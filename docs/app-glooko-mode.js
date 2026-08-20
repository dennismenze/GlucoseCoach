(function (root) {
  'use strict';

  const MINUTE_MS = 60_000;
  const MEAL_SOURCE_KEY = 'glucosecoach-meal-source-v1';
  const SOURCE_LOCAL = 'local';
  const SOURCE_GLOOKO = 'glooko';
  const MEAL_OCCASIONS = new Set(['Frühstück', 'Mittagessen', 'Abendessen', 'Snack']);
  const GLOOKO_CARBS_ASSOCIATION_MINUTES = 10;

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
          source: 'glooko',
          readOnly: true,
          sourceItems: group.items,
          calories: group.caloriesSeen ? round(group.calories, 0) : null,
        };
      });
  }

  function localMealEntries(diary) {
    return safeArray(diary).filter((entry) => MEAL_OCCASIONS.has(entry?.occasion));
  }

  function resolveMealSource(localDiary, clinical, storedSource = null) {
    if ([SOURCE_LOCAL, SOURCE_GLOOKO].includes(storedSource)) return storedSource;
    return buildGlookoMealEntries(clinical).length > 0 && localMealEntries(localDiary).length === 0
      ? SOURCE_GLOOKO
      : SOURCE_LOCAL;
  }

  function buildAnalysisDiary(localDiary, clinical, source) {
    const local = safeArray(localDiary);
    if (source !== SOURCE_GLOOKO) return [...local];
    const nonMealContext = local.filter((entry) => !MEAL_OCCASIONS.has(entry?.occasion));
    return [...nonMealContext, ...buildGlookoMealEntries(clinical)];
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

  function storedMealSource() {
    try {
      return localStorage.getItem(MEAL_SOURCE_KEY);
    } catch {
      return null;
    }
  }

  function saveMealSource(source) {
    try {
      localStorage.setItem(MEAL_SOURCE_KEY, source);
    } catch {
      // A blocked localStorage should not prevent local analysis for this page load.
    }
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
      .glooko-source-control label { display:grid; gap:7px; font-weight:800; }
      .glooko-source-control p { margin:10px 0 0; }
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
    if (heading) heading.textContent = 'Glooko-Export lokal auswerten';

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
        'ergänzen den Bestand und werden dedupliziert.';
    }

    let workflow = document.querySelector('#glooko-workflow');
    if (!workflow) {
      workflow = document.createElement('div');
      workflow.id = 'glooko-workflow';
      workflow.className = 'glooko-workflow';
      drop.insertBefore(workflow, drop.querySelector('.actions'));
    }
    workflow.innerHTML =
      '<p><strong>Vorgesehener Ablauf:</strong> Geräte und Essen in Glooko erfassen → im ' +
      'Glooko-Webkonto als ZIP exportieren → ZIP hier ablegen. GlucoseCoach übernimmt nur ' +
      'Deutung und Auswertung.</p>' +
      '<p class="muted">Eine offizielle direkte Kontosynchronisation ist für private ' +
      'Glooko-Konten derzeit nicht freigeschaltet. Sie bleibt als späterer Adapter möglich, ' +
      'sobald offizielle Geschäftskunden-Zugangsdaten vorliegen.</p>' +
      '<div class="actions"><a class="file-button" href="https://my.glooko.com" ' +
      'target="_blank" rel="noopener noreferrer">Glooko-Webkonto öffnen</a></div>';
  }

  function ensureSourceControl(mode, localDiary, glookoMeals) {
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

    const localCount = localMealEntries(localDiary).length;
    control.innerHTML =
      '<label>Mahlzeitenquelle' +
      '<select id="glooko-meal-source">' +
      `<option value="${SOURCE_GLOOKO}">Glooko-Lebensmitteleinträge (${glookoMeals.length})</option>` +
      `<option value="${SOURCE_LOCAL}">GlucoseCoach-Tagebuch (${localCount})</option>` +
      '</select></label>' +
      `<p class="muted">${mode === SOURCE_GLOOKO
        ? 'Essen wird in Glooko erfasst. Importierte Mahlzeiten sind hier nur lesbar und werden automatisch mit CGM- und Bolusdaten verknüpft.'
        : 'Das lokale Tagebuch bleibt als Übergangs- und Fallbackmodus verfügbar.'}</p>`;

    const select = control.querySelector('#glooko-meal-source');
    select.value = mode;
    select.onchange = () => {
      saveMealSource(select.value);
      if (typeof gcRender === 'function') gcRender();
    };

    form.hidden = mode === SOURCE_GLOOKO;
    const heading = card.querySelector('h2');
    if (heading) heading.textContent = mode === SOURCE_GLOOKO
      ? 'Mahlzeiten aus Glooko'
      : 'Kontext erfassen';
    const intro = card.querySelector(':scope > p.muted');
    if (intro) {
      intro.textContent = mode === SOURCE_GLOOKO
        ? 'Neue Mahlzeiten bitte in Glooko eingeben und anschließend den aktuellen Glooko-ZIP-Export importieren. GlucoseCoach verändert diese Einträge nicht.'
        : 'Lokale Einträge bleiben möglich, sind aber nicht nötig, wenn Glooko als Mahlzeitenquelle verwendet wird.';
    }
  }

  function renderGlookoDiary(glookoMeals) {
    const target = document.querySelector('#entries');
    const empty = document.querySelector('#empty-diary');
    if (!target || !empty) return;

    const entries = [...glookoMeals].sort((a, b) => String(b.when).localeCompare(String(a.when)));
    empty.hidden = entries.length > 0;
    empty.textContent = 'Noch keine Glooko-Lebensmitteleinträge importiert.';
    target.innerHTML = entries.map((entry) => {
      const date = new Date(entry.when);
      const dateText = Number.isNaN(date.getTime()) ? entry.when : date.toLocaleString('de-DE');
      const nutrients = [
        entry.carbs !== '' ? `${formatNumber(entry.carbs)} g KH` : null,
        entry.fat !== '' ? `${formatNumber(entry.fat)} g Fett` : null,
        entry.protein !== '' ? `${formatNumber(entry.protein)} g Eiweiß` : null,
      ].filter(Boolean).join(' · ');
      return `<details class="entry" data-source="glooko">` +
        `<summary class="entry-head"><strong>${escapeHtml(entry.occasion)}</strong>` +
        `<small>${escapeHtml(dateText)}<span class="glooko-source-badge">Glooko · nur lesbar</span></small></summary>` +
        `<p>${escapeHtml(entry.food)}</p>` +
        `<p class="glooko-readonly-note">${escapeHtml(nutrients || 'Keine Nährstoffmenge im Export')}.</p>` +
        '</details>';
    }).join('');

    const summary = document.querySelector('#diary-entries-summary');
    if (summary) {
      summary.textContent = entries.length
        ? `${entries.length} ${entries.length === 1 ? 'Glooko-Mahlzeit' : 'Glooko-Mahlzeiten'} anzeigen`
        : 'Noch keine Glooko-Mahlzeiten';
    }
  }

  function updateOverviewSource(mode, glookoMeals) {
    if (mode !== SOURCE_GLOOKO) return;
    const source = document.querySelector('#source-pill');
    if (source && Number(gcState?.clinical?.cgm?.length || 0) > 0) {
      source.textContent = 'Glooko-Export · lokal ausgewertet';
    }
    const badge = document.querySelector('#header-badge');
    if (badge && Number(gcState?.clinical?.cgm?.length || 0) > 0) {
      badge.textContent = `${formatNumber(gcState.clinical.cgm.length, 0)} lokale CGM-Werte · Glooko`;
    }
    const facts = [...document.querySelectorAll('#dataset-facts li')];
    const diaryFact = facts.find((item) => item.querySelector('span')?.textContent === 'Tagebucheinträge');
    if (diaryFact) {
      diaryFact.querySelector('span').textContent = 'Glooko-Mahlzeiten';
      diaryFact.querySelector('strong').textContent = String(glookoMeals.length);
    }
    const notice = document.querySelector('#recommendations .notice');
    if (notice) {
      notice.innerHTML = '<strong>Glooko als Datenerfassung:</strong> Empfehlungen entstehen aus dem lokal importierten Glooko-Export. GlucoseCoach übernimmt ausschließlich Deutung und Auswertung.';
    }
  }

  function updateQualitySource(mode, glookoMeals) {
    const body = document.querySelector('#quality-body');
    if (!body) return;
    let row = body.querySelector('tr[data-quality="glooko-source"]');
    if (!row) {
      row = document.createElement('tr');
      row.dataset.quality = 'glooko-source';
      body.appendChild(row);
    }
    row.innerHTML = mode === SOURCE_GLOOKO
      ? `<td>Mahlzeitenquelle</td><td>Glooko · ${glookoMeals.length} Einträge</td><td>Importierte Lebensmittel- und Kohlenhydratereignisse werden nur lokal gelesen und als schreibgeschützte Mahlzeiten analysiert.</td>`
      : '<td>Mahlzeitenquelle</td><td>lokales GlucoseCoach-Tagebuch</td><td>Glooko-Lebensmitteleinträge bleiben gespeichert, werden in diesem Modus aber nicht als Mahlzeitenanker verwendet.</td>';
  }

  function decorate(mode, localDiary, glookoMeals) {
    installStyles();
    ensureImportWorkflow();
    ensureSourceControl(mode, localDiary, glookoMeals);
    if (mode === SOURCE_GLOOKO) renderGlookoDiary(glookoMeals);
    updateOverviewSource(mode, glookoMeals);
    updateQualitySource(mode, glookoMeals);
  }

  function installBrowserPatch() {
    if (typeof document === 'undefined' || typeof gcRender !== 'function' || typeof gcState === 'undefined') return;

    const previousIllnessComparison = typeof illnessComparison === 'function'
      ? illnessComparison
      : null;
    if (previousIllnessComparison) {
      const knownIllnessComparison = (analyses) => previousIllnessComparison(
        safeArray(analyses).filter((analysis) => ['ja', 'nein'].includes(analysis?.entry?.illness)),
      );
      illnessComparison = knownIllnessComparison;
      if (typeof GlucoseCoachV3 !== 'undefined') {
        GlucoseCoachV3.illnessComparison = knownIllnessComparison;
      }
    }

    const previousRender = gcRender;
    gcRender = function renderWithGlookoMealSource() {
      const localDiary = safeArray(gcState.diary);
      const clinical = gcState.clinical && typeof gcState.clinical === 'object'
        ? gcState.clinical
        : {};
      const glookoMeals = buildGlookoMealEntries(clinical);
      const mode = resolveMealSource(localDiary, clinical, storedMealSource());
      const analysisDiary = buildAnalysisDiary(localDiary, clinical, mode);

      gcState.diary = analysisDiary;
      try {
        previousRender();
      } finally {
        gcState.diary = localDiary;
      }
      decorate(mode, localDiary, glookoMeals);
    };

    gcRender();
  }

  const api = {
    MEAL_SOURCE_KEY,
    SOURCE_LOCAL,
    SOURCE_GLOOKO,
    GLOOKO_CARBS_ASSOCIATION_MINUTES,
    inferMealOccasion,
    localDateTimeValue,
    buildGlookoMealEntries,
    buildAnalysisDiary,
    resolveMealSource,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.GlucoseCoachGlookoMode = api;
  installBrowserPatch();
})(typeof globalThis !== 'undefined' ? globalThis : this);
