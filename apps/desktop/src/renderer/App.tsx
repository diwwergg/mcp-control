import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import type {
  DashboardSnapshot,
  DoctorReport,
  LogLine,
  LogSource,
  PermissionProfileName,
  UiLocale,
  WorkspaceSummary,
} from '@lnwjud/ipc-contracts';
import { apiClient } from './api/client.js';
import { connectDashboardSocket } from './api/socket.js';
import { AppShell, type Screen } from './features/shell/AppShell.js';
import { ControlCenterPage } from './features/home/ControlCenterPage.js';
import { ProjectsPage } from './features/projects/ProjectsPage.js';
import { GitPage } from './features/git/GitPage.js';
import { WorkLogPage } from './features/worklog/WorkLogPage.js';
import { LiveLogsPage } from './features/live/LiveLogsPage.js';
import { applyLogSnapshot } from './features/live/log-buffer.js';
import { SettingsPage } from './features/settings/SettingsPage.js';
import { DoctorPanel } from './features/doctor/DoctorPanel.js';
import { createTranslator } from './i18n/index.js';

const MAX_CLIENT_LOG_LINES = 4_000;

export function App(): ReactElement {
  const [screen, setScreen] = useState<Screen>('home');
  const [dashboard, setDashboard] = useState<DashboardSnapshot | null>(null);
  const [workspaces, setWorkspaces] = useState<readonly WorkspaceSummary[]>([]);
  const [doctor, setDoctor] = useState<DoctorReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mcpBusy, setMcpBusy] = useState(false);
  const [tunnelBusy, setTunnelBusy] = useState(false);
  const [locale, setLocale] = useState<UiLocale>('th');
  const [logLines, setLogLines] = useState<readonly LogLine[]>([]);
  const [tunnelLogPath, setTunnelLogPath] = useState<string | null>(null);
  const [tunnelLogExists, setTunnelLogExists] = useState(false);
  const logIds = useRef<Set<number>>(new Set());

  const t = createTranslator(locale);

  const appendLogLine = useCallback((line: LogLine): void => {
    if (logIds.current.has(line.id)) return;
    logIds.current.add(line.id);
    setLogLines((previous) => [...previous.slice(-(MAX_CLIENT_LOG_LINES - 1)), line]);
  }, []);

  useEffect(() => {
    let disposed = false;
    void apiClient.getLogSnapshot().then((snapshot) => {
      if (disposed) return;
      setLogLines((previous) => {
        const merged = applyLogSnapshot(previous, logIds.current, snapshot.lines);
        logIds.current = merged.ids;
        return merged.lines;
      });
      setTunnelLogPath(snapshot.tunnelLogPath);
      setTunnelLogExists(snapshot.tunnelLogExists);
    }).catch(() => undefined);
    return (): void => {
      disposed = true;
    };
  }, []);

  async function clearLogSource(source: LogSource): Promise<void> {
    try {
      await apiClient.clearLogBuffer({ source });
      setLogLines((previous) => previous.filter((line) => line.source !== source));
    } catch (cause: unknown) {
      setError(errorMessage(cause, t('error.logBufferClear')));
    }
  }

  async function exportLogSource(source: LogSource): Promise<void> {
    try {
      await apiClient.exportLogs({ source, filePath: '' });
    } catch (cause: unknown) {
      setError(errorMessage(cause, t('error.logExport')));
    }
  }

  async function popOutLogViewer(): Promise<void> {
    try {
      await apiClient.openLogViewer();
    } catch (cause: unknown) {
      setError(errorMessage(cause, t('error.logViewerOpen')));
    }
  }

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [nextDashboard, nextWorkspaces] = await Promise.all([
        apiClient.getDashboard(),
        apiClient.listWorkspaces(),
      ]);
      setDashboard(nextDashboard);
      setWorkspaces(nextWorkspaces);
      setLocale(nextDashboard.locale);
      setError(null);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : createTranslator(locale)('error.desktopService'));
    }
  }, [locale]);

  useEffect(() => {
    void refresh();
    // WebSocket `dashboard` pushes (below) deliver near-real-time updates after any
    // mutation; this slow interval only catches background drift (e.g. a process
    // exiting on its own) between pushes.
    const interval = window.setInterval(() => { void refresh(); }, 5_000);
    return (): void => { window.clearInterval(interval); };
  }, [refresh]);

  useEffect(() => {
    const socket = connectDashboardSocket();
    const unsubscribe = socket.subscribe((message) => {
      if (message.type === 'dashboard') {
        setDashboard(message.payload);
        setLocale(message.payload.locale);
        return;
      }
      appendLogLine(message.payload);
      if (message.payload.source === 'tunnel') setTunnelLogExists(true);
    });
    return (): void => {
      unsubscribe();
      socket.close();
    };
  }, [appendLogLine]);

  async function addWorkspace(rootPath: string): Promise<void> {
    try {
      await apiClient.addWorkspace({ rootPath });
      await refresh();
    } catch (cause: unknown) {
      setError(errorMessage(cause, t('error.workspaceAdd')));
    }
  }

  async function selectWorkspace(workspaceId: string): Promise<void> {
    try {
      setMcpBusy(true);
      await apiClient.selectWorkspace({ workspaceId });
      await refresh();
    } catch (cause: unknown) {
      setError(errorMessage(cause, t('error.workspaceSelect')));
    } finally {
      setMcpBusy(false);
    }
  }

  async function setPermissionProfile(profile: PermissionProfileName): Promise<void> {
    try {
      await apiClient.setPermissionProfile({ profile });
      await refresh();
    } catch (cause: unknown) {
      setError(errorMessage(cause, t('error.permissionProfileChange')));
    }
  }

  async function setUnrestrictedMode(enabled: boolean): Promise<boolean> {
    try {
      const result = await apiClient.setUnrestrictedMode({ enabled });
      await refresh();
      return result.restartRequired;
    } catch (cause: unknown) {
      setError(errorMessage(cause, t('error.unrestrictedModeChange')));
      return true;
    }
  }

  async function stopMcp(): Promise<void> {
    try {
      setMcpBusy(true);
      await apiClient.stopMcp();
      await refresh();
    } catch (cause: unknown) {
      setError(errorMessage(cause, t('error.mcpStop')));
    } finally {
      setMcpBusy(false);
    }
  }

  async function restartMcp(): Promise<void> {
    try {
      setMcpBusy(true);
      await apiClient.restartMcp();
      await refresh();
    } catch (cause: unknown) {
      setError(errorMessage(cause, t('error.mcpRestart')));
    } finally {
      setMcpBusy(false);
    }
  }

  async function clearWorkLog(): Promise<void> {
    try {
      await apiClient.clearWorkLog();
      await refresh();
    } catch (cause: unknown) {
      setError(errorMessage(cause, t('error.workLogClear')));
    }
  }

  async function startTunnel(): Promise<void> {
    try {
      setTunnelBusy(true);
      await apiClient.startTunnel();
      await refresh();
    } catch (cause: unknown) {
      setError(errorMessage(cause, t('error.tunnelStart')));
    } finally {
      setTunnelBusy(false);
    }
  }

  async function stopTunnel(): Promise<void> {
    try {
      setTunnelBusy(true);
      await apiClient.stopTunnel();
      await refresh();
    } catch (cause: unknown) {
      setError(errorMessage(cause, t('error.tunnelStop')));
    } finally {
      setTunnelBusy(false);
    }
  }

  async function saveTunnelApiKey(apiKey: string): Promise<void> {
    await apiClient.saveTunnelApiKey({ apiKey });
    await refresh();
  }

  async function setTunnelClientPath(clientPath: string): Promise<void> {
    await apiClient.setTunnelClientPath({ clientPath });
    await refresh();
  }

  async function changeLocale(next: UiLocale): Promise<void> {
    await apiClient.setLocale({ locale: next });
    setLocale(next);
    await refresh();
  }

  async function runDoctor(): Promise<void> {
    try {
      setDoctor(await apiClient.runDoctor());
    } catch (cause: unknown) {
      setError(errorMessage(cause, t('error.doctorRun')));
    }
  }

  if (dashboard === null) {
    return <div className="boot-screen">{t('app.loading')}</div>;
  }

  return (
    <AppShell
      locale={locale}
      appVersion={dashboard.appVersion}
      mcpRunning={dashboard.mcp.running}
      screen={screen}
      onNavigate={setScreen}
      onLocaleChange={(next) => { void changeLocale(next); }}
    >
      {error === null ? null : <div className="error-banner" role="alert">{error}</div>}
      {screen === 'home' ? (
        <ControlCenterPage
          dashboard={dashboard}
          workspaces={workspaces}
          locale={locale}
          mcpBusy={mcpBusy}
          tunnelBusy={tunnelBusy}
          onRefresh={refresh}
          onStopMcp={stopMcp}
          onRestartMcp={restartMcp}
          onSelectWorkspace={selectWorkspace}
          onAddWorkspace={addWorkspace}
          onStartTunnel={startTunnel}
          onStopTunnel={stopTunnel}
          onClearWorkLog={clearWorkLog}
        />
      ) : null}
      {screen === 'projects' ? (
        <ProjectsPage
          locale={locale}
          workspaces={workspaces}
          selectedWorkspaceId={dashboard.selectedWorkspace?.id ?? null}
          onSelectWorkspace={selectWorkspace}
          onAddWorkspace={addWorkspace}
        />
      ) : null}
      {screen === 'git' ? (
        <GitPage
          locale={locale}
          gitSummary={dashboard.gitSummary}
          selectedWorkspace={dashboard.selectedWorkspace}
          workspaces={workspaces}
          onSelectWorkspace={selectWorkspace}
          onRefresh={refresh}
        />
      ) : null}
      {screen === 'worklog' ? (
        <WorkLogPage locale={locale} dashboard={dashboard} onClearWorkLog={clearWorkLog} />
      ) : null}
      {screen === 'live' ? (
        <LiveLogsPage
          locale={locale}
          lines={logLines}
          tunnelLogPath={tunnelLogPath}
          tunnelLogExists={tunnelLogExists}
          onClear={clearLogSource}
          onExport={exportLogSource}
          onPopOut={popOutLogViewer}
        />
      ) : null}
      {screen === 'settings' ? (
        <SettingsPage
          locale={locale}
          dashboard={dashboard}
          onLocaleChange={changeLocale}
          onPermissionProfileChange={setPermissionProfile}
          onUnrestrictedChange={setUnrestrictedMode}
          onSaveTunnelApiKey={saveTunnelApiKey}
          onSetTunnelClientPath={setTunnelClientPath}
        />
      ) : null}
      {screen === 'doctor' ? (
        <div className="page-content">
          <h1>{t('doctor.title')}</h1>
          <DoctorPanel locale={locale} report={doctor} onRunDoctor={runDoctor} />
        </div>
      ) : null}
    </AppShell>
  );
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.trim().length > 0 ? cause.message : fallback;
}
