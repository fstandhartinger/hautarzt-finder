'use strict';

const LS_TOKEN = 'hautarzt.token';

const STATUS_OPTS = [
  ['', '—'],
  ['termin', '✅ Termin bekommen'],
  ['warteliste', '⏳ Warteliste'],
  ['rueckruf', '📞 Rückruf zugesagt'],
  ['nicht_erreicht', '🔇 Nicht erreicht'],
  ['voll', '⛔ Nimmt niemanden'],
  ['abgelehnt', '❌ Abgelehnt'],
];
const GOOD_STATUS = new Set(['termin', 'warteliste', 'rueckruf']);

let TOKEN = localStorage.getItem(LS_TOKEN) || '';
let DOCS = [];
let CONFIG = null;
let map = null;
const markers = new Map();
let selectedId = null;

const $ = (s) => document.querySelector(s);
const el = (t, c) => { const n = document.createElement(t); if (c) n.className = c; return n; };

// ------------------------------------------------------------------ api

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'X-Auth-Token': TOKEN, ...(opts.headers || {}) },
  });
  if (res.status === 401) { logout(); throw new Error('unauthorized'); }
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

function logout() {
  localStorage.removeItem(LS_TOKEN);
  TOKEN = '';
  $('#gate').classList.remove('hidden');
  $('#app').classList.remove('ready');
}

function toast(msg, isErr) {
  const h = $('#saveHint');
  h.textContent = msg;
  h.classList.toggle('err', !!isErr);
  h.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => h.classList.remove('show'), 1600);
}

// ------------------------------------------------------------------ login

// The gate uses a masked text input rather than type=password, so that Chrome's
// password manager — which shares saved logins across every *.mintapis.com app —
// never offers another Sandy app's credentials here. If a browser cannot mask a
// text input, masking wins and we fall back to a real password field.
const pwInput = $('#pw');
const canMask = !!(window.CSS && CSS.supports &&
  (CSS.supports('-webkit-text-security', 'disc') || CSS.supports('text-security', 'disc')));
if (!canMask) {
  pwInput.type = 'password';
  pwInput.classList.remove('masked');
}

$('#pwReveal').addEventListener('click', () => {
  const hidden = pwInput.type === 'password' || pwInput.classList.contains('masked');
  if (canMask) pwInput.classList.toggle('masked', !hidden);
  else pwInput.type = hidden ? 'text' : 'password';
  $('#pwReveal').textContent = hidden ? '🙈' : '👁';
  pwInput.focus();
});

$('#gateForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#gateErr').textContent = '';
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: $('#pw').value }),
    });
    if (!res.ok) { $('#gateErr').textContent = 'Falsches Passwort.'; return; }
    const { token } = await res.json();
    TOKEN = token;
    localStorage.setItem(LS_TOKEN, token);
    document.cookie = `hautarzt_token=${encodeURIComponent(token)}; path=/; max-age=63072000; SameSite=Lax`;
    await boot();
  } catch (err) {
    $('#gateErr').textContent = 'Fehler: ' + err.message;
  }
});

// ------------------------------------------------------------------ boot

async function boot() {
  try {
    CONFIG = await api('/api/config');
    DOCS = await api('/api/doctors');
  } catch (err) {
    if (String(err.message) !== 'unauthorized') $('#gateErr').textContent = 'Fehler: ' + err.message;
    return;
  }
  $('#gate').classList.add('hidden');
  $('#app').classList.add('ready');
  initMap();
  render();
}

// ------------------------------------------------------------------ map

function pinColor(d) {
  if (GOOD_STATUS.has(d.status)) return '#22c55e';
  if (d.called) return '#94a3b8';
  return '#f87171';
}

function initMap() {
  mapboxgl.accessToken = CONFIG.mapboxToken;
  map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/dark-v11',
    center: [CONFIG.home.lon, CONFIG.home.lat],
    zoom: 8.2,
  });
  map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
  map.addControl(new mapboxgl.FullscreenControl(), 'top-right');

  const home = el('div', 'pin home');
  home.textContent = '🏠';
  new mapboxgl.Marker({ element: home })
    .setLngLat([CONFIG.home.lon, CONFIG.home.lat])
    .setPopup(new mapboxgl.Popup({ offset: 18 }).setHTML(`<h3>🏠 Zuhause</h3>${CONFIG.home.label}`))
    .addTo(map);

  for (const d of DOCS) {
    const node = el('div', 'pin');
    node.style.background = pinColor(d);
    node.title = d.name;
    node.addEventListener('click', () => selectDoctor(d.id, false));
    const m = new mapboxgl.Marker({ element: node })
      .setLngLat([d.lon, d.lat])
      .setPopup(new mapboxgl.Popup({ offset: 18, maxWidth: '280px' }).setHTML(popupHTML(d)))
      .addTo(map);
    markers.set(d.id, { marker: m, node });
  }
}

