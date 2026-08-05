// ═══════════════════════════════════════════════════════════════════════════════
// TEST — trova_prenotazione + controlla_disponibilita
// ═══════════════════════════════════════════════════════════════════════════════
// Esegui:  node backend/tests/test-trova.js
//
// Scenari testati:
//   1. Setup: crea 3 prenotazioni di test (Costa, Simone Costa, Rossi)
//   2. trova per nome esatto "Costa" → 2 match (Costa + Simone Costa)
//   3. trova per nome + data → filtra a 1
//   4. trova per telefono → match esatto
//   5. trova con criterio vuoto → errore no_criteria
//   6. trova per nome inesistente → non_trovata
//   7. controlla_disponibilita libera → esito libero
//   8. controlla_disponibilita giorno chiuso → esito day_closed
//   9. controlla_disponibilita gruppo grande → esito gruppo_grande
//  10. Cleanup: cancella le prenotazioni di test
// ═══════════════════════════════════════════════════════════════════════════════

import 'dotenv/config';
import { closePool, query } from '../db.js';
import { getTenantByPhone, invalidateTenantCache } from '../services/tenants.js';
import { creaPrenotazioneTool } from '../tools/crea-prenotazione.js';
import { trovaPrenotazioneTool } from '../tools/trova-prenotazione.js';
import { controllaDisponibilitaTool } from '../tools/check-availability.js';

const OSTERIA_TEST_PHONE = '+390299223311';
const TEST_MARKER = 'TEST_SMOKE_TROVA';

function nextFriday() {
  const now = new Date();
  const day = now.getUTCDay();
  const daysUntilFriday = (5 - day + 7) % 7 || 7;
  const friday = new Date(now.getTime() + daysUntilFriday * 24 * 60 * 60 * 1000);
  return friday.toISOString().substring(0, 10);
}
function nextSaturday() {
  const now = new Date();
  const day = now.getUTCDay();
  const daysUntilSat = (6 - day + 7) % 7 || 7;
  const sat = new Date(now.getTime() + daysUntilSat * 24 * 60 * 60 * 1000);
  return sat.toISOString().substring(0, 10);
}
function nextMonday() {
  const now = new Date();
  const day = now.getUTCDay();
  const daysUntilMonday = (1 - day + 7) % 7 || 7;
  const monday = new Date(now.getTime() + daysUntilMonday * 24 * 60 * 60 * 1000);
  return monday.toISOString().substring(0, 10);
}

let passed = 0;
let failed = 0;

function assertTrue(cond, testName, extraInfo = '') {
  if (cond) { console.log(`  ✅ PASS: ${testName}`); passed++; }
  else      { console.log(`  ❌ FAIL: ${testName} ${extraInfo}`); failed++; }
}

