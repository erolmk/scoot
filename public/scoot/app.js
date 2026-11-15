/* SCoot — prototype app. Demo data lives in localStorage; AI checks call the real server (/rideon/api/check). */
'use strict';
const API = '/scoot/api';
const $ = s => document.querySelector(s);
const app = $('#app');
const KEY = 'rideon.v1';

/* ---------- time + format helpers ---------- */
const MIN = 60000, HOUR = 60 * MIN;
const now = () => Date.now() + (S.skew || 0);           // demo fast-forward shifts the clock
const t = ms => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const money = n => '$' + (Math.round(n * 100) / 100).toFixed(2);
const dur = ms => { const m = Math.max(0, Math.round(ms / MIN)); return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m} min`; };
const clock = ms => { const s = Math.max(0, Math.floor(Math.abs(ms) / 1000)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// ponytail: demo-only — late at night the 11 PM no-overnight cap would hide every ride, so the demo shifts the cap; real app keeps 11 PM
const endOfDay = () => { const e = todayAt(LAST_RETURN_HOUR); return e - now() >= 4 * HOUR ? e : roundUp30(now() + 6 * HOUR); };
const roundUp30 = ms => Math.ceil(ms / (30 * MIN)) * 30 * MIN;
const todayAt = h => { const d = new Date(now()); d.setHours(h, 0, 0, 0); return d.getTime(); };
function miles(a, b) { const R = 3958.8, r = x => x * Math.PI / 180; const dl = r(b.lat - a.lat), dn = r(b.lng - a.lng); const q = Math.sin(dl / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(q)) * 1.3; } // 1.3 = paths are not straight lines

/* ---------- rules (from the design rulebook) ---------- */
// Pricing: each owner sets a start price (covers the first 2 hours + 2 miles; the minimum rental), a price per started
// extra hour and a price per started extra mile. The curfew is the owner's back-by time; missing it adds a one-time $10.
const PRICING = { inclHours: 2, inclMiles: 2, curfewFee: 10 }, RATE0 = { base: 5, hr: 2, mi: 2 };
const rateOf = v => v.rate || RATE0;
const MIN_BOOK = 45 * MIN;                                   // need at least this long before the owner's curfew to book
const rideMiles = b => Math.max(b.miles || 0, b.gpsMiles || 0);
function bill(b, endTs) {
  const rt = b.rate || RATE0, hours = Math.max(0, (endTs - (b.startedAt || b.created)) / HOUR), mi = rideMiles(b);
  const xh = Math.max(0, Math.ceil(hours - PRICING.inclHours - 1e-9)), xm = Math.max(0, Math.ceil(mi - PRICING.inclMiles - 1e-9));
  const late = endTs > b.end ? PRICING.curfewFee : 0;
  return { hours, mi, xh, xm, late, rt, total: rt.base + xh * rt.hr + xm * rt.mi + late };
}
// Battery estimate: the last AI photo reading minus miles ridden x this scooter's drain per mile.
// Drain starts at 100% / full-charge range and is re-learned from the before/after photos of every ride.
const drainOf = v => v.drain || 100 / RANGE[v.range].full;
const estBatt = (b, v) => Math.max(0, Math.round(b.pickupBattery - rideMiles(b) * drainOf(v)));
const HOLD = { e: 25, bike: 10 };
const OWNER_SHARE = 0.7;
const RANGE = { long: { full: 25, min: 40, label: 'Long range' }, medium: { full: 15, min: 50, label: 'Medium range' }, short: { full: 10, min: 60, label: 'Short range' } };
const RETURN_FLOOR = 20;
const LAST_RETURN_HOUR = 23;                                // no overnight rentals
const isE = v => v.type !== 'bike';
const cls = v => isE(v) ? 'e' : 'bike';

/* ---------- places (real coordinates, OpenStreetMap) ---------- */
const RACKS = [
  { id: 'IRC', name: 'IRC Parkside', sub: 'International Residential College', lat: 34.01918, lng: -118.29087 },
  { id: 'LYON', name: 'Lyon Center', sub: 'Gym · 34th & McClintock', lat: 34.02428, lng: -118.28855 },
  { id: 'LEAVEY', name: 'Leavey Library', sub: 'Hoover side racks', lat: 34.02163, lng: -118.28306 },
  { id: 'VILLAGE', name: 'USC Village', sub: 'McCarthy Honors', lat: 34.02552, lng: -118.28525 },
  { id: 'BIRN', name: 'Birnkrant', sub: 'Residential college', lat: 34.02138, lng: -118.28214 },
  { id: 'WEBB', name: 'Webb Tower', sub: '34th Street', lat: 34.02448, lng: -118.28755 },
  { id: 'MARKS', name: 'Marks & Pardee', sub: 'Hellman Way', lat: 34.01985, lng: -118.28225 },
  { id: 'RTH', name: 'Tutor Hall', sub: 'Viterbi · McClintock', lat: 34.02018, lng: -118.28963 },
  { id: 'CARD', name: 'Cardinal Gardens', sub: 'North of 32nd', lat: 34.02605, lng: -118.28715 },
];
const rack = id => RACKS.find(r => r.id === id);
const ROUTES_BLOCKED = 'Hahn Plaza and campus intersections are walk-only zones (DPS tickets).';

/* ---------- state ---------- */
let S = { skew: 0 };
function seed() {
  const n = now(), until = h => Math.min(roundUp30(n + h * HOUR), endOfDay() || n + h * HOUR);
  const O = (name, color, dorm) => ({ name, initials: name.slice(0, 2).toUpperCase(), color, dorm });
  return {
    v: 1, skew: 0, user: null, license: null, agreed: false, filter: 'all', rackFilter: null,
    vehicles: [
      { id: 'v1', rate: { base: 5, hr: 2, mi: 2 }, name: 'Big Red', model: 'Segway Ninebot Max G30', type: 'scooter', range: 'long', rack: 'IRC', owner: O('Maya', '#7c3aed', 'IRC'), battery: 84, battAgo: 18, status: 'available', until: until(6), rating: 4.9, trips: 37, color: '#990000' },
      { id: 'v2', rate: { base: 4, hr: 1.5, mi: 1.5 }, name: 'Gold Rush', model: 'Hiboy S2 Pro', type: 'scooter', range: 'medium', rack: 'IRC', owner: O('Dev', '#0891b2', 'IRC'), battery: 72, battAgo: 41, status: 'available', until: until(3), rating: 4.8, trips: 22, color: '#d4a300' },
      { id: 'v3', rate: { base: 3, hr: 1, mi: 1 }, name: 'Fixie Fight On', model: 'State Bicycle 6061', type: 'bike', range: null, rack: 'IRC', owner: O('Sam', '#059669', 'IRC'), battery: null, status: 'available', until: until(8), rating: 5.0, trips: 15, color: '#1f2937' },
      { id: 'v4', rate: { base: 5, hr: 2, mi: 2 }, name: 'Pump', model: 'Xiaomi Scooter 4 Pro', type: 'scooter', range: 'long', rack: 'LYON', owner: O('Ava', '#db2777', 'Webb'), battery: 66, battAgo: 25, status: 'available', until: until(4), rating: 4.7, trips: 19, color: '#374151' },
      { id: 'v5', rate: { base: 6, hr: 2, mi: 2 }, name: 'Doheny Dash', model: 'NIU KQi3 Pro', type: 'scooter', range: 'medium', rack: 'LEAVEY', owner: O('Leo', '#ea580c', 'Birnkrant'), battery: 91, battAgo: 9, status: 'available', until: until(5), rating: 4.9, trips: 51, color: '#b91c1c' },
      { id: 'v6', rate: { base: 7, hr: 3, mi: 2 }, name: 'Conquest', model: 'Rad Power RadMission e-bike', type: 'ebike', range: 'long', rack: 'VILLAGE', owner: O('Priya', '#2563eb', 'McCarthy'), battery: 58, battAgo: 33, status: 'available', until: until(6), rating: 4.8, trips: 12, color: '#0f766e' },
      { id: 'v7', rate: { base: 2, hr: 1, mi: 0.5 }, name: 'Hellman Hauler', model: 'Trek FX 1', type: 'bike', range: null, rack: 'MARKS', owner: O('Nate', '#9333ea', 'Marks'), battery: null, status: 'available', until: until(7), rating: 4.6, trips: 9, color: '#475569' },
      { id: 'v8', rate: { base: 4, hr: 1.5, mi: 2 }, name: 'Little Wheelie', model: 'Segway Ninebot E2', type: 'scooter', range: 'short', rack: 'WEBB', owner: O('Jules', '#ca8a04', 'Webb'), battery: 45, battAgo: 52, status: 'available', until: until(4), rating: 4.5, trips: 8, color: '#64748b' },
      { id: 'v9', rate: { base: 5, hr: 2, mi: 2 }, name: 'Viterbi Vroom', model: 'Segway Ninebot Max G30', type: 'scooter', range: 'long', rack: 'RTH', owner: O('Kai', '#16a34a', 'Parkside'), battery: 77, battAgo: 14, status: 'available', until: until(5), rating: 4.9, trips: 30, color: '#7f1d1d' },
      { id: 'v10', rate: { base: 6, hr: 2.5, mi: 2 }, name: 'Spirit', model: 'Apollo City Pro', type: 'scooter', range: 'long', rack: 'BIRN', owner: O('Mia', '#be123c', 'Birnkrant'), battery: 88, battAgo: 6, status: 'available', until: until(6), rating: 5.0, trips: 44, color: '#990000' },
    ],
    mine: {
      id: 'mine', rate: { base: 5, hr: 2, mi: 2 }, name: 'Traveler', model: 'Segway Ninebot Max G30P', type: 'scooter', range: 'long', rack: 'IRC', battery: 61, color: '#990000',
      listed: true, days: [1, 1, 1, 1, 1, 0, 0], from: '09:00', to: '18:00', needBy: null,
      rental: { renter: 'Jordan K.', renterDorm: 'IRC', start: n - 70 * MIN, end: n + 4 * HOUR, earn: 3.5, at: 'LEAVEY', state: 'parked' },
      kit: { lockBatt: 82, lockClosed: true, tagPing: 2, decal: 'DPS-UPC-48213' },
      week: [3.5, 7.7, 0, 3.5, 4.9, 0, 0], history: [
        { who: 'Ava R.', hrs: '1 h 20 m · 1.4 mi', earn: 3.5, ago: '1 day ago', checks: 'Battery 31% · parked · no new damage' },
        { who: 'Dev P.', hrs: '4 h 40 m · 1.1 mi', earn: 7.7, ago: '2 days ago', checks: 'Battery 24% · parked · no new damage' },
        { who: 'Jordan K.', hrs: '50 m · 0.8 mi', earn: 3.5, ago: '3 days ago', checks: 'Battery 52% · parked · no new damage' },
      ], balance: 19.6,
    },
    booking: null, trips: [], wallet: [{ d: 'Traveler rentals this week', a: 19.6, ago: 'this week' }],
    reports: [],
  };
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { } }
function load() { try { const x = JSON.parse(localStorage.getItem(KEY)); return x && x.v === 1 ? x : null; } catch { return null; } }
S = load() || seed();
// ponytail: demo data has fixed times; if the page is opened hours later, refresh vehicle times so rides are bookable again
if (!S.seededAt) S.seededAt = Date.now();
if (Date.now() - S.seededAt > 2 * HOUR && !S.booking) { const f = seed(); S.vehicles = f.vehicles; if (S.mine.rental) S.mine.rental = f.mine.rental; S.seededAt = Date.now(); S.skew = 0; }

/* ---------- toast + modal ---------- */
let toastT;
function toast(msg) { const el = $('#toast'); el.textContent = msg; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 2600); }
function modal(html) { closeModal(); const bg = document.createElement('div'); bg.className = 'modal-bg'; bg.id = 'modal'; bg.innerHTML = `<div class="modal"><div class="grab" style="width:40px;height:5px;border-radius:3px;background:#d8d0cb;margin:0 auto 14px"></div>${html}</div>`; bg.onclick = e => { if (e.target === bg) closeModal(); }; app.appendChild(bg); }
function closeModal() { const m = $('#modal'); if (m) m.remove(); }

/* ---------- art ---------- */
function art(v, size = 50) {
  const c = v.color || '#990000';
  if (v.type === 'bike' || v.type === 'ebike') return `<svg viewBox="0 0 120 90" width="${size}" height="${size}"><circle cx="28" cy="62" r="20" fill="none" stroke="#222" stroke-width="5"/><circle cx="92" cy="62" r="20" fill="none" stroke="#222" stroke-width="5"/><path d="M28 62 L50 30 L82 30 L92 62 M50 30 L62 62 L82 30 M62 62 L28 62" stroke="${c}" stroke-width="5" fill="none" stroke-linejoin="round"/><path d="M48 24 h12 M82 30 l-4 -12 h10" stroke="#222" stroke-width="4" stroke-linecap="round" fill="none"/>${v.type === 'ebike' ? '<rect x="50" y="36" width="18" height="9" rx="3" fill="#FFCC00" stroke="#222" stroke-width="1.5" transform="rotate(30 59 40)"/>' : ''}</svg>`;
  return `<svg viewBox="0 0 120 90" width="${size}" height="${size}"><circle cx="24" cy="72" r="13" fill="#1d1d1d"/><circle cx="24" cy="72" r="5" fill="#aaa"/><circle cx="96" cy="72" r="13" fill="#1d1d1d"/><circle cx="96" cy="72" r="5" fill="#aaa"/><path d="M26 64 H86 L96 72" stroke="${c}" stroke-width="8" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M92 70 L80 12" stroke="${c}" stroke-width="7" stroke-linecap="round"/><path d="M69 11 H92" stroke="#1d1d1d" stroke-width="6" stroke-linecap="round"/><rect x="34" y="58" width="44" height="6" rx="3" fill="#2b2b2b"/></svg>`;
}
const ICON = {
  ride: '<svg viewBox="0 0 24 24"><circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><path d="M6 17h9l3-11h3M9 17l3-6"/></svg>',
  garage: '<svg viewBox="0 0 24 24"><path d="M3 10l9-6 9 6v10H3z"/><path d="M7 20v-6h10v6"/></svg>',
  wallet: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="14" rx="3"/><path d="M3 10h18M16 15h2"/></svg>',
  me: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
  lock: '<svg viewBox="0 0 64 64"><rect x="14" y="28" width="36" height="28" rx="6"/><path class="shackle" d="M22 28V20a10 10 0 0 1 20 0v8"/><circle cx="32" cy="42" r="3"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></svg>',
};
const battColor = p => p == null ? '#888' : p >= 50 ? '#16a34a' : p >= 25 ? '#d97706' : '#dc2626';
const battChip = p => p == null ? '<span class="battbar muted">No battery · pedal</span>' : `<span class="battbar" style="color:${battColor(p)}"><i style="--p:${p}"></i>${p}%</span>`;

