import json
import unittest
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).parents[2]
IGNORE_FILE = REPOSITORY_ROOT / ".templatesyncignore"
MANIFEST_FILE = REPOSITORY_ROOT / ".github" / "inheritance" / "manifest.json"
BUGFIX_SKILL = REPOSITORY_ROOT / ".skills" / "bugfix.skill.md"
CI_WORKFLOW = REPOSITORY_ROOT / ".github" / "workflows" / "ci.yml"
WORKFLOW_RULES = REPOSITORY_ROOT / ".ai" / "workflow.md"


class RepChatTemplateSyncContractTest(unittest.TestCase):
    def entries(self):
        return {
            line.strip()
            for line in IGNORE_FILE.read_text(encoding="utf-8").splitlines()
            if line.strip() and not line.lstrip().startswith("#")
        }

    def test_foundation_bugfix_skill_is_inherited_and_transportable(self):
        path = ".skills/bugfix.skill.md"
        manifest = json.loads(MANIFEST_FILE.read_text(encoding="utf-8"))
        skill = BUGFIX_SKILL.read_text(encoding="utf-8")

        self.assertIn(path, manifest["inherited_paths"])
        self.assertNotIn(path, manifest["protected_paths"])
        self.assertNotIn(path, self.entries())
        self.assertIn("Sweep for siblings", skill)
        self.assertIn("Sibling occurrences searched; results reported", skill)

    def test_foundation_expand_compatibility_test_has_explicit_ownership(self):
        path = "scripts/tests/test_expand_phase_compatibility.py"
        manifest = json.loads(MANIFEST_FILE.read_text(encoding="utf-8"))

        self.assertIn(path, manifest["inherited_paths"])
        self.assertNotIn(path, manifest["protected_paths"])
        self.assertNotIn(path, self.entries())

    def test_new_foundation_test_support_is_inherited(self):
        entries = self.entries()
        manifest = json.loads(MANIFEST_FILE.read_text(encoding="utf-8"))

        for path in (
            "scripts/run-foundation-tests.sh",
            "scripts/tests/test_foundation_test_suite_selection.py",
            "scripts/tests/test_presentation_skill_contract.py",
        ):
            self.assertIn(path, manifest["inherited_paths"])
            self.assertNotIn(path, manifest["protected_paths"])
            self.assertNotIn(path, entries)

    def test_pr_language_role_tools_are_inherited_and_transportable(self):
        entries = self.entries()
        manifest = json.loads(MANIFEST_FILE.read_text(encoding="utf-8"))

        for path in (
            "scripts/pr_language_policy.py",
            "scripts/pr_repository_role.py",
            "scripts/tests/test_pr_language_policy.py",
            "scripts/tests/test_pr_repository_role.py",
        ):
            self.assertIn(path, manifest["inherited_paths"])
            self.assertNotIn(path, manifest["protected_paths"])
            self.assertNotIn(path, entries)

    def test_leaf_pr_language_caller_uses_the_accepted_base_contract(self):
        workflow = CI_WORKFLOW.read_text(encoding="utf-8")
        rules = WORKFLOW_RULES.read_text(encoding="utf-8")

        for fragment in (
            "types: [opened, reopened, synchronize, edited, labeled, unlabeled, ready_for_review]",
            "ref: ${{ github.event.pull_request.base.sha }}",
            "working-directory: .pr-language-base",
            "PR_ROLE: ${{ steps.pr-role.outputs.role }}",
            "python3 -m scripts.pr_language_policy",
        ):
            self.assertIn(fragment, workflow)
        self.assertNotIn("pull_request_target:", workflow)
        self.assertIn("template producers, Japanese for consumer leaves", rules)
        self.assertIn("PR language guide", rules)

    def test_project_release_history_and_codeql_invariant_are_target_owned(self):
        entries = self.entries()
        manifest = json.loads(MANIFEST_FILE.read_text(encoding="utf-8"))

        self.assertIn("CHANGELOG.md", entries)
        self.assertIn("scripts/tests/test_codeql_workflow.py", entries)
        self.assertIn(
            "scripts/tests/test_repchat_template_sync_contract.py",
            entries,
        )
        self.assertIn(
            "scripts/tests/test_repchat_template_sync_contract.py",
            manifest["protected_paths"],
        )
        self.assertIn(
            "scripts/tests/test_template_sync_ignore.py",
            manifest["inherited_paths"],
        )
        self.assertNotIn("scripts/tests/test_template_sync_ignore.py", entries)

    def test_project_foundation_suite_split_is_target_owned(self):
        entries = self.entries()
        manifest = json.loads(MANIFEST_FILE.read_text(encoding="utf-8"))

        for path in (
            "scripts/foundation_test_runner.py",
            "scripts/tests/test_foundation_test_runner.py",
        ):
            self.assertIn(path, entries)
            self.assertIn(path, manifest["protected_paths"])
            self.assertNotIn(path, manifest["inherited_paths"])


if __name__ == "__main__":
    unittest.main()