async function runTests() {
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  🧪 TEST — trova_prenotazione + check_availability               ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  await invalidateTenantCache(OSTERIA_TEST_PHONE);
  const tenant = await getTenantByPhone(OSTERIA_TEST_PHONE);
  if (!tenant?.id) {
    console.error('❌ Tenant non trovato');
    await closePool();
    process.exit(1);
  }
  console.log(`Tenant: "${tenant.restaurantName}" (id=${String(tenant.id).substring(0, 8)}...)\n`);

  const friday = nextFriday();
  const saturday = nextSaturday();
  const monday = nextMonday();

  // ─── Cleanup pre-test ──────────────────────────────────────────────────────
  console.log('▶ Cleanup precedente...');
  await query(`DELETE FROM reservations WHERE tenant_id = $1 AND notes = $2`, [tenant.id, TEST_MARKER]);
  console.log('');

  // ─── Setup: crea 3 prenotazioni di test ────────────────────────────────────
  console.log('▶ Setup: creo 3 prenotazioni di test...');
  const setup1 = await creaPrenotazioneTool(tenant, {
    nome: 'Costa', persone: 2, data: friday, ora: '21:00:00',
    telefono: '+393385354671', notes: TEST_MARKER, source: 'telnyx',
  });
  const setup2 = await creaPrenotazioneTool(tenant, {
    nome: 'Simone Costa', persone: 3, data: saturday, ora: '21:00:00',
    telefono: '+393887654321', notes: TEST_MARKER, source: 'telnyx',
  });
  const setup3 = await creaPrenotazioneTool(tenant, {
    nome: 'Rossi', persone: 4, data: friday, ora: '21:30:00',
    telefono: '+393329988776', notes: TEST_MARKER, source: 'telnyx',
  });
  console.log(`  ✓ Costa (${friday}): ${setup1.creata ? 'ok' : 'FAIL'}`);
  console.log(`  ✓ Simone Costa (${saturday}): ${setup2.creata ? 'ok' : 'FAIL'}`);
  console.log(`  ✓ Rossi (${friday}): ${setup3.creata ? 'ok' : 'FAIL'}`);
  if (!setup1.creata || !setup2.creata || !setup3.creata) {
    console.error('❌ Setup fallito. Aborting.');
    await query(`DELETE FROM reservations WHERE tenant_id = $1 AND notes = $2`, [tenant.id, TEST_MARKER]);
    await closePool();
    process.exit(1);
  }
  console.log('');

  // ─── TEST 1: trova per nome "Costa" (deve matchare Costa E Simone Costa) ──
  console.log('▶ Test 1: trova per nome "Costa" (fuzzy match) ...');
  const t1_start = Date.now();
  const r1 = await trovaPrenotazioneTool(tenant, { nome: 'Costa' });
  const t1_ms = Date.now() - t1_start;
  console.log(`  ⏱  ${t1_ms}ms`);
  console.log(`  📄 found=${r1.found}, count=${r1.count}, primo=${r1.reservation?.name}`);
  assertTrue(r1.found === true, 'found = true');
  assertTrue(r1.count >= 1, 'count >= 1 (almeno Costa)', `got: ${r1.count}`);
  assertTrue(r1.reservation?.name === 'Costa' || r1.reservation?.name === 'Simone Costa', 'match Costa o Simone Costa');
  assertTrue(t1_ms < 500, 'Latenza <500ms', `${t1_ms}ms`);
  console.log('');

  // ─── TEST 2: trova per nome + data (deve filtrare a 1) ────────────────────
  console.log('▶ Test 2: trova per nome "Costa" + data venerdì ...');
  const r2 = await trovaPrenotazioneTool(tenant, { nome: 'Costa', data: friday });
  console.log(`  📄 found=${r2.found}, count=${r2.count}, primo=${r2.reservation?.name}`);
  assertTrue(r2.found === true, 'found = true');
  assertTrue(r2.count === 1, 'count = 1 (filtrato per data)', `got: ${r2.count}`);
  assertTrue(r2.reservation?.name === 'Costa', 'match esatto Costa');
  console.log('');

  // ─── TEST 3: trova per telefono esatto ─────────────────────────────────────
  console.log('▶ Test 3: trova per telefono +393887654321 ...');
  const r3 = await trovaPrenotazioneTool(tenant, { telefono: '+393887654321' });
  console.log(`  📄 found=${r3.found}, count=${r3.count}, primo=${r3.reservation?.name}`);
  assertTrue(r3.found === true, 'found = true');
  assertTrue(r3.reservation?.name === 'Simone Costa', 'match per phone → Simone Costa', `got: ${r3.reservation?.name}`);
  console.log('');

  // ─── TEST 4: trova senza criteri → errore ──────────────────────────────────
  console.log('▶ Test 4: trova senza criteri (deve fallire) ...');
  const r4 = await trovaPrenotazioneTool(tenant, {});
  console.log(`  📄 found=${r4.found}, motivo=${r4.motivo}`);
  assertTrue(r4.found === false, 'found = false');
  assertTrue(r4.motivo === 'no_criteria', 'motivo = no_criteria', `got: ${r4.motivo}`);
  console.log('');

  // ─── TEST 5: trova per nome inesistente ────────────────────────────────────
  console.log('▶ Test 5: trova nome inesistente "Franceschini" ...');
  const r5 = await trovaPrenotazioneTool(tenant, { nome: 'Franceschini' });
  console.log(`  📄 found=${r5.found}, motivo=${r5.motivo}`);
  assertTrue(r5.found === false, 'found = false');
  assertTrue(r5.motivo === 'non_trovata', 'motivo = non_trovata', `got: ${r5.motivo}`);
  console.log('');

  // ─── TEST 6: check_availability slot libero ────────────────────────────────
  console.log('▶ Test 6: controlla_disponibilita venerdì 22:00 (libero) ...');
  const t6_start = Date.now();
  const c1 = await controllaDisponibilitaTool(tenant, { data: friday, ora: '22:00', persone: 2 });
  const t6_ms = Date.now() - t6_start;
  console.log(`  ⏱  ${t6_ms}ms`);
  console.log(`  📄 esito=${c1.esito}, slot_available=${c1.slot_available}`);
  assertTrue(c1.esito === 'libero', 'esito = libero', `got: ${c1.esito}`);
  assertTrue(c1.slot_available === true, 'slot_available = true');
  console.log('');

  // ─── TEST 7: check_availability giorno chiuso (lunedì) ─────────────────────
  console.log('▶ Test 7: controlla_disponibilita lunedì (giorno chiuso) ...');
  const c2 = await controllaDisponibilitaTool(tenant, { data: monday, ora: '21:00', persone: 2 });
  console.log(`  📄 esito=${c2.esito}, slot_available=${c2.slot_available}`);
  assertTrue(c2.esito === 'day_closed', 'esito = day_closed', `got: ${c2.esito}`);
  assertTrue(c2.slot_available === false, 'slot_available = false');
  console.log('');

  // ─── TEST 8: check_availability gruppo grande ──────────────────────────────
  console.log('▶ Test 8: controlla_disponibilita 11 persone (gruppo grande) ...');
  const c3 = await controllaDisponibilitaTool(tenant, { data: friday, ora: '22:00', persone: 11 });
  console.log(`  📄 esito=${c3.esito}, slot_available=${c3.slot_available}`);
  assertTrue(c3.esito === 'gruppo_grande', 'esito = gruppo_grande', `got: ${c3.esito}`);
  assertTrue(c3.slot_available === true, 'slot_available = true (procedi con PENDING)');
  console.log('');

  // ─── Cleanup ───────────────────────────────────────────────────────────────
  console.log('▶ Cleanup finale...');
  const cleanup = await query(`DELETE FROM reservations WHERE tenant_id = $1 AND notes = $2`, [tenant.id, TEST_MARKER]);
  console.log(`  🗑  ${cleanup.rowCount} prenotazioni rimosse\n`);

  // ─── Riepilogo ─────────────────────────────────────────────────────────────
  const total = passed + failed;
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  if (failed === 0) {
    console.log(`║  ✅ TUTTI I TEST SUPERATI (${passed}/${total})                                    ║`);
  } else {
    console.log(`║  ⚠️  ${passed}/${total} PASSATI — ${failed} FALLITI                                    ║`);
  }
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  await closePool();
  process.exit(failed === 0 ? 0 : 1);
}

runTests().catch(async (err) => {
  console.error('❌ Test crashed:', err);
  await closePool();
  process.exit(1);
});
