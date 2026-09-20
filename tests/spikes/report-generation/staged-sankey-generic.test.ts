import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const REPORT_DIR = path.join(ROOT, 'spikes/report-generation');
const { standardSankeyOption } = (await import(
  new URL('../../../spikes/report-generation/chart_renderer_composition.js', import.meta.url).href
)) as {
  standardSankeyOption: (result: object) => any;
};
const { graph } = (await import(
  new URL('../../../spikes/report-generation/chart_renderer_dispatch.js', import.meta.url).href
)) as {
  graph: (result: object, box: object, library?: object | null) => boolean;
};

class ElementStub {
  [key: string]: any;
  attributes: Record<string, string> = {};
  children: ElementStub[] = [];
  className = '';
  classList = {
    add: (...names: string[]) => {
      this.className += ` ${names.join(' ')}`;
    },
  };
  style: Record<string, unknown> = {
    setProperty: (name: string, value: unknown) => {
      this.style[name] = value;
    },
  };
  tag: string;
  textContent: unknown = '';
  value = '';

  constructor(tag: string) {
    this.tag = tag;
  }

  setAttribute(name: string, value: unknown) {
    this.attributes[name] = String(value);
  }

  append(...children: ElementStub[]) {
    this.children.push(...children);
  }

  appendChild(child: ElementStub) {
    this.children.push(child);
    return child;
  }

  replaceChildren(...children: ElementStub[]) {
    this.children = children;
  }

  createTHead() {
    return this.appended('thead');
  }

  createTBody() {
    return this.appended('tbody');
  }

  insertRow() {
    return this.appended('tr');
  }

  insertCell() {
    return this.appended('td');
  }

  requestFullscreen() {}

  private appended(tag: string) {
    const child = new ElementStub(tag);
    this.append(child);
    return child;
  }
}

function withDocument<T>(callback: () => T): T {
  const runtime = globalThis as typeof globalThis & { document?: unknown };
  const hadDocument = Object.hasOwn(runtime, 'document');
  const previousDocument = runtime.document;
  runtime.document = {
    createElement: (tag: string) => new ElementStub(tag),
    createTextNode: (value: unknown) =>
      Object.assign(new ElementStub('#text'), { textContent: value }),
  };
  try {
    return callback();
  } finally {
    if (hadDocument) runtime.document = previousDocument;
    else delete runtime.document;
  }
}

function chartLibrary({ fails = false } = {}) {
  return {
    init() {
      if (fails) throw new Error('render failed');
      return { dispose() {}, resize() {}, setOption() {} };
    },
    registerMap() {},
  };
}

function render(result: object, library: object | null = chartLibrary()) {
  return withDocument(() => graph(result, new ElementStub('div'), library));
}

test('unverified staged Sankey remains source-neutral and fails before SQL generation', () => {
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
try:build_planned_analysis_section(panel)
except ValueError as error:diagnostic=str(error)
else:raise AssertionError('staged Sankey SQL section accepted')
print(json.dumps({"request":request,"diagnostic":diagnostic},ensure_ascii=False))
`,
    ],
    { cwd: ROOT, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.match(output.request, /flow_sankey/);
  assert.match(output.request, /循環しない/);
  assert.doesNotMatch(output.request, /ページ回遊|最終ページ|page path/);
  assert.match(output.diagnostic, /完全.*経路.*契約/);
});

test('staged Sankey renderer preserves arbitrary node values, including URL characters', () => {
  const option = standardSankeyOption({
    columns: ['source', 'target', 'metric_value'],
    rows: [['1. <b>https://example.test/state?phase=beta#part</b>', '2. Done', 3]],
  });
  assert.equal(
    option.series[0].data[0].label.formatter(),
    '1. <b>https://example.test/state?phase=beta#part</b>',
  );
  const edgeTooltip = option.tooltip.formatter({
    dataType: 'edge',
    data: option.series[0].links[0],
  });
  assert.match(edgeTooltip, /&lt;b&gt;https:\/\/example\.test\/state\?phase=beta#part&lt;\/b&gt;/);
  assert.equal(
    option.tooltip.formatter({ dataType: 'node', name: '1. <unsafe>' }),
    '1. &lt;unsafe&gt;',
  );
});

test('standard chart reports renderer success and failure', () => {
  const result = {
    visualization: 'bar',
    columns: ['category', 'metric_value'],
    rows: [['A', 2]],
  };
  assert.equal(render(result), true);
  assert.equal(render(result, chartLibrary({ fails: true })), false);
});

test('DOM renderers report success without target-specific helpers', () => {
  assert.equal(render({ visualization: 'scalar', columns: ['metric_value'], rows: [[2.5]] }), true);
  assert.equal(
    render({ visualization: 'table', columns: ['category', 'metric_value'], rows: [['A', 2.5]] }),
    true,
  );
});

test('sparkline table uses the explicitly supplied chart library', () => {
  const result = {
    visualization: 'sparkline_table',
    columns: ['category', 'time_value', 'metric_value'],
    rows: [['A', '2026-09-21', 2]],
  };
  assert.equal(render(result), true);
  assert.equal(render(result, null), false);
});

test('unsupported visualization fails even when no rows exist', () => {
  assert.equal(render({ visualization: 'unknown', columns: ['category'], rows: [] }), false);
});
