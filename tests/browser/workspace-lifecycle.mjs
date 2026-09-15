import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';

const { chromium, webkit } = await import(pathToFileURL(process.env.NEXUS_PLAYWRIGHT_MODULE).href);
const root = fileURLToPath(new URL('../../', import.meta.url));
const stub = fileURLToPath(new URL('./supabase.mjs', import.meta.url));
const baseUrl = 'http://127.0.0.1:4181';
const server = await createServer({
  root,
  configFile: false,
  base: '/',
  server: { host: '127.0.0.1', port: 4181, strictPort: true, hmr: false },
  plugins: [{
    name: 'workspace-lifecycle-browser-fixture',
    enforce: 'pre',
    resolveId(source) {
      if (source.endsWith('/lib/supabase') || source.endsWith('/lib/env')) return stub;
    },
  }],
});

await server.listen();
await mkdir('browser-results', { recursive: true });

const selectedWorkspace = page => page.getByLabel('Workspace auswählen', { exact: true });
const lifecyclePanel = page => page.locator('.workspace-lifecycle-panel');
const lifecycleCallCount = (page, name) => page.evaluate(
  expected => window.nexusTest.lifecycleCalls.filter(call => call.name === expected).length,
  name,
);

try {
  for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await engine.launch();
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(() => sessionStorage.setItem('nexusTest.workspaceLifecycleFixture', '1'));
    await context.route('**/*', route => route.request().url().startsWith(baseUrl) ? route.continue() : route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    try {
      await page.goto(`${baseUrl}/#/app/settings?category=workspace`);
      await page.getByRole('heading', { name: 'Workspace & Team', exact: true }).waitFor();
      await lifecyclePanel(page).getByRole('heading', { name: 'Workspace verwalten', exact: true }).waitFor();
      assert.equal(await selectedWorkspace(page).inputValue(), 'w-owner');
      assert.match(await lifecyclePanel(page).innerText(), /Owner/);

      // Owner/Admin rename is persisted and the synchronous action lock prevents
      // a double click from issuing the RPC twice while its first reply is pending.
      await page.evaluate(() => { window.nexusTest.lifecycleDelay = 300; });
      await lifecyclePanel(page).getByLabel('Name', { exact: true }).fill('Nordstern Lab');
      const renameButton = lifecyclePanel(page).locator('.workspace-rename-form button[type="submit"]');
      await renameButton.evaluate(button => { button.click(); button.click(); });
      await page.waitForFunction(() => window.nexusTest.lifecycleCalls.some(call => call.name === 'rename_workspace'));
      assert.equal(await lifecycleCallCount(page, 'rename_workspace'), 1, 'Rename must be sent only once');
      assert.equal(await renameButton.isDisabled(), true, 'Rename button must stay disabled while saving');
      assert.equal(await selectedWorkspace(page).isDisabled(), true, 'Settings must lock workspace switching while the RPC is pending');
      const sidebarWorkspace = page.locator('.side .workspace select');
      assert.equal(await sidebarWorkspace.isDisabled(), true, 'Sidebar must lock workspace switching while the RPC is pending');
      await page.evaluate(() => {
        for (const select of [
          document.querySelector('#settings-workspace'),
          document.querySelector('.side .workspace select'),
        ]) {
          select.disabled = false;
          select.value = 'w-member';
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
      await page.waitForFunction(() => document.querySelector('#settings-workspace option:checked')?.textContent === 'Nordstern Lab');
      assert.equal(await selectedWorkspace(page).inputValue(), 'w-owner', 'A forced stale change event must not retarget or replace the active workspace');
      assert.equal(await sidebarWorkspace.inputValue(), 'w-owner', 'Both workspace controls must stay on the mutation target');
      assert.deepEqual(await page.evaluate(() => {
        const call = window.nexusTest.lifecycleCalls.find(entry => entry.name === 'rename_workspace');
        return call && call.args;
      }), { p_workspace_id: 'w-owner', p_name: 'Nordstern Lab' });

      // Ownership can only be transferred to an eligible Admin/Member. The
      // current owner becomes Admin after confirmation and stays in the team.
      await page.evaluate(() => { window.nexusTest.lifecycleDelay = 300; });
      const successor = lifecyclePanel(page).locator('#workspace-lifecycle-successor');
      assert.deepEqual(await successor.locator('option').allTextContents(), ['Alex Admin · Admin', 'Mira Member · Member']);
      await successor.selectOption('next-owner');
      await lifecyclePanel(page).getByRole('button', { name: 'Ownership übertragen', exact: true }).click();
      const transferDialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Neue Owner-Person festlegen?', exact: true }) });
      await transferDialog.waitFor();
      const transferConfirm = transferDialog.getByRole('button', { name: 'Ownership übertragen', exact: true });
      await transferConfirm.evaluate(button => { button.click(); button.click(); });
      await page.waitForFunction(() => window.nexusTest.lifecycleCalls.some(call => call.name === 'transfer_workspace_ownership'));
      assert.equal(await transferDialog.locator('.workspace-danger-button').isDisabled(), true, 'Transfer confirmation must stay disabled while saving');
      await transferDialog.waitFor({ state: 'detached' });
      assert.equal(await lifecycleCallCount(page, 'transfer_workspace_ownership'), 1, 'Transfer must be sent only once');
      assert.deepEqual(await page.evaluate(() => {
        const call = window.nexusTest.lifecycleCalls.find(entry => entry.name === 'transfer_workspace_ownership');
        return call && call.args;
      }), { p_workspace_id: 'w-owner', p_new_owner_id: 'next-owner' });
      await page.locator('.settings-role').filter({ hasText: 'Admin' }).waitFor();
      await lifecyclePanel(page).getByRole('button', { name: 'Workspace verlassen', exact: true }).waitFor();

      // A non-owner can leave. The removed workspace disappears immediately and
      // the app deterministically falls back to the first remaining workspace.
      await page.evaluate(() => { window.nexusTest.lifecycleDelay = 0; });
      await selectedWorkspace(page).selectOption('w-member');
      await page.locator('.settings-role').filter({ hasText: 'Member' }).waitFor();
      await lifecyclePanel(page).getByRole('button', { name: 'Workspace verlassen', exact: true }).click();
      const leaveDialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Workspace wirklich verlassen?', exact: true }) });
      await leaveDialog.waitFor();
      await leaveDialog.getByRole('button', { name: 'Workspace verlassen', exact: true }).click();
      await leaveDialog.waitFor({ state: 'detached' });
      await page.waitForFunction(() => document.querySelector('#settings-workspace')?.value === 'w-owner');
      assert.equal(await selectedWorkspace(page).locator('option[value="w-member"]').count(), 0);
      assert.equal(await lifecycleCallCount(page, 'leave_workspace'), 1);
      assert.deepEqual(await page.evaluate(() => {
        const call = window.nexusTest.lifecycleCalls.find(entry => entry.name === 'leave_workspace');
        return call && call.args;
      }), { p_workspace_id: 'w-member' });

      // Destructive deletion stays disabled until the current name matches
      // exactly, then requires a second modal confirmation and selects a fallback.
      await selectedWorkspace(page).selectOption('w-delete');
      await page.locator('.settings-role').filter({ hasText: 'Owner' }).waitFor();
      const deleteInput = lifecyclePanel(page).getByLabel(/Gib zur Bestätigung/);
      const deleteButton = lifecyclePanel(page).getByRole('button', { name: 'Workspace löschen', exact: true });
      await deleteInput.fill('archiv workspace');
      assert.equal(await deleteButton.isDisabled(), true, 'Deletion must require an exact, case-sensitive name');
      assert.equal(await lifecycleCallCount(page, 'delete_workspace'), 0);
      await deleteInput.fill('Archiv Workspace');
      assert.equal(await deleteButton.isEnabled(), true);
      await deleteButton.click();
      const deleteDialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Workspace endgültig löschen?', exact: true }) });
      await deleteDialog.waitFor();
      await deleteDialog.getByRole('button', { name: 'Endgültig löschen', exact: true }).click();
      await deleteDialog.waitFor({ state: 'detached' });
      await page.waitForFunction(() => document.querySelector('#settings-workspace')?.value === 'w-owner');
      assert.equal(await selectedWorkspace(page).locator('option[value="w-delete"]').count(), 0);
      assert.equal(await lifecycleCallCount(page, 'delete_workspace'), 1);
      assert.deepEqual(await page.evaluate(() => {
        const call = window.nexusTest.lifecycleCalls.find(entry => entry.name === 'delete_workspace');
        return call && call.args;
      }), { p_workspace_id: 'w-delete', p_confirmation: 'Archiv Workspace' });

      // 390 px layout and dialog semantics remain usable with a keyboard.
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Mobile page must not overflow horizontally');
      assert.equal(await lifecyclePanel(page).isVisible(), true);
      assert.equal(await lifecyclePanel(page).getByLabel('Name', { exact: true }).isVisible(), true);
      await lifecyclePanel(page).getByRole('button', { name: 'Workspace verlassen', exact: true }).click();
      const mobileDialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Workspace wirklich verlassen?', exact: true }) });
      await mobileDialog.waitFor();
      assert.equal(await mobileDialog.getAttribute('aria-labelledby'), 'workspace-lifecycle-dialog-title');
      assert.equal(await mobileDialog.getAttribute('aria-describedby'), 'workspace-lifecycle-dialog-description');
      await page.keyboard.press('Escape');
      await mobileDialog.waitFor({ state: 'detached' });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Mobile dialog must not create horizontal overflow');

      // The narrowest supported phone width must keep the complete lifecycle
      // surface inside the viewport. Its primary form and confirmation dialog
      // must remain operable instead of merely being present in the DOM.
      await page.setViewportSize({ width: 320, height: 700 });
      const narrowLayout = await page.evaluate(() => {
        const panel = document.querySelector('.workspace-lifecycle-panel')?.getBoundingClientRect();
        const nameInput = document.querySelector('#workspace-lifecycle-name')?.getBoundingClientRect();
        const renameButton = document.querySelector('.workspace-rename-form button[type="submit"]')?.getBoundingClientRect();
        const viewportWidth = document.documentElement.clientWidth;
        return {
          innerWidth,
          viewportWidth,
          documentWidth: document.documentElement.scrollWidth,
          bodyWidth: document.body.scrollWidth,
          panel: panel && { left: panel.left, right: panel.right },
          nameInput: nameInput && { left: nameInput.left, right: nameInput.right },
          renameButton: renameButton && { left: renameButton.left, right: renameButton.right },
        };
      });
      assert.equal(narrowLayout.innerWidth, 320, 'The narrow layout must be tested at an actual 320px viewport');
      assert.equal(narrowLayout.documentWidth <= narrowLayout.viewportWidth, true, '320px page must not overflow horizontally');
      assert.equal(narrowLayout.bodyWidth <= narrowLayout.viewportWidth, true, '320px body must not overflow horizontally');
      for (const [label, bounds] of [
        ['Lifecycle panel', narrowLayout.panel],
        ['Workspace name input', narrowLayout.nameInput],
        ['Rename button', narrowLayout.renameButton],
      ]) {
        assert.ok(bounds, `${label} must be rendered at 320px`);
        assert.equal(bounds.left >= 0 && bounds.right <= narrowLayout.viewportWidth, true, `${label} must stay inside the 320px viewport`);
      }

      const narrowNameInput = lifecyclePanel(page).getByLabel('Name', { exact: true });
      await narrowNameInput.fill('Nordstern Labor');
      assert.equal(await renameButton.isEnabled(), true, 'Rename must remain operable at 320px');
      await narrowNameInput.fill('Nordstern Lab');
      await lifecyclePanel(page).getByRole('button', { name: 'Workspace verlassen', exact: true }).click();
      const narrowDialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Workspace wirklich verlassen?', exact: true }) });
      await narrowDialog.waitFor();
      const narrowDialogLayout = await narrowDialog.evaluate((dialog) => {
        const bounds = dialog.getBoundingClientRect();
        const cancel = dialog.querySelector('.workspace-lifecycle-dialog-actions button')?.getBoundingClientRect();
        const confirm = dialog.querySelector('.workspace-lifecycle-dialog-actions .workspace-danger-button')?.getBoundingClientRect();
        return {
          viewportWidth: document.documentElement.clientWidth,
          viewportHeight: innerHeight,
          documentWidth: document.documentElement.scrollWidth,
          dialog: { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom },
          cancel: cancel && { left: cancel.left, right: cancel.right },
          confirm: confirm && { left: confirm.left, right: confirm.right },
        };
      });
      assert.equal(narrowDialogLayout.documentWidth <= narrowDialogLayout.viewportWidth, true, '320px dialog must not create horizontal overflow');
      assert.equal(
        narrowDialogLayout.dialog.left >= 0
          && narrowDialogLayout.dialog.right <= narrowDialogLayout.viewportWidth
          && narrowDialogLayout.dialog.top >= 0
          && narrowDialogLayout.dialog.bottom <= narrowDialogLayout.viewportHeight,
        true,
        'Dialog must stay fully inside the 320px viewport',
      );
      for (const [label, bounds] of [
        ['Cancel action', narrowDialogLayout.cancel],
        ['Confirm action', narrowDialogLayout.confirm],
      ]) {
        assert.ok(bounds, `${label} must be rendered at 320px`);
        assert.equal(bounds.left >= 0 && bounds.right <= narrowDialogLayout.viewportWidth, true, `${label} must stay inside the 320px dialog`);
      }
      await narrowDialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
      await narrowDialog.waitFor({ state: 'detached' });

      await page.screenshot({ path: `browser-results/${name}-workspace-lifecycle-mobile.png`, fullPage: true });
      assert.deepEqual(pageErrors, []);
      console.log(`${name}: workspace rename, ownership transfer, leave/delete fallback, action lock and 390/320px accessibility passed`);
    } catch (error) {
      await page.screenshot({ path: `browser-results/${name}-workspace-lifecycle-failure.png`, fullPage: true });
      console.error('Browser errors:', pageErrors);
      console.error('Test URL:', page.url());
      console.error('Test UI:', (await page.locator('body').innerText()).slice(0, 9000));
      throw error;
    } finally {
      await context.close();
      await browser.close();
    }
  }
} finally {
  await server.close();
}
