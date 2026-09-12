import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Phase 2.5 migration contains the complete protected group-management contract', async () => {
  const sql = await read('supabase/migrations/0015_complete_group_management.sql');
  const cleanupSql = await read('supabase/migrations/0016_harden_group_storage_cleanup.sql');
  const foundation = await read('supabase/migrations/0011_group_chats_foundation.sql');
  const required = [
    'nexus-group-avatars',
    'can_upload_group_avatar',
    'can_read_group_avatar',
    'can_delete_group_avatar',
    'update_group_avatar',
    'remove_group_avatar',
    'transfer_group_ownership',
    'get_group_storage_paths_for_deletion',
    'delete_group_chat',
    "gm.role = 'owner'",
    "tablename = 'group_conversations'",
    "tablename = 'group_members'",
  ];
  for (const token of required) assert.ok(sql.includes(token), `Migration fehlt: ${token}`);
  assert.match(foundation, /ALTER TABLE public\.group_conversations ENABLE ROW LEVEL SECURITY/);
  assert.match(foundation, /CREATE POLICY group_conversations_select_member/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.delete_group_chat\(uuid\) FROM public/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.delete_group_chat\(uuid\) TO authenticated/);
  assert.match(cleanupSql, /FROM storage\.objects so/);
  assert.match(cleanupSql, /owner_member\.role = 'owner'/);
});

test('Group UI exposes avatar, roles, ownership, leave and owner-only deletion flows', async () => {
  const page = await read('src/pages/GroupChatsPage.tsx');
  const data = await read('src/features/data/groupChatData.ts');
  for (const token of [
    'changeGroupAvatar',
    'clearGroupAvatar',
    'changeMemberRole',
    'transferOwnership',
    'leaveCurrentGroup',
    'deleteCurrentGroup',
    'isGroupOwner &&',
  ]) assert.ok(page.includes(token), `Gruppenoberfläche fehlt: ${token}`);
  for (const token of [
    'update_group_avatar',
    'remove_group_avatar',
    'transfer_group_ownership',
    'get_group_storage_paths_for_deletion',
    'delete_group_chat',
    "table: 'group_conversations'",
    "table: 'group_members'",
  ]) assert.ok(data.includes(token), `Datenfluss fehlt: ${token}`);
});

test('Migration sequence is complete from 0001 through 0017', async () => {
  const files = (await readdir(new URL('../supabase/migrations/', import.meta.url)))
    .filter((name) => name.endsWith('.sql'))
    .sort();
  const prefixes = files.map((name) => Number(name.slice(0, 4)));
  assert.deepEqual(prefixes, Array.from({ length: 17 }, (_, index) => index + 1));
});

test('Legacy trigger and RLS helper functions are not anonymously executable', async () => {
  const sql = await read('supabase/migrations/0017_harden_legacy_function_access.sql');
  for (const functionName of [
    'set_updated_at',
    'handle_new_user',
    'handle_new_workspace',
    'rls_auto_enable',
    'is_workspace_member',
    'has_workspace_role',
  ]) assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${functionName}\\(`));
  assert.match(sql, /ALTER FUNCTION public\.set_updated_at\(\)\s+SET search_path = public/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.is_workspace_member\(uuid\) TO authenticated/);
});

test('No privileged Supabase secret is referenced by browser source', async () => {
  const sourceFiles = [];
  const walk = async (url) => {
    for (const entry of await readdir(url, { withFileTypes: true })) {
      const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, url);
      if (entry.isDirectory()) await walk(child);
      else if (/\.(ts|tsx)$/.test(entry.name)) sourceFiles.push(child);
    }
  };
  await walk(new URL('../src/', import.meta.url));
  const source = (await Promise.all(sourceFiles.map((url) => readFile(url, 'utf8')))).join('\n');
  assert.doesNotMatch(source, /VITE_SUPABASE_SERVICE_ROLE|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY/i);
});
