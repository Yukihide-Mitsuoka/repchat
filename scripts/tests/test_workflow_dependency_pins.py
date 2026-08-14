import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SHA = re.compile(r"[0-9a-f]{40}")
USES = re.compile(r"\buses:\s*([^\s#]+)")
VERSION_COMMENT = re.compile(r"#\s*v(\d+)(?:\D|$)")
NODE24_MINIMUM_MAJORS = {
    "actions/attest-build-provenance": 4,
    "actions/upload-artifact": 7,
    "amannn/action-semantic-pull-request": 6,
    "crazy-max/ghaction-github-labeler": 6,
    "gitleaks/gitleaks-action": 3,
    "github/codeql-action": 4,
    "googleapis/release-please-action": 5,
}


class WorkflowDependencyPinsTest(unittest.TestCase):
    def test_external_workflow_dependencies_use_commit_shas(self) -> None:
        unpinned: list[str] = []
        sources = list((ROOT / ".github/workflows").glob("*.y*ml"))
        sources.extend((ROOT / "scripts/actions").glob("*/action.yml"))
        for workflow in sorted(sources):
            for line_number, line in enumerate(workflow.read_text().splitlines(), 1):
                match = USES.search(line)
                if not match:
                    continue
                target = match.group(1)
                if target.startswith(("./", "docker://")):
                    continue
                reference = target.rsplit("@", 1)[-1]
                if not SHA.fullmatch(reference):
                    unpinned.append(f"{workflow.relative_to(ROOT)}:{line_number}: {target}")

        self.assertEqual([], unpinned, "unpinned workflow dependencies:\n" + "\n".join(unpinned))

    def test_javascript_actions_use_node24_compatible_majors(self) -> None:
        incompatible: list[str] = []
        sources = list((ROOT / ".github/workflows").glob("*.y*ml"))
        sources.extend((ROOT / "scripts/actions").glob("*/action.yml"))
        for workflow in sorted(sources):
            for line_number, line in enumerate(workflow.read_text().splitlines(), 1):
                match = USES.search(line)
                if not match:
                    continue
                action = match.group(1).rsplit("@", 1)[0]
                repository = "/".join(action.split("/")[:2])
                minimum = NODE24_MINIMUM_MAJORS.get(repository)
                if minimum is None:
                    continue
                version = VERSION_COMMENT.search(line)
                if version is None or int(version.group(1)) < minimum:
                    incompatible.append(
                        f"{workflow.relative_to(ROOT)}:{line_number}: {line.strip()}"
                    )

        self.assertEqual(
            [],
            incompatible,
            "actions below the Node.js 24-compatible major:\n"
            + "\n".join(incompatible),
        )


if __name__ == "__main__":
    unittest.main()
