import { supabase } from '../../lib/supabase';
import type { InitialProjectTask, ProjectPriority } from './businessData';

export type TemplateTask = {
  title: string; description: string | null; priority: ProjectPriority;
  due_offset: number | null; checklist: string[];
};
export type ProjectTemplate = {
  id: string; workspace_id: string; name: string; description: string | null;
  priority: ProjectPriority; deadline_offset: number | null; tasks: TemplateTask[];
};
export type TemplateDraft = {
  title: string; description: string; priority: ProjectPriority; deadline: string;
  tasks: InitialProjectTask[];
};

// Calendar arithmetic uses UTC only as a day counter, never the user's timezone.
export function shiftTemplateDate(start: string, offset: number | null): string | null {
  if (offset === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !Number.isInteger(offset)) throw new Error('Bitte ein gültiges Startdatum wählen.');
  const day = new Date(start + 'T00:00:00Z');
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== start || start < '1900-01-01') throw new Error('Bitte ein gültiges Startdatum ab 1900 wählen.');
  day.setUTCDate(day.getUTCDate() + offset);
  if (!Number.isFinite(day.getTime()) || day.getUTCFullYear() < 1900 || day.getUTCFullYear() > 9999) throw new Error('Die berechneten Termine liegen außerhalb des gültigen Bereichs.');
  return day.toISOString().slice(0, 10);
}

export function projectFromTemplate(template: ProjectTemplate, start: string): TemplateDraft {
  shiftTemplateDate(start, 0);
  return {
    title: template.name, description: template.description || '', priority: template.priority,
    deadline: shiftTemplateDate(start, template.deadline_offset) || '',
    tasks: template.tasks.map(task => ({
      id: crypto.randomUUID(), title: task.title, description: task.description, priority: task.priority,
      status: 'todo', assigned_to: null, due_date: shiftTemplateDate(start, task.due_offset), checklist: [...task.checklist],
    })),
  };
}

export function cleanInitialChecklists(tasks: InitialProjectTask[]): InitialProjectTask[] {
  let total = 0;
  return tasks.map(task => {
    const checklist = (task.checklist || []).map(label => label.trim()).filter(Boolean);
    total += checklist.length;
    if (checklist.length > 100 || total > 500 || checklist.some(label => label.length > 240)) {
      throw new Error('Maximal 100 Checklistenpunkte je Aufgabe und 500 insgesamt; jeder Punkt darf höchstens 240 Zeichen enthalten.');
    }
    return { ...task, checklist };
  });
}

function templateError(error: { code?: string; message?: string }): Error {
  if (error.code === '42501') return new Error('Keine Berechtigung. Bitte Anmeldung und Workspace-Rolle prüfen.');
  if (error.code === '23503') return new Error('Das Ausgangsprojekt ist nicht mehr verfügbar.');
  if (error.code === '22023' || error.code === '23514') return new Error(error.message || 'Die Vorlage konnte nicht übernommen werden.');
  return new Error('Vorlagen konnten nicht geladen oder gespeichert werden. Bitte erneut versuchen.');
}

export async function loadProjectTemplates(workspaceId: string): Promise<ProjectTemplate[]> {
  if (!supabase) throw new Error('Nexus ist nicht verbunden.');
  const { data, error } = await supabase.from('project_templates')
    .select('id,workspace_id,name,description,priority,deadline_offset,tasks')
    .eq('workspace_id', workspaceId).eq('archived', false).order('name').order('id').range(0, 99);
  if (error) throw templateError(error);
  return data || [];
}

export async function saveProjectTemplate(id: string, workspaceId: string, projectId: string, name: string, start: string): Promise<ProjectTemplate> {
  if (!supabase) throw new Error('Nexus ist nicht verbunden.');
  const { data, error } = await supabase.rpc('save_project_template', {
    p_id: id, p_workspace: workspaceId, p_project: projectId, p_name: name.trim(), p_start: start,
  });
  if (error) throw templateError(error);
  if (!data || data.id !== id || data.workspace_id !== workspaceId) throw new Error('Vorlage konnte nicht bestätigt werden. Bitte erneut versuchen.');
  return data;
}

export async function archiveProjectTemplate(id: string, workspaceId: string): Promise<void> {
  if (!supabase) throw new Error('Nexus ist nicht verbunden.');
  const { error } = await supabase.rpc('archive_project_template', { p_id: id, p_workspace: workspaceId });
  if (error) throw templateError(error);
}
