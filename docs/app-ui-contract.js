(function () {
  'use strict';

  const SUPPORTED_OMNIPOD_TYPE_COUNT = 12;
  const METHODOLOGICAL_BOUNDARY =
    'Ein CGM-Kurvenproxy ist kein direkter pharmakologischer Wirkeintritt und keine Dosisempfehlung.';

  if (typeof module !== 'undefined' && module.exports && typeof document === 'undefined') {
    module.exports = { SUPPORTED_OMNIPOD_TYPE_COUNT, METHODOLOGICAL_BOUNDARY };
    return;
  }

  if (typeof document === 'undefined' || typeof gcQuality !== 'function' || typeof gcRender !== 'function') return;

  const previousQuality = gcQuality;
  gcQuality = function fullImportQuality() {
    previousQuality();
    const rows = [...document.querySelectorAll('#quality-body tr')];
    const row = rows.find((candidate) => candidate.cells?.[0]?.textContent?.trim() === 'Omnipod-Dateitypen');
    if (!row) return;
    row.cells[1].textContent = `${SUPPORTED_OMNIPOD_TYPE_COUNT} unterstützt`;
    row.cells[2].textContent = 'CGM, Bolus, Tagesinsulin, Basal, manuelle Glukose, Alarme/Ereignisse, CGM-Kohlenhydrate, Sport, Lebensmittel, manuelles Insulin, Medikamente und Notizen werden getrennt erkannt.';
  };

  gcRender();
})();
