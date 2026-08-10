import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const LIVE = path.join(ROOT, 'spikes/report-generation/live_demo.py');
function python(body: string) {
  return spawnSync(
    'python3',
    [
      '-c',
      `import json,sys\nsys.path.insert(0,${JSON.stringify(path.dirname(LIVE))})\nimport live_demo as m\n${body}`,
    ],
    { cwd: ROOT, encoding: 'utf8' },
  );
}
test('live dry-run describes the paid localhost workflow', () => {
  const result = spawnSync('python3', [LIVE, '--project', 'example-project', '--dry-run'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /live mode: enter a Japanese prompt, then stream a graph or dashboard/,
  );
  assert.match(result.stdout, /call Vertex AI and BigQuery after each submitted prompt/);
  assert.match(result.stdout, /open http:\/\/127\.0\.0\.1:8765\//);
});
test('live startup prepares pinned dependencies before creating the engine', () => {
  const result = python(`
from pathlib import Path
calls=[]
m.sys.argv=[str(m.Path(m.__file__)),"--project","example-project","--accept-cost","--no-open"]
m.sys.executable="/usr/bin/python3"
m.sys.prefix=str(m.VENV_DIR)
m.sys.version_info=(3,13,0)
m.shutil.which=lambda _tool:"/usr/bin/gcloud"
m.require_adc=lambda:calls.append("adc")
m.venv_python=lambda:Path(m.sys.executable)
def prepare():
 calls.append("prepare")
 return Path(m.sys.executable)
m.prepare_python=prepare
m.LiveQueryEngine=lambda _project:(calls.append("engine") or object())
class Server:
 server_port=8765
 def serve_forever(self):calls.append("serve");raise KeyboardInterrupt
 def server_close(self):calls.append("close")
m.create_server=lambda _host,_port,_engine:Server()
status=m.main()
print(json.dumps({"status":status,"calls":calls}))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.split('\n').at(-2) ?? ''), {
    status: 0,
    calls: ['adc', 'prepare', 'engine', 'serve', 'close'],
  });
});
test('live startup re-enters the venv when executable symlinks share one target', () => {
  const result = python(`
import tempfile
from pathlib import Path
with tempfile.TemporaryDirectory() as directory:
 root=Path(directory);base=root/"python";base.touch();system=root/"system-python";venv_python=root/"venv-python"
 system.symlink_to(base);venv_python.symlink_to(base);calls=[]
 m.sys.argv=[str(m.Path(m.__file__)),"--project","example-project","--accept-cost","--no-open"]
 m.sys.executable=str(system);m.sys.prefix=str(root/"system-prefix");m.sys.version_info=(3,13,0)
 m.shutil.which=lambda _tool:"/usr/bin/gcloud";m.require_adc=lambda:calls.append("adc")
 m.VENV_DIR=root/"demo-venv"
 m.prepare_python=lambda:(calls.append("prepare") or venv_python)
 m.run=lambda _command:calls.append("reexec")
 m.LiveQueryEngine=lambda _project:(calls.append("engine") or object())
 class Server:
  server_port=8765
  def serve_forever(self):calls.append("serve");raise KeyboardInterrupt
  def server_close(self):calls.append("close")
 m.create_server=lambda _host,_port,_engine:Server()
 status=m.main()
 print(json.dumps({"status":status,"same_target":system.resolve()==venv_python.resolve(),"calls":calls}))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.split('\n').at(-2) ?? ''), {
    status: 0,
    same_target: true,
    calls: ['adc', 'prepare', 'reexec'],
  });
});
test('live prompt uses an accessible in-page cost dialog before sending the request', () => {
  const result = python(`
html=m.HTML
print(json.dumps({
 "copy":all(x in html for x in ["Vertex AI 約¥1","BigQuery 最大40 GiB","最大約¥38","合計最大約¥39","無料枠やキャッシュで0円"]),
 "dialog":all(x in html for x in ['<dialog id="cost-dialog"','aria-labelledby="cost-title"','id="cancel-cost"','id="confirm-cost"']),
 "actions":all(x in html for x in ['$("cost-dialog").showModal()','$("cost-dialog").close()','pendingMode==="dashboard-plan"?runPlan():pendingMode==="dashboard-build"?runDashboard():pendingMode==="report"?runMeetingReport():runQuery()']),
 "dashboard":all(x in html for x in ["今回の相談 約¥1","BigQuery ¥0（仕様確定前は実行しません）","count*40","count*39"]),
 "portable":"confirm(COST_CONFIRMATION)" not in html,
 "progress":all(x in html for x in ["生成の進行状況","実行前","質問を送信すると、ここに処理状況が表示されます。","SQLを作る","安全性を確認","データを取得","結果を可視化"])
}))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    copy: true,
    dialog: true,
    actions: true,
    dashboard: true,
    portable: true,
    progress: true,
  });
});
test('live page JavaScript parses before the user can interact', () => {
  const rendered = python('print(m.HTML)');
  assert.equal(rendered.status, 0, rendered.stderr);
  const script = rendered.stdout.split('<script>').at(-1)?.split('</script>')[0] ?? '';
  const syntax = spawnSync(process.execPath, ['--check'], { input: script, encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr);
});
test('live SQL uses restrained GitHub colors and safe DOM token highlighting', () => {
  const rendered = python('print(m.HTML)');
  assert.equal(rendered.status, 0, rendered.stderr);
  const html = rendered.stdout;
  for (const expected of [
    '.sql{white-space:pre;overflow:auto;background:#f6f8fa;color:#24292f',
    '.sql-keyword{color:#cf222e}',
    '.sql-string,.sql-identifier{color:#0a3069}',
    '.sql-number{color:#0550ae}',
    '.sql-comment{color:#6e7781}',
    '.sql-function{color:#8250df}',
  ]) {
    assert.ok(html.includes(expected), `missing SQL theme token: ${expected}`);
  }
  assert.ok(!html.includes('innerHTML'), 'SQL must not be inserted as HTML');

  const script = html.split('<script>').at(-1)?.split('</script>')[0] ?? '';
  const renderSql = script.slice(
    script.indexOf('function renderSql('),
    script.indexOf('function selectResultTab('),
  );
  class ElementStub {
    children: ElementStub[] = [];
    className = '';
    textContent = '';
    tag: string;
    constructor(tag: string) {
      this.tag = tag;
    }
    replaceChildren(...children: ElementStub[]) {
      this.children = children;
    }
  }
  const target = new ElementStub('pre');
  const context = {
    document: {
      createElement: (tag: string) => new ElementStub(tag),
      createTextNode: (value: string) =>
        Object.assign(new ElementStub('#text'), { textContent: value }),
    },
    target,
    sql: "-- test\nSELECT\n    COUNT(*) AS sessions,\n    '20210101' AS start_date,\n    42 AS sample\nFROM\n    `project.dataset.table`\nWHERE\n    label = '<script>'\n    AND label2 = \"double\"",
  };
  const tokens = vm.runInNewContext(
    `${renderSql}\nrenderSql(target,sql); target.children.map(node=>({className:node.className,textContent:node.textContent}));`,
    context,
  );
  const classes = new Set(tokens.map((token: { className: string }) => token.className));
  assert.deepEqual([...classes].sort(), [
    '',
    'sql-comment',
    'sql-function',
    'sql-identifier',
    'sql-keyword',
    'sql-number',
    'sql-string',
  ]);
  assert.equal(
    tokens.map((token: { textContent: string }) => token.textContent).join(''),
    context.sql,
    'highlighting must preserve SQL text, whitespace, and HTML-like strings',
  );
});
test('single-graph results expose and reset an accessible query-data tab', () => {
  const rendered = python('print(m.HTML)');
  assert.equal(rendered.status, 0, rendered.stderr);
  const html = rendered.stdout;
  for (const expected of [
    'role="tablist" aria-label="BigQuery実行結果の表示"',
    'id="result-tab-chart"',
    'aria-controls="result-chart-panel"',
    'id="result-tab-data"',
    'aria-controls="result-data-panel"',
    '>取得データ</button>',
  ]) {
    assert.ok(html.includes(expected), `missing accessible result tab markup: ${expected}`);
  }

  const script = html.split('<script>').at(-1)?.split('</script>')[0] ?? '';
  const functions = script.slice(
    script.indexOf('function table('),
    script.indexOf('function sankey('),
  );
  class ElementStub {
    attributes: Record<string, string> = {};
    children: ElementStub[] = [];
    className = '';
    textContent = '';
    tag: string;
    constructor(tag: string) {
      this.tag = tag;
    }
    setAttribute(name: string, value: unknown) {
      this.attributes[name] = String(value);
    }
    appendChild(child: ElementStub): ElementStub {
      this.children.push(child);
      return child;
    }
    replaceChildren(...children: ElementStub[]) {
      this.children = children;
    }
    insertRow(): ElementStub {
      return this.appendChild(new ElementStub('tr'));
    }
    insertCell(): ElementStub {
      return this.appendChild(new ElementStub('td'));
    }
    createTHead(): ElementStub {
      return this.appendChild(new ElementStub('thead'));
    }
    createTBody(): ElementStub {
      return this.appendChild(new ElementStub('tbody'));
    }
  }
  const elements = new Map(
    [
      'result-tab-chart',
      'result-tab-data',
      'result-chart-panel',
      'result-data-panel',
      'result-data',
      'chart',
    ].map((id) => [id, new ElementStub('div')]),
  );
  const context = {
    document: { createElement: (tag: string) => new ElementStub(tag) },
    $: (id: string) => elements.get(id),
    graph: () => {
      elements.get('chart')?.replaceChildren(new ElementStub('svg'));
    },
    first: { columns: ['source', 'target', 'sessions'], rows: [['入口', '/shop', 12]] },
    second: { columns: ['medium', 'sessions'], rows: [['organic', 20]] },
  };
  const state = vm.runInNewContext(
    `${functions}
populateResult(first);
selectResultTab("data");
const firstTable = $("result-data").children[0];
const dataSelected = $("result-tab-data").attributes["aria-selected"];
populateResult(second);
const secondTable = $("result-data").children[0];
const resetToChart = $("result-tab-chart").attributes["aria-selected"];
clearResult();
({firstHead:firstTable.children[0].children[0].children.map(cell=>cell.textContent),firstRow:firstTable.children[1].children[0].children.map(cell=>cell.textContent),dataSelected,secondRow:secondTable.children[1].children[0].children.map(cell=>cell.textContent),resetToChart,cleared:$("result-data").children.length});`,
    context,
  );
  assert.deepEqual(JSON.parse(JSON.stringify(state)), {
    firstHead: ['source', 'target', 'sessions'],
    firstRow: ['入口', '/shop', 12],
    dataSelected: 'true',
    secondRow: ['organic', 20],
    resetToChart: 'true',
    cleared: 0,
  });
});
test('live bar chart renders labels when DOM append returns undefined', () => {
  const rendered = python('print(m.HTML)');
  assert.equal(rendered.status, 0, rendered.stderr);
  const script = rendered.stdout.split('<script>').at(-1)?.split('</script>')[0] ?? '';
  const functions = script.slice(
    script.indexOf('function node('),
    script.indexOf('function finish('),
  );
  class ElementStub {
    attributes: Record<string, string> = {};
    children: ElementStub[] = [];
    className = '';
    textContent = '';
    onblur?: () => void;
    onfocus?: () => void;
    onmouseenter?: () => void;
    onmouseleave?: () => void;
    tag: string;
    constructor(tag: string) {
      this.tag = tag;
    }
    setAttribute(name: string, value: unknown) {
      this.attributes[name] = String(value);
    }
    append(...children: ElementStub[]): void {
      this.children.push(...children);
    }
    appendChild(child: ElementStub): ElementStub {
      this.children.push(child);
      return child;
    }
    replaceChildren(...children: ElementStub[]) {
      this.children = children;
    }
  }
  const chart = new ElementStub('div');
  const context = {
    document: { createElementNS: (_namespace: string, tag: string) => new ElementStub(tag) },
    $: () => chart,
    result: {
      rows: [
        ['organic', 120],
        ['cpc', 80],
      ],
      visualization: 'bar',
    },
  };
  assert.doesNotThrow(() =>
    vm.runInNewContext(`${functions}\ngraph(result); graph(result);`, context),
  );
  assert.equal(chart.children.length, 1);
  const svg = chart.children[0];
  assert.ok(svg);
  assert.deepEqual(
    svg.children.filter((child) => child.tag === 'text').map((child) => child.textContent),
    ['organic', '120', 'cpc', '80'],
  );
});
test('live Sankey result is classified and rendered as a diagram', () => {
  const classified = python(`
print(m.visualization_for_result(
 [("1. 入口: /", "2. /shop", 120), ("2. /shop", "3. /cart", 48)],
 ["source", "target", "sessions"]
))
`);
  assert.equal(classified.status, 0, classified.stderr);
  assert.equal(classified.stdout.trim(), 'sankey');

  const rendered = python('print(m.HTML)');
  assert.equal(rendered.status, 0, rendered.stderr);
  const script = rendered.stdout.split('<script>').at(-1)?.split('</script>')[0] ?? '';
  const functions = script.slice(
    script.indexOf('function node('),
    script.indexOf('function finish('),
  );
  class ElementStub {
    attributes: Record<string, string> = {};
    children: ElementStub[] = [];
    className = '';
    textContent = '';
    onblur?: () => void;
    onfocus?: () => void;
    onmouseenter?: () => void;
    onmouseleave?: () => void;
    tag: string;
    constructor(tag: string) {
      this.tag = tag;
    }
    setAttribute(name: string, value: unknown) {
      this.attributes[name] = String(value);
    }
    append(...children: ElementStub[]): void {
      this.children.push(...children);
    }
    appendChild(child: ElementStub): ElementStub {
      this.children.push(child);
      return child;
    }
    replaceChildren(...children: ElementStub[]) {
      this.children = children;
    }
  }
  const chart = new ElementStub('div');
  const secondChart = new ElementStub('div');
  const context = {
    document: {
      createElementNS: (_namespace: string, tag: string) => new ElementStub(tag),
      createElement: (tag: string) => new ElementStub(tag),
    },
    $: () => chart,
    result: {
      rows: [
        ['1. 入口: /', '2. /shop', 120],
        ['2. /shop', '3. /cart', 48],
        ['3. /cart', '4. /complete', 20],
      ],
      columns: ['source', 'target', 'sessions'],
      visualization: 'sankey',
      navigation_depth: 4,
    },
  };
  assert.doesNotThrow(() =>
    vm.runInNewContext(`${functions}\ngraph(result); graph(result, secondChart);`, {
      ...context,
      secondChart,
    }),
  );
  assert.equal(chart.children[0]?.tag, 'svg');
  assert.equal(secondChart.children[0]?.tag, 'svg');
  const tags = chart.children[0]?.children.map((child) => child.tag) ?? [];
  assert.ok(tags.includes('path'), 'Sankey links should be SVG paths');
  assert.ok(tags.includes('rect'), 'Sankey nodes should be SVG rectangles');
  const descendants = (element: ElementStub): ElementStub[] => [
    element,
    ...element.children.flatMap(descendants),
  ];
  const elements = descendants(chart.children[0]);
  const gradients = elements.filter((element) => element.tag === 'linearGradient');
  const links = elements.filter((element) => element.tag === 'path');
  const nodeColors = new Set(
    elements.filter((element) => element.tag === 'rect').map((element) => element.attributes.fill),
  );
  const linkStrokes = elements
    .filter((element) => element.tag === 'path')
    .map((element) => element.attributes.stroke);
  assert.equal(gradients.length, 3, 'each transition should have a color gradient');
  assert.ok(nodeColors.size >= 3, 'different page types should use different node colors');
  assert.ok(
    linkStrokes.every((stroke) => /^url\(#sankey-\d+-link-\d+\)$/.test(stroke ?? '')),
    'each transition should reference its own source-to-target gradient',
  );
  const sankeySvgs = [chart.children[0], secondChart.children[0]];
  const allGradientIds = sankeySvgs.flatMap((svg) =>
    descendants(svg)
      .filter((element) => element.tag === 'linearGradient')
      .map((element) => element.attributes.id),
  );
  assert.equal(
    new Set(allGradientIds).size,
    allGradientIds.length,
    'paint-server IDs must be unique across Sankey SVG instances in the same document',
  );
  for (const svg of sankeySvgs) {
    const localGradientIds = new Set(
      descendants(svg)
        .filter((element) => element.tag === 'linearGradient')
        .map((element) => element.attributes.id),
    );
    const localLinks = descendants(svg).filter((element) => element.tag === 'path');
    assert.ok(
      localLinks.every((link) => {
        const referencedId = link.attributes.stroke?.match(/^url\(#(.+)\)$/)?.[1];
        return referencedId !== undefined && localGradientIds.has(referencedId);
      }),
      'each link must reference a gradient defined in its own SVG',
    );
  }
  assert.deepEqual(
    elements
      .filter((element) => element.attributes.class === 'sankey-stage')
      .map((element) => element.textContent),
    ['入口', '2ページ目', '3ページ目', '4ページ目'],
  );
  assert.ok(links.every((link) => link.attributes.tabindex === '0'));
  assert.ok(links.every((link) => link.attributes['aria-label']?.includes('セッション')));
  assert.ok(
    links.every((link) => link.children.some((child) => child.tag === 'title')),
    'each transition should expose its value as an SVG tooltip',
  );
  const detail = chart.children.find((element) => element.className.includes('sankey-detail'));
  assert.ok(detail);
  links[0]?.onfocus?.();
  assert.match(detail.textContent, /\/ → \/shop: 120セッション/);
  const terminal = chart.children.find((element) => element.className.includes('sankey-terminal'));
  assert.match(
    terminal?.textContent ?? '',
    /2ページ目で終了: 72セッション、3ページ目で終了: 28セッション/,
  );
});

test('navigation SQL requires deterministic tie-breaking before BigQuery execution', () => {
  const result = python(`
queries=[
 "SELECT p1,p2,p3,COUNT(1) AS path_sessions FROM journeys GROUP BY p1,p2,p3 ORDER BY path_sessions DESC LIMIT 12",
 "SELECT p1,p2,p3,COUNT(1) AS path_sessions FROM journeys GROUP BY p1,p2,p3 ORDER BY IF(path_sessions > 0, path_sessions, 0) DESC, p1 LIMIT 12",
 "SELECT p1,p2,p3,COUNT(1) AS path_sessions FROM journeys GROUP BY p1,p2,p3 ORDER BY path_sessions DESC, p1 DESC, p2 DESC, p3 DESC LIMIT 12",
 "SELECT p1,p2,p3,COUNT(1) AS path_sessions FROM journeys GROUP BY p1,p2,p3 ORDER BY path_sessions DESC, p1, p2, p3 LIMIT 12",
]
out=[]
for sql in queries:
 try:
  m.require_deterministic_navigation_order(sql)
  out.append("accepted")
 except m.LiveDemoError as error:
  out.append(str(error))
print(json.dumps(out,ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [
    '回遊の上位12経路に同数時の順序がないためBigQueryへ送信しません。',
    '回遊の上位12経路に同数時の順序がないためBigQueryへ送信しません。',
    '回遊の上位12経路に同数時の順序がないためBigQueryへ送信しません。',
    'accepted',
  ]);
});

test('custom navigation depth keeps the bounded Sankey analysis contract', () => {
  const result = python(`
spec=json.loads((m.HERE/"report.json").read_text())
q3="2021年1月のWebサイト回遊を分析するため、セッション内のページビューを時系列順に並べ、入口から3ページ目までの上位12経路を集計し、段階付きのsource、target、セッション数をサンキーダイアグラム用に出して"
q4=q3.replace("3ページ目", "4ページ目")
sections=[m.section_for_question(spec,q) for q in [q3,q4]]
too_deep=""
try:m.section_for_question(spec,q3.replace("3ページ目", "7ページ目"))
except m.LiveDemoError as error:too_deep=str(error)
print(json.dumps({"sections":[{"id":s["id"],"component":s["component"],"transition_mode":s["transition_mode"],"navigation_depth":s["navigation_depth"],"verification":s["verification"],"requirements":" ".join(s["generation_requirements"])} for s in sections],"too_deep":too_deep},ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(result.stdout);
  assert.deepEqual(
    value.sections.map((section: Record<string, string | number>) => ({
      id: section.id,
      component: section.component,
      transition_mode: section.transition_mode,
      navigation_depth: section.navigation_depth,
      verification: section.verification,
    })),
    [
      {
        id: 'R17',
        component: 'sankey',
        transition_mode: 'page_navigation',
        navigation_depth: 3,
        verification: 'reference',
      },
      {
        id: 'Q1',
        component: 'sankey',
        transition_mode: 'page_navigation',
        navigation_depth: 4,
        verification: 'execution',
      },
    ],
  );
  assert.match(value.sections[1].requirements, /4ページ目/);
  assert.match(value.sections[1].requirements, /3→4/);
  assert.equal(value.too_deep, '回遊Sankeyで指定できるのは入口から3〜6ページ目までです。');
});

test('custom navigation depth validates stable ordering and all adjacent stages', () => {
  const result = python(`
ordering=[]
for sql in [
 "SELECT p1,p2,p3,p4,COUNT(1) AS sessions FROM journeys GROUP BY p1,p2,p3,p4 ORDER BY sessions DESC,p1,p2,p3 LIMIT 12",
 "SELECT p1,p2,p3,p4,COUNT(1) AS sessions FROM journeys GROUP BY p1,p2,p3,p4 ORDER BY sessions DESC,p1,p2,p3,p4 LIMIT 12",
]:
 try:m.require_deterministic_navigation_order(sql,4);ordering.append("accepted")
 except m.LiveDemoError as error:ordering.append(str(error))
valid=[("1. 入口: /","2. /shop",10),("2. /shop","3. /cart",7),("3. /cart","4. /done",4)]
invalid=[("1. 入口: /","2. /shop",10),("3. /cart","4. /done",4)]
validation=[]
for rows in [valid,invalid]:
 try:m.validate_navigation_sankey(rows,4);validation.append("accepted")
 except m.LiveDemoError as error:validation.append(str(error))
print(json.dumps({"ordering":ordering,"validation":validation},ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    ordering: [
      '回遊の上位12経路に同数時の順序がないためBigQueryへ送信しません。',
      'accepted',
    ],
    validation: ['accepted', '回遊の段階間が接続しないため描画しません。'],
  });
});

test('single-graph progress shows the dynamic stop reason before stage details', () => {
  const rendered = python('print(m.HTML)');
  assert.equal(rendered.status, 0, rendered.stderr);
  const html = rendered.stdout;
  const progressStart = html.indexOf('aria-labelledby="progress-title"');
  const progressEnd = html.indexOf('</section>', progressStart);
  const progress = html.slice(progressStart, progressEnd);
  assert.ok(progress.indexOf('id="message"') < progress.indexOf('<ol class="stages">'));
  assert.doesNotMatch(progress, /質問を送信すると、ここに処理状況が表示されます。/);
  assert.match(html, /未定義のため停止:/);
});

test('dashboard-specific KPI, funnel, and trend panels render from fixed results', () => {
  const rendered = python('print(m.HTML)');
  assert.equal(rendered.status, 0, rendered.stderr);
  const script = rendered.stdout.split('<script>').at(-1)?.split('</script>')[0] ?? '';
  const functions = script.slice(
    script.indexOf('function node('),
    script.indexOf('function finish('),
  );
  class ElementStub {
    attributes: Record<string, string> = {};
    children: ElementStub[] = [];
    style: Record<string, string> = {};
    textContent = '';
    className = '';
    tag: string;
    constructor(tag: string) {
      this.tag = tag;
    }
    setAttribute(name: string, value: unknown) {
      this.attributes[name] = String(value);
    }
    append(...children: ElementStub[]): void {
      this.children.push(...children);
    }
    appendChild(child: ElementStub): ElementStub {
      this.children.push(child);
      return child;
    }
    replaceChildren(...children: ElementStub[]) {
      this.children = children;
    }
  }
  const chart = new ElementStub('div');
  const context = {
    document: {
      createElementNS: (_namespace: string, tag: string) => new ElementStub(tag),
      createElement: (tag: string) => new ElementStub(tag),
      createTextNode: (value: string) =>
        Object.assign(new ElementStub('#text'), { textContent: value }),
    },
    $: () => chart,
  };
  const cases = [
    {
      visualization: 'kpi_pair',
      columns: ['購入件数', '売上'],
      rows: [[895, 57350]],
      expectedTag: 'div',
    },
    {
      visualization: 'funnel',
      columns: ['閲覧', 'カート', '購入'],
      rows: [[23105, 4537, 1115]],
      expectedTag: 'div',
    },
    {
      visualization: 'trend',
      columns: ['日付', 'セッション', '7日移動平均'],
      rows: [
        ['2021-01-01', 100, 90],
        ['2021-01-02', 120, 95],
      ],
      expectedTag: 'svg',
    },
  ];
  for (const result of cases) {
    assert.doesNotThrow(() =>
      vm.runInNewContext(`${functions}\ngraph(result);`, { ...context, result }),
    );
    assert.equal(chart.children[0]?.tag, result.expectedTag);
  }
  const polylines = chart.children[0]?.children.filter((child) => child.tag === 'polyline') ?? [];
  assert.equal(polylines.length, 2, 'trend should contain daily and moving-average series');
});

test('live query derives the requested month and rejects unavailable periods', () => {
  const result = python(`
values={}
for question in ["2020年12月のセッション数を出して", "2021年1月のセッション数を出して"]:
 values[question]=m.period_for_question(question)
errors=[]
for question in ["2021年x月のセッション数を出して", "2021年2月のセッション数を出して"]:
 try:
  m.period_for_question(question)
 except m.LiveDemoError as error:
  errors.append(str(error))
print(json.dumps({"values":values,"errors":errors},ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    values: {
      '2020年12月のセッション数を出して': {
        from: '20201201',
        to: '20201231',
        label: '2020年12月',
      },
      '2021年1月のセッション数を出して': {
        from: '20210101',
        to: '20210131',
        label: '2021年1月',
      },
    },
    errors: [
      '対象月を「YYYY年M月」の形式で指定してください。',
      '公開サンプルで利用できる期間は2020年11月〜2021年1月です。',
    ],
  });
});

test('one dashboard request expands to the six validated analyses for its month', () => {
  const result = python(`
spec=json.loads((m.HERE/"report.json").read_text())
period,sections=m.dashboard_sections(spec,"2020年12月のECサイト分析ダッシュボードを作って")
error=""
try:
 m.dashboard_sections(spec,"2021年1月のECサイト分析をして")
except m.LiveDemoError as caught:
 error=str(caught)
print(json.dumps({"period":period,"ids":[s["id"] for s in sections],"requested_month":all(period["label"] in s["text"] for s in sections),"verification":[s["verification"] for s in sections],"purposes":[bool(s["purpose"]) for s in sections],"error":error},ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    period: { from: '20201201', to: '20201231', label: '2020年12月' },
    ids: ['R4', 'R11', 'R12', 'R9', 'R16', 'R17'],
    requested_month: true,
    verification: Array(6).fill('execution'),
    purposes: Array(6).fill(true),
    error: '依頼に「ダッシュボード」を含めてください。',
  });
});

test('dashboard engine streams six generated panels without paid dependencies', () => {
  const result = python(`
import threading
from datetime import date
e=object.__new__(m.LiveQueryEngine);e.model=m.report.DEFAULT_MODEL
e.spec=json.loads((m.HERE/"report.json").read_text());e.rules="";e.client=e.bq=object();e.lock=threading.Lock()
generated=[];executed=[]
results={
 "R4": ([(895,57350)],["purchases","revenue"]),
 "R11": ([(14.56,)],["repeat_rate"]),
 "R12": ([(49.51,)],["engagement_seconds"]),
 "R9": ([(23105,4537,1115)],["viewed","carted","purchased"]),
 "R16": ([(date(2020,12,1),100,90.0)],["day","sessions","moving_average"]),
 "R17": ([("1. 入口: /","2. /shop",20)],["source","target","sessions"]),
}
def generate(_client,_model,section,period,_rules):
 generated.append([section["id"],period["label"]])
 order="ORDER BY value DESC, value, value, value LIMIT 12" if section["id"]=="R17" else "LIMIT 1"
 sql=f"SELECT 1 AS value FROM \`bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*\` WHERE _TABLE_SUFFIX BETWEEN '20201201' AND '20201231' {order} /* {section['id']} */"
 return ({"sql":sql,"reason":"理由","undefined_terms":[]},{"input_tokens":1,"output_tokens":1})
def execute(_bq,sql,**_kwargs):
 section_id=next(section_id for section_id in m.DASHBOARD_SECTION_IDS if f"/* {section_id} */" in sql)
 executed.append(section_id)
 return (results[section_id],None)
m.report.generate=generate;m.report.exec_bq=execute
events=[]
e.dashboard("2020年12月のECサイト分析ダッシュボードを作って",events.append)
panel_results=[event for event in events if event["type"]=="result"]
print(json.dumps({"first":events[0]["type"],"last":events[-1]["type"],"generated":generated,"executed":executed,"result_ids":[event["panel_id"] for event in panel_results],"visualizations":[event["visualization"] for event in panel_results],"first_columns":panel_results[0]["columns"],"count":events[-1]["panel_count"]},ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    first: 'dashboard_plan',
    last: 'dashboard_complete',
    generated: [
      ['R4', '2020年12月'],
      ['R11', '2020年12月'],
      ['R12', '2020年12月'],
      ['R9', '2020年12月'],
      ['R16', '2020年12月'],
      ['R17', '2020年12月'],
    ],
    executed: ['R4', 'R11', 'R12', 'R9', 'R16', 'R17'],
    result_ids: ['R4', 'R11', 'R12', 'R9', 'R16', 'R17'],
    visualizations: ['kpi_pair', 'scalar', 'scalar', 'funnel', 'trend', 'sankey'],
    first_columns: ['購入件数', '購入金額'],
    count: 6,
  });
});

test('dashboard result-shape validation fails closed before rendering', () => {
  const result = python(`
errors=[]
for section,rows,columns in [
 ({"title":"購入KPI","component":"kpi_pair"},[(1,)],["only_one"]),
 ({"title":"ファネル","component":"funnel"},[(100,-1,2)],["a","b","c"]),
 ({"title":"回遊","component":"sankey"},[("/","/shop","many")],["source","target","sessions"]),
]:
 try:
  m.dashboard_visualization(section,rows,columns)
 except m.LiveDemoError as error:
  errors.append(str(error))
print(json.dumps(errors,ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [
    '購入KPIの結果形状がダッシュボード仕様と一致しないため描画しません。',
    'ファネルの結果形状がダッシュボード仕様と一致しないため描画しません。',
    '回遊の結果形状がダッシュボード仕様と一致しないため描画しません。',
  ]);
});

test('dashboard navigation Sankey rejects repeated pages as consecutive transitions', () => {
  const result = python(`
section={"id":"R17","title":"回遊","component":"sankey","transition_mode":"page_navigation"}
cases=[
 [("1. 入口: /", "2. /", 38913)],
 [("1. 入口: /", "2. /shop", 20), ("2. /shop", "3. /shop", 8)],
]
errors=[]
for rows in cases:
 try:
  m.dashboard_visualization(section,rows,["source","target","sessions"])
 except m.LiveDemoError as error:
  errors.append(str(error))
print(json.dumps(errors,ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [
    '回遊の連続する同一ページが遷移として含まれるため描画しません。',
    '回遊の連続する同一ページが遷移として含まれるため描画しません。',
  ]);
});

test('dashboard navigation Sankey requires staged connected aggregated edges', () => {
  const result = python(`
section={"id":"R17","title":"回遊","component":"sankey","transition_mode":"page_navigation"}
cases=[
 [("1. 入口: /", "3. /cart", 10)],
 [("1. 入口: /", "2. /shop", 10), ("1. 入口: /", "2. /shop", 5)],
 [("1. 入口: /", "2. /shop", 10), ("2. /cart", "3. /done", 5)],
]
errors=[]
for rows in cases:
 try:
  m.dashboard_visualization(section,rows,["source","target","sessions"])
 except m.LiveDemoError as error:
  errors.append(str(error))
print(json.dumps(errors,ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [
    '回遊の段階が1→2または2→3になっていないため描画しません。',
    '回遊に未集約の重複edgeが含まれるため描画しません。',
    '回遊の1段目と2段目が接続しないため描画しません。',
  ]);
});

test('reference mismatch stops before a live result is rendered', () => {
  const result = python(`
import threading
e=object.__new__(m.LiveQueryEngine);e.model=m.report.DEFAULT_MODEL
e.rules="";e.client=e.bq=object();e.lock=threading.Lock()
section={
 "id":"R17","title":"回遊","text":"回遊","compare":"rows_ordered",
 "component":"sankey","verification":"reference",
 "gold_sql":"SELECT 'reference' FROM \`bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*\` WHERE _TABLE_SUFFIX BETWEEN '20210101' AND '20210131'",
}
generated_sql="SELECT 'generated' FROM \`bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*\` WHERE _TABLE_SUFFIX BETWEEN '20210101' AND '20210131'"
m.report.generate=lambda *_args,**_kwargs:({"sql":generated_sql,"reason":"理由","undefined_terms":[]},{"input_tokens":1,"output_tokens":1})
results=[([("1. 入口: /","2. /shop",20)],["source","target","sessions"]),([("1. 入口: /","2. /cart",20)],["source","target","sessions"])]
m.report.exec_bq=lambda *_args,**_kwargs:(results.pop(0),None)
events=[]
try:
 e._run_section(section,{"from":"20210101","to":"20210131","label":"2021年1月"},events.append)
except m.LiveDemoError as error:
 print(json.dumps({"error":str(error),"types":[event["type"] for event in events]},ensure_ascii=False))
else:
 raise AssertionError("reference mismatch was rendered")
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    error: '回遊の結果が登録済み参照値と一致しないため描画しません。',
    types: ['stage', 'sql', 'stage'],
  });
});

test('live query passes the requested period to SQL generation', () => {
  const result = python(`
import threading
e=object.__new__(m.LiveQueryEngine)
e.model=m.report.DEFAULT_MODEL
e.spec=json.loads((m.HERE/"report.json").read_text())
e.rules=""
e.client=e.bq=object()
e.lock=threading.Lock()
periods=[]
sql="SELECT traffic_source.medium AS medium, COUNT(DISTINCT user_pseudo_id) AS sessions FROM \`bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*\` WHERE _TABLE_SUFFIX BETWEEN '20201201' AND '20201231' GROUP BY medium"
m.report.generate=lambda _client,_model,_section,period,_rules:(periods.append(period) or ({"sql":sql,"reason":"集計","undefined_terms":[]},{"input_tokens":1,"output_tokens":1}))
m.report.exec_bq=lambda *_args,**_kwargs:(([('organic',10)],['medium','sessions']),None)
events=[]
e.query("2020年12月のセッション数を流入チャネル（medium）別に、多い順で出して",events.append)
print(json.dumps({"periods":periods,"types":[event["type"] for event in events]},ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    periods: [{ from: '20201201', to: '20201231', label: '2020年12月' }],
    types: ['stage', 'sql', 'stage', 'result'],
  });
});

test('live query rejects generated SQL for a different month before BigQuery', () => {
  const result = python(`
import threading
e=object.__new__(m.LiveQueryEngine)
e.model=m.report.DEFAULT_MODEL
e.spec=json.loads((m.HERE/"report.json").read_text())
e.rules=""
e.client=e.bq=object()
e.lock=threading.Lock()
sql="SELECT traffic_source.medium AS medium, COUNT(DISTINCT user_pseudo_id) AS sessions FROM \`bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*\` WHERE _TABLE_SUFFIX BETWEEN '20210101' AND '20210131' GROUP BY medium"
m.report.generate=lambda *_args:({"sql":sql,"reason":"集計","undefined_terms":[]},{"input_tokens":1,"output_tokens":1})
executions=[]
m.report.exec_bq=lambda *_args,**_kwargs:(executions.append(True) or (([],[]),None))
error=""
try:
 e.query("2020年12月のセッション数を流入チャネル（medium）別に、多い順で出して",lambda _event:None)
except m.LiveDemoError as caught:
 error=str(caught)
print(json.dumps({"error":error,"executions":executions},ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    error: '生成SQLの対象期間が問い合わせの2020年12月と一致しません。',
    executions: [],
  });
});

test('live page uses an Evidence-like restrained visual system', () => {
  const result = python(`
html=m.HTML
print(json.dumps({
 "theme":all(x in html for x in ['data-theme="evidence"','--color-primary:#1f4e79','--color-border:#d9dee7']),
 "structure":all(x in html for x in ['class="app-header"','class="eyebrow"','class="workspace"']),
 "restrained":'box-shadow:0 5px 18px' not in html and 'border-radius:14px' not in html
}))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    theme: true,
    structure: true,
    restrained: true,
  });
});

test('live engine renders safe shapes, refuses undefined metrics, and caps fetched rows', () => {
  const result = python(`
import threading
from datetime import date
from decimal import Decimal
def engine():
 e=object.__new__(m.LiveQueryEngine);e.model=m.report.DEFAULT_MODEL
 e.spec=json.loads((m.HERE/"report.json").read_text());e.rules="";e.client=e.bq=object();e.lock=threading.Lock();return e
sql="SELECT COUNT(DISTINCT user_pseudo_id) AS users FROM \`bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*\` WHERE _TABLE_SUFFIX BETWEEN '20210101' AND '20210131'"
m.report.generate=lambda *_:({"sql":sql,"reason":"集計","undefined_terms":[]},{"input_tokens":1,"output_tokens":1})
limits=[];m.report.exec_bq=lambda *_args,**kw:(limits.append(kw.get("max_results")) or (([(94790,)],["users"]),None))
events=[];engine().query("2021年1月のユーザー数を出して",events.append)
m.report.generate=lambda *_:({"sql":"","reason":"未定義","undefined_terms":["直帰率"]},{"input_tokens":1,"output_tokens":1})
refusal=[];engine().query("2021年1月の直帰率を出して",refusal.append)
print(json.dumps({"shapes":[m.visualization_for_result([(1,)],["x"]),m.visualization_for_result([(date(2021,1,1),1)],["d","v"]),m.visualization_for_result([("a",Decimal("1"))],["k","v"])],"types":[x["type"] for x in events],"refusal":refusal[-1]["undefined_terms"],"limits":limits,"safe":"innerHTML" not in m.HTML and "renderSql($(\\"sql\\"),e.sql)" in m.HTML}))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    shapes: ['scalar', 'line', 'bar'],
    types: ['stage', 'sql', 'stage', 'result'],
    refusal: ['直帰率'],
    limits: [101, null],
    safe: true,
  });
});
test('live HTTP boundary serves same-origin JSON and rejects unsafe requests and binds', () => {
  const result = python(`
import threading,urllib.error,urllib.request
class E:
 spec=json.loads((m.HERE/"report.json").read_text())
 def query(self,q,emit):emit({"type":"result","rows":[[118380]],"columns":["sessions"],"visualization":"scalar","verification":"matched","verification_label":"照合済み","cost_jpy":0.1})
 def dashboard(self,q,emit):emit({"type":"dashboard_complete","panel_count":6,"cost_jpy":1.2})
 def meeting_report(self,revision,emit):emit({"type":"meeting_report","build_revision":revision})
s=m.create_server("127.0.0.1",0,E());t=threading.Thread(target=s.serve_forever,daemon=True);t.start();base=f"http://127.0.0.1:{s.server_port}";statuses=[]
try:
 page=urllib.request.urlopen(base+"/").read().decode()
 req=urllib.request.Request(base+"/api/query",data=json.dumps({"question":"2021年1月のセッション数を出して"}).encode(),headers={"content-type":"application/json","origin":base},method="POST")
 value=json.loads(urllib.request.urlopen(req).read().decode())["rows"][0][0]
 dashboard_req=urllib.request.Request(base+"/api/dashboard",data=json.dumps({"question":"2021年1月のECサイト分析ダッシュボードを作って"}).encode(),headers={"content-type":"application/json","origin":base},method="POST")
 dashboard_count=json.loads(urllib.request.urlopen(dashboard_req).read().decode())["panel_count"]
 report_req=urllib.request.Request(base+"/api/report",data=json.dumps({"question":"会議報告案を作って","build_revision":"build-111111111111"}).encode(),headers={"content-type":"application/json","origin":base},method="POST")
 report_revision=json.loads(urllib.request.urlopen(report_req).read().decode())["build_revision"]
 try:urllib.request.urlopen(urllib.request.Request(base+"/api/report",data=json.dumps({"question":"会議報告案を作って","build_revision":"bad"}).encode(),headers={"content-type":"application/json","origin":base},method="POST"))
 except urllib.error.HTTPError as e:statuses.append(e.code)
 for ct,origin in [("text/plain",base),("application/json","https://attacker.example")]:
  try:urllib.request.urlopen(urllib.request.Request(base+"/api/query",data=b"{}",headers={"content-type":ct,"origin":origin},method="POST"))
  except urllib.error.HTTPError as e:statuses.append(e.code)
 print(json.dumps({"form":"日本語の問い合わせ" in page,"value":value,"dashboard_count":dashboard_count,"report_revision":report_revision,"statuses":statuses}))
finally:s.shutdown();s.server_close();t.join()
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.split('\n').at(-2) ?? ''), {
    form: true,
    value: 118380,
    dashboard_count: 6,
    report_revision: 'build-111111111111',
    statuses: [400, 415, 403],
  });
  const bind = spawnSync(
    'python3',
    [LIVE, '--project', 'example-project', '--host', '0.0.0.0', '--no-open'],
    { cwd: ROOT, encoding: 'utf8' },
  );
  assert.equal(bind.status, 2);
  assert.match(bind.stderr, /host must remain localhost-only/);
});

test('expired application-default credentials return a safe recovery instruction', () => {
  const result = python(`
import threading,urllib.request
RefreshError=type("RefreshError",(Exception,),{})
RefreshError.__module__="google.auth.exceptions"
class E:
 spec=json.loads((m.HERE/"report.json").read_text())
 def query(self,_question,_emit):raise RefreshError("sensitive credential detail")
s=m.create_server("127.0.0.1",0,E());t=threading.Thread(target=s.serve_forever,daemon=True);t.start();base=f"http://127.0.0.1:{s.server_port}"
try:
 req=urllib.request.Request(base+"/api/query",data=json.dumps({"question":"2021年1月のセッション数を出して"}).encode(),headers={"content-type":"application/json","origin":base},method="POST")
 event=json.loads(urllib.request.urlopen(req).read().decode())
 print(json.dumps(event,ensure_ascii=False))
finally:s.shutdown();s.server_close();t.join()
`);
  assert.equal(result.status, 0, result.stderr);
  const event = JSON.parse(result.stdout.split('\n').find((line) => line.startsWith('{')) ?? '');
  assert.deepEqual(event, {
    type: 'error',
    message:
      'Google Cloudの認証期限が切れています。gcloud auth application-default loginを実行し、デモを再起動してください。今回の処理は自動再実行していません。',
  });
  assert.doesNotMatch(result.stdout, /sensitive credential detail/);
});

test('dashboard HTTP boundary accepts a bounded confirmed plan larger than a simple query', () => {
  const result = python(`
import threading,urllib.error,urllib.request
class E:
 spec=json.loads((m.HERE/"report.json").read_text())
 def dashboard(self,q,emit,plan=None):emit({"type":"dashboard_complete","accepted":plan is not None})
s=m.create_server("127.0.0.1",0,E());t=threading.Thread(target=s.serve_forever,daemon=True);t.start();base=f"http://127.0.0.1:{s.server_port}"
question="2021年1月のECサイトで購入成果を改善するため、課題の場所と優先施策を判断できるダッシュボードを作って"
def plan(reason):
 return {"objective":question,"objective_summary":"購入課題を判断する","audience":"月次会議","comparison":"月内推移","period":m.period_for_question(question),"hypotheses":["購入導線に課題がある"],"clarifications":[],"answers":{"audience":"月次会議"},"panels":[{"id":panel_id,"reason":reason} for panel_id in ["R4","R9","R16","R17"]]}
def request(analysis_plan):
 data=json.dumps({"question":question,"profile":"ga4","analysis_plan":analysis_plan},ensure_ascii=False).encode()
 req=urllib.request.Request(base+"/api/dashboard",data=data,headers={"content-type":"application/json","origin":base},method="POST")
 return data,req
try:
 bounded,bounded_req=request(plan("理由"*250))
 accepted=json.loads(urllib.request.urlopen(bounded_req).read().decode())["accepted"]
 oversized,oversized_req=request(plan("理由"*1000))
 oversized_status=0
 try:urllib.request.urlopen(oversized_req)
 except urllib.error.HTTPError as error:oversized_status=error.code
 print(json.dumps({"bounded_bytes":len(bounded),"oversized_bytes":len(oversized),"accepted":accepted,"oversized_status":oversized_status}))
finally:s.shutdown();s.server_close();t.join()
`);
  assert.equal(result.status, 0, result.stderr);
  const observed = JSON.parse(result.stdout.split('\n').at(-2) ?? '');
  assert.ok(observed.bounded_bytes > 4096, observed);
  assert.ok(observed.bounded_bytes <= 16384, observed);
  assert.ok(observed.oversized_bytes > 16384, observed);
  assert.equal(observed.accepted, true);
  assert.equal(observed.oversized_status, 400);
});

test('non-GA4 selector exposes the bounded Bitcoin nested-schema demonstration', () => {
  const result = python(`
html=m.HTML
profile=m.bitcoin
period=profile.period_for_question(profile.EXAMPLE_QUESTION)
errors=[]
for question in ["2023年12月の受取アドレス別の取引数", "2024年1月の手数料を出して"]:
 try:
  profile.period_for_question(question)
  profile.section(question)
 except ValueError as error:
  errors.append(str(error))
print(json.dumps({
 "selector":all(value in html for value in ['id="dataset-profile"','value="bitcoin"','Bitcoin受取先の複雑度']),
 "cost":all(value in html for value in ["BigQuery dry run 約2.91 GiB","上限20 GiB","参照値照合なし","通常約¥5・最大約¥20"]),
 "schema":all(value in profile.SCHEMA_DDL for value in ["outputs ARRAY<STRUCT<","addresses ARRAY<STRING>",profile.TABLE]),
 "rules":all(value in profile.prompt_rules() for value in ["outputs と output.addresses はそれぞれ UNNEST","SELECT * は使わず"]),
 "reference":all(value in profile.REFERENCE_SQL for value in ["UNNEST(t.outputs)","UNNEST(output.addresses)","block_timestamp_month = DATE '2024-01-01'"]),
 "period":period,
 "errors":errors,
},ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    selector: true,
    cost: true,
    schema: true,
    rules: true,
    reference: true,
    period: {
      from: '2024-01-01',
      to: '2024-01-31',
      partition: '2024-01-01',
      label: '2024年1月',
    },
    errors: [
      'Bitcoinデモで検証する期間は2024年1月〜12月です。',
      'Bitcoinデモは現在「取引ごとの受取アドレス数帯別の取引数」のみ対応します。',
    ],
  });
});

test('Bitcoin query uses its own schema, partition guard, and dataset boundary', () => {
  const result = python(`
import threading
e=object.__new__(m.LiveQueryEngine);e.model=m.report.DEFAULT_MODEL
e.spec=json.loads((m.HERE/"report.json").read_text());e.rules="";e.bitcoin_rules=m.bitcoin.prompt_rules()
e.client=e.bq=object();e.lock=threading.Lock();generated=[];executed=[]
sql="""WITH per_transaction AS (
SELECT hash, COUNT(DISTINCT address) AS address_count
FROM \`bigquery-public-data.crypto_bitcoin.transactions\`
CROSS JOIN UNNEST(outputs) AS output
CROSS JOIN UNNEST(output.addresses) AS address
WHERE block_timestamp_month = DATE '2024-01-01'
GROUP BY hash)
SELECT CASE WHEN address_count = 1 THEN '1件' WHEN address_count BETWEEN 2 AND 3 THEN '2〜3件' WHEN address_count BETWEEN 4 AND 9 THEN '4〜9件' ELSE '10件以上' END AS address_count_band, COUNT(1) AS transaction_count
FROM per_transaction GROUP BY address_count_band ORDER BY transaction_count DESC"""
m.report.generate_request=lambda _client,_model,request,rules:(generated.append([request,rules]) or ({"sql":sql,"reason":"二段階で展開","undefined_terms":[]},{"input_tokens":1,"output_tokens":1}))
def execute(_bq,source,**kwargs):
 executed.append([source,kwargs])
 return (([("1件",10),("2〜3件",4)], ["address_count_band","transaction_count"]),None)
m.report.exec_bq=execute;events=[]
e.query(m.bitcoin.EXAMPLE_QUESTION,events.append,profile="bitcoin")
bad=sql.replace("bigquery-public-data.crypto_bitcoin", "bigquery-public-data.ga4_obfuscated_sample_ecommerce")
_,bad_error=m.report.validate_sql(bad,m.bitcoin.DATASET)
period_error=""
try:m.bitcoin.require_sql_period(sql.replace("2024-01-01","2024-02-01"),m.bitcoin.period_for_question(m.bitcoin.EXAMPLE_QUESTION))
except ValueError as error:period_error=str(error)
print(json.dumps({
 "types":[event["type"] for event in events],
 "visualization":events[-1]["visualization"],
 "columns":events[-1]["columns"],
 "request_has_partition":"block_timestamp_month = DATE '2024-01-01'" in generated[0][0],
 "rules_has_nested":"output.addresses" in generated[0][1],
 "allowed":executed[0][1]["allowed_dataset"],
 "max_results":executed[0][1]["max_results"],
 "bad_error":bad_error,
 "period_error":period_error,
},ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    types: ['stage', 'sql', 'stage', 'result'],
    visualization: 'bar',
    columns: ['address_count_band', 'transaction_count'],
    request_has_partition: true,
    rules_has_nested: true,
    allowed: 'bigquery-public-data.crypto_bitcoin',
    max_results: 101,
    bad_error:
      'rejected: foreign table ref `bigquery-public-data.ga4_obfuscated_sample_ecommerce.transactions`',
    period_error: '生成SQLの対象期間が問い合わせの2024年1月と一致しません。',
  });
});

test('Bitcoin query quotes the reserved hash column before BigQuery execution', () => {
  const result = python(`
import threading
e=object.__new__(m.LiveQueryEngine);e.model=m.report.DEFAULT_MODEL
e.spec=json.loads((m.HERE/"report.json").read_text());e.rules="";e.bitcoin_rules=m.bitcoin.prompt_rules()
e.client=e.bq=object();e.lock=threading.Lock();executed=[]
sql="""WITH tx_address_counts AS (
    SELECT
        t.hash,
        COUNT(DISTINCT addr) AS unique_address_count
    FROM \`bigquery-public-data.crypto_bitcoin.transactions\` AS t,
        UNNEST(t.outputs) AS o,
        UNNEST(o.addresses) AS addr
    WHERE t.block_timestamp_month = DATE '2024-01-01'
    GROUP BY t.hash
),
tx_bands AS (
    SELECT
        HASH,
        CASE WHEN unique_address_count = 1 THEN '1件'
             WHEN unique_address_count BETWEEN 2 AND 3 THEN '2〜3件'
             WHEN unique_address_count BETWEEN 4 AND 9 THEN '4〜9件'
             WHEN unique_address_count >= 10 THEN '10件以上'
        END AS address_count_band
    FROM tx_address_counts
    WHERE unique_address_count > 0
)
SELECT address_count_band, COUNT(1) AS transaction_count
FROM tx_bands
GROUP BY address_count_band
ORDER BY transaction_count DESC"""
m.report.generate_request=lambda *_args:({"sql":sql,"reason":"二段階で展開","undefined_terms":[]},{"input_tokens":1,"output_tokens":1})
def execute(_bq,source,**_kwargs):
 executed.append(source)
 return (([("1件",10)], ["address_count_band","transaction_count"]),None)
m.report.exec_bq=execute;events=[]
e.query(m.bitcoin.EXAMPLE_QUESTION,events.append,profile="bitcoin")
shown=next(event["sql"] for event in events if event["type"]=="sql")
quoted=chr(96)+"hash"+chr(96)
protected="SELECT t.hash, 'hash', "+quoted+" -- hash\\n/* hash */ FROM source"
protected_once=m.bitcoin.quote_reserved_hash_identifiers(protected)
long_literal="SELECT '"+(chr(92)+"!")*2000+"hash'"
print(json.dumps({
 "executed_quoted":("SELECT\\n        "+quoted+",") in executed[0],
 "display_quoted":quoted in shown,
 "qualified_unchanged":"t.hash" in executed[0],
 "prompt_guard":"予約語" in e.bitcoin_rules and quoted in e.bitcoin_rules,
 "protected_unchanged":protected_once==protected,
 "idempotent":m.bitcoin.quote_reserved_hash_identifiers(executed[0])==executed[0],
 "long_literal_unchanged":m.bitcoin.quote_reserved_hash_identifiers(long_literal)==long_literal,
},ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    executed_quoted: true,
    display_quoted: true,
    qualified_unchanged: true,
    prompt_guard: true,
    protected_unchanged: true,
    idempotent: true,
    long_literal_unchanged: true,
  });
});

test('planning calls Vertex only and a confirmed plan narrows dashboard panels', () => {
  const result = python(`
import threading
e=object.__new__(m.LiveQueryEngine);e.model=m.report.DEFAULT_MODEL;e.metrics="metrics";e.client=object();e.lock=threading.Lock()
raw={"status":"proposed","objective":"2021年1月の購入成果を改善するダッシュボードを作って","objective_summary":"目的","audience":"責任者","comparison":"月内比較","period":m.period_for_question("2021年1月"),"hypotheses":["仮説"],"clarifications":[],"answers":{"audience":"責任者"},"organization_context_revision":"demo-org-ec-v1","panels":[{"id":panel_id,**m.planner.PANEL_CATALOG[panel_id],"reason":"理由"} for panel_id in ["R4","R9","R16","R17"]],"revision":"plan-test"}
calls=[]
m.planner.propose=lambda *_args:(calls.append("vertex") or (raw,{"input_tokens":10,"output_tokens":5}))
events=[];e.plan(raw["objective"],raw["answers"],events.append)
spec=json.loads((m.HERE/"report.json").read_text());period,sections=m.dashboard_sections(spec,raw["objective"],["R4","R9","R16","R17"])
confirmed=m.planner.confirm_plan(raw)
print(json.dumps({"calls":calls,"events":[event["type"] for event in events],"ids":[section["id"] for section in sections],"period":period["label"],"confirmed":confirmed["status"]},ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    calls: ['vertex'],
    events: ['plan_stage', 'plan'],
    ids: ['R4', 'R9', 'R16', 'R17'],
    period: '2021年1月',
    confirmed: 'confirmed',
  });
});

test('dashboard UI separates consultation from confirmed paid build', () => {
  const result = python(`
html=m.HTML
print(json.dumps({
 "copy":all(value in html for value in ["AIと分析計画を相談","仕様を確定するまでBigQueryは実行しません","この仕様を確定してbuild"]),
 "review":all(value in html for value in ['id="plan-review"','id="plan-clarifications"','id="plan-panels"','id="plan-revision"']),
 "flow":all(value in html for value in ['/api/plan','answers:currentAnswers','analysis_plan:pendingPlan','selected.size<4']),
 "memory":all(value in html for value in ["organization_context_revision","ローカルデモfixture・本番メモリー未接続"]),
}))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    copy: true,
    review: true,
    flow: true,
    memory: true,
  });
});

test('dashboard and single-graph progress both expose active and completed states', () => {
  const result = python(`
html=m.HTML
print(json.dumps({
 "dashboard_steps":all(value in html for value in ['id="dashboard-step-plan"','id="dashboard-step-review"','id="dashboard-step-build"']),
 "dashboard_styles":all(value in html for value in [".plan-item.active",".plan-item.done"]),
 "dashboard_transitions":all(value in html for value in ['dashboardStage("plan")','dashboardStage("review")','dashboardStage("build")','dashboardStage("complete")']),
 "graph_transitions":all(value in html for value in ["function stage(name)",".stages .active",".stages .done"]),
}))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    dashboard_steps: true,
    dashboard_styles: true,
    dashboard_transitions: true,
    graph_transitions: true,
  });
});

test('single and dashboard SQL areas provide an accessible clipboard action', () => {
  const result = python(`
html=m.HTML
print(json.dumps({
 "single":all(value in html for value in ['class="sql-shell"','id="sql-copy"','aria-label="SQLをコピー"']),
 "dashboard":all(value in html for value in ["makeCopyButton(sql)","codeShell.append(copy,sql)"]),
 "clipboard":all(value in html for value in ["navigator.clipboard.writeText(target.textContent)","SQLをコピーしました","SQLのコピーに失敗しました"]),
}))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    single: true,
    dashboard: true,
    clipboard: true,
  });
});

test('chart values use bounded Japanese number formatting without changing raw tables', () => {
  const rendered = python('print(m.HTML)');
  assert.equal(rendered.status, 0, rendered.stderr);
  const script = rendered.stdout.split('<script>').at(-1)?.split('</script>')[0] ?? '';
  const start = script.indexOf('function chartValue(');
  const end = script.indexOf('function renderSql(');
  assert.ok(start >= 0 && end > start, 'chartValue must be defined before renderSql');
  const values = vm.runInNewContext(
    `${script.slice(start, end)};[
      chartValue(118380.0,"sessions",true),
      chartValue(895.0,"purchases"),
      chartValue(57350.1256,"revenue"),
      chartValue(14.5659,"repeat_user_rate"),
      chartValue(49.509999,"average_engagement"),
      chartValue("organic","medium"),
    ]`,
  );
  assert.deepEqual([...values], ['118,380', '895', '57,350.13', '14.57', '49.51', 'organic']);
  assert.ok(script.includes('textContent:chartValue(r.rows[0][0],r.columns[0],true)'));
  assert.ok(script.includes('value.textContent=chartValue(r.rows[0][index],column)'));
  assert.ok(script.includes('textContent:chartValue(r.rows[0][index],column,true)'));
  assert.ok(script.includes('textContent=chartValue(x[1],r.columns?.[1]??"")'));
  assert.ok(
    script.includes('replaceChildren(table(result.columns,result.rows))'),
    'the audit table must retain raw query values',
  );
});

test('meeting report click gives immediate feedback and surfaces missing revision or dialog failure', () => {
  const rendered = python('print(m.HTML)');
  assert.equal(rendered.status, 0, rendered.stderr);
  const script = rendered.stdout.split('<script>').at(-1)?.split('</script>')[0] ?? '';
  const start = script.indexOf('function requestMeetingReport(');
  const end = script.indexOf('configureCopyButton($("sql-copy")');
  assert.ok(start >= 0 && end > start, 'meeting report request handler must be explicit');
  const source = script.slice(start, end);
  assert.ok(source.includes('費用確認待ち'));
  assert.ok(source.includes('会議報告案を生成できるbuild結果がありません。'));
  assert.ok(source.includes('費用確認ダイアログを開けませんでした。'));
  assert.ok(script.includes('$("report-submit").onclick=requestMeetingReport'));

  function invoke(revision: string | null, showCost: () => void) {
    const elements = {
      'dashboard-message': { className: '', textContent: '' },
      'dashboard-status': { textContent: '' },
    };
    vm.runInNewContext(
      `let latestBuildRevision=${JSON.stringify(revision)};
       const $=id=>elements[id];
       ${source}
       requestMeetingReport();`,
      { elements, showCost },
    );
    return elements;
  }

  const missing = invoke(null, () => assert.fail('must not open the cost dialog'));
  assert.equal(missing['dashboard-status'].textContent, 'エラー');
  assert.equal(
    missing['dashboard-message'].textContent,
    '会議報告案を生成できるbuild結果がありません。',
  );

  let requestedMode = '';
  const waiting = invoke('build-1', (mode?: string) => {
    requestedMode = mode ?? '';
  });
  assert.equal(requestedMode, 'report');
  assert.equal(waiting['dashboard-status'].textContent, '費用確認待ち');

  const failed = invoke('build-1', () => {
    throw new Error('dialog unavailable');
  });
  assert.equal(failed['dashboard-status'].textContent, 'エラー');
  assert.equal(failed['dashboard-message'].textContent, '費用確認ダイアログを開けませんでした。');
});

test('dashboard UI accepts recommended clarification answers without forced re-proposal', () => {
  const result = python(`
html=m.HTML
print(json.dumps({
 "accepted_copy":all(value in html for value in ["推奨回答を採用済み（編集可）","AIに再提案（任意）"]),
 "captures_defaults":"currentAnswers[item.field]=input.value.trim()" in html,
 "syncs_edits":"input.oninput=syncClarificationAnswers" in html,
 "build_collects":'collectAnswers();pendingPlan=selectedPlan();showCost("dashboard-build")' in html,
 "minimal_panels":"map(panel=>({id:panel.id,reason:panel.reason}))" in html,
 "not_length_blocked":"plan.clarifications.length>0" not in html,
}))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    accepted_copy: true,
    captures_defaults: true,
    syncs_edits: true,
    build_collects: true,
    minimal_panels: true,
    not_length_blocked: true,
  });
});

test('confirmed dashboard freezes provenance and meeting report reuses it without BigQuery', () => {
  const result = python(`
import threading
e=object.__new__(m.LiveQueryEngine);e.model=m.report.DEFAULT_MODEL
e.spec=json.loads((m.HERE/"report.json").read_text());e.metric_definitions=json.loads((m.HERE/"metrics.json").read_text())
e.client=e.bq=object();e.lock=threading.Lock();e.latest_dashboard=None
plan={"objective":"2021年1月の購入成果を改善するダッシュボードを作って","objective_summary":"購入成果の課題を判断する","audience":"月次会議","comparison":"月内推移","period":m.period_for_question("2021年1月"),"hypotheses":["導線に課題がある"],"clarifications":[],"answers":{"audience":"月次会議"},"panels":[{"id":panel_id,"reason":"必要"} for panel_id in ["R4","R9","R16","R17"]]}
rows={"R4":[[895,123456.0]],"R9":[[100,50,20]],"R16":[["2021-01-31",118380,117000.5]],"R17":[["1. 入口: /","2. /shop",5]]}
columns={"R4":["購入件数","購入金額"],"R9":["閲覧","カート","購入"],"R16":["日付","セッション数","7日移動平均"],"R17":["source","target","sessions"]}
def run_section(section,period,emit,context=None,profile="ga4"):
 emit({"type":"sql","sql":"SELECT value FROM source","sql_sha256":"1"*16,**context})
 emit({"type":"result","columns":columns[section["id"]],"rows":rows[section["id"]],"verification":"matched","verification_label":"照合済み","visualization":section["component"],**context})
 return .1
e._run_section=run_section;events=[];e.dashboard(plan["objective"],events.append,plan);bundle=e.latest_dashboard
raw={"executive_summary":"追加診断が必要です。","observations":[{"text":"購入件数は895件です。","panel_ids":["R4"]}],"interpretations":[{"text":"変動があります。","uncertainty":"施策履歴がありません。","panel_ids":["R16"]}],"hypotheses":[{"text":"導線に課題がある可能性があります。","validation":"流入別に検証します。","panel_ids":["R9"]}],"actions":[{"text":"導線を確認します。","owner":"マーケティング責任者","urgency":"次回会議まで","expected_impact":"阻害箇所を特定できます。","next_step":"流入別に比較します。","success_metric":"購入件数","panel_ids":["R4"]}],"limitations":["目標値と施策履歴が未登録です。"]}
calls=[]
m.meeting.generate=lambda _client,_model,current:(calls.append(current["build_revision"]) or (m.meeting.normalize_report(raw,current),{"input_tokens":10,"output_tokens":5}))
report_events=[];e.meeting_report(bundle["build_revision"],report_events.append)
error=""
try:e.meeting_report("build-000000000000",lambda _event:None)
except m.LiveDemoError as caught:error=str(caught)
funnel=next(panel for panel in bundle["panels"] if panel["id"]=="R9")
print(json.dumps({"dashboard_complete":events[-1]["build_revision"],"build":bundle["build_revision"],"plan":bundle["analysis_specification"]["revision"],"organization":bundle["organization_context"]["goal"],"metric":"購入件数" in bundle["metric_definitions"]["metrics"],"result_revision":bundle["panels"][0]["result_revision"],"sql":bundle["panels"][0]["sql_sha256"],"funnel_rate":funnel["derived_metrics"][0]["value"],"report_types":[event["type"] for event in report_events],"report_revision":report_events[-1]["report"]["report_revision"],"citation":report_events[-1]["report"]["observations"][0]["evidence_refs"][0],"calls":calls,"error":error},ensure_ascii=False))
`);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.dashboard_complete, output.build);
  assert.match(output.build, /^build-[0-9a-f]{12}$/);
  assert.match(output.plan, /^plan-[0-9a-f]{12}$/);
  assert.equal(output.organization, '購入成果を伸ばし、訪問者の継続利用を改善する');
  assert.equal(output.metric, true);
  assert.match(output.result_revision, /^result-[0-9a-f]{12}$/);
  assert.equal(output.sql, '1111111111111111');
  assert.equal(output.funnel_rate, 50);
  assert.deepEqual(output.report_types, ['report_stage', 'meeting_report']);
  assert.match(output.report_revision, /^report-[0-9a-f]{12}$/);
  assert.equal(output.citation.result_revision, output.result_revision);
  assert.deepEqual(output.calls, [output.build]);
  assert.equal(output.error, '指定したbuild revisionの根拠bundleがありません。');
});

test('meeting report UI is explicit about cost, evidence, approval, and prototype limits', () => {
  const result = python(`
html=m.HTML
print(json.dumps({
 "action":all(value in html for value in ["この結果から会議報告案を生成","/api/report","latestBuildRevision"]),
 "cost":all(value in html for value in ["BigQueryは再実行しません","BigQuery ¥0（保存済み集計bundleだけを参照）","今回の報告案 最大約¥25","根拠bundle 48 KiB・出力8,192 tokens上限・思考tokensを含む"]),
 "evidence":all(value in html for value in ["result_revision","sql_sha256","期待効果"]),
 "summary_citation":'$("report-summary").replaceChildren(citedItem(report.executive_summary))' in html,
 "approval":all(value in html for value in ["AIが作成した未承認案","外部共有前に人間が根拠と表現を確認"]),
 "safe":"innerHTML" not in html,
},ensure_ascii=False))`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    action: true,
    cost: true,
    evidence: true,
    summary_citation: true,
    approval: true,
    safe: true,
  });
});
