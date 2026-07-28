import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
LANGUAGE_MATRIX = re.compile(r"(?m)^\s*language:\s*\[([^\]\r\n]*)\]\s*(?:#.*)?$")


def python_analysis_is_enabled(workflow: str) -> bool:
    match = LANGUAGE_MATRIX.search(workflow)
    if match is None:
        return False
    languages = {entry.strip() for entry in match.group(1).split(",") if entry.strip()}
    return "python" in languages


class CodeQLWorkflowTest(unittest.TestCase):
    def test_python_analysis_is_enabled(self) -> None:
        workflow = (ROOT / ".github/workflows/codeql.yml").read_text()

        self.assertTrue(python_analysis_is_enabled(workflow))

    def test_python_analysis_can_share_a_multi_language_matrix(self) -> None:
        workflow = "matrix:\n  language: [javascript-typescript, python]\n"

        self.assertTrue(python_analysis_is_enabled(workflow))

    def test_python_analysis_requires_an_exact_non_empty_entry(self) -> None:
        self.assertFalse(python_analysis_is_enabled("language: []\n"))
        self.assertFalse(python_analysis_is_enabled("language: [javascript-typescript]\n"))
        self.assertFalse(python_analysis_is_enabled("language: [python-custom]\n"))


if __name__ == "__main__":
    unittest.main()
