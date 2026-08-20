# GlucoseCoach

GlucoseCoach ist eine statische Web-App zur persönlichen retrospektiven Auswertung von CGM-, Bolus- und Mahlzeitendaten. Die Datenerfassung kann vollständig in Glooko bleiben: GlucoseCoach importiert den Glooko-Webexport und übernimmt nur Deutung und Auswertung.

## Glooko als zentrale Datenerfassung

Der bevorzugte Ablauf ist:

1. Gerätewerte, Insulin und Essen in Glooko erfassen bzw. synchronisieren.
2. Im Glooko-Webkonto den gewünschten Zeitraum als ZIP exportieren.
3. Das ZIP in GlucoseCoach ablegen.
4. In GlucoseCoach als Mahlzeitenquelle **Glooko-Lebensmitteleinträge** verwenden.

Der Import verarbeitet die CSV-Dateien auch aus Unterordnern des ZIP. `food_data_*.csv` und – falls kein benannter Lebensmitteleintrag vorhanden ist – `cgm_carbs_data_*.csv` werden als schreibgeschützte Mahlzeitenanker verwendet. Mehrere Lebensmittel mit demselben Zeitstempel werden zu einer Mahlzeit zusammengefasst. CGM- und Bolusdaten werden danach mit denselben retrospektiven Regeln wie bei lokalen Tagebucheinträgen verknüpft.

Das lokale GlucoseCoach-Tagebuch bleibt als Übergangs- und Fallbackmodus erhalten. In einem frischen Browser wird Glooko automatisch als Mahlzeitenquelle gewählt, sobald ein Export mit Lebensmitteln oder Kohlenhydraten importiert wurde. Existieren bereits lokale Mahlzeiten, kann die Quelle im Reiter **Tagebuch** umgeschaltet werden.

Eine offizielle direkte Glooko-Kontosynchronisation ist für individuelle Nutzerkonten nicht verfügbar. Glooko stellt die Direct API nur im Rahmen einer Geschäftsbeziehung mit zugewiesenem API-Schlüssel bereit. Deshalb enthält die öffentliche GitHub-Pages-App bewusst weder Glooko-Zugangsdaten noch inoffizielles Login-Scraping. Die technische Abgrenzung für einen späteren offiziellen API-Adapter steht in [`GLOOKO_INTEGRATION.md`](GLOOKO_INTEGRATION.md).

## Speichermodell

Die öffentliche Website enthält **keinen vorbefüllten Patientendatensatz**. Ein neuer Browser startet leer. Persönliche Daten werden erst durch den jeweiligen Nutzer importiert oder eingetragen und ausschließlich in `localStorage` der Website gespeichert.

Damit gilt:

- jeder Browser besitzt einen eigenen lokalen Datenbestand;
- CSV- und ZIP-Dateien werden im Browser verarbeitet und nicht zum Hosting-Server hochgeladen;
- wiederholte Importe werden anhand der normalisierten Datensätze dedupliziert;
- der vollständige lokale Bestand kann als CSV-ZIP exportiert und auf einem anderen Gerät wieder importiert werden;
- sämtliche Kennzahlen und Empfehlungen werden aus dem persönlichen lokalen Datenbestand neu berechnet.

Die App hat derzeit keine Benutzerkonten und keine Cloud-Synchronisation. Für mehrere Geräte wird der CSV-ZIP-Export verwendet. Er enthält zwölf einzelne, wieder importierbare Glooko-/Omnipod-/CGM-Dateien mit den unterstützten Dateinamen und Spalten sowie `glucosecoach_data_1.csv` für lokales Tagebuch, Profileinstellungen und Importhistorie. Klinische Daten werden in der Begleitdatei nicht nochmals dupliziert.

## Funktionen

- nativer Glooko-ZIP-Import einschließlich Geräte-, Insulin-, Lebensmittel-, Kohlenhydrat-, Sport-, Medikamenten- und Notizdateien
- wählbare Mahlzeitenquelle: schreibgeschützte Glooko-Einträge oder lokales GlucoseCoach-Tagebuch
- CGM-Kennzahlen für 7, 14, 30, 90 Tage oder den gesamten lokalen Bestand
- Bereichszeiten, Mittelwert, GMI-Schätzung und Variationskoeffizient
- Zeitfenster mit relativ häufigeren hohen oder niedrigen Messwerten
- lokale Zuordnung von Mahlzeiten zu CGM- und Bolusereignissen
- Ausgangswert, nachhaltiger Anstieg, Peak, Zwei-Stunden-Wert und CGM-Kurvenwendepunkt-Proxy
- Vergleiche wiederholt dokumentierter Mahlzeiten
- Import einzelner CSV-Dateien oder kompletter ZIP-Archive per Dateiauswahl und Drag-and-drop
- CSV-ZIP-Export mit zwölf importkompatiblen Datendateien und einer nicht redundanten GlucoseCoach-Begleitdatei

## GitHub Pages

Die veröffentlichte App liegt unter `docs/`. GitHub Pages liefert `main` + `/docs` aus.

## Tests

Die schnellen Vertrags- und Logiktests liegen unter `tests/`. Zusätzlich gibt es eine Playwright-E2E-Suite unter `e2e/`.

Die E2E-Suite erzeugt für mehrere feste Seeds synthetische, aber physiologisch plausible CGM-Verläufe sowie alle zwölf unterstützten Datentypen. Sie trägt lokale Fallback-Tagebucheinträge über das echte Browserformular ein, importiert die CSV-Dateien über den echten File-Input und prüft anschließend alle Bereiche. Ein eigener Browservertrag importiert zusätzlich einen nativen Glooko-ZIP mit Unterordnern, mehreren Lebensmitteln pro Mahlzeit und leerem lokalem Tagebuch. Er weist nach, dass der lokale Speicher leer bleibt, Glooko automatisch Mahlzeitenquelle wird und die Mahlzeit vollständig in die CGM-/Bolusanalyse eingeht.

Zusätzliche Roundtrip-Tests prüfen die exakten CSV-Dateinamen und Kopfzeilen, den ZIP-Download, den Import aus einem zuvor geleerten Browser sowie beide Eingabewege: Dateiauswahl und Drag-and-drop.

Lokal:

```bash
npm install
npx playwright install chromium
npm run test:e2e
```

In GitHub Actions läuft die Suite mit Chromium und einem Worker, damit die seeded Zufallsszenarien reproduzierbar bleiben.

## Medizinische Grenze

GlucoseCoach ist retrospektive Entscheidungsunterstützung. Die App berechnet keine Insulindosen, Basalraten, Kohlenhydrat- oder Korrekturfaktoren und gibt keine Akutanweisungen. Ein aus dem CGM-Verlauf erkannter Kurvenwendepunkt ist kein direkter Nachweis des pharmakologischen Wirkeintritts von Insulin.
