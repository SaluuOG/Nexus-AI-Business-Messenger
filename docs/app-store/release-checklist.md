# Freigabeliste für den ersten Store-Release

Stand 3. Oktober 2026. **Status: Vorbereitung, noch nicht einreichbar.** Unbestätigte Punkte bleiben offen. Unterlagen allein schließen technische Lücken nicht.

| Priorität / Aufgabe | Stand und nächste konkrete Arbeit | Abnahme |
| --- | --- | --- |
| P0 Betreiber und Vertragsmodell | Name, Anschrift, Staat, Kontakte, Zielgruppe, Preise und Länder ergänzen | Identität stimmt mit Anbieter-/Apple-Angaben überein; offene Felder sind ausgefüllt |
| P0 Öffentliche Rechtstexte | Entwürfe prüfen lassen; danach zugängliche HTTPS-Seiten veröffentlichen und in Anmeldung/Einstellungen verlinken | Ohne Login auf iPhone erreichbar; keine Platzhalter; dauerhaft lesbar |
| P0 AGB-Einbeziehung | Aktuell keine Umsetzung gefunden. Finale Fassung vor Kontoabschluss zugänglich machen, Zustimmung/Version passend dokumentieren | Registrierung zeigt Bedingungen rechtzeitig; keine mit Marketing/Datenschutz vermischte Einwilligung; bestehende Nutzer gesondert behandeln |
| P0 Missbrauchsschutz | Melden, serverseitiges Blockieren, Inhaltsschutz und Bearbeitungsweg fehlen | Mit zwei Konten Eingriff nachweisbar; Zuständiger erhält und bearbeitet Meldung; Rückfrage/Beschwerde möglich |
| P0 Löschkonzept | Team-Freitexte, Kopien, Dateiobjekte, lokale Entwürfe, Logs und Backups noch nicht vollständig abgedeckt | Dateninventar und implementierte Löschung stimmen überein; kein vermeidbares Hindernis zur Kontolöschung |
| P0 Löschhinweis in App | Aktuell zu weitgehend „persönliche Daten werden dauerhaft gelöscht“; kein Hinweis auf verbleibende Team-Inhalte | Verständlich vor Bestätigung; keine unwahre Sofortlösch-/Anonymisierungsgarantie |
| P0 Lokale Entwürfe | Konto-Schlüssel trennen Nutzer, löschen aber alte Einträge nicht automatisch | Abmeldung/Kontolöschung bereinigt Entwürfe und Wiederholungsdaten; Kontowechsel kann fremde Daten nicht anzeigen; Ablauf-/Löschoption dokumentiert |
| P0 Dienstleister und Datenschutz | AVV/DPA, SMTP, Unterauftragnehmer, Log-/Backupfristen und Drittlandzugriffe klären | Nachweis im internen Verzeichnis; öffentliche Erklärung und Apple-Label entsprechen Betrieb |
| P0 Apple-Konto | Zuletzt kostenloses Personal Team; heutige Mitgliedschaft unbekannt | Aktive passende Developer-Program-Mitgliedschaft, Vertragsannahmen durch Account Holder; keine Buchung durch diesen Schritt |
| P0 Review-Zugang | Noch kein eigens bestätigtes Review-/Löschkonto | Synthetische Daten, geprüfte Zugänge, erreichbarer Ansprechpartner |
| P1 Native Veröffentlichung | Unsigned CI vorhanden; signiertes Release-Archiv fehlt | Aktuelle Xcode-/SDK-Vorgaben, Signierung, Version/Build, Organizer-Validierung bestanden |
| P1 Store-Angaben | Textentwurf und Datenmatrix vorhanden | Rechte am Namen/Symbol, Kategorien, Altersfragebogen, Preis, Länder, EU-Händlerstatus bestätigt |
| P1 Screenshots | Motive/Texte vorbereitet, Aufnahmen fehlen | Echte iPhone- und iPad-Bilder passen zum finalen Build |
| P1 Privacy-Report / Export | SDK-Manifeste teilweise geprüft, abschließende Archivprüfung offen | APIs/SDKs, Datenschutzlabel und Exportantworten korrekt dokumentiert |
| P1 Geräteabnahme | Frühere Teilfunktionen vom Nutzer bestätigt | Liste in review-notes.md mit endgültigem Build auf iPhone/iPad abschließen |

