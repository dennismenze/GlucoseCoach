# MVP-Status

Stand: 18. August 2026

## Öffentlich ausgelieferte App

- statische GitHub-Pages-App unter `docs/`
- kein eingebauter oder vorbefüllter Patientendatensatz
- neuer Browser startet ohne CGM-, Bolus- oder Tagebuchwerte
- lokaler CSV-Import und lokale Neuberechnung
- Tagebuch bleibt im jeweiligen Browser gespeichert
- JSON-Gesamtsicherung für Gerätewechsel
- Mahlzeitenanalyse und persönliche, regelbasierte Beobachtungen

## Speichermodell

Persönliche Daten liegen ausschließlich in `localStorage` der Website-Origin. Die öffentliche Repository-Version enthält keine individuellen Messwerte oder daraus berechneten persönlichen Statistiken im aktuellen Stand.

## Medizinische Grenze

Keine Diagnose, keine automatische Insulindosierung und keine Änderung von Pumpeneinstellungen.
