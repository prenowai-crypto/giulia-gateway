// ═══════════════════════════════════════════════════════════════════════════════
// RESERVATIONS SERVICE — CRUD prenotazioni
// ═══════════════════════════════════════════════════════════════════════════════
// Funzioni implementate:
//   ✅ createReservation()   — crea nuova
//   ✅ findReservations()    — cerca per nome/data/telefono (fuzzy name match)
//   ✅ updateReservation()   — partial update
//   ✅ cancelReservation()   — soft delete (status=CANCELLED)
//   ✅ requestBigEvent()     — richiesta per gruppi >= event_threshold
// ═══════════════════════════════════════════════════════════════════════════════

import { query, withTransaction } from '../db.js';
import { checkAvailability } from './availability.js';

// ─── Helpers ───────────────────────────────────────────────────────────────────

function normalizeTime(timeStr) {
  const s = String(timeStr).trim();
  if (s.match(/^\d{2}:\d{2}$/)) return `${s}:00`;
  return s;
}

function determineStatus(people, largeGroupThreshold) {
  return people > largeGroupThreshold ? 'PENDING_OWNER' : 'CONFIRMED';
}

function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameSimilarity(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  const wordsA = na.split(' ');
  const wordsB = nb.split(' ');
  const commonWords = wordsA.filter(w => w.length >= 3 && wordsB.includes(w));
  if (commonWords.length > 0) return 0.7;
  return 0;
}

function dateToIsoString(d) {
  if (!d) return null;
  if (d instanceof Date) return d.toISOString().substring(0, 10);
  return String(d).substring(0, 10);
}

function timeToHHMM(t) {
  if (!t) return null;
  if (t instanceof Date) {
    return `${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}`;
  }
  return String(t).substring(0, 5);
}

// ─── Public API ────────────────────────────────────────────────────────────────

export async function createReservation(tenant, params) {
  const {
    date, time, people, name,
    phone, email, notes, area_preferita,
    source = 'telnyx',
    callId, callerPhone,
  } = params;

  if (!tenant) throw new Error('createReservation: tenant mancante');
  if (!date || !time || !people || !name) {
    return { success: false, esito: 'invalid_params', message: 'Data, ora, persone e nome sono obbligatori' };
  }
  if (people <= 0 || people > 200) {
    return { success: false, esito: 'invalid_people', message: 'Numero persone non valido' };
  }

  const avail = await checkAvailability(tenant, { date, time, people: Number(people) });
  if (avail.esito !== 'libero' && avail.esito !== 'gruppo_grande') {
    return {
      success: false, esito: avail.esito,
      message: avail.message || `slot non disponibile: ${avail.esito}`,
      details: avail,
    };
  }

  const largeGroupThreshold = Number(tenant.largeGroupThreshold) || 10;
  const isGroup = Number(people) > largeGroupThreshold;
  const status = determineStatus(Number(people), largeGroupThreshold);
  const normalizedTime = normalizeTime(time);

  const insertedRow = await withTransaction(async (client) => {
    const insertResult = await client.query(
      `INSERT INTO reservations (
         tenant_id, date, time, people, name, phone, email, notes, area_preferita,
         status, is_group, source, email_status
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id, tenant_id, date, time, people, name, phone, email, notes,
                 status, is_group, source, created_at, email_status`,
      [
        tenant.id, date, normalizedTime, Number(people),
        String(name).trim(), phone || null, email || null, notes || '', area_preferita || null,
        status, isGroup, source, email ? 'PENDING' : 'NO_EMAIL',
      ]
    );
    const reservation = insertResult.rows[0];

    await client.query(
      `INSERT INTO reservation_audit_log (
         tenant_id, reservation_id, action, source, after_data, caller_phone, call_id
       ) VALUES ($1, $2, 'create', $3, $4, $5, $6)`,
      [
        tenant.id, reservation.id, source,
        JSON.stringify({ date, time: normalizedTime, people: Number(people), name, phone, email, notes, status, is_group: isGroup }),
        callerPhone || phone || null, callId || null,
      ]
    );

    if (email) {
      await client.query(
        `INSERT INTO sync_jobs (tenant_id, reservation_id, job_type, payload)
         VALUES ($1, $2, 'email_confirmation', $3)`,
        [tenant.id, reservation.id, JSON.stringify({ to: email, name, date, time: normalizedTime, people })]
      );
    }

    return reservation;
  });

  return { success: true, esito: 'creata', reservation: insertedRow, status, is_group: isGroup };
}

