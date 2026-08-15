import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const LIVE = path.join(ROOT, 'spikes/report-generation/live_demo.py');

function python(body: string) {
  return spawnSync(
    'python3',
    [
      '-c',
      `import json,sys\nsys.path.insert(0,${JSON.stringify(path.dirname(LIVE))})\nimport live_demo as m\n${body}`,
    ],
    { cwd: ROOT, encoding: 'utf8' },
  );
}

test('cancelling an active request releases the server operation lock', () => {
  const result = python(`
import threading,time
e=object.__new__(m.LiveQueryEngine);e.lock=threading.Lock();e.operation_state_lock=threading.Lock();e.active_request_id=e.active_cancel_event=e.active_done_event=None
token=e._begin_operation("request-123456789012-abcd");cancelled=[]
thread=threading.Thread(target=lambda:cancelled.append(e.cancel("request-123456789012-abcd")));thread.start()
for _ in range(100):
 if token.is_set():break
 time.sleep(.001)
observed=token.is_set();e._finish_operation();thread.join()
available=e.lock.acquire(blocking=False)
if available:e.lock.release()
print(json.dumps({"observed":observed,"cancelled":cancelled,"available":available}))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    observed: true,
    cancelled: [true],
    available: true,
  });
});

test('composer becomes a stop control and prevents a second submission while streaming', () => {
  const rendered = python('print(m.HTML)');
  assert.equal(rendered.status, 0, rendered.stderr);
  const script = rendered.stdout.split('<script>').at(-1)?.split('</script>')[0] ?? '';
  for (const expected of [
    'new AbortController()',
    'function stopActiveRequest()',
    'function setComposerSubmitIcon(stopping)',
    'setComposerSubmitIcon(true)',
    'setComposerSubmitIcon(false)',
    '$("composer-input").disabled=true',
    'if(activeRequest){stopActiveRequest();return}',
    'request_id:operation.requestId',
  ]) {
    assert.ok(script.includes(expected), `missing in-flight composer contract: ${expected}`);
  }
  assert.match(rendered.stdout, /#composer-submit svg\{display:block;width:16px;height:16px\}/);
});
