// ═══════════════════════════════════════════════════════════════════════════════
// TEST — modifica_prenotazione
// ═══════════════════════════════════════════════════════════════════════════════
// Esegui:  node backend/tests/test-modifica.js
//
// Scenari:
//   1. Setup: crea una prenotazione base "Costa" 2 pax venerdì 21:00
//   2. Modifica persone (2 → 3) — CONFIRMED
//   3. Modifica ora (21:00 → 22:00) — check availability
//   4. Modifica solo note — verifica partial update (altri campi intatti!)
//   5. Modifica nome
//   6. Modifica che porta a gruppo grande (3 → 11) → PENDING_OWNER
//   7. Modifica indietro (11 → 5) → CONFIRMED
//   8. Modifica a giorno chiuso (lunedì) → rifiuto
//   9. Modifica con eventId inesistente → not_found
//  10. Modifica senza eventId → missing_eventid
//  11. Rimozione nota (notes: "") → verifica rimozione esplicita
// ═══════════════════════════════════════════════════════════════════════════════

import 'dotenv/config';
import { closePool, query } from '../db.js';
import { getTenantByPhone, invalidateTenantCache } from '../services/tenants.js';
import { creaPrenotazioneTool } from '../tools/crea-prenotazione.js';
import { modificaPrenotazioneTool } from '../tools/modifica-prenotazione.js';

const OSTERIA_TEST_PHONE = '+390299223311';
const TEST_MARKER = 'TEST_SMOKE_MODIFICA';

function nextFriday() {
  const now = new Date();
  const day = now.getUTCDay();
  const daysUntilFriday = (5 - day + 7) % 7 || 7;
  return new Date(now.getTime() + daysUntilFriday * 86400000).toISOString().substring(0, 10);
}
function nextMonday() {
  const now = new Date();
  const day = now.getUTCDay();
  const daysUntilMonday = (1 - day + 7) % 7 || 7;
  return new Date(now.getTime() + daysUntilMonday * 86400000).toISOString().substring(0, 10);
}

let passed = 0;
let failed = 0;

function assertTrue(cond, testName, extraInfo = '') {
  if (cond) { console.log(`  ✅ PASS: ${testName}`); passed++; }
  else      { console.log(`  ❌ FAIL: ${testName} ${extraInfo}`); failed++; }
}

