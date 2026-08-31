'use strict';

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const PORT = parseInt(process.env.PORT || '8080', 10);
const APP_PASSWORD = process.env.APP_PASSWORD || '';
const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN || '';
const DATABASE_URL = process.env.DATABASE_URL || '';

const HOME = {
  label: 'Zuhause – Reichenberger Straße 2, 94036 Passau',
  lat: parseFloat(process.env.HOME_LAT || '48.562705'),
  lon: parseFloat(process.env.HOME_LON || '13.420486'),
};

if (!APP_PASSWORD) { console.error('FATAL: APP_PASSWORD not set'); process.exit(1); }
if (!DATABASE_URL) { console.error('FATAL: DATABASE_URL not set'); process.exit(1); }

// Deterministic token so a stored token survives restarts and redeploys.
const TOKEN = crypto.createHmac('sha256', APP_PASSWORD).update('hautarzt-finder-v1').digest('hex');

const pool = new Pool({
  connectionString: DATABASE_URL,
  // PgBouncer on Sandy terminates TLS with a self-signed certificate.
  ssl: process.env.PGSSL_DISABLE === '1' ? false : { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));

// ---------------------------------------------------------------- schema + seed

const SCHEMA = `
CREATE TABLE IF NOT EXISTS doctors (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  also          text[] NOT NULL DEFAULT '{}',
  address       text NOT NULL,
  zip           text,
  city          text,
  country       text NOT NULL,
  lat           double precision NOT NULL,
  lon           double precision NOT NULL,
  phone         text,
  website       text,
  rating        numeric(2,1),
  rating_count  integer,
  billing       text,
  note          text,
  km            numeric(5,1) NOT NULL,
  source        text,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS doctor_state (
  doctor_id  text PRIMARY KEY REFERENCES doctors(id) ON DELETE CASCADE,
  called     boolean NOT NULL DEFAULT false,
  comment    text NOT NULL DEFAULT '',
  status     text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS doctors_km_idx ON doctors (km);
`;

function slugify(s) {
  return s.toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

async function migrate() {
  await pool.query(SCHEMA);
  // `status` was added after the first deploy; keep older databases working.
  await pool.query(`ALTER TABLE doctor_state ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT ''`);
}

async function seed() {
  const file = path.join(__dirname, 'data', 'doctors.json');
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
  const seen = new Set();
  for (const d of rows) {
    let id = slugify(`${d.name}-${d.zip || ''}`);
    let n = 2;
    while (seen.has(id)) { id = `${slugify(`${d.name}-${d.zip || ''}`)}-${n++}`; }
    seen.add(id);
    // Upsert the reference data but never touch the user's own call state.
    await pool.query(
      `INSERT INTO doctors (id,name,also,address,zip,city,country,lat,lon,phone,website,
                            rating,rating_count,billing,note,km,source,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,now())
       ON CONFLICT (id) DO UPDATE SET
         name=EXCLUDED.name, also=EXCLUDED.also, address=EXCLUDED.address, zip=EXCLUDED.zip,
         city=EXCLUDED.city, country=EXCLUDED.country, lat=EXCLUDED.lat, lon=EXCLUDED.lon,
         phone=EXCLUDED.phone, website=EXCLUDED.website, rating=EXCLUDED.rating,
         rating_count=EXCLUDED.rating_count, billing=EXCLUDED.billing, note=EXCLUDED.note,
         km=EXCLUDED.km, source=EXCLUDED.source, updated_at=now()`,
      [id, d.name, d.also || [], d.address, d.zip || null, d.city || null, d.country,
       d.lat, d.lon, d.phone || null, d.website || null, d.rating ?? null,
       d.rating_count ?? null, d.billing || null, d.note || null, d.km, d.source || null]
    );
    await pool.query(
      `INSERT INTO doctor_state (doctor_id) VALUES ($1) ON CONFLICT (doctor_id) DO NOTHING`, [id]);
  }
  const { rows: [{ count }] } = await pool.query('SELECT count(*)::int AS count FROM doctors');
  console.log(`seed complete: ${count} doctors`);
}

// ---------------------------------------------------------------- auth

function requireAuth(req, res, next) {
  const t = req.get('X-Auth-Token') || '';
  const a = Buffer.from(t);
  const b = Buffer.from(TOKEN);
  if (a.length === b.length && crypto.timingSafeEqual(a, b)) return next();
  res.status(401).json({ error: 'unauthorized' });
}

app.post('/api/login', (req, res) => {
  const given = String((req.body && req.body.password) || '');
  const a = Buffer.from(given);
  const b = Buffer.from(APP_PASSWORD);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) return res.status(401).json({ error: 'Falsches Passwort' });
  res.json({ token: TOKEN });
});

// ---------------------------------------------------------------- api

app.get('/healthz', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch (e) {
    res.status(503).json({ ok: false, error: String(e.message || e) });
  }
});

