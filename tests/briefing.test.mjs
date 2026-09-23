import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBriefing, briefingDateKey, briefingEndDate } from '../src/features/data/briefing.ts';
import { businessSearch, readBusinessSearch } from '../src/app/businessNavigation.ts';

const project = (id, patch = {}) => ({ id, workspace_id: 'w1', status: 'active', title: id, deadline: '2026-09-16', priority: 'medium', progress: 40, ...patch });
const task = (id, patch = {}) => ({ id, workspace_id: 'w1', project_id: 'p1', status: 'todo', assigned_to: 'me', due_date: '2026-09-14', priority: 'medium', ...patch });
const summarize = (tasks, projects = [project('p1')], user = 'me') => buildBriefing(projects, tasks, 'w1', user, '2026-09-14');

test('Today contains only my due and overdue unfinished tasks, sorted deterministically', () => {
  const result = summarize([
    task('future', { due_date: '2026-09-15' }), task('other', { assigned_to: 'other' }),
    task('done', { status: 'done' }), task('undated', { due_date: null }),
    task('today'), task('urgent', { priority: 'urgent' }),
    task('overdue', { due_date: '2026-09-13' }),
  ]);
  assert.deepEqual(result.dueTasks.map(t => t.id), ['overdue', 'urgent', 'today']);
  assert.equal(result.mineCount, 5);
  assert.equal(result.openCount, 6);
  assert.equal(result.overdueCount, 1);
  assert.equal(summarize([task('no-user')], undefined, null).dueTasks.length, 0);
});

test('All attention items are counted, including more than five, with no double counting', () => {
  const rows = Array.from({ length: 12 }, (_, i) => task('unassigned-' + i, { assigned_to: null }));
  rows.push(task('both', { status: 'blocked', assigned_to: null }), task('done', { status: 'done', assigned_to: null }));
  assert.equal(summarize(rows).attentionTasks.length, 13);
});

test('Overdue projects stay visible, undated follow deadlines, closed projects are excluded', () => {
  const result = summarize([], [
    project('future'), project('overdue', { deadline: '2026-09-13' }),
    project('undated', { deadline: null }), project('done', { status: 'completed' }),
    project('archived', { status: 'archived' }),
  ]);
  assert.deepEqual(result.activeProjects.map(p => p.id), ['overdue', 'future', 'undated']);
  assert.equal(result.overdueProjectCount, 1);
});

test('Seven calendar days include today through day six, across year and leap boundaries', () => {
  assert.equal(briefingEndDate('2026-12-29'), '2027-01-04');
  assert.equal(briefingEndDate('2028-02-26'), '2028-03-03');
  const result = summarize([], [project('today', { deadline: '2026-09-14' }), project('last', { deadline: '2026-09-20' }), project('outside', { deadline: '2026-09-21' })]);
  assert.equal(result.deadlineCount, 2);
  assert.equal(briefingDateKey(new Date(2026, 8, 14, 23, 59)), '2026-09-14');
});

test('Workspace isolation also applies to summary inputs and names', () => {
  const rows = [task('mine'), task('foreign', { workspace_id: 'w2', assigned_to: null })];
  const result = summarize(rows, [project('p1'), project('private', { workspace_id: 'w2' })]);
  assert.equal(result.openCount, 1);
  assert.equal(result.attentionTasks.length, 0);
  assert.equal(result.projectNames.has('private'), false);
  assert.equal(result.activeProjects.length, 1);
});

test('Summaries leave input data unchanged and update on the next calendar day', () => {
  const tasks = [task('tomorrow', { due_date: '2026-09-15' }), task('today')];
  const copy = structuredClone(tasks);
  assert.equal(summarize(tasks).dueTasks.length, 1);
  assert.equal(buildBriefing([project('p1')], tasks, 'w1', 'me', '2026-09-15').dueTasks.length, 2);
  assert.deepEqual(tasks, copy);
});

test('Business links preserve workspace and exact record while tabs clear old targets', () => {
  const search = businessSearch('workspace & two', { view: 'tasks', projectId: 'p/1', taskId: 't?1' });
  assert.deepEqual(readBusinessSearch(search, 'workspace & two'), { view: 'tasks', projectId: 'p/1', taskId: 't?1', commentId: null });
  assert.deepEqual(readBusinessSearch(search, 'other'), { view: 'projects', projectId: null, taskId: null, commentId: null });
  assert.deepEqual(readBusinessSearch(businessSearch('w1', { view: 'projects' }), 'w1'), { view: 'projects', projectId: null, taskId: null, commentId: null });
  assert.equal(readBusinessSearch('view=invalid&task=one', 'w1').view, 'tasks');
});
