import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).parents[2]
SHARED_TEST = ROOT / "scripts/tests/test_template_sync_ignore.py"
SHARED_VALIDATOR = ROOT / "scripts/template_sync_auth.py"
SHARED_WORKFLOW = ROOT / ".github/workflows/template-sync.yml"


class TemplateSyncIgnorePortabilityTest(unittest.TestCase):
    def test_shared_test_accepts_bootstrapped_child_contract(self):
        with tempfile.TemporaryDirectory(dir=ROOT.parent) as temporary_directory:
            child = Path(temporary_directory) / "child"
            test_path = child / "scripts/tests/test_template_sync_ignore.py"
            test_path.parent.mkdir(parents=True)
            shutil.copy2(SHARED_TEST, test_path)
            shutil.copy2(SHARED_VALIDATOR, child / "scripts/template_sync_auth.py")
            (child / ".github/workflows").mkdir(parents=True)
            (child / ".templatesyncignore").write_text(
                ".ai/project/**\n"
                ".github/inheritance/agent-profile.json\n"
                ".github/workflows/**\n"
                "docs/**\n"
                ":!docs/foundation/\n"
                ":!docs/foundation/**\n",
                encoding="utf-8",
            )
            workflow = SHARED_WORKFLOW.read_text(encoding="utf-8").replace(
                "{{ORG}}/ai-dev-foundation", "acme/parent"
            )
            (child / ".github/workflows/template-sync.yml").write_text(
                workflow, encoding="utf-8"
            )

            result = subprocess.run(
                [sys.executable, str(test_path)],
                cwd=child,
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertEqual(
                result.returncode,
                0,
                msg=f"{result.stdout}\n{result.stderr}",
            )


if __name__ == "__main__":
    unittest.main()
