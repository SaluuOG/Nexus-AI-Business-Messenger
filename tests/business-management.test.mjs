import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Phase 3.1 migration creates tenant-safe customer and project records', async () => {
  const sql = await read('supabase/migrations/0020_business_management.sql');

  for (const token of [
    'CREATE TABLE public.customers',
    'CREATE TABLE public.projects',
    'workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE',
    'customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL',
    'ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY',
    'ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY',
    'customers_select_workspace',
    'projects_select_workspace',
    'public.is_workspace_member(workspace_id)',
    'guard_business_record_scope',
    'validate_project_customer_scope',
    'ALTER PUBLICATION supabase_realtime ADD TABLE public.customers',
    'ALTER PUBLICATION supabase_realtime ADD TABLE public.projects',
  ]) {
    assert.ok(sql.includes(token), `Business-Migration fehlt: ${token}`);
  }

  assert.match(sql, /customers_insert_managers[\s\S]*ARRAY\['owner', 'admin'\]/);
  assert.match(sql, /customers_update_team[\s\S]*ARRAY\['owner', 'admin', 'member'\]/);
  assert.match(sql, /customers_delete_managers[\s\S]*ARRAY\['owner', 'admin'\]/);
  assert.match(sql, /projects_insert_managers[\s\S]*ARRAY\['owner', 'admin'\]/);
  assert.match(sql, /projects_update_team[\s\S]*ARRAY\['owner', 'admin', 'member'\]/);
  assert.match(sql, /projects_delete_managers[\s\S]*ARRAY\['owner', 'admin'\]/);
  assert.match(sql, /REVOKE ALL PRIVILEGES ON FUNCTION public\.guard_business_record_scope\(\)/);
});

test('Business data layer includes persistent CRUD and realtime synchronization', async () => {
  const data = await read('src/features/data/businessData.ts');

  for (const token of [
    "from('customers')",
    "from('projects')",
    'loadBusinessWorkspace',
    'createCustomer',
    'updateCustomer',
    'deleteCustomer',
    'createProject',
    'updateProject',
    'deleteProject',
    'subscribeToBusinessWorkspace',
    "table: 'customers'",
    "table: 'projects'",
    'removeChannel',
  ]) {
    assert.ok(data.includes(token), `Business-Datenfluss fehlt: ${token}`);
  }
});

test('Business UI uses real workspace data and enforces role-aware actions', async () => {
  const [page, app] = await Promise.all([
    read('src/pages/BusinessPage.tsx'),
    read('src/app/App.tsx'),
  ]);

  for (const token of [
    "workspaceRole === 'owner' || workspaceRole === 'admin'",
    "workspaceRole === 'member'",
    'loadBusinessWorkspace',
    'Kunde erfolgreich angelegt.',
    'Projekt erfolgreich angelegt.',
    'Auftragswert',
    'Überfällige Deadlines',
    'Projekte durchsuchen',
    'Kunden durchsuchen',
  ]) {
    assert.ok(page.includes(token), `Business-Oberfläche fehlt: ${token}`);
  }

  assert.doesNotMatch(page, /Restaurant Bella|Zahnarzt Meier/);
  assert.match(app, /workspaceId=\{selectedWorkspaceId\}/);
  assert.match(app, /workspaceRole=\{currentWorkspaceRole\}/);
});