app.get('/api/config', requireAuth, (_req, res) => {
  res.json({ mapboxToken: MAPBOX_TOKEN, home: HOME });
});

app.get('/api/doctors', requireAuth, async (_req, res) => {
  try {
    await ready;
    const { rows } = await pool.query(`
      SELECT d.id, d.name, d.also, d.address, d.zip, d.city, d.country, d.lat, d.lon,
             d.phone, d.website, d.rating, d.rating_count, d.billing, d.note, d.km, d.source,
             COALESCE(s.called,false) AS called,
             COALESCE(s.comment,'')  AS comment,
             COALESCE(s.status,'')   AS status,
             s.updated_at            AS state_updated_at
        FROM doctors d
        LEFT JOIN doctor_state s ON s.doctor_id = d.id
       ORDER BY d.km ASC`);
    res.json(rows.map(r => ({
      ...r,
      rating: r.rating === null ? null : Number(r.rating),
      km: Number(r.km),
    })));
  } catch (e) {
    console.error('GET /api/doctors', e);
    res.status(500).json({ error: 'db error' });
  }
});

app.put('/api/doctors/:id/state', requireAuth, async (req, res) => {
  const { id } = req.params;
  const body = req.body || {};
  const fields = [];
  const values = [id];
  if (typeof body.called === 'boolean') { values.push(body.called); fields.push(`called = $${values.length}`); }
  if (typeof body.comment === 'string') { values.push(body.comment.slice(0, 4000)); fields.push(`comment = $${values.length}`); }
  if (typeof body.status === 'string') { values.push(body.status.slice(0, 40)); fields.push(`status = $${values.length}`); }
  if (!fields.length) return res.status(400).json({ error: 'nothing to update' });
  try {
    const { rowCount } = await pool.query(
      `INSERT INTO doctor_state (doctor_id) VALUES ($1)
       ON CONFLICT (doctor_id) DO NOTHING`, [id]);
    void rowCount;
    const { rows } = await pool.query(
      `UPDATE doctor_state SET ${fields.join(', ')}, updated_at = now()
        WHERE doctor_id = $1
        RETURNING called, comment, status, updated_at`, values);
    if (!rows.length) return res.status(404).json({ error: 'unknown doctor' });
    res.json(rows[0]);
  } catch (e) {
    console.error('PUT state', e);
    res.status(500).json({ error: 'db error' });
  }
});

// Serve index.html with a build-stamped asset query so a redeploy never serves a
// stale app.js out of the browser cache.
const BUILD = String(Date.now());
const INDEX_HTML = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8')
  .replace('src="/app.js"', `src="/app.js?v=${BUILD}"`);

app.get(['/', '/index.html'], (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.type('html').send(INDEX_HTML);
});

app.use(express.static(path.join(__dirname, 'public'), {
  index: 'index.html',
  etag: true,
  setHeaders(res, filePath) {
    // The HTML carries the inline CSS, so it must never go stale after a redeploy.
    res.setHeader('Cache-Control', /\.(html|js)$/.test(filePath) ? 'no-cache' : 'public, max-age=3600');
  },
}));

// ---------------------------------------------------------------- boot

// Bind the port first: the platform healthcheck starts probing immediately, and
// migrate+seed takes long enough that a later listen() reads as a dead container.
app.listen(PORT, '0.0.0.0', () => console.log(`hautarzt-finder listening on ${PORT}`));

const ready = (async () => {
  for (let i = 1; i <= 10; i++) {
    try { await migrate(); break; }
    catch (e) {
      console.error(`migrate attempt ${i} failed: ${e.message}`);
      if (i === 10) process.exit(1);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  try { await seed(); } catch (e) { console.error('seed failed (continuing):', e.message); }
})();
