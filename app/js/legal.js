// Rellena en las páginas legales los datos del responsable de esta instalación (los da el servidor).
fetch('/api/legal', { cache: 'no-store', credentials: 'omit' })
  .then(r => r.ok ? r.json() : null)
  .then(d => {
    if (!d) return;
    const set = (key, value) => document.querySelectorAll(`[data-legal="${key}"]`).forEach(el => { if (value) el.textContent = value; });
    set('operator', d.operator);
    set('contact', d.contact);
    set('policy', d.policyVersion);
    set('version', d.version && 'v' + d.version);
  })
  .catch(() => { /* sin conexión: se muestra el texto por defecto */ });
