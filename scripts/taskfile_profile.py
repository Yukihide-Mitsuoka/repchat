#!/usr/bin/env python3
"""Check required Task names and unresolved template placeholders offline."""

import argparse
import re
import sys
from pathlib import Path


REQUIRED_TASKS = (
    "setup",
    "format",
    "lint",
    "test",
    "test-unit",
    "test-integration",
    "coverage",
    "build",
    "run",
    "security-scan",
    "sbom",
    "clean",
    "doctor",
)
TASK_HEADER = re.compile(r"^  ['\"]?([a-z][a-z0-9-]*)['\"]?:")


class TaskfileProfileError(ValueError):
    """Raised when a repository lacks a required Task implementation."""


def task_blocks(content):
    """Extract top-level task bodies; Task CLI remains the YAML syntax authority."""
    blocks = {}
    in_tasks = False
    name = None
    for line in content.splitlines():
        if line == "tasks:":
            in_tasks = True
            continue
        if in_tasks and line and not line.startswith((" ", "#")):
            break
        if not in_tasks:
            continue
        header = TASK_HEADER.match(line)
        if header:
            name = header.group(1)
            blocks[name] = [line]
        elif name:
            blocks[name].append(line)
    return blocks


def has_commands(block):
    """Reject empty task shells while accepting short and list-style tasks."""
    inline = block[0].split(":", maxsplit=1)[1].split("#", maxsplit=1)[0].strip()
    if inline:
        return True
    for index, line in enumerate(block[1:], start=1):
        command_field = re.match(r"^    (?:cmds|deps):\s*(.*)$", line)
        if not command_field:
            continue
        value = command_field.group(1).split("#", maxsplit=1)[0].strip()
        if value and value not in ("[]", "null", "~"):
            return True
        if not value:
            for nested in block[index + 1 :]:
                if nested.startswith("    ") and not nested.startswith("      "):
                    break
                if nested.startswith("      - "):
                    return True
    return False


def validate_taskfile(root, *, allow_template_placeholders=False):
    """Validate required task entries and return unresolved template task names."""
    taskfile = Path(root) / "Taskfile.yml"
    try:
        blocks = task_blocks(taskfile.read_text(encoding="utf-8"))
    except OSError as error:
        raise TaskfileProfileError(f"Taskfile.yml cannot be read: {error}") from error

    missing = [name for name in REQUIRED_TASKS if name not in blocks]
    if missing:
        raise TaskfileProfileError(f"Taskfile.yml missing required tasks: {', '.join(missing)}")

    no_commands = [name for name in REQUIRED_TASKS if not has_commands(blocks[name])]
    if no_commands:
        raise TaskfileProfileError(
            f"Taskfile.yml required tasks have no commands: {', '.join(no_commands)}"
        )

    unresolved = [
        name
        for name in REQUIRED_TASKS
        if f"[template] {name}: not wired yet" in "\n".join(blocks[name])
    ]
    if unresolved and not allow_template_placeholders:
        raise TaskfileProfileError(
            "Taskfile.yml required tasks still use the template 'not wired yet' "
            f"placeholder: {', '.join(unresolved)}; wire each task or mark it explicitly not applicable"
        )
    return unresolved


def main(argv=None):
    parser = argparse.ArgumentParser(description="validate required Taskfile implementations")
    parser.add_argument("--root", default=".", help="repository root")
    parser.add_argument(
        "--allow-template-placeholders",
        action="store_true",
        help="allow placeholders only for the canonical Foundation template",
    )
    args = parser.parse_args(argv)
    try:
        validate_taskfile(args.root, allow_template_placeholders=args.allow_template_placeholders)
    except TaskfileProfileError as error:
        print(f"taskfile profile: ERROR: {error}", file=sys.stderr)
        return 1
    print("taskfile profile: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
