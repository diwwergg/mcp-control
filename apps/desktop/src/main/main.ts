import { app, BrowserWindow, dialog, Menu, nativeImage, Tray } from 'electron';
import { autoUpdater } from 'electron-updater';
import { APP_NAME, type WsMessage } from '@lnwjud/ipc-contracts';
import { startMcpStdio } from '@lnwjud/mcp-server';
import { DEFAULT_DASHBOARD_PORT, startDashboardServer, type DashboardServerHandle } from './dashboard-server.js';
import { attachDashboardWs, type DashboardWsHandle } from './dashboard-ws.js';
import { createDesktopRuntime, type DesktopRuntime } from './desktop-services.js';
import { shouldHoldSingleInstanceLock, wantsMcpStdio } from './instance-lock.js';
import { createLogViewerWindow, createMainWindow, getRendererStaticRoot, getWindowIconPath } from './window.js';
import { createTrayMenuTemplate, shouldHideMainWindowOnClose } from './tray.js';

let mainWindow: BrowserWindow | null = null;
let logViewerWindow: BrowserWindow | null = null;
let desktopRuntime: DesktopRuntime | null = null;
let dashboardServer: DashboardServerHandle | null = null;
let dashboardWs: DashboardWsHandle | null = null;
let dashboardUrl: string | null = null;
let tray: Tray | null = null;
let quitRequested = false;
let shutdownStarted = false;

function readDashboardPort(value: string | undefined): number {
  if (value === undefined || value.trim().length === 0) return DEFAULT_DASHBOARD_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error('LNWJUD_DASHBOARD_PORT must be an integer from 0 to 65535');
  }
  return port;
}

async function startDashboard(runtime: DesktopRuntime): Promise<string> {
  const server = await startDashboardServer({
    port: readDashboardPort(process.env.LNWJUD_DASHBOARD_PORT),
    staticRoot: getRendererStaticRoot(),
    services: runtime.services,
    getMainWindow: () => mainWindow,
    openLogViewer: (): boolean => openLogViewerWindow() !== null,
    onMutation: (): void => {
      void runtime.services.getDashboard().then((snapshot) => {
        dashboardWs?.broadcast({ type: 'dashboard', payload: snapshot });
      }).catch(() => undefined);
    },
  });
  dashboardServer = server;
  dashboardWs = attachDashboardWs({ server: server.server });
  runtime.logHub.setOnLine((line) => {
    const message: WsMessage = { type: 'log', payload: line };
    dashboardWs?.broadcast(message);
  });
  const url = `http://${server.address.host}:${server.address.port}/`;
  dashboardUrl = url;
  return url;
}

async function stopDashboard(): Promise<void> {
  await dashboardWs?.close();
  await dashboardServer?.close();
  dashboardWs = null;
  dashboardServer = null;
  dashboardUrl = null;
}

function openLogViewerWindow(): BrowserWindow | null {
  if (dashboardUrl === null) return null;
  if (logViewerWindow !== null && !logViewerWindow.isDestroyed()) {
    if (logViewerWindow.isMinimized()) logViewerWindow.restore();
    logViewerWindow.show();
    logViewerWindow.focus();
    return logViewerWindow;
  }
  const viewer = createLogViewerWindow(dashboardUrl);
  logViewerWindow = viewer;
  viewer.on('closed', () => {
    logViewerWindow = null;
  });
  return viewer;
}