// A Google `cid` addresses the exact place (reviews included); everything else
// falls back to a plain Maps search for the name and address.
function mapsUrl(d) {
  return d.cid
    ? `https://www.google.com/maps?cid=${encodeURIComponent(d.cid)}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${d.name}, ${d.address}`)}`;
}

function popupHTML(d) {
  const esc = (s) => String(s || '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const tel = d.phone ? `<div>📞 <a href="tel:${esc(d.phone.replace(/\s/g, ''))}">${esc(d.phone)}</a></div>` : '';
  const web = d.website ? `<div>🌐 <a href="${esc(d.website)}" target="_blank" rel="noopener">Website</a></div>` : '';
  const rat = d.rating != null ? `<div>⭐ ${d.rating.toFixed(1)} (${d.rating_count} Bew.)</div>` : '<div>⭐ keine Bewertung</div>';
  const addr = `<div><a href="${esc(mapsUrl(d))}" target="_blank" rel="noopener">${esc(d.address)}</a></div>`;
  return `<h3>${esc(d.name)}</h3>${addr}<div>📍 ${d.km.toFixed(1)} km</div>${rat}${tel}${web}`;
}

function refreshMarker(d) {
  const m = markers.get(d.id);
  if (!m) return;
  m.node.style.background = pinColor(d);
}

// ------------------------------------------------------------------ state saving

const pending = new Map();
async function saveState(id, patch) {
  const d = DOCS.find((x) => x.id === id);
  Object.assign(d, patch);
  refreshMarker(d);
  updateStats();
  clearTimeout(pending.get(id));
  pending.set(id, setTimeout(async () => {
    try {
      await api(`/api/doctors/${encodeURIComponent(id)}/state`, { method: 'PUT', body: JSON.stringify(patch) });
      toast('Gespeichert');
    } catch (err) {
      toast('Speichern fehlgeschlagen', true);
      console.error(err);
    }
  }, 350));
}

// ------------------------------------------------------------------ filtering / sorting

const F = {
  q: '', maxKm: 100, country: '', rating: '', billing: '', called: '', status: '',
  sortBy: 'km', sortDir: 'asc',
};

function isPrivate(d) { return /privat|wahlarzt/i.test(d.billing || '') || /privat|wahlarzt/i.test(d.name); }

function filtered() {
  const q = F.q.trim().toLowerCase();
  let out = DOCS.filter((d) => {
    if (d.km > F.maxKm) return false;
    if (F.country && d.country !== F.country) return false;
    if (F.rating === 'rated' && d.rating == null) return false;
    if (F.rating && F.rating !== 'rated' && (d.rating == null || d.rating < parseFloat(F.rating))) return false;
    if (F.billing === 'privat' && !isPrivate(d)) return false;
    if (F.billing === 'kasse' && isPrivate(d)) return false;
    if (F.called === '1' && !d.called) return false;
    if (F.called === '0' && d.called) return false;
    if (F.status === 'none' && d.status) return false;
    if (F.status && F.status !== 'none' && d.status !== F.status) return false;
    if (q) {
      const hay = [d.name, d.address, d.city, d.phone, d.comment, d.note, (d.also || []).join(' ')]
        .join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const dir = F.sortDir === 'desc' ? -1 : 1;
  const key = F.sortBy;
  out.sort((a, b) => {
    let av, bv;
    if (key === 'rating') { av = a.rating ?? -1; bv = b.rating ?? -1; }
    else if (key === 'rating_count') { av = a.rating_count ?? -1; bv = b.rating_count ?? -1; }
    else if (key === 'km') { av = a.km; bv = b.km; }
    else if (key === 'called') { av = a.called ? 1 : 0; bv = b.called ? 1 : 0; }
    else if (key === 'status') { av = a.status || 'zzz'; bv = b.status || 'zzz'; }
    else if (key === 'phone') { av = a.phone || 'zzz'; bv = b.phone || 'zzz'; }
    else if (key === 'city') { av = (a.city || '').toLowerCase(); bv = (b.city || '').toLowerCase(); }
    else { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return a.km - b.km;
  });
  return out;
}

// ------------------------------------------------------------------ rendering

function ratingCell(d) {
  const c = el('div', 'rating');
  if (d.rating == null) {
    c.className = 'rating r-none';
    c.textContent = '– keine';
    return c;
  }
  const cls = d.rating >= 4 ? 'r-hi' : d.rating >= 3.2 ? 'r-mid' : 'r-lo';
  c.className = 'rating ' + cls;
  c.innerHTML = `<b>${d.rating.toFixed(1)}</b> ★ <small>(${d.rating_count})</small>`;
  return c;
}

function render() {
  const rows = filtered();
  const tb = $('#tbody');
  tb.textContent = '';
  $('#empty').hidden = rows.length > 0;

  for (const d of rows) {
    const tr = el('tr');
    tr.dataset.id = d.id;
    if (d.called) tr.classList.add('called');
    if (d.id === selectedId) tr.classList.add('sel');

    // Praxis
    const tdName = el('td');
    const nm = el('div', 'docname');
    nm.textContent = d.name;
    nm.addEventListener('click', () => selectDoctor(d.id, true));
    tdName.appendChild(nm);
    const sub = el('div', 'sub');
    const addrLink = document.createElement('a');
    addrLink.className = 'addr';
    addrLink.href = mapsUrl(d);
    addrLink.target = '_blank';
    addrLink.rel = 'noopener';
    addrLink.title = 'In Google Maps öffnen';
    addrLink.textContent = d.address + ' ';
    const pin = el('span', 'pinIcon');
    pin.textContent = '📍';
    addrLink.appendChild(pin);
    sub.appendChild(addrLink);
    tdName.appendChild(sub);
    const badges = el('div', 'sub');
    if (d.country === 'AT') { const b = el('span', 'badge at'); b.textContent = '🇦🇹 Österreich'; badges.appendChild(b); }
    if (isPrivate(d)) { const b = el('span', 'badge privat'); b.textContent = 'Privat/Wahlarzt'; badges.appendChild(b); }
    if (d.website) {
      const a = document.createElement('a');
      a.href = d.website; a.target = '_blank'; a.rel = 'noopener';
      a.className = 'badge'; a.textContent = 'Website';
      badges.appendChild(a);
    }
    if (badges.children.length) tdName.appendChild(badges);
    if (d.note) { const n = el('div', 'note'); n.textContent = 'ℹ ' + d.note; tdName.appendChild(n); }
    if (d.also && d.also.length) {
      const o = el('div', 'sub');
      o.textContent = 'auch: ' + d.also.join(' · ');
      tdName.appendChild(o);
    }
    tr.appendChild(tdName);

    // km
    const tdKm = el('td', 'km c-meta m-inline');
    tdKm.dataset.l = 'Entfernung';
    tdKm.textContent = d.km.toFixed(1) + ' km';
    tr.appendChild(tdKm);

    // rating
    const tdR = el('td', 'm-inline');
    tdR.dataset.l = 'Bewertung';
    tdR.appendChild(ratingCell(d));
    tr.appendChild(tdR);

    // phone
    const tdP = el('td', 'tel m-inline');
    tdP.dataset.l = 'Telefon';
    if (d.phone) {
      const a = document.createElement('a');
      a.href = 'tel:' + d.phone.replace(/\s/g, '');
      a.textContent = d.phone;
      tdP.appendChild(a);
    } else tdP.textContent = '–';
    tr.appendChild(tdP);

    // called
    const tdC = el('td', 'c-called');
    tdC.dataset.l = 'Angerufen';
    const cb = el('input', 'chk');
    cb.type = 'checkbox';
    cb.checked = !!d.called;
    cb.title = 'Schon angerufen?';
    cb.addEventListener('change', () => {
      tr.classList.toggle('called', cb.checked);
      saveState(d.id, { called: cb.checked });
    });
    tdC.appendChild(cb);
    const lbl = el('span', 'sub');
    lbl.textContent = 'angerufen';
    lbl.style.cursor = 'pointer';
    lbl.addEventListener('click', () => { cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); });
    tdC.appendChild(lbl);
    tr.appendChild(tdC);

    // status
    const tdS = el('td');
    tdS.dataset.l = 'Ergebnis';
    const sel = el('select', 'stsel');
    for (const [v, t] of STATUS_OPTS) {
      const o = document.createElement('option');
      o.value = v; o.textContent = t;
      if (v === d.status) o.selected = true;
      sel.appendChild(o);
    }
    sel.dataset.v = d.status || '';
    sel.addEventListener('change', () => {
      sel.dataset.v = sel.value;
      saveState(d.id, { status: sel.value });
    });
    tdS.appendChild(sel);
    tr.appendChild(tdS);

    // comment
    const tdCm = el('td');
    tdCm.dataset.l = 'Kommentar';
    const ta = el('textarea', 'cmt');
    ta.rows = 2;
    ta.placeholder = 'Notiz zum Telefonat …';
    ta.value = d.comment || '';
    let t0;
    ta.addEventListener('input', () => {
      clearTimeout(t0);
      t0 = setTimeout(() => saveState(d.id, { comment: ta.value }), 700);
    });
    ta.addEventListener('blur', () => { clearTimeout(t0); saveState(d.id, { comment: ta.value }); });
    tdCm.appendChild(ta);
    tr.appendChild(tdCm);

    tb.appendChild(tr);
  }

  updateStats(rows.length);
  syncHeaderArrows();

  // Only show markers that pass the current filters.
  const visible = new Set(rows.map((r) => r.id));
  for (const [id, m] of markers) {
    m.node.style.display = visible.has(id) ? '' : 'none';
  }
}

function updateStats(shown) {
  const total = DOCS.length;
  const called = DOCS.filter((d) => d.called).length;
  const wins = DOCS.filter((d) => GOOD_STATUS.has(d.status)).length;
  const n = shown == null ? document.querySelectorAll('#tbody tr').length : shown;
  $('#stats').textContent = `${n}/${total} angezeigt · ${called} angerufen · ${wins} mit Termin/WL`;
}

function syncHeaderArrows() {
  document.querySelectorAll('thead th').forEach((th) => {
    const s = th.dataset.s;
    th.querySelector('.arr')?.remove();
    if (s && s === F.sortBy) {
      const a = el('span', 'arr');
      a.textContent = F.sortDir === 'asc' ? ' ▲' : ' ▼';
      th.appendChild(a);
    }
  });
}

function selectDoctor(id, fromList) {
  selectedId = id;
  const d = DOCS.find((x) => x.id === id);
  if (!d) return;
  document.querySelectorAll('#tbody tr').forEach((tr) => tr.classList.toggle('sel', tr.dataset.id === id));
  const m = markers.get(id);
  if (m) {
    map.flyTo({ center: [d.lon, d.lat], zoom: Math.max(map.getZoom(), 11), speed: 1.4 });
    m.marker.togglePopup();
  }
  if (!fromList) {
    const tr = document.querySelector(`#tbody tr[data-id="${CSS.escape(id)}"]`);
    if (tr) tr.scrollIntoView({ block: 'center', behavior: 'smooth' });
    else toast('Praxis ist aktuell ausgefiltert');
  }
}

