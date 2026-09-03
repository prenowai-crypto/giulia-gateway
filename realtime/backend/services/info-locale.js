// ═══════════════════════════════════════════════════════════════════════════════
// INFO LOCALE SERVICE — Info generali + Menu + Chiusure del ristorante (v7.7.30)
// ═══════════════════════════════════════════════════════════════════════════════
// v7.7.30 (2026-08-30):
//   - getInfoLocale ora RESTITUISCE ANCHE orari precisi (lunch/dinner start-end),
//     closedDays settimanali e chiusure straordinarie prossime future.
//     Fix bug B10-010/011/012: modello inventava orari (es. "19:30") o
//     contraddiceva chiusura lunedì perché non aveva i dati esposti dal tool.
//   - Aggiunto FESTIVITÀ_MAP per tradurre nomi festività italiane in date ISO.
//   - Nuovo getInfoConDate(tenant, {date_iso?, festività?}): consulta closures
//     per data specifica o nome festività. Fix bug B10-013 Natale.
//
// v7.7.5: aggiunta lettura menu strutturato dalla tabella tenant_menu
//         e chiusure straordinarie da closures.
//
// Fonti dati:
//   - tenants.info_locale JSONB    → info generali (parcheggio, wifi, ecc.)
//   - tenants (colonne)             → orari precisi, closedDays, timezone
//   - tenant_menu tabella           → piatti strutturati per categoria
//   - closures tabella              → chiusure straordinarie
// ═══════════════════════════════════════════════════════════════════════════════

import { query } from '../db.js';

// ═══════════════════════════════════════════════════════════════════════════════
// v7.7.30: HELPERS orari + festività
// ═══════════════════════════════════════════════════════════════════════════════

// Nomi giorni settimana italiani per esporli in modo leggibile al modello.
const DAY_NAMES_IT = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];

// Mappa festività italiane → date ISO (mese-giorno).
// Se il cliente dice "Natale", "Pasqua", ecc., possiamo tradurre in data specifica
// e consultare la tabella closures per verificare chiusura.
// NOTA: Pasqua è variabile — per semplicità l'omettiamo qui, il ristoratore
// dovrebbe inserire chiusura specifica per l'anno in tabella closures.
const FESTIVITA_FISSE = {
  'natale':          '12-25',
  'santo stefano':   '12-26',
  'capodanno':       '01-01',
  'epifania':        '01-06',
  'befana':          '01-06',
  'liberazione':     '04-25',
  'lavoro':          '05-01',
  'primo maggio':    '05-01',
  'festa repubblica':'06-02',
  'ferragosto':      '08-15',
  'ognissanti':      '11-01',
  'tutti i santi':   '11-01',
  'immacolata':      '12-08',
  'san silvestro':   '12-31',
};

/**
 * Costruisce l'oggetto "orari" leggibile dal modello a partire dai campi tenant.
 */
function buildOrariBlock(tenant) {
  if (!tenant) return null;

  const lunchStart  = tenant.lunchStart  || tenant.lunch_start  || null;
  const lunchEnd    = tenant.lunchEnd    || tenant.lunch_end    || null;
  const dinnerStart = tenant.dinnerStart || tenant.dinner_start || null;
  const dinnerEnd   = tenant.dinnerEnd   || tenant.dinner_end   || null;

  const closedDays        = tenant.closedDays        || tenant.closed_days        || [];
  const lunchClosedDays   = tenant.lunchClosedDays   || tenant.lunch_closed_days  || [];
  const dinnerClosedDays  = tenant.dinnerClosedDays  || tenant.dinner_closed_days || [];

  const orari = {};

  if (lunchStart && lunchEnd) {
    orari.pranzo = `${lunchStart} - ${lunchEnd}`;
  } else {
    orari.pranzo = null; // non servito
  }

  if (dinnerStart && dinnerEnd) {
    orari.cena = `${dinnerStart} - ${dinnerEnd}`;
  } else {
    orari.cena = null;
  }

  orari.giorni_chiusi_settimanali = (closedDays || []).map(d => DAY_NAMES_IT[d]);
  orari.chiusi_solo_a_pranzo      = (lunchClosedDays || []).map(d => DAY_NAMES_IT[d]);
  orari.chiusi_solo_a_cena        = (dinnerClosedDays || []).map(d => DAY_NAMES_IT[d]);

  return orari;
}

/**
 * Data una stringa in linguaggio naturale (es. "Natale", "25 dicembre"),
 * prova a estrarre una data ISO per l'anno corrente o successivo.
 * @returns {string|null} "YYYY-MM-DD" o null se non riconosciuto.
 */
