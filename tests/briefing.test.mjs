import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const briefing = readFileSync(new URL('../src/pages/BriefingPage.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/app/App.tsx', import.meta.url), 'utf8');
const business = readFileSync(new URL('../src/pages/BusinessPage.tsx', import.meta.url), 'utf8');
const tasks = readFileSync(new URL('../src/components/ProjectTasksPanel.tsx', import.meta.url), 'utf8');

test('briefing is backed by the selected workspace data', () => {
  assert.match(briefing, /loadBusinessWorkspace/);
  assert.match(briefing, /subscribeToBusinessWorkspace/);
  assert.match(briefing, /Heute erledigen/);
  assert.match(briefing, /Handlungsbedarf/);
  assert.doesNotMatch(briefing, /Autohaus Müller|Restaurant Bella|Zahnarzt Meier/);
});

test('briefing actions link to real business records', () => {
  assert.match(app, /openBusiness=\{\(target\) =>/);
  assert.match(app, /params\.set\('task', target\.taskId\)/);
  assert.match(business, /requestedTaskId/);
  assert.match(business, /nexus-project-/);
  assert.match(tasks, /nexus-task-/);
});

test('briefing live refreshes are debounced and safe', () => {
  assert.match(briefing, /setTimeout\(\(\) => void refresh\(false\), 150\)/);
  assert.match(briefing, /visibilitychange/);
  assert.match(briefing, /unsubscribeBusinessWorkspace/);
});
