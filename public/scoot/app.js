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
// extra hour and a price per started extra mile. The curfew is the owner's back-by time; missing it adds a one-time $15.
const PRICING = { inclHours: 2, inclMiles: 2, curfewFee: 15 }, RATE0 = { base: 5, hr: 2, mi: 2 };
const rateOf = v => v.rate || RATE0;
const MIN_BOOK = 45 * MIN;                                   // need at least this long before the owner's curfew to book
const rideMiles = b => (b.miles || 0) + (b.legGps || 0);
const closeLeg = (b, from, to) => { b.miles = (b.miles || 0) + ((b.legGps || 0) > 0.05 ? b.legGps : miles(from, to)); b.legGps = 0; };
function bill(b, endTs) {
  const rt = b.rate || RATE0, t0 = b.startedAt || b.created, hours = Math.max(0, (endTs - t0) / HOUR), mi = rideMiles(b);
  const billH = b.waiveFrom ? Math.max(0, (Math.min(endTs, b.waiveFrom) - t0) / HOUR) : hours;   // no extra time after a reported incident
  const xh = Math.max(0, Math.ceil(billH - PRICING.inclHours - 1e-9)), xm = b.timeOnly ? 0 : Math.max(0, Math.ceil(mi - PRICING.inclMiles - 1e-9));   // pedal bikes: time only
  const late = endTs > b.end && !(b.waiveFrom && b.waiveFrom <= b.end) ? PRICING.curfewFee : 0;
  return { hours, mi, xh, xm, late, rt, timeOnly: !!b.timeOnly, total: rt.base + xh * rt.hr + xm * rt.mi + late };
}
// Battery estimate: the last AI photo reading minus miles ridden x this scooter's drain per mile.
// Drain starts at 100% / full-charge range and is re-learned from the before/after photos of every ride.
const drainOf = v => v.drain || 100 / RANGE[v.range].full;
const battAge = v => v.battAt ? Math.max(0, Math.round((now() - v.battAt) / MIN)) : v.battAgo + Math.round((Date.now() - (S.seededAt || Date.now())) / MIN);   // real time since seeding (now() carries the demo offset)
const estBatt = (b, v) => Math.max(0, Math.round((b.pickupBattery ?? v.battery ?? 0) - rideMiles(b) * drainOf(v)));
const HOLD = { e: 25, bike: 10 };
// The 30% SCoot keeps: half pays off the owner's $86 lock kit, half covers card fees + the safety fund.
// Once the kit is paid off, the owner keeps 90% and SCoot keeps 10% for card fees and the safety fund.
const KIT = 86, SPLIT = { owner: .70, kit: .15, ops: .15 }, PAID_OFF_SHARE = .90;
// Launch lock: a small combination key box (about $20, bought by the owner) holds the key to the owner's own lock. The renter
// gets the code after the pickup photos; the owner changes it every night when the scooter comes in to charge. There's no
// SCoot lock to pay off, so the owner keeps 90% from the first ride. The smart padlock kit comes with the pilot.
const keybox = v => v.lock === 'keybox';
const kitLeft = v => keybox(v) ? 0 : Math.max(0, KIT - (v.kitPaid || 0));
const ownerShare = v => kitLeft(v) > 0 ? SPLIT.owner : PAID_OFF_SHARE;
function split(v, fare) {   // -> { owner, kit, ops } in dollars for one fare
  const c = Math.round(fare * 100), kit = Math.min(Math.round(kitLeft(v) * 100), Math.round(c * SPLIT.kit)), ops = Math.round(c * (kitLeft(v) > 0 ? SPLIT.ops : 1 - PAID_OFF_SHARE));
  return { owner: (c - kit - ops) / 100, kit: kit / 100, ops: ops / 100 };
}
const RANGE = { long: { full: 25, min: 40, label: 'Long range' }, medium: { full: 15, min: 50, label: 'Medium range' }, short: { full: 10, min: 60, label: 'Short range' } };
const RETURN_FLOOR = 20;
const LAST_RETURN_HOUR = 23;                                // no overnight rentals
const isE = v => v.type !== 'bike';
// Pedal bikes have no battery, so they're priced by time only: no mile price, no mile counter.
const inclTxt = v => isE(v) ? '2 hours + 2 miles' : '2 hours';
// Demo owners get fictional 555-01xx numbers (the range reserved for fiction).
const phoneOf = o => o.phone || '(213) 555-01' + String((o.name.charCodeAt(0) * 7 + o.name.length * 3) % 90 + 10);
const licenseOk = () => !!(S.license && !S.license.pending && S.license.exp && S.license.exp >= new Date(now()).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }));
const unfinished = b => b && ['booked', 'active', 'parked', 'returning'].includes(b.phase);
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
// Time saved: walking the ridden distance at 2 mph, minus the minutes actually spent riding (parked time doesn't count).
const WALK_MPH = 2, walkMins = mi => mi / WALK_MPH * 60;
const savedMins = b => Math.max(0, Math.round(walkMins(rideMiles(b)) - (b.rideMin || 0)));

/* ---------- state ---------- */
// Demo clock: outside 8 AM-8 PM the demo runs at 12:40 PM, so owners' hours look like a normal day.
function dayClock() { const d = new Date(), h = d.getHours(); if (h >= 8 && h < 20) return 0; d.setHours(12, 40, 0, 0); return d - Date.now(); }
let S = { skew: dayClock() };
function seed() {
  const n = now(), until = h => Math.min(roundUp30(n + h * HOUR), endOfDay() || n + h * HOUR);
  const O = (name, color, dorm) => ({ name, initials: name.slice(0, 2).toUpperCase(), color, dorm });
  return {
    v: 1, skew: S.skew || 0, user: null, license: null, agreed: false, filter: 'all', rackFilter: null,
    vehicles: [
      { id: 'v1', rate: { base: 5, hr: 2, mi: 2 }, name: 'Big Red', model: 'Segway Ninebot Max G30', type: 'scooter', range: 'long', rack: 'IRC', owner: O('Maya', '#7c3aed', 'IRC'), battery: 84, battAgo: 18, status: 'available', until: until(6), rating: 4.9, trips: 37, kitPaid: 29.6, color: '#990000' },
      { id: 'v2', rate: { base: 4, hr: 1.5, mi: 1.5 }, name: 'Gold Rush', model: 'Hiboy S2 Pro', type: 'scooter', range: 'medium', rack: 'IRC', owner: O('Dev', '#0891b2', 'IRC'), battery: 72, battAgo: 41, status: 'available', until: until(3), rating: 4.8, trips: 22, kitPaid: 17.6, color: '#d4a300' },
      { id: 'v3', rate: { base: 3, hr: 1, mi: 0 }, lock: 'keybox', code: '2207', name: 'Fixie Fight On', model: 'State Bicycle 6061', type: 'bike', range: null, rack: 'IRC', owner: O('Sam', '#059669', 'IRC'), battery: null, status: 'available', until: until(8), rating: 5.0, trips: 15, kitPaid: 12.0, color: '#1f2937' },
      { id: 'v4', rate: { base: 5, hr: 2, mi: 2 }, name: 'Pump', model: 'Xiaomi Scooter 4 Pro', type: 'scooter', range: 'long', rack: 'LYON', owner: O('Ava', '#db2777', 'Webb'), battery: 66, battAgo: 25, status: 'available', until: until(4), rating: 4.7, trips: 19, kitPaid: 15.2, color: '#374151' },
      { id: 'v5', rate: { base: 6, hr: 2, mi: 2 }, name: 'Doheny Dash', model: 'NIU KQi3 Pro', type: 'scooter', range: 'medium', rack: 'LEAVEY', owner: O('Leo', '#ea580c', 'Birnkrant'), battery: 91, battAgo: 9, status: 'available', until: until(5), rating: 4.9, trips: 112, kitPaid: 86, color: '#b91c1c' },
      { id: 'v6', rate: { base: 7, hr: 3, mi: 2 }, name: 'Conquest', model: 'Rad Power RadMission e-bike', type: 'ebike', range: 'long', rack: 'VILLAGE', owner: O('Priya', '#2563eb', 'McCarthy'), battery: 58, battAgo: 33, status: 'available', until: until(6), rating: 4.8, trips: 12, kitPaid: 9.6, color: '#0f766e' },
      { id: 'v7', rate: { base: 2, hr: 1, mi: 0 }, name: 'Hellman Hauler', model: 'Trek FX 1', type: 'bike', range: null, rack: 'MARKS', owner: O('Nate', '#9333ea', 'Marks'), battery: null, status: 'available', until: until(7), rating: 4.6, trips: 9, kitPaid: 7.2, color: '#475569' },
      { id: 'v8', rate: { base: 4, hr: 1.5, mi: 2 }, name: 'Little Wheelie', model: 'Segway Ninebot E2', type: 'scooter', range: 'short', rack: 'WEBB', owner: O('Jules', '#ca8a04', 'Webb'), battery: 45, battAgo: 52, status: 'available', until: until(4), rating: 4.5, trips: 8, kitPaid: 6.4, color: '#64748b' },
      { id: 'v9', rate: { base: 5, hr: 2, mi: 2 }, name: 'Viterbi Vroom', model: 'Segway Ninebot Max G30', type: 'scooter', range: 'long', rack: 'RTH', owner: O('Kai', '#16a34a', 'Parkside'), battery: 77, battAgo: 14, status: 'available', until: until(5), rating: 4.9, trips: 30, kitPaid: 24.0, color: '#7f1d1d' },
      { id: 'v11', rate: { base: 5, hr: 2, mi: 2 }, lock: 'keybox', code: '4819', name: 'Trojan Express', model: 'Segway Ninebot Max G2', type: 'scooter', range: 'long', rack: 'IRC', owner: O('Ethan', '#0ea5e9', 'IRC'), battery: 79, battAgo: 22, status: 'available', until: until(5), rating: 4.8, trips: 26, kitPaid: 20.8, color: '#990000' },
      { id: 'v12', rate: { base: 4.5, hr: 2, mi: 1.5 }, name: 'Cardinal Cruiser', model: 'Hiboy S2 Max', type: 'scooter', range: 'medium', rack: 'IRC', owner: O('Sofia', '#c026d3', 'IRC'), battery: 63, battAgo: 37, status: 'available', until: until(4), rating: 4.7, trips: 18, kitPaid: 14.4, color: '#7f1d1d' },
      { id: 'v13', rate: { base: 4, hr: 1.5, mi: 1.5 }, name: 'Victory Lap', model: 'NIU KQi2 Pro', type: 'scooter', range: 'medium', rack: 'IRC', owner: O('Chloe', '#f43f5e', 'IRC'), battery: 38, battAgo: 64, status: 'available', until: until(6), rating: 4.6, trips: 11, kitPaid: 8.8, color: '#334155' },
      { id: 'v14', rate: { base: 5, hr: 2, mi: 2 }, name: 'Fight On Flyer', model: 'Segway Ninebot F2', type: 'scooter', range: 'medium', rack: 'LYON', owner: O('Marcus', '#16a34a', 'Fluor'), battery: 81, battAgo: 12, status: 'available', until: until(5), rating: 4.9, trips: 33, kitPaid: 26.4, color: '#d4a300' },
      { id: 'v15', rate: { base: 6, hr: 2, mi: 2 }, name: 'Gold Standard', model: 'Apollo Air', type: 'scooter', range: 'long', rack: 'VILLAGE', owner: O('Hana', '#9333ea', 'McCarthy'), battery: 92, battAgo: 8, status: 'available', until: until(6), rating: 5.0, trips: 40, kitPaid: 32.0, color: '#ca8a04' },
      { id: 'v16', rate: { base: 4, hr: 1.5, mi: 1.5 }, name: 'Expo Express', model: 'Gotrax G4', type: 'scooter', range: 'medium', rack: 'VILLAGE', owner: O('Diego', '#ea580c', 'Cowlings'), battery: 70, battAgo: 29, status: 'available', until: until(3), rating: 4.6, trips: 14, kitPaid: 11.2, color: '#1f2937' },
      { id: 'v17', rate: { base: 3, hr: 1, mi: 0 }, name: 'Spirit of Troy', model: 'Trek Verve 1', type: 'bike', range: null, rack: 'VILLAGE', owner: O('Grace', '#0d9488', 'Cowlings'), battery: null, status: 'available', until: until(7), rating: 4.9, trips: 21, kitPaid: 16.8, color: '#990000' },
      { id: 'v18', rate: { base: 5, hr: 2, mi: 2 }, name: 'Late Night Leavey', model: 'Segway Ninebot Max G30', type: 'scooter', range: 'long', rack: 'LEAVEY', owner: O('Omar', '#2563eb', 'Webb'), battery: 55, battAgo: 47, status: 'rented', until: until(4), rating: 4.8, trips: 29, kitPaid: 23.2, color: '#475569' },
      { id: 'v19', rate: { base: 7, hr: 3, mi: 2 }, name: 'Big Wheel', model: 'Rad Power RadRunner e-bike', type: 'ebike', range: 'long', rack: 'CARD', owner: O('Zoe', '#db2777', 'Cardinal Gardens'), battery: 74, battAgo: 19, status: 'available', until: until(5), rating: 4.9, trips: 17, kitPaid: 13.6, color: '#0f766e' },
      { id: 'v20', rate: { base: 4, hr: 1.5, mi: 1.5 }, name: 'Doheny Drifter', model: 'Hiboy S2', type: 'scooter', range: 'medium', rack: 'WEBB', owner: O('Ben', '#65a30d', 'Webb'), battery: 86, battAgo: 15, status: 'available', until: until(4), rating: 4.7, trips: 24, kitPaid: 19.2, color: '#b91c1c' },
      { id: 'v21', rate: { base: 4.5, hr: 1.5, mi: 2 }, name: 'Hahn Hopper', model: 'Xiaomi Scooter 4', type: 'scooter', range: 'medium', rack: 'MARKS', owner: O('Ivy', '#7c3aed', 'Marks'), battery: 67, battAgo: 26, status: 'available', until: until(5), rating: 4.8, trips: 16, kitPaid: 12.8, color: '#374151' },
      { id: 'v22', rate: { base: 5, hr: 2, mi: 2 }, name: 'Bovard Bolt', model: 'Segway Ninebot Max G30', type: 'scooter', range: 'long', rack: 'RTH', owner: O('Raj', '#0891b2', 'Parkside'), battery: 89, battAgo: 11, status: 'available', until: until(6), rating: 4.9, trips: 38, kitPaid: 30.4, color: '#990000' },
      { id: 'v23', rate: { base: 3, hr: 1, mi: 0 }, lock: 'keybox', code: '5530', name: 'Marshall Mover', model: 'Schwinn Wayfarer', type: 'bike', range: null, rack: 'BIRN', owner: O('Lucas', '#ca8a04', 'Birnkrant'), battery: null, status: 'available', until: until(8), rating: 4.6, trips: 12, kitPaid: 9.6, color: '#1e3a8a' },
      { id: 'v10', rate: { base: 6, hr: 2.5, mi: 2 }, name: 'Spirit', model: 'Apollo City Pro', type: 'scooter', range: 'long', rack: 'BIRN', owner: O('Mia', '#be123c', 'Birnkrant'), battery: 88, battAgo: 6, status: 'available', until: until(6), rating: 5.0, trips: 44, kitPaid: 35.2, color: '#990000' },
    ],
    mine: {
      id: 'mine', rate: { base: 5, hr: 2, mi: 2 }, kitPaid: 31.5, name: 'Traveler', model: 'Segway Ninebot Max G30P', type: 'scooter', range: 'long', rack: 'IRC', battery: 61, color: '#990000',
      listed: true, days: [1, 1, 1, 1, 1, 0, 0], from: '09:00', to: '18:00', needBy: null,
      rental: { renter: 'Jordan K.', renterDorm: 'IRC', start: n - 70 * MIN, end: n + 4 * HOUR, earn: 3.5, at: 'LEAVEY', state: 'parked' },
      kit: { lockBatt: 82, lockClosed: true, tagPing: 2, decal: 'DPS-UPC-48213' },
      week: [3.5, 7.7, 0, 3.5, 4.9, 0, 0], history: [
        { who: 'Ava R.', hrs: '1 h 20 m · 1.4 mi', earn: 3.5, ago: '1 day ago', checks: 'Battery 31% · parked · no new damage' },
        { who: 'Dev P.', hrs: '4 h 40 m · 1.1 mi', earn: 7.7, ago: '2 days ago', checks: 'Battery 24% · parked · no new damage' },
        { who: 'Jordan K.', hrs: '50 m · 0.8 mi', earn: 3.5, ago: '3 days ago', checks: 'Battery 52% · parked · no new damage' },
      ], balance: 19.6,
    },
    booking: null, trips: [], wallet: [{ d: 'Rentals this week', a: 19.6, ago: 'this week' }],
    reports: [],
  };
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { } }
function load() { try { const x = JSON.parse(localStorage.getItem(KEY)); return x && x.v === 1 ? x : null; } catch { return null; } }
S = load() || seed();
if (S.booking && ['active', 'returning'].includes(S.booking.phase) && navigator.permissions)
  navigator.permissions.query({ name: 'geolocation' }).then(p => { if (p.state === 'granted') gpsStart(); }).catch(() => { });
