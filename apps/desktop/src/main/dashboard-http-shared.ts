import type { IncomingMessage } from 'node:http';

/** Converts a Node HTTP request into a WHATWG Request for origin-policy validation. */
export function toFetchRequest(request: IncomingMessage): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) headers.set(name, value.join(', '));
    else if (value !== undefined) headers.set(name, value);
  }
  const requestedPath = new URL(request.url ?? '/', 'http://127.0.0.1');
  return new Request(`http://127.0.0.1${requestedPath.pathname}${requestedPath.search}`, {
    method: request.method ?? 'GET',
    headers,
  });
}
