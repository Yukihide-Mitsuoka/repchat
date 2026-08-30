"""Data-source context and metric definitions supplied to the SQL agent."""

import json
from pathlib import Path


# Hand-transcribed from the public sample. Deliberately the raw export shape:
# no semantic layer, no pre-aggregation. That is the point of the measurement.
SCHEMA_DDL = """
-- dataset: bigquery-public-data.ga4_obfuscated_sample_ecommerce (BigQuery, US)
-- 日次シャード。テーブルは events_YYYYMMDD、ワイルドカードは `events_*` で
-- _TABLE_SUFFIX に 'YYYYMMDD' 文字列が入る。
CREATE TABLE events_* (
  event_date STRING,          -- 'YYYYMMDD' 形式の文字列。DATE型ではない
  event_timestamp INT64,      -- マイクロ秒
  event_name STRING,          -- 'page_view' | 'session_start' | 'purchase' | 'add_to_cart' | 'view_item' 等
  event_params ARRAY<STRUCT<
    key STRING,
    value STRUCT<string_value STRING, int_value INT64,
                 float_value FLOAT64, double_value FLOAT64>
  >>,                         -- key に 'ga_session_id'(int_value), 'page_location'(string_value),
                              -- 'page_title'(string_value), 'engagement_time_msec'(int_value) 等
  user_pseudo_id STRING,      -- ブラウザ単位の識別子。ユーザー数はこれを数える
  user_id STRING,             -- ログインID。このデータセットではほぼNULL
  device STRUCT<category STRING, mobile_brand_name STRING, operating_system STRING,
                web_info STRUCT<browser STRING>>,
  geo STRUCT<continent STRING, country STRING, region STRING, city STRING>,
  traffic_source STRUCT<name STRING, medium STRING, source STRING>,
  ecommerce STRUCT<total_item_quantity INT64, purchase_revenue_in_usd FLOAT64,
                   purchase_revenue FLOAT64, transaction_id STRING>,
                              -- purchase_revenue は event_name='purchase' の行にのみ入る
  items ARRAY<STRUCT<item_id STRING, item_name STRING, price FLOAT64,
                     quantity INT64, item_revenue FLOAT64>>
);
"""


def metrics_block(path: Path) -> str:
    """Render the metric definitions for the prompt, or '' when running without.

    LOG-0065 measured the model writing correct SQL but choosing a different
    reading of 「購入件数」 between runs at temperature 0. This block is the
    intervention being tested: does declaring the definition make the answer
    reproducible? In production the agency maintains these definitions in our
    shared definition layer; generated pages and source definitions go to the
    customer's Git (ADR-0014).
    """
    if not path.exists():
        return ""
    m = json.loads(path.read_text(encoding="utf-8"))
    lines = ["", "指標定義（この定義に従うこと。ここに定義がある語は、自分で解釈し直さない）:"]
    for name, g in m["grain"].items():
        lines.append(f"- 粒度 {{{name}}} = {g['expr']}")
    # LOG-0070: without aliases the model refused 「新規訪問」 because the
    # definition is named 「新規セッション」 — it matched strings, not meaning.
    def alias(spec):
        a = spec.get("aliases")
        return f"  [同義: {'、'.join(a)}]" if a else ""

    for name, spec in m["metrics"].items():
        extra = f"  ※{spec['note']}" if spec.get("note") else ""
        flt = f"  [対象行: {spec['filter']}]" if spec.get("filter") else ""
        lines.append(f"- 指標「{name}」 = {spec['expr']}{flt}{alias(spec)}{extra}")
    for name, spec in m["dimensions"].items():
        flt = f"  [対象行: {spec['filter']}]" if spec.get("filter") else ""
        lines.append(f"- 軸「{name}」 = {spec['expr']}{flt}{alias(spec)}")
    return "\n".join(lines).replace("\t", "    ")


def prompt_rules(metrics: str) -> str:
    return f"""あなたは BigQuery 標準SQLでレポート用のクエリを書く。

{SCHEMA_DDL}
{metrics}

規則:
- テーブル参照は必ず `bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*` と完全修飾する。
- 期間の絞り込みは必ず `_TABLE_SUFFIX BETWEEN '<from>' AND '<to>'` で行う（スキャン量を抑えるため）。
- GA4 の生エクスポートには「セッション」という行は存在しない。
- **列の別名は ASCII の snake_case にする**（`sessions`, `repeat_user_pct` など）。
  BigQuery のフィールド名には日本語や記号（全角括弧など）を使えない。
- **指定された列名は「表示名」であって、SQLの識別子ではない。** 表示名はレポートを組み立てる
  側が付けるので、SQLには**指定された順序**だけを守ればよい。
- **`SELECT *` は使わず、レポートに必要な列だけを明示する。** BigQueryは列指向なので、
  不要な列の読み取りを避け、生成結果の契約を列名で固定する。
- SELECT 文のみ。DDL/DML は書かない。
- **指標定義に無い語を求められたら、推測でSQLを書かない。** `sql` を空文字にし、
  `undefined_terms` にその語を入れて返す（ADR-0013 C5）。**別の指標の式を流用して代用しない。**
  読み手には、定義済みの数字と推測された数字の区別がつかないため。
- `undefined_terms` が空でない場合は、`clarification_question` に、利用者が回答すれば対象を
  確定できる確認質問を日本語1文で返す。対象URL、ページ一覧、イベント名、計算式など、
  不足している条件を具体的に尋ね、推奨値や暗黙の既定値は入れない。
- `undefined_terms` が空の場合は `clarification_question` を空文字にする。
- ただし判定は**字面ではなく意味**で行う。**同義として挙げられた語は、その指標を指している。**
- **定義済みの指標を、上のテーブルの列で絞り込む・分割するのは「代用」ではない**（例:
  「商品を見たセッション数」は、セッション数を `event_name = 'view_item'` で絞ったもの）。
  指標の定義式そのものを変えなければ、合成してよい。
- 定義がある語だけで答えられる場合は `undefined_terms` を空配列にする。
- `event_params` の値は、その `events_*` を直接読む最初のCTEでスカラー列として抽出する。
  後続CTEやJOINから外側のテーブルを参照する相関サブクエリを作らない。BigQueryが相関を
  de-correlateできない構造になる場合は、先に `UNNEST` して必要なキーを抽出したCTEへ変換する。
- URLやページパスを抽出するときは、BigQuery Standard SQLに存在しない `NET.PARSE_URL` を使わない。
  `page_location` の文字列から必要なパスを取り出す場合は、`REGEXP_EXTRACT` などBigQueryで
  実行可能な標準関数を使い、scheme・host・query・fragmentを分析仕様に従って扱う。未対応の
  方言関数を別の固定SQLへ置換するのではなく、同じ出力契約を保つSQLとして生成する。
- 結果は JSON で {{"sql": "...", "reason": "...", "undefined_terms": [...],
  "clarification_question": "..."}} の形で返す。
  reason は日本語1文。
"""
