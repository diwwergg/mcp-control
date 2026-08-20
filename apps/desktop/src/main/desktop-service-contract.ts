import {
  APP_VERSION,
  type AddWorkspaceRequest,
  type ClearLogBufferRequest,
  type DashboardSnapshot,
  type DoctorReport,
  type LogSnapshot,
  type ManagedBrowserStatus,
  type McpConnectionStatus,
  type ProcessSummary,
  type PermissionProfileName,
  type SaveTunnelApiKeyRequest,
  type SelectWorkspaceRequest,
  type SetLocaleRequest,
  type SetPermissionProfileRequest,
  type SetTunnelClientPathRequest,
  type SetUnrestrictedModeRequest,
  type StartMcpRequest,
  type StartProcessRequest,
  type StopProcessRequest,
  type TunnelStatus,
  type UiLocale,
  type WorkspaceSummary,
} from '@lnwjud/ipc-contracts';

/**
 * Transport-agnostic dashboard operations. Implemented by
 * desktop-services.ts and called from dashboard-server.ts's HTTP route
 * handlers.
 */
export interface DesktopIpcServices {
  listWorkspaces(): Promise<readonly WorkspaceSummary[]>;
  addWorkspace(request: AddWorkspaceRequest): Promise<WorkspaceSummary>;
  selectWorkspace(request: SelectWorkspaceRequest): Promise<WorkspaceSummary>;
  getDashboard(): Promise<DashboardSnapshot>;
  setPermissionProfile(request: SetPermissionProfileRequest): Promise<{ readonly profile: PermissionProfileName }>;
  setUnrestrictedMode(request: SetUnrestrictedModeRequest): Promise<{ readonly unrestricted: boolean; readonly restartRequired: boolean }>;
  listProcesses(): Promise<readonly ProcessSummary[]>;
  startProcess(request: StartProcessRequest): Promise<ProcessSummary>;
  stopProcess(request: StopProcessRequest): Promise<{ readonly stopped: boolean }>;
  startMcp(request: StartMcpRequest): Promise<McpConnectionStatus>;
  stopMcp(): Promise<McpConnectionStatus>;
  restartMcp(): Promise<McpConnectionStatus>;
  clearWorkLog(): Promise<{ readonly cleared: boolean }>;
  saveTunnelApiKey(request: SaveTunnelApiKeyRequest): Promise<{ readonly saved: boolean }>;
  startTunnel(): Promise<TunnelStatus>;
  stopTunnel(): Promise<TunnelStatus>;
  getTunnelStatus(): Promise<TunnelStatus>;
  setTunnelClientPath(request: SetTunnelClientPathRequest): Promise<{ readonly clientPath: string }>;
  setLocale(request: SetLocaleRequest): Promise<{ readonly locale: UiLocale }>;
  launchManagedBrowser(): Promise<ManagedBrowserStatus>;
  runDoctor(): Promise<DoctorReport>;
  getLogSnapshot(): Promise<LogSnapshot>;
  clearLogBuffer(request: ClearLogBufferRequest): Promise<{ readonly cleared: boolean }>;
}

const emptyTunnel: TunnelStatus = {
  state: 'stopped',
  source: 'desktop',
  hasApiKey: false,
  clientPath: null,
  profileExists: false,
  message: null,
  logPath: null,
};

export const defaultDesktopServices: DesktopIpcServices = {
  listWorkspaces: async (): Promise<readonly WorkspaceSummary[]> => [],
  addWorkspace: async (): Promise<WorkspaceSummary> => {
    throw new Error('Workspace service is not configured');
  },
  selectWorkspace: async (): Promise<WorkspaceSummary> => {
    throw new Error('Workspace service is not configured');
  },
  getDashboard: async (): Promise<DashboardSnapshot> => ({
    selectedWorkspace: null,
    gitSummary: { branch: null, changedFiles: 0, stagedFiles: 0, message: 'No workspace selected' },
    mcp: { running: false, url: null, workspaceId: null },
    codex: { installed: false, version: null },
    managedProcessCount: 0,
    auditEventCount: 0,
    recentAuditEvents: [],
    permissionProfile: 'safe',
    capabilities: [],
    agentState: 'stopped',
    mode: 'WORK',
    locale: 'th',
    unrestricted: false,
    connectionModes: { httpUrl: null, stdioCommand: 'lnwjud.exe --mcp-stdio' },
    workLog: [],
    inFlight: [],
    tunnel: emptyTunnel,
    appVersion: APP_VERSION,
  }),
  setPermissionProfile: async (request): Promise<{ readonly profile: PermissionProfileName }> => ({ profile: request.profile }),
  setUnrestrictedMode: async (request): Promise<{ readonly unrestricted: boolean; readonly restartRequired: boolean }> => ({
    unrestricted: request.enabled,
    restartRequired: false,
  }),
  listProcesses: async (): Promise<readonly ProcessSummary[]> => [],
  startProcess: async (): Promise<ProcessSummary> => {
    throw new Error('Desktop services are not configured');
  },
  stopProcess: async (): Promise<{ readonly stopped: boolean }> => ({ stopped: false }),
  startMcp: async (): Promise<McpConnectionStatus> => ({ running: false, url: null, workspaceId: null }),
  stopMcp: async (): Promise<McpConnectionStatus> => ({ running: false, url: null, workspaceId: null }),
  restartMcp: async (): Promise<McpConnectionStatus> => ({ running: false, url: null, workspaceId: null }),
  clearWorkLog: async (): Promise<{ readonly cleared: boolean }> => ({ cleared: false }),
  saveTunnelApiKey: async (): Promise<{ readonly saved: boolean }> => ({ saved: false }),
  startTunnel: async (): Promise<TunnelStatus> => emptyTunnel,
  stopTunnel: async (): Promise<TunnelStatus> => emptyTunnel,
  getTunnelStatus: async (): Promise<TunnelStatus> => emptyTunnel,
  setTunnelClientPath: async (request): Promise<{ readonly clientPath: string }> => ({ clientPath: request.clientPath }),
  setLocale: async (request): Promise<{ readonly locale: UiLocale }> => ({ locale: request.locale }),
  launchManagedBrowser: async (): Promise<ManagedBrowserStatus> => ({ ready: false, port: 9222, launched: false }),
  runDoctor: async (): Promise<DoctorReport> => ({
    checks: [{ id: 'desktop', required: true, status: 'fail', message: 'Desktop services are not configured' }],
    exitCode: 1,
  }),
  getLogSnapshot: async (): Promise<LogSnapshot> => ({
    lines: [],
    tunnelLogPath: null,
    tunnelLogExists: false,
  }),
  clearLogBuffer: async (): Promise<{ readonly cleared: boolean }> => ({ cleared: false }),
};
