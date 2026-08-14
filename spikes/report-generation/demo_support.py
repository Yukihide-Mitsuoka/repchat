"""Environment helpers shared by the AI-planned localhost demo."""

from __future__ import annotations

import os
import shlex
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
WORK_DIR = HERE / "out" / ".demo"
VENV_DIR = WORK_DIR / "venv"


class DemoError(RuntimeError):
    """An actionable demo setup failure safe to show to the operator."""


def run(command: list[str], *, cwd: Path | None = None) -> None:
    print(f"+ {shlex.join(command)}", flush=True)
    try:
        subprocess.run(command, cwd=cwd, check=True)
    except subprocess.CalledProcessError as error:
        raise DemoError(
            f"command failed with exit {error.returncode}: {command[0]}"
        ) from error


def capture(command: list[str]) -> str:
    try:
        result = subprocess.run(command, check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError:
        return ""
    return result.stdout.strip()


def require_adc() -> None:
    if not capture(["gcloud", "auth", "application-default", "print-access-token"]):
        raise DemoError(
            "Application Default Credentials are unavailable; "
            "run: gcloud auth application-default login"
        )


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
