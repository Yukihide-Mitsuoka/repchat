import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from scripts import pr_size_policy
from scripts.pr_size_policy import evaluate_size, summarize_lockfiles


class PullRequestSizePolicyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)

    def source(self, name="src/app.py", lines=801, prefix=""):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(prefix + "value = 1\n" * lines, encoding="utf-8")
        return {"filename": name, "additions": 1, "deletions": 0, "status": "modified"}

    def test_large_changed_source_warns_without_demanding_a_split(self):
        entry = self.source()
        warnings = pr_size_policy.maintainability_warnings([[entry]], self.root)
        self.assertEqual(1, len(warnings))
        for marker in ("MNT-002", "801 nonblank lines", "src/app.py", "not a violation"):
            self.assertIn(marker, warnings[0])

    def test_numeric_boundary_and_unchanged_files_are_quiet(self):
        self.source("src/untouched.py")
        entry = self.source(lines=800, prefix="\n" * 50)
        self.assertEqual([], pr_size_policy.maintainability_warnings([entry], self.root))
        for status in ("removed", "renamed"):
            entry = self.source()
            entry.update(status=status, additions=0, deletions=0)
            self.assertEqual([], pr_size_policy.maintainability_warnings([entry], self.root))

    def test_exempt_paths_and_generated_headers_are_quiet(self):
        names = (
            "pnpm-lock.yaml", "src/settings.json", "src/options.config.ts",
            "src/types.d.ts", "src/client.generated.py", "src/client.pb.go",
            "fixtures/sample.py", "tests/__fixtures__/sample.ts",
            "migrations/001.py", "generated/client.py", "vendor/lib.py",
            "schemas/model.py", "data/table.py", "src/blob.min.js",
        )
        entries = [self.source(name) for name in names]
        entries.append(self.source("src/generated.go", prefix="// Code generated. DO NOT EDIT.\n"))
        entries.append(self.source("src/client.py", prefix="# @generated\n"))
        self.assertEqual([], pr_size_policy.maintainability_warnings(entries, self.root))

    def test_generated_word_in_code_does_not_hide_handwritten_source(self):
        entry = self.source(prefix='message = "@generated"\n')
        self.assertEqual(1, len(pr_size_policy.maintainability_warnings([entry], self.root)))

    def test_removed_source_with_nonzero_diff_is_not_opened(self):
        entry = self.source()
        entry.update(status="removed", additions=0, deletions=801)
        (self.root / entry["filename"]).unlink()
        self.assertEqual([], pr_size_policy.maintainability_warnings([entry], self.root))

    def test_read_failures_and_unsafe_paths_do_not_read_or_leak_content(self):
        entry = self.source()
        (self.root / entry["filename"]).write_bytes(b"\xff\x00")
        warnings = pr_size_policy.maintainability_warnings([entry], self.root)
        self.assertIn("not inspected", warnings[0])
        for name in ("../outside.py", "/outside.py", "src/missing.py"):
            entry["filename"] = name
            warnings = pr_size_policy.maintainability_warnings([entry], self.root)
            self.assertIn("not inspected", warnings[0])
        with tempfile.TemporaryDirectory() as outside:
            secret = Path(outside) / "private.py"
            secret.write_text("DO_NOT_DISCLOSE", encoding="utf-8")
            (self.root / "linked.py").symlink_to(secret)
            entry["filename"] = "linked.py"
            warnings = pr_size_policy.maintainability_warnings([entry], self.root)
            self.assertIn("not inspected", warnings[0])
            self.assertNotIn("DO_NOT_DISCLOSE", warnings[0])
            (self.root / "linked-dir").symlink_to(outside, target_is_directory=True)
            entry["filename"] = "linked-dir/private.py"
            self.assertIn("not inspected", pr_size_policy.maintainability_warnings([entry], self.root)[0])

    def test_bounded_read_and_binary_input_are_reported_not_silently_passed(self):
        entry = self.source()
        path = self.root / entry["filename"]
        for content in (b"x" * (2_000_000 + 1), b"\x00value = 1\n", b"\xff"):
            path.write_bytes(content)
            warnings = pr_size_policy.maintainability_warnings([entry], self.root)
            self.assertIn("not inspected", warnings[0])

    def test_cli_preserves_exit_codes_and_escapes_warning_payload(self):
        entry = self.source("src/name%0A::error::.py")
        payload = self.root / "files.json"
        payload.write_text(json.dumps([entry]), encoding="utf-8")
        for additions, expected in ((1, 0), (401, 0), (801, 1)):
            argv = [
                "pr_size_policy.py", "--files-json", str(payload),
                "--additions", str(additions), "--deletions", "0", "--files", "1",
                "--source-root", str(self.root),
            ]
            output = io.StringIO()
            with mock.patch("sys.argv", argv), contextlib.redirect_stdout(output):
                self.assertEqual(expected, pr_size_policy.main())
            self.assertIn("::warning::MNT-002", output.getvalue())
            self.assertIn("%250A", output.getvalue())

    def test_excludes_lockfile_churn_from_hard_limit(self) -> None:
        lockfile_stats = summarize_lockfiles(
            [
                {"filename": "package.json", "additions": 15, "deletions": 58},
                {"filename": "pnpm-lock.yaml", "additions": 300, "deletions": 700},
            ]
        )

        result = evaluate_size(315, 758, 2, lockfile_stats)

        self.assertEqual(result.changed_lines, 73)
        self.assertEqual(result.changed_files, 1)
        self.assertEqual(result.level, "ok")

    def test_recognizes_nested_lockfiles_across_paginated_responses(self) -> None:
        payload = [
            [{"filename": "infra/.terraform.lock.hcl", "additions": 8, "deletions": 3}],
            [{"filename": "services/api/poetry.lock", "additions": 10, "deletions": 5}],
        ]

        self.assertEqual(summarize_lockfiles(payload), (18, 8, 2))

    def test_does_not_exclude_similarly_named_source_files(self) -> None:
        payload = [
            {"filename": "docs/pnpm-lock.yaml.md", "additions": 1000, "deletions": 0},
            {"filename": "src/package-lock.json.ts", "additions": 1000, "deletions": 0},
        ]

        self.assertEqual(summarize_lockfiles(payload), (0, 0, 0))

    def test_rejects_malformed_file_statistics(self) -> None:
        with self.assertRaises(ValueError):
            summarize_lockfiles(
                [{"filename": "pnpm-lock.yaml", "additions": "300", "deletions": 0}]
            )

    def test_rejects_exclusions_larger_than_aggregate_statistics(self) -> None:
        with self.assertRaises(ValueError):
            evaluate_size(10, 10, 1, (11, 0, 1))

    def test_preserves_soft_and_hard_limits(self) -> None:
        self.assertEqual(evaluate_size(401, 0, 1, (0, 0, 0)).level, "soft")
        self.assertEqual(evaluate_size(801, 0, 1, (0, 0, 0)).level, "hard")


if __name__ == "__main__":
    unittest.main()
