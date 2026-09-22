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

### Phase 3.1 — Echte Kunden- und Projektverwaltung ✅
- Migration `0020_business_management.sql` mit echten `customers`- und `projects`-Tabellen
- Kunden mit Status, Ansprechpartner, E-Mail, Telefon, Website und Notizen
- Projekte mit Kundenzuordnung, Status, Priorität, Auftragswert, Deadline, Fortschritt und Beschreibung
- vollständiges Anlegen, Bearbeiten und Löschen über die Business-Oberfläche
- Suche und Statusfilter für Kunden und Projekte
- Live-Kennzahlen für Kunden, offene Projekte, Auftragswert und überfällige Deadlines
- Supabase Realtime synchronisiert Business-Änderungen im Team
- strikte Workspace-Trennung per Row Level Security
- Aktuelles Rollenmodell für Kunden/Projekte: Owner/Admin vollständig; Member und Guest lesen (seit dem mobilen Update vom 22. September 2026)
- Workspace und Ersteller eines Datensatzes sind serverseitig gegen Manipulation geschützt
- beim Löschen eines Kunden bleiben zugehörige Projekte sicher erhalten

### Phase 3.2 — Projektaufgaben, Zuständigkeiten & Deadlines ✅
- Migration `0021_project_tasks.sql` mit geschützter Tabelle `project_tasks`
- Aufgaben direkt aus einer Projektkarte oder über „Alle Projektaufgaben“ innerhalb von „Projekte“ öffnen
- Titel, Beschreibung, Projekt, verantwortliche Person, Priorität und Deadline
- Status: Offen, In Arbeit, Zur Prüfung, Blockiert und Erledigt; direkt in der Liste änderbar
- Projekt-/Personen-/Statusfilter sowie Suche und „Meine Aufgaben“
- Kennzahlen für offene, heute fällige und überfällige Aufgaben; erledigte Aufgaben zählen nicht als überfällig
- Aufgabenfortschritt aus erledigten Aufgaben je Projekt; der bestehende manuelle Projektfortschritt bleibt separat
- Warnhinweis, wenn eine Aufgabe nach der Projekt-Deadline fällig wird
- Owner/Admin können Aufgaben anlegen, bearbeiten und löschen; Member anlegen und bearbeiten; Guest lesen
- Zuständigkeiten nur für schreibberechtigte Team-Mitglieder; Entfernung oder Herabstufung zum Guest gibt Aufgaben automatisch frei
- Workspace-Trennung durch RLS und zusammengesetzte Fremdschlüssel; Audit-Felder sind nicht vom Browser beschreibbar
- Gleichzeitige Bearbeitung wird über die gespeicherte Version erkannt, damit Änderungen nicht unbemerkt überschrieben werden
- Realtime für Aufgaben- und Teamänderungen, einschließlich Löschungen; erneutes Laden bei Rückkehr zum Tab
- Projektlöschung entfernt nach ausdrücklicher Bestätigung auch die zugehörigen Aufgaben
- Funktionstests für Filter, Rollen, Datenzugriff, Seitengrenzen, Konflikte und gerenderte Oberfläche
- `tests/sql/project-tasks-rls.sql` prüft Owner/Admin/Member/Guest, Workspace-Trennung und Löschketten in einer vollständig zurückgerollten Transaktion

