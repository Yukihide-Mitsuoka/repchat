import os
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).parents[2]
SELECTOR = REPOSITORY_ROOT / "scripts/run-foundation-tests.sh"


class FoundationTestSuiteSelectionTest(unittest.TestCase):
    def run_selector(self, suite: str | None, *, runner_exists: bool = True):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            scripts = root / "scripts"
            fake_bin = root / "bin"
            scripts.mkdir()
            fake_bin.mkdir()
            if runner_exists:
                (scripts / "foundation_test_runner.py").write_text(
                    "# repository-owned runner\n", encoding="utf-8"
                )
            python = fake_bin / "python3"
            python.write_text(
                "#!/usr/bin/env bash\nprintf '%s\\n' \"$@\"\n", encoding="utf-8"
            )
            python.chmod(python.stat().st_mode | stat.S_IXUSR)
            environment = os.environ.copy()
            environment["PATH"] = f"{fake_bin}:{environment['PATH']}"
            if suite is None:
                environment.pop("FOUNDATION_TEST_SUITE", None)
            else:
                environment["FOUNDATION_TEST_SUITE"] = suite

            return subprocess.run(
                ["bash", str(SELECTOR)],
                cwd=root,
                env=environment,
                text=True,
                capture_output=True,
                check=False,
            )

    def test_default_runs_the_complete_discovery_suite(self):
        result = self.run_selector(None, runner_exists=False)

        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual(
            ["-m", "unittest", "discover", "-s", "scripts/tests", "-p", "test_*.py"],
            result.stdout.splitlines(),
        )

    def test_bounded_selection_uses_the_repository_owned_runner(self):
        for suite in ("fast", "slow"):
            with self.subTest(suite=suite):
                result = self.run_selector(suite)

                self.assertEqual(0, result.returncode, result.stderr)
                self.assertEqual(
                    ["scripts/foundation_test_runner.py", "--suite", suite],
                    result.stdout.splitlines(),
                )

    def test_non_default_selection_requires_the_local_runner(self):
        result = self.run_selector("fast", runner_exists=False)

        self.assertEqual(2, result.returncode)
        self.assertIn("requires scripts/foundation_test_runner.py", result.stderr)

    def test_unknown_selection_fails_without_executing_python(self):
        result = self.run_selector("arbitrary-command")

        self.assertEqual(2, result.returncode)
        self.assertEqual("", result.stdout)
        self.assertIn("expected all, fast, or slow", result.stderr)

    def test_doctor_delegates_to_the_bounded_selector(self):
        template_check = (REPOSITORY_ROOT / "scripts/template-check.sh").read_text(
            encoding="utf-8"
        )

        self.assertIn("bash scripts/run-foundation-tests.sh", template_check)
        self.assertNotIn("FOUNDATION_TEST_SUITE:-", template_check)


if __name__ == "__main__":
    unittest.main()
