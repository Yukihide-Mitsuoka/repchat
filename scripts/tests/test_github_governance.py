import copy
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).parents[1] / "github_governance.py"
REPOSITORY_ROOT = MODULE_PATH.parents[1]
SPEC = importlib.util.spec_from_file_location("github_governance", MODULE_PATH)
governance = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(governance)

KNOWN_RULES = {"GR-010", "GR-011", "GR-012", "SEC-002", "SEC-003", "WF-030"}


def foundation_policy():
    return {
        "schema_version": 1,
        "managed_by": "ai-dev-foundation",
        "minimums": {
            "pull_request_required": {"value": True, "rule_refs": ["GR-010"]},
            "status_checks_required": {"value": True, "rule_refs": ["GR-012"]},
            "force_pushes_allowed": {"value": False, "rule_refs": ["GR-011"]},
            "admin_bypass_allowed": {"value": False, "rule_refs": ["GR-010", "GR-012"]},
            "squash_merge_only": {"value": True, "rule_refs": ["WF-030"]},
            "secret_scanning_enabled": {"value": True, "rule_refs": ["SEC-002"]},
            "push_protection_enabled": {"value": True, "rule_refs": ["SEC-002"]},
            "vulnerability_alerts_enabled": {"value": True, "rule_refs": ["SEC-003"]},
            "private_vulnerability_reporting_enabled": {
                "value": True,
                "rule_refs": ["SEC-003"],
            },
        },
        "defaults": {
            "target_branch": "main",
            "enforcement_backend": "ruleset",
            "required_approvals": 0,
            "require_last_push_approval": False,
            "required_checks": ["lint", "test"],
            "dependency_update_provider": "renovate",
            "delete_branch_on_merge": True,
            "discussions_enabled": False,
            "squash_merge_commit_title": "PR_TITLE",
            "squash_merge_commit_message": "PR_BODY",
        },
    }


def profile(profile_id, parent, checks):
    return {
        "schema_version": 1,
        "id": profile_id,
        "parent": parent,
        "required_checks": checks,
    }


