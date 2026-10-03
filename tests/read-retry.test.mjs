import assert from 'node:assert/strict';
import test from 'node:test';
import { retryRead, briefingLoadError } from '../src/features/data/readRetry.ts';
const failure = { error: 'JWT issued at future', data: [] };
test('clock rejection recovers with bounded backoff', async () => {
  let calls = 0; const waits = [];
  const result = await retryRead(async () => ++calls < 3 ? failure : { error: null, data: ['workspace'] }, () => true, async ms => { waits.push(ms); });
  assert.equal(calls, 3); assert.deepEqual(waits, [1000, 2000]); assert.deepEqual(result.data, ['workspace']);
});
test('persistent clock rejection stops after three reads', async () => {
  let calls = 0;
  const result = await retryRead(async () => { calls++; return failure; }, () => true, async () => {});
  assert.equal(calls, 3); assert.equal(result, failure);
});
test('permission, expired session and network errors are not replayed', async () => {
  for (const error of ['permission denied', 'JWT expired', 'network error', null]) {
    let calls = 0;
    await retryRead(async () => { calls++; return { error }; }, () => true, async () => assert.fail('Unexpected retry'));
    assert.equal(calls, 1);
  }
});
test('account or workspace change during backoff prevents stale retry', async () => {
  let current = true, calls = 0;
  await retryRead(async () => { calls++; return failure; }, () => current, async () => { current = false; });
  assert.equal(calls, 1);
});
test('briefing errors hide raw infrastructure details', () => {
  assert.match(briefingLoadError(failure.error), /Sitzung/);
  assert.doesNotMatch(briefingLoadError(failure.error), /JWT/);
  assert.doesNotMatch(briefingLoadError('private backend detail'), /private backend detail/);
});
