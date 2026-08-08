import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PLANNER = path.join(ROOT, 'spikes/report-generation/analysis_planner.py');

test('analysis planner creates a bounded revision and requires clarification', () => {
  const result = spawnSync(
    'python3',
    [
      '-c',
      `import importlib.util,json
spec=importlib.util.spec_from_file_location("planner",${JSON.stringify(PLANNER)})
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
period={"from":"20210101","to":"20210131","label":"2021年1月"}
base={
 "objective_summary":"購入成果の阻害箇所を特定して優先施策を決める",
 "audience":"月次マーケティング会議",
 "comparison":"月内の日次推移とファネル段階",
 "hypotheses":["商品閲覧からカート追加への減少が大きい"],
 "clarifications":[{"field":"audience","question":"主な読者は誰ですか","recommended_answer":"マーケティング責任者"}],
 "panels":[{"id":panel_id,"reason":"目的に必要"} for panel_id in ["R4","R9","R16","R17"]],
}
first=p.normalize_plan(base,"2021年1月の購入成果を改善するダッシュボードを作って",period,{})
answered={**base,"clarifications":[],"audience":"マーケティング責任者"}
second=p.normalize_plan(answered,first["objective"],period,{"audience":"マーケティング責任者"})
confirmed=p.confirm_plan(second)
errors=[]
for changed in [
 {**base,"panels":base["panels"][:3]},
 {**base,"panels":[*base["panels"][:3],{"id":"UNKNOWN","reason":"x"}]},
]:
 try:p.normalize_plan(changed,first["objective"],period,{})
 except p.PlannerError as error:errors.append(str(error))
print(json.dumps({
 "first_status":first["status"],"question_count":len(first["clarifications"]),
 "revision_stable":first["revision"]==p.normalize_plan(base,first["objective"],period,{})["revision"],
 "confirmed_status":confirmed["status"],"revision_changed":confirmed["revision"]!=first["revision"],
 "context":confirmed["organization_context_revision"],"panel_ids":[item["id"] for item in confirmed["panels"]],
 "errors":errors,
},ensure_ascii=False))`,
    ],
    { cwd: ROOT, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    first_status: 'proposed',
    question_count: 1,
    revision_stable: true,
    confirmed_status: 'confirmed',
    revision_changed: true,
    context: 'demo-org-ec-v1',
    panel_ids: ['R4', 'R9', 'R16', 'R17'],
    errors: [
      '分析計画のパネルは4〜6件にしてください。',
      '分析計画に未登録または重複したパネルがあります。',
    ],
  });
});

test('planner prompt is bounded to declared context, metrics, and panel catalog', () => {
  const result = spawnSync(
    'python3',
    [
      '-c',
      `import importlib.util,json
spec=importlib.util.spec_from_file_location("planner",${JSON.stringify(PLANNER)})
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
request=p.planning_request("目的",{"label":"2021年1月"},"指標定義",{})
print(json.dumps({"context":p.ORGANIZATION_CONTEXT["revision"] in request,"metrics":"指標定義" in request,"catalog":all(panel_id in request for panel_id in p.PANEL_CATALOG),"questions":"確認を1〜3件" in request},ensure_ascii=False))`,
    ],
    { cwd: ROOT, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    context: true,
    metrics: true,
    catalog: true,
    questions: true,
  });
});
