// Importa i siti (monumenti/targhe QR) da un CSV.
// Uso:  npm run import            (legge monumenti.csv)
//       npm run import -- altro.csv
// Senza DATABASE_URL scrive nel database locale; con DATABASE_URL (Neon) scrive online.
// Colonne richieste: city_slug, monument_slug, title, latitude, longitude
// Colonne opzionali: category, address, audio_duration_sec
// Si può rilanciare: i siti già presenti (stessa città + stesso slug) vengono aggiornati, i testi restano.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tx, closeDb, usingLocalDb } from './db.js';

export function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

const titleCase = (s) => s.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

export async function importMonuments(file) {
  return importMonumentsText(readFileSync(file, 'utf8'));
}

export async function importMonumentsText(text) {
  const rows = parseCsv(text);
  const head = rows.shift().map((h) => h.trim());
  const idx = Object.fromEntries(head.map((h, i) => [h, i]));
  for (const need of ['city_slug', 'monument_slug', 'title', 'latitude', 'longitude']) {
    if (!(need in idx)) throw new Error(`Colonna mancante nel CSV: ${need}`);
  }
  const get = (r, k) => (k in idx ? (r[idx[k]] ?? '').trim() : '');

  const out = { inserted: 0, updated: 0, skipped: [] };
  await tx(async (t) => {
    for (const [n, r] of rows.entries()) {
      const line = n + 2;
      const city = get(r, 'city_slug'), slug = get(r, 'monument_slug'), name = get(r, 'title');
      const lat = Number(get(r, 'latitude')), lng = Number(get(r, 'longitude'));
      const dur = get(r, 'audio_duration_sec') ? Number(get(r, 'audio_duration_sec')) : null;
      if (!/^[a-z0-9-]+$/.test(city) || !/^[a-z0-9-]+$/.test(slug)) { out.skipped.push(`riga ${line}: city_slug o monument_slug non valido (solo a-z, 0-9, trattino)`); continue; }
      if (!name) { out.skipped.push(`riga ${line} (${slug}): titolo mancante`); continue; }
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) { out.skipped.push(`riga ${line} (${slug}): coordinate non valide`); continue; }
      // il comune si imposta solo alla prima creazione; xmax = 0 significa "riga appena inserita"
      const res = await t.q(
        `INSERT INTO monuments (city_slug, slug, name, comune, category, address, audio_duration_sec, lat, lng)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (city_slug, slug) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, address = EXCLUDED.address,
           audio_duration_sec = EXCLUDED.audio_duration_sec, lat = EXCLUDED.lat, lng = EXCLUDED.lng
         RETURNING (xmax = 0) AS inserted`,
        [city, slug, name, titleCase(city), get(r, 'category') || null, get(r, 'address') || null, Number.isFinite(dur) ? dur : null, lat, lng],
      );
      if (res[0].inserted) out.inserted++; else out.updated++;
    }
  });
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2] || 'monumenti.csv';
  console.log(usingLocalDb ? 'Database: locale (PGlite)' : 'Database: online (DATABASE_URL)');
  const r = await importMonuments(file);
  console.log(`Import da ${file}: ${r.inserted} nuovi, ${r.updated} aggiornati, ${r.skipped.length} saltati.`);
  r.skipped.forEach((s) => console.log('  - ' + s));
  await closeDb();
  process.exit(0);
}
