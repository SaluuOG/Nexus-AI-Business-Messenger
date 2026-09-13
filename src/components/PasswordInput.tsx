import { Eye, EyeOff, LockKeyhole } from 'lucide-react';
import { type InputHTMLAttributes, useState } from 'react';
import { getPasswordStrength } from '../features/auth/passwordPolicy';

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

export function PasswordInput(props: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const visibilityLabel = visible ? 'Passwort verbergen' : 'Passwort anzeigen';

  return (
    <div className="password-input">
      <LockKeyhole size={17} aria-hidden="true" />
      <input {...props} type={visible ? 'text' : 'password'} />
      <button
        className="password-visibility"
        type="button"
        aria-label={visibilityLabel}
        aria-pressed={visible}
        title={visibilityLabel}
        onClick={() => setVisible((current) => !current)}
      >
        {visible ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
      </button>
    </div>
  );
}

export function PasswordStrengthHint({ password }: { password: string }) {
  if (!password) return null;
  const strength = getPasswordStrength(password);

  return (
    <div className={`password-strength level-${strength.level}`} role="status" aria-live="polite">
      <span>Passwortstärke: <b>{strength.label}</b></span>
      <span className="password-strength-bars" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </div>
  );
}
