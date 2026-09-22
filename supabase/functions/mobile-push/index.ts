import { createClient } from 'npm:@supabase/supabase-js@2.116.0';
import webpush from 'npm:web-push@3.6.7';
import { deliverBatch } from './core.mjs';

const origin = 'https://saluuog.github.io';
const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Vary': 'Origin' };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers });

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return json({ error: 'Methode nicht erlaubt.' }, 405);
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } });
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const { data, error } = await admin.rpc(name, args);
    if (error) throw new Error('Push database request failed'); // Never log keys, endpoints or payloads.
    return data;
  };
  try {
    const token = request.headers.get('x-nexus-push-token');
    if (token) {
      if (!/^[a-f0-9]{64}$/.test(token)) return json({ error: 'Nicht berechtigt.' }, 401);
      if (!await rpc('consume_push_wake', { p_token: token })) return json({ error: 'Nicht berechtigt.' }, 401);
      const config = await rpc('get_push_server_keys', { p_seed: null });
      // A first signed database wake initializes stable VAPID keys exactly once.
      const keys = config.public_key ? config : await rpc('get_push_server_keys', { p_seed: webpush.generateVAPIDKeys() });
      const counts = await deliverBatch({ rpc, send: async (item: any, payload: any) => {
        const details = webpush.generateRequestDetails({ endpoint: item.endpoint, keys: { p256dh: item.p256dh, auth: item.auth_key } }, JSON.stringify(payload), {
          vapidDetails: { subject: origin + '/Nexus-AI-Business-Messenger/', publicKey: keys.public_key, privateKey: keys.private_key },
          TTL: 300, urgency: 'normal', contentEncoding: 'aes128gcm',
        });
        const response = await fetch(details.endpoint, { method: 'POST', headers: details.headers, body: details.body,
          redirect: 'error', signal: AbortSignal.timeout(8_000) });
        await response.body?.cancel();
        return response.status;
      } });
      return json(counts);
    }
    // Custom auth is deliberate: current signing-key JWTs are verified via Auth,
    // while server dispatch consumes a one-use, short-lived 256-bit nonce.
    const authorization = request.headers.get('Authorization') || '';
    if (!authorization.startsWith('Bearer ')) return json({ error: 'Bitte melde dich an.' }, 401);
    const { data, error } = await admin.auth.getUser(authorization.slice(7));
    if (error || !data.user) return json({ error: 'Bitte melde dich erneut an.' }, 401);
    const config = await rpc('get_push_server_keys', { p_seed: webpush.generateVAPIDKeys() });
    return json({ publicKey: config.public_key }); // Never return the private key.
  } catch {
    return json({ error: 'Push ist gerade nicht erreichbar. Bitte erneut versuchen.' }, 503);
  }
});