/* ---------- demo photos (drawn on a canvas; the AI reads these like real photos) ---------- */
function cvs(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function rr(x, a, b, w, h, r) { x.beginPath(); x.roundRect(a, b, w, h, r); }
function photoDisplay(pct) {
  const [c, x] = cvs(960, 720);
  const g = x.createLinearGradient(0, 0, 0, 720); g.addColorStop(0, '#5b5f63'); g.addColorStop(1, '#2a2c2e'); x.fillStyle = g; x.fillRect(0, 0, 960, 720);
  x.fillStyle = '#1a1a1a'; rr(x, 70, 230, 820, 120, 50); x.fill();                    // handlebar
  x.fillStyle = '#0c0c0c'; rr(x, 230, 170, 500, 360, 60); x.fill();                   // display housing
  x.fillStyle = '#10161a'; rr(x, 270, 210, 420, 280, 30); x.fill();
  x.fillStyle = '#e8f6ff'; x.font = 'bold 150px Arial'; x.textAlign = 'center'; x.fillText('0', 400, 400);
  x.font = 'bold 30px Arial'; x.fillText('km/h', 400, 445);
  const bars = Math.max(0, Math.min(5, Math.ceil(pct / 20)));
  x.strokeStyle = '#e8f6ff'; x.lineWidth = 5; rr(x, 520, 270, 130, 52, 8); x.stroke(); x.fillRect(650, 285, 10, 22);
  for (let i = 0; i < 5; i++) { x.fillStyle = i < bars ? (pct < 25 ? '#ff5a4f' : '#7CFC9a') : '#24323a'; rr(x, 530 + i * 24, 280, 18, 32, 3); x.fill(); }
  x.fillStyle = '#e8f6ff'; x.font = 'bold 58px Arial'; x.fillText(pct + '%', 585, 400);
  x.font = '22px Arial'; x.fillStyle = '#7aa0b4'; x.fillText('ECO', 585, 450);
  for (let i = 0; i < 2500; i++) { x.fillStyle = `rgba(255,255,255,${Math.random() * .04})`; x.fillRect(Math.random() * 960, Math.random() * 720, 2, 2); }
  return c;
}
function photoRack(v, rackId, { locked = true, scratch = false } = {}) {
  const [c, x] = cvs(960, 720);
  const sky = x.createLinearGradient(0, 0, 0, 430); sky.addColorStop(0, '#cfe3f2'); sky.addColorStop(1, '#eef2f4'); x.fillStyle = sky; x.fillRect(0, 0, 960, 430);
  x.fillStyle = '#b5a28d'; x.fillRect(0, 140, 960, 290);                                // brick wall
  x.strokeStyle = '#9c8a76'; x.lineWidth = 2; for (let y = 160; y < 430; y += 30) { x.beginPath(); x.moveTo(0, y); x.lineTo(960, y); x.stroke(); }
  x.fillStyle = '#c9c4bd'; x.fillRect(0, 430, 960, 290);                                // concrete
  x.strokeStyle = '#8d8f91'; x.lineWidth = 16; x.lineCap = 'round';                     // rack hoops
  for (const rx of [180, 470, 760]) { x.beginPath(); x.moveTo(rx - 70, 620); x.lineTo(rx - 70, 420); x.arc(rx, 420, 70, Math.PI, 0); x.lineTo(rx + 70, 620); x.stroke(); }
  x.fillStyle = '#fff'; rr(x, 420, 360, 100, 110, 10); x.fill();                        // rack QR sticker
  x.fillStyle = '#111'; for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) if ((i * 7 + j * 3 + i * j) % 3 === 0 || i % 6 === 0 && j % 6 === 0) x.fillRect(435 + i * 10, 372 + j * 10, 9, 9);
  x.fillStyle = '#990000'; x.font = 'bold 14px Arial'; x.textAlign = 'center'; x.fillText('SCOOT ' + rackId + '-01', 470, 460);
  const col = v.color || '#990000';                                                       // scooter
  x.lineCap = 'round'; x.strokeStyle = col; x.lineWidth = 26; x.beginPath(); x.moveTo(260, 600); x.lineTo(640, 600); x.lineTo(690, 640); x.stroke();
  x.lineWidth = 22; x.beginPath(); x.moveTo(670, 630); x.lineTo(600, 270); x.stroke();
  x.strokeStyle = '#1b1b1b'; x.lineWidth = 18; x.beginPath(); x.moveTo(530, 262); x.lineTo(680, 262); x.stroke();
  for (const wx of [260, 690]) { x.fillStyle = '#1b1b1b'; x.beginPath(); x.arc(wx, 645, 52, 0, 7); x.fill(); x.fillStyle = '#9a9a9a'; x.beginPath(); x.arc(wx, 645, 18, 0, 7); x.fill(); }
  if (scratch) { x.strokeStyle = '#f2f2f2'; x.lineWidth = 4; x.beginPath(); x.moveTo(380, 592); x.lineTo(460, 606); x.moveTo(390, 600); x.lineTo(455, 612); x.stroke(); }
  x.strokeStyle = '#ffcc00'; x.lineWidth = 15;                                            // U-lock through stem + rack
  if (locked) { x.beginPath(); x.moveTo(560, 470); x.lineTo(560, 400); x.arc(590, 400, 30, Math.PI, 0); x.lineTo(620, 470); x.stroke(); x.fillStyle = '#222'; rr(x, 540, 462, 100, 34, 8); x.fill(); }
  else { x.beginPath(); x.moveTo(780, 690); x.lineTo(780, 630); x.arc(810, 630, 30, Math.PI, 0); x.stroke(); x.fillStyle = '#222'; rr(x, 770, 690, 70, 22, 6); x.fill(); }
  return c;
}
function photoLicense() {
  const [c, x] = cvs(1000, 630);
  const g = x.createLinearGradient(0, 0, 1000, 630); g.addColorStop(0, '#e9f1fb'); g.addColorStop(1, '#f8ead6'); x.fillStyle = '#3c3c3c'; x.fillRect(0, 0, 1000, 630);
  x.fillStyle = g; rr(x, 40, 30, 920, 570, 30); x.fill();
  x.fillStyle = '#1f3d7a'; x.font = 'bold 54px Georgia'; x.fillText('California', 80, 110);
  x.font = 'bold 26px Arial'; x.fillStyle = '#b4232a'; x.fillText('DRIVER LICENSE', 400, 106);
  x.fillStyle = '#c0392b'; x.font = 'bold 30px Arial'; x.fillText('SAMPLE · NOT A REAL DOCUMENT', 80, 160);
  x.fillStyle = '#b9c3cc'; rr(x, 80, 190, 230, 290, 14); x.fill(); x.fillStyle = '#8b97a3'; x.beginPath(); x.arc(195, 290, 60, 0, 7); x.fill(); x.fillRect(120, 370, 150, 110);
  x.fillStyle = '#111'; x.font = '26px Arial'; const L = [['DL', 'S0000000'], ['EXP', '08/14/2029'], ['LN', 'SAMPLE'], ['FN', 'TROJAN'], ['CLASS', 'C'], ['DOB', '01/01/2000']];
  L.forEach(([k, v], i) => { x.fillStyle = '#b4232a'; x.fillText(k, 350, 230 + i * 50); x.fillStyle = '#111'; x.fillText(v, 450, 230 + i * 50); });
  x.globalAlpha = .12; x.fillStyle = '#1f3d7a'; x.font = 'bold 120px Arial'; x.save(); x.translate(500, 450); x.rotate(-.25); x.fillText('SAMPLE', -230, 0); x.restore(); x.globalAlpha = 1;
  return c;
}
function toB64(src, max = 1024) {
  const w = src.naturalWidth || src.width, h = src.naturalHeight || src.height, k = Math.min(1, max / Math.max(w, h));
  const [c, x] = cvs(Math.round(w * k), Math.round(h * k)); x.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', .85);
}
function pickPhoto() {
  return new Promise(res => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.capture = 'environment';
    inp.onchange = () => { const f = inp.files[0]; if (!f) return res(null); const img = new Image(); img.onload = () => res(toB64(img)); img.onerror = () => res(null); img.src = URL.createObjectURL(f); };
    inp.click();
  });
}

