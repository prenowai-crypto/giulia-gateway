// ═══════════════════════════════════════════════════════════════════════════════
// TOOL: cancella_prenotazione
// ═══════════════════════════════════════════════════════════════════════════════
// Cancella una prenotazione (soft delete).
// Il modello passa l'eventId ottenuto da trova_prenotazione precedente.
//
// v7.7.31 (2026-09-10): SAFETY NET MULTI-RESULT (B09-009 Silvestri)
//   Se il modello chiama con `nome` (senza eventId), il tool fa disambiguation
//   server-side: se trova >1 prenotazioni per quel nome+data, REFUSE e chiede
//   data specifica (evita mapped[0] silenzioso che cancella la sbagliata).
//
// Payload input (v7.7.31):
//   PATH A (eventId — path preferito):
//     {
//       eventId: "2b71994f-...",       (UUID Postgres — richiesto)
//       motivo: "customer_request",     (opzionale)
//       source: "telnyx_cancel",
//     }
//   PATH B (safety net — nome+data fallback):
//     {
//       nome: "Silvestri",              (richiesto se eventId assente)
//       data: "2026-10-10",             (opzionale — MA richiesto se >1 match)
//       motivo, source, ...
//     }
//
// Risposta output:
//   Successo:
//     { success: true, cancellata: true, eventId, nome, data, ora, persone }
//   Errore standard:
//     { success: false, reason: "not_found" | "missing_eventid" | ..., message: "..." }
//   Errore multi-result (nuovo v7.7.31):
//     { success: false, reason: "date_required_for_disambiguation",
//       message: "Trovate N prenotazioni a nome X. Specificare la data.",
//       matches: [{ data_iso, data_naturale, ora, persone }, ...],
//       count: N }
// ═══════════════════════════════════════════════════════════════════════════════

import { getTenantByPhone } from '../services/tenants.js';
import { cancelReservation, findReservations } from '../services/reservations.js';

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

  // >1 match: REFUSE e chiedi data specifica al modello
  // Se il caller ha già passato una data e ci sono ancora >1 match,
  // significa che ci sono più prenotazioni STESSO NOME + STESSA DATA
  // (raro, ma possibile — es. 2 Rossi diversi stessa sera): serve orario.
  const matches = reservations.map(r => ({
    data_iso: toIsoDate(r.date),
    data_naturale: formatDateItalian(r.date, tenant.timezone),
    ora: shortTime(r.time),
    persone: Number(r.people),
  }));

  if (data) {
    // stesso nome + stessa data + multi-match → serve ora
    return {
      ok: false,
      reason: 'time_required_for_disambiguation',
      message: `Trovate ${reservations.length} prenotazioni a nome ${nome} per il ${formatDateItalian(data, tenant.timezone)}. Specificare anche l'orario.`,
      matches,
      count: reservations.length,
    };
  }

  // Solo nome, no data: chiedi data
  const dateList = matches.map(m => m.data_iso).join(', ');
  return {
    ok: false,
    reason: 'date_required_for_disambiguation',
    message: `MULTI-RESULT: trovate ${reservations.length} prenotazioni a nome ${nome}. RIPROVA IMMEDIATAMENTE cancella_prenotazione passando il parametro "data" con una di queste date ISO esatte: [${dateList}]. NON trasferire al ristorante — riprova la chiamata con "data" specificata. Esempio: cancella_prenotazione(data="${matches[0].data_iso}")`,
    matches,
    count: reservations.length,
    date_disponibili: matches.map(m => m.data_iso),
    retry_instruction: `Chiama di nuovo cancella_prenotazione con parametro data="YYYY-MM-DD" usando una data della lista date_disponibili. NON trasferire.`,
  };
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

  // ═══════════════════════════════════════════════════════════════════════════
  // v7.7.31 SAFETY NET: se eventId assente, prova a risolvere da nome+data
  // ═══════════════════════════════════════════════════════════════════════════
  let eventId = params.eventId || params.event_id || null;

  if (!eventId) {
    const nome = params.nome || params.name || null;
    const data = params.data || params.date || null;

    if (!nome) {
      return {
        success: false, reason: 'missing_eventid',
        message: 'eventId (o nome) richiesto per cancellare. Chiama prima trova_prenotazione.'
      };
    }

    // Prova a risolvere nome+data → eventId con safety net multi-result
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