function createDesktopWindow(url: string): void {
  mainWindow = createMainWindow(url);
  mainWindow.on('close', (event) => {
    if (!shouldHideMainWindowOnClose(quitRequested)) return;
    event.preventDefault();
    if (mainWindow !== null && !mainWindow.isDestroyed()) mainWindow.hide();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function revealMainWindow(): void {
  if (mainWindow === null || mainWindow.isDestroyed()) {
    if (dashboardUrl !== null) createDesktopWindow(dashboardUrl);
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function checkForUpdatesFromTray(): void {
  if (!app.isPackaged) {
    void dialog.showMessageBox({
      type: 'info',
      title: 'ตรวจอัปเดต',
      message: 'การตรวจอัปเดตจะทำงานเมื่อใช้แอปที่ติดตั้งจาก release แล้ว',
      buttons: ['ตกลง'],
    });
    return;
  }
  void autoUpdater.checkForUpdates().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'ไม่สามารถตรวจอัปเดตได้';
    console.error('[AutoUpdater] tray check failed: ' + message);
    void dialog.showMessageBox({
      type: 'error',
      title: 'ตรวจอัปเดต',
      message,
      buttons: ['ตกลง'],
    });
  });
}

function createDesktopTray(): void {
  const iconPath = getWindowIconPath();
  if (iconPath === undefined) {
    console.error('lnwjud tray icon was not found');
    return;
  }
  tray?.destroy();
  tray = new Tray(nativeImage.createFromPath(iconPath));
  tray.setToolTip('lnwjud — ทำงานเบื้องหลัง');
  tray.setContextMenu(Menu.buildFromTemplate(createTrayMenuTemplate({
    openMainWindow: revealMainWindow,
    checkForUpdates: checkForUpdatesFromTray,
    quit: (): void => { app.quit(); },
  })));
  tray.on('click', revealMainWindow);
}

function destroyDesktopTray(): void {
  tray?.destroy();
  tray = null;
}

function readArgValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function redirectConsoleToStderr(): void {
  const write = (stream: NodeJS.WriteStream, args: unknown[]): void => {
    stream.write(`${args.map((entry) => typeof entry === 'string' ? entry : JSON.stringify(entry)).join(' ')}\n`);
  };
  console.log = (...args: unknown[]): void => write(process.stderr, args);
  console.info = (...args: unknown[]): void => write(process.stderr, args);
  console.warn = (...args: unknown[]): void => write(process.stderr, args);
  console.error = (...args: unknown[]): void => write(process.stderr, args);
}

function bootstrapMcpStdio(): void {
  redirectConsoleToStderr();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-software-rasterizer');
  const dataPath = configureDataPath();
  void app.whenReady().then(async () => {
    const runtime = createDesktopRuntime(dataPath, { permissionProfile: 'full' });
    desktopRuntime = runtime;
    const workspacePath = readArgValue('--workspace')
      ?? process.env.LNWJUD_WORKSPACE
      ?? process.cwd();
    try {
      const workspaceId = await runtime.ensureDefaultWorkspace(workspacePath);
      process.stderr.write(`lnwjud MCP stdio ready workspace=${workspaceId}\n`);
    } catch (error: unknown) {
      process.stderr.write(`lnwjud MCP stdio workspace warning: ${error instanceof Error ? error.message : 'unknown'}\n`);
    }
    startMcpStdio({
      services: runtime.mcpServices,
      actor: runtime.mcpActor,
      activityTracker: runtime.activityTracker,
      onError: (error): void => {
        if (/EPIPE|ECONNRESET|broken pipe/i.test(error.message)) {
          process.stderr.write(`lnwjud MCP stdio: peer closed (${error.message})\n`);
          void desktopRuntime?.close().finally(() => process.exit(0));
          return;
        }
        process.stderr.write(`lnwjud MCP stdio error: ${error.message}\n`);
      },
    });
    process.stdin.on('end', () => {
      void desktopRuntime?.close().finally(() => process.exit(0));
    });
    process.stdin.on('close', () => {
      void desktopRuntime?.close().finally(() => process.exit(0));
    });
    process.stdout.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EPIPE' || error.code === 'ECONNRESET') {
        void desktopRuntime?.close().finally(() => process.exit(0));
      }
    });
  });
  app.on('window-all-closed', () => {
    // Keep the stdio MCP process alive without a BrowserWindow.
  });
  app.on('before-quit', () => {
    void desktopRuntime?.close();
  });
}

