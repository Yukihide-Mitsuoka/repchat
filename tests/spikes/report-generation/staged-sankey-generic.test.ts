import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const REPORT_DIR = path.join(ROOT, 'spikes/report-generation');

test('staged Sankey planning and SQL requirements do not assume page navigation', () => {
  const result = spawnSync(
    'python3',
    [
      '-c',
      `
import json,sys
sys.path.insert(0,${JSON.stringify(REPORT_DIR)})
import analysis_planner as planner
from visualization_sections import build_planned_analysis_section
request=planner.dashboard_planning_request("状態遷移を分析する",None,"指標定義",{})
panel={"id":"P1","title":"状態遷移","chart":"sankey","execution_prompt":"契約上の順序付き経路を集計する","dimensions":["遷移元状態","遷移先状態"],"measures":["件数"]}
section=build_planned_analysis_section(panel)
print(json.dumps({"request":request,"requirements":section["generation_requirements"],"max_stages":section.get("max_stages"),"max_paths":section.get("max_paths"),"navigation_pages":section.get("max_navigation_pages")},ensure_ascii=False))
`,
    ],
    { cwd: ROOT, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.match(output.request, /順序付き.*経路/);
  assert.match(output.request, /最大4段階/);
  assert.match(output.request, /確認できない場合.*選ばない/);
  assert.doesNotMatch(output.request, /ページ回遊|最終ページ|page path/);
  assert.equal(output.max_stages, 4);
  assert.equal(output.max_paths, 10);
  assert.equal(output.navigation_pages, null);
  assert.match(output.requirements.join(' '), /1\.〜4\./);
  assert.doesNotMatch(
    output.requirements.join(' '),
    /ページ|URL|page path|scheme|host|query|fragment/,
  );
});

test('staged Sankey renderer preserves arbitrary node values, including URL characters', () => {
  const source = readFileSync(path.join(REPORT_DIR, 'chart_renderer_composition.js'), 'utf8');
  const context = vm.createContext({
    standardChartBase: () => ({}),
    standardChartPalette: ['#123456'],
    standardChartNumber: Number,
    standardChartFormat: () => '<b>3</b>',
  });
  vm.runInContext(`${source}\nglobalThis.sankeyOption = standardSankeyOption;`, context);
  const option = (context as { sankeyOption: (result: object) => any }).sankeyOption({
    columns: ['source', 'target', 'metric_value'],
    rows: [['1. https://example.test/state?phase=beta#part', '2. Done', 3]],
  });
  assert.equal(
    option.series[0].data[0].label.formatter(),
    '1. https://example.test/state?phase=beta#part',
  );
  const edgeTooltip = option.tooltip.formatter({
    dataType: 'edge',
    data: option.series[0].links[0],
  });
  assert.match(edgeTooltip, /https:\/\/example\.test\/state\?phase=beta#part/);
  assert.match(edgeTooltip, /&lt;b&gt;3&lt;\/b&gt;/);
  assert.equal(
    option.tooltip.formatter({ dataType: 'node', name: '1. <unsafe>' }),
    '1. &lt;unsafe&gt;',
  );
});
