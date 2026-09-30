// Dati di esempio: i 50 siti arrivano da monumenti.csv; solo 4 hanno testi demo (partner: solo associazioni di categoria; MSC non è incluso). I testi sono BOZZE da riscrivere e verificare prima del lancio.
// I locali sono finti (prefisso "DEMO"): sostituiscili con quelli reali dall'area admin.
import { q, one, tx, newToken, reportToken, closeDb, usingLocalDb } from './db.js';
import { importMonuments } from './import.js';

console.log(usingLocalDb ? 'Database: locale (PGlite)' : 'Database: online (DATABASE_URL)');
const reset = process.argv.includes('--reset');
if (reset) await q('TRUNCATE events, businesses, monument_texts, monuments, partners, settings RESTART IDENTITY CASCADE');
if ((await one('SELECT COUNT(*) n FROM monuments')).n > 0) {
  console.log('Database già popolato. Usa "npm run seed:reset" per ripartire da zero.');
  await closeDb();
  process.exit(0);
}

// --- Partner ---
await q('INSERT INTO partners (code, name, type, commission_pct) VALUES (?, ?, ?, ?), (?, ?, ?, ?)',
  ['assoc-a', 'Associazione di categoria A (esempio)', 'association', 10, 'assoc-b', 'Associazione di categoria B (esempio)', 'association', 10]);
const pid = Object.fromEntries((await q('SELECT code, id FROM partners')).map((p) => [p.code, p.id]));

