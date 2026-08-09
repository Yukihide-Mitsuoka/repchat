import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).parents[2]
SHARED_TEST = ROOT / "scripts/tests/test_template_sync_ignore.py"


class TemplateSyncIgnorePortabilityTest(unittest.TestCase):
    def test_shared_test_accepts_bootstrapped_child_contract(self):
        with tempfile.TemporaryDirectory(dir=ROOT.parent) as temporary_directory:
            child = Path(temporary_directory) / "child"
            test_path = child / "scripts/tests/test_template_sync_ignore.py"
            test_path.parent.mkdir(parents=True)
            shutil.copy2(SHARED_TEST, test_path)
            (child / ".github/workflows").mkdir(parents=True)
            (child / ".templatesyncignore").write_text(
                ".ai/project/**\n"
                ".github/inheritance/agent-profile.json\n"
                ".github/workflows/**\n"
                "docs/**\n"
                ":!docs/foundation/\n"
                ":!docs/foundation/**\n",
                encoding="utf-8",
            )
            (child / ".github/workflows/template-sync.yml").write_text(
                "name: Template Sync\n"
                "on:\n"
                "  schedule:\n"
                "    - cron: \"17 7 * * *\"\n"
                "concurrency:\n"
                "  group: template-sync-${{ github.repository }}\n"
                "  cancel-in-progress: false\n"
                "jobs:\n"
                "  sync:\n"
                "    steps:\n"
                "      - id: sync-preflight\n"
                "        run: |\n"
                "          gh pr list --state open --limit 101\n"
                "          echo 'More than 100 open PRs prevent bounded preflight'\n"
                "          echo 'select(.head.ref | startswith(\"chore/template_sync_\"))'\n"
                "          echo 'Multiple open Template Sync PRs require human review'\n"
                "          echo 'should_sync=true' >> \"$GITHUB_OUTPUT\"\n"
                "      - id: template-sync\n"
                "        if: steps.sync-preflight.outputs.should_sync == 'true'\n"
                "      - if: steps.template-sync.outputs.pr_branch != ''\n"
                "        run: |\n"
                "          SOURCE_COMMIT=\"$(gh api \"repos/${SOURCE_REPOSITORY}/commits/${SOURCE_SHORT}\" --jq .sha)\"\n"
                "          echo \"Unable to expand the Template Sync source commit\"\n"
                "          body=\"Direct-parent-source: ${SOURCE_COMMIT}\n\n"
                "          Before merge:\n"
                "          - Finalize manual boundaries and .github/inheritance/lock.json in this same reviewed PR.\"\n"
                "          gh pr edit \"$PR_NUMBER\" --body \"$body\"\n",
                encoding="utf-8",
            )

            result = subprocess.run(
                [sys.executable, str(test_path)],
                cwd=child,
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertEqual(
                result.returncode,
                0,
                msg=f"{result.stdout}\n{result.stderr}",
            )


if __name__ == "__main__":
    unittest.main()
