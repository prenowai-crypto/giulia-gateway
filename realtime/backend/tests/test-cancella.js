// ═══════════════════════════════════════════════════════════════════════════════
// TEST — cancella_prenotazione
// ═══════════════════════════════════════════════════════════════════════════════
// Esegui:  node backend/tests/test-cancella.js
//
// Scenari:
//   1. Setup: crea una prenotazione
//   2. Cancella → success
//   3. Verifica DB: status=CANCELLED, cancelled_at valorizzato
//   4. Cancella di nuovo (idempotenza) → success con already_cancelled=true
//   5. Trova_prenotazione dopo cancel → NON deve trovarla (escluse CANCELLED)
//   6. Cancella con eventId inesistente → not_found
//   7. Cancella senza eventId → missing_eventid
//   8. Cancella con eventId formato invalido → invalid_eventid
//   9. Verifica audit log: 1 record 'create' + 1 record 'cancel'
// ═══════════════════════════════════════════════════════════════════════════════

import 'dotenv/config';
import { closePool, query } from '../db.js';
import { getTenantByPhone, invalidateTenantCache } from '../services/tenants.js';
import { creaPrenotazioneTool } from '../tools/crea-prenotazione.js';
import { cancellaPrenotazioneTool } from '../tools/cancella-prenotazione.js';
import { trovaPrenotazioneTool } from '../tools/trova-prenotazione.js';

const OSTERIA_TEST_PHONE = '+390299223311';
const TEST_MARKER = 'TEST_SMOKE_CANCELLA';

function nextFriday() {
  const now = new Date();
  const day = now.getUTCDay();
  const daysUntilFriday = (5 - day + 7) % 7 || 7;
  return new Date(now.getTime() + daysUntilFriday * 86400000).toISOString().substring(0, 10);
}

let passed = 0;
let failed = 0;

function assertTrue(cond, testName, extraInfo = '') {
  if (cond) { console.log(`  ✅ PASS: ${testName}`); passed++; }
  else      { console.log(`  ❌ FAIL: ${testName} ${extraInfo}`); failed++; }
}

