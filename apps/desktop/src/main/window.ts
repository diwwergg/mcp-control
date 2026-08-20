import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserWindow } from 'electron';

const mainDirectory = path.dirname(fileURLToPath(import.meta.url));

export function getRendererStaticRoot(): string {
  return path.resolve(mainDirectory, '..', 'renderer');
}

export function getWindowIconPath(): string | undefined {
  const candidates = [
    path.resolve(mainDirectory, '..', 'renderer', 'favicon.ico'),
    path.resolve(mainDirectory, '..', 'renderer', 'logo.png'),
    path.resolve(mainDirectory, '..', 'renderer', 'logo-512.png'),
    path.resolve(mainDirectory, '..', '..', 'build', 'icon.ico'),
    path.resolve(mainDirectory, '..', '..', 'build', 'icon.png'),
    path.resolve(mainDirectory, '..', '..', 'assets', 'logo', 'logo.ico'),
    path.resolve(mainDirectory, '..', '..', 'assets', 'logo', 'logo-256x256.png'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

/** True when navigationUrl is same-origin with the dashboard website this app serves. */
export function isAllowedRendererUrl(navigationUrl: string, dashboardOrigin: string): boolean {
  try {
    const parsedUrl = new URL(navigationUrl);
    return parsedUrl.protocol === 'http:' && parsedUrl.origin === dashboardOrigin;
  } catch {
    return false;
  }
}

function createDashboardWindow(dashboardUrl: string, options: { readonly width: number; readonly height: number; readonly title?: string }): BrowserWindow {
  const dashboardOrigin = new URL(dashboardUrl).origin;
  const iconPath = getWindowIconPath();
  const window = new BrowserWindow({
    width: options.width,
    height: options.height,
    show: true,
    autoHideMenuBar: true,
    ...(options.title !== undefined ? { title: options.title } : {}),
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#07090e',
      symbolColor: '#f5c542',
      height: 38,
    },
    ...(iconPath !== undefined ? { icon: iconPath } : {}),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, navigationUrl) => {
    if (!isAllowedRendererUrl(navigationUrl, dashboardOrigin)) event.preventDefault();
  });
  window.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
  void window.loadURL(dashboardUrl);
  return window;
}

export function createMainWindow(dashboardUrl: string): BrowserWindow {
  const mainWindow = createDashboardWindow(dashboardUrl, { width: 1280, height: 800 });
  const reveal = (): void => {
    if (mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  };
  mainWindow.once('ready-to-show', reveal);
  // Fallback if ready-to-show never fires (blank/hung loads).
  setTimeout(reveal, 1_500);
  return mainWindow;
}

export function createLogViewerWindow(dashboardUrl: string): BrowserWindow {
  const viewerUrl = new URL(dashboardUrl);
  viewerUrl.hash = 'log-viewer';
  return createDashboardWindow(viewerUrl.toString(), { width: 960, height: 680, title: 'lnwjud — Live Logs' });
}
