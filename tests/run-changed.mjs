// Select the affected checks from the actual change set. Unknown application
// paths conservatively retain the complete suite; full checks remain available.
import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';

const unit = new Set(), browser = new Set();
let full = process.argv.includes('--full');
let changed = [];
try {
  const event = process.env.GITHUB_EVENT_PATH ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH,'utf8')) : {};
  const ref = process.env.NEXUS_TEST_BASE || event.pull_request?.base?.sha || event.before;
  const base = ref === 'origin/main' ? execFileSync('git',['rev-parse','origin/main'],{encoding:'utf8'}).trim() : ref;
  if (!base || !/^[a-f0-9]{40}$/.test(base) || /^0+$/.test(base)) full = true;
  else changed = execFileSync('git',['diff','--name-only',base,'HEAD'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
} catch { full = true; }
const add = (units,browsers) => { for(const name of units)unit.add(name);for(const name of browsers)browser.add(name); };
for(const file of changed) {
  if (/^(src\/features\/data\/(taskMentions|taskCollaboration|useTaskCollaboration)\.ts|src\/components\/(TaskCollaboration|ProjectTasksPanel)\.tsx|src\/pages\/(BusinessPage|NotificationsPage)\.tsx|src\/app\/businessNavigation\.ts|src\/features\/notifications\/notifications\.ts|src\/task-collaboration\.css|public\/sw\.js|supabase\/functions\/mobile-push\/core\.mjs|supabase\/migrations\/\d+_task_comment_mentions\.sql|tests\/(task-mentions|task-collaboration|notifications|mobile-push)\.test\.mjs|tests\/sql\/task-mentions-rls\.sql|tests\/browser\/(task-mentions|task-collaboration|collaboration-service|supabase)\.mjs)$/.test(file)) {
    add(['tests/task-mentions.test.mjs','tests/task-collaboration.test.mjs','tests/notifications.test.mjs','tests/mobile-push.test.mjs'],['tests/browser/task-mentions.mjs','tests/browser/task-collaboration.mjs','tests/browser/notifications.mjs','tests/browser/mobile-push.mjs','tests/browser/mobile-install.mjs']);continue;
  }
  if (/^(src\/components\/ProjectTemplates\.tsx|src\/features\/data\/(projectTemplates|businessData)\.ts|src\/pages\/BusinessPage\.tsx|src\/project-templates\.css|supabase\/migrations\/\d+_project_templates\.sql|tests\/sql\/project-templates-rls\.sql|tests\/browser\/(project-templates|template-service)\.mjs)$/.test(file)) {
    add(['tests/business-management.test.mjs','tests/project-tasks-workflow.test.mjs','tests/project-templates.test.mjs'],['tests/browser/project-templates.mjs']);continue;
  }

  if (/^(src\/components\/(TaskAttachments|TaskCollaboration)\.tsx|src\/features\/data\/(taskAttachments|taskCollaboration|useTaskCollaboration)\.ts|src\/task-collaboration\.css|supabase\/functions\/task-file-cleanup\/|supabase\/migrations\/\d+_task_attachments\.sql|tests\/sql\/task-attachments-rls\.sql|tests\/browser\/(collaboration-service|attachment-service|task-attachments|task-collaboration)\.mjs)/.test(file)) {
    add(['tests/task-attachments.test.mjs','tests/task-collaboration.test.mjs'],['tests/browser/task-attachments.mjs','tests/browser/task-collaboration.mjs']);continue;
  }
  if (/^(supabase\/migrations\/\d+_deadline_push_reminders\.sql|tests\/sql\/deadline-reminders-rls\.sql)$/.test(file)) {
    add(['tests/mobile-push.test.mjs','tests/notifications.test.mjs'],['tests/browser/mobile-push.mjs','tests/browser/notifications.mjs']);continue;
  }
  if (/^(README\.md|docs\/|\.github\/|tests\/run-changed\.mjs)/.test(file)) continue;
  if (/^tests\/[^/]+\.test\.mjs$/.test(file)) { unit.add(file); continue; }
  if (/^tests\/browser\/(mobile-push|notifications|settings|mobile-install)\.mjs$/.test(file)) { browser.add(file); continue; }
  if (/^(src\/features\/notifications\/|src\/components\/(PushPreferences|NotificationPreferences)\.tsx|src\/pages\/NotificationsPage\.tsx|src\/notifications\.css|supabase\/functions\/mobile-push\/|supabase\/migrations\/\d+_mobile_push_notifications\.sql|tests\/sql\/mobile-push-rls\.sql|tests\/browser\/push-service\.mjs)/.test(file)) {
    add(['tests/mobile-push.test.mjs','tests/notifications.test.mjs'],['tests/browser/mobile-push.mjs','tests/browser/notifications.mjs']);continue;
  }
  if (/^(src\/features\/auth\/AuthProvider\.tsx|src\/pages\/SettingsPage\.tsx)$/.test(file)) {
    add(['tests/auth-recovery.test.mjs','tests/settings-preferences.test.mjs','tests/mobile-push.test.mjs'],['tests/browser/auth-recovery.mjs','tests/browser/mobile-push.mjs','tests/browser/settings.mjs']);continue;
  }
  if(file==='public/sw.js') {add(['tests/mobile-push.test.mjs'],['tests/browser/mobile-push.mjs','tests/browser/mobile-install.mjs']);continue;}
  // Shared service is used by all feature tests: changes retain their coverage.
  if(file==='tests/browser/supabase.mjs') { full=true; continue; }
  full=true;
}
if(full) {
  for(const name of readdirSync('tests').filter(name=>name.endsWith('.test.mjs')))unit.add('tests/'+name);
  for(const name of ['auth-recovery','project-templates','mobile-push','task-attachments','task-collaboration','task-mentions','mobile-workflows','chat-scan','briefing','mobile-install','workspace-lifecycle','message-history','message-tasks','settings','notifications'])browser.add(`tests/browser/${name}.mjs`);
}
const selection={unit:[...unit].sort(),browser:[...browser].sort()};
console.log(JSON.stringify({scope:full?'full':'changed',...selection}));
if(process.argv.includes('--list'))process.exit(0);
if(process.argv.includes('--unit')&&selection.unit.length) {
  const result=spawnSync(process.execPath,['--test','--test-concurrency=1',...selection.unit],{stdio:'inherit'});process.exit(result.status??1);
}
if(process.argv.includes('--browser'))for(const path of selection.browser) {
  const result=spawnSync(process.execPath,[path],{stdio:'inherit'});if(result.status!==0)process.exit(result.status??1);
}
