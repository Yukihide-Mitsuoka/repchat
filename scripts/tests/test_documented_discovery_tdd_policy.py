import unittest
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).parents[2]
AI_ROOT = REPOSITORY_ROOT / ".ai"
SKILL_ROOT = REPOSITORY_ROOT / ".skills"


def normalized(path: Path) -> str:
    return " ".join(path.read_text(encoding="utf-8").split())


class DocumentedDiscoveryAndTddPolicyTest(unittest.TestCase):
    def test_requirements_records_only_confirmed_terms_at_bounded_checkpoints(self):
        skill = normalized(SKILL_ROOT / "requirements.skill.md")

        for contract in (
            "human confirms both the term and its meaning",
            "bounded checkpoint",
            "docs/foundation/glossary.md",
            "docs/glossary.md",
            "Proposed, contradictory, incidental, or unresolved",
            "MUST NOT modify implementation code",
            "separate explicit instruction",
        ):
            with self.subTest(contract=contract):
                self.assertIn(contract, skill)

    def test_architecture_preserves_gr_022_and_bounds_smaller_decisions(self):
        skill = normalized(SKILL_ROOT / "architecture.skill.md")

        for contract in (
            "Every decision in GR-022",
            "outside GR-022",
            "hard to reverse",
            "surprising without its context",
            "real trade-off",
            "COD-052",
            "human confirms both the term and its meaning",
        ):
            with self.subTest(contract=contract):
                self.assertIn(contract, skill)

    def test_testing_authority_defines_conditional_vertical_tdd(self):
        policy = normalized(AI_ROOT / "testing.md")

        for contract in (
            "TST-011: Conditional test-driven development",
            "stable observable seam",
            "independent basis",
            "one behavior slice at a time",
            "fail for the intended reason",
            "smallest complete behavior",
            "same logic as the implementation",
            "introduced within the current behavior slice",
            "pre-existing code",
            "documentation-only changes",
            "disposable prototypes",
        ):
            with self.subTest(contract=contract):
                self.assertIn(contract, policy)

    def test_existing_implementation_routes_apply_the_shared_tdd_rule(self):
        for filename in ("feature.skill.md", "bugfix.skill.md", "test.skill.md"):
            with self.subTest(filename=filename):
                self.assertIn("TST-011", normalized(SKILL_ROOT / filename))

    def test_no_competing_skill_or_document_namespace_is_added(self):
        for relative_path in (
            ".skills/documented-discovery.skill.md",
            ".skills/grill-with-docs.skill.md",
            ".skills/implement.skill.md",
            ".skills/tdd.skill.md",
            "CONTEXT.md",
        ):
            with self.subTest(relative_path=relative_path):
                self.assertFalse((REPOSITORY_ROOT / relative_path).exists())


if __name__ == "__main__":
    unittest.main()
