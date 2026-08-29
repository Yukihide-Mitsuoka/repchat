import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PUBLIC_ONLY = "if: github.event.repository.visibility == 'public'"


class PrivateRepositoryWorkflowTest(unittest.TestCase):
    def test_code_scanning_jobs_are_public_only(self) -> None:
        for path, job in (
            (".github/workflows/codeql.yml", "analyze"),
            (".github/workflows/scorecard.yml", "analysis"),
        ):
            with self.subTest(path=path):
                workflow = (ROOT / path).read_text(encoding="utf-8")
                job_body = workflow.split(f"  {job}:\n", maxsplit=1)[1]

                self.assertIn(f"    {PUBLIC_ONLY}\n", job_body)

    def test_only_the_plan_limited_release_step_is_public_only(self) -> None:
        workflow = (ROOT / ".github/workflows/release.yml").read_text(
            encoding="utf-8"
        )
        release_gates = (
            ROOT / "scripts/actions/release-gates/action.yml"
        ).read_text(encoding="utf-8")

        self.assertNotIn(PUBLIC_ONLY, workflow)
        self.assertIn(
            "if: github.event.repository.visibility == 'public' && "
            "hashFiles('dist/**') != ''",
            release_gates,
        )

    def test_portable_security_scans_remain_enabled_for_private_repositories(self) -> None:
        workflow = (ROOT / ".github/workflows/security.yml").read_text(
            encoding="utf-8"
        )

        self.assertNotIn("repository.visibility", workflow)


if __name__ == "__main__":
    unittest.main()
