import { type FormEvent, useEffect, useState } from 'react';
import { ArrowLeft, Mail, ShieldCheck, Sparkles, UserRound } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { routes } from '../app/routes';
import { PasswordInput, PasswordStrengthHint } from '../components/PasswordInput';
import { MobileInstall } from '../components/MobileInstall';
import { useAuth } from '../features/auth/AuthProvider';
import {
  PASSWORD_MIN_LENGTH,
  RESET_REQUEST_CONFIRMATION,
  validateNewPassword,
} from '../features/auth/passwordPolicy';

type AuthMode = 'login' | 'register' | 'forgot';
type AuthLocationState = {
  authMode?: AuthMode;
  message?: string;
};

export function AuthPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const auth = useAuth();
  const locationState = location.state as AuthLocationState | null;
  const [mode, setMode] = useState<AuthMode>(() => locationState?.authMode ?? 'login');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(() => locationState?.message ?? null);
  const [error, setError] = useState<string | null>(null);

  const inviteFromUrl = new URLSearchParams(location.search).get('invite');
  const pendingInvite = inviteFromUrl || localStorage.getItem('nexus_pending_invite');
  const destination = pendingInvite
    ? `${routes.settings}?invite=${encodeURIComponent(pendingInvite)}`
    : '/';

  useEffect(() => {
    if (inviteFromUrl) {
      localStorage.setItem('nexus_pending_invite', inviteFromUrl);
    }
  }, [inviteFromUrl]);

  const changeMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setPassword('');
    setMessage(null);
    setError(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage(null);
    setError(null);

    if (mode === 'register') {
      const validationError = validateNewPassword(password);
      if (validationError) {
        setError(validationError);
        return;
      }
    }

    setBusy(true);

    try {
      if (mode === 'forgot') {
        const result = await auth.requestPasswordReset(email.trim());
        if (result.error) {
          setError(result.error);
          return;
        }
        setMessage(RESET_REQUEST_CONFIRMATION);
        return;
      }

      if (mode === 'login') {
        const result = await auth.signIn(email.trim(), password);
        if (result.error) {
          setError(result.error);
          return;
        }
        navigate(destination, { replace: true });
        return;
      }

      const result = await auth.signUp(email.trim(), password, fullName.trim());
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
    } catch {
      setError('Nexus Auth ist gerade nicht erreichbar. Bitte versuche es erneut.');
    } finally {
      setBusy(false);
    }
  };

  if (!auth.configured) {
    return (
      <div className="auth-shell">
        <div className="auth-card setup-card">
          <div className="auth-logo"><Sparkles /></div>
          <span className="auth-kicker">NEXUS BACKEND</span>
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
          {auth.authLinkError && <div className="auth-alert error" role="alert">{auth.authLinkError}</div>}
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

  const title = mode === 'login'
    ? 'Willkommen zurück'
    : mode === 'register'
      ? 'Nexus Account erstellen'
      : 'Passwort zurücksetzen';
  const description = pendingInvite
    ? 'Melde dich mit der eingeladenen E-Mail-Adresse an, um dem Workspace beizutreten.'
    : mode === 'login'
      ? 'Melde dich sicher in deinem Workspace an.'
      : mode === 'register'
        ? 'Erstelle deine persönliche Identität.'
        : 'Wir senden dir einen einmaligen Link zum Festlegen eines neuen Passworts.';

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-logo"><Sparkles /></div>
        <span className="auth-kicker">NEXUS · AI BUSINESS MESSENGER</span>
        <h1>{title}</h1>
        <p>{description}</p>

        {mode === 'forgot' ? (
          <button className="auth-back" type="button" onClick={() => changeMode('login')}>
            <ArrowLeft size={15} /> Zurück zur Anmeldung
          </button>
        ) : (
          <div className="auth-tabs">
            <button
              className={mode === 'login' ? 'active' : ''}
              type="button"
              onClick={() => changeMode('login')}
            >
              Anmelden
            </button>
            <button
              className={mode === 'register' ? 'active' : ''}
              type="button"
              onClick={() => changeMode('register')}
            >
              Registrieren
            </button>
          </div>
        )}

        <form className="auth-form" onSubmit={submit}>
          {mode === 'register' && (
            <label>
              <span>Name</span>
              <div>
                <UserRound size={17} />
                <input
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  required
                  placeholder="Dein Name"
                  autoComplete="name"
                />
              </div>
            </label>
          )}
          <label>
            <span>E-Mail</span>
            <div>
              <Mail size={17} />
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                placeholder="name@firma.de"
                autoComplete="email"
              />
            </div>
          </label>
          {mode !== 'forgot' && (
            <label>
              <span>Passwort</span>
              <PasswordInput
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={mode === 'register' ? PASSWORD_MIN_LENGTH : undefined}
                placeholder={mode === 'register' ? `Mindestens ${PASSWORD_MIN_LENGTH} Zeichen` : 'Dein Passwort'}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              />
            </label>
          )}
          {mode === 'register' && <PasswordStrengthHint password={password} />}
          {mode === 'login' && (
            <button className="auth-inline-action" type="button" onClick={() => changeMode('forgot')}>
              Passwort vergessen?
            </button>
          )}

          {(error || auth.authLinkError) && <div className="auth-alert error" role="alert">{error || auth.authLinkError}</div>}
          {message && <div className="auth-alert success" role="status">{message}</div>}

          <button className="auth-primary" disabled={busy} type="submit">
            {busy
              ? 'Bitte warten…'
              : mode === 'login'
                ? 'Sicher anmelden'
                : mode === 'register'
                  ? 'Account erstellen'
                  : 'Wiederherstellungslink senden'}
          </button>
        </form>

        <div className="auth-security">
          <ShieldCheck size={16} /> Sichere Session- und Passwortverwaltung über Supabase Auth
        </div>
        <MobileInstall />
      </div>
    </div>
  );
}
