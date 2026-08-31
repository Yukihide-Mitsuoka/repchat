import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { python } from './live-demo-test-helpers.ts';

test('live prompt uses an accessible in-page cost dialog before sending the request', () => {
  const result = python(`
html=m.HTML
print(json.dumps({
 "copy":all(x in html for x in ["Vertex AI 最大約¥2","BigQuery 最大20 GiB","最大約¥19","合計最大約¥21","無料枠やキャッシュで0円"]),
 "dialog":all(x in html for x in ['<dialog id="cost-dialog"','aria-labelledby="cost-title"','id="cancel-cost"','id="confirm-cost"']),
 "actions":all(x in html for x in ['$("cost-dialog").showModal()','$("cost-dialog").close()','pendingMode==="dashboard-plan"?runPlan():pendingMode==="dashboard-build"?runDashboard():pendingMode==="report"?runMeetingReport():runQuery()']),
 "dashboard":all(x in html for x in ["今回の相談 約¥1","BigQuery ¥0（仕様確定前は実行しません）","count*20","count*21"]),
 "portable":"confirm(COST_CONFIRMATION)" not in html,
 "progress":all(x in html for x in ["生成の進行状況","実行前","問い合わせを入力し、生成ボタンを押してください。","SQLを作る","安全性を確認","データを取得","結果を可視化"])
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
