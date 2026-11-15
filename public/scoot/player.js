// Demo player for the landing page: a cursor taps through the real app, a caption under the phone says what's
// happening, a clock shows time passing, and the matching step in the example is highlighted. It uses the app's own
// buttons and the real AI checks. Pause/Resume and Stop sit in the bar under the phone.
const Demo = (() => {
  const phone = document.getElementById('phone');
  const W = ms => new Promise(r => setTimeout(r, ms));
  let run = 0, active = null, paused = false, cur, veil, clock;
  let pace = 1;                                   // 3 = the landing-page walkthroughs play at a third of the speed
  class Stopped extends Error { }
  const bar = () => document.getElementById('plbar');

  function ui() {
    if (cur) return;
    cur = document.createElement('div'); cur.className = 'pl-cursor';
    cur.innerHTML = '<span class="ring"></span><svg width="26" height="30" viewBox="0 0 26 30"><path d="M2 2 L2 24 L8 18.5 L12.5 28 L16.5 26.2 L12 16.8 L20 16.8 Z" fill="#fff" stroke="#16110f" stroke-width="2" stroke-linejoin="round"/></svg>';
    veil = document.createElement('div'); veil.className = 'pl-veil';            // keeps stray clicks out while a demo plays
    clock = document.createElement('div'); clock.className = 'pl-clock';
    clock.innerHTML = '<svg width="120" height="120" viewBox="0 0 120 120"><circle cx="60" cy="60" r="54" fill="none" stroke="#ffffff33" stroke-width="6"/>'
      + Array.from({ length: 12 }, (_, i) => `<line x1="60" y1="12" x2="60" y2="20" stroke="#ffffff88" stroke-width="3" transform="rotate(${i * 30} 60 60)"/>`).join('')
      + '<line class="hand hh" x1="60" y1="60" x2="60" y2="34" stroke="#FFCC00" stroke-width="6" stroke-linecap="round"/><line class="hand mh" x1="60" y1="60" x2="60" y2="20" stroke="#fff" stroke-width="4" stroke-linecap="round"/><circle cx="60" cy="60" r="5" fill="#fff"/></svg>'
      + '<div class="pl-time"></div><div class="pl-cap"></div>';
    phone.append(veil, clock, cur);
  }
  const scale = () => phone.getBoundingClientRect().width / 390;
  const live = tok => { if (tok !== run) throw new Stopped(); };
  const wait = async (ms, tok) => { for (let left = ms * pace; left > 0;) { await W(Math.min(100, left)); live(tok); if (!paused) left -= 100; } };   // time stands still while paused
  const say = text => { document.getElementById('pl-say').textContent = text; };

  async function find(sel, tok, ms = 20000) {
    for (let t = 0; t < ms; t += 150) {
      const el = typeof sel === 'function' ? sel() : [...document.querySelectorAll(sel)].find(e => e.offsetParent !== null && !e.disabled);
      if (el) return el;
      await wait(150, tok);
    }
    throw new Error('stuck waiting for ' + sel);
  }
  async function reveal(el, tok) {               // scroll the phone's own list so the target is on screen
    const sc = el.closest('.scroll'); if (!sc) return;
    const s = scale(), er = el.getBoundingClientRect(), sr = sc.getBoundingClientRect();
    if (er.top < sr.top + 30 || er.bottom > sr.bottom - 30) { sc.scrollTo({ top: sc.scrollTop + (er.top - sr.top) / s - sc.clientHeight / 2 + er.height / s / 2, behavior: 'smooth' }); await wait(500, tok); }
  }
  async function point(el, tok) {
    await reveal(el, tok);
    const s = scale(), p = phone.getBoundingClientRect(), r = el.getBoundingClientRect();
    cur.classList.add('on'); cur.style.transform = `translate(${(r.left + r.width / 2 - p.left) / s}px, ${(r.top + r.height / 2 - p.top) / s}px)`;
    await wait(750, tok);
  }
  async function tap(sel, tok, text) {
    if (text) say(text);
    const el = await find(sel, tok); await point(el, tok); await wait(text ? 500 : 150, tok);
    cur.classList.remove('tap'); void cur.offsetWidth; cur.classList.add('tap');
    el.click(); await wait(650, tok);
  }
  async function hover(sel, tok, text, ms = 1200) { if (text) say(text); const el = await find(sel, tok); await point(el, tok); await wait(ms, tok); }
  async function page(hash, tok) { await find(() => location.hash === hash ? document.body : null, tok); await wait(500, tok); }
  async function photo(tok, text) {               // demo photo -> real AI check -> Continue (or the review path after two tries)
    for (let i = 0; i < 3; i++) {
      await tap('#c-demo', tok, i ? 'Retakes the photo' : text);
      say('The AI is checking the photo…');
      await find(() => document.querySelector('#app .thinking') ? null : document.body, tok, 45000);
      const head = document.querySelector('#c-res .head');
      say('AI: ' + (head ? head.textContent.replace(/^AI/, '').replace(/[\d.]+s( · backup model)?$/, '') : 'done').trim());
      await wait(1800, tok);
      if (document.querySelector('#c-ok')) { await tap('#c-ok', tok, 'Continues'); return; }
    }
    throw new Error('photo check did not pass');
  }
  async function pass(min, caption, tok) {        // the clock animation, then the app's clock really moves on
    cur.classList.remove('on'); say(caption);
    const t1 = now(), d = new Date(t1), h0 = (d.getHours() % 12) * 30 + d.getMinutes() * 0.5, m0 = d.getMinutes() * 6;
    const hh = clock.querySelector('.hh'), mh = clock.querySelector('.mh'), tm = clock.querySelector('.pl-time');
    const draw = k => { const e = k < .5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2; hh.style.transform = `rotate(${h0 + min * .5 * e}deg)`; mh.style.transform = `rotate(${m0 + min * 6 * e}deg)`; tm.textContent = t(t1 + min * MIN * e); };
    clock.querySelector('.pl-cap').textContent = caption; draw(0);
    clock.classList.add('on'); await wait(400, tok);
    for (let k = 0; k < 1;) { await wait(40, tok); k = Math.min(1, k + 40 / 1800); draw(k); }   // pauses with the player
    S.skew = (S.skew || 0) + min * MIN; meter(); save(); render();
    await wait(800, tok); clock.classList.remove('on'); await wait(400, tok);
  }
  function mark(key, i) {                        // highlight step i of the example (the last index is the total line)
    const list = document.querySelector(`[data-case="${key}"]`); if (!list) return;
    [...list.children, list.parentElement.querySelector('.lp-total')].filter(Boolean).forEach((el, k) => el.classList.toggle('lp-now', k === i));
  }
  const at = (h, m) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.getTime(); };
  function fresh(h, m, user) {
    closeModal(); S.skew = at(h, m) - Date.now(); S = seed(); S.seededAt = Date.now();
    S.user = user; S.lastNetid = user.netid; S.agreed = true; S.license = { kind: 'Driver license', exp: '2029-08-14', at: now() };
  }
  const go2 = async (hash, tok) => { save(); if (location.hash === hash) render(); else location.hash = hash; await page(hash, tok); };

  async function ride(key, who, o, tok) {         // the shared renter flow: book, pick up, park at class, return
    mark(key, 0);
    await hover(`.veh[onclick*="#/v/${o.vid}'"]`, tok, `${who} opens SCoot and sees the scooters at the ${o.rackName} rack`, 900);
    await tap(`.veh[onclick*="#/v/${o.vid}'"]`, tok, `${who} taps ${o.start}`); await page('#/v/' + o.vid, tok);
    await hover('.foot [onclick^="A.book"]', tok, 'The price page: $5 for 2 hours + 2 miles, the curfew, and the hold', 1500);
    await tap('.foot [onclick^="A.book"]', tok, 'Taps Book');
    await tap('#modal [onclick^="A.confirm"]', tok, 'Confirms. 10 minutes to reach the rack'); await page('#/pickup', tok);
    await pass(5, `${who} walks down to the ${o.rackName} rack`, tok);
    mark(key, 1);
    await tap('[onclick="A.scan()"]', tok, 'Scans the SCoot sticker on the rack');
    await photo(tok, 'Takes a photo of the battery display');
    await photo(tok, 'Takes the “before” photo of the whole scooter');
    await tap('[onclick="A.unlock()"]', tok, 'Unlocks the padlock from the phone. Billing starts'); await page('#/ride', tok);
    await hover('.timer', tok, 'The ride screen: free time left, battery estimate and cost so far', 1800);
    await pass(o.toPark, `Riding to ${o.parkName}`, tok);
    mark(key, 2);
    await tap('[onclick="go(\'#/park\')"]', tok, `Locks it at the ${o.parkName} rack`); await page('#/park', tok);
    await tap(`[onclick="A.parkPick('${o.park}')"]`, tok, `Picks the ${o.parkName} rack`);
    await photo(tok, 'Takes a photo of it chained to the rack'); await page('#/ride', tok);
    await pass(o.atClass.min, o.atClass.text, tok);
    mark(key, 3);
    await tap('[onclick="A.unpark()"]', tok, 'Unlocks it with the phone again');
    if (o.after) o.after();
    await pass(o.back.min, o.back.text, tok);
    mark(key, o.back.mark || 3);
    await tap('[onclick="A.startReturn()"]', tok, `Back at the ${o.rackName} rack: starts the return`); await page('#/return', tok);
    await tap('[onclick="A.rscan()"]', tok, 'Scans the same rack’s sticker');
    await photo(tok, 'Photo of the battery, so the owner knows what’s left');
    await photo(tok, 'Chains it up and takes one photo with the lock showing');
    await tap('[onclick="A.finish()"]', tok, 'Ends the rental'); await page('#/receipt', tok);
  }

  const STORIES = {
    async tommy(tok) {
      fresh(12, 30, { netid: 'ttrojan', name: 'Tommy', dorm: 'IRC' });
      Object.assign(S.vehicles.find(v => v.id === 'v1'), { battery: 84, until: at(19, 0), status: 'available' });
      await go2('#/home', tok);
      await ride('tommy', 'Tommy', { vid: 'v1', rackName: 'IRC', start: 'Maya’s scooter, Big Red', park: 'VILLAGE', parkName: 'the Village gym', toPark: 5,
        atClass: { min: 60, text: 'Tommy works out at the gym' }, back: { min: 5, text: 'Riding back to IRC' } }, tok);
      mark('tommy', 4); await hover('#app .card', tok, 'Receipt: 1 h 10 min, 1.4 miles, so $5. Maya gets $3.50', 2500);
    },
    async priya(tok) {
      fresh(9, 30, { netid: 'priyas', name: 'Priya', dorm: 'WEBB' });
      Object.assign(S.vehicles.find(v => v.id === 'v20'), { rate: { base: 5, hr: 2, mi: 2 }, battery: 86, until: at(14, 30), status: 'available' });
      await go2('#/home', tok);
      await ride('priya', 'Priya', { vid: 'v20', rackName: 'Webb', start: 'Ben’s scooter', park: 'RTH', parkName: 'Tutor Hall', toPark: 10,
        atClass: { min: 245, text: 'Four hours of class' },
        after: () => { S.booking.legGps = 2.3; S.booking.gpsUsed = true; },   // her phone's GPS logs the trip to 30th Street and back
        back: { min: 60, text: 'To a friend’s place on 30th Street and back. The curfew passes', mark: 4 } }, tok);
      mark('priya', 5); await hover('#app .card', tok, 'Receipt: 4 extra hours, 1 extra mile and the $15 late fee: $30', 2500);
    },
    async maya(tok) {
      fresh(12, 20, { netid: 'mayal', name: 'Maya', dorm: 'IRC' });
      Object.assign(S.mine, { name: 'Big Red', model: 'Segway Ninebot Max G30', rental: null, listed: false, week: [3.5, 7.7, 0, 4.9, 0, 0, 0], balance: 16.1, kitPaid: 31.5 });
      await go2('#/garage', tok);
      mark('maya', 0);
      await tap('[onclick="A.addVehicle()"]', tok, 'Maya opens her Garage and adds her scooter');
      await hover('#pick-smart', tok, 'She picks the smart padlock and chain, nothing to pay up front', 1400);
      await tap('#pick-smart', tok, 'Requests her lock kit');
      mark('maya', 1);
      await hover('#rate-base', tok, 'Sets her prices: $5 to start…', 900); await hover('#rate-hr', tok, '…$2 per extra hour…', 700); await hover('#rate-mi', tok, '…$2 per extra mile', 700);
      await hover('.days', tok, 'Rentable weekdays, 9 AM to 6 PM', 1200);
      await tap('button.toggle', tok, 'Turns on “Rent it out”');
      await pass(15, 'Maya walks to class. Tommy books Big Red.', tok);
      mark('maya', 2);
      S.mine.rental = { renter: 'Tommy K.', renterDorm: 'IRC', start: now(), end: at(19, 0), earn: 3.5, at: 'IRC', state: 'riding' }; save(); render();
      await hover('.card .pulse', tok, 'She sees who has it and when it’s due back, not where he parks', 2200);
      await pass(70, 'Tommy rides to the gym and back', tok);
      mark('maya', 3);
      A.ownerReturn(); await page('#/garage', tok);
      await hover('.big-earn', tok, 'Tommy returned it: +$3.50. This week: 4 rentals, $19.60', 2200);
      await tap('.btn.gold[onclick="go(\'#/wallet\')"]', tok, 'Taps Cash out'); await page('#/wallet', tok);
      await tap('[onclick="A.cashout()"]', tok, 'Sends $19.60 to her bank (simulated)');
      await pass(Math.round((at(22, 0) - now()) / MIN), 'That night', tok);
      mark('maya', 4);
      await tap('.tabbar [onclick="go(\'#/garage\')"]', tok, 'Back to the Garage'); await page('#/garage', tok);
      await tap('button.toggle', tok, 'Pauses rentals and takes it inside to charge');
      mark('maya', 5); await hover('.gauge', tok, 'Each ride pays off a little more of her lock. Then she keeps 90%', 2500);
    },
  };

  function reset(key) {
    cur && cur.classList.remove('on', 'tap'); veil && veil.classList.remove('on'); clock && clock.classList.remove('on');
    bar().classList.remove('on'); paused = false; document.getElementById('pl-pause').textContent = '❚❚';
    document.querySelectorAll('.lp-play').forEach(b => { b.textContent = b.dataset.label; });
    if (key) mark(key, -1);
    active = null;
  }
  async function play(key) {
    if (active === key) return pause();            // the card's button doubles as pause/resume
    if (active) { const was = active; run++; reset(was); }
    ui(); const tok = ++run; active = key; paused = false; pace = 3; cur.classList.add('slow');
    const btn = document.querySelector(`.lp-play[data-story="${key}"]`); btn.textContent = '❚❚ Pause';
    veil.classList.add('on'); bar().classList.add('on'); say('Starting…');
    const card = btn.closest('.lp-case');
    if (getComputedStyle(document.getElementById('phonewrap')).position === 'sticky') window.scrollTo({ top: card.getBoundingClientRect().top + scrollY - 24, behavior: 'smooth' });
    else document.getElementById('phonewrap').scrollIntoView({ behavior: 'smooth' });
    try { await STORIES[key](tok); await W(600); if (tok === run) reset(key); }
    catch (e) { if (!(e instanceof Stopped) && tok === run) { reset(key); toast('The demo hit a snag. Tap Play to try again.'); console.error(e); } }
  }
  function pause() {
    if (!active) return;
    paused = !paused;
    document.getElementById('pl-pause').textContent = paused ? '▶' : '❚❚';
    const btn = document.querySelector(`.lp-play[data-story="${active}"]`); if (btn) btn.textContent = paused ? '▶ Resume' : '❚❚ Pause';
  }
  function stop() { if (!active) return; const was = active; run++; reset(was); }
  // Time-skip button for pages where the viewer taps through the app themselves: the clock animation, then the app's clock moves.
  // Resolves true when the time really passed, false if it was interrupted (another skip, Start over, Stop).
  async function skip(min, caption) {
    if (active) stop();
    ui(); const tok = ++run; active = 'skip'; veil.classList.add('on'); pace = 1; cur.classList.remove('slow');
    try { await pass(min, caption, tok); return true; } catch (e) { if (!(e instanceof Stopped)) throw e; return false; } finally { if (tok === run) { veil.classList.remove('on'); active = null; } }
  }
  document.querySelectorAll('.lp-play').forEach(b => b.dataset.label = b.textContent);
  return { play, pause, stop, skip };
})();
