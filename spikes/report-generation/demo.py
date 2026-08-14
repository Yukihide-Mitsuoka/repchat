#!/usr/bin/env python3
"""Prepare and run the paid report-generation demo from a fresh checkout."""

from __future__ import annotations

import argparse
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
WORK_DIR = HERE / "out" / ".demo"
EVIDENCE_DIR = WORK_DIR / "evidence-app"
VENV_DIR = WORK_DIR / "venv"
TEMPLATE_REPO = "https://github.com/evidence-dev/template.git"
# Pin the scaffold as well as npm/Python packages. Moving `main` would make the
# same command produce a different demo without a repository diff (GR-042).
TEMPLATE_COMMIT = "4b13d42e157bf0a5218ba8927912abe3f8f1c248"
REPORT_URL = "http://localhost:3000/"
EVIDENCE_PACKAGE = {
    "name": "my-evidence-project",
    "version": "0.0.1",
    "scripts": {
        "build": "evidence build",
        "dev": "evidence dev --open /",
        "preview": "evidence preview",
        "sources": "evidence sources",
    },
    "engines": {"npm": ">=7.0.0", "node": ">=18.0.0"},
    "type": "module",
    "dependencies": {
        "@evidence-dev/bigquery": "2.0.12",
        "@evidence-dev/core-components": "5.4.2",
        "@evidence-dev/evidence": "40.1.8",
    },
    "devDependencies": {"typescript": "5.4.2"},
    "overrides": {
        "axios": "1.17.1",
        "jsonwebtoken": "9.0.2",
        "trim@<0.0.3": ">0.0.3",
        "uuid": "11.1.1",
        # Evidence SDK publishes a vulnerable Vitest UI as a transitive dev
        # dependency. The demo never runs it, but SEC-030 still requires a
        # non-vulnerable version in the installed graph.
        "vitest": "3.2.6",
    },
}
EVIDENCE_CONFIG = """\
plugins:
  components:
    "@evidence-dev/core-components": {}
  datasources:
    "@evidence-dev/bigquery": {}
"""


class DemoError(RuntimeError):
    """An actionable demo setup failure safe to show to the operator."""


def run(command: list[str], *, cwd: Path | None = None, env: dict[str, str] | None = None) -> None:
    print(f"+ {shlex.join(command)}", flush=True)
    try:
        subprocess.run(command, cwd=cwd, env=env, check=True)
    except subprocess.CalledProcessError as error:
        raise DemoError(f"command failed with exit {error.returncode}: {command[0]}") from error


