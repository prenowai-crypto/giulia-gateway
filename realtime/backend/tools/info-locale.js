// ═══════════════════════════════════════════════════════════════════════════════
// TOOL: info_locale
// ═══════════════════════════════════════════════════════════════════════════════
// Restituisce info del ristorante (generali, menu, chiusure).
// Drop-in replacement per la vecchia chiamata Apps Script get_restaurant_info.
//
// Payload input (dal modello):
//   { argomento?: string }
//
// Il campo `argomento` guida cosa restituire:
//   - "menu", "piatti", "cosa avete", "primi", "secondi", "antipasti" ecc.
//                                        → menu strutturato
//   - "chiusure", "chiuso", "festivo"    → chiusure straordinarie
//   - "orari", "apertura", "quando aprite" → info generali con orari (JSONB)
//   - "parcheggio", "wifi", "accessibilità", "cucina", "pagamento", ecc.
//                                        → info dal JSONB
//   - vuoto o non riconosciuto           → tutto (info + menu breve)
//
// Risposta output (formato flessibile — il modello estrae ciò che serve):
//   { success: true, info: {...}, menu?: {...}, chiusure?: [...] }
// ═══════════════════════════════════════════════════════════════════════════════

import { getTenantByPhone } from '../services/tenants.js';
import { getInfoLocale, getMenuGrouped, getClosures } from '../services/info-locale.js';

// Parole chiave per classificare l'argomento del cliente
const MENU_KEYWORDS = [
  'menu', 'menù', 'piatti', 'piatto', 'cosa avete', 'cosa fate',
  'antipasti', 'antipasto', 'primi', 'primo', 'secondi', 'secondo',
  'contorni', 'contorno', 'dolci', 'dolce', 'dessert',
  'carbonara', 'pasta', 'pizza', 'pesce', 'carne', 'vegetarian',
  'specialit', 'cucina',
];

// FIX v7.7.11: rimosse 'aperto' e 'apert' — matchavano 'quando aprite',
// 'orari di apertura' e triggeravano getClosures invece di getInfoLocale.
// Le chiusure sono eventi straordinari, non domande sugli orari base.
const CLOSURE_KEYWORDS = [
  'chiuso', 'chiusa', 'chiuse', 'chiusi', 'chiusure', 'chiudete',
  'evento privato', 'festivo', 'festivi', 'ferie', 'vacanze',
];

// FIX v7.7.11: nuova categoria per domande sugli orari base di apertura.
// Match esplicito prima di CLOSURE_KEYWORDS per evitare falsi positivi.
const OPENING_KEYWORDS = [
  'orari', 'orario', 'apertura', 'aperture', 'aprite', 'apre', 'aprono',
  'quando siete aperti', 'quando siete aperte', 'quando aprite',
  'a che ora', 'che ore', 'che orari',
];

const CATEGORY_MAP = {
  'antipasti': 'ANTIPASTI', 'antipasto': 'ANTIPASTI',
  'primi':     'PRIMI',     'primo': 'PRIMI',
  'secondi':   'SECONDI',   'secondo': 'SECONDI',
  'contorni':  'CONTORNI',  'contorno': 'CONTORNI',
  'dolci':     'DOLCI',     'dolce': 'DOLCI',   'dessert': 'DOLCI',
};

function detectCategoria(arg) {
  for (const [k, v] of Object.entries(CATEGORY_MAP)) {
    if (arg.includes(k)) return v;
  }
  return null;
}

function containsAny(text, keywords) {
  return keywords.some(k => text.includes(k));
}

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

  const argomento = String(params.argomento || '').toLowerCase().trim();

  // Se l'argomento riguarda il menu → restituisci menu (filtrato per categoria se dedotta)
  if (argomento && containsAny(argomento, MENU_KEYWORDS)) {
    const categoria = detectCategoria(argomento);
    const menuResult = await getMenuGrouped(tenant, categoria ? { categoria } : {});
    if (menuResult.success && menuResult.count > 0) {
      return { success: true, tipo: 'menu', menu: menuResult.menu, count: menuResult.count };
    }
    // Se il menu è vuoto, fallback su info generali
  }

  // FIX v7.7.11: check OPENING_KEYWORDS PRIMA di CLOSURE_KEYWORDS.
  // Se l'argomento riguarda gli orari di apertura → restituisci info generali (JSONB)
  // che contengono gli orari base, NON le chiusure straordinarie.
  if (argomento && containsAny(argomento, OPENING_KEYWORDS)) {
    const infoResult = await getInfoLocale(tenant);
    if (infoResult.success) {
      return { success: true, tipo: 'info', info: infoResult.info || {} };
    }
    // Se info è vuota, fallback sotto
  }

  // Se l'argomento riguarda le chiusure → restituisci chiusure future
  if (argomento && containsAny(argomento, CLOSURE_KEYWORDS)) {
    const closuresResult = await getClosures(tenant, { limit: 5 });
    const infoResult = await getInfoLocale(tenant);
    return {
      success: true,
      tipo: 'chiusure',
      chiusure: closuresResult.closures,
      info_generali: infoResult.info,   // includo anche orari generali dal JSONB
    };
  }

  // Altrimenti → info generali dal JSONB (filtrata se possibile)
  const infoResult = await getInfoLocale(tenant);
  if (!infoResult.success) {
    return { success: false, info: {}, message: infoResult.message };
  }

  const info = infoResult.info || {};

  // Se argomento specifico, filtro le chiavi rilevanti
  if (argomento) {
    const relevantKeys = Object.keys(info).filter(k =>
      k.toLowerCase().includes(argomento) || argomento.includes(k.toLowerCase())
    );
    if (relevantKeys.length > 0) {
      const filtered = {};
      for (const k of relevantKeys) filtered[k] = info[k];
      return { success: true, tipo: 'info', info: filtered };
    }
  }

  // Nessun match specifico → info completa (il modello sceglie cosa dire)
  if (Object.keys(info).length === 0) {
    return { success: false, info: {}, message: 'informazione non disponibile' };
  }
  return { success: true, tipo: 'info', info };
}
