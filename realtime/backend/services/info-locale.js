// ═══════════════════════════════════════════════════════════════════════════════
// INFO LOCALE SERVICE — Info generali + Menu + Chiusure del ristorante
// ═══════════════════════════════════════════════════════════════════════════════
// v7.7.5: aggiunta lettura menu strutturato dalla tabella tenant_menu
//         e chiusure straordinarie da tenant_closures.
//
// Fonti dati:
//   - tenants.info_locale JSONB    → info generali (parcheggio, wifi, ecc.)
//   - tenant_menu tabella           → piatti strutturati per categoria
//   - tenant_closures tabella       → chiusure straordinarie
// ═══════════════════════════════════════════════════════════════════════════════

import { query } from '../db.js';

/**
 * getInfoLocale(tenant)
 * Restituisce le info generali dal JSONB. Fast path se già in restaurantConfig.
 */
export async function getInfoLocale(tenant) {
  if (!tenant) throw new Error('getInfoLocale: tenant mancante');

  // Fast path: già in restaurantConfig (caricato con getTenantByPhone)
  if (tenant.info_locale && Object.keys(tenant.info_locale).length > 0) {
    return { success: true, info: tenant.info_locale };
  }

  // Fallback: query mirata
  try {
    const result = await query(
      `SELECT info_locale FROM tenants WHERE id = $1 LIMIT 1`,
      [tenant.id]
    );
    if (result.rows.length === 0) {
      return { success: false, info: {}, message: 'tenant non trovato' };
    }
    return { success: true, info: result.rows[0].info_locale || {} };
  } catch (err) {
    console.error(`❌ getInfoLocale error: ${err.message}`);
    return { success: false, info: {}, message: err.message };
  }
}

/**
 * getMenu(tenant, options)
 * Restituisce il menu strutturato del ristorante (piatti in array piatto).
 *
 * @param {object} tenant
 * @param {object} options
 *   - categoria: string  filtra per categoria specifica (case-insensitive)
 *   - onlyAttivo: bool   solo piatti attivi (default true)
 * @returns {Promise<{success, menu: [{categoria, piatto, prezzo, descrizione}], count}>}
 */
export async function getMenu(tenant, options = {}) {
  if (!tenant) throw new Error('getMenu: tenant mancante');
  if (!tenant.id) return { success: false, menu: [], count: 0, message: 'tenant senza id' };

  const { categoria = null, onlyAttivo = true } = options;

  const sql = `
    SELECT categoria, piatto, prezzo::float AS prezzo, descrizione, ordine
      FROM tenant_menu
     WHERE tenant_id = $1
       ${onlyAttivo ? 'AND attivo = true' : ''}
       ${categoria ? 'AND upper(categoria) = upper($2)' : ''}
     ORDER BY
       CASE categoria
         WHEN 'ANTIPASTI' THEN 1
         WHEN 'PRIMI'     THEN 2
         WHEN 'SECONDI'   THEN 3
         WHEN 'CONTORNI'  THEN 4
         WHEN 'DOLCI'     THEN 5
         WHEN 'INFO'      THEN 99
         ELSE 50
       END,
       ordine ASC, piatto ASC
  `;

  try {
    const params = [tenant.id];
    if (categoria) params.push(categoria);
    const result = await query(sql, params);
    return { success: true, menu: result.rows, count: result.rows.length };
  } catch (err) {
    console.error(`❌ getMenu error: ${err.message}`);
    return { success: false, menu: [], count: 0, message: err.message };
  }
}

/**
 * getMenuGrouped(tenant, options)
 * Come getMenu ma raggruppato per categoria (piu comodo per il modello).
 *
 * @returns {Promise<{success, menu: {ANTIPASTI: [...], PRIMI: [...], ...}, count}>}
 */
export async function getMenuGrouped(tenant, options = {}) {
  const flat = await getMenu(tenant, options);
  if (!flat.success) return flat;

  const grouped = {};
  for (const dish of flat.menu) {
    const cat = dish.categoria;
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push({
      piatto: dish.piatto,
      prezzo: dish.prezzo,
      descrizione: dish.descrizione,
    });
  }

  return { success: true, menu: grouped, count: flat.count };
}

/**
 * getClosures(tenant, options)
 * Restituisce le chiusure straordinarie future del ristorante.
 *
 * @param {object} tenant
 * @param {object} options
 *   - fromDate: string YYYY-MM-DD  (default: oggi)
 *   - limit: number                 (default: 20)
 * @returns {Promise<{success, closures: [{date, reason}], count}>}
 */
export async function getClosures(tenant, options = {}) {
  if (!tenant) throw new Error('getClosures: tenant mancante');
  if (!tenant.id) return { success: false, closures: [], count: 0 };

  const fromDate = options.fromDate || new Date().toISOString().substring(0, 10);
  const limit = Math.min(Number(options.limit) || 20, 100);

  try {
    const result = await query(
      `SELECT date::text AS date, reason
         FROM tenant_closures
        WHERE tenant_id = $1 AND date >= $2
        ORDER BY date ASC
        LIMIT $3`,
      [tenant.id, fromDate, limit]
    );
    return { success: true, closures: result.rows, count: result.rows.length };
  } catch (err) {
    console.error(`❌ getClosures error: ${err.message}`);
    return { success: false, closures: [], count: 0, message: err.message };
  }
}

/**
 * isSpecialClosureDate(tenant, dateISO)
 * Controlla se una data specifica ha una chiusura straordinaria.
 * Utile in checkAvailability per rifiutare prenotazioni su giorni chiusi ad hoc.
 *
 * @returns {Promise<{closed: boolean, reason?: string}>}
 */
export async function isSpecialClosureDate(tenant, dateISO) {
  if (!tenant?.id || !dateISO) return { closed: false };

  try {
    const result = await query(
      `SELECT reason FROM tenant_closures
        WHERE tenant_id = $1 AND date = $2::date
        LIMIT 1`,
      [tenant.id, dateISO]
    );
    if (result.rows.length === 0) return { closed: false };
    return { closed: true, reason: result.rows[0].reason || 'chiusura straordinaria' };
  } catch (err) {
    console.error(`❌ isSpecialClosureDate error: ${err.message}`);
    return { closed: false };
  }
}
