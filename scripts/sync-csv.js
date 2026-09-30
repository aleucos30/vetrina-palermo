// Rigenera monumenti-data.js a partire da monumenti.csv.
// Serve perché il pulsante "Carica dati" dell'admin (che gira su Vercel) non legge file dal disco:
// usa questa copia incorporata nel codice. Uso: npm run sync-csv
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const csv = readFileSync(fileURLToPath(new URL('monumenti.csv', root)), 'utf8');
const header = [
  '// Copia del file monumenti.csv incorporata nel codice, così il pulsante "Carica dati" dell\'admin funziona anche su Vercel.',
  '// File generato: se modifichi monumenti.csv, rigeneralo con  npm run sync-csv',
  '',
].join('\n');
writeFileSync(fileURLToPath(new URL('monumenti-data.js', root)), `${header}export default ${JSON.stringify(csv)};\n`);
console.log(`monumenti-data.js aggiornato (${csv.trim().split(/\r?\n/).length - 1} siti).`);
