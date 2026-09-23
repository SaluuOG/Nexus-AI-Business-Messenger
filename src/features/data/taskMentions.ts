import type { NexusWorkspaceMember } from './nexusData';
import { taskMemberName } from './projectTasks';

export type TaskMentionDraft = { userId: string; label: string };
export type TaskMentionQuery = { start: number; end: number; query: string };

export const taskMentionLimit = 20;

export function taskMentionLabel(member: NexusWorkspaceMember) {
  return taskMemberName(member).replace(/[\r\n@]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
}

export function findTaskMentionQuery(value: string, caret: number): TaskMentionQuery | null {
  const safeCaret = Math.max(0, Math.min(caret, value.length));
  const before = value.slice(0, safeCaret);
  const match = /(^|\s)@([^\s@]{0,100})$/u.exec(before);
  if (!match) return null;
  return { start: safeCaret - match[2].length - 1, end: safeCaret, query: match[2] };
}

export function insertTaskMention(value: string, query: TaskMentionQuery, label: string) {
  const token = `@${label} `;
  const remainder = value.slice(query.end).replace(/^\s/u, '');
  return {
    value: value.slice(0, query.start) + token + remainder,
    caret: query.start + token.length,
  };
}

export function beginTaskMention(value: string, start: number, end = start) {
  const safeStart = Math.max(0, Math.min(start, value.length));
  const safeEnd = Math.max(safeStart, Math.min(end, value.length));
  const spacer = safeStart > 0 && !/\s/u.test(value[safeStart - 1]) ? ' ' : '';
  const inserted = `${spacer}@`;
  const next = value.slice(0, safeStart) + inserted + value.slice(safeEnd);
  const caret = safeStart + inserted.length;
  return { value: next, caret, query: findTaskMentionQuery(next, caret)! };
}

function taskMentionIndexes(value: string, label: string) {
  const token = `@${label}`;
  const indexes: number[] = [];
  let index = value.indexOf(token);
  while (index >= 0) {
    const previous = value[index - 1];
    const next = value[index + token.length];
    if ((previous === undefined || /\s/u.test(previous)) && (next === undefined || /[\s.,!?;:)]/u.test(next))) indexes.push(index);
    index = value.indexOf(token, index + token.length);
  }
  return indexes;
}

export function hasTaskMention(value: string, label: string) {
  return taskMentionIndexes(value, label).length > 0;
}

export function pruneTaskMentions(value: string, selected: TaskMentionDraft[]) {
  const used = new Map<string, number>();
  const available = new Map<string, number>();
  return selected.filter(mention => {
    const count = available.get(mention.label) ?? taskMentionIndexes(value, mention.label).length;
    available.set(mention.label, count);
    const position = used.get(mention.label) ?? 0;
    used.set(mention.label, position + 1);
    return position < count;
  });
}

export function removeTaskMention(value: string, label: string) {
  const token = `@${label}`;
  const index = taskMentionIndexes(value, label)[0];
  if (index === undefined) return value;
  const before = value.slice(0, index);
  const after = value.slice(index + token.length).replace(/^\s/u, '');
  return before + after;
}

export function taskMentionCandidates(
  members: NexusWorkspaceMember[], currentUserId: string, selected: TaskMentionDraft[], query: string,
) {
  const selectedIds = new Set(selected.map(mention => mention.userId));
  const needle = query.trim().toLocaleLowerCase('de-DE');
  return members.filter(member => member.user_id !== currentUserId && !selectedIds.has(member.user_id))
    .filter(member => !needle || [taskMentionLabel(member), member.username ?? '']
      .some(value => value.toLocaleLowerCase('de-DE').includes(needle)))
    .sort((a, b) => taskMentionLabel(a).localeCompare(taskMentionLabel(b), 'de-DE'))
    .slice(0, 8);
}
