import json
import unittest
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).parents[2]
IGNORE_FILE = REPOSITORY_ROOT / ".templatesyncignore"
MANIFEST_FILE = REPOSITORY_ROOT / ".github" / "inheritance" / "manifest.json"
BUGFIX_SKILL = REPOSITORY_ROOT / ".skills" / "bugfix.skill.md"


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


if __name__ == "__main__":
    unittest.main()