// ponytail: demo data has fixed times; if the page is opened hours later, refresh vehicle times so rides are bookable again
if (!S.seededAt) S.seededAt = Date.now();
if (Date.now() - S.seededAt > 2 * HOUR && !S.booking) { S.skew = dayClock(); const f = seed(); S.vehicles = f.vehicles.map(fv => { const v = S.vehicles.find(x => x.id === fv.id); return v ? { ...v, until: fv.until, status: v.status === 'booked' || v.status === 'rented' ? fv.status : v.status } : fv; }); if (S.mine.rental) S.mine.rental = f.mine.rental; S.seededAt = Date.now(); }

/* ---------- toast + modal ---------- */
let toastT;
function toast(msg) { const el = $('#toast'); el.textContent = msg; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 2600); }
function modal(html) { closeModal(); const bg = document.createElement('div'); bg.className = 'modal-bg'; bg.id = 'modal'; bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="SCoot" tabindex="-1"><div class="grab" style="width:40px;height:5px;border-radius:3px;background:#d8d0cb;margin:0 auto 14px"></div>${html}</div>`; bg.onclick = e => { if (e.target === bg) closeModal(); }; app.appendChild(bg); bg.querySelector('.modal').focus(); }
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
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
const battColor = p => p == null ? '#6b625d' : p >= 50 ? '#15803d' : p >= 25 ? '#b45309' : '#b91c1c';
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
  if (locked) { x.beginPath(); x.moveTo(560, 492); x.lineTo(560, 400); x.arc(590, 400, 30, Math.PI, 0); x.lineTo(620, 492); x.stroke(); x.fillStyle = '#222'; rr(x, 536, 466, 108, 40, 9); x.fill(); x.fillStyle = '#ffcc00'; x.fillRect(552, 466, 16, 7); x.fillRect(612, 466, 16, 7); x.fillStyle = '#888'; x.beginPath(); x.arc(590, 486, 6, 0, 7); x.fill(); }   // shackle ends sit inside the crossbar: clearly closed
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
// Desktop: scale the whole phone to fit the window instead of squashing it.
function fitPhone() {
  const w = $('#phonewrap'), p = $('#phone'); if (!w) return;
  if (innerWidth <= 520) { p.style.transform = w.style.width = w.style.height = ''; return; }
  const s = Math.min(1, (innerHeight - 96) / 844), bar = $('#plbar');   // leaves room under the phone for the demo player bar
  p.style.transform = `scale(${s})`; w.style.width = 390 * s + 'px'; w.style.height = 844 * s + 56 + 'px';
  if (bar) { bar.style.top = 844 * s + 10 + 'px'; bar.style.width = 390 * s + 'px'; }
}
addEventListener('resize', fitPhone); fitPhone();
// Landing-page "Show me" buttons drive the phone (signing in the demo user if needed).
window.demoJump = h => {
  if (!S.user) { S.user = { netid: 'ttrojan', name: 'Tommy', dorm: 'IRC' }; S.lastNetid = 'ttrojan'; }
  S.agreed = true;
  if (h === 'pickup') {
    if (!unfinished(S.booking)) {
      if (!licenseOk()) S.license = { kind: 'Sample license (demo)', exp: '2029-08-14', at: now() };
      const v = S.vehicles.find(x => x.rack === S.user.dorm && x.type === 'scooter' && x.status === 'available') || S.vehicles.find(x => x.type === 'scooter' && x.status === 'available');
      save(); return v ? A.confirm(v.id) : toast('No scooter free right now.');
    }
    h = { booked: '#/pickup', returning: '#/return' }[S.booking.phase] || '#/ride';
  }
  save(); if (location.hash === h) render(); else location.hash = h;
};
function render() {
  closeModal(); clearInterval(tick); tick = null;
  if (mapObj) { mapObj.stop(); mapObj.remove(); mapObj = null; }
  let h = location.hash.replace(/^#\/?/, '') || '';
  if (!S.user && !['welcome', 'login'].includes(h.split('/')[0])) h = 'welcome';
  if (S.user && (h === '' || h === 'welcome' || h === 'login')) h = S.agreed ? 'home' : 'onboard';
  if (S.user && !S.agreed && !['onboard', 'rules', 'how'].includes(h.split('/')[0])) h = 'onboard';
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
  app.innerHTML = `<div class="view welcome"><div class="hero"><img class="bigR" src="logo-gold.svg" alt="SCoot logo">
    <h1>Rent a scooter from a student in <em>your building.</em></h1>
    <p>Pick it up at the owner’s rack. Ride to class. Bring it back to the same rack by the owner’s curfew. Usually $5 for the first 2 hours and 2 miles.</p>
    <div class="fighton">✌ FIGHT ON. SCOOT ON.</div></div>
    <div class="foot"><button class="btn gold" onclick="go('#/login')">Sign in with USC NetID</button>
    <p class="xs" style="text-align:center;opacity:.7;margin:14px 0 0">USC students only · prototype for AI@USC 2026</p></div></div>`;
};

PAGES.login = () => {
  app.innerHTML = `<div class="view sso"><div class="bar"><span>NetID sign-in</span><span class="xs" style="opacity:.8">DEMO · not a real USC page</span></div>
  <div class="scroll pad" style="padding-top:26px"><h2 style="margin:0 0 6px;letter-spacing:-.5px">Sign in</h2><p class="muted sm" style="margin:0 0 22px">Use your USC NetID. SCoot never sees your password. In the pilot, USC confirms you're a current student.</p>
  <div class="field"><label for="nid">USC NetID</label><input id="nid" autocapitalize="none" autocomplete="username" placeholder="ttrojan" value="${esc(window.DEMO_NETID || 'ttrojan')}"></div>
  <div class="field"><label for="pw">Password (demo, not checked or sent)</label><input id="pw" type="password" autocomplete="current-password" value="fighton1880"></div>
  <div class="field"><label for="dorm">Your residence</label><select id="dorm">${RACKS.filter(r => ['IRC', 'VILLAGE', 'BIRN', 'WEBB', 'MARKS', 'CARD'].includes(r.id)).map(r => `<option value="${r.id}">${r.name}</option>`).join('')}</select></div>
  <div id="duo"></div></div>
  <div class="foot"><button class="btn" id="go" onclick="A.login()">Sign in</button><p class="xs muted" style="text-align:center">Demo sign-in: no real USC credentials are checked or sent.</p></div></div>`;
};

PAGES.onboard = () => {
  const L = S.license;
  app.innerHTML = `<div class="view">${topbar('Before your first ride', false)}
  <div class="scroll pad"><div class="steps"><i class="on"></i><i class="${L ? 'on' : ''}"></i></div>
  <div class="card col"><div class="row"><div class="h3 grow">1 · License check</div>${L ? (L.pending ? '<span class="chip gold">Review (demo)</span>' : '<span class="chip green">Checked</span>') : ''}</div>
   <p class="sm ink2" style="margin:0">California law (Vehicle Code 21235) requires a driver's license or learner's permit to ride a motorized scooter. Ordinary bikes do not need one. <b>Demo: use the sample license, not your real one.</b></p>
   ${licenseOk() ? `<div class="note green">✓ ${esc(L.kind)} · expires ${esc(L.exp)}. SCoot didn’t keep the photo.</div>` : `${L ? `<div class="note">${esc(L.kind)}: retake the check below to ride scooters.</div>` : ''}<div id="lic"></div>`}
  </div>
  <div class="card col" style="margin-top:12px"><div class="h3">2 · The SCoot deal</div>
   <ol class="rules sm" style="padding-left:18px;margin:4px 0">
   <li><b>Round trip.</b> Bring it back to the same rack you got it from.</li>
   <li><b>Owners set the price:</b> a start price covers 2 hours and 2 miles. After that, you pay a price for each started extra hour and each started extra mile. Most owners charge $5 to start, then $2 per extra hour and $2 per extra mile. Ordinary bikes are time only.</li>
   <li><b>Photos at pickup and return.</b> AI reads the battery and checks parking, lock and damage.</li>
   <li><b>Be back by the curfew.</b> Miss it and you pay a one-time $15. If the battery dies, kick it home without the motor.</li>
   <li><b>Lock it at a rack</b> every time you leave it. No passengers and no overnight rentals.</li></ol>
   <a class="link sm" href="#/rules">Read all the rules →</a></div><div style="height:16px"></div></div>
  <div class="foot"><button class="btn" ${L ? '' : 'disabled'} onclick="A.agree()">I agree · Let's ride</button>
  <button class="btn ghost sm" style="margin-top:8px" onclick="A.agree(true)">Skip license (bikes only for now)</button></div></div>`;
  if (!licenseOk()) mountCapture('#lic', { kind: 'license', title: 'Photo of your license', sampleLabel: 'Use sample license', instant: { document_category: 'driver_license', expiry_iso: '2029-08-14' }, sample: () => photoLicense(), onPass: r => { S.license = r.pending ? { kind: 'Pending staff review (demo)', exp: new Date(now() + 86400e3).toISOString().slice(0, 10), pending: true, at: now() } : { kind: r.document_category === 'instruction_permit' ? 'Learner permit' : 'Driver license', exp: r.expiry_iso, at: now() }; save(); toast('License checked. SCoot didn’t keep the photo.'); render(); } });
};

PAGES.home = () => {
  pickupExpired();
  const me = S.user, home = rack(me.dorm);
  const list = S.vehicles.filter(v => S.filter === 'all' || (S.filter === 'scooter' ? v.type === 'scooter' : S.filter === 'bike' ? v.type !== 'scooter' : true))
    .filter(v => !S.rackFilter || v.rack === S.rackFilter);
  const ready = v => v.status === 'available' && (!isE(v) || v.battery >= RANGE[v.range].min) && v.until - now() >= MIN_BOOK + 10 * MIN;
  const at = list.filter(v => v.rack === (S.rackFilter || me.dorm)), others = S.rackFilter ? [] : list.filter(v => v.rack !== me.dorm).sort((a, b) => miles(home, rack(a.rack)) - miles(home, rack(b.rack)));
  const b = S.booking, live = b && ['booked', 'active', 'parked', 'returning'].includes(b.phase);
  const row = v => { const ok = ready(v); return `<button class="veh" onclick="go('#/v/${v.id}')" style="${ok ? '' : 'opacity:.55'}"><div class="thumb">${art(v)}</div><div class="grow"><div class="b">${esc(v.name)}</div><div class="xs muted">${esc(v.model)}</div><div class="row" style="gap:8px;margin-top:4px">${battChip(v.battery)}<span class="xs muted">· ${ok ? 'free till ' + t(v.until) : v.status === 'review' ? 'being checked by staff' : v.status !== 'available' ? 'in use' : isE(v) && v.battery < RANGE[v.range].min ? 'needs charge' : 'unavailable'}</span></div></div><div class="price">${money(rateOf(v).base)}<div class="xs muted" style="font-weight:600">${isE(v) ? '2 h + 2 mi' : '2 h · no miles'}</div></div></button>`; };
  app.innerHTML = `<div class="view"><div class="mapwrap"><div id="map"></div>
   <div class="maptop"><div class="search"><div class="av">${esc(me.name[0])}</div><div class="grow">Rides near <b>${esc(home.name)}</b></div><span class="chip gold">${S.vehicles.filter(ready).length} free</span></div>
   <div class="chips">${[['all', 'All'], ['scooter', '🛴 Scooters'], ['bike', '🚲 Bikes & e-bikes']].map(([k, l]) => `<button class="chip ${S.filter === k ? 'on' : ''}" aria-pressed="${S.filter === k}" onclick="A.filter('${k}')">${l}</button>`).join('')}${S.rackFilter ? `<button class="chip red" onclick="A.rack(null)">${esc(rack(S.rackFilter).name)} ✕</button>` : ''}</div></div>
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
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' }).addTo(mapObj); mapObj.attributionControl.setPrefix(false);   // credit links open in a new tab, never away from the app
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
  const canBook = v.status === 'available' && maxMs >= MIN_BOOK + 10 * MIN, curfew = Math.min(v.until, endOfDay()), rt = rateOf(v);
  const busy = unfinished(S.booking);
  app.innerHTML = `<div class="view"><div class="scroll"><div class="hero-veh"><div class="row"><button class="back" aria-label="Back" onclick="back()">‹</button><div class="grow"></div><span class="chip">${v.type === 'bike' ? '🚲 Bike' : v.type === 'ebike' ? '⚡ E-bike' : '🛴 E-scooter'}</span></div>
   <div class="art">${art(v, 190)}</div><h2 style="margin:0;font-size:28px;letter-spacing:-.8px">${esc(v.name)}</h2><div class="muted sm">${esc(v.model)}${rc ? ' · ' + rc.label : ''}</div>
   <div class="stats"><div class="stat"><b>${e ? v.battery + '%' : '—'}</b><small>${e ? `${v.battSrc === 'old' ? 'last reading' : 'AI-read'} ${battAge(v)} min ago` : 'pedal power'}</small></div><div class="stat"><b>${e ? '~' + Math.round(v.battery / drainOf(v) * .9) + ' mi' : '∞'}</b><small>est. range</small></div><div class="stat"><b>★ ${v.rating.toFixed(1)}</b><small>${v.trips} trips</small></div></div></div>
   <div class="pad"><div class="sec">Owner</div><div class="card owner"><div class="avatar" style="background:${v.owner.color}">${esc(v.owner.initials)}</div><div class="grow"><div class="b">${esc(v.owner.name)} · lives in ${esc(v.owner.dorm)}</div><div class="xs muted">USC verified · lends it until ${t(v.until)} today</div></div><span class="chip green">✓ NetID</span></div>
   <div class="sec">Round trip</div><div class="card row"><div style="font-size:26px">🔁</div><div class="grow"><div class="b">${esc(r.name)}</div><div class="xs muted">Pick up here, bring it back here. ${esc(r.sub)}.</div></div></div>
   <div class="card row" style="margin-top:8px"><div style="font-size:26px">${keybox(v) ? '🔑' : '🔐'}</div><div class="grow"><div class="b">${keybox(v) ? 'Key box' : 'Smart padlock'}</div><div class="xs muted">${keybox(v) ? `${esc(v.owner.name)}’s key is in a small code box on the ${v.type === 'scooter' ? 'scooter' : 'bike'}. You get the code after your pickup photos.` : 'Opens from your phone over Bluetooth.'}</div></div></div>
   ${lowBatt ? `<div class="note red" style="margin-top:12px">🔋 Battery is ${v.battery}%. ${rc.label} scooters need ${rc.min}% to start a rental. The owner has been asked to charge it.</div>` : ''}
   <div class="sec">Price, set by ${esc(v.owner.name)}</div><div class="card"><div class="kv"><span>Start: first ${inclTxt(v)}</span><b>${money(rt.base)}</b></div><div class="kv"><span>Each extra hour</span><span>${money(rt.hr)}</span></div>${e ? `<div class="kv"><span>Each extra mile</span><span>${money(rt.mi)}</span></div>` : `<div class="kv"><span>Miles</span><span>Not charged on bikes</span></div>`}<div class="kv"><span>Curfew: back at ${esc(r.name)} by</span><b>${t(curfew)}</b></div><div class="kv"><span>Miss the curfew</span><span>$15.00</span></div><div class="kv"><span>Refundable hold</span><span>${money(HOLD[cls(v)])}</span></div></div>
   <p class="xs muted" style="margin:10px 2px">${e ? `Parkside to the Village gym and back (1.4 mi, about 1 h 10 min): ${money(rt.base)}. To a 4-hour lecture and back (about 4 h 20 min): ${money(rt.base + 3 * rt.hr)}. Distance comes from your phone’s GPS.` : `Bikes are priced by time only: ${money(rt.base)} for the first 2 hours, then ${money(rt.hr)} per started extra hour. Ride as far as you like.`}</p>
   <div style="height:20px"></div></div></div>
   <div class="foot">${busy ? `<button class="btn dark" onclick="go('#/ride')">You already have a rental →</button>` : e && v.type === 'scooter' && !licenseOk() ? `<button class="btn" onclick="go('#/onboard')">Verify license to ride scooters</button>` : `<button class="btn" ${canBook && !lowBatt ? '' : 'disabled'} onclick="A.book('${id}')">Book · ${money(rt.base)} to start</button>`}</div></div>`;
};

