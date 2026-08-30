"""Safe publication of generated Evidence pages and SQL sources."""

from __future__ import annotations

from pathlib import Path
from typing import Callable


def write_outputs(
    out_dir: Path,
    spec: dict,
    results: list,
    project: str,
    *,
    source: str,
    render_page: Callable[[dict, list], str],
) -> Path:
    """Replace generated Evidence sources and page without retaining stale SQL."""
    pages_dir = out_dir / "pages"
    sources_dir = out_dir / "sources"
    src_dir = sources_dir / source
    out_path = pages_dir / "monthly_report.md"
    connection_path = src_dir / "connection.yaml"
    for path in (out_dir, pages_dir, sources_dir, src_dir, out_path, connection_path):
        if path.is_symlink():
            raise ValueError(f"refusing symlink in generated output path: {path}")

    pages_dir.mkdir(parents=True, exist_ok=True)
    src_dir.mkdir(parents=True, exist_ok=True)
    for previous_sql in src_dir.glob("*.sql"):
        previous_sql.unlink()

    out_path.write_text(render_page(spec, results), encoding="utf-8")
    # One .sql per answered section. Refused sections get no source file, so a
    # missing definition cannot silently become an empty chart.
    for result in results:
        if result["sql"]:
            (src_dir / f"{result['id'].lower()}.sql").write_text(
                result["sql"].strip() + "\n", encoding="utf-8"
            )
    connection_path.write_text(
        f"name: {source}\ntype: bigquery\noptions:\n"
        f"  project_id: {project}\n  authenticator: gcloud-cli\n",
        encoding="utf-8",
    )
    return out_path
