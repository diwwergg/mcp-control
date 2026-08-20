import { DASHBOARD_WS_PATH, type WsMessage } from '@lnwjud/ipc-contracts';

export type DashboardSocketListener = (message: WsMessage) => void;

export interface DashboardSocket {
  subscribe(listener: DashboardSocketListener): () => void;
  close(): void;
}

const MIN_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 15_000;

export function connectDashboardSocket(): DashboardSocket {
  const listeners = new Set<DashboardSocketListener>();
  let socket: WebSocket | null = null;
  let closed = false;
  let retryDelayMs = MIN_RETRY_DELAY_MS;

  function scheduleReconnect(): void {
    if (closed) return;
    setTimeout(connect, retryDelayMs);
    retryDelayMs = Math.min(retryDelayMs * 2, MAX_RETRY_DELAY_MS);
  }

  function connect(): void {
    if (closed) return;
    const url = new URL(DASHBOARD_WS_PATH, window.location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const nextSocket = new WebSocket(url.toString());
    socket = nextSocket;
    nextSocket.addEventListener('open', () => {
      retryDelayMs = MIN_RETRY_DELAY_MS;
    });
    nextSocket.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(String(event.data)) as WsMessage;
        for (const listener of listeners) listener(message);
      } catch {
        return;
      }
    });
    nextSocket.addEventListener('close', scheduleReconnect);
    nextSocket.addEventListener('error', () => nextSocket.close());
  }

  connect();

  return {
    subscribe(listener: DashboardSocketListener): () => void {
      listeners.add(listener);
      return (): void => {
        listeners.delete(listener);
      };
    },
    close(): void {
      closed = true;
      socket?.close();
    },
  };
}
