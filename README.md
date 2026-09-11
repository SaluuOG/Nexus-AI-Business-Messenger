# Nexus — AI Business Messenger

Nexus ist ein AI- und Business-Messenger-Projekt.

## Status

### Phase 0 — Grundgerüst ✅
- AI-Briefing, Chats, Business-/Projektübersicht und AI-Assistent
- Responsive Desktop-/Mobile-Struktur

### Phase 1B.1 — Codebasis professionalisiert ✅
### Phase 1B.2 — Routing ✅
### Phase 1B.3 — Supabase & Auth-Grundlage ✅
### Phase 1B.4 — Profile, Business-Identitäten, Workspaces & Rollen ✅
### Phase 1B.5 — Team, Einladungen & Rollenverwaltung ✅
- Zwei-Account-Test erfolgreich
- Owner/Admin/Member/Guest serverseitig geschützt
- Migrationen `0002_workspace_team.sql` und `0003_fix_invitation_ambiguity.sql`

### Phase 1B.6 — Echte Kontakte & Nutzerverzeichnis ✅
- Migration `0004_contacts_directory.sql` aktiv
- echte Supabase-Kontakte statt Mock-Kontakten
- exakte Username-Suche ohne Offenlegung von E-Mail-Adressen
- Kontaktanfragen senden, annehmen, ablehnen und zurückziehen
- akzeptierte Kontakte dauerhaft und beidseitig gespeichert
- Kontakte entfernen
- Zwei-Account-Test erfolgreich

### Phase 2.1 — Echte 1:1-Chats 🚧
- Migration `0005_direct_messages.sql` aktiv
- echte persistente 1:1-Unterhaltungen zwischen bestätigten Nexus-Kontakten
- Kontaktseite kann einen Chat direkt erstellen/öffnen
- Chatliste zeigt echte Kontakte, letzte Nachricht, Zeit und Ungelesen-Zähler
- Nachrichten werden dauerhaft in Supabase gespeichert
- Nachrichtenabruf und Versand sind serverseitig auf Chat-Teilnehmer begrenzt
- Lesestatus pro Nutzer
- Supabase Realtime für neue Nachrichten aktiviert
- RLS auf Conversations, Messages und Read-Status
- Nachrichtenlänge serverseitig auf 1–5000 Zeichen begrenzt

> Phase 2.1 ist technisch integriert. Als nächster Schritt folgt der Zwei-Account-Praxistest Samet ↔ Darlyn für Versand, Empfang, Realtime und Ungelesen-Status.

## Routen
- `#/app/briefing`
- `#/app/chats`
- `#/app/contacts`
- `#/app/business`
- `#/app/ai`
- `#/app/settings`

## Lokal starten
```bash
npm install
npm run dev
```

Produktionsbuild:
```bash
npm run build
```

## Sicherheit
Nexus verwendet Supabase Row Level Security und Security-Definer-RPCs für sensible Datenoperationen. Private Server-Schlüssel gehören nicht ins Frontend. Kontakte und direkte Chats sind auf authentifizierte Nutzer und bestätigte Beziehungen begrenzt. Das Nutzerverzeichnis gibt keine E-Mail-Adressen aus. Eine spätere Ende-zu-Ende-Verschlüsselung wird mit etablierter Kryptografie separat entworfen; Phase 2.1 ist noch keine E2E-Verschlüsselung.