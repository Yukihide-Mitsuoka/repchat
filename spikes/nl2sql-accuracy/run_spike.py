"""NL→SQL accuracy spike runner.

Modes:
  python3 run_spike.py --project PID            # Gemini via Vertex (default provider), ADC auth
  python3 run_spike.py --project PID --provider anthropic  # Opus 4.8 fallback via Vertex
  python3 run_spike.py --answers FILE.json      # offline: evaluate pre-generated answers (pilot)

Provider policy (per product decision 2026-07-16): default to the cheap
Gemini Flash model; only fall back to Opus 4.8 when accuracy cannot be
recovered by prompt/request changes. Auth is GCP ADC for both.

Safety: generated SQL is executed against a read-only SQLite connection and
must be a single SELECT/WITH statement containing the tenant filter.
"""

from __future__ import annotations

import argparse
import datetime
import json
import re
import sqlite3
import sys
from pathlib import Path

import expected as expected_mod
import seed

HERE = Path(__file__).parent
TENANT = "t_alpha"

# USD per 1M tokens (input, output).
# Claude: platform.claude.com pricing, 2026-07.
# Gemini: rough public Flash-tier estimate — MARKED ESTIMATE, confirm on GCP billing.
PRICING = {
    "claude-opus-4-8": (5.00, 25.00),
    "claude-sonnet-5": (3.00, 15.00),
    "claude-haiku-4-5": (1.00, 5.00),
    "gemini-3.5-flash": (0.30, 2.50),   # ESTIMATE — verify
    "gemini-2.5-flash": (0.30, 2.50),   # ESTIMATE — verify
    "gemini-flash-latest": (0.30, 2.50),  # ESTIMATE — verify
}
PRICE_ESTIMATE = {"gemini-3.5-flash", "gemini-2.5-flash", "gemini-flash-latest"}
USD_JPY = 155.0  # rough conversion for the report; update as needed

PROMPT_RULES = f"""あなたはBIシステムのSQL生成アシスタントです。ユーザーの質問をSQLite用のSQLに変換します。

# スキーマ
{(HERE / "schema.sql").read_text()}

# コンテキスト
- 現在のテナント: {TENANT}(他テナントのデータ参照は禁止)
- 今日の日付: 2026-07-16

# ビジネスルール(必ず従うこと)
- 「売上」= order_items の quantity * unit_price の合計。対象は orders.status = 'confirmed' のみ。期間の判定は confirmed_at(確定日時)基準。
- 「注文件数」= orders の件数。ordered_at(受注日時)基準。status が 'cancelled' のものは除く。
- 「直近30日間」= 今日を含む過去30日(2026-06-17 〜 2026-07-16)。
- 「上半期」= 1月〜6月。「Q2」= 4月〜6月。
- 「前月比」= (当月売上 - 前月売上) / 前月売上 * 100。
- 生成する全てのSQLに WHERE tenant_id = '{TENANT}' を必ず含めること(JOINする各テーブルにも)。
- 全テナント・他テナントのデータを求められたら拒否すること。
- 質問が曖昧でSQLを一意に決められない場合は、推測せずに確認質問を返すこと。

# 出力形式(JSONのみを出力)
SQLを生成する場合:      {{"action": "sql", "sql": "SELECT ..."}}
確認質問を返す場合:      {{"action": "clarify", "question": "..."}}
拒否する場合:            {{"action": "refuse", "reason": "..."}}
"""


def build_db() -> Path:
    db = HERE / "spike.db"
    if not db.exists():
        seed.write_db(db)
    return db


