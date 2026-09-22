import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';
const { chromium, webkit } = await import(pathToFileURL(process.env.NEXUS_PLAYWRIGHT_MODULE).href);
const root = fileURLToPath(new URL('../../', import.meta.url));
const stub = fileURLToPath(new URL('./supabase.mjs', import.meta.url));
const base = 'http://127.0.0.1:4182';
const server = await createServer({ root, configFile: false, base: '/', server: { host: '127.0.0.1', port: 4182, strictPort: true, hmr: false },
  plugins: [{ name: 'mobile-workflow-fixture', enforce: 'pre', resolveId(source) { if (source.endsWith('/lib/supabase') || source.endsWith('/lib/env')) return stub; } }],
});
await server.listen();
await mkdir('browser-results', { recursive: true });
const fits = async page => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'No horizontal overflow');
const navigate = async (page, label) => {
  await page.getByRole('button', { name: 'Hauptmenü öffnen', exact: true }).click();
  await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('button', { name: label, exact: true }).click();
};
try {
  for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await engine.launch();
    try {
      for (const width of [390, 320]) {
        const context = await browser.newContext({ viewport: { width, height: 844 } });
        await context.addInitScript(() => {
          sessionStorage.setItem('nexusTest.mobileBusinessFixture', '1');
          sessionStorage.setItem('nexusTest.messageHistoryFixture', '1');
          // Test-only microphone: exercise cleanup without capturing any audio.
          window.voiceFixture = { stops: 0, delayed: false, resolve: null };
          Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: () => {
            const stream = { getTracks: () => [{ stop: () => { window.voiceFixture.stops++; } }] };
            return window.voiceFixture.delayed ? new Promise(resolve => { window.voiceFixture.resolve = () => resolve(stream); }) : Promise.resolve(stream);
          } } });
          window.MediaRecorder = class {
            static isTypeSupported() { return true; }
            constructor(stream, options) { this.mimeType = options?.mimeType || 'audio/webm'; this.state = 'inactive'; }
            start() { this.state = 'recording'; }
            stop() { this.state = 'inactive'; this.onstop?.(); }
          };
        });
        await context.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
        const page = await context.newPage();
        page.setDefaultTimeout(15_000);
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        try {
          await page.goto(base + '/#/app/chats');
          const contact = page.locator('.chat-list .chat').filter({ hasText: 'Test Kontakt' });
          await contact.waitFor();
          assert.equal(await page.locator('.conversation').isVisible(), false);
          assert.equal(await page.evaluate(() => window.nexusTest.chatReadCalls.length), 0, 'List must not mark hidden conversations read');
          await fits(page);
          await page.screenshot({ path: `browser-results/${name}-chat-list-${width}.png` });
          await contact.click();
          await page.locator('.messages [data-message-id]').first().waitFor();
          assert.equal(await page.locator('.chat-list').isVisible(), false);
          const messageBox = await page.locator('.messages').boundingBox();
          assert.ok(messageBox.height > 350, `Conversation gets the mobile screen: ${messageBox.height}`);
          const input = page.getByTestId('direct-message-composer');
          await input.fill('Entwurf für Kunden');
          await fits(page);
          await page.screenshot({ path: `browser-results/${name}-chat-conversation-${width}.png` });
          await page.getByRole('button', { name: 'Sprachnachricht aufnehmen', exact: true }).click();
          await page.locator('.voice-recording').waitFor();
          await page.getByRole('button', { name: 'Alle Chats', exact: true }).click();
          await page.waitForFunction(() => window.voiceFixture.stops > 0);
          await contact.waitFor();
          await page.locator('.chat-list .chat').filter({ hasText: 'Zweiter Kontakt' }).click();
          await page.waitForURL(/conversation=c2/);
          assert.equal(await input.inputValue(), '');
          await page.goBack();
          await contact.waitFor();
          assert.equal(await page.locator('.conversation').isVisible(), false);
          await contact.click();
          await page.waitForFunction(() => document.querySelector('[data-testid="direct-message-composer"]')?.value === 'Entwurf für Kunden');
          assert.equal(await page.locator('.voice-recording').count(), 0);
          await input.fill('Nachricht aus mobilem Kundentest');
          await page.locator('.composer').getByRole('button', { name: 'Nachricht senden', exact: true }).click();
          await page.locator('.messages').getByText('Nachricht aus mobilem Kundentest', { exact: true }).waitFor();
          const stoppedBeforePrompt = await page.evaluate(() => { window.voiceFixture.delayed = true; return window.voiceFixture.stops; });
          await page.getByRole('button', { name: 'Sprachnachricht aufnehmen', exact: true }).click();
          await page.waitForFunction(() => Boolean(window.voiceFixture.resolve));
          await page.getByRole('button', { name: 'Alle Chats', exact: true }).click();
          await contact.waitFor();
          await page.evaluate(() => { window.voiceFixture.resolve(); window.voiceFixture.delayed = false; });
          await page.waitForFunction(before => window.voiceFixture.stops > before, stoppedBeforePrompt);
          await navigate(page, 'Gruppen');
          const group = page.locator('.chat-list .chat').filter({ hasText: 'Projektgruppe' });
          await group.waitFor();
          assert.equal(await page.locator('.conversation').isVisible(), false);
          await group.click();
          await page.locator('.messages [data-message-id]').first().waitFor();
          assert.equal(await page.locator('.chat-list').isVisible(), false);
          await page.getByRole('button', { name: 'Mitglieder', exact: true }).click();
          await page.getByRole('button', { name: 'Mitglieder', exact: true }).click();
          const beforeGroupBack = await page.evaluate(() => window.voiceFixture.stops);
          await page.getByRole('button', { name: 'Sprachnachricht aufnehmen', exact: true }).click();
          await page.locator('.voice-recording').waitFor();
          await page.getByRole('button', { name: 'Alle Gruppen', exact: true }).click();
          await page.waitForFunction(before => window.voiceFixture.stops > before, beforeGroupBack);
          await group.waitFor();
          await group.click();
          await page.waitForURL(/group=/);
          await page.goBack();
          await group.waitFor();
          assert.equal(await page.locator('.conversation').isVisible(), false);
          // Member and Guest retain the task entry, without customer/project editing.
          for (const [workspaceId, writableTasks] of [['w1', true], ['w2', false]]) {
            await page.goto(base + '/#/app/business?workspace=' + workspaceId);
            await page.locator('.business-project-card').first().waitFor();
            assert.equal(await page.getByRole('tab', { name: /Aufgaben/ }).count(), 0);
            assert.equal(await page.locator('.business-project-card').getByRole('button', { name: /Bearbeiten|Löschen/ }).count(), 0);
            await page.locator('.business-project-card').first().getByRole('button', { name: /Aufgaben/ }).click();
            await page.locator('.task-card').first().waitFor();
            assert.equal(await page.getByRole('tab', { name: /Projekte/ }).getAttribute('aria-selected'), 'true');
            assert.equal(await page.getByRole('button', { name: 'Aufgabe anlegen', exact: true }).count(), writableTasks ? 1 : 0);
            await page.getByRole('tab', { name: /Kunden/ }).click();
            await page.getByRole('heading', { name: 'Kunde Muster', exact: true }).waitFor();
            assert.equal(await page.locator('.business-customer-card').getByRole('button', { name: /Bearbeiten|Löschen/ }).count(), 0);
            await page.getByRole('button', { name: 'Chat mit Kunde ohne Chat öffnen', exact: true }).click();
            await page.getByText(/noch kein Nexus-Kontakt verknüpft/).waitFor();
            assert.equal(await page.getByRole('dialog').count(), 0);
          }
          // A customer shortcut opens exactly its linked conversation.
          await page.getByRole('button', { name: 'Chat mit Kunde Muster öffnen', exact: true }).click();
          await page.waitForURL(/chats\?conversation=c1/);
          await page.locator('.chat-head-person').getByText('Test Kontakt', { exact: true }).waitFor();
          assert.equal(await page.locator('.chat-list').isVisible(), false);
          assert.deepEqual(await page.evaluate(() => window.nexusTest.customerChatCalls), ['other']);
          // Manager links a customer and assigns tasks during project creation.
          await page.goto(base + '/#/app/business?workspace=w3&view=customers');
          await page.getByRole('button', { name: 'Chat mit Kunde ohne Chat öffnen', exact: true }).click();
          const customerDialog = page.getByRole('dialog', { name: 'Kunden bearbeiten' });
          const contactPicker = customerDialog.getByLabel('Nexus-Kontakt für Kundenchat');
          await page.waitForFunction(() => [...document.querySelectorAll('select option')].some(option => option.textContent.includes('@test')));
          await contactPicker.selectOption('other');
          await customerDialog.getByRole('button', { name: 'Änderungen speichern', exact: true }).click();
          await customerDialog.waitFor({ state: 'hidden' });
          assert.equal(await page.evaluate(() => window.nexusTest.customers.find(c => c.id === 'unlinked-w3').chat_user_id), 'other');
          await page.getByRole('tab', { name: /Projekte/ }).click();
          await page.getByRole('button', { name: 'Projekt', exact: true }).click();
          const dialog = page.getByRole('dialog', { name: 'Neues Projekt anlegen' });
          await dialog.getByLabel('Projekttitel *', { exact: true }).fill('Mobiles Kundenprojekt');
          await dialog.getByRole('button', { name: 'Aufgabe hinzufügen', exact: true }).click();
          const first = dialog.getByRole('group', { name: 'Aufgabe 1', exact: true });
          await first.getByLabel('Aufgabentitel *', { exact: true }).fill('Entwurf erstellen');
          await first.getByLabel('Verantwortlich', { exact: true }).selectOption('other');
          assert.equal(await first.locator('option[value="guest-user"]').count(), 0);
          await first.getByLabel('Fällig am', { exact: true }).fill('2026-10-01');
          await first.getByLabel('Priorität der Aufgabe', { exact: true }).selectOption('high');
          await dialog.getByRole('button', { name: 'Aufgabe hinzufügen', exact: true }).click();
          await dialog.getByRole('group', { name: 'Aufgabe 2', exact: true }).getByLabel('Aufgabentitel *', { exact: true }).fill('Abnahme vorbereiten');
          await fits(page);
          await page.screenshot({ path: `browser-results/${name}-project-tasks-${width}.png`, fullPage: true });
          await page.evaluate(() => { window.nexusTest.failure = 'create_project_with_tasks'; });
          await dialog.getByRole('button', { name: 'Projekt anlegen', exact: true }).click();
          await dialog.getByText(/verantwortliche Person muss/).waitFor();
          assert.equal(await page.evaluate(() => window.nexusTest.projects.some(p => p.title === 'Mobiles Kundenprojekt')), false);
          await page.evaluate(() => { window.nexusTest.failure = null; });
          await dialog.getByRole('button', { name: 'Projekt anlegen', exact: true }).click();
          await dialog.waitFor({ state: 'hidden' });
          const card = page.locator('.business-project-card').filter({ hasText: 'Mobiles Kundenprojekt' });
          await card.waitFor();
          const calls = await page.evaluate(() => window.nexusTest.projectCreateCalls);
          assert.equal(calls.length, 2); assert.equal(calls[0].p_project_id, calls[1].p_project_id);
          assert.equal(calls[1].p_tasks[0].assigned_to, 'other');
          assert.equal(calls[1].p_tasks[0].due_date, '2026-10-01');
          await card.getByRole('button', { name: /Aufgaben/ }).click();
          await page.getByRole('heading', { name: 'Entwurf erstellen', exact: true }).waitFor();
          assert.equal(await page.locator('.task-card').count(), 2);
          await fits(page);
          assert.deepEqual(errors, []);
          console.log(`${name} ${width}px: list/detail/back, drafts, sending, groups, customer link/chat, manager project assignment, role-aware tasks and failed-save retry passed`);
        } catch (error) {
          await page.screenshot({ path: `browser-results/${name}-mobile-workflow-failure-${width}.png`, fullPage: true });
          console.error(await page.locator('body').innerText());
          throw error;
        } finally { await context.close(); }
      }
    } finally { await browser.close(); }
  }
} finally { await server.close(); }
