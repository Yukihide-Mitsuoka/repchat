import unittest
from pathlib import Path

from scripts import foundation_test_runner


ROOT = Path(__file__).parents[2]


class FoundationTestRunnerTest(unittest.TestCase):
    def test_fast_suite_excludes_only_declared_slow_modules(self):
        self.assertTrue(
            foundation_test_runner.belongs_to_suite(
                "test_setup_github_wrapper.SetupGitHubWrapperTest.test_dry_run",
                "fast",
            )
        )
        self.assertFalse(
            foundation_test_runner.belongs_to_suite(
                "test_template_inheritance_plan.TemplateInheritancePlanTest.test_plan",
                "fast",
            )
        )

    def test_slow_suite_contains_only_declared_slow_modules(self):
        self.assertFalse(
            foundation_test_runner.belongs_to_suite(
                "test_setup_github_wrapper.SetupGitHubWrapperTest.test_dry_run",
                "slow",
            )
        )
        self.assertTrue(
            foundation_test_runner.belongs_to_suite(
                "test_template_inheritance_plan.TemplateInheritancePlanTest.test_plan",
                "slow",
            )
        )

    def test_doctor_and_ci_keep_both_suites_wired(self):
        template_check = (ROOT / "scripts/template-check.sh").read_text(encoding="utf-8")
        selector = (ROOT / "scripts/run-foundation-tests.sh").read_text(
            encoding="utf-8"
        )
        makefile = (ROOT / "Makefile").read_text(encoding="utf-8")
        workflow = (ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8")

        self.assertIn("bash scripts/run-foundation-tests.sh", template_check)
        self.assertIn(
            "FOUNDATION_TEST_SUITE=fast bash scripts/template-check.sh",
            makefile,
        )
        self.assertIn('suite="${FOUNDATION_TEST_SUITE:-all}"', selector)
        self.assertIn('runner="scripts/foundation_test_runner.py"', selector)
        self.assertIn("doctor-slow:", makefile)
        self.assertIn("foundation_test_runner.py --suite slow", makefile)
        self.assertIn("doctor-slow:", workflow)
        self.assertIn("make doctor-slow", workflow)


if __name__ == "__main__":
    unittest.main()
