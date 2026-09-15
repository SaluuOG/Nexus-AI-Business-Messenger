import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

test('Workspace lifecycle UI exposes only role-safe actions and successors', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const server = await createServer({
    root,
    configFile: false,
    server: { middlewareMode: true },
    appType: 'custom',
  });

  try {
    const { WorkspaceLifecyclePanel } = await server.ssrLoadModule('/src/components/WorkspaceLifecyclePanel.tsx');
    const workspace = {
      id: 'workspace-1',
      owner_id: 'owner-1',
      name: 'Nexus <Team>',
      slug: 'nexus-team',
      avatar_url: null,
    };
    const members = [
      { user_id: 'owner-1', role: 'owner', joined_at: '', full_name: 'Aktueller Owner', username: null, avatar_url: null },
      { user_id: 'admin-2', role: 'admin', joined_at: '', full_name: 'Neue Admin', username: null, avatar_url: null },
      { user_id: 'member-3', role: 'member', joined_at: '', full_name: null, username: 'member3', avatar_url: null },
      { user_id: 'guest-4', role: 'guest', joined_at: '', full_name: 'Nur Gast', username: null, avatar_url: null },
    ];
    const common = {
      selectedWorkspace: workspace,
      currentUserId: 'owner-1',
      members,
      onRename: async () => ({ error: null }),
      onLeave: async () => ({ error: null }),
      onTransfer: async () => ({ error: null }),
      onDelete: async () => ({ error: null }),
    };
    const renderRole = (role, currentUserId = common.currentUserId) => renderToStaticMarkup(
      React.createElement(WorkspaceLifecyclePanel, { ...common, currentRole: role, currentUserId }),
    );

    const owner = renderRole('owner');
    assert.match(owner, /Namen speichern/);
    assert.match(owner, /Ownership übertragen/);
    assert.match(owner, /Neue Admin/);
    assert.match(owner, /@member3/);
    assert.doesNotMatch(owner, /Nur Gast/);
    assert.doesNotMatch(owner, /Aktueller Owner.*option/);
    assert.match(owner, /Workspace löschen/);
    assert.match(owner, /Nexus &lt;Team&gt;/);

    const admin = renderRole('admin', 'admin-2');
    assert.match(admin, /Namen speichern/);
    assert.match(admin, /Workspace verlassen/);
    assert.doesNotMatch(admin, /Workspace löschen/);
    assert.doesNotMatch(admin, /Neue Owner-Person/);

    const member = renderRole('member', 'member-3');
    assert.match(member, /Workspace verlassen/);
    assert.match(member, /Nur Owner und Admins können den Workspace umbenennen/);
    assert.doesNotMatch(member, /Workspace löschen/);
  } finally {
    await server.close();
  }
});
