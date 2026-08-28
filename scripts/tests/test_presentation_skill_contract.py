import json
import unittest
from pathlib import Path, PurePosixPath


REPOSITORY_ROOT = Path(__file__).parents[2]
SKILL = ".ai/contracts/foundation/skills/presentation/SKILL.md"
WRAPPER = ".claude/skills/presentation/SKILL.md"


def is_owned(path: str, roots: list[str]) -> bool:
    candidate = PurePosixPath(path)
    for root in roots:
        if root.endswith("/"):
            if candidate.is_relative_to(PurePosixPath(root.removesuffix("/"))):
                return True
        elif path == root:
            return True
    return False


class PresentationSkillContractTest(unittest.TestCase):
    def test_task_route_loads_the_presentation_skill_conditionally(self):
        route = (REPOSITORY_ROOT / ".ai/README.md").read_text(encoding="utf-8")

        self.assertIn(
            f"| Presentation or slide deck | documentation.md | `{SKILL}` |", route
        )
        self.assertNotIn(
            SKILL, route.split("## Reading protocol by task type", maxsplit=1)[0]
        )

    def test_skill_and_runtime_wrapper_use_existing_inherited_roots(self):
        export = json.loads(
            (REPOSITORY_ROOT / ".ai/contracts/foundation/inheritance-export.json").read_text(
                encoding="utf-8"
            )
        )

        self.assertTrue(is_owned(SKILL, export["inherited_paths"]))
        self.assertTrue(is_owned(WRAPPER, export["inherited_paths"]))
        self.assertNotIn(SKILL, export["inherited_paths"])
        self.assertNotIn(WRAPPER, export["inherited_paths"])

    def test_skill_stays_tool_neutral_and_requires_visual_verification(self):
        skill_path = REPOSITORY_ROOT / SKILL
        skill = skill_path.read_text(encoding="utf-8")
        normalized_skill = " ".join(skill.split())
        wrapper = (REPOSITORY_ROOT / WRAPPER).read_text(encoding="utf-8")

        self.assertEqual(
            ["SKILL.md"], sorted(path.name for path in skill_path.parent.iterdir())
        )
        for required_outcome in (
            "requested format",
            "Never invent a statistic",
            "Render every slide",
            "inspect the actual output",
            "State any unverified property",
        ):
            self.assertIn(required_outcome, normalized_skill)
        self.assertIn(SKILL, wrapper)
        self.assertLessEqual(len(wrapper.splitlines()), 12)


if __name__ == "__main__":
    unittest.main()
