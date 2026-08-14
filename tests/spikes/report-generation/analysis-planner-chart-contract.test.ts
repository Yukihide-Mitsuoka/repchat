import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PLANNER_DIR = path.join(ROOT, 'spikes/report-generation');

function python(body: string) {
  return spawnSync(
    'python3',
    [
      '-c',
      `import json,sys\nsys.path.insert(0,${JSON.stringify(PLANNER_DIR)})\nimport analysis_planner as p\n${body}`,
    ],
    { cwd: ROOT, encoding: 'utf8' },
  );
}

test('renderer capabilities are represented by one chart and shape contract', () => {
  const result = python(`
schema=p._visualization_response_schema(p.SUPPORTED_DASHBOARD_CHARTS,seed="依頼A")
variants=schema["anyOf"]
print(json.dumps({
 "charts":[item["properties"]["chart"]["enum"][0] for item in variants],
 "contracts":{
  item["properties"]["chart"]["enum"][0]:[
   item["properties"]["dimensions"]["minItems"],
   item["properties"]["dimensions"]["maxItems"],
   item["properties"]["measures"]["minItems"],
   item["properties"]["measures"]["maxItems"],
  ] for item in variants
 },
 "row_limits":p.DASHBOARD_ROW_LIMITS,
},ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(
    new Set(output.charts),
    new Set(output.row_limits ? Object.keys(output.row_limits) : []),
  );
  assert.deepEqual(output.contracts.scorecard, [0, 0, 1, 1]);
  assert.deepEqual(output.contracts.grouped_bar, [1, 1, 2, 4]);
  assert.deepEqual(output.contracts.heatmap, [2, 2, 1, 1]);
  assert.deepEqual(output.contracts.sankey, [2, 2, 1, 1]);
});

test('chart order is deterministic per request and unrelated to declaration order', () => {
  const result = python(`
charts=p.SUPPORTED_DASHBOARD_CHARTS
first=p._neutral_chart_order(charts,"依頼A")
second=p._neutral_chart_order(tuple(reversed(charts)),"依頼A")
other=p._neutral_chart_order(charts,"依頼B")
print(json.dumps({"same":first==second,"different":first!=other,"complete":set(first)==set(charts)}))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    same: true,
    different: true,
    complete: true,
  });
});

test('answered clarification schema avoids the provider-invalid zero item bound', () => {
  const result = python(`
schema=p._response_schema({"audience":"A","comparison":"B","business_goal":"C"})
clarifications=schema["properties"]["clarifications"]
print(json.dumps({"has_max":"maxItems" in clarifications,"has_min":"minItems" in clarifications}))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { has_max: false, has_min: false });
});
