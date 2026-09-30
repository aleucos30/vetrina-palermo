// Carica i testi di testi-data.js nel database.
// Per sicurezza non sovrascrive mai un testo già scritto: inserisce solo le lingue che mancano o hanno il corpo vuoto.
import { q, tx } from './db.js';
import testi from './testi-data.js';

export const TEXT_SITES = Object.keys(testi).length;

export async function loadTexts({ log = console.log } = {}) {
  const mons = await q('SELECT id, slug FROM monuments');
  const out = { inserted: 0, kept: 0, sites: 0, missingSites: [] };
  await tx(async (t) => {
    for (const m of mons) {
      const tt = testi[m.slug];
      if (!tt) continue;
      out.sites++;
      for (const [lang, [title, body]] of Object.entries(tt)) {
        const r = await t.q(
          `INSERT INTO monument_texts (monument_id, lang, title, body) VALUES (?, ?, ?, ?)
           ON CONFLICT (monument_id, lang) DO UPDATE SET title = EXCLUDED.title, body = EXCLUDED.body
           WHERE monument_texts.body IS NULL OR monument_texts.body = ''
           RETURNING 1 AS ok`, [m.id, lang, title, body]);
        if (r.length) out.inserted++; else out.kept++;
      }
    }
  });
  for (const s of Object.keys(testi)) if (!mons.some((m) => m.slug === s)) out.missingSites.push(s);
  log(`Testi caricati: ${out.inserted} (${out.sites} siti); già presenti e lasciati come sono: ${out.kept}.`);
  if (out.missingSites.length) log(`Siti con testo ma non nel database: ${out.missingSites.join(', ')}`);
  return out;
}