P0/P1 sind unsere Arbeitsprioritäten, keine von Apple vergebenen Bewertungen. Diese Liste umfasst die im Audit erkannten Veröffentlichungshindernisse; sie ist keine Garantie einer Zulassung.

## Rechtstexte später veröffentlichen

Vorgeschlagene Pfade sind `/rechtliches/datenschutz`, `/rechtliches/nutzungsbedingungen`, `/rechtliches/impressum` und `/support`. Diese Pfade sind **noch nicht implementiert**. Bei GitHub Pages das Projekt-Unterverzeichnis und den tatsächlichen Router berücksichtigen; Direktaufrufe dürfen nicht auf 404 enden. Keinen ungeschützten Review-Zugang veröffentlichen.

Nach juristischer Freigabe Rechtstexte auch im App-Bundle lesbar halten, Version/Datum anzeigen und die identische öffentliche Fassung verlinken. Datenschutzhinweise sind eine Information; sie ersetzen keine erforderliche gesonderte Einwilligung. Ein Cookiebanner ist nicht automatisch für jede technisch notwendige Speicherung nötig. Den automatisch angelegten Offline-Cache und Entwurfsspeicher hinsichtlich Zweck, Erforderlichkeit und gegebenenfalls Wahlmöglichkeit nach § 25 TDDDG konkret prüfen.

## Technische Aufnahme in App Store Connect

1. Betreiber vervollständigt Mitgliedschaft und Anbieter-/Händlerangaben. Die kostenlose Installation über Xcode allein berechtigt nicht zur Store-Verteilung.
2. App-Eintrag mit bestehender Bundle-ID anlegen; neue Bundle-ID nicht nur wegen des Anzeigenamens erfinden. SKU intern festlegen.
3. Buildnummer pro Upload erhöhen, Release-Archiv erstellen, Datenschutzbericht und Archiv validieren. Mindestziel im Projekt ist iOS 15; aktuelle Uploadvorgaben am Tag des Uploads erneut prüfen.
4. Angaben aus Metadaten und geprüfter Datenschutzmatrix übertragen; Altersfragen ehrlich beantworten. Mac-/Vision-Verfügbarkeit separat prüfen statt ungeprüft aktiv lassen.
5. Screenshots und private Prüferzugänge ergänzen; keine echten Kundendaten hochladen.
6. Nach bestandener Geräteabnahme kann der Betreiber den vollständig ausgefüllten Entwurf prüfen und zur Einreichung freigeben. In diesem Arbeitsschritt wurde nichts hochgeladen, kein Vertrag akzeptiert und nichts veröffentlicht.

## Betriebsaufgaben vor öffentlicher Nutzung

- Erreichbares Support-/Datenschutzpostfach mit verantwortlicher Person betreiben; Anfragen und gesetzliche Fristen nachhalten.
- Moderationsverfahren für Meldung, begrenzte Beweissicherung, Entscheidung, Information und Überprüfung einrichten. Keine pauschale laufende Einsicht in private Chats versprechen.
- Rollenverteilung mit Workspace-Betreibern, AV-Verträge und technische/organisatorische Maßnahmen dokumentieren. Verbraucherrecht, Barrierefreiheit und die Einordnung als Kommunikationsdienst bzw. Vermittlungsdienst für das tatsächliche Angebot rechtlich prüfen.
- Logs/Backups mit konkreten Fristen, zweckgebundener Aufbewahrung und Löschkontrollen betreiben. Eine Frist im Text ersetzt keinen Löschjob.
- Wiederherstellung und Zugriffsschutz testen; keinen unbelegten Dienstverfügbarkeitswert oder „100 % sicher“ versprechen.

## Prüfung dieses Vorbereitungspakets

Dieses Paket verändert ausschließlich Dokumentation. Metadatenlängen, UTF-8-Keywordbudget, Dateilinks, Bundle-ID/Version sowie PNG-Größe/Farbmodus werden lokal geprüft. Eine erneute vollständige Funktionsprüfung der App nur wegen dieser Dokumente ist nicht erforderlich. Frühere Tests bestätigen keine neuen Moderations-/Rechtstextfunktionen: Diese sind noch zu bauen.
