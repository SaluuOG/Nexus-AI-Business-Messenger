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

### Phase 2.1 — Echte 1:1-Chats ✅
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
- Zwei-Account-Praxistest Samet ↔ Darlyn erfolgreich: Versand und Empfang in beide Richtungen funktionieren

### Phase 2.2 — Messenger-Erlebnis ✅
- Migration `0006_messenger_experience.sql` aktiv
- Online-/Zuletzt-online-Status mit geschütztem Presence-Heartbeat
- „schreibt gerade…“-Status zwischen Chat-Teilnehmern
- Realtime-Synchronisierung für neue, bearbeitete und gelöschte Nachrichten
- Realtime-Lesestatus mit Doppelhaken für gelesene eigene Nachrichten
- Antworten auf einzelne Nachrichten mit Reply-Vorschau
- eigene Nachrichten bearbeiten
- eigene Nachrichten per Soft-Delete löschen
- gelöschte Nachrichten verlieren serverseitig ihren Nachrichtentext
- RLS und Security-Definer-RPCs schützen Presence-, Typing- und Message-Aktionen
- Zwei-Account-Livetest erfolgreich: Online/Presence, „schreibt gerade…“, Gelesen/Doppelhaken, Antworten, Bearbeiten und Löschen funktionieren in beide Richtungen

### Phase 2.3 — Medien, Dateien & Anhänge ✅
- Migrationen `0007_chat_attachments.sql` und `0008_fix_attachment_cleanup.sql` aktiv
- privater Supabase-Storage-Bucket `nexus-chat-attachments`
- Anhänge sind serverseitig an Chat, Nachricht und Uploader gebunden
- Storage-Policies erlauben Upload/Lesen/Löschen nur für berechtigte Chat-Teilnehmer
- fehlgeschlagene Uploads können sicher aus dem eigenen Chat-/User-Pfad bereinigt werden
- Bilder/Fotos und Dokumente können als echte Chat-Nachrichten gesendet werden
- unterstützte Bilder: JPEG, PNG, WebP, GIF, HEIC und HEIF
- unterstützte Dokumente: PDF, TXT, CSV, Word, Excel, PowerPoint und ZIP
- maximale Dateigröße: 25 MB, im Frontend und Backend validiert
- private Dateien werden über kurzlebige Signed URLs im Messenger angezeigt
- Bildvorschau direkt im Chat; Dokumente mit Dateiname und Dateigröße
- optionale Text-Beschriftung bei Datei-/Bildnachrichten
- Reply-Funktion unterstützt auch Anhang-Nachrichten
- Upload-Zustand und Fehlerbehandlung im Composer
- Löschen eigener Anhang-Nachrichten entfernt Storage-Objekt und Metadaten
- Chatliste zeigt für reine Anhänge `📷 Bild` oder `📎 Datei`
- Produktionsbuild und GitHub-Pages-Deployment erfolgreich
- Zwei-Account-Livetest erfolgreich: Datei-Upload/Versand/Empfang funktioniert in beide Richtungen
- Löschen einer gesendeten Datei-Nachricht erfolgreich getestet
- PNG-Bildversand erfolgreich getestet: Bild wird direkt im Chat gerendert und lässt sich vergrößert öffnen

### Phase 2.4 — Sprachnachrichten ✅
- Migrationen `0009_voice_messages.sql` und `0010_fix_voice_message_rpc_mime.sql` aktiv
- Mikrofonaufnahme direkt im Messenger mit Browser-Mikrofonberechtigung
- laufender Aufnahme-Timer sowie Stoppen und Abbrechen der Aufnahme
- Audio-Vorschau vor dem Versand
- Sprachnachrichten werden über den bestehenden privaten Supabase-Storage gespeichert
- Audio-MIME-Typen werden im Storage, Frontend und serverseitigen Versand-RPC unterstützt
- Audio-Player direkt in der Chat-Nachricht
- Sprachnachrichten können wie andere eigene Nachrichten gelöscht werden
- bestehende RLS-/Storage-Regeln beschränken Zugriff weiterhin auf berechtigte Chat-Teilnehmer
- Produktionsbuild und GitHub-Pages-Deployment erfolgreich
- Zwei-Account-Livetest Samet ↔ Darlyn erfolgreich: Aufnahme, Vorschau, Versand, Empfang und Wiedergabe funktionieren in beide Richtungen

