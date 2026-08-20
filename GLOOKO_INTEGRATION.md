# Glooko-Integration

## Ausgangslage

Die vor PR #18 vorhandene CSV-/ZIP-Schnittstelle verarbeitet bereits den Export aus der Glooko-Webanwendung. Die Bezeichnung „Omnipod-Export“ war missverständlich: Omnipod- und andere Gerätewerte gelangen über Glooko in denselben Glooko-Export. PR #18 hat deshalb keinen zweiten Importpfad und keinen neu geratenen CSV-Parser hinzugefügt.

Der zusätzliche Funktionsumfang von PR #18 beginnt erst **nach** dem Import: Bereits normalisierte Glooko-Lebensmittel- und Kohlenhydratereignisse werden in eine Form überführt, welche die bestehende GlucoseCoach-Mahlzeitenanalyse verwenden kann. Die tägliche Eingabe im GlucoseCoach-Tagebuch bleibt unabhängig davon vollständig nutzbar. Importierte Glooko-Mahlzeiten werden schreibgeschützt ergänzt; lokale und importierte Einträge fließen gemeinsam in die retrospektive Verknüpfung, Deutung und Auswertung ein.

## Bereits vorhandener Glooko-Webexport

Ein Glooko-Webexport wird als ZIP direkt im Browser entpackt. Unterordner werden rekursiv berücksichtigt. Die unterstützten Glooko-Dateien umfassen insbesondere:

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

Die Importer erkennen diese Dateien anhand der vorhandenen Dateinamen und Kopfzeilen und speichern ihre normalisierten Zeilen im klinischen Browserbestand. Dieser Teil bestand bereits vor PR #18.

## Zusätzliche Mahlzeitennutzung seit PR #18

`food_data_*` ist die bevorzugte Quelle für benannte importierte Glooko-Mahlzeiten. Zeilen mit demselben Zeitstempel werden zu einer Mahlzeit aggregiert. Ein naher `cgm_carbs_data_*`-Eintrag ergänzt fehlende Kohlenhydrate, wird aber nicht doppelt addiert, wenn `food_data_*` bereits eine Kohlenhydratmenge enthält. Reine Kohlenhydratereignisse ohne Lebensmittelbezeichnung werden derzeit als **Glooko-Kohlenhydrate** analysiert.

Die daraus erzeugten Mahlzeiteneinträge werden nicht zusätzlich in `glucosecoach-diary-v1` gespeichert. Sie werden beim Rendern aus dem klinischen Glooko-Bestand abgeleitet, für die Analyse vorübergehend mit den lokalen Tagebucheinträgen kombiniert und danach wieder aus dem veränderbaren Tagebuchzustand entfernt. Dadurch entstehen keine zweiten klinischen CSV-Zeilen und keine dauerhafte Kopie derselben Glooko-Mahlzeit im lokalen Tagebuch.

Importierte Mahlzeiten sind schreibgeschützt. Korrekturen erfolgen in Glooko und werden mit dem nächsten Export übernommen. Wiederholte Importe sind auf Ebene der normalisierten Ursprungszeilen dedupliziert. Das lokale Formular wird nicht ausgeblendet.

## Explizite Heuristiken

Der Glooko-Export liefert nicht alle Felder, welche das bestehende GlucoseCoach-Tagebuch verwendet. Deshalb sind folgende Zuordnungen abgeleitet und keine direkt aus Glooko gelesenen Tatsachen:

- Die Mahlzeitenart wird aus der lokalen Uhrzeit geschätzt: 05:00–10:59 Uhr Frühstück, 11:00–14:59 Uhr Mittagessen, 15:00–21:59 Uhr Abendessen, sonst Snack.
- Mehrere `food_data_*`-Zeilen werden nur dann sicher als eine Mahlzeit aggregiert, wenn sie denselben Zeitstempel besitzen.
- Ein `cgm_carbs_data_*`-Ereignis wird einem benannten Lebensmitteleintrag zugeordnet, wenn es höchstens zehn Minuten entfernt liegt.
- Ein lokaler und ein importierter Eintrag gelten als dasselbe Ereignis, wenn sie höchstens zwei Minuten auseinanderliegen. Bei bis zu zehn Minuten Abstand ist zusätzlich derselbe normalisierte Lebensmitteltext oder eine Kohlenhydratabweichung von höchstens einem Gramm erforderlich.

Diese Regeln verhindern typische Doppelzählungen und ermöglichen die Nutzung der bereits vorhandenen Glooko-Daten in der bestehenden Analyse. Sie sind jedoch von der tatsächlichen Glooko-Dateistruktur zu unterscheiden und können später anhand realer Exportbeispiele enger gefasst werden.

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