// ─── findReservations ─────────────────────────────────────────────────────────

export async function findReservations(tenant, params) {
  const { name, date, phone, limit = 5, includeCancelled = false } = params;

  if (!tenant) throw new Error('findReservations: tenant mancante');
  if (!name && !date && !phone) {
    return { success: false, esito: 'invalid_params', message: 'Almeno uno tra name, date, phone richiesto', reservations: [], count: 0 };
  }

  const conditions = [`tenant_id = $1`];
  const values = [tenant.id];
  let idx = 2;

  if (date) {
    conditions.push(`date = $${idx++}`);
    values.push(date);
  }
  if (phone) {
    conditions.push(`phone = $${idx++}`);
    values.push(phone);
  }
  if (!includeCancelled) {
    conditions.push(`status <> 'CANCELLED'`);
  }
  if (name) {
    const firstWord = normalizeName(name).split(' ')[0];
    if (firstWord && firstWord.length >= 2) {
      conditions.push(`unaccent(lower(name)) LIKE unaccent(lower($${idx++}))`);
      values.push(`%${firstWord}%`);
    }
  }

  const sql = `
    SELECT id, tenant_id, date, time, people, name, phone, email, notes,
           status, is_group, source, created_at, updated_at, cancelled_at
      FROM reservations
     WHERE ${conditions.join(' AND ')}
     ORDER BY date DESC, time ASC, created_at DESC
     LIMIT ${Math.min(limit * 5, 100)}
  `;

  // v7.7.17-DEBUG: log tattico per capire perché trova_prenotazione non trova
  console.log('[findReservations DEBUG] tenant.id=', JSON.stringify(tenant?.id));
  console.log('[findReservations DEBUG] params=', JSON.stringify({name, date, phone, limit, includeCancelled}));
  console.log('[findReservations DEBUG] sql=', sql);
  console.log('[findReservations DEBUG] values=', JSON.stringify(values));

  let result;
  try {
    result = await query(sql, values);
    console.log('[findReservations DEBUG] rows=', result.rows.length);
  } catch (err) {
    if (err.message && err.message.includes('unaccent')) {
      const fallbackConditions = conditions.map(c => {
        if (c.includes('unaccent')) {
          const firstWord = normalizeName(name).split(' ')[0];
          return `lower(name) LIKE lower('%${firstWord.replace(/'/g, "''")}%')`;
        }
        return c;
      });
      const fallbackSql = sql.replace(conditions.join(' AND '), fallbackConditions.join(' AND '));
      const filteredValues = values.filter((v) => !(typeof v === 'string' && v.startsWith('%') && v.endsWith('%')));
      result = await query(fallbackSql, filteredValues);
    } else {
      throw err;
    }
  }

  let rows = result.rows;
  if (name && rows.length > 0) {
    rows = rows.map(r => ({ ...r, _score: nameSimilarity(name, r.name) }));
    rows = rows.filter(r => r._score >= 0.5);
    rows.sort((a, b) => {
      if (b._score !== a._score) return b._score - a._score;
      return new Date(b.date) - new Date(a.date);
    });
  }

  const limited = rows.slice(0, limit);
  console.log('[findReservations DEBUG] after filter rows=', rows.length, 'limited=', limited.length);
  return {
    success: true,
    esito: limited.length > 0 ? 'trovate' : 'non_trovate',
    reservations: limited,
    count: limited.length,
    total_matches: rows.length,
  };
}

// ─── updateReservation ─────────────────────────────────────────────────────────

