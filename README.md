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

> Aktuell arbeitet die App noch mit Testdaten. Echte Authentifizierung, Datenbank, Sessions und Verschlüsselung folgen schrittweise.

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

Phase 1B.3: Supabase-Grundlage und echte Authentifizierung vorbereiten. Danach Datenbankschema, Profile, Workspaces und Rollen.

## Sicherheit

Nexus wird keine selbst erfundene Kryptografie für Ende-zu-Ende-Verschlüsselung verwenden. Vor einem Produktionsrelease wird eine gesonderte Security-Architektur für Authentifizierung, Sessions, Schlüsselverwaltung und E2E-Verschlüsselung benötigt.
