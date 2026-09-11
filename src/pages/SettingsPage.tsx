import {
  Building2,
  CheckCircle2,
  LockKeyhole,
  ShieldCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import { Header } from '../components/Header';
import type { IdentityMode } from '../types';

type SettingsPageProps = {
  identity: IdentityMode;
  setIdentity: (identity: IdentityMode) => void;
};

export function SettingsPage({ identity, setIdentity }: SettingsPageProps) {
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
              <small>Samet · @samet</small>
            </span>
          </button>
          <button
            className={identity === 'business' ? 'active' : ''}
            onClick={() => setIdentity('business')}
          >
            <Building2 />
            <span>
              <b>Business</b>
              <small>WebWorkBalance · @webworkbalance</small>
            </span>
          </button>
        </div>
      </div>

      <div className="settings-grid">
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
            Passwort, Sessions, 2FA und spätere Schlüsselverwaltung sind architektonisch
            vorgesehen.
          </p>
          <span className="ok">
            <CheckCircle2 size={15} /> Frontend speichert keine echten Secrets
          </span>
        </div>
      </div>
    </section>
  );
}