export async function updateReservation(tenant, reservationId, params, meta = {}) {
  if (!tenant) throw new Error('updateReservation: tenant mancante');
  if (!reservationId) {
    return { success: false, esito: 'missing_id', message: 'reservation_id richiesto' };
  }

  const source = meta.source || 'telnyx_modify';
  const callId = meta.callId || null;
  const callerPhone = meta.callerPhone || null;

  const existingResult = await query(
    `SELECT id, tenant_id, date, time, people, name, phone, email, notes,
            area_preferita, status, is_group, source, created_at
       FROM reservations
      WHERE id = $1 AND tenant_id = $2 AND status <> 'CANCELLED'
      LIMIT 1`,
    [reservationId, tenant.id]
  );

  if (existingResult.rows.length === 0) {
    return {
      success: false, esito: 'not_found',
      message: `Prenotazione ${reservationId.substring(0, 8)}... non trovata o cancellata`
    };
  }

  const existing = existingResult.rows[0];
  const existingDate = dateToIsoString(existing.date);
  const existingTime = timeToHHMM(existing.time);
  const existingPeople = Number(existing.people);

  const merged = {
    date:            (params.date !== undefined && params.date !== null && params.date !== '') ? params.date : existingDate,
    time:            (params.time !== undefined && params.time !== null && params.time !== '') ? params.time : existingTime,
    people:          (params.people !== undefined && params.people !== null && Number(params.people) > 0) ? Number(params.people) : existingPeople,
    name:            (params.name !== undefined && params.name !== null && String(params.name).trim() !== '') ? String(params.name).trim() : existing.name,
    phone:           (params.phone !== undefined) ? params.phone : existing.phone,
    email:           (params.email !== undefined) ? params.email : existing.email,
    notes:           (params.notes !== undefined && params.notes !== null) ? String(params.notes) : (existing.notes || ''),
    area_preferita:  (params.area_preferita !== undefined) ? params.area_preferita : existing.area_preferita,
  };

  const changingSlot = (merged.date !== existingDate) || (merged.time !== existingTime) || (merged.people !== existingPeople);

  if (changingSlot) {
    const avail = await checkAvailability(tenant, {
      date: merged.date, time: merged.time, people: merged.people,
      excludeReservationId: reservationId,
    });

    if (avail.esito !== 'libero' && avail.esito !== 'gruppo_grande') {
      return {
        success: false, esito: avail.esito,
        message: avail.message || `Modifica non possibile: ${avail.esito}`,
        details: avail,
      };
    }
  }

  const largeGroupThreshold = Number(tenant.largeGroupThreshold) || 10;
  const newIsGroup = merged.people > largeGroupThreshold;
  const newStatus = determineStatus(merged.people, largeGroupThreshold);
  const normalizedTime = normalizeTime(merged.time);

  const updatedRow = await withTransaction(async (client) => {
    const lockResult = await client.query(`SELECT id FROM reservations WHERE id = $1 FOR UPDATE`, [reservationId]);
    if (lockResult.rows.length === 0) {
      throw new Error(`Reservation ${reservationId} vanished during update`);
    }

    const updateResult = await client.query(
      `UPDATE reservations
          SET date = $1, time = $2, people = $3, name = $4,
              phone = $5, email = $6, notes = $7, area_preferita = $8,
              status = $9, is_group = $10, updated_at = NOW()
        WHERE id = $11 AND tenant_id = $12
        RETURNING id, tenant_id, date, time, people, name, phone, email, notes,
                  status, is_group, source, created_at, updated_at`,
      [
        merged.date, normalizedTime, merged.people, merged.name,
        merged.phone, merged.email, merged.notes, merged.area_preferita,
        newStatus, newIsGroup,
        reservationId, tenant.id,
      ]
    );
    const updated = updateResult.rows[0];

    await client.query(
      `INSERT INTO reservation_audit_log (
         tenant_id, reservation_id, action, source, before_data, after_data,
         caller_phone, call_id
       ) VALUES ($1, $2, 'update', $3, $4, $5, $6, $7)`,
      [
        tenant.id, reservationId, source,
        JSON.stringify({
          date: existingDate, time: existingTime, people: existingPeople,
          name: existing.name, phone: existing.phone, email: existing.email,
          notes: existing.notes, status: existing.status, is_group: existing.is_group,
        }),
        JSON.stringify({
          date: merged.date, time: normalizedTime, people: merged.people,
          name: merged.name, phone: merged.phone, email: merged.email,
          notes: merged.notes, status: newStatus, is_group: newIsGroup,
        }),
        callerPhone || merged.phone || null,
        callId,
      ]
    );

    if (merged.email && changingSlot) {
      await client.query(
        `INSERT INTO sync_jobs (tenant_id, reservation_id, job_type, payload)
         VALUES ($1, $2, 'email_confirmation', $3)`,
        [
          tenant.id, reservationId,
          JSON.stringify({
            to: merged.email, name: merged.name,
            date: merged.date, time: normalizedTime, people: merged.people,
            update: true,
          }),
        ]
      );
    }

    return updated;
  });

  return {
    success: true, esito: 'aggiornata', reservation: updatedRow,
    status: newStatus, is_group: newIsGroup, changed_slot: changingSlot,
  };
}

