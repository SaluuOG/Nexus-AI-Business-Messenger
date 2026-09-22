// Only browser-vendor push services are accepted. Never fetch arbitrary URLs
// supplied by a client (including redirects, credentials, ports or IP literals).
export function validEndpoint(value) {
  try {
    const u = new URL(value);
    return typeof value === 'string' && value.length <= 2048 && u.protocol === 'https:' &&
      !u.username && !u.password && !u.port && !u.hash && (
        u.hostname === 'fcm.googleapis.com' || u.hostname === 'updates.push.services.mozilla.com' ||
        u.hostname.endsWith('.push.services.mozilla.com') || u.hostname === 'web.push.apple.com' ||
        u.hostname.endsWith('.push.apple.com') || u.hostname.endsWith('.notify.windows.com')
      );
  } catch { return false; }
}

export function deliveryOutcome(status) {
  if (status >= 200 && status < 300) return 'sent';
  if (status === 404 || status === 410) return 'expired';
  if (status === 429 || status >= 500 || status === 0) return 'retry';
  return 'failed';
}

export function pushPayload(item) {
  const generic = { direct_message: 'Du hast eine neue Nachricht.', group_message: 'Es gibt eine neue Gruppennachricht.',
    task_assigned: 'Dir wurde eine Aufgabe zugewiesen.', task_comment: 'Es gibt einen neuen Aufgabenkommentar.',
    task_reminder_before: 'Eine deiner Aufgaben ist morgen fällig.', task_reminder_due: 'Eine deiner Aufgaben ist heute fällig.',
    test: 'Push ist auf diesem Gerät eingerichtet.' }[item.kind];
  if (!generic) throw new Error('Unsupported push kind');
  const d = item.details ?? {};
  const params = new URLSearchParams();
  let path = '/app/settings?category=notifications';
  if (item.kind === 'direct_message' && d.chat_id) path = '/app/chats?' + new URLSearchParams({ conversation: d.chat_id });
  else if (item.kind === 'group_message' && d.chat_id) path = '/app/groups?' + new URLSearchParams({ group: d.chat_id });
  else if (item.kind.startsWith('task_') && d.workspace_id && d.project_id && d.task_id) {
    params.set('workspace', d.workspace_id); params.set('view', 'tasks'); params.set('project', d.project_id); params.set('task', d.task_id);
    path = '/app/business?' + params;
  } else if (item.kind !== 'test') throw new Error('Missing push target');
  return {
    v: 1, id: item.delivery_id, recipient: item.user_id, device: item.device_id, kind: item.kind, path,
    title: item.previews ? String(d.title || 'Nexus').slice(0, 100) : 'Nexus',
    body: item.previews ? String(item.preview || generic).slice(0, 160) : generic,
    generic, expires: Date.now() + 5 * 60_000,
  };
}

// Each lease has its own token: an expired worker can never finish a new lease.
export async function deliverBatch({ rpc, send }) {
  const jobs = await rpc('claim_push_deliveries', {});
  const counts = { sent: 0, discarded: 0, retry: 0, expired: 0, failed: 0 };
  // Small concurrency bounds vendor requests and the Edge Function wall clock.
  for (let i = 0; i < jobs.length; i += 5) {
    await Promise.all(jobs.slice(i, i + 5).map(async job => {
      const args = { p_id: job.id, p_lease: job.lease_token };
      let outcome = 'retry';
      try {
        const item = await rpc('prepare_push_delivery', args);
        if (!item) outcome = 'discarded';
        else if (!validEndpoint(item.endpoint)) outcome = 'failed';
        else {
          try { outcome = deliveryOutcome(await send(item, pushPayload(item))); }
          catch (error) { outcome = deliveryOutcome(Number(error?.statusCode) || 0); }
        }
      } catch { outcome = 'retry'; }
      await rpc('finish_push_delivery', { ...args, p_outcome: outcome });
      counts[outcome]++;
    }));
  }
  return counts;
}
