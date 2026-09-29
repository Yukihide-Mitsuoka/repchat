"""Pin the inherited post-edit hook to the canonical Task interface."""

import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
HOOK = ROOT / ".claude/hooks/post-edit-quality.sh"


class PostEditQualityHookTests(unittest.TestCase):
    def run_hook(self, *, fail_lint=False):
        with tempfile.TemporaryDirectory() as directory:
            bin_dir = Path(directory)
            log = bin_dir / "calls"
            jq = bin_dir / "jq"
            jq.write_text("#!/bin/sh\necho src/example.py\n", encoding="utf-8")
            jq.chmod(0o755)
            task = bin_dir / "task"
            task.write_text(
                '#!/bin/sh\nprintf "%s\\n" "$*" >> "$TASK_LOG"\n'
                '[ "$1" = lint ] && [ "$TASK_FAIL_LINT" = 1 ] && exit 1\n'
                'exit 0\n',
                encoding="utf-8",
            )
            task.chmod(0o755)
            env = os.environ.copy()
            env.update(
                PATH=f"{bin_dir}:{env['PATH']}",
                TASK_LOG=str(log),
                TASK_FAIL_LINT="1" if fail_lint else "0",
            )
            result = subprocess.run(
                ["bash", str(HOOK)],
                input=json.dumps({"tool_input": {"file_path": "src/example.py"}}),
                text=True,
                capture_output=True,
                env=env,
                cwd=ROOT,
                check=False,
            )
            return result, log.read_text(encoding="utf-8").splitlines()

    def test_format_then_lint_use_task(self):
        result, calls = self.run_hook()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(calls, ["format FILE=src/example.py", "lint FILE=src/example.py"])

    def test_lint_failure_is_reported(self):
        result, calls = self.run_hook(fail_lint=True)
        self.assertEqual(result.returncode, 2)
        self.assertIn("Lint failed", result.stderr)
        self.assertEqual(calls, ["format FILE=src/example.py", "lint FILE=src/example.py"])


if __name__ == "__main__":
    unittest.main()
