import assert from 'node:assert/strict';
import test from 'node:test';
import { filterTasks, localDateKey, summarizeTasks, taskIsOverdue, taskPermissions } from '../src/features/data/projectTasks.ts';

const today = '2026-09-14';
const makeTask = (id, overrides = {}) => ({ id, project_id: 'website', workspace_id: 'team', title: 'Startseite gestalten', status: 'todo', priority: 'medium', assigned_to: 'member', due_date: today, description: null, ...overrides });
const tasks = [makeTask('1', { due_date: '2026-09-13' }), makeTask('2', { status: 'done', due_date: '2026-09-10' }), makeTask('3'), makeTask('4', { assigned_to: null, due_date: null }), makeTask('5', { project_id: 'shop', status: 'blocked', assigned_to: 'owner', due_date: '2026-09-15' })];
const members = new Map([['member', { user_id: 'member', full_name: 'Darlyn', role: 'member' }], ['owner', { user_id: 'owner', full_name: 'Samet', role: 'owner' }]]);
const projects = new Map([['website', 'Unternehmenswebsite'], ['shop', 'Neuer Shop']]);
const all = { query: '', project: 'all', assignee: 'all', status: 'all' };
const find = (filters) => filterTasks(tasks, { ...all, ...filters }, today, projects, members, 'member').map(task => task.id);

test('Deadlines use the local calendar day and exclude completed or undated tasks', () => {
  assert.equal(localDateKey(new Date(2026, 8, 14, 0, 5)), today);
  assert.equal(taskIsOverdue(tasks[0], today), true);
  assert.equal(taskIsOverdue(tasks[1], today), false);
  assert.equal(taskIsOverdue(tasks[2], today), false);
  assert.equal(taskIsOverdue(tasks[3], today), false);
  assert.deepEqual(summarizeTasks(tasks, today, 'member'), { total: 5, done: 1, open: 4, overdue: 1, today: 1, mine: 2 });
});

test('Task filters combine project, person, search and date without losing unassigned work', () => {
  assert.deepEqual(find({ assignee: 'me', status: 'open' }), ['1', '3']);
  assert.deepEqual(find({ status: 'today' }), ['3']);
  assert.deepEqual(find({ status: 'overdue' }), ['1']);
  assert.deepEqual(find({ assignee: 'unassigned' }), ['4']);
  assert.deepEqual(find({ project: 'shop', query: 'SAMET', status: 'blocked' }), ['5']);
  assert.deepEqual(find({ query: 'unternehmenswebsite', status: 'done' }), ['2']);
  assert.deepEqual(find({ project: 'website', assignee: 'owner' }), []);
  assert.equal(filterTasks(tasks, { ...all, assignee: 'me' }, today, projects, members).length, 0);
});

test('Task ordering puts deadlines first, urgent work before normal work, and completed work last without mutation', () => {
  const input = [makeTask('b'), makeTask('c', { status: 'done', due_date: '2026-01-01' }), makeTask('a', { priority: 'urgent' })];
  assert.deepEqual(filterTasks(input, all, today, projects, members).map(t => t.id), ['a', 'b', 'c']);
  assert.deepEqual(input.map(t => t.id), ['b', 'c', 'a']);
});

test('Task permissions grant team writes, manager deletes, and no writes for guests or missing roles', () => {
  for (const role of ['owner', 'admin']) assert.deepEqual(taskPermissions(role), { write: true, delete: true });
  assert.deepEqual(taskPermissions('member'), { write: true, delete: false });
  for (const role of ['guest', undefined]) assert.deepEqual(taskPermissions(role), { write: false, delete: false });
});
