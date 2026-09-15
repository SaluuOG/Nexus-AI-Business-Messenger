import { createClient } from 'npm:@supabase/supabase-js@2.116.0';
import { createChatScanHandler } from './core.mjs';

// Keep Supabase's verify_jwt platform check enabled for this user-only endpoint.
Deno.serve(createChatScanHandler({ createClient, env: (name: string) => Deno.env.get(name) }));
