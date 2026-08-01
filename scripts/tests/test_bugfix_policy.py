import unittest
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).parents[2]
BUGFIX_SKILL = REPOSITORY_ROOT / ".skills" / "bugfix.skill.md"
JAPANESE_GUIDE = (
    REPOSITORY_ROOT / "docs" / "foundation" / "guides" / "ai-instruction-files.ja.md"
)


class BugfixPolicyTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.skill = " ".join(BUGFIX_SKILL.read_text(encoding="utf-8").split())

    def test_durable_fix_and_scoped_idempotence_are_the_default(self):
        for contract in (
            "Durable root-cause correction is the default",
            "smallest complete correction",
            "retried, resumed, replayed, or scheduled",
            "partial failure",
            "idempotent",
            "If idempotence is not applicable, state why",
        ):
            with self.subTest(contract=contract):
                self.assertIn(contract, self.skill)

    def test_temporary_mitigation_requires_explicit_human_direction(self):
        for contract in (
            "only when a human explicitly requests a temporary mitigation",
            "MUST NOT be reported as resolved",
            "permanent-fix issue",
            "rollback and removal conditions",
            "Guardrails, security controls, regression tests, and review remain mandatory",
        ):
            with self.subTest(contract=contract):
                self.assertIn(contract, self.skill)

    def test_japanese_guide_names_the_default_and_exception(self):
        guide = JAPANESE_GUIDE.read_text(encoding="utf-8")

        self.assertIn("堅牢・冪等な恒久修正", guide)
        self.assertIn("明示指示時のみ期限付き応急処置", guide)


if __name__ == "__main__":
    unittest.main()
