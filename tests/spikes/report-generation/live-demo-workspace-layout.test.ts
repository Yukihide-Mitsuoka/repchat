import test from 'node:test';
import assert from 'node:assert/strict';
import { python } from './live-demo-test-helpers.ts';

test('workspace pane controls stay viewport-anchored and expose their state visually', () => {
  const rendered = python('print(m.HTML)');
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.match(rendered.stdout, /#sidebar-toggle,#inspector-toggle\{position:fixed/);
  assert.match(rendered.stdout, /#sidebar-toggle\{left:8px\}#inspector-toggle\{right:8px\}/);
  assert.match(rendered.stdout, /function paneIcon\(side,expanded\)/);
  assert.match(rendered.stdout, /button\.dataset\.state=expanded\?"open":"closed"/);
  assert.match(rendered.stdout, /replaceChildren\(paneIcon\(side,expanded\)\)/);
  assert.match(rendered.stdout, /成果物パネルを展開/);
});

test('shared composer stays readable, grows upward, and routes through cost gates', () => {
  const rendered = python('print(m.HTML)');
  assert.equal(rendered.status, 0, rendered.stderr);
  const script = rendered.stdout.split('<script>').at(-1)?.split('</script>')[0] ?? '';
  assert.ok(script.includes('function submitComposer()'));
  assert.ok(script.includes('showCost("dashboard-plan")'));
  assert.ok(script.includes('showCost("graph")'));
  assert.ok(script.includes('showCost("report")'));
  assert.ok(script.includes('$("artifact-preview-host").appendChild($("output"))'));
  assert.ok(script.includes('selectWorkspace("build");setComposerAction("dashboard",false)'));
  assert.match(
    rendered.stdout,
    /width:min\(768px,calc\(100vw - var\(--nav-column\) - var\(--nav-grip\) - var\(--inspector-column\) - var\(--inspector-grip\) - 48px\)\)/,
  );
  assert.match(rendered.stdout, /\.analysis-composer\{[^}]*border-radius:22px/);
  assert.match(rendered.stdout, /#composer-input\{[^}]*max-height:none[^}]*overflow-y:hidden/);
  assert.ok(script.includes('function resizeComposerInput()'));
  assert.ok(script.includes('input.style.height=`${input.scrollHeight}px`'));
  assert.ok(script.includes('$("composer-input").addEventListener("input",resizeComposerInput)'));
  assert.match(
    rendered.stdout,
    /@media\(max-width:960px\)\{\.analysis-composer\{[^}]*width:min\(768px,calc\(100vw - 24px\)\)/,
  );
});

test('completed dashboards enter an accessible reading mode without losing chat', () => {
  const rendered = python('print(m.HTML)');
  assert.equal(rendered.status, 0, rendered.stderr);
  const script = rendered.stdout.split('<script>').at(-1)?.split('</script>')[0] ?? '';
  assert.ok(rendered.stdout.includes('id="composer-launcher"'));
  assert.ok(rendered.stdout.includes('aria-label="AIへの相談入力を開く"'));
  assert.ok(rendered.stdout.includes('id="composer-collapse"'));
  assert.match(
    rendered.stdout,
    /\.analysis-composer\.composer-collapsed\{[^}]*width:auto[^}]*box-shadow:none/,
  );
  assert.ok(script.includes('function collapseComposer()'));
  assert.ok(
    script.includes(
      'function collapseComposerFromControl(){collapseComposer();$("composer-launcher").focus()}',
    ),
  );
  assert.ok(script.includes('function expandComposer(focusInput=true)'));
  assert.ok(script.includes('function enterDashboardReadingMode()'));
  assert.ok(
    script.includes(
      'if(!$("app-shell").classList.contains("inspector-collapsed"))toggleInspector()',
    ),
  );
  assert.ok(script.includes('$("composer-launcher").onclick=()=>expandComposer()'));
  assert.ok(script.includes('$("composer-collapse").onclick=collapseComposerFromControl'));
  assert.ok(script.includes('selectWorkspace("dashboard");enterDashboardReadingMode()'));
  assert.ok(
    script.includes(
      'if(view!=="dashboard"){$("analysis-composer").classList.remove("dashboard-ready");expandComposer(false)}',
    ),
  );
});

test('dashboard resizes every shared row without free rearrangement', () => {
  const rendered = python('print(m.HTML)');
  assert.equal(rendered.status, 0, rendered.stderr);
  const script = rendered.stdout.split('<script>').at(-1)?.split('</script>')[0] ?? '';
  assert.ok(script.includes('function groupDashboardPanelRow(ids,initialShares)'));
  assert.ok(
    script.includes('e.layout_rows.forEach(row=>groupDashboardPanelRow(row.panel_ids,row.shares))'),
  );
  assert.ok(script.includes('separator.setAttribute("role","separator")'));
  assert.ok(script.includes('separator.setAttribute("aria-valuemin"'));
  assert.ok(script.includes('separator.setAttribute("aria-valuemax"'));
  assert.ok(script.includes('separator.setAttribute("aria-valuenow"'));
  assert.ok(script.includes('separator.onpointerdown='));
  assert.ok(script.includes('separator.onpointermove='));
  assert.ok(script.includes('separator.onkeydown='));
  assert.match(rendered.stdout, /\.dashboard-layout-row\{[^}]*display:grid/);
  assert.match(rendered.stdout, /\.dashboard-grid\{[^}]*container-type:inline-size/);
  assert.match(rendered.stdout, /\.dashboard-card-resizer\{[^}]*cursor:col-resize/);
  assert.match(
    rendered.stdout,
    /@container \(max-width:900px\)\{\.dashboard-layout-row\{grid-template-columns:minmax\(0,1fr\)!important;gap:14px\}\.dashboard-layout-row>\.dashboard-card\{grid-column:1!important/,
  );
  assert.match(
    rendered.stdout,
    /\.dashboard-layout-row\{grid-column:1;grid-template-columns:minmax\(0,1fr\)!important;gap:14px\}/,
  );
  assert.doesNotMatch(script, /draggable\s*=|ondragstart|Sortable/);
});

test('dashboard cards in the same row share height while content stays top-aligned', () => {
  const rendered = python('print(m.HTML)');
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.match(rendered.stdout, /\.dashboard-layout-row\{[^}]*align-items:stretch/);
  assert.match(
    rendered.stdout,
    /\.dashboard-card \.chart\{[^}]*align-items:start[^}]*overflow:visible[^}]*flex:1/,
  );
  assert.match(
    rendered.stdout,
    /\.dashboard-layout-row>\.dashboard-card \.chart\{[^}]*max-height:460px[^}]*overflow:auto/,
  );
  assert.match(
    rendered.stdout,
    /\.dashboard-layout-row>\.dashboard-card \.chart\{display:flex;flex:1;min-height:0;overflow:hidden\}/,
  );
  assert.match(
    rendered.stdout,
    /\.dashboard-layout-row>\.dashboard-card \.echart-root\{flex:1 1 auto;height:100%!important;min-height:300px\}/,
  );
  assert.ok(
    rendered.stdout.indexOf(
      '.dashboard-layout-row>.dashboard-card .chart{max-height:460px;overflow:auto}',
    ) <
      rendered.stdout.indexOf(
        '@container (max-width:900px){.dashboard-layout-row{grid-template-columns:',
      ),
    'the single-column container override must follow the desktop height cap',
  );
  assert.match(rendered.stdout, /\.chart-table-scroll\{[^}]*max-height:360px[^}]*overflow:auto/);
  assert.match(rendered.stdout, /\.chart-table-scroll th,[^}]*overflow-wrap:anywhere/);
});