// ------------------------------------------------------------------ controls

function bindFilter(sel, key, transform) {
  const node = $(sel);
  node.addEventListener('input', () => {
    F[key] = transform ? transform(node.value) : node.value;
    if (key === 'maxKm') $('#kmVal').textContent = F.maxKm + ' km';
    render();
  });
}
bindFilter('#search', 'q');
bindFilter('#maxKm', 'maxKm', (v) => parseFloat(v));
bindFilter('#fCountry', 'country');
bindFilter('#fRating', 'rating');
bindFilter('#fBilling', 'billing');
bindFilter('#fCalled', 'called');
bindFilter('#fStatus', 'status');
bindFilter('#sortBy', 'sortBy');
bindFilter('#sortDir', 'sortDir');

$('#resetF').addEventListener('click', () => {
  Object.assign(F, { q: '', maxKm: 100, country: '', rating: '', billing: '', called: '', status: '', sortBy: 'km', sortDir: 'asc' });
  $('#search').value = ''; $('#maxKm').value = 100; $('#kmVal').textContent = '100 km';
  ['#fCountry', '#fRating', '#fBilling', '#fCalled', '#fStatus'].forEach((s) => { $(s).value = ''; });
  $('#sortBy').value = 'km'; $('#sortDir').value = 'asc';
  render();
});