### Phase 3.3 — Tagesbriefing & Prioritäten
- persönliche heute fällige und überfällige Aufgaben, getrennt vom Handlungsbedarf des gesamten Teams
- vollständige Zähler unabhängig von der Anzahl angezeigter Zeilen; weitere Einträge nachladen
- überfällige Projekte zuerst, anschließend kommende Deadlines und Projekte ohne Termin
- Sieben-Tage-Zeitraum umfasst heute bis einschließlich sechs Kalendertage später; lokaler Tageswechsel wird automatisch berücksichtigt
- Projektfortschritt entspricht dem in der Projektverwaltung gepflegten Wert
- direkte Detailansichten mit Workspace, Projekt und Aufgabe in der URL; funktionieren nach Neuladen und für lesende Gäste
- leere, ladende, fehlgeschlagene und nicht mehr zugängliche Daten werden getrennt angezeigt
- Realtime, Aktualisieren-Schaltfläche, Rückkehr zum Tab und periodischer Abgleich halten den Stand aktuell
- automatische Prüfungen für Fristen, Zähler, Seitengrenzen, Berechtigungen sowie Browserabläufe in Chromium und WebKit
- Browserprüfungen verwenden ausschließlich isolierte Testdaten; sie ändern keine Produktionsdaten
- Veröffentlichung prüft zusätzlich das konkrete veröffentlichte JavaScript-Paket und den echten Login in beiden Browsern

### Phase 3.4 — Nachrichten als Projektaufgaben
- „Als Aufgabe übernehmen“ in Einzel- und Gruppenchats; Titel und Beschreibung werden aus der Nachricht vorbereitet und bleiben bearbeitbar
- bewusste Freigabe an einen Workspace mit Schreibrecht; Projekt, zuständige Person, Priorität und Deadline auswählen
- Anhänge bleiben im Chat; Nachrichten über 4.000 Zeichen müssen vor der Übernahme in der Aufgabenbeschreibung gekürzt werden
- Aufgabe und Quellenverknüpfung werden atomar gespeichert; derselbe Übernahmeversuch erzeugt bei Wiederholung keine zweite Aufgabe
- neue Aufgaben erscheinen in der Projektverwaltung und bei passender Zuständigkeit/Frist im Tagesbriefing
- Rücksprung zeigt die genaue aktuelle Ursprungsnachricht im Chat, auch außerhalb der letzten 200 Nachrichten; URL funktioniert nach Neuladen
- Quellenverknüpfungen sind nur bei gleichzeitigem Zugriff auf Workspace und Chat lesbar; fehlender Zugriff oder gelöschte Quellen zeigen keinen Nachrichtentext
- Änderungen oder Löschung der Quelle verändern den bewusst geteilten Aufgabentext nicht; Aufgabenlöschung entfernt ihre Verknüpfung
- Migration `20260915030037_message_project_tasks.sql`, erzeugt mit der Supabase CLI; neue Funktionen verwenden `SECURITY INVOKER` und die bestehenden RLS-Regeln
- `tests/sql/message-tasks-rls.sql` prüft mit drei Identitäten Quellenzugriff, Rollenwechsel, Seitengrenzen, Wiederholung und Löschketten und rollt sämtliche Testdaten zurück
- Browserabläufe prüfen beide Chat-Arten, mobile Dialoge, Textfreigabe, Verbindungsabbruch nach Speicherung, Workspace-Wechsel, lange Nachrichten und verlorenen Zugriff

