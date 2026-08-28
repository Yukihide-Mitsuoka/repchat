// Minimal Node http → Web-Fetch adapter for the service composition roots.
//
// The gate, executor, and control-plane handlers are all written against the
// Web `Request → Response` contract so the same code runs on Workers and Node.
// On Workers the runtime provides that contract; on Node these services need a
// tiny bridge from `node:http`. This is that bridge — deliberately a handful of
// lines and no dependency, rather than pulling a web framework for one adapter
// (COD-040).
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

export interface RunningServer {
  /** The bound port (useful when listening on 0 picks an ephemeral one). */
  readonly port: number;
  close(): Promise<void>;
}

/**
 * Start `handler` as an HTTP server on `port` (0 = an ephemeral port).
 *
 * Deploy composition roots keep the default `0.0.0.0` binding required by
 * Cloud Run. Tests and local callers can opt into loopback so a self-check
 * never races with another process or exposes a test listener broadly.
 */
export function serve(
  handler: (req: Request) => Promise<Response>,
  port: number,
  host = '0.0.0.0',
): Promise<RunningServer> {
  const server = createServer((nodeReq, nodeRes) => {
    void respond(handler, nodeReq, nodeRes);
  });
  return new Promise((resolve, reject) => {
    const rejectListen = (error: Error): void => reject(error);
    server.once('error', rejectListen);
    server.listen(port, host, () => {
      server.off('error', rejectListen);
      const addr = server.address();
      let closePromise: Promise<void> | undefined;
      resolve({
        port: typeof addr === 'object' && addr !== null ? addr.port : port,
        close: () => {
          closePromise ??= new Promise<void>((closeResolve, closeReject) => {
            server.close((error) => {
              if (error) closeReject(error);
              else closeResolve();
            });
            // close() alone waits for idle keep-alive sockets to time out, which
            // a client's connection pool holds open — enough to hang shutdown
            // (and a CI test run) indefinitely. Drop them so close() completes.
            server.closeAllConnections();
          });
          return closePromise;
        },
      });
    });
  });
}

async function respond(
  handler: (req: Request) => Promise<Response>,
  nodeReq: IncomingMessage,
  nodeRes: ServerResponse,
): Promise<void> {
  try {
    const res = await handler(await toRequest(nodeReq));
    nodeRes.statusCode = res.status;
    res.headers.forEach((value, key) => nodeRes.setHeader(key, value));
    nodeRes.end(Buffer.from(await res.arrayBuffer()));
  } catch {
    // A throwing handler must not crash the process or leave the socket open.
    // The generic 500 mirrors the handlers' own fail-closed mapping; detail
    // stays server-side (never echoed to the caller).
    nodeRes.statusCode = 500;
    nodeRes.setHeader('content-type', 'application/json');
    nodeRes.end('{"error":"internal error"}');
  }
}

async function toRequest(nodeReq: IncomingMessage): Promise<Request> {
  const host = nodeReq.headers.host ?? 'localhost';
  const url = `http://${host}${nodeReq.url ?? '/'}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(nodeReq.headers)) {
    if (Array.isArray(value)) for (const one of value) headers.append(key, one);
    else if (value !== undefined) headers.set(key, value);
  }
  const method = nodeReq.method ?? 'GET';
  const init: RequestInit = { method, headers };

  if (method !== 'GET' && method !== 'HEAD') {
    const chunks: Buffer[] = [];
    for await (const chunk of nodeReq) chunks.push(chunk as Buffer);
    // Buffer is a Uint8Array, a valid BodyInit; the cast bridges the Node/DOM
    // lib mismatch in the global fetch types.
    if (chunks.length > 0)
      init.body = Buffer.concat(chunks) as unknown as NonNullable<RequestInit['body']>;
  }
  return new Request(url, init);
}
