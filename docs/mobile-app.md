# Nexus auf dem Handy

Nexus ist als installierbare Web-App für iPhone/iPad und Android vorbereitet.
Adresse: https://saluuog.github.io/Nexus-AI-Business-Messenger/

- iPhone/iPad: In Safari öffnen, Teilen → Zum Home-Bildschirm. „Als Web-App öffnen“ aktivieren, falls angeboten, und hinzufügen.
- Android: In Chrome öffnen, Menü → App installieren bzw. Zum Startbildschirm hinzufügen. Wenn verfügbar, gibt es auch in Nexus einen Installationsbutton.
- Anschließend über das Nexus-Symbol starten und mit dem vorhandenen Konto anmelden. Eine Anmeldung kann in der installierten App erneut nötig sein.
- Anleitung auch auf der Anmeldung und unter Einstellungen → Allgemein.
- Mobile Navigation: oben links öffnet das Menü-Symbol die Kategorien. Die aktive Kategorie ist markiert; Auswahl, Tippen außerhalb oder Escape schließen das Menü. Der Inhalt bleibt nach dem Schließen normal scrollbar. Am Desktop bleibt die Seitenleiste sichtbar.

## Technischer Umfang

Die mobile App basiert auf der abgeschlossenen Phase 3.8. Der Entwurf von Phase 3.9 bleibt in PR #2; seine Datenbankmigration ist weiterhin nicht veröffentlicht. Die mobile Installation selbst benötigt keine Datenbankänderung. Die unten beschriebenen Business-Änderungen verwenden eine eigene Migration; kostenpflichtige KI bleibt deaktiviert.

Manifest mit stabilem ID/Scope/Startpfad unter dem GitHub-Pages-Unterverzeichnis, Standalone-Darstellung, PNG-Symbolen in 192/512 px, Apple-Touch-Icon in 180 px und skalierbarem Favicon. Mobil: Safe-Area-Abstände und 16-px-Eingaben gegen automatisches iOS-Fokuszoomen. Kein Zoom-Verbot.

Service Worker: nur die öffentliche Offline-Hinweisseite wird in CacheStorage gespeichert. App-HTML, JS, API-Antworten und Nutzerdaten werden nicht durch den Worker zwischengespeichert; es gibt keine Offline-Schreibwarteschlange. Bestehende Anmeldung/Entwürfe bleiben durch die bisherigen App-Funktionen verwaltet. App-Updates werden regulär aus dem Netz geladen, ohne erzwungenes Neuladen während der Eingabe.

Internet wird für neue Nachrichten und Aufgaben benötigt. Die native iOS-App kann bereits gespeicherte Textnachrichten offline lesen (siehe unten). Eine Veröffentlichung im Apple App Store oder Google Play Store sowie System-Push bei geschlossener App sind nicht Teil dieses Umfangs.

## Gespeicherte Chats ohne Internet

Die native App speichert erfolgreich geladene Einzel- und Gruppenchats in IndexedDB auf dem Gerät. Nach einem Offline-Neustart bleiben die gespeicherten Textnachrichten lesbar. Der angezeigte Zeitpunkt bezeichnet den letzten gespeicherten Stand; neue Nachrichten, Änderungen und Löschungen werden nach dem Wiederverbinden vom Server geladen. Offline-Ansichten erzeugen keine Lesebestätigungen. Nachrichten werden weiterhin ausschließlich manuell gesendet.

- Pro zuletzt geladener Chatseite: maximal 100 Nachrichten; maximal 40 Gesprächsverläufe und je 100 Listeneinträge. Gesamtbudget etwa 8 MB, Aufbewahrung höchstens 30 Tage. Bei wenig Gerätespeicher können weniger Daten verfügbar sein. Ältere paginierte Seiten werden nicht als vollständiges Archiv gespeichert.
- Nur Text, Namen, IDs und Zeitangaben. Keine Anhänge, Avatare, signierten Download-URLs, Zugangstoken oder Berechtigungen. Anhänge erhalten einen Offline-Hinweis; zitierte Nachrichtentexte werden nicht redundant gespeichert. Der lokale Textspeicher ist nicht zusätzlich durch die App verschlüsselt.
- Konten werden getrennt. Kontowechsel und Abmeldung löschen die vorherigen Offline-Daten. Verspätete Antworten eines vorherigen Kontos dürfen den Speicher nicht wieder füllen. Online-Zugriffsfehler und aus einer erfolgreich geladenen Liste entfernte Chats verwerfen betroffene gespeicherte Verläufe.
- Falls die Sitzung offline nicht erneuert werden kann, öffnet sich eine gesonderte Leseansicht für das zuletzt angemeldete Konto. Der gespeicherte Konto-Identifier ist keine Anmeldung und wird nie für Serverberechtigungen verwendet. Diese Ansicht hat keine Schreib-, Mitglieder- oder Serverfunktionen. Dort kann der lokale Chatspeicher gelöscht werden. Online übernimmt wieder die reguläre Sitzungsprüfung.
- Gespeicherte Daten sind ein begrenzter letzter Stand, kein Backup. Änderungen oder entzogene Zugriffe, die das Gerät noch nicht online erhalten hat, können offline nicht erkannt werden. Nach bestätigter Serveränderung wird der lokale Stand aktualisiert bzw. entfernt.

