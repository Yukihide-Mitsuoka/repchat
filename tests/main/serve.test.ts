// The node:http → Web-Fetch bridge, over a real loopback socket (ephemeral
// port, no external dependency). Confirms method, path, headers and body all
// survive the round trip, and that a throwing handler becomes a clean 500
// rather than a crashed process or a hung socket.
import test from 'node:test';
import assert from 'node:assert/strict';
import { serve } from '../../src/main/serve.ts';

async function withServer(
  handler: (req: Request) => Promise<Response>,
  fn: (base: string) => Promise<void>,
): Promise<void> {
  const server = await serve(handler, 0, '127.0.0.1');
  try {
    await fn(`http://127.0.0.1:${server.port}`);
  } finally {
    await server.close();
  }
}

test('GET round trip: path and headers reach the handler; response comes back', async () => {
  const handler = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    return Response.json(
      { path: url.pathname, auth: req.headers.get('authorization') },
      { status: 200 },
    );
  };
  await withServer(handler, async (base) => {
    const res = await fetch(`${base}/r/report-1`, { headers: { authorization: 'Bearer t' } });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { path: '/r/report-1', auth: 'Bearer t' });
  });
});

test('POST body round trip: the request body is delivered intact', async () => {
  const handler = async (req: Request): Promise<Response> => {
    const body = (await req.json()) as { op: string };
    return Response.json({ echoedOp: body.op }, { status: 200 });
  };
  await withServer(handler, async (base) => {
    const res = await fetch(`${base}/v1/control`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ op: 'tenantEpoch' }),
    });
    assert.deepEqual(await res.json(), { echoedOp: 'tenantEpoch' });
  });
});

test('response status and headers are propagated', async () => {
  const handler = async (): Promise<Response> =>
    new Response('nope', { status: 404, headers: { 'content-type': 'text/plain' } });
  await withServer(handler, async (base) => {
    const res = await fetch(`${base}/missing`);
    assert.equal(res.status, 404);
    assert.match(res.headers.get('content-type') ?? '', /text\/plain/);
    assert.equal(await res.text(), 'nope');
  });
});

test('a throwing handler becomes a generic 500, not a crash or a hang', async () => {
  const handler = async (): Promise<Response> => {
    throw new Error('boom with internal detail');
  };
  await withServer(handler, async (base) => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: 'internal error' }); // detail not leaked
  });
});

test('listener allocation failure rejects with the underlying socket error', async () => {
  const handler = async (): Promise<Response> => new Response('ok');
  const first = await serve(handler, 0, '127.0.0.1');
  try {
    await assert.rejects(serve(handler, first.port, '127.0.0.1'), (error: unknown) => {
      assert.equal((error as NodeJS.ErrnoException).code, 'EADDRINUSE');
      return true;
    });
  } finally {
    await first.close();
  }
});

test('close releases the listener and remains safe when repeated', async () => {
  const handler = async (): Promise<Response> => new Response('ok');
  const first = await serve(handler, 0, '127.0.0.1');
  const port = first.port;

  await Promise.all([first.close(), first.close()]);

  const replacement = await serve(handler, port, '127.0.0.1');
  await replacement.close();
});
