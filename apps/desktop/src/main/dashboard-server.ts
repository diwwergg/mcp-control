import { createReadStream } from 'node:fs';
import { stat, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import { dialog } from 'electron';
import { createOriginPolicy, type OriginPolicy } from '@lnwjud/mcp-server';
import {
  apiRoutes,
  type AddWorkspaceRequest,
  type ApiOperation,
  type ClearLogBufferRequest,
  type ExportLogsRequest,
  type LogSource,
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
} from '@lnwjud/ipc-contracts';
import type { DesktopIpcServices } from './desktop-service-contract.js';
import { toFetchRequest } from './dashboard-http-shared.js';

export const DEFAULT_DASHBOARD_PORT = 18766;

export interface DashboardServerAddress {
  readonly host: '127.0.0.1';
  readonly port: number;
}

export interface DashboardServerHandle {
  readonly server: HttpServer;
  readonly address: DashboardServerAddress;
  close(): Promise<void>;
}

export interface DashboardServerOptions {
  readonly port: number;
  readonly staticRoot: string;
  readonly services: DesktopIpcServices;
  readonly getMainWindow: () => BrowserWindow | null;
  readonly openLogViewer: () => boolean;
  readonly onMutation?: () => void;
  readonly originPolicy?: OriginPolicy;
}

const MAX_BODY_BYTES = 1_048_576;

const MIME_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
};

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(text);
}

function sendText(response: ServerResponse, status: number, text: string): void {
  response.statusCode = status;
  response.setHeader('content-type', 'text/plain; charset=utf-8');
  response.end(text);
}

async function writeFetchResponse(response: ServerResponse, result: Response): Promise<void> {
  response.statusCode = result.status;
  result.headers.forEach((value, name) => response.setHeader(name, value));
  response.end(result.body === null ? undefined : Buffer.from(await result.arrayBuffer()));
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const declaredLength = Number(request.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new Error('Request body too large');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error('Request body too large');
    chunks.push(buffer);
  }
  if (chunks.length === 0) return undefined;
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (text.length === 0) return undefined;
  return JSON.parse(text) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`Invalid request body: ${field}`);
  return value;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPermissionProfile(value: unknown): value is PermissionProfileName {
  return value === 'safe' || value === 'balanced' || value === 'full' || value === 'custom';
}

function isLogSource(value: unknown): value is LogSource {
  return value === 'tunnel' || value === 'mcp' || value === 'process';
}

function parseAddWorkspaceRequest(body: unknown): AddWorkspaceRequest {
  if (!isRecord(body)) throw new Error('Invalid request body');
  return { rootPath: nonEmptyString(body.rootPath, 'rootPath') };
}

function parseSelectWorkspaceRequest(body: unknown): SelectWorkspaceRequest {
  if (!isRecord(body)) throw new Error('Invalid request body');
  return { workspaceId: nonEmptyString(body.workspaceId, 'workspaceId') };
}

function parseSetPermissionProfileRequest(body: unknown): SetPermissionProfileRequest {
  if (!isRecord(body) || !isPermissionProfile(body.profile)) throw new Error('Invalid request body: profile');
  return { profile: body.profile };
}

function parseSetUnrestrictedModeRequest(body: unknown): SetUnrestrictedModeRequest {
  if (!isRecord(body) || typeof body.enabled !== 'boolean') throw new Error('Invalid request body: enabled');
  return { enabled: body.enabled };
}

function parseStartProcessRequest(body: unknown): StartProcessRequest {
  if (!isRecord(body)) throw new Error('Invalid request body');
  if (!isNonEmptyString(body.workspaceId)) throw new Error('Invalid request body: workspaceId');
  if (body.mode !== 'fixture' && body.mode !== 'project-dev') throw new Error('Invalid request body: mode');
  return { workspaceId: body.workspaceId, mode: body.mode };
}

function parseStopProcessRequest(body: unknown): StopProcessRequest {
  if (!isRecord(body)) throw new Error('Invalid request body');
  return { processId: nonEmptyString(body.processId, 'processId') };
}

function parseStartMcpRequest(body: unknown): StartMcpRequest {
  if (!isRecord(body) || !isNonEmptyString(body.workspaceId)) throw new Error('Invalid request body: workspaceId');
  return { workspaceId: body.workspaceId };
}

