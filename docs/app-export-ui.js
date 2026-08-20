(function (root) {
  'use strict';

  const PROFILE_KEY = 'glucosecoach-profile-v1';
  const VALID_WINDOWS = new Set(['7', '14', '30', '90', 'all']);

  function safeArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function readProfile() {
    try {
      const parsed = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function normalizedClinical(value = gcState.clinical) {
    if (
      typeof GlucoseCoachV3 !== 'undefined' &&
      typeof GlucoseCoachV3.normalizeClinical === 'function'
    ) {
      return GlucoseCoachV3.normalizeClinical(value || {});
    }
    return value || {};
  }

  function currentPayload() {
    return {
      profile: readProfile(),
      ui: { windowDays: gcState.windowDays },
      diary: safeArray(gcState.diary),
      clinical: normalizedClinical(),
    };
  }

  function downloadText(filename, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function dateFilenamePart() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  function restoreCompleteCsv(payload) {
    gcState.diary = safeArray(payload.diary);
    gcState.clinical = normalizedClinical(payload.clinical);
    const profile = payload.profile && typeof payload.profile === 'object' ? payload.profile : {};
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));

    const requested = String(payload.ui?.windowDays ?? '90');
    gcState.windowDays = VALID_WINDOWS.has(requested) ? requested : '90';
    const select = document.querySelector('#window-days');
    if (select) select.value = gcState.windowDays;

    gcState.lastImport = null;
    gcSave();
    gcRender();
    if (typeof gcShow === 'function') gcShow('overview');
  }

  function ensureExportControls() {
    const api = root.GlucoseCoachExport;
    const csvButton = document.querySelector('#export-all');
    const csvInput = document.querySelector('#import-complete-csv');
    if (!api || !csvButton || !csvInput) return;

    csvButton.textContent = 'Vollständige CSV herunterladen';
    csvButton.onclick = () => {
      downloadText(
        `glucosecoach-vollstaendig-${dateFilenamePart()}.csv`,
        api.buildCompleteCsv(currentPayload()),
        'text/csv;charset=utf-8',
      );
    };

    if (csvInput.dataset.completeCsvHandler !== 'true') {
      csvInput.dataset.completeCsvHandler = 'true';
      csvInput.onchange = async (event) => {
        const progress = document.querySelector('#complete-csv-progress');
        try {
          const file = event.target.files?.[0];
          if (!file) return;
          const payload = api.parseCompleteCsv(await file.text());
          restoreCompleteCsv(payload);
          if (progress) {
            progress.textContent =
              `Wiederhergestellt: ${payload.diary.length} Tagebucheinträge und ` +
              `${payload.clinical.cgm.length} CGM-Werte aus ${file.name}.`;
          }
        } catch (error) {
          if (progress) progress.textContent = `Wiederherstellung fehlgeschlagen: ${error.message}`;
          else alert(error.message);
        }
        event.target.value = '';
      };
    }
  }

  function removeLegacyJsonControls() {
    for (const selector of [
      '#export-all-json',
      '#export-diary',
      '#import-diary',
      '#import-all',
    ]) {
      const element = document.querySelector(selector);
      if (!element) continue;
      const label = element.closest('label');
      if (label) label.remove();
      else element.remove();
    }
  }

  function installBrowserPatch() {
    if (typeof document === 'undefined' || typeof gcRender !== 'function') return;
    const previousRender = gcRender;
    gcRender = function renderWithCompleteCsv() {
      previousRender();
      removeLegacyJsonControls();
      ensureExportControls();
    };
    removeLegacyJsonControls();
    ensureExportControls();
  }

  if (typeof document !== 'undefined') installBrowserPatch();
})(typeof globalThis !== 'undefined' ? globalThis : this);
