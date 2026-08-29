"""Workspace interaction scripts and clarification UI for the live demo."""

WORKSPACE_POLISH_SCRIPT = r"""
function paneIcon(side,expanded){const ns="http://www.w3.org/2000/svg",svg=document.createElementNS(ns,"svg"),frame=document.createElementNS(ns,"rect"),divider=document.createElementNS(ns,"path");svg.setAttribute("class","pane-icon");svg.setAttribute("viewBox","0 0 18 18");svg.setAttribute("aria-hidden","true");for(const[name,value]of Object.entries({x:"2.5",y:"2.5",width:"13",height:"13",rx:"2"}))frame.setAttribute(name,value);divider.setAttribute("d",side==="left"?"M7 3v12":"M11 3v12");svg.append(frame);if(expanded){const fill=document.createElementNS(ns,"rect");for(const[name,value]of Object.entries({class:"pane-fill",x:side==="left"?"2.5":"11",y:"2.5",width:"4.5",height:"13",rx:"1"}))fill.setAttribute(name,value);svg.append(fill)}svg.append(divider);return svg}
function updatePaneButton(id,side,expanded,label){const button=$(id);button.dataset.state=expanded?"open":"closed";button.replaceChildren(paneIcon(side,expanded));button.setAttribute("aria-expanded",String(expanded));button.setAttribute("aria-label",label);button.title=label}
function toggleSidebar(){const collapsed=$("app-shell").classList.toggle("sidebar-collapsed");updatePaneButton("sidebar-toggle","left",!collapsed,collapsed?"ナビゲーションを展開":"ナビゲーションを折りたたむ");if(window.innerWidth>1180)setInspectorWidth(currentInspectorWidth());resizeComposerInput()}
function toggleInspector(){const collapsed=$("app-shell").classList.toggle("inspector-collapsed");updatePaneButton("inspector-toggle","right",!collapsed,collapsed?"成果物パネルを展開":"成果物パネルを折りたたむ");resizeComposerInput()}
function showInsightArtifact(hasResult=false){const pane=$("panel-inspector");pane.classList.add("artifact-active");$("artifact-preview").className="artifact-preview";$("artifact-preview-empty").className=hasResult?"hidden":"inspector-empty";$("inspector-title").textContent="インサイト";$("inspector-subtitle").textContent="未保存の分析結果";if($("app-shell").classList.contains("inspector-collapsed"))toggleInspector()}
function hideInsightArtifact(){const pane=$("panel-inspector");pane.classList.remove("artifact-active");$("artifact-preview").className="artifact-preview hidden"}
const consultationHistory=[];let pendingConsultation=null,consultationProfile=null;
function appendConsultationMessage(role,text){const message=Object.assign(document.createElement("p"),{className:`consultation-message ${role}`,textContent:text});$("consultation-thread").append(message);message.scrollIntoView({block:"nearest"});return message}
function resetConsultation(profile){consultationHistory.splice(0);pendingInsightSpecification=null;$("consultation-thread").replaceChildren();$("consultation-recommendations").replaceChildren();consultationProfile=profile}
function rollbackPendingConsultation(){if(!pendingConsultation)return;const pending=pendingConsultation,last=consultationHistory.at(-1);if(last?.role==="user"&&last.content===pending.question)consultationHistory.pop();pending.message.remove();$("composer-input").value=pending.question;resizeComposerInput();$("consultation-status").textContent="相談を実行しませんでした。発言を編集して再送信できます。";pendingConsultation=null;$("composer-input").focus()}
function renderAnalysisRecommendations(recommendations){const host=$("consultation-recommendations");host.replaceChildren();const chartLabels={scorecard:"スコアカード",kpi_group:"KPIグループ",bar:"棒グラフ",grouped_bar:"グループ棒",stacked_bar:"積み上げ棒",line:"折れ線",multi_line:"複数軸折れ線",area:"面グラフ",stacked_area:"積み上げ面",histogram:"ヒストグラム",donut:"ドーナツ",calendar_heatmap:"カレンダーヒートマップ",scatter:"散布図",bubble:"バブル",funnel:"ファネル",heatmap:"ヒートマップ",table:"テーブル",sankey:"サンキー"};recommendations.forEach(recommendation=>{const card=Object.assign(document.createElement("button"),{className:"recommendation-card",type:"button"}),title=document.createElement("strong"),chart=Object.assign(document.createElement("span"),{className:"recommendation-chart"}),decision=Object.assign(document.createElement("span"),{className:"recommendation-decision"}),definition=document.createElement("span"),prompt=document.createElement("span");title.textContent=recommendation.title;chart.textContent=chartLabels[recommendation.chart]||recommendation.chart;decision.textContent=`判断: ${recommendation.objective}`;definition.textContent=`指標: ${recommendation.measures.join("、")} / 軸: ${recommendation.dimensions.join("、")||"なし"} / 比較: ${recommendation.comparison}`;prompt.textContent=`AIが定義した実行仕様: ${recommendation.execution_prompt}`;card.dataset.prompt=recommendation.execution_prompt;card.setAttribute("aria-pressed","false");card.append(title,chart,decision,definition,prompt);card.onclick=()=>selectAnalysisRecommendation(recommendation);host.append(card)})}
function handleAnalysisConsultation(event){if(event.type==="consultation_stage"){$("consultation-status").textContent=event.message;return}if(event.type==="error")throw new Error(event.message);if(event.type!=="consultation")return;appendConsultationMessage("assistant",`${event.assistant_message}\n\n${event.follow_up_question}`);consultationHistory.push({role:"assistant",content:event.history_message});renderAnalysisRecommendations(event.recommendations);$("consultation-status").textContent=`AIが${event.recommendations.length}件の分析仕様を考察しました。Vertex AI推定 ¥${event.cost_jpy}。候補を選ぶか、下から追加相談できます。`;$("composer-message").textContent="相談結果を確認してください。BigQueryはまだ実行していません。";pendingConsultation=null}
function beginAnalysisConsultation(question,profile){pendingInsightSpecification=null;hideInsightArtifact();selectWorkspace("consult");setComposerAction("consult",false);if(consultationProfile!==profile)resetConsultation(profile);$("inspector-title").textContent="分析相談";$("inspector-subtitle").textContent="BigQuery未実行";$("inspector-empty").className="inspector-empty";$("inspector-content").className="hidden";$("inspector-empty").textContent="AIが目的、指標、軸、比較、可視化を考察します。選択後にSQL生成費用を別途確認します。";const history=consultationHistory.slice(-8),message=appendConsultationMessage("user",question);consultationHistory.push({role:"user",content:question});pendingConsultation={question,profile,history,message};$("composer-input").value="";resizeComposerInput();$("consultation-status").textContent="費用確認後にVertex AIへ相談します。BigQueryは実行しません。";$("composer-message").textContent="相談費用を確認してください。";try{showCost("analysis-consult")}catch(error){rollbackPendingConsultation();$("consultation-status").textContent=error.message}}
async function runAnalysisConsultation(){const pending=pendingConsultation;if(!pending)return;const operation=startActiveRequest();$("cost-dialog").close();$("consultation-status").textContent="AIが分析目的と利用可能なデータを照合しています。";try{await stream("/api/consult",pending.question,handleAnalysisConsultation,pending.profile,{history:pending.history},operation)}catch(error){if(error.name!=="AbortError"){rollbackPendingConsultation();$("consultation-status").textContent=error.message}}finally{finishActiveRequest(operation)}}
function resizeComposerInput(){const input=$("composer-input");input.style.height="auto";input.style.height=`${input.scrollHeight}px`}
function collapseComposer(){const composer=$("analysis-composer");composer.classList.add("composer-collapsed");$("composer-launcher").setAttribute("aria-expanded","false");$("composer-input").blur()}
function collapseComposerFromControl(){collapseComposer();$("composer-launcher").focus()}
function expandComposer(focusInput=true){const composer=$("analysis-composer");composer.classList.remove("composer-collapsed");$("composer-launcher").setAttribute("aria-expanded","true");resizeComposerInput();if(focusInput)$("composer-input").focus()}
// Issue #364: completed dashboards prioritize reading; explicit controls restore chat without hover-driven layout changes.
function enterDashboardReadingMode(){hideInsightArtifact();$("analysis-composer").classList.add("dashboard-ready");if(!$("app-shell").classList.contains("inspector-collapsed"))toggleInspector();collapseComposer()}
function selectAnalysisRecommendation(recommendation){document.querySelectorAll(".recommendation-card").forEach(card=>{const selected=card.dataset.prompt===recommendation.execution_prompt;card.classList.toggle("selected",selected);card.setAttribute("aria-pressed",String(selected))});pendingInsightSpecification=recommendation;setComposerAction("insight",false);$("composer-input").value=recommendation.execution_prompt;resizeComposerInput();$("consultation-status").textContent=`「${recommendation.title}」のAI分析仕様を依頼文へ反映しました。変更した場合はAIが仕様を再検討します。`;$("composer-message").textContent="AIが考察した仕様を反映しました。まだSQL生成・BigQuery実行はしていません。";$("inspector-title").textContent=recommendation.title;$("inspector-subtitle").textContent="AI分析仕様・未実行";$("inspector-empty").textContent=`${recommendation.reason} 依頼文を確認し、費用確認後にSQLを生成します。`;$("composer-input").focus()}
function setComposerAction(action,copyInput=true){document.querySelectorAll("[data-composer-action]").forEach(button=>button.classList.toggle("selected",button.dataset.composerAction===action));$("analysis-composer").dataset.action=action;$("composer-profile").className=["consult","insight"].includes(action)?"":"hidden";const input=$("composer-input");if(copyInput)input.value=action==="consult"?"":action==="dashboard"?$("dashboard-question").value:$("question").value;resizeComposerInput();$("composer-target").textContent=action==="consult"?"対象: 分析テーマを相談":action==="dashboard"?"対象: 現在の分析スレッド":"対象: 未保存のインサイト"}
const baseSelectWorkspace=selectWorkspace;
selectWorkspace=view=>{baseSelectWorkspace(view);$("compact-title").textContent=$("page-title").textContent;if(view!=="dashboard"){$("analysis-composer").classList.remove("dashboard-ready");expandComposer(false)}};
function submitComposer(){if(activeRequest){stopActiveRequest();return}const action=$("analysis-composer").dataset.action||"dashboard",question=$("composer-input").value.trim();if(!question){$("composer-message").textContent="分析したい内容を入力してください。";return}if(action==="consult"){beginAnalysisConsultation(question,$("composer-profile").value);return}$("composer-message").textContent="費用と実行範囲を確認します。";if(action==="insight"){if(!pendingInsightSpecification||question!==pendingInsightSpecification.execution_prompt){beginAnalysisConsultation(question,$("composer-profile").value);return}selectWorkspace("graph");$("question").value=question;$("dataset-profile").value=$("composer-profile").value;selectProfile($("composer-profile").value);showInsightArtifact();showCost("graph");return}$("dashboard-question").value=question;currentAnswers={};currentPlan=null;pendingPlan=null;pendingPlanBase=null;pendingPlanInstruction=null;$("plan-revision-instruction").value="";dashboardStage();showCost("dashboard-plan")}
const originalQueryHandler=handle;handle=e=>{if(["sql","result","refusal"].includes(e.type))showInsightArtifact(true);originalQueryHandler(e)};
const originalPanelInspector=openPanelInspector;openPanelInspector=panelId=>{hideInsightArtifact();originalPanelInspector(panelId)};
$("artifact-preview-host").appendChild($("output"));
document.querySelectorAll("[data-composer-action]").forEach(button=>button.onclick=()=>setComposerAction(button.dataset.composerAction));
$("composer-profile").onchange=()=>{pendingInsightSpecification=null;const profile=$("composer-profile").value;selectProfile(profile);$("composer-input").value="";$("composer-message").textContent=profile==="bitcoin"?"Bitcoin取引について判断したい内容を入力してください。":"GA4について判断したい内容を入力してください。";resizeComposerInput()};
$("question").addEventListener("input",()=>{pendingInsightSpecification=null});
$("composer-input").addEventListener("input",resizeComposerInput);
let composerInputWidth=0;new ResizeObserver(([entry])=>{if(entry.contentRect.width===composerInputWidth)return;composerInputWidth=entry.contentRect.width;resizeComposerInput()}).observe($("composer-input"));
setInspectorWidth(currentInspectorWidth());
inspectorResizer.onkeydown=event=>{if(!["ArrowLeft","ArrowRight"].includes(event.key))return;event.preventDefault();setInspectorWidth(event.key==="ArrowLeft"?currentInspectorWidth()+20:currentInspectorWidth()-20)};
window.addEventListener("resize",()=>{if(window.innerWidth>1180)setInspectorWidth(currentInspectorWidth());resizeComposerInput()});
$("composer-submit").onclick=submitComposer;$("composer-input").onkeydown=event=>{if((event.metaKey||event.ctrlKey)&&event.key==="Enter")submitComposer()};
$("composer-launcher").onclick=()=>expandComposer();
$("composer-collapse").onclick=collapseComposerFromControl;
$("new-analysis").onclick=()=>{selectWorkspace("consult");setComposerAction("consult");$("composer-input").focus()};
$("view-dashboard").onclick=()=>{hideInsightArtifact();selectWorkspace("dashboard");setComposerAction("dashboard",false);if(latestBuildRevision)enterDashboardReadingMode()};
$("view-build").onclick=()=>{hideInsightArtifact();selectWorkspace("build");setComposerAction("dashboard",false)};
$("view-report").onclick=()=>{hideInsightArtifact();selectWorkspace("report");setComposerAction("report",false)};
$("view-graph").onclick=()=>{selectWorkspace("graph");setComposerAction("insight",false);showInsightArtifact(!$("output").classList.contains("hidden"))};
updatePaneButton("sidebar-toggle","left",!$("app-shell").classList.contains("sidebar-collapsed"),$("app-shell").classList.contains("sidebar-collapsed")?"ナビゲーションを展開":"ナビゲーションを折りたたむ");updatePaneButton("inspector-toggle","right",!$("app-shell").classList.contains("inspector-collapsed"),$("app-shell").classList.contains("inspector-collapsed")?"成果物パネルを展開":"成果物パネルを折りたたむ");
const headerMeta=document.querySelector(".app-header .header-context:last-child");headerMeta.insertBefore($("workspace-state"),headerMeta.querySelector(".draft-badge"));
selectWorkspace("build");setComposerAction("dashboard",false);
if(window.innerWidth<=1180 && $("inspector-toggle").getAttribute("aria-expanded")==="true")toggleInspector();
if(window.innerWidth<=960 && $("sidebar-toggle").getAttribute("aria-expanded")==="true")toggleSidebar();
"""

