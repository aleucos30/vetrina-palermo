// Legge testi/*.txt e rigenera testi-data.js (copia incorporata nel codice, usata dal pulsante "Carica testi" dell'admin).
// Formato dei file:  @@ slug  /  ## lingua (it, en, fr, de, es)  /  prima riga = titolo, il resto = testo (paragrafi separati da riga vuota).
// Uso: npm run sync-testi
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const dir = fileURLToPath(new URL('testi/', root));
const LANGS = ['it', 'en', 'fr', 'de', 'es'];
const data = {};
const problems = [];

for (const f of readdirSync(dir).filter((x) => x.endsWith('.txt')).sort()) {
  let slug = null, lang = null, lines = [];
  const flush = () => {
    if (slug && lang) {
      const [title, ...rest] = lines;
      const body = rest.join('\n').trim();
      if (!title?.trim() || !body) problems.push(`${f}: ${slug}/${lang} vuoto`);
      else (data[slug] ||= {})[lang] = [title.trim(), body];
    }
    lines = [];
  };
  for (const raw of readFileSync(dir + f, 'utf8').split(/\r?\n/)) {
    const line = raw.trimEnd();
    let m;
    if ((m = line.match(/^@@\s+([a-z0-9-]+)\s*$/))) { flush(); slug = m[1]; lang = null; }
    else if ((m = line.match(/^##\s+([a-z]{2})\s*$/))) {
      flush(); lang = m[1];
      if (!LANGS.includes(lang)) problems.push(`${f}: lingua sconosciuta ${lang} (${slug})`);
    } else if (lang) lines.push(line);
  }
  flush();
}

const csv = readFileSync(fileURLToPath(new URL('monumenti.csv', root)), 'utf8').trim().split(/\r?\n/).slice(1).map((l) => l.split(',')[2]);
for (const s of csv) {
  if (!data[s]) problems.push(`nessun testo per il sito ${s}`);
  else for (const l of ['it', 'en', 'fr', 'de']) if (!data[s][l]) problems.push(`${s}: manca la lingua ${l}`);
}
for (const s of Object.keys(data)) if (!csv.includes(s)) problems.push(`slug non presente nel CSV: ${s}`);

if (problems.length) { console.error('Problemi nei testi:\n - ' + problems.join('\n - ')); process.exit(1); }
const header = '// Copia dei file testi/*.txt incorporata nel codice. File generato: dopo aver modificato testi/, rigeneralo con  npm run sync-testi\n\n';
writeFileSync(fileURLToPath(new URL('testi-data.js', root)), `${header}export default ${JSON.stringify(data)};\n`);
console.log(`testi-data.js aggiornato: ${Object.keys(data).length} siti.`);
