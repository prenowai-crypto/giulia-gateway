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

  // v7.7.28: matching intelligente con synonyms map + normalization.
  // Il fix v7.7.27 era troppo strict (underscore vs spazio rompeva il match).
  // Ora usiamo synonyms + normalization per catturare varianti naturali del cliente.
  const SYNONYMS = {
    // chiave DB → parole/frasi che il cliente potrebbe usare
    'metodi_pagamento':  ['pagament', 'carta', 'bancomat', 'pos', 'cash', 'contanti', 'satispay'],
    'prezzi_extra':      ['coperto', 'servizio', 'extra', 'sovrapprezzo', 'costo extra'],
    'senza_glutine':     ['glutine', 'celiac', 'gluten', 'senza glutine'],
    'accessibility':     ['accessibil', 'disabili', 'sedia a rotelle', 'carrozzella', 'barriere'],
    'seggiolone':        ['seggiolon', 'bambini', 'bambin', 'sedia bimbo', 'sedia bambino'],
    'dehors':            ['dehor', 'esterno', 'terrazza', 'giardino', 'fuori', 'tavoli fuori', 'all\'aperto'],
    'parcheggio':        ['parcheggi', 'posto auto', 'posti auto', 'garage', 'macchina'],
    'vegano':            ['vegan'],
    'indirizzo':         ['indirizz', 'dove siete', 'dove si trova', 'dove è', 'dov e', 'dove è', 'via', 'strada', 'ubicazione', 'raggiung', 'come arriv'],
    'cucina':            ['cucina', 'tipo di cucina', 'che cucina', 'tipico', 'tipica', 'specialità', 'specialita'],
    'menu_descrizione':  ['menu', 'menù', 'piatti', 'piatto'],
    'telefono_pubblico': ['telefono', 'numero', 'contatto', 'chiamare', 'contattarvi'],
  };

  function normalize(s) {
    return String(s).toLowerCase()
      .replace(/_/g, ' ')
      .replace(/[àáâãä]/g, 'a').replace(/[èéêë]/g, 'e').replace(/[ìíîï]/g, 'i')
      .replace(/[òóôõö]/g, 'o').replace(/[ùúûü]/g, 'u')
      .trim();
  }

  // Se argomento specifico, provo 3 strategie di matching
  if (argomento) {
    const argNorm = normalize(argomento);
    const matched = new Set();

    // Strategia 1: nome chiave normalizzato (metodi_pagamento → "metodi pagamento") contenuto/contenente argomento
    for (const key of Object.keys(info)) {
      const keyNorm = normalize(key);
      if (keyNorm.includes(argNorm) || argNorm.includes(keyNorm)) {
        matched.add(key);
      }
    }

    // Strategia 2: synonyms map
    for (const [key, synonyms] of Object.entries(SYNONYMS)) {
      if (!info[key]) continue; // chiave non presente nel tenant
      for (const syn of synonyms) {
        if (argNorm.includes(normalize(syn))) {
          matched.add(key);
          break;
        }
      }
    }

    // Strategia 3: split per parole (per catturare frasi più complesse)
    const words = argNorm.split(/\s+/).filter(w => w.length >= 3);
    for (const word of words) {
      for (const key of Object.keys(info)) {
        if (normalize(key).includes(word)) {
          matched.add(key);
        }
      }
    }

    if (matched.size > 0) {
      const filtered = {};
      for (const k of matched) filtered[k] = info[k];
      return { success: true, tipo: 'info', info: filtered };
    }

    // Nessun match dopo 3 strategie → info davvero non disponibile.
    // v7.7.27 anti-hallucination: return esplicito così il modello non inventa.
    return {
      success: false,
      tipo: 'info_non_disponibile',
      argomento_richiesto: argomento,
      chiavi_disponibili: Object.keys(info),
      message: `L'informazione richiesta ("${argomento}") non è tra i dati registrati per questo ristorante. NON inventare la risposta: informa il cliente che questo dato non è disponibile e suggerisci di chiamare direttamente il ristorante al numero pubblico.`,
    };
  }

  // Nessun argomento → info completa
  if (Object.keys(info).length === 0) {
    return { success: false, info: {}, message: 'informazione non disponibile' };
  }
  return { success: true, tipo: 'info', info };
}
