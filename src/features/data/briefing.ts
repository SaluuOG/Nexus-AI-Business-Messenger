import type { NexusProject, NexusProjectTask } from './businessData';

export function briefingDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// Date-only deadlines are calendar days, independent of UTC offsets and DST.
export function briefingEndDate(today: string) {
  const [year, month, day] = today.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 6)).toISOString().slice(0, 10);
}

export function buildBriefing(
  projects: NexusProject[], tasks: NexusProjectTask[], workspaceId: string,
  currentUserId: string | undefined, today: string,
) {
  const priority = { urgent: 0, high: 1, medium: 2, low: 3 };
  const compareTasks = (a: NexusProjectTask, b: NexusProjectTask) =>
    (a.due_date ?? '9999-12-31').localeCompare(b.due_date ?? '9999-12-31') ||
    priority[a.priority] - priority[b.priority] || a.id.localeCompare(b.id);
  const workspaceProjects = projects.filter(project => project.workspace_id === workspaceId);
  const openTasks = tasks.filter(task => task.workspace_id === workspaceId && task.status !== 'done');
  const mine = currentUserId ? openTasks.filter(task => task.assigned_to === currentUserId) : [];
  const dueTasks = mine.filter(task => task.due_date && task.due_date <= today).sort(compareTasks);
  const attentionTasks = openTasks.filter(task => task.status === 'blocked' || task.assigned_to === null).sort(compareTasks);
  const activeProjects = workspaceProjects.filter(project => !['completed', 'archived'].includes(project.status))
    .sort((a, b) => (a.deadline ?? '9999-12-31').localeCompare(b.deadline ?? '9999-12-31') ||
      priority[a.priority] - priority[b.priority] || a.id.localeCompare(b.id));
  const endDate = briefingEndDate(today);
  return {
    openCount: openTasks.length, mineCount: mine.length, dueTasks, attentionTasks, activeProjects,
    overdueCount: dueTasks.filter(task => task.due_date! < today).length,
    deadlineCount: activeProjects.filter(project => project.deadline && project.deadline >= today && project.deadline <= endDate).length,
    overdueProjectCount: activeProjects.filter(project => project.deadline && project.deadline < today).length,
    projectNames: new Map(workspaceProjects.map(project => [project.id, project.title])),
    endDate,
  };
}