/* ---------- AI ---------- */
async function ai(kind, images, context = {}) {
  const t0 = performance.now();
  try {
    const r = await fetch(API + '/check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind, images: images.map(d => d.split(',')[1]), context }) });
    const j = await r.json(); j.ms = Math.round(performance.now() - t0); return j;
  } catch (e) { return { ok: false, error: 'network', ms: Math.round(performance.now() - t0) }; }
}

/* ---------- router ---------- */
let mapObj = null, tick = null;
const go = h => { location.hash = h; };
function back(fallback = '#/home') { history.length > 1 ? history.back() : go(fallback); }
window.addEventListener('hashchange', render);
function render() {
  closeModal(); clearInterval(tick); tick = null;
  if (mapObj) { mapObj.remove(); mapObj = null; }
  let h = location.hash.replace(/^#\/?/, '') || '';
  if (!S.user && !['welcome', 'login'].includes(h.split('/')[0])) h = 'welcome';
  if (S.user && (h === '' || h === 'welcome' || h === 'login')) h = S.agreed ? 'home' : 'onboard';
  const [page, arg] = h.split('/');
  const fn = PAGES[page] || PAGES.home;
  document.querySelector('.statusbar').classList.toggle('light', ['welcome', 'ride'].includes(page) || page === 'login');
  fn(arg);
  save();
}
function tabs(on) {
  const live = S.booking && ['active', 'parked'].includes(S.booking.phase);
  const T = [['home', 'Ride', 'ride'], ['garage', 'Garage', 'garage'], ['wallet', 'Wallet', 'wallet'], ['profile', 'Profile', 'me']];
  return `<nav class="tabbar">${T.map(([p, l, i]) => `<button class="tab ${on === p ? 'on' : ''}" onclick="go('#/${p === 'home' && live ? 'ride' : p}')">${ICON[i]}${p === 'home' && live ? '<span class="dot"></span>' : ''}${l}</button>`).join('')}</nav>`;
}
const topbar = (title, backTo = true, right = '') => `<div class="top">${backTo ? `<button class="back" aria-label="Back" onclick="back()">‹</button>` : ''}<h2>${title}</h2>${right}</div>`;

/* ---------- pages ---------- */
const PAGES = {};

PAGES.welcome = () => {
  app.innerHTML = `<div class="view welcome"><div class="hero"><div class="bigR">SC</div>
    <h1>Borrow a<br>Trojan's <em>ride.</em></h1>
    <p>Scooters and bikes owned by students in your building. Pick one up at the rack, ride to class, bring it back. Owners earn while they're in lecture.</p>
    <div class="fighton">✌ FIGHT ON. SCOOT ON.</div></div>
    <div class="foot"><button class="btn gold" onclick="go('#/login')">Sign in with USC NetID</button>
    <p class="xs" style="text-align:center;opacity:.7;margin:14px 0 0">USC students only · prototype for AI@USC 2026</p></div></div>`;
};

PAGES.login = () => {
  app.innerHTML = `<div class="view sso"><div class="bar"><span>NetID sign-in</span><span class="xs" style="opacity:.8">DEMO · not a real USC page</span></div>
  <div class="scroll pad" style="padding-top:26px"><h2 style="margin:0 0 6px;letter-spacing:-.5px">Sign in</h2><p class="muted sm" style="margin:0 0 22px">Use your USC NetID. SCoot never sees your password; USC confirms you're a current student.</p>
  <div class="field"><label>USC NetID</label><input id="nid" autocapitalize="none" placeholder="ttrojan" value="ttrojan"></div>
  <div class="field"><label>Password</label><input type="password" value="fighton1880"></div>
  <div class="field"><label>Your residence</label><select id="dorm">${RACKS.filter(r => ['IRC', 'VILLAGE', 'BIRN', 'WEBB', 'MARKS', 'CARD'].includes(r.id)).map(r => `<option value="${r.id}">${r.name}</option>`).join('')}</select></div>
  <div id="duo"></div></div>
  <div class="foot"><button class="btn" id="go" onclick="A.login()">Sign in</button><p class="xs muted" style="text-align:center">Demo sign-in: no real USC credentials are checked or sent.</p></div></div>`;
};

PAGES.onboard = () => {
  const L = S.license;
  app.innerHTML = `<div class="view">${topbar('Before your first ride', false)}
  <div class="scroll pad"><div class="steps"><i class="on"></i><i class="${L ? 'on' : ''}"></i></div>
  <div class="card col"><div class="row"><div class="h3 grow">1 · License check</div>${L ? '<span class="chip green">Verified</span>' : ''}</div>
   <p class="sm ink2" style="margin:0">California law (Vehicle Code 21235) requires a driver's license or learner's permit to ride a motorized scooter. Regular bikes don't need one.</p>
   ${L ? `<div class="note green">✓ ${esc(L.kind)} · expires ${esc(L.exp)}. The photo was deleted right after the check.</div>` : `<div id="lic"></div>`}
  </div>
  <div class="card col" style="margin-top:12px"><div class="h3">2 · The SCoot deal</div>
   <ol class="rules sm" style="padding-left:18px;margin:4px 0">
   <li><b>Round trip.</b> Bring it back to the same rack you got it from.</li>
   <li><b>Owners set the price:</b> a start price covers 2 hours and 2 miles, then a price per extra hour and per extra mile. Most are $5, $2, $2.</li>
   <li><b>Photos at pickup and return.</b> AI reads the battery and checks parking, lock and damage.</li>
   <li><b>Be back by the curfew.</b> Miss it and it’s $10. If the battery dies, kick it home without the motor.</li>
   <li><b>Lock it at a rack</b> every time you leave it. No passengers, no overnight.</li></ol>
   <a class="link sm" href="#/rules">Read all the rules →</a></div><div style="height:16px"></div></div>
  <div class="foot"><button class="btn" ${L ? '' : 'disabled'} onclick="A.agree()">I agree · Let's ride</button>
  <button class="btn ghost sm" style="margin-top:8px" onclick="A.agree(true)">Skip license (bikes only for now)</button></div></div>`;
  if (!L) mountCapture('#lic', { kind: 'license', title: 'Photo of your license', sampleLabel: 'Use sample license', sample: () => photoLicense(), onPass: r => { S.license = { kind: r.document_category === 'instruction_permit' ? 'Learner permit' : 'Driver license', exp: r.expiry_iso, at: now() }; save(); toast('License verified. Photo deleted.'); render(); } });
};

PAGES.home = () => {
  const me = S.user, home = rack(me.dorm);
  const list = S.vehicles.filter(v => S.filter === 'all' || (S.filter === 'scooter' ? v.type === 'scooter' : S.filter === 'bike' ? v.type !== 'scooter' : true))
    .filter(v => !S.rackFilter || v.rack === S.rackFilter);
  const ready = v => v.status === 'available' && (!isE(v) || v.battery >= RANGE[v.range].min) && v.until - now() >= MIN_BOOK + 10 * MIN;
  const at = list.filter(v => v.rack === (S.rackFilter || me.dorm)), others = S.rackFilter ? [] : list.filter(v => v.rack !== me.dorm).sort((a, b) => miles(home, rack(a.rack)) - miles(home, rack(b.rack)));
  const b = S.booking, live = b && ['booked', 'active', 'parked', 'returning'].includes(b.phase);
  const row = v => { const ok = ready(v); return `<button class="veh" onclick="go('#/v/${v.id}')" style="${ok ? '' : 'opacity:.55'}"><div class="thumb">${art(v)}</div><div class="grow"><div class="b">${esc(v.name)}</div><div class="xs muted">${esc(v.model)}</div><div class="row" style="gap:8px;margin-top:4px">${battChip(v.battery)}<span class="xs muted">· ${ok ? 'free till ' + t(v.until) : v.status !== 'available' ? 'in use' : isE(v) && v.battery < RANGE[v.range].min ? 'needs charge' : 'unavailable'}</span></div></div><div class="price">${money(rateOf(v).base)}<div class="xs muted" style="font-weight:600">2 h + 2 mi</div></div></button>`; };
  app.innerHTML = `<div class="view"><div class="mapwrap"><div id="map"></div>
   <div class="maptop"><div class="search"><div class="av">${esc(me.name[0])}</div><div class="grow">Rides near <b>${esc(home.name)}</b></div><span class="chip gold">${S.vehicles.filter(ready).length} free</span></div>
   <div class="chips">${[['all', 'All'], ['scooter', '🛴 Scooters'], ['bike', '🚲 Bikes & e-bikes']].map(([k, l]) => `<button class="chip ${S.filter === k ? 'on' : ''}" onclick="A.filter('${k}')">${l}</button>`).join('')}${S.rackFilter ? `<button class="chip red" onclick="A.rack(null)">${esc(rack(S.rackFilter).name)} ✕</button>` : ''}</div></div>
   <div class="sheet"><div class="grab"></div><div class="scroll">
    ${live ? `<button class="banner" onclick="go('#/${b.phase === 'booked' ? 'pickup' : b.phase === 'returning' ? 'return' : 'ride'}')"><span class="pulse"></span><div class="grow"><div class="b">${b.phase === 'booked' ? 'Pickup waiting' : b.phase === 'returning' ? 'Finishing return' : 'Rental in progress'} · ${esc(S.vehicles.find(v => v.id === b.vid).name)}</div><div class="xs" style="opacity:.75">Back to ${esc(rack(b.rack).name)} by ${t(b.end)}</div></div>›</button>` : ''}
    <div class="row" style="margin:6px 2px 10px"><div class="h3 grow">${S.rackFilter ? esc(rack(S.rackFilter).name) : 'In your building'}</div><span class="xs muted">${S.rackFilter ? '' : esc(home.name)}</span></div>
    ${at.map(row).join('') || '<p class="muted sm">Nothing here right now.</p>'}
    ${others.length ? `<div class="row" style="margin:16px 2px 10px"><div class="h3 grow">Other racks</div><span class="xs muted">round trip from each</span></div>${others.map(row).join('')}` : ''}
   </div></div></div>${tabs('home')}</div>`;
  const mapEl = $('#map');
  setTimeout(() => {
    if (!mapEl.isConnected || mapObj) return;
    mapObj = L.map(mapEl, { zoomControl: false, attributionControl: true }).setView([34.0213, -118.2865], 16);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(mapObj);
    for (const r of RACKS) {
      const n = S.vehicles.filter(v => v.rack === r.id && ready(v)).length, isHome = r.id === me.dorm;
      const icon = L.divIcon({ className: '', iconSize: [40, 40], iconAnchor: [20, 40], html: `<div class="pin ${isHome ? 'home' : n ? 'has' : 'none'} "><span>${isHome ? '★' : n}</span></div>` });
      L.marker([r.lat, r.lng], { icon }).addTo(mapObj).on('click', () => A.rack(r.id)).bindTooltip(`${r.name}`, { direction: 'top', offset: [0, -38] });
    }
    L.marker([home.lat - .0004, home.lng + .0006], { icon: L.divIcon({ className: '', html: '<div class="me"></div>', iconSize: [18, 18] }) }).addTo(mapObj);
    const sh = document.querySelector('.sheet').offsetHeight;
    mapObj.fitBounds(RACKS.map(r => [r.lat, r.lng]), { paddingTopLeft: [24, 130], paddingBottomRight: [24, sh + 16] });
  });
};

PAGES.v = id => {
  const v = S.vehicles.find(x => x.id === id); if (!v) return go('#/home');
  const r = rack(v.rack), e = isE(v), rc = e && RANGE[v.range];
  const lowBatt = e && v.battery < rc.min, maxMs = Math.min(v.until, endOfDay()) - now();
  const canBook = maxMs >= MIN_BOOK + 10 * MIN, curfew = Math.min(v.until, endOfDay()), rt = rateOf(v);
  const busy = S.booking && ['booked', 'active', 'parked'].includes(S.booking.phase);
  app.innerHTML = `<div class="view"><div class="scroll"><div class="hero-veh"><div class="row"><button class="back" onclick="back()">‹</button><div class="grow"></div><span class="chip">${v.type === 'bike' ? '🚲 Bike' : v.type === 'ebike' ? '⚡ E-bike' : '🛴 E-scooter'}</span></div>
   <div class="art">${art(v, 190)}</div><h2 style="margin:0;font-size:28px;letter-spacing:-.8px">${esc(v.name)}</h2><div class="muted sm">${esc(v.model)}${rc ? ' · ' + rc.label : ''}</div>
   <div class="stats"><div class="stat"><b>${e ? v.battery + '%' : '—'}</b><small>${e ? `AI-read ${v.battAgo} min ago` : 'pedal power'}</small></div><div class="stat"><b>${e ? '~' + Math.round(v.battery / drainOf(v) * .9) + ' mi' : '∞'}</b><small>est. range</small></div><div class="stat"><b>★ ${v.rating.toFixed(1)}</b><small>${v.trips} trips</small></div></div></div>
   <div class="pad"><div class="sec">Owner</div><div class="card owner"><div class="avatar" style="background:${v.owner.color}">${esc(v.owner.initials)}</div><div class="grow"><div class="b">${esc(v.owner.name)} · lives in ${esc(v.owner.dorm)}</div><div class="xs muted">USC verified · lends it until ${t(v.until)} today</div></div><span class="chip green">✓ NetID</span></div>
   <div class="sec">Round trip</div><div class="card row"><div style="font-size:26px">🔁</div><div class="grow"><div class="b">${esc(r.name)}</div><div class="xs muted">Pick up here, bring it back here. ${esc(r.sub)}.</div></div></div>
   ${lowBatt ? `<div class="note red" style="margin-top:12px">🔋 Battery is ${v.battery}%. ${rc.label} scooters need ${rc.min}% to start a rental. The owner has been asked to charge it.</div>` : ''}
   <div class="sec">Price, set by ${esc(v.owner.name)}</div><div class="card"><div class="kv"><span>Start: first 2 hours + 2 miles</span><b>${money(rt.base)}</b></div><div class="kv"><span>Each extra hour</span><span>${money(rt.hr)}</span></div><div class="kv"><span>Each extra mile</span><span>${money(rt.mi)}</span></div><div class="kv"><span>Curfew: back at ${esc(r.name)} by</span><b>${t(curfew)}</b></div><div class="kv"><span>Miss the curfew</span><span>$10.00</span></div><div class="kv"><span>Refundable hold</span><span>${money(HOLD[cls(v)])}</span></div><div class="kv xs"><span>${esc(v.owner.name)} gets</span><span>70% of what you pay</span></div></div>
   <p class="xs muted" style="margin:10px 2px">Parkside to the Village gym and back (1.4 mi, 1½ h): ${money(rt.base)}. To a 4-hour lecture and back (about 4 h 20 min): ${money(rt.base + 3 * rt.hr)}. Distance comes from your phone’s GPS.</p>
   <div style="height:20px"></div></div></div>
   <div class="foot">${busy ? `<button class="btn dark" onclick="go('#/ride')">You already have a rental →</button>` : e && v.type === 'scooter' && !S.license ? `<button class="btn" onclick="go('#/onboard')">Verify license to ride scooters</button>` : `<button class="btn" ${canBook && !lowBatt ? '' : 'disabled'} onclick="A.book('${id}')">Book · ${money(rt.base)} to start</button>`}</div></div>`;
};

PAGES.pickup = () => {
  const b = S.booking; if (!b || b.phase !== 'booked') return go('#/home');
  const v = S.vehicles.find(x => x.id === b.vid), r = rack(b.rack), e = isE(v), step = b.step || 'scan';
  const order = e ? ['scan', 'battery', 'condition', 'unlock'] : ['scan', 'condition', 'unlock'];
  const bar = `<div class="steps">${order.map((s, i) => `<i class="${i <= order.indexOf(step) ? 'on' : ''}"></i>`).join('')}</div>`;
  const left = b.pickupBy - now();
  let body = '', foot = '';
  if (step === 'scan') {
    body = `<p class="ink2 sm" style="margin-top:0">Go to <b>${esc(r.name)}</b> and find ${esc(v.name)}. Scan the SCoot sticker on the rack.</p>
     <div class="scanbox"><div class="frame"></div><div class="rackqr">▚▞▚▞▚<br>SCOOT ${r.id}-01</div></div>
     <div class="note" style="margin-top:12px">⏱ Pickup window: ${left > 0 ? dur(left) + ' left' : 'expired'} (10 minutes). Late pickup cancels the booking.</div>`;
    foot = `<button class="btn" onclick="A.scan()">Scan rack sticker</button><button class="btn ghost sm" style="margin-top:8px" onclick="A.cancel()">Cancel booking (free within 2 min)</button>`;
  } else if (step === 'battery') {
    body = `<p class="ink2 sm" style="margin-top:0">Turn the scooter on and take a close photo of the display. The AI reads the battery so you and the owner agree on the starting charge.</p><div id="cap"></div>`;
  } else if (step === 'condition') {
    body = `<p class="ink2 sm" style="margin-top:0">One photo of the whole ${v.type === 'scooter' ? 'scooter' : 'bike'} at the rack. This is the "before" photo: if someone claims damage later, the AI compares it with your return photo.</p><div id="cap"></div>`;
  } else {
    body = `<div style="text-align:center"><div class="lockbig" id="lk">${ICON.lock}</div><div class="h3">${esc(v.name)} · lock ${v.id.toUpperCase()}</div><p class="sm muted" style="margin:6px 0 0">The server gives your phone a one-time key that only works until ${t(b.end)}. Your phone sends it to the lock over Bluetooth.</p></div>
     <div class="card" style="margin-top:16px"><div class="kv"><span>Start battery</span><b>${e ? b.pickupBattery + '%' : '—'}</b></div><div class="kv"><span>Before photo</span><b style="color:var(--ok)">Saved ✓</b></div><div class="kv"><span>Back at ${esc(r.name)} by</span><b>${t(b.end)}</b></div></div>`;
    foot = `<button class="btn gold" onclick="A.unlock()">🔓 Unlock with Bluetooth</button><button class="btn ghost sm" style="margin-top:8px" onclick="A.unlock(true)">Demo unlock (no lock nearby)</button>`;
  }
  app.innerHTML = `<div class="view">${topbar('Pick up ' + esc(v.name))}<div class="scroll pad">${bar}${body}<div style="height:16px"></div></div>${foot ? `<div class="foot">${foot}</div>` : ''}</div>`;
  if (step === 'battery') mountCapture('#cap', { kind: 'battery', title: 'Battery display', sampleLabel: 'Use demo photo', sample: () => photoDisplay(v.battery), onPass: r => A.pickBattery(r) });
  if (step === 'condition') mountCapture('#cap', { kind: 'parking', title: 'Whole vehicle at the rack', sampleLabel: 'Use demo photo', sample: () => photoRack(v, b.rack), keep: true, onPass: (r, img) => A.pickCondition(img) });
};

PAGES.ride = () => {
  const b = S.booking; if (!b || !['active', 'parked'].includes(b.phase)) return go(b && b.phase === 'booked' ? '#/pickup' : b && b.phase === 'returning' ? '#/return' : '#/home');
  const v = S.vehicles.find(x => x.id === b.vid), r = rack(b.rack), e = isE(v);
  const parked = b.phase === 'parked', here = rack(b.at || b.rack);
  const est = e ? estBatt(b, v) : null, rangeLeft = e ? Math.max(0, (est - 5) / drainOf(v)) : 0, rt = b.rate || RATE0;
  const homeMi = miles(here, r), walkMin = Math.round(homeMi / 3 * 60);
  app.innerHTML = `<div class="view ride">${topbar('Your ride', false, `<span class="chip" style="background:#2e2522;color:#fff;box-shadow:none">${esc(v.name)}</span>`)}
  <div class="scroll pad"><div class="ridecard"><div class="xs muted b" id="lbl">CURFEW · back by ${t(b.end)}</div><div class="timer" id="tm">--:--</div>
   <div class="row" style="margin-top:10px;gap:8px"><span class="chip" style="background:${parked ? '#3b2f12' : '#123b22'};color:${parked ? 'var(--gold)' : '#7CFC9a'};box-shadow:none">${parked ? '🔒 Locked at ' + esc(here.name) : '🛴 Riding'}</span><span class="xs muted" id="late"></span></div></div>
   ${e ? `<div class="ridecard" style="margin-top:12px"><div class="row"><div class="grow"><div class="xs muted b">BATTERY ESTIMATE</div><div style="font-size:26px;font-weight:900">~${est}%</div></div><div style="text-align:right" class="xs muted">${b.pickupBattery}% in the pickup photo<br>− ${rideMiles(b).toFixed(1)} mi × ${drainOf(v).toFixed(1)}% per mile</div></div>
     <div class="gauge"><i style="width:${est}%"></i><u style="left:${RETURN_FLOOR}%"></u></div><div class="xs muted" style="margin-top:8px">About ${rangeLeft.toFixed(1)} mi of range left · home rack is ${homeMi.toFixed(1)} mi away</div>${rangeLeft < homeMi + 0.5 || est < 30 ? `<div class="note red" style="margin-top:10px">Low battery. Head back to ${esc(r.name)} now. If it dies, you kick it home without the motor.</div>` : ''}</div>` : ''}
   <div class="ridecard" style="margin-top:12px"><div class="row"><div class="grow"><div class="xs muted b">COST SO FAR</div><div style="font-size:26px;font-weight:900" id="cost">${money(rt.base)}</div></div><div style="text-align:right" class="xs muted" id="usage"></div></div><div class="xs muted" style="margin-top:6px">${money(rt.base)} covers 2 hours + 2 miles. Then ${money(rt.hr)} per extra hour, ${money(rt.mi)} per extra mile (${esc(v.owner.name)}’s prices).</div></div>
   <div class="ridecard" style="margin-top:12px"><div class="xs muted b" style="margin-bottom:8px">HOME RACK</div><div class="minimap" id="mm"></div>
    <div class="kv" style="margin-top:8px"><span>${esc(r.name)}</span><b>${parked && b.at !== b.rack ? homeMi.toFixed(1) + ' mi · ' + walkMin + ' min walk' : b.at === b.rack ? "you're here" : 'round trip'}</b></div><div class="xs muted">${ROUTES_BLOCKED}</div></div>
   <div class="ridecard" style="margin-top:12px"><div class="xs muted b" style="margin-bottom:4px">RIDE LOG</div>${(b.log || []).map(l => `<div class="kv"><span>${l.kind === 'unlock' ? '🔓 Unlocked' : '🔒 Locked'} · ${esc(l.place)}</span><b>${t(l.t)}</b></div>`).join('') || '<div class="xs muted">Nothing yet.</div>'}<div class="xs muted" style="margin-top:4px">Your phone’s location at every unlock and lock. Kept for disputes and theft reports, never shown to the owner.</div></div>
   <div class="row2" style="margin-top:12px">${parked ? `<button class="btn gold sm" onclick="A.unpark()">🔓 Unlock & ride</button>` : `<button class="btn ghost sm" onclick="go('#/park')">🔒 Lock at a rack</button>`}<button class="btn ghost sm" onclick="go('#/problem')">⚠ Problem</button></div>
   <div style="height:12px"></div></div>
  <div class="foot" style="background:none"><button class="btn gold" onclick="A.startReturn()">Return to ${esc(r.name)}</button></div>${tabs('home')}</div>`;
  const upd = () => {
    const left = b.end - now(), el = $('#tm'); if (!el) return;
    el.textContent = (left < 0 ? '+' : '') + clock(left); el.classList.toggle('late', left < 0);
    if (left < 0) { $('#lbl').textContent = 'CURFEW MISSED · was ' + t(b.end); $('#late').textContent = 'curfew fee $10'; }
    meter(); const bl = bill(b, now()); $('#cost').textContent = money(bl.total); $('#usage').innerHTML = `${dur(bl.hours * HOUR)} · ${bl.mi.toFixed(1)} mi<br>${bl.xh ? '+' + bl.xh + ' h' : 'within 2 h'} · ${bl.xm ? '+' + bl.xm + ' mi' : 'within 2 mi'}`;
  };
  upd(); tick = setInterval(upd, 1000);
  const mmEl = $('#mm');
  setTimeout(() => {
    if (!mmEl.isConnected || mapObj) return;
    mapObj = L.map(mmEl, { zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false }).setView([(here.lat + r.lat) / 2, (here.lng + r.lng) / 2], 15);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(mapObj);
    L.marker([r.lat, r.lng], { icon: L.divIcon({ className: '', iconSize: [40, 40], iconAnchor: [20, 40], html: '<div class="pin home"><span>★</span></div>' }) }).addTo(mapObj);
    if (b.at && b.at !== b.rack) { L.marker([here.lat, here.lng], { icon: L.divIcon({ className: '', html: '<div class="me"></div>', iconSize: [18, 18] }) }).addTo(mapObj); L.polyline([[here.lat, here.lng], [r.lat, r.lng]], { color: '#FFCC00', dashArray: '6 8', weight: 3 }).addTo(mapObj); mapObj.fitBounds([[here.lat, here.lng], [r.lat, r.lng]], { padding: [30, 30] }); }
  });
};

PAGES.park = () => {
  const b = S.booking; if (!b) return go('#/home');
  const v = S.vehicles.find(x => x.id === b.vid);
  const st = S.parkPick || null;
  app.innerHTML = `<div class="view">${topbar('Lock it at a rack')}<div class="scroll pad">
   <p class="ink2 sm" style="margin-top:0">Going into class? Lock ${esc(v.name)} to any SCoot rack. Your time keeps running, and only you can unlock it.</p>
   ${st ? `<div class="card row" style="margin-bottom:12px"><div style="font-size:24px">📍</div><div class="grow"><div class="b">${esc(rack(st).name)}</div><div class="xs muted">${esc(rack(st).sub)}</div></div><button class="link sm" onclick="A.parkPick(null)">Change</button></div><div id="cap"></div>`
      : RACKS.map(r => `<button class="list-btn" onclick="A.parkPick('${r.id}')"><div class="ic" style="background:#f6efe9">${r.id === b.rack ? '★' : '🅿'}</div><div class="grow"><div class="b">${esc(r.name)}</div><div class="xs muted">${esc(r.sub)}</div></div><span class="chev">›</span></button>`).join('')}
   <div style="height:16px"></div></div></div>`;
  if (st) mountCapture('#cap', { kind: 'parking', title: 'Vehicle locked to the rack', sampleLabel: 'Use demo photo', sample: () => photoRack(v, st), onPass: () => A.parkDone(st) });
};

PAGES.return = () => {
  const b = S.booking; if (!b || !['active', 'parked', 'returning'].includes(b.phase)) return go('#/home');
  const v = S.vehicles.find(x => x.id === b.vid), r = rack(b.rack), e = isE(v), step = b.rstep || 'scan';
  const order = e ? ['scan', 'battery', 'photo', 'lock'] : ['scan', 'photo', 'lock'];
  const bar = `<div class="steps">${order.map((s, i) => `<i class="${i <= order.indexOf(step) ? 'on' : ''}"></i>`).join('')}</div>`;
  let body = '', foot = '';
  if (step === 'scan') {
    body = `<p class="ink2 sm" style="margin-top:0">Ride back to <b>${esc(r.name)}</b>, the rack you picked it up from, and scan its sticker.</p><div class="scanbox"><div class="frame"></div><div class="rackqr">▚▞▚▞▚<br>SCOOT ${r.id}-01</div></div>
    <div class="note blue" style="margin-top:12px">Home rack full or blocked? Tap "Something went wrong": we'll approve the nearest legal rack instead.</div>`;
    foot = `<button class="btn" onclick="A.rscan()">Scan ${esc(r.id)} rack sticker</button>`;
  } else if (step === 'battery') body = `<p class="ink2 sm" style="margin-top:0">Photo of the display again, so ${esc(v.owner.name)} knows how much charge is left.</p><div id="cap"></div>`;
  else if (step === 'photo') body = `<p class="ink2 sm" style="margin-top:0">Lock it to the rack, then take one photo of the whole ${v.type === 'scooter' ? 'scooter' : 'bike'} with the lock showing. The AI checks the parking and compares it with your pickup photo for new damage.</p><div id="cap"></div>`;
  else {
    body = `<div style="text-align:center"><div class="lockbig open" id="lk">${ICON.lock}</div><div class="h3">Close the lock</div><p class="sm muted">The lock's sensor tells the server it's really shut before the rental ends.</p></div>`;
    foot = `<button class="btn" onclick="A.finish()">🔒 Lock & end rental</button>`;
  }
  app.innerHTML = `<div class="view">${topbar('Return ' + esc(v.name))}<div class="scroll pad">${bar}${body}<div style="height:16px"></div></div>${foot ? `<div class="foot">${foot}</div>` : ''}</div>`;
  if (step === 'battery') mountCapture('#cap', { kind: 'battery', title: 'Battery display', sampleLabel: 'Use demo photo', sample: () => photoDisplay(Math.max(5, estBatt(b, v) - 2)), onPass: r => A.retBattery(r) });
  if (step === 'photo') mountCapture('#cap', { kind: 'return', title: 'Locked at ' + r.name, sampleLabel: 'Use demo photo', sample: () => photoRack(v, b.rack), before: b.beforeImg, onPass: (res) => A.retPhoto(res) });
};

PAGES.receipt = () => {
  const tr = S.trips[0]; if (!tr) return go('#/home');
  app.innerHTML = `<div class="view">${topbar('Trip complete', false)}<div class="scroll pad" style="text-align:center">
   <div class="success">${ICON.check}</div><h2 style="margin:6px 0 2px;letter-spacing:-.6px">Fight On! ✌</h2><p class="muted sm" style="margin:0 0 16px">${esc(tr.name)} is back at ${esc(tr.rack)}.</p>
   <div class="card" style="text-align:left"><div class="kv"><span>Ride: ${tr.bill ? dur(tr.bill.hours * HOUR) + ' · ' + tr.bill.mi.toFixed(1) + ' mi' : ''}</span><span></span></div><div class="kv"><span>Start (2 hours + 2 miles)</span><span>${money(tr.bill ? tr.bill.rt.base : 0)}</span></div>
    ${tr.bill && tr.bill.xh ? `<div class="kv"><span>Extra time: ${tr.bill.xh} h × ${money(tr.bill.rt.hr)}</span><span>${money(tr.bill.xh * tr.bill.rt.hr)}</span></div>` : ''}${tr.bill && tr.bill.xm ? `<div class="kv"><span>Extra distance: ${tr.bill.xm} mi × ${money(tr.bill.rt.mi)}</span><span>${money(tr.bill.xm * tr.bill.rt.mi)}</span></div>` : ''}
    ${tr.late ? `<div class="kv"><span>Curfew missed</span><span>${money(tr.late)}</span></div>` : `<div class="kv"><span>Back before curfew</span><span style="color:var(--ok)">$0.00</span></div>`}
    ${tr.lowBatt ? `<div class="kv"><span>Battery under ${RETURN_FLOOR}% (no fee, just a heads-up)</span><span>$0.00</span></div>` : ''}
    <div class="kv total"><span>Charged</span><span>${money(tr.price + tr.late)}</span></div>
    <div class="kv xs"><span>${money(tr.hold)} hold</span><span>released</span></div><div class="kv xs"><span>${esc(tr.owner)} earns</span><span>${money((tr.price + tr.late) * OWNER_SHARE)}</span></div><div class="kv xs"><span>Safety fund + payments (30%)</span><span>${money((tr.price + tr.late) * (1 - OWNER_SHARE))}</span></div></div>
   <div class="card" style="text-align:left;margin-top:12px"><div class="row" style="margin-bottom:6px"><span class="badge" style="font-size:10.5px;font-weight:850;padding:3px 7px;border-radius:6px;background:var(--ink);color:var(--gold)">AI CHECKS</span></div>
    <div class="kv sm"><span>Battery start → end</span><b>${tr.b0 != null ? tr.b0 + '% → ' + (tr.b1 ?? '?') + '%' : 'bike'}</b></div>${tr.est != null && tr.b1 != null ? `<div class="kv sm"><span>Estimate from distance vs photo</span><b>${tr.est}% vs ${tr.b1}%</b></div>` : ''}<div class="kv sm"><span>Parking + lock</span><b style="color:var(--ok)">OK</b></div><div class="kv sm"><span>Ride log</span><b>${tr.logN || 0} unlock/lock events</b></div><div class="kv sm"><span>New damage vs pickup</span><b style="color:${tr.damage ? 'var(--warn)' : 'var(--ok)'}">${tr.damage ? 'Flagged for review' : 'None seen'}</b></div></div>
   <div class="sec">Rate ${esc(tr.owner)}'s ride</div><div class="stars">${[1, 2, 3, 4, 5].map(i => `<button class="${i <= (tr.stars || 0) ? 'on' : ''}" onclick="A.stars(${i})">★</button>`).join('')}</div><div style="height:20px"></div></div>
   <div class="foot"><button class="btn" onclick="go('#/home')">Done</button></div></div>`;
};

PAGES.problem = () => {
  const b = S.booking, v = b && S.vehicles.find(x => x.id === b.vid), r = b && rack(b.rack);
  const P = [
    ['🔋', '#fde8e8', 'Battery died', 'dead'], ['🛞', '#f6efe9', 'Flat tire or it broke', 'broken'], ['🔐', '#fff6cc', "Lock won't open or close", 'lock'],
    ['📵', '#e6effe', 'My phone is dying', 'phone'], ['🅿', '#e3f7ea', 'Home rack is full or blocked', 'full'], ['🚨', '#fde8e8', 'It was stolen', 'stolen'], ['🤕', '#fde8e8', 'Crash or injury', 'crash']];
  app.innerHTML = `<div class="view">${topbar('What happened?')}<div class="scroll pad">${!b ? '<p class="muted">No active rental.</p>' : P.map(([i, bg, l, k]) => `<button class="list-btn" onclick="A.problem('${k}')"><div class="ic" style="background:${bg}">${i}</div><div class="grow b">${l}</div><span class="chev">›</span></button>`).join('')}
  <p class="xs muted" style="margin-top:14px">Emergency: call 911. USC DPS (24/7): (213) 740-4321.</p></div></div>`;
};

PAGES.garage = () => {
  const m = S.mine, rn = m.rental, k = m.kit, maxW = Math.max(...m.week, 1), wk = m.week.reduce((a, b) => a + b, 0);
  const D = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  app.innerHTML = `<div class="view">${topbar('My garage', false, `<button class="chip" onclick="A.addVehicle()">＋ Add</button>`)}<div class="scroll pad">
   <div class="card"><div class="row"><div class="thumb" style="width:64px;height:64px;border-radius:16px;background:#f6efe9;display:grid;place-items:center">${art(m, 54)}</div><div class="grow"><div class="h3">${esc(m.name)}</div><div class="xs muted">${esc(m.model)} · home: ${esc(rack(m.rack).name)}</div></div><button class="toggle ${m.listed ? 'on' : ''}" aria-label="Rent it out" onclick="A.list()"></button></div>
    <div class="divider"></div>
    ${rn ? `<div class="row"><span class="pulse" style="width:10px;height:10px;border-radius:50%;background:var(--cardinal);display:inline-block"></span><div class="grow"><div class="b">Rented by ${esc(rn.renter)} · ${esc(rn.renterDorm)}</div><div class="xs muted">${rn.state === 'parked' ? '🔒 Parked and locked' : '🛴 Riding'} · back by ${t(rn.end)}${now() > rn.end ? ' · <b style="color:var(--bad)">LATE</b>' : ''}</div></div><span class="chip gold">+${money(rn.earn || 3.5)}</span></div>`
      : `<div class="row"><div class="grow"><div class="b">${m.listed ? 'At ' + esc(rack(m.rack).name) + ', ready to rent' : 'Not listed: only you can unlock it'}</div><div class="xs muted">Battery ${m.battery}% (AI-read at last return)</div></div>${m.listed ? '<span class="chip green">Listed</span>' : '<span class="chip">Private</span>'}</div>`}
   </div>
   <div class="sec">This week</div><div class="card"><div class="row"><div class="grow"><div class="big-earn">${money(wk)}</div><div class="xs muted">${m.history.length + (rn ? 1 : 0)} rentals · you keep 70%</div></div><button class="btn sm gold" style="width:auto;padding:10px 14px" onclick="go('#/wallet')">Cash out</button></div>
    <div class="bars">${m.week.map((x, i) => `<div><i class="${x === Math.max(...m.week) && x > 0 ? 'hi' : ''}" style="height:${Math.max(4, x / maxW * 70)}px"></i>${D[i]}</div>`).join('')}</div></div>
   <div class="sec">Your prices</div><div class="card col"><div class="row2" style="grid-template-columns:1fr 1fr 1fr"><div class="field" style="margin:0;min-width:0"><label>Start (2 h + 2 mi)</label><input style="width:100%;box-sizing:border-box" type="number" min="1" max="50" step="0.5" value="${rateOf(m).base}" onchange="A.rate('base',this.value)"></div><div class="field" style="margin:0;min-width:0"><label>Extra hour</label><input style="width:100%;box-sizing:border-box" type="number" min="0" max="20" step="0.5" value="${rateOf(m).hr}" onchange="A.rate('hr',this.value)"></div><div class="field" style="margin:0;min-width:0"><label>Extra mile</label><input style="width:100%;box-sizing:border-box" type="number" min="0" max="20" step="0.5" value="${rateOf(m).mi}" onchange="A.rate('mi',this.value)"></div></div>
    <div class="xs muted">Every rental starts with 2 hours and 2 miles for your start price. After that, renters pay your price for each started extra hour and each started extra mile. You keep 70%. Most owners charge $5, $2 and $2.</div></div>
   <div class="sec">When it's rentable</div><div class="card col"><div class="days">${D.map((d, i) => `<button class="${m.days[i] ? 'on' : ''}" onclick="A.day(${i})">${d}</button>`).join('')}</div>
    <div class="row2"><div class="field" style="margin:0"><label>From</label><input type="time" value="${m.from}" onchange="A.win('from',this.value)"></div><div class="field" style="margin:0"><label>Back by</label><input type="time" value="${m.to}" onchange="A.win('to',this.value)"></div></div>
    <div class="xs muted">Your "back by" time is the renter’s curfew (never overnight). Miss it and they pay $10. You can pause renting any time; current renters still finish.</div></div>
   <div class="sec">Your free starter kit</div><div class="kit">
    <div class="card"><div class="b sm">🔐 Smart lock</div><div class="xs muted">${k.lockClosed ? 'Closed' : 'Open'} · battery ${k.lockBatt}%</div></div>
    <div class="card"><div class="b sm">📍 Ride log</div><div class="xs muted">Every unlock and lock is logged</div></div>
    <div class="card"><div class="b sm">⛓ Hardened chain</div><div class="xs muted">Through the frame and the rack</div></div>
    <div class="card"><div class="b sm">🛡 DPS registered</div><div class="xs muted">${k.decal}</div></div></div>
   <div class="sec">Recent rentals</div><div class="card">${m.history.map(h => `<div class="hist"><div class="avatar" style="background:#e9e2dd;color:var(--ink);width:34px;height:34px;font-size:12px">${esc(h.who.slice(0, 2))}</div><div class="grow"><div class="b sm">${esc(h.who)} · ${esc(h.hrs || '')}</div><div class="xs muted">${esc(h.checks)}</div></div><div class="b sm" style="color:var(--ok)">+${money(h.earn)}</div></div>`).join('')}</div>
   <div style="height:16px"></div></div>${tabs('garage')}</div>`;
};

PAGES.wallet = () => {
  const m = S.mine;
  app.innerHTML = `<div class="view">${topbar('Wallet', false)}<div class="scroll pad">
   <div class="card" style="background:linear-gradient(140deg,#990000,#5c0000);color:#fff"><div class="xs b" style="opacity:.75">EARNINGS BALANCE</div><div class="big-earn" style="margin:4px 0 12px">${money(m.balance)}</div><button class="btn gold sm" onclick="A.cashout()">Cash out to bank (test mode)</button></div>
   <div class="sec">Pay with</div><div class="card row"><div style="font-size:22px">💳</div><div class="grow"><div class="b">Visa •••• 4242</div><div class="xs muted">Stripe test card · holds released after each return</div></div></div>
   <div class="sec">Activity</div><div class="card">${[...S.trips.map(x => ({ d: 'Ride · ' + x.name, a: -(x.price + x.late), ago: t(x.at) })), ...S.wallet].map(x => `<div class="hist"><div class="grow"><div class="b sm">${esc(x.d)}</div><div class="xs muted">${esc(x.ago)}</div></div><div class="b sm" style="color:${x.a < 0 ? 'var(--ink)' : 'var(--ok)'}">${x.a < 0 ? '−' + money(-x.a) : '+' + money(x.a)}</div></div>`).join('') || '<p class="muted sm">No activity yet.</p>'}</div>
   <div class="sec">Where the money goes</div><div class="card sm ink2" style="line-height:1.5">Owners keep <b>70%</b> of every rental. The other 30% pays card fees and a safety fund for theft and damage. SCoot isn't trying to profit, so there's no unlock fee and no per-minute meter.</div>
   <div style="height:16px"></div></div>${tabs('wallet')}</div>`;
};

PAGES.profile = () => {
  const u = S.user;
  app.innerHTML = `<div class="view">${topbar('Profile', false)}<div class="scroll pad">
   <div class="card row"><div class="avatar" style="background:var(--cardinal);color:var(--gold);width:54px;height:54px;font-size:20px">${esc(u.name[0])}</div><div class="grow"><div class="h3">${esc(u.name)}</div><div class="xs muted">${esc(u.netid)}@usc.edu · ${esc(rack(u.dorm).name)}</div></div><span class="chip green">USC ✓</span></div>
   <div class="sec">Ride status</div>
   <div class="card"><div class="kv"><span>License</span><b>${S.license ? '✓ ' + esc(S.license.kind) + ' · exp ' + esc(S.license.exp) : '<a class="link" href="#/onboard">Verify</a>'}</b></div><div class="kv"><span>Strikes</span><b>0 of 3</b></div><div class="kv"><span>Trips</span><b>${S.trips.length}</b></div><div class="kv"><span>Helmet</span><b>Required under 18</b></div></div>
   <div class="sec">Learn</div>
   <button class="list-btn" onclick="go('#/rules')"><div class="ic" style="background:#fff6cc">📜</div><div class="grow b">The rules</div><span class="chev">›</span></button>
   <button class="list-btn" onclick="go('#/how')"><div class="ic" style="background:#fde8e8">🛡</div><div class="grow b">Safety, theft & damage</div><span class="chev">›</span></button>
   <div class="sec">Demo controls</div>
   <button class="list-btn" onclick="A.ff(30)"><div class="ic" style="background:#e6effe">⏩</div><div class="grow"><div class="b">Skip ahead 30 minutes</div><div class="xs muted">Try a late return</div></div></button>
   <button class="list-btn" onclick="A.ownerReturn()"><div class="ic" style="background:#e3f7ea">↩</div><div class="grow"><div class="b">Jordan returns Traveler</div><div class="xs muted">See the owner side</div></div></button>
   <button class="list-btn" onclick="A.reset()"><div class="ic" style="background:#f6efe9">↺</div><div class="grow b">Reset demo</div></button>
   <button class="list-btn" onclick="A.logout()"><div class="ic" style="background:#f6efe9">⎋</div><div class="grow b">Sign out</div></button>
   <p class="xs muted" style="text-align:center;margin:14px 0 24px">SCoot prototype · AI@USC 2026 · demo data, test payments</p></div>${tabs('profile')}</div>`;
};

PAGES.rules = () => {
  app.innerHTML = `<div class="view">${topbar('The rules')}<div class="scroll pad"><ol class="rules sm" style="padding-left:20px">
  <li><b>Same rack, both ends.</b> Pick up and return at the same marked rack. Only a reported safety problem or a full rack allows another approved spot.</li>
  <li><b>Each owner sets a start price</b> that covers your first 2 hours and 2 miles (the shortest rental), plus a price for each extra hour and each extra mile (from your phone’s GPS). Most owners charge $5, $2 and $2. Parking during your ride counts as time.</li>
  <li><b>$25 refundable hold</b> for electric ($10 for bikes). It's released after the return check.</li>
  <li><b>Pick up within 10 minutes</b> of booking, or the booking lapses.</li>
  <li><b>Photos at pickup and return.</b> AI reads the battery and checks parking, lock and new damage. Unclear photos go to a person, never an automatic fine.</li>
  <li><b>Start with enough charge.</b> Long-range scooters need 40% to start, medium 50%, short 60%.</li>
  <li><b>Battery died?</b> Kick it home to the rack without the motor. It’s still faster than walking. Report it and your curfew moves back 30 minutes.</li>
  <li><b>Curfew:</b> the owner’s back-by time, shown before you book. Miss it and there’s a one-time $10 fee. After 24 hours missing, it’s treated as stolen.</li>
  <li><b>Lock to a rack</b> every time you leave it. No passengers, no lending your booking to a friend, no overnight rentals.</li>
  <li><b>Walk-only zones:</b> walk it through Hahn Plaza and campus intersections. DPS tickets are on you.</li>
  <li><b>License:</b> e-scooters need a driver's license or learner's permit (CA Vehicle Code 21235). Helmet required under 18.</li></ol><div style="height:20px"></div></div></div>`;
};

PAGES.how = () => {
  app.innerHTML = `<div class="view">${topbar('Safety, theft & damage')}<div class="scroll pad col sm ink2" style="line-height:1.55">
  <div class="card"><div class="h3" style="margin-bottom:6px">Theft</div>Every renter is a verified USC student, so nobody rides anonymously. Every unlock and lock is logged with the renter’s phone location, and every scooter is registered with USC DPS. If a scooter is stolen and not recovered, the SCoot safety fund pays the owner its depreciated value.</div>
  <div class="card"><div class="h3" style="margin-bottom:6px">Damage</div>The pickup photo is the "before". The return photo is the "after". The AI points out visible differences, and a person decides. Normal wear isn't damage. Either side can appeal.</div>
  <div class="card"><div class="h3" style="margin-bottom:6px">Battery</div>Only certified scooters (UL 2272) and e-bikes (UL 2849). Owners charge their own scooters with the original charger.</div>
  <div class="card"><div class="h3" style="margin-bottom:6px">Injury</div>Call 911 or DPS at (213) 740-4321 first. For the pilot, SCoot works with USC Risk Management on group insurance, the way Lime insures its riders. That has to be in place before real rides start.</div>
  <div class="card"><div class="h3" style="margin-bottom:6px">Your data</div>License photos are read once and never stored. Ride photos are kept for 30 days for disputes, then deleted. Images are treated as evidence, never as instructions to the AI.</div>
  <div style="height:16px"></div></div></div>`;
};

/* ---------- photo + AI capture component ---------- */
function mountCapture(sel, o) {
  const box = $(sel); if (!box) return;
  let img = null, busy = false, tries = 0;
  const draw = (res) => {
    box.innerHTML = `<div class="cam">${img ? `<img src="${img}" alt="">` : `<div class="empty">📷<br>${esc(o.title)}</div>`}<div class="guide" style="${img ? 'display:none' : ''}"></div><span class="lbl">${esc(o.title)}</span></div>
     <div class="row2" style="margin-top:10px"><button class="btn sm" id="c-take">📷 ${img ? 'Retake' : 'Take photo'}</button><button class="btn ghost sm" id="c-demo">${esc(o.sampleLabel)}</button></div>
     <div id="c-res" style="margin-top:12px">${res || ''}</div>`;
    $('#c-take').onclick = async () => { if (busy) return; const d = await pickPhoto(); if (d) { img = d; run(); } };
    $('#c-demo').onclick = () => { if (busy) return; img = toB64(o.sample()); run(); };
  };
  const run = async () => {
    busy = true; tries++;
    draw(`<div class="ai"><div class="thinking"><div class="spinner"></div>AI is checking the photo…</div></div>`);
    let r;
    if (o.kind === 'return') {
      const [p, d] = await Promise.all([ai('parking', [img]), o.before ? ai('damage', [o.before, img]) : Promise.resolve(null)]);
      r = { ok: p.ok, error: p.error, ms: Math.max(p.ms, d?.ms || 0), result: p.result, damage: d && d.ok ? d.result : null, model: p.model };
    } else r = await ai(o.kind, [img]);
    busy = false;
    const v = verdict(o.kind, r);
    draw(`<div class="ai ${v.cls}"><div class="head"><span class="badge">AI</span>${esc(v.title)}<span class="grow"></span><span class="xs muted">${r.ms ? (r.ms / 1000).toFixed(1) + 's' : ''}</span></div><ul>${v.lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
      ${r.result?.instruction_text_seen ? '<div class="note red" style="margin-top:8px">⚠ The photo contained text trying to instruct the AI. It was ignored and flagged.</div>' : ''}</div>
      ${v.pass ? `<button class="btn" style="margin-top:12px" id="c-ok">${o.kind === 'battery' ? 'Matches what I see · Continue' : 'Continue'}</button>`
        : tries >= 2 || !r.ok ? `<button class="btn ghost" style="margin-top:12px" id="c-ok">Send to a person for review · continue (demo)</button>` : ''}`);
    const ok = $('#c-ok'); if (ok) ok.onclick = () => o.onPass(v.data || {}, img);
  };
  draw();
}
function verdict(kind, r) {
  if (!r.ok) return { cls: 'warn', title: 'AI check unavailable', lines: [r.error === 'rate_limited' ? 'Too many checks from this device. Try again in a few minutes.' : "Couldn't reach the AI. A person will review this photo instead.", 'Nothing is approved or charged automatically.'], pass: false, data: {} };
  const x = r.result || {};
  if (kind === 'battery') {
    if (x.status === 'readable' && x.display_kind === 'percent' && x.percent != null) return { cls: 'ok', title: `Battery reads ${x.percent}%`, lines: [`Display text: "${x.visible_text || x.percent + '%'}"`, 'Read from the photo, not typed by anyone.'], pass: true, data: x };
    if (x.display_kind === 'bars' && x.bars_lit != null) return { cls: 'warn', title: `${x.bars_lit} of ${x.bars_total} bars`, lines: ['Bars aren\'t a precise percentage. Retake closer if the display shows a number.'], pass: false, data: x };
    return { cls: 'bad', title: "Can't read the battery", lines: [x.retake_instruction || 'Move closer, block the glare and retake.'], pass: false, data: x };
  }
  if (kind === 'license') {
    const valid = x.expiry_iso && x.expiry_iso >= new Date(now()).toISOString().slice(0, 10) && ['driver_license', 'instruction_permit'].includes(x.document_category);
    return valid ? { cls: 'ok', title: 'License looks valid', lines: [`${x.document_category === 'instruction_permit' ? 'Learner permit' : 'Driver license'} · ${x.issuing_jurisdiction || 'unknown state'}`, `Expires ${x.expiry_iso}`, 'No name, number or face was read. The photo is deleted now.'], pass: true, data: x }
      : { cls: 'bad', title: x.expiry_iso ? 'License expired or not accepted' : "Couldn't read the expiry date", lines: ['Retake in good light, or a staff member can check it in person.'], pass: false, data: x };
  }
  const p = x, good = p.view_quality === 'usable' && p.upright !== 'no' && p.walkway_obstructed !== 'yes' && p.shackle_appears_closed !== 'no';
  const lines = [`Upright: ${p.upright} · walkway blocked: ${p.walkway_obstructed}`, `Lock through frame + rack: ${p.frame_and_rack_path_visible} · shackle closed: ${p.shackle_appears_closed}`, `Rack sticker visible: ${p.rack_label_visible}`, ...(p.corrective_instructions || []).slice(0, 2)];
  if (kind === 'return' && r.damage) {
    const d = r.damage, n = (d.new_visible_differences || []).length;
    lines.push(n ? `Possible new damage: ${d.new_visible_differences.map(z => z.description).join('; ')} (a person will review)` : 'No new damage compared with the pickup photo.');
  }
  return { cls: good ? 'ok' : 'warn', title: good ? (kind === 'return' ? 'Parked, locked, checked' : 'Looks good') : 'Fix the parking', lines, pass: good, data: { ...p, damage: r.damage } };
}

/* ---------- actions ---------- */
const A = window.A = {
  login() {
    const netid = ($('#nid').value || 'ttrojan').trim().toLowerCase().replace(/[^a-z0-9]/g, '') || 'ttrojan';
    $('#duo').innerHTML = `<div class="duo"><div class="spinner"></div><div class="b">Duo push sent</div><div class="sm muted">Approve on your phone…</div></div>`; $('#go').disabled = true;
    setTimeout(() => { const nm = netid === 'ttrojan' ? 'Tommy' : netid[0].toUpperCase() + netid.slice(1, 8); S.user = { netid, name: nm, dorm: $('#dorm').value }; save(); go('#/onboard'); }, 1400);
  },
  agree() { S.agreed = true; save(); go('#/home'); },
  filter(k) { S.filter = k; render(); },
  rack(id) { S.rackFilter = id; render(); },
  book(vid) {
    const v = S.vehicles.find(x => x.id === vid), curfew = Math.min(v.until, endOfDay()), rt = rateOf(v);
    modal(`<div class="h3" style="font-size:20px">Confirm ${esc(v.name)}</div><p class="sm muted">Round trip from ${esc(rack(v.rack).name)}</p>
     <div class="card"><div class="kv"><span>Start (2 hours + 2 miles)</span><b>${money(rt.base)}</b></div><div class="kv"><span>Extra hour / extra mile</span><span>${money(rt.hr)} / ${money(rt.mi)}</span></div><div class="kv"><span>Refundable hold</span><span>${money(HOLD[cls(v)])}</span></div><div class="kv"><span>Pick up within</span><span>10 minutes</span></div><div class="kv"><span>Curfew: back at ${esc(rack(v.rack).name)} by</span><b>${t(curfew)}</b></div></div>
     <div class="note" style="margin:12px 0">Miss the curfew and it’s a one-time $10. If the battery dies, you kick it home without the motor. Still faster than walking.</div>
     <button class="btn" onclick="A.confirm('${vid}')">Start for ${money(rt.base)} · Visa 4242 (test)</button>`);
  },
  confirm(vid) {
    const v = S.vehicles.find(x => x.id === vid), n = now();
    S.booking = { vid, rack: v.rack, at: v.rack, phase: 'booked', step: 'scan', created: n, pickupBy: n + 10 * MIN, end: Math.min(v.until, endOfDay()), rate: { ...rateOf(v) }, price: rateOf(v).base, hold: HOLD[cls(v)], rideMin: 0, miles: 0 };
    v.status = 'booked'; S.sel = null; save(); closeModal(); toast('Booked! Head to ' + rack(v.rack).name); go('#/pickup');
  },
  cancel() { const b = S.booking; S.vehicles.find(x => x.id === b.vid).status = 'available'; S.booking = null; save(); toast('Booking cancelled. Hold released.'); go('#/home'); },
  scan() { const b = S.booking; toast('Rack ' + b.rack + '-01 matched ✓'); b.step = isE(S.vehicles.find(x => x.id === b.vid)) ? 'battery' : 'condition'; render(); },
  pickBattery(r) {
    const b = S.booking, v = S.vehicles.find(x => x.id === b.vid), need = RANGE[v.range].min;
    if (r.percent == null) r = { percent: v.battery };   // human-review path: keep the owner's last verified reading
    if (r.percent < need) { toast(`${r.percent}% is below the ${need}% needed to start. Booking cancelled, no charge.`); v.battery = r.percent; v.status = 'available'; S.booking = null; save(); return go('#/home'); }
    b.pickupBattery = r.percent; v.battery = r.percent; v.battAgo = 0; b.step = 'condition'; render();
  },
  pickCondition(img) { const b = S.booking; b.beforeImg = img; b.step = 'unlock'; render(); },
  async unlock(demo) {
    const b = S.booking, lk = $('#lk'); lk.classList.add('busy');
    let ok = false;
    if (!demo && navigator.bluetooth) {
      try {
        const key = await (await fetch(API + '/key', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ vehicle: b.vid, until: b.end }) })).json();
        const dev = await navigator.bluetooth.requestDevice({ filters: [{ namePrefix: 'SCoot' }], optionalServices: [LOCK_SVC] });
        const ch = await (await (await dev.gatt.connect()).getPrimaryService(LOCK_SVC)).getCharacteristic(LOCK_CHR);
        await ch.writeValue(new TextEncoder().encode(key.msg + '|' + key.sig)); ok = true; dev.gatt.disconnect();
      } catch (e) { lk.classList.remove('busy'); return toast(e.name === 'NotFoundError' ? 'No lock picked. Use demo unlock.' : 'Lock not reachable: ' + e.message); }
    } else { await new Promise(r => setTimeout(r, 1300)); ok = true; }
    if (ok) {
      lk.classList.remove('busy'); lk.classList.add('open'); toast('Unlocked. Ride safe! ✌');
      const v = S.vehicles.find(x => x.id === b.vid); v.status = 'rented';
      b.phase = 'active'; b.startedAt = now(); b.lastTick = now(); if (!isE(v)) b.pickupBattery = null; save(); logLoc('unlock', b.rack);
      setTimeout(() => go('#/ride'), 900);
    }
  },
  parkPick(id) { S.parkPick = id; render(); },
  parkDone(id) { const b = S.booking; meter(); b.miles = (b.miles || 0) + miles(rack(b.at || b.rack), rack(id)); b.phase = 'parked'; b.at = id; S.parkPick = null; save(); logLoc('lock', id); toast('Locked at ' + rack(id).name + '. Your time keeps running.'); go('#/ride'); },
  unpark() { const b = S.booking; meter(); b.phase = 'active'; save(); logLoc('unlock', b.at); toast('Unlocked. Your one-time key still works until ' + t(b.end)); render(); },
  startReturn() { const b = S.booking; meter(); b.phase = 'returning'; b.rstep = 'scan'; save(); go('#/return'); },
  rscan() { const b = S.booking; toast('Home rack ' + b.rack + '-01 matched ✓'); b.miles = (b.miles || 0) + miles(rack(b.at || b.rack), rack(b.rack)); b.at = b.rack; b.rstep = isE(S.vehicles.find(x => x.id === b.vid)) ? 'battery' : 'photo'; render(); },
  retBattery(r) { const b = S.booking; b.returnBattery = r.percent ?? null; b.rstep = 'photo'; if (r.percent != null && r.percent < RETURN_FLOOR) toast(`${r.percent}% is under ${RETURN_FLOOR}%. No fee, but plan for the trip home next time.`); render(); },
  retPhoto(res) { const b = S.booking; b.damage = !!(res.damage && (res.damage.new_visible_differences || []).length); b.rstep = 'lock'; render(); },
  rstep(s) { S.booking.rstep = s; render(); },
  async finish() {
    const b = S.booking, v = S.vehicles.find(x => x.id === b.vid), lk = $('#lk'); lk.classList.remove('open'); lk.classList.add('busy');
    await logLoc('lock', b.rack);
    setTimeout(() => {
      const bl = bill(b, now()), late = bl.late; gpsStop();
      const est = isE(v) && b.pickupBattery != null ? estBatt(b, v) : null;
      if (est != null && b.returnBattery != null && bl.mi >= 0.5) v.drain = Math.min(15, Math.max(1, .7 * drainOf(v) + .3 * (b.pickupBattery - b.returnBattery) / bl.mi));
      S.trips.unshift({ name: v.name, rack: rack(b.rack).name, owner: v.owner.name, bill: bl, price: bl.total - late, late, hold: b.hold, b0: b.pickupBattery ?? null, b1: b.returnBattery ?? null, est, lowBatt: b.returnBattery != null && b.returnBattery < RETURN_FLOOR, damage: b.damage, at: now(), logN: (b.log || []).length });
      v.status = 'available'; if (b.returnBattery != null) { v.battery = b.returnBattery; v.battAgo = 0; } v.trips++;
      S.booking = null; save(); go('#/receipt');
    }, 900);
  },
  stars(n) { S.trips[0].stars = n; save(); render(); toast('Thanks! ' + S.trips[0].owner + ' sees your rating.'); },
  problem(k) {
    const b = S.booking, v = S.vehicles.find(x => x.id === b.vid), r = rack(b.rack), here = rack(b.at || b.rack), mi = miles(here, r), wm = Math.max(2, Math.round(mi / 3 * 60));
    const M = {
      dead: `<div class="h3" style="font-size:20px">🔋 Battery died</div><p class="sm ink2">Kick it back to <b>${esc(r.name)}</b> without the motor: about ${mi.toFixed(1)} mi. Still faster than walking. Report it now and your <b>curfew moves back 30 minutes</b>.</p><div class="note red">If it's hot, smoking, leaking or won't roll, stop. Don't move it, step away, and call DPS (213) 740-4321.</div><div style="height:12px"></div><button class="btn" onclick="A.report('dead')">Report & move curfew 30 min</button>`,
      broken: `<div class="h3" style="font-size:20px">🛞 It broke on you</div><p class="sm ink2">Not your fault, so it's not your cost. Lock it to the nearest rack and take a photo. We refund the unused time, end your rental there, and ${esc(v.owner.name)} picks it up.</p><button class="btn" onclick="A.report('broken')">Lock here & end rental</button>`,
      lock: `<div class="h3" style="font-size:20px">🔐 Lock trouble</div><p class="sm ink2">1. Stand within 2 m and turn Bluetooth on. 2. Try again. 3. Still stuck? Support can open it remotely or send someone. The clock pauses while it's our problem.</p><button class="btn" onclick="A.report('lock')">Contact support · pause clock</button>`,
      phone: `<div class="h3" style="font-size:20px">📵 Phone dying</div><p class="sm ink2">Your curfew (${t(b.end)}) and home rack (${esc(r.name)}) are saved offline. Lock it at a rack if you can. To finish later, sign in on any phone or ask the IRC front desk. No late fees while support confirms it.</p><button class="btn" onclick="A.report('phone')">Got it</button>`,
      full: `<div class="h3" style="font-size:20px">🅿 Home rack full</div><p class="sm ink2">Lock it to the nearest legal rack within 100 m of ${esc(r.name)} and take a photo. Support approves the spot and tells ${esc(v.owner.name)} exactly where it is.</p><button class="btn" onclick="A.report('full')">Use nearby rack</button>`,
      stolen: `<div class="h3" style="font-size:20px">🚨 Stolen</div><p class="sm ink2">Don't chase anyone. Call DPS at <b>(213) 740-4321</b>. We send DPS the serial number, its DPS decal and the hidden GPS tag's live location. If it was locked properly, you don't pay for it.</p><a class="btn" href="tel:2137404321" style="text-decoration:none">Call DPS</a><div style="height:8px"></div><button class="btn ghost" onclick="A.report('stolen')">File report</button>`,
      crash: `<div class="h3" style="font-size:20px">🤕 Crash</div><p class="sm ink2">If anyone is hurt, call 911. Then DPS at (213) 740-4321. Your rental pauses and no fees run while we sort it out.</p><a class="btn" href="tel:911" style="text-decoration:none">Call 911</a><div style="height:8px"></div><button class="btn ghost" onclick="A.report('crash')">Report incident</button>`,
    };
    modal(M[k]);
  },
  report(k) {
    const b = S.booking; S.reports.push({ k, at: now() }); closeModal();
    if (k === 'dead') { b.end += 30 * MIN; toast('Reported. Curfew moved to ' + t(b.end)); }
    else if (k === 'broken') { const v = S.vehicles.find(x => x.id === b.vid); v.status = 'repair'; S.trips.unshift({ name: v.name, rack: rack(b.at || b.rack).name, owner: v.owner.name, price: 0, late: 0, hold: b.hold, b0: b.pickupBattery ?? null, b1: null, at: now() }); S.booking = null; save(); toast('Rental ended. Full refund. Owner notified.'); return go('#/home'); }
    else toast('Support has your report. Reply within 5 min.');
    save(); go('#/ride');
  },
  list() { S.mine.listed = !S.mine.listed; save(); render(); toast(S.mine.listed ? 'Traveler is rentable again' : 'Paused. Current rental still finishes.'); },
  day(i) { S.mine.days[i] = S.mine.days[i] ? 0 : 1; render(); },
  rate(k, val) { const x = Math.round(parseFloat(val) * 2) / 2, lo = k === 'base' ? 1 : 0; if (!(x >= lo && x <= (k === 'base' ? 50 : 20))) { toast('Pick between ' + money(lo) + ' and ' + money(k === 'base' ? 50 : 20)); return render(); } S.mine.rate = { ...rateOf(S.mine), [k]: x }; save(); toast('Price saved: ' + money(x)); },
  win(k, val) { S.mine[k] = val; save(); toast('Saved'); },
  reserve() { toast('Outlet 2 reserved 9 PM–1 AM. Power cuts off at full.'); },
  addVehicle() { modal(`<div class="h3" style="font-size:20px">Add a scooter or bike</div><p class="sm ink2">We check the model is certified (UL 2272 / UL 2849) and not recalled, register it with DPS, and give you the starter kit for free:</p><ul class="sm ink2" style="line-height:1.7"><li>Smart U-lock (opens with your phone)</li><li>Hardened chain</li><li>Ride log from the renter’s phone</li><li>DPS registration decal</li></ul><button class="btn" onclick="closeModal();toast('Kit requested: pick up at the IRC front desk')">Request my kit</button>`); },
  cashout() { toast('Payout of ' + money(S.mine.balance) + ' sent (Stripe test mode)'); S.wallet.unshift({ d: 'Cash out to bank', a: -S.mine.balance, ago: 'just now' }); S.mine.balance = 0; save(); render(); },
  ff(m) { S.skew = (S.skew || 0) + m * MIN; meter(); save(); toast('Clock moved ' + m + ' minutes ahead'); render(); },
  ownerReturn() { const m = S.mine; if (!m.rental) return toast('Traveler is already home.'); m.history.unshift({ who: m.rental.renter, hrs: '1 h 10 m · 1.0 mi', earn: m.rental.earn, ago: 'just now', checks: 'Battery 38% · parked at IRC · no new damage' }); m.week[(new Date(now()).getDay() + 6) % 7] += m.rental.earn; m.balance += m.rental.earn; m.battery = 38; m.rental = null; save(); toast('Jordan returned Traveler to IRC. +' + money(3.5)); go('#/garage'); },
  reset() { if (!confirm('Reset all demo data?')) return; S = seed(); save(); go('#/welcome'); render(); },
  logout() { S.user = null; save(); go('#/welcome'); },
};
const LOCK_SVC = '7a0e0001-6d1b-4c1f-9b1e-5243554f4e01', LOCK_CHR = '7a0e0002-6d1b-4c1f-9b1e-5243554f4e01';
// Ride log: the renter's phone location at every unlock and lock (the lock itself has no GPS).
function nearestRack(lat, lng) { let best = null, d = 1e9; for (const r of RACKS) { const m = miles({ lat, lng }, r); if (m < d) { d = m; best = r; } } return d < 0.12 ? best.name : lat.toFixed(4) + ', ' + lng.toFixed(4); }
async function logLoc(kind, fallbackRack) {
  const b = S.booking; if (!b) return; b.log = b.log || [];
  let pos = null;
  try {
    const st = navigator.permissions ? (await navigator.permissions.query({ name: 'geolocation' })).state : 'prompt';
    if (st === 'granted' || (st === 'prompt' && matchMedia('(pointer:coarse)').matches)) { if (kind === 'unlock') gpsStart(); else gpsStop(); }
    if (st === 'granted' || (st === 'prompt' && matchMedia('(pointer:coarse)').matches))
      pos = await new Promise(res => navigator.geolocation.getCurrentPosition(p => res(p.coords), () => res(null), { timeout: 5000, maximumAge: 30000 }));
  } catch { }
  const r = rack(fallbackRack || b.at || b.rack);
  b.log.push(pos ? { kind, t: now(), place: nearestRack(pos.latitude, pos.longitude), gps: true } : { kind, t: now(), place: r.name, gps: false });
  save();
}
// Real phones: while riding, add up GPS movement (ignores jitter under 15 m).
let gpsWatch = null, gpsLast = null;
function gpsStart() {
  if (!navigator.geolocation || gpsWatch != null) return;
  gpsWatch = navigator.geolocation.watchPosition(p => {
    const b = S.booking, c = { lat: p.coords.latitude, lng: p.coords.longitude }; if (!b) return;
    if (gpsLast) { const d = miles(gpsLast, c) / 1.3; if (d > 0.01) { b.gpsMiles = (b.gpsMiles || 0) + d; gpsLast = c; save(); } } else gpsLast = c;
  }, () => { }, { enableHighAccuracy: true, maximumAge: 5000 });
}
function gpsStop() { if (gpsWatch != null) navigator.geolocation.clearWatch(gpsWatch); gpsWatch = null; gpsLast = null; }
function meter() { const b = S.booking; if (!b) return; if (b.phase === 'active') b.rideMin += Math.max(0, (now() - (b.lastTick || now())) / MIN); b.lastTick = now(); }
window.go = go; window.back = back; window.closeModal = closeModal; window.toast = toast;

/* status bar clock */
setInterval(() => { $('#sb-time').textContent = new Date(now()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M/, ''); }, 1000);
render();
