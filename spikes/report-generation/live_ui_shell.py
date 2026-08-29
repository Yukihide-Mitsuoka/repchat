"""Workspace shell, responsive, and composer styles for the live demo."""

from live_ui_theme import WORKSPACE_THEME_CSS

WORKSPACE_POLISH_CSS = WORKSPACE_THEME_CSS + r"""/* Issue #350: pane-owned chrome, compact type, and invisible resize hit areas. */
:root{--header-height:44px;--icon-button-size:32px;--splitter-hit-area:8px;--splitter-line:1px}
body{font-size:13px;font-weight:400}
.app-shell{grid-template-rows:44px minmax(0,1fr);min-height:100vh}
.app-header{grid-column:3;grid-row:1;position:sticky;top:0;z-index:30;height:var(--header-height);min-width:0;padding:0 48px;border-bottom:var(--splitter-line) solid #e8e8e8;box-shadow:none;background:#fff;backdrop-filter:none}
.header-context{gap:8px;min-width:0}
.header-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#343541;font-size:12px;font-weight:500}
.header-context strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:500}
.brand{font-size:15px;font-weight:600;letter-spacing:-.015em}
.sidebar-chrome{display:flex;align-items:center;gap:8px;min-height:var(--header-height);padding:0 8px;color:#6b6b70;font-size:11px}
.sidebar-chrome .brand{color:#202123}
#sidebar-toggle,#inspector-toggle{width:var(--icon-button-size);height:var(--icon-button-size);min-height:var(--icon-button-size);border:0;border-radius:7px;padding:0;background:transparent;box-shadow:none;font-size:14px}
#sidebar-toggle:hover,#inspector-toggle:hover{border:0;background:#ececf1}
button{min-height:32px;padding:6px 11px;font-weight:500;letter-spacing:0}
.workspace-sidebar{grid-column:1;grid-row:1/3;position:sticky;top:0;height:100vh;padding:0 4px 8px;border:0;background:#f7f7f8;box-shadow:none}
.workspace-nav{gap:1px}
.workspace-nav button{grid-template-columns:16px minmax(0,1fr);column-gap:4px;min-height:36px;border-radius:7px;padding:6px 4px;font-weight:500;overflow:hidden}
.workspace-nav button.selected{background:#ececf1;box-shadow:none}
.workspace-nav button:focus-visible{outline:2px solid #7fa2c2;outline-offset:-2px}
.workspace-nav button::before{width:16px;font-size:14px}
.sidebar-label{margin:12px 5px 4px;font-weight:500;letter-spacing:.06em;text-transform:none}
.navigation-resizer,.inspector-resizer{position:sticky;top:0;z-index:35;width:var(--splitter-hit-area);height:100vh;justify-self:center;border:0;background:transparent;touch-action:none}
.navigation-resizer{grid-column:2;grid-row:1/3}
.inspector-resizer{grid-column:4;grid-row:1/3}
.app-shell.sidebar-collapsed .navigation-resizer,.app-shell.inspector-collapsed .inspector-resizer{display:none}
.navigation-resizer::after,.inspector-resizer::after{content:"";position:absolute;top:0;bottom:0;width:var(--splitter-line);background:#e5e5e5}
.navigation-resizer::after,.inspector-resizer::after{left:50%;transform:translateX(-50%)}
.navigation-resizer:hover,.navigation-resizer.dragging,.navigation-resizer:focus,.inspector-resizer:hover,.inspector-resizer.dragging,.inspector-resizer:focus{background:#4b84b414}
.workspace{grid-column:3;grid-row:2;width:100%;padding:22px 24px 56px}
.workspace-inspector{grid-column:5;grid-row:1/3;position:sticky;top:0;height:100vh;padding:16px 14px;border:0;background:#fafafa;box-shadow:none}
.app-shell.inspector-collapsed .workspace-inspector,.app-shell.sidebar-collapsed .workspace-sidebar{display:none;overflow:hidden}
.workspace-topbar{margin-bottom:18px}
.eyebrow{font-weight:500}
h1{font-size:24px;font-weight:600}
h2,.dashboard-card h3{font-weight:600}
.status-pill,.panel-state{font-weight:500}
.panel{border-color:#e5e7eb;box-shadow:0 1px 2px #10182808}
.dashboard-card{box-shadow:0 1px 2px #10182808}
@media(max-width:1400px) and (min-width:1181px){
.dashboard-card:nth-child(1){grid-column:span 12}
.dashboard-card:nth-child(2),.dashboard-card:nth-child(3){grid-column:span 6}
}
@media(max-width:1180px) and (min-width:961px){
.app-shell,.app-shell.sidebar-collapsed,.app-shell.inspector-collapsed{--inspector-column:0px;--inspector-grip:0px;grid-template-columns:var(--nav-column) var(--nav-grip) minmax(0,1fr)}
.app-header{grid-column:3;grid-row:1}
.workspace-sidebar{grid-row:1/3}
.workspace{grid-column:3;grid-row:2}
.workspace-inspector{position:fixed;z-index:40;top:0;right:0;width:min(380px,42vw);height:100vh;box-shadow:var(--shadow-pane);transform:translateX(0);transition:transform 160ms ease-out,visibility 160ms}
.app-shell.inspector-collapsed .workspace-inspector{visibility:hidden;transform:translateX(100%)}
.inspector-resizer{display:none}
.dashboard-card:nth-child(1){grid-column:span 12}
.dashboard-card:nth-child(2),.dashboard-card:nth-child(3){grid-column:span 6}
}
@media(max-width:960px){
.app-shell,.app-shell.sidebar-collapsed,.app-shell.inspector-collapsed{display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:var(--header-height) minmax(0,1fr)}
.app-header{grid-column:1;grid-row:1}
.workspace{grid-column:1;grid-row:2;width:100%}
.workspace-sidebar,.workspace-inspector{position:fixed;z-index:45;top:0;height:100vh;box-shadow:var(--shadow-pane);transition:transform 160ms ease-out,visibility 160ms}
.workspace-sidebar{left:0;width:min(320px,88vw);transform:translateX(0)}
.workspace-inspector{right:0;width:min(420px,92vw);transform:translateX(0)}
.app-shell.sidebar-collapsed .workspace-sidebar{display:flex;visibility:hidden;transform:translateX(-100%)}
.app-shell.inspector-collapsed .workspace-inspector{display:block;visibility:hidden;transform:translateX(100%)}
.navigation-resizer,.inspector-resizer{display:none}
.dashboard-card:nth-child(1){grid-column:span 12}
.dashboard-card:nth-child(2),.dashboard-card:nth-child(3),.dashboard-card:nth-child(4),.dashboard-card:nth-child(5){grid-column:span 6}
}
@media(max-width:760px){
.app-header{padding:0 48px;gap:8px}
.app-header .header-context:first-child>span:last-child,.app-header .header-context:last-child>strong{display:none}
#inspector-toggle{display:inline-flex}
.workspace{padding:20px 16px 44px}
.workspace-topbar{display:flex;align-items:flex-start;gap:10px;margin-bottom:18px}
.workspace-topbar .lead{font-size:12px}
h1{font-size:22px}
.workspace-nav{display:grid;overflow:visible}
.sidebar-label,.sidebar-item{display:block}
.workspace-inspector{display:block;width:100%}
.dashboard-head{display:block}
.dashboard-head>div:last-child{margin-top:14px;padding:12px 0 0;border-top:1px solid #e5e9ee;border-left:0;text-align:left}
.dashboard-grid{grid-template-columns:1fr}
.dashboard-card,.dashboard-card:nth-child(1),.dashboard-card:nth-child(2),.dashboard-card:nth-child(3),.dashboard-card:nth-child(4),.dashboard-card:nth-child(5),.dashboard-card:nth-child(6){grid-column:1;min-height:auto}
.dashboard-layout-row{grid-column:1;grid-template-columns:minmax(0,1fr)!important;gap:14px}
.dashboard-layout-row>.dashboard-card{grid-column:1!important;min-height:340px}
.dashboard-card-resizer{display:none}
.dashboard-card{padding:17px}
.dashboard-card:nth-child(4),.dashboard-card:nth-child(5){min-height:340px}
.dashboard-card:nth-child(6){min-height:420px}
.kpi-pair{grid-template-columns:1fr 1fr}
}
@media(prefers-reduced-motion:reduce){
*,*::before,*::after{scroll-behavior:auto!important;transition-duration:0s!important;animation-duration:0s!important}
}

/* Issue #352: one conversation, an artifact tree, and a stable artifact pane. */
#sidebar-toggle,#inspector-toggle{position:fixed;top:6px;z-index:70;display:grid;place-items:center}
#sidebar-toggle{left:8px}#inspector-toggle{right:8px}
.pane-icon{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.6}
.pane-icon .pane-fill{fill:currentColor;stroke:none;opacity:.18}
.sidebar-chrome{gap:5px;margin:0 -4px;padding:0 8px 0 44px;border-bottom:1px solid #e7e7e8}
.workspace-inspector{padding-top:52px}
.workspace{height:calc(100vh - var(--header-height));overflow:auto;padding-bottom:150px}
.workspace-topbar{display:none}
.workspace-sidebar .new-analysis{width:100%;justify-content:flex-start;margin:6px 0 1px;padding:6px 4px;border:0;background:transparent;color:#202123;text-align:left}
.workspace-sidebar .new-analysis::before{content:"＋";width:16px;margin-right:4px;font-size:16px;text-align:center}
.artifact-tree button,.thread-tree button{grid-template-rows:auto auto}
.artifact-tree .sidebar-title,.thread-tree .sidebar-title{grid-column:2;display:block;min-width:0;overflow:hidden;container-type:inline-size;line-height:1.25;white-space:nowrap}
.sidebar-title>span{display:block;width:max-content;min-width:100%;white-space:nowrap}
.workspace-nav button:hover .sidebar-title>span,.workspace-nav button:focus-visible .sidebar-title>span{animation:sidebar-title-marquee 4s linear infinite alternate}
@keyframes sidebar-title-marquee{0%,18%{transform:translateX(0)}82%,100%{transform:translateX(calc(-100% + 100cqw))}}
@media(prefers-reduced-motion:reduce){.workspace-nav button:hover .sidebar-title>span,.workspace-nav button:focus-visible .sidebar-title>span{animation:none}}
.artifact-tree button small,.thread-tree button small{grid-column:2;color:#8a8a91;font-size:10px;font-weight:400;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sidebar-account{display:flex;align-items:center;gap:6px;margin-top:auto;margin-right:-4px;margin-left:-4px;padding:8px 8px 0;border-top:1px solid #e7e7e8;color:#343541}
.sidebar-account>span:last-child{display:grid;min-width:0}.sidebar-account strong{font-size:12px;font-weight:500}.sidebar-account small{color:#85858b;font-size:10px}
.account-avatar{display:grid;place-items:center;width:28px;height:28px;border-radius:50%;background:#e4e4e7;font-size:11px}
.analysis-composer{position:fixed;z-index:60;left:calc(var(--nav-column) + var(--nav-grip) + (100vw - var(--nav-column) - var(--nav-grip) - var(--inspector-column) - var(--inspector-grip))/2);bottom:14px;width:min(768px,calc(100vw - var(--nav-column) - var(--nav-grip) - var(--inspector-column) - var(--inspector-grip) - 48px));margin:0;padding:9px 11px 10px;transform:translateX(-50%);border:1px solid #d9d9df;border-radius:22px;background:#fff;box-shadow:0 8px 28px #10182817}
.analysis-composer.composer-collapsed{width:auto;min-width:0;padding:0;border:0;background:transparent;box-shadow:none}
.analysis-composer.composer-collapsed>:not(.composer-launcher){display:none}
.composer-launcher{display:none;align-items:center;gap:6px;min-height:34px;padding:7px 12px;border:1px solid #d9d9df;border-radius:999px;background:#fff;color:#343541;font-size:12px;font-weight:550;box-shadow:0 4px 16px #10182814}
.composer-launcher:hover,.composer-launcher:focus-visible{border-color:#9fb5c9;background:#f7f8fa;color:#1f4e79}.analysis-composer.composer-collapsed .composer-launcher{display:inline-flex}
.composer-collapse{display:none;place-items:center;width:24px;height:24px;min-height:24px;margin-left:auto;padding:0;border:0;border-radius:6px;background:transparent;color:#6b6b72;font-size:16px}.analysis-composer.dashboard-ready:not(.composer-collapsed) .composer-collapse{display:grid}.composer-collapse:hover,.composer-collapse:focus-visible{background:#ececf1;color:#202123}
.composer-context,.composer-footer{display:flex;align-items:center;gap:8px}.composer-context{flex-wrap:wrap;margin-bottom:5px}.composer-footer{justify-content:space-between;color:#85858b;font-size:10px}
.composer-target{padding:3px 7px;border-radius:999px;background:#f1f1f3;color:#5f5f66;font-size:10px}
.composer-actions{display:flex;gap:2px}.composer-actions button{min-height:24px;padding:3px 7px;border:0;border-radius:6px;background:transparent;color:#6b6b72;font-size:10px}.composer-actions button.selected{background:#ececf1;color:#202123}
#composer-profile{min-height:26px;margin:0;padding:3px 22px 3px 7px;border-color:#dedee3;font-size:10px}
#composer-input{min-height:52px;max-height:none;padding:7px 4px;overflow-y:hidden;border:0;border-radius:0;resize:none;box-shadow:none;font-size:13px}#composer-input:focus{border:0;outline:0}
#composer-submit{display:grid;place-items:center;width:28px;height:28px;min-height:28px;padding:0;border:0;border-radius:50%;background:#202123;line-height:0}#composer-submit svg{display:block;width:16px;height:16px}
.analysis-consultation{max-width:860px;margin:8px auto 120px}
.consultation-thread{display:grid;gap:16px;margin:8px 0 30px}.consultation-message{max-width:760px;margin:0;white-space:pre-wrap;font-size:14px;line-height:1.65}.consultation-message.user{justify-self:end;max-width:78%;padding:10px 14px;border-radius:16px 16px 4px 16px;background:#ececef;color:#27272a}.consultation-message.assistant{justify-self:start;color:#343541}
.consultation-assistant{max-width:760px}.consultation-assistant h2{font-size:20px;letter-spacing:-.01em}.consultation-assistant>.lead{margin:8px 0 0;font-size:13px}.consultation-free{margin:15px 0 18px;padding-left:11px;border-left:2px solid #4b84b4;color:#5f6672;font-size:12px;line-height:1.6}.consultation-free strong{color:#234e70}
.consultation-recommendations{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.recommendation-card{display:grid;grid-template-columns:1fr auto;gap:5px 12px;min-height:128px;padding:14px;border:1px solid #dedee3;border-radius:10px;background:#fff;color:#27272a;text-align:left;box-shadow:none}.recommendation-card:hover,.recommendation-card:focus-visible{border-color:#7aa4c7;background:#f8fbfd}.recommendation-card.selected{border-color:#1f4e79;box-shadow:0 0 0 2px #1f4e7920}.recommendation-card strong{font-size:14px;font-weight:650}.recommendation-card .recommendation-chart{align-self:start;padding:2px 7px;border-radius:999px;background:#f1f1f3;color:#667085;font-size:10px;font-weight:500}.recommendation-card span:not(.recommendation-chart){grid-column:1/-1;color:#5f6672;font-size:11px;font-weight:400;line-height:1.55}.recommendation-card .recommendation-decision{color:#344054}.consultation-status{margin:14px 0 0;color:#667085;font-size:12px;line-height:1.55}
#build-studio-view .query-panel,#graph-workspace>.query-panel{display:none}
.artifact-preview-heading{display:flex;align-items:center;gap:8px;margin-bottom:10px}.artifact-preview-heading strong{font-size:12px;font-weight:500}
#artifact-preview-host #output>.grid{grid-template-columns:1fr}#artifact-preview-host #output .panel{margin-top:10px;padding:13px;border-radius:8px;box-shadow:none}
#artifact-preview-host #output h2{font-size:13px}#artifact-preview-host .chart svg{min-width:620px}#artifact-preview-host .sql{font-size:10px;max-height:320px}
.workspace-inspector.artifact-active #inspector-empty,.workspace-inspector.artifact-active #inspector-content{display:none}
.workspace-inspector .table-scroll th,.workspace-inspector .table-scroll td{padding:6px 8px;font-size:12px;line-height:1.35;vertical-align:top}
@media(max-width:1180px){.analysis-composer{left:calc(var(--nav-column) + var(--nav-grip) + (100vw - var(--nav-column) - var(--nav-grip))/2);width:min(768px,calc(100vw - var(--nav-column) - var(--nav-grip) - 48px))}}
@media(max-width:960px){.analysis-composer{left:50%;bottom:8px;width:min(768px,calc(100vw - 24px))}.workspace{padding-bottom:140px}.workspace-inspector{padding-top:52px}}
@media(max-width:640px){.composer-target{display:none}.composer-actions{width:100%}.composer-actions button{flex:1}.analysis-composer{width:calc(100% - 16px)}.workspace{padding-left:12px;padding-right:12px}.consultation-recommendations{grid-template-columns:1fr}.consultation-message.user{max-width:92%}}
"""
