// ═══════════════════════════════════════════════════════════════════════════════
// TOOL: crea_prenotazione
// ═══════════════════════════════════════════════════════════════════════════════
// Interfaccia usata dal gateway al posto di HTTP verso Apps Script.
//
// Payload input (identico a quello che il gateway mandava ad Apps Script):
//   {
//     nome: "Costa",
//     persone: 4,
//     data: "2026-08-07",
//     ora: "21:00:00",
//     telefono: "+393385354671",
//     notes: "",
//     source: "telnyx",
//     forceNew: true              ← ignorato (era per Apps Script duplicate check)
//   }
//
// Risposta output (identica a quella che Apps Script restituiva):
//   {
//     creata: true,
//     stato: "CONFIRMED",
//     data: "venerdì 7 agosto",   ← formato italiano human-readable
//     ora: "21:00",
//     persone: 4
//   }
//
// In caso di errore:
//   { creata: false, motivo: "...", messaggio_utente: "..." }
// ═══════════════════════════════════════════════════════════════════════════════

import { getTenantByPhone } from '../services/tenants.js';
import { createReservation } from '../services/reservations.js';

// 🐛 FIX: Postgres restituisce il campo DATE come oggetto Date JS, non stringa.
//   Devo gestire entrambi i casi in modo robusto.
//
// Formattazione data italiana:
//   Input:  Date object (da Postgres)   → "venerdì 7 agosto"
//   Input:  "2026-08-07" (string)       → "venerdì 7 agosto"
//   Input:  invalido                     → ritorna la rappresentazione grezza
function formatDateItalian(dateInput, timezone = 'Europe/Rome') {
  let d;

  if (dateInput instanceof Date) {
    // Già un Date object (caso Postgres). Uso mezzogiorno UTC per stabilità timezone.
    // Prendo la data ISO YYYY-MM-DD del Date object e la ricreo con T12:00:00Z
    // per evitare che il fuso locale sposti il giorno.
    const iso = dateInput.toISOString().substring(0, 10);
    d = new Date(`${iso}T12:00:00Z`);
  } else if (typeof dateInput === 'string' && dateInput.match(/^\d{4}-\d{2}-\d{2}/)) {
    // Stringa YYYY-MM-DD (con eventuale suffisso)
    d = new Date(`${dateInput.substring(0, 10)}T12:00:00Z`);
  } else {
    // Fallback: prova a parsare direttamente
    d = new Date(dateInput);
  }

  if (isNaN(d.getTime())) {
    // Data non parsabile — ritorna la stringa raw
    return String(dateInput);
  }

  return new Intl.DateTimeFormat('it-IT', {
    weekday: 'long',
    day:     'numeric',
    month:   'long',
    timeZone: timezone,
  }).format(d);
}

// Normalizza "21:00:00" → "21:00" per l'output al modello.
// Postgres TIME restituisce di solito una stringa "HH:MM:SS", ma per sicurezza
// gestiamo anche Date object o altri formati.
function shortTime(timeInput) {
  if (!timeInput) return '';
  if (timeInput instanceof Date) {
    // Improbabile, ma gestiamo il caso
    const h = String(timeInput.getUTCHours()).padStart(2, '0');
    const m = String(timeInput.getUTCMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }
  const s = String(timeInput).trim();
  return s.length >= 5 ? s.substring(0, 5) : s;
}

/**
 * creaPrenotazioneTool(restaurantConfig, params, meta?)
 *
 * @param {object} restaurantConfig  - config del ristorante (dalla callInfo del gateway)
 * @param {object} params            - payload originale del gateway
 * @param {object} meta              - { callId, callerPhone } opzionali
 * @returns {Promise<object>}        - risposta drop-in compatibile con Apps Script
 */
export async function creaPrenotazioneTool(restaurantConfig, params, meta = {}) {
  // Il restaurantConfig arriva dal gateway (Registry Sheet o, dopo cutover, getTenantByPhone).
  // Assicuriamoci di avere il tenant COMPLETO da Postgres.
  let tenant = restaurantConfig;

  // Se il restaurantConfig non ha `id` (uuid), significa che viene dalla vecchia
  // Registry Sheet e dobbiamo cercarlo su Postgres. Al cutover completo,
  // avremo già il tenant Postgres qui.
  if (!tenant?.id && restaurantConfig?.twilio_number) {
    tenant = await getTenantByPhone(restaurantConfig.twilio_number);
    if (!tenant) {
      return {
        creata: false,
        motivo: 'tenant_not_found',
        messaggio_utente: 'Configurazione ristorante non trovata',
      };
    }
  }

  if (!tenant?.id) {
    return {
      creata: false,
      motivo: 'invalid_tenant',
      messaggio_utente: 'Configurazione ristorante non valida',
    };
  }

  // Chiamata al service
  const result = await createReservation(tenant, {
    date:         params.data,
    time:         params.ora,
    people:       Number(params.persone),
    name:         params.nome,
    phone:        params.telefono || null,
    email:        params.email    || null,
    notes:        params.notes    || params.note || '',
    source:       params.source   || 'telnyx',
    callId:       meta.callId     || null,
    callerPhone:  meta.callerPhone || params.telefono || null,
  });

  // Errore di validazione o slot non disponibile → risposta drop-in
  if (!result.success) {
    // Mapping tra i nostri esiti e i motivi che Apps Script restituiva
    const motiviMap = {
      day_closed:         'giorno_chiuso',
      closure:            'chiusura_straordinaria',
      time_closed:        'fuori_orario',
      time_closed_lunch:  'pranzo_chiuso',
      time_closed_dinner: 'cena_chiusa',
      in_past:            'data_passata',
      slot_full:          'slot_pieno',
      evento:             'evento',
      invalid_params:     'parametri_invalidi',
      invalid_people:     'numero_persone_invalido',
    };
    return {
      creata: false,
      motivo: motiviMap[result.esito] || result.esito,
      messaggio_utente: result.message || 'Impossibile creare la prenotazione',
      details: result.details,
    };
  }

  // Successo → risposta drop-in compatibile con Apps Script
  const res = result.reservation;
  return {
    creata: true,
    stato: result.status,             // "CONFIRMED" o "PENDING_OWNER"
    data: formatDateItalian(res.date, tenant.timezone),
    ora: shortTime(res.time),
    persone: Number(res.people),
    is_group: result.is_group,
    // Extra info utile al gateway (non usata dal modello ma dai log)
    _internal: {
      reservation_id: res.id,
      tenant_id: res.tenant_id,
    },
  };
}
