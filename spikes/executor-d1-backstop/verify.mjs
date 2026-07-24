// Live proof of the ADR-0010 D1 backstop over real BigQuery.
//
// The claim under test: with per-tenant impersonation, the ① tenant boundary
// survives a TOTAL failure of the AST binder. We bypass the binder entirely and
// hand the runner fully-qualified cross-tenant SQL — the shape a broken binder
// would emit — and show that BigQuery itself denies it, because the impersonated
// service account has no access to the other tenant's dataset. This is the
// data-layer insurance that status.md (LOG-0040) recorded as missing for
// BigQuery; here it is, measured.
//
// Prerequisites: run ./README.md's gcloud steps first (two reader SAs, each with
// dataViewer on its own dataset only + jobUser, and your gcloud identity granted
// tokenCreator on both). Datasets t_alpha / t_bravo come from the
// executor-bigquery spike (LOG-0033). Then: node spikes/executor-d1-backstop/verify.mjs
import { BigQueryRunner } from '../../src/modules/executor/infrastructure/bigquery.ts';
import { AdcTokenProvider } from '../../src/modules/executor/infrastructure/google-auth.ts';
import { ImpersonatingTokenProvider } from '../../src/modules/executor/infrastructure/impersonation.ts';

const PROJECT = 'kotonoha-bi-dev';
const ALPHA_SA = `t-alpha-reader@${PROJECT}.iam.gserviceaccount.com`;
const BRAVO_SA = `t-bravo-reader@${PROJECT}.iam.gserviceaccount.com`;

const source = new AdcTokenProvider();
const tokens = new ImpersonatingTokenProvider({ source });
const runner = new BigQueryRunner({ tokens });

// Deliberately UNBOUND, fully-qualified SQL: we are testing the IAM layer, not
// the binder. `credentialRef` is the SA to impersonate — the D1 identity.
const runAs = (credentialRef, dataset) =>
  runner.run(`SELECT COUNT(*) AS n FROM ${dataset}.orders`, {}, { projectId: PROJECT, credentialRef });

let pass = 0;
let fail = 0;
const check = (label, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? `  ${extra}` : ''}`);
};
const denied = (r) => !r.ok && /access denied|permission|denied/i.test(r.reason);

// 1. Each tenant SA can read its OWN dataset.
const a = await runAs(ALPHA_SA, 't_alpha');
const b = await runAs(BRAVO_SA, 't_bravo');
check('alpha SA reads t_alpha', a.ok, a.ok ? `n=${a.rows[0]?.n}` : `ERR:${a.reason}`);
check('bravo SA reads t_bravo', b.ok, b.ok ? `n=${b.rows[0]?.n}` : `ERR:${b.reason}`);

// 2. THE BACKSTOP: each tenant SA is DENIED the other dataset, even though the
//    SQL names it directly (a fully-broken binder). BigQuery refuses at the IAM
//    layer — our AST rewrite is not involved at all.
const ax = await runAs(ALPHA_SA, 't_bravo');
const bx = await runAs(BRAVO_SA, 't_alpha');
check('alpha SA is DENIED t_bravo by BigQuery (binder bypassed)', denied(ax), ax.ok ? `LEAK n=${ax.rows[0]?.n}` : ax.reason);
check('bravo SA is DENIED t_alpha by BigQuery (binder bypassed)', denied(bx), bx.ok ? `LEAK n=${bx.rows[0]?.n}` : bx.reason);

// 3. Contrast: the runtime's OWN identity (no impersonation) can see both — which
//    is exactly why the connection principal must not be the ambient one. The
//    narrow reach above comes from impersonation, not from the human's access.
const own = await runner.run('SELECT COUNT(*) AS n FROM t_bravo.orders', {}, { projectId: PROJECT, credentialRef: null });
check('runtime own identity CAN read t_bravo (shows why impersonation matters)', own.ok, own.ok ? `n=${own.rows[0]?.n}` : `ERR:${own.reason}`);

console.log(`\nresult: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
