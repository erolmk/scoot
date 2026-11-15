// "Ask SCoot AI" chat bubble: questions go to /scoot/api/ask, which answers from SCoot's documents with Claude Opus 5.5.
(() => {
  const $ = s => document.getElementById(s), hist = [];
  const open = $('ask-open'), panel = $('ask-panel'), log = $('ask-log'), form = $('ask-form'), inp = $('ask-in');
  if (!open) return;
  const add = (cls, text) => { const d = document.createElement('div'); d.className = 'ask-msg ' + cls; d.textContent = text; log.appendChild(d); log.scrollTop = log.scrollHeight; return d; };
  const show = on => { panel.hidden = !on; open.setAttribute('aria-expanded', on); if (on) inp.focus(); };
  open.onclick = () => show(panel.hidden);
  $('ask-close').onclick = () => show(false);
  let busy = false;
  form.onsubmit = async e => {
    e.preventDefault();
    const q = inp.value.trim(); if (!q || busy) return;
    busy = true; inp.value = ''; add('me', q); hist.push({ role: 'user', content: q });
    const wait = add('bot wait', 'Thinking…');
    let a = "Sorry, I couldn't reach the server. Try again in a moment.", ok = false;
    try {
      const r = await fetch('/scoot/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: hist.slice(-12), sid: window.SCOOT_SID }) });
      const j = await r.json();
      ok = !!j.ok;
      a = j.ok ? j.answer : j.error === 'rate_limited' ? 'Too many questions from this device. Try again in a few minutes.' : "Sorry, I couldn't answer that right now.";
    } catch { }
    wait.remove(); add('bot', a);
    if (ok) hist.push({ role: 'assistant', content: a }); else hist.pop();
    busy = false;
  };
})();
