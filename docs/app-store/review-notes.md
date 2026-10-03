# App Review: vorbereitete Hinweise

**Draft. Do not submit while placeholders or release blockers remain.** These notes describe the intended submission of the current feature set; they do not certify App Store compliance.

## English notes for the reviewer

Nexus combines private one-to-one and group conversations with shared customer, project and task management. Users authenticate with email and password. Workspace roles determine access to shared business content; private conversations are not automatically shared with workspace administrators.

The supplied review account contains synthetic data only. Use the navigation menu to open Chats, Group Chats, Briefing, Projects and Settings. From a message's options menu, you can create a task, save a private bookmark or schedule a personal follow-up. Follow-ups appear in the Briefing screen while the app is in use; they are not background notifications.

Previously loaded text messages can be read offline within a bounded local cache. Attachments, new messages and writes require connectivity. The app does not provide end-to-end encryption. Native APNs delivery is not enabled in this version. The AI integration is disabled; no paid model access is required for the listed messaging and project features.

Account deletion is available under Settings → Privacy & Security (German UI: Einstellungen → Datenschutz & Sicherheit → Konto dauerhaft löschen). Confirm by entering `KONTO LÖSCHEN`. If an account owns a workspace or group, it must first transfer ownership or delete that workspace/group. Supply a separate disposable deletion account to preserve the main review environment.

Microphone access is requested only when recording a voice message. Denying it should leave text messaging available.

Review account: `[ENTER_IN_APP_STORE_CONNECT_ONLY]`

Password: `[ENTER_IN_APP_STORE_CONNECT_ONLY]`

Disposable deletion account: `[ENTER_IN_APP_STORE_CONNECT_ONLY]`

Support/contact for review: `[REAL_NAME_EMAIL_PHONE]`

Moderation workflow: `[ADD_EXACT_PATHS_AFTER_REPORT_BLOCK_AND_CONTENT_HANDLING_ARE_IMPLEMENTED_AND_TESTED]`

## Betreiber-Vorbereitung

- Zwei oder drei dauerhaft erreichbare Testkonten in einem ausschließlich synthetischen Workspace bereitstellen; Zugangsdaten nur im geschützten App-Review-Feld hinterlegen, nicht im Repository.
- Hauptkonto mit sichtbaren Chats, Projekt, Aufgabe, Reaktion und persönlicher Wiedervorlage ausstatten. Zweites Konto als Gesprächspartner; separates Konto für die zerstörende Löschprüfung.
- Zugang während der Prüfung funktionsfähig halten; keine unerklärten Einladungs-, Bestätigungs- oder MFA-Hürden. Reale Nutzerdaten bleiben unzugänglich.
- Prüferkontakt und eventuell nötige besondere Schritte vollständig eintragen. Kein produktives Kennwort im Screenshot oder Supporttext.
- Nach Implementierung des Missbrauchsschutzes die Lücke im englischen Text durch tatsächliche Menüpfade ersetzen.

## Geräteabnahme vor Upload

- **Anmeldung:** Frisch starten, anmelden, schließen und erneut öffnen → Sitzung und richtige Kontodaten erscheinen.
- **Passwort vergessen:** Neuen Link anfordern, auf demselben iPhone öffnen, Passwort ändern → danach funktioniert das neue Kennwort; verbrauchter Link führt zu verständlichem Hinweis.
- **Chats:** Mit zwei Testkonten Nachricht senden, antworten, reagieren und weiterleiten → richtige Empfänger, keine doppelte Nachricht.
- **Wiedervorlage:** Termin wenige Minuten in der Zukunft setzen → im Briefing sichtbar; nach Fälligkeit im Filter „Fällig“; „Erledigen“ entfernt sie aus offenen Einträgen. Kein Hintergrundalarm erwartet.
- **Offline:** Chat online laden, Internet abschalten, App neu öffnen → gespeicherter Text bleibt lesbar; Wiederverbindung lädt neue Inhalte.
- **Kontowechsel:** A abmelden, B anmelden → B sieht weder private Nachrichten noch Wiedervorlagen von A. Entwürfe separat prüfen, siehe Freigabeliste.
- **Mikrofon:** Berechtigung zunächst verweigern → verständlicher Hinweis und Textchat bleibt bedienbar. Anschließend erlauben, aufnehmen und mit Testkonto empfangen.
- **Team-Rechte:** Member/Guest versuchen eine Owner-Aktion → Server verweigert sie; eigene persönliche Wiedervorlagen sind für das andere Konto unsichtbar.
- **Kontolöschung – nur Wegwerfkonto:** Erst abbrechen → Konto bleibt. Dann endgültig bestätigen → Anmeldung scheitert, Konto- und Dateibereinigung mit beiden Testkonten prüfen. Niemals das produktive Eigentümerkonto zum Test löschen.
- **iPad und Bedienbarkeit:** Hoch-/Querformat, Tastatur, große Schrift, VoiceOver und Zurücknavigation → keine abgeschnittenen Dialoge, bedienbare Optionen und verständliche Beschriftungen. Unterstützungsangaben erst danach bestätigen.
- **Rechtstexte – nach Veröffentlichung:** Im abgemeldeten Zustand und aus Einstellungen öffnen → vollständige aktuelle Texte, funktionierende Kontakte, keine Platzhalter.
- **Melden/Blockieren – nach Umsetzung:** Missbrauchsmeldung und Blockierung mit Testkonten auslösen → autorisierte Bearbeitung, wirksame Serversperre und keine Offenlegung fremder Chats.

Die Rückmeldungen im Chat bestätigen mehrere bestehende Abläufe auf dem iPhone, aber keine vollständige Abnahme dieses Release-Kandidaten. Die persönlichen Wiedervorlagen und die spätere Store-Fassung sind noch gezielt zu prüfen.
