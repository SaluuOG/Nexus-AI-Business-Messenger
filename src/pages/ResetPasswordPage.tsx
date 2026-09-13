import { type FormEvent, useState } from 'react';
import { CheckCircle2, CircleAlert, ShieldCheck, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { routes } from '../app/routes';
import { PasswordInput, PasswordStrengthHint } from '../components/PasswordInput';
import { useAuth } from '../features/auth/AuthProvider';
import { PASSWORD_MIN_LENGTH, validateNewPassword } from '../features/auth/passwordPolicy';

export function ResetPasswordPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const validationError = validateNewPassword(password, confirmation);
    if (validationError) {
      setError(validationError);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const result = await auth.updatePassword(password);
      if (result.error) {
        setError(result.error);
        return;
      }

      auth.clearRecoveryMode();
      setPassword('');
      setConfirmation('');
      setCompleted(true);
    } catch {
      setError('Das Passwort konnte gerade nicht geändert werden. Bitte versuche es erneut.');
    } finally {
      setBusy(false);
    }
  };

  if (completed) {
    return (
      <div className="auth-shell">
        <div className="auth-card setup-card">
          <div className="auth-logo success-logo"><CheckCircle2 /></div>
          <span className="auth-kicker">PASSWORT AKTUALISIERT</span>
          <h1>Dein Zugang ist wieder sicher</h1>
          <p>Das neue Passwort ist aktiv. Deine aktuelle Sitzung bleibt angemeldet.</p>
          <button className="auth-primary" onClick={() => navigate(routes.briefing, { replace: true })}>
            Nexus öffnen
          </button>
        </div>
      </div>
    );
  }

  const hasValidRecoverySession = Boolean(auth.session && auth.recoveryMode);

  if (!auth.configured || !hasValidRecoverySession) {
    return (
      <div className="auth-shell">
        <div className="auth-card setup-card">
          <div className="auth-logo warning-logo"><CircleAlert /></div>
          <span className="auth-kicker">PASSWORT-WIEDERHERSTELLUNG</span>
          <h1>Link nicht mehr gültig</h1>
          <p>
            {auth.recoveryError ??
              'Dieser Wiederherstellungslink ist ungültig, abgelaufen oder wurde bereits verwendet.'}
          </p>
          <div className="auth-actions">
            <button
              className="auth-primary"
              onClick={() => {
                auth.clearRecoveryMode();
                navigate(routes.auth, { replace: true, state: { authMode: 'forgot' } });
              }}
            >
              Neuen Link anfordern
            </button>
            {auth.user && (
              <button className="auth-secondary-action" onClick={() => navigate(routes.briefing, { replace: true })}>
                Nexus öffnen
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-logo"><Sparkles /></div>
        <span className="auth-kicker">NEXUS · SICHERER ZUGANG</span>
        <h1>Neues Passwort setzen</h1>
        <p>Wähle ein neues Passwort für deinen Nexus Account.</p>

        <form className="auth-form" onSubmit={submit}>
          <label>
            <span>Neues Passwort</span>
            <PasswordInput
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={PASSWORD_MIN_LENGTH}
              placeholder={`Mindestens ${PASSWORD_MIN_LENGTH} Zeichen`}
              autoComplete="new-password"
            />
          </label>
          <PasswordStrengthHint password={password} />
          <label>
            <span>Passwort bestätigen</span>
            <PasswordInput
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              required
              minLength={PASSWORD_MIN_LENGTH}
              placeholder="Noch einmal eingeben"
              autoComplete="new-password"
            />
          </label>

          {error && <div className="auth-alert error" role="alert">{error}</div>}

          <button className="auth-primary" disabled={busy} type="submit">
            {busy ? 'Wird gespeichert…' : 'Neues Passwort speichern'}
          </button>
        </form>

        <div className="auth-security">
          <ShieldCheck size={16} /> Der Link ist einmalig und wird nach erfolgreicher Verwendung entfernt.
        </div>
      </div>
    </div>
  );
}
