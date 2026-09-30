# Audio-guida Palermo – MVP

PWA turistica: il turista inquadra il QR sulla targa di un monumento, si apre la pagina (nessuna app da scaricare), ascolta l'audio-guida nella sua lingua e vede i ristoranti e bar vicini che pagano per stare in vetrina.

Cosa c'è dentro:

- **Pagina del sito** (`/p/<città>/<sito>`, per esempio `/p/palermo/cattedrale`): testo e audio in IT, EN, FR, DE, ES; vetrina "Vicino a te" ordinata per piano (Plus prima, poi Base) e distanza; pulsanti Chiama, Mappa, Sito; funziona offline per l'ultimo contenuto visto.
- **Dashboard admin** (`/admin`): scansioni, visitatori, ascolti e click per singolo QR; lingue; locali più cliccati; incasso annuo degli abbonamenti e scadenze.
- **Vetrina** (`/admin/businesses`): aggiungi locali, piano Base 300 € / Plus 500 €, data di scadenza, attivo/non attivo, associazione che lo ha portato.
- **Monumenti e QR** (`/admin/monuments`): crei monumenti, scrivi i testi per lingua, scarichi il QR in SVG o stampi un foglio A4 con tutti i QR.
- **Report per il Comune** (`/report/<codice>`): dati aggregati e anonimi, con CSV e stampa/PDF. Il link si trova in "Partner e Comune" e si può rigenerare.
- **Pagina per ogni locale** (`/v/<codice>`): il titolare vede quante volte è stato mostrato e quanti click ha ricevuto. È l'argomento per il rinnovo.

Stack: Node.js 22, Postgres, pagine servite senza framework. Il database è Postgres: online si usa Neon (o Supabase, o qualunque Postgres); in locale, senza configurare nulla, parte un Postgres incorporato (PGlite) in `data/`.

## Provarlo sul computer

Serve Node.js 22 o più recente.

```bash
npm install
npm run seed        # 50 siti di monumenti.csv + locali DEMO + 30 giorni di statistiche finte
ADMIN_PASSWORD="scegli-una-password" SECRET="una-frase-lunga-casuale" npm start
```

Apri `http://localhost:3000` (pagina demo: `/p/palermo/cattedrale`, admin: `/admin`).

## Pubblicarlo: GitHub + Vercel + Neon

### 1. GitHub

Crea un repository **privato** e caricaci la cartella. Il `.gitignore` esclude `node_modules/`, `data/` e i file `.env`.

```bash
git init
git add .
git commit -m "Primo invio"
git branch -M main
git remote add origin https://github.com/TUO-NOME/vetrina-palermo.git
git push -u origin main
```

Non scrivere mai password o chiavi nel codice: vanno solo nelle variabili d'ambiente di Vercel.

### 2. Vercel

1. Su [vercel.com](https://vercel.com) scegli **Add New → Project** e importa il repository. Non servono comandi di build: Vercel riconosce `server.js` e `vercel.json` (regione Francoforte, rewrite delle pagine `/p/…`).
2. Nel progetto apri **Storage** e collega un database **Neon (Postgres)** dal Marketplace. Scegli la regione **Frankfurt**, la stessa delle funzioni. L'integrazione aggiunge da sola la variabile `DATABASE_URL` (l'app accetta anche `POSTGRES_URL`).
3. In **Settings → Environment Variables** aggiungi:
   - `ADMIN_PASSWORD`: la tua password dell'area admin
   - `SECRET`: una frase lunga e casuale
   - `BASE_URL`: l'indirizzo pubblico con https (il dominio definitivo, appena lo hai)
4. Ripubblica (**Redeploy**). Le tabelle vengono create da sole alla prima richiesta.
5. Apri `/api/health`: deve rispondere `{"ok":true}`.

Se `ADMIN_PASSWORD` e `SECRET` non sono impostati, in produzione l'area admin resta bloccata (risposta 503) invece di accettare la password di default.

### 3. Caricare i dati

Il database online parte vuoto. Dal tuo computer, con l'indirizzo di connessione di Neon (lo trovi nel pannello Neon, scegli quello **pooled**):

```bash
# solo i 50 siti veri, senza locali finti
DATABASE_URL="postgresql://…" npm run import

# oppure, per una demo con locali DEMO e statistiche finte
DATABASE_URL="postgresql://…" npm run seed
```

`npm run import -- altro.csv` importa un altro file (per esempio un altro Comune). Si può rilanciare quando vuoi: i siti già presenti (stessa città + stesso `monument_slug`) vengono aggiornati e i testi già scritti restano. Colonne del CSV: `city_slug, monument_slug, title, latitude, longitude`, più `category, address, audio_duration_sec`.

### Piano Vercel

Il piano gratuito (Hobby) è limitato a uso personale non commerciale, secondo la [documentazione di Vercel](https://vercel.com/docs/plans/hobby): va bene per mostrare una demo, ma quando ci sono locali che pagano serve il piano Pro.

## Prima di stampare i QR

1. Collega il **dominio definitivo** al progetto Vercel (Settings → Domains) e imposta `BASE_URL` con quel dominio, poi ripubblica.
2. Nell'admin, "Monumenti e QR" e il foglio di stampa mostrano un avviso finché l'indirizzo è provvisorio (`localhost`, `.vercel.app`, `.onrender.com`). Controlla a mano un QR dal telefono.
3. **Un QR stampato con l'indirizzo sbagliato non si corregge.** Usa un dominio che terrai per anni. L'indirizzo di ogni sito è `/p/<città>/<sito>` e non va mai cambiato dopo la stampa.
4. Fai un backup del database (Neon ha il ripristino a un momento precedente; verifica nel tuo piano quanto indietro arriva).

## Privacy

Non sono salvati IP né dati personali. Il "visitatore" è un codice anonimo che cambia ogni giorno, quindi lo stesso turista in giorni diversi conta più volte. La posizione del telefono è usata solo se il turista preme "Usa la mia posizione", e non è memorizzata. Per la pubblicazione serve comunque una breve informativa privacy: fattela controllare.

## Da sapere

- I testi dei monumenti inclusi (Cattedrale, Quattro Canti, Teatro Massimo, Palazzo dei Normanni) sono **bozze** per la demo: riscrivili e verificali. La voce usa la sintesi vocale del telefono; se vuoi registrazioni tue, incolla il link a un file audio nella scheda del monumento.
- I locali "DEMO" e le statistiche del seed sono finti: dillo a chi guarda la demo.
- Non c'è ancora il pagamento online: il locale si inserisce a mano dall'admin dopo il pagamento (bonifico o link di pagamento).
- La password admin è una sola. Non condividere il link `/admin`.
- Variabili d'ambiente: `DATABASE_URL` (o `POSTGRES_URL`), `ADMIN_PASSWORD`, `SECRET`, `BASE_URL`; facoltative `PORT` (3000), `PG_POOL_MAX` (3) e, in locale, `PGLITE_DIR` (`data/pglite`).

## Prossimi passi possibili

1. Badge "punto sicuro" assegnato dall'ETS con criteri scritti, separato dall'abbonamento.
2. Iscrizione e pagamento del locale da solo con Stripe Checkout (fattura e attivazione automatiche).
3. Audio registrato e immagini per ogni monumento.
4. Accesso per le associazioni, per vedere solo i loro locali.
