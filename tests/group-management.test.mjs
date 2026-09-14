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

test('Migration sequence is complete from 0001 through 0020', async () => {
  const files = (await readdir(new URL('../supabase/migrations/', import.meta.url)))
    .filter((name) => name.endsWith('.sql'))
    .sort();
  const prefixes = files.map((name) => Number(name.slice(0, 4)));
  assert.deepEqual(prefixes, Array.from({ length: 20 }, (_, index) => index + 1));
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

test('Database hardening migration closes direct access and fixes advisor findings', async () => {
  const sql = await read('supabase/migrations/0018_harden_database_access.sql');

  for (const policy of [
    'contact_links_no_direct_access',
    'contact_requests_no_direct_access',
    'workspace_invitations_no_direct_access',
  ]) assert.ok(sql.includes(policy), `RPC-only deny policy fehlt: ${policy}`);

  for (const index of [
    'contact_links_user_b_idx',
    'conversation_typing_user_id_idx',
    'direct_conversation_reads_user_id_idx',
    'workspace_invitations_accepted_by_idx',
    'workspace_invitations_invited_by_idx',
    'workspaces_owner_id_idx',
  ]) assert.ok(sql.includes(index), `Fremdschlüsselindex fehlt: ${index}`);

  assert.match(sql, /REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon, authenticated/);
  assert.match(sql, /REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon/);
  assert.match(sql, /REVOKE ALL PRIVILEGES ON FUNCTION public\.send_direct_message\(uuid, text\) FROM authenticated/);
  assert.match(sql, /ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public/);
  assert.ok((sql.match(/\(SELECT auth\.uid\(\)\)/g) ?? []).length >= 13, 'RLS-InitPlan-Optimierung ist unvollständig.');
});

test('Presence RLS checks contacts through a non-exposed helper', async () => {
  const sql = await read('supabase/migrations/0019_fix_presence_contact_rls.sql');

  assert.match(sql, /CREATE SCHEMA IF NOT EXISTS private/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION private\.is_contact\(p_user_id uuid\)/);
  assert.match(sql, /SECURITY DEFINER\s+SET search_path = public/);
  assert.match(sql, /REVOKE ALL PRIVILEGES ON FUNCTION private\.is_contact\(uuid\) FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION private\.is_contact\(uuid\) TO authenticated/);
  assert.match(sql, /OR private\.is_contact\(user_id\)/);
  assert.doesNotMatch(sql, /GRANT SELECT ON (TABLE )?public\.contact_links/i);
});
