import type { NexusProjectTask } from './businessData';
import type { NexusWorkspaceMember, WorkspaceRole } from './nexusData';

export const taskStatuses = ['todo', 'in_progress', 'review', 'blocked', 'done'] as const;
export type TaskStatus = (typeof taskStatuses)[number];
export const taskStatusLabels: Record<TaskStatus, string> = {
  todo: 'Offen', in_progress: 'In Arbeit', review: 'Zur Prüfung', blocked: 'Blockiert', done: 'Erledigt',
};
export const taskPriorityLabels = { low: 'Niedrig', medium: 'Normal', high: 'Hoch', urgent: 'Dringend' } as const;

export function taskPermissions(role?: WorkspaceRole) {
  return {
    write: role === 'owner' || role === 'admin' || role === 'member',
    delete: role === 'owner' || role === 'admin',
  };
}

export function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function taskIsOverdue(task: Pick<NexusProjectTask, 'status' | 'due_date'>, today: string) {
  return task.status !== 'done' && Boolean(task.due_date && task.due_date < today);
}

export function taskMemberName(member?: NexusWorkspaceMember) {
  return member?.full_name || member?.username || (member ? `Nexus Nutzer ${member.user_id.slice(0, 6)}` : 'Nicht mehr im Team');
}

export function summarizeTasks(tasks: NexusProjectTask[], today: string, currentUserId?: string) {
  return tasks.reduce((summary, task) => {
    summary.total++;
    if (task.status === 'done') summary.done++;
    else {
      summary.open++;
      if (taskIsOverdue(task, today)) summary.overdue++;
      if (task.due_date === today) summary.today++;
      if (currentUserId && task.assigned_to === currentUserId) summary.mine++;
    }
    return summary;
  }, { total: 0, open: 0, done: 0, overdue: 0, today: 0, mine: 0 });
}

export type TaskFilters = {
  query: string;
  project: string;
  status: TaskStatus | 'all' | 'open' | 'overdue' | 'today';
  assignee: string;
};

export function filterTasks(
  tasks: NexusProjectTask[], filters: TaskFilters, today: string,
  projectNames: Map<string, string>, members: Map<string, NexusWorkspaceMember>, currentUserId?: string,
) {
  const query = filters.query.trim().toLocaleLowerCase('de-DE');
  const priority = { urgent: 0, high: 1, medium: 2, low: 3 };
  return tasks.filter(task => {
    if (filters.project !== 'all' && task.project_id !== filters.project) return false;
    if (filters.status === 'open' && task.status === 'done') return false;
    if (filters.status === 'overdue' && !taskIsOverdue(task, today)) return false;
    if (filters.status === 'today' && (task.status === 'done' || task.due_date !== today)) return false;
    if (!['all', 'open', 'overdue', 'today'].includes(filters.status) && task.status !== filters.status) return false;
    if (filters.assignee === 'me' && (!currentUserId || task.assigned_to !== currentUserId)) return false;
    if (filters.assignee === 'unassigned' && task.assigned_to !== null) return false;
    if (!['all', 'me', 'unassigned'].includes(filters.assignee) && task.assigned_to !== filters.assignee) return false;
    const text = [task.title, task.description, projectNames.get(task.project_id), task.assigned_to ? taskMemberName(members.get(task.assigned_to)) : 'Nicht zugewiesen'].join(' ').toLocaleLowerCase('de-DE');
    return !query || text.includes(query);
  }).sort((a, b) =>
    Number(a.status === 'done') - Number(b.status === 'done') ||
    (a.due_date ?? '9999-12-31').localeCompare(b.due_date ?? '9999-12-31') ||
    priority[a.priority] - priority[b.priority] || a.id.localeCompare(b.id),
  );
}
