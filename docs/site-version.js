(function (root) {
  'use strict';

  const build = Object.freeze({
    version: "2026.08.20.0",
    commit: "develop",
    builtAt: "2026-08-20T10:45:00Z",
  });
  root.GlucoseCoachBuild = build;

  function renderVersion() {
    const target = document.querySelector('#app-version');
    if (!target) return;
    const commit = build.commit ? ` · ${build.commit}` : '';
    target.textContent = `Version ${build.version}${commit}`;
    target.title = build.builtAt ? `Erzeugt: ${build.builtAt}` : '';
  }

  function ensureStyles() {
    if (document.querySelector('#site-version-styles')) return;
    const style = document.createElement('style');
    style.id = 'site-version-styles';
    style.textContent = `
      .header-meta { display:flex; flex-direction:column; align-items:flex-end; gap:8px; }
      .version-badge { font-size:.78rem; font-weight:600; opacity:.82; white-space:nowrap; }
      @media (max-width:720px) { .header-meta { align-items:flex-start; } }
    `;
    document.head.appendChild(style);
  }

  if (typeof document !== 'undefined') {
    ensureStyles();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', renderVersion, { once: true });
    } else renderVersion();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
