#!/usr/bin/env python3
"""Serve ONE built Evidence shell to two tenants, with different data each.

LOG-0025 proved this on a hand-written page. LOG-0075 confirmed a generated
page carries the same seam — `all-queries.json` maps <query>_data to a hash and
`api/prerendered_queries/<hash>.arrow` holds what the page shows on first
render. This script closes the gap by actually doing the swap, which is
ADR-0005's ② result cache expressed at Evidence's own boundary.

The tenant boundary here is a predicate on device.category, standing in for the
tenant/row-scope predicate the executor injects in production. What is being
measured is the SERVING mechanism, not the binder — the binder already has its
own proof (LOG-0042).

Two ports rather than a cookie, matching how LOG-0025 did it: whichever port
you load decides which tenant's data the identical shell receives.

    python3 tenant_serve.py --build <path-to-evidence-build> --project <gcp>
"""
import argparse
import glob
import http.server
import json
import os
import socketserver
import sys
import threading
from pathlib import Path

TABLE = "`bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*`"
PERIOD = "_TABLE_SUFFIX BETWEEN '20210101' AND '20210131'"
SESSION = (
    "CONCAT(user_pseudo_id, '-', CAST((SELECT value.int_value FROM UNNEST(event_params) "
    "WHERE key = 'ga_session_id') AS STRING))"
)
# Hand-written on purpose: the point is the swap, so the queries stay obvious.
TENANTS = {
    "desktop": "device.category = 'desktop'",
    "mobile": "device.category = 'mobile'",
}
QUERIES = {
    "r1": f"SELECT COUNT(DISTINCT {SESSION}) AS sessions FROM {TABLE} WHERE {PERIOD} AND {{scope}}",
    "r3": f"SELECT COUNT(*) AS pageviews FROM {TABLE} WHERE {PERIOD} AND event_name = 'page_view' AND {{scope}}",
}


def query_map(build: Path) -> dict:
    for p in glob.glob(str(build / "api" / "*" / "*" / "all-queries.json")):
        d = json.loads(Path(p).read_text())
        if "r1_data" in d:
            return d
    raise SystemExit("all-queries.json for the generated page not found — build it first")


def write_arrow(path: Path, column: str, value: float) -> None:
    import pyarrow as pa
    import pyarrow.ipc as ipc

    # float64 to match what the build produced; LOG-0075 found the pipeline
    # widens integers to DOUBLE before the page ever sees them.
    table = pa.table({column: pa.array([value], type=pa.float64())})
    with path.open("wb") as fh, ipc.new_stream(fh, table.schema) as w:
        w.write_table(table)


def build_tenant_data(build: Path, project: str, out: Path) -> dict:
    from google.cloud import bigquery

    bq = bigquery.Client(project=project)
    qmap = query_map(build)
    served = {}
    for tenant, scope in TENANTS.items():
        (out / tenant).mkdir(parents=True, exist_ok=True)
        for qid, sql in QUERIES.items():
            rows = list(bq.query(sql.format(scope=scope)).result(timeout=180))
            col = list(rows[0].keys())[0]
            value = float(rows[0][col])
            target = out / tenant / f"{qmap[f'{qid}_data']}.arrow"
            write_arrow(target, col, value)
            served.setdefault(tenant, {})[qid] = value
            print(f"  {tenant:8} {qid}: {col}={value:,.0f}  -> {target.name}", flush=True)
    return served


def serve(build: Path, overrides: Path, port: int, tenant: str) -> None:
    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=str(build), **kw)

        def translate_path(self, path):
            # The only per-tenant thing: prerendered results. Everything else —
            # HTML, JS, the shell itself — is byte-identical for both tenants.
            name = path.split("?")[0].split("/")[-1]
            cand = overrides / tenant / name
            if "/api/prerendered_queries/" in path and cand.exists():
                return str(cand)
            return super().translate_path(path)

        def log_message(self, *a):  # quiet
            pass

    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", port), Handler) as httpd:
        print(f"  tenant={tenant:8} http://localhost:{port}/monthly_report", flush=True)
        httpd.serve_forever()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--build", required=True, type=Path)
    ap.add_argument("--project", default=os.environ.get("GOOGLE_CLOUD_PROJECT"))
    ap.add_argument("--ports", default="8801,8802")
    ap.add_argument("--no-serve", action="store_true", help="データだけ作って終了")
    args = ap.parse_args()
    if not args.project:
        print("--project or GOOGLE_CLOUD_PROJECT is required", file=sys.stderr)
        return 2

    out = args.build.parent / "tenant-data"
    print("building tenant-scoped results:")
    served = build_tenant_data(args.build, args.project, out)
    if served["desktop"] == served["mobile"]:
        print("両テナントの値が同じ — 境界が効いていない", file=sys.stderr)
        return 1
    if args.no_serve:
        return 0

    ports = [int(p) for p in args.ports.split(",")]
    print("serving one shell, two tenants:")
    for port, tenant in zip(ports, TENANTS):
        threading.Thread(target=serve, args=(args.build, out, port, tenant), daemon=True).start()
    threading.Event().wait()
    return 0


if __name__ == "__main__":
    sys.exit(main())
