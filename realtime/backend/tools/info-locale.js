// ═══════════════════════════════════════════════════════════════════════════════
// INFO LOCALE SERVICE — Info statiche del ristorante da Postgres JSONB
// ═══════════════════════════════════════════════════════════════════════════════
// Sostituisce la vecchia chiamata Apps Script `get_restaurant_info`.
//
// Il campo `tenants.info_locale` è JSONB e può contenere qualsiasi chiave:
//   {
//     "menu": "Cucina italiana tradizionale...",
//     "parcheggio": "Disponibile a 100 metri",
//     "accessibility": "Purtroppo non accessibile a sedie a rotelle",
//     "wifi": "Disponibile, chiedere al personale",
//     "orari_leggibili": "Pranzo 12-14:30, Cena 21-22:30",
//     "prezzo_medio": "€25-35 a persona",
//     "indirizzo": "Via Roma 123, Milano",
//     "animali": "Ammessi solo cani piccoli",
//     "carte_credito": "Accettate Visa, Mastercard, Amex",
//     ...
//   }
//
// Il modello riceve l'oggetto intero e sceglie cosa dire in base alla domanda
// del cliente. È estensibile: aggiungere una chiave nel DB = subito disponibile.
// ═══════════════════════════════════════════════════════════════════════════════

import { query } from '../db.js';

/**
 * getInfoLocale(tenant)
 *
 * Restituisce l'oggetto info_locale del tenant. Se il tenant l'ha già in cache
 * (dal getTenantByPhone), non fa query. Altrimenti fa una query mirata.
 *
 * @param {object} tenant  - dalla getTenantByPhone()
 * @returns {Promise<{success: boolean, info: object}>}
 */
export async function getInfoLocale(tenant) {
  if (!tenant) throw new Error('getInfoLocale: tenant mancante');

  // Fast path: se il tenant caricato dal getTenantByPhone già include info_locale,
  // ritorno direttamente (Redis cache = risposta in <5ms).
  if (tenant.info_locale && Object.keys(tenant.info_locale).length > 0) {
    return { success: true, info: tenant.info_locale };
  }

  // Slow path: query mirata al DB (~10-30ms)
  try {
    const result = await query(
      `SELECT info_locale FROM tenants WHERE id = $1 LIMIT 1`,
      [tenant.id]
    );
    if (result.rows.length === 0) {
      return { success: false, info: {}, message: 'tenant non trovato' };
    }
    const info = result.rows[0].info_locale || {};
    return { success: true, info };
  } catch (err) {
    console.error(`❌ getInfoLocale error: ${err.message}`);
    return { success: false, info: {}, message: err.message };
  }
}
