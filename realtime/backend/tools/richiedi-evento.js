// ═══════════════════════════════════════════════════════════════════════════════
// TOOL: richiedi_evento
// ═══════════════════════════════════════════════════════════════════════════════
// Registra una RICHIESTA per un grande evento (>= event_threshold persone).
// Non è una vera prenotazione confermata — il ristoratore deve valutare offline.
//
// Payload input:
//   {
//     nome: "Rossi",
//     persone: 50,
//     data: "2026-08-15",
//     ora: "20:00",
//     telefono: "+39...",
//     email: "cliente@example.com",   (opzionale, ma raccomandato)
//     notes: "Compleanno di mio marito, buffet",
//     source: "telnyx",
//   }
//
// Risposta output (drop-in con Apps Script):
//   Successo:
//     { success: true, richiesta_inviata: true, stato: "PENDING_OWNER",
//       data: "sabato 15 agosto", ora: "20:00", persone: 50, eventId: "..." }
//   Errore:
//     { success: false, reason: "below_event_threshold" | ..., message: "..." }
// ═══════════════════════════════════════════════════════════════════════════════

import { getTenantByPhone } from '../services/tenants.js';
import { requestBigEvent } from '../services/reservations.js';

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

export async function richiediEventoTool(restaurantConfig, params, meta = {}) {
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

  const result = await requestBigEvent(
    tenant,
    {
      date:   params.data,
      time:   params.ora,
      people: Number(params.persone),
      name:   params.nome,
      phone:  params.telefono || null,
      email:  params.email    || null,
      notes:  params.notes    || params.note || '',
    },
    {
      source: params.source || 'telnyx_event',
      callId: meta.callId || null,
      callerPhone: meta.callerPhone || params.telefono || null,
    }
  );

  if (!result.success) {
    const reasonMap = {
      below_event_threshold: 'below_event_threshold',
      invalid_params:        'parametri_invalidi',
      invalid_people:        'numero_persone_invalido',
    };
    return {
      success: false,
      reason: reasonMap[result.esito] || result.esito || 'event_request_failed',
      message: result.message,
    };
  }

  const r = result.reservation;
  return {
    success: true,
    richiesta_inviata: true,
    stato: 'PENDING_OWNER',
    eventId: String(r.id),
    data: formatDateItalian(r.date, tenant.timezone),
    ora: shortTime(r.time),
    persone: Number(r.people),
    nome: r.name,
    // Info aggiuntiva utile al modello per parlare al cliente
    messaggio_utente: `Ho registrato la richiesta per ${r.people} persone. Il ristoratore la valuterà e la contatterà per confermare.`,
  };
}