function parseSaveTunnelApiKeyRequest(body: unknown): SaveTunnelApiKeyRequest {
  if (!isRecord(body)) throw new Error('Invalid request body');
  return { apiKey: nonEmptyString(body.apiKey, 'apiKey') };
}

function parseSetTunnelClientPathRequest(body: unknown): SetTunnelClientPathRequest {
  if (!isRecord(body)) throw new Error('Invalid request body');
  return { clientPath: nonEmptyString(body.clientPath, 'clientPath') };
}

function parseSetLocaleRequest(body: unknown): SetLocaleRequest {
  if (!isRecord(body) || (body.locale !== 'th' && body.locale !== 'en')) throw new Error('Invalid request body: locale');
  return { locale: body.locale };
}

function parseClearLogBufferRequest(body: unknown): ClearLogBufferRequest {
  if (!isRecord(body) || !isLogSource(body.source)) throw new Error('Invalid request body: source');
  return { source: body.source };
}

function parseExportLogsRequest(body: unknown): ExportLogsRequest {
  if (!isRecord(body) || !isLogSource(body.source)) throw new Error('Invalid request body');
  return { source: body.source, filePath: typeof body.filePath === 'string' ? body.filePath : '' };
}

/** Operations that mutate server state and should trigger a `dashboard` WebSocket push. */
const MUTATING_OPERATIONS: ReadonlySet<ApiOperation> = new Set([
  'addWorkspace', 'selectWorkspace', 'setPermissionProfile', 'setUnrestrictedMode',
  'startProcess', 'stopProcess', 'startMcp', 'stopMcp', 'restartMcp', 'clearWorkLog',
  'saveTunnelApiKey', 'startTunnel', 'stopTunnel', 'setTunnelClientPath', 'setLocale',
]);

async function exportLogsToFile(
  window: BrowserWindow | null,
  services: DesktopIpcServices,
  request: ExportLogsRequest,
): Promise<{ readonly exported: boolean }> {
  if (window === null) return { exported: false };
  const result = await dialog.showSaveDialog(window, {
    title: 'Export lnwjud logs',
    defaultPath: `lnwjud-${request.source}-logs.txt`,
    filters: [{ name: 'Text', extensions: ['txt', 'log'] }],
  });
  if (result.canceled || result.filePath === undefined || result.filePath.length === 0) {
    return { exported: false };
  }
  const snapshot = await services.getLogSnapshot();
  const content = snapshot.lines
    .filter((line) => line.source === request.source)
    .map((line) => `[${line.timestamp}] [${line.level.toUpperCase()}] ${line.text}`)
    .join('\r\n');
  await writeFile(result.filePath, content.length === 0 ? '' : `${content}\r\n`, 'utf8');
  return { exported: true };
}

async function dispatchApiOperation(
  operation: ApiOperation,
  body: unknown,
  options: DashboardServerOptions,
): Promise<unknown> {
  const { services } = options;
  switch (operation) {
    case 'listWorkspaces': return services.listWorkspaces();
    case 'addWorkspace': return services.addWorkspace(parseAddWorkspaceRequest(body));
    case 'selectWorkspace': return services.selectWorkspace(parseSelectWorkspaceRequest(body));
    case 'getDashboard': return services.getDashboard();
    case 'setPermissionProfile': return services.setPermissionProfile(parseSetPermissionProfileRequest(body));
    case 'setUnrestrictedMode': return services.setUnrestrictedMode(parseSetUnrestrictedModeRequest(body));
    case 'listProcesses': return services.listProcesses();
    case 'startProcess': return services.startProcess(parseStartProcessRequest(body));
    case 'stopProcess': return services.stopProcess(parseStopProcessRequest(body));
    case 'startMcp': return services.startMcp(parseStartMcpRequest(body));
    case 'stopMcp': return services.stopMcp();
    case 'restartMcp': return services.restartMcp();
    case 'clearWorkLog': return services.clearWorkLog();
    case 'saveTunnelApiKey': return services.saveTunnelApiKey(parseSaveTunnelApiKeyRequest(body));
    case 'startTunnel': return services.startTunnel();
    case 'stopTunnel': return services.stopTunnel();
    case 'getTunnelStatus': return services.getTunnelStatus();
    case 'setTunnelClientPath': return services.setTunnelClientPath(parseSetTunnelClientPathRequest(body));
    case 'setLocale': return services.setLocale(parseSetLocaleRequest(body));
    case 'launchManagedBrowser': return services.launchManagedBrowser();
    case 'runDoctor': return services.runDoctor();
    case 'getLogSnapshot': return services.getLogSnapshot();
    case 'clearLogBuffer': return services.clearLogBuffer(parseClearLogBufferRequest(body));
    case 'exportLogs': return exportLogsToFile(options.getMainWindow(), services, parseExportLogsRequest(body));
    case 'openLogViewer': return { opened: options.openLogViewer() };
  }
}

