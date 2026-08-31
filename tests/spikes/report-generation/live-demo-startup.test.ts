import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { LIVE, ROOT, python } from './live-demo-test-helpers.ts';

test('live dry-run describes the paid localhost workflow', () => {
  const result = spawnSync('python3', [LIVE, '--project', 'example-project', '--dry-run'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /live mode: enter a Japanese prompt, then stream a graph or dashboard/,
  );
  assert.match(result.stdout, /call Vertex AI and BigQuery after each submitted prompt/);
  assert.match(result.stdout, /open http:\/\/127\.0\.0\.1:8765\//);
});
test('live startup prepares pinned dependencies before creating the engine', () => {
  const result = python(`
from pathlib import Path
calls=[]
m.sys.argv=[str(m.Path(m.__file__)),"--project","example-project","--accept-cost","--no-open"]
m.sys.executable="/usr/bin/python3"
m.sys.prefix=str(m.VENV_DIR)
m.sys.version_info=(3,13,0)
m.shutil.which=lambda _tool:"/usr/bin/gcloud"
m.require_adc=lambda:calls.append("adc")
m.venv_python=lambda:Path(m.sys.executable)
def prepare():
 calls.append("prepare")
 return Path(m.sys.executable)
m.prepare_python=prepare
m.LiveQueryEngine=lambda _project:(calls.append("engine") or object())
class Server:
 server_port=8765
 def serve_forever(self):calls.append("serve");raise KeyboardInterrupt
 def server_close(self):calls.append("close")
m.create_server=lambda _host,_port,_engine:Server()
status=m.main()
print(json.dumps({"status":status,"calls":calls}))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.split('\n').at(-2) ?? ''), {
    status: 0,
    calls: ['adc', 'prepare', 'engine', 'serve', 'close'],
  });
});
test('live startup re-enters the venv when executable symlinks share one target', () => {
  const result = python(`
import tempfile
from pathlib import Path
with tempfile.TemporaryDirectory() as directory:
 root=Path(directory);base=root/"python";base.touch();system=root/"system-python";venv_python=root/"venv-python"
 system.symlink_to(base);venv_python.symlink_to(base);calls=[]
 m.sys.argv=[str(m.Path(m.__file__)),"--project","example-project","--accept-cost","--no-open"]
 m.sys.executable=str(system);m.sys.prefix=str(root/"system-prefix");m.sys.version_info=(3,13,0)
 m.shutil.which=lambda _tool:"/usr/bin/gcloud";m.require_adc=lambda:calls.append("adc")
 m.VENV_DIR=root/"demo-venv"
 m.prepare_python=lambda:(calls.append("prepare") or venv_python)
 m.run=lambda _command:calls.append("reexec")
 m.LiveQueryEngine=lambda _project:(calls.append("engine") or object())
 class Server:
  server_port=8765
  def serve_forever(self):calls.append("serve");raise KeyboardInterrupt
  def server_close(self):calls.append("close")
 m.create_server=lambda _host,_port,_engine:Server()
 status=m.main()
 print(json.dumps({"status":status,"same_target":system.resolve()==venv_python.resolve(),"calls":calls}))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.split('\n').at(-2) ?? ''), {
    status: 0,
    same_target: true,
    calls: ['adc', 'prepare', 'reexec'],
  });
});
