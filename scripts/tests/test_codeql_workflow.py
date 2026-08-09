import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SKIP_DIRS = {".venv", "venv", "node_modules", ".git", "build", "dist"}
CODEQL_ACTION = re.compile(
    r"github/codeql-action/(?P<action>[^@\s]+)@"
    r"(?P<sha>[0-9a-f]{40})\s+#\s+(?P<version>v\S+)"
)
SUPPORTED_CODEQL_SHA = "5595ccaf912efad79be6eef63a5619ff05969be3"
SUPPORTED_CODEQL_VERSION = "v4.37.6"


def _has(pattern: str, *roots: str) -> bool:
    for r in roots:
        base = ROOT / r
        if not base.is_dir():
            continue
        for p in base.rglob(pattern):
            if not SKIP_DIRS & set(p.parts):
                return True
    return False


class CodeQLWorkflowTest(unittest.TestCase):
    def test_codeql_actions_use_supported_v4_digest(self) -> None:
        expected = {
            ".github/workflows/codeql.yml": {"init", "autobuild", "analyze"},
            ".github/workflows/scorecard.yml": {"upload-sarif"},
        }

        for path, expected_actions in expected.items():
            with self.subTest(path=path):
                workflow = (ROOT / path).read_text(encoding="utf-8")
                references = {
                    (match["action"], match["sha"], match["version"])
                    for match in CODEQL_ACTION.finditer(workflow)
                }
                self.assertEqual(
                    {
                        (action, SUPPORTED_CODEQL_SHA, SUPPORTED_CODEQL_VERSION)
                        for action in expected_actions
                    },
                    references,
                )

    def test_all_executable_source_languages_are_analyzed(self) -> None:
        """Every language the repo actually ships source for must be scanned.

        Asserting a literal `language: [python]` fails on any project that
        analyses more than the template does, and the obvious way to make that
        assertion pass — narrowing the matrix — would delete SAST coverage
        (GR-030). Deriving the expectation from the source tree keeps the check
        meaningful both in a single-language template and in a polyglot project.
        """
        workflow = (ROOT / ".github/workflows/codeql.yml").read_text()
        matrix = re.search(r"language:\s*\[([^\]]*)\]", workflow)
        self.assertIsNotNone(matrix, "codeql.yml declares no language matrix")

        declared = {x.strip() for x in matrix.group(1).split(",") if x.strip()}
        self.assertNotEqual(declared, set(), "codeql.yml language matrix is empty")

        expected = set()
        if _has("*.ts", "src", "scripts") or _has("*.js", "src", "scripts"):
            expected.add("javascript-typescript")
        if _has("*.py", "scripts", "spikes", "src"):
            expected.add("python")

        missing = expected - declared
        self.assertFalse(missing, f"source present but not analyzed by CodeQL: {sorted(missing)}")


if __name__ == "__main__":
    unittest.main()
