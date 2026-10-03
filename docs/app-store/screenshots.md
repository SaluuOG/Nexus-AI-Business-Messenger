# Screenshot-Paket: Aufnahmeplan und Bildtexte

Vorbereitet sind Motive und Texte. **Es liegen noch keine freigegebenen nativen Store-Screenshots vor.** Frühere Nutzerfotos und Bildschirmaufnahmen enthalten echte Namen oder Fehlerzustände und werden nicht als Werbematerial verwendet. Keine erfundenen Bildschirmfunktionen darstellen.

## Motive in dieser Reihenfolge

| Datei | Bildtext | Was in der echten App sichtbar sein soll |
| --- | --- | --- |
| `01-briefing.png` | Dein Arbeitstag. Auf einen Blick. | Briefing mit offenen Aufgaben und Projektterminen |
| `02-chat.png` | Im Gespräch bleiben. | Einzelchat mit Antwortbezug und einer Emoji-Reaktion |
| `03-aufgabe.png` | Vom Gespräch zur Aufgabe. | Projektaufgabe mit Termin, Verantwortlichem und Checkliste |
| `04-projekte.png` | Gemeinsam Projekte organisieren. | Projektübersicht eines Test-Workspaces mit zwei Projekten |
| `05-wiedervorlagen.png` | Wichtiges später wieder aufgreifen. | Persönliche Wiedervorlagen im Briefing, mit fälligem Eintrag |
| `06-offline.png` | Gespeicherte Texte unterwegs lesen. | Zuvor geladener Chat ohne Internet mit sichtbarem Offline-Hinweis |

Die Bildtexte sind optional. Zunächst unveränderte Screenshots der echten App aufnehmen. Beim späteren Layout darf die Oberfläche nicht verändert und ein Hinweis auf eingeschränkten Offline-Umfang nicht verdeckt werden. Keine Garantie von Push-Zustellung durch Glocken-/Alarm-Werbung suggerieren.

## Einheitliche synthetische Daten

- Workspace: „Nexus Demo-Team“; Konten: „Alex Beispiel“ und „Mira Muster“. E-Mail-Adressen nur in eigenen Testkonten; keine erfundene fremde Adresse anschreiben.
- Kunde: „Studio Beispiel“; Projekte: „Website-Relaunch“ und „Team-Workshop“.
- Nachricht: „Bitte prüfe den Entwurf bis morgen.“ Antwort: „Ich ergänze heute die Checkliste.“
- Aufgabe: „Startseite abstimmen“; Checkliste: „Text prüfen“, „Bildauswahl bestätigen“, „Freigabe festhalten“.
- Fälligkeiten relativ zum Aufnahmetag setzen. Keine über Monate veralteten Demo-Termine als aktuelle Arbeitsansicht verwenden.
- Der für Apple vorgesehene Demo-Zugang hat ausschließlich solche Daten und keinen Zugang zu echten Workspaces.

## Aufnahme auf dem Mac

1. Release-Kandidaten in Xcode öffnen. Einen passenden iPhone-Simulator auswählen und den Build starten.
2. Mit einem vorbereiteten Testkonto anmelden und die Motive einzeln öffnen. In der Simulator-Menüleiste „File → Save Screen“ verwenden; falls die Bezeichnung abweicht, die Screenshot-Aktion im File-Menü wählen.
3. Jedes Motiv als PNG in Originalauflösung speichern. Keine Statusmeldungen, Tastaturreste, echten Telefonnummern, Kennwörter oder Reset-Links im Bild.
4. Weil das Projekt aktuell iPad unterstützt (`TARGETED_DEVICE_FAMILY = 1,2`), dieselben Motive auf einem 13-Zoll-iPad-Simulator aufnehmen. iPhone-Aufnahmen nicht auf iPad-Breite strecken.
5. Vor Verwendung des Offline-Motivs Textnachrichten online laden, die Internetverbindung des Testgeräts trennen und die gespeicherte Ansicht öffnen. Simulationsverfahren und Aufnahme mit dem echten Verhalten auf dem iPhone vergleichen.

## Zielformate

- iPhone: beispielsweise **1320 × 2868 px**, Hochformat, für die 6,9-Zoll-Gruppe. Apple akzeptiert dort auch 1260 × 2736 und 1290 × 2796.
- iPad: beispielsweise **2064 × 2752 px**, Hochformat, für die 13-Zoll-Gruppe; alternativ 2048 × 2732.
- Natives App-Symbol ist bereits 1024 × 1024 px, RGB ohne Alpha. Datei: `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png`; der Dateiname ändert die tatsächliche Größe nicht.
- Vor Upload die dann geltenden Slots prüfen: [Apple Screenshot Specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications).

## Abnahme in Stichpunkten

- Jede Aufnahme bei voller Größe ansehen: Text ist lesbar, nichts abgeschnitten, keine Testfehler eingeblendet.
- Je ein iPhone- und iPad-Motiv mit dem Release-Build vergleichen: identische Funktionen, keine veralteten Menüs.
- Alle Namen, Nachrichten und Dateinamen auf synthetische Daten prüfen.
- Offline-Bild zeigt den letzten gespeicherten Stand; es erweckt nicht den Eindruck, neue Nachrichten offline zu empfangen.
