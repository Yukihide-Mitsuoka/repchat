import unittest
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).parents[2]
IGNORE_FILE = REPOSITORY_ROOT / ".templatesyncignore"
WORKFLOW_FILE = REPOSITORY_ROOT / ".github" / "workflows" / "template-sync.yml"


class TemplateSyncIgnoreTest(unittest.TestCase):
    def entries(self):
        return {
            line.strip()
            for line in IGNORE_FILE.read_text(encoding="utf-8").splitlines()
            if line.strip() and not line.lstrip().startswith("#")
        }

    def test_foundation_docs_use_git_pathspec_exclusions(self):
        entries = self.entries()

        self.assertIn("docs/**", entries)
        self.assertIn(":!docs/foundation/", entries)
        self.assertIn(":!docs/foundation/**", entries)
        self.assertNotIn("!docs/foundation/", entries)
        self.assertNotIn("!docs/foundation/**", entries)

    def test_legacy_sync_excludes_every_workflow(self):
        self.assertIn(".github/workflows/**", self.entries())

    def test_legacy_sync_protects_agent_profile_and_project_overlay(self):
        entries = self.entries()

        self.assertIn(".github/inheritance/agent-profile.json", entries)
        self.assertIn(".ai/project/**", entries)

    def test_sync_pr_records_the_source_commit_used_by_the_action(self):
        workflow = WORKFLOW_FILE.read_text(encoding="utf-8")

        self.assertIn("id: template-sync", workflow)
        self.assertIn("steps.template-sync.outputs.pr_branch", workflow)
        self.assertIn('gh api "repos/${SOURCE_REPOSITORY}/commits/${SOURCE_SHORT}"', workflow)
        self.assertIn("Unable to expand the Template Sync source commit", workflow)
        self.assertIn("gh pr edit", workflow)

    def test_private_source_read_is_separate_from_child_writes(self):
        workflow = WORKFLOW_FILE.read_text(encoding="utf-8")

        required = (
            "id: source-auth",
            "scripts/template_sync_auth.py",
            "id: source-app-token",
            "actions/create-github-app-token@",
            "# v3",
            "owner: ${{ steps.source-auth.outputs.owner }}",
            "repositories: ${{ steps.source-auth.outputs.repository }}",
            "permission-contents: read",
            "source_gh_token: ${{ steps.source-app-token.outputs.token || github.token }}",
            "target_gh_token: ${{ github.token }}",
            "persist-credentials: false",
            "id: source-provenance",
            "SOURCE_COMMIT: ${{ steps.source-provenance.outputs.commit }}",
        )
        for value in required:
            with self.subTest(value=value):
                self.assertIn(value, workflow)
        self.assertNotIn("skip-token-revoke", workflow)
        self.assertIn(
            "HAS_SOURCE_APP_PRIVATE_KEY: "
            "${{ secrets.TEMPLATE_SYNC_SOURCE_APP_PRIVATE_KEY != '' }}",
            workflow,
        )
        self.assertNotIn(
            "SOURCE_APP_PRIVATE_KEY: ${{ secrets.TEMPLATE_SYNC_SOURCE_APP_PRIVATE_KEY }}",
            workflow,
        )
        self.assertNotIn("secrets.GITHUB_TOKEN", workflow)
        self.assertIn(
            "GH_TOKEN: ${{ steps.source-app-token.outputs.token || github.token }}",
            workflow,
        )
        self.assertIn("GH_TOKEN: ${{ github.token }}", workflow)

    def test_template_sync_runs_daily_off_the_hour(self):
        workflow = WORKFLOW_FILE.read_text(encoding="utf-8")

        self.assertIn('cron: "17 7 * * *"', workflow)
        self.assertNotIn('cron: "0 7 * * 1"', workflow)

    def test_template_sync_is_single_flight_and_preserves_open_prs(self):
        workflow = WORKFLOW_FILE.read_text(encoding="utf-8")

        self.assertIn("group: template-sync-${{ github.repository }}", workflow)
        self.assertIn("cancel-in-progress: false", workflow)
        self.assertIn("id: sync-preflight", workflow)
        self.assertIn("--state open --limit 101", workflow)
        self.assertIn("More than 100 open PRs prevent bounded", workflow)
        self.assertIn('startswith("chore/template_sync_")', workflow)
        self.assertIn("Multiple open Template Sync PRs require human review", workflow)
        self.assertIn("steps.sync-preflight.outputs.should_sync == 'true'", workflow)
        self.assertNotIn("is_force_push_pr", workflow)
        self.assertNotIn("cleanup_old", workflow)

    def test_sync_pr_body_stays_inside_the_run_block(self):
        workflow = WORKFLOW_FILE.read_text(encoding="utf-8")

        self.assertNotIn("\nBefore merge:\n", workflow)
        self.assertIn("\n          Before merge:\n", workflow)
        self.assertIn(
            "\n          - Finalize manual boundaries and "
            ".github/inheritance/lock.json in this same reviewed PR.",
            workflow,
        )


if __name__ == "__main__":
    unittest.main()
