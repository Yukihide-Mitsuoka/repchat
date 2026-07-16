import importlib.util
import unittest
from pathlib import Path

from test_github_governance_comparison import CHECKS, resolved_policy, ruleset_inventory


ROOT = Path(__file__).parents[2]
MODULE_PATH = ROOT / "scripts/github_governance.py"
SPEC = importlib.util.spec_from_file_location("github_governance_apply_actions", MODULE_PATH)
governance = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(governance)

REPOSITORY = "acme/demo"


def inventory():
    result = ruleset_inventory()
    result["branch"]["protected"] = False
    result["effective_rules"] = []
    result["rulesets"] = []
    return result


def managed_update_state():
    return {
        "conditions": {"exclude": [], "include": ["refs/heads/main"]},
        "pull_request": {
            "allowed_merge_methods": ["squash"],
            "dismiss_stale_reviews_on_push": True,
            "require_code_owner_review": True,
            "required_review_thread_resolution": True,
        },
        "required_status_checks": [
            {"context": "lint", "integration_id": 42},
            {"context": "test", "integration_id": None},
        ],
        "rule_types": ["non_fast_forward", "pull_request", "required_status_checks"],
        "unsupported": [],
    }


class ApplyActionPlanningTest(unittest.TestCase):
    def test_missing_ruleset_creates_owned_ruleset_action(self):
        result = governance.build_apply_actions(resolved_policy(), inventory())
        self.assertEqual(result["status"], "ready")
        self.assertEqual(
            [action["id"] for action in result["actions"]],
            ["branch.ruleset"],
        )
        action = result["actions"][0]
        self.assertEqual(action["method"], "POST")
        self.assertEqual(action["endpoint"], f"repos/{REPOSITORY}/rulesets")
        self.assertEqual(action["body"]["name"], governance.MANAGED_RULESET_NAME)
        self.assertEqual(
            action["body"]["conditions"]["ref_name"]["include"],
            ["refs/heads/main"],
        )
        pull = action["body"]["rules"][0]["parameters"]
        self.assertEqual(pull["required_approving_review_count"], 0)
        self.assertTrue(pull["required_review_thread_resolution"])
        checks = action["body"]["rules"][1]["parameters"]
        self.assertEqual(
            checks["required_status_checks"],
            [{"context": check} for check in CHECKS],
        )
        self.assertTrue(checks["strict_required_status_checks_policy"])

    def test_drifted_existing_repository_ruleset_update_is_rejected(self):
        current = ruleset_inventory()
        current["effective_rules"] = []
        with self.assertRaises(governance.PolicyError):
            governance.build_apply_actions(resolved_policy(), current)

    def test_existing_ruleset_update_preserves_supported_stricter_fields(self):
        current = ruleset_inventory()
        current["effective_rules"] = []
        current["rulesets"][0]["update_state"] = managed_update_state()
        result = governance.build_apply_actions(resolved_policy(), current)
        action = result["actions"][0]
        self.assertEqual(action["method"], "PUT")
        self.assertEqual(action["endpoint"], f"repos/{REPOSITORY}/rulesets/7")
        pull = action["body"]["rules"][0]["parameters"]
        self.assertTrue(pull["dismiss_stale_reviews_on_push"])
        self.assertTrue(pull["require_code_owner_review"])
        self.assertEqual(pull["allowed_merge_methods"], ["squash"])
        checks = action["body"]["rules"][1]["parameters"]["required_status_checks"]
        by_context = {check["context"]: check for check in checks}
        self.assertEqual(by_context["lint"]["integration_id"], 42)
        self.assertNotIn("integration_id", by_context["test"])

    def test_existing_ruleset_update_rejects_unpreservable_state(self):
        for mutation in ("unsupported", "conditions", "unknown", "methods", "types"):
            current = ruleset_inventory()
            current["effective_rules"] = []
            state = managed_update_state()
            if mutation == "unsupported":
                state["unsupported"] = ["unsupported_rule"]
            elif mutation == "conditions":
                state["conditions"]["include"].append("refs/heads/release")
            elif mutation == "unknown":
                state["pull_request"]["require_code_owner_review"] = "unknown"
            elif mutation == "methods":
                state["pull_request"]["allowed_merge_methods"] = [[]]
            else:
                state["rule_types"] = [[]]
            current["rulesets"][0]["update_state"] = state
            with self.subTest(mutation=mutation), self.assertRaises(governance.PolicyError):
                governance.build_apply_actions(resolved_policy(), current)

    def test_common_actions_are_ordered_and_describe_side_effects(self):
        current = ruleset_inventory()
        current["repository"].update(
            allow_merge_commit=True,
            delete_branch_on_merge=False,
            has_discussions=False,
            squash_merge_commit_title="COMMIT_OR_PR_TITLE",
        )
        current["security"] = {
            "dependabot_security_updates": "enabled",
            "private_vulnerability_reporting": "disabled",
            "push_protection": "disabled",
            "secret_scanning": "disabled",
            "vulnerability_alerts": "disabled",
        }
        result = governance.build_apply_actions(resolved_policy(), current)
        self.assertEqual(
            [action["id"] for action in result["actions"]],
            [
                "security.secret_scanning",
                "security.vulnerability_alerts",
                "security.private_vulnerability_reporting",
                "repository.settings",
                "security.dependabot_security_updates",
            ],
        )
        self.assertEqual(result["actions"][0]["method"], "PATCH")
        self.assertIn(
            "pushes_containing_detected_secrets_are_rejected",
            result["actions"][0]["side_effects"],
        )
        self.assertEqual(result["actions"][1]["method"], "PUT")
        self.assertIsNone(result["actions"][1]["body"])
        repository_action = result["actions"][3]
        self.assertEqual(
            repository_action["body"],
            {
                "allow_merge_commit": False,
                "allow_rebase_merge": False,
                "allow_squash_merge": True,
                "delete_branch_on_merge": True,
                "has_discussions": True,
                "squash_merge_commit_message": "PR_BODY",
                "squash_merge_commit_title": "PR_TITLE",
            },
        )
        self.assertIn("repository.merge_strategy", repository_action["verify_controls"])
        self.assertEqual(result["actions"][4]["method"], "DELETE")
        self.assertIn(
            "dependabot_security_updates_are_disabled",
            result["actions"][4]["side_effects"],
        )

    def test_compliant_inventory_has_no_actions(self):
        result = governance.build_apply_actions(
            resolved_policy(),
            ruleset_inventory(),
        )
        self.assertEqual(result["status"], "compliant")
        self.assertEqual(result["actions"], [])

    def test_squash_merge_is_enabled_before_linear_history_ruleset(self):
        current = inventory()
        current["repository"].update(
            allow_merge_commit=True,
            allow_squash_merge=False,
        )

        result = governance.build_apply_actions(resolved_policy(), current)

        self.assertEqual(
            [action["id"] for action in result["actions"]],
            ["repository.settings", "branch.ruleset"],
        )

    def test_unknown_or_unobserved_preflight_blocks_all_actions(self):
        unknown = ruleset_inventory()
        unknown["rulesets"][0]["has_bypass_actors"] = "unknown"
        unknown_repository = ruleset_inventory()
        unknown_repository["repository"].pop("has_discussions")
        unobserved = inventory()
        unobserved["observed_checks"] = ["lint"]
        for current in (unknown, unknown_repository, unobserved):
            with self.subTest(current=current), self.assertRaises(governance.PolicyError):
                governance.build_apply_actions(resolved_policy(), current)

    def test_drifted_legacy_backend_is_rejected(self):
        with self.assertRaises(governance.PolicyError):
            governance.build_apply_actions(resolved_policy("legacy_branch_protection"), inventory())

    def test_organization_ruleset_with_managed_name_is_not_updated(self):
        current = ruleset_inventory()
        current["rulesets"][0]["source"] = "acme"
        current["rulesets"][0]["source_type"] = "Organization"
        for rule in current["effective_rules"]:
            rule["source"] = "acme"
            rule["source_type"] = "Organization"
        result = governance.build_apply_actions(resolved_policy(), current)
        self.assertEqual(result["actions"][0]["method"], "POST")
        self.assertEqual(result["actions"][0]["endpoint"], f"repos/{REPOSITORY}/rulesets")

    def test_repository_ownership_matching_is_case_insensitive(self):
        current = ruleset_inventory()
        current["rulesets"][0]["source"] = "Acme/Demo"
        current["effective_rules"] = []
        with self.assertRaises(governance.PolicyError):
            governance.build_apply_actions(resolved_policy(), current)


if __name__ == "__main__":
    unittest.main()