export function resolveFestivitaToISO(query, tenantTimezone = 'Europe/Rome') {
  if (!query || typeof query !== 'string') return null;
  const q = query.toLowerCase().trim();

  // Cerca festività nota
  for (const [nome, mmdd] of Object.entries(FESTIVITA_FISSE)) {
    if (q.includes(nome)) {
      const nowRome = new Date().toLocaleString('sv-SE', { timeZone: tenantTimezone });
      const currentYear = parseInt(nowRome.substring(0, 4), 10);
      const currentDate = nowRome.substring(0, 10);
      const candidate = `${currentYear}-${mmdd}`;
      // Se la festività di quest'anno è passata, uso quella dell'anno prossimo
      return (candidate < currentDate) ? `${currentYear + 1}-${mmdd}` : candidate;
    }
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SERVICES PRINCIPALI
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * getInfoLocale(tenant, options)
 * Restituisce le info generali dal JSONB ARRICCHITE con orari precisi,
 * giorni di chiusura settimanali e chiusure straordinarie prossime.
 *
 * v7.7.30: prima restituiva solo il JSONB "grezzo" senza orari precisi né
 * closedDays — il modello inventava orari o contraddiceva chiusure. Ora
 * il tool_result contiene tutti i dati necessari per rispondere correttamente
 * a domande su orari, giorni chiusi, chiusure straordinarie.
 *
 * @param {object} options
 *   - includeUpcomingClosures: bool  se true (default) aggiunge chiusure future 60gg
 *   - closuresLimit: number          limite chiusure future (default 10)
 */
export async function getInfoLocale(tenant, options = {}) {
  if (!tenant) throw new Error('getInfoLocale: tenant mancante');

  const {
    includeUpcomingClosures = true,
    closuresLimit = 10,
  } = options;

  // 1. Base: JSONB info_locale del tenant
  let baseInfo = {};
  if (tenant.info_locale && Object.keys(tenant.info_locale).length > 0) {
    baseInfo = { ...tenant.info_locale };
  } else {
    try {
      const result = await query(
        `SELECT info_locale FROM tenants WHERE id = $1 LIMIT 1`,
        [tenant.id]
      );
      if (result.rows.length === 0) {
        return { success: false, info: {}, message: 'tenant non trovato' };
      }
      baseInfo = result.rows[0].info_locale || {};
    } catch (err) {
      console.error(`❌ getInfoLocale error: ${err.message}`);
      return { success: false, info: {}, message: err.message };
    }
  }

  // 2. v7.7.30: arricchisco con orari precisi + closedDays
  const orari = buildOrariBlock(tenant);
  if (orari) baseInfo.orari_apertura = orari;

  // 3. v7.7.30: aggiungo chiusure straordinarie future (60 gg avanti) se richiesto
  if (includeUpcomingClosures) {
    try {
      const upcoming = await getClosures(tenant, { limit: closuresLimit });
      if (upcoming.success && upcoming.closures.length > 0) {
        baseInfo.chiusure_straordinarie_prossime = upcoming.closures.map(c => ({
          data: c.date,
          motivo: c.reason || 'chiusura straordinaria',
        }));
      } else {
        baseInfo.chiusure_straordinarie_prossime = [];
      }
    } catch (err) {
      // non blocco l'intera risposta se questo fallisce
      console.error(`⚠️  getInfoLocale: closures fetch failed: ${err.message}`);
    }
  }

  return { success: true, info: baseInfo };
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
         FROM closures
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
      `SELECT reason FROM closures
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

/**
 * v7.7.30: checkFestivitaClosure(tenant, query)
 * Traduce nome festività (o data verbale) in ISO e verifica chiusura.
 * Utile per rispondere a "siete aperti a Natale?" — il tool wrapper può
 * chiamare questa funzione per il branch CLOSURE_FESTIVITA.
 *
 * @param {object} tenant
 * @param {string} queryText  es. "Natale", "25 dicembre", "Ferragosto"
 * @returns {Promise<{festivita_rilevata: boolean, data_iso?: string,
 *                    chiusa?: boolean, motivo?: string, giorno_settimana?: string}>}
 */
export async function checkFestivitaClosure(tenant, queryText) {
  const dateISO = resolveFestivitaToISO(queryText, tenant?.timezone || 'Europe/Rome');
  if (!dateISO) return { festivita_rilevata: false };

  // Verifica chiusura straordinaria per quella data
  const closure = await isSpecialClosureDate(tenant, dateISO);

  // Anche verifica se cade in giorno di chiusura settimanale
  const d = new Date(`${dateISO}T12:00:00Z`);
  const dow = d.getUTCDay();
  const closedDays = tenant.closedDays || tenant.closed_days || [];
  const closedForWeeklyDay = closedDays.includes(dow);

  return {
    festivita_rilevata: true,
    data_iso: dateISO,
    giorno_settimana: DAY_NAMES_IT[dow],
    chiusa: closure.closed || closedForWeeklyDay,
    motivo: closure.reason || (closedForWeeklyDay ? `giorno di chiusura settimanale (${DAY_NAMES_IT[dow]})` : null),
  };
}
