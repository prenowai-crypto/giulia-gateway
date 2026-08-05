// ═══════════════════════════════════════════════════════════════════════════════
// RESERVATIONS SERVICE — CRUD prenotazioni
// ═══════════════════════════════════════════════════════════════════════════════
// Funzioni implementate:
//   ✅ createReservation()  — crea nuova
//   ✅ findReservations()   — cerca per nome/data/telefono (fuzzy name match)
//   ✅ updateReservation()  — partial update (aggiorna solo campi passati)
//   ⏳ cancelReservation()  — [prossimo]
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

// Normalizza il campo `date` (che da Postgres arriva come Date object)
// in stringa YYYY-MM-DD per confronti e output
function dateToIsoString(d) {
  if (!d) return null;
  if (d instanceof Date) return d.toISOString().substring(0, 10);
  return String(d).substring(0, 10);
}

// Normalizza il campo `time` (da Postgres arriva come stringa "HH:MM:SS")
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

  let result;
  try {
    result = await query(sql, values);
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
  return {
    success: true,
    esito: limited.length > 0 ? 'trovate' : 'non_trovate',
    reservations: limited,
    count: limited.length,
    total_matches: rows.length,
  };
}

// ─── updateReservation ─────────────────────────────────────────────────────────

/**
 * updateReservation(tenant, reservationId, params)
 *
 * Aggiorna una prenotazione esistente con PARTIAL UPDATE:
 * - Solo i campi passati in `params` vengono aggiornati.
 * - Se `params.notes === ""` (stringa vuota esplicita), la nota viene rimossa.
 * - Se `params.notes === undefined/null`, la nota corrente resta.
 *
 * Flusso:
 *   1. SELECT prenotazione esistente (LOCK FOR UPDATE)
 *   2. Merge dei campi: se params.X è definito, usa quello; altrimenti tieni il corrente
 *   3. Se cambia date/time/people: chiama checkAvailability escludendo self
 *   4. Ricalcola status (potrebbe cambiare CONFIRMED ↔ PENDING_OWNER)
 *   5. UPDATE + audit log + enqueue email se cambiato in modo rilevante
 *
 * @param {object} tenant
 * @param {string} reservationId  - UUID Postgres della prenotazione
 * @param {object} params         - campi da aggiornare (parziali)
 * @param {object} meta           - { callId, callerPhone, source }
 * @returns {Promise<{success, reservation?, esito?, message?}>}
 */
export async function updateReservation(tenant, reservationId, params, meta = {}) {
  if (!tenant) throw new Error('updateReservation: tenant mancante');
  if (!reservationId) {
    return { success: false, esito: 'missing_id', message: 'reservation_id richiesto' };
  }

  const source = meta.source || 'telnyx_modify';
  const callId = meta.callId || null;
  const callerPhone = meta.callerPhone || null;

  // ─── Step 1: leggi la prenotazione esistente ───────────────────────────────
  // NB: uso SELECT semplice fuori dalla transazione perché in Postgres è veloce
  // e riduce il tempo del lock. Il LOCK vero è dentro la transazione poi.
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
      success: false,
      esito: 'not_found',
      message: `Prenotazione ${reservationId.substring(0, 8)}... non trovata o cancellata`
    };
  }

  const existing = existingResult.rows[0];
  const existingDate = dateToIsoString(existing.date);
  const existingTime = timeToHHMM(existing.time);
  const existingPeople = Number(existing.people);

  // ─── Step 2: merge campi ───────────────────────────────────────────────────
  // Partial update: se il campo è passato (non undefined/null) uso quello, altrimenti tengo il corrente.
  // Eccezione: params.notes = "" è considerato ESPLICITO (rimozione nota), diverso da undefined.

  const merged = {
    date:            (params.date !== undefined && params.date !== null && params.date !== '') ? params.date : existingDate,
    time:            (params.time !== undefined && params.time !== null && params.time !== '') ? params.time : existingTime,
    people:          (params.people !== undefined && params.people !== null && Number(params.people) > 0) ? Number(params.people) : existingPeople,
    name:            (params.name !== undefined && params.name !== null && String(params.name).trim() !== '') ? String(params.name).trim() : existing.name,
    phone:           (params.phone !== undefined) ? params.phone : existing.phone,
    email:           (params.email !== undefined) ? params.email : existing.email,
    // Note ha logica speciale: "" (stringa vuota) è rimozione esplicita
    notes:           (params.notes !== undefined && params.notes !== null) ? String(params.notes) : (existing.notes || ''),
    area_preferita:  (params.area_preferita !== undefined) ? params.area_preferita : existing.area_preferita,
  };

  // ─── Step 3: se cambia date/time/people, ricontrolla disponibilità ─────────
  const changingSlot = (merged.date !== existingDate) || (merged.time !== existingTime) || (merged.people !== existingPeople);

  if (changingSlot) {
    const avail = await checkAvailability(tenant, {
      date: merged.date,
      time: merged.time,
      people: merged.people,
      excludeReservationId: reservationId,   // ← escludi self!
    });

    if (avail.esito !== 'libero' && avail.esito !== 'gruppo_grande') {
      return {
        success: false,
        esito: avail.esito,
        message: avail.message || `Modifica non possibile: ${avail.esito}`,
        details: avail,
      };
    }
  }

  // ─── Step 4: ricalcola status ──────────────────────────────────────────────
  const largeGroupThreshold = Number(tenant.largeGroupThreshold) || 10;
  const newIsGroup = merged.people > largeGroupThreshold;
  const newStatus = determineStatus(merged.people, largeGroupThreshold);
  const normalizedTime = normalizeTime(merged.time);

  // ─── Step 5: UPDATE in transazione ─────────────────────────────────────────
  const updatedRow = await withTransaction(async (client) => {
    // Prendo il lock su questa riga (evita race condition)
    const lockResult = await client.query(
      `SELECT id FROM reservations WHERE id = $1 FOR UPDATE`,
      [reservationId]
    );
    if (lockResult.rows.length === 0) {
      throw new Error(`Reservation ${reservationId} vanished during update`);
    }

    // UPDATE
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

    // Audit log
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

    // Enqueue email di aggiornamento se ha email e ci sono cambi significativi
    // (data, ora o persone). Cambi solo di note NON generano email.
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
    success: true,
    esito: 'aggiornata',
    reservation: updatedRow,
    status: newStatus,
    is_group: newIsGroup,
    changed_slot: changingSlot,
  };
}
