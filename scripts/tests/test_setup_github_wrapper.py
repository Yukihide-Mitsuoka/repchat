import os
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).parents[2]
WRAPPER = ROOT / "scripts/setup-github.sh"


class SetupGitHubWrapperTest(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.bin_directory = Path(self.temporary_directory.name)
        self.arguments_path = self.bin_directory / "python-arguments"
        python = self.bin_directory / "python3"
        python.write_text(
            "#!/bin/sh\n"
            "printf '%s\\n' \"$@\" > \"$FAKE_PYTHON_ARGUMENTS\"\n"
            "printf 'delegated\\n'\n"
            "exit \"${FAKE_PYTHON_EXIT:-0}\"\n",
            encoding="utf-8",
        )
        python.chmod(0o755)
        self.environment = {
            "FAKE_PYTHON_ARGUMENTS": str(self.arguments_path),
            "HOME": os.environ.get("HOME", "/tmp"),
            "PATH": f"{self.bin_directory}:/usr/bin:/bin",
        }

    def tearDown(self):
        self.temporary_directory.cleanup()

    def run_wrapper(self, *arguments, **environment):
        return subprocess.run(
            ["/bin/bash", str(WRAPPER), *arguments],
            capture_output=True,
            check=False,
            cwd="/",
            env={**self.environment, **environment},
            text=True,
            timeout=5,
        )

    def delegated_arguments(self):
        return self.arguments_path.read_text(encoding="utf-8").splitlines()

    def test_explicit_repository_delegates_to_confirmed_apply(self):
        result = self.run_wrapper("acme/demo", "--confirm-repo", "acme/demo")

        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "delegated\n")
        self.assertEqual(
            self.delegated_arguments(),
            [
                str(ROOT / "scripts/github_governance.py"),
                "apply",
                "--root",
                str(ROOT),
                "--repo",
                "acme/demo",
                "--confirm-repo",
                "acme/demo",
            ],
        )

    def test_dry_run_delegates_to_read_only_plan(self):
        result = self.run_wrapper("acme/demo", DRY_RUN="1")

        self.assertEqual(result.returncode, 0)
        self.assertEqual(
            self.delegated_arguments(),
            [
                str(ROOT / "scripts/github_governance.py"),
                "plan",
                "--root",
                str(ROOT),
                "--repo",
                "acme/demo",
            ],
        )

    def test_dry_run_rejects_apply_confirmation_arguments(self):
        result = self.run_wrapper(
            "acme/demo",
            "--confirm-repo",
            "acme/demo",
            DRY_RUN="1",
        )

        self.assertEqual(result.returncode, 2)
        self.assertFalse(self.arguments_path.exists())

    def test_missing_mismatched_or_extra_confirmation_stops_before_delegation(self):
        invalid_arguments = (
            (),
            ("acme/demo",),
            ("acme/demo", "--confirm-repo", "acme/other"),
            ("acme/demo", "--confirm-repo", "acme/demo", "extra"),
        )
        for arguments in invalid_arguments:
            with self.subTest(arguments=arguments):
                result = self.run_wrapper(*arguments)
                self.assertEqual(result.returncode, 2)
                self.assertIn("Usage:", result.stderr)
                if arguments == ("acme/demo", "--confirm-repo", "acme/other"):
                    self.assertIn("must exactly match", result.stderr)
                self.assertFalse(self.arguments_path.exists())

    def test_python_exit_code_is_preserved(self):
        result = self.run_wrapper(
            "acme/demo",
            "--confirm-repo",
            "acme/demo",
            FAKE_PYTHON_EXIT="7",
        )

        self.assertEqual(result.returncode, 7)

    def test_repository_target_is_passed_as_one_argument(self):
        marker = self.bin_directory / "unexpected-command"
        target = f"acme/demo; touch {marker}"

        result = self.run_wrapper(target, "--confirm-repo", target)

        self.assertEqual(result.returncode, 0)
        self.assertFalse(marker.exists())
        self.assertEqual(
            self.delegated_arguments()[-4:],
            ["--repo", target, "--confirm-repo", target],
        )


if __name__ == "__main__":
    unittest.main()