// ─── cancelReservation ─────────────────────────────────────────────────────────

export async function cancelReservation(tenant, reservationId, meta = {}) {
  if (!tenant) throw new Error('cancelReservation: tenant mancante');
  if (!reservationId) {
    return { success: false, esito: 'missing_id', message: 'reservation_id richiesto' };
  }

  const source = meta.source || 'telnyx_cancel';
  const callId = meta.callId || null;
  const callerPhone = meta.callerPhone || null;
  const reason = meta.reason || 'customer_request';

  const existingResult = await query(
    `SELECT id, tenant_id, date, time, people, name, phone, email, notes,
            status, is_group, source, created_at
       FROM reservations
      WHERE id = $1 AND tenant_id = $2
      LIMIT 1`,
    [reservationId, tenant.id]
  );

  if (existingResult.rows.length === 0) {
    return {
      success: false, esito: 'not_found',
      message: `Prenotazione ${reservationId.substring(0, 8)}... non trovata`
    };
  }

  const existing = existingResult.rows[0];

  if (existing.status === 'CANCELLED') {
    return {
      success: true, esito: 'already_cancelled',
      reservation: existing,
      message: 'Prenotazione già cancellata',
    };
  }

  const cancelledRow = await withTransaction(async (client) => {
    await client.query(`SELECT id FROM reservations WHERE id = $1 FOR UPDATE`, [reservationId]);

    const updateResult = await client.query(
      `UPDATE reservations
          SET status = 'CANCELLED', cancelled_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2
        RETURNING id, tenant_id, date, time, people, name, phone, email, notes,
                  status, is_group, source, created_at, cancelled_at`,
      [reservationId, tenant.id]
    );
    const cancelled = updateResult.rows[0];

    await client.query(
      `INSERT INTO reservation_audit_log (
         tenant_id, reservation_id, action, source, before_data, after_data,
         caller_phone, call_id
       ) VALUES ($1, $2, 'cancel', $3, $4, $5, $6, $7)`,
      [
        tenant.id, reservationId, source,
        JSON.stringify({
          date: dateToIsoString(existing.date),
          time: timeToHHMM(existing.time),
          people: Number(existing.people),
          name: existing.name,
          status: existing.status,
        }),
        JSON.stringify({
          status: 'CANCELLED',
          cancelled_at: new Date().toISOString(),
          reason,
        }),
        callerPhone || existing.phone || null,
        callId,
      ]
    );

    if (existing.email) {
      await client.query(
        `INSERT INTO sync_jobs (tenant_id, reservation_id, job_type, payload)
         VALUES ($1, $2, 'email_cancellation', $3)`,
        [
          tenant.id, reservationId,
          JSON.stringify({
            to: existing.email,
            name: existing.name,
            date: dateToIsoString(existing.date),
            time: timeToHHMM(existing.time),
          }),
        ]
      );
    }

    return cancelled;
  });

  return {
    success: true,
    esito: 'cancellata',
    reservation: cancelledRow,
  };
}

// ─── requestBigEvent ───────────────────────────────────────────────────────────

