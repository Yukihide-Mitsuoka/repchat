#!/usr/bin/env python3
"""Enforce GR-020 and report advisory MNT-002 signals from changed source files."""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any


LOCKFILE_NAMES = frozenset(
    {
        ".terraform.lock.hcl",
        "Cargo.lock",
        "Gemfile.lock",
        "Pipfile.lock",
        "bun.lock",
        "bun.lockb",
        "composer.lock",
        "go.sum",
        "npm-shrinkwrap.json",
        "package-lock.json",
        "pnpm-lock.yaml",
        "poetry.lock",
        "uv.lock",
        "yarn.lock",
    }
)

SOURCE_SUFFIXES = frozenset(
    ".py .js .jsx .ts .tsx .mjs .cjs .go .rs .rb .java .kt .swift "
    ".cs .c .h .cpp .hpp .sh .bash .php".split()
)
EXEMPT_PARTS = frozenset(
    ".git node_modules vendor vendored generated __generated__ dist build coverage "
    "fixtures __fixtures__ migrations schemas data __snapshots__".split()
)
GENERATED_SUFFIXES = (
    ".d.ts", ".min.js", ".generated.py", ".generated.ts", ".pb.go", "_pb2.py", ".g.cs",
)
GENERATED_HEADER = re.compile(
    r"^\s*(?:#|//|/\*|\*)\s*(?:@generated\b|code generated\b|auto-generated\b)", re.I | re.M
)
SOURCE_BYTE_LIMIT = 2_000_000


@dataclass(frozen=True)
class SizeResult:
    changed_lines: int
    changed_files: int
    level: str


def _nonnegative_integer(value: Any, label: str) -> int:
    if type(value) is not int or value < 0:
        raise ValueError(f"{label} must be a non-negative integer")
    return value


def _flatten_pages(payload: Any) -> list[dict[str, Any]]:
    if not isinstance(payload, list):
        raise ValueError("pull-request files response must be a JSON array")
    if all(isinstance(item, dict) for item in payload):
        return payload
    if all(isinstance(page, list) for page in payload):
        files = [item for page in payload for item in page]
        if all(isinstance(item, dict) for item in files):
            return files
    raise ValueError("pull-request files response has an unexpected shape")


def summarize_lockfiles(payload: Any) -> tuple[int, int, int]:
    additions = 0
    deletions = 0
    files = 0
    for entry in _flatten_pages(payload):
        filename = entry.get("filename")
        if not isinstance(filename, str):
            raise ValueError("file entry is missing a filename")
        added = _nonnegative_integer(entry.get("additions"), f"additions for {filename}")
        deleted = _nonnegative_integer(entry.get("deletions"), f"deletions for {filename}")
        if PurePosixPath(filename).name in LOCKFILE_NAMES:
            additions += added
            deletions += deleted
            files += 1
    return additions, deletions, files


def evaluate_size(
    additions: int,
    deletions: int,
    files: int,
    lockfile_stats: tuple[int, int, int],
) -> SizeResult:
    additions = _nonnegative_integer(additions, "additions")
    deletions = _nonnegative_integer(deletions, "deletions")
    files = _nonnegative_integer(files, "files")
    lock_additions, lock_deletions, lock_files = (
        _nonnegative_integer(value, label)
        for value, label in zip(
            lockfile_stats,
            ("lockfile additions", "lockfile deletions", "lockfile files"),
            strict=True,
        )
    )
    if lock_additions > additions or lock_deletions > deletions or lock_files > files:
        raise ValueError("lockfile exclusions exceed aggregate PR statistics")

    changed_lines = additions - lock_additions + deletions - lock_deletions
    changed_files = files - lock_files
    if changed_lines > 800 or changed_files > 20:
        level = "hard"
    elif changed_lines > 400 or changed_files > 10:
        level = "soft"
    else:
        level = "ok"
    return SizeResult(changed_lines, changed_files, level)


def _source_text(root: Path, filename: str) -> str:
    path = PurePosixPath(filename)
    if path.is_absolute() or ".." in path.parts or "\\" in filename:
        raise ValueError("unsafe path")
    target = root
    for part in path.parts:
        target = target / part
        if target.is_symlink():
            raise ValueError("symlink")
    if not target.is_file():
        raise ValueError("not a regular file")
    with target.open("rb") as source:
        content = source.read(SOURCE_BYTE_LIMIT + 1)
    if len(content) > SOURCE_BYTE_LIMIT or b"\x00" in content:
        raise ValueError("oversized or binary source")
    return content.decode("utf-8")


def maintainability_warnings(payload: Any, root: Path) -> list[str]:
    """Read only changed source; never execute it or infer a GR-025 violation."""
    warnings = []
    for entry in _flatten_pages(payload):
        filename = entry["filename"]
        path = PurePosixPath(filename)
        if (
            entry.get("status") == "removed"
            or not (entry["additions"] + entry["deletions"])
            or path.suffix not in SOURCE_SUFFIXES or path.name in LOCKFILE_NAMES
            or EXEMPT_PARTS.intersection(path.parts)
            or path.name.endswith(GENERATED_SUFFIXES) or ".config." in path.name
        ):
            continue
        label = json.dumps(filename, ensure_ascii=True)
        try:
            content = _source_text(root, filename)
        except (OSError, ValueError):
            warnings.append(f"MNT-002: {label} not inspected; review manually (advisory).")
            continue
        if GENERATED_HEADER.search("\n".join(content.splitlines()[:20])):
            continue
        lines = sum(bool(line.strip()) for line in content.splitlines())
        if lines > 800:
            warnings.append(
                f"MNT-002: {label} has {lines} nonblank lines (approximate, not a violation). "
                "Review responsibility, coupling, exemptions and GR-025; do not split cosmetically."
            )
    return warnings


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--files-json", required=True, type=Path)
    parser.add_argument("--additions", required=True, type=int)
    parser.add_argument("--deletions", required=True, type=int)
    parser.add_argument("--files", required=True, type=int)
    parser.add_argument(
        "--source-root", type=Path, default=Path("."),
        help="checkout to inspect for advisory warnings (default: current directory)",
    )
    args = parser.parse_args()
    try:
        with args.files_json.open(encoding="utf-8") as source:
            payload = json.load(source)
            lockfile_stats = summarize_lockfiles(payload)
        result = evaluate_size(args.additions, args.deletions, args.files, lockfile_stats)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"::error::Invalid PR-size policy input: {error}")
        return 2

    print(
        f"Changed lines excluding lockfiles: {result.changed_lines}, "
        f"files: {result.changed_files}"
    )
    for warning in maintainability_warnings(payload, args.source_root):
        # PR filenames are untrusted GitHub workflow-command data, not annotations.
        escaped = warning.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
        print(f"::warning::{escaped}")
    if result.level == "hard":
        print(
            "::error::PR exceeds hard size limit (GR-020). Split it "
            "(soft limit 400 lines/10 files, hard 800/20)."
        )
        return 1
    if result.level == "soft":
        print(
            "::warning::PR exceeds the GR-020 soft limit — must be justified "
            "in the description (mechanical change?)."
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
