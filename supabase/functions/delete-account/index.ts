import { createClient } from 'npm:@supabase/supabase-js@2.116.0';
import {
  deletionBlocker,
  groupStorageObjects,
  parseSessionId,
  validateDeletionRequest,
} from './core.mjs';

const allowedOrigins = new Set([
  'https://saluuog.github.io',
  'capacitor://localhost',
  'http://localhost',
]);

function responseHeaders(request: Request) {
  const origin = request.headers.get('Origin') ?? '';
  return {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    ...(allowedOrigins.has(origin) ? {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Vary': 'Origin',
    } : {}),
  };
}

Deno.serve(async (request: Request) => {
  const headers = responseHeaders(request);
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return json({ error: 'Methode nicht erlaubt.' }, 405);

  const authorization = request.headers.get('Authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) return json({ error: 'Bitte melde dich erneut an.' }, 401);
  const jwt = authorization.slice(7);
  const sessionId = parseSessionId(jwt);
  if (!sessionId) return json({ error: 'Deine Sitzung ist ungültig. Bitte melde dich erneut an.' }, 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Ungültige Anfrage.' }, 400);
  }
  const validationError = validateDeletionRequest(body);
  if (validationError) return json({ error: validationError }, 400);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  try {
    const { data: authData, error: authError } = await admin.auth.getUser(jwt);
    if (authError || !authData.user) return json({ error: 'Bitte melde dich erneut an.' }, 401);

    const { data: plan, error: planError } = await admin.rpc('get_account_deletion_plan', {
      p_user_id: authData.user.id,
      p_session_id: sessionId,
    });
    if (planError) throw planError;
    if (!plan?.session_active) return json({ error: 'Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.' }, 401);

    const blocker = deletionBlocker(plan);
    if (blocker) return json({ error: blocker, code: 'ownership_transfer_required' }, 409);

    for (const [bucket, paths] of groupStorageObjects(plan.storage_objects)) {
      for (let offset = 0; offset < paths.length; offset += 100) {
        const { error } = await admin.storage.from(bucket).remove(paths.slice(offset, offset + 100));
        if (error) throw error;
      }
    }

    const { error: signOutError } = await admin.auth.admin.signOut(jwt, 'global');
    if (signOutError) throw signOutError;
    const { error: deleteError } = await admin.auth.admin.deleteUser(authData.user.id);
    if (deleteError) throw deleteError;

    return json({ deleted: true });
  } catch {
    return json({ error: 'Das Konto konnte gerade nicht gelöscht werden. Bitte versuche es erneut.' }, 503);
  }
});

