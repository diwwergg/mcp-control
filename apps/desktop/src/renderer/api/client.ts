import { apiRoutes, type DashboardApiClient } from '@lnwjud/ipc-contracts';

async function call<T>(operation: keyof typeof apiRoutes, body?: unknown): Promise<T> {
  const route = apiRoutes[operation];
  const response = await fetch(route.path, {
    method: route.method,
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const message = payload !== undefined && typeof payload === 'object' && payload !== null && 'error' in payload && typeof (payload as { error?: unknown }).error === 'string'
      ? (payload as { error: string }).error
      : `Request failed: ${route.method} ${route.path}`;
    throw new Error(message);
  }
  return payload as T;
}

export const apiClient: DashboardApiClient = {
  listWorkspaces: () => call('listWorkspaces'),
  addWorkspace: (request) => call('addWorkspace', request),
  selectWorkspace: (request) => call('selectWorkspace', request),
  getDashboard: () => call('getDashboard'),
  setPermissionProfile: (request) => call('setPermissionProfile', request),
  setUnrestrictedMode: (request) => call('setUnrestrictedMode', request),
  listProcesses: () => call('listProcesses'),
  startProcess: (request) => call('startProcess', request),
  stopProcess: (request) => call('stopProcess', request),
  startMcp: (request) => call('startMcp', request),
  stopMcp: () => call('stopMcp', {}),
  restartMcp: () => call('restartMcp', {}),
  clearWorkLog: () => call('clearWorkLog', {}),
  saveTunnelApiKey: (request) => call('saveTunnelApiKey', request),
  startTunnel: () => call('startTunnel', {}),
  stopTunnel: () => call('stopTunnel', {}),
  getTunnelStatus: () => call('getTunnelStatus'),
  setTunnelClientPath: (request) => call('setTunnelClientPath', request),
  setLocale: (request) => call('setLocale', request),
  launchManagedBrowser: () => call('launchManagedBrowser', {}),
  runDoctor: () => call('runDoctor', {}),
  getLogSnapshot: () => call('getLogSnapshot'),
  clearLogBuffer: (request) => call('clearLogBuffer', request),
  exportLogs: (request) => call('exportLogs', request),
  openLogViewer: () => call('openLogViewer', {}),
};
