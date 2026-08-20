export const APP_NAME = 'lnwjud';
export const APP_VERSION = '4.0.0';

export interface ApiRouteDefinition {
  readonly method: 'GET' | 'POST';
  readonly path: string;
}

/**
 * REST route for every dashboard operation, served by the loopback dashboard
 * HTTP server (apps/desktop/src/main/dashboard-server.ts) and consumed by the
 * renderer's fetch-based client (apps/desktop/src/renderer/api/client.ts).
 */
export const apiRoutes = {
  listWorkspaces: { method: 'GET', path: '/api/workspaces' },
  addWorkspace: { method: 'POST', path: '/api/workspaces' },
  selectWorkspace: { method: 'POST', path: '/api/workspaces/select' },
  getDashboard: { method: 'GET', path: '/api/dashboard' },
  setPermissionProfile: { method: 'POST', path: '/api/permission-profile' },
  setUnrestrictedMode: { method: 'POST', path: '/api/unrestricted-mode' },
  listProcesses: { method: 'GET', path: '/api/processes' },
  startProcess: { method: 'POST', path: '/api/processes' },
  stopProcess: { method: 'POST', path: '/api/processes/stop' },
  startMcp: { method: 'POST', path: '/api/mcp/start' },
  stopMcp: { method: 'POST', path: '/api/mcp/stop' },
  restartMcp: { method: 'POST', path: '/api/mcp/restart' },
  clearWorkLog: { method: 'POST', path: '/api/work-log/clear' },
  saveTunnelApiKey: { method: 'POST', path: '/api/tunnel/api-key' },
  startTunnel: { method: 'POST', path: '/api/tunnel/start' },
  stopTunnel: { method: 'POST', path: '/api/tunnel/stop' },
  getTunnelStatus: { method: 'GET', path: '/api/tunnel/status' },
  setTunnelClientPath: { method: 'POST', path: '/api/tunnel/client-path' },
  setLocale: { method: 'POST', path: '/api/locale' },
  launchManagedBrowser: { method: 'POST', path: '/api/managed-browser/launch' },
  runDoctor: { method: 'POST', path: '/api/doctor/run' },
  getLogSnapshot: { method: 'GET', path: '/api/logs' },
  clearLogBuffer: { method: 'POST', path: '/api/logs/clear' },
  exportLogs: { method: 'POST', path: '/api/logs/export' },
  openLogViewer: { method: 'POST', path: '/api/log-viewer/open' },
} as const satisfies Record<string, ApiRouteDefinition>;

export type ApiOperation = keyof typeof apiRoutes;

/** WebSocket path the dashboard server upgrades on (apps/desktop/src/main/dashboard-ws.ts). */
export const DASHBOARD_WS_PATH = '/ws';

/**
 * Real-time messages pushed over the dashboard WebSocket. `log` replaces the
 * old Electron `pushChannels.logEvent` IPC push; `dashboard` is emitted after
 * any mutating operation so the UI stays live without polling.
 */
export type WsMessage =
  | { readonly type: 'log'; readonly payload: LogLine }
  | { readonly type: 'dashboard'; readonly payload: DashboardSnapshot };

export type PermissionProfileName = 'safe' | 'balanced' | 'full' | 'custom';
export type UiLocale = 'th' | 'en';
export type AgentState = 'stopped' | 'idle' | 'busy';
export type TunnelRunState = 'stopped' | 'starting' | 'running' | 'error';

export interface WorkspaceSummary {
  readonly id: string;
  readonly displayName: string;
  readonly rootPath: string;
  readonly realRootPath: string;
  readonly createdAt: string;
}

export type CapabilityToolName = 'shell' | 'dom_cdp' | 'accessibility' | 'input_event' | 'vision' | 'window' | 'health' | 'system_info' | 'notification' | 'file_dialog' | 'clipboard' | 'web_fetch' | 'audio' | 'screen_record' | 'office' | 'scheduler' | 'wsl_exec' | 'wsl_fs';

export interface CapabilitySummary {
  readonly name: CapabilityToolName;
  readonly title: string;
  readonly description: string;
  readonly available: boolean;
  readonly ready: boolean;
}

export interface WorkLogEntry {
  readonly id: string;
  readonly timestamp: string;
  readonly kind: 'task' | 'result' | 'error';
  readonly toolName: string;
  readonly resultCode: string;
  readonly errorMessage: string | null;
  readonly targetSummary: string | null;
  readonly durationMs: number;
  readonly workspaceId: string | null;
  readonly callId?: string;
}

export interface InFlightWorkItem {
  readonly callId: string;
  readonly toolName: string;
  readonly startedAt: string;
  readonly targetSummary: string | null;
  readonly workspaceId: string | null;
}

export interface ConnectionModes {
  readonly httpUrl: string | null;
  readonly stdioCommand: string;
}

