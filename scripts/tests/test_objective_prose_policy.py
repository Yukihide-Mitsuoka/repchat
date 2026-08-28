import unittest
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).parents[2]
AI_INDEX = REPOSITORY_ROOT / ".ai" / "README.md"
DOCUMENTATION_RULES = REPOSITORY_ROOT / ".ai" / "documentation.md"
DOCUMENTATION_SKILL = REPOSITORY_ROOT / ".skills" / "documentation.skill.md"


class ObjectiveProsePolicyTest(unittest.TestCase):
    def test_every_task_routes_ai_authored_prose_to_doc_002(self):
        index = AI_INDEX.read_text(encoding="utf-8")

        self.assertIn("All AI-authored explanatory prose", index)
        self.assertIn("[DOC-002](documentation.md#doc-002-objective-structured-prose)", index)

    def test_metaphor_exception_requires_mapping_benefit_and_limit(self):
        rules = DOCUMENTATION_RULES.read_text(encoding="utf-8")
        normalized_rules = " ".join(rules.split())

        self.assertIn("MUST NOT use metaphor", normalized_rules)
        self.assertIn("mapped technical elements", normalized_rules)
        self.assertIn("specific insight it adds", normalized_rules)
        self.assertIn("where the comparison stops", normalized_rules)

    def test_document_quality_rules_are_conditional_and_reader_centered(self):
        index = AI_INDEX.read_text(encoding="utf-8")
        rules = DOCUMENTATION_RULES.read_text(encoding="utf-8")
        skill = DOCUMENTATION_SKILL.read_text(encoding="utf-8")
        normalized_rules = " ".join(rules.split())

        self.assertNotIn("DOC-003", index.split("## Context acquisition protocol")[0])
        self.assertIn("| Documentation | documentation.md", index)
        self.assertIn("## DOC-003: Reader-centered logical documentation", rules)
        self.assertIn("reader without conversation history", normalized_rules)
        self.assertIn(
            "classification criterion and level of abstraction", normalized_rules
        )
        self.assertIn("verified fact, inference, accepted decision", normalized_rules)
        self.assertIn("structure and representation chosen by DOC-003", skill)

    def test_formatting_heuristics_do_not_replace_meaning(self):
        rules = DOCUMENTATION_RULES.read_text(encoding="utf-8")
        normalized_rules = " ".join(rules.split())

        self.assertIn("review signals, not mandatory limits", normalized_rules)
        self.assertIn(
            "do not create empty headings or deep indentation", normalized_rules
        )
        self.assertIn("state its conclusion and essential conditions", normalized_rules)
        self.assertIn("label representative or incomplete sets", normalized_rules)


if __name__ == "__main__":
    unittest.main()
