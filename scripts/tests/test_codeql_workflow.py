import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


class CodeQLWorkflowTest(unittest.TestCase):
    def test_python_analysis_is_enabled(self) -> None:
        workflow = (ROOT / ".github/workflows/codeql.yml").read_text()

        self.assertIn("language: [python]", workflow)
        self.assertNotIn("language: []", workflow)


if __name__ == "__main__":
    unittest.main()