// --- Monumenti ---
const monuments = [
  {
    slug: 'cattedrale',
    t: {
      it: ['Cattedrale di Palermo', 'La Cattedrale nasce alla fine del XII secolo e nei secoli ha accolto stili diversi: normanno, gotico, rinascimentale e neoclassico. Al suo interno si trovano le tombe di sovrani, tra cui Federico II.'],
      en: ['Palermo Cathedral', 'The Cathedral was begun in the late 12th century and has absorbed many styles over time: Norman, Gothic, Renaissance and Neoclassical. Inside are the tombs of several rulers, including Frederick II.'],
      fr: ['Cathédrale de Palerme', 'La cathédrale a été commencée à la fin du XIIe siècle et a accueilli de nombreux styles : normand, gothique, Renaissance et néoclassique. Elle abrite les tombeaux de plusieurs souverains, dont Frédéric II.'],
      de: ['Kathedrale von Palermo', 'Die Kathedrale wurde Ende des 12. Jahrhunderts begonnen und vereint normannische, gotische, Renaissance- und klassizistische Elemente. Im Inneren befinden sich die Grabmäler mehrerer Herrscher, darunter Friedrich II.'],
      es: ['Catedral de Palermo', 'La catedral se empezó a finales del siglo XII y reúne estilos normando, gótico, renacentista y neoclásico. En su interior se encuentran las tumbas de varios soberanos, entre ellos Federico II.'],
    },
  },
  {
    slug: 'quattro-canti',
    t: {
      it: ['Quattro Canti', 'Piazza Vigliena, detta Quattro Canti, è il crocevia barocco della città. Le quattro facciate raccontano le stagioni, i re spagnoli e le sante patrone di Palermo.'],
      en: ['Quattro Canti', 'Piazza Vigliena, known as Quattro Canti, is the Baroque crossroads of the city. Its four façades show the seasons, Spanish kings and the patron saints of Palermo.'],
      fr: ['Quattro Canti', 'La place Vigliena, dite Quattro Canti, est le carrefour baroque de la ville. Ses quatre façades évoquent les saisons, les rois d’Espagne et les saintes patronnes de Palerme.'],
      de: ['Quattro Canti', 'Die Piazza Vigliena, genannt Quattro Canti, ist die barocke Kreuzung der Stadt. Die vier Fassaden zeigen die Jahreszeiten, spanische Könige und die Schutzheiligen Palermos.'],
      es: ['Quattro Canti', 'La plaza Vigliena, llamada Quattro Canti, es el cruce barroco de la ciudad. Sus cuatro fachadas representan las estaciones, los reyes españoles y las santas patronas de Palermo.'],
    },
  },
  {
    slug: 'teatro-massimo',
    t: {
      it: ['Teatro Massimo', 'Inaugurato nel 1897, il Teatro Massimo è uno dei più grandi teatri d’opera d’Europa. Fu progettato da Giovan Battista Filippo Basile e completato dal figlio Ernesto.'],
      en: ['Teatro Massimo', 'Opened in 1897, Teatro Massimo is one of the largest opera houses in Europe. It was designed by Giovan Battista Filippo Basile and completed by his son Ernesto.'],
      fr: ['Teatro Massimo', 'Inauguré en 1897, le Teatro Massimo est l’un des plus grands opéras d’Europe. Il a été conçu par Giovan Battista Filippo Basile et achevé par son fils Ernesto.'],
      de: ['Teatro Massimo', 'Das 1897 eröffnete Teatro Massimo gehört zu den größten Opernhäusern Europas. Es wurde von Giovan Battista Filippo Basile entworfen und von seinem Sohn Ernesto vollendet.'],
      es: ['Teatro Massimo', 'Inaugurado en 1897, el Teatro Massimo es uno de los mayores teatros de ópera de Europa. Fue proyectado por Giovan Battista Filippo Basile y terminado por su hijo Ernesto.'],
    },
  },
  {
    slug: 'cappella-palatina',
    t: {
      it: ['Palazzo dei Normanni', 'Antica residenza dei sovrani normanni, oggi sede dell’Assemblea Regionale Siciliana. La Cappella Palatina, del XII secolo, unisce mosaici bizantini, arte araba e architettura normanna.'],
      en: ['Norman Palace', 'Former residence of the Norman kings, today home to the Sicilian Regional Assembly. The 12th-century Palatine Chapel blends Byzantine mosaics, Arab art and Norman architecture.'],
      fr: ['Palais des Normands', 'Ancienne résidence des rois normands, aujourd’hui siège de l’Assemblée régionale sicilienne. La chapelle Palatine, du XIIe siècle, unit mosaïques byzantines, art arabe et architecture normande.'],
      de: ['Normannenpalast', 'Ehemalige Residenz der normannischen Könige, heute Sitz des Sizilianischen Regionalparlaments. Die Cappella Palatina aus dem 12. Jahrhundert verbindet byzantinische Mosaike, arabische Kunst und normannische Architektur.'],
      es: ['Palacio de los Normandos', 'Antigua residencia de los reyes normandos, hoy sede de la Asamblea Regional Siciliana. La Capilla Palatina, del siglo XII, une mosaicos bizantinos, arte árabe y arquitectura normanda.'],
    },
  },
];

const imp = await importMonuments(new URL('./monumenti.csv', import.meta.url).pathname);
console.log(`Siti importati dal CSV: ${imp.inserted}` + (imp.skipped.length ? `, saltati: ${imp.skipped.length}` : ''));
for (const m of monuments) {
  const row = await one('SELECT id FROM monuments WHERE city_slug = ? AND slug = ?', ['palermo', m.slug]);
  if (!row) continue;
  for (const [lang, [title, body]] of Object.entries(m.t)) {
    await q(`INSERT INTO monument_texts (monument_id, lang, title, body) VALUES (?, ?, ?, ?)
             ON CONFLICT (monument_id, lang) DO UPDATE SET title = EXCLUDED.title, body = EXCLUDED.body`, [row.id, lang, title, body]);
  }
}

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
// inserimento a blocchi da 500 righe (una sola richiesta per blocco)
await tx(async (t) => {
  for (let i = 0; i < evs.length; i += 500) {
    const chunk = evs.slice(i, i + 500);
    await t.q(`INSERT INTO events (ts, type, monument_id, business_id, lang, source, visitor) VALUES ${chunk.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(',')}`, chunk.flat());
  }
});
console.log(`Eventi di esempio: ${evs.length}`);

console.log('Seed completato.');
console.log('Link Comune (sola lettura): /report/' + (await reportToken()));
await closeDb();
process.exit(0);