export interface TunnelStatus {
  readonly state: TunnelRunState;
  /** desktop = started by this app; external = started by a script or another process. */
  readonly source: 'desktop' | 'external';
  readonly hasApiKey: boolean;
  readonly clientPath: string | null;
  readonly profileExists: boolean;
  readonly message: string | null;
  readonly logPath: string | null;
}

export type LogSource = 'tunnel' | 'mcp' | 'process';
export type LogLevel = 'info' | 'warn' | 'error';

export interface LogLine {
  readonly id: number;
  readonly source: LogSource;
  readonly timestamp: string;
  readonly level: LogLevel;
  readonly text: string;
}

export interface LogSnapshot {
  readonly lines: readonly LogLine[];
  readonly tunnelLogPath: string | null;
  readonly tunnelLogExists: boolean;
}

export interface ClearLogBufferRequest {
  readonly source: LogSource;
}

export interface ExportLogsRequest {
  readonly source: LogSource;
  readonly filePath: string;
}

export interface GitStatusEntrySummary {
  readonly path: string;
  readonly kind: string;
  readonly indexStatus: string;
  readonly worktreeStatus: string;
}

export interface DashboardGitSummary {
  readonly branch: string | null;
  readonly changedFiles: number;
  readonly stagedFiles: number;
  readonly message: string;
  readonly repositoryPath?: string | null;
  readonly isRepo?: boolean;
  readonly entries?: readonly GitStatusEntrySummary[];
}

export interface DashboardSnapshot {
  readonly selectedWorkspace: WorkspaceSummary | null;
  readonly gitSummary: DashboardGitSummary;
  readonly mcp: {
    readonly running: boolean;
    readonly url: string | null;
    readonly workspaceId: string | null;
  };
  readonly codex: {
    readonly installed: boolean;
    readonly version: string | null;
  };
  readonly managedProcessCount: number;
  readonly auditEventCount: number;
  readonly recentAuditEvents: readonly AuditEventSummary[];
  readonly permissionProfile: PermissionProfileName;
  readonly capabilities: readonly CapabilitySummary[];
  readonly agentState: AgentState;
  readonly mode: 'WORK';
  readonly locale: UiLocale;
  readonly unrestricted: boolean;
  readonly connectionModes: ConnectionModes;
  readonly workLog: readonly WorkLogEntry[];
  readonly inFlight: readonly InFlightWorkItem[];
  readonly tunnel: TunnelStatus;
  readonly appVersion: string;
}

export interface AuditEventSummary {
  readonly id: string;
  readonly timestamp: string;
  readonly action: string;
  readonly resultCode: string;
}

export interface ProcessSummary {
  readonly id: string;
  readonly workspaceId: string;
  readonly executable: string;
  readonly args: readonly string[];
  readonly state: 'starting' | 'running' | 'exited' | 'failed' | 'stopped' | 'timed_out';
  readonly logSummary: string;
}

export type DoctorCheckStatus = 'pass' | 'warn' | 'fail';

export interface DoctorCheck {
  readonly id: string;
  readonly required: boolean;
  readonly status: DoctorCheckStatus;
  readonly message: string;
}

export interface DoctorReport {
  readonly checks: readonly DoctorCheck[];
  readonly exitCode: 0 | 1;
}

export interface AddWorkspaceRequest {
  readonly rootPath: string;
}

export interface SelectWorkspaceRequest {
  readonly workspaceId: string;
}

export interface SetPermissionProfileRequest {
  readonly profile: PermissionProfileName;
}

export interface SetUnrestrictedModeRequest {
  readonly enabled: boolean;
}

export interface StartProcessRequest {
  readonly workspaceId: string;
  readonly mode: 'fixture' | 'project-dev';
}

export interface StopProcessRequest {
  readonly processId: string;
}

export interface StartMcpRequest {
  readonly workspaceId: string;
}

export interface SaveTunnelApiKeyRequest {
  readonly apiKey: string;
}

export interface SetTunnelClientPathRequest {
  readonly clientPath: string;
}

export interface SetLocaleRequest {
  readonly locale: UiLocale;
}

export interface McpConnectionStatus {
  readonly running: boolean;
  readonly url: string | null;
  readonly workspaceId: string | null;
}

export interface ManagedBrowserStatus {
  readonly ready: boolean;
  readonly port: number;
  readonly launched: boolean;
}

