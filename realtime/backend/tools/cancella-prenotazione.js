// ═══════════════════════════════════════════════════════════════════════════════
// TOOL: cancella_prenotazione
// ═══════════════════════════════════════════════════════════════════════════════
// Cancella una prenotazione (soft delete).
// Il modello passa l'eventId ottenuto da trova_prenotazione precedente.
//
// Payload input:
//   {
//     eventId: "2b71994f-...",       (UUID Postgres — richiesto)
//     motivo: "customer_request",     (opzionale)
//     source: "telnyx_cancel",
//   }
//
// Risposta output (drop-in con Apps Script):
//   Successo:
//     { success: true, cancellata: true, eventId, nome, data, ora, persone }
//   Errore:
//     { success: false, reason: "not_found" | "missing_eventid" | ..., message: "..." }
// ═══════════════════════════════════════════════════════════════════════════════

import { getTenantByPhone } from '../services/tenants.js';
import { cancelReservation } from '../services/reservations.js';

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

function isValidUUID(str) {
  if (!str || typeof str !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

export async function cancellaPrenotazioneTool(restaurantConfig, params, meta = {}) {
  let tenant = restaurantConfig;

  if (!tenant?.id && restaurantConfig?.twilio_number) {
    tenant = await getTenantByPhone(restaurantConfig.twilio_number);
    if (!tenant) {
      return { success: false, reason: 'tenant_not_found', message: 'Configurazione ristorante non trovata' };
    }
  }
  if (!tenant?.id) {
    return { success: false, reason: 'invalid_tenant', message: 'Configurazione ristorante non valida' };
  }

  const eventId = params.eventId || params.event_id || null;
  if (!eventId) {
    return {
      success: false, reason: 'missing_eventid',
      message: 'eventId richiesto per cancellare. Chiama prima trova_prenotazione.'
    };
  }

  if (!isValidUUID(eventId)) {
    return {
      success: false, reason: 'invalid_eventid',
      message: 'eventId non è un UUID valido. Questa prenotazione potrebbe essere legacy.'
    };
  }

  const result = await cancelReservation(
    tenant,
    eventId,
    {
      source: params.source || 'telnyx_cancel',
      reason: params.motivo || params.reason || 'customer_request',
      callId: meta.callId || null,
      callerPhone: meta.callerPhone || null,
    }
  );

  if (!result.success) {
    const reasonMap = {
      not_found:  'not_found',
      missing_id: 'missing_eventid',
    };
    return {
      success: false,
      reason: reasonMap[result.esito] || result.esito || 'cancel_failed',
      message: result.message || 'Impossibile cancellare la prenotazione',
    };
  }

  // Idempotenza: se era già cancellata segnalo comunque success ma indico
  if (result.esito === 'already_cancelled') {
    const r = result.reservation;
    return {
      success: true,
      cancellata: true,
      already_cancelled: true,
      eventId: String(r.id),
      nome: r.name,
      data: formatDateItalian(r.date, tenant.timezone),
      ora: shortTime(r.time),
      persone: Number(r.people),
      message: 'Prenotazione era già cancellata',
    };
  }

  // Cancellazione riuscita
  const r = result.reservation;
  return {
    success: true,
    cancellata: true,
    eventId: String(r.id),
    nome: r.name,
    data: formatDateItalian(r.date, tenant.timezone),
    ora: shortTime(r.time),
    persone: Number(r.people),
  };
}