Der Service Worker bleibt unverändert: Ein kalter Offline-Start der Web/PWA-Version lädt weiterhin die öffentliche Hinweisseite. Der Offline-Neustart der nativen App funktioniert mit ihren lokal gebündelten App-Dateien.

Gezielte Prüfung: `tests/browser/offline-cache.mjs` deckt Einzel-/Gruppenchats, frischen Offline-Start, abgelaufene Sitzung, Wiederverbindung, bearbeitete/gelöschte Nachrichten, Kontowechsel, Abmeldung, Datenbegrenzung, Entzug des Zugriffs und verspätete Antworten ab. Ein Test auf dem physischen iPhone bleibt nach Installation des neuen Builds nötig.

## Prüfung

`npm run typecheck`, `npm test`, `npm run build`; CI in Chromium und WebKit mit dem Produktionsbuild: Manifest/Pfade, echte PNG-Maße, Apple-Icon, Anmeldung, 320/390-px-Breiten, Eingabegröße, Installationshinweise, simulierte Installationsereignisse, ausschließlich öffentlicher Offline-Cache, Offline-Neuladen und Wiederverbindung. Bestehende Workspace-, Nachrichten-, Aufgaben- und Einstellungsabläufe bleiben CI-Pflicht. Nach Veröffentlichung wird das genaue Build-Asset einschließlich Manifest, Symbolen, Service Worker und mobiler Anmeldung auf der echten URL geprüft. Eine physische iPhone-/Android-Installation kann nur auf dem jeweiligen Handy bestätigt werden.

Quellen: [Apple](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios), [MDN](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable).

## Kunden, Projekte und mobile Chats (22. September 2026)

- Auf dem Handy öffnet „Chats“ zuerst die Liste. Eine Auswahl öffnet nur das Gespräch; „Alle Chats“ führt zurück. Gruppen folgen demselben Muster. Entwürfe bleiben pro Gespräch erhalten, direkte Links öffnen weiterhin das richtige Gespräch bzw. die Ursprungsnachricht. Die reine Listenansicht markiert keine verborgenen Chats als gelesen. Am Desktop bleibt die zweigeteilte Ansicht.
- Auf jeder Kundenkarte öffnet die Sprechblase den privaten Chat mit dem verknüpften Nexus-Kontakt. Owner/Admin wählen im Kundenformular unter „Nexus-Kontakt für Kundenchat“ einen bestätigten Kontakt aus. Ein Kunde ohne Nexus-Konto bzw. bestätigte Kontaktverbindung kann nicht automatisch angeschrieben werden. Jede Person braucht ihre eigene bestätigte Verbindung; die Verknüpfung teilt keine fremden Chatverläufe.
- Der separate Aufgaben-Tab entfällt. „Projekte“ enthält die Schaltfläche „Alle Projektaufgaben“ und pro Projekt die vorhandene Schaltfläche „Aufgaben“. Alte Aufgabenlinks bleiben gültig. Beim Anlegen eines Projekts können bis zu 50 Aufgaben mit Verantwortlichen, Termin, Priorität und Beschreibung mitgespeichert werden.
- Kunden und Projekte können nur Owner/Admin anlegen, bearbeiten oder löschen. Member dürfen Projektaufgaben weiterhin anlegen und bearbeiten; Guests können sie ansehen und öffnen. Aufgabenlöschen bleibt Owner/Admin vorbehalten.

Migration: `20260922010549_mobile_business_workflows.sql` (Dateiversion mit der tatsächlich angewendeten Migration abgeglichen). Sie schränkt beide UPDATE-Policies auf Owner/Admin ein, ergänzt die explizite Kontaktverknüpfung und führt `create_project_with_tasks` als SECURITY INVOKER ein. Bestehende RLS- und Aufgaben-Trigger bleiben wirksam. Ein Auftrag einschließlich erster Aufgaben wird atomar gespeichert; Wiederholungen derselben Projekt-ID erzeugen keine Duplikate und überschreiben keine vorhandenen Daten.

Gezielte Abnahme: `tests/sql/mobile-business-rls.sql` prüft mit ausschließlich synthetischen und zurückgerollten Daten Owner/Admin, Member, Guest, Außenstehende und anonyme Aufrufer; außerdem Kontaktprivatsphäre, Zuweisung, Transaktionsabbruch und wiederholte Projektanlage. `tests/browser/mobile-workflows.mjs` prüft die neuen Oberflächenabläufe bei 320 und 390 px in Chromium und WebKit. Die bestehende vollständige Browser-Abnahme und die Prüfung der veröffentlichten Build-Datei bleiben Release-Gates.

Nach der Migration: keine neue Sicherheitswarnung für die geänderten Objekte. Bestehende Advisor-Hinweise bleiben separat: [authentifizierte SECURITY-DEFINER-RPCs](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [private Tabellen ohne direkte RLS-Policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [Passwortschutz](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) sowie [Indizes](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys). Der neue Fremdschlüsselindex ist vorhanden; der Hinweis „noch unbenutzt“ direkt nach Anlage ist erwartbar.