def exec_sql(db: Path, sql: str):
    """Execute read-only; returns (rows, error)."""
    s = sql.strip().rstrip(";")
    if not re.match(r"^(select|with)\b", s, re.I):
        return None, "rejected: not a SELECT"
    if f"'{TENANT}'" not in s and f'"{TENANT}"' not in s:
        return None, "rejected: missing tenant filter"
    lowered = re.sub(r"'[^']*'", "", s).lower()
    for t in ("t_bravo", "t_charlie"):
        if t in sql and t != TENANT:
            return None, f"rejected: references other tenant {t}"
    if re.search(r"\b(insert|update|delete|drop|alter|attach|pragma)\b", lowered):
        return None, "rejected: forbidden keyword"
    try:
        conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        rows = conn.execute(s).fetchall()
        conn.close()
        return rows, None
    except sqlite3.Error as e:
        return None, f"sqlite error: {e}"


def _norm_cell(c):
    if isinstance(c, float):
        return round(c, 1)
    return c


def compare(kind: str, got_rows, want):
    got = [tuple(_norm_cell(c) for c in r) for r in got_rows]
    if kind == "scalar":
        if len(got) == 1 and len(got[0]) == 1:
            return got[0][0] == want, f"got={got[0][0]} want={want}"
        return False, f"expected 1x1 result, got {got[:3]}"
    if kind == "scalar_pct":
        if len(got) == 1 and len(got[0]) == 1 and isinstance(got[0][0], (int, float)):
            ok = abs(float(got[0][0]) - float(want)) <= 0.05
            return ok, f"got={got[0][0]} want={want}"
        return False, f"expected 1x1 numeric, got {got[:3]}"
    want_n = [tuple(_norm_cell(c) for c in r) for r in want]
    if kind == "rows_ordered":
        return got == want_n, f"got={got[:4]}... want={want_n[:4]}..."
    if kind == "rows_ordered_ties":  # order must match on the value column; ties lenient
        ok = (sorted(got) == sorted(want_n)
              and [r[1] for r in got] == [r[1] for r in want_n])
        return ok, f"got={got} want={want_n}"
    raise ValueError(kind)


DEFAULT_MODEL = {"gemini": "gemini-3.5-flash", "anthropic": "claude-opus-4-8"}

_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "action": {"type": "string", "enum": ["sql", "clarify", "refuse"]},
        "sql": {"type": "string"},
        "question": {"type": "string"},
        "reason": {"type": "string"},
    },
    "required": ["action"],
}


def make_client(args):
    """Return a (provider, client) pair. Both authenticate via GCP ADC on Vertex."""
    if args.provider == "gemini":
        from google import genai
        return "gemini", genai.Client(vertexai=True, project=args.project,
                                      location=args.region)
    from anthropic import AnthropicVertex
    return "anthropic", AnthropicVertex(project_id=args.project, region=args.region)


def _generate_gemini(client, question: str, model: str):
    from google.genai import types
    resp = client.models.generate_content(
        model=model,
        contents=question,
        config=types.GenerateContentConfig(
            system_instruction=PROMPT_RULES,
            response_mime_type="application/json",
            response_schema={**_JSON_SCHEMA, "propertyOrdering": ["action", "sql", "question", "reason"]},
            temperature=0,
        ),
    )
    um = resp.usage_metadata
    return json.loads(resp.text), {
        "input_tokens": um.prompt_token_count or 0,
        "output_tokens": um.candidates_token_count or 0,
        "cache_read": getattr(um, "cached_content_token_count", 0) or 0,
        "cache_write": 0,
    }


def _generate_anthropic(client, question: str, model: str):
    resp = client.messages.create(
        model=model,
        max_tokens=2048,
        thinking={"type": "adaptive"},
        system=[{"type": "text", "text": PROMPT_RULES,
                 "cache_control": {"type": "ephemeral"}}],
        messages=[{"role": "user", "content": question}],
        output_config={"format": {"type": "json_schema",
                                  "schema": {**_JSON_SCHEMA, "additionalProperties": False}}},
    )
    text = next(b.text for b in resp.content if b.type == "text")
    u = resp.usage
    return json.loads(text), {
        "input_tokens": u.input_tokens, "output_tokens": u.output_tokens,
        "cache_read": u.cache_read_input_tokens, "cache_write": u.cache_creation_input_tokens,
    }


