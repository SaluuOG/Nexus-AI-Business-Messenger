import { createClient } from '@supabase/supabase-js';
import { backendConfigured, supabaseConfig } from './env';

type AuthCallbackMarker = 'callback' | 'recovery' | null;

export type InitialAuthCallback = {
  marker: AuthCallbackMarker;
  isRecovery: boolean;
  hasError: boolean;
  errorCode: string | null;
  errorDescription: string | null;
  hasPkceCode: boolean;
};

function readInitialAuthCallback(): InitialAuthCallback {
  if (typeof window === 'undefined') {
    return {
      marker: null,
      isRecovery: false,
      hasError: false,
      errorCode: null,
      errorDescription: null,
      hasPkceCode: false,
    };
  }

  const url = new URL(window.location.href);
  const hashParams = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.hash);
  const markerValue = url.searchParams.get('auth');
  const marker = markerValue === 'callback' || markerValue === 'recovery' ? markerValue : null;
  const errorCode = url.searchParams.get('error_code') ?? hashParams.get('error_code');
  const errorDescription =
    url.searchParams.get('error_description') ?? hashParams.get('error_description');

  return {
    marker,
    isRecovery: marker === 'recovery' || hashParams.get('type') === 'recovery',
    hasError: Boolean(
      url.searchParams.get('error') ||
        errorCode ||
        hashParams.get('error') ||
        errorDescription,
    ),
    errorCode,
    errorDescription,
    hasPkceCode: url.searchParams.has('code'),
  };
}

// Capture callback details before supabase-js consumes and removes them from the URL.
export const initialAuthCallback = readInitialAuthCallback();

export const supabase = backendConfigured
  ? createClient(supabaseConfig.url!, supabaseConfig.publishableKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        // Nexus is a client-only GitHub Pages app. The implicit flow lets a recovery
        // email be opened in Safari, an email webview or another device without a
        // PKCE verifier having to exist in the browser that requested the email.
        flowType: 'implicit',
      },
    })
  : null;
