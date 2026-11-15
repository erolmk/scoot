// Site analytics: page views, every click, app screens and form changes, sent in batches to /scoot/api/track (stored in D1).
// Password fields are never recorded and photos never leave the photo checks. The Ask SCoot AI chat is logged on the server.
(() => {
  const sid = (() => { try { let s = sessionStorage.getItem('scoot.sid'); if (!s) { s = Math.random().toString(36).slice(2) + Date.now().toString(36); sessionStorage.setItem('scoot.sid', s); } return s; } catch { return 'nostorage'; } })();
  window.SCOOT_SID = sid;
  const q = [];
  const flush = () => {
    if (!q.length) return;
    const body = JSON.stringify({ sid, events: q.splice(0, 60) });
    if (!(navigator.sendBeacon && navigator.sendBeacon('/scoot/api/track', body))) fetch('/scoot/api/track', { method: 'POST', body, keepalive: true }).catch(() => { });
  };
  const track = window.track = (type, target, detail) => {
    q.push({ t: Date.now(), page: location.pathname + location.hash, type, target: target == null ? null : String(target).slice(0, 200), detail: detail == null ? null : String(detail).slice(0, 500) });
    if (q.length >= 40) flush();
  };
  const label = el => (el.getAttribute('aria-label') || el.innerText || el.value || el.id || el.getAttribute('class') || el.tagName).replace(/\s+/g, ' ').trim().slice(0, 120);
  track('pageview', document.title, document.referrer || null);
  addEventListener('click', e => {
    const el = e.target.closest('button, a, [onclick], input, select, label, .veh, .list-btn, li, h1, h2, h3, p, img') || e.target;
    track('click', label(el), (el.id ? '#' + el.id + ' ' : '') + (el.closest('#phone') ? 'in phone' : 'on page'));
  }, true);
  addEventListener('change', e => {
    const el = e.target; if (!el.matches || !el.matches('input, select, textarea')) return;
    track('change', el.id || el.name || el.type, el.type === 'password' ? '(not recorded)' : el.type === 'file' ? 'file chosen' : String(el.value).slice(0, 60));
  }, true);
  addEventListener('hashchange', () => track('screen', location.hash));
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { track('hidden'); flush(); } });
  addEventListener('pagehide', flush);
  setInterval(flush, 5000);
})();
