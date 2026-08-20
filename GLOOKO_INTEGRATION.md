# Glooko-Integration

## Zielbild

Glooko ist eine zusätzliche Erfassungs- und Geräteplattform. Die bestehende tägliche Eingabe im GlucoseCoach-Tagebuch bleibt unabhängig davon vollständig nutzbar. Importierte Glooko-Mahlzeiten werden schreibgeschützt ergänzt; lokale und importierte Einträge fließen gemeinsam in die retrospektive Verknüpfung, Deutung und Auswertung ein.

## Heute unterstützt: nativer Webexport

Ein Glooko-Webexport wird als ZIP direkt im Browser entpackt. Unterordner werden rekursiv berücksichtigt. Die bereits unterstützten Glooko-Dateien umfassen insbesondere:

- `cgm_data_*.csv`
- `bolus_data_*.csv`
- `insulin_data_*.csv`
- `basal_data_*.csv`
- `bg_data_*.csv`
- `alarms_data_*.csv`
- `cgm_carbs_data_*.csv`
- `exercise_data_*.csv`
- `food_data_*.csv`
- `manual_insulin_data_*.csv`
- `medication_data_*.csv`
- `notes_data_*.csv`

`food_data_*` ist die bevorzugte Quelle für importierte Glooko-Mahlzeiten. Zeilen mit demselben Zeitstempel werden zu einer Mahlzeit aggregiert. Ein naher `cgm_carbs_data_*`-Eintrag ergänzt fehlende Kohlenhydrate, wird aber nicht doppelt addiert, wenn `food_data_*` bereits eine Kohlenhydratmenge enthält. Reine Kohlenhydratereignisse ohne Lebensmittelbezeichnung werden als **Glooko-Kohlenhydrate** analysiert.

Importierte Mahlzeiten sind schreibgeschützt. Korrekturen erfolgen in Glooko und werden mit dem nächsten Export übernommen. Wiederholte Importe sind dedupliziert. Das lokale Formular wird nicht ausgeblendet. Zeitlich und inhaltlich passende Mahlzeiten aus beiden Quellen werden für die Analyse als derselbe Vorgang behandelt, damit ein parallel erfasster Eintrag nicht doppelt in Gruppenmittel, Peaks oder Empfehlungen eingeht.

## Direkte Synchronisation

Die offizielle Glooko Direct API verlangt eine Geschäftsbeziehung, einen zugewiesenen Integration Manager und einen API-Schlüssel. Individuelle Nutzerkonten erhalten laut Glooko keine Direct-API-Zugangsdaten. Die statische GitHub-Pages-App implementiert deshalb kein inoffizielles Login, Session-Cookie-Replay oder Screen-Scraping.

Ein späterer offizieller Adapter soll außerhalb der statischen Seite laufen und diese Grenzen einhalten:

1. Zugangsdaten und API-Schlüssel ausschließlich serverseitig verwalten.
2. Nur ausdrücklich freigegebene Patienten-/Nutzerdaten abrufen.
3. Die API-Antwort in dasselbe interne klinische Schema normalisieren wie der CSV-/ZIP-Importer.
4. Synchronisationsmetadaten getrennt von medizinischen Daten behandeln.
5. Die vorhandenen Deduplizierungs-, Qualitäts- und E2E-Verträge unverändert anwenden.
6. Keine Dosis-, Basal- oder Pumpenparameter automatisch verändern.

Offizielle Referenzen:

- Glooko CSV export: https://support.glooko.com/hc/en-us/articles/4460340377875-How-can-I-export-my-diabetes-data-from-Glooko
- Glooko developer portal: https://developers.glooko.com/docs/directintegrations