async function runTests() {
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  🧪 TEST — cancella_prenotazione                                 ║');
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

  // ─── Cleanup pre-test ──────────────────────────────────────────────────────
  console.log('▶ Cleanup precedente...');
  const uniqueMarker = `${TEST_MARKER}_${Date.now()}`;
  await query(`DELETE FROM reservations WHERE tenant_id = $1 AND notes LIKE $2`,
    [tenant.id, `${TEST_MARKER}%`]);
  console.log('');

  // ─── Setup: crea prenotazione ──────────────────────────────────────────────
  console.log('▶ Setup: crea prenotazione "Grandi" 3 pax venerdì 21:00 ...');
  const setup = await creaPrenotazioneTool(tenant, {
    nome: 'Grandi', persone: 3, data: friday, ora: '21:00:00',
    telefono: '+393385354671', notes: uniqueMarker, source: 'telnyx',
  });
  if (!setup.creata) {
    console.error('❌ Setup fallito:', setup);
    await closePool();
    process.exit(1);
  }
  const eventId = setup._internal.reservation_id;
  console.log(`  ✓ Creata (eventId=${eventId.substring(0, 8)}...)\n`);

  // ─── TEST 1: Cancella → success ────────────────────────────────────────────
  console.log('▶ Test 1: cancella prenotazione');
  const t1_start = Date.now();
  const r1 = await cancellaPrenotazioneTool(tenant, {
    eventId, motivo: 'customer_request', source: 'telnyx_cancel',
  });
  const t1_ms = Date.now() - t1_start;
  console.log(`  ⏱  ${t1_ms}ms`);
  console.log(`  📄 success=${r1.success}, cancellata=${r1.cancellata}, nome=${r1.nome}`);
  assertTrue(r1.success === true, 'success = true');
  assertTrue(r1.cancellata === true, 'cancellata = true');
  assertTrue(r1.nome === 'Grandi', 'nome corretto restituito');
  assertTrue(r1.eventId === eventId, 'eventId corretto restituito');
  assertTrue(!r1.already_cancelled, 'NON already_cancelled (era attiva)');
  assertTrue(t1_ms < 500, 'Latenza <500ms', `${t1_ms}ms`);
  console.log('');

  // ─── TEST 2: Verifica DB — status + cancelled_at ───────────────────────────
  console.log('▶ Test 2: verifica DB — status=CANCELLED, cancelled_at valorizzato');
  const dbCheck = await query(
    `SELECT status, cancelled_at, updated_at FROM reservations WHERE id = $1`,
    [eventId]
  );
  const row = dbCheck.rows[0];
  console.log(`  📄 status=${row.status}, cancelled_at=${row.cancelled_at?.toISOString?.() || row.cancelled_at}`);
  assertTrue(row.status === 'CANCELLED', 'status = CANCELLED', `got: ${row.status}`);
  assertTrue(row.cancelled_at !== null, 'cancelled_at NON null');
  console.log('');

  // ─── TEST 3: Cancella di nuovo → idempotente ───────────────────────────────
  console.log('▶ Test 3: cancella di nuovo (idempotenza)');
  const r3 = await cancellaPrenotazioneTool(tenant, {
    eventId, motivo: 'customer_request', source: 'telnyx_cancel',
  });
  console.log(`  📄 success=${r3.success}, already_cancelled=${r3.already_cancelled}`);
  assertTrue(r3.success === true, 'success = true (idempotente)');
  assertTrue(r3.already_cancelled === true, 'already_cancelled = true');
  console.log('');

  // ─── TEST 4: trova_prenotazione NON deve trovarla ──────────────────────────
  console.log('▶ Test 4: trova_prenotazione dopo cancel — NON trovata');
  const r4 = await trovaPrenotazioneTool(tenant, { nome: 'Grandi', data: friday });
  console.log(`  📄 found=${r4.found}, count=${r4.count}, motivo=${r4.motivo}`);
  assertTrue(r4.found === false, 'found = false (esclude CANCELLED)');
  assertTrue(r4.motivo === 'non_trovata', 'motivo = non_trovata');
  console.log('');

  // ─── TEST 5: eventId inesistente ───────────────────────────────────────────
  console.log('▶ Test 5: cancella con eventId inesistente');
  const fakeUuid = '00000000-0000-0000-0000-000000000000';
  const r5 = await cancellaPrenotazioneTool(tenant, {
    eventId: fakeUuid, source: 'telnyx_cancel',
  });
  console.log(`  📄 success=${r5.success}, reason=${r5.reason}`);
  assertTrue(r5.success === false, 'success = false');
  assertTrue(r5.reason === 'not_found', 'reason = not_found', `got: ${r5.reason}`);
  console.log('');

  // ─── TEST 6: senza eventId ─────────────────────────────────────────────────
  console.log('▶ Test 6: cancella senza eventId');
  const r6 = await cancellaPrenotazioneTool(tenant, { source: 'telnyx_cancel' });
  console.log(`  📄 success=${r6.success}, reason=${r6.reason}`);
  assertTrue(r6.success === false, 'success = false');
  assertTrue(r6.reason === 'missing_eventid', 'reason = missing_eventid', `got: ${r6.reason}`);
  console.log('');

  // ─── TEST 7: eventId formato invalido ──────────────────────────────────────
  console.log('▶ Test 7: eventId formato invalido (non-UUID)');
  const r7 = await cancellaPrenotazioneTool(tenant, {
    eventId: 'abc123@google.com',  // vecchio formato Apps Script
    source: 'telnyx_cancel',
  });
  console.log(`  📄 success=${r7.success}, reason=${r7.reason}`);
  assertTrue(r7.success === false, 'success = false');
  assertTrue(r7.reason === 'invalid_eventid', 'reason = invalid_eventid', `got: ${r7.reason}`);
  console.log('');

  // ─── TEST 8: Verifica audit log ────────────────────────────────────────────
  console.log('▶ Test 8: verifica audit log (create + cancel)');
  const audit = await query(
    `SELECT action, source FROM reservation_audit_log
      WHERE reservation_id = $1
      ORDER BY created_at ASC`,
    [eventId]
  );
  console.log(`  📄 audit entries: ${audit.rows.map(a => a.action).join(', ')}`);
  assertTrue(audit.rows.length >= 2, `audit ha almeno 2 record (got: ${audit.rows.length})`);
  assertTrue(audit.rows.some(a => a.action === 'create'), 'audit contiene create');
  assertTrue(audit.rows.some(a => a.action === 'cancel'), 'audit contiene cancel');
  console.log('');

  // ─── Cleanup finale ────────────────────────────────────────────────────────
  console.log('▶ Cleanup finale...');
  // Cancella cascade audit + sync_jobs → CASCADE è configurato nel schema
  const cleanup = await query(`DELETE FROM reservations WHERE id = $1`, [eventId]);
  const cleanupExtra = await query(`DELETE FROM reservations WHERE tenant_id = $1 AND notes LIKE $2`,
    [tenant.id, `${TEST_MARKER}%`]);
  console.log(`  🗑  ${cleanup.rowCount + cleanupExtra.rowCount} prenotazioni rimosse\n`);

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