def generate_via_api(provider, client, question: str, model: str):
    if provider == "gemini":
        return _generate_gemini(client, question, model)
    return _generate_anthropic(client, question, model)


def cost_jpy(model: str, u: dict) -> float:
    pin, pout = PRICING[model]
    usd = (u["input_tokens"] * pin + u["cache_write"] * pin * 1.25
           + u["cache_read"] * pin * 0.1 + u["output_tokens"] * pout) / 1e6
    return usd * USD_JPY


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--answers", help="offline: JSON file {qid: answer_obj}")
    ap.add_argument("--provider", choices=["gemini", "anthropic"], default="gemini",
                    help="gemini (default, cheap) | anthropic (Opus 4.8 fallback)")
    ap.add_argument("--model", help="override model id (default per provider)")
    ap.add_argument("--project", help="GCP project_id (required for API modes)")
    ap.add_argument("--region", default="global", help="Vertex region (default: global)")
    args = ap.parse_args()
    model = args.model or DEFAULT_MODEL[args.provider]

    db = build_db()
    spec = json.loads((HERE / "questions.json").read_text())
    offline = json.loads(Path(args.answers).read_text()) if args.answers else None
    provider, client = (None, None) if offline is not None else make_client(args)

    results, total_cost = [], 0.0
    for q in spec["questions"]:
        if offline is not None:
            ans, usage = offline.get(q["id"]), None
            if ans is None:
                results.append((q, "SKIP", "no answer provided", None))
                continue
        else:
            try:
                ans, usage = generate_via_api(provider, client, q["text"], model)
            except Exception as e:  # record and continue
                results.append((q, "ERROR", f"api error: {e}", None))
                continue
            total_cost += cost_jpy(model, usage)

        action = ans.get("action")
        if q["expect"] in ("clarify", "refuse"):
            ok = action in ("clarify", "refuse")
            detail = f"action={action}"
            results.append((q, "PASS" if ok else "FAIL", detail, usage))
            continue

        if action != "sql":
            results.append((q, "FAIL", f"expected sql, got action={action}", usage))
            continue

        rows, err = exec_sql(db, ans["sql"])
        if err:
            results.append((q, "FAIL", err, usage))
            continue
        want = getattr(expected_mod, q["expected_fn"])()
        ok, detail = compare(q["compare"], rows, want)
        results.append((q, "PASS" if ok else "FAIL", detail, usage))

    # report
    n = len([r for r in results if r[1] != "SKIP"])
    passed = len([r for r in results if r[1] == "PASS"])
    stamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    mode = "offline/pilot" if offline is not None else f"{provider} ({model})"
    lines = [f"# NL→SQL spike run — {stamp} — mode: {mode}", "",
             f"**{passed}/{n} PASS**", "",
             "| Q | category | verdict | detail |", "|---|---|---|---|"]
    for q, verdict, detail, usage in results:
        d = detail.replace("|", "\\|")[:160]
        lines.append(f"| {q['id']} | {q['category']} | {verdict} | {d} |")
    if offline is None:
        est = " — ⚠️ Gemini price is an ESTIMATE, confirm on GCP billing" \
            if model in PRICE_ESTIMATE else ""
        per_q = total_cost / n if n else 0
        lines += ["", f"**Total measured cost: ~¥{total_cost:.4f}** "
                      f"(~¥{per_q:.4f}/question @{USD_JPY} JPY/USD){est}"]
    report = "\n".join(lines) + "\n"
    out = HERE / "results" / f"run-{datetime.datetime.now():%Y%m%d-%H%M%S}.md"
    out.parent.mkdir(exist_ok=True)
    out.write_text(report)
    print(report)
    print(f"written: {out}")
    return 0 if passed == n else 1


if __name__ == "__main__":
    sys.exit(main())
