import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

test('Phase 3.8 workspace lifecycle uses only the protected RPC contract', async t => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const stubPath = fileURLToPath(new URL('./support/supabaseStub.mjs', import.meta.url));
  const server = await createServer({
    root,
    configFile: false,
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
    plugins: [{
      name: 'workspace-lifecycle-data-fixture',
      enforce: 'pre',
      resolveId(source) {
        if (source.endsWith('/lib/supabase')) return stubPath;
      },
    }],
  });

  try {
    const api = await server.ssrLoadModule('/src/features/data/nexusData.ts');
    const stub = await server.ssrLoadModule('/tests/support/supabaseStub.mjs');

    await t.test('rename trims the new name and calls rename_workspace', async () => {
      stub.setResponse(() => ({ data: null, error: null }));

      assert.deepEqual(await api.renameWorkspace('workspace-1', '  Neues Team  '), { error: null });
      assert.deepEqual(stub.requests, [{
        rpc: 'rename_workspace',
        args: { p_workspace_id: 'workspace-1', p_name: 'Neues Team' },
      }]);
    });

    await t.test('ownership transfer sends the selected successor', async () => {
      stub.setResponse(() => ({ data: null, error: null }));

      assert.deepEqual(
        await api.transferWorkspaceOwnership('workspace-1', 'member-2'),
        { error: null },
      );
      assert.deepEqual(stub.requests, [{
        rpc: 'transfer_workspace_ownership',
        args: { p_workspace_id: 'workspace-1', p_new_owner_id: 'member-2' },
      }]);
    });

    await t.test('leave calls the authenticated self-service RPC without a user id', async () => {
      stub.setResponse(() => ({ data: null, error: null }));

      assert.deepEqual(await api.leaveWorkspace('workspace-1'), { error: null });
      assert.deepEqual(stub.requests, [{
        rpc: 'leave_workspace',
        args: { p_workspace_id: 'workspace-1' },
      }]);
    });

    await t.test('delete forwards the explicit confirmation and never deletes the table directly', async () => {
      stub.setResponse(() => ({ data: null, error: null }));

      assert.deepEqual(
        await api.deleteWorkspace('workspace-1', 'Nexus / AI-Messenger'),
        { error: null },
      );
      assert.deepEqual(stub.requests, [{
        rpc: 'delete_workspace',
        args: {
          p_workspace_id: 'workspace-1',
          p_confirmation: 'Nexus / AI-Messenger',
        },
      }]);
      assert.equal(stub.requests.some(request => request.table === 'workspaces'), false);
    });

    await t.test('all RPC failures expose the existing message-only result shape', async () => {
      for (const invoke of [
        () => api.renameWorkspace('workspace-1', 'Team'),
        () => api.transferWorkspaceOwnership('workspace-1', 'member-2'),
        () => api.leaveWorkspace('workspace-1'),
        () => api.deleteWorkspace('workspace-1', 'Team'),
      ]) {
        stub.setResponse(() => ({
          data: null,
          error: { code: 'P0001', message: 'Aktion nicht erlaubt.', details: 'internal' },
        }));

        assert.deepEqual(await invoke(), { error: 'Aktion nicht erlaubt.' });
        assert.equal(stub.requests.length, 1);
      }
    });
  } finally {
    await server.close();
  }
});
