export const accountDeletionConfirmation = 'KONTO LÖSCHEN';

export function parseSessionId(jwt) {
  if (typeof jwt !== 'string') return null;
  const payload = jwt.split('.')[1];
  if (!payload) return null;
  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')));
    return typeof decoded.session_id === 'string' && /^[0-9a-f-]{36}$/i.test(decoded.session_id)
      ? decoded.session_id
      : null;
  } catch {
    return null;
  }
}

export function validateDeletionRequest(body) {
  return body && body.confirmation === accountDeletionConfirmation
    ? null
    : `Bitte gib „${accountDeletionConfirmation}“ vollständig ein.`;
}

export function deletionBlocker(plan) {
  const workspaces = Array.isArray(plan?.owned_workspaces) ? plan.owned_workspaces : [];
  const groups = Array.isArray(plan?.owned_groups) ? plan.owned_groups : [];
  if (!workspaces.length && !groups.length) return null;

  const parts = [];
  if (workspaces.length) parts.push(`${workspaces.length} Workspace${workspaces.length === 1 ? '' : 's'}`);
  if (groups.length) parts.push(`${groups.length} Gruppe${groups.length === 1 ? '' : 'n'}`);
  return `Übertrage oder lösche zuerst: ${parts.join(' und ')}.`;
}

export function groupStorageObjects(objects) {
  const grouped = new Map();
  for (const object of Array.isArray(objects) ? objects : []) {
    if (typeof object?.bucket_id !== 'string' || typeof object?.name !== 'string') continue;
    const paths = grouped.get(object.bucket_id) ?? [];
    paths.push(object.name);
    grouped.set(object.bucket_id, paths);
  }
  return grouped;
}

