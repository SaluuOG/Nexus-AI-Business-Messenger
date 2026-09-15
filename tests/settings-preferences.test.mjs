import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

test('Account preferences keep navigation valid and separate each account', async t => {
  const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), configFile: false, server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const rows = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: key => rows.get(key) ?? null, setItem: (key, value) => rows.set(key, value) } });
  try {
    const api = await server.ssrLoadModule('/src/features/settings/preferences.ts');
    await t.test('Missing, invalid and unknown preferences fall back to working defaults', () => {
      for (const value of [null, [], 'wrong', { identity: 'admin', startView: 'https://example.invalid' }]) {
        assert.deepEqual(api.normalizePreferences(value), { identity: 'business', startView: 'briefing' });
      }
      rows.set('nexus.preferences.v1:a', '{broken json');
      assert.deepEqual(api.readAccountPreferences('a'), api.defaultPreferences);
      assert.equal(api.startRoute('not-a-route'), '/app/briefing');
    });
    await t.test('Choices survive reload and never carry over to another account or anonymous visitor', () => {
      assert.equal(api.saveAccountPreferences('a', { identity: 'private', startView: 'groups' }), true);
      assert.deepEqual(api.readAccountPreferences('a'), { identity: 'private', startView: 'groups' });
      assert.deepEqual(api.readAccountPreferences('b'), api.defaultPreferences);
      assert.deepEqual(api.readAccountPreferences(), api.defaultPreferences);
      assert.equal(api.saveAccountPreferences(undefined, { identity: 'private', startView: 'chats' }), false);
    });
    await t.test('Blocked browser storage does not break startup or claim the setting was saved', () => {
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('Storage unavailable'); } });
      assert.deepEqual(api.readAccountPreferences('a'), api.defaultPreferences);
      assert.equal(api.saveAccountPreferences('a', { identity: 'business', startView: 'business' }), false);
    });
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete globalThis.localStorage;
    await server.close();
  }
});
