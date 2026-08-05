// ═══════════════════════════════════════════════════════════════════════════════
// POSTGRES POOL — Connessione Neon con configurazione ottimale
// ═══════════════════════════════════════════════════════════════════════════════
// Usa `pg` (node-postgres) con connection pooling nativo.
// Neon supporta bene i pool: teniamo 10 connessioni max, sufficienti per il
// gateway anche sotto carico. Ogni tool call libera la connessione subito.
//
// Timeout aggressivi: se una query prende >5s c'è qualcosa che non va,
// meglio fallire veloci che tenere il cliente al telefono.
// ═══════════════════════════════════════════════════════════════════════════════

import pg from 'pg';

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL non configurata. Il backend non può partire.');
  throw new Error('DATABASE_URL missing');
}

// Neon usa SSL sempre. La connection string ha ?sslmode=require di default.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,                          // max 10 connessioni concorrenti
  idleTimeoutMillis: 30000,         // chiudi connessioni inattive dopo 30s
  connectionTimeoutMillis: 5000,    // timeout se non si connette in 5s
  statement_timeout: 5000,          // ogni query max 5s (poi fail)
  query_timeout: 5000,
});

pool.on('error', (err) => {
  console.error('❌ Postgres pool error:', err.message);
});

// Verifica connessione allo startup (con timeout breve, non blocca il gateway)
export async function verifyDatabaseConnection() {
  try {
    const start = Date.now();
    const result = await pool.query('SELECT NOW() as now, version() as version');
    const ms = Date.now() - start;
    console.log(`✅ Postgres connesso in ${ms}ms — ${result.rows[0].version.substring(0, 40)}...`);
    return true;
  } catch (err) {
    console.error('❌ Postgres verify FAILED:', err.message);
    return false;
  }
}

// Helper: query con logging del tempo per debug performance
export async function query(text, params = []) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const ms = Date.now() - start;
    if (ms > 500) {
      // Log solo query lente
      console.warn(`🐌 Slow query (${ms}ms): ${text.substring(0, 80)}`);
    }
    return result;
  } catch (err) {
    console.error(`❌ Query failed: ${text.substring(0, 80)} — ${err.message}`);
    throw err;
  }
}

// Helper: transazione con rollback automatico
export async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Chiudi tutte le connessioni allo shutdown
export async function closePool() {
  await pool.end();
}

export default pool;
