// ═══════════════════════════════════════════════════════════════════════════════
// AVAILABILITY SERVICE — Check disponibilità slot
// ═══════════════════════════════════════════════════════════════════════════════
// Business logic (identica a quella di Apps Script attuale):
//
//   Uno slot è definito da (data, ora, slot_minutes). Ogni prenotazione occupa
//   uno slot temporale. Due slot si sovrappongono se il loro intervallo
//   temporale ha intersezione.
//
//   Esempio: slot_minutes = 90
//     Prenotazione A: 21:00 → 22:30
//     Prenotazione B: 21:45 → 23:15   ← si sovrappone con A
//     Prenotazione C: 22:30 → 24:00   ← NON si sovrappone (bordo esatto)
//
//   La capacità dello slot è total_seats (default 30 per Osteria Test).
//   Contiamo solo prenotazioni CONFIRMED e PENDING_OWNER (non CANCELLED).
//
// Esiti possibili:
//   - 'libero': slot disponibile
//   - 'slot_full': overbooking
//   - 'day_closed': giorno di chiusura settimanale
//   - 'closure': chiusura straordinaria (dalla tabella closures)
//   - 'time_closed_lunch' / 'time_closed_dinner': fuori orario servizio
//   - 'in_past': data passata
//   - 'gruppo_grande': supera large_group_threshold
//   - 'evento': raggiunge event_threshold
// ═══════════════════════════════════════════════════════════════════════════════

import { query } from '../db.js';

// ─── Helpers date/time ─────────────────────────────────────────────────────────

// Ritorna il giorno della settimana come 0-6 dove 0=domenica, 1=lunedì...6=sabato
// (identico al formato usato in Apps Script per closedDays)
function dayOfWeek(dateStr) {
  const d = new Date(`${dateStr}T12:00:00Z`);  // mezzogiorno UTC per evitare edge di timezone
  return d.getUTCDay();
}

// Converte "21:00" o "21:00:00" in minuti dal midnight (per confronti)
function timeToMinutes(timeStr) {
  const parts = String(timeStr).split(':');
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1] || '0', 10);
}

// Verifica se due intervalli temporali si sovrappongono (in minuti dal midnight)
function intervalsOverlap(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}

