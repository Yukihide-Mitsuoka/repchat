import unittest

from scripts.pr_size_policy import evaluate_size, summarize_lockfiles


class PullRequestSizePolicyTests(unittest.TestCase):
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
