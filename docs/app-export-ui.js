(function (root) {
  'use strict';

  const PROFILE_KEY = 'glucosecoach-profile-v1';

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

  function normalizedClinical() {
    if (
      typeof GlucoseCoachV3 !== 'undefined' &&
      typeof GlucoseCoachV3.normalizeClinical === 'function'
    ) {
      return GlucoseCoachV3.normalizeClinical(gcState.clinical || {});
    }
    return gcState.clinical || {};
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

  function ensureExportControls() {
    const api = root.GlucoseCoachExport;
    const csvButton = document.querySelector('#export-all');
    if (!api || !csvButton) return;

    csvButton.textContent = 'Vollständige CSV herunterladen';
    csvButton.onclick = () => {
      downloadText(
        `glucosecoach-vollstaendig-${dateFilenamePart()}.csv`,
        api.buildCompleteCsv(currentPayload()),
        'text/csv;charset=utf-8',
      );
    };

    let jsonButton = document.querySelector('#export-all-json');
    if (!jsonButton) {
      jsonButton = document.createElement('button');
      jsonButton.type = 'button';
      jsonButton.id = 'export-all-json';
      jsonButton.className = 'secondary';
      csvButton.insertAdjacentElement('afterend', jsonButton);
    }
    jsonButton.textContent = 'Gesamtsicherung (JSON)';
    jsonButton.onclick = () => {
      downloadText(
        `glucosecoach-gesamtsicherung-${dateFilenamePart()}.json`,
        JSON.stringify(api.buildBackupPayload(currentPayload()), null, 2),
        'application/json;charset=utf-8',
      );
    };

    const backupInput = document.querySelector('#import-all');
    if (!backupInput || backupInput.dataset.completeBackupHandler === 'true') return;
    backupInput.dataset.completeBackupHandler = 'true';
    backupInput.onchange = async (event) => {
      try {
        const file = event.target.files?.[0];
        if (!file) return;
        const payload = JSON.parse(await file.text());
        if (!Array.isArray(payload.diary) || !payload.clinical) {
          throw new Error('Ungültige Gesamtsicherung');
        }
        gcState.diary = payload.diary;
        gcState.clinical = (
          typeof GlucoseCoachV3 !== 'undefined' &&
          typeof GlucoseCoachV3.normalizeClinical === 'function'
        ) ? GlucoseCoachV3.normalizeClinical(payload.clinical) : payload.clinical;
        if (payload.profile && typeof payload.profile === 'object') {
          localStorage.setItem(PROFILE_KEY, JSON.stringify(payload.profile));
        }
        if (payload.ui?.windowDays !== undefined) {
          const requested = String(payload.ui.windowDays);
          gcState.windowDays = ['7', '14', '30', '90', 'all'].includes(requested)
            ? requested
            : '90';
          const select = document.querySelector('#window-days');
          if (select) select.value = gcState.windowDays;
        }
        gcState.lastImport = null;
        gcSave();
        gcRender();
      } catch (error) {
        alert(error.message);
      }
      event.target.value = '';
    };
  }

  function installBrowserPatch() {
    if (typeof document === 'undefined' || typeof gcRender !== 'function') return;
    const previousRender = gcRender;
    gcRender = function renderWithCompleteExport() {
      previousRender();
      ensureExportControls();
    };
    ensureExportControls();
  }

  if (typeof document !== 'undefined') installBrowserPatch();
})(typeof globalThis !== 'undefined' ? globalThis : this);
