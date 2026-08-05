// ═══════════════════════════════════════════════════════════════════════════════
// TOOL: trova_prenotazione
// ═══════════════════════════════════════════════════════════════════════════════
// Cerca una prenotazione per nome, data e/o telefono.
// Usata dal modello prima di ogni modifica_prenotazione o cancella_prenotazione.
//
// Payload input:
//   {
//     nome: "Costa",            (opzionale ma quasi sempre presente)
//     data: "2026-08-07",       (opzionale)
//     telefono: "+39...",       (opzionale, il gateway lo passa se disponibile)
//   }
//
// Risposta output:
//   {
//     found: true,
//     count: 1,
//     reservation: { eventId, date, time, people, name, phone, notes, status },
//     reservations: [ ... ]     ← se count > 1, tutti i match
//   }
//
// In caso di non trovato:
//   { found: false, count: 0, motivo: "non_trovata" }
// ═══════════════════════════════════════════════════════════════════════════════

import { getTenantByPhone } from '../services/tenants.js';
import { findReservations } from '../services/reservations.js';

// Riusa gli helper di formattazione di crea-prenotazione (mantengo consistenza)
function formatDateItalian(dateInput, timezone = 'Europe/Rome') {
  let d;
  if (dateInput instanceof Date) {
    const iso = dateInput.toISOString().substring(0, 10);
    d = new Date(`${iso}T12:00:00Z`);
  } else if (typeof dateInput === 'string' && dateInput.match(/^\d{4}-\d{2}-\d{2}/)) {
    d = new Date(`${dateInput.substring(0, 10)}T12:00:00Z`);
  } else {
    d = new Date(dateInput);
  }
  if (isNaN(d.getTime())) return String(dateInput);
  return new Intl.DateTimeFormat('it-IT', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: timezone,
  }).format(d);
}

function shortTime(timeInput) {
  if (!timeInput) return '';
  if (timeInput instanceof Date) {
    const h = String(timeInput.getUTCHours()).padStart(2, '0');
    const m = String(timeInput.getUTCMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }
  return String(timeInput).substring(0, 5);
}

// Mappa una riga DB al formato risposta compatibile con Apps Script
function mapReservationToResponse(r) {
  // `eventId` è il campo che il modello si aspetta come identificatore.
  // Nel vecchio sistema era il Google Calendar event ID.
  // Nel nuovo sistema usiamo l'UUID di Postgres come identificatore univoco.
  return {
    eventId: String(r.id),
    date: r.date instanceof Date ? r.date.toISOString().substring(0, 10) : String(r.date).substring(0, 10),
    time: shortTime(r.time),
    people: Number(r.people),
    name: r.name,
    phone: r.phone || null,
    email: r.email || null,
    notes: r.notes || '',
    status: r.status,
    is_group: !!r.is_group,
    // Info human-readable utile al modello per parlare al cliente
    data_human: formatDateItalian(r.date),
  };
}

/**
 * trovaPrenotazioneTool(restaurantConfig, params, meta?)
 *
 * @param {object} restaurantConfig  - config del ristorante (dal gateway)
 * @param {object} params            - payload originale del gateway
 * @param {object} meta              - { callId, callerPhone } opzionali
 * @returns {Promise<object>}        - risposta drop-in
 */
export async function trovaPrenotazioneTool(restaurantConfig, params, meta = {}) {
  let tenant = restaurantConfig;

  if (!tenant?.id && restaurantConfig?.twilio_number) {
    tenant = await getTenantByPhone(restaurantConfig.twilio_number);
    if (!tenant) {
      return { found: false, count: 0, motivo: 'tenant_not_found' };
    }
  }

  if (!tenant?.id) {
    return { found: false, count: 0, motivo: 'invalid_tenant' };
  }

  // Estrai i parametri (compatibili con nomenclatura Apps Script + varianti)
  const nome     = params.nome     || params.name     || null;
  const data     = params.data     || params.date     || null;
  const telefono = params.telefono || params.phone    || meta.callerPhone || null;

  // Il modello a volte chiama trova senza nessun parametro (bug o edge case).
  // Almeno un criterio è richiesto.
  if (!nome && !data && !telefono) {
    return {
      found: false,
      count: 0,
      motivo: 'no_criteria',
      messaggio_utente: 'Servono nome, data o telefono per cercare',
    };
  }

  const result = await findReservations(tenant, {
    name: nome,
    date: data,
    phone: telefono,
    limit: 5,
  });

  if (!result.success) {
    return {
      found: false,
      count: 0,
      motivo: result.esito || 'search_failed',
      messaggio_utente: result.message,
    };
  }

  if (result.count === 0) {
    return {
      found: false,
      count: 0,
      motivo: 'non_trovata',
      messaggio_utente: 'Nessuna prenotazione trovata con questi criteri',
    };
  }

  // Mappa i risultati al formato risposta
  const mapped = result.reservations.map(mapReservationToResponse);

  return {
    found: true,
    count: result.count,
    reservation: mapped[0],     // ← primo match (più rilevante)
    reservations: mapped,       // ← tutti i match (se ce ne sono più di 1)
    total_matches: result.total_matches,
  };
}
