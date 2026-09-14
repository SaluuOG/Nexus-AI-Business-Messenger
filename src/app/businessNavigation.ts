export type BusinessTarget = {
  view?: 'projects' | 'customers' | 'tasks';
  projectId?: string;
  taskId?: string;
};

export function businessSearch(workspaceId: string | null, target: BusinessTarget = {}) {
  const params = new URLSearchParams();
  if (workspaceId) params.set('workspace', workspaceId);
  params.set('view', target.view ?? (target.taskId ? 'tasks' : 'projects'));
  if (target.projectId) params.set('project', target.projectId);
  if (target.taskId) params.set('task', target.taskId);
  return params.toString();
}

export function readBusinessSearch(search: string, workspaceId: string | null) {
  const params = new URLSearchParams(search);
  // A target from another workspace must never be applied to the current data.
  if (params.get('workspace') && params.get('workspace') !== workspaceId) {
    return { view: 'projects' as const, projectId: null, taskId: null };
  }
  const rawView = params.get('view');
  const view = rawView === 'tasks' || rawView === 'customers' || rawView === 'projects'
    ? rawView : params.get('task') ? 'tasks' : 'projects';
  return { view, projectId: params.get('project'), taskId: params.get('task') };
}
