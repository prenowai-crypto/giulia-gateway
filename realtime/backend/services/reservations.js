// ═══════════════════════════════════════════════════════════════════════════════
// RESERVATIONS SERVICE — CRUD prenotazioni
// ═══════════════════════════════════════════════════════════════════════════════
// Per ora solo create(). Nei prossimi step aggiungiamo find(), update(), cancel().
//
// Ogni operazione:
//   - È transazionale (BEGIN/COMMIT/ROLLBACK)
//   - Scrive un audit log (reservation_audit_log)
//   - Enqueue di job asincroni per Google Calendar / Gmail / Sheet mirror
//     (i job vengono processati dai worker separati — vediamo dopo)
// ═══════════════════════════════════════════════════════════════════════════════

import { query, withTransaction } from '../db.js';
import { checkAvailability } from './availability.js';

// ─── Helpers ───────────────────────────────────────────────────────────────────

// Normalizza time: "21:00" → "21:00:00" (formato TIME di Postgres)
function normalizeTime(timeStr) {
  const s = String(timeStr).trim();
  if (s.match(/^\d{2}:\d{2}$/)) return `${s}:00`;
  return s;
}

// Determina status in base a persone + soglia
function determineStatus(people, largeGroupThreshold) {
  return people > largeGroupThreshold ? 'PENDING_OWNER' : 'CONFIRMED';
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * createReservation(tenant, params)
 *
 * Crea una nuova prenotazione.
 *
 * Flusso:
 *   1. checkAvailability() per validare (respinge se in_past/day_closed/slot_full)
 *   2. Determina status (CONFIRMED o PENDING_OWNER)
 *   3. INSERT in reservations + audit_log in transazione
 *   4. Enqueue job Calendar sync + Email confirmation (async, non blocca)
 *   5. Ritorna la reservation creata
 *
 * @param {object} tenant   - dalla getTenantByPhone()
 * @param {object} params   - { date, time, people, name, phone?, email?, notes?, source, callId?, callerPhone? }
 * @returns {Promise<{success: boolean, reservation?: object, esito?: string, ...}>}
 */
export async function createReservation(tenant, params) {
  const {
    date, time, people, name,
    phone, email, notes, area_preferita,
    source = 'telnyx',
    callId, callerPhone,
  } = params;

  // Validazione base
  if (!tenant) throw new Error('createReservation: tenant mancante');
  if (!date || !time || !people || !name) {
    return {
      success: false,
      esito: 'invalid_params',
      message: 'Data, ora, persone e nome sono obbligatori'
    };
  }
  if (people <= 0 || people > 200) {
    return { success: false, esito: 'invalid_people', message: 'Numero persone non valido' };
  }

  // ─── Step 1: check availability ────────────────────────────────────────────
  const avail = await checkAvailability(tenant, {
    date,
    time,
    people: Number(people),
  });

  // Se lo slot non è libero (né 'libero' né 'gruppo_grande'), respingi
  if (avail.esito !== 'libero' && avail.esito !== 'gruppo_grande') {
    return {
      success: false,
      esito: avail.esito,
      message: avail.message || `slot non disponibile: ${avail.esito}`,
      details: avail,
    };
  }

  // ─── Step 2: determina status e is_group ───────────────────────────────────
  const largeGroupThreshold = Number(tenant.largeGroupThreshold) || 10;
  const isGroup = Number(people) > largeGroupThreshold;
  const status = determineStatus(Number(people), largeGroupThreshold);
  const normalizedTime = normalizeTime(time);

  // ─── Step 3: INSERT in transazione ─────────────────────────────────────────
  const insertedRow = await withTransaction(async (client) => {
    // Insert reservation
    const insertResult = await client.query(
      `INSERT INTO reservations (
         tenant_id, date, time, people, name, phone, email, notes, area_preferita,
         status, is_group, source, email_status
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id, tenant_id, date, time, people, name, phone, email, notes,
                 status, is_group, source, created_at, email_status`,
      [
        tenant.id,
        date,
        normalizedTime,
        Number(people),
        String(name).trim(),
        phone || null,
        email || null,
        notes || '',
        area_preferita || null,
        status,
        isGroup,
        source,
        email ? 'PENDING' : 'NO_EMAIL',
      ]
    );
    const reservation = insertResult.rows[0];

    // Insert audit log (fire-and-forget non lo facciamo — è dentro transazione)
    await client.query(
      `INSERT INTO reservation_audit_log (
         tenant_id, reservation_id, action, source, after_data, caller_phone, call_id
       )
       VALUES ($1, $2, 'create', $3, $4, $5, $6)`,
      [
        tenant.id,
        reservation.id,
        source,
        JSON.stringify({
          date, time: normalizedTime, people: Number(people), name,
          phone, email, notes, status, is_group: isGroup,
        }),
        callerPhone || phone || null,
        callId || null,
      ]
    );

    // Enqueue Google Calendar sync (non blocca, il worker lo processa)
    if (tenant.google_calendar_id) {
      await client.query(
        `INSERT INTO sync_jobs (tenant_id, reservation_id, job_type, payload)
         VALUES ($1, $2, 'calendar_create', $3)`,
        [
          tenant.id,
          reservation.id,
          JSON.stringify({ calendarId: tenant.google_calendar_id }),
        ]
      );
    }

    // Enqueue email confirmation se presente
    if (email) {
      await client.query(
        `INSERT INTO sync_jobs (tenant_id, reservation_id, job_type, payload)
         VALUES ($1, $2, 'email_confirmation', $3)`,
        [
          tenant.id,
          reservation.id,
          JSON.stringify({ to: email, name, date, time: normalizedTime, people }),
        ]
      );
    }

    // Enqueue Sheet mirror (per il ristoratore che guarda ancora il Sheet)
    if (tenant.google_sheet_id) {
      await client.query(
        `INSERT INTO sync_jobs (tenant_id, reservation_id, job_type, payload)
         VALUES ($1, $2, 'sheet_mirror', $3)`,
        [tenant.id, reservation.id, JSON.stringify({ sheetId: tenant.google_sheet_id })]
      );
    }

    return reservation;
  });

  return {
    success: true,
    esito: 'creata',
    reservation: insertedRow,
    status,
    is_group: isGroup,
  };
}
