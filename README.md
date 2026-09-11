# Nexus — AI Business Messenger

Nexus ist ein AI- und Business-Messenger-Projekt.

## Status

### Phase 0 — Grundgerüst ✅
- AI-Briefing
- Chats
- Kundenchat mit Business-Kontext
- Business-/Projektübersicht
- AI-Assistent
- Responsive Desktop-/Mobile-Struktur

### Phase 1 — Accounts & Identität
- Login- und Registrierungsflow
- Private und geschäftliche Identität
- Profilinformationen
- Username-Konzept
- Kontakte: Kunde / Team / Privat
- Workspace-Wechsel
- Teammitglieder und Einladungen
- Rollen: Owner / Admin / Member / Guest
- Sicherheits- und Geräteansicht

### Phase 1B.1 — Codebasis professionalisiert ✅
- App in Pages, Components, Daten, Types und App-Shell aufgeteilt
- zentrale Zustände aus der alten Monolith-Datei herausgelöst

### Phase 1B.2 — Routing ✅
- eigenes Routing für Briefing, Chats, Kontakte, Business, AI und Einstellungen
- direkte Links und Reloads funktionieren zuverlässig auf GitHub Pages
- GitHub-Pages-kompatibles Hash-Routing

Routen:
- `#/app/briefing`
- `#/app/chats`
- `#/app/contacts`
- `#/app/business`
- `#/app/ai`
- `#/app/settings`

### Phase 1B.3 — Supabase & Auth-Grundlage ✅
- Supabase-Client und Auth-Schicht integriert
- echte Registrierung und Login
- persistente Sessions und Logout
- geschützte App-Routen
- öffentliche Supabase-Konfiguration über GitHub Actions Variables
- keine privaten Server-Schlüssel im Frontend

### Phase 1B.4 — Profile, Business-Identitäten, Workspaces & Rollen ✅
- Supabase-Schema für `profiles`, `business_profiles`, `workspaces` und `workspace_members`
- Rollenmodell Owner / Admin / Member / Guest
- Row Level Security und Rollenprüfungen aktiviert
- bestehende Auth-Nutzer automatisch in `profiles` übernommen
- persönliches Profil wird aus Supabase geladen und kann gespeichert werden
- Business-Identität kann real in Supabase erstellt werden
- Workspaces werden real geladen, erstellt und in der Sidebar gewechselt
- aktuelle Workspace-Rolle wird aus `workspace_members` geladen
- Begrüßung und Profilanzeige verwenden echte Account-/Profildaten

### Phase 1B.5 — Team, Einladungen & Rollenverwaltung 🚧
- Migration `0002_workspace_team.sql` vorbereitet
- echte Workspace-Mitgliederansicht vorbereitet
- Einladung per E-Mail + sicherem Einladungslink vorbereitet
- Einladungen laufen nach 7 Tagen ab und können widerrufen werden
- eingeladene Nutzer können nach Login/Registrierung dem Workspace beitreten
- Owner kann Admin / Member / Guest vergeben
- Admin kann Member / Guest verwalten
- Owner-Rolle ist auf Datenbankebene gegen Admin-Änderungen und Entfernen geschützt
- Team-Schreibzugriffe laufen über Security-Definer-RPCs statt direkter Tabellenänderungen

> Phase 1B.5 wird aktiv, sobald `supabase/migrations/0002_workspace_team.sql` einmal im Supabase SQL Editor ausgeführt wurde.

> Chats, Kontakte, Briefing-Kennzahlen und Beispielkunden arbeiten aktuell noch teilweise mit Testdaten. Diese Bereiche werden in den nächsten Datenbank-Schritten ersetzt.

## Lokal starten

```bash
npm install
npm run dev
```

Produktionsbuild:

```bash
npm run build
```

## Nächster Entwicklungsschritt

Nach Aktivierung von Phase 1B.5: Team-Einladungen mit zwei Accounts testen und anschließend Kontakte auf echte Supabase-Daten umstellen.

## Sicherheit

Nexus verwendet Supabase Row Level Security für den Zugriff auf Account- und Workspace-Daten. Private Server-Schlüssel gehören nicht ins Frontend. Rollenänderungen und Einladungen werden zusätzlich serverseitig in Datenbankfunktionen geprüft. Für eine spätere Ende-zu-Ende-Verschlüsselung wird keine selbst erfundene Kryptografie verwendet; dafür folgt eine gesonderte Security-Architektur.
