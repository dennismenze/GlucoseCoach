# GlucoseCoach

GlucoseCoach ist eine statische Web-App zur persönlichen retrospektiven Auswertung von CGM-, Bolus- und Tagebuchdaten.

## Speichermodell

Die öffentliche Website enthält **keinen vorbefüllten Patientendatensatz**. Ein neuer Browser startet leer. Persönliche Daten werden erst durch den jeweiligen Nutzer importiert oder eingetragen und ausschließlich in `localStorage` der Website gespeichert.

Damit gilt:

- jeder Browser besitzt einen eigenen lokalen Datenbestand;
- CSV-Dateien werden im Browser verarbeitet und nicht zum Hosting-Server hochgeladen;
- wiederholte Exporte werden nach Zeitstempel dedupliziert;
- Tagebuch, CGM- und Bolusdaten können als JSON-Gesamtsicherung exportiert und auf einem anderen Gerät wieder importiert werden;
- sämtliche Kennzahlen und Empfehlungen werden aus dem persönlichen lokalen Datenbestand neu berechnet.

Die App hat derzeit keine Benutzerkonten und keine Cloud-Synchronisation. Für mehrere Geräte wird die JSON-Sicherung verwendet.

## Funktionen

- CGM-Kennzahlen für 7, 14, 30, 90 Tage oder den gesamten lokalen Bestand
- Bereichszeiten, Mittelwert, GMI-Schätzung und Variationskoeffizient
- Zeitfenster mit relativ häufigeren hohen oder niedrigen Messwerten
- Tagebuch für Mahlzeiten, Makronährstoffe, Aktivität, Schlaf, Krankheit und Stress
- lokale Zuordnung von Mahlzeiten zu CGM- und Bolusereignissen
- Ausgangswert, nachhaltiger Anstieg, Peak, Zwei-Stunden-Wert und CGM-Kurvenwendepunkt-Proxy
- Vergleiche wiederholt dokumentierter Mahlzeiten
- JSON-Backup sowie wiederholbarer Import des vollständigen Omnipod-CSV-Exports

## GitHub Pages

Die veröffentlichte App liegt unter `docs/`. GitHub Pages liefert `main` + `/docs` aus.

## Tests

Die schnellen Vertrags- und Logiktests liegen unter `tests/`. Zusätzlich gibt es eine Playwright-E2E-Suite unter `e2e/`.

Die E2E-Suite erzeugt für mehrere feste Seeds synthetische, aber physiologisch plausible CGM-Verläufe sowie alle zwölf unterstützten Omnipod-Datentypen. Sie trägt Tagebucheinträge über das echte Browserformular ein, importiert 13 CSV-Dateien über den echten File-Input und prüft anschließend alle sechs Tabs. Für 7, 14, 30 und 90 Tage sowie den Gesamtbestand werden sämtliche dargestellten dynamischen Zahlen gegen einen vom Rendering unabhängigen Oracle-Code abgeglichen. Dazu gehören Kennzahlen, Bereichszeiten, Datenbestandszähler, Empfehlungen, jede Zahl jeder Mahlzeitenkurve, Gruppenvergleiche, Krankheitsgruppen und Datenqualitätswerte.

Lokal:

```bash
npm install
npx playwright install chromium
npm run test:e2e
```

In GitHub Actions läuft die Suite mit Chromium und einem Worker, damit die seeded Zufallsszenarien reproduzierbar bleiben.

## Medizinische Grenze

GlucoseCoach ist retrospektive Entscheidungsunterstützung. Die App berechnet keine Insulindosen, Basalraten, Kohlenhydrat- oder Korrekturfaktoren und gibt keine Akutanweisungen. Ein aus dem CGM-Verlauf erkannter Kurvenwendepunkt ist kein direkter Nachweis des pharmakologischen Wirkeintritts von Insulin.
