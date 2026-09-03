import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PUBLIC_ONLY = "if: github.event.repository.visibility == 'public'"
WORKFLOW_ROOT = ROOT / ".github" / "workflows"
JOB_HEADER = re.compile(r"^  ([A-Za-z0-9_-]+):\s*(?:#.*)?$")
REPOSITORY_READ_STEP = re.compile(
    r"^\s{6,}-\s+uses:\s+['\"]?(?:actions/checkout@|\./)"
)


def _permissions(lines: list[str], indent: str) -> tuple[bool, str | None]:
    prefix = f"{indent}permissions:"
    child_prefix = f"{indent}  "
    for index, line in enumerate(lines):
        if not line.startswith(prefix):
            continue
        scalar = line.removeprefix(prefix).split("#", maxsplit=1)[0].strip()
        if scalar in {"read-all", "write-all"}:
            return True, "read" if scalar == "read-all" else "write"
        for child in lines[index + 1 :]:
            if not child.strip() or child.lstrip().startswith("#"):
                continue
            if not child.startswith(child_prefix):
                break
            stripped = child.removeprefix(child_prefix)
            if stripped.startswith("contents:"):
                value = stripped.removeprefix("contents:")
                return True, value.split("#", maxsplit=1)[0].strip()
        return True, None
    return False, None


def _workflow_jobs(workflow: str) -> tuple[list[str], list[tuple[str, list[str]]]]:
    lines = workflow.splitlines()
    jobs_index = lines.index("jobs:")
    starts = [
        (index, match.group(1))
        for index, line in enumerate(lines[jobs_index + 1 :], start=jobs_index + 1)
        if (match := JOB_HEADER.fullmatch(line))
    ]
    jobs = []
    for position, (start, name) in enumerate(starts):
        end = starts[position + 1][0] if position + 1 < len(starts) else len(lines)
        jobs.append((name, lines[start:end]))
    return lines[:jobs_index], jobs


class PrivateRepositoryWorkflowTest(unittest.TestCase):
    def test_repository_reading_jobs_have_effective_contents_access(self) -> None:
        failures = []
        for path in sorted(WORKFLOW_ROOT.glob("*.y*ml")):
            workflow = path.read_text(encoding="utf-8")
            workflow_lines, jobs = _workflow_jobs(workflow)
            _, workflow_contents = _permissions(workflow_lines, "")
            for job, job_lines in jobs:
                if not any(REPOSITORY_READ_STEP.match(line) for line in job_lines):
                    continue
                has_job_permissions, job_contents = _permissions(job_lines, "    ")
                effective = job_contents if has_job_permissions else workflow_contents
                if effective not in {"read", "write"}:
                    failures.append(
                        f"{path.relative_to(ROOT)}:{job} reads the repository "
                        f"with effective contents: {effective or 'none'}"
                    )

        self.assertEqual([], failures, "\n".join(failures))

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
