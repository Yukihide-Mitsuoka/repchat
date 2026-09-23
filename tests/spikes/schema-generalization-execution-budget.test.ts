import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { ROOT } from './report-generation/live-demo-test-helpers.ts';

const EVALUATION = path.join(ROOT, 'spikes/schema-generalization-evaluation');

function assertPython(body: string) {
  const result = spawnSync(
    'python3',
    ['-c', `import sys\nsys.path.insert(0,${JSON.stringify(EVALUATION)})\n${body}`],
    {
      cwd: ROOT,
      encoding: 'utf8',
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
}

const setup = String.raw`
from decimal import Decimal as D
from execution_budget import BudgetGate, BudgetLimits, BudgetError
limits=BudgetLimits(D('10'),D('5'),D('12'))
`;

test('budget gate reserves before calls and releases unused exposure after measured settlement', () => {
  assertPython(String.raw`
${setup}
gate=BudgetGate(limits);called=[]
def operation(name,cost):
 called.append(name)
 return name,D(cost)
assert gate.run('vertex',D('8'),lambda:operation('first','3'))=='first'
assert gate.run('bigquery',D('5'),lambda:operation('second','1'))=='second'
assert gate.run('vertex',D('7'),lambda:operation('third','2'))=='third'
assert called==['first','second','third']
assert gate.settled_jpy=={'vertex':D('5'),'bigquery':D('1')}
assert gate.unresolved_reservation_jpy=={'vertex':D('0'),'bigquery':D('0')}
at_limit=BudgetGate(limits)
assert at_limit.run('vertex',D('10'),lambda:('vertex',D('10')))=='vertex'
assert at_limit.run('bigquery',D('2'),lambda:('bigquery',D('2')))=='bigquery'
large=D('10000000000000000000000000000000')
precise=BudgetGate(BudgetLimits(large,D('1'),D('10000000000000000000000000000001')))
precise.run('vertex',large,lambda:('large',large))
assert precise.run('bigquery',D('1'),lambda:('small',D('1')))=='small'
`);
});

test('budget gate refuses provider and total ceiling breaches before the fake operation', () => {
  assertPython(String.raw`
${setup}
for provider,amount,prior in (
 ('vertex',D('10.01'),None),
 ('bigquery',D('5.01'),None),
 ('vertex',D('8'),('bigquery',D('5'))),
):
 gate=BudgetGate(limits);called=[]
 if prior:gate.run(prior[0],prior[1],lambda:('prior',prior[1]))
 try:gate.run(provider,amount,lambda:called.append('called'))
 except BudgetError:pass
 else:raise AssertionError('over-budget operation was accepted')
 assert called==[]
 try:gate.run('vertex',D('1'),lambda:called.append('retry'))
 except BudgetError:pass
 else:raise AssertionError('stopped gate allowed another operation')
 assert called==[]
`);
});

test('budget gate stops on unknown or above-reservation usage without assuming zero cost', () => {
  assertPython(String.raw`
${setup}
for outcome in (None,D('4.01'),D('-1'),D('NaN'),D('0.0000001')):
 gate=BudgetGate(limits);called=[]
 try:gate.run('vertex',D('4'),lambda:('result',outcome))
 except BudgetError:pass
 else:raise AssertionError('unknown or excessive usage was accepted')
 try:gate.run('bigquery',D('1'),lambda:called.append('next'))
 except BudgetError:pass
 else:raise AssertionError('gate continued after uncertain usage')
 assert called==[]
 assert gate.unresolved_reservation_jpy['vertex']==D('4')
gate=BudgetGate(limits)
def broken():raise RuntimeError('provider failed')
try:gate.run('vertex',D('4'),broken)
except RuntimeError:pass
else:raise AssertionError('provider failure was swallowed')
try:gate.run('vertex',D('1'),lambda:('retry',D('0')))
except BudgetError:pass
else:raise AssertionError('failure allowed a retry')
assert gate.unresolved_reservation_jpy['vertex']==D('4')
`);
});

test('budget gate rejects invalid amounts and overlapping operations', () => {
  assertPython(String.raw`
${setup}
for amount in (D('0'),D('-1'),D('NaN'),D('Infinity'),D('0.0000001'),D('1e32'),1.5,True):
 try:BudgetLimits(amount,D('5'),D('12'))
 except BudgetError:pass
 else:raise AssertionError('invalid limit was accepted')
 gate=BudgetGate(limits)
 try:gate.run('vertex',amount,lambda:('unused',D('0')))
 except BudgetError:pass
 else:raise AssertionError('invalid reservation was accepted')
try:BudgetLimits(D('1'),D('1'),D('3'))
except BudgetError:pass
else:raise AssertionError('total ceiling exceeded provider ceilings')
gate=BudgetGate(limits)
def nested():
 try:gate.run('bigquery',D('1'),lambda:('nested',D('0')))
 except BudgetError:pass
 return 'outer',D('1')
try:gate.run('vertex',D('2'),nested)
except BudgetError:pass
else:raise AssertionError('overlap was accepted')
try:gate.run('vertex',D('1'),lambda:('later',D('0')))
except BudgetError:pass
else:raise AssertionError('overlap did not stop the gate')
`);
});