function pickupExpired() {
  const b = S.booking; if (!b || b.phase !== 'booked' || now() <= b.pickupBy) return false;
  S.vehicles.find(x => x.id === b.vid).status = 'available'; S.booking = null; save();
  toast('Pickup window passed. Booking cancelled, no charge.'); go('#/home'); return true;
}
PAGES.pickup = () => {
  if (pickupExpired()) return;
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
    foot = `<button class="btn" onclick="A.scan()">Scan rack sticker (simulated)</button><button class="btn ghost sm" style="margin-top:8px" onclick="A.cancel()">Cancel booking · no charge</button>`;
  } else if (step === 'battery') {
    body = `<p class="ink2 sm" style="margin-top:0">Turn the scooter on and take a close photo of the display. The AI reads the battery so you and the owner agree on the starting charge.</p><div id="cap"></div>`;
  } else if (step === 'condition') {
    body = `<p class="ink2 sm" style="margin-top:0">One photo of the whole ${v.type === 'scooter' ? 'scooter' : 'bike'} at the rack. This is the "before" photo: if someone claims damage later, the AI compares it with your return photo.</p><div id="cap"></div>`;
  } else if (keybox(v)) {
    body = `<div style="text-align:center"><div class="xs muted b" style="letter-spacing:.08em">KEY BOX CODE</div><div class="codebox" id="lk">${String(v.code || '0000').split('').map(d => `<span>${esc(d)}</span>`).join('')}</div><div class="h3">${esc(v.owner.name)}’s key box</div><p class="sm muted" style="margin:6px 0 0">Turn the dials to this code, take out ${esc(v.owner.name)}’s key and open the lock. Keep the key with you and lock up with it whenever you park. ${esc(v.owner.name)} changes the code every night.</p><div class="note" style="margin-top:10px;text-align:left">🤫 Keep this code to yourself. If it leaks and the scooter is stolen, you’re responsible.</div></div>
     <div class="card" style="margin-top:16px"><div class="kv"><span>Start battery</span><b>${e ? b.pickupBattery + '%' : '—'}</b></div><div class="kv"><span>Before photo</span><b style="color:var(--ok)">Saved ✓</b></div><div class="kv"><span>Back at ${esc(r.name)} by</span><b>${t(b.end)}</b></div></div>`;
    foot = `<button class="btn gold" onclick="A.unlock()">🔑 Got the key · Start ride</button>`;
  } else {
    body = `<div style="text-align:center"><div class="lockbig" id="lk">${ICON.lock}</div><div class="h3">${esc(v.name)} · lock ${v.id.toUpperCase()}</div><p class="sm muted" style="margin:6px 0 0">In the pilot, your phone gets a Bluetooth key for this padlock. It works until you end the rental (curfew ${t(b.end)}). This demo simulates the lock.</p></div>
     <div class="card" style="margin-top:16px"><div class="kv"><span>Start battery</span><b>${e ? b.pickupBattery + '%' : '—'}</b></div><div class="kv"><span>Before photo</span><b style="color:var(--ok)">Saved ✓</b></div><div class="kv"><span>Back at ${esc(r.name)} by</span><b>${t(b.end)}</b></div></div>`;
    foot = `<button class="btn gold" onclick="A.unlock()">🔓 Unlock with Bluetooth</button>`;
  }
  app.innerHTML = `<div class="view">${topbar('Pick up ' + esc(v.name))}<div class="scroll pad">${bar}${body}<div style="height:16px"></div></div>${foot ? `<div class="foot">${foot}</div>` : ''}</div>`;
  if (step === 'battery') mountCapture('#cap', { kind: 'battery', title: 'Battery display', sampleLabel: 'Use demo photo', sample: () => photoDisplay(v.battery), onPass: r => A.pickBattery(r) });
  if (step === 'condition') mountCapture('#cap', { kind: 'parking', lenient: true, title: 'Whole vehicle at the rack', sampleLabel: 'Use demo photo', sample: () => photoRack(v, b.rack), keep: true, onPass: (r, img) => A.pickCondition(img) });
};