class GovernancePolicyTest(unittest.TestCase):
    def resolve(self, foundation=None, repository=None, profiles=None):
        return governance.resolve_policy(
            foundation or foundation_policy(),
            repository or {"schema_version": 1, "overrides": {}},
            KNOWN_RULES,
            [] if profiles is None else profiles,
        )

    def assert_policy_error(self, foundation=None, repository=None):
        with self.assertRaises(governance.PolicyError):
            self.resolve(foundation, repository)

    def test_foundation_file_uses_solo_friendly_defaults(self):
        policy = json.loads(
            (REPOSITORY_ROOT / ".github/governance/foundation.json").read_text()
        )
        defaults = policy["defaults"]
        minimums = policy["minimums"]

        self.assertEqual(defaults["required_approvals"], 0)
        self.assertFalse(defaults["require_last_push_approval"])
        self.assertTrue(defaults["delete_branch_on_merge"])
        self.assertFalse(defaults["discussions_enabled"])
        self.assertEqual(defaults["dependency_update_provider"], "renovate")
        self.assertTrue(minimums["squash_merge_only"]["value"])
        self.assertFalse(minimums["admin_bypass_allowed"]["value"])

    def test_repository_customizes_defaults_and_adds_required_checks(self):
        result = self.resolve(
            repository={
                "schema_version": 1,
                "overrides": {
                    "required_approvals": 1,
                    "require_last_push_approval": True,
                    "required_checks": ["doctor", "secret-scan"],
                    "dependency_update_provider": "dependabot",
                    "discussions_enabled": True,
                    "squash_merge_commit_title": "COMMIT_OR_PR_TITLE",
                    "squash_merge_commit_message": "COMMIT_MESSAGES",
                },
            }
        )

        self.assertEqual(result["settings"]["required_approvals"], 1)
        self.assertEqual(
            result["settings"]["required_checks"],
            ["lint", "test", "doctor", "secret-scan"],
        )
        self.assertTrue(result["settings"]["discussions_enabled"])
        self.assertEqual(result["settings"]["squash_merge_commit_title"], "COMMIT_OR_PR_TITLE")
        self.assertTrue(result["minimums"]["pull_request_required"]["value"])

    def test_profiles_form_parent_chain_and_required_checks_are_monotonic(self):
        result = self.resolve(
            repository={
                "schema_version": 1,
                "overrides": {"required_checks": ["test", "mart-inspection"]},
            },
            profiles=[
                profile("secure-data", "terraform-gcp", ["data-contract"]),
                profile("terraform-gcp", "ai-dev-foundation", ["lint", "iac-scan"]),
            ],
        )

        self.assertEqual(
            [item["id"] for item in result["profiles"]],
            ["terraform-gcp", "secure-data"],
        )
        self.assertEqual(
            result["settings"]["required_checks"],
            ["lint", "test", "iac-scan", "data-contract", "mart-inspection"],
        )

    def test_invalid_profile_graphs_fail_closed(self):
        invalid_graphs = (
            [profile("terraform", "ai-dev-foundation", ["scan"])] * 2,
            [
                profile("terraform", "ai-dev-foundation", ["scan"]),
                profile("nextjs", "ai-dev-foundation", ["web-test"]),
            ],
            [profile("orphan", "missing", ["scan"])],
            [profile("first", "second", ["scan"]), profile("second", "first", ["test"])],
            [profile("Invalid", "ai-dev-foundation", ["scan"])],
            [profile("terraform", "ai-dev-foundation", ["scan", "scan"])],
        )
        for profiles in invalid_graphs:
            with self.subTest(profiles=profiles), self.assertRaises(governance.PolicyError):
                self.resolve(profiles=profiles)

    def test_profile_directory_loads_regular_json_and_rejects_symlinks(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            directory = root / ".github/governance/profiles"
            directory.mkdir(parents=True)
            safe = profile("terraform", "ai-dev-foundation", ["scan"])
            (directory / "safe.json").write_text(json.dumps(safe))
            self.assertEqual(governance._load_profiles(root), [safe])
            outside = root / "outside.json"
            outside.write_text(json.dumps(profile("outside", "ai-dev-foundation", ["scan"])))
            (directory / "unsafe.json").symlink_to(outside)

            with self.assertRaises(governance.PolicyError):
                governance._load_profiles(root)

            linked_root = root / "linked-root"
            linked_root.mkdir()
            (linked_root / ".github").symlink_to(root / ".github", target_is_directory=True)
            with self.assertRaises(governance.PolicyError):
                governance._load_profiles(linked_root)

    def test_unknown_fields_and_minimum_overrides_are_rejected(self):
        for repository in (
            {"schema_version": 1, "overrides": {}, "extra": True},
            {"schema_version": 1, "overrides": {"pull_request_required": False}},
        ):
            with self.subTest(repository=repository):
                self.assert_policy_error(repository=repository)

    def test_invalid_operational_values_are_rejected(self):
        invalid_overrides = (
            {"target_branch": "feature//main"},
            {"target_branch": "release/.hidden"},
            {"required_approvals": -1},
            {"enforcement_backend": "automatic"},
            {"enforcement_backend": ["ruleset"]},
            {"required_checks": []},
            {"required_checks": ["lint", "lint"]},
            {"required_checks": ["lint\ntest"]},
            {"required_checks": ["lint", ["test"]]},
            {"dependency_update_provider": ["renovate", "dependabot"]},
            {"discussions_enabled": "yes"},
            {"squash_merge_commit_title": "ISSUE_TITLE"},
            {"squash_merge_commit_message": "FULL_DIFF"},
            {"squash_merge_commit_title": ["PR_TITLE"]},
            {"squash_merge_commit_message": {"format": "PR_BODY"}},
            {"required_approvals": 0, "require_last_push_approval": True},
        )
        for overrides in invalid_overrides:
            with self.subTest(overrides=overrides):
                self.assert_policy_error(repository={"schema_version": 1, "overrides": overrides})

    def test_foundation_minimum_values_and_rule_refs_are_strict(self):
        for mutate in (
            lambda policy: policy["minimums"]["force_pushes_allowed"].update(value=True),
            lambda policy: policy["minimums"]["pull_request_required"].update(rule_refs=[]),
            lambda policy: policy["minimums"]["pull_request_required"].update(rule_refs=[["GR-010"]]),
            lambda policy: policy["minimums"]["pull_request_required"].update(rule_refs=["GR-011"]),
            lambda policy: policy["minimums"]["pull_request_required"].update(rule_refs=["GR-999"]),
        ):
            policy = copy.deepcopy(foundation_policy())
            mutate(policy)
            with self.subTest(policy=policy):
                self.assert_policy_error(foundation=policy)

    def test_schema_version_and_manager_are_fixed(self):
        for key, value in (("schema_version", 2), ("managed_by", "downstream")):
            policy = foundation_policy()
            policy[key] = value
            with self.subTest(key=key):
                self.assert_policy_error(foundation=policy)


if __name__ == "__main__":
    unittest.main()
