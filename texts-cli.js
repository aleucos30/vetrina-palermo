// Uso: npm run testi   (carica i testi nel database locale o in quello di DATABASE_URL, senza sovrascrivere testi già scritti)
import { closeDb, usingLocalDb } from './db.js';
import { loadTexts } from './texts.js';
console.log(usingLocalDb ? 'Database: locale (PGlite)' : 'Database: online (DATABASE_URL)');
await loadTexts();
await closeDb();
process.exit(0);
