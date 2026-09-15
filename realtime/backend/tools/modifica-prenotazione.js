// ═══════════════════════════════════════════════════════════════════════════════
// TOOL: modifica_prenotazione
// ═══════════════════════════════════════════════════════════════════════════════
// Modifica una prenotazione esistente (partial update).
// Il gateway garantisce che venga passato eventId (dal _lastFound salvato dalla
// tool call trova_prenotazione precedente).
//
// Payload input (identico a quello che il gateway mandava ad Apps Script):
//   {
//     eventId: "2b71994f-...",         (UUID Postgres — o vecchio Google ID)
//     nome: "Costa",                    (opzionale — solo se cambia)
//     data: "2026-08-08",               (opzionale — solo se cambia)
//     ora: "22:00",                     (opzionale — solo se cambia)
//     persone: 3,                       (opzionale — solo se cambia)
//     telefono: "+39...",               (opzionale)
//     notes: "Tavolo esterno",          (opzionale — "" = rimozione nota)
//     source: "telnyx_modify",
//   }
//
// Risposta output (drop-in con Apps Script):
//   Successo:
//     { success: true, changeType: "UPDATE", stato: "CONFIRMED",
//       data: "sabato 8 agosto", ora: "22:00", persone: 3, eventId: "..." }
//   Errore:
//     { success: false, reason: "not_found", message: "..." }
//     { success: false, reason: "slot_pieno", message: "..." }
//     { success: false, reason: "giorno_chiuso", message: "..." }
// ═══════════════════════════════════════════════════════════════════════════════

import { getTenantByPhone } from '../services/tenants.js';
import { updateReservation } from '../services/reservations.js';

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

// Valida che una stringa sia un UUID Postgres
function isValidUUID(str) {
  if (!str || typeof str !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

/**
 * modificaPrenotazioneTool(restaurantConfig, params, meta?)
 */
export async function modificaPrenotazioneTool(restaurantConfig, params, meta = {}) {
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

  // Recupera eventId (UUID della prenotazione)
  const eventId = params.eventId || params.event_id || null;
  if (!eventId) {
    return {
      success: false,
      reason: 'missing_eventid',
      message: 'eventId richiesto per la modifica. Chiama prima trova_prenotazione.'
    };
  }

  // Verifica formato UUID (proteggo da eventId "vecchi" tipo Google Calendar)
  if (!isValidUUID(eventId)) {
    return {
      success: false,
      reason: 'invalid_eventid',
      message: 'eventId non è un UUID valido. Questa prenotazione potrebbe essere legacy (Apps Script).'
    };
  }

  // Chiamata al service con partial update
  const result = await updateReservation(
    tenant,
    eventId,
    {
      date:   params.data,
      time:   params.ora,
      people: params.persone !== undefined ? Number(params.persone) : undefined,
      name:   params.nome,
      phone:  params.telefono,
      email:  params.email,
      // Note: rispetto la stringa vuota come segnale di "rimuovi"
      notes:  params.notes !== undefined ? params.notes : (params.note !== undefined ? params.note : undefined),
    },
    {
      source: params.source || 'telnyx_modify',
      callId: meta.callId || null,
      callerPhone: meta.callerPhone || params.telefono || null,
    }
  );

  if (!result.success) {
    // Mapping esiti → reason compatibili con Apps Script
    const reasonMap = {
      not_found:          'not_found',
      missing_id:         'missing_eventid',
      day_closed:         'giorno_chiuso',
      closure:            'chiusura_straordinaria',
      time_closed:        'fuori_orario',
      time_closed_lunch:  'pranzo_chiuso',
      time_closed_dinner: 'cena_chiusa',
      in_past:            'data_passata',
      slot_full:          'slot_pieno',
      evento:             'evento',
      invalid_params:     'parametri_invalidi',
    };
    return {
      success: false,
      reason: reasonMap[result.esito] || result.esito || 'update_failed',
      message: result.message || 'Impossibile modificare la prenotazione',
      details: result.details,
    };
  }

  // Successo → risposta drop-in
  const r = result.reservation;
  return {
    success: true,
    changeType: 'UPDATE',
    stato: result.status,
    eventId: String(r.id),
    data: formatDateItalian(r.date, tenant.timezone),
    ora: shortTime(r.time),
    persone: Number(r.people),
    nome: r.name,
    is_group: !!r.is_group,
    changed_slot: !!result.changed_slot,
  };
}
