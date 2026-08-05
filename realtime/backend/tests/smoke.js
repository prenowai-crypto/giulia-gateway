// ═══════════════════════════════════════════════════════════════════════════════
// SMOKE TEST — Verifica che il backend sia funzionante
// ═══════════════════════════════════════════════════════════════════════════════
// Esegui: node backend/tests/smoke.js
// (dalla cartella `realtime/`)
//
// Controlla:
//   1. Connessione Postgres (query semplice)
//   2. Connessione Redis (set + get)
//   3. Lookup tenant "Osteria Test" (cache miss + cache hit)
//   4. Latenza misurata di ogni step
//
// Se tutto passa: siamo pronti a scrivere le tool call.
// ═══════════════════════════════════════════════════════════════════════════════

import 'dotenv/config';
import { verifyDatabaseConnection, closePool } from '../db.js';
import { verifyRedisConnection } from '../cache.js';
import { getTenantByPhone, invalidateTenantCache, listActiveTenants } from '../services/tenants.js';

const OSTERIA_TEST_PHONE = '+390299223311';

async function runSmokeTests() {
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  🧪 PRENOW BACKEND — SMOKE TEST                                  ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  let allPass = true;

  // ─── Test 1: Postgres ────────────────────────────────────────────────────────
  console.log('▶ Test 1: connessione Postgres...');
  const pgOk = await verifyDatabaseConnection();
  if (!pgOk) {
    console.error('❌ FAIL: Postgres non raggiungibile\n');
    allPass = false;
  }

  // ─── Test 2: Redis ───────────────────────────────────────────────────────────
  console.log('\n▶ Test 2: connessione Redis...');
  const redisOk = await verifyRedisConnection();
  if (!redisOk) {
    console.error('❌ FAIL: Redis non raggiungibile\n');
    allPass = false;
  }

  if (!allPass) {
    console.log('\n⛔ Test interrotti: fix connessioni prima di proseguire.');
    await closePool();
    process.exit(1);
  }

  // ─── Test 3: Listing tenants ─────────────────────────────────────────────────
  console.log('\n▶ Test 3: elenco tenant attivi...');
  try {
    const tenants = await listActiveTenants();
    console.log(`✅ Tenant attivi trovati: ${tenants.length}`);
    for (const t of tenants) {
      console.log(`    • ${t.restaurant_name} (${t.restaurant_id}) → ${t.phone_number}`);
    }
    if (tenants.length === 0) {
      console.warn('⚠️  Nessun tenant attivo. Assicurati di aver eseguito lo schema.sql con il seed.');
    }
  } catch (err) {
    console.error(`❌ Listing failed: ${err.message}`);
    allPass = false;
  }

  // ─── Test 4: Lookup tenant — cache miss ──────────────────────────────────────
  console.log(`\n▶ Test 4a: lookup tenant "${OSTERIA_TEST_PHONE}" (cache miss, force)...`);
  await invalidateTenantCache(OSTERIA_TEST_PHONE);
  const t0 = Date.now();
  const tenant1 = await getTenantByPhone(OSTERIA_TEST_PHONE);
  const missMs = Date.now() - t0;
  if (tenant1) {
    console.log(`✅ Cache miss lookup: ${missMs}ms — "${tenant1.restaurantName}"`);
    console.log(`    Orari cena: ${tenant1.dinnerStart}-${tenant1.dinnerEnd}`);
    console.log(`    Chiusi: giorni ${JSON.stringify(tenant1.closedDays)}`);
    console.log(`    Soglia gruppo grande: ${tenant1.largeGroupThreshold} persone`);
  } else {
    console.error(`❌ Tenant "${OSTERIA_TEST_PHONE}" non trovato. Hai eseguito lo schema.sql?`);
    allPass = false;
  }

  // ─── Test 5: Lookup tenant — cache hit ───────────────────────────────────────
  if (tenant1) {
    console.log('\n▶ Test 4b: lookup tenant (cache hit)...');
    const t1 = Date.now();
    const tenant2 = await getTenantByPhone(OSTERIA_TEST_PHONE);
    const hitMs = Date.now() - t1;
    if (tenant2 && tenant2.restaurantName === tenant1.restaurantName) {
      console.log(`✅ Cache hit lookup: ${hitMs}ms — ${hitMs < missMs ? 'più veloce del miss ✓' : 'ATTENZIONE: non più veloce'}`);
    } else {
      console.error('❌ Cache hit: risultato diverso dal cache miss!');
      allPass = false;
    }
  }

  // ─── Riepilogo ───────────────────────────────────────────────────────────────
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  if (allPass) {
    console.log('║  ✅ TUTTI I TEST SUPERATI — pronti per Giorno 2 (tool call)      ║');
  } else {
    console.log('║  ❌ ALCUNI TEST FALLITI — verifica gli errori sopra              ║');
  }
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  await closePool();
  process.exit(allPass ? 0 : 1);
}

runSmokeTests().catch((err) => {
  console.error('❌ Smoke test crashed:', err);
  process.exit(1);
});
