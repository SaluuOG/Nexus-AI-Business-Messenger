# Nexus: App-Store-Paket

Stand: 3. Oktober 2026. Arbeitsfassung zur Prüfung, **noch nicht zur Einreichung freigegeben**.
Geprüfte Codebasis: `bec5ed4`, Branch `codex/native-auth-links` auf GitHub.

## Was vorbereitet ist

| Unterlage | Inhalt |
| --- | --- |
| [Store-Texte](metadata-de.md) | Name, Untertitel, Beschreibung, Suchbegriffe und Pflichtfelder |
| [Maschinenlesbare Metadaten](metadata-de.json) | Kopierbare deutsche Texte; offene Felder bewusst leer |
| [Screenshots](screenshots.md) | Sechs Motive, Bildtexte, Beispieldaten und Aufnahmefolge |
| [App Review](review-notes.md) | Englische Prüferhinweise, Testkonto-Vorbereitung und Geräteabnahme |
| [App-Datenschutz](privacy-mapping.md) | Datenarten anhand des Codes, vorgeschlagene Apple-Angaben und offene Nachweise |
| [Freigabeliste](release-checklist.md) | Konkrete technische und organisatorische Voraussetzungen |
| [AGB-Entwurf](../legal/agb-entwurf.md) | Nutzungsbedingungen für den Nexus-Dienst |
| [Datenschutz-Entwurf](../legal/datenschutz-entwurf.md) | Verarbeitung, Empfänger, lokale Daten und Betroffenenrechte |
| [Impressum und Support](../legal/impressum-support-entwurf.md) | Vorlagen für die notwendigen öffentlichen Kontaktseiten |
| [Fehlende Angaben](../legal/betreiberangaben.md) | Informationen, die der Betreiber noch entscheiden oder ergänzen muss |
| [Quellen](sources.md) | Offizielle Apple-, Gesetzes- und Dienstleisterquellen |

Die Dateien liegen absichtlich außerhalb von `public` und `src`. Sie werden nicht als fertige Rechtstexte in die App eingebaut und nicht mit dem Vite-Build veröffentlicht. Die AGB sind keine bereits vereinbarte Vertragsfassung. Alle Texte mit `[PLATZHALTERN]` benötigen Ergänzung und rechtliche Prüfung.

## Ergebnis der Bestandsaufnahme

- **Vorhanden:** App-Name Nexus; Bundle-ID `com.saluuog.nexus`; iPhone und iPad; Mindestversion iOS 15; Version 1.0 / Build 1; eigenes 1024×1024-RGB-Symbol ohne Alpha-Kanal; Mikrofonhinweis; lokal gebündelte Web-Dateien; nativer Auth-Rücksprung; Kontolöschfunktion. Es wurde kein signiertes Archiv erzeugt.
- **Bestätigt:** Supabase-Projekt ist am Prüfdatum aktiv, Region `eu-central-1` (Frankfurt). Das belegt nicht, dass sämtliche Unterauftragnehmer, Supportzugriffe und Logs ausschließlich in der EU liegen.
- **Nicht vorhanden im geprüften Code:** öffentliche Datenschutz-, AGB-, Impressums- und Supportseiten; wirksame Einbeziehung der AGB bei Registrierung; Nutzerblockierung; Meldung von missbräuchlichen Inhalten; vollständiger Moderationsablauf. Kontaktanfragen und Rollen ersetzen diese Funktionen nicht.
- **Nicht als Store-Funktion versprechen:** fertige native APNs-Zustellung, Hintergrundalarm für persönliche Wiedervorlagen, aktive KI-Auswertung, Ende-zu-Ende-Verschlüsselung, vollständiges Offline-Archiv.
- **Nacharbeiten nötig:** Löschhinweise erklären Team-Inhalte und lokale Entwürfe noch nicht ausreichend. Lokale Entwürfe haben aktuell keine automatische Ablaufzeit und werden vom Abmelde-/Kontolöschpfad nicht ausdrücklich entfernt. Details und Abnahme in der Freigabeliste.

## Was du jetzt prüfen kannst

- Store-Beschreibung lesen: Beschreibt sie den Zweck von Nexus so, wie du ihn anbieten möchtest?
- Die vier wichtigsten Betreiberangaben bereitstellen: rechtlicher Name und Sitzland, ladungsfähige Anschrift, Support-/Datenschutz-E-Mail, Zielgruppe und Preisgestaltung.
- Bei den sechs Screenshot-Motiven prüfen, ob diese Funktionen im zuletzt installierten Build sichtbar sind.
- Keine echten Kunden- oder Chatdaten für öffentliche Screenshots verwenden.

**Für diesen Dokumentationsschritt ist kein neuer iPhone-Build und kein Terminal-Update nötig.** Es wurden weder App-Funktionen noch Datenbankdaten geändert. Die Vorbereitung ist mit dem bisherigen Werkzeugbestand möglich; App-Store-Veröffentlichung und TestFlight benötigen eine entsprechende Apple-Developer-Mitgliedschaft. Es wurde nichts gebucht oder eingereicht.

Für spätere Änderungen enthalten die Übergaben jeweils konkrete Testpunkte mit Aktion und erwartetem Ergebnis. Geräteprüfungen werden erst nach Rückmeldung als bestanden markiert.