function matchOperation(method: string, pathname: string): ApiOperation | undefined {
  for (const [operation, route] of Object.entries(apiRoutes)) {
    if (route.method === method && route.path === pathname) return operation as ApiOperation;
  }
  return undefined;
}

async function serveStaticFile(response: ServerResponse, staticRoot: string, pathname: string): Promise<void> {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const resolved = path.normalize(path.join(staticRoot, requested));
  if (!resolved.startsWith(path.normalize(staticRoot))) {
    sendText(response, 403, 'Forbidden');
    return;
  }
  const target = await stat(resolved).catch(() => null);
  const filePath = target !== null && target.isFile() ? resolved : path.join(staticRoot, 'index.html');
  const fileStat = await stat(filePath).catch(() => null);
  if (fileStat === null) {
    sendText(response, 404, 'Not found');
    return;
  }
  response.statusCode = 200;
  response.setHeader('content-type', MIME_TYPES[path.extname(filePath)] ?? 'application/octet-stream');
  createReadStream(filePath).pipe(response);
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: DashboardServerOptions,
  originPolicy: OriginPolicy,
): Promise<void> {
  const rejected = originPolicy.validate(toFetchRequest(request));
  if (rejected !== undefined) {
    await writeFetchResponse(response, rejected);
    return;
  }

  const requestedPath = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
  const method = request.method ?? 'GET';
  const operation = matchOperation(method, requestedPath);

  if (operation === undefined) {
    if (method === 'GET') {
      await serveStaticFile(response, options.staticRoot, requestedPath);
      return;
    }
    sendText(response, 404, 'Not found');
    return;
  }

  try {
    const body = method === 'GET' ? undefined : await readJsonBody(request);
    const result = await dispatchApiOperation(operation, body, options);
    sendJson(response, 200, result);
    if (MUTATING_OPERATIONS.has(operation)) options.onMutation?.();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    sendJson(response, message.startsWith('Invalid request body') ? 400 : 500, { error: message });
  }
}

function listen(server: HttpServer, port: number): Promise<DashboardServerAddress> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off('error', onError);
      const address = server.address();
      if (address === null || typeof address === 'string' || address.address !== '127.0.0.1') {
        reject(new Error('Dashboard HTTP server did not bind to loopback'));
        return;
      }
      resolve({ host: '127.0.0.1', port: address.port });
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen({ host: '127.0.0.1', port });
  });
}

function isAddressInUse(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'EADDRINUSE';
}

export async function startDashboardServer(options: DashboardServerOptions): Promise<DashboardServerHandle> {
  const originPolicy = options.originPolicy ?? createOriginPolicy();
  const server = createServer((request, response) => {
    void handleRequest(request, response, options, originPolicy).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Unhandled dashboard HTTP error';
      process.stderr.write(`lnwjud dashboard HTTP error: ${message}\n`);
      if (!response.headersSent) sendText(response, 500, 'Internal server error');
      else response.destroy();
    });
  });

  let address: DashboardServerAddress;
  try {
    address = await listen(server, options.port);
  } catch (error: unknown) {
    if (options.port !== 0 && isAddressInUse(error)) {
      address = await listen(server, 0);
    } else {
      throw error;
    }
  }

  return {
    server,
    address,
    async close(): Promise<void> {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => error === undefined ? resolve() : reject(error));
      });
    },
  };
}
