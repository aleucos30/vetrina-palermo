// Dati di esempio: i 50 siti arrivano da monumenti.csv; i testi stanno in testi/*.txt (partner: solo associazioni di categoria; MSC non è incluso). I testi sono BOZZE da riscrivere e verificare prima del lancio.
// I locali sono finti (prefisso "DEMO"): sostituiscili con quelli reali dall'area admin.
import { fileURLToPath } from 'node:url';
import { q, one, tx, newToken, reportToken, closeDb, usingLocalDb } from './db.js';
import { importMonumentsText } from './import.js';
import monumentiCsv from './monumenti-data.js';
import { loadTexts } from './texts.js';

// Carica i dati di esempio. Usata da "npm run seed" e dal pulsante "Carica dati" dell'admin.
export async function seedDemo({ reset = false, log = console.log } = {}) {
if (reset) await q('TRUNCATE events, businesses, monument_texts, monuments, partners, settings RESTART IDENTITY CASCADE');
if ((await one('SELECT COUNT(*) n FROM monuments')).n > 0) {
  log('Database già popolato: non ho cambiato nulla.');
  return { skipped: true };
}

// --- Partner ---
await q('INSERT INTO partners (code, name, type, commission_pct) VALUES (?, ?, ?, ?), (?, ?, ?, ?)',
  ['assoc-a', 'Associazione di categoria A (esempio)', 'association', 10, 'assoc-b', 'Associazione di categoria B (esempio)', 'association', 10]);
const pid = Object.fromEntries((await q('SELECT code, id FROM partners')).map((p) => [p.code, p.id]));

// --- Monumenti e testi (i testi veri stanno in testi/*.txt) ---
const imp = await importMonumentsText(monumentiCsv);
log(`Siti importati dal CSV: ${imp.inserted}` + (imp.skipped.length ? `, saltati: ${imp.skipped.length}` : ''));
await loadTexts({ log });

// --- Locali DEMO in vetrina ---
const nextYear = new Date(Date.now() + 365 * 864e5).toISOString().slice(0, 10);
const demo = [
  ['DEMO Trattoria della Cattedrale', 'Ristorante', 'Via Vittorio Emanuele (demo)', 38.1138, 13.3570, '+390910000001', '', 'Cucina siciliana di casa, pranzo e cena.', 'plus', 500, 'assoc-a'],
  ['DEMO Caffè Cassaro', 'Bar', 'Via Vittorio Emanuele (demo)', 38.1144, 13.3580, '+390910000002', '', 'Colazione, cannoli e caffè.', 'base', 300, 'assoc-a'],
  ['DEMO Osteria Quattro Canti', 'Ristorante', 'Via Maqueda (demo)', 38.1155, 13.3612, '+390910000003', '', 'Pesce fresco e menù turistico in più lingue.', 'plus', 500, 'assoc-b'],
  ['DEMO Bar Maqueda', 'Bar', 'Via Maqueda (demo)', 38.1160, 13.3608, '+390910000004', '', 'Aperitivo e street food.', 'base', 300, 'assoc-b'],
  ['DEMO Pasticceria Teatro', 'Pasticceria', 'Via Maqueda (demo)', 38.1203, 13.3568, '+390910000005', '', 'Dolci siciliani, cassata e gelato.', 'base', 300, null],
  ['DEMO Ristorante Normanni', 'Ristorante', 'Corso Re Ruggero (demo)', 38.1110, 13.3540, '+390910000006', '', 'Menù degustazione dopo la visita.', 'plus', 500, null],
];
for (const [n, c, a, lat, lng, ph, web, d, tier, price, partner] of demo) {
  await q(`INSERT INTO businesses (name, category, address, lat, lng, phone, website, description, tier, price_eur, paid_until, partner_id, token)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [n, c, a, lat, lng, ph, web, d, tier, price, nextYear, partner ? pid[partner] : null, newToken()]);
}

// Eventi di esempio degli ultimi 30 giorni, per vedere subito dashboard e report.
const mons = await q('SELECT id, slug FROM monuments');
const bizs = await q('SELECT id FROM businesses');
const langs = ['it', 'en', 'en', 'fr', 'de', 'es', 'en', 'it'];
const weight = { cattedrale: 5, 'quattro-canti': 6, 'teatro-massimo': 3, 'cappella-palatina': 4 };
let seed = 42;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const evs = [];
for (let d = 29; d >= 0; d--) {
  const day = new Date(Date.now() - d * 864e5).toISOString().slice(0, 10);
  for (const m of mons) {
    const n = Math.round((weight[m.slug] ?? 0.3) * (2 + rnd() * 6));
    for (let i = 0; i < n; i++) {
      const ts = `${day} ${String(8 + Math.floor(rnd() * 12)).padStart(2, '0')}:${String(Math.floor(rnd() * 60)).padStart(2, '0')}:00+00`;
      const lang = langs[Math.floor(rnd() * langs.length)];
      const visitor = `v${day}${m.id}${i}`;
      evs.push([ts, 'scan', m.id, null, lang, null, visitor]);
      if (rnd() < 0.6) evs.push([ts, 'audio', m.id, null, lang, null, visitor]);
      for (let k = 0; k < 3; k++) {
        const b = bizs[Math.floor(rnd() * bizs.length)].id;
        evs.push([ts, 'impression', m.id, b, lang, null, visitor]);
        if (rnd() < 0.08) evs.push([ts, ['call', 'map', 'web'][Math.floor(rnd() * 3)], m.id, b, lang, null, visitor]);
      }
    }
  }
}
// inserimento a blocchi da 2000 righe (una sola richiesta per blocco)
await tx(async (t) => {
  for (let i = 0; i < evs.length; i += 2000) {
    const chunk = evs.slice(i, i + 2000);
    await t.q(`INSERT INTO events (ts, type, monument_id, business_id, lang, source, visitor) VALUES ${chunk.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(',')}`, chunk.flat());
  }
});
log(`Eventi di esempio: ${evs.length}`);

log('Seed completato.');
log('Link Comune (sola lettura): /report/' + (await reportToken()));
return { skipped: false, sites: imp.inserted, events: evs.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(usingLocalDb ? 'Database: locale (PGlite)' : 'Database: online (DATABASE_URL)');
  await seedDemo({ reset: process.argv.includes('--reset') });
  await closeDb();
  process.exit(0);
}