### Phase 3.5 — Benachrichtigungen & Aktivitätsübersicht
- Glocke mit vollständigem Ungelesen-Zähler, eigener Übersicht und Filter „Alle/Ungelesen“; mobile Bedienung und Tastaturzugriff
- serverseitige Ereignisse für neue Einzel-/Gruppennachrichten, Kontaktanfragen, Workspace-Einladungen und Aufgabenzuweisungen durch andere Teammitglieder
- Frist-Hinweise für eigene heute fällige und überfällige Aufgaben; lokale IANA-Zeitzone, jeweils ein Ereignis pro Aufgabe/Termin/Fristzustand
- Fristen und noch offene Kontaktanfragen/Einladungen werden beim Abruf abgeglichen; Nachrichten und Zuweisungen werden ab Aktivierung dieser Phase erfasst
- nur Metadaten und Quellenkennungen werden gespeichert, keine Kopien privater Nachrichtentexte; aktuelle Quellenrechte werden bei jedem Abruf erneut geprüft
- beantwortete Anfragen, abgelaufene/widerrufene Einladungen, gelöschte Nachrichten sowie nicht mehr zugängliche Aufgaben/Gruppen verschwinden aus der Übersicht
- Hinweis-Gelesenstatus bleibt pro Konto erhalten; „Alle als gelesen“ gilt bis zur abgerufenen Ereignisnummer, sodass gleichzeitig neu eintreffende Hinweise ungelesen bleiben
- Öffnen eines Chats markiert auch seine Hinweise als gelesen; das Markieren eines Hinweises erzeugt keine Chat-Lesebestätigung
- vollständige Zähler und Keyset-Seitennavigation; direkte Links zu Chat, Gruppe, Einladung oder genauer Workspace-/Projektaufgabe
- Kategorie „Benachrichtigungen“ speichert Nachrichten, Kontaktanfragen, Einladungen, Zuweisungen und Fristen pro Konto für alle Geräte; ausgeschaltete Kategorien bleiben aus Übersicht und Zähler ausgeblendet
- Realtime sowie Abgleich bei Rückkehr zur App, wiederhergestellter Verbindung und alle 30 Sekunden; ausschließlich Hinweise innerhalb der geöffneten App
- Migration `20260915035952_notifications_center.sql`; RLS, minimale Schreibrechte, interne Trigger in nicht exponiertem Schema und öffentliche RPCs mit `SECURITY INVOKER`
- `tests/sql/notifications-rls.sql` verwendet ausschließlich synthetische Identitäten und rollt alle Prüfungen zurück; Browserabläufe in Chromium/WebKit verwenden isolierte Testdaten

### Phase 3.6 — Gesamten Chat mit KI auswerten (Anbindung vorbereitet)
- eigener Button unten rechts im Einzel- und Gruppenchat; keine Auswahl einzelner Nachrichten nötig
- vollständiger zugänglicher Textverlauf über einen separaten seitenweisen Abruf, einschließlich älterer Nachrichten außerhalb der letzten 200
- Zusammenfassung, wichtige Informationen, Entscheidungen, Aufgaben und offene Fragen mit Textstellen zum Nachprüfen
- Dialog mit Status der KI-Anbindung, bewusstem Start, Fortschrittsanzeige, Abbrechen und verständlichen Fehlerzuständen
- Dateiinhalte, Bilder und Sprachnachrichten sind noch nicht Teil dieser Textauswertung; keine automatische Aufgabenanlage oder Nachrichtenversendung
- Ergebnisse sind an Konto, Chat und den ausgewerteten Verlauf gebunden; veraltete oder verspätete Ergebnisse werden verworfen
- persönliche Chatstatus „Offen“, „Neue Nachrichten“, „Ausgewertet“ und „Fertig“, mit Filtern in Einzel- und Gruppenchats
- „Fertig“ bleibt bis zum manuellen Wiederöffnen ausgeschlossen; ausgewertete unveränderte Chats öffnen ihr letztes privat gespeichertes Ergebnis ohne neuen KI-Aufruf
- neue oder geänderte Nachrichten geben einen ausgewerteten Verlauf zur erneuten vollständigen Analyse frei; „Ausgewertet“ setzt keine Aufgaben auf erledigt
- Migrationen `20260915044932_chat_scan.sql`, `20260915132017_chat_scan_workflow.sql` und Edge Function `chat-scan`; serverseitiger Anbieterzugang, Quellenrechte, Statusrennen und begrenzte Nutzung
- **Aktivierung ausstehend:** Anbieterzugang, Modell und Kostenrahmen sind noch einzurichten; bisherige KI-Prüfungen verwenden simulierte Antworten
- Einrichtung und Grenzen: [docs/chat-scan-setup.md](docs/chat-scan-setup.md)

