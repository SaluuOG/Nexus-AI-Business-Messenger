import { createClient } from '@supabase/supabase-js';
import { backendConfigured, supabaseConfig } from './env';

export const supabase = backendConfigured
  ? createClient(supabaseConfig.url!, supabaseConfig.publishableKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
    })
  : null;
