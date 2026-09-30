import os
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from scripts import makefile_profile


REPOSITORY_ROOT = Path(__file__).parents[2]
FOUNDATION_README_MARKER = (
    "<!-- repository-readme-owner: Yukihide-Mitsuoka/ai-dev-foundation -->"
)


class MakefileProfileTest(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary_directory.cleanup)
        self.root = Path(self.temporary_directory.name)

    def write_makefile(self, content):
        (self.root / "Makefile").write_text(content, encoding="utf-8")

    def test_downstream_rejects_required_template_placeholders(self):
        self.write_makefile(
            'setup:\n\t@echo "[template] setup: not wired yet"\n'
            'test:\n\t@echo "[template] test: not wired yet"\n'
        )

        with self.assertRaisesRegex(
            makefile_profile.MakefileProfileError,
            "setup, test",
        ):
            makefile_profile.validate_makefile(self.root)

    def test_foundation_may_retain_template_placeholders(self):
        self.write_makefile(
            'build:\n\t@echo "[template] build: not wired yet"\n'
        )

        unresolved = makefile_profile.validate_makefile(
            self.root,
            allow_template_placeholders=True,
        )

        self.assertEqual(unresolved, ["build"])

    def test_explicit_not_applicable_target_is_valid(self):
        self.write_makefile(
            'build:\n\t@echo "[project] build: not applicable — no artifact"\n'
        )

        unresolved = makefile_profile.validate_makefile(self.root)

        self.assertEqual(unresolved, [])

    def test_documented_placeholder_text_is_not_an_implementation(self):
        self.write_makefile(
            "# Replace [template] test: not wired yet during setup\n"
            'test:\n\t@echo "[project] test: not applicable — no test surface"\n'
        )

        unresolved = makefile_profile.validate_makefile(self.root)

        self.assertEqual(unresolved, [])

    def test_missing_makefile_fails_closed(self):
        with self.assertRaisesRegex(
            makefile_profile.MakefileProfileError,
            "Makefile cannot be read",
        ):
            makefile_profile.validate_makefile(self.root)


class FoundationMakeShimTest(unittest.TestCase):
    def setUp(self):
        readme = (REPOSITORY_ROOT / "README.md").read_text(encoding="utf-8")
        if FOUNDATION_README_MARKER not in readme:
            self.skipTest("Foundation-owned root Make shim is not inherited")
        self.makefile = (REPOSITORY_ROOT / "Makefile").read_text(encoding="utf-8")
        self.taskfile = (REPOSITORY_ROOT / "Taskfile.yml").read_text(encoding="utf-8")

    def run_make_with_fake_task(self, *arguments, task_exit_code=0):
        with tempfile.TemporaryDirectory() as directory:
            task = Path(directory) / "task"
            task.write_text(
                '#!/bin/sh\nprintf "[%s]\\n" "$@"\nexit "$TASK_EXIT_CODE"\n',
                encoding="utf-8",
            )
            task.chmod(0o755)
            environment = os.environ.copy()
            environment["PATH"] = f"{directory}:{environment['PATH']}"
            environment["TASK_EXIT_CODE"] = str(task_exit_code)
            return subprocess.run(
                [
                    "make",
                    "--no-print-directory",
                    "-f",
                    str(REPOSITORY_ROOT / "Makefile"),
                    *arguments,
                ],
                cwd=directory,
                env=environment,
                capture_output=True,
                text=True,
                check=False,
            )

    def test_foundation_make_recipes_only_forward_to_task(self):
        recipes = [line for line in self.makefile.splitlines() if line.startswith("\t")]
        self.assertTrue(recipes)
        self.assertTrue(all(re.match(r"\t@task(?:\s|$)", line) for line in recipes))

    def test_required_make_targets_forward_to_matching_tasks(self):
        for target in (
            "help", "setup", "test", "test-unit", "test-integration", "coverage",
            "build", "run", "security-scan", "sbom", "clean", "doctor",
        ):
            with self.subTest(target=target):
                result = self.run_make_with_fake_task(target)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout, f"[{target}]\n")

    def test_file_and_fleet_variables_are_forwarded(self):
        for target in ("format", "lint"):
            with self.subTest(target=target):
                result = self.run_make_with_fake_task(target, "FILE=src/example.py")
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout, f"[{target}]\n[FILE=src/example.py]\n")
        result = self.run_make_with_fake_task("fleet-audit", "FLEET_WORKSPACE_ROOT=/tmp/fleet")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "[fleet-audit]\n[FLEET_WORKSPACE_ROOT=/tmp/fleet]\n")

    def test_file_variable_with_quotes_is_forwarded_literally(self):
        value = 'src/odd"file.py'
        result = self.run_make_with_fake_task("format", f"FILE={value}")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, f"[format]\n[FILE={value}]\n")

    def test_unknown_make_target_is_not_caught(self):
        result = self.run_make_with_fake_task("unknown-target")
        self.assertNotEqual(result.returncode, 0)

    def test_task_failure_is_not_masked(self):
        result = self.run_make_with_fake_task("test", task_exit_code=7)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "[test]\n")

    def test_installed_task_accepts_make_compatibility_calls(self):
        if shutil.which("task") is None:
            self.skipTest("Task CLI is not installed locally; CI installs pinned Task")
        for arguments in (("help",), ("lint", "FILE=src/example.py")):
            with self.subTest(arguments=arguments):
                result = subprocess.run(
                    ["make", *arguments],
                    cwd=REPOSITORY_ROOT,
                    capture_output=True,
                    text=True,
                    check=False,
                )
                self.assertEqual(result.returncode, 0, result.stderr)

    def test_taskfile_test_targets_execute_regression_suites(self):
        self.assertIn("- task: test-unit", self.taskfile)
        self.assertIn("bash .claude/hooks/tests/guard-bash.test.sh", self.taskfile)
        self.assertIn(
            "python3 -m unittest discover -s scripts/tests -p 'test_*.py'",
            self.taskfile,
        )
        self.assertNotIn("[template] test: not wired yet", self.taskfile)
        self.assertNotIn("[template] test-unit: not wired yet", self.taskfile)

    def test_taskfile_coverage_target_emits_a_local_report(self):
        self.assertIn("  coverage:", self.taskfile)
        self.assertIn("python3 -m trace --count --missing --summary", self.taskfile)
        self.assertIn("--coverdir coverage", self.taskfile)
        self.assertNotIn("[template] coverage: not wired yet", self.taskfile)


if __name__ == "__main__":
    unittest.main()