### Phase 2.5 — Gruppen & Team-Messenger ✅
- Migrationen `0011_group_chats_foundation.sql` bis `0016_harden_group_storage_cleanup.sql`
- sichere Gruppen-Grundstruktur mit `group_conversations`, `group_members`, `group_messages` und `group_reads`
- RLS auf allen Gruppentabellen
- Gruppen können nur mit bestätigten Nexus-Kontakten erstellt werden
- Rollen und Rechte: Owner, Admin und Mitglied
- Gruppen erstellen und mehrere Kontakte auswählen
- Gruppenliste mit Mitgliederzahl, letzter Nachricht und Ungelesen-Zähler
- echte Gruppen-Nachrichten mit Supabase Realtime
- Antworten, Bearbeiten und Löschen eigener Gruppen-Nachrichten
- Bilder, Dokumente und Sprachnachrichten im Gruppenchat
- Online-, Tipp- und Gruppen-Lesestatus in Echtzeit
- Mitgliederübersicht mit Online- und Rollenstatus direkt im Gruppenchat
- Gruppenname und privates Gruppenbild ändern
- bestätigte Kontakte nachträglich hinzufügen sowie Mitglieder entfernen
- Admins ernennen und zurückstufen
- Ownership sicher an ein vorhandenes Mitglied übertragen
- Gruppe als Mitglied/Admin verlassen; endgültiges Löschen ausschließlich durch den Owner
- Gruppen-, Rollen- und Mitgliederänderungen werden live synchronisiert
- Gruppenanhänge und Gruppenbilder sind über getrennte private Storage-Regeln geschützt
- beim endgültigen Löschen werden auch verwaiste Dateien im Gruppenspeicher bereinigt
- neue Mitglieder erhalten keine historischen Nachrichten fälschlich als ungelesen
- Build, TypeScript-Prüfung, automatisierte Vertrags-/Sicherheitschecks und Supabase-RLS-Prüfung eingerichtet
- Seiten werden als kleinere Teilpakete geladen, damit der Messenger schneller startet
- ältere Trigger- und RLS-Hilfsfunktionen gegen anonymen RPC-Zugriff gehärtet
- Owner-/Admin-Abnahme mit zwei Konten erfolgreich: Rollenanzeige, Gruppenbild, Nachrichten, Admin-Aktionen und Owner-only-Löschung geprüft

### Phase 2.6 — Datenbank-Sicherheit & Performance ✅
- Migrationen `0017_harden_legacy_function_access.sql` bis `0019_fix_presence_contact_rls.sql` aktiv
- anonyme Tabellen- und privilegierte Funktionszugriffe vollständig entzogen
- direkte Rechte auf das tatsächlich vom Browser benötigte Minimum reduziert
- Kontakte, Kontaktanfragen und Workspace-Einladungen explizit als RPC-only geschützt
- veralteten Direktnachrichten-RPC geschlossen und zukünftige Datenbankobjekte standardmäßig gesperrt
- 13 RLS-Regeln auf einmalige `auth.uid()`-Auswertung optimiert
- sechs fehlende Fremdschlüssel-Indizes ergänzt
- Presence-Kontaktprüfung über eine nicht exponierte Sicherheitsfunktion abgesichert
- Supabase Security- und Performance-Advisors erneut geprüft

### Phase 2.7 — Account-Wiederherstellung & Passwortschutz ✅
- neutraler „Passwort vergessen?“-Ablauf ohne Preisgabe, ob eine E-Mail registriert ist
- Wiederherstellungs-E-Mail über Supabase Auth mit sicherer Rückkehr zu GitHub Pages
- eigene Route `#/auth/reset-password` zum Setzen und Bestätigen eines neuen Passworts
- Recovery-Rückkehr für die reine Web-App ohne browsergebundenen PKCE-Verifier, damit der Link auch aus Mail-Apps und auf einem anderen Gerät zuverlässig geöffnet werden kann
- Callback-Daten werden vor der URL-Bereinigung sicher erkannt; der Recovery-Modus übersteht außerdem ein versehentliches Neuladen des Tabs
- abgelaufene, ungültige und bereits verwendete Links werden verständlich abgefangen
- einmalige Auth-Codes und Callback-Parameter werden nach der Verarbeitung aus der URL entfernt
- Passwort ein-/ausblenden und gemeinsame Mindestlängen-/Stärkeanzeige
- angemeldete Nutzer können ihr Passwort direkt in den Einstellungen ändern
- automatisierte Vertrags-, UI- und Sicherheitschecks für den Recovery-Fluss

## Routen
- `#/auth`
- `#/auth/reset-password`
- `#/app/briefing`
- `#/app/chats`
- `#/app/groups`
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
Nexus verwendet Supabase Row Level Security und Security-Definer-RPCs für sensible Datenoperationen. Private Server-Schlüssel gehören nicht ins Frontend. Kontakte und direkte Chats sind auf authentifizierte Nutzer und bestätigte Beziehungen begrenzt. Gruppen werden serverseitig auf bestätigte Kontakte, Gruppen-Mitgliedschaft und Rollen geprüft. Das Nutzerverzeichnis gibt keine E-Mail-Adressen aus. Eine spätere Ende-zu-Ende-Verschlüsselung wird mit etablierter Kryptografie separat entworfen; die aktuellen Messenger-Phasen sind noch keine E2E-Verschlüsselung.
