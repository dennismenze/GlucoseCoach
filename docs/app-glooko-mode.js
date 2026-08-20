(function (root) {
  'use strict';

  const MINUTE_MS = 60_000;
  const MEAL_SOURCE_KEY = 'glucosecoach-meal-source-v1';
  const SOURCE_LOCAL = 'local';
  const SOURCE_GLOOKO = 'glooko';
  const SOURCE_COMBINED = 'combined';
  const MEAL_OCCASIONS = new Set(['Frühstück', 'Mittagessen', 'Abendessen', 'Snack']);
  const GLOOKO_CARBS_ASSOCIATION_MINUTES = 10;
  const DUPLICATE_MEAL_WINDOW_MINUTES = 10;

  function safeArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function finite(value) {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  function round(value, digits = 2) {
    if (!Number.isFinite(value)) return null;
    const factor = 10 ** digits;
    return Math.round((value + Number.EPSILON) * factor) / factor;
  }

  function parseMinute(value) {
    const source = String(value ?? '').trim();
    if (!source) return null;
    const german = source.match(
      /^(\d{1,2})\.(\d{1,2})\.(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/,
    );
    if (german) {
      const date = new Date(
        Number(german[3]),
        Number(german[2]) - 1,
        Number(german[1]),
        Number(german[4]),
        Number(german[5]),
        Number(german[6] || 0),
      );
      return Number.isNaN(date.getTime()) ? null : Math.round(date.getTime() / MINUTE_MS);
    }
    const date = new Date(source);
    return Number.isNaN(date.getTime()) ? null : Math.round(date.getTime() / MINUTE_MS);
  }

  function localDateTimeValue(minute) {
    const numeric = Number(minute);
    if (!Number.isFinite(numeric)) return '';
    const date = new Date(numeric * MINUTE_MS);
    if (Number.isNaN(date.getTime())) return '';
    const part = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}` +
      `T${part(date.getHours())}:${part(date.getMinutes())}`;
  }

  function inferMealOccasion(minute) {
    const numeric = Number(minute);
    if (!Number.isFinite(numeric)) return 'Snack';
    const hour = new Date(numeric * MINUTE_MS).getHours();
    if (hour >= 5 && hour < 11) return 'Frühstück';
    if (hour >= 11 && hour < 15) return 'Mittagessen';
    if (hour >= 15 && hour < 22) return 'Abendessen';
    return 'Snack';
  }

  function emptyGroup(minute) {
    return {
      minute,
      names: [],
      nameSet: new Set(),
      items: 0,
      carbs: 0,
      carbsSeen: false,
      fat: 0,
      fatSeen: false,
      protein: 0,
      proteinSeen: false,
      calories: 0,
      caloriesSeen: false,
      sources: new Set(),
    };
  }

  function addName(group, value) {
    const name = String(value ?? '').trim();
    if (!name) return;
    const key = name.toLocaleLowerCase('de-DE');
    if (group.nameSet.has(key)) return;
    group.nameSet.add(key);
    group.names.push(name);
  }

  function addNumeric(group, key, value) {
    const numeric = finite(value);
    if (numeric === null) return;
    group[key] += numeric;
    group[`${key}Seen`] = true;
  }

  function closestFoodGroup(groups, minute) {
    let best = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const group of groups.values()) {
      if (!group.sources.has('food')) continue;
      const distance = Math.abs(group.minute - minute);
      if (distance <= GLOOKO_CARBS_ASSOCIATION_MINUTES && distance < bestDistance) {
        best = group;
        bestDistance = distance;
      }
    }
    return best;
  }

  function buildGlookoMealEntries(clinical = {}) {
    const groups = new Map();
    const groupAt = (minute) => {
      const key = String(minute);
      if (!groups.has(key)) groups.set(key, emptyGroup(minute));
      return groups.get(key);
    };

    for (const row of safeArray(clinical.foodEvents)) {
      const minute = finite(row?.[0]);
      if (minute === null) continue;
      const group = groupAt(minute);
      group.sources.add('food');
      group.items += 1;
      addName(group, row[1]);
      addNumeric(group, 'carbs', row[2]);
      addNumeric(group, 'fat', row[3]);
      addNumeric(group, 'protein', row[4]);
      addNumeric(group, 'calories', row[5]);
    }

    for (const row of safeArray(clinical.cgmCarbs)) {
      const minute = finite(row?.[0]);
      const carbs = finite(row?.[1]);
      if (minute === null || carbs === null || carbs <= 0) continue;
      const nearbyFood = closestFoodGroup(groups, minute);
      if (nearbyFood) {
        nearbyFood.sources.add('cgmCarbs');
        if (!nearbyFood.carbsSeen) addNumeric(nearbyFood, 'carbs', carbs);
        continue;
      }
      const group = groupAt(minute);
      group.sources.add('cgmCarbs');
      group.items += 1;
      addNumeric(group, 'carbs', carbs);
    }

    return [...groups.values()]
      .filter((group) => group.names.length || group.carbsSeen)
      .sort((a, b) => a.minute - b.minute)
      .map((group) => {
        const nutrientText = [
          group.carbsSeen ? `${round(group.carbs, 1)} g KH` : null,
          group.fatSeen ? `${round(group.fat, 1)} g Fett` : null,
          group.proteinSeen ? `${round(group.protein, 1)} g Eiweiß` : null,
        ].filter(Boolean).join(' · ');
        const calorieText = group.caloriesSeen ? `${round(group.calories, 0)} kcal` : '';
        const details = [nutrientText, calorieText].filter(Boolean).join(' · ');
        return {
          id: `glooko-meal-${group.minute}`,
          when: localDateTimeValue(group.minute),
          occasion: inferMealOccasion(group.minute),
          food: group.names.join(' + ') || 'Glooko-Kohlenhydrate',
          carbs: group.carbsSeen ? round(group.carbs, 1) : '',
          fat: group.fatSeen ? round(group.fat, 1) : '',
          protein: group.proteinSeen ? round(group.protein, 1) : '',
          fiber: '',
          activity: '',
          sleep: '',
          stress: '',
          illness: 'unbekannt',
          notes: `Aus Glooko-Export übernommen${details ? ` · ${details}` : ''}`,
          source: SOURCE_GLOOKO,
          readOnly: true,
          sourceItems: group.items,
          calories: group.caloriesSeen ? round(group.calories, 0) : null,
        };
      });
  }

  function localMealEntries(diary) {
    return safeArray(diary).filter((entry) => MEAL_OCCASIONS.has(entry?.occasion));
  }

  function normalizeFood(value) {
    return String(value ?? '')
      .trim()
      .toLocaleLowerCase('de-DE')
      .replace(/\s+/g, ' ');
  }

  function isDuplicateMeal(localEntry, glookoEntry) {
    if (!MEAL_OCCASIONS.has(localEntry?.occasion)) return false;
    const localMinute = parseMinute(localEntry.when);
    const glookoMinute = parseMinute(glookoEntry.when);
    if (localMinute === null || glookoMinute === null) return false;

    const distance = Math.abs(localMinute - glookoMinute);
    if (distance > DUPLICATE_MEAL_WINDOW_MINUTES) return false;
    if (distance <= 2) return true;

    const localFood = normalizeFood(localEntry.food);
    const glookoFood = normalizeFood(glookoEntry.food);
    if (localFood && glookoFood && localFood === glookoFood) return true;

    const localCarbs = finite(localEntry.carbs);
    const glookoCarbs = finite(glookoEntry.carbs);
    return localCarbs !== null &&
      glookoCarbs !== null &&
      Math.abs(localCarbs - glookoCarbs) <= 1;
  }

  function buildAdditionalGlookoMealEntries(localDiary, clinical) {
    const localMeals = localMealEntries(localDiary);
    return buildGlookoMealEntries(clinical).filter(
      (glookoEntry) => !localMeals.some((localEntry) => isDuplicateMeal(localEntry, glookoEntry)),
    );
  }

  function resolveMealSource() {
    return SOURCE_COMBINED;
  }

  function buildAnalysisDiary(localDiary, clinical) {
    return [
      ...safeArray(localDiary),
      ...buildAdditionalGlookoMealEntries(localDiary, clinical),
    ];
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[character]));
  }

  function formatNumber(value, digits = 1) {
    return Number.isFinite(Number(value))
      ? new Intl.NumberFormat('de-DE', { maximumFractionDigits: digits }).format(Number(value))
      : '–';
  }

  function installStyles() {
    if (document.querySelector('#glooko-mode-styles')) return;
    const style = document.createElement('style');
    style.id = 'glooko-mode-styles';
    style.textContent = `
      .glooko-workflow,
      .glooko-source-control {
        border:1px solid var(--line);
        border-radius:14px;
        padding:14px;
        background:var(--surface-strong);
      }
      .glooko-workflow { margin:12px 0; }
      .glooko-workflow p { margin:0; }
      .glooko-workflow p + p { margin-top:8px; }
      .glooko-workflow .actions { margin-top:12px; }
      .glooko-source-control { margin:0 0 16px; }
      .glooko-source-control p { margin:8px 0 0; }
      .glooko-readonly-note { margin:8px 14px 14px; color:var(--muted); }
      .glooko-source-badge {
        display:inline-block;
        margin-left:8px;
        font-size:.72rem;
        color:var(--muted);
      }
    `;
    document.head.appendChild(style);
  }

  function ensureImportWorkflow() {
    const panel = document.querySelector('#import-data');
    const card = panel?.querySelector('article.card.wide');
    const drop = card?.querySelector('.import-drop');
    if (!card || !drop) return;

    const heading = card.querySelector('h2');
    if (heading) heading.textContent = 'Glooko-Export zusätzlich auswerten';

    const paragraphs = drop.querySelectorAll(':scope > p');
    if (paragraphs[0]) {
      paragraphs[0].innerHTML =
        '<strong>Kompletter Omnipod-Export oder Glooko-Webexport als ZIP:</strong> ' +
        'ZIP hier ablegen oder CSV/ZIP auswählen. Gerätewerte, Insulin, Kohlenhydrate und ' +
        'Glooko-Lebensmitteleinträge werden gemeinsam übernommen.';
    }
    if (paragraphs[1]) {
      paragraphs[1].textContent =
        'Die Dateien werden ausschließlich in diesem Browser gelesen. Wiederholte Exporte ' +
        'ergänzen den Bestand und werden dedupliziert. Das lokale Tagebuch bleibt parallel nutzbar.';
    }

    let workflow = document.querySelector('#glooko-workflow');
    if (!workflow) {
      workflow = document.createElement('div');
      workflow.id = 'glooko-workflow';
      workflow.className = 'glooko-workflow';
      drop.insertBefore(workflow, drop.querySelector('.actions'));
    }
    workflow.innerHTML =
      '<p><strong>Möglicher Ablauf:</strong> Geräte und Essen in Glooko erfassen → im ' +
      'Glooko-Webkonto als ZIP exportieren → ZIP hier ablegen. Alternativ oder ergänzend ' +
      'können Mahlzeiten weiterhin direkt im GlucoseCoach-Tagebuch eingetragen werden.</p>' +
      '<p class="muted">Eine offizielle direkte Kontosynchronisation ist für private ' +
      'Glooko-Konten derzeit nicht freigeschaltet. Sie bleibt als späterer Adapter möglich, ' +
      'sobald offizielle Geschäftskunden-Zugangsdaten vorliegen.</p>' +
      '<div class="actions"><a class="file-button" href="https://my.glooko.com" ' +
      'target="_blank" rel="noopener noreferrer">Glooko-Webkonto öffnen</a></div>';
  }

  function ensureSourceSummary(localDiary, importedMeals, additionalMeals) {
    const card = document.querySelector('#diary article.card.wide');
    const form = document.querySelector('#diary-form');
    if (!card || !form) return;

    let control = document.querySelector('#glooko-source-control');
    if (!control) {
      control = document.createElement('div');
      control.id = 'glooko-source-control';
      control.className = 'glooko-source-control';
      form.insertAdjacentElement('beforebegin', control);
    }

    const localMeals = localMealEntries(localDiary).length;
    const matched = importedMeals.length - additionalMeals.length;
    control.innerHTML =
      `<strong>Zusätzliche Glooko-Mahlzeiten: ${additionalMeals.length}</strong>` +
      `<p class="muted">${importedMeals.length} Glooko-Mahlzeit(en) erkannt, ` +
      `${matched} bereits vorhandenen lokalen Einträgen zugeordnet und deshalb nicht doppelt ` +
      `gezählt. ${localMeals} lokale Mahlzeit(en) bleiben bearbeitbar. Beide Quellen fließen ` +
      'gemeinsam in die Auswertung ein.</p>';

    form.hidden = false;
    form.style.display = '';
    const heading = card.querySelector('h2');
    if (heading) heading.textContent = 'Kontext erfassen';
    const intro = card.querySelector(':scope > p.muted');
    if (intro) {
      intro.textContent =
        'Mahlzeiten und Kontext können weiterhin direkt hier eingetragen werden. Importierte ' +
        'Glooko-Mahlzeiten erscheinen zusätzlich schreibgeschützt. Zeitlich und inhaltlich ' +
        'gleiche Einträge werden für die Analyse nicht doppelt gezählt.';
    }
  }

  function nutrientsText(entry) {
    return [
      entry.carbs !== '' ? `${formatNumber(entry.carbs)} g KH` : null,
      entry.fat !== '' ? `${formatNumber(entry.fat)} g Fett` : null,
      entry.protein !== '' ? `${formatNumber(entry.protein)} g Eiweiß` : null,
    ].filter(Boolean).join(' · ');
  }

  function decorateDiary(localDiary, additionalMeals) {
    const target = document.querySelector('#entries');
    const empty = document.querySelector('#empty-diary');
    if (!target || !empty) return;

    const buttons = [...target.querySelectorAll('.remove-entry')];
    for (const entry of additionalMeals) {
      const button = buttons.find((candidate) => candidate.dataset.id === entry.id);
      const item = button?.closest('.entry');
      if (!item) continue;
      item.dataset.source = SOURCE_GLOOKO;
      button.remove();

      const small = item.querySelector('.entry-head small');
      if (small && !small.querySelector('.glooko-source-badge')) {
        const badge = document.createElement('span');
        badge.className = 'glooko-source-badge';
        badge.textContent = 'Glooko · nur lesbar';
        small.appendChild(badge);
      }

      if (!item.querySelector('.glooko-readonly-note')) {
        const note = document.createElement('p');
        note.className = 'glooko-readonly-note';
        note.textContent = `${nutrientsText(entry) || 'Keine Nährstoffmenge im Export'}.`;
        item.appendChild(note);
      }
    }

    for (const item of target.querySelectorAll('.entry')) {
      if (!item.dataset.source) item.dataset.source = SOURCE_LOCAL;
    }

    const total = localDiary.length + additionalMeals.length;
    empty.hidden = total > 0;
    empty.textContent = 'Noch keine lokalen oder importierten Einträge.';
    const summary = document.querySelector('#diary-entries-summary');
    if (summary) {
      summary.textContent = total
        ? `${total} Einträge anzeigen · ${localDiary.length} lokal, ${additionalMeals.length} Glooko`
        : 'Noch keine Tagebucheinträge';
    }
  }

  function updateOverviewSource(localDiary, additionalMeals) {
    if (!additionalMeals.length) return;

    const source = document.querySelector('#source-pill');
    if (source && Number(gcState?.clinical?.cgm?.length || 0) > 0) {
      source.textContent = 'Glooko-Export + lokales Tagebuch · lokal ausgewertet';
    }
    const badge = document.querySelector('#header-badge');
    if (badge && Number(gcState?.clinical?.cgm?.length || 0) > 0) {
      badge.textContent =
        `${formatNumber(gcState.clinical.cgm.length, 0)} lokale CGM-Werte · Glooko + Eingabe`;
    }

    const facts = document.querySelector('#dataset-facts');
    const diaryFact = [...(facts?.querySelectorAll('li') || [])]
      .find((item) => item.querySelector('span')?.textContent === 'Tagebucheinträge');
    if (diaryFact) {
      diaryFact.querySelector('span').textContent = 'lokale Tagebucheinträge';
      diaryFact.querySelector('strong').textContent = String(localDiary.length);
    }
    if (facts) {
      let glookoFact = facts.querySelector('li[data-fact="glooko-meals"]');
      if (!glookoFact) {
        glookoFact = document.createElement('li');
        glookoFact.dataset.fact = 'glooko-meals';
        facts.appendChild(glookoFact);
      }
      glookoFact.innerHTML =
        `<span>zusätzliche Glooko-Mahlzeiten</span><strong>${additionalMeals.length}</strong>`;
    }

    const notice = document.querySelector('#recommendations .notice');
    if (notice) {
      notice.innerHTML =
        '<strong>Gemeinsame Datengrundlage:</strong> Empfehlungen entstehen aus lokal ' +
        'importierten Glooko-Daten und weiterhin möglichen GlucoseCoach-Tagebucheinträgen.';
    }
  }

  function updateQualitySource(localDiary, importedMeals, additionalMeals) {
    const body = document.querySelector('#quality-body');
    if (!body) return;
    let row = body.querySelector('tr[data-quality="glooko-source"]');
    if (!row) {
      row = document.createElement('tr');
      row.dataset.quality = 'glooko-source';
      body.appendChild(row);
    }
    row.innerHTML =
      '<td>Mahlzeitenquellen</td>' +
      `<td>lokal ${localMealEntries(localDiary).length} · Glooko zusätzlich ${additionalMeals.length}</td>` +
      `<td>${importedMeals.length} Glooko-Mahlzeit(en) erkannt. Importierte Einträge sind ` +
      'schreibgeschützt; passende lokale Duplikate werden nicht nochmals als Mahlzeitenanker gezählt.</td>';
  }

  function decorate(localDiary, importedMeals, additionalMeals) {
    installStyles();
    ensureImportWorkflow();
    ensureSourceSummary(localDiary, importedMeals, additionalMeals);
    decorateDiary(localDiary, additionalMeals);
    updateOverviewSource(localDiary, additionalMeals);
    updateQualitySource(localDiary, importedMeals, additionalMeals);
  }

  function installBrowserPatch() {
    if (
      typeof document === 'undefined' ||
      typeof gcRender !== 'function' ||
      typeof gcState === 'undefined'
    ) return;

    const previousIllnessComparison = typeof illnessComparison === 'function'
      ? illnessComparison
      : null;
    if (previousIllnessComparison) {
      const knownIllnessComparison = (analyses) => previousIllnessComparison(
        safeArray(analyses).filter(
          (analysis) => ['ja', 'nein'].includes(analysis?.entry?.illness),
        ),
      );
      illnessComparison = knownIllnessComparison;
      if (typeof GlucoseCoachV3 !== 'undefined') {
        GlucoseCoachV3.illnessComparison = knownIllnessComparison;
      }
    }

    const previousRender = gcRender;
    gcRender = function renderWithAdditionalGlookoMeals() {
      const localDiary = safeArray(gcState.diary);
      const clinical = gcState.clinical && typeof gcState.clinical === 'object'
        ? gcState.clinical
        : {};
      const importedMeals = buildGlookoMealEntries(clinical);
      const additionalMeals = buildAdditionalGlookoMealEntries(localDiary, clinical);
      const analysisDiary = [...localDiary, ...additionalMeals];

      gcState.diary = analysisDiary;
      try {
        previousRender();
      } finally {
        gcState.diary = localDiary;
      }
      decorate(localDiary, importedMeals, additionalMeals);
    };

    gcRender();
  }

  const api = {
    MEAL_SOURCE_KEY,
    SOURCE_LOCAL,
    SOURCE_GLOOKO,
    SOURCE_COMBINED,
    GLOOKO_CARBS_ASSOCIATION_MINUTES,
    DUPLICATE_MEAL_WINDOW_MINUTES,
    inferMealOccasion,
    localDateTimeValue,
    parseMinute,
    isDuplicateMeal,
    buildGlookoMealEntries,
    buildAdditionalGlookoMealEntries,
    buildAnalysisDiary,
    resolveMealSource,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.GlucoseCoachGlookoMode = api;
  installBrowserPatch();
})(typeof globalThis !== 'undefined' ? globalThis : this);
