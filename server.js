import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { q, one, tx, newToken, reportToken, setSetting } from './db.js';
import { importMonumentsText } from './import.js';
import { seedDemo } from './seed.js';
import { loadTexts, TEXT_SITES } from './texts.js';
import monumentiCsv from './monumenti-data.js';

const PORT = Number(process.env.PORT || 3000);
// Indirizzo pubblico usato nei QR. Ordine: BASE_URL → dominio di produzione Vercel → Render → localhost.
const BASE = (
  process.env.BASE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '') ||
  process.env.RENDER_EXTERNAL_URL ||
  `http://localhost:${PORT}`
).replace(/\/$/, '');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'cambiami';
const SECRET = process.env.SECRET || 'dev-secret-cambia-me';
const PUBLIC_DIR = resolve('public');
const LANGS = ['it', 'en', 'fr', 'de', 'es'];
const LANG_NAMES = { it: 'Italiano', en: 'English', fr: 'Français', de: 'Deutsch', es: 'Español' };
const TIERS = { base: { label: 'Base', price: 300 }, plus: { label: 'Plus', price: 500 } };

const INSECURE = ADMIN_PASSWORD === 'cambiami' || SECRET === 'dev-secret-cambia-me';
const ON_SERVER = Boolean(process.env.VERCEL || process.env.RENDER || process.env.NODE_ENV === 'production');
if (INSECURE) {
  console.warn(ON_SERVER
    ? 'ATTENZIONE: ADMIN_PASSWORD/SECRET di default: in produzione l\'area admin resta bloccata finché non li imposti.'
    : 'ATTENZIONE: password/segreto di default. Imposta ADMIN_PASSWORD e SECRET prima di andare online.');
}

// ---------- utilità ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v, d = 0) => Number(v ?? d).toLocaleString('it-IT');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.mp3': 'audio/mpeg', '.webmanifest': 'application/manifest+json' };

// Giorni sempre nel fuso di Roma (en-CA formatta come AAAA-MM-GG).
const romeFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' });
const romeDay = (t = Date.now()) => romeFmt.format(new Date(t));
const today = () => romeDay();
const DAY_SQL = (col) => `to_char(${col} AT TIME ZONE 'Europe/Rome', 'YYYY-MM-DD')`;

function send(res, status, body, type = 'text/html; charset=utf-8', headers = {}) {
  res.writeHead(status, { 'content-type': type, 'x-content-type-options': 'nosniff', ...headers });
  res.end(body);
}
const json = (res, status, obj) => send(res, status, JSON.stringify(obj), 'application/json', { 'cache-control': 'no-store' });
const redirect = (res, to, headers = {}) => { res.writeHead(303, { location: to, ...headers }); res.end(); };

function readBody(req, limit = 200_000) {
  return new Promise((ok, ko) => {
    let s = '';
    req.on('data', (c) => { s += c; if (s.length > limit) { ko(new Error('troppo grande')); req.destroy(); } });
    req.on('end', () => ok(s));
    req.on('error', ko);
  });
}
const parseForm = (s) => Object.fromEntries(new URLSearchParams(s));

