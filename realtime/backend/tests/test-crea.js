// ═══════════════════════════════════════════════════════════════════════════════
// TEST — crea_prenotazione
// ═══════════════════════════════════════════════════════════════════════════════
// Esegui:  node backend/tests/test-crea.js
//
// Scenari testati:
//   1. Crea prenotazione normale (2 persone, venerdì cena) → CONFIRMED
//   2. Crea gruppo grande (11 persone) → PENDING_OWNER
//   3. Crea in giorno chiuso (lunedì) → esito day_closed
//   4. Crea fuori orario (alle 4 del mattino) → esito time_closed
//   5. Crea in data passata → esito in_past
//   6. Crea evento (45+ persone) → esito evento
//   7. Cleanup: cancella le prenotazioni di test create
//
// Ogni test misura il tempo di risposta. Obiettivo: <100ms per crea normale.
// ═══════════════════════════════════════════════════════════════════════════════

import 'dotenv/config';
import { closePool, query } from '../db.js';
import { getTenantByPhone } from '../services/tenants.js';
import { creaPrenotazioneTool } from '../tools/crea-prenotazione.js';

const OSTERIA_TEST_PHONE = '+390299223311';
const TEST_MARKER = 'TEST_SMOKE_CREA';   // per identificare (e pulire) le prenotazioni di test

// Trova venerdì prossimo (giorno della settimana = 5)
function nextFriday() {
  const now = new Date();
  const day = now.getUTCDay();  // 0=dom, 5=ven
  const daysUntilFriday = (5 - day + 7) % 7 || 7;
  const friday = new Date(now.getTime() + daysUntilFriday * 24 * 60 * 60 * 1000);
  return friday.toISOString().substring(0, 10);   // YYYY-MM-DD
}

// Trova lunedì prossimo (chiuso)
function nextMonday() {
  const now = new Date();
  const day = now.getUTCDay();
  const daysUntilMonday = (1 - day + 7) % 7 || 7;
  const monday = new Date(now.getTime() + daysUntilMonday * 24 * 60 * 60 * 1000);
  return monday.toISOString().substring(0, 10);
}

// Data passata (ieri)
function yesterday() {
  const y = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return y.toISOString().substring(0, 10);
}

let passed = 0;
let failed = 0;

function assertTrue(cond, testName, extraInfo = '') {
  if (cond) {
    console.log(`  ✅ PASS: ${testName}`);
    passed++;
  } else {
    console.log(`  ❌ FAIL: ${testName} ${extraInfo}`);
    failed++;
  }
}