test('left navigation stays compact and scrolls long titles only on interaction', () => {
  const rendered = python('print(m.HTML)');
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.match(rendered.stdout, /class="sidebar-title"><span>購入成果改善ダッシュボード<\/span>/);
  assert.match(
    rendered.stdout,
    /class="sidebar-chrome"><span class="brand">RepChat<\/span><\/div>/,
  );
  assert.doesNotMatch(rendered.stdout, /<span>Analysis workspace<\/span>/);
  assert.match(rendered.stdout, /\.workspace-sidebar\{[^}]*padding:0 4px 8px/);
  assert.match(
    rendered.stdout,
    /\.workspace-nav button\{[^}]*grid-template-columns:16px minmax\(0,1fr\);column-gap:4px[^}]*padding:6px 4px[^}]*overflow:hidden/,
  );
  assert.match(rendered.stdout, /\.sidebar-label\{margin:12px 5px 4px/);
  assert.match(
    rendered.stdout,
    /\.sidebar-title>span\{[^}]*width:max-content[^}]*white-space:nowrap/,
  );
  assert.match(rendered.stdout, /@keyframes sidebar-title-marquee/);
  assert.match(
    rendered.stdout,
    /\.workspace-nav button:focus-visible\{outline:2px solid #7fa2c2;outline-offset:-2px\}/,
  );
  assert.match(
    rendered.stdout,
    /button:hover \.sidebar-title>span,\.workspace-nav button:focus-visible \.sidebar-title>span\{animation:sidebar-title-marquee/,
  );
});

