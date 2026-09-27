import unittest
from pathlib import Path


ROOT = Path(__file__).parents[2]


class TaskCiTest(unittest.TestCase):
    def test_foundation_quality_jobs_install_task_before_use(self):
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
