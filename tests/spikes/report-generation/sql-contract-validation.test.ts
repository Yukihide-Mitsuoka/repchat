import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MODULE_DIR = path.join(ROOT, 'spikes/report-generation');
const BAR = {
  title: '集計',
  planned_visualization: 'bar',
  source_columns: ['category', 'metric_value'],
  nonnull_metric_columns: ['metric_value'],
  max_result_rows: 20,
};

function python(body: string, input: unknown) {
  const result = spawnSync(
    'python3',
    [
      '-c',
      `import json,sys\nsys.path.insert(0,${JSON.stringify(MODULE_DIR)})\nimport sql_contract_validation as contracts\n${body}`,
    ],
    { cwd: ROOT, input: JSON.stringify(input), encoding: 'utf8', timeout: 10_000 },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function checkSql(section: Record<string, unknown>, sqls: string[]) {
  return python(
    `
import copy
payload=json.load(sys.stdin)
section=payload["section"]
before=copy.deepcopy(section)
results=[]
for sql in payload["sqls"]:
 try:
  result=contracts.validate_generated_dashboard_sql(section,sql)
  assert result is None
  results.append(None)
 except contracts.SQLContractError as error:
  results.append(str(error))
 assert section==before
print(json.dumps(results,ensure_ascii=False))
`,
    { section, sqls },
  ) as (string | null)[];
}

const aliasError = (observed: string) =>
  `集計のSQL出力列（${observed}）は、barに必要な2列の一意なASCII別名を満たさないためBigQueryへ送信しません。`;
const nullError = (columns = 'metric_value') =>
  `集計のSQL指標列（${columns}）がNULLを返し得るためBigQueryへ送信しません。COUNT/COUNTIFを使うか、最終SELECT式全体をCOALESCEまたはIFNULLで包んでください。`;
const boundError = (chart = 'bar', max = 20) =>
  `集計のSQLに${chart}用のORDER BYとLIMIT ${max}以下がないためBigQueryへ送信しません。`;
const aggregateError = (chart: string) =>
  `集計のSQLが${chart}用の単一集計行になっていないためBigQueryへ送信しません。`;
const select = (value: string, suffix = 'ORDER BY metric_value DESC LIMIT 20') =>
  `SELECT kind AS category, ${value} AS metric_value FROM events ${suffix}`;

test('SQL output aliases require an exact count and case-insensitive ASCII uniqueness', () => {
  const suffix = ' FROM events ORDER BY metric_value LIMIT 20';
  assert.deepEqual(
    checkSql(BAR, [
      'SELECT kind AS CATEGORY, COUNT(*) as METRIC_VALUE' + suffix,
      'SELECT kind, COUNT(*) AS metric_value' + suffix,
      'SELECT kind AS category, COUNT(*) AS CATEGORY' + suffix,
      'SELECT kind AS 区分, COUNT(*) AS metric_value' + suffix,
      'SELECT kind AS `category`, COUNT(*) AS metric_value' + suffix,
      'SELECT COUNT(*) AS metric_value' + suffix,
      'SELECT kind AS category, COUNT(*) AS metric_value, COUNT(*) AS extra' + suffix,
    ]),
    [
      null,
      aliasError('別名なし、metric_value'),
      aliasError('category、category'),
      aliasError('別名なし、metric_value'),
      aliasError('別名なし、metric_value'),
      aliasError('metric_value'),
      aliasError('category、metric_value、extra'),
    ],
  );
});

test('nonnull metrics accept supported count and NULL-protection forms', () => {
  const safe = [
    'COUNT(*)',
    'countif(active)',
    'COALESCE(SUM(amount), 0)',
    'IFNULL(AVG(amount), 0)',
    'CAST(COUNT(*) AS INT64)',
    'SAFE_CAST(COUNTIF(active) AS FLOAT64)',
  ];
  assert.deepEqual(
    checkSql(
      BAR,
      safe.map((value) => select(value)),
    ),
    safe.map(() => null),
  );
  const unsafe = ['SUM(amount)', 'AVG(amount)', 'metric_value', '0', 'CAST(SUM(amount) AS INT64)'];
  assert.deepEqual(
    checkSql(
      BAR,
      unsafe.map((value) => select(value)),
    ),
    unsafe.map(() => nullError()),
  );
});

test('nonnull checks follow the declared metric columns and preserve their diagnostic order', () => {
  const section = {
    ...BAR,
    planned_visualization: 'grouped_bar',
    source_columns: ['category', 'metric_1', 'metric_2'],
    nonnull_metric_columns: ['metric_2', 'metric_1'],
  };
  assert.deepEqual(
    checkSql(section, [
      'SELECT kind AS category, SUM(a) AS metric_1, AVG(b) AS metric_2 FROM events ORDER BY metric_1 LIMIT 20',
      'SELECT kind AS category, SUM(a) AS metric_1, COUNT(*) AS metric_2 FROM events ORDER BY metric_1 LIMIT 20',
    ]),
    [nullError('metric_2、metric_1'), nullError('metric_1')],
  );
  assert.deepEqual(checkSql({ ...BAR, nonnull_metric_columns: [] }, [select('SUM(amount)')]), [
    null,
  ]);
});

test('bounded SQL requires top-level ORDER BY and a LIMIT within inclusive bounds', () => {
  const suffixes = [
    'ORDER BY metric_value LIMIT 1',
    'order by metric_value limit 20',
    'ORDER BY metric_value LIMIT 0',
    'ORDER BY metric_value LIMIT 21',
    'ORDER BY metric_value LIMIT -1',
    'ORDER BY metric_value',
    'LIMIT 20',
    '',
  ];
  assert.deepEqual(
    checkSql(
      BAR,
      suffixes.map((suffix) => select('COUNT(*)', suffix)),
    ),
    [null, null, ...Array(6).fill(boundError())],
  );
  assert.deepEqual(
    checkSql({ ...BAR, max_result_rows: 1 }, [
      select('COUNT(*)', 'ORDER BY metric_value LIMIT 1'),
      select('COUNT(*)', 'ORDER BY metric_value LIMIT 2'),
    ]),
    [null, boundError('bar', 1)],
  );
});

test('CTE, subquery, comment and literal clauses cannot satisfy final SELECT row bounds', () => {
  assert.deepEqual(
    checkSql(BAR, [
      'WITH ranked AS (SELECT kind, amount FROM events ORDER BY amount LIMIT 20) SELECT kind AS category, COUNT(*) AS metric_value FROM ranked',
      'SELECT kind AS category, COUNT(*) AS metric_value FROM (SELECT kind FROM events ORDER BY kind LIMIT 20)',
      select('COUNT(*)', '/* ORDER BY metric_value LIMIT 20 */'),
      select('COUNT(*)', '-- ORDER BY metric_value LIMIT 20'),
      "SELECT 'ORDER BY value LIMIT 20' AS category, COUNT(*) AS metric_value FROM events",
    ]),
    Array(5).fill(boundError()),
  );
});

test('final SELECT parsing preserves nested commas and ignores quoted SQL tokens', () => {
  const sql = `WITH totals AS (SELECT kind, SUM(amount) AS amount FROM events GROUP BY kind)
SELECT CONCAT('SELECT, FROM', kind) AS category, COALESCE(SUM(amount), 0) AS metric_value
FROM totals /* SELECT hidden FROM ignored ORDER BY x LIMIT 99 */
GROUP BY category ORDER BY metric_value DESC LIMIT 20`;
  assert.deepEqual(checkSql(BAR, [sql]), [null]);
  assert.deepEqual(checkSql(BAR, ['']), [
    '生成SQLの最終SELECTを解析できないためBigQueryへ送信しません。',
  ]);
});

for (const chart of ['scorecard', 'kpi_group', 'delta']) {
  test(`${chart} requires a single aggregate row and rejects grouping or window aggregation`, () => {
    const columns = chart === 'scorecard' ? ['metric_value'] : ['metric_1', 'metric_2'];
    const section = {
      title: '集計',
      planned_visualization: chart,
      source_columns: columns,
      nonnull_metric_columns: columns,
      max_result_rows: 1,
    };
    const expressions = columns.map((column) => `COUNT(*) AS ${column}`).join(', ');
    const bound = chart === 'delta' ? ` ORDER BY ${columns[0]} LIMIT 1` : '';
    const valid = `SELECT ${expressions} FROM events${bound}`;
    assert.deepEqual(
      checkSql(section, [
        valid,
        `WITH groups AS (SELECT kind, COUNT(*) AS n FROM events GROUP BY kind) SELECT ${expressions} FROM groups${bound}`,
        `SELECT ${expressions} FROM events GROUP BY kind${bound}`,
        `SELECT ${expressions.replace('COUNT(*)', 'COUNT(*) OVER ()')} FROM events${bound}`,
        `SELECT ${expressions.replace('COUNT(*)', 'COALESCE(amount, 0)')} FROM events${bound}`,
      ]),
      [null, null, aggregateError(chart), aggregateError(chart), aggregateError(chart)],
    );
    if (chart === 'delta') {
      // Preserve the current distinction: delta still checks row bounds before aggregates.
      assert.deepEqual(checkSql(section, [`SELECT ${expressions} FROM events`]), [
        boundError(chart, 1),
      ]);
    }
  });
}

test('multiple SQL violations report aliases before NULL safety and row bounds', () => {
  assert.deepEqual(
    checkSql(BAR, [
      'SELECT kind, SUM(amount) AS metric_value FROM events',
      'SELECT kind AS category, SUM(amount) AS metric_value FROM events',
      'SELECT kind AS category, COALESCE(SUM(amount), 0) AS metric_value FROM events',
    ]),
    [aliasError('別名なし、metric_value'), nullError(), boundError()],
  );
  assert.deepEqual(
    checkSql({ ...BAR, planned_visualization: 'delta' }, [select('COUNT(*) OVER ()', '')]),
    [boundError('delta')],
  );
});

test('missing visualization contracts remain outside this validator and do not parse SQL', () => {
  for (const section of [
    {},
    { planned_visualization: 'bar' },
    { source_columns: ['value'] },
    { planned_visualization: 'bar', source_columns: [] },
  ]) {
    assert.deepEqual(checkSql(section, ['not SQL']), [null]);
  }
  const { max_result_rows: _limit, ...unbounded } = BAR;
  assert.deepEqual(checkSql(unbounded, [select('COUNT(*)', '')]), [null]);
});

test('live SQL validation translates the contract error and retains its cause', () => {
  const result = python(
    `
import live_contracts
payload=json.load(sys.stdin)
try:live_contracts.validate_generated_dashboard_sql(payload["section"],payload["sql"])
except live_contracts.LiveDemoError as error:
 print(json.dumps({"type":type(error).__name__,"message":str(error),
  "cause_type":type(error.__cause__).__name__,"cause_message":str(error.__cause__),
  "suggestion":error.suggested_instruction},ensure_ascii=False))
else:raise AssertionError("invalid SQL was accepted")
`,
    { section: BAR, sql: 'SELECT kind, COUNT(*) AS metric_value FROM events' },
  );
  assert.deepEqual(result, {
    type: 'LiveDemoError',
    message: aliasError('別名なし、metric_value'),
    cause_type: 'SQLContractError',
    cause_message: aliasError('別名なし、metric_value'),
    suggestion: null,
  });
});
