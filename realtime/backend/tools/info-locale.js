// ═══════════════════════════════════════════════════════════════════════════════
// TOOL: info_locale
// ═══════════════════════════════════════════════════════════════════════════════
// Restituisce info statiche del ristorante (menu, parcheggio, wifi, ecc.).
// Drop-in replacement per la vecchia chiamata Apps Script `get_restaurant_info`.
//
// Payload input (dal modello):
//   { argomento?: "menu" | "parcheggio" | "wifi" | ... }
//
// Nota: `argomento` è opzionale — se il modello lo passa possiamo filtrare
// per ridurre il token count, ma per adesso restituiamo tutto (l'oggetto
// è piccolo, ~500 byte).
//
// Risposta output (drop-in con Apps Script):
//   {
//     success: true,
//     info: {
//       menu: "...",
//       parcheggio: "...",
//       ...
//     }
//   }
// ═══════════════════════════════════════════════════════════════════════════════

import { getTenantByPhone } from '../services/tenants.js';
import { getInfoLocale } from '../services/info-locale.js';

export async function infoLocaleTool(restaurantConfig, params = {}, meta = {}) {
  let tenant = restaurantConfig;

  if (!tenant?.id && restaurantConfig?.twilio_number) {
    tenant = await getTenantByPhone(restaurantConfig.twilio_number);
    if (!tenant) {
      return { success: false, info: {}, message: 'Configurazione ristorante non trovata' };
    }
  }
  if (!tenant?.id) {
    return { success: false, info: {}, message: 'Configurazione ristorante non valida' };
  }

  const result = await getInfoLocale(tenant);

  // Filtro opzionale per argomento (se il modello lo passa)
  const argomento = String(params.argomento || '').toLowerCase().trim();
  if (argomento && result.success && result.info) {
    // Se il modello chiede uno specifico argomento e la chiave esiste, ritorno
    // solo quello + tutte le chiavi correlate (contengono la parola argomento).
    const relevantKeys = Object.keys(result.info).filter(k =>
      k.toLowerCase().includes(argomento) || argomento.includes(k.toLowerCase())
    );
    if (relevantKeys.length > 0) {
      const filtered = {};
      for (const k of relevantKeys) filtered[k] = result.info[k];
      return { success: true, info: filtered };
    }
    // Se non c'è match, ritorno tutto (il modello sceglie)
  }

  return result;
}
