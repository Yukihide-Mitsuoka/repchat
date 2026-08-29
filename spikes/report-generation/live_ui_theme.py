"""Base visual theme for the localhost live workspace."""

WORKSPACE_THEME_CSS = r"""
:root{
--color-background:#f3f5f7;
--color-surface-raised:#fff;
--color-border-strong:#cbd2dc;
--color-focus:#1f4e7940;
--color-success:#18794e;
--color-success-soft:#eaf7f0;
--radius-control:8px;
--radius-card:12px;
--shadow-card:0 1px 2px #1018280d,0 8px 24px #1018280a;
--shadow-pane:0 18px 48px #1018281f;
}
html{-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
body{overflow-x:hidden;background:var(--color-background);font-size:14px}
button,textarea,select{transition:border-color 120ms ease,background 120ms ease,box-shadow 120ms ease,transform 120ms ease}
button{min-height:36px;border-radius:var(--radius-control);padding:8px 14px;letter-spacing:.01em}
button:active:not(:disabled){transform:translateY(1px)}
:focus-visible{outline:3px solid var(--color-focus);outline-offset:2px}
textarea,select{border-color:var(--color-border-strong);border-radius:var(--radius-control)}
.app-header{position:sticky;top:0;z-index:50;background:#ffffffed;backdrop-filter:blur(14px);border-color:#e3e7ed;box-shadow:0 1px 0 #10182808}
.brand{font-size:17px;font-weight:600;letter-spacing:-.02em}
.draft-badge,.status-pill{border-color:#d7dde5;background:#fff;box-shadow:0 1px 1px #10182808}
#sidebar-toggle,#inspector-toggle{border-color:#c8d0da;background:#fff;box-shadow:0 1px 2px #1018280d}
#sidebar-toggle:hover,#inspector-toggle:hover{background:#edf3f8;border-color:#9fb5c9}
.app-shell{background:var(--color-background);min-width:0}
.workspace-sidebar{display:flex;flex-direction:column;overflow-x:hidden;padding:18px 12px 14px;border-color:#e1e6ec;box-shadow:1px 0 0 #10182803}
.sidebar-label{margin:18px 10px 8px;color:#778292;font-size:10px;letter-spacing:.11em}
.sidebar-label:first-child{margin-top:4px}
.workspace-nav{gap:5px}
.workspace-nav button{display:grid;grid-template-columns:22px minmax(0,1fr);align-items:center;column-gap:8px;min-height:40px;border-radius:9px;padding:9px 10px;color:#344054;font-size:13px;font-weight:680}
.workspace-nav button::before{color:#64748b;font-size:15px;text-align:center}
#view-dashboard::before{content:"▦"}
#view-build::before{content:"✦"}
#view-report::before{content:"▤"}
#view-graph::before{content:"⌁"}
.workspace-nav button:hover{background:#f1f4f7;color:#1f2937}
.workspace-nav button.selected{background:#e8f0f7;color:var(--color-primary);box-shadow:inset 3px 0 var(--color-primary)}
.workspace-nav button.selected::before{color:var(--color-primary)}
.sidebar-item{margin:0 10px;padding:10px 0 12px;border-color:#eef1f4;color:#475467;font-size:12px}
.future-note{color:#84909f}
.navigation-resizer,.inspector-resizer{border-color:#e1e6ec}
.navigation-resizer:hover,.navigation-resizer.dragging,.navigation-resizer:focus,.inspector-resizer:hover,.inspector-resizer.dragging,.inspector-resizer:focus{background:#b9d2e7}
.workspace{width:100%;min-width:0;padding:26px 28px 64px;background:var(--color-background)}
.workspace-topbar{align-items:center;margin:0 0 22px;padding:0 2px}
.workspace-topbar .page-heading{max-width:760px}
.eyebrow{margin-bottom:7px;color:#386489;font-size:10px;letter-spacing:.14em}
h1{font-size:26px;line-height:1.25;letter-spacing:-.025em}
.workspace-topbar .lead{margin:8px 0 0;font-size:13px;line-height:1.65}
.panel{border-color:#dfe4ea;border-radius:var(--radius-card);box-shadow:var(--shadow-card)}
.empty-state{min-height:310px;display:grid;place-content:center;padding:48px 34px;background:linear-gradient(145deg,#fff 0%,#f8fbfd 100%)}
.empty-state h2{font-size:21px;letter-spacing:-.015em}
.empty-state .lead{font-size:13px}
.dashboard-head{align-items:center;padding:18px 20px;background:#fff}
.dashboard-head h2{font-size:18px;letter-spacing:-.01em}
.dashboard-head .lead{margin:7px 0 0;font-size:12px}
.dashboard-head>div:last-child{min-width:128px;padding-left:18px;border-left:1px solid #e5e9ee;text-align:right}
.dashboard-head>div:last-child strong{font-size:13px}
.dashboard-grid{gap:14px;margin-top:14px;align-items:stretch;container-type:inline-size}
.dashboard-card{display:flex;flex-direction:column;grid-column:span 4;min-width:0;min-height:268px;padding:18px 18px 16px;border-color:#dde3ea;border-radius:var(--radius-card);box-shadow:var(--shadow-card);overflow:hidden;transition:border-color 140ms ease,box-shadow 140ms ease,transform 140ms ease}
.dashboard-card:hover{border-color:#bcc9d5;box-shadow:0 2px 4px #1018280d,0 14px 34px #10182812;transform:translateY(-1px)}
.dashboard-layout-row{grid-column:1/-1;display:grid;align-items:stretch;min-width:0}
.dashboard-layout-row>.dashboard-card{grid-column:auto!important;min-height:268px;margin:0}
.dashboard-card-resizer{position:relative;z-index:2;align-self:stretch;min-width:10px;cursor:col-resize;touch-action:none;outline:0}
.dashboard-card-resizer::after{content:"";position:absolute;top:12px;bottom:12px;left:calc(50% - .5px);width:1px;border-radius:999px;background:#dfe4ea;transition:background 120ms ease,box-shadow 120ms ease}
.dashboard-card-resizer:hover::after,.dashboard-card-resizer:focus-visible::after,.dashboard-card-resizer.dragging::after{background:#4b84b4;box-shadow:0 0 0 3px #4b84b426}
.dashboard-layout-row>.dashboard-card .chart{max-height:460px;overflow:auto}
@container (max-width:900px){.dashboard-layout-row{grid-template-columns:minmax(0,1fr)!important;gap:14px}.dashboard-layout-row>.dashboard-card{grid-column:1!important;min-height:340px}.dashboard-layout-row>.dashboard-card .chart{max-height:none;overflow:visible}.dashboard-card-resizer{display:none}}
.dashboard-layout-row>.dashboard-card .chart{display:flex;flex:1;min-height:0;overflow:hidden}
.dashboard-layout-row>.dashboard-card .echart-root{flex:1 1 auto;height:100%!important;min-height:300px}
@container (max-width:900px){.dashboard-layout-row>.dashboard-card .chart{overflow:visible}.dashboard-layout-row>.dashboard-card .echart-root{height:auto!important;min-height:260px}}
.dashboard-card h3{font-size:15px;line-height:1.45;letter-spacing:-.01em}
.dashboard-card .purpose{min-height:0;margin:9px 0 16px;color:#687386;font-size:11px}
.panel-state{display:inline-flex;align-items:center;min-height:23px;padding:3px 7px;border-radius:999px;background:var(--color-success-soft);color:var(--color-success);font-size:10px;white-space:nowrap}
.dashboard-card .chart{min-width:0;display:grid;align-items:start;overflow:visible;flex:1}
.chart .echart-root{display:block;width:100%;min-width:0;max-width:100%;height:auto}
.dashboard-card .chart .echart-root{width:100%;min-width:0;max-width:100%}
.dashboard-card .chart svg{display:block;min-width:0;width:100%;max-width:100%}
.chart-table-scroll{align-self:start;width:100%;max-height:360px;overflow:auto}
.chart-table-scroll table{width:max-content;min-width:100%;margin-top:0}
.chart-table-scroll th,.chart-table-scroll td{max-width:320px;overflow-wrap:anywhere;vertical-align:top}
.advanced-table{display:flex;flex:1;min-width:0;min-height:0;flex-direction:column;gap:8px}
.advanced-table-toolbar{display:flex;align-items:center;gap:7px;min-width:0}
.advanced-table-search{min-width:120px;max-width:240px;padding:6px 9px}
.advanced-table-summary{margin-right:auto;color:#687386;font-size:10px;white-space:nowrap}
.advanced-table-toolbar button,.advanced-table-pager button{width:auto;padding:5px 9px;font-size:10px}
.advanced-table-scroll{flex:1;max-height:420px;border:1px solid #e5e9ee;border-radius:7px}
.advanced-table-scroll thead{position:sticky;z-index:2;top:0;background:#f7f9fb}
.advanced-table-scroll th:first-child,.advanced-table-scroll td:first-child{position:sticky;z-index:1;left:0;background:inherit}
.advanced-table-scroll tbody tr:nth-child(even){background:#fafbfd}
.advanced-table-scroll th button{width:100%;padding:0;border:0;background:transparent;color:inherit;text-align:left;font:inherit}
.advanced-table-scroll th[aria-sort="ascending"] button::after{content:"  ↑"}
.advanced-table-scroll th[aria-sort="descending"] button::after{content:"  ↓"}
.advanced-table-number{background:linear-gradient(90deg,#dbeafe var(--table-bar-width),transparent var(--table-bar-width));font-variant-numeric:tabular-nums;text-align:right}
.advanced-table-delta{color:#315f86;font-weight:700}
.advanced-table-sparkline{width:128px;height:36px}
.advanced-table-pager{display:flex;align-items:center;justify-content:flex-end;gap:9px;color:#687386;font-size:10px}
.metric{align-self:center;padding:20px 6px;font-size:48px;letter-spacing:-.04em}
.kpi-pair{gap:10px;align-self:center;width:100%}
.kpi-pair div{padding:17px 16px;border:1px solid #edf0f3;border-radius:9px;background:#f7f9fb}
.kpi-pair strong{font-size:29px;letter-spacing:-.035em}
.funnel-step{border-radius:0 7px 7px 0;background:#e4effb}
.inspect-panel{align-self:flex-start;width:auto;margin-top:14px;padding:7px 11px;border-color:#d6dde5;background:#fff;color:#315f86;font-size:11px}
.inspect-panel::after{content:"  →"}
.dashboard-card.selected-card{border-color:#6c97bb;box-shadow:0 0 0 3px #4b84b426,var(--shadow-card)}
.workspace-inspector{overflow-x:hidden;padding:20px 18px;background:#fbfcfd;border-left:1px solid #e1e6ec}
.inspector-heading{padding:0 2px 15px;border-color:#e5e9ee}
.inspector-heading .eyebrow{margin-bottom:5px}
.inspector-heading h2{font-size:16px}
.inspector-empty{margin-top:14px;padding:22px 16px;border:1px dashed #cdd6df;border-radius:10px;background:#fff;color:#667085}
.inspector-tabs{gap:3px;padding:3px;border:1px solid #e2e7ec;border-radius:9px;background:#f1f4f7}
.inspector-tab{min-height:32px;border:0;border-radius:6px;padding:6px 4px;font-size:11px}
.inspector-tab.selected{border:0;background:#fff;color:var(--color-primary);box-shadow:0 1px 3px #10182814}
.inspector-panel{font-size:12px;line-height:1.7}
.notice{border-radius:0 8px 8px 0}
.local-note{padding:14px 2px 0;color:#7a8595;font-size:11px}
.view-actions{gap:8px}
dialog{border:0;border-radius:12px;box-shadow:0 24px 70px #10182838}

"""
