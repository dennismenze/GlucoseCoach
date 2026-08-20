# GlucoseCoach

GlucoseCoach ist eine statische Web-App zur persönlichen retrospektiven Auswertung von CGM-, Bolus- und Tagebuchdaten.

## Speichermodell

Die öffentliche Website enthält **keinen vorbefüllten Patientendatensatz**. Ein neuer Browser startet leer. Persönliche Daten werden erst durch den jeweiligen Nutzer importiert oder eingetragen und ausschließlich in `localStorage` der Website gespeichert.

Damit gilt:

- jeder Browser besitzt einen eigenen lokalen Datenbestand;
- CSV- und ZIP-Dateien werden im Browser verarbeitet und nicht zum Hosting-Server hochgeladen;
- wiederholte Importe werden anhand der normalisierten Datensätze dedupliziert;
- der vollständige lokale Bestand kann als CSV-ZIP exportiert und auf einem anderen Gerät wieder importiert werden;
- sämtliche Kennzahlen und Empfehlungen werden aus dem persönlichen lokalen Datenbestand neu berechnet.

Die App hat derzeit keine Benutzerkonten und keine Cloud-Synchronisation. Für mehrere Geräte wird der CSV-ZIP-Export verwendet. Er enthält zwölf einzelne, wieder importierbare Omnipod-/CGM-Dateien mit den unterstützten Dateinamen und Spalten sowie `glucosecoach_data_1.csv` für Tagebuch, Profileinstellungen und Importhistorie. Klinische Daten werden in der Begleitdatei nicht nochmals dupliziert.

## Funktionen

- CGM-Kennzahlen für 7, 14, 30, 90 Tage oder den gesamten lokalen Bestand
- Bereichszeiten, Mittelwert, GMI-Schätzung und Variationskoeffizient
- Zeitfenster mit relativ häufigeren hohen oder niedrigen Messwerten
- Tagebuch für Mahlzeiten, Makronährstoffe, Aktivität, Schlaf, Krankheit und Stress
- lokale Zuordnung von Mahlzeiten zu CGM- und Bolusereignissen
- Ausgangswert, nachhaltiger Anstieg, Peak, Zwei-Stunden-Wert und CGM-Kurvenwendepunkt-Proxy
- Vergleiche wiederholt dokumentierter Mahlzeiten
- Import einzelner CSV-Dateien oder kompletter ZIP-Archive per Dateiauswahl und Drag-and-drop
- CSV-ZIP-Export mit zwölf importkompatiblen Datendateien und einer nicht redundanten GlucoseCoach-Begleitdatei

## GitHub Pages

Die veröffentlichte App liegt unter `docs/`. GitHub Pages liefert `main` + `/docs` aus.

## Tests

Die schnellen Vertrags- und Logiktests liegen unter `tests/`. Zusätzlich gibt es eine Playwright-E2E-Suite unter `e2e/`.

Die E2E-Suite erzeugt für mehrere feste Seeds synthetische, aber physiologisch plausible CGM-Verläufe sowie alle zwölf unterstützten Omnipod-Datentypen. Sie trägt Tagebucheinträge über das echte Browserformular ein, importiert die CSV-Dateien über den echten File-Input und prüft anschließend alle sechs Tabs. Für 7, 14, 30 und 90 Tage sowie den Gesamtbestand werden sämtliche dargestellten dynamischen Zahlen gegen einen vom Rendering unabhängigen Oracle-Code abgeglichen. Dazu gehören Kennzahlen, Bereichszeiten, Datenbestandszähler, Empfehlungen, jede Zahl jeder Mahlzeitenkurve, Gruppenvergleiche, Krankheitsgruppen und Datenqualitätswerte.

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
