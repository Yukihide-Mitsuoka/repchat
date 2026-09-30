"""Check the repository-owned Taskfile without requiring the Task binary."""

import tempfile
import unittest
from pathlib import Path

from scripts import taskfile_profile


class TaskfileProfileTest(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary_directory.cleanup)
        self.root = Path(self.temporary_directory.name)

    def write_tasks(self, *, missing=(), placeholder=()):
        lines = ["version: '3'", "tasks:"]
        for name in taskfile_profile.REQUIRED_TASKS:
            if name in missing:
                continue
            message = (
                f"[template] {name}: not wired yet"
                if name in placeholder
                else f"[project] {name}: not applicable"
            )
            lines.extend((f"  {name}:", "    cmds:", f"      - 'echo {message}'"))
        (self.root / "Taskfile.yml").write_text("\n".join(lines) + "\n", encoding="utf-8")

    def test_accepts_explicit_repository_owned_no_ops(self):
        self.write_tasks()
        self.assertEqual(taskfile_profile.validate_taskfile(self.root), [])

    def test_rejects_missing_required_task(self):
        self.write_tasks(missing={"lint"})
        with self.assertRaisesRegex(taskfile_profile.TaskfileProfileError, "missing.*lint"):
            taskfile_profile.validate_taskfile(self.root)

    def test_rejects_unresolved_template_placeholder(self):
        self.write_tasks(placeholder={"lint"})
        with self.assertRaisesRegex(taskfile_profile.TaskfileProfileError, "not wired yet.*lint"):
            taskfile_profile.validate_taskfile(self.root)

    def test_rejects_required_task_without_command(self):
        self.write_tasks()
        taskfile = self.root / "Taskfile.yml"
        content = taskfile.read_text(encoding="utf-8")
        content = content.replace(
            "  lint:\n    cmds:\n      - 'echo [project] lint: not applicable'",
            "  lint:\n    desc: Lint code",
        )
        taskfile.write_text(content, encoding="utf-8")
        with self.assertRaisesRegex(taskfile_profile.TaskfileProfileError, "no commands.*lint"):
            taskfile_profile.validate_taskfile(self.root)

    def test_rejects_empty_command_list(self):
        self.write_tasks()
        taskfile = self.root / "Taskfile.yml"
        content = taskfile.read_text(encoding="utf-8")
        content = content.replace(
            "  lint:\n    cmds:\n      - 'echo [project] lint: not applicable'",
            "  lint: # required task\n    cmds: []",
        )
        taskfile.write_text(content, encoding="utf-8")
        with self.assertRaisesRegex(taskfile_profile.TaskfileProfileError, "no commands.*lint"):
            taskfile_profile.validate_taskfile(self.root)

    def test_allows_foundation_placeholder_but_not_missing_task(self):
        self.write_tasks(placeholder={"lint"})
        self.assertEqual(
            taskfile_profile.validate_taskfile(self.root, allow_template_placeholders=True),
            ["lint"],
        )
        self.write_tasks(missing={"lint"})
        with self.assertRaisesRegex(taskfile_profile.TaskfileProfileError, "missing.*lint"):
            taskfile_profile.validate_taskfile(self.root, allow_template_placeholders=True)

    def test_rejects_missing_taskfile(self):
        with self.assertRaisesRegex(taskfile_profile.TaskfileProfileError, "cannot be read"):
            taskfile_profile.validate_taskfile(self.root)


if __name__ == "__main__":
    unittest.main()
