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
 "copy":all(x in html for x in ["Vertex AI 約¥0.2","BigQuery 最大40 GiB","最大約¥38","合計最大約¥39","無料枠やキャッシュで0円"]),
 "dialog":all(x in html for x in ['<dialog id="cost-dialog"','aria-labelledby="cost-title"','id="cancel-cost"','id="confirm-cost"']),
 "actions":all(x in html for x in ['$("cost-dialog").showModal()','$("cost-dialog").close()','$("confirm-cost").onclick=()=>pendingMode==="dashboard"?runDashboard():runQuery()']),
 "dashboard":all(x in html for x in ["Vertex AI 約¥1.2（SQL生成6回）","BigQuery 最大240 GiB","最大12クエリ","合計最大約¥230"]),
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
    textContent = '';
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
    textContent = '';
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
    },
    $: () => chart,
    result: {
      rows: [
        ['1. 入口: /', '2. /shop', 120],
        ['2. /shop', '3. /cart', 48],
      ],
      columns: ['source', 'target', 'sessions'],
      visualization: 'sankey',
    },
  };
  assert.doesNotThrow(() => vm.runInNewContext(`${functions}\ngraph(result);`, context));
  assert.equal(chart.children[0]?.tag, 'svg');
  const tags = chart.children[0]?.children.map((child) => child.tag) ?? [];
  assert.ok(tags.includes('path'), 'Sankey links should be SVG paths');
  assert.ok(tags.includes('rect'), 'Sankey nodes should be SVG rectangles');
  const descendants = (element: ElementStub): ElementStub[] => [
    element,
    ...element.children.flatMap(descendants),
  ];
  const elements = descendants(chart.children[0]);
  const gradients = elements.filter((element) => element.tag === 'linearGradient');
  const nodeColors = new Set(
    elements.filter((element) => element.tag === 'rect').map((element) => element.attributes.fill),
  );
  const linkStrokes = elements
    .filter((element) => element.tag === 'path')
    .map((element) => element.attributes.stroke);
  assert.equal(gradients.length, 2, 'each transition should have a color gradient');
  assert.ok(nodeColors.size >= 3, 'different page types should use different node colors');
  assert.ok(
    linkStrokes.every((stroke) => stroke?.startsWith('url(#sankey-link-') === true),
    'each transition should reference its own source-to-target gradient',
  );
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
 sql=f"SELECT 1 AS value FROM \`bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*\` WHERE _TABLE_SUFFIX BETWEEN '20201201' AND '20201231' LIMIT 1 /* {section['id']} */"
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
s=m.create_server("127.0.0.1",0,E());t=threading.Thread(target=s.serve_forever,daemon=True);t.start();base=f"http://127.0.0.1:{s.server_port}";statuses=[]
try:
 page=urllib.request.urlopen(base+"/").read().decode()
 req=urllib.request.Request(base+"/api/query",data=json.dumps({"question":"2021年1月のセッション数を出して"}).encode(),headers={"content-type":"application/json","origin":base},method="POST")
 value=json.loads(urllib.request.urlopen(req).read().decode())["rows"][0][0]
 dashboard_req=urllib.request.Request(base+"/api/dashboard",data=json.dumps({"question":"2021年1月のECサイト分析ダッシュボードを作って"}).encode(),headers={"content-type":"application/json","origin":base},method="POST")
 dashboard_count=json.loads(urllib.request.urlopen(dashboard_req).read().decode())["panel_count"]
 for ct,origin in [("text/plain",base),("application/json","https://attacker.example")]:
  try:urllib.request.urlopen(urllib.request.Request(base+"/api/query",data=b"{}",headers={"content-type":ct,"origin":origin},method="POST"))
  except urllib.error.HTTPError as e:statuses.append(e.code)
 print(json.dumps({"form":"日本語の問い合わせ" in page,"value":value,"dashboard_count":dashboard_count,"statuses":statuses}))
finally:s.shutdown();s.server_close();t.join()
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.split('\n').at(-2) ?? ''), {
    form: true,
    value: 118380,
    dashboard_count: 6,
    statuses: [415, 403],
  });
  const bind = spawnSync(
    'python3',
    [LIVE, '--project', 'example-project', '--host', '0.0.0.0', '--no-open'],
    { cwd: ROOT, encoding: 'utf8' },
  );
  assert.equal(bind.status, 2);
  assert.match(bind.stderr, /host must remain localhost-only/);
});