$('#toggleFilters').addEventListener('click', () => {
  const g = $('#filterGrid');
  g.classList.toggle('open');
  $('#toggleFilters').textContent = g.classList.contains('open') ? 'Filter ▴' : 'Filter ▾';
  $('#toggleFilters').classList.toggle('on', g.classList.contains('open'));
});

$('#toggleList').addEventListener('click', () => {
  const m = $('#main');
  m.classList.remove('mapCollapsed');
  m.classList.toggle('listCollapsed');
  $('#toggleList').classList.toggle('on', !m.classList.contains('listCollapsed'));
  setTimeout(() => map && map.resize(), 260);
});

$('#toggleMap').addEventListener('click', () => {
  const m = $('#main');
  m.classList.remove('listCollapsed');
  m.classList.toggle('mapCollapsed');
  $('#toggleMap').classList.toggle('on', !m.classList.contains('mapCollapsed'));
  setTimeout(() => map && map.resize(), 260);
});

document.querySelectorAll('thead th[data-s]').forEach((th) => {
  th.addEventListener('click', () => {
    const s = th.dataset.s;
    if (F.sortBy === s) F.sortDir = F.sortDir === 'asc' ? 'desc' : 'asc';
    else { F.sortBy = s; F.sortDir = (s === 'rating' || s === 'rating_count') ? 'desc' : 'asc'; }
    $('#sortBy').value = ['km', 'rating', 'rating_count', 'name', 'city', 'called'].includes(F.sortBy) ? F.sortBy : 'km';
    $('#sortDir').value = F.sortDir;
    render();
  });
});

// ------------------------------------------------------------------ start

$('#toggleList').classList.add('on');
$('#toggleMap').classList.add('on');
if (TOKEN) boot(); else $('#pw').focus();
