// ═══════════════════════════════════════════════════════════════════════════════
// TEST — richiedi_evento
// ═══════════════════════════════════════════════════════════════════════════════
// Esegui:  node backend/tests/test-richiedi-evento.js
//
// Scenari:
//   1. Richiesta evento 50 pax → success, PENDING_OWNER
//   2. Richiesta evento 80 pax con email → success + email job in coda
//   3. Verifica DB: status=PENDING_OWNER, is_group=true, notes prefissato "EVENTO"
//   4. Verifica coda sync_jobs: email_owner_notify presente
//   5. Persone sotto soglia (30) → below_event_threshold
//   6. Parametri mancanti → invalid_params
// ═══════════════════════════════════════════════════════════════════════════════

import 'dotenv/config';
import { closePool, query } from '../db.js';
import { getTenantByPhone, invalidateTenantCache } from '../services/tenants.js';
import { richiediEventoTool } from '../tools/richiedi-evento.js';

const OSTERIA_TEST_PHONE = '+390299223311';
const TEST_MARKER = 'TEST_SMOKE_EVENTO';

function nextSaturday() {
  const now = new Date();
  const day = now.getUTCDay();
  const daysUntilSat = (6 - day + 7) % 7 || 7;
  return new Date(now.getTime() + daysUntilSat * 86400000).toISOString().substring(0, 10);
}

let passed = 0;
let failed = 0;

function assertTrue(cond, testName, extraInfo = '') {
  if (cond) { console.log(`  ✅ PASS: ${testName}`); passed++; }
  else      { console.log(`  ❌ FAIL: ${testName} ${extraInfo}`); failed++; }
}

