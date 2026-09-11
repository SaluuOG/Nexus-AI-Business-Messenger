import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { backendConfigured } from '../../lib/env';
import { supabase } from '../../lib/supabase';

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
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signUp: (email: string, password: string, fullName: string) => Promise<SignUpResult>;
  signOut: () => Promise<AuthResult>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(backendConfigured);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
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
      async signIn(email, password) {
        if (!supabase) return { error: 'Supabase ist noch nicht konfiguriert.' };
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        return { error: error?.message ?? null };
      },
      async signUp(email, password, fullName) {
        if (!supabase) {
          return {
            error: 'Supabase ist noch nicht konfiguriert.',
            needsEmailConfirmation: false,
          };
        }

        const redirectTo = `${window.location.origin}${window.location.pathname}?auth=callback#/auth`;
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: redirectTo,
            data: { full_name: fullName },
          },
        });

        return {
          error: error?.message ?? null,
          needsEmailConfirmation: !data.session && Boolean(data.user),
        };
      },
      async signOut() {
        if (!supabase) return { error: null };
        const { error } = await supabase.auth.signOut();
        return { error: error?.message ?? null };
      },
    }),
    [loading, session],
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
