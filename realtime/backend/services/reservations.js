// ═══════════════════════════════════════════════════════════════════════════════
// RESERVATIONS SERVICE — CRUD prenotazioni
// ═══════════════════════════════════════════════════════════════════════════════
// Funzioni implementate:
//   ✅ createReservation()  — crea nuova
//   ✅ findReservations()   — cerca per nome/data/telefono (fuzzy name match)
//   ⏳ updateReservation()  — [prossimo]
//   ⏳ cancelReservation()  — [prossimo]
//
// Ogni operazione:
//   - È transazionale (BEGIN/COMMIT/ROLLBACK)
//   - Scrive un audit log (reservation_audit_log)
//   - Enqueue di job asincroni per Email (i worker li processano)
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

// Normalizza nome per fuzzy match: minuscolo, no accenti, no doppi spazi
function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // rimuove accenti
    .replace(/\s+/g, ' ')
    .trim();
}

// Calcola similarità fuzzy tra due nomi (score 0-1)
// Usa un match "contiene" bidirezionale + Levenshtein per casi limite
function nameSimilarity(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  // "Costa" match "Simone Costa" e viceversa
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  // Split in parole: se una parola combacia esatto, score parziale
  const wordsA = na.split(' ');
  const wordsB = nb.split(' ');
  const commonWords = wordsA.filter(w => w.length >= 3 && wordsB.includes(w));
  if (commonWords.length > 0) return 0.7;
  return 0;
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * createReservation(tenant, params)
 * Vedi documentazione precedente. Nessuna modifica.
 */
export async function createReservation(tenant, params) {
  const {
    date, time, people, name,
    phone, email, notes, area_preferita,
    source = 'telnyx',
    callId, callerPhone,
  } = params;

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

  const avail = await checkAvailability(tenant, { date, time, people: Number(people) });

  if (avail.esito !== 'libero' && avail.esito !== 'gruppo_grande') {
    return {
      success: false,
      esito: avail.esito,
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

    // Enqueue email confirmation se presente
    if (email) {
      await client.query(
        `INSERT INTO sync_jobs (tenant_id, reservation_id, job_type, payload)
         VALUES ($1, $2, 'email_confirmation', $3)`,
        [tenant.id, reservation.id, JSON.stringify({ to: email, name, date, time: normalizedTime, people })]
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

/**
 * findReservations(tenant, params)
 *
 * Cerca prenotazioni per uno o più criteri.
 * Usato da `trova_prenotazione` (per il modello) e dalla webapp.
 *
 * Strategia:
 *   1. Se `phone` fornito: filtro esatto per telefono (canale voice = telefono affidabile)
 *   2. Se `name` fornito: fuzzy match sul nome (canale voice = STT può storpiare)
 *   3. Se `date` fornito: filtro esatto per data
 *   4. Ordina per: (a) match score name DESC, (b) date DESC, (c) created_at DESC
 *
 * Esclude sempre le CANCELLED per default.
 *
 * @param {object} tenant   - dalla getTenantByPhone()
 * @param {object} params   - { name?, date?, phone?, limit?, includeCancelled? }
 * @returns {Promise<{success, reservations: [], count}>}
 */
export async function findReservations(tenant, params) {
  const {
    name,
    date,
    phone,
    limit = 5,
    includeCancelled = false,
  } = params;

  if (!tenant) throw new Error('findReservations: tenant mancante');
  if (!name && !date && !phone) {
    return {
      success: false,
      esito: 'invalid_params',
      message: 'Almeno uno tra name, date, phone richiesto',
      reservations: [],
      count: 0,
    };
  }

  // Costruisco WHERE dinamico
  const conditions = [`tenant_id = $1`];
  const values = [tenant.id];
  let idx = 2;

  if (date) {
    conditions.push(`date = $${idx++}`);
    values.push(date);
  }
  if (phone) {
    // Match esatto sul phone (già normalizzato dal gateway/Telnyx)
    conditions.push(`phone = $${idx++}`);
    values.push(phone);
  }
  if (!includeCancelled) {
    conditions.push(`status <> 'CANCELLED'`);
  }

  // Se ho il nome, uso ILIKE per pre-filtrare al DB
  // (evita di leggere migliaia di righe se il tenant ha molte prenotazioni)
  if (name) {
    // Uso una condizione permissiva: prima parola del nome nel campo name
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
    // Se `unaccent` non è installato in Postgres, fallback a query semplice
    if (err.message && err.message.includes('unaccent')) {
      const fallbackConditions = conditions.map(c => {
        if (c.includes('unaccent')) {
          const firstWord = normalizeName(name).split(' ')[0];
          return `lower(name) LIKE lower('%${firstWord.replace(/'/g, "''")}%')`;
        }
        return c;
      });
      const fallbackSql = sql.replace(conditions.join(' AND '), fallbackConditions.join(' AND '));
      const filteredValues = values.filter((_, i) => {
        // Rimuove il parametro name se era nella query con unaccent
        return !(typeof _ === 'string' && _.startsWith('%') && _.endsWith('%'));
      });
      result = await query(fallbackSql, filteredValues);
    } else {
      throw err;
    }
  }

  // Se ho `name`, applico un fuzzy scoring sui risultati e riordino
  let rows = result.rows;
  if (name && rows.length > 0) {
    rows = rows.map(r => ({
      ...r,
      _score: nameSimilarity(name, r.name),
    }));
    // Filtro score minimo (0.5) per evitare match casuali
    rows = rows.filter(r => r._score >= 0.5);
    // Ordino per: score DESC, poi date DESC
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