async function runTests() {
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  🧪 TEST — crea_prenotazione                                     ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  const tenant = await getTenantByPhone(OSTERIA_TEST_PHONE);
  if (!tenant) {
    console.error('❌ Tenant Osteria Test non trovato. Aborting.');
    await closePool();
    process.exit(1);
  }
  console.log(`Tenant: "${tenant.restaurantName}" (id=${tenant.id.substring(0, 8)}...)\n`);

  const friday = nextFriday();
  const monday = nextMonday();
  const pastDate = yesterday();

  // ─── Cleanup pre-test ──────────────────────────────────────────────────────
  console.log('▶ Cleanup prenotazioni di test precedenti...');
  const cleanupResult = await query(
    `DELETE FROM reservations WHERE tenant_id = $1 AND notes = $2`,
    [tenant.id, TEST_MARKER]
  );
  console.log(`  🗑  ${cleanupResult.rowCount} prenotazioni di test rimosse\n`);

  // ─── TEST 1: crea normale (2 pax, venerdì 21:00) → CONFIRMED ───────────────
  console.log('▶ Test 1: crea normale — 2 persone venerdì 21:00');
  const t1_start = Date.now();
  const r1 = await creaPrenotazioneTool(tenant, {
    nome: 'Bianchi Test',
    persone: 2,
    data: friday,
    ora: '21:00:00',
    telefono: '+393385354671',
    notes: TEST_MARKER,
    source: 'telnyx',
  });
  const t1_ms = Date.now() - t1_start;
  console.log(`  ⏱  ${t1_ms}ms`);
  console.log(`  📄 ${JSON.stringify(r1, null, 2).substring(0, 300)}`);
  assertTrue(r1.creata === true, 'Crea = true');
  assertTrue(r1.stato === 'CONFIRMED', 'Stato = CONFIRMED', `got: ${r1.stato}`);
  assertTrue(r1.persone === 2, 'Persone = 2', `got: ${r1.persone}`);
  assertTrue(r1.data && r1.data.includes('venerdì'), 'Data formattata italiana');
  assertTrue(r1.ora === '21:00', 'Ora = 21:00', `got: ${r1.ora}`);
  assertTrue(t1_ms < 500, 'Latenza <500ms', `${t1_ms}ms`);
  console.log('');

  // ─── TEST 2: gruppo grande (11 pax) → PENDING_OWNER ────────────────────────
  console.log('▶ Test 2: gruppo grande — 11 persone venerdì 21:00 (secondo slot)');
  const r2 = await creaPrenotazioneTool(tenant, {
    nome: 'Rossi Gruppo Grande',
    persone: 11,
    data: friday,
    ora: '21:00:00',
    telefono: '+393385354671',
    notes: TEST_MARKER,
    source: 'telnyx',
  });
  console.log(`  📄 stato=${r2.stato}, is_group=${r2.is_group}, creata=${r2.creata}`);
  assertTrue(r2.creata === true, 'Crea = true');
  assertTrue(r2.stato === 'PENDING_OWNER', 'Stato = PENDING_OWNER', `got: ${r2.stato}`);
  assertTrue(r2.is_group === true, 'is_group = true');
  console.log('');

  // ─── TEST 3: giorno chiuso (lunedì) ────────────────────────────────────────
  console.log('▶ Test 3: giorno chiuso — lunedì');
  const r3 = await creaPrenotazioneTool(tenant, {
    nome: 'Verdi Lunedi',
    persone: 2,
    data: monday,
    ora: '21:00:00',
    telefono: '+393385354671',
    notes: TEST_MARKER,
    source: 'telnyx',
  });
  console.log(`  📄 creata=${r3.creata}, motivo=${r3.motivo}`);
  assertTrue(r3.creata === false, 'Crea = false (giorno chiuso)');
  assertTrue(r3.motivo === 'giorno_chiuso', 'Motivo = giorno_chiuso', `got: ${r3.motivo}`);
  console.log('');

  // ─── TEST 4: fuori orario ──────────────────────────────────────────────────
  console.log('▶ Test 4: fuori orario — venerdì 04:00');
  const r4 = await creaPrenotazioneTool(tenant, {
    nome: 'Neri Notturno',
    persone: 2,
    data: friday,
    ora: '04:00:00',
    telefono: '+393385354671',
    notes: TEST_MARKER,
    source: 'telnyx',
  });
  console.log(`  📄 creata=${r4.creata}, motivo=${r4.motivo}`);
  assertTrue(r4.creata === false, 'Crea = false (fuori orario)');
  assertTrue(r4.motivo === 'fuori_orario', 'Motivo = fuori_orario', `got: ${r4.motivo}`);
  console.log('');

  // ─── TEST 5: data passata ──────────────────────────────────────────────────
  console.log('▶ Test 5: data passata — ieri');
  const r5 = await creaPrenotazioneTool(tenant, {
    nome: 'Blu Passato',
    persone: 2,
    data: pastDate,
    ora: '21:00:00',
    telefono: '+393385354671',
    notes: TEST_MARKER,
    source: 'telnyx',
  });
  console.log(`  📄 creata=${r5.creata}, motivo=${r5.motivo}`);
  assertTrue(r5.creata === false, 'Crea = false (data passata)');
  assertTrue(r5.motivo === 'data_passata', 'Motivo = data_passata', `got: ${r5.motivo}`);
  console.log('');

  // ─── TEST 6: evento (45+ persone) ──────────────────────────────────────────
  console.log('▶ Test 6: evento — 50 persone');
  const r6 = await creaPrenotazioneTool(tenant, {
    nome: 'Evento Compleanno',
    persone: 50,
    data: friday,
    ora: '21:00:00',
    telefono: '+393385354671',
    notes: TEST_MARKER,
    source: 'telnyx',
  });
  console.log(`  📄 creata=${r6.creata}, motivo=${r6.motivo}`);
  assertTrue(r6.creata === false, 'Crea = false (evento)');
  assertTrue(r6.motivo === 'evento', 'Motivo = evento', `got: ${r6.motivo}`);
  console.log('');

  // ─── Cleanup post-test ─────────────────────────────────────────────────────
  console.log('▶ Cleanup finale...');
  const finalCleanup = await query(
    `DELETE FROM reservations WHERE tenant_id = $1 AND notes = $2`,
    [tenant.id, TEST_MARKER]
  );
  console.log(`  🗑  ${finalCleanup.rowCount} prenotazioni di test rimosse\n`);

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
