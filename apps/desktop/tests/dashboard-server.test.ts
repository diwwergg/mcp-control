import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultDesktopServices, type DesktopIpcServices } from '../src/main/desktop-service-contract.js';
import { startDashboardServer, type DashboardServerHandle } from '../src/main/dashboard-server.js';

const temporaryRoots: string[] = [];
const handles: DashboardServerHandle[] = [];

afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.close()));
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createStaticRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-dashboard-static-'));
  temporaryRoots.push(root);
  await writeFile(path.join(root, 'index.html'), '<!doctype html><title>lnwjud</title>', 'utf8');
  return root;
}

async function launchServer(services: DesktopIpcServices, onMutation?: () => void): Promise<string> {
  const staticRoot = await createStaticRoot();
  const handle = await startDashboardServer({
    port: 0,
    staticRoot,
    services,
    getMainWindow: () => null,
    openLogViewer: () => false,
    ...(onMutation === undefined ? {} : { onMutation }),
  });
  handles.push(handle);
  return `http://${handle.address.host}:${handle.address.port}`;
}

describe('dashboard HTTP server', () => {
  it('serves a GET route by calling the matching service method', async () => {
    const services: DesktopIpcServices = {
      ...defaultDesktopServices,
      listWorkspaces: async () => [{ id: 'w1', displayName: 'demo', rootPath: 'E:\\demo', realRootPath: 'E:\\demo', createdAt: '2026-01-01T00:00:00.000Z' }],
    };
    const base = await launchServer(services);
    const response = await fetch(`${base}/api/workspaces`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ id: 'w1', displayName: 'demo', rootPath: 'E:\\demo', realRootPath: 'E:\\demo', createdAt: '2026-01-01T00:00:00.000Z' }]);
  });

  it('parses a POST body and calls the matching service method', async () => {
    let received: unknown;
    const services: DesktopIpcServices = {
      ...defaultDesktopServices,
      addWorkspace: async (request) => {
        received = request;
        return { id: 'w2', displayName: 'demo2', rootPath: request.rootPath, realRootPath: request.rootPath, createdAt: '2026-01-01T00:00:00.000Z' };
      },
    };
    const base = await launchServer(services);
    const response = await fetch(`${base}/api/workspaces`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rootPath: 'E:\\demo2' }),
    });
    expect(response.status).toBe(200);
    expect(received).toEqual({ rootPath: 'E:\\demo2' });
    expect(await response.json()).toMatchObject({ id: 'w2' });
  });

  it('returns 400 with an error body for an invalid request body', async () => {
    const base = await launchServer(defaultDesktopServices);
    const response = await fetch(`${base}/api/workspaces`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('rootPath') });
  });

  it('returns 404 for an unknown API route', async () => {
    const base = await launchServer(defaultDesktopServices);
    const response = await fetch(`${base}/api/does-not-exist`, { method: 'POST' });
    expect(response.status).toBe(404);
  });

  it('falls back to index.html for unmatched GET paths', async () => {
    const base = await launchServer(defaultDesktopServices);
    const response = await fetch(`${base}/some/client-route`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<title>lnwjud</title>');
  });

  it('invokes onMutation after a mutating operation succeeds', async () => {
    let mutated = 0;
    const base = await launchServer(defaultDesktopServices, () => { mutated += 1; });
    await fetch(`${base}/api/mcp/stop`, { method: 'POST' });
    expect(mutated).toBe(1);
    await fetch(`${base}/api/dashboard`);
    expect(mutated).toBe(1);
  });
});