function initAutoUpdater(): void {
  if (!app.isPackaged) return;
  try {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('checking-for-update', () => {
      console.log('[AutoUpdater] Checking for updates on GitHub...');
    });

    autoUpdater.on('update-available', (info) => {
      console.log(`[AutoUpdater] Update available: v${info.version}`);
      dashboardWs?.broadcast({
        type: 'log',
        payload: {
          id: Date.now(),
          timestamp: new Date().toISOString(),
          level: 'info',
          source: 'process',
          text: `[AutoUpdater] Version v${info.version} is available and downloading in background...`,
        },
      });
    });

    autoUpdater.on('update-downloaded', (info) => {
      console.log(`[AutoUpdater] Downloaded update: v${info.version}`);
      dashboardWs?.broadcast({
        type: 'log',
        payload: {
          id: Date.now(),
          timestamp: new Date().toISOString(),
          level: 'info',
          source: 'process',
          text: `[AutoUpdater] Update v${info.version} downloaded! Ready to install.`,
        },
      });
      void dialog.showMessageBox({
        type: 'info',
        title: 'Update Ready - lnwjud',
        message: `Version v${info.version} has been downloaded. Restart lnwjud now to install?`,
        buttons: ['Restart Now', 'Later'],
        defaultId: 0,
        cancelId: 1,
      }).then((result) => {
        if (result.response === 0) {
          autoUpdater.quitAndInstall();
        }
      });
    });

    autoUpdater.on('error', (err) => {
      console.error('[AutoUpdater] error:', err.message);
    });

    setTimeout(() => {
      void autoUpdater.checkForUpdates().catch(() => {});
    }, 5000);
  } catch (err: unknown) {
    console.error('Failed to initialize auto updater:', err);
  }
}

function bootstrapDesktop(): void {
  const dataPath = configureDataPath();
  void app.whenReady().then(async () => {
    app.setAppUserModelId('com.lnwjud.desktop');
    const runtime = createDesktopRuntime(dataPath);
    desktopRuntime = runtime;
    runtime.logHub.start();
    const url = await startDashboard(runtime);
    try {
      await runtime.autoStartMcp();
    } catch (error: unknown) {
      console.error(`MCP auto-start failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
    createDesktopWindow(url);
    createDesktopTray();
    initAutoUpdater();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createDesktopWindow(url);
    });
  });
  app.on('before-quit', () => {
    quitRequested = true;
    destroyDesktopTray();
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('will-quit', (event) => {
    if (shutdownStarted) return;
    event.preventDefault();
    shutdownStarted = true;
    void closeDesktopRuntimeAndQuit();
  });
}

function bootstrapLogViewerOnly(): void {
  const dataPath = configureDataPath();
  void app.whenReady().then(async () => {
    app.setAppUserModelId('com.lnwjud.desktop');
    const runtime = createDesktopRuntime(dataPath);
    desktopRuntime = runtime;
    runtime.logHub.start();
    await startDashboard(runtime);
    const viewer = openLogViewerWindow();
    if (viewer !== null) {
      mainWindow = viewer;
      viewer.on('closed', () => {
        if (mainWindow === viewer) mainWindow = null;
      });
    }
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('will-quit', (event) => {
    if (shutdownStarted) return;
    event.preventDefault();
    shutdownStarted = true;
    void closeDesktopRuntimeAndQuit();
  });
}

async function closeDesktopRuntimeAndQuit(): Promise<void> {
  try {
    await stopDashboard();
    await desktopRuntime?.close();
  } catch (error: unknown) {
    console.error(`Desktop shutdown failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  } finally {
    desktopRuntime = null;
    app.quit();
  }
}

function configureDataPath(): string {
  app.setName(APP_NAME);
  const configuredDataPath = process.env.LNWJUD_DATA_PATH;
  if (typeof configuredDataPath === 'string' && configuredDataPath.trim().length > 0) {
    app.setPath('userData', configuredDataPath);
    return configuredDataPath;
  }
  return app.getPath('userData');
}

const gotInstanceLock = shouldHoldSingleInstanceLock(process.argv) ? app.requestSingleInstanceLock() : true;
if (!gotInstanceLock) {
  app.quit();
} else {
  if (shouldHoldSingleInstanceLock(process.argv)) {
    app.on('second-instance', (_event, argv) => {
      const existing = logViewerWindow !== null && !logViewerWindow.isDestroyed() ? logViewerWindow : null;
      if (existing !== null) {
        if (existing.isMinimized()) existing.restore();
        existing.show();
        existing.focus();
      } else if (argv.includes('--log-viewer')) {
        openLogViewerWindow();
      } else if (mainWindow !== null) {
        mainWindow.show();
        mainWindow.focus();
      }
    });
  }
  if (wantsMcpStdio(process.argv)) {
    bootstrapMcpStdio();
  } else if (process.argv.includes('--log-viewer')) {
    bootstrapLogViewerOnly();
  } else {
    bootstrapDesktop();
  }
}