export interface ApiRequestMap {
  readonly listWorkspaces: undefined;
  readonly addWorkspace: AddWorkspaceRequest;
  readonly selectWorkspace: SelectWorkspaceRequest;
  readonly getDashboard: undefined;
  readonly setPermissionProfile: SetPermissionProfileRequest;
  readonly setUnrestrictedMode: SetUnrestrictedModeRequest;
  readonly listProcesses: undefined;
  readonly startProcess: StartProcessRequest;
  readonly stopProcess: StopProcessRequest;
  readonly startMcp: StartMcpRequest;
  readonly stopMcp: undefined;
  readonly restartMcp: undefined;
  readonly clearWorkLog: undefined;
  readonly saveTunnelApiKey: SaveTunnelApiKeyRequest;
  readonly startTunnel: undefined;
  readonly stopTunnel: undefined;
  readonly getTunnelStatus: undefined;
  readonly setTunnelClientPath: SetTunnelClientPathRequest;
  readonly setLocale: SetLocaleRequest;
  readonly launchManagedBrowser: undefined;
  readonly runDoctor: undefined;
  readonly getLogSnapshot: undefined;
  readonly clearLogBuffer: ClearLogBufferRequest;
  readonly exportLogs: ExportLogsRequest;
  readonly openLogViewer: undefined;
}

export interface ApiResponseMap {
  readonly listWorkspaces: readonly WorkspaceSummary[];
  readonly addWorkspace: WorkspaceSummary;
  readonly selectWorkspace: WorkspaceSummary;
  readonly getDashboard: DashboardSnapshot;
  readonly setPermissionProfile: { readonly profile: PermissionProfileName };
  readonly setUnrestrictedMode: { readonly unrestricted: boolean; readonly restartRequired: boolean };
  readonly listProcesses: readonly ProcessSummary[];
  readonly startProcess: ProcessSummary;
  readonly stopProcess: { readonly stopped: boolean };
  readonly startMcp: McpConnectionStatus;
  readonly stopMcp: McpConnectionStatus;
  readonly restartMcp: McpConnectionStatus;
  readonly clearWorkLog: { readonly cleared: boolean };
  readonly saveTunnelApiKey: { readonly saved: boolean };
  readonly startTunnel: TunnelStatus;
  readonly stopTunnel: TunnelStatus;
  readonly getTunnelStatus: TunnelStatus;
  readonly setTunnelClientPath: { readonly clientPath: string };
  readonly setLocale: { readonly locale: UiLocale };
  readonly launchManagedBrowser: ManagedBrowserStatus;
  readonly runDoctor: DoctorReport;
  readonly getLogSnapshot: LogSnapshot;
  readonly clearLogBuffer: { readonly cleared: boolean };
  readonly exportLogs: { readonly exported: boolean };
  readonly openLogViewer: { readonly opened: boolean };
}

/** Renderer-side fetch client contract (apps/desktop/src/renderer/api/client.ts). */
export interface DashboardApiClient {
  listWorkspaces(): Promise<ApiResponseMap['listWorkspaces']>;
  addWorkspace(request: AddWorkspaceRequest): Promise<ApiResponseMap['addWorkspace']>;
  selectWorkspace(request: SelectWorkspaceRequest): Promise<ApiResponseMap['selectWorkspace']>;
  getDashboard(): Promise<ApiResponseMap['getDashboard']>;
  setPermissionProfile(request: SetPermissionProfileRequest): Promise<ApiResponseMap['setPermissionProfile']>;
  setUnrestrictedMode(request: SetUnrestrictedModeRequest): Promise<ApiResponseMap['setUnrestrictedMode']>;
  listProcesses(): Promise<ApiResponseMap['listProcesses']>;
  startProcess(request: StartProcessRequest): Promise<ApiResponseMap['startProcess']>;
  stopProcess(request: StopProcessRequest): Promise<ApiResponseMap['stopProcess']>;
  startMcp(request: StartMcpRequest): Promise<ApiResponseMap['startMcp']>;
  stopMcp(): Promise<ApiResponseMap['stopMcp']>;
  restartMcp(): Promise<ApiResponseMap['restartMcp']>;
  clearWorkLog(): Promise<ApiResponseMap['clearWorkLog']>;
  saveTunnelApiKey(request: SaveTunnelApiKeyRequest): Promise<ApiResponseMap['saveTunnelApiKey']>;
  startTunnel(): Promise<ApiResponseMap['startTunnel']>;
  stopTunnel(): Promise<ApiResponseMap['stopTunnel']>;
  getTunnelStatus(): Promise<ApiResponseMap['getTunnelStatus']>;
  setTunnelClientPath(request: SetTunnelClientPathRequest): Promise<ApiResponseMap['setTunnelClientPath']>;
  setLocale(request: SetLocaleRequest): Promise<ApiResponseMap['setLocale']>;
  launchManagedBrowser(): Promise<ApiResponseMap['launchManagedBrowser']>;
  runDoctor(): Promise<ApiResponseMap['runDoctor']>;
  getLogSnapshot(): Promise<ApiResponseMap['getLogSnapshot']>;
  clearLogBuffer(request: ClearLogBufferRequest): Promise<ApiResponseMap['clearLogBuffer']>;
  exportLogs(request: ExportLogsRequest): Promise<ApiResponseMap['exportLogs']>;
  openLogViewer(): Promise<ApiResponseMap['openLogViewer']>;
}
