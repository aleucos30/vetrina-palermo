// Accesso ai dati: Postgres.
//  - In produzione (Vercel + Neon): imposta DATABASE_URL (o POSTGRES_URL) e si usa il driver "pg".
//  - In locale, senza DATABASE_URL: parte un Postgres incorporato (PGlite) salvato in data/pglite.
// Il codice scrive le query con "?" e qui vengono convertite nei segnaposto $1, $2… di Postgres.
import crypto from 'node:crypto';
import { mkdirSync } from 'node:fs';

const DB_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';

const SCHEMA = `
-- Partner: associazioni di categoria. commission_pct = quota sugli abbonamenti dei locali portati.
CREATE TABLE IF NOT EXISTS partners (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'association',
  commission_pct INTEGER NOT NULL DEFAULT 0
);

-- Un sito = una targa QR. Indirizzo pubblico: /p/<city_slug>/<slug> (non cambiarlo dopo la stampa).
CREATE TABLE IF NOT EXISTS monuments (
  id SERIAL PRIMARY KEY,
  city_slug TEXT NOT NULL DEFAULT 'palermo',
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  comune TEXT NOT NULL DEFAULT 'Palermo',
  category TEXT,
  address TEXT,
  audio_duration_sec INTEGER,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (city_slug, slug)
);

CREATE TABLE IF NOT EXISTS monument_texts (
  monument_id INTEGER NOT NULL REFERENCES monuments(id) ON DELETE CASCADE,
  lang TEXT NOT NULL,
  title TEXT,
  body TEXT,
  audio_url TEXT,
  PRIMARY KEY (monument_id, lang)
);

CREATE TABLE IF NOT EXISTS businesses (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Ristorante',
  address TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  phone TEXT,
  website TEXT,
  description TEXT,
  tier TEXT NOT NULL DEFAULT 'base',
  price_eur INTEGER NOT NULL DEFAULT 300,
  paid_until TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  partner_id INTEGER REFERENCES partners(id) ON DELETE SET NULL,
  token TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS biz_geo ON businesses (lat, lng);

-- Eventi anonimi: nessun IP, nessun identificativo personale.
-- visitor = hash con sale giornaliero (non collegabile tra giorni diversi).
CREATE TABLE IF NOT EXISTS events (
  id BIGSERIAL PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  type TEXT NOT NULL,
  monument_id INTEGER,
  business_id INTEGER,
  lang TEXT,
  source TEXT,
  visitor TEXT
);
ALTER TABLE events ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS channel TEXT;
CREATE INDEX IF NOT EXISTS ev_ts ON events (ts);
CREATE INDEX IF NOT EXISTS ev_m ON events (monument_id, type, ts);
CREATE INDEX IF NOT EXISTS ev_b ON events (business_id, type, ts);

CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT);
`;

const conv = (text) => {
  let i = 0;
  return text.replace(/\?/g, () => `$${++i}`);
};

async function makePg() {
  const pg = (await import('pg')).default;
  pg.types.setTypeParser(20, Number); // COUNT / SUM (int8) → numero
  pg.types.setTypeParser(1700, Number); // numeric → numero
  const pool = new pg.Pool({
    connectionString: DB_URL,
    max: Number(process.env.PG_POOL_MAX || 3),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });
  pool.on('error', (e) => console.error('pg pool:', e.message));
  return {
    query: async (t, p = []) => (await pool.query(conv(t), p)).rows,
    tx: async (fn) => {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const r = await fn({ q: async (t, p = []) => (await c.query(conv(t), p)).rows });
        await c.query('COMMIT');
        return r;
      } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    },
    // il lucchetto evita che due istanze appena avviate creino le tabelle insieme
    migrate: async (sql) => {
      const c = await pool.connect();
      try {
        await c.query('SELECT pg_advisory_lock(727001)');
        await c.query(sql);
      } finally {
        await c.query('SELECT pg_advisory_unlock(727001)').catch(() => {});
        c.release();
      }
    },
    close: () => pool.end(),
  };
}

async function makeLocal() {
  const name = '@electric-sql/pglite'; // nome in variabile: non viene incluso nel pacchetto di produzione
  let PGlite;
  try {
    ({ PGlite } = await import(name));
  } catch {
    throw new Error('DATABASE_URL non impostato e PGlite non installato: imposta DATABASE_URL (Postgres/Neon) oppure esegui "npm install".');
  }
  mkdirSync('data', { recursive: true });
  const db = new PGlite(process.env.PGLITE_DIR || 'data/pglite');
  await db.waitReady;
  const norm = (rows) => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v])));
  return {
    query: async (t, p = []) => norm((await db.query(conv(t), p)).rows),
    tx: (fn) => db.transaction((t) => fn({ q: async (text, p = []) => norm((await t.query(conv(text), p)).rows) })),
    migrate: (sql) => db.exec(sql),
    close: () => db.close(),
  };
}

let implPromise;
function getImpl() {
  if (!implPromise) {
    implPromise = (async () => {
      const i = DB_URL ? await makePg() : await makeLocal();
      await i.migrate(SCHEMA);
      return i;
    })().catch((e) => {
      implPromise = undefined; // al prossimo accesso si riprova
      throw e;
    });
  }
  return implPromise;
}

export const usingLocalDb = !DB_URL;
export const q = async (text, params = []) => (await getImpl()).query(text, params);
export const one = async (text, params = []) => (await q(text, params))[0];
export const tx = async (fn) => (await getImpl()).tx(fn);
export const closeDb = async () => (implPromise ? (await implPromise).close() : undefined);

export function newToken(bytes = 12) {
  return crypto.randomBytes(bytes).toString('hex');
}

export async function setSetting(k, v) {
  await q('INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v', [k, v]);
}

// Token del link in sola lettura da dare al Comune.
export async function reportToken() {
  let r = await one('SELECT v FROM settings WHERE k = ?', ['report_token']);
  if (!r) {
    await q('INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT (k) DO NOTHING', ['report_token', newToken(16)]);
    r = await one('SELECT v FROM settings WHERE k = ?', ['report_token']);
  }
  return r.v;
}