async function runTests() {
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  🧪 TEST — modifica_prenotazione                                 ║');
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
  const monday = nextMonday();

  // ─── Cleanup pre-test ──────────────────────────────────────────────────────
  console.log('▶ Cleanup precedente...');
  await query(`DELETE FROM reservations WHERE tenant_id = $1 AND notes LIKE $2`,
    [tenant.id, `${TEST_MARKER}%`]);
  console.log('');

  // ─── Setup: crea prenotazione base ─────────────────────────────────────────
  console.log('▶ Setup: crea prenotazione base "Costa" 2 pax venerdì 21:00 ...');
  const setup = await creaPrenotazioneTool(tenant, {
    nome: 'Costa', persone: 2, data: friday, ora: '21:00:00',
    telefono: '+393385354671', notes: TEST_MARKER, source: 'telnyx',
  });
  if (!setup.creata) {
    console.error('❌ Setup fallito:', setup);
    await closePool();
    process.exit(1);
  }
  const eventId = setup._internal.reservation_id;
  console.log(`  ✓ Creata (eventId=${eventId.substring(0, 8)}...)\n`);

  // ─── TEST 1: Modifica persone (2 → 3) ─────────────────────────────────────
  console.log('▶ Test 1: modifica persone 2 → 3');
  const t1_start = Date.now();
  const r1 = await modificaPrenotazioneTool(tenant, {
    eventId, persone: 3, source: 'telnyx_modify',
  });
  const t1_ms = Date.now() - t1_start;
  console.log(`  ⏱  ${t1_ms}ms`);
  console.log(`  📄 success=${r1.success}, stato=${r1.stato}, persone=${r1.persone}`);
  assertTrue(r1.success === true, 'success = true');
  assertTrue(r1.persone === 3, 'persone = 3', `got: ${r1.persone}`);
  assertTrue(r1.stato === 'CONFIRMED', 'stato = CONFIRMED');
  assertTrue(r1.changed_slot === true, 'changed_slot = true (cambio persone impatta slot)');
  assertTrue(t1_ms < 500, 'Latenza <500ms', `${t1_ms}ms`);
  console.log('');

  // ─── TEST 2: Modifica ora (21:00 → 22:00) ─────────────────────────────────
  console.log('▶ Test 2: modifica ora 21:00 → 22:00');
  const r2 = await modificaPrenotazioneTool(tenant, {
    eventId, ora: '22:00', source: 'telnyx_modify',
  });
  console.log(`  📄 success=${r2.success}, ora=${r2.ora}, persone=${r2.persone}`);
  assertTrue(r2.success === true, 'success = true');
  assertTrue(r2.ora === '22:00', 'ora = 22:00', `got: ${r2.ora}`);
  assertTrue(r2.persone === 3, 'persone MANTENUTE = 3 (partial update)', `got: ${r2.persone}`);
  console.log('');

  // ─── TEST 3: Modifica solo note — verifica altri campi intatti ────────────
  console.log('▶ Test 3: modifica solo note — verifica partial update');
  const r3 = await modificaPrenotazioneTool(tenant, {
    eventId,
    notes: `${TEST_MARKER} — tavolo esterno`,
    source: 'telnyx_modify',
  });
  console.log(`  📄 success=${r3.success}, ora=${r3.ora}, persone=${r3.persone}, nome=${r3.nome}`);
  assertTrue(r3.success === true, 'success = true');
  assertTrue(r3.persone === 3, 'persone INTATTE = 3', `got: ${r3.persone}`);
  assertTrue(r3.ora === '22:00', 'ora INTATTA = 22:00', `got: ${r3.ora}`);
  assertTrue(r3.nome === 'Costa', 'nome INTATTO = Costa', `got: ${r3.nome}`);
  assertTrue(r3.changed_slot === false, 'changed_slot = false (solo note)');
  console.log('');

  // ─── TEST 4: Modifica nome ────────────────────────────────────────────────
  console.log('▶ Test 4: modifica nome Costa → Simone Costa');
  const r4 = await modificaPrenotazioneTool(tenant, {
    eventId, nome: 'Simone Costa', source: 'telnyx_modify',
  });
  console.log(`  📄 success=${r4.success}, nome=${r4.nome}`);
  assertTrue(r4.success === true, 'success = true');
  assertTrue(r4.nome === 'Simone Costa', 'nome = Simone Costa', `got: ${r4.nome}`);
  console.log('');

  // ─── TEST 5: Modifica a gruppo grande (3 → 11) → PENDING_OWNER ────────────
  console.log('▶ Test 5: modifica persone 3 → 11 (attraversa soglia 10)');
  const r5 = await modificaPrenotazioneTool(tenant, {
    eventId, persone: 11, source: 'telnyx_modify',
  });
  console.log(`  📄 success=${r5.success}, stato=${r5.stato}, is_group=${r5.is_group}`);
  assertTrue(r5.success === true, 'success = true');
  assertTrue(r5.persone === 11, 'persone = 11');
  assertTrue(r5.stato === 'PENDING_OWNER', 'stato = PENDING_OWNER', `got: ${r5.stato}`);
  assertTrue(r5.is_group === true, 'is_group = true');
  console.log('');

  // ─── TEST 6: Modifica indietro (11 → 5) → CONFIRMED ───────────────────────
  console.log('▶ Test 6: modifica persone 11 → 5 (torna sotto soglia)');
  const r6 = await modificaPrenotazioneTool(tenant, {
    eventId, persone: 5, source: 'telnyx_modify',
  });
  console.log(`  📄 success=${r6.success}, stato=${r6.stato}, is_group=${r6.is_group}`);
  assertTrue(r6.success === true, 'success = true');
  assertTrue(r6.stato === 'CONFIRMED', 'stato torna a CONFIRMED', `got: ${r6.stato}`);
  assertTrue(r6.is_group === false, 'is_group = false');
  console.log('');

  // ─── TEST 7: Modifica a giorno chiuso (lunedì) → rifiuto ──────────────────
  console.log('▶ Test 7: modifica data a lunedì (chiuso) → rifiuto');
  const r7 = await modificaPrenotazioneTool(tenant, {
    eventId, data: monday, source: 'telnyx_modify',
  });
  console.log(`  📄 success=${r7.success}, reason=${r7.reason}`);
  assertTrue(r7.success === false, 'success = false');
  assertTrue(r7.reason === 'giorno_chiuso', 'reason = giorno_chiuso', `got: ${r7.reason}`);
  console.log('');

  // ─── TEST 8: eventId inesistente → not_found ──────────────────────────────
  console.log('▶ Test 8: eventId inesistente → not_found');
  const fakeUuid = '00000000-0000-0000-0000-000000000000';
  const r8 = await modificaPrenotazioneTool(tenant, {
    eventId: fakeUuid, persone: 5, source: 'telnyx_modify',
  });
  console.log(`  📄 success=${r8.success}, reason=${r8.reason}`);
  assertTrue(r8.success === false, 'success = false');
  assertTrue(r8.reason === 'not_found', 'reason = not_found', `got: ${r8.reason}`);
  console.log('');

  // ─── TEST 9: Missing eventId → errore ─────────────────────────────────────
  console.log('▶ Test 9: chiamata senza eventId → missing_eventid');
  const r9 = await modificaPrenotazioneTool(tenant, {
    persone: 5, source: 'telnyx_modify',
  });
  console.log(`  📄 success=${r9.success}, reason=${r9.reason}`);
  assertTrue(r9.success === false, 'success = false');
  assertTrue(r9.reason === 'missing_eventid', 'reason = missing_eventid', `got: ${r9.reason}`);
  console.log('');

  // ─── TEST 10: Rimozione nota (notes: "") → verifica rimozione esplicita ───
  console.log('▶ Test 10: rimozione nota (notes: "")');
  const r10 = await modificaPrenotazioneTool(tenant, {
    eventId, notes: '', source: 'telnyx_modify',
  });
  console.log(`  📄 success=${r10.success}`);
  assertTrue(r10.success === true, 'success = true');
  // Verifico direttamente nel DB che la nota sia stata svuotata
  const verify = await query(`SELECT notes FROM reservations WHERE id = $1`, [eventId]);
  const finalNotes = verify.rows[0].notes;
  console.log(`  📝 notes in DB: "${finalNotes}"`);
  assertTrue(finalNotes === '', 'notes DB = "" (rimossa esplicitamente)', `got: "${finalNotes}"`);
  console.log('');

  // ─── Cleanup finale ────────────────────────────────────────────────────────
  console.log('▶ Cleanup finale...');
  // Attenzione: al test 10 abbiamo svuotato le note, quindi il match TEST_MARKER
  // non le troverebbe. Uso l'ID direttamente.
  const cleanup = await query(`DELETE FROM reservations WHERE id = $1`, [eventId]);
  // E per sicurezza anche eventuali altre residuali:
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
