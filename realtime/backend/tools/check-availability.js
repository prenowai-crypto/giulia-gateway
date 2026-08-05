// ═══════════════════════════════════════════════════════════════════════════════
// TOOL: controlla_disponibilita
// ═══════════════════════════════════════════════════════════════════════════════
// Verifica se uno slot (data + ora + persone) è disponibile.
// Usato dal modello PRIMA di crea_prenotazione o quando il cliente sposta data.
//
// Payload input:
//   {
//     data: "2026-08-07",
//     ora: "21:00",
//     persone: 4,
//   }
//
// Risposta output (identica ad Apps Script):
//   Slot libero:  { esito: "libero", slot_available: true, capienza, disponibili }
//   Slot pieno:   { esito: "slot_full", slot_available: false }
//   Giorno chiuso: { esito: "day_closed", giorno }
//   ...
// ═══════════════════════════════════════════════════════════════════════════════

import { getTenantByPhone } from '../services/tenants.js';
import { checkAvailability } from '../services/availability.js';

export async function controllaDisponibilitaTool(restaurantConfig, params, meta = {}) {
  let tenant = restaurantConfig;

  if (!tenant?.id && restaurantConfig?.twilio_number) {
    tenant = await getTenantByPhone(restaurantConfig.twilio_number);
    if (!tenant) return { esito: 'tenant_not_found', slot_available: false };
  }
  if (!tenant?.id) return { esito: 'invalid_tenant', slot_available: false };

  const result = await checkAvailability(tenant, {
    date: params.data,
    time: params.ora,
    people: Number(params.persone),
  });

  // Aggiungo il flag `slot_available` boolean per compatibilità con come il
  // modello legge il risultato (nel prompt v7.5.1 il modello controlla
  // `slot_available: true/false`).
  const slotAvailable = result.esito === 'libero' || result.esito === 'gruppo_grande';

  return {
    ...result,
    slot_available: slotAvailable,
  };
}