test('pane splitters keep an accessible hit area without visible layout gaps', () => {
  const rendered = python('print(m.HTML)');
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.match(
    rendered.stdout,
    /--nav-grip:1px;--inspector-column:var\(--inspector-width\);--inspector-grip:1px/,
  );
  assert.match(
    rendered.stdout,
    /\.navigation-resizer,\.inspector-resizer\{[^}]*width:var\(--splitter-hit-area\)[^}]*justify-self:center/,
  );
  assert.match(
    rendered.stdout,
    /\.navigation-resizer::after,\.inspector-resizer::after\{left:50%;transform:translateX\(-50%\)\}/,
  );
  assert.match(rendered.stdout, /\.sidebar-chrome\{[^}]*margin:0 -4px/);
  assert.match(rendered.stdout, /\.sidebar-account\{[^}]*margin-right:-4px;margin-left:-4px/);
});

test('analysis workspace visual hierarchy protects charts and the main surface', () => {
  const result = python(`
html=m.HTML
print(json.dumps({
 "tokens":all(value in html for value in ["--radius-card:12px","--shadow-card:","--color-background:"]),
 "hierarchy":all(value in html for value in [".dashboard-layout-row>.dashboard-card{grid-column:auto!important;min-height:268px", ".dashboard-layout-row>.dashboard-card{grid-column:1!important;min-height:340px}"]),
 "overflow":all(value in html for value in ["body{overflow-x:hidden", ".dashboard-card .chart svg{display:block;min-width:0;width:100%;max-width:100%}"]),
 "responsive":all(value in html for value in ["@media(max-width:1180px)","position:fixed","@media(max-width:960px)","@media(max-width:760px)"]),
 "accessible":all(value in html for value in [":focus-visible","prefers-reduced-motion:reduce","outline:3px solid var(--color-focus)"]),
}))
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    tokens: true,
    hierarchy: true,
    overflow: true,
    responsive: true,
    accessible: true,
  });
});

test('analysis workspace starts with overlays closed on narrow viewports', () => {
  const rendered = python('print(m.HTML)');
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.match(rendered.stdout, /window\.innerWidth<=1180/);
  assert.match(rendered.stdout, /window\.innerWidth<=960/);
  assert.match(rendered.stdout, /!\$\("app-shell"\)\.classList\.contains\("inspector-collapsed"\)/);
});

test('workspace panes own the full height while the header belongs to the main column', () => {
  const rendered = python('print(m.HTML)');
  assert.equal(rendered.status, 0, rendered.stderr);
  const html = rendered.stdout;
  const shell = html.indexOf('id="app-shell"');
  const sidebar = html.indexOf('id="workspace-sidebar"');
  const header = html.indexOf('class="app-header"');
  const main = html.indexOf('id="workspace-main"');
  const inspector = html.indexOf('id="panel-inspector"');
  assert.ok(shell < sidebar && sidebar < header && header < main && main < inspector);
  assert.match(html, /grid-template-rows:44px minmax\(0,1fr\)/);
  assert.match(html, /\.workspace-sidebar\{grid-column:1;grid-row:1\/3/);
  assert.match(html, /\.workspace-inspector\{grid-column:5;grid-row:1\/3/);
  assert.match(html, /\.app-header\{grid-column:3;grid-row:1/);
  assert.match(html, /class="sidebar-chrome"><span class="brand">RepChat/);
  assert.match(html, /id="compact-title" class="header-title">分析ワークスペース/);
  assert.doesNotMatch(html, /<span class="brand">RepChat<\/span><span>Live analysis demo/);
});

test('selected workspace title is compact and not repeated above the main content', () => {
  const rendered = python('print(m.HTML)');
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.match(rendered.stdout, /\.workspace-topbar\{display:none\}/);
  assert.match(
    rendered.stdout,
    /selectWorkspace=view=>\{baseSelectWorkspace\(view\);\$\("compact-title"\)\.textContent=\$\("page-title"\)\.textContent;/,
  );
  assert.match(
    rendered.stdout,
    /build:\["購入成果を改善する","AIと目的・KPI・比較軸を相談し、確認した仕様だけをbuildします。","分析スレッド"\]/,
  );
  assert.doesNotMatch(rendered.stdout, /id="workspace-back"|id="workspace-forward"/);
});

test('workspace chrome uses compact controls and separates splitter hit area from its hairline', () => {
  const rendered = python('print(m.HTML)');
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.match(rendered.stdout, /--header-height:44px/);
  assert.match(rendered.stdout, /--icon-button-size:32px/);
  assert.match(rendered.stdout, /--splitter-hit-area:8px/);
  assert.match(rendered.stdout, /--splitter-line:1px/);
  assert.match(
    rendered.stdout,
    /\.app-shell\.inspector-collapsed \.workspace-inspector,[^}]+display:none;overflow:hidden/,
  );
  assert.match(
    rendered.stdout,
    /\.app-shell\.sidebar-collapsed \.navigation-resizer,[^}]+display:none/,
  );
  assert.match(rendered.stdout, /font-weight:500/);
  assert.doesNotMatch(rendered.stdout, /font-weight:800/);
});
