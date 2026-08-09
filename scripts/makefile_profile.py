#!/usr/bin/env python3
"""Reject unresolved canonical Make target placeholders outside Foundation."""

import argparse
import sys
from pathlib import Path


REQUIRED_TARGETS = (
    "setup",
    "format",
    "lint",
    "test",
    "test-unit",
    "coverage",
    "build",
)


class MakefileProfileError(ValueError):
    """Raised when a repository has no valid Makefile profile."""


def unresolved_targets(content):
    """Return required targets that retain the exact template placeholder."""
    recipe_lines = [line.lstrip() for line in content.splitlines()]
    return [
        target
        for target in REQUIRED_TARGETS
        if any(
            line.startswith("@echo ")
            and f"[template] {target}: not wired yet" in line
            for line in recipe_lines
        )
    ]


def validate_makefile(root, *, allow_template_placeholders=False):
    """Validate one repository Makefile and return unresolved target names."""
    makefile = Path(root) / "Makefile"
    try:
        content = makefile.read_text(encoding="utf-8")
    except OSError as error:
        raise MakefileProfileError(f"Makefile cannot be read: {error}") from error

    unresolved = unresolved_targets(content)
    if unresolved and not allow_template_placeholders:
        joined = ", ".join(unresolved)
        raise MakefileProfileError(
            "Makefile required targets still use the template 'not wired yet' "
            f"placeholder: {joined}; wire each target or mark it explicitly not applicable"
        )
    return unresolved


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="validate required canonical Make target implementations"
    )
    parser.add_argument("--root", default=".", help="repository root")
    parser.add_argument(
        "--allow-template-placeholders",
        action="store_true",
        help="allow placeholders only for the canonical Foundation template",
    )
    args = parser.parse_args(argv)
    try:
        validate_makefile(
            args.root,
            allow_template_placeholders=args.allow_template_placeholders,
        )
    except MakefileProfileError as error:
        print(f"makefile profile: ERROR: {error}", file=sys.stderr)
        return 1
    print("makefile profile: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