def capture(command: list[str], *, cwd: Path | None = None) -> str:
    try:
        result = subprocess.run(command, cwd=cwd, check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError:
        return ""
    return result.stdout.strip()


def require_tools() -> None:
    if sys.version_info < (3, 13):
        raise DemoError("Python 3.13 or newer is required")
    for tool in ("git", "node", "npm", "gcloud"):
        if shutil.which(tool) is None:
            raise DemoError(f"required command is not installed: {tool}")
    version = capture(["node", "--version"])
    match = re.fullmatch(r"v(\d+)(?:\.\d+){2}", version)
    if match is None or int(match.group(1)) < 18:
        raise DemoError(f"Node 18 or newer is required; found {version or 'unknown'}")


def require_adc() -> None:
    if not capture(["gcloud", "auth", "application-default", "print-access-token"]):
        raise DemoError(
            "Application Default Credentials are unavailable; "
            "run: gcloud auth application-default login"
        )


def confirm_paid_run(accepted: bool) -> None:
    print("This demo calls real Vertex AI (about ¥2) and BigQuery (capped at 20 GiB).")
    if accepted:
        return
    if not sys.stdin.isatty():
        raise DemoError("paid run not confirmed; pass --accept-cost or set ACCEPT_COST=yes")
    answer = input("Continue with the paid run? [y/N] ").strip().lower()
    if answer not in {"y", "yes"}:
        raise DemoError("paid run cancelled")


def venv_python() -> Path:
    return VENV_DIR / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def prepare_python() -> Path:
    python = venv_python()
    if not python.exists():
        WORK_DIR.mkdir(parents=True, exist_ok=True)
        run([sys.executable, "-m", "venv", str(VENV_DIR)])
    run(
        [
            str(python),
            "-m",
            "pip",
            "install",
            "--disable-pip-version-check",
            "--no-input",
            "--requirement",
            str(HERE / "requirements.txt"),
        ]
    )
    return python


def prepare_evidence() -> None:
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    if EVIDENCE_DIR.is_symlink():
        raise DemoError(f"refusing to use symlink as Evidence workspace: {EVIDENCE_DIR}")
    if EVIDENCE_DIR.exists() and not (EVIDENCE_DIR / ".git").is_dir():
        raise DemoError(f"refusing to replace non-git directory: {EVIDENCE_DIR}")
    if not EVIDENCE_DIR.exists():
        run(["git", "init", str(EVIDENCE_DIR)])
        run(["git", "-C", str(EVIDENCE_DIR), "remote", "add", "origin", TEMPLATE_REPO])
    if capture(["git", "rev-parse", "HEAD"], cwd=EVIDENCE_DIR) != TEMPLATE_COMMIT:
        run(["git", "fetch", "--depth", "1", "origin", TEMPLATE_COMMIT], cwd=EVIDENCE_DIR)
        run(["git", "checkout", "--detach", "--force", "FETCH_HEAD"], cwd=EVIDENCE_DIR)
    # The official template includes every connector and an old lockfile. Keep
    # its scaffold, but install only this demo's pinned Evidence/BigQuery graph.
    (EVIDENCE_DIR / "package.json").write_text(
        json.dumps(EVIDENCE_PACKAGE, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (EVIDENCE_DIR / "evidence.config.yaml").write_text(EVIDENCE_CONFIG, encoding="utf-8")
    shutil.copy2(HERE / "evidence-package-lock.json", EVIDENCE_DIR / "package-lock.json")
    run(["npm", "ci", "--no-audit", "--no-fund"], cwd=EVIDENCE_DIR)
    # Fail a fresh demo if a newly disclosed critical advisory reaches the
    # pinned graph. High advisories and local-only mitigations are documented.
    run(["npm", "audit", "--audit-level=critical"], cwd=EVIDENCE_DIR)


def generate_report(python: Path, project: str) -> None:
    env = os.environ.copy()
    env["GOOGLE_CLOUD_PROJECT"] = project
    command = [str(python), str(HERE / "run_report.py"), "--project", project]
    run(command, env=env)


def install_generated_report() -> None:
    generated_sources = HERE / "out" / "sources"
    generated_page = HERE / "out" / "pages" / "monthly_report.md"
    if not generated_sources.is_dir() or not generated_page.is_file():
        raise DemoError("report output is incomplete; run_report.py did not finish")

    target_sources = EVIDENCE_DIR / "sources"
    if target_sources.is_symlink():
        raise DemoError(f"refusing to replace symlink: {target_sources}")
    if target_sources.exists():
        shutil.rmtree(target_sources)
    shutil.copytree(generated_sources, target_sources)
    # The pinned template opens `/`; make that route the report so the browser
    # lands on the demo rather than requiring a second navigation step.
    shutil.copy2(generated_page, EVIDENCE_DIR / "pages" / "index.md")


def planned_steps(project: str) -> None:
    print(f"project: {project}")
    print(f"Evidence template: {TEMPLATE_COMMIT}")
    for step in (
        "create isolated Python venv and install pinned dependencies",
        "fetch the pinned Evidence scaffold and install the minimal audited lockfile",
        "generate and verify the report with Vertex AI + BigQuery",
        "materialize Evidence sources and build the site",
        f"open {REPORT_URL}",
    ):
        print(f"- {step}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", default=os.environ.get("GOOGLE_CLOUD_PROJECT"))
    parser.add_argument("--accept-cost", action="store_true")
    parser.add_argument("--build-only", action="store_true", help="build but do not start the server")
    parser.add_argument("--dry-run", action="store_true", help="show the paid workflow without changing files")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    project = (args.project or "").strip()
    if not project:
        print("error: --project or GOOGLE_CLOUD_PROJECT is required", file=sys.stderr)
        return 2
    try:
        if args.dry_run:
            planned_steps(project)
            return 0
        confirm_paid_run(args.accept_cost)
        require_tools()
        require_adc()
        python = prepare_python()
        prepare_evidence()
        generate_report(python, project)
        install_generated_report()
        run(["npm", "run", "sources"], cwd=EVIDENCE_DIR)
        run(["npm", "run", "build"], cwd=EVIDENCE_DIR)
        if args.build_only:
            print(f"demo built: {EVIDENCE_DIR / 'build'}")
            return 0
        print(f"opening report at {REPORT_URL}")
        # The development server exposes every local page query and result.
        # Production preview keeps the presentation focused on the dashboard.
        run(["npm", "run", "preview"], cwd=EVIDENCE_DIR)
        return 0
    except DemoError as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("\ndemo stopped")
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
