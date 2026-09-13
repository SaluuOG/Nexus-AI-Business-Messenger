export const PASSWORD_MIN_LENGTH = 8;

export const RESET_REQUEST_CONFIRMATION =
  'Falls ein Nexus-Konto zu dieser E-Mail-Adresse existiert, wurde ein Wiederherstellungslink gesendet.';

export type PasswordStrength = {
  label: 'Schwach' | 'Okay' | 'Stark';
  level: 1 | 2 | 3;
};

export function getPasswordStrength(password: string): PasswordStrength {
  let score = 0;

  if (password.length >= PASSWORD_MIN_LENGTH) score += 1;
  if (password.length >= 12) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;

  if (score >= 4) return { label: 'Stark', level: 3 };
  if (score >= 3) return { label: 'Okay', level: 2 };
  return { label: 'Schwach', level: 1 };
}

export function validateNewPassword(password: string, confirmation?: string) {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Das Passwort muss mindestens ${PASSWORD_MIN_LENGTH} Zeichen lang sein.`;
  }

  if (confirmation !== undefined && password !== confirmation) {
    return 'Die beiden Passwörter stimmen nicht überein.';
  }

  return null;
}
