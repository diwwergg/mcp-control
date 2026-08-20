import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Socket } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import { DASHBOARD_WS_PATH, type WsMessage } from '@lnwjud/ipc-contracts';
import { createOriginPolicy, type OriginPolicy } from '@lnwjud/mcp-server';
import { toFetchRequest } from './dashboard-http-shared.js';

export interface DashboardWsHandle {
  broadcast(message: WsMessage): void;
  close(): Promise<void>;
}

export interface DashboardWsOptions {
  readonly server: HttpServer;
  readonly originPolicy?: OriginPolicy;
}

/** Attaches a WebSocket endpoint at DASHBOARD_WS_PATH to an existing loopback HTTP server. */
export function attachDashboardWs(options: DashboardWsOptions): DashboardWsHandle {
  const originPolicy = options.originPolicy ?? createOriginPolicy();
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set<WebSocket>();

  wss.on('connection', (socket: WebSocket) => {
    clients.add(socket);
    socket.on('close', () => clients.delete(socket));
    socket.on('error', () => clients.delete(socket));
  });

  const onUpgrade = (request: IncomingMessage, socket: Socket, head: Buffer): void => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    if (pathname !== DASHBOARD_WS_PATH) return;
    if (originPolicy.validate(toFetchRequest(request)) !== undefined) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (client) => {
      wss.emit('connection', client, request);
    });
  };
  options.server.on('upgrade', onUpgrade);

  return {
    broadcast(message: WsMessage): void {
      const text = JSON.stringify(message);
      for (const client of clients) {
        if (client.readyState === client.OPEN) client.send(text);
      }
    },
    async close(): Promise<void> {
      options.server.off('upgrade', onUpgrade);
      for (const client of clients) client.terminate();
      clients.clear();
      await new Promise<void>((resolve, reject) => {
        wss.close((error?: Error) => error === undefined ? resolve() : reject(error));
      });
    },
  };
}