CLARIFICATION_MARKUP = r"""
<section id="clarification-panel" class="panel hidden" aria-labelledby="clarification-title"><h2 id="clarification-title">追加の定義が必要です</h2><p id="clarification-terms" class="notice warning"></p><p id="clarification-question" class="lead"></p><label for="clarification-answer">対象条件を回答してください</label><textarea id="clarification-answer" rows="3" maxlength="800" placeholder="例: 対象URLは /signup と /register、イベント名は sign_up です"></textarea><div class="actions"><button id="clarification-submit" type="button">回答して再生成</button><span class="cost">回答内容だけを条件に使い、回答にない条件は推測しない。BigQueryはSQL確定後にのみ実行します。</span></div></section>
"""

FOLLOWUP_SCRIPT = r"""
let clarificationRequest = null;
const originalQueryHandle = handle;
handle = function followupAwareHandle(event) {
  if (event.type === "refusal") {
    clarificationRequest = event;
    $("clarification-terms").textContent = `未定義: ${event.undefined_terms.join("、")}`;
    $("clarification-question").textContent = event.clarification_question ||
      "対象URL、ページ一覧、イベント名、または指標の計算定義を具体的に指定してください。";
    $("clarification-answer").value = "";
    $("clarification-panel").className = "panel";
  }
  originalQueryHandle(event);
};
async function runClarifiedQuery() {
  if (!clarificationRequest) return;
  const answer = $("clarification-answer").value.trim();
  if (!answer) {
    $("message").className = "notice error";
    $("message").textContent = "確認質問への回答を入力してください。";
    return;
  }
  let operation;
  try {
    operation = startActiveRequest();
  } catch (error) {
    $("message").className = "notice error";
    $("message").textContent = error.message;
    return;
  }
  $("clarification-submit").disabled = true;
  $("clarification-panel").className = "panel hidden";
  $("run-status").textContent = "再確認中";
  $("message").className = "notice";
  $("message").textContent = "回答を反映してVertex AIへ再確認しています。";
  $("output").className = "hidden";
  clearResult();
  stage("generate");
  try {
    await stream(
      "/api/query",
      $("question").value.trim(),
      handle,
      $("dataset-profile").value,
      {analysis_specification: pendingInsightSpecification, clarification_answer: answer},
      operation,
    );
    clarificationRequest = null;
  } catch (error) {
    if (error.name !== "AbortError") {
      $("message").className = "notice error";
      $("message").textContent = error.message;
      finish("エラー");
    }
  } finally {
    $("clarification-submit").disabled = false;
    finishActiveRequest(operation);
  }
}
$("clarification-submit").onclick = runClarifiedQuery;
"""