PAGES.ride = () => {
  const b = S.booking; if (!b || !['active', 'parked'].includes(b.phase)) return go(b && b.phase === 'booked' ? '#/pickup' : b && b.phase === 'returning' ? '#/return' : '#/home');
  const v = S.vehicles.find(x => x.id === b.vid), r = rack(b.rack), e = isE(v);
  const parked = b.phase === 'parked', here = rack(b.at || b.rack);
  const est = e ? estBatt(b, v) : null, rangeLeft = e ? Math.max(0, (est - 5) / drainOf(v)) : 0, rt = b.rate || RATE0;
  const homeMi = miles(here, r), walkMin = Math.round(walkMins(homeMi));
  app.innerHTML = `<div class="view ride">${topbar('Your ride', false, `<span class="chip" style="background:#2e2522;color:#fff;box-shadow:none">${esc(v.name)}</span>`)}
  <div class="scroll pad"><div class="ridecard"><div class="xs muted b" id="lbl">FREE TIME LEFT</div><div class="timer" id="tm">--:--</div><div class="sm" id="cur" style="margin-top:8px;opacity:.8">Curfew: back at ${esc(r.name)} by ${t(b.end)}</div>
   <div class="row" style="margin-top:10px;gap:8px"><span class="chip" style="background:${parked ? '#3b2f12' : '#123b22'};color:${parked ? 'var(--gold)' : '#7CFC9a'};box-shadow:none">${parked ? '🔒 Locked at ' + esc(here.name) : '🛴 Riding'}</span><span class="xs muted" id="late"></span></div></div>
   ${e ? `<div class="ridecard" style="margin-top:12px"><div class="row"><div class="grow"><div class="xs muted b">BATTERY ESTIMATE</div><div style="font-size:26px;font-weight:900" id="best">~${est}%</div></div><div style="text-align:right" class="xs muted">${b.pickupBattery}% ${b.battSrc === 'old' ? '(owner’s last reading)' : 'in the pickup photo'}<br>− <span id="bmi">${rideMiles(b).toFixed(1)}</span> mi × ${drainOf(v).toFixed(1)}% per mile</div></div>
     <div class="gauge"><i id="bgauge" style="width:${est}%"></i><u style="left:${RETURN_FLOOR}%"></u></div><div class="xs muted" style="margin-top:8px" id="brange">Estimated range left: about ${Math.round(rangeLeft)} mi · home rack is ${homeMi.toFixed(1)} mi away</div>${rangeLeft < homeMi + 0.5 || est < 30 ? `<div class="note red" style="margin-top:10px">Low battery. Head back to ${esc(r.name)} now. If it dies, you kick it home without the motor.</div>` : ''}</div>` : ''}
   <div class="ridecard" style="margin-top:12px"><div class="row"><div class="grow"><div class="xs muted b">COST SO FAR</div><div style="font-size:26px;font-weight:900" id="cost">${money(rt.base)}</div></div><div style="text-align:right" class="xs muted" id="usage"></div></div><div class="xs muted" style="margin-top:6px">${e ? `${money(rt.base)} covers 2 hours + 2 miles. Then ${money(rt.hr)} per extra hour, ${money(rt.mi)} per extra mile (${esc(v.owner.name)}’s prices).` : `${money(rt.base)} covers 2 hours. Then ${money(rt.hr)} per extra hour (${esc(v.owner.name)}’s price). Bikes have no mile charge.`}</div></div>
   <div class="ridecard" style="margin-top:12px"><div class="row"><div class="grow"><div class="xs muted b">TIME SAVED VS WALKING</div><div style="font-size:26px;font-weight:900;color:#7CFC9a" id="saved">0 min</div></div><div style="text-align:right" class="xs muted" id="savedx"></div></div><div class="xs muted" style="margin-top:6px">Walking the same distance at 2 mph, minus your riding time. Distance is added each time you lock up.</div></div>
   <div class="ridecard" style="margin-top:12px"><div class="xs muted b" style="margin-bottom:8px">HOME RACK</div><div class="minimap" id="mm"></div>
    <div class="kv" style="margin-top:8px"><span>${esc(r.name)}</span><b>${parked && b.at !== b.rack ? homeMi.toFixed(1) + ' mi · ' + walkMin + ' min walk' : b.at === b.rack ? "you're here" : 'round trip'}</b></div><div class="xs muted">${ROUTES_BLOCKED}</div></div>
   <div class="ridecard" style="margin-top:12px"><div class="xs muted b" style="margin-bottom:4px">RIDE LOG</div>${(b.log || []).map(l => `<div class="kv"><span>${l.kind === 'unlock' ? '🔓 Unlocked' : '🔒 Locked'} · ${esc(l.place)}${l.gps ? '' : ' (rack, no GPS)'}</span><b>${t(l.t)}</b></div>`).join('') || '<div class="xs muted">Nothing yet.</div>'}<div class="xs muted" style="margin-top:4px">Your phone’s GPS location at every unlock and lock (or the rack you scanned, if GPS is off). In the pilot it’s kept for disputes and theft reports, never shown to the owner. This demo keeps it only in this browser.</div></div>
   <div class="row2" style="margin-top:12px">${parked ? `<button class="btn gold sm" onclick="A.unpark()">🔓 Unlock & ride</button>` : `<button class="btn ghost sm" onclick="go('#/park')">🔒 Lock at a rack</button>`}<button class="btn ghost sm" onclick="go('#/problem')">⚠ Problem</button></div>
   <div style="height:12px"></div></div>
  <div class="foot" style="background:none"><button class="btn gold" onclick="A.startReturn()">Return to ${esc(r.name)}</button></div>${tabs('home')}</div>`;
  const upd = () => {
    const left = b.end - now(), free = (b.startedAt || now()) + PRICING.inclHours * HOUR - now(), el = $('#tm'); if (!el) return;
    // big number: free time left in the start price, then extra time; small line: the curfew
    el.textContent = (free < 0 ? '+' : '') + clock(free); el.classList.toggle('extra', free < 0); el.classList.toggle('late', left < 0);
    $('#lbl').textContent = free >= 0 ? 'FREE TIME LEFT' : `EXTRA TIME · ${money(rt.hr)} per started hour`;
    $('#cur').textContent = left >= 0 ? `Curfew: back at ${r.name} by ${t(b.end)} · ${clock(left)} left` : `Curfew missed (was ${t(b.end)}): $15 fee`;
    if (e && $('#best')) { const ne = estBatt(b, v); $('#best').textContent = '~' + ne + '%'; $('#bgauge').style.width = ne + '%'; $('#bmi').textContent = rideMiles(b).toFixed(1); $('#brange').textContent = `Estimated range left: about ${Math.round(Math.max(0, (ne - 5) / drainOf(v)))} mi · home rack is ${homeMi.toFixed(1)} mi away`; }
    meter(); const bl = bill(b, now()); $('#cost').textContent = money(bl.total);
    $('#saved').textContent = savedMins(b) + ' min'; $('#savedx').innerHTML = `Walking ${rideMiles(b).toFixed(1)} mi: ${Math.round(walkMins(rideMiles(b)))} min<br>Riding so far: ${Math.round(b.rideMin || 0)} min`; $('#usage').innerHTML = e ? `${dur(bl.hours * HOUR)} · ${bl.mi.toFixed(1)} mi${b.gpsUsed ? '' : ' (est. from racks)'}<br>${bl.xh ? '+' + bl.xh + ' h' : 'within 2 h'} · ${bl.xm ? '+' + bl.xm + ' mi' : 'within 2 mi'}` : `${dur(bl.hours * HOUR)}<br>${bl.xh ? '+' + bl.xh + ' h' : 'within 2 h'}`;
  };
  upd(); tick = setInterval(upd, 1000);
  const mmEl = $('#mm');
  setTimeout(() => {
    if (!mmEl.isConnected || mapObj) return;
    mapObj = L.map(mmEl, { zoomControl: false, attributionControl: true, dragging: false, scrollWheelZoom: false }).setView([(here.lat + r.lat) / 2, (here.lng + r.lng) / 2], 17);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' }).addTo(mapObj); mapObj.attributionControl.setPrefix(false);
    L.marker([r.lat, r.lng], { icon: L.divIcon({ className: '', iconSize: [40, 40], iconAnchor: [20, 40], html: '<div class="pin home"><span>★</span></div>' }) }).addTo(mapObj);
    if (b.at && b.at !== b.rack) { L.marker([here.lat, here.lng], { icon: L.divIcon({ className: '', html: '<div class="me"></div>', iconSize: [18, 18] }) }).addTo(mapObj); L.polyline([[here.lat, here.lng], [r.lat, r.lng]], { color: '#FFCC00', dashArray: '6 8', weight: 3 }).addTo(mapObj); mapObj.fitBounds([[here.lat, here.lng], [r.lat, r.lng]], { padding: [16, 16], maxZoom: 17 }); }
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
    <div class="note blue" style="margin-top:12px">If the home rack is full or blocked, tap "Something went wrong" and we will approve the nearest legal rack.</div>`;
    foot = `<button class="btn" onclick="A.rscan()">Scan ${esc(r.id)} rack sticker (simulated)</button><button class="btn ghost sm" style="margin-top:8px" onclick="go('#/problem')">⚠ Something went wrong</button>`;
  } else if (step === 'battery') body = `<p class="ink2 sm" style="margin-top:0">Photo of the display again, so ${esc(v.owner.name)} knows how much charge is left.</p><div id="cap"></div>`;
  else if (step === 'photo') body = `<p class="ink2 sm" style="margin-top:0">${keybox(v) ? `Lock it through the frame and the rack with ${esc(v.owner.name)}’s lock` : 'Run the chain through the frame and the rack and close the padlock'}. Then take one photo of the whole ${v.type === 'scooter' ? 'scooter' : 'bike'} with the lock showing. The AI checks the parking and compares it with your pickup photo for new damage.</p><div id="cap"></div>`;
  else {
    body = `<div style="text-align:center"><div class="lockbig" id="lk">${ICON.lock}</div><div class="h3">End the rental</div><p class="sm muted">${keybox(v) ? `Put ${esc(v.owner.name)}’s key back in the key box and spin the dials. Billing stopped when your return photo was accepted.` : 'Billing stops when your return photo is accepted. In the pilot, the padlock also reports that it’s shut. This demo simulates the lock.'}</p></div>`;
    foot = `<button class="btn" onclick="A.finish()">${keybox(v) ? 'Key is back in the box · End rental' : 'End rental'}</button>`;
  }
  app.innerHTML = `<div class="view">${topbar('Return ' + esc(v.name))}<div class="scroll pad">${bar}${body}<div style="height:16px"></div></div>${foot ? `<div class="foot">${foot}</div>` : ''}</div>`;
  if (step === 'battery') mountCapture('#cap', { kind: 'battery', title: 'Battery display', sampleLabel: 'Use demo photo', sample: () => photoDisplay(Math.max(5, estBatt(b, v) - 2)), onPass: r => A.retBattery(r) });
  if (step === 'photo') mountCapture('#cap', { kind: 'return', title: 'Locked at ' + r.name, sampleLabel: 'Use demo photo', sample: () => photoRack(v, b.rack), before: b.beforeImg, onPass: (res) => A.retPhoto(res) });
};

PAGES.receipt = () => {
  const tr = S.trips[0]; if (!tr) return go('#/home');
  app.innerHTML = `<div class="view">${topbar('Trip complete', false)}<div class="scroll pad" style="text-align:center">
   <div class="success">${ICON.check}</div><h2 style="margin:6px 0 2px;letter-spacing:-.6px">Fight On! ✌</h2><p class="muted sm" style="margin:0 0 16px">${esc(tr.name)} is back at ${esc(tr.rack)}.</p>
   <div class="card" style="text-align:left"><div class="kv"><span>Ride: ${tr.bill ? dur(tr.bill.hours * HOUR) + (tr.bill.timeOnly ? '' : ' · ' + tr.bill.mi.toFixed(1) + ' mi') : ''}</span><span></span></div>${tr.walkMin != null ? `<div class="kv"><span>Time saved vs walking (2 mph)</span><b style="color:var(--ok)">${tr.saved} min</b></div><div class="kv xs"><span>Walking ${tr.bill.mi.toFixed(1)} mi: ${tr.walkMin} min · riding: ${tr.rideMin} min</span><span></span></div>` : ''}<div class="kv"><span>Start (${tr.bill && tr.bill.timeOnly ? '2 hours' : '2 hours + 2 miles'})</span><span>${money(tr.bill ? tr.bill.rt.base : 0)}</span></div>
    ${tr.bill && tr.bill.xh ? `<div class="kv"><span>Extra time: ${tr.bill.xh} h × ${money(tr.bill.rt.hr)}</span><span>${money(tr.bill.xh * tr.bill.rt.hr)}</span></div>` : ''}${tr.bill && tr.bill.xm ? `<div class="kv"><span>Extra distance: ${tr.bill.xm} mi × ${money(tr.bill.rt.mi)}</span><span>${money(tr.bill.xm * tr.bill.rt.mi)}</span></div>` : ''}
    ${tr.late ? `<div class="kv"><span>Curfew missed</span><span>${money(tr.late)}</span></div>` : `<div class="kv"><span>Back before curfew</span><span style="color:var(--ok)">$0.00</span></div>`}
    ${tr.lowBatt ? `<div class="kv"><span>Battery under ${RETURN_FLOOR}% (no fee, just a heads-up)</span><span>$0.00</span></div>` : ''}
    <div class="kv total"><span>Charged</span><span>${money(tr.price + tr.late)}</span></div>
    <div class="kv xs"><span>${money(tr.hold)} hold</span><span>released</span></div>${tr.sp ? `<div class="kv xs"><span>${esc(tr.owner)} earns (${Math.round(tr.sp.owner / Math.max(0.01, tr.sp.owner + tr.sp.kit + tr.sp.ops) * 100)}%)</span><span>${money(tr.sp.owner)}</span></div>${tr.sp.kit > 0 ? `<div class="kv xs"><span>Pays off ${esc(tr.owner)}’s lock (${money(Math.min(KIT, tr.kitPaid))} of $${KIT})</span><span>${money(tr.sp.kit)}</span></div>` : ''}<div class="kv xs"><span>Card fees + safety fund</span><span>${money(tr.sp.ops)}</span></div>` : ''}</div>
   <div class="card" style="text-align:left;margin-top:12px"><div class="row" style="margin-bottom:6px"><span class="badge" style="font-size:10.5px;font-weight:850;padding:3px 7px;border-radius:6px;background:var(--ink);color:var(--gold)">AI CHECKS</span></div>
    <div class="kv sm"><span>Battery start → end</span><b>${tr.b0 != null ? tr.b0 + '% → ' + (tr.b1 ?? '?') + '%' : 'bike'}</b></div>${tr.est != null && tr.b1 != null ? `<div class="kv sm"><span>Estimate from distance vs photo</span><b>${tr.est}% vs ${tr.b1}%</b></div>` : ''}<div class="kv sm"><span>Parking + lock</span><b style="color:${tr.parkCheck === 'review' ? 'var(--warn)' : 'var(--ok)'}">${tr.parkCheck === 'review' ? 'Staff review' : 'OK'}</b></div>${tr.held ? `<div class="kv sm"><span>${esc(tr.name)} is out of service until a person reviews this return</span><button class="chip" onclick="A.clearReview('${tr.vid}')">Staff: clear (demo)</button></div>` : ''}<div class="kv sm"><span>Ride log</span><b>${tr.logN || 0} unlock/lock events</b></div><div class="kv sm"><span>New damage vs pickup</span><b style="color:${tr.damageCheck === 'none' ? 'var(--ok)' : 'var(--warn)'}">${{ none: 'None seen', flagged: 'Flagged for review', 'not comparable': 'Not comparable · review', 'not compared': 'Not compared · review' }[tr.damageCheck || (tr.damage ? 'flagged' : 'none')]}</b></div></div>
   <div class="sec">Rate ${esc(tr.owner)}'s ride</div><div class="stars">${[1, 2, 3, 4, 5].map(i => `<button class="${i <= (tr.stars || 0) ? 'on' : ''}" aria-label="${i} star${i > 1 ? 's' : ''}" aria-pressed="${i <= (tr.stars || 0)}" onclick="A.stars(${i})">★</button>`).join('')}</div><div style="height:20px"></div></div>
   <div class="foot"><button class="btn" onclick="go('#/home')">Done</button></div></div>`;
};

PAGES.problem = () => {
  const b = S.booking, v = b && S.vehicles.find(x => x.id === b.vid), r = b && rack(b.rack);
  const P = [
    ['🔋', '#fde8e8', 'Battery died', 'dead'], ['🛞', '#f6efe9', 'Flat tire or breakdown', 'broken'], ['🔐', '#fff6cc', "Lock won't open or close", 'lock'],
    ['📵', '#e6effe', 'My phone is dying', 'phone'], ['🅿', '#e3f7ea', 'Home rack is full or blocked', 'full'], ['🚨', '#fde8e8', 'It was stolen', 'stolen'], ['🤕', '#fde8e8', 'Crash or injury', 'crash']];
  app.innerHTML = `<div class="view">${topbar('What happened?')}<div class="scroll pad">${!b ? '<p class="muted">No active rental.</p>' : P.filter(p => p[3] !== 'dead' || isE(v)).map(([i, bg, l, k]) => `<button class="list-btn" onclick="A.problem('${k}')"><div class="ic" style="background:${bg}">${i}</div><div class="grow b">${l}</div><span class="chev">›</span></button>`).join('')}
  <p class="xs muted" style="margin-top:14px">Emergency: call 911. USC DPS (24/7): (213) 740-4321.</p></div></div>`;
};

PAGES.garage = () => {
  const m = S.mine, rn = m.rental, k = m.kit, maxW = Math.max(...m.week, 1), wk = m.week.reduce((a, b) => a + b, 0);
  const D = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  app.innerHTML = `<div class="view">${topbar('My garage', false, `<button class="chip" onclick="A.addVehicle()">＋ Add</button>`)}<div class="scroll pad">
   <div class="card"><div class="row"><div class="thumb" style="width:64px;height:64px;border-radius:16px;background:#f6efe9;display:grid;place-items:center">${art(m, 54)}</div><div class="grow"><div class="h3">${esc(m.name)}</div><div class="xs muted">${esc(m.model)} · home: ${esc(rack(m.rack).name)}</div></div><button class="toggle ${m.listed ? 'on' : ''}" role="switch" aria-checked="${!!m.listed}" aria-label="Rent it out" onclick="A.list()"></button></div>
    <div class="divider"></div>
    ${rn ? `<div class="row"><span class="pulse" style="width:10px;height:10px;border-radius:50%;background:var(--cardinal);display:inline-block"></span><div class="grow"><div class="b">Rented by ${esc(rn.renter)} · ${esc(rn.renterDorm)}</div><div class="xs muted">${rn.state === 'parked' ? '🔒 Parked and locked' : '🛴 Riding'} · back by ${t(rn.end)}${now() > rn.end ? ' · <b style="color:var(--bad)">LATE</b>' : ''}</div></div><span class="chip gold">+${money(rn.earn || 3.5)}</span></div>`
      : `<div class="row"><div class="grow"><div class="b">${m.listed ? 'At ' + esc(rack(m.rack).name) + ', ready to rent' : 'Not listed: only you can unlock it'}</div><div class="xs muted">Battery ${m.battery}% (AI-read at last return)</div></div>${m.listed ? '<span class="chip green">Listed</span>' : '<span class="chip">Private</span>'}</div>`}
   </div>
   <div class="sec">This week</div><div class="card"><div class="row"><div class="grow"><div class="big-earn">${money(wk)}</div><div class="xs muted">${m.history.length + (rn ? 1 : 0)} rentals · you keep ${Math.round(ownerShare(m) * 100)}%</div></div><button class="btn sm gold" style="width:auto;padding:10px 14px" onclick="go('#/wallet')">Cash out</button></div>
    <div class="bars">${m.week.map((x, i) => `<div><i class="${x === Math.max(...m.week) && x > 0 ? 'hi' : ''}" style="height:${Math.max(4, x / maxW * 70)}px"></i>${D[i]}</div>`).join('')}</div></div>
   <div class="sec">Your prices</div><div class="card col"><div class="row2" style="grid-template-columns:1fr 1fr 1fr"><div class="field" style="margin:0;min-width:0"><label for="rate-base">Start (2 h + 2 mi)</label><input id="rate-base" style="width:100%;box-sizing:border-box" type="number" min="1" max="50" step="0.5" value="${rateOf(m).base}" onchange="A.rate('base',this.value)"></div><div class="field" style="margin:0;min-width:0"><label for="rate-hr">Extra hour</label><input id="rate-hr" style="width:100%;box-sizing:border-box" type="number" min="0" max="20" step="0.5" value="${rateOf(m).hr}" onchange="A.rate('hr',this.value)"></div><div class="field" style="margin:0;min-width:0"><label for="rate-mi">Extra mile</label><input id="rate-mi" style="width:100%;box-sizing:border-box" type="number" min="0" max="20" step="0.5" value="${rateOf(m).mi}" onchange="A.rate('mi',this.value)"></div></div>
    <div class="xs muted">You set the prices. Your start price covers the first 2 hours and 2 miles of every rental. After that, renters pay your price for each started extra hour and each started extra mile. ${keybox(m) ? 'With your own key box you keep 90%.' : 'You keep 70% until your lock is paid off, then 90%.'} Most owners charge $5 to start, then $2 per extra hour and $2 per extra mile.</div></div>
   <div class="sec">When it's rentable</div><div class="card col"><div class="days">${D.map((d, i) => `<button class="${m.days[i] ? 'on' : ''}" aria-pressed="${!!m.days[i]}" aria-label="${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][i]}" onclick="A.day(${i})">${d}</button>`).join('')}</div>
    <div class="row2"><div class="field" style="margin:0"><label for="win-from">From</label><input id="win-from" type="time" value="${m.from}" onchange="A.win('from',this.value)"></div><div class="field" style="margin:0"><label for="win-to">Back by</label><input id="win-to" type="time" value="${m.to}" onchange="A.win('to',this.value)"></div></div>
    <div class="xs muted">Your "back by" time is the renter’s curfew (never overnight). A renter who misses it pays a one-time $15. You can pause renting any time; current renters still finish.</div></div>
   ${m.lock === 'none' ? `<div class="sec">How renters open it</div><div class="card col"><div class="b">Pick a lock to start renting</div><div class="xs muted">Start today with a key box, or get the smart padlock once the pilot begins.</div><button class="btn sm" style="margin-top:10px" onclick="A.addVehicle()">Choose a lock</button></div>`
   : keybox(m) ? `<div class="sec">Your key box</div><div class="card col"><div class="row"><div class="grow"><div class="b">Today’s code</div><div class="xs muted">Renters see it after their pickup photos. Change it every night when you take ${esc(m.name)} in to charge, and keep the box out of sight on the frame.</div></div><input id="kb-code" aria-label="Key box code" inputmode="numeric" maxlength="4" value="${esc(m.code || '')}" onchange="A.code(this.value)" style="width:86px;font-size:22px;font-weight:900;letter-spacing:4px;text-align:center;padding:8px;border-radius:12px;border:1.5px solid #e3d9d2"></div>
    <div class="xs muted" style="margin-top:8px">There is no SCoot lock to pay off, so you keep 90% of every rental. You can switch to the smart padlock when the pilot begins. Then you keep 70% until its $86 kit is paid off, and 90% after that.</div></div>`
   : `<div class="sec">Your lock, paid off by rentals</div><div class="card"><div class="row"><div class="grow"><div class="b">${money(Math.min(KIT, m.kitPaid || 0))} of $${KIT} paid off</div><div class="xs muted">15% of each fare pays off your lock kit, never your own money. ${kitLeft(m) > 0 ? 'When it’s paid off, your share goes from 70% to 90%.' : 'Paid off: you now keep 90%.'}</div></div><span class="chip ${kitLeft(m) > 0 ? 'gold' : 'green'}">${kitLeft(m) > 0 ? '70%' : '90%'}</span></div><div class="gauge" style="margin-top:10px;background:#efe6df"><i style="width:${Math.min(100, (m.kitPaid || 0) / KIT * 100)}%"></i></div></div>`}
   <div class="sec">Your starter kit</div><div class="kit">
    ${keybox(m) ? `<div class="card"><div class="b sm">🔑 Key box</div><div class="xs muted">Holds the key to your own lock</div></div>` : `<div class="card"><div class="b sm">🔐 Smart lock</div><div class="xs muted">${m.lock === 'none' ? 'Not set up yet' : (k.lockClosed ? 'Closed' : 'Open') + ' · battery ' + k.lockBatt + '%'}</div></div>`}
    <div class="card"><div class="b sm">📍 Ride log</div><div class="xs muted">Every unlock and lock is logged</div></div>
    <div class="card"><div class="b sm">⛓ ${keybox(m) ? 'Your own lock' : 'Hardened chain'}</div><div class="xs muted">Through the frame and the rack</div></div>
    <div class="card"><div class="b sm">🛡 DPS registered</div><div class="xs muted">${k.decal}</div></div></div>
   <div class="sec">Recent rentals</div><div class="card">${m.history.length ? '' : '<p class="xs muted" style="margin:0">No rentals yet.</p>'}${m.history.map(h => `<div class="hist"><div class="avatar" style="background:#e9e2dd;color:var(--ink);width:34px;height:34px;font-size:12px">${esc(h.who.slice(0, 2))}</div><div class="grow"><div class="b sm">${esc(h.who)} · ${esc(h.hrs || '')}</div><div class="xs muted">${esc(h.checks)}</div></div><div class="b sm" style="color:var(--ok)">+${money(h.earn)}</div></div>`).join('')}</div>
   <div style="height:16px"></div></div>${tabs('garage')}</div>`;
};

PAGES.wallet = () => {
  const m = S.mine;
  app.innerHTML = `<div class="view">${topbar('Wallet', false)}<div class="scroll pad">
   <div class="card" style="background:linear-gradient(140deg,#990000,#5c0000);color:#fff"><div class="xs b" style="opacity:.75">EARNINGS BALANCE</div><div class="big-earn" style="margin:4px 0 12px">${money(m.balance)}</div><button class="btn gold sm" onclick="A.cashout()">Cash out to bank (test mode)</button></div>
   <div class="sec">Pay with</div><div class="card row"><div style="font-size:22px">💳</div><div class="grow"><div class="b">Visa •••• 4242</div><div class="xs muted">Simulated card. No real charges. Holds are released after the return check.</div></div></div>
   <div class="sec">Activity</div><div class="card">${[...S.trips.map(x => ({ d: 'Ride · ' + x.name, a: -(x.price + x.late), ago: t(x.at) })), ...S.wallet].map(x => `<div class="hist"><div class="grow"><div class="b sm">${esc(x.d)}</div><div class="xs muted">${esc(x.ago)}</div></div><div class="b sm" style="color:${x.a < 0 ? 'var(--ink)' : 'var(--ok)'}">${x.a < 0 ? '−' + money(-x.a) : '+' + money(x.a)}</div></div>`).join('') || '<p class="muted sm">No activity yet.</p>'}</div>
   <div class="sec">Where the money goes</div><div class="card sm ink2" style="line-height:1.5">Owners keep <b>70%</b> of each fare with the smart padlock until the $86 kit is paid off. Of the other 30%, half pays off the kit and half pays card fees and a safety fund for theft and damage. <b>After that, the owner keeps 90%.</b> Owners who start with their own key box keep 90% from the first ride. SCoot isn't trying to profit, so there's no unlock fee and no per-minute meter.</div>
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
  <li><b>Same rack, both ends.</b> Pick up and return at the same marked rack. You may use another approved spot only after you report a safety problem or a full rack.</li>
  <li><b>Each owner sets a start price</b> that covers your first 2 hours and 2 miles (the shortest rental). After that you pay the owner’s price for each started extra hour and each started extra mile, measured by your phone’s GPS. Most owners charge $5 to start, then $2 per extra hour and $2 per extra mile. Time spent parked during a ride still counts. Ordinary bikes are priced by time only, with no mile charge.</li>
  <li><b>$25 refundable hold</b> for electric scooters and e-bikes, and $10 for ordinary bikes. It is released after the return check.</li>
  <li><b>Pick up within 10 minutes</b> of booking, or the booking lapses.</li>
  <li><b>Photos at pickup and return.</b> AI reads the battery and checks parking, lock and new damage. Unclear photos go to a person, never an automatic fine.</li>
  <li><b>Start with enough charge.</b> Long-range scooters need 40% to start, medium 50%, short 60%.</li>
  <li><b>If the battery dies,</b> kick it home to the rack without the motor. That is still faster than walking. Report it, and your curfew moves 30 minutes later.</li>
  <li><b>Curfew:</b> the owner’s back-by time, shown before you book. If you miss it, you pay a one-time $15 fee. A vehicle still missing after 24 hours is treated as stolen.</li>
  <li><b>Lock to a rack</b> every time you leave it. No passengers, no lending your booking to a friend, no overnight rentals.</li>
  <li><b>Key box rides:</b> keep the owner’s key with you during the ride. At the end, put it back in the box and spin the dials. Open the box where no one can see the code, and never share it. If the scooter is stolen after you shared the code or let someone see it, you are responsible. SCoot and DPS will question you first, and you will likely pay for the loss.</li>
  <li><b>Walk-only zones:</b> walk it through Hahn Plaza and campus intersections. You pay any DPS ticket.</li>
  <li><b>License:</b> e-scooters need a driver's license or learner's permit (CA Vehicle Code 21235). Helmet required under 18.</li></ol><div style="height:20px"></div></div></div>`;
};

PAGES.how = () => {
  app.innerHTML = `<div class="view">${topbar('Safety, theft & damage')}<div class="scroll pad col sm ink2" style="line-height:1.55">
  <div class="card"><div class="h3" style="margin-bottom:6px">Theft</div>In the pilot, every renter is a verified USC student, so nobody rides anonymously, and every scooter is registered with USC DPS. The app logs the renter’s phone location at every unlock and lock. Proposed for the pilot (not active in this demo): if a scooter locked correctly is stolen and not recovered, a safety fund pays the owner its depreciated value, up to a cap set with the insurer before any real rides.</div>
  <div class="card"><div class="h3" style="margin-bottom:6px">Damage</div>The pickup photo is the "before". The return photo is the "after". The AI points out visible differences, and a person decides. Normal wear isn't damage. Either side can appeal.</div>
  <div class="card"><div class="h3" style="margin-bottom:6px">Battery</div>In the pilot, SCoot accepts only certified scooters (UL 2272) and e-bikes (UL 2849). Owners charge their own scooters with the original charger.</div>
  <div class="card"><div class="h3" style="margin-bottom:6px">Injury</div>Call 911 or DPS at (213) 740-4321 first. For the pilot, SCoot works with USC Risk Management on group insurance, the way Lime insures its riders. That has to be in place before real rides start.</div>
  <div class="card"><div class="h3" style="margin-bottom:6px">Your data</div>Each photo is sent to the AI provider for its check, and SCoot does not store photos. In the pilot, ride photos would be kept 30 days for disputes, then deleted. This demo records clicks, app screens, chat questions and check results (never photos or passwords) to improve the site. Images are treated as evidence, never as instructions to the AI.</div>
  <div style="height:16px"></div></div></div>`;
};

/* ---------- photo + AI capture component ---------- */
function mountCapture(sel, o) {
  const box = $(sel); if (!box) return;
  let img = null, busy = false, tries = 0;
  const draw = (res) => {
    box.innerHTML = `<div class="cam">${img ? `<img src="${img}" alt="">` : `<div class="empty">📷<br>${esc(o.title)}</div>`}<div class="guide" style="${img ? 'display:none' : ''}"></div><span class="lbl">${esc(o.title)}</span></div>
     <div class="row2" style="margin-top:10px"><button class="btn sm" id="c-take">📷 ${img ? 'Retake' : 'Take photo'}</button><button class="btn ghost sm" id="c-demo">${esc(o.sampleLabel)}</button></div>
     <div id="c-res" aria-live="polite" style="margin-top:12px">${res || ''}</div>`;
    $('#c-take').onclick = async () => { if (busy) return; const d = await pickPhoto(); if (d) { img = d; run(); } };
    $('#c-demo').onclick = () => { if (busy) return; if (o.instant) return o.onPass(o.instant); img = toB64(o.sample()); run(); };   // the sample license always passes
  };
  const run = async () => {
    busy = true; tries++;
    const still = () => box.isConnected;   // the page may have changed while the AI was thinking
    draw(`<div class="ai"><div class="thinking"><div class="spinner"></div>AI is checking the photo…</div></div>`);
    let r;
    if (o.kind === 'return') {
      const [p, d] = await Promise.all([ai('parking', [img]), o.before ? ai('damage', [o.before, img]) : Promise.resolve(null)]);
      r = { ok: p.ok, error: p.error, ms: Math.max(p.ms, d?.ms || 0), result: p.result, damage: d && d.ok ? d.result : null, damageFailed: !!o.before && !(d && d.ok), model: p.model };
    } else r = await ai(o.kind, [img]);
    busy = false; if (!still()) return;
    let v = verdict(o.kind, r);
    if (o.lenient && r.ok && r.result && r.result.view_quality === 'usable' && !r.result.instruction_text_seen) v = { ...v, cls: 'ok', title: 'Before photo saved', pass: true };
    if (v.pass && o.kind === 'license') return o.onPass(v.data || {}, img);   // no extra Continue for a license
    draw(`<div class="ai ${v.cls}"><div class="head"><span class="badge">AI</span>${esc(v.title)}<span class="grow"></span><span class="xs muted">${r.ms ? (r.ms / 1000).toFixed(1) + 's' : ''}${/llama/i.test(r.model || '') ? ' · backup model' : ''}</span></div><ul>${v.lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
      ${r.result?.instruction_text_seen ? '<div class="note red" style="margin-top:8px">⚠ The photo contained text trying to instruct the AI. It was ignored and flagged.</div>' : ''}</div>
      ${v.pass ? `<button class="btn" style="margin-top:12px" id="c-ok">${o.kind === 'battery' ? 'Matches what I see · Continue' : 'Continue'}</button>`
        : tries >= 2 || !r.ok ? `<button class="btn ghost" style="margin-top:12px" id="c-ok">Simulate staff review (demo only)</button>` : ''}`);
    const ok = box.querySelector('#c-ok'); if (ok) ok.onclick = () => o.onPass(v.pass ? v.data || {} : { ...(v.data || {}), percent: null, pending: true }, img);
  };
  draw();
}
function verdict(kind, r) {
  if (!r.ok) return { cls: 'warn', title: 'AI check unavailable', lines: [r.error === 'rate_limited' ? 'Too many checks from this device. Try again in a few minutes.' : "Couldn't reach the AI. A person will review this photo instead.", 'Nothing is approved or charged automatically.'], pass: false, data: {} };
  const x = r.result || {};
  if (x.instruction_text_seen) return { cls: 'bad', title: 'Sent to a person for review', lines: ['The photo contained text trying to instruct the AI, so this check can’t pass on its own.'], pass: false, data: x };
  if (kind === 'battery') {
    if (x.status === 'readable' && x.display_kind === 'percent' && x.percent != null) return { cls: 'ok', title: `Battery reads ${x.percent}%`, lines: [`Display text: "${x.visible_text || x.percent + '%'}"`, 'Read from the photo, not typed by anyone.'], pass: true, data: x };
    if (x.display_kind === 'bars' && x.bars_lit != null) return { cls: 'warn', title: `${x.bars_lit} of ${x.bars_total} bars`, lines: ['Bars aren\'t a precise percentage. Retake closer if the display shows a number.'], pass: false, data: x };
    return { cls: 'bad', title: "Can't read the battery", lines: [x.retake_instruction || 'Move closer, block the glare and retake.'], pass: false, data: x };
  }
  if (kind === 'license') {
    const valid = x.valid_today === true && x.readability === 'readable' && !x.instruction_text_seen;
    return valid ? { cls: 'ok', title: 'License looks valid', lines: [`${x.document_category === 'instruction_permit' ? 'Learner permit' : 'Driver license'} · ${x.issuing_jurisdiction || 'unknown state'}`, `Expires ${x.expiry_iso}`, 'Only type, state and expiry are returned. The image is processed by the AI provider and not stored by SCoot. This doesn’t prove who you are.'], pass: true, data: x }
      : { cls: 'bad', title: x.expiry_iso ? 'License expired or not accepted' : "Couldn't read the expiry date", lines: ['Retake in good light, or a staff member can check it in person.'], pass: false, data: x };
  }
  // A parking photo fails only on something clearly wrong; unclear details are listed but don't block.
  const p = x, good = p.view_quality !== 'retake' && p.upright !== 'no' && p.walkway_obstructed !== 'yes' && p.frame_and_rack_path_visible !== 'no' && p.shackle_appears_closed !== 'no' && !(kind === 'return' && r.damage && r.damage.instruction_text_seen);
  const lines = [`Upright: ${p.upright} · walkway blocked: ${p.walkway_obstructed}`, `Lock through frame + rack: ${p.frame_and_rack_path_visible} · shackle closed: ${p.shackle_appears_closed}`, `Rack sticker visible: ${p.rack_label_visible}`, ...(p.corrective_instructions || []).slice(0, 2)];
  if (kind === 'return') {
    const d = r.damage, n = d ? (d.new_visible_differences || []).length : 0;
    if (d && d.instruction_text_seen) lines.push('The comparison photo contained instruction text. A person will review.');
    lines.push(!d ? 'Damage not compared (check failed). A person will review.' : d.comparable !== 'yes' || (d.not_comparable || []).length ? `Only partly comparable${(d.not_comparable || []).length ? ' (' + d.not_comparable.join(', ') + ')' : ''}. A person will review.`
      : n ? `Possible new damage: ${d.new_visible_differences.map(z => z.description).join('; ')} (a person will review)` : 'No new damage compared with the pickup photo.');
  }
  return { cls: good ? 'ok' : 'warn', title: good ? (kind === 'return' ? 'Parked, locked, checked' : 'Looks good') : 'Fix the parking', lines, pass: good, data: { ...p, damage: r.damage } };
}

/* ---------- actions ---------- */
let finishing = false;
const A = window.A = {
  login() {
    const netid = ($('#nid').value || 'ttrojan').trim().toLowerCase().replace(/[^a-z0-9]/g, '') || 'ttrojan';
    $('#duo').innerHTML = `<div class="duo"><div class="spinner"></div><div class="b">Duo push sent</div><div class="sm muted">Approve on your phone…</div></div>`; $('#go').disabled = true;
    setTimeout(() => { const nm = netid === 'ttrojan' ? 'Tommy' : netid[0].toUpperCase() + netid.slice(1, 8); if (S.lastNetid && S.lastNetid !== netid) { S.license = null; S.agreed = false; } S.lastNetid = netid; S.user = { netid, name: nm, dorm: $('#dorm').value }; save(); go('#/onboard'); }, 1400);
  },
  agree() { S.agreed = true; save(); go('#/home'); },
  filter(k) { S.filter = k; render(); },
  rack(id) { S.rackFilter = id; render(); },
  book(vid) {
    const v = S.vehicles.find(x => x.id === vid), curfew = Math.min(v.until, endOfDay()), rt = rateOf(v);
    modal(`<div class="h3" style="font-size:20px">Confirm ${esc(v.name)}</div><p class="sm muted">Round trip from ${esc(rack(v.rack).name)}</p>
     <div class="card"><div class="kv"><span>Start (${inclTxt(v)})</span><b>${money(rt.base)}</b></div><div class="kv"><span>${isE(v) ? 'Extra hour / extra mile' : 'Extra hour'}</span><span>${isE(v) ? money(rt.hr) + ' / ' + money(rt.mi) : money(rt.hr)}</span></div><div class="kv"><span>Lock</span><span>${keybox(v) ? 'Key box · code after your photos' : 'Smart padlock'}</span></div><div class="kv"><span>Refundable hold</span><span>${money(HOLD[cls(v)])}</span></div><div class="kv"><span>Pick up within</span><span>10 minutes</span></div><div class="kv"><span>Curfew: back at ${esc(rack(v.rack).name)} by</span><b>${t(curfew)}</b></div></div>
     <div class="note" style="margin:12px 0">Miss the curfew and you pay a one-time $15. If the battery dies, kick it home without the motor. That is still faster than walking.</div>
     <button class="btn" onclick="A.confirm('${vid}')">Start for ${money(rt.base)} · simulated card</button>`);
  },
  confirm(vid) {
    const v = S.vehicles.find(x => x.id === vid), n = now();
    if (unfinished(S.booking)) { closeModal(); return toast('Finish your current rental first.'); }
    if (v.status !== 'available' || (isE(v) && v.type === 'scooter' && !licenseOk()) || Math.min(v.until, endOfDay()) - n < MIN_BOOK + 10 * MIN) { closeModal(); return toast('This one isn’t available to you right now.'); }
    S.booking = { vid, rack: v.rack, at: v.rack, phase: 'booked', step: 'scan', created: n, pickupBy: n + 10 * MIN, end: Math.min(v.until, endOfDay()), rate: { ...rateOf(v) }, timeOnly: !isE(v), price: rateOf(v).base, hold: HOLD[cls(v)], rideMin: 0, miles: 0 };
    v.status = 'booked'; S.sel = null; save(); closeModal(); toast('Booked! Head to ' + rack(v.rack).name); go('#/pickup');
  },
  cancel() { const b = S.booking; S.vehicles.find(x => x.id === b.vid).status = 'available'; S.booking = null; save(); toast('Booking cancelled. Hold released.'); go('#/home'); },
  scan() { if (pickupExpired()) return; const b = S.booking; toast('Rack ' + b.rack + '-01 matched ✓'); b.step = isE(S.vehicles.find(x => x.id === b.vid)) ? 'battery' : 'condition'; render(); },
  pickBattery(r) {
    const b = S.booking, v = S.vehicles.find(x => x.id === b.vid), need = RANGE[v.range].min;
    const old = r.percent == null;
    if (old) r = { percent: v.battery };   // simulated staff-review path: the owner's last reading, labeled as such
    if (r.percent < need) { toast(`${r.percent}% is below the ${need}% needed to start. Booking cancelled, no charge.`); v.battery = r.percent; v.status = 'available'; S.booking = null; save(); return go('#/home'); }
    b.pickupBattery = r.percent; b.battSrc = old ? 'old' : 'photo'; if (!old) { v.battery = r.percent; v.battAt = now(); v.battSrc = 'photo'; } b.step = 'condition'; render();
  },
  pickCondition(img) { const b = S.booking; b.beforeImg = img; b.step = 'unlock'; render(); },
  // The lock is simulated in this prototype; in the pilot this button sends the phone's Bluetooth key to the TTLock padlock.
  async unlock() {
    if (pickupExpired()) return;
    const b = S.booking, lk = $('#lk'); if (b.phase !== 'booked' || lk.classList.contains('busy')) return;   // ignore a double tap
    lk.classList.add('busy'); await new Promise(r => setTimeout(r, keybox(S.vehicles.find(x => x.id === b.vid)) ? 400 : 1100));
    const v = S.vehicles.find(x => x.id === b.vid); v.status = 'rented';
    lk.classList.remove('busy'); lk.classList.add('open'); toast(keybox(v) ? 'Got the key. Ride safe! ✌' : 'Unlocked. Ride safe! ✌');
    b.phase = 'active'; b.startedAt = now(); b.lastTick = now(); if (!isE(v)) b.pickupBattery = null; save(); logLoc('unlock', b.rack);
    setTimeout(() => go('#/ride'), 900);
  },
  parkPick(id) { S.parkPick = id; render(); },
  parkDone(id) { const b = S.booking; meter(); closeLeg(b, rack(b.at || b.rack), rack(id)); b.phase = 'parked'; b.at = id; S.parkPick = null; save(); logLoc('lock', id); toast('Locked at ' + rack(id).name + '. Your time keeps running.'); go('#/ride'); },
  unpark() { const b = S.booking; meter(); b.phase = 'active'; save(); logLoc('unlock', b.at); toast(keybox(S.vehicles.find(x => x.id === b.vid)) ? 'Unlocked with the key. Keep it until you return.' : 'Unlocked. Your key works until you end the rental (curfew ' + t(b.end) + ').'); render(); },
  startReturn() { const b = S.booking; meter(); b.phase = 'returning'; b.rstep = 'scan'; save(); go('#/return'); },
  rscan() { const b = S.booking; toast('Home rack ' + b.rack + '-01 matched ✓'); closeLeg(b, rack(b.at || b.rack), rack(b.rack)); b.at = b.rack; b.rstep = isE(S.vehicles.find(x => x.id === b.vid)) ? 'battery' : 'photo'; render(); },
  retBattery(r) { const b = S.booking; b.returnBattery = r.pending ? null : r.percent ?? null; b.rstep = 'photo'; if (r.percent != null && r.percent < RETURN_FLOOR) toast(`${r.percent}% is under ${RETURN_FLOOR}%. No fee, but plan for the trip home next time.`); render(); },
  retPhoto(res) {
    const b = S.booking, d = res.damage;
    b.arrivedAt = now(); b.parkCheck = res.pending ? 'review' : 'ok';
    b.damageCheck = res.pending || !d || d.instruction_text_seen ? 'not compared' : (d.new_visible_differences || []).length ? 'flagged' : d.comparable !== 'yes' || (d.not_comparable || []).length ? 'not comparable' : 'none';
    b.damage = b.damageCheck === 'flagged'; b.rstep = 'lock'; render();
  },
  rstep(s) { S.booking.rstep = s; render(); },
  async finish() {
    const b = S.booking; if (!b || finishing) return; finishing = true; setTimeout(() => { finishing = false; }, 5000);
    const v = S.vehicles.find(x => x.id === b.vid), lk = $('#lk'); if (lk) { lk.classList.remove('open'); lk.classList.add('busy'); }
    document.querySelectorAll('.foot .btn').forEach(x => x.disabled = true);
    await logLoc('lock', b.rack);
    setTimeout(() => {
      const bl = bill(b, b.arrivedAt || now()), late = bl.late; gpsStop();
      const est = isE(v) && b.pickupBattery != null ? estBatt(b, v) : null;
      if (est != null && b.returnBattery != null && b.battSrc !== 'old' && b.returnBattery < b.pickupBattery && bl.mi >= 0.5) v.drain = Math.min(15, Math.max(1, .7 * drainOf(v) + .3 * (b.pickupBattery - b.returnBattery) / bl.mi));
      const sp = split(v, bl.total); v.kitPaid = (v.kitPaid || 0) + sp.kit;
      S.trips.unshift({ name: v.name, rack: rack(b.rack).name, owner: v.owner.name, bill: bl, price: bl.total - late, late, sp, kitPaid: v.kitPaid, hold: b.hold, b0: b.pickupBattery ?? null, b1: b.returnBattery ?? null, est, lowBatt: b.returnBattery != null && b.returnBattery < RETURN_FLOOR, damage: b.damage, held: b.parkCheck !== 'ok' || b.damageCheck !== 'none' || (isE(v) && b.returnBattery == null), vid: v.id, parkCheck: b.parkCheck || 'review', damageCheck: b.damageCheck || 'not compared', at: now(), logN: (b.log || []).length, walkMin: Math.round(walkMins(bl.mi)), rideMin: Math.round(b.rideMin || 0), saved: savedMins(b) });
      const hold = b.parkCheck !== 'ok' || b.damageCheck !== 'none' || (isE(v) && b.returnBattery == null);
      v.status = hold ? 'review' : 'available'; if (b.returnBattery != null) { v.battery = b.returnBattery; v.battAt = now(); v.battSrc = 'photo'; } v.trips++;
      S.booking = null; save(); go('#/receipt');
    }, 900);
  },
  clearReview(vid) { const v = S.vehicles.find(x => x.id === vid); if (v && v.status === 'review') v.status = 'available'; S.trips.forEach(t => { if (t.vid === vid) t.held = false; }); save(); render(); toast('Cleared by staff (demo). ' + (v ? v.name : '') + ' is rentable again.'); },
  stars(n) { S.trips[0].stars = n; save(); render(); toast('Thanks! ' + S.trips[0].owner + ' sees your rating.'); },
  problem(k) {
    const b = S.booking, v = S.vehicles.find(x => x.id === b.vid), r = rack(b.rack), here = rack(b.at || b.rack), mi = miles(here, r), wm = Math.max(2, Math.round(walkMins(mi)));
    const M = {
      dead: `<div class="h3" style="font-size:20px">🔋 Battery died</div><p class="sm ink2">Kick it back to <b>${esc(r.name)}</b> without the motor: about ${mi.toFixed(1)} mi. That is still faster than walking. If it is not safe to ride, walk it, or lock it at the nearest rack and report it so the operator can collect it. Report it once, and your <b>curfew moves 30 minutes later</b>.</p><div class="note red">If it is hot, smoking or leaking, or will not roll, stop. Do not move it. Step away and call DPS (213) 740-4321.</div><div style="height:12px"></div><button class="btn" onclick="A.report('dead')">Report and add 30 minutes to the curfew</button>`,
      broken: `<div class="h3" style="font-size:20px">🛞 Flat tire or breakdown</div><p class="sm ink2">This is not your fault, so it is not your cost. Lock it to the nearest rack and tap below. We log where it is and end your rental there with a full refund. ${esc(v.owner.name)} picks it up.</p><button class="btn" onclick="A.report('broken')">Lock it here and end the rental</button>`,
      lock: `<div class="h3" style="font-size:20px">🔐 Lock trouble</div><p class="sm ink2">${keybox(v) ? `The key box code is <b>${esc(v.code)}</b> (it changes every night). Still stuck?` : '1. Stand within 2 m and turn Bluetooth on. 2. Try again. 3. Still stuck?'} Call ${esc(v.owner.name)}, the owner, at <b>${phoneOf(v.owner)}</b>. ${keybox(v) ? 'Or report it and support sends someone.' : 'Support can also open it remotely.'} Once you report it, you aren’t charged extra time or the curfew fee.</p><a class="btn" href="tel:${phoneOf(v.owner).replace(/\D/g, '')}" style="text-decoration:none">📞 Call ${esc(v.owner.name)}</a><div style="height:8px"></div><button class="btn ghost" onclick="A.report('lock')">Report lock trouble</button>`,
      phone: `<div class="h3" style="font-size:20px">📵 Phone dying</div><p class="sm ink2">Your curfew is ${t(b.end)} and your home rack is ${esc(r.name)}. Lock it at a rack if you can; the pilot operator can help you finish. Once you report it, there are no extra-time or curfew fees. (This demo saves the rental only in this browser.)</p><button class="btn" onclick="A.report('phone')">Got it</button>`,
      full: `<div class="h3" style="font-size:20px">🅿 Home rack full</div><p class="sm ink2">Lock it to the nearest legal rack within 100 m of ${esc(r.name)} and report it. In the pilot, support approves the spot and tells ${esc(v.owner.name)} where it is. In this demo, finish the return as usual.</p><button class="btn" onclick="A.report('full')">Use nearby rack</button>`,
      stolen: `<div class="h3" style="font-size:20px">🚨 Stolen</div><p class="sm ink2">Don't chase anyone. Call DPS at <b>(213) 740-4321</b>. We send DPS the serial number, its DPS decal and the location of the last unlock or lock from the ride log. There is no live tracker. If you locked it properly and did not leak a key box code, you do not pay for it.</p><a class="btn" href="tel:2137404321" style="text-decoration:none">Call DPS</a><div style="height:8px"></div><button class="btn ghost" onclick="A.report('stolen')">File report</button>`,
      crash: `<div class="h3" style="font-size:20px">🤕 Crash</div><p class="sm ink2">If anyone is hurt, call 911. Then call DPS at (213) 740-4321. Once you report it, you aren’t charged extra time or the curfew fee.</p><a class="btn" href="tel:911" style="text-decoration:none">Call 911</a><div style="height:8px"></div><button class="btn ghost" onclick="A.report('crash')">Report incident</button>`,
    };
    modal(M[k]);
  },
  report(k) {
    const b = S.booking; S.reports.push({ k, at: now() }); closeModal();
    if (k === 'dead') { if (b.deadReported) return toast('Already reported. Curfew is ' + t(b.end)); b.deadReported = true; b.end += 30 * MIN; toast('Reported. Curfew moved to ' + t(b.end)); }
    else if (['lock', 'crash', 'phone'].includes(k)) { b.waiveFrom = b.waiveFrom || now(); toast('Reported. No extra-time or curfew fees from now on.'); }
    else if (k === 'stolen') {
      const v = S.vehicles.find(x => x.id === b.vid); v.status = 'stolen'; logLoc('lock', b.at || b.rack); gpsStop();
      S.trips.unshift({ name: v.name, rack: rack(b.at || b.rack).name, owner: v.owner.name, price: bill(b, now()).total, late: 0, hold: b.hold, held: true, vid: v.id, at: now() });
      S.booking = null; save(); toast('Reported stolen. Rental ended. Your hold stays until DPS and staff review it (simulated).'); return go('#/home');
    }
    else if (k === 'broken') { logLoc('lock', b.at || b.rack); gpsStop(); const v = S.vehicles.find(x => x.id === b.vid); v.status = 'repair'; S.trips.unshift({ name: v.name, rack: rack(b.at || b.rack).name, owner: v.owner.name, price: 0, late: 0, hold: b.hold, b0: b.pickupBattery ?? null, b1: null, at: now() }); S.booking = null; save(); toast('Rental ended. Full refund. Owner notified.'); return go('#/home'); }
    else toast('Report saved (support is simulated in this demo).');
    save(); go('#/ride');
  },
  list() { if (S.mine.lock === 'none') return A.addVehicle(); S.mine.listed = !S.mine.listed; save(); render(); toast(S.mine.listed ? S.mine.name + ' is rentable again' : 'Paused. Current rental still finishes.'); },
  day(i) { S.mine.days[i] = S.mine.days[i] ? 0 : 1; render(); },
  rate(k, val) { const x = Math.round(parseFloat(val) * 2) / 2, lo = k === 'base' ? 1 : 0; if (!(x >= lo && x <= (k === 'base' ? 50 : 20))) { toast('Pick between ' + money(lo) + ' and ' + money(k === 'base' ? 50 : 20)); return render(); } S.mine.rate = { ...rateOf(S.mine), [k]: x }; save(); toast('Price saved: ' + money(x)); },
  win(k, val) { const w = { from: S.mine.from, to: S.mine.to, [k]: val }; if (!(w.from && w.to && w.from < w.to && w.to <= '23:00')) { toast('Pick a same-day window that ends by 11 PM.'); return render(); } S.mine[k] = val; save(); toast('Saved'); },
  addVehicle() {
    modal(`<div class="h3" style="font-size:20px">How will renters open it?</div><p class="sm ink2" style="margin-top:4px">In the pilot, we check that the model is certified (UL 2272 or UL 2849) and not recalled, and we register it with DPS. Choose a lock:</p>
     <button class="list-btn" id="pick-keybox" onclick="A.pickLock('keybox')" style="text-align:left"><div class="ic" style="background:#fff6cc">🔑</div><div class="grow"><div class="b">Key box · start today</div><div class="xs muted">Buy a small code box (about $20) that holds the key to your own lock, and hang it on the frame. Renters get the code, and you change it every night. You keep 90% of every fare.</div></div><span class="chev">›</span></button>
     <button class="list-btn" id="pick-smart" onclick="A.pickLock('smart')" style="text-align:left"><div class="ic" style="background:#fde8e8">🔐</div><div class="grow"><div class="b">Smart padlock · with the pilot</div><div class="xs muted">TTLock padlock and hardened chain ($86), with no upfront cost to you. Renters open it with their phone. You keep 70% while 15% of each fare pays off the kit, then 90%.</div></div><span class="chev">›</span></button>`);
  },
  pickLock(kind) {
    const m = S.mine; m.lock = kind; if (kind === 'keybox' && !/^\d{4}$/.test(m.code || '')) m.code = String(1000 + Math.floor(Math.random() * 9000));
    save(); closeModal(); render(); toast(kind === 'keybox' ? 'Key box set. Today’s code: ' + m.code : 'Smart padlock chosen (demo). In the pilot, you would pick up the kit at the IRC front desk.');
  },
  code(val) { const c = String(val).trim(); if (!/^\d{4}$/.test(c)) { toast('Use 4 digits, the same as on the box.'); return render(); } S.mine.code = c; save(); toast('Code saved. The next renter gets ' + c + '.'); },
  cashout() { toast('Demo payout of ' + money(S.mine.balance) + ' recorded. No real money moved.'); S.wallet.unshift({ d: 'Cash out to bank', a: -S.mine.balance, ago: 'just now' }); S.mine.balance = 0; save(); render(); },
  ff(m) { S.skew = (S.skew || 0) + m * MIN; meter(); save(); toast('Clock moved ' + m + ' minutes ahead'); render(); },
  ownerReturn() { const m = S.mine; if (!m.rental) return toast(m.name + ' is already home.'); const sp = split(m, rateOf(m).base); m.kitPaid = (m.kitPaid || 0) + sp.kit; m.rental.earn = sp.owner; m.history.unshift({ who: m.rental.renter, hrs: '1 h 10 m · 1.4 mi', earn: m.rental.earn, ago: 'just now', checks: 'Battery 38% · parked at IRC · no new damage' }); m.week[(new Date(now()).getDay() + 6) % 7] += m.rental.earn; m.balance += m.rental.earn; m.battery = 38; m.rental = null; save(); toast(m.history[0].who + ' returned ' + m.name + ' to ' + rack(m.rack).name + '. +' + money(m.history[0].earn)); location.hash === '#/garage' ? render() : go('#/garage'); },
  reset() { if (!confirm('Reset all demo data?')) return; S.skew = dayClock(); S = seed(); save(); go('#/welcome'); render(); },
  logout() { S.user = null; save(); go('#/welcome'); },
};
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
    const b = S.booking, c = { lat: p.coords.latitude, lng: p.coords.longitude, t: p.timestamp }; if (!b || !['active', 'returning'].includes(b.phase) || p.coords.accuracy > 30) return;
    if (gpsLast && miles(gpsLast, c) / 1.3 / Math.max(1 / 3600, (c.t - gpsLast.t) / 3600e3) > 25) return;   // faster than 25 mph: a bad fix
    if (gpsLast) { const d = miles(gpsLast, c) / 1.3; if (d > 0.01) { b.legGps = (b.legGps || 0) + d; b.gpsUsed = true; gpsLast = c; save(); } } else gpsLast = c;
  }, () => { }, { enableHighAccuracy: true, maximumAge: 5000 });
}
function gpsStop() { if (gpsWatch != null) navigator.geolocation.clearWatch(gpsWatch); gpsWatch = null; gpsLast = null; }
function meter() { const b = S.booking; if (!b) return; if (b.phase === 'active') b.rideMin += Math.max(0, (now() - (b.lastTick || now())) / MIN); b.lastTick = now(); }
window.go = go; window.back = back; window.closeModal = closeModal; window.toast = toast;

/* status bar clock */
setInterval(() => { $('#sb-time').textContent = new Date(now()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M/, ''); }, 1000);
render();
