    function filterCgmWindow(cgmRows, windowDays = 'all') {
      if (!cgmRows.length || windowDays === 'all') return cgmRows;
      const days = Number(windowDays);
      const end = cgmRows[cgmRows.length - 1][0];
      const start = end - days * 24 * 60;
      return cgmRows.filter((row) => row[0] >= start);
    }

    function hourlyMetrics(cgmRows) {
      const buckets = Array.from({ length: 24 }, () => []);
      for (const row of cgmRows) buckets[new Date(row[0] * MINUTE).getHours()].push(row);
      return buckets.map((rows, hour) => ({ hour, ...calculateMetrics(rows) })).filter((item) => item.samples);
    }

    function lowerBound(rows, minute) {
      let low = 0;
      let high = rows.length;
      while (low < high) {
        const middle = (low + high) >> 1;
        if (rows[middle][0] < minute) low = middle + 1;
        else high = middle;
      }
      return low;
    }

    function rowsBetween(rows, start, end) {
      const from = lowerBound(rows, start);
      const result = [];
      for (let index = from; index < rows.length && rows[index][0] <= end; index += 1) result.push(rows[index]);
      return result;
    }

    function diaryMinute(entry) {
      return parseDateTime(entry.when ?? entry.timestamp);
    }

    function normalizeFood(value) {
      return String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase('de-DE').replace(/[\s,;]+/g, ' ').replace(/\s+/g, ' ');
    }

    function closestExact(rows, target, toleranceMinutes) {
      let best = null;
      for (const row of rows) {
        if (row[1] === null) continue;
        const distance = Math.abs(row[0] - target);
        if (distance <= toleranceMinutes && (!best || distance < best.distance)) best = { row, distance };
      }
      return best?.row ?? null;
    }

    function findSustainedRise(postRows, baseline) {
      const exact = postRows.filter((row) => row[1] !== null);
      for (let index = 0; index <= exact.length - 3; index += 1) {
        const first = exact[index];
        const next = exact[index + 1];
        const third = exact[index + 2];
        if (first[1] >= baseline + 5 && next[1] >= baseline + 3 && third[1] >= baseline + 3 && third[1] >= first[1] - 3) return first[0];
      }
      return null;
    }

    function findCurveTurn(postRows, baseline, bolusMinute, riseMinute) {
      if (bolusMinute === null || riseMinute === null) return null;
      const exact = postRows.filter((row) => row[1] !== null && row[0] >= Math.max(bolusMinute + 10, riseMinute));
      for (let index = 0; index <= exact.length - 3; index += 1) {
        const first = exact[index];
        const second = exact[index + 1];
        const third = exact[index + 2];
        const hadRise = first[1] >= baseline + 5;
        const sustainedNonRise = second[1] <= first[1] + 1 && third[1] <= second[1] + 1;
        const meaningfulTurn = third[1] <= first[1] - 5;
        if (hadRise && sustainedNonRise && meaningfulTurn) return first[0];
      }
      return null;
    }

    function matchBolus(entryMinute, boluses) {
      const candidates = boluses.filter((row) => row[0] >= entryMinute - 60 && row[0] <= entryMinute + 30 && Number(row[2]) > 0);
      if (!candidates.length) return null;
      return candidates.sort((a, b) => Math.abs(a[0] - entryMinute) - Math.abs(b[0] - entryMinute))[0];
    }

    function mealIsolation(entry, sortedMeals) {
      const minute = diaryMinute(entry);
      const index = sortedMeals.findIndex((item) => item.id === entry.id);
      const previous = index > 0 ? diaryMinute(sortedMeals[index - 1]) : null;
      const next = index >= 0 && index < sortedMeals.length - 1 ? diaryMinute(sortedMeals[index + 1]) : null;
      return {
        previousMinutes: previous === null ? null : minute - previous,
        nextMinutes: next === null ? null : next - minute,
        isolated: (previous === null || minute - previous >= 120) && (next === null || next - minute >= 180),
      };
    }

    function analyzeMealEntry(entry, cgmRows, boluses, allDiary) {
      const minute = diaryMinute(entry);
      if (minute === null) return { entry, status: 'invalid-time', complete: false };
      const sortedMeals = allDiary.filter((item) => MEAL_TYPES.has(item.occasion)).sort((a, b) => diaryMinute(a) - diaryMinute(b));
      const isolation = mealIsolation(entry, sortedMeals);
      const windowRows = rowsBetween(cgmRows, minute - 15, minute + 180);
      if (!windowRows.length) return { entry, minute, status: 'missing-cgm', complete: false, isolation };
      const pre = windowRows.filter((row) => row[0] <= minute && row[1] !== null);
      const post = windowRows.filter((row) => row[0] >= minute + 5 && row[1] !== null);
      if (!pre.length || post.length < 18) return { entry, minute, status: 'partial-cgm', complete: false, isolation, cgmPoints: post.length };
      const baselineRow = pre[pre.length - 1];
      const baseline = baselineRow[1];
      const peakRow = post.reduce((best, row) => row[1] > best[1] ? row : best, post[0]);
      const twoHourRow = closestExact(post.filter((row) => row[0] >= minute + 105 && row[0] <= minute + 135), minute + 120, 15);
      const riseMinute = findSustainedRise(post, baseline);
      const bolus = matchBolus(minute, boluses);
      const turnMinute = findCurveTurn(post, baseline, bolus?.[0] ?? null, riseMinute);
      return {
        entry,
        minute,
        status: post.length >= 25 && twoHourRow ? 'complete' : 'partial-analysis',
        complete: post.length >= 25 && Boolean(twoHourRow),
        isolation,
        cgmPoints: post.length,
        baseline,
        baselineMinute: baselineRow[0],
        riseMinute,
        minutesToRise: riseMinute === null ? null : riseMinute - minute,
        peak: peakRow[1],
        peakMinute: peakRow[0],
        minutesToPeak: peakRow[0] - minute,
        peakDelta: peakRow[1] - baseline,
        twoHour: twoHourRow?.[1] ?? null,
        twoHourDelta: twoHourRow ? twoHourRow[1] - baseline : null,
        bolus,
        bolusOffset: bolus ? bolus[0] - minute : null,
        turnMinute,
        turnFromMeal: turnMinute === null ? null : turnMinute - minute,
        turnFromBolus: turnMinute === null || !bolus ? null : turnMinute - bolus[0],
      };
    }

    function analyzeMeals(diary, cgmRows, boluses) {
      return diary.filter((entry) => MEAL_TYPES.has(entry.occasion)).map((entry) => analyzeMealEntry(entry, cgmRows, boluses, diary));
    }

    function buildFoodComparisons(analyses) {
      const groups = new Map();
      for (const analysis of analyses) {
        const key = normalizeFood(analysis.entry.food);
        if (!key) continue;
        if (!groups.has(key)) groups.set(key, { key, label: analysis.entry.food.trim(), all: [], analyzed: [] });
        const group = groups.get(key);
        group.all.push(analysis);
        if (analysis.complete && analysis.isolation?.isolated) group.analyzed.push(analysis);
      }
      return [...groups.values()].filter((group) => group.all.length >= 2).map((group) => ({
        key: group.key,
        label: group.label,
        entries: group.all.length,
        analyzed: group.analyzed.length,
        medianPeakDelta: round(median(group.analyzed.map((item) => item.peakDelta).filter(Number.isFinite)), 0),
        medianMinutesToPeak: round(median(group.analyzed.map((item) => item.minutesToPeak).filter(Number.isFinite)), 0),
        medianTwoHourDelta: round(median(group.analyzed.map((item) => item.twoHourDelta).filter(Number.isFinite)), 0),
      })).sort((a, b) => b.entries - a.entries || a.label.localeCompare(b.label, 'de'));
    }

    function illnessComparison(analyses) {
      const summarize = (items) => ({
        entries: items.length,
        peakDelta: round(median(items.map((item) => item.peakDelta).filter(Number.isFinite)), 0),
        minutesToPeak: round(median(items.map((item) => item.minutesToPeak).filter(Number.isFinite)), 0),
        twoHourDelta: round(median(items.map((item) => item.twoHourDelta).filter(Number.isFinite)), 0),
      });
      const complete = analyses.filter((item) => item.complete && item.isolation?.isolated);
      return {
        illness: summarize(complete.filter((item) => item.entry.illness === 'ja')),
        noIllness: summarize(complete.filter((item) => item.entry.illness !== 'ja')),
        recordedIllnessEntries: analyses.filter((item) => item.entry.illness === 'ja').length,
      };
    }

    function buildRecommendations(context) {
      const { diary, analyses, foodGroups, cgmRows, metrics } = context;
      const cards = [];
      const meals = analyses.length;
      const missing = analyses.filter((item) => item.status === 'missing-cgm').length;
      const partial = analyses.filter((item) => item.status === 'partial-cgm' || item.status === 'partial-analysis').length;
      const complete = analyses.filter((item) => item.complete).length;

      if (missing) {
        const dated = analyses.filter((item) => item.status === 'missing-cgm').map((item) => item.minute).filter(Number.isFinite).sort((a, b) => a - b);
        cards.push({
          type: 'info', tag: 'Nächster Schritt', title: `${missing} Tagebucheintrag${missing === 1 ? '' : 'e'} wartet auf passende CGM-Werte`,
          finding: `Die gespeicherten Mahlzeiten reichen bis ${dated.length ? formatDateMinute(dated[dated.length - 1]) : 'in den aktuellen Zeitraum'}, der lokale CGM-Bestand deckt diese Zeitpunkte aber noch nicht ab.`,
          action: 'Den aktuellen CGM-Export und möglichst auch die Bolus-CSV im Bereich „CSV-Daten“ ergänzen. Überlappende Zeiträume werden automatisch dedupliziert.',
          boundary: 'Ohne zeitlich passende CGM-Werte werden keine Glukosewirkung oder Wirkkurven erfunden.',
        });
      }

      for (const group of foodGroups.filter((item) => item.entries >= 2)) {
        if (group.analyzed >= 2) {
          cards.push({
            type: 'high', tag: group.analyzed < 3 ? 'Vorläufig' : 'Beobachtung', title: `${group.label}: wiederholter Mahlzeitenvergleich`,
            finding: `${group.analyzed} isoliert auswertbare Wiederholungen zeigen im Median einen Anstieg bis zum Peak von ${formatMg(group.medianPeakDelta)} nach ${formatMinutes(group.medianMinutesToPeak)}.`,
            action: 'Weitere möglichst ähnlich zusammengesetzte Wiederholungen erfassen und Abweichungen bei Menge, Fett, Eiweiß, Ballaststoffen, Bewegung, Schlaf und Krankheit beachten.',
            boundary: `${group.analyzed < 3 ? 'Die Fallzahl ist noch sehr klein. ' : ''}Der Vergleich beschreibt Korrelationen und keine Dosisempfehlung.`,
          });
        } else {
          cards.push({
            type: 'info', tag: 'Vergleich vorbereitet', title: `${group.label} ist bereits ${group.entries}-mal dokumentiert`,
            finding: 'Die wiederholten Tagebucheinträge können direkt miteinander verglichen werden, sobald die zugehörigen CGM-Zeitpunkte lokal vorhanden und ausreichend isoliert sind.',
            action: 'Aktuelle CGM-CSV ergänzen; bei weiteren Einträgen die Bezeichnung möglichst gleich schreiben.',
            boundary: 'Makronährstoffähnlichkeit allein genügt nicht für eine Glukosewirkungsanalyse.',
          });
        }
      }

      if (!cgmRows.length) {
        cards.push(
          {
            type: 'high', tag: 'Ausgangsbefund', title: 'Frühstück gezielt protokollieren',
            finding: 'Im veröffentlichten 90-Tage-Ausgangsstand lag der mediane Peak isoliert auswertbarer Frühstücksereignisse bei 202 mg/dl und ungefähr 95 Minuten nach dem Kohlenhydrateintrag.',
            action: 'Konkrete Lebensmittel, Mengen und Kontext weiter erfassen. Nach dem CSV-Import werden diese Einträge einzeln und als Wiederholungsgruppen analysiert.',
            boundary: 'Der Ausgangsbefund wird nicht automatisch mit lokalen Detaildaten vermischt und erlaubt keine Dosis- oder Timingänderung.',
          },
          {
            type: 'high', tag: 'Ausgangsbefund', title: 'Abendliche Hochphasen um 21 Uhr weiter aufklären',
            finding: 'Im veröffentlichten Ausgangsstand war der Anteil über 180 mg/dl um etwa 21 Uhr deutlich höher als im Gesamtprofil.',
            action: 'Späte Mahlzeiten, Snacks, Getränke, Bewegung, Krankheit und Stress zeitlich genau dokumentieren.',
            boundary: 'Ohne lokale Detaildaten und vollständigen Kontext ist keine Ursache bewiesen.',
          },
          {
            type: 'low', tag: 'Ausgangsbefund', title: '18–20 Uhr als Niedrig-Zeitfenster markieren',
            finding: 'Im veröffentlichten Ausgangsstand traten zwischen 18 und 20 Uhr relativ häufiger Werte unter 70 mg/dl auf.',
            action: 'Aktivität, vorausgehende Mahlzeit, Zeit seit dem letzten Bolus und Symptome für künftige Ereignisse erfassen.',
            boundary: 'Die App ersetzt weder CGM-/Pumpenalarm noch den vereinbarten Hypoglykämieplan.',
          },
        );
      }

      if (cgmRows.length && metrics) {
        const hourly = hourlyMetrics(cgmRows);
        const high = hourly.filter((item) => item.samples >= 24 && item.above180 >= metrics.above180 + 8).sort((a, b) => b.above180 - a.above180)[0];
        const low = hourly.filter((item) => item.samples >= 24 && item.below70 >= metrics.below70 + 1).sort((a, b) => b.below70 - a.below70)[0];
        if (high) cards.push({
          type: 'high', tag: 'Zeitmuster', title: `Höherer Hochanteil um ${String(high.hour).padStart(2, '0')}:00 Uhr`,
          finding: `${formatPercent(high.above180)} der lokalen Werte in dieser Stunde liegen über 180 mg/dl, gegenüber ${formatPercent(metrics.above180)} im gewählten Gesamtzeitraum.`,
          action: 'Tagebucheinträge, Snacks, Bewegung, Krankheit und noch aktives Insulin in diesem Zeitfenster vergleichen.',
          boundary: 'Das Stundenmuster beweist keine einzelne Ursache.',
        });
        if (low) cards.push({
          type: 'low', tag: 'Zeitmuster', title: `Höherer Niedriganteil um ${String(low.hour).padStart(2, '0')}:00 Uhr`,
          finding: `${formatPercent(low.below70)} der lokalen Werte in dieser Stunde liegen unter 70 mg/dl, gegenüber ${formatPercent(metrics.below70)} im gewählten Gesamtzeitraum.`,
          action: 'Aktivität, vorausgehende Mahlzeit, Bolusereignisse und Symptome für wiederkehrende Konstellationen markieren.',
          boundary: 'Die App gibt keine Akut- oder Pumpenanweisung.',
        });
      }

      const illnessEntries = diary.filter((entry) => entry.illness === 'ja').length;
      if (!illnessEntries) cards.push({
        type: '', tag: 'Kontext', title: 'Krankheit ist als Vergleichsmerkmal vorbereitet',
        finding: 'Derzeit ist noch kein Tagebucheintrag als Krankheit markiert.',
        action: 'Bei Krankheit weiterhin das vorhandene Feld verwenden. Sobald vergleichbare Mahlzeiten mit und ohne Krankheit vorliegen, zeigt die App die Gruppen getrennt.',
        boundary: 'Unterschiede zwischen Krankheitstagen und anderen Tagen bleiben beobachtend.',
      });

      if (!cards.length) {
        cards.push({
          type: 'info', tag: 'Datengrundlage', title: 'Noch keine auswertbaren lokalen Beobachtungen',
          finding: 'Für den gewählten lokalen Zeitraum liegen noch keine ausreichenden Tagebuch- oder CGM-Muster vor.',
          action: 'Tagebucheinträge erfassen und aktuelle CGM-/Bolus-CSV ergänzen.',
          boundary: 'Fehlende Daten werden nicht durch Beispielwerte ersetzt.',
        });
      }

      if (partial) cards.push({
        type: 'info', tag: 'Datenqualität', title: `${partial} Mahlzeit${partial === 1 ? '' : 'en'} nur teilweise auswertbar`,
        finding: 'Im Drei-Stunden-Fenster fehlen ausreichend viele exakte CGM-Werte oder ein Zwei-Stunden-Näherungswert.',
        action: 'Datenlücken prüfen oder einen vollständigeren Export ergänzen.',
        boundary: 'Teilanalysen werden nicht in Lebensmittelgruppen-Mediane aufgenommen.',
      });

      if (complete) cards.unshift({
        type: '', tag: 'Aktueller Stand', title: `${complete} Mahlzeit${complete === 1 ? '' : 'en'} mit vollständiger lokaler Kurvenanalyse`,
        finding: `${meals} Mahlzeiteneinträge sind gespeichert; ${complete} erfüllen die Mindestabdeckung für Ausgangswert, Peak und Zwei-Stunden-Wert.`,
        action: 'In der Mahlzeitenanalyse einzelne Verläufe und wiederholte Lebensmittel vergleichen.',
        boundary: 'Der Kurvenwendepunkt ist nur ein retrospektiver CGM-Proxy.',
      });
      return cards.slice(0, 10);
    }
