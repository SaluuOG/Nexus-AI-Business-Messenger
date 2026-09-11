import { FormEvent, useEffect, useState } from 'react';
import { LockKeyhole, Mail, ShieldCheck, Sparkles, UserRound } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthProvider';
import { routes } from '../app/routes';

export function AuthPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const auth = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const inviteFromUrl = new URLSearchParams(location.search).get('invite');
  const pendingInvite = inviteFromUrl || localStorage.getItem('nexus_pending_invite');
  const destination = pendingInvite
    ? `${routes.settings}?invite=${encodeURIComponent(pendingInvite)}`
    : routes.briefing;

  useEffect(() => {
    if (inviteFromUrl) {
      localStorage.setItem('nexus_pending_invite', inviteFromUrl);
    }
  }, [inviteFromUrl]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    setError(null);

    if (mode === 'login') {
      const result = await auth.signIn(email, password);
      setBusy(false);
      if (result.error) {
        setError(result.error);
        return;
      }
      navigate(destination, { replace: true });
      return;
    }

    const result = await auth.signUp(email, password, fullName.trim());
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }

    if (result.needsEmailConfirmation) {
      setMessage(
        pendingInvite
          ? 'Account erstellt. Bitte bestätige deine E-Mail-Adresse. Deine Workspace-Einladung bleibt gespeichert.'
          : 'Account erstellt. Bitte bestätige jetzt die E-Mail-Adresse.',
      );
      return;
    }

    navigate(destination, { replace: true });
  };

  if (!auth.configured) {
    return (
      <div className="auth-shell">
        <div className="auth-card setup-card">
          <div className="auth-logo"><Sparkles /></div>
          <span className="auth-kicker">PHASE 1B.3</span>
          <h1>Backend ist vorbereitet</h1>
          <p>
            Die Supabase-Authentifizierung ist im Code eingebaut. Für echte Accounts müssen
            nur noch die Projekt-URL und der Publishable Key verbunden werden.
          </p>
          <div className="auth-note">
            <ShieldCheck size={18} />
            <span>Keine Service-Role-Keys oder privaten Secrets werden im Browser gespeichert.</span>
          </div>
          <button className="auth-primary" onClick={() => navigate(routes.briefing)}>
            Demo-Modus öffnen
          </button>
        </div>
      </div>
    );
  }

  if (auth.user) {
    return (
      <div className="auth-shell">
        <div className="auth-card setup-card">
          <div className="auth-logo"><Sparkles /></div>
          <span className="auth-kicker">NEXUS ACCOUNT</span>
          <h1>Du bist angemeldet</h1>
          <p>
            {pendingInvite
              ? 'Eine Workspace-Einladung wartet auf dich.'
              : auth.user.email}
          </p>
          <button className="auth-primary" onClick={() => navigate(destination)}>
            {pendingInvite ? 'Einladung öffnen' : 'Nexus öffnen'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-logo"><Sparkles /></div>
        <span className="auth-kicker">NEXUS · AI BUSINESS MESSENGER</span>
        <h1>{mode === 'login' ? 'Willkommen zurück' : 'Nexus Account erstellen'}</h1>
        <p>
          {pendingInvite
            ? 'Melde dich mit der eingeladenen E-Mail-Adresse an, um dem Workspace beizutreten.'
            : mode === 'login'
              ? 'Melde dich sicher in deinem Workspace an.'
              : 'Erstelle deine persönliche Identität.'}
        </p>

        <div className="auth-tabs">
          <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>
            Anmelden
          </button>
          <button
            className={mode === 'register' ? 'active' : ''}
            onClick={() => setMode('register')}
          >
            Registrieren
          </button>
        </div>

        <form className="auth-form" onSubmit={submit}>
          {mode === 'register' && (
            <label>
              <span>Name</span>
              <div><UserRound size={17} /><input value={fullName} onChange={(event) => setFullName(event.target.value)} required placeholder="Dein Name" autoComplete="name" /></div>
            </label>
          )}
          <label>
            <span>E-Mail</span>
            <div><Mail size={17} /><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required placeholder="name@firma.de" autoComplete="email" /></div>
          </label>
          <label>
            <span>Passwort</span>
            <div><LockKeyhole size={17} /><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} placeholder="Mindestens 8 Zeichen" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></div>
          </label>

          {error && <div className="auth-alert error">{error}</div>}
          {message && <div className="auth-alert success">{message}</div>}

          <button className="auth-primary" disabled={busy} type="submit">
            {busy ? 'Bitte warten…' : mode === 'login' ? 'Sicher anmelden' : 'Account erstellen'}
          </button>
        </form>

        <div className="auth-security"><ShieldCheck size={16} /> Session-Verwaltung über Supabase Auth</div>
      </div>
    </div>
  );
}
