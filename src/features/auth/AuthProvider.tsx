import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { routes } from '../../app/routes';
import { backendConfigured } from '../../lib/env';
import { initialAuthCallback, supabase } from '../../lib/supabase';

type AuthResult = {
  error: string | null;
};

type SignUpResult = AuthResult & {
  needsEmailConfirmation: boolean;
};

type AuthContextValue = {
  configured: boolean;
  loading: boolean;
  session: Session | null;
  user: User | null;
  recoveryMode: boolean;
  recoveryError: string | null;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signUp: (email: string, password: string, fullName: string) => Promise<SignUpResult>;
  requestPasswordReset: (email: string) => Promise<AuthResult>;
  updatePassword: (password: string) => Promise<AuthResult>;
  clearRecoveryMode: () => void;
  signOut: () => Promise<AuthResult>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const AUTH_CALLBACK_KEYS = [
  'auth',
  'code',
  'sb_flow_id',
  'error',
  'error_code',
  'error_description',
];
const AUTH_HASH_KEYS = [
  'access_token',
  'refresh_token',
  'expires_in',
  'expires_at',
  'token_type',
  'type',
  'error',
  'error_code',
  'error_description',
];
const RECOVERY_SESSION_KEY = 'nexus_password_recovery';

function hasRecoveryMarker() {
  return initialAuthCallback.isRecovery;
}

function hasRememberedRecoverySession() {
  try {
    return window.sessionStorage.getItem(RECOVERY_SESSION_KEY) === 'active';
  } catch {
    return false;
  }
}

function rememberRecoverySession(active: boolean) {
  try {
    if (active) window.sessionStorage.setItem(RECOVERY_SESSION_KEY, 'active');
    else window.sessionStorage.removeItem(RECOVERY_SESSION_KEY);
  } catch {
    // Recovery remains functional even when storage is unavailable.
  }
}

function readRecoveryError() {
  return initialAuthCallback.hasError
    ? 'Der Wiederherstellungslink ist ungültig oder abgelaufen.'
    : null;
}

function clearAuthCallbackUrl(recoveryRequested: boolean) {
  const url = new URL(window.location.href);
  let changed = false;

  for (const key of AUTH_CALLBACK_KEYS) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
  }

  const hashParams = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.hash);
  if (AUTH_HASH_KEYS.some((key) => hashParams.has(key))) {
    url.hash = recoveryRequested ? routes.resetPassword : '';
    changed = true;
  } else if (recoveryRequested && !url.hash) {
    url.hash = routes.resetPassword;
    changed = true;
  }

  if (!changed) return;
  const search = url.searchParams.toString();
  window.history.replaceState(
    window.history.state,
    '',
    `${url.pathname}${search ? `?${search}` : ''}${url.hash}`,
  );
}

function buildAuthRedirect(marker: 'callback' | 'recovery') {
  const url = new URL(window.location.pathname, window.location.origin);
  url.searchParams.set('auth', marker);
  return url.toString();
}

function publicAuthError(message: string | undefined, fallback: string) {
  if (!message) return null;
  const normalized = message.toLowerCase();

  if (normalized.includes('rate limit') || normalized.includes('too many')) {
    return 'Zu viele Versuche. Bitte warte kurz und versuche es dann erneut.';
  }
  if (normalized.includes('invalid login credentials')) {
    return 'E-Mail-Adresse oder Passwort ist nicht korrekt.';
  }
  if (normalized.includes('weak password') || normalized.includes('password should')) {
    return 'Das Passwort erfüllt die Sicherheitsanforderungen noch nicht.';
  }
  if (normalized.includes('same password')) {
    return 'Bitte verwende ein anderes Passwort als bisher.';
  }
  if (
    normalized.includes('expired') ||
    normalized.includes('otp') ||
    normalized.includes('session')
  ) {
    return 'Der Wiederherstellungslink ist ungültig oder abgelaufen.';
  }

  return fallback;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(backendConfigured);
  const [recoveryMode, setRecoveryMode] = useState(
    () => hasRecoveryMarker() || hasRememberedRecoverySession(),
  );
  const [recoveryError, setRecoveryError] = useState<string | null>(readRecoveryError);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    let mounted = true;

    const recoveryRequested = hasRecoveryMarker();

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      if (recoveryRequested && data.session) {
        rememberRecoverySession(true);
        setRecoveryMode(true);
        setRecoveryError(null);
      } else if (recoveryRequested && !data.session) {
        rememberRecoverySession(false);
        setRecoveryError((current) =>
          current ??
          (initialAuthCallback.hasPkceCode
            ? 'Dieser Link wurde noch mit dem alten Browser-Verfahren erstellt. Bitte fordere nach dem aktuellen Nexus-Update einen neuen Link an.'
            : 'Der Wiederherstellungslink ist ungültig oder abgelaufen.'),
        );
      }
      setLoading(false);
      clearAuthCallbackUrl(recoveryRequested);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      if (event === 'PASSWORD_RECOVERY') {
        rememberRecoverySession(true);
        setRecoveryMode(true);
        setRecoveryError(null);
      } else if (event === 'SIGNED_OUT') {
        rememberRecoverySession(false);
        setRecoveryMode(false);
      }
      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      configured: backendConfigured,
      loading,
      session,
      user: session?.user ?? null,
      recoveryMode,
      recoveryError,
      async signIn(email, password) {
        if (!supabase) return { error: 'Supabase ist noch nicht konfiguriert.' };
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        return {
          error: publicAuthError(error?.message, 'Die Anmeldung ist gerade nicht möglich.'),
        };
      },
      async signUp(email, password, fullName) {
        if (!supabase) {
          return {
            error: 'Supabase ist noch nicht konfiguriert.',
            needsEmailConfirmation: false,
          };
        }

        const redirectTo = buildAuthRedirect('callback');
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: redirectTo,
            data: { full_name: fullName },
          },
        });

        return {
          error: publicAuthError(error?.message, 'Der Account konnte gerade nicht erstellt werden.'),
          needsEmailConfirmation: !data.session && Boolean(data.user),
        };
      },
      async requestPasswordReset(email) {
        if (!supabase) return { error: 'Supabase ist noch nicht konfiguriert.' };
        const redirectTo = buildAuthRedirect('recovery');
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
        return {
          error: publicAuthError(
            error?.message,
            'Der Wiederherstellungslink konnte gerade nicht gesendet werden.',
          ),
        };
      },
      async updatePassword(password) {
        if (!supabase) return { error: 'Supabase ist noch nicht konfiguriert.' };
        const { error } = await supabase.auth.updateUser({ password });
        return {
          error: publicAuthError(error?.message, 'Das Passwort konnte gerade nicht geändert werden.'),
        };
      },
      clearRecoveryMode() {
        rememberRecoverySession(false);
        setRecoveryMode(false);
        setRecoveryError(null);
      },
      async signOut() {
        if (!supabase) return { error: null };
        rememberRecoverySession(false);
        const { error } = await supabase.auth.signOut();
        return { error: publicAuthError(error?.message, 'Die Abmeldung ist gerade nicht möglich.') };
      },
    }),
    [loading, recoveryError, recoveryMode, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth muss innerhalb von AuthProvider verwendet werden.');
  }
  return context;
}
