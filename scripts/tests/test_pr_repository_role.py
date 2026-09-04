import copy
import json
import tempfile
import unittest
from pathlib import Path

from scripts import pr_repository_role as roles
from scripts import template_inheritance as inheritance
from scripts.tests.test_template_inheritance import valid_lock, valid_manifest


ROOT = Path(__file__).resolve().parents[2]
EXPORT = inheritance.FOUNDATION_BOOTSTRAP_EXPORT_PATH
FOUNDATION = "Yukihide-Mitsuoka/ai-dev-foundation"
CHILD = "acme/application"


class RepositoryRoleTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.export = json.loads((ROOT / EXPORT).read_text())
        self.write(EXPORT, self.export)
        self.write(".ai/contracts/foundation/agent-entry.md", "foundation contract")

    def write(self, path, value):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(value if isinstance(value, str) else json.dumps(value))
        return target

    def consumer(self):
        manifest = valid_manifest()
        self.write(inheritance.MANIFEST_PATH, manifest)
        self.write(".github/inheritance/lock.json", valid_lock())
        self.write(".templatesyncignore", "\n".join(manifest["protected_paths"] + [".github/workflows/**"]))

    def template(self, repository=CHILD):
        export = copy.deepcopy(self.export)
        directory = f".ai/contracts/templates/{repository.casefold()}/"
        export["repository"] = repository
        export["inherited_paths"].append(directory)
        export["agent_inputs"].append({
            "layer": "template", "repository": repository, "path": directory + "agent-overlay.md",
        })
        self.write(directory + "agent-overlay.md", "template overlay")
        return self.write(directory + "inheritance-export.json", export)

    def test_foundation_and_intermediate_producers(self):
        self.assertEqual(roles.resolve_role(self.root, FOUNDATION), "producer")
        self.assertEqual(roles.resolve_role(self.root, FOUNDATION.upper()), "producer")
        self.consumer()
        self.template()
        self.assertEqual(roles.resolve_role(self.root, CHILD), "producer")

    def test_leaf_does_not_become_producer_from_ancestor_exports(self):
        self.consumer()
        self.template("acme/parent-template")
        self.assertEqual(roles.resolve_role(self.root, CHILD), "consumer")

    def test_export_added_in_head_does_not_change_accepted_base_role(self):
        self.consumer()
        base = self.root
        with tempfile.TemporaryDirectory() as directory:
            self.root = Path(directory).resolve()
            self.write(EXPORT, self.export)
            self.write(".ai/contracts/foundation/agent-entry.md", "foundation contract")
            self.consumer()
            self.template()
            self.assertEqual(roles.resolve_role(self.root, CHILD), "producer")
            self.assertEqual(roles.resolve_role(base, CHILD), "consumer")

    def test_missing_role_and_malformed_identity_fail_closed(self):
        for repository in (CHILD, "../bad", "", "acme/repo\n"):
            with self.subTest(repository=repository), self.assertRaises(ValueError):
                roles.resolve_role(self.root, repository)

    def test_invalid_manifest_cannot_hide_behind_producer_export(self):
        self.write(inheritance.MANIFEST_PATH, {})
        with self.assertRaises(ValueError):
            roles.resolve_role(self.root, FOUNDATION)

    def test_v2_profile_must_identify_the_current_leaf(self):
        manifest = {
            "schema_version": 2, "parent": {"repository": FOUNDATION, "branch": "main"},
            "lock_file": ".github/inheritance/lock.json",
            "inherited_paths": self.export["inherited_paths"],
            "protected_paths": self.export["protected_paths"],
        }
        self.write(inheritance.MANIFEST_PATH, manifest)
        self.write(manifest["lock_file"], {"schema_version": 1, "parent": {"repository": FOUNDATION, "commit": "a" * 40}})
        self.write(".templatesyncignore", "\n".join(manifest["protected_paths"]))
        self.write(".ai/project/agent-overlay.md", "project overlay")
        self.write(inheritance.AGENT_PROFILE_PATH, {
            "schema_version": 1, "authority_policy": "strengthen-only",
            "inputs": self.export["agent_inputs"] + [{
                "layer": "project", "repository": CHILD, "path": ".ai/project/agent-overlay.md",
            }],
        })
        self.assertEqual(roles.resolve_role(self.root, CHILD), "consumer")
        with self.assertRaisesRegex(ValueError, "profile identity"):
            roles.resolve_role(self.root, "acme/another-repository")

    def test_self_parent_is_contradictory(self):
        self.consumer()
        with self.assertRaisesRegex(ValueError, "inherit from itself"):
            roles.resolve_role(self.root, valid_manifest()["parent"]["repository"])

    def test_malformed_export_fields_and_inputs_fail_closed(self):
        for field, value in (("schema_version", True), ("repository", CHILD),
                             ("agent_inputs", []), ("agent_inputs", {}),
                             ("agent_inputs", [self.export["agent_inputs"][0]] * 2)):
            export = copy.deepcopy(self.export)
            export[field] = value
            self.write(EXPORT, export)
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                roles.resolve_role(self.root, FOUNDATION)

    def test_duplicate_json_keys_and_broken_symlinks_fail_closed(self):
        path = self.write(EXPORT, '{"repository":"acme/one","repository":"acme/two"}')
        with self.assertRaisesRegex(ValueError, "duplicate"):
            roles.resolve_role(self.root, FOUNDATION)
        path.unlink()
        path.symlink_to(self.root / "missing.json")
        with self.assertRaises(ValueError):
            roles.resolve_role(self.root, FOUNDATION)

    def test_non_owner_qualified_and_symlinked_export_directories_fail_closed(self):
        path = self.template()
        renamed = path.parent.with_name("wrong-name")
        path.parent.rename(renamed)
        with self.assertRaisesRegex(ValueError, "path must match"):
            roles.resolve_role(self.root, FOUNDATION)
        path.parent.symlink_to(renamed, target_is_directory=True)
        with self.assertRaises(ValueError):
            roles.resolve_role(self.root, FOUNDATION)

    def test_absent_agent_input_and_invalid_ancestor_export_fail_closed(self):
        self.consumer()
        (self.root / ".ai/contracts/foundation/agent-entry.md").unlink()
        with self.assertRaises(ValueError):
            roles.resolve_role(self.root, CHILD)
        self.write(EXPORT, "not json")
        with self.assertRaises(ValueError):
            roles.resolve_role(self.root, CHILD)

    def test_export_discovery_rejects_misplaced_files_and_excessive_entries(self):
        misplaced = self.write(".ai/contracts/templates/inheritance-export.json", self.export)
        with self.assertRaisesRegex(ValueError, "owner-qualified"):
            roles.resolve_role(self.root, FOUNDATION)
        misplaced.unlink()
        for index in range(257):
            self.write(f".ai/contracts/templates/file-{index}", "irrelevant")
        with self.assertRaisesRegex(ValueError, "excessive"):
            roles.resolve_role(self.root, FOUNDATION)

    def test_english_template_and_inherited_contract_explain_leaf_scope(self):
        template = (ROOT / ".github/PULL_REQUEST_TEMPLATE.md").read_text()
        self.assertIn("English prose; consumer leaves write Japanese prose", template)
        self.assertIn("## What and why", template)
        self.assertNotIn("## 変更内容と理由", template)
        entry = (ROOT / ".ai/contracts/foundation/agent-entry.md").read_text()
        self.assertIn("Read ADR-0021 for PR language", entry)


if __name__ == "__main__":
    unittest.main()
