// ═══════════════════════════════════════════════════════════════════════════════
// TOOL: modifica_prenotazione
// ═══════════════════════════════════════════════════════════════════════════════
// Modifica una prenotazione esistente (partial update).
// Il gateway garantisce che venga passato eventId (dal _lastFound salvato dalla
// tool call trova_prenotazione precedente).
//
// v7.7.31 (2026-09-10): SAFETY NET MULTI-RESULT (B09-009 pattern)
//   Se il modello chiama con `nome` (senza eventId), il tool fa disambiguation
//   server-side: se trova >1 prenotazioni per quel nome+data, REFUSE e chiede
//   data specifica (evita modifica silenziosa di prenotazione sbagliata).
//
// Payload input (v7.7.31):
//   PATH A (eventId — path preferito):
//     {
//       eventId: "2b71994f-...",         (UUID Postgres)
//       nome, data, ora, persone, ...    (campi da modificare)
//     }
//   PATH B (safety net — nome+data fallback):
//     {
//       nome: "Sanna",                    (identifier — obbligatorio)
//       data: "2026-10-10",               (opzionale — MA richiesto se >1 match)
//       // + campi da modificare, che si distinguono per essere DIVERSI da nome/data:
//       ora: "22:00",
//       persone: 3,
//       notes: "...",
//     }
//   NOTA: in PATH B, `data` è AMBIGUA — è identifier o nuovo valore?
//   Convenzione: se `eventId` assente, `data` è IDENTIFIER (data prenotazione
//   esistente). Per cambiare la data ci vuole PATH A con eventId + nuovo `data`.
//
// Risposta output:
//   Successo:
//     { success: true, changeType: "UPDATE", stato: "CONFIRMED",
//       data: "sabato 8 agosto", ora: "22:00", persone: 3, eventId: "..." }
//   Errore standard:
//     { success: false, reason: "not_found" | "slot_pieno" | ..., message: "..." }
//   Errore multi-result (nuovo v7.7.31):
//     { success: false, reason: "date_required_for_disambiguation",
//       message: "Trovate N prenotazioni a nome X. Specificare la data.",
//       matches: [{ data_iso, data_naturale, ora, persone }, ...],
//       count: N }
// ═══════════════════════════════════════════════════════════════════════════════

import { getTenantByPhone } from '../services/tenants.js';
import { updateReservation, findReservations } from '../services/reservations.js';

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

function toIsoDate(dateInput) {
  if (!dateInput) return null;
  if (dateInput instanceof Date) return dateInput.toISOString().substring(0, 10);
  const s = String(dateInput);
  return s.substring(0, 10);
}

// Valida che una stringa sia un UUID Postgres
function isValidUUID(str) {
  if (!str || typeof str !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

// ═══════════════════════════════════════════════════════════════════════════════
// v7.7.31 SAFETY NET: risolve nome+data → eventId con multi-result disambiguation
// ═══════════════════════════════════════════════════════════════════════════════
async function resolveEventIdFromNameDate(tenant, nome, data) {
  const result = await findReservations(tenant, {
    name: nome,
    date: data || undefined,
    limit: 5,
  });
  const reservations = result.reservations || [];

  if (reservations.length === 0) {
    return { ok: false, reason: 'not_found', message: `Nessuna prenotazione trovata a nome ${nome}${data ? ' per il ' + formatDateItalian(data, tenant.timezone) : ''}.` };
  }

  if (reservations.length === 1) {
    return { ok: true, eventId: String(reservations[0].id) };
  }

  const matches = reservations.map(r => ({
    data_iso: toIsoDate(r.date),
    data_naturale: formatDateItalian(r.date, tenant.timezone),
    ora: shortTime(r.time),
    persone: Number(r.people),
  }));

  if (data) {
    return {
      ok: false,
      reason: 'time_required_for_disambiguation',
      message: `Trovate ${reservations.length} prenotazioni a nome ${nome} per il ${formatDateItalian(data, tenant.timezone)}. Specificare anche l'orario.`,
      matches,
      count: reservations.length,
    };
  }

  return {
    ok: false,
    reason: 'date_required_for_disambiguation',
    message: `Trovate ${reservations.length} prenotazioni a nome ${nome}. Specificare la data per modificare quella corretta.`,
    matches,
    count: reservations.length,
  };
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

  // ═══════════════════════════════════════════════════════════════════════════
  // v7.7.31 SAFETY NET: se eventId assente, prova a risolvere da nome+data
  // ═══════════════════════════════════════════════════════════════════════════
  let eventId = params.eventId || params.event_id || null;

  if (!eventId) {
    const nome = params.nome || params.name || null;
    const data = params.data || params.date || null;

    if (!nome) {
      return {
        success: false,
        reason: 'missing_eventid',
        message: 'eventId (o nome) richiesto per la modifica. Chiama prima trova_prenotazione.'
      };
    }

    const resolved = await resolveEventIdFromNameDate(tenant, nome, data);
    if (!resolved.ok) {
      return {
        success: false,
        reason: resolved.reason,
        message: resolved.message,
        matches: resolved.matches,
        count: resolved.count,
      };
    }
    eventId = resolved.eventId;
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
  // NOTA: se abbiamo risolto eventId da nome+data (PATH B), NON passiamo
  // params.data come nuovo valore (era l'identifier). Passiamo undefined per
  // date/name — evita di "riscrivere" la data esistente con se stessa.
  const usedFallback = !params.eventId && !params.event_id;

  const result = await updateReservation(
    tenant,
    eventId,
    {
      date:   usedFallback ? undefined : params.data,
      time:   params.ora,
      people: params.persone !== undefined ? Number(params.persone) : undefined,
      name:   usedFallback ? undefined : params.nome,
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
