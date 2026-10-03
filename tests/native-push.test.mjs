import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativePushEnrollment, createNativePushActionHandler, nativePushTarget, parseNativePushOptions } from '../src/features/notifications/nativePush.ts';
const chat = '12345678-1234-1234-1234-123456789012';
const payload = { v: 1, id: 'delivery-1', recipient: 'user-a', device: 'device', expires: 2000, path: `/app/chats?conversation=${chat}` };
const options = parseNativePushOptions(null);
function fixture(ready = true) {
  const calls = [];
  const platform = { permission: async () => { calls.push('permission'); return 'prompt'; }, requestPermission: async () => { calls.push('prompt'); return 'granted'; }, register: async () => { calls.push('register'); return 'a'.repeat(64); }, unregister: async () => { calls.push('unregister'); }, clearDelivered: async () => { calls.push('clear'); } };
  const backend = { bind: async value => { calls.push(['bind', value]); }, unbind: async () => { calls.push('unbind'); }, saveOptions: async () => { calls.push('save'); } };
  return { calls, platform, backend, create: () => createNativePushEnrollment({ ready, environment: 'sandbox', deviceId: 'device', platform, backend }) };
}
test('Personal Team gate performs no OS or backend calls', async () => {
  const f = fixture(false), session = f.create();
  await assert.rejects(session.enable(options), /nicht freigeschaltet/);
  await session.dispose();
  assert.deepEqual(f.calls, []);
});
test('enrolment waits for permission and persisted binding before marking enabled', async () => {
  const f = fixture(), session = f.create();
  await session.enable(options);
  assert.equal(session.enabled, true);
  assert.deepEqual(f.calls.slice(0, 3), ['permission', 'prompt', 'register']);
  assert.equal(f.calls[3][1].environment, 'sandbox');
  assert.equal(f.calls[3][1].options.previews, false);
  await session.disable();
  assert.equal(session.enabled, false);
  assert.deepEqual(f.calls.slice(-3), ['unregister', 'clear', 'unbind']);
});
test('denied permission never registers a device', async () => {
  const f = fixture(); f.platform.permission = async () => 'denied';
  const session = f.create(); await assert.rejects(session.enable(options), /nicht erlaubt/);
  assert.equal(session.enabled, false);
  assert.equal(f.calls.includes('register'), false);
  assert.equal(f.calls.some(x => Array.isArray(x)), false);
});
test('backend failure cannot produce an active state or expose raw token', async () => {
  const f = fixture(); f.backend.bind = async () => { throw new Error('offline'); };
  const session = f.create(); await assert.rejects(session.enable(options), /nicht gespeichert/);
  assert.equal(session.enabled, false); assert.ok(f.calls.includes('unregister')); assert.ok(f.calls.includes('unbind'));
});
test('logout during registration rejects the late token without binding', async () => {
  const f = fixture(); let release; let started;
  const waiting = new Promise(resolve => { started = resolve; });
  f.platform.register = async () => { started(); return new Promise(resolve => { release = resolve; }); };
  const session = f.create(); const pending = session.enable(options);
  await waiting; await session.dispose(); release('a'.repeat(64));
  await assert.rejects(pending, /Sitzung/);
  assert.equal(f.calls.some(x => Array.isArray(x)), false);
});
test('logout during persistence removes late server binding', async () => {
  const f = fixture(); let release; let started;
  const waiting = new Promise(resolve => { started = resolve; });
  f.backend.bind = async () => { started(); await new Promise(resolve => { release = resolve; }); };
  const session = f.create(); const pending = session.enable(options);
  await waiting; await session.dispose(); release(); await assert.rejects(pending, /Sitzung/);
  assert.equal(f.calls.filter(x => x === 'unbind').length, 2);
});
test('push actions are bounded to the matching account, device and valid internal destination', () => {
  assert.equal(nativePushTarget(payload, 'user-a', 'device', 1000), payload.path);
  for (const patch of [{ recipient: 'other' }, { device: 'other' }, { expires: 999 }, { path: 'https://evil.invalid' }, { path: '/app/chats?conversation=x' }, { path: payload.path + '&redirect=https://evil.invalid' }, { path: '/app/groups?conversation=' + chat }]) {
    assert.equal(nativePushTarget({ ...payload, ...patch }, 'user-a', 'device', 1000), null);
  }
});
test('cold-start action waits for session restoration and duplicate taps open once', () => {
  let user = null; const paths = [];
  const handler = createNativePushActionHandler({ deviceId: 'device', userId: () => user, navigate: p => paths.push(p), now: () => 1000 });
  handler.handle(payload); assert.deepEqual(paths, []);
  user = 'user-a'; handler.flush(); handler.handle(payload);
  assert.deepEqual(paths, [payload.path]);
  handler.clear(); user = 'user-b'; handler.handle(payload); assert.equal(paths.length, 1);
});
test('preference parsing keeps previews private and ignores extra properties', () => {
  assert.equal(parseNativePushOptions({ previews: 'true' }).previews, false);
  assert.deepEqual(parseNativePushOptions({ messages: false, token: 'never persist' }), { ...options, messages: false });
});

test('task navigation accepts only complete scoped targets', () => {
  const path = `/app/business?workspace=${chat}&view=tasks&project=${chat}&task=${chat}`;
  assert.equal(nativePushTarget({ ...payload, path }, 'user-a', 'device', 1000), path);
  assert.equal(nativePushTarget({ ...payload, path: path + '&other=1' }, 'user-a', 'device', 1000), null);
});