/**
 * requestBigEvent(tenant, params)
 *
 * Registra una RICHIESTA di prenotazione per grandi eventi (>= event_threshold).
 * Non è una vera prenotazione — è un'espressione di interesse che il ristoratore
 * deve valutare offline (via email).
 *
 * Salvato come:
 *   - status = 'PENDING_OWNER'
 *   - is_group = true
 *   - notes = "EVENTO — [dettagli aggiuntivi]"
 *
 * NON fa checkAvailability perché gli eventi sono negoziati con il ristoratore.
 * NON blocca capacità per altre prenotazioni fino a conferma esplicita.
 *
 * Enqueue email al proprietario per notificare la richiesta.
 *
 * @param {object} tenant
 * @param {object} params  - { date, time, people, name, phone?, email?, notes? }
 * @param {object} meta    - { callId, callerPhone, source }
 * @returns {Promise<{success, reservation?, esito?, message?}>}
 */
export async function requestBigEvent(tenant, params, meta = {}) {
  const {
    date, time, people, name,
    phone, email, notes,
  } = params;

  const source = meta.source || 'telnyx_event';
  const callId = meta.callId || null;
  const callerPhone = meta.callerPhone || null;

  if (!tenant) throw new Error('requestBigEvent: tenant mancante');
  if (!date || !time || !people || !name) {
    return {
      success: false, esito: 'invalid_params',
      message: 'Data, ora, persone e nome sono obbligatori'
    };
  }
  if (people <= 0 || people > 500) {
    return { success: false, esito: 'invalid_people', message: 'Numero persone non valido' };
  }

  const eventThreshold = Number(tenant.eventThreshold) || 45;
  if (Number(people) < eventThreshold) {
    return {
      success: false,
      esito: 'below_event_threshold',
      message: `Per ${people} persone usa crea_prenotazione, non richiedi_evento. Soglia evento: ${eventThreshold}.`
    };
  }

  const normalizedTime = normalizeTime(time);
  const eventNotes = `EVENTO — ${notes || 'richiesta di grande gruppo'}`;

  const insertedRow = await withTransaction(async (client) => {
    const insertResult = await client.query(
      `INSERT INTO reservations (
         tenant_id, date, time, people, name, phone, email, notes,
         status, is_group, source, email_status
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id, tenant_id, date, time, people, name, phone, email, notes,
                 status, is_group, source, created_at`,
      [
        tenant.id, date, normalizedTime, Number(people),
        String(name).trim(), phone || null, email || null, eventNotes,
        'PENDING_OWNER',   // sempre pending per eventi
        true,              // sempre gruppo grande
        source,
        email ? 'PENDING' : 'NO_EMAIL',
      ]
    );
    const reservation = insertResult.rows[0];

    // Audit log
    await client.query(
      `INSERT INTO reservation_audit_log (
         tenant_id, reservation_id, action, source, after_data, caller_phone, call_id
       ) VALUES ($1, $2, 'create', $3, $4, $5, $6)`,
      [
        tenant.id, reservation.id, source,
        JSON.stringify({
          type: 'event_request',
          date, time: normalizedTime, people: Number(people), name, phone, email, notes: eventNotes,
          status: 'PENDING_OWNER',
        }),
        callerPhone || phone || null,
        callId,
      ]
    );

    // Enqueue email al PROPRIETARIO (non al cliente)
    // È il proprietario che deve valutare l'evento
    if (tenant.owner_email) {
      await client.query(
        `INSERT INTO sync_jobs (tenant_id, reservation_id, job_type, payload)
         VALUES ($1, $2, 'email_owner_notify', $3)`,
        [
          tenant.id, reservation.id,
          JSON.stringify({
            to: tenant.owner_email,
            type: 'event_request',
            customer_name: name,
            customer_phone: phone,
            customer_email: email,
            date, time: normalizedTime, people: Number(people),
            notes: notes || '',
          }),
        ]
      );
    }

    // Enqueue email al cliente se ha fornito email
    if (email) {
      await client.query(
        `INSERT INTO sync_jobs (tenant_id, reservation_id, job_type, payload)
         VALUES ($1, $2, 'email_confirmation', $3)`,
        [
          tenant.id, reservation.id,
          JSON.stringify({
            to: email, name, date, time: normalizedTime, people: Number(people),
            type: 'event_request',
          }),
        ]
      );
    }

    return reservation;
  });

  return {
    success: true,
    esito: 'richiesta_inviata',
    reservation: insertedRow,
    status: 'PENDING_OWNER',
  };
}