function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}
const adminToken = () => crypto.createHmac('sha256', SECRET).update(ADMIN_PASSWORD).digest('hex');
const isAdmin = (req) => {
  const c = cookies(req).adm || '';
  const a = Buffer.from(c), b = Buffer.from(adminToken());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

// Visitatore anonimo: hash con sale giornaliero, nessun IP salvato.
function visitorHash(req) {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  return crypto.createHash('sha256').update(`${SECRET}|${today()}|${ip}|${req.headers['user-agent'] || ''}`).digest('hex').slice(0, 16);
}

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000, r = (x) => (x * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function parseCoords(s) {
  const m = String(s || '').match(/(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  const lat = Number(m[1].replace(',', '.')), lng = Number(m[2].replace(',', '.'));
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

const slugify = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const rangeDays = (url) => Math.min(365, Math.max(1, Math.floor(Number(url.searchParams.get('d'))) || 30));

// ---------- API pubblica ----------
async function monumentPayload(city, slug, lang, lat, lng) {
  const m = await one('SELECT * FROM monuments WHERE city_slug = ? AND slug = ? AND active = 1', [city, slug]);
  if (!m) return null;
  const texts = await q('SELECT * FROM monument_texts WHERE monument_id = ?', [m.id]);
  const text = texts.find((t) => t.lang === lang && t.body) || texts.find((t) => t.lang === 'en' && t.body) || texts.find((t) => t.lang === 'it' && t.body) || texts[0] || { lang, title: m.name, body: '', audio_url: null };

  const from = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : { lat: m.lat, lng: m.lng };
  const rows = await q(`SELECT id, name, category, description, phone, website, lat, lng, tier FROM businesses
    WHERE active = 1 AND lat IS NOT NULL AND (paid_until IS NULL OR paid_until >= ?)`, [today()]);
  const all = rows.map((b) => ({ ...b, distance_m: Math.round(haversine(from.lat, from.lng, b.lat, b.lng)) })).sort((a, b) => a.distance_m - b.distance_m);
  let near = all.filter((b) => b.distance_m <= 800);
  if (near.length < 3) near = all.filter((b) => b.distance_m <= 2000).slice(0, 6);
  // "Plus" prima dei "Base", poi per distanza
  near.sort((a, b) => (a.tier === b.tier ? a.distance_m - b.distance_m : a.tier === 'plus' ? -1 : 1));
  return {
    monument: { city: m.city_slug, slug: m.slug, name: m.name, comune: m.comune, category: m.category, lat: m.lat, lng: m.lng },
    text: { lang: text.lang, title: text.title || m.name, body: text.body || '', audio_url: text.audio_url || null },
    languages: texts.filter((t) => t.body).map((t) => t.lang),
    showcase: near.slice(0, 10),
  };
}

const EVENT_TYPES = new Set(['scan', 'audio', 'call', 'map', 'web', 'impression']);

async function handleTrack(req, res) {
  let b;
  try { b = JSON.parse(await readBody(req, 10_000)); } catch { return json(res, 400, { error: 'json' }); }
  if (!b || !EVENT_TYPES.has(b.type)) return json(res, 400, { error: 'type' });
  const m = await one('SELECT id FROM monuments WHERE city_slug = ? AND slug = ?', [String(b.city || 'palermo'), String(b.slug || '')]);
  if (!m) return json(res, 404, { error: 'slug' });
  const lang = LANGS.includes(b.lang) ? b.lang : null;
  const source = /^[a-z0-9-]{1,30}$/.test(b.source || '') ? b.source : null;
  const visitor = visitorHash(req);
  const ids = b.type === 'impression' ? (Array.isArray(b.business_ids) ? b.business_ids : []).slice(0, 20) : [b.business_id ?? null];
  const rows = [];
  for (const id of ids) {
    const bid = id == null ? null : Number(id);
    if (bid != null && !Number.isInteger(bid)) continue;
    rows.push([b.type, m.id, bid, lang, source, visitor]);
  }
  if (rows.length) {
    await q(`INSERT INTO events (type, monument_id, business_id, lang, source, visitor) VALUES ${rows.map(() => '(?, ?, ?, ?, ?, ?)').join(',')}`, rows.flat());
  }
  json(res, 200, { ok: true });
}

// ---------- viste HTML ----------
function layout(title, body, { nav = null, wide = true } = {}) {
  const items = [['dash', '/admin', 'Dashboard'], ['biz', '/admin/businesses', 'Vetrina'], ['mon', '/admin/monuments', 'Monumenti e QR'], ['par', '/admin/partners', 'Partner e Comune']];
  const navHtml = nav ? `<nav class="adm">${items.map(([k, h, l]) => `<a href="${h}" class="${k === nav ? 'on' : ''}">${l}</a>`).join('')}<a href="/admin/logout" style="margin-left:auto">Esci</a></nav>` : '';
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><link rel="icon" href="/icon.svg" type="image/svg+xml"><link rel="stylesheet" href="/style.css"></head>
<body>${navHtml}<main class="wrap ${wide ? 'wide' : ''}">${body}</main></body></html>`;
}

function rangeSwitch(base, d) {
  return `<p class="noprint">${[7, 30, 90].map((n) => (n === d ? `<b>${n} giorni</b>` : `<a href="${base}?d=${n}">${n} giorni</a>`)).join(' · ')}</p>`;
}

function barChart(rows, label = 'Scansioni') {
  const W = 640, H = 150, pad = 22, max = Math.max(1, ...rows.map((r) => r.value));
  const bw = (W - 2) / rows.length;
  const bars = rows.map((r, i) => {
    const h = Math.round(((H - pad - 6) * r.value) / max);
    return `<rect x="${(i * bw + 1).toFixed(1)}" y="${H - pad - h}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${h}" rx="2"><title>${esc(r.day)}: ${r.value}</title></rect>`;
  }).join('');
  const first = rows[0].day.slice(5), last = rows.at(-1).day.slice(5);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)} per giorno, massimo ${max}" width="100%">${bars}
<text x="0" y="${H - 6}">${first}</text><text x="${W}" y="${H - 6}" text-anchor="end">${last}</text><text x="${W}" y="10" text-anchor="end">max ${max}/giorno</text></svg>`;
}

function dailySeries(rows, d) {
  const map = new Map(rows.map((r) => [r.day, r.n]));
  const out = [];
  for (let i = d - 1; i >= 0; i--) {
    const day = romeDay(Date.now() - i * 864e5);
    out.push({ day, value: map.get(day) || 0 });
  }
  return out;
}

const CLICKS = `e.type IN ('call','map','web')`;

async function stats(d) {
  const tot = await one(`SELECT
      COUNT(*) FILTER (WHERE type = 'scan') scans,
      COUNT(DISTINCT CASE WHEN type = 'scan' THEN visitor END) uniq,
      COUNT(*) FILTER (WHERE type = 'audio') audio,
      COUNT(*) FILTER (WHERE type IN ('call','map','web')) clicks,
      COUNT(*) FILTER (WHERE type = 'impression') imps
    FROM events WHERE ts >= now() - make_interval(days => ?)`, [d]);
  const perMon = await q(`SELECT m.id, m.name, m.slug, m.city_slug, m.comune,
      COUNT(e.id) FILTER (WHERE e.type = 'scan') scans,
      COUNT(DISTINCT CASE WHEN e.type = 'scan' THEN e.visitor END) uniq,
      COUNT(e.id) FILTER (WHERE e.type = 'audio') audio,
      COUNT(e.id) FILTER (WHERE ${CLICKS}) clicks
    FROM monuments m LEFT JOIN events e ON e.monument_id = m.id AND e.ts >= now() - make_interval(days => ?)
    WHERE m.active = 1 GROUP BY m.id ORDER BY scans DESC, m.name`, [d]);
  const perLang = await q(`SELECT COALESCE(lang, 'n/d') lang, COUNT(*) n FROM events WHERE type = 'scan' AND ts >= now() - make_interval(days => ?) GROUP BY lang ORDER BY n DESC`, [d]);
  const perComune = await q(`SELECT m.comune, COUNT(*) n FROM events e JOIN monuments m ON m.id = e.monument_id WHERE e.type = 'scan' AND e.ts >= now() - make_interval(days => ?) GROUP BY m.comune ORDER BY n DESC`, [d]);
  const perDay = await q(`SELECT ${DAY_SQL('ts')} AS day, COUNT(*) n FROM events WHERE type = 'scan' AND ts >= now() - make_interval(days => ?) GROUP BY 1`, [d]);
  return { tot, perMon, perLang, perComune, perDay };
}

function langTable(rows) {
  const total = rows.reduce((a, r) => a + r.n, 0) || 1;
  return `<table><tr><th>Lingua</th><th class="n">Scansioni</th><th class="n">%</th></tr>${rows.map((r) => `<tr><td>${esc(LANG_NAMES[r.lang] || r.lang)}</td><td class="n">${num(r.n)}</td><td class="n">${Math.round((100 * r.n) / total)}%</td></tr>`).join('')}</table>`;
}

// --- Caricamento dati iniziali (per quando il database online è vuoto) ---
const setupCard = () => `<div class="card"><b>Il database è vuoto</b>
  <p>Carica i 50 siti delle targhe per cominciare.</p>
  <form method="post" action="/admin/setup" style="display:inline"><input type="hidden" name="mode" value="sites"><button>Carica solo i 50 siti</button></form>
  <form method="post" action="/admin/setup" style="display:inline"><input type="hidden" name="mode" value="demo"><button class="ghost">Carica i 50 siti + dati di esempio (demo)</button></form>
  <p class="mute">Vengono caricati anche i testi in 4 lingue. I dati di esempio comprendono 6 locali "DEMO" e 30 giorni di statistiche finte: servono solo per mostrare il progetto. Il caricamento funziona solo se il database è vuoto e non cancella nulla.</p></div>`;

async function setupPage() {
  const n = (await one('SELECT COUNT(*) n FROM monuments')).n;
  return layout('Carica dati', `<h1>Carica dati iniziali</h1>${n === 0 ? setupCard() : `<div class="card"><p>Il database contiene già ${num(n)} siti: non serve caricare altro.</p><p><a class="btn" href="/admin">Vai alla dashboard</a></p></div>`}`, { nav: 'dash' });
}

// --- Dashboard admin ---
async function dashboardPage(url) {
  const d = rangeDays(url);
  const st = await stats(d);
  const topBiz = await q(`SELECT b.id, b.name, b.tier,
      COUNT(e.id) FILTER (WHERE e.type = 'impression') imps,
      COUNT(e.id) FILTER (WHERE ${CLICKS}) clicks
    FROM businesses b LEFT JOIN events e ON e.business_id = b.id AND e.ts >= now() - make_interval(days => ?)
    WHERE b.active = 1 GROUP BY b.id ORDER BY clicks DESC, imps DESC LIMIT 10`, [d]);
  const rev = await one(`SELECT COUNT(*) n, COALESCE(SUM(price_eur), 0) eur FROM businesses WHERE active = 1 AND (paid_until IS NULL OR paid_until >= ?)`, [today()]);
  const expiring = await q(`SELECT name, paid_until FROM businesses WHERE active = 1 AND paid_until BETWEEN ? AND ? ORDER BY paid_until`, [today(), romeDay(Date.now() + 30 * 864e5)]);
  const ctr = st.tot.imps ? ((100 * st.tot.clicks) / st.tot.imps).toFixed(1) : '0.0';
  const empty = (await one('SELECT COUNT(*) n FROM monuments')).n === 0;
  return layout('Dashboard', `
    <h1>Dashboard</h1>${empty ? setupCard() : ''}${rangeSwitch('/admin', d)}
    <div class="grid">
      <div class="kpi"><b>${num(st.tot.scans)}</b>Scansioni QR</div>
      <div class="kpi"><b>${num(st.tot.uniq)}</b>Visitatori (unici al giorno)</div>
      <div class="kpi"><b>${num(st.tot.audio)}</b>Ascolti avviati</div>
      <div class="kpi"><b>${num(st.tot.clicks)}</b>Click sui locali (${ctr}%)</div>
      <div class="kpi"><b>${num(rev.eur)} €</b>Abbonamenti attivi (${rev.n} locali, annuo)</div>
    </div>
    ${expiring.length ? `<div class="card warn">In scadenza entro 30 giorni: ${expiring.map((e) => `${esc(e.name)} (${esc(e.paid_until)})`).join(', ')}</div>` : ''}
    <h2>Scansioni per giorno</h2><div class="card">${barChart(dailySeries(st.perDay, d))}</div>
    <h2>Per singolo QR / monumento</h2>
    <div class="card overflow"><table><tr><th>Monumento</th><th>Comune</th><th class="n">Scansioni</th><th class="n">Visitatori</th><th class="n">Ascolti</th><th class="n">Click locali</th></tr>
    ${st.perMon.map((m) => `<tr><td><a href="/p/${esc(m.city_slug)}/${esc(m.slug)}" target="_blank">${esc(m.name)}</a></td><td>${esc(m.comune)}</td><td class="n">${num(m.scans)}</td><td class="n">${num(m.uniq)}</td><td class="n">${num(m.audio)}</td><td class="n">${num(m.clicks)}</td></tr>`).join('')}</table></div>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">
      <div><h2>Lingue</h2><div class="card">${langTable(st.perLang)}</div></div>
      <div><h2>Locali più cliccati</h2><div class="card overflow"><table><tr><th>Locale</th><th class="n">Mostrato</th><th class="n">Click</th></tr>
      ${topBiz.map((b) => `<tr><td>${esc(b.name)}</td><td class="n">${num(b.imps)}</td><td class="n">${num(b.clicks)}</td></tr>`).join('')}</table></div></div>
    </div>`, { nav: 'dash' });
}

// --- Vetrina (aziende) ---
async function businessesPage() {
  const partners = await q('SELECT * FROM partners ORDER BY name');
  const rows = await q(`SELECT b.*, p.name partner_name FROM businesses b LEFT JOIN partners p ON p.id = b.partner_id ORDER BY b.active DESC, b.name`);
  const partnerOpts = (sel) => `<option value="">— nessuno —</option>${partners.map((p) => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}`;
  const tierOpts = (sel) => Object.entries(TIERS).map(([k, t]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${t.label} (${t.price} €)</option>`).join('');
  const nextYear = romeDay(Date.now() + 365 * 864e5);
  return layout('Vetrina', `
    <h1>Vetrina: locali che pagano</h1>
    <div class="card"><b>Aggiungi un locale</b>
    <form class="row" method="post" action="/admin/businesses" style="margin-top:10px">
      <label>Nome<input name="name" required></label>
      <label>Tipo<input name="category" value="Ristorante" list="cats"></label>
      <datalist id="cats"><option>Ristorante</option><option>Bar</option><option>Pasticceria</option><option>Hotel</option><option>Bottega</option></datalist>
      <label>Coordinate (da Google Maps: tasto destro → copia)<input name="coords" placeholder="38.1157, 13.3615" required></label>
      <label>Indirizzo<input name="address"></label>
      <label>Telefono<input name="phone" placeholder="+39…"></label>
      <label>Sito (https://…)<input name="website"></label>
      <label>Descrizione breve<input name="description" maxlength="140"></label>
      <label>Piano<select name="tier">${tierOpts('base')}</select></label>
      <label>Importo annuo (€)<input name="price_eur" type="number" value="300"></label>
      <label>Pagato fino al<input name="paid_until" type="date" value="${nextYear}"></label>
      <label>Portato da<select name="partner_id">${partnerOpts(null)}</select></label>
      <button>Aggiungi</button>
    </form></div>
    <div class="card overflow"><table>
      <tr><th>Locale</th><th>Piano</th><th>€ / anno</th><th>Pagato fino al</th><th>Attivo</th><th>Portato da</th><th>Pagina locale</th><th></th></tr>
      ${rows.map((b) => {
        const exp = b.paid_until && b.paid_until < today();
        return `<tr><td><b>${esc(b.name)}</b><br><span class="mute">${esc(b.category)} · ${b.lat?.toFixed(4)}, ${b.lng?.toFixed(4)}</span></td>
        <td><select name="tier" form="f${b.id}">${tierOpts(b.tier)}</select></td>
        <td><input name="price_eur" type="number" value="${b.price_eur}" form="f${b.id}" style="width:80px"></td>
        <td><input name="paid_until" type="date" value="${esc(b.paid_until || '')}" form="f${b.id}">${exp ? '<div class="warn">scaduto</div>' : ''}</td>
        <td><input type="checkbox" name="active" value="1" ${b.active ? 'checked' : ''} form="f${b.id}" style="width:auto"></td>
        <td><select name="partner_id" form="f${b.id}">${partnerOpts(b.partner_id)}</select></td>
        <td><a href="/v/${b.token}" target="_blank">apri</a></td>
        <td><form id="f${b.id}" method="post" action="/admin/businesses/${b.id}"><button class="small">Salva</button></form></td></tr>`;
      }).join('')}
    </table>
    <p class="mute">Un locale compare nella vetrina solo se è attivo e non scaduto. "Pagina locale" è il link da mandare al titolare: vede quante volte è stato mostrato e quanti click ha ricevuto.</p></div>`, { nav: 'biz' });
}

// --- Monumenti e QR ---
async function monumentsPage(url) {
  const rows = await q(`SELECT m.*, COUNT(e.id) FILTER (WHERE e.type = 'scan') scans
    FROM monuments m LEFT JOIN events e ON e.monument_id = m.id AND e.ts >= now() - make_interval(days => 30)
    GROUP BY m.id ORDER BY m.city_slug, m.name`);
  const langRows = await q(`SELECT monument_id, lang FROM monument_texts WHERE body <> ''`);
  const langsOf = new Map();
  for (const r of langRows) langsOf.set(r.monument_id, [...(langsOf.get(r.monument_id) || []), r.lang]);
  for (const r of rows) r.langs = (langsOf.get(r.id) || []).sort((a, b) => LANGS.indexOf(a) - LANGS.indexOf(b));
  const partners = await q('SELECT code, name FROM partners ORDER BY name');
  const onlyMissing = url.searchParams.get('f') === 'missing';
  const missing = rows.filter((r) => r.langs.length === 0).length;
  const shown = onlyMissing ? rows.filter((r) => r.langs.length === 0) : rows;
  const mmss = (s) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '—');
  return layout('Monumenti e QR', `
    <h1>Monumenti e QR</h1>
    <p>${rows.length} siti · ${rows.filter((r) => r.langs.length > 0).length} con testo · <b>${missing} ancora senza testo</b>
      · ${onlyMissing ? '<a href="/admin/monuments">mostra tutti</a>' : '<a href="/admin/monuments?f=missing">mostra solo quelli senza testo</a>'}</p>
    <div class="card"><b>Nuovo monumento</b>
    <form class="row" method="post" action="/admin/monuments" style="margin-top:10px">
      <label>Nome<input name="name" required></label>
      <label>Comune<input name="comune" value="Palermo" required></label>
      <label>Categoria<input name="category" placeholder="Museo, Piazza…"></label>
      <label>Indirizzo<input name="address"></label>
      <label>Coordinate (da Google Maps)<input name="coords" placeholder="38.1157, 13.3615" required></label>
      <button>Crea</button>
    </form>
    <p class="mute">Per inserirne molti insieme: prepara un CSV come <code>monumenti.csv</code> e lancia <code>npm run import</code>.</p></div>
    <div class="card"><b>Testi delle audio-guide</b>
      <p>Per ${TEXT_SITES} siti sono pronti i testi in italiano, inglese, francese e tedesco (descrizione più leggenda o curiosità). Sono <b>bozze</b>: vanno verificati prima del lancio.</p>
      <form method="post" action="/admin/testi"><button>Carica i testi</button></form>
      <p class="mute">Non sovrascrive i testi che hai già scritto o modificato: inserisce solo quelli mancanti. Puoi ripremerlo senza rischi.</p></div>
    <p><input id="q" placeholder="Cerca un sito…" oninput="const v=this.value.toLowerCase();document.querySelectorAll('#tb tr').forEach(r=>r.style.display=r.textContent.toLowerCase().includes(v)?'':'none')"></p>
    <div class="card overflow"><table><thead><tr><th>Sito</th><th>Categoria</th><th>Lingue con testo</th><th class="n">Durata prevista</th><th class="n">Scansioni 30 gg</th><th>QR</th><th></th></tr></thead><tbody id="tb">
    ${shown.map((m) => {
      const langs = m.langs.map((l) => l.toUpperCase()).join(' ');
      return `<tr><td><b>${esc(m.name)}</b>${m.active ? '' : ' <span class="warn">(disattivo)</span>'}<br><span class="mute">/p/${esc(m.city_slug)}/${esc(m.slug)}</span></td>
      <td>${esc(m.category || '—')}</td><td>${langs ? esc(langs) : '<span class="warn">nessuna</span>'}</td><td class="n">${mmss(m.audio_duration_sec)}</td><td class="n">${num(m.scans)}</td>
      <td><a href="/admin/qr/${esc(m.city_slug)}/${esc(m.slug)}.svg" target="_blank">SVG</a> · <a href="/p/${esc(m.city_slug)}/${esc(m.slug)}" target="_blank">prova</a></td>
      <td><a class="btn small ghost" href="/admin/monuments/${m.id}">Testi e dati</a></td></tr>`;
    }).join('')}</tbody></table></div>
    <div class="card"><b>Foglio QR da stampare</b>
      <form method="get" action="/admin/print" class="row" style="margin-top:10px">
        <label>Origine (opzionale)<select name="s"><option value="">— nessuna —</option>${partners.map((p) => `<option value="${esc(p.code)}">${esc(p.name)}</option>`).join('')}</select></label>
        <button>Apri foglio A4 con tutti i QR</button>
      </form>
      <p class="mute">Il QR punta a ${esc(BASE)}/p/città/sito. Se scegli un'origine, le scansioni vengono contate anche per quel partner. <b>Prima di stampare imposta BASE_URL con il tuo dominio HTTPS definitivo e controlla gli indirizzi: un QR stampato non si corregge.</b></p>
      ${/localhost|\.vercel\.app|\.onrender\.com/.test(BASE) ? '<p class="warn">Indirizzo provvisorio: un QR stampato non si corregge.</p>' : ''}</div>`, { nav: 'mon' });
}

async function monumentEditPage(id, msg = '') {
  const m = await one('SELECT * FROM monuments WHERE id = ?', [id]);
  if (!m) return null;
  const texts = Object.fromEntries((await q('SELECT * FROM monument_texts WHERE monument_id = ?', [id])).map((t) => [t.lang, t]));
  return layout(m.name, `
    <p><a href="/admin/monuments">← Monumenti</a></p><h1>${esc(m.name)}</h1><p class="mute">Indirizzo del QR: ${esc(BASE)}/p/${esc(m.city_slug)}/${esc(m.slug)} (fisso: non si modifica per non invalidare i QR stampati)${m.category ? ` · ${esc(m.category)}` : ''}${m.address ? ` · ${esc(m.address)}` : ''}${m.audio_duration_sec ? ` · durata prevista ${Math.floor(m.audio_duration_sec / 60)}:${String(m.audio_duration_sec % 60).padStart(2, '0')}` : ''}</p>${msg ? `<p class="ok">${esc(msg)}</p>` : ''}
    <form method="post" action="/admin/monuments/${m.id}">
      <div class="card"><div class="grid">
        <label>Nome<input name="name" value="${esc(m.name)}" required></label>
        <label>Comune<input name="comune" value="${esc(m.comune)}" required></label>
        <label>Coordinate<input name="coords" value="${m.lat}, ${m.lng}" required></label>
        <label>Attivo<select name="active"><option value="1" ${m.active ? 'selected' : ''}>Sì</option><option value="0" ${m.active ? '' : 'selected'}>No</option></select></label>
      </div></div>
      ${LANGS.map((l) => `<div class="card"><b>${LANG_NAMES[l]}</b>
        <label>Titolo<input name="title_${l}" value="${esc(texts[l]?.title || '')}"></label>
        <label>Testo dell'audio-guida<textarea name="body_${l}">${esc(texts[l]?.body || '')}</textarea></label>
        <label>Link a un file audio (opzionale; se vuoto la voce è sintetizzata dal telefono)<input name="audio_${l}" value="${esc(texts[l]?.audio_url || '')}" placeholder="https://…/audio.mp3"></label></div>`).join('')}
      <button>Salva</button>
    </form>`, { nav: 'mon' });
}

// --- Partner e link Comune ---
async function partnersPage() {
  const partners = await q(`SELECT p.*, COUNT(b.id) n, COALESCE(SUM(b.price_eur), 0) eur
    FROM partners p LEFT JOIN businesses b ON b.partner_id = p.id AND b.active = 1 GROUP BY p.id ORDER BY p.name`);
  const link = `${BASE}/report/${await reportToken()}`;
  return layout('Partner e Comune', `
    <h1>Report per il Comune</h1>
    <div class="card"><p>Link in sola lettura con dati aggregati e anonimi (nessun dato dei locali, nessun dato personale):</p>
      <p><input readonly value="${esc(link)}" onclick="this.select()"></p>
      <p><a class="btn small" href="${esc(link)}" target="_blank">Apri il report</a>
      <form method="post" action="/admin/report-token/regenerate" style="display:inline" onsubmit="return confirm('Il vecchio link smetterà di funzionare. Continuare?')"><button class="small ghost">Genera nuovo link</button></form></p></div>
    <h1>Partner (associazioni di categoria)</h1>
    <div class="card"><form class="row" method="post" action="/admin/partners">
      <label>Nome<input name="name" required></label>
      <label>Codice breve (lettere, numeri, trattino)<input name="code" pattern="[a-z0-9-]{2,30}" required></label>
      <label>Quota sugli abbonamenti (%)<input name="commission_pct" type="number" min="0" max="100" value="0"></label>
      <button>Aggiungi</button></form></div>
    <div class="card overflow"><table><tr><th>Partner</th><th>Codice</th><th class="n">Locali attivi</th><th class="n">Abbonamenti €/anno</th><th class="n">Quota %</th><th class="n">Da riconoscere €</th></tr>
    ${partners.map((p) => `<tr><td>${esc(p.name)}</td><td>${esc(p.code)}</td><td class="n">${p.n}</td><td class="n">${num(p.eur)}</td><td class="n">${p.commission_pct}</td><td class="n">${num(Math.round((p.eur * p.commission_pct) / 100))}</td></tr>`).join('')}</table>
    <p class="mute">I locali vengono assegnati a un partner dalla pagina Vetrina.</p></div>`, { nav: 'par' });
}

// --- Report Comune (pubblico con token) ---
async function reportPage(url) {
  const d = rangeDays(url);
  const token = url.pathname.split('/')[2].replace(/\.csv$/, '');
  const st = await stats(d);
  return layout('Report visitatori', `
    <h1>Report visitatori – audio-guida QR</h1>
    <p class="mute">Dati aggregati e anonimi. Periodo: ultimi ${d} giorni (aggiornato al ${today()}).</p>${rangeSwitch(`/report/${token}`, d)}
    <div class="grid">
      <div class="kpi"><b>${num(st.tot.scans)}</b>Scansioni QR</div>
      <div class="kpi"><b>${num(st.tot.uniq)}</b>Visitatori (unici al giorno)</div>
      <div class="kpi"><b>${num(st.tot.audio)}</b>Ascolti avviati</div>
    </div>
    <h2>Scansioni per giorno</h2><div class="card">${barChart(dailySeries(st.perDay, d))}</div>
    <h2>Per monumento</h2><div class="card overflow"><table><tr><th>Monumento</th><th>Comune</th><th class="n">Scansioni</th><th class="n">Visitatori</th><th class="n">Ascolti</th></tr>
    ${st.perMon.map((m) => `<tr><td>${esc(m.name)}</td><td>${esc(m.comune)}</td><td class="n">${num(m.scans)}</td><td class="n">${num(m.uniq)}</td><td class="n">${num(m.audio)}</td></tr>`).join('')}</table></div>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">
      <div><h2>Per comune</h2><div class="card"><table><tr><th>Comune</th><th class="n">Scansioni</th></tr>${st.perComune.map((c) => `<tr><td>${esc(c.comune)}</td><td class="n">${num(c.n)}</td></tr>`).join('')}</table></div></div>
      <div><h2>Lingua dei visitatori</h2><div class="card">${langTable(st.perLang)}</div></div>
    </div>
    <p class="noprint"><a class="btn" href="/report/${token}.csv?d=${d}">Scarica CSV</a> <button class="ghost" onclick="print()">Stampa / PDF</button></p>
    <p class="mute">Il "visitatore unico" è calcolato con un codice anonimo che cambia ogni giorno: non sono salvati indirizzi IP né dati personali, e lo stesso visitatore in giorni diversi viene contato più volte.</p>`, { wide: true });
}

async function reportCsv(url) {
  const d = rangeDays(url);
  const rows = await q(`SELECT ${DAY_SQL('e.ts')} giorno, m.name monumento, m.comune, COALESCE(e.lang, '') lingua,
      COUNT(*) FILTER (WHERE e.type = 'scan') scansioni,
      COUNT(DISTINCT CASE WHEN e.type = 'scan' THEN e.visitor END) visitatori,
      COUNT(*) FILTER (WHERE e.type = 'audio') ascolti
    FROM events e JOIN monuments m ON m.id = e.monument_id
    WHERE e.type IN ('scan','audio') AND e.ts >= now() - make_interval(days => ?)
    GROUP BY 1, m.id, 4 ORDER BY 1, 2`, [d]);
  const qt = (v) => `"${String(v).replace(/"/g, '""')}"`;
  return ['giorno,monumento,comune,lingua,scansioni,visitatori,ascolti', ...rows.map((r) => [r.giorno, qt(r.monumento), qt(r.comune), r.lingua, r.scansioni, r.visitatori, r.ascolti].join(','))].join('\n');
}

// --- Pagina del singolo locale ---
async function businessViewPage(token, url) {
  const b = await one('SELECT * FROM businesses WHERE token = ?', [token]);
  if (!b) return null;
  const d = rangeDays(url);
  const t = await one(`SELECT COUNT(*) FILTER (WHERE type = 'impression') imps, COUNT(*) FILTER (WHERE type = 'call') calls,
      COUNT(*) FILTER (WHERE type = 'map') maps, COUNT(*) FILTER (WHERE type = 'web') webs
    FROM events WHERE business_id = ? AND ts >= now() - make_interval(days => ?)`, [b.id, d]);
  const perDay = await q(`SELECT ${DAY_SQL('ts')} AS day, COUNT(*) n FROM events WHERE business_id = ? AND type IN ('call','map','web') AND ts >= now() - make_interval(days => ?) GROUP BY 1`, [b.id, d]);
  const clicks = t.calls + t.maps + t.webs;
  return layout(b.name, `
    <h1>${esc(b.name)}</h1><p class="mute">Risultati della tua presenza in vetrina. ${b.paid_until ? `Valida fino al ${esc(b.paid_until)}.` : ''}</p>${rangeSwitch(`/v/${token}`, d)}
    <div class="grid">
      <div class="kpi"><b>${num(t.imps)}</b>Volte mostrato ai turisti</div>
      <div class="kpi"><b>${num(clicks)}</b>Click totali (${t.imps ? ((100 * clicks) / t.imps).toFixed(1) : '0.0'}%)</div>
      <div class="kpi"><b>${num(t.calls)}</b>Chiamate</div>
      <div class="kpi"><b>${num(t.maps)}</b>Indicazioni stradali</div>
      <div class="kpi"><b>${num(t.webs)}</b>Visite al sito</div>
    </div>
    <h2>Click per giorno</h2><div class="card">${barChart(dailySeries(perDay, d), 'Click')}</div>`, { wide: false });
}

// ---------- router ----------
async function serveStatic(res, file) {
  try {
    const p = normalize(join(PUBLIC_DIR, file));
    if (!p.startsWith(PUBLIC_DIR)) return send(res, 403, 'Vietato', 'text/plain');
    const buf = await readFile(p);
    send(res, 200, buf, MIME[extname(p)] || 'application/octet-stream', { 'cache-control': file === '/sw.js' ? 'no-cache' : 'public, max-age=300' });
  } catch { send(res, 404, layout('Non trovato', '<h1>Pagina non trovata</h1>', { wide: false })); }
}

const loginPage = (err = '') => layout('Accesso', `<h1>Area admin</h1>${err ? `<p class="warn">${esc(err)}</p>` : ''}
  <form method="post" action="/admin/login" class="card"><label>Password<input type="password" name="password" autofocus required></label><p><button>Entra</button></p></form>`, { wide: false });

async function route(req, res) {
  const url = new URL(req.url, BASE);
  const p = url.pathname, method = req.method;
  let m;

  // stato del servizio (nessun dato sensibile)
  if (method === 'GET' && p === '/api/health') {
    try { await one('SELECT 1 AS ok'); return json(res, 200, { ok: true }); } catch (e) { console.error(e); return json(res, 503, { ok: false }); }
  }

  // pubblico
  if (method === 'GET' && (m = p.match(/^\/api\/p\/([a-z0-9-]+)\/([a-z0-9-]+)$/))) {
    const lang = LANGS.includes(url.searchParams.get('lang')) ? url.searchParams.get('lang') : 'en';
    const data = await monumentPayload(m[1], m[2], lang, parseFloat(url.searchParams.get('lat')), parseFloat(url.searchParams.get('lng')));
    return data ? json(res, 200, data) : json(res, 404, { error: 'non trovato' });
  }
  if (method === 'POST' && p === '/api/track') return handleTrack(req, res);
  if (method === 'GET' && /^\/p\/[a-z0-9-]+\/[a-z0-9-]+$/.test(p)) return serveStatic(res, '/m.html');
  // vecchio indirizzo /m/<sito> → /p/palermo/<sito>
  if (method === 'GET' && (m = p.match(/^\/m\/([a-z0-9-]+)$/))) return redirect(res, `/p/palermo/${m[1]}${url.search}`);
  if (method === 'GET' && (m = p.match(/^\/report\/([a-f0-9]+)(\.csv)?$/))) {
    if (m[1] !== (await reportToken())) return send(res, 404, layout('Non trovato', '<h1>Link non valido</h1>', { wide: false }));
    return m[2] ? send(res, 200, await reportCsv(url), 'text/csv; charset=utf-8', { 'content-disposition': 'attachment; filename="report-visitatori.csv"' }) : send(res, 200, await reportPage(url));
  }
  if (method === 'GET' && (m = p.match(/^\/v\/([a-f0-9]+)$/))) {
    const html = await businessViewPage(m[1], url);
    return html ? send(res, 200, html) : send(res, 404, layout('Non trovato', '<h1>Link non valido</h1>', { wide: false }));
  }

  // admin
  if (p === '/admin' || p.startsWith('/admin/')) {
    if (ON_SERVER && INSECURE) {
      return send(res, 503, layout('Configurazione', '<h1>Area admin bloccata</h1><p>Imposta le variabili d\'ambiente <code>ADMIN_PASSWORD</code> e <code>SECRET</code> del progetto e ripubblica.</p>', { wide: false }));
    }
  }
  if (p === '/admin/login') {
    if (method === 'GET') return send(res, 200, loginPage());
    const f = parseForm(await readBody(req));
    const a = Buffer.from(String(f.password || '')), b = Buffer.from(ADMIN_PASSWORD);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      return redirect(res, '/admin', { 'set-cookie': `adm=${adminToken()}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${BASE.startsWith('https') ? '; Secure' : ''}` });
    }
    return send(res, 401, loginPage('Password errata'));
  }
  if (p === '/admin/logout') return redirect(res, '/admin/login', { 'set-cookie': 'adm=; Path=/; Max-Age=0' });
  if (p === '/admin' || p.startsWith('/admin/')) {
    if (!isAdmin(req)) return redirect(res, '/admin/login');

    if (method === 'GET' && p === '/admin') return send(res, 200, await dashboardPage(url));
    if (method === 'GET' && p === '/admin/businesses') return send(res, 200, await businessesPage());
    if (method === 'GET' && p === '/admin/monuments') return send(res, 200, await monumentsPage(url));
    if (method === 'GET' && p === '/admin/partners') return send(res, 200, await partnersPage());
    if (method === 'GET' && p === '/admin/setup') return send(res, 200, await setupPage());
    if (method === 'GET' && (m = p.match(/^\/admin\/monuments\/(\d+)$/))) {
      const html = await monumentEditPage(Number(m[1]), url.searchParams.get('ok') ? 'Salvato.' : '');
      return html ? send(res, 200, html) : send(res, 404, 'Non trovato', 'text/plain');
    }
    if (method === 'GET' && (m = p.match(/^\/admin\/qr\/([a-z0-9-]+)\/([a-z0-9-]+)\.svg$/))) {
      const svg = await QRCode.toString(`${BASE}/p/${m[1]}/${m[2]}`, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' });
      return send(res, 200, svg, 'image/svg+xml');
    }
    if (method === 'GET' && p === '/admin/print') {
      const s = /^[a-z0-9-]{1,30}$/.test(url.searchParams.get('s') || '') ? url.searchParams.get('s') : '';
      const mons = await q('SELECT city_slug, slug, name FROM monuments WHERE active = 1 ORDER BY city_slug, name');
      const cells = await Promise.all(mons.map(async (mo) => {
        const link = `${BASE}/p/${mo.city_slug}/${mo.slug}${s ? `?s=${s}` : ''}`;
        const svg = await QRCode.toString(link, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
        return `<div class="qrcell">${svg}<b>${esc(mo.name)}</b><span class="mute">Scansiona per l'audio-guida · Scan for the audio guide</span></div>`;
      }));
      const warn = /localhost|\.vercel\.app|\.onrender\.com/.test(BASE) ? '<p class="warn">Indirizzo provvisorio: un QR stampato non si corregge. Collega il dominio definitivo e imposta BASE_URL prima di stampare.</p>' : '';
      return send(res, 200, layout('Foglio QR', `<p class="noprint"><a href="/admin/monuments">← Indietro</a> <button onclick="print()">Stampa</button></p>${warn}<div class="qrgrid">${cells.join('')}</div>`, { nav: 'mon', wide: false }));
    }

    if (method === 'POST') {
      const f = parseForm(await readBody(req));
      if (p === '/admin/businesses') {
        const c = parseCoords(f.coords);
        if (!f.name || !c) return send(res, 400, layout('Errore', '<p class="warn">Nome e coordinate valide sono obbligatori.</p><p><a href="/admin/businesses">Indietro</a></p>', { nav: 'biz' }));
        const tier = TIERS[f.tier] ? f.tier : 'base';
        await q(`INSERT INTO businesses (name, category, address, lat, lng, phone, website, description, tier, price_eur, paid_until, partner_id, token)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [f.name.trim(), (f.category || 'Ristorante').trim(), f.address || null, c.lat, c.lng, f.phone || null,
          /^https?:\/\//.test(f.website || '') ? f.website : null, f.description || null, tier, Number(f.price_eur) || TIERS[tier].price, f.paid_until || null, f.partner_id ? Number(f.partner_id) : null, newToken()]);
        return redirect(res, '/admin/businesses');
      }
      if ((m = p.match(/^\/admin\/businesses\/(\d+)$/))) {
        const tier = TIERS[f.tier] ? f.tier : 'base';
        await q('UPDATE businesses SET tier = ?, price_eur = ?, paid_until = ?, active = ?, partner_id = ? WHERE id = ?',
          [tier, Number(f.price_eur) || 0, f.paid_until || null, f.active ? 1 : 0, f.partner_id ? Number(f.partner_id) : null, Number(m[1])]);
        return redirect(res, '/admin/businesses');
      }
      if (p === '/admin/monuments') {
        const c = parseCoords(f.coords);
        if (!f.name || !c) return send(res, 400, layout('Errore', '<p class="warn">Nome e coordinate valide sono obbligatori.</p><p><a href="/admin/monuments">Indietro</a></p>', { nav: 'mon' }));
        const comune = (f.comune || 'Palermo').trim(), city = slugify(comune) || 'palermo';
        let slug = slugify(f.name) || 'monumento', n = 2;
        while (await one('SELECT 1 AS x FROM monuments WHERE city_slug = ? AND slug = ?', [city, slug])) slug = `${slugify(f.name) || 'monumento'}-${n++}`;
        const row = await one('INSERT INTO monuments (city_slug, slug, name, comune, category, address, lat, lng) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id', [city, slug, f.name.trim(), comune, f.category || null, f.address || null, c.lat, c.lng]);
        return redirect(res, `/admin/monuments/${row.id}`);
      }
      if ((m = p.match(/^\/admin\/monuments\/(\d+)$/))) {
        const id = Number(m[1]), c = parseCoords(f.coords);
        if (!(await one('SELECT 1 AS x FROM monuments WHERE id = ?', [id]))) return send(res, 404, 'Monumento non trovato', 'text/plain');
        if (!c) return send(res, 400, 'Coordinate non valide', 'text/plain');
        await tx(async (t) => {
          await t.q('UPDATE monuments SET name = ?, comune = ?, lat = ?, lng = ?, active = ? WHERE id = ?', [f.name, f.comune, c.lat, c.lng, f.active === '0' ? 0 : 1, id]);
          for (const l of LANGS) {
            await t.q(`INSERT INTO monument_texts (monument_id, lang, title, body, audio_url) VALUES (?, ?, ?, ?, ?)
              ON CONFLICT (monument_id, lang) DO UPDATE SET title = EXCLUDED.title, body = EXCLUDED.body, audio_url = EXCLUDED.audio_url`,
            [id, l, f[`title_${l}`] || '', f[`body_${l}`] || '', /^https?:\/\//.test(f[`audio_${l}`] || '') ? f[`audio_${l}`] : null]);
          }
        });
        return redirect(res, `/admin/monuments/${id}?ok=1`);
      }
      if (p === '/admin/partners') {
        const code = slugify(f.code || '');
        if (!f.name || code.length < 2) return send(res, 400, 'Nome e codice obbligatori', 'text/plain');
        await q('INSERT INTO partners (code, name, type, commission_pct) VALUES (?, ?, ?, ?) ON CONFLICT (code) DO NOTHING', [code, f.name.trim(), 'association', Math.min(100, Math.max(0, Number(f.commission_pct) || 0))]);
        return redirect(res, '/admin/partners');
      }
      if (p === '/admin/testi') {
        const lines = [];
        await loadTexts({ log: (l) => lines.push(l) });
        return send(res, 200, layout('Caricamento testi', `<h1>Caricamento testi</h1><div class="card"><pre style="white-space:pre-wrap">${esc(lines.join('\n'))}</pre></div><p><a class="btn" href="/admin/monuments">Vai ai monumenti</a></p>`, { nav: 'mon' }));
      }
      if (p === '/admin/setup') {
        const lines = [];
        const log = (l) => lines.push(l);
        if (f.mode === 'demo') {
          await seedDemo({ log });
        } else if (f.mode === 'sites') {
          if ((await one('SELECT COUNT(*) n FROM monuments')).n > 0) log('Database già popolato: non ho cambiato nulla.');
          else {
            const r = await importMonumentsText(monumentiCsv);
            log(`Siti importati: ${r.inserted}${r.skipped.length ? `, saltati: ${r.skipped.length}` : ''}.`);
            await loadTexts({ log });
          }
        } else return send(res, 400, 'Richiesta non valida', 'text/plain');
        return send(res, 200, layout('Caricamento dati', `<h1>Caricamento dati</h1><div class="card"><pre style="white-space:pre-wrap">${esc(lines.join('\n'))}</pre></div><p><a class="btn" href="/admin">Vai alla dashboard</a></p>`, { nav: 'dash' }));
      }
      if (p === '/admin/report-token/regenerate') { await setSetting('report_token', newToken(16)); return redirect(res, '/admin/partners'); }
    }
    return send(res, 404, layout('Non trovato', '<h1>Pagina non trovata</h1>', { nav: 'dash' }));
  }

  // file statici
  if (method === 'GET') return serveStatic(res, p === '/' ? '/index.html' : p);
  send(res, 405, 'Metodo non consentito', 'text/plain');
}

http.createServer((req, res) => {
  route(req, res).catch((e) => {
    console.error(e);
    if (!res.headersSent) send(res, 500, layout('Errore', '<h1>Errore interno</h1>', { wide: false }));
  });
}).listen(PORT, () => console.log(`Server su ${BASE}  (admin: ${BASE}/admin)`));