// v7.7.29: BUSINESS RULE tavoli.
// Un cliente da 1 pax occupa un tavolo da 2 (posti fisici).
// Un cliente da 3 pax occupa un tavolo da 4 (posti fisici).
// Il conteggio della capacità DEVE tenere conto dei posti FISICI occupati,
// non del numero di persone dichiarato dal cliente, altrimenti il ristorante
// rischia overbooking (es. 15 prenotazioni da 1 pax = sistema conta 15 posti,
// realtà occupano 30 posti fisici = 15 tavoli da 2).
function roundToTable(pax) {
  const n = Number(pax);
  if (n === 1) return 2;
  if (n === 3) return 4;
  return n;
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * checkAvailability(tenant, params)
 *
 * @param {object} tenant     - dalla getTenantByPhone()
 * @param {object} params     - { date: 'YYYY-MM-DD', time: 'HH:MM', people, excludeReservationId? }
 * @returns {Promise<{esito: string, ...extras}>}
 */
export async function checkAvailability(tenant, params) {
  const { date, time, people, excludeReservationId } = params;

  if (!tenant) throw new Error('checkAvailability: tenant mancante');
  if (!date || !time || !people) {
    return { esito: 'invalid_params', message: 'data, ora, persone richiesti' };
  }

  // ─── 1. Check "in the past" ────────────────────────────────────────────────
  // Confronto con oggi in Europe/Rome
  const nowRome = new Date().toLocaleString('sv-SE', { timeZone: tenant.timezone || 'Europe/Rome' });
  const todayRome = nowRome.substring(0, 10);  // "YYYY-MM-DD"
  if (date < todayRome) {
    return { esito: 'in_past', message: 'data nel passato' };
  }

  // ─── 2. Check giorno di chiusura settimanale ──────────────────────────────
  const dow = dayOfWeek(date);
  if ((tenant.closedDays || []).includes(dow)) {
    return { esito: 'day_closed', giorno: dow };
  }

  // ─── 3. Check chiusura straordinaria (tabella closures) ────────────────────
  const closureResult = await query(
    `SELECT id, reason, is_lunch_only, is_dinner_only
       FROM closures
      WHERE tenant_id = $1 AND date = $2
      LIMIT 5`,
    [tenant.id, date]
  );
  if (closureResult.rows.length > 0) {
    // Se c'è una chiusura totale (né lunch_only né dinner_only) → chiuso
    const fullClosure = closureResult.rows.find(c => !c.is_lunch_only && !c.is_dinner_only);
    if (fullClosure) {
      return { esito: 'closure', message: 'chiusura straordinaria', reason: fullClosure.reason };
    }
    // TODO: gestione chiusure parziali (solo pranzo o solo cena) — verifica time
  }

  // ─── 4. Check orario in range lunch o dinner ───────────────────────────────
  const timeMin = timeToMinutes(time);
  const lunchStart  = timeToMinutes(tenant.lunchStart  || '12:00');
  const lunchEnd    = timeToMinutes(tenant.lunchEnd    || '15:00');
  const dinnerStart = timeToMinutes(tenant.dinnerStart || '19:00');
  const dinnerEnd   = timeToMinutes(tenant.dinnerEnd   || '22:30');

  const inLunch  = timeMin >= lunchStart  && timeMin <= lunchEnd;
  const inDinner = timeMin >= dinnerStart && timeMin <= dinnerEnd;

  if (!inLunch && !inDinner) {
    return { esito: 'time_closed', message: 'ora fuori orari di servizio' };
  }

  // Check chiusura lunch/dinner per giorno della settimana
  if (inLunch && (tenant.lunchClosedDays || []).includes(dow)) {
    return { esito: 'time_closed_lunch', giorno: dow };
  }
  if (inDinner && (tenant.dinnerClosedDays || []).includes(dow)) {
    return { esito: 'time_closed_dinner', giorno: dow };
  }

  // ─── 5. Check event threshold (prenotazione MOLTO grande = evento) ─────────
  const eventThreshold = Number(tenant.eventThreshold) || 45;
  if (people >= eventThreshold) {
    return { esito: 'evento', message: 'usa richiedi_evento invece di crea_prenotazione' };
  }

  // ─── 6. Check large group threshold (informativo, non blocca) ──────────────
  const largeGroupThreshold = Number(tenant.largeGroupThreshold) || 10;
  const isLargeGroup = people > largeGroupThreshold;

  // ─── 7. Conta persone già confermate nello slot ────────────────────────────
  // Prendo tutte le prenotazioni attive per quella data
  // e verifico overlap temporale con lo slot richiesto.
  const slotMinutes = Number(tenant.slot_minutes) || 90;
  const newStart = timeMin;
  const newEnd   = timeMin + slotMinutes;

  const excludeCondition = excludeReservationId ? 'AND id <> $3' : '';
  const excludeParams = excludeReservationId ? [excludeReservationId] : [];

  const existingResult = await query(
    `SELECT id, time, people, status
       FROM reservations
      WHERE tenant_id = $1
        AND date = $2
        AND status IN ('CONFIRMED', 'PENDING_OWNER')
        ${excludeCondition}`,
    [tenant.id, date, ...excludeParams]
  );

  let occupiedSeats = 0;
  for (const r of existingResult.rows) {
    const rStart = timeToMinutes(r.time);
    const rEnd   = rStart + slotMinutes;
    if (intervalsOverlap(newStart, newEnd, rStart, rEnd)) {
      // v7.7.29: applico rounding a tavolo per ogni prenotazione esistente.
      // Es. r.people=1 → conta come 2 posti fisici (tavolo da 2).
      occupiedSeats += roundToTable(r.people);
    }
  }

  const totalSeats = Number(tenant.total_seats) || 30;
  // v7.7.29: applico rounding anche alla nuova richiesta.
  // Es. cliente chiede 3 pax → conta come 4 posti fisici (tavolo da 4).
  const requestedSeats = roundToTable(people);
  const seatsAfter = occupiedSeats + requestedSeats;

  // ─── 8. Verifica capacità ──────────────────────────────────────────────────
  if (seatsAfter > totalSeats) {
    return {
      esito: 'slot_full',
      message: 'slot pieno',
      capienza: totalSeats,
      occupati: occupiedSeats,
      richiesti: requestedSeats,
      richiesti_dichiarati: Number(people),
    };
  }

  // ─── 9. OK: slot libero (con eventuale flag gruppo grande) ─────────────────
  return {
    esito: isLargeGroup ? 'gruppo_grande' : 'libero',
    capienza: totalSeats,
    occupati: occupiedSeats,
    disponibili: totalSeats - occupiedSeats,
    largeGroupThreshold,
    isLargeGroup,
  };
}