### Phase 3.7 — Vollständiger Verlauf, Suche & sichere Entwürfe ✅
- ältere Direkt- und Gruppennachrichten seitenweise nachladen, ohne dass die sichtbare Stelle im Verlauf springt
- globale, serverseitige Nachrichtensuche über alle aktuell zugänglichen Chats; Filter nach Chat-Art, Gespräch oder Person und lokalem Datumsbereich
- Suchtreffer öffnen exakt die betreffende Nachricht im richtigen Direkt- oder Gruppenchat und heben sie sichtbar hervor
- gelöschte Nachrichten und Anhänge werden serverseitig geschwärzt; entfernte Zugriffe verschwinden unmittelbar aus Suche und Verlauf
- Textentwürfe bleiben pro Konto, Chat und Chat-Art in diesem Browser erhalten, auch nach Chatwechsel oder Neuladen
- fehlgeschlagene Textsendungen werden ausschließlich nach bewusster Bestätigung mit derselben Anfrage-ID wiederholt; ein verlorenes Serverergebnis erzeugt dadurch keine doppelte Nachricht
- Dateien und Sprachnachrichten werden niemals automatisch erneut hochgeladen
- Chatlisten reagieren per Realtime auch auf neue Nachrichten in nicht geöffneten Unterhaltungen; Fokus- und 30-Sekunden-Abgleich dienen als Ausfallsicherung
- bereits geladene ältere Nachrichten werden nach externem Bearbeiten oder Löschen gezielt aktualisiert, auch wenn sie außerhalb der neuesten 100 Nachrichten liegen
- tiefe Verlaufsansichten setzen keine ungesehenen neueren Nachrichten versehentlich auf gelesen und bieten jederzeit den Sprung zum aktuellen Ende
- Migration `20260915182541_phase_three_seven_message_history_search.sql` mit stabilen Cursor-Indizes, zugriffsgeschützten RPCs und explizit gesperrtem anonymem Zugriff
- automatisierte Daten-, Sicherheits- und Browserprüfungen decken Cursor-Kollisionen, RLS-Isolation, Suche, Deep-Links, Entwürfe, Wiederholung und 320-/390-Pixel-Ansichten ab
- diese Phase benötigt keinen KI-Anbieter und verursacht keine OpenAI-API-Aufrufe; die KI-Anbindung aus Phase 3.6 bleibt bis zur bewussten Aktivierung ausgeschaltet

### Phase 3.8 — Workspace-Lebenszyklus & sichere Ownership ✅
- Owner und Admins können den aktiven Workspace in den Einstellungen umbenennen; Namen werden serverseitig validiert
- Admins, Member und Gäste können einen Workspace nach ausdrücklicher Bestätigung selbst verlassen; zugewiesene Aufgaben bleiben erhalten und werden sicher freigegeben
- Owner können die Ownership atomar an einen vorhandenen Admin oder Member übertragen und bleiben anschließend als Admin im Team
- ein partieller Datenbankindex verhindert dauerhaft mehr als eine Owner-Mitgliedschaft pro Workspace
- endgültiges Löschen ist ausschließlich für den aktuellen Owner möglich und verlangt den exakten Workspace-Namen sowie einen zweiten Bestätigungsdialog
- Workspace, Einladungen, Kunden, Projekte, Aufgaben und weitere abhängige Daten werden beim Löschen über die bestehenden Fremdschlüssel kontrolliert entfernt
- direkte Workspace-Updates und -Löschungen aus dem Browser sind entzogen; sämtliche sensiblen Aktionen laufen über gesperrte, authentifizierte RPCs mit leerem `search_path`
- nach Verlassen oder Löschen wählt Nexus automatisch den nächsten verfügbaren Workspace oder einen sicheren leeren Zustand
- Rollen, Nachfolgerauswahl, Busy-/Doppelklickschutz, Fehlermeldungen und Dialoge sind bis 320 Pixel Breite zugänglich bedienbar
- rollbackfähige SQL-Prüfungen decken Rollen, RLS, anonyme Zugriffe, Owner-Invariante, Aufgabenfreigabe und Löschkaskaden ab; Browserprüfungen testen den vollständigen Ablauf
- diese Phase benötigt keinen KI-Anbieter und verursacht keine OpenAI-API-Aufrufe

