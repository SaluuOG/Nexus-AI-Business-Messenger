import test from 'node:test';
import assert from 'node:assert/strict';
import {
  accountDeletionConfirmation,
  deletionBlocker,
  groupStorageObjects,
  parseSessionId,
  validateDeletionRequest,
} from '../supabase/functions/delete-account/core.mjs';

function jwt(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `header.${encoded}.signature`;
}

test('account deletion requires the exact destructive confirmation', () => {
  assert.equal(validateDeletionRequest({ confirmation: accountDeletionConfirmation }), null);
  assert.match(validateDeletionRequest({ confirmation: 'konto löschen' }), /KONTO LÖSCHEN/);
});

test('session id is read only from a well-formed JWT payload', () => {
  const id = '123e4567-e89b-12d3-a456-426614174000';
  assert.equal(parseSessionId(jwt({ session_id: id })), id);
  assert.equal(parseSessionId(jwt({ session_id: 'nope' })), null);
  assert.equal(parseSessionId('broken'), null);
});

test('owned workspaces and groups block account deletion', () => {
  assert.equal(deletionBlocker({ owned_workspaces: [], owned_groups: [] }), null);
  assert.equal(
    deletionBlocker({ owned_workspaces: [{ id: '1' }], owned_groups: [{ id: '2' }, { id: '3' }] }),
    'Übertrage oder lösche zuerst: 1 Workspace und 2 Gruppen.',
  );
});

test('storage objects are grouped by bucket and invalid entries ignored', () => {
  const grouped = groupStorageObjects([
    { bucket_id: 'chat', name: 'a' },
    { bucket_id: 'task', name: 'b' },
    { bucket_id: 'chat', name: 'c' },
    { bucket_id: null, name: 'd' },
  ]);
  assert.deepEqual([...grouped], [['chat', ['a', 'c']], ['task', ['b']]]);
});
