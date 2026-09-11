import {
  Building2,
  CheckCircle2,
  LockKeyhole,
  LogOut,
  ServerCog,
  ShieldCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import { Header } from '../components/Header';
import type { IdentityMode } from '../types';

type SettingsPageProps = {
  identity: IdentityMode;
  setIdentity: (identity: IdentityMode) => void;
  backendConfigured: boolean;
  accountEmail?: string;
  onSignOut?: () => void;
};

export function SettingsPage({
  identity,
  setIdentity,
  backendConfigured,
  accountEmail,
  onSignOut,
}: SettingsPageProps) {
  return (
    <section className="page">
      <Header
        kicker="ACCOUNT"
        title="Einstellungen"
        sub="Identität, Workspace, Teamrollen und Sicherheitsgrundlage."
      />

      <div className="panel">
        <h3>Deine Identität</h3>
        <div className="identity">
          <button
            className={identity === 'private' ? 'active' : ''}
            onClick={() => setIdentity('private')}
          >
            <Users />
            <span>
              <b>Privat</b>
              <small>Persönliche Identität</small>
            </span>
          </button>
          <button
            className={identity === 'business' ? 'active' : ''}
            onClick={() => setIdentity('business')}
          >
            <Building2 />
            <span>
              <b>Business</b>
              <small>Geschäftliche Identität</small>
            </span>
          </button>
        </div>
      </div>

      <div className="settings-grid">
        <div className="panel">
          <ServerCog />
          <h3>Account & Backend</h3>
          <p>
            {backendConfigured
              ? `Supabase Auth ist verbunden${accountEmail ? ` · ${accountEmail}` : ''}.`
              : 'Nexus läuft aktuell im Demo-Modus. Die Supabase-Anbindung ist im Code vorbereitet.'}
          </p>
          <span className={backendConfigured ? 'ok' : 'setup-status'}>
            <CheckCircle2 size={15} />
            {backendConfigured ? 'Authentifizierung aktiv' : 'Wartet auf Supabase-Projektdaten'}
          </span>
          {onSignOut && (
            <button className="secondary signout" onClick={onSignOut}>
              <LogOut size={15} /> Abmelden
            </button>
          )}
        </div>

        <div className="panel">
          <ShieldCheck />
          <h3>Workspace & Rollen</h3>
          <p>Owner, Admin, Member und Guest sind als Rollenmodell vorbereitet.</p>
          <button className="secondary">
            <UserPlus size={15} /> Mitglied einladen
          </button>
        </div>

        <div className="panel">
          <LockKeyhole />
          <h3>Sicherheit & Geräte</h3>
          <p>
            Sessions werden künftig über Supabase Auth verwaltet. 2FA und Geräteverwaltung
            bauen wir darauf auf.
          </p>
          <span className="ok">
            <CheckCircle2 size={15} /> Keine privaten Server-Secrets im Frontend
          </span>
        </div>
      </div>
    </section>
  );
}
