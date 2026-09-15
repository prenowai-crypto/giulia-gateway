// ═══════════════════════════════════════════════════════════════════════════════
// TOOL: trova_prenotazione
// ═══════════════════════════════════════════════════════════════════════════════
// Cerca una prenotazione esistente per nome (obbligatorio) + data (opzionale).
//
// v7.7.18 (2026-08-21): RIMOSSO filtro phone strict.
//   Business decision: un cliente può chiamare da un telefono diverso
//   (numero cambiato, chiama da lavoro, chiede a parente). Il phone del
//   caller viene usato solo come TIE-BREAKER (boost score se matcha),
//   NON come filtro esclusivo. Un cliente identifica la prenotazione con
//   nome + eventualmente data, il phone è solo informativo.
//
// v7.7.31 (2026-09-10): ENRICHMENT MULTI-RESULT (B09-009 supporto)
//   Nei risultati aggiungo `data_naturale` ("sabato 10 ottobre") e `ora_short`
//   ("21:00") pre-formattati, così il modello può leggerli direttamente al
//   cliente senza dover fare parsing. Riduce il rischio che il modello si
//   confonda tra le prenotazioni multiple e passi eventId sbagliato.
//
// Payload input:
//   { nome: "Rossi", data: "2026-08-22" }
//
// Meta (dal gateway):
//   { callId, callerPhone }
// ═══════════════════════════════════════════════════════════════════════════════

import { getTenantByPhone } from '../services/tenants.js';
import { findReservations } from '../services/reservations.js';

function formatDateItalian(dateInput, timezone = 'Europe/Rome') {
  if (!dateInput) return '';
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

export async function trovaPrenotazioneTool(restaurantConfig, params, meta = {}) {
  let tenant = restaurantConfig;
  if (!tenant?.id && restaurantConfig?.phone_number) {
    tenant = await getTenantByPhone(restaurantConfig.phone_number);
    if (!tenant) return { found: false, count: 0, motivo: 'tenant_not_found' };
  }
  if (!tenant?.id) return { found: false, count: 0, motivo: 'invalid_tenant' };

  const nome = params.nome || params.name || null;
  const data = params.data || params.date || null;

  // v7.7.18: NON passiamo phone come filtro strict.
  const callerPhoneForAudit = params.telefono || params.phone || meta.callerPhone || null;

  if (!nome) {
    return { found: false, count: 0, motivo: 'missing_nome' };
  }

  const result = await findReservations(tenant, {
    name: nome,
    date: data,
    limit: 5,
  });

  const reservations = result.reservations || [];

  if (reservations.length === 0) {
    return {
      found: false,
      count: 0,
      motivo: 'non_trovata',
    };
  }

  // Se c'è un solo risultato, restituisci quella (con enrichment v7.7.31)
  if (reservations.length === 1) {
    const r = reservations[0];
    return {
      found: true,
      count: 1,
      reservation: {
        id: r.id,
        nome: r.name,
        data: r.date,
        data_naturale: formatDateItalian(r.date, tenant.timezone),
        ora: r.time,
        ora_short: shortTime(r.time),
        persone: r.people,
        note: r.notes || '',
        phone: r.phone,
      },
      caller_matches_phone: callerPhoneForAudit && r.phone && callerPhoneForAudit === r.phone,
    };
  }

  // Multipli risultati: ordina per match phone (chi matcha viene primo)
  const withMatch = reservations.map(r => ({
    ...r,
    _phoneMatch: callerPhoneForAudit && r.phone === callerPhoneForAudit ? 1 : 0,
  })).sort((a, b) => b._phoneMatch - a._phoneMatch);

  return {
    found: true,
    count: withMatch.length,
    reservations: withMatch.map(r => ({
      id: r.id,
      nome: r.name,
      data: r.date,
      data_naturale: formatDateItalian(r.date, tenant.timezone),  // v7.7.31: pronto per TTS
      ora: r.time,
      ora_short: shortTime(r.time),                                // v7.7.31: pronto per TTS
      persone: r.people,
      note: r.notes || '',
      phone: r.phone,
    })),
    // Modello deve chiedere disambiguazione al caller
    needs_disambiguation: true,
    // v7.7.31: hint esplicito al modello per prevenire mapped[0] bug
    disambiguation_hint: 'Chiedi al cliente quale prenotazione vuole tra quelle elencate (usa data_naturale). Passa data + eventId corretto nella chiamata successiva.',
  };
}
