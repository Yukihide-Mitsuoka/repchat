import tempfile
import unittest
from pathlib import Path
from unittest import mock

from scripts.tests import test_context_budget
from scripts.tests import test_local_workflow_actions


CANONICAL_GUARDRAILS = ".ai/contracts/foundation/guardrails.md"


class ExpandPhaseCompatibilityTest(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary_directory.cleanup)
        self.root = Path(self.temporary_directory.name)

    def write(self, relative_path, content):
        path = self.root / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    def test_legacy_guardrail_body_satisfies_synchronized_boundary_test(self):
        rule_ids = ("GR-001", "GR-010", "GR-020", "GR-030", "GR-040")
        rule_body = "\n".join(f"### {rule_id}: retained rule" for rule_id in rule_ids)
        self.write(".ai/guardrails.md", rule_body)
        self.write(CANONICAL_GUARDRAILS, rule_body)

        case = test_context_budget.ContextBudgetTest(
            "test_guardrail_adapter_loads_one_canonical_rule_body"
        )
        with mock.patch.object(test_context_budget, "REPOSITORY_ROOT", self.root):
            result = case.run()

        self.assertTrue(result.wasSuccessful())

    def test_legacy_workflow_caller_satisfies_synchronized_boundary_test(self):
        action = "scripts/actions/labels-sync/action.yml"
        pinned = (
            "crazy-max/ghaction-github-labeler@"
            "548a7c3603594ec17c819e1239f281a3b801ab4d"
        )
        self.write(
            ".github/workflows/labels-sync.yml",
            "\n".join(
                (
                    "permissions:",
                    "  contents: read",
                    "steps:",
                    "  - uses: actions/checkout@"
                    "d23441a48e516b6c34aea4fa41551a30e30af803",
                    f"  - uses: {pinned}",
                )
            ),
        )
        self.write(
            action,
            "\n".join(("runs:", "  using: composite", f"  implementation: {pinned}")),
        )
        cases = {
            "labels": {
                "workflow": ".github/workflows/labels-sync.yml",
                "action": action,
                "implementation": "crazy-max/ghaction-github-labeler@",
                "pinned_action": pinned,
            }
        }
        case = test_local_workflow_actions.LocalWorkflowActionsTest(
            "test_protected_callers_keep_boundaries_and_delegate_implementation"
        )
        with (
            mock.patch.object(
                test_local_workflow_actions, "REPOSITORY_ROOT", self.root
            ),
            mock.patch.object(
                test_local_workflow_actions.LocalWorkflowActionsTest, "CASES", cases
            ),
        ):
            result = case.run()

        self.assertTrue(result.wasSuccessful())


if __name__ == "__main__":
    unittest.main()