async function runTests() {
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  🧪 TEST — richiedi_evento                                       ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  await invalidateTenantCache(OSTERIA_TEST_PHONE);
  const tenant = await getTenantByPhone(OSTERIA_TEST_PHONE);
  if (!tenant?.id) {
    console.error('❌ Tenant non trovato');
    await closePool();
    process.exit(1);
  }
  console.log(`Tenant: "${tenant.restaurantName}" (id=${String(tenant.id).substring(0, 8)}...)`);
  console.log(`Event threshold: ${tenant.eventThreshold} persone`);
  console.log(`Owner email: ${tenant.owner_email || '(non configurata)'}\n`);

  const saturday = nextSaturday();

  // ─── Cleanup pre-test ──────────────────────────────────────────────────────
  console.log('▶ Cleanup precedente...');
  await query(
    `DELETE FROM reservations WHERE tenant_id = $1 AND notes LIKE $2`,
    [tenant.id, `%${TEST_MARKER}%`]
  );
  console.log('');

  // ─── TEST 1: Richiesta evento 50 pax ───────────────────────────────────────
  console.log('▶ Test 1: richiesta evento 50 pax sabato 20:00');
  const t1_start = Date.now();
  const r1 = await richiediEventoTool(tenant, {
    nome: 'Rossi',
    persone: 50,
    data: saturday,
    ora: '20:00',
    telefono: '+393385354671',
    notes: `${TEST_MARKER} — compleanno`,
    source: 'telnyx_event',
  });
  const t1_ms = Date.now() - t1_start;
  console.log(`  ⏱  ${t1_ms}ms`);
  console.log(`  📄 success=${r1.success}, stato=${r1.stato}, persone=${r1.persone}, eventId=${r1.eventId?.substring(0,8)}...`);
  assertTrue(r1.success === true, 'success = true');
  assertTrue(r1.richiesta_inviata === true, 'richiesta_inviata = true');
  assertTrue(r1.stato === 'PENDING_OWNER', 'stato = PENDING_OWNER', `got: ${r1.stato}`);
  assertTrue(r1.persone === 50, 'persone = 50');
  assertTrue(r1.data && r1.data.includes('sabato'), 'data formattata italiana');
  assertTrue(t1_ms < 500, 'Latenza <500ms', `${t1_ms}ms`);
  const eventId1 = r1.eventId;
  console.log('');

  // ─── TEST 2: Richiesta evento 80 pax con email ─────────────────────────────
  console.log('▶ Test 2: richiesta evento 80 pax CON email cliente');
  const r2 = await richiediEventoTool(tenant, {
    nome: 'Bianchi',
    persone: 80,
    data: saturday,
    ora: '20:00',
    telefono: '+393887654321',
    email: 'bianchi@example.com',
    notes: `${TEST_MARKER} — matrimonio`,
    source: 'telnyx_event',
  });
  console.log(`  📄 success=${r2.success}, stato=${r2.stato}, persone=${r2.persone}`);
  assertTrue(r2.success === true, 'success = true');
  assertTrue(r2.persone === 80, 'persone = 80');
  const eventId2 = r2.eventId;
  console.log('');

  // ─── TEST 3: Verifica DB — status, is_group, notes ─────────────────────────
  console.log('▶ Test 3: verifica DB stato');
  const dbCheck = await query(
    `SELECT status, is_group, notes, email FROM reservations WHERE id = $1`,
    [eventId1]
  );
  const row = dbCheck.rows[0];
  console.log(`  📄 status=${row.status}, is_group=${row.is_group}, notes="${row.notes}"`);
  assertTrue(row.status === 'PENDING_OWNER', 'status = PENDING_OWNER');
  assertTrue(row.is_group === true, 'is_group = true');
  assertTrue(row.notes.startsWith('EVENTO'), 'notes prefissato con "EVENTO"', `got: "${row.notes}"`);
  console.log('');

  // ─── TEST 4: Verifica sync_jobs (email_owner_notify) ───────────────────────
  console.log('▶ Test 4: verifica coda sync_jobs — email owner + email cliente');
  const jobs1 = await query(
    `SELECT job_type, status FROM sync_jobs WHERE reservation_id = $1 ORDER BY created_at`,
    [eventId1]
  );
  const jobs2 = await query(
    `SELECT job_type, status FROM sync_jobs WHERE reservation_id = $1 ORDER BY created_at`,
    [eventId2]
  );
  console.log(`  📄 evento1 jobs: [${jobs1.rows.map(j => j.job_type).join(', ')}]`);
  console.log(`  📄 evento2 jobs (con email): [${jobs2.rows.map(j => j.job_type).join(', ')}]`);

  // Test 1: se owner_email è configurato, deve esserci email_owner_notify
  if (tenant.owner_email && tenant.owner_email !== 'placeholder@example.com') {
    assertTrue(
      jobs1.rows.some(j => j.job_type === 'email_owner_notify'),
      'evento1: email_owner_notify presente in coda'
    );
  } else {
    console.log('  ⏭  SKIP: owner_email non configurato (placeholder)');
  }

  // Test 2: ha email cliente → deve avere email_confirmation
  assertTrue(
    jobs2.rows.some(j => j.job_type === 'email_confirmation'),
    'evento2 (con email): email_confirmation presente in coda'
  );
  console.log('');

  // ─── TEST 5: Persone sotto soglia ──────────────────────────────────────────
  console.log(`▶ Test 5: persone sotto soglia (30 < ${tenant.eventThreshold})`);
  const r5 = await richiediEventoTool(tenant, {
    nome: 'Verdi',
    persone: 30,
    data: saturday,
    ora: '20:00',
    telefono: '+393329988776',
    notes: TEST_MARKER,
    source: 'telnyx_event',
  });
  console.log(`  📄 success=${r5.success}, reason=${r5.reason}`);
  assertTrue(r5.success === false, 'success = false');
  assertTrue(r5.reason === 'below_event_threshold', 'reason = below_event_threshold', `got: ${r5.reason}`);
  console.log('');

  // ─── TEST 6: Parametri mancanti ────────────────────────────────────────────
  console.log('▶ Test 6: parametri mancanti (senza nome)');
  const r6 = await richiediEventoTool(tenant, {
    persone: 60,
    data: saturday,
    ora: '20:00',
    telefono: '+393000000000',
    source: 'telnyx_event',
  });
  console.log(`  📄 success=${r6.success}, reason=${r6.reason}`);
  assertTrue(r6.success === false, 'success = false');
  assertTrue(r6.reason === 'parametri_invalidi', 'reason = parametri_invalidi', `got: ${r6.reason}`);
  console.log('');

  // ─── Cleanup finale ────────────────────────────────────────────────────────
  console.log('▶ Cleanup finale...');
  const cleanup = await query(
    `DELETE FROM reservations WHERE tenant_id = $1 AND notes LIKE $2`,
    [tenant.id, `%${TEST_MARKER}%`]
  );
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
