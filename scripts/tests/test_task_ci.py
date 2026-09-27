import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).parents[2]
FOUNDATION_README_MARKER = (
    "<!-- repository-readme-owner: Yukihide-Mitsuoka/ai-dev-foundation -->"
)


class TaskCiTest(unittest.TestCase):
    def test_child_ci_is_not_bound_to_foundation_job_shape(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "README.md").write_text("# Child repository\n", encoding="utf-8")
            workflow = root / ".github/workflows/ci.yml"
            workflow.parent.mkdir(parents=True)
            workflow.write_text("jobs:\n  lint:\n    - run: make lint\n", encoding="utf-8")

            with patch.object(sys.modules[__name__], "ROOT", root):
                with self.assertRaises(unittest.SkipTest):
                    TaskCiTest().test_foundation_quality_jobs_install_task_before_use()

    def test_foundation_quality_jobs_install_task_before_use(self):
        readme = ROOT / "README.md"
        if not readme.is_file() or FOUNDATION_README_MARKER not in readme.read_text(
            encoding="utf-8"
        ):
            self.skipTest("protected child CI remains repository-owned during migration")
        workflow = (ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8")
        self.assertEqual(workflow.count("uses: ./scripts/actions/setup-task"), 4)
        for command in ("setup", "lint", "coverage", "build", "test", "doctor"):
            self.assertIn(f"task {command}", workflow)
        self.assertNotIn("- run: make ", workflow)

    def test_task_install_is_version_and_digest_pinned(self):
        action = (ROOT / "scripts/actions/setup-task/action.yml").read_text(
            encoding="utf-8"
        )
        self.assertIn("v3.53.1/task_linux_amd64.tar.gz", action)
        self.assertIn(
            "a54a408f6861ff921f6e87774180db31bacd8c1e7c944ca696db9fea49a82fc7",
            action,
        )
        self.assertIn("sha256sum -c -", action)


if __name__ == "__main__":
    unittest.main()