### Phase 3.9 — Aufgaben-Zusammenarbeit ✅
- Aufgabendetails sind direkt aus der Aufgabenliste erreichbar und enthalten Kommentare, Checklisten und einen serverseitigen Änderungsverlauf
- Owner, Admins und Member können kommentieren und Checklisten pflegen; Gäste lesen mit
- nur die Verfasser bearbeiten Kommentare; Verfasser mit Schreibrecht sowie Owner/Admins können Kommentare entfernen
- unveränderliche Workspace-/Aufgaben-Zuordnung, serverseitige Autoren und Revisionen schützen vor gefälschten Metadaten und veraltetem Überschreiben
- Wiederholung nach einer verlorenen Antwort erzeugt keinen doppelten Kommentar oder Checklistenpunkt
- Kommentare und Verlauf werden mit stabilen Cursorn nachgeladen; Realtime, erneuter Fokus und ein sichtbarkeitsabhängiger Abgleich aktualisieren die geladene Ansicht
- Konto-, Rollen- und Workspace-Wechsel verwerfen alte Antworten und Eingaben; fehlgeschlagene Zugriffsprüfungen entfernen zuvor geladene Inhalte
- der Verlauf speichert Aktionsarten und geänderte Feldnamen, keine Kopien privater Chat- oder Kommentartexte
- [Umfang, Testnachweise und Freigabeschritte](docs/phase-3-9.md); beide Migrationen sind angewandt, die veröffentlichte Version sowie Owner-/Member-/Guest-Abnahme mit zwei echten Konten sind bestätigt und der Test-Workspace ist bereinigt

### Einstellungen nach Kategorien
- Allgemein: Startansicht sowie private oder geschäftliche Identität; die Auswahl wird pro Konto in diesem Browser gespeichert
- Profil & Business: Name, Username, Bio und Business-Profil
- Workspace & Team: aktiven Workspace auch mobil auswählen, Workspace erstellen oder umbenennen, Mitglieder, Rollen und Einladungen verwalten sowie Ownership übertragen, verlassen oder sicher löschen
- Benachrichtigungen: Hinweise nach Art ein-/ausschalten; Auswahl wird pro Konto auf allen Geräten gespeichert
- Datenschutz & Sicherheit: Passwort ändern, Wiederherstellungslink an die eigene Konto-Adresse senden und abmelden
- klare Fehlermeldungen und eine Sendepause nach erfolgreicher Reset-Anforderung; Passwort-Sonderzeichen bleiben unverändert erhalten
- Kategorien bleiben in der URL erhalten und unterstützen Neuladen, Zurück/Vorwärts und Tastaturbedienung; Einladungslinks bleiben beim Kategorienwechsel erhalten
- direkte Aufgaben- und Chatlinks haben Vorrang vor der gewählten Startansicht
- Testfälle für Kontentrennung und nicht verfügbaren Browserspeicher sowie vollständige Browserabläufe mit isolierten Auth-Testdaten

Browserprüfungen laufen in GitHub Actions mit Playwright 1.55.1 in einem separaten Laufzeitverzeichnis. Lokal: Playwright installieren, Chromium/WebKit mit `playwright install --with-deps chromium webkit` bereitstellen und `NEXUS_PLAYWRIGHT_MODULE` auf den absoluten Pfad zu `playwright/index.mjs` setzen. Danach die Skripte in `tests/browser/` ausführen; Phase 3.7 wird mit `node tests/browser/message-history.mjs` geprüft. Screenshots landen unter `browser-results/`. `node tests/browser/preview.mjs` startet eine separate Vorschau mit synthetischen Testdaten; diese werden nicht mit der App veröffentlicht.

Offene Nutzerabnahme: abschließender manueller Durchlauf mit zwei echten Konten. Browserprüfungen mit Testdaten ersetzen diese Abnahme nicht.

## Routen
- `#/auth`
- `#/auth/reset-password`
- `#/app/briefing`
- `#/app/chats`
- `#/app/groups`
- `#/app/search`
- `#/app/contacts`
- `#/app/business`
- `#/app/ai`
- `#/app/settings`
- `#/app/notifications`

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
