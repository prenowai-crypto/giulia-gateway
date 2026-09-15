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
// Payload input:
//   { nome: "Rossi", data: "2026-08-22" }
//
// Meta (dal gateway):
//   { callId, callerPhone }
// ═══════════════════════════════════════════════════════════════════════════════

import { getTenantByPhone } from '../services/tenants.js';
import { findReservations } from '../services/reservations.js';

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
  // La ricerca è per nome + data (opzionale). Phone del caller viene
  // salvato solo per audit / boost score futuro se necessario.
  const callerPhoneForAudit = params.telefono || params.phone || meta.callerPhone || null;

  if (!nome) {
    return { found: false, count: 0, motivo: 'missing_nome' };
  }

  const result = await findReservations(tenant, {
    name: nome,
    date: data,
    // NO phone filter: chiunque può cercare per nome
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

  // Se c'è un solo risultato, restituisci quella
  if (reservations.length === 1) {
    const r = reservations[0];
    return {
      found: true,
      count: 1,
      reservation: {
        id: r.id,
        nome: r.name,
        data: r.date,
        ora: r.time,
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
      ora: r.time,
      persone: r.people,
      note: r.notes || '',
      phone: r.phone,
    })),
    // Modello deve chiedere disambiguazione al caller
    needs_disambiguation: true,
  };
}
