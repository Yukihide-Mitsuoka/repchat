import unittest
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).parents[2]
AI_INDEX = REPOSITORY_ROOT / ".ai" / "README.md"
DOCUMENTATION_RULES = REPOSITORY_ROOT / ".ai" / "documentation.md"


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


if __name__ == "__main__":
    unittest.main()
