// ═══════════════════════════════════════════════════════════════════════════════
// PRENOW - RECEPTIONIST AI GATEWAY v3.9.31
// Architettura pulita con RECAP deterministico per cancel/modify
// 
// 🆕 FIX v3.9.31 - MULTI-TENANT COMPLETO:
//
// Orari e chiusure ora letti dal Registry Sheet per ogni ristorante:
//   - closed_days: giorni chiusura settimanale (es: "1" o "1,7")
//   - lunch_start, lunch_end: orari pranzo (es: "12:00", "15:00")
//   - dinner_start, dinner_end: orari cena (es: "19:00", "22:30")
//   - large_group_threshold: soglia gruppi grandi (default 10)
//   - event_threshold: soglia eventi (default 45)
//   - receptionist_name: nome assistente (default "Giulia")
//
// Modifiche principali:
//   - ConfigHelper: nuova utility per leggere config ristorante
//   - ValidationPipeline.isValidTime(): usa orari dinamici
//   - DateManager.buildCalendar(): usa closed_days dinamici
//   - ClosureChecker.isOpen(): usa closed_days dinamici
//   - GPTService.buildSystemPrompt(): usa orari/chiusure dinamici
//   - Messaggi errore: usano orari dinamici
//
// ─────────────────────────────────────────────────────────────────────────────
// FIX v3.9.30 - BUG D10 + I4 + TEST J (FUNZIONALITÀ FUTURE):
//
// D10: Gruppi grandi (>10 pax) - Gestione PENDING_OWNER migliorata
//   - Resta in pending_large_group finché cliente non chiude esplicitamente
//   - Se cliente insiste per conferma immediata → spiega che serve conferma ristoratore
//   - Se cliente accetta (ok, grazie, capito) → chiude conversazione
//   - Evita che GPT risponda "è confermata" quando status è PENDING_OWNER
//
// I4: Orari in lettere (es. "venti e trenta" → 20:30)
//   - TimeManager ora riconosce numeri scritti in lettere
//   - Supporto: undici...ventitré, mezza, un quarto, trenta, etc.
//   - Funziona sia in italiano che inglese
//
// 🆕 J1-J10: NOTE CLIENTE (allergie, richieste speciali, occasioni)
//   - Rilevamento automatico: celiaco, allergia, seggiolone, anniversario, compleanno, etc.
//   - Salvataggio note nel calendario e log prenotazioni
//   - GPT conferma la nota presa ("Ho annotato che sei celiaca")
//
// 🆕 J3: NON INVENTARE (accessibilità, parcheggio, servizi)
//   - GPT non inventa più informazioni su accessibilità
//   - Risponde "Non ho questa informazione, contatta direttamente il ristorante"
//
// 🆕 J8: TEMPO RELATIVO ("tra mezz'ora", "tra un'ora")
//   - Riconosce pattern come "tra mezz'ora", "tra 30 minuti", "in half an hour"
//   - Calcola orario effettivo e imposta data = oggi
//   - Arrotonda ai 15 minuti più vicini (slot)
//
// ─────────────────────────────────────────────────────────────────────────────
// FIX v3.9.29 - CRITICAL CAPACITY FIXES (E3, E4, E9, F9) (ereditati):
//
// E4 (P0 CRITICO): Check capacità MODIFY ora esclude pax esistenti
//   - Quando cliente diminuisce pax (8→5), Gateway salta il check
//   - Quando cliente aumenta pax (4→7), verifica solo pax AGGIUNTIVI (+3)
//   - Passa existingPeople ad Apps Script per conteggio corretto
//
// E3/E9 (P1): Check preventivo MODIFY corretto
//   - checkAvailability ora accetta parametro existingPeople
//   - Apps Script esclude pax esistenti dal conteggio capacità
//   - E3: aumento 4→7 verifica solo +3 pax aggiuntivi
//   - E9: cambio orario considera che slot originale si libera
//
// F9 (P1): Flusso multi-prenotazione corretto
//   - Dopo selezione in awaiting_which_reservation
//   - Skip awaiting_name → procede direttamente a conferma
//   - Se cancel: chiede conferma cancellazione
//   - Se modify: chiede cosa vuole modificare
//
// ─────────────────────────────────────────────────────────────────────────────
// FIX v3.9.26 - MINI BUG FIXES (ereditati):
//
// ZF9B: Skip proattività se cliente dice esplicitamente "altra/nuova prenotazione"
//   - Pattern: /\b(altra|nuova|second\w*)\s+(prenotazion|reservation)/i
//   - Se match, procede direttamente con CREATE senza chiedere
//
// ZG-NOME: Override ask_name → ask_email se ValidationPipeline ha estratto nome
//   - Se GPT dice ask_name ma NameManager ha estratto un nome valido
//   - Cambia action a ask_email per evitare richiesta ridondante
//
// E4-FLUSSO: Dopo switch a MODIFY, verifica nome nella risposta
//   - Se cliente dice "Sì sono X" e X corrisponde, passa direttamente a awaiting_modify_details
//   - Evita passaggio inutile per awaiting_name
//
// F6-RIPENSAMENTO: isDenying esteso per riconoscere ripensamenti
//   - Nuovi pattern: "teniamo/mantieni/lascia stare/lascia perdere/non cancellare"
//
// E10-UX: Riconosce "lascia perdere, va bene così" come annullamento modifica
//   - In awaiting_modify_details, pattern per mantenere originale
//
// F4-UX: Riconosce chiusura conversazione
//   - "va bene grazie/ok grazie" quando nessuna prenotazione trovata → chiude
//
// ─────────────────────────────────────────────────────────────────────────────
// FIX v3.9.25 (ereditati):
//
// BUG-023 (F1/F7): "confermo la cancellazione" ora riconosciuto nella stessa frase del nome
// E7: "martedì 10" ora usa il 10 come giorno del mese
// E10: Nel MODIFY, date prima della prenotazione originale vengono corrette
// E3/E5/E9: Check disponibilità PRIMA di chiedere conferma nel MODIFY
// E4: Proattività quando numero ha già prenotazione
//
// ─────────────────────────────────────────────────────────────────────────────
// FIX v3.9.24 (ereditati):
// - BUG-020 COMPLETO: Skip check availability anche nel flusso principale
//
// ─────────────────────────────────────────────────────────────────────────────
// FIX v3.9.23 (ereditati):
// - BUG-022: "sono Nome" non più interpretato come negazione (\b word boundary)
// - BUG-019: "altra prenotazione" riconosciuto come CREATE
// - BUG-020: Skip check P1 in ValidationPipeline se eventId esiste
// - BUG-021: reply_text sincronizzato con data corretta anche al primo messaggio
//
// ─────────────────────────────────────────────────────────────────────────────
// FIX v3.9.22 (ereditati):
// - BUG-017: "annullarla/cancellarla" riconosciuti come intent cancel
// - UX-G6: extractName pulisce prefissi comuni
//
// ─────────────────────────────────────────────────────────────────────────────
// FIX v3.9.21 (ereditati):
// 
// BUG-001 (P0): Verifica nome completamente riscritta
//   - nameMatches ora cerca il nome ATTESO nella risposta utente (non viceversa)
//   - Aggiunto supporto per conferme implicite ("sì esatto", "yes that's us")
//   - extractName migliorato per estrarre SOLO il nome
//
// BUG-002 (P0): Intent "Cancelleri" protetto
//   - Aggiunto pre-processing per rimuovere "a nome X" prima del detect
//   - Aggiunto word boundary ai pattern cancel per evitare match parziali
//
// BUG-009 (P0): NameManager pattern ampliati
// BUG-003/004 (P1): Soglia gruppi corretta nel prompt GPT
// BUG-008 (P1): Alternative per gruppi PENDING su slot pieno
// BUG-010 (P1): Recovery dopo verifica nome fallita (retry)
// ═══════════════════════════════════════════════════════════════════════════════

import express from "express";
import bodyParser from "body-parser";
import cors from "cors";

const app = express();

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 1: CONFIGURAZIONE
// ═══════════════════════════════════════════════════════════════════════════════

const CONFIG = {
  RECEPTIONIST_NAME: process.env.RECEPTIONIST_NAME || "Giulia",
  DEFAULT_RESTAURANT_NAME: process.env.RESTAURANT_NAME || "Ristorante",
  OWNER_EMAIL_DEFAULT: process.env.OWNER_EMAIL || "prenowai@gmail.com",
  
  REGISTRY_SHEET_ID: "1AdXq1EagVhPsX-UT4HENfuQ1mxUN39kWtECiY6he8bg",
  REGISTRY_SHEET_NAME: "Registry",
  REGISTRY_CACHE_TTL: 5 * 60 * 1000,
  
  APPS_SCRIPT_URL: process.env.APPS_SCRIPT_URL || 
    "https://script.google.com/macros/s/AKfycbx39h60wqJ0TwLy9PzZyZTqCPV_eGid4j0NOF1FsHJyi411mWyOtZZYC_Z68htZSonqlg/exec",
  
  BASE_URL: process.env.BASE_URL || "https://giulia-gateway.onrender.com",
  PORT: process.env.PORT || 10000,
  
  LARGE_GROUP_THRESHOLD: 10,
  EVENT_THRESHOLD: 45,
  WEEKLY_CLOSING_DAYS: [1], // Lunedì (fallback)
  
  // 🆕 v3.9.31: Orari default (fallback se non specificati nel Registry)
  DEFAULT_LUNCH_START: "12:00",
  DEFAULT_LUNCH_END: "15:00",
  DEFAULT_DINNER_START: "19:00",
  DEFAULT_DINNER_END: "22:30",
  
  GPT_MODEL: "gpt-4o-mini",
  GPT_MAX_TOKENS: 300,
  GPT_TEMPERATURE: 0.2,
};

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 2: STATO IN MEMORIA
// ═══════════════════════════════════════════════════════════════════════════════

const STATE = {
  conversations: new Map(),       // Conversazioni GPT
  languages: new Map(),           // Lingua per chiamata
  userTexts: new Map(),           // Cronologia testi utente
  contexts: new Map(),            // Contesto ristorante
  reservations: new Map(),        // Stato prenotazione in costruzione
  restaurantConfigs: new Map(),   // Config multi-tenant
  
  // v3: Flusso cancel/modify
  initialIntents: new Map(),      // Intent iniziale (create|cancel|modify)
  existingReservations: new Map(),// Prenotazione esistente trovata
  conversationPhases: new Map(),  // Fase conversazione (v3)
  pendingModifications: new Map(),// Modifica in attesa di conferma (v3.1)
  
  // FIX v3.9.21 BUG-010: Contatore retry verifica nome
  nameVerificationRetries: new Map(),
  
  // FIX v3.9.23 BUG-020: Traccia eventId creati per evitare falsi "al completo"
  createdEventIds: new Map(),
  
  // FIX v3.9.27 ZF9B: Flag per cliente che vuole NUOVA prenotazione (skip proattività)
  wantsNewReservations: new Map(),
  
  // FIX v3.9.27 ZG3C/ZG6C: Salva data corretta dopo redirect P1 (slot pieno)
  pendingCorrectDates: new Map(),
  
  // 🆕 FIX F9: Tutte le prenotazioni di un cliente (per multi-prenotazione)
  allReservations: new Map(),
  
  // 🆕 FIX F9: Flag per tracciare se abbiamo già chiesto quale prenotazione
  askedWhichReservation: new Map(),
  
  // Registry cache
  registryCache: null,
  registryCacheTime: 0,
};

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 3: UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

function escapeXml(unsafe = "") {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function normalizeText(str) {
  return (str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function sanitizeEmail(email) {
  if (!email || typeof email !== "string") return null;
  const cleaned = email.replace(/\s+/g, "");
  return cleaned || null;
}

function extractEmailFromText(text) {
  if (!text || typeof text !== "string") return null;
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0] : null;
}

// 🆕 FIX F9: Trova quale prenotazione ha scelto il cliente tra più opzioni
function findChosenReservation(userText, reservations, lang) {
  if (!userText || !reservations || reservations.length === 0) return null;
  
  const text = userText.toLowerCase();
  
  // Prova a matchare per numero (1, 2, prima, seconda, etc)
  const numberMatch = text.match(/\b(1|2|3|prima|prima prenotazione|seconda|seconda prenotazione|terza|uno|due|tre|first|second|third)\b/i);
  if (numberMatch) {
    const numStr = numberMatch[1].toLowerCase();
    let index = -1;
    if (numStr === '1' || numStr === 'prima' || numStr === 'uno' || numStr === 'first' || numStr === 'prima prenotazione') index = 0;
    else if (numStr === '2' || numStr === 'seconda' || numStr === 'due' || numStr === 'second' || numStr === 'seconda prenotazione') index = 1;
    else if (numStr === '3' || numStr === 'terza' || numStr === 'tre' || numStr === 'third') index = 2;
    
    if (index >= 0 && index < reservations.length) {
      return reservations[index];
    }
  }
  
  // Prova a matchare per giorno della settimana
  const daysIT = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
  const daysEN = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  
  for (const res of reservations) {
    const resDate = new Date(res.date);
    const dayOfWeek = resDate.getDay();
    const dayNameIT = daysIT[dayOfWeek];
    const dayNameEN = daysEN[dayOfWeek];
    
    if (text.includes(dayNameIT) || text.includes(dayNameEN)) {
      return res;
    }
  }
  
  // Prova a matchare per data specifica (es: "8 febbraio", "il 10")
  for (const res of reservations) {
    const resDate = new Date(res.date);
    const day = resDate.getDate();
    
    // Match "il 10", "8 febbraio", etc
    if (text.includes(String(day)) || text.includes(`il ${day}`)) {
      return res;
    }
  }
  
  // Prova a matchare per orario
  for (const res of reservations) {
    const timeShort = res.time.substring(0, 5); // "20:00"
    const timeNoColon = res.time.replace(':', ''); // "2000"
    
    if (text.includes(timeShort) || text.includes(timeNoColon.substring(0, 2))) {
      return res;
    }
  }
  
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 4: INTENT DETECTOR
// ═══════════════════════════════════════════════════════════════════════════════

const IntentDetector = {
  // FIX v3.9.22 BUG-017: Aggiunte forme con pronomi cliticizzati
  CANCEL_KEYWORDS: [
    'cancellare', 'cancella', 'cancello', 'cancellazione',
    'cancellarla', 'cancellarlo', 'cancellarli', 'cancellarle',  // v3.9.22
    'disdire', 'disdetta', 'disdico',
    'disdirla', 'disdirlo', 'disdirli', 'disdirle',              // v3.9.22
    'annullare', 'annulla', 'annullo', 'annullamento',
    'annullarla', 'annullarlo', 'annullarli', 'annullarle',      // v3.9.22
    'eliminare', 'elimina', 'elimino',
    'eliminarla', 'eliminarlo', 'eliminarli', 'eliminarle',      // v3.9.22
    'non vengo', 'non veniamo', 'non riesco', 'non riusciamo',
    'cancel', 'cancellation', 'delete', 'remove',
    'i need to cancel', 'i want to cancel', 'i have to cancel',
    'cancel my reservation', 'cancel my booking',
  ],
  
  MODIFY_KEYWORDS: [
    'modificare', 'modifica', 'modifico', 'modifiche',
    'spostare', 'sposta', 'sposto',
    'cambiare', 'cambia', 'cambio',
    'anticipare', 'posticipare',
    'aumentat', 'aggiunger',
    'change', 'modify', 'move', 'reschedule', 'update',
    'i need to change', 'i want to change', 'i have to change',
    'i need to modify', 'i want to modify',
    'change my reservation', 'change my booking',
  ],
  
  EXISTING_RESERVATION_KEYWORDS: [
    'ho prenotato', 'avevo prenotato', 'ho una prenotazione',
    'la mia prenotazione', 'la prenotazione',
    'i have a reservation', 'my reservation', 'i booked',
    'i have a booking', 'my booking',
  ],
  
  // FIX v3.9.23 BUG-019: Pattern che forzano CREATE anche se ci sono keyword MODIFY
  // Esempio: "vorrei aggiungere un'altra prenotazione" → CREATE (non MODIFY)
  CREATE_OVERRIDE_PATTERNS: [
    /\b(altra|nuova|seconda)\s+prenotazione/i,
    /\b(un'?\s*altra|una\s+nuova)\s+prenotazione/i,
    /\bprenotazione\s+(nuova|altra)/i,
    /\b(another|new|second)\s+(reservation|booking)/i,
    /\b(make|add|create)\s+(a\s+)?(new|another)\s+(reservation|booking)/i,
  ],
  
  // ═══════════════════════════════════════════════════════════════════════════
  // FIX v3.9.21 BUG-002: Pre-processing per proteggere cognomi
  // ═══════════════════════════════════════════════════════════════════════════
  _preprocessText(text) {
    if (!text) return '';
    let t = text.toLowerCase();
    t = t.replace(/\ba\s+nome\s+\w+/gi, ' ');
    t = t.replace(/\bnome\s+\w+/gi, ' ');
    t = t.replace(/\bname\s+\w+/gi, ' ');
    t = t.replace(/\bunder\s+(the\s+)?name\s+\w+/gi, ' ');
    t = t.replace(/\s+/g, ' ').trim();
    return t;
  },
  
  detectIntent(text) {
    if (!text) return 'create';
    
    const t = this._preprocessText(text);
    const tOriginal = text.toLowerCase();
    
    // FIX v3.9.23 BUG-019: Check CREATE_OVERRIDE_PATTERNS PRIMA di tutto
    // "altra prenotazione" deve essere CREATE anche se c'è "aggiungere"
    for (const pattern of this.CREATE_OVERRIDE_PATTERNS) {
      if (pattern.test(tOriginal)) {
        console.log(`🎯 FIX v3.9.23: Intent CREATE forzato da pattern override`);
        return 'create';
      }
    }
    
    // FIX v3.9.21: Word boundary per evitare match parziali
    for (const kw of this.CANCEL_KEYWORDS) {
      if (kw.includes(' ')) {
        if (t.includes(kw)) {
          console.log(`🎯 FIX v3.9.21: Intent cancel da frase "${kw}"`);
          return 'cancel';
        }
      } else {
        const regex = new RegExp(`\\b${kw}\\b`, 'i');
        if (regex.test(t)) {
          console.log(`🎯 FIX v3.9.21: Intent cancel da keyword "${kw}" (con boundary)`);
          return 'cancel';
        }
      }
    }
    
    for (const kw of this.MODIFY_KEYWORDS) {
      if (t.includes(kw)) return 'modify';
    }
    
    for (const kw of this.EXISTING_RESERVATION_KEYWORDS) {
      if (tOriginal.includes(kw)) return 'modify';
    }
    
    return 'create';
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 5: STATE MANAGER
// ═══════════════════════════════════════════════════════════════════════════════

const StateManager = {
  // Lingua
  getLanguage(callId) {
    return STATE.languages.get(callId) || "it-IT";
  },
  setLanguage(callId, lang) {
    if (callId) STATE.languages.set(callId, lang);
  },
  
  // Testi utente
  appendUserText(callId, text) {
    if (!callId || !text) return;
    const arr = STATE.userTexts.get(callId) || [];
    arr.push(text);
    STATE.userTexts.set(callId, arr);
  },
  getAllUserText(callId) {
    const arr = STATE.userTexts.get(callId);
    return arr ? arr.join(" ") : "";
  },
  
  // Prenotazione in costruzione
  getReservation(callId) {
    return STATE.reservations.get(callId) || {
      date: null, time: null, people: null, name: null, customerEmail: null, notes: null,  // 🆕 FIX v3.9.30
    };
  },
  setReservation(callId, reservation) {
    STATE.reservations.set(callId, reservation);
  },
  mergeReservation(callId, newData = {}) {
    const prev = this.getReservation(callId);
    const merged = {
      date: 'date' in newData ? newData.date : prev.date,
      time: 'time' in newData ? newData.time : prev.time,
      people: 'people' in newData ? newData.people : prev.people,
      name: 'name' in newData ? newData.name : prev.name,
      customerEmail: 'customerEmail' in newData ? newData.customerEmail : prev.customerEmail,
      // 🆕 FIX v3.9.30: Preserva note esistenti se GPT restituisce null/undefined/vuoto
      notes: (newData.notes && typeof newData.notes === 'string' && newData.notes.trim()) ? newData.notes : prev.notes,
    };
    this.setReservation(callId, merged);
    return merged;
  },
  
  // Contesto ristorante
  getContext(callId) {
    return STATE.contexts.get(callId) || null;
  },
  setContext(callId, context) {
    STATE.contexts.set(callId, context);
  },
  
  // Config ristorante (multi-tenant)
  getRestaurantConfig(callId) {
    return STATE.restaurantConfigs.get(callId) || null;
  },
  setRestaurantConfig(callId, config) {
    STATE.restaurantConfigs.set(callId, config);
  },
  
  // Conversazione GPT
  getConversation(callId) {
    return STATE.conversations.get(callId) || null;
  },
  setConversation(callId, convo) {
    STATE.conversations.set(callId, convo);
  },
  
  // Intent iniziale
  getInitialIntent(callId) {
    return STATE.initialIntents.get(callId) || null;
  },
  setInitialIntent(callId, intent) {
    if (!STATE.initialIntents.has(callId)) {
      STATE.initialIntents.set(callId, intent);
      console.log(`🎯 Intent iniziale: ${intent}`);
    }
  },
  // FIX v3.9.27 E4: Forza cambio intent (per quando cliente cambia idea)
  forceInitialIntent(callId, intent) {
    const oldIntent = STATE.initialIntents.get(callId);
    STATE.initialIntents.set(callId, intent);
    console.log(`🎯 FIX v3.9.27: Intent cambiato da "${oldIntent}" a "${intent}"`);
  },
  
  // Prenotazione esistente
  getExistingReservation(callId) {
    return STATE.existingReservations.get(callId) || null;
  },
  setExistingReservation(callId, reservation) {
    STATE.existingReservations.set(callId, reservation);
    console.log(`[INFO] Prenotazione esistente salvata:`, reservation);
  },
  // FIX v3.9.25 E4: Pulisce prenotazione esistente per nuova prenotazione
  clearExistingReservation(callId) {
    STATE.existingReservations.delete(callId);
    console.log(`[INFO] FIX v3.9.25: Prenotazione esistente rimossa per nuova prenotazione`);
  },
  
  // FIX v3.9.27 ZF9B: Flag per cliente che vuole NUOVA prenotazione
  getWantsNewReservation(callId) {
    return STATE.wantsNewReservations.get(callId) || false;
  },
  setWantsNewReservation(callId, value) {
    STATE.wantsNewReservations.set(callId, value);
    if (value) {
      console.log(`[INFO] FIX v3.9.27 ZF9B: Flag wantsNewReservation=true per ${callId}`);
    }
  },
  
  // FIX v3.9.27 ZG3C/ZG6C: Salva data corretta dopo redirect P1
  getPendingCorrectDate(callId) {
    return STATE.pendingCorrectDates.get(callId) || null;
  },
  setPendingCorrectDate(callId, date) {
    if (date) {
      STATE.pendingCorrectDates.set(callId, date);
      console.log(`[INFO] FIX v3.9.27 ZG6C: Data corretta salvata: ${date} per ${callId}`);
    }
  },
  clearPendingCorrectDate(callId) {
    STATE.pendingCorrectDates.delete(callId);
  },
  
  // 🆕 FIX F9: Tutte le prenotazioni di un cliente
  getAllReservations(callId) {
    return STATE.allReservations.get(callId) || [];
  },
  setAllReservations(callId, reservations) {
    if (reservations && Array.isArray(reservations)) {
      STATE.allReservations.set(callId, reservations);
      console.log(`📋 FIX F9: Salvate ${reservations.length} prenotazioni per ${callId}`);
    }
  },
  clearAllReservations(callId) {
    STATE.allReservations.delete(callId);
  },
  
  // 🆕 FIX F9: Flag per tracciare se abbiamo chiesto quale prenotazione
  getAskedWhichReservation(callId) {
    return STATE.askedWhichReservation.get(callId) || false;
  },
  setAskedWhichReservation(callId, value) {
    STATE.askedWhichReservation.set(callId, value);
  },
  
  // v3: Fase conversazione
  getPhase(callId) {
    return STATE.conversationPhases.get(callId) || 'initial';
  },
  setPhase(callId, phase) {
    STATE.conversationPhases.set(callId, phase);
    console.log(`📍 Fase conversazione: ${phase}`);
  },
  
  // FIX v3.9.21 BUG-010: Gestione retry verifica nome
  getNameVerificationRetries(callId) {
    return STATE.nameVerificationRetries.get(callId) || 0;
  },
  incrementNameVerificationRetries(callId) {
    const current = this.getNameVerificationRetries(callId);
    STATE.nameVerificationRetries.set(callId, current + 1);
    return current + 1;
  },
  
  // FIX v3.9.23 BUG-020: Traccia eventId per evitare check P1 su update
  getCreatedEventId(callId) {
    return STATE.createdEventIds.get(callId) || null;
  },
  setCreatedEventId(callId, eventId) {
    if (callId && eventId) {
      STATE.createdEventIds.set(callId, eventId);
      console.log(`[INFO] FIX v3.9.23: EventId salvato per callId ${callId}: ${eventId}`);
    }
  },
  
  // Cleanup
  clearCall(callId) {
    STATE.conversations.delete(callId);
    STATE.languages.delete(callId);
    STATE.userTexts.delete(callId);
    STATE.contexts.delete(callId);
    STATE.reservations.delete(callId);
    STATE.restaurantConfigs.delete(callId);
    STATE.initialIntents.delete(callId);
    STATE.existingReservations.delete(callId);
    STATE.conversationPhases.delete(callId);
    STATE.pendingModifications.delete(callId);
    STATE.nameVerificationRetries.delete(callId);
    STATE.createdEventIds.delete(callId);  // FIX v3.9.23
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// 🆕 SEZIONE 5B: CONFIG HELPER (v3.9.31 - Multi-tenant)
// ═══════════════════════════════════════════════════════════════════════════════

const ConfigHelper = {
  /**
   * Ottiene i giorni di chiusura per un ristorante
   * @param {string} callId - ID chiamata
   * @returns {number[]} Array di giorni (0=dom, 1=lun, ...)
   */
  getClosedDays(callId) {
    const config = StateManager.getRestaurantConfig(callId);
    if (config?.closed_days) {
      // Può essere "1" o "1,7" o "1, 7"
      const daysStr = String(config.closed_days).replace(/\s/g, '');
      const days = daysStr.split(',').map(d => parseInt(d.trim())).filter(d => !isNaN(d));
      if (days.length > 0) {
        return days;
      }
    }
    return CONFIG.WEEKLY_CLOSING_DAYS; // fallback
  },
  
  /**
   * Ottiene gli orari di apertura per un ristorante
   * @param {string} callId - ID chiamata
   * @returns {Object} { lunchStart, lunchEnd, dinnerStart, dinnerEnd } in minuti
   */
  getOpeningHours(callId) {
    const config = StateManager.getRestaurantConfig(callId);
    
    const parseTime = (timeStr, defaultVal) => {
      if (!timeStr) return defaultVal;
      const [h, m] = String(timeStr).split(':').map(Number);
      if (isNaN(h)) return defaultVal;
      return h * 60 + (m || 0);
    };
    
    return {
      lunchStart: parseTime(config?.lunch_start, 12 * 60),      // default 12:00
      lunchEnd: parseTime(config?.lunch_end, 15 * 60),          // default 15:00
      dinnerStart: parseTime(config?.dinner_start, 19 * 60),    // default 19:00
      dinnerEnd: parseTime(config?.dinner_end, 22 * 60 + 30),   // default 22:30
    };
  },
  
  /**
   * Ottiene gli orari come stringhe per display/messaggi
   * @param {string} callId - ID chiamata
   * @returns {Object} { lunchStart, lunchEnd, dinnerStart, dinnerEnd } come "HH:MM"
   */
  getOpeningHoursDisplay(callId) {
    const config = StateManager.getRestaurantConfig(callId);
    
    return {
      lunchStart: config?.lunch_start || CONFIG.DEFAULT_LUNCH_START,
      lunchEnd: config?.lunch_end || CONFIG.DEFAULT_LUNCH_END,
      dinnerStart: config?.dinner_start || CONFIG.DEFAULT_DINNER_START,
      dinnerEnd: config?.dinner_end || CONFIG.DEFAULT_DINNER_END,
    };
  },
  
  /**
   * Ottiene le soglie per gruppi/eventi
   * @param {string} callId - ID chiamata
   * @returns {Object} { largeGroup, event }
   */
  getThresholds(callId) {
    const config = StateManager.getRestaurantConfig(callId);
    return {
      largeGroup: Number(config?.large_group_threshold) || CONFIG.LARGE_GROUP_THRESHOLD,
      event: Number(config?.event_threshold) || CONFIG.EVENT_THRESHOLD,
    };
  },
  
  /**
   * Ottiene il nome del receptionist
   * @param {string} callId - ID chiamata
   * @returns {string} Nome receptionist
   */
  getReceptionistName(callId) {
    const config = StateManager.getRestaurantConfig(callId);
    return config?.receptionist_name || CONFIG.RECEPTIONIST_NAME;
  },
  
  /**
   * Costruisce il messaggio di orario non valido
   * @param {string} callId - ID chiamata
   * @param {string} lang - Lingua
   * @returns {string} Messaggio
   */
  buildInvalidTimeMessage(callId, lang = "it-IT") {
    const hours = this.getOpeningHoursDisplay(callId);
    return lang === "en-US"
      ? `I'm sorry, that time is outside our opening hours. We're open for lunch ${hours.lunchStart}-${hours.lunchEnd} and dinner ${hours.dinnerStart}-${hours.dinnerEnd}. What time works for you?`
      : `Mi dispiace, quell'orario è fuori dai nostri orari di apertura. Siamo aperti a pranzo ${hours.lunchStart}-${hours.lunchEnd} e a cena ${hours.dinnerStart}-${hours.dinnerEnd}. A che ora preferisci?`;
  },
  
  /**
   * Costruisce testo chiusure per il prompt GPT
   * @param {string} callId - ID chiamata
   * @param {string} lang - Lingua
   * @returns {string} Testo chiusure
   */
  buildClosuresText(callId, lang = "it-IT") {
    const closedDays = this.getClosedDays(callId);
    const daysIT = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
    const daysEN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    
    if (closedDays.length === 0) {
      return lang === "en-US" ? "Open every day" : "Aperto tutti i giorni";
    }
    
    const dayNames = closedDays.map(d => lang === "en-US" ? daysEN[d] : daysIT[d]);
    return lang === "en-US" 
      ? `Closed on ${dayNames.join(', ')}`
      : `Chiuso il ${dayNames.join(', ')}`;
  },
  
  /**
   * Costruisce testo orari per il prompt GPT
   * @param {string} callId - ID chiamata
   * @returns {string} Testo orari
   */
  buildOpeningHoursText(callId) {
    const hours = this.getOpeningHoursDisplay(callId);
    return `Pranzo ${hours.lunchStart}-${hours.lunchEnd}, Cena ${hours.dinnerStart}-${hours.dinnerEnd}. Ultima prenotazione alle ${hours.dinnerEnd}.`;
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 6: MULTI-TENANT REGISTRY
// ═══════════════════════════════════════════════════════════════════════════════

const Registry = {
  async fetch() {
    const now = Date.now();
    if (STATE.registryCache && (now - STATE.registryCacheTime) < CONFIG.REGISTRY_CACHE_TTL) {
      return STATE.registryCache;
    }
    
    try {
      const url = `https://docs.google.com/spreadsheets/d/${CONFIG.REGISTRY_SHEET_ID}/gviz/tq?tqx=out:json&sheet=${CONFIG.REGISTRY_SHEET_NAME}`;
      console.log("🌐 Registry: fetch...");
      
      const response = await fetch(url);
      const text = await response.text();
      
      const jsonMatch = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);?$/);
      if (!jsonMatch) {
        console.error("❌ Registry: formato non valido");
        return STATE.registryCache || [];
      }
      
      const data = JSON.parse(jsonMatch[1]);
      const rows = data.table.rows || [];
      const cols = data.table.cols || [];
      
      let headers = cols.map(c => c.label || "");
      if (headers.every(h => h === "")) {
        if (rows.length > 0 && rows[0].c) {
          headers = rows[0].c.map(cell => cell ? (cell.v !== null ? String(cell.v) : "") : "");
          rows.shift();
        }
      }
      
      const registry = rows.map(row => {
        const obj = {};
        row.c.forEach((cell, idx) => {
          const key = headers[idx];
          if (key) obj[key] = cell ? (cell.v !== null ? cell.v : "") : "";
        });
        return obj;
      });
      
      console.log(`✅ Registry: ${registry.length} ristoranti`);
      STATE.registryCache = registry;
      STATE.registryCacheTime = now;
      return registry;
    } catch (err) {
      console.error("❌ Registry error:", err);
      return STATE.registryCache || [];
    }
  },
  
  async getByTwilioNumber(twilioNumber) {
    if (!twilioNumber) return null;
    const registry = await this.fetch();
    const normalizedInput = twilioNumber.replace(/\s/g, "").trim();
    
    const match = registry.find(r => {
      if (!r.twilio_number) return false;
      return String(r.twilio_number).replace(/\s/g, "").trim() === normalizedInput;
    });
    
    if (match) console.log(`✅ Registry: "${match.restaurant_name}" per ${twilioNumber}`);
    return match || null;
  },
  
  async getConfigForCall(callId, twilioNumber = null) {
    const cached = StateManager.getRestaurantConfig(callId);
    if (cached) return cached;
    
    if (twilioNumber) {
      const config = await this.getByTwilioNumber(twilioNumber);
      if (config) {
        StateManager.setRestaurantConfig(callId, config);
        // 🆕 v3.9.31: Log config multi-tenant
        console.log(`🆕 v3.9.31: Config caricata per ${config.restaurant_name}:`, {
          closed_days: config.closed_days || '1',
          lunch: `${config.lunch_start || '12:00'}-${config.lunch_end || '15:00'}`,
          dinner: `${config.dinner_start || '19:00'}-${config.dinner_end || '22:30'}`,
          thresholds: `${config.large_group_threshold || 10}/${config.event_threshold || 45}`,
          receptionist: config.receptionist_name || 'Giulia'
        });
        return config;
      }
    }
    return null;
  },
  
  getAppsScriptUrl(callId) {
    const config = StateManager.getRestaurantConfig(callId);
    if (config?.apps_script_url?.trim()) return config.apps_script_url.trim();
    return CONFIG.APPS_SCRIPT_URL;
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 7: DATE MANAGER
// ═══════════════════════════════════════════════════════════════════════════════

const DateManager = {
  DAYS_IT: ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'],
  DAYS_EN: ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
  MONTHS_IT: ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 
              'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'],
  
  getNow() {
    const nowString = new Date().toLocaleString("en-US", { timeZone: "Europe/Rome" });
    return new Date(nowString);
  },
  
  startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  },
  
  addDays(date, days) {
    const d = new Date(date.getTime());
    d.setDate(d.getDate() + days);
    return d;
  },
  
  toISO(date) {
    if (!date || isNaN(date.getTime())) return null;
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  },
  
  getDayOfWeek(dateISO) {
    if (!dateISO) return null;
    const [y, m, d] = dateISO.split("-").map(Number);
    return new Date(y, m - 1, d).getDay();
  },
  
  getDayName(dateISO, lang = "it-IT") {
    const dow = this.getDayOfWeek(dateISO);
    if (dow === null) return null;
    return lang === "en-US" ? this.DAYS_EN[dow] : this.DAYS_IT[dow];
  },
  
  formatForDisplay(dateISO, lang = "it-IT") {
    if (!dateISO) return "";
    try {
      const [y, m, d] = dateISO.split("-").map(Number);
      const date = new Date(y, m - 1, d);
      return date.toLocaleDateString(lang, { weekday: 'long', day: 'numeric', month: 'long' });
    } catch (e) {
      return dateISO;
    }
  },
  
  getNextWeekday(fromDate, targetWeekday) {
    const result = new Date(fromDate.getTime());
    const diff = ((targetWeekday - result.getDay()) + 7) % 7;
    const daysToAdd = diff === 0 ? 7 : diff;
    if (diff === 0) {
      console.log(`📆 FIX v3.9.15: Oggi è già ${this.DAYS_IT[targetWeekday]}, uso PROSSIMA settimana (+7 giorni)`);
    }
    result.setDate(result.getDate() + daysToAdd);
    return result;
  },
  
  // 🆕 v3.9.31: buildCalendar ora accetta callId per usare closed_days dinamici
  buildCalendar(days = 14, callId = null) {
    const now = this.getNow();
    const today = this.startOfDay(now);
    const calendar = [];
    
    // 🆕 v3.9.31: Usa closed_days dal config del ristorante
    const closedDays = ConfigHelper.getClosedDays(callId);
    
    for (let i = 0; i <= days; i++) {
      const d = this.addDays(today, i);
      const iso = this.toISO(d);
      const dayOfWeek = d.getDay();
      const isClosed = closedDays.includes(dayOfWeek);
      
      calendar.push({
        offset: i,
        date: iso,
        dayOfWeek,
        dayName: this.DAYS_IT[dayOfWeek],
        isClosed,
        label: i === 0 ? "OGGI" : i === 1 ? "domani" : i === 2 ? "dopodomani" : null,
      });
    }
    return calendar;
  },
  
  parseFromText(text, callId = null) {
    if (!text) return null;
    const t = normalizeText(text);
    const now = this.getNow();
    const today = this.startOfDay(now);
    
    const explicitDate = this._parseExplicitDate(t, today);
    if (explicitDate) {
      console.log(`📆 FIX v3.9: Data esplicita trovata: ${explicitDate}`);
      return explicitDate;
    }
    
    const relativeDate = this._parseRelativeDate(t, today);
    if (relativeDate) {
      console.log(`📆 FIX v3.9: Data relativa trovata: ${relativeDate}`);
      return relativeDate;
    }
    
    // FIX v3.9.25 E7: Pattern "giorno settimana + numero" (es. "martedì 10")
    // Il numero indica il giorno del mese, non è da ignorare!
    const weekdayWithDay = this._parseWeekdayWithDayNumber(t, today);
    if (weekdayWithDay) {
      console.log(`📆 FIX v3.9.25: Giorno settimana + numero trovato: ${weekdayWithDay}`);
      return weekdayWithDay;
    }
    
    const weekdayDate = this._parseWeekdayDate(t, today);
    if (weekdayDate) {
      console.log(`📆 FIX v3.9: Giorno settimana trovato: ${weekdayDate}`);
      return weekdayDate;
    }
    
    return null;
  },
  
  // FIX v3.9.25 E7: Parsa "martedì 10" → 10 del mese corrente/prossimo
  _parseWeekdayWithDayNumber(text, today) {
    const weekdayPatterns = [
      { pattern: /\b(?:domenica|sunday)\s+(\d{1,2})\b/i, index: 0 },
      { pattern: /\b(?:lunedi|monday)\s+(\d{1,2})\b/i, index: 1 },
      { pattern: /\b(?:martedi|tuesday)\s+(\d{1,2})\b/i, index: 2 },
      { pattern: /\b(?:mercoledi|wednesday)\s+(\d{1,2})\b/i, index: 3 },
      { pattern: /\b(?:giovedi|thursday)\s+(\d{1,2})\b/i, index: 4 },
      { pattern: /\b(?:venerdi|friday)\s+(\d{1,2})\b/i, index: 5 },
      { pattern: /\b(?:sabato|saturday)\s+(\d{1,2})\b/i, index: 6 },
    ];
    
    for (const wp of weekdayPatterns) {
      const match = text.match(wp.pattern);
      if (match) {
        const dayNum = parseInt(match[1]);
        if (dayNum >= 1 && dayNum <= 31) {
          // Prova mese corrente
          let candidate = new Date(today.getFullYear(), today.getMonth(), dayNum);
          
          // Se è nel passato, prova mese prossimo
          if (candidate < today) {
            candidate = new Date(today.getFullYear(), today.getMonth() + 1, dayNum);
          }
          
          // Verifica che il giorno della settimana corrisponda
          if (candidate.getDay() === wp.index) {
            console.log(`📆 FIX v3.9.25: "${this.DAYS_IT[wp.index]} ${dayNum}" → ${this.toISO(candidate)}`);
            return this.toISO(candidate);
          } else {
            // Se non corrisponde, l'utente potrebbe essersi sbagliato sul giorno settimana
            // Usiamo comunque il numero come priorità (l'utente ha detto "10")
            console.log(`⚠️ FIX v3.9.25: "${this.DAYS_IT[wp.index]} ${dayNum}" ma ${dayNum} non è ${this.DAYS_IT[wp.index]}, uso comunque giorno ${dayNum}`);
            return this.toISO(candidate);
          }
        }
      }
    }
    return null;
  },
  
  _parseExplicitDate(text, today) {
    const monthsMap = {
      'gennaio': 0, 'febbraio': 1, 'marzo': 2, 'aprile': 3, 'maggio': 4, 'giugno': 5,
      'luglio': 6, 'agosto': 7, 'settembre': 8, 'ottobre': 9, 'novembre': 10, 'dicembre': 11,
      'january': 0, 'february': 1, 'march': 2, 'april': 3, 'may': 4, 'june': 5,
      'july': 6, 'august': 7, 'september': 8, 'october': 9, 'november': 10, 'december': 11,
    };
    
    const slashMatch = text.match(/\b(\d{1,2})\/(\d{1,2})\b/);
    if (slashMatch) {
      const day = parseInt(slashMatch[1]);
      const month = parseInt(slashMatch[2]) - 1;
      
      if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
        let year = today.getFullYear();
        let candidate = new Date(year, month, day);
        if (candidate < today) {
          year++;
          candidate = new Date(year, month, day);
        }
        console.log(`📆 FIX v3.9.9: Formato DD/MM parsato: ${day}/${month+1} → ${this.toISO(candidate)}`);
        return this.toISO(candidate);
      }
    }
    
    const allMonths = Object.keys(monthsMap).join("|");
    const regex = new RegExp(`(\\d{1,2})\\s*(?:di\\s+)?(${allMonths})`, "i");
    const match = text.match(regex);
    
    if (match) {
      const day = parseInt(match[1]);
      const monthName = match[2].toLowerCase();
      const month = monthsMap[monthName];
      
      if (month !== undefined && day >= 1 && day <= 31) {
        let year = today.getFullYear();
        let candidate = new Date(year, month, day);
        if (candidate < today) {
          year++;
          candidate = new Date(year, month, day);
        }
        return this.toISO(candidate);
      }
    }
    return null;
  },
  
  _parseRelativeDate(text, today) {
    if (/dopodomani|dopo domani|day after tomorrow/.test(text)) return this.toISO(this.addDays(today, 2));
    if (/\btomorrow\b/.test(text) || /\bdomani\b/.test(text)) return this.toISO(this.addDays(today, 1));
    if (/oggi|today|stasera|questa sera|tonight/.test(text)) return this.toISO(today);
    
    const traMatch = text.match(/(?:tra|fra|in)\s*(\d+)\s*giorni/);
    if (traMatch) return this.toISO(this.addDays(today, parseInt(traMatch[1])));
    
    return null;
  },
  
  _parseWeekdayDate(text, today) {
    const weekdays = [
      { patterns: ['domenica', 'sunday'], index: 0 },
      { patterns: ['lunedi', 'monday'], index: 1 },
      { patterns: ['martedi', 'tuesday'], index: 2 },
      { patterns: ['mercoledi', 'wednesday'], index: 3 },
      { patterns: ['giovedi', 'thursday'], index: 4 },
      { patterns: ['venerdi', 'friday'], index: 5 },
      { patterns: ['sabato', 'saturday'], index: 6 },
    ];
    
    let lastFoundIndex = -1;
    let lastFoundPosition = -1;
    
    for (const wd of weekdays) {
      for (const pattern of wd.patterns) {
        const pos = text.lastIndexOf(pattern);
        if (pos !== -1 && pos > lastFoundPosition) {
          lastFoundPosition = pos;
          lastFoundIndex = wd.index;
        }
      }
    }
    
    if (lastFoundIndex !== -1) {
      console.log(`📆 Ultimo giorno: ${this.DAYS_IT[lastFoundIndex]}`);
      
      const hasNextModifier = /\b(prossim[ao]|next)\b/i.test(text);
      
      let result = this.getNextWeekday(today, lastFoundIndex);
      
      if (hasNextModifier && result.getDay() === today.getDay() && 
          result.getDate() === today.getDate() && 
          result.getMonth() === today.getMonth()) {
        console.log(`📆 FIX v3.9.9: "prossimo" rilevato + oggi è già ${this.DAYS_IT[lastFoundIndex]} → +7 giorni`);
        result = this.addDays(result, 7);
      }
      
      return this.toISO(result);
    }
    return null;
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 8: TIME MANAGER
// ═══════════════════════════════════════════════════════════════════════════════

const TimeManager = {
  // 🆕 FIX v3.9.30 I4: Mappa numeri in lettere → cifre
  wordsToNumber(text) {
    const mapping = {
      'zero': 0, 'una': 1, 'uno': 1, 'due': 2, 'tre': 3, 'quattro': 4,
      'cinque': 5, 'sei': 6, 'sette': 7, 'otto': 8, 'nove': 9, 'dieci': 10,
      'undici': 11, 'dodici': 12, 'tredici': 13, 'quattordici': 14, 'quindici': 15,
      'sedici': 16, 'diciassette': 17, 'diciotto': 18, 'diciannove': 19,
      'venti': 20, 'ventuno': 21, 'ventidue': 22, 'ventitre': 23, 'ventitré': 23,
      'ventiquattro': 24,
      // English
      'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6,
      'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10, 'eleven': 11, 'twelve': 12,
      'thirteen': 13, 'fourteen': 14, 'fifteen': 15, 'sixteen': 16,
      'seventeen': 17, 'eighteen': 18, 'nineteen': 19, 'twenty': 20,
      'twenty-one': 21, 'twenty-two': 22, 'twenty-three': 23
    };
    
    const minuteMapping = {
      'mezza': 30, 'mezzo': 30, 'half': 30,
      'un quarto': 15, 'quarter': 15,
      'quarantacinque': 45, 'forty-five': 45, 'forty five': 45,
      'trenta': 30, 'thirty': 30,
      'quindici': 15, 'fifteen': 15,
      'quaranta': 40, 'forty': 40,
      'cinquanta': 50, 'fifty': 50,
      'dieci': 10, 'ten': 10,
      'venti': 20, 'twenty': 20,
      'cinque': 5, 'five': 5
    };
    
    return { mapping, minuteMapping };
  },
  
  // 🆕 FIX v3.9.30 J8: Supporto tempo relativo ("tra mezz'ora", "tra un'ora")
  parseRelativeTime(text) {
    if (!text) return null;
    const t = text.toLowerCase().trim();
    
    // Pattern per tempo relativo
    const relativePatterns = [
      // Italiano
      { pattern: /tra\s+mezz['']?\s*ora/i, minutes: 30 },
      { pattern: /tra\s+un['']?\s*ora/i, minutes: 60 },
      { pattern: /tra\s+(\d+)\s*minut/i, extract: true },
      { pattern: /tra\s+(\d+)\s*ore/i, extract: true, hours: true },
      { pattern: /fra\s+mezz['']?\s*ora/i, minutes: 30 },
      { pattern: /fra\s+un['']?\s*ora/i, minutes: 60 },
      { pattern: /fra\s+(\d+)\s*minut/i, extract: true },
      // English
      { pattern: /in\s+(half\s+an?\s+hour|30\s+min)/i, minutes: 30 },
      { pattern: /in\s+(an?\s+hour|one\s+hour|60\s+min)/i, minutes: 60 },
      { pattern: /in\s+(\d+)\s*min/i, extract: true },
      { pattern: /in\s+(\d+)\s*hour/i, extract: true, hours: true },
    ];
    
    for (const p of relativePatterns) {
      const match = t.match(p.pattern);
      if (match) {
        let minutesOffset;
        if (p.extract) {
          const num = parseInt(match[1]);
          minutesOffset = p.hours ? num * 60 : num;
        } else {
          minutesOffset = p.minutes;
        }
        
        // 🆕 FIX v3.9.30 J8: Usa timezone Europe/Rome invece di UTC
        const nowString = new Date().toLocaleString("en-US", { timeZone: "Europe/Rome" });
        const now = new Date(nowString);
        const targetTime = new Date(now.getTime() + minutesOffset * 60 * 1000);
        
        // Arrotonda ai 15 minuti più vicini (slot)
        const mins = targetTime.getMinutes();
        const roundedMins = Math.ceil(mins / 15) * 15;
        targetTime.setMinutes(roundedMins % 60);
        if (roundedMins >= 60) targetTime.setHours(targetTime.getHours() + 1);
        targetTime.setSeconds(0);
        
        const hour = targetTime.getHours();
        const minute = targetTime.getMinutes();
        const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
        
        console.log(`⏰ FIX v3.9.30 J8: Tempo relativo "${match[0]}" → now=${now.toISOString()} +${minutesOffset}min → ${timeStr}`);
        
        return {
          time: timeStr,
          isRelative: true,
          isToday: true, // Tempo relativo implica "oggi"
          originalMatch: match[0]
        };
      }
    }
    
    return null;
  },
  
  parseFromText(text) {
    if (!text) return null;
    const t = text.toLowerCase().trim();
    
    // 🆕 Prima controlla tempo relativo
    const relativeResult = this.parseRelativeTime(text);
    if (relativeResult) {
      return relativeResult.time;
    }
    
    if (/mezzogiorno|noon/.test(t)) return "12:00:00";
    if (/mezzanotte|midnight/.test(t)) return "00:00:00";
    
    const allTimes = [];
    let match;
    
    // 🆕 FIX v3.9.30 I4: Pattern per numeri in lettere (es. "alle venti e trenta")
    const { mapping, minuteMapping } = this.wordsToNumber();
    const hourWords = Object.keys(mapping).filter(k => mapping[k] >= 12 && mapping[k] <= 23).join('|');
    const allHourWords = Object.keys(mapping).join('|');
    
    // Pattern per "alle venti e trenta", "alle otto e mezza", "alle diciannove"
    const patternWords = new RegExp(`(?:alle|ore|per le|at)\\s+(${allHourWords})(?:\\s+e\\s+(mezza|mezzo|un quarto|trenta|quindici|quaranta|quarantacinque|venti|dieci|cinque))?`, 'gi');
    while ((match = patternWords.exec(t)) !== null) {
      const hourWord = match[1].toLowerCase();
      const minuteWord = match[2] ? match[2].toLowerCase() : null;
      
      let hour = mapping[hourWord];
      if (hour === undefined) continue;
      
      let minutes = 0;
      if (minuteWord && minuteMapping[minuteWord] !== undefined) {
        minutes = minuteMapping[minuteWord];
      }
      
      // Converti ore piccole in PM per contesto ristorante (sera)
      if (hour >= 1 && hour <= 11 && !t.includes("mattina") && !t.includes("pranzo") && !t.includes("morning") && !t.includes("lunch")) {
        hour += 12;
      }
      
      if (hour >= 0 && hour <= 23) {
        const timeStr = `${String(hour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
        console.log(`⏰ TimeManager patternWords: "${match[0]}" → ${timeStr}`);
        allTimes.push({ position: match.index, time: timeStr, pattern: 'patternWords', match: match[0] });
      }
    }
    
    const pattern1 = /(?:alle|ore|per le)\s*(\d{1,2})(?::(\d{2}))?/gi;
    while ((match = pattern1.exec(t)) !== null) {
      let hour = parseInt(match[1]);
      const minutes = match[2] ? parseInt(match[2]) : 0;
      if (hour >= 1 && hour <= 11 && !t.includes("mattina") && !t.includes("pranzo")) {
        hour += 12;
      }
      if (hour >= 0 && hour <= 23) {
        const timeStr = `${String(hour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
        allTimes.push({ position: match.index, time: timeStr, pattern: 'pattern1', match: match[0] });
      }
    }
    
    const pattern2 = /(?:^|[^l])\ble\s+(\d{1,2})(?::(\d{2}))?\b/gi;
    while ((match = pattern2.exec(t)) !== null) {
      let hour = parseInt(match[1]);
      const minutes = match[2] ? parseInt(match[2]) : 0;
      if (hour >= 1 && hour <= 11 && !t.includes("mattina") && !t.includes("pranzo")) {
        hour += 12;
      }
      if (hour >= 0 && hour <= 23) {
        const timeStr = `${String(hour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
        allTimes.push({ position: match.index, time: timeStr, pattern: 'pattern2', match: match[0] });
      }
    }
    
    const pattern3 = /\b(\d{1,2})(?::(\d{2}))?\s*(pm|am)\b/gi;
    while ((match = pattern3.exec(t)) !== null) {
      let hour = parseInt(match[1]);
      const minutes = match[2] ? parseInt(match[2]) : 0;
      const isPM = match[3].toLowerCase() === 'pm';
      if (isPM && hour < 12) hour += 12;
      if (!isPM && hour === 12) hour = 0;
      if (hour >= 0 && hour <= 23) {
        const timeStr = `${String(hour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
        allTimes.push({ position: match.index, time: timeStr, pattern: 'pattern3', match: match[0] });
      }
    }
    
    const pattern4 = /\bat\s+(\d{1,2})(?::(\d{2}))?\b/gi;
    while ((match = pattern4.exec(t)) !== null) {
      let hour = parseInt(match[1]);
      const minutes = match[2] ? parseInt(match[2]) : 0;
      if (hour >= 1 && hour <= 11 && !t.includes("morning") && !t.includes("lunch")) {
        hour += 12;
      }
      if (hour >= 0 && hour <= 23) {
        const timeStr = `${String(hour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
        allTimes.push({ position: match.index, time: timeStr, pattern: 'pattern4', match: match[0] });
      }
    }
    
    const eveningContext = /tonight|dinner|evening|sera|cena|stasera/i.test(t);
    const pattern5 = /\b(\d{1,2}):(\d{2})\b/g;
    while ((match = pattern5.exec(t)) !== null) {
      let hour = parseInt(match[1]);
      const minutes = parseInt(match[2]);
      
      if (eveningContext && hour >= 1 && hour <= 11) {
        console.log(`⏰ FIX v3.9.12: Contesto serale rilevato, ${hour}:${String(minutes).padStart(2,'0')} → ${hour+12}:${String(minutes).padStart(2,'0')}`);
        hour += 12;
      }
      else if (hour >= 1 && hour <= 11) {
        const amMinutes = hour * 60 + minutes;
        const pmMinutes = (hour + 12) * 60 + minutes;
        const isAmValid = (amMinutes >= 720 && amMinutes <= 900) || (amMinutes >= 1140 && amMinutes <= 1350);
        const isPmValid = (pmMinutes >= 720 && pmMinutes <= 900) || (pmMinutes >= 1140 && pmMinutes <= 1350);
        
        if (!isAmValid && isPmValid) {
          console.log(`⏰ FIX v3.9.13: ${hour}:${String(minutes).padStart(2,'0')} fuori orario, ${hour+12}:${String(minutes).padStart(2,'0')} valido → uso PM`);
          hour += 12;
        }
      }
      
      if (hour >= 0 && hour <= 23 && minutes >= 0 && minutes <= 59) {
        const timeStr = `${String(hour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
        const isDuplicate = allTimes.some(t => 
          Math.abs(t.position - match.index) < 5 && t.time === timeStr
        );
        if (!isDuplicate) {
          allTimes.push({ position: match.index, time: timeStr, pattern: 'pattern5', match: match[0] });
        }
      }
    }
    
    if (allTimes.length === 0) return null;
    
    allTimes.sort((a, b) => a.position - b.position);
    const lastTime = allTimes[allTimes.length - 1];
    
    if (allTimes.length > 1) {
      console.log(`⏰ TimeManager: trovati ${allTimes.length} orari: ${allTimes.map(t => `"${t.match}"→${t.time}`).join(', ')}`);
      console.log(`⏰ TimeManager: scelto ULTIMO → "${lastTime.match}" = ${lastTime.time}`);
    } else {
      console.log(`⏰ TimeManager ${lastTime.pattern}: "${lastTime.match}" → ${lastTime.time}`);
    }
    
    return lastTime.time;
  },
  
  inferDefault(text) {
    if (!text) return null;
    const t = normalizeText(text);
    if (/pranzo|lunch/.test(t)) return "13:00:00";
    if (/sera|serale|cena|dinner/.test(t)) return "20:00:00";
    return null;
  },
  
  formatForDisplay(timeStr) {
    if (!timeStr) return "";
    return timeStr.substring(0, 5);
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 9: PEOPLE MANAGER
// ═══════════════════════════════════════════════════════════════════════════════

const PeopleManager = {
  parseFromText(text) {
    if (!text) return null;
    const t = text.toLowerCase().trim();
    
    const correctionPatterns = /anzi|no aspetta|aspetta|facciamo|meglio|diciamo|actually|no wait|wait|let's say|make it|changed to|now it's/i;
    if (correctionPatterns.test(t)) {
      const allNumbers = t.match(/\b(\d+)\b/g);
      if (allNumbers && allNumbers.length >= 2) {
        const lastNum = parseInt(allNumbers[allNumbers.length - 1]);
        if (lastNum > 0 && lastNum < 100) {
          console.log(`👥 FIX v3.9.12: Correzione rilevata! Numeri trovati: [${allNumbers.join(', ')}] → uso ULTIMO: ${lastNum}`);
          return lastNum;
        }
      }
    }
    
    const patterns = [
      /(\d+)\s*in\s*totale/i,
      /(\d+)\s*invece\s*di\s*\d+/i,
      /diventat[io]\s*(\d+)/i,
      /adesso\s*(?:siamo\s*)?(?:in\s*)?(\d+)/i,
      /siamo\s*(?:in\s*)?(\d+)/i,
      /(?:per|siamo|saremo|in)\s*(\d+)\s*(?:person[ae]|pax)?/i,
      /(\d+)\s*(?:person[ae]|pax|coperti|guests|people)/i,
      /(?:tavolo|table)\s*(?:per|for)\s*(\d+)/i,
    ];
    
    for (const pattern of patterns) {
      const match = t.match(pattern);
      if (match) {
        const num = parseInt(match[1]);
        if (num > 0 && num < 100) {
          console.log(`👥 PeopleManager: estratto ${num} da "${t.substring(0,30)}"`);
          return num;
        }
      }
    }
    
    const wordNumbers = {
      'due': 2, 'tre': 3, 'quattro': 4, 'cinque': 5, 'sei': 6,
      'sette': 7, 'otto': 8, 'nove': 9, 'dieci': 10,
    };
    
    for (const [word, num] of Object.entries(wordNumbers)) {
      if (t.includes(word)) return num;
    }
    
    return null;
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 9B: NAME MANAGER (FIX v3.9.21)
// ═══════════════════════════════════════════════════════════════════════════════

const NameManager = {
  parseFromText(text) {
    if (!text) return null;
    const t = text.trim();
    
    const excludeWords = [
      'not', 'the', 'a', 'an', 'is', 'are', 'it', 'my', 'your', 'no', 'yes', 'ok', 'and', 'or',
      'mio', 'mia', 'suo', 'sua', 'nostro', 'nostra', 'vostro', 'vostra', 'il', 'la', 'lo', 'un', 'una',
      'per', 'alle', 'ore', 'persone', 'pax', 'people', 'persons'
    ];
    
    const patterns = [
      /\bname\s+is\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\b/i,
      /\bunder\s+(?:the\s+)?name\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\b/i,
      /\ba\s+nome\s+(?:di\s+)?([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)\b/i,
      // FIX v3.9.21 BUG-009: Pattern aggiuntivi
      /,\s*nome\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)\s*$/i,
      /\b(?:in|per)\s+\d+\s*,\s*([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)\s*$/i,
      /\d+\s*(?:person[ae]|pax|people)\s*,\s*([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)\s*$/i,
      /(?:^|[.!?]\s*)\s*nome\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\b/i,
    ];
    
    for (const pattern of patterns) {
      const match = t.match(pattern);
      if (match && match[1]) {
        const name = match[1].trim();
        const nameWords = name.toLowerCase().split(/\s+/);
        const isExcluded = nameWords.every(w => excludeWords.includes(w));
        
        if (name.length >= 2 && !isExcluded) {
          console.log(`👤 FIX v3.9.21 NameManager: estratto "${name}" da "${t.substring(0,50)}..."`);
          return name;
        }
      }
    }
    
    return null;
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 10: CLOSURE CHECKER
// 🆕 v3.9.31: Usa closed_days dinamici dal config del ristorante
// ═══════════════════════════════════════════════════════════════════════════════

const ClosureChecker = {
  async isOpen(dateISO, callId = null) {
    if (!dateISO) return { open: true, reason: null };
    
    console.log(`🔍 ClosureChecker: ${dateISO}...`);
    
    const dayOfWeek = DateManager.getDayOfWeek(dateISO);
    
    // 🆕 v3.9.31: Usa closed_days dal config del ristorante
    const closedDays = ConfigHelper.getClosedDays(callId);
    
    if (closedDays.includes(dayOfWeek)) {
      const dayName = DateManager.getDayName(dateISO, "it-IT");
      const dayNameEN = DateManager.getDayName(dateISO, "en-US");
      console.log(`⛔ CHIUSO: ${dayName} (closedDays: ${closedDays.join(',')})`);
      return {
        open: false,
        reason: "chiusura_settimanale",
        dayName,
        dayNameEN,
        message_it: `Il ristorante è chiuso il ${dayName}.`,
        message_en: `The restaurant is closed on ${dayNameEN}s.`,
      };
    }
    
    try {
      const appsScriptUrl = Registry.getAppsScriptUrl(callId);
      const response = await fetch(appsScriptUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "check_closure", data: dateISO }),
      });
      
      const text = await response.text();
      let data;
      try { data = JSON.parse(text); } catch (e) { return { open: true, reason: null }; }
      
      if (data.isClosed === true) {
        console.log(`⛔ CHIUSO: ${data.reason}`);
        return {
          open: false,
          reason: "chiusura_straordinaria",
          message_it: data.reason || "Chiusura straordinaria",
          message_en: "Exceptional closing day",
        };
      }
      
      console.log(`✅ APERTO: ${dateISO}`);
      return { open: true, reason: null };
    } catch (err) {
      console.error("❌ ClosureChecker error:", err);
      return { open: true, reason: null };
    }
  },
  
  buildClosedMessage(dateISO, closureResult, lang = "it-IT") {
    const dateDisplay = DateManager.formatForDisplay(dateISO, lang);
    
    if (closureResult.reason === "chiusura_settimanale") {
      const dayToShow = lang === "en-US" ? closureResult.dayNameEN : closureResult.dayName;
      return lang === "en-US"
        ? `I'm sorry, the restaurant is closed on ${dayToShow}s. Would you like another day?`
        : `Mi dispiace, il ristorante è chiuso il ${dayToShow}. Vuoi prenotare per un altro giorno?`;
    }
    
    return lang === "en-US"
      ? `I'm sorry, we're closed on ${dateDisplay}. Would you like another day?`
      : `Mi dispiace, siamo chiusi ${dateDisplay}. Vuoi prenotare per un altro giorno?`;
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 11: CALENDAR SERVICE
// ═══════════════════════════════════════════════════════════════════════════════

const CalendarService = {
  async createReservation(data, callId = null) {
    const appsScriptUrl = Registry.getAppsScriptUrl(callId);
    console.log("📅 Calendar: creazione", data);
    
    // 🆕 FIX ZF9B: Se forceNew=true, Apps Script crea NUOVA prenotazione
    const forceNew = data.forceNew === true;
    if (forceNew) {
      console.log("🆕 FIX ZF9B: forceNew=true, forzo creazione nuova prenotazione");
    }
    
    // 🆕 FIX v3.9.30 J1-J10: Includi note cliente
    if (data.notes) {
      console.log(`📝 FIX v3.9.30: Invio note cliente: "${data.notes}"`);
    }
    
    const response = await fetch(appsScriptUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: data.source || "gateway",
        nome: data.name,
        persone: data.people,
        data: data.date,
        ora: data.time,
        telefono: data.phone || "",
        email: data.customerEmail || "",
        forceNew: forceNew,  // 🆕 FIX ZF9B
        notes: data.notes || "",  // 🆕 FIX v3.9.30 J1-J10
      }),
    });
    
    const text = await response.text();
    let result;
    try { result = JSON.parse(text); } catch (e) { result = { rawResponse: text }; }
    console.log("📅 Calendar: risposta", result);
    return result;
  },
  
  async cancelReservation(data, callId = null) {
    const appsScriptUrl = Registry.getAppsScriptUrl(callId);
    console.log("🗑️ Calendar: cancellazione", data);
    
    const response = await fetch(appsScriptUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "cancel_reservation",
        source: data.source || "gateway",
        nome: data.name || "",
        data: data.date,
        ora: data.time || null,
        telefono: data.phone || "",
      }),
    });
    
    const text = await response.text();
    let result;
    try { result = JSON.parse(text); } catch (e) { result = { rawResponse: text }; }
    console.log("🗑️ Calendar: risposta", result);
    return result;
  },
  
  async findExistingReservation(phone, date, callId = null) {
    if (!phone) return null;
    
    const appsScriptUrl = Registry.getAppsScriptUrl(callId);
    console.log(`🔍 Ricerca prenotazione: ${phone}`);
    
    try {
      const response = await fetch(appsScriptUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "find_reservation",
          telefono: phone,
          data: date || null,
        }),
      });
      
      const text = await response.text();
      let result;
      try { result = JSON.parse(text); } catch (e) { return null; }
      
      if (result.found && result.reservation) {
        console.log(`✅ Prenotazione trovata:`, result.reservation);
        return result.reservation;
      }
      console.log(`[INFO] Nessuna prenotazione per ${phone}`);
      return null;
    } catch (err) {
      console.error("❌ Errore ricerca:", err);
      return null;
    }
  },
  
  // 🆕 FIX F9: Trova TUTTE le prenotazioni per un telefono
  async findAllReservations(phone, callId = null) {
    if (!phone) return { found: false, count: 0, reservations: [] };
    
    const appsScriptUrl = Registry.getAppsScriptUrl(callId);
    console.log(`🔍 FIX F9: Ricerca TUTTE le prenotazioni per ${phone}`);
    
    try {
      const response = await fetch(appsScriptUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "find_all_reservations",
          telefono: phone,
        }),
      });
      
      const text = await response.text();
      let result;
      try { result = JSON.parse(text); } catch (e) { return { found: false, count: 0, reservations: [] }; }
      
      if (result.found && result.reservations) {
        console.log(`✅ FIX F9: Trovate ${result.count} prenotazioni:`, result.reservations);
        return {
          found: true,
          count: result.count,
          reservation: result.reservation,  // Prima prenotazione (retrocompatibile)
          reservations: result.reservations  // Tutte le prenotazioni
        };
      }
      console.log(`[INFO] FIX F9: Nessuna prenotazione per ${phone}`);
      return { found: false, count: 0, reservations: [] };
    } catch (err) {
      console.error("❌ FIX F9: Errore ricerca:", err);
      return { found: false, count: 0, reservations: [] };
    }
  },
  
  // 🆕 FIX v3.9.29 E3/E9: Aggiunto parametro existingPeople per escludere pax esistenti dal check
  async checkAvailability(date, time, people, callId = null, existingPeople = 0) {
    if (!date || !time || !people) return { available: true };
    
    const appsScriptUrl = Registry.getAppsScriptUrl(callId);
    
    // FIX v3.9.29: Log dettagliato per debug
    if (existingPeople > 0) {
      console.log(`🔍 Check slot ${date} ${time} per ${people} pax (esistenti: ${existingPeople}, verifica +${people - existingPeople} aggiuntivi)`);
    } else {
      console.log(`🔍 Check slot ${date} ${time} per ${people} pax`);
    }
    
    try {
      const response = await fetch(appsScriptUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "check_availability",
          data: date,
          ora: time,
          persone: people,
          existingPeople: existingPeople, // 🆕 FIX v3.9.29: Apps Script escluderà questi dal conteggio
        }),
      });
      
      const text = await response.text();
      let data;
      try { data = JSON.parse(text); } catch (e) { return { available: true }; }
      
      if (data.reason === "day_closed") {
        return { available: false, reason: "day_closed", closureReason: data.closureReason };
      }
      if (data.reason === "slot_full") {
        return { available: false, reason: "slot_full" };
      }
      return { available: true };
    } catch (err) {
      return { available: true };
    }
  },
  
  async findAlternatives(date, time, people, callId = null) {
    const appsScriptUrl = Registry.getAppsScriptUrl(callId);
    
    try {
      const response = await fetch(appsScriptUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "find_available_slots",
          data: date,
          ora: time || "20:00:00",
          persone: people,
        }),
      });
      
      const text = await response.text();
      let data;
      try { data = JSON.parse(text); } catch (e) { return { success: false, sameDay: [], nextDays: [] }; }
      
      if (data.success && data.availableSlots) {
        return {
          success: true,
          sameDay: data.availableSlots.sameDay || [],
          nextDays: data.availableSlots.nextDays || [],
        };
      }
      return { success: false, sameDay: [], nextDays: [] };
    } catch (err) {
      return { success: false, sameDay: [], nextDays: [] };
    }
  },
  
  // FIX v3.9.21 BUG-008: Nota PENDING per gruppi grandi
  buildAlternativesMessage(alternatives, lang = "it-IT", isLargeGroup = false) {
    const { sameDay, nextDays } = alternatives;
    
    const pendingNote = isLargeGroup
      ? (lang === "en-US" 
          ? " The booking will be subject to restaurant confirmation."
          : " La prenotazione sarà soggetta a conferma del ristorante.")
      : "";
    
    if (sameDay?.length > 0) {
      const times = sameDay.map(s => s.time).slice(0, 3);
      if (lang === "en-US") {
        return times.length === 1
          ? `I'm sorry, we're full. I have ${times[0]}. Would that work?${pendingNote}`
          : `I'm sorry, we're full. I have ${times.slice(0,-1).join(", ")} or ${times.slice(-1)}. Which do you prefer?${pendingNote}`;
      }
      return times.length === 1
        ? `Mi dispiace, siamo al completo. Ho le ${times[0]}. Può andare?${pendingNote}`
        : `Mi dispiace, siamo al completo. Ho le ${times.slice(0,-1).join(", ")} o le ${times.slice(-1)}. Quale preferisci?${pendingNote}`;
    }
    
    if (nextDays?.length > 0) {
      const firstDay = nextDays[0];
      const times = firstDay.slots?.map(s => s.time).slice(0, 2) || [];
      return lang === "en-US"
        ? `I'm sorry, we're full today. Next availability is ${firstDay.dayName} at ${times.join(" or ")}. Would you like to book?${pendingNote}`
        : `Mi dispiace, oggi siamo al completo. Prima disponibilità ${firstDay.dayName} alle ${times.join(" o ")}. Vuoi prenotare?${pendingNote}`;
    }
    
    return lang === "en-US"
      ? `I'm sorry, we're fully booked. Would you like a different day?${pendingNote}`
      : `Mi dispiace, siamo al completo. Vuoi provare un altro giorno?${pendingNote}`;
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 12: CONTEXT SERVICE
// ═══════════════════════════════════════════════════════════════════════════════

const ContextService = {
  async fetch(callId = null) {
    try {
      const appsScriptUrl = Registry.getAppsScriptUrl(callId);
      const url = `${appsScriptUrl}?action=get_context`;
      console.log("🌐 Context: fetch...");
      
      const response = await fetch(url);
      const text = await response.text();
      
      let data;
      try { data = JSON.parse(text); } catch (e) { return this.getDefault(); }
      
      if (!response.ok || !data || data.success === false) return this.getDefault();
      
      console.log("✅ Context: caricato");
      return data;
    } catch (err) {
      console.error("❌ Context error:", err);
      return this.getDefault();
    }
  },
  
  getDefault() {
    return {
      success: false,
      restaurant: {
        name: CONFIG.DEFAULT_RESTAURANT_NAME,
        email: CONFIG.OWNER_EMAIL_DEFAULT,
        address: "", phone: "", timezone: "Europe/Rome",
        openingHoursText: "", closingRulesText: "",
      },
      menu: { summaryText: "", vegetarianText: "", glutenFreeText: "", priceRangeText: "" },
      rules: { largeGroupThreshold: CONFIG.LARGE_GROUP_THRESHOLD, eventThreshold: CONFIG.EVENT_THRESHOLD },
    };
  },
  
  async ensureForCall(callId) {
    let ctx = StateManager.getContext(callId);
    if (!ctx) {
      ctx = await this.fetch(callId);
      StateManager.setContext(callId, ctx);
    }
    return ctx;
  },
  
  getRestaurantName(callId) {
    const config = StateManager.getRestaurantConfig(callId);
    if (config?.restaurant_name) return config.restaurant_name;
    const ctx = StateManager.getContext(callId);
    return ctx?.restaurant?.name || CONFIG.DEFAULT_RESTAURANT_NAME;
  },
  
  getRestaurantEmail(callId) {
    const ctx = StateManager.getContext(callId);
    return ctx?.restaurant?.email || CONFIG.OWNER_EMAIL_DEFAULT;
  },
  
  // 🆕 v3.9.31: Ora usa ConfigHelper per thresholds
  getThresholds(callId) {
    return ConfigHelper.getThresholds(callId);
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 13: RECAP MANAGER (v3.9.21 - FIX BUG-001, BUG-010)
// ═══════════════════════════════════════════════════════════════════════════════

const RecapManager = {
  buildModifyRecapMessage(existingRes, userText, lang = "it-IT") {
    const firstName = existingRes.name?.split(' ')[0] || existingRes.name;
    const dateDisplay = DateManager.formatForDisplay(existingRes.date, lang);
    const timeDisplay = TimeManager.formatForDisplay(existingRes.time);
    
    const modification = this.extractModification(userText, existingRes);
    const modCount = (modification.newTime ? 1 : 0) + (modification.newDate ? 1 : 0) + (modification.newPeople ? 1 : 0);
    
    if (modCount >= 2) {
      let changes = [];
      if (modification.newTime) changes.push(lang === "en-US" ? `time to ${TimeManager.formatForDisplay(modification.newTime)}` : `orario alle ${TimeManager.formatForDisplay(modification.newTime)}`);
      if (modification.newDate) changes.push(lang === "en-US" ? `date to ${DateManager.formatForDisplay(modification.newDate, lang)}` : `data a ${DateManager.formatForDisplay(modification.newDate, lang)}`);
      if (modification.newPeople) changes.push(lang === "en-US" ? `${modification.newPeople} people` : `${modification.newPeople} persone`);
      
      return lang === "en-US"
        ? `Hi ${firstName}, I have your reservation for ${existingRes.people} people on ${dateDisplay} at ${timeDisplay}. You want to change: ${changes.join(" and ")}. Correct?`
        : `Ciao ${firstName}, ho la tua prenotazione per ${existingRes.people} persone ${dateDisplay} alle ${timeDisplay}. Vuoi cambiare: ${changes.join(" e ")}. Giusto?`;
    }
    
    if (modification.newTime) {
      const newTimeDisplay = TimeManager.formatForDisplay(modification.newTime);
      return lang === "en-US"
        ? `Hi ${firstName}, I have your reservation for ${existingRes.people} people on ${dateDisplay} at ${timeDisplay}. You want to move it to ${newTimeDisplay}, correct?`
        : `Ciao ${firstName}, ho la tua prenotazione per ${existingRes.people} persone ${dateDisplay} alle ${timeDisplay}. Vuoi spostare alle ${newTimeDisplay}, giusto?`;
    }
    
    if (modification.newDate) {
      const newDateDisplay = DateManager.formatForDisplay(modification.newDate, lang);
      return lang === "en-US"
        ? `Hi ${firstName}, I have your reservation for ${existingRes.people} people on ${dateDisplay} at ${timeDisplay}. You want to move it to ${newDateDisplay}, correct?`
        : `Ciao ${firstName}, ho la tua prenotazione per ${existingRes.people} persone ${dateDisplay} alle ${timeDisplay}. Vuoi spostare a ${newDateDisplay}, giusto?`;
    }
    
    if (modification.newPeople) {
      return lang === "en-US"
        ? `Hi ${firstName}, I have your reservation for ${existingRes.people} people on ${dateDisplay} at ${timeDisplay}. You want to change to ${modification.newPeople} people, correct?`
        : `Ciao ${firstName}, ho la tua prenotazione per ${existingRes.people} persone ${dateDisplay} alle ${timeDisplay}. Vuoi cambiare a ${modification.newPeople} persone, giusto?`;
    }
    
    return lang === "en-US"
      ? `Hi ${firstName}, I have your reservation for ${existingRes.people} people on ${dateDisplay} at ${timeDisplay}. What would you like to change?`
      : `Ciao ${firstName}, ho la tua prenotazione per ${existingRes.people} persone ${dateDisplay} alle ${timeDisplay}. Cosa vorresti modificare?`;
  },
  
  buildCancelRecapMessage(existingRes, lang = "it-IT") {
    const firstName = existingRes.name?.split(' ')[0] || existingRes.name;
    const dateDisplay = DateManager.formatForDisplay(existingRes.date, lang);
    const timeDisplay = TimeManager.formatForDisplay(existingRes.time);
    
    return lang === "en-US"
      ? `Hi ${firstName}, I have your reservation for ${existingRes.people} people on ${dateDisplay} at ${timeDisplay}. Do you confirm you want to cancel it?`
      : `Ciao ${firstName}, ho la tua prenotazione per ${existingRes.people} persone ${dateDisplay} alle ${timeDisplay}. Confermi di volerla cancellare?`;
  },
  
  extractModification(text, existingRes) {
    const result = { newTime: null, newDate: null, newPeople: null };
    if (!text) return result;
    
    const time = TimeManager.parseFromText(text);
    if (time) {
      const existingTimeNorm = existingRes.time?.includes(':') 
        ? (existingRes.time.length === 5 ? existingRes.time + ':00' : existingRes.time)
        : existingRes.time + ':00:00';
      if (time !== existingTimeNorm && time !== existingRes.time) {
        result.newTime = time;
      }
    }
    
    let date = DateManager.parseFromText(text);
    if (date && date !== existingRes.date) {
      // FIX v3.9.25 E10: Se la data calcolata è PRIMA della prenotazione originale,
      // non ha senso "spostare" indietro - aggiungi 7 giorni
      if (existingRes.date && date < existingRes.date) {
        const originalDate = new Date(existingRes.date);
        const parsedDate = new Date(date);
        const daysDiff = Math.round((originalDate - parsedDate) / (1000 * 60 * 60 * 24));
        
        // Se è entro 7 giorni prima, probabilmente intende la settimana dopo
        if (daysDiff <= 7 && daysDiff > 0) {
          const correctedDate = new Date(parsedDate);
          correctedDate.setDate(correctedDate.getDate() + 7);
          const correctedISO = DateManager.toISO(correctedDate);
          console.log(`⚠️ FIX v3.9.25 E10: Data ${date} è PRIMA di prenotazione ${existingRes.date}, correggo a ${correctedISO}`);
          date = correctedISO;
        }
      }
      result.newDate = date;
    }
    
    const people = PeopleManager.parseFromText(text);
    if (people && people !== existingRes.people) {
      result.newPeople = people;
    }
    
    console.log(`🔍 extractModification: "${text.substring(0,50)}" → time=${result.newTime}, date=${result.newDate}, people=${result.newPeople}`);
    return result;
  },
  
  buildCancellationDoneMessage(existingRes, lang = "it-IT") {
    return lang === "en-US"
      ? `Done! The reservation has been cancelled. We hope to see you again soon. Goodbye!`
      : `Fatto! La prenotazione è stata cancellata. Speriamo di rivederti presto. Buona giornata!`;
  },
  
  buildModificationDoneMessage(reservation, lang = "it-IT") {
    const dateDisplay = DateManager.formatForDisplay(reservation.date, lang);
    const timeDisplay = TimeManager.formatForDisplay(reservation.time);
    const firstName = reservation.name?.split(' ')[0] || reservation.name;
    
    return lang === "en-US"
      ? `Perfect ${firstName}! Your reservation is updated: ${reservation.people} people on ${dateDisplay} at ${timeDisplay}. See you soon!`
      : `Perfetto ${firstName}! Prenotazione aggiornata: ${reservation.people} persone ${dateDisplay} alle ${timeDisplay}. Ti aspettiamo!`;
  },
  
  buildNotFoundMessage(lang = "it-IT") {
    return lang === "en-US"
      ? `I couldn't find a reservation with your phone number. Would you like to make a new one?`
      : `Non ho trovato prenotazioni associate a questo numero. Vuoi fare una nuova prenotazione?`;
  },
  
  buildAskNameMessage(lang = "it-IT") {
    return lang === "en-US"
      ? `Of course! What name is the reservation under?`
      : `Certo! A che nome è la prenotazione?`;
  },
  
  // FIX v3.9.21 BUG-010: Retry
  buildNameMismatchMessage(saidName, lang = "it-IT", isRetry = false) {
    if (isRetry) {
      return lang === "en-US"
        ? `I'm sorry, I still can't find a match. Please call from the phone number used to book, or contact the restaurant directly.`
        : `Mi dispiace, ancora non trovo corrispondenza. Prova a chiamare dal numero usato per prenotare, o contatta direttamente il ristorante.`;
    }
    return lang === "en-US"
      ? `I don't find a reservation under "${saidName}" with this number. Could you repeat the name on the reservation?`
      : `Non trovo prenotazioni a nome "${saidName}" con questo numero. Puoi ripetere il nome della prenotazione?`;
  },
  
  // FIX v3.9.21 BUG-001: Estrae SOLO il cognome/nome
  // FIX v3.9.22 UX-G6: Rimuove prefissi comuni ("sempre", "ancora", etc.)
  extractName(text) {
    if (!text) return null;
    const t = text.trim();
    
    const explicitPatterns = [
      /\bsono\s+([A-Z][a-zA-Z]+)/i,
      /\bè\s+([A-Z][a-zA-Z]+)/i,
      /\bname\s+is\s+([A-Z][a-zA-Z]+)/i,
      /\bi'?m\s+([A-Z][a-zA-Z]+)/i,
      /\bthis\s+is\s+([A-Z][a-zA-Z]+)/i,
      /\ba\s+nome\s+([A-Z][a-zA-Z]+)/i,
    ];
    
    for (const pattern of explicitPatterns) {
      const match = t.match(pattern);
      if (match && match[1]) {
        let name = match[1].trim();
        // FIX v3.9.22: Strip parole comuni prima del nome
        name = name.replace(/^(sempre|ancora|proprio|stesso|solito)\s*/i, '');
        const commonWords = ['io', 'me', 'here', 'yes', 'si', 'no', 'quello', 'quella', 'esatto', 'confermo'];
        if (!commonWords.includes(name.toLowerCase()) && name.length >= 2) {
          console.log(`👤 FIX v3.9.21 extractName (explicit): "${name}"`);
          return name;
        }
      }
    }
    
    const words = t.split(/[\s,]+/);
    // FIX v3.9.22: Aggiunti prefissi italiani comuni da escludere
    const capitalizedWords = words.filter(w => {
      if (w.length < 2) return false;
      if (!/^[A-Z]/.test(w)) return false;
      const lower = w.toLowerCase();
      const exclude = ['sì', 'si', 'yes', 'no', 'ok', 'esatto', 'confermo', 'giusto', 'certo', 
                       'quello', 'quella', 'here', 'that', 'right', 'correct', 'sono', 'io',
                       'sempre', 'ancora', 'proprio', 'stesso', 'solito'];  // FIX v3.9.22
      return !exclude.includes(lower);
    });
    
    if (capitalizedWords.length > 0) {
      const lastName = capitalizedWords[capitalizedWords.length - 1];
      console.log(`👤 FIX v3.9.21 extractName (lastCap): "${lastName}"`);
      return lastName;
    }
    
    return null;
  },
  
  // FIX v3.9.21 BUG-001: Cerca nome ATTESO nella risposta + conferme implicite
  // FIX v3.9.22 BUG-013: Ignora nomi in contesto di negazione
  nameMatches(userResponse, expectedName) {
    if (!expectedName) return false;
    if (!userResponse) return false;
    
    const responseLower = userResponse.toLowerCase().trim();
    const expectedLower = expectedName.toLowerCase().trim();
    
    // FIX v3.9.22 BUG-013: Check negazione PRIMA di cercare il nome
    // FIX v3.9.23 BUG-022: Aggiunto \b word boundary per evitare match "sono" → "no"
    // Se il nome atteso è in un contesto di negazione, non è un match
    const negationPatterns = [
      new RegExp(`\\bnon\\s+(sono|mi\\s+chiamo|è|e')\\s+${expectedLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'),
      new RegExp(`\\b(non|no)\\s+${expectedLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'),  // FIX v3.9.23: \b aggiunto
      new RegExp(`${expectedLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+\\b(no|non|sbagliato|errato)\\b`, 'i'),
      new RegExp(`\\b(sbagliato|errato|errore)\\b.*${expectedLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'),
      new RegExp(`\\bnon\\s+è\\s+${expectedLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'),
    ];
    
    for (const pattern of negationPatterns) {
      if (pattern.test(responseLower)) {
        console.log(`❌ FIX v3.9.23 nameMatches: "${expectedLower}" in contesto NEGAZIONE, ignoro`);
        return false;
      }
    }
    
    // STEP 1: Nome atteso contenuto nella risposta
    if (responseLower.includes(expectedLower)) {
      console.log(`✅ FIX v3.9.21 nameMatches: "${expectedLower}" trovato in "${responseLower}"`);
      return true;
    }
    
    const expectedWords = expectedLower.split(/\s+/).filter(w => w.length >= 2);
    for (const word of expectedWords) {
      const regex = new RegExp(`\\b${word}\\b`, 'i');
      if (regex.test(responseLower)) {
        console.log(`✅ FIX v3.9.21 nameMatches: parola "${word}" trovata`);
        return true;
      }
    }
    
    // STEP 2: Conferme implicite
    const implicitConfirmPatterns = [
      /^s[ìi]\s*$/,
      /^s[ìi]\s+(esatto|confermo|quello|quella|giusto|certo|proprio)/i,
      /^esatto\s*$/i,
      /^confermo\s*$/i,
      /^giusto\s*$/i,
      /^quello\s*$/i,
      /^quella\s*$/i,
      /^yes\s*$/i,
      /^yes\s+(that'?s?\s*)?(us|me|right|correct|it)/i,
      /^that'?s?\s*(us|me|right|correct|it)/i,
      /^correct\s*$/i,
      /^right\s*$/i,
    ];
    
    for (const pattern of implicitConfirmPatterns) {
      if (pattern.test(responseLower)) {
        console.log(`✅ FIX v3.9.21 nameMatches: conferma implicita "${responseLower}"`);
        return true;
      }
    }
    
    // STEP 3: Selezione prenotazione
    const selectionPatterns = [
      /^quella?\s+(di\s+)?(luned|marted|mercoled|gioved|venerd|sabato|domenica)/i,
      /^quella?\s+(di\s+)?(sera|pranzo|mattina)/i,
      /^quella?\s+(delle?\s+)?\d{1,2}/i,
      /^the\s+one\s+(on|at|for)/i,
    ];
    
    for (const pattern of selectionPatterns) {
      if (pattern.test(responseLower)) {
        console.log(`✅ FIX v3.9.21 nameMatches: selezione "${responseLower}"`);
        return true;
      }
    }
    
    console.log(`❌ FIX v3.9.21 nameMatches: nessun match per "${expectedLower}" in "${responseLower}"`);
    return false;
  },
  
  isConfirming(text) {
    const t = normalizeText(text || "");
    if (/^(si\b|sii\b|yes\b|esatto|corretto|giusto|confermo|certo|ok\b|va bene|proprio|quella|perfetto)/.test(t)) return true;
    if (/\b(conferm|esatt|corrett|giust|perfett)\b/.test(t)) return true;
    return false;
  },
  
  // FIX v3.9.25 BUG-023: Riconosce conferma cancellazione esplicita
  isConfirmingCancellation(text) {
    const t = normalizeText(text || "");
    // Pattern italiani
    if (/conferm\w*\s+(la\s+)?cancellazion/i.test(t)) return true;
    if (/cancella(te)?\s+pure/i.test(t)) return true;
    if (/procedi\s+(con\s+)?(la\s+)?cancellazion/i.test(t)) return true;
    if (/si\s*,?\s*cancella/i.test(t)) return true;
    // Pattern inglesi
    if (/confirm\w*\s+(the\s+)?cancellation/i.test(t)) return true;
    if (/please\s+cancel/i.test(t)) return true;
    if (/go\s+ahead\s+(and\s+)?cancel/i.test(t)) return true;
    if (/yes\s*,?\s*cancel/i.test(t)) return true;
    return false;
  },
  
  isDenying(text) {
    const t = normalizeText(text || "");
    if (/^(no[^n]|non |sbagliato|errato|altra|diversa)/.test(t)) return true;
    if (/\b(sbagliat|errat|non e quella)\b/.test(t)) return true;
    // FIX v3.9.26 F6: Riconosce ripensamenti sulla cancellazione
    if (/\b(teniamo|mantieni|manteniamo|lascia stare|lascia perdere|non cancell|non la cancell)\b/i.test(t)) return true;
    // Pattern inglesi per ripensamento
    if (/\b(keep it|don't cancel|never\s*mind|forget it)\b/i.test(t)) return true;
    return false;
  },
  
  buildAskWhatToModify(existingRes, lang = "it-IT") {
    const firstName = existingRes.name?.split(' ')[0] || existingRes.name;
    return lang === "en-US"
      ? `${firstName}, what would you like to change? The time, day, or number of people?`
      : `${firstName}, cosa vorresti modificare? L'orario, il giorno, o il numero di persone?`;
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 14: VALIDATION PIPELINE
// ═══════════════════════════════════════════════════════════════════════════════

const ValidationPipeline = {
  // 🆕 v3.9.31: Accetta callId per usare orari dinamici
  isValidTime(time, callId = null) {
    if (!time) return false;
    const [hourStr, minStr] = time.split(':');
    const hour = parseInt(hourStr);
    const minutes = parseInt(minStr || '0');
    const totalMinutes = hour * 60 + minutes;
    
    // 🆕 v3.9.31: Usa orari dal config del ristorante
    const hours = ConfigHelper.getOpeningHours(callId);
    
    const isLunch = totalMinutes >= hours.lunchStart && totalMinutes <= hours.lunchEnd;
    const isDinner = totalMinutes >= hours.dinnerStart && totalMinutes <= hours.dinnerEnd;
    const isValid = isLunch || isDinner;
    
    if (!isValid) {
      console.log(`⏰ isValidTime: ${time} (${totalMinutes} min) fuori range pranzo ${hours.lunchStart}-${hours.lunchEnd} E cena ${hours.dinnerStart}-${hours.dinnerEnd}`);
    }
    return isValid;
  },
  
  checkDayWeekNumberMismatch(userText, calculatedDate, lang = "it-IT") {
    if (!userText || !calculatedDate) return { mismatch: false };
    
    const text = normalizeText(userText);
    
    const daysMap = {
      'domenica': 0, 'sunday': 0,
      'lunedi': 1, 'monday': 1,
      'martedi': 2, 'tuesday': 2,
      'mercoledi': 3, 'wednesday': 3,
      'giovedi': 4, 'thursday': 4,
      'venerdi': 5, 'friday': 5,
      'sabato': 6, 'saturday': 6,
    };
    
    const dayNamesIT = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
    const dayNamesEN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const monthNamesIT = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
                          'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
    const monthNamesEN = ['January', 'February', 'March', 'April', 'May', 'June',
                          'July', 'August', 'September', 'October', 'November', 'December'];
    
    let mentionedDayOfWeek = null;
    let mentionedDayName = null;
    for (const [dayName, dayIndex] of Object.entries(daysMap)) {
      if (text.includes(dayName)) {
        mentionedDayOfWeek = dayIndex;
        mentionedDayName = dayName;
        break;
      }
    }
    
    const monthNames = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
                        'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre',
                        'january', 'february', 'march', 'april', 'may', 'june',
                        'july', 'august', 'september', 'october', 'november', 'december'];
    
    const hasExplicitMonth = monthNames.some(m => text.includes(m));
    if (hasExplicitMonth) return { mismatch: false };
    
    const allDays = Object.keys(daysMap).join('|');
    const italianPattern = new RegExp(`\\b(${allDays})\\s+(?:il\\s+)?(\\d{1,2})\\b`, 'i');
    const englishPattern = new RegExp(`\\b(${allDays})\\s+(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'i');
    const inversePattern = new RegExp(`\\b(?:il\\s+|the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(${allDays})\\b`, 'i');
    
    let mentionedDayNumber = null;
    let adjacentDayMatch = text.match(italianPattern) || text.match(englishPattern);
    
    if (adjacentDayMatch) {
      mentionedDayNumber = parseInt(adjacentDayMatch[2]);
      console.log(`📆 FIX v3.9.20: Pattern adiacente trovato: "${adjacentDayMatch[0]}" → giorno ${mentionedDayNumber}`);
    } else {
      const inverseMatch = text.match(inversePattern);
      if (inverseMatch) {
        mentionedDayNumber = parseInt(inverseMatch[1]);
        console.log(`📆 FIX v3.9.20: Pattern inverso trovato: "${inverseMatch[0]}" → giorno ${mentionedDayNumber}`);
      }
    }
    
    if (mentionedDayNumber === null) return { mismatch: false };
    if (mentionedDayOfWeek === null || mentionedDayNumber === null) return { mismatch: false };
    
    const [year, month, day] = calculatedDate.split('-').map(Number);
    const dateObj = new Date(year, month - 1, day);
    const actualDayOfWeek = dateObj.getDay();
    const actualDayNumber = dateObj.getDate();
    
    if (mentionedDayOfWeek !== actualDayOfWeek || mentionedDayNumber !== actualDayNumber) {
      console.log(`📆 FIX v3.9.10: Mismatch! Utente dice "${mentionedDayName} ${mentionedDayNumber}", calcolato ${calculatedDate} (dow=${actualDayOfWeek}, day=${actualDayNumber})`);
      
      const suggestedDate = this._findNextMatchingDate(mentionedDayOfWeek, mentionedDayNumber);
      
      if (suggestedDate) {
        const suggestedDayName = lang === "en-US" ? dayNamesEN[mentionedDayOfWeek] : dayNamesIT[mentionedDayOfWeek];
        const suggestedMonthName = lang === "en-US" ? monthNamesEN[suggestedDate.getMonth()] : monthNamesIT[suggestedDate.getMonth()];
        const suggestedDateStr = `${suggestedDate.getFullYear()}-${String(suggestedDate.getMonth() + 1).padStart(2, '0')}-${String(suggestedDate.getDate()).padStart(2, '0')}`;
        
        console.log(`📆 FIX v3.9.10: Data più vicina trovata: ${suggestedDateStr} (${suggestedDayName} ${mentionedDayNumber} ${suggestedMonthName})`);
        
        const message = lang === "en-US"
          ? `Do you mean ${suggestedDayName} ${mentionedDayNumber} ${suggestedMonthName}?`
          : `Intendi ${suggestedDayName} ${mentionedDayNumber} ${suggestedMonthName}?`;
        
        return {
          mismatch: true,
          mentionedDay: mentionedDayName,
          mentionedNumber: mentionedDayNumber,
          calculatedDate: calculatedDate,
          suggestedDate: suggestedDateStr,
          message: message,
        };
      } else {
        const message = lang === "en-US"
          ? `You said ${mentionedDayName} the ${mentionedDayNumber}th, but I'm not sure which month you mean. Could you specify the month?`
          : `Hai detto ${mentionedDayName} ${mentionedDayNumber}, ma non ho capito il mese. Puoi specificare il mese?`;
        
        return {
          mismatch: true,
          mentionedDay: mentionedDayName,
          mentionedNumber: mentionedDayNumber,
          calculatedDate: calculatedDate,
          message: message,
        };
      }
    }
    
    return { mismatch: false };
  },
  
  _findNextMatchingDate(dayOfWeek, dayNumber, maxDays = 60) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const maxDate = new Date(today);
    maxDate.setDate(maxDate.getDate() + maxDays);
    
    for (let monthOffset = 0; monthOffset < 3; monthOffset++) {
      const testYear = today.getFullYear() + Math.floor((today.getMonth() + monthOffset) / 12);
      const testMonth = (today.getMonth() + monthOffset) % 12;
      
      const testDate = new Date(testYear, testMonth, dayNumber);
      
      if (testDate.getDate() !== dayNumber) continue;
      if (testDate.getDay() !== dayOfWeek) continue;
      
      if (testDate >= today) {
        if (testDate <= maxDate) {
          return testDate;
        } else {
          console.log(`📆 FIX v3.9.20: Data ${testDate.toISOString().split('T')[0]} oltre limite ${maxDays} giorni, ignorata`);
          return null;
        }
      }
    }
    
    return null;
  },
  
  FALSE_CLOSURE_PATTERNS: [
    /è (un |il )?lunedì/i,
    /lunedì.*chius/i,
    /chius.*lunedì/i,
    /siamo chius/i,
    /ristorante.*chius/i,
    /giorno.*chius/i,
    /quel giorno.*chius/i,
    /is closed/i,
    /we are closed/i,
    /we're closed/i,
    /it's.*monday/i,
    /is a monday/i,
    /on monday/i,
    /that day.*closed/i,
  ],
  
  FALSE_FULLYBOOOKED_PATTERNS: [
    /fully booked/i,
    /we.?re full/i,
    /we are full/i,
    /no availability/i,
    /no tables? available/i,
    /all booked/i,
    /siamo (al )?complet/i,
    /siamo pien/i,
    /tutto (e)?saurito/i,
    /non abbiamo (più )?posto/i,
    /non abbiamo disponibilità/i,
  ],
  
  async validate(gptResponse, userText, callId) {
    console.log("🔄 ValidationPipeline...");
    
    const lang = StateManager.getLanguage(callId);
    let response = { ...gptResponse };
    let reservation = response.reservation || {};
    
    // 🆕 FIX v3.9.30 J8: Controlla tempo relativo ("tra mezz'ora", "tra un'ora")
    const relativeTime = TimeManager.parseRelativeTime(userText);
    if (relativeTime) {
      console.log(`⏰ FIX v3.9.30 J8: Tempo relativo rilevato → ${relativeTime.time}, imposto data=oggi`);
      reservation.time = relativeTime.time;
      reservation.date = DateManager.toISO(DateManager.getNow()); // Oggi
      
      // 🆕 v3.9.31: Verifica se orario è valido usando orari dinamici
      if (!this.isValidTime(relativeTime.time, callId)) {
        console.log(`⏰ FIX v3.9.30 J8: Orario ${relativeTime.time} fuori orari apertura`);
        response.action = "ask_time";
        response.reply_text = ConfigHelper.buildInvalidTimeMessage(callId, lang);
        response.reservation = reservation;
        return response;
      }
    }
    
    // 🆕 FIX v3.9.30 J1-J10: Rileva note cliente (allergie, richieste speciali, occasioni)
    const noteKeywords = {
      // Allergie e intolleranze
      'celiac|celiaco|celiaca|glutine|gluten': 'Allergia/intolleranza glutine',
      'allergic|allergi|allergico|allergica': null, // Generico, cattura il contesto
      'intoleran|intolleran': null, // Generico
      'vegetarian|vegetariano|vegetariana': 'Vegetariano/a',
      'vegan|vegano|vegana': 'Vegano/a',
      'lactose|lattosio': 'Intolleranza lattosio',
      'arachidi|peanut|noci|nuts|frutta secca': 'Allergia frutta secca/arachidi',
      // Richieste bambini
      'seggiolone|seggiolino|highchair|high chair': 'Richiesto seggiolone',
      'bambino piccolo|bambina piccola|neonato|infant|baby|toddler': 'Presenza bambino piccolo',
      'passeggino|stroller': 'Passeggino',
      // Accessibilità
      'sedia a rotelle|carrozzina|wheelchair': 'Accessibilità richiesta',
      'disabil|handicap': 'Accessibilità richiesta',
      // Occasioni speciali
      'anniversario|anniversary': 'Anniversario',
      'compleanno|birthday': 'Compleanno',
      'romantico|romantic': 'Tavolo romantico',
      'proposta|propose|engagement': 'Occasione speciale',
      // Preferenze tavolo
      'finestra|window': 'Preferenza tavolo finestra',
      'esterno|terrazza|outside|outdoor|terrace': 'Preferenza esterno',
      'interno|inside|indoor': 'Preferenza interno',
      'tranquillo|quiet|riservato|private': 'Tavolo tranquillo/riservato',
      'vicino ai giochi|near play|area giochi': 'Vicino area giochi bambini',
    };
    
    // 🆕 FIX v3.9.30 J5/J6: Rileva numero di telefono alternativo
    const phonePattern = /(?:numero|telefono|cell|phone|contact|contatt).*?(\+?\d[\d\s\-]{6,})/i;
    const phoneMatch = userText.match(phonePattern);
    
    const savedRes = StateManager.getReservation(callId);
    let existingNotes = savedRes.notes || reservation.notes || '';
    
    if (phoneMatch) {
      const phoneNumber = phoneMatch[1].replace(/[\s\-]/g, '');
      const phoneNote = `Tel. alternativo: ${phoneNumber}`;
      console.log(`📝 FIX v3.9.30 J5/J6: Rilevato telefono alternativo: "${phoneNumber}"`);
      
      if (!existingNotes.includes('Tel. alternativo')) {
        existingNotes = existingNotes ? `${existingNotes}; ${phoneNote}` : phoneNote;
        reservation.notes = existingNotes;
        StateManager.mergeReservation(callId, { notes: reservation.notes });
        console.log(`📝 FIX v3.9.30 J5/J6: Note aggiornate: "${reservation.notes}"`);
      }
    }
    
    let newNotesFound = [];
    
    const textLower = userText.toLowerCase();
    for (const [pattern, defaultNote] of Object.entries(noteKeywords)) {
      const regex = new RegExp(pattern, 'i');
      if (regex.test(textLower)) {
        // Estrai contesto per note generiche
        let noteText = defaultNote;
        if (!noteText) {
          // Cattura parte del messaggio come nota
          const match = textLower.match(new RegExp(`(\\w+\\s+){0,3}${pattern}(\\s+\\w+){0,3}`, 'i'));
          noteText = match ? match[0].trim() : pattern;
        }
        
        // Evita duplicati
        if (!existingNotes.toLowerCase().includes(noteText.toLowerCase().substring(0, 10))) {
          newNotesFound.push(noteText);
          console.log(`📝 FIX v3.9.30 NOTE: Rilevata nota cliente: "${noteText}"`);
        }
      }
    }
    
    if (newNotesFound.length > 0) {
      const allNotes = existingNotes 
        ? `${existingNotes}; ${newNotesFound.join('; ')}`
        : newNotesFound.join('; ');
      reservation.notes = allNotes;
      console.log(`📝 FIX v3.9.30 NOTE: Note totali: "${reservation.notes}"`);
      
      // 🆕 FIX v3.9.30: Salva le note nello StateManager per persistenza
      StateManager.mergeReservation(callId, { notes: reservation.notes });
    }
    
    // FIX v3.9.27 ZG6C: Se c'è una data pendente (dopo redirect P1), forza quella data
    const pendingDate = StateManager.getPendingCorrectDate(callId);
    if (pendingDate) {
      if (reservation.date && reservation.date !== pendingDate) {
        console.log(`📆 FIX v3.9.27 ZG6C: GPT dice "${reservation.date}" ma data corretta è "${pendingDate}" - OVERRIDE`);
        reservation.date = pendingDate;
      } else if (!reservation.date) {
        console.log(`📆 FIX v3.9.27 ZG6C: GPT non ha data, uso data pendente "${pendingDate}"`);
        reservation.date = pendingDate;
      }
      
      // FIX v3.9.27 ZG3C: Se c'è data pendente ma cliente non ha scelto orario, chiedi ancora
      const parsedTimeFromText = TimeManager.parseFromText(userText);
      if (!parsedTimeFromText && !reservation.time) {
        console.log(`⚠️ FIX v3.9.27 ZG3C: Data pendente ma nessun orario scelto - chiedo ancora`);
        
        // Salva email se presente nel messaggio (non perderla!)
        const emailFromText = extractEmailFromText(userText);
        if (emailFromText) {
          reservation.customerEmail = sanitizeEmail(emailFromText);
          console.log(`📧 FIX v3.9.27 ZG3C: Salvata email "${reservation.customerEmail}" per dopo`);
        }
        
        // Salva anche il nome se presente
        const savedRes = StateManager.getReservation(callId);
        if (savedRes.name) reservation.name = savedRes.name;
        if (savedRes.people) reservation.people = savedRes.people;
        
        // Merge per salvare tutto
        StateManager.mergeReservation(callId, reservation);
        
        response.action = "ask_time";
        response.reply_text = lang === "en-US"
          ? "Which time would you prefer among the alternatives I proposed?"
          : "Quale orario preferisci tra le alternative che ti ho proposto?";
        response.reservation = reservation;
        // NON pulisco la data pendente, serve ancora
        return response;
      }
      
      // Pulisci la data pendente se stiamo creando la prenotazione
      if (response.action === "create_reservation") {
        StateManager.clearPendingCorrectDate(callId);
      }
    }
    
    const gptOriginalTime = reservation.time;
    const gptOriginalDate = reservation.date;
    const savedReservation = StateManager.getReservation(callId);
    
    let parsedDate = DateManager.parseFromText(userText, null);
    if (parsedDate) {
      if (reservation.date && reservation.date !== parsedDate) {
        console.log(`📆 FIX v3.9 OVERRIDE DATA: ${reservation.date} → ${parsedDate}`);
      }
      
      // FIX v3.9.23 BUG-021: Correggi reply_text se GPT usa data diversa da quella calcolata
      // Questo fix si applica anche al PRIMO messaggio (quando savedReservation è vuoto)
      // 🆕 FIX v3.9.31: Pattern cattura anche giorno settimana opzionale per evitare "venerdì sabato 6"
      if (gptOriginalDate && gptOriginalDate !== parsedDate) {
        const italianMonths = "gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre";
        const englishMonths = "January|February|March|April|May|June|July|August|September|October|November|December";
        const italianDays = "lunedì|martedì|mercoledì|giovedì|venerdì|sabato|domenica";
        const englishDays = "Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday";
        
        // 🆕 FIX v3.9.31: Pattern che cattura [giorno_settimana opzionale] + numero + mese + [anno opzionale]
        const italianDatePattern = new RegExp(`(?:(?:${italianDays})\\s+)?(\\d{1,2})\\s+(${italianMonths})(?:\\s+\\d{4})?`, 'gi');
        const englishDatePattern = new RegExp(`(?:(?:${englishDays})\\s+)?(${englishMonths})\\s+(\\d{1,2})(?:\\s+\\d{4})?`, 'gi');
        
        // 🆕 FIX v3.9.31: Include anche l'anno nella sostituzione
        const correctDateDisplay = DateManager.formatForDisplay(parsedDate, lang);
        const correctYear = parsedDate.split('-')[0];
        const correctDateWithYear = `${correctDateDisplay} ${correctYear}`;
        
        if (response.reply_text && (italianDatePattern.test(response.reply_text) || englishDatePattern.test(response.reply_text))) {
          let correctedReply = response.reply_text;
          // Reset regex lastIndex
          italianDatePattern.lastIndex = 0;
          englishDatePattern.lastIndex = 0;
          // 🆕 FIX v3.9.31: Usa data con anno per la sostituzione
          correctedReply = correctedReply.replace(italianDatePattern, correctDateWithYear);
          correctedReply = correctedReply.replace(englishDatePattern, correctDateWithYear);
          
          if (correctedReply !== response.reply_text) {
            console.log(`📝 FIX v3.9.23 BUG-021: Corretto reply_text con data calcolata: "${correctDateWithYear}"`);
            response.reply_text = correctedReply;
          }
        }
      }
      
      reservation.date = parsedDate;
      
      const dayWeekMismatch = this.checkDayWeekNumberMismatch(userText, parsedDate, lang);
      if (dayWeekMismatch.mismatch) {
        if (dayWeekMismatch.suggestedDate) {
          console.log(`⚠️ FIX v3.9.11: Mismatch rilevato! Uso data suggerita: ${dayWeekMismatch.suggestedDate}`);
          reservation.date = dayWeekMismatch.suggestedDate;
          parsedDate = dayWeekMismatch.suggestedDate;
          response._dateWasCorrected = true;
          response._correctedDateMessage = dayWeekMismatch.message.replace('?', '.');
        } else {
          console.log(`⚠️ FIX v3.9.10: Mismatch rilevato! Chiedo il mese (no suggestedDate).`);
          response.reply_text = dayWeekMismatch.message;
          response.action = "ask_date";
          reservation.date = null;
          StateManager.mergeReservation(callId, { date: null });
          response.reservation = reservation;
          return response;
        }
      }
    } else if (savedReservation.date) {
      if (reservation.date && reservation.date !== savedReservation.date) {
        console.log(`📆 FIX v3.9.2 PROTEZIONE DATA: GPT dice ${reservation.date}, mantengo ${savedReservation.date}`);
        
        // 🆕 FIX v3.9.31: Pattern cattura anche giorno settimana + anno opzionale
        const italianMonths = "gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre";
        const englishMonths = "January|February|March|April|May|June|July|August|September|October|November|December";
        const italianDays = "lunedì|martedì|mercoledì|giovedì|venerdì|sabato|domenica";
        const englishDays = "Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday";
        
        const italianDatePattern = new RegExp(`(?:(?:${italianDays})\\s+)?(\\d{1,2})\\s+(${italianMonths})(?:\\s+\\d{4})?`, 'gi');
        const englishDatePattern = new RegExp(`(?:(?:${englishDays})\\s+)?(${englishMonths})\\s+(\\d{1,2})(?:\\s+\\d{4})?`, 'gi');
        
        // 🆕 FIX v3.9.31: Include anno nella sostituzione
        const correctDateDisplay = DateManager.formatForDisplay(savedReservation.date, lang);
        const correctYear = savedReservation.date.split('-')[0];
        const correctDateWithYear = `${correctDateDisplay} ${correctYear}`;
        
        if (italianDatePattern.test(response.reply_text) || englishDatePattern.test(response.reply_text)) {
          let correctedReply = response.reply_text;
          italianDatePattern.lastIndex = 0;
          englishDatePattern.lastIndex = 0;
          correctedReply = correctedReply.replace(italianDatePattern, correctDateWithYear);
          correctedReply = correctedReply.replace(englishDatePattern, correctDateWithYear);
          
          if (correctedReply !== response.reply_text) {
            console.log(`📝 FIX v3.9.19: Corretto reply_text con data protetta: "${correctDateWithYear}"`);
            response.reply_text = correctedReply;
          }
        }
      }
      reservation.date = savedReservation.date;
    }
    
    // 🆕 FIX v3.9.31: Se GPT inventa una data che l'utente non ha specificato, forzare ask_date
    // Questo previene che GPT scelga arbitrariamente un giorno (es. "mercoledì") quando
    // l'utente non ha specificato il giorno
    if (!savedReservation.date && !parsedDate && reservation.date) {
      console.log(`⚠️ FIX v3.9.31: GPT ha inventato data ${reservation.date} ma utente non l'ha specificata → forzo ask_date`);
      response.action = "ask_date";
      response.reply_text = lang === "en-US"
        ? "For which day would you like to book?"
        : "Per quale giorno vorresti prenotare?";
      reservation.date = null;
      response.reservation = reservation;
      return response;
    }
    
    if (reservation.date) {
      const closureCheck = await ClosureChecker.isOpen(reservation.date, callId);
      if (!closureCheck.open) {
        console.log(`⛔ Giorno chiuso`);
        response.reply_text = ClosureChecker.buildClosedMessage(reservation.date, closureCheck, lang);
        response.action = "ask_date";
        reservation.date = null;
        StateManager.mergeReservation(callId, { date: null });
        response.reservation = reservation;
        return response;
      }
      
      if (this.FALSE_CLOSURE_PATTERNS.some(p => p.test(response.reply_text))) {
        console.log(`📝 FIX v3.9.9: GPT dice "chiuso" ma ${reservation.date} è APERTO - correggo reply_text`);
        
        const dateDisplay = DateManager.formatForDisplay(reservation.date, lang);
        
        if (lang === "en-US") {
          response.reply_text = `Perfect, ${dateDisplay}! What time would you like to book?`;
        } else {
          response.reply_text = `Perfetto, ${dateDisplay}! A che ora vorresti prenotare?`;
        }
        response.action = "ask_time";
        console.log(`📝 FIX v3.9.9: Nuova reply: "${response.reply_text}"`);
      }
      
      const earlyTimeCheck = reservation.time || savedReservation.time;
      const earlyPeopleCheck = reservation.people || savedReservation.people;
      const gptSaysFullyBooked = this.FALSE_FULLYBOOOKED_PATTERNS.some(p => p.test(response.reply_text));
      
      if (gptSaysFullyBooked && (!earlyTimeCheck || !earlyPeopleCheck)) {
        console.log(`📝 FIX v3.9.16: GPT dice "pieni/fully booked" ma non abbiamo verificato - correggo`);
        
        const dateDisplay = DateManager.formatForDisplay(reservation.date, lang);
        
        if (!earlyTimeCheck) {
          response.reply_text = lang === "en-US"
            ? `We're open on ${dateDisplay}. What time would you like to book?`
            : `Siamo aperti ${dateDisplay}. A che ora vorresti prenotare?`;
          response.action = "ask_time";
        } else if (!earlyPeopleCheck) {
          response.reply_text = lang === "en-US"
            ? `How many people will be in your party?`
            : `Per quante persone?`;
          response.action = "ask_people";
        }
        console.log(`📝 FIX v3.9.16: Nuova reply: "${response.reply_text}"`);
      }
    }
    
    const effectiveDate = reservation.date || savedReservation.date;
    if (response.action === "ask_date" && effectiveDate) {
      console.log(`⚠️ FIX v3.9.17: GPT chiede data ma abbiamo già ${effectiveDate} → skip`);
      
      reservation.date = effectiveDate;
      
      const hasTime = reservation.time || savedReservation.time;
      const hasPeople = reservation.people || savedReservation.people;
      const hasName = reservation.name || savedReservation.name;
      
      if (!hasTime) {
        response.action = "ask_time";
        response.reply_text = lang === "en-US"
          ? "What time would you like to book?"
          : "A che ora vorresti prenotare?";
      } else if (!hasPeople) {
        response.action = "ask_people";
        response.reply_text = lang === "en-US"
          ? "How many people will be in your party?"
          : "Per quante persone?";
      } else if (!hasName) {
        response.action = "ask_name";
        response.reply_text = lang === "en-US"
          ? "What name for the reservation?"
          : "A che nome la prenotazione?";
      } else {
        response.action = "ask_email";
        response.reply_text = lang === "en-US"
          ? "Would you like to provide an email for confirmation?"
          : "Vuoi fornire un'email per la conferma?";
      }
      console.log(`⚠️ FIX v3.9.17: Nuovo action: ${response.action}`);
    }
    
    const parsedTime = TimeManager.parseFromText(userText);
    if (parsedTime) {
      if (reservation.time && reservation.time !== parsedTime) {
        console.log(`⏰ FIX v3.9 OVERRIDE ORARIO: ${reservation.time} → ${parsedTime}`);
      }
      reservation.time = parsedTime;
    } else if (savedReservation.time) {
      if (reservation.time && reservation.time !== savedReservation.time) {
        console.log(`⏰ FIX v3.9.2 PROTEZIONE ORARIO: GPT dice ${reservation.time}, mantengo ${savedReservation.time}`);
      }
      reservation.time = savedReservation.time;
    } else if (!reservation.time) {
      const defaultTime = TimeManager.inferDefault(userText);
      if (defaultTime) {
        console.log(`⏰ FIX v3.9: Orario inferito da "${userText.substring(0,20)}": ${defaultTime}`);
        reservation.time = defaultTime;
      }
    }
    
    // 🆕 v3.9.31: Usa isValidTime con callId per orari dinamici
    if (reservation.time && !this.isValidTime(reservation.time, callId)) {
      const isAskingAboutTime = /\b(ultimo|prima|quale|quali|orari|apertura|chiusura|when|what time|available|hours)\b/i.test(userText);
      
      if (isAskingAboutTime) {
        console.log(`ℹ️ FIX v3.9.3: Orario ${reservation.time} invalido + cliente chiede info → resetto`);
        reservation.time = null;
      } else {
        console.log(`⏰ FIX v3.9.4: Orario ${reservation.time} INVALIDO → forzo ask_time`);
        response.action = "ask_time";
        // 🆕 v3.9.31: Usa messaggio con orari dinamici
        response.reply_text = ConfigHelper.buildInvalidTimeMessage(callId, lang);
        reservation.time = null;
      }
    }
    else if (response.action === "ask_time" && reservation.time) {
      const isAskingAboutTime = /\b(ultimo|prima|quale|quali|orari|apertura|chiusura|when|what time|available|hours)\b/i.test(userText);
      
      if (isAskingAboutTime) {
        console.log(`ℹ️ FIX v3.9: Cliente chiede info orari, lascio risposta GPT`);
      } else if (this.isValidTime(reservation.time, callId)) {
        console.log(`⚠️ FIX v3.9: GPT chiede orario ma abbiamo già ${reservation.time} valido → skip`);
        
        const hasPeople = savedReservation.people || reservation.people;
        const hasName = savedReservation.name || reservation.name;
        const hasDate = savedReservation.date || reservation.date;
        
        if (!hasPeople) {
          response.action = "ask_people";
          response.reply_text = lang === "en-US" 
            ? "For how many people?" 
            : "Per quante persone?";
        } else if (!hasName) {
          response.action = "ask_name";
          response.reply_text = lang === "en-US"
            ? "What name for the reservation?"
            : "A che nome la prenotazione?";
        } else if (hasDate && hasPeople && hasName) {
          console.log(`✅ FIX v3.9: Tutti i dati presenti, forzo create_reservation`);
          response.action = "create_reservation";
        }
      }
    }
    
    const parsedPeople = PeopleManager.parseFromText(userText);
    if (parsedPeople) {
      if (reservation.people && reservation.people !== parsedPeople) {
        console.log(`👥 FIX v3.9 OVERRIDE PERSONE: ${reservation.people} → ${parsedPeople}`);
      }
      reservation.people = parsedPeople;
    } else if (savedReservation.people) {
      if (reservation.people && reservation.people !== savedReservation.people) {
        console.log(`👥 FIX v3.9.2 PROTEZIONE PERSONE: GPT dice ${reservation.people}, mantengo ${savedReservation.people}`);
      }
      reservation.people = savedReservation.people;
    }
    
    const parsedName = NameManager.parseFromText(userText);
    if (parsedName) {
      if (!reservation.name) {
        reservation.name = parsedName;
      }
    } else if (savedReservation.name && !reservation.name) {
      reservation.name = savedReservation.name;
    }
    
    // FIX v3.9.27: Estrai email dal messaggio corrente PRIMA del check ZG-NOME
    if (!reservation.customerEmail) {
      const emailFromText = extractEmailFromText(userText);
      if (emailFromText) {
        reservation.customerEmail = sanitizeEmail(emailFromText);
        console.log(`📧 FIX v3.9.27: Email "${reservation.customerEmail}" estratta dal messaggio`);
      }
    }
    
    // FIX v3.9.27 ZG-NOME: Se GPT chiede nome ma abbiamo già un nome (da questo turn O da turn precedenti), skip
    const knownName = reservation.name || savedReservation.name;
    const knownEmail = reservation.customerEmail || savedReservation.customerEmail;
    
    if (response.action === "ask_name" && knownName) {
      // Se abbiamo anche l'email, procedi direttamente con la prenotazione
      if (knownEmail) {
        console.log(`[OUT] FIX v3.9.27 ZG-NOME: Nome "${knownName}" e email "${knownEmail}" già noti, override ask_name → create_reservation`);
        response.action = "create_reservation";
        // Il sistema gestirà automaticamente PENDING_OWNER per gruppi >10
      } else {
        // Solo nome noto, chiedi email
        console.log(`[OUT] FIX v3.9.27 ZG-NOME: Nome "${knownName}" già noto, override ask_name → ask_email`);
        response.action = "ask_email";
        response.reply_text = lang === "en-US"
          ? "Do you have an email for the confirmation? It's optional."
          : "Hai un'email per la conferma? È opzionale.";
      }
    }
    
    if (reservation.people >= CONFIG.EVENT_THRESHOLD) {
      const email = ContextService.getRestaurantEmail(callId);
      response.action = "none";
      response.reply_text = lang === "en-US"
        ? `For events of ${reservation.people} people, please email us at ${email}. We'll be happy to help!`
        : `Per eventi di ${reservation.people} persone, ti chiedo di scriverci a ${email}. Saremo felici di organizzare!`;
      response.reservation = reservation;
      return response;
    }
    
    const hasDateForCheck = reservation.date;
    const hasTimeForCheck = reservation.time;
    const hasPeopleForCheck = reservation.people;
    
    if (hasDateForCheck && hasTimeForCheck && hasPeopleForCheck) {
      if (response.action === "ask_name" || response.action === "ask_email" || response.action === "create_reservation") {
        
        // FIX v3.9.23 BUG-020: Skip check P1 se prenotazione già creata (è un update, non nuova)
        const existingEventId = StateManager.getCreatedEventId(callId);
        if (existingEventId) {
          console.log(`⏭️ FIX v3.9.23: Skip check P1, prenotazione già creata (eventId: ${existingEventId})`);
        } else {
          const dateToCheck = reservation.date;
          const timeToCheck = reservation.time;
          const peopleToCheck = reservation.people;
          
          console.log(`🔍 FIX P1: Check anticipato ${dateToCheck} ${timeToCheck} per ${peopleToCheck} pax`);
          const availability = await CalendarService.checkAvailability(
            dateToCheck, timeToCheck, peopleToCheck, callId
          );
          
          if (!availability.available) {
            console.log(`⚠️ FIX P1: Slot NON disponibile! Propongo alternative.`);
            
            if (availability.reason === "day_closed") {
              response.reply_text = lang === "en-US"
                ? "I'm sorry, we're closed that day. Would you like another day?"
                : "Mi dispiace, quel giorno siamo chiusi. Vuoi provare un altro giorno?";
              response.action = "ask_date";
              reservation.date = null;
              StateManager.mergeReservation(callId, { date: null });
            } else {
              const alternatives = await CalendarService.findAlternatives(
                dateToCheck, timeToCheck, peopleToCheck, callId
              );
              const isLargeGroup = peopleToCheck > CONFIG.LARGE_GROUP_THRESHOLD;
              response.reply_text = CalendarService.buildAlternativesMessage(alternatives, lang, isLargeGroup);
              response.action = "ask_time";
              reservation.time = null;
              StateManager.mergeReservation(callId, { time: null });
              
              // FIX v3.9.27 ZG6C: Salva data corretta per il turn successivo
              StateManager.setPendingCorrectDate(callId, dateToCheck);
            }
            
            response.reservation = reservation;
            console.log("✅ ValidationPipeline completato (con redirect P1)");
            return response;
          } else {
            console.log(`✅ FIX P1: Slot disponibile, procedo normalmente`);
          }
        }
      }
    }
    
    if (!reservation.customerEmail) {
      const email = extractEmailFromText(userText);
      if (email) reservation.customerEmail = sanitizeEmail(email);
    }
    
    const merged = StateManager.mergeReservation(callId, reservation);
    response.reservation = merged;
    
    if (response.action === "create_reservation") {
      if (!merged.date) response.action = "ask_date";
      else if (!merged.time) response.action = "ask_time";
      else if (!merged.people) response.action = "ask_people";
      else if (!merged.name) response.action = "ask_name";
    }
    
    if (response.reply_text && merged.time && gptOriginalTime && gptOriginalTime !== merged.time) {
      const oldTimeDisplay = TimeManager.formatForDisplay(gptOriginalTime);
      const newTimeDisplay = TimeManager.formatForDisplay(merged.time);
      
      const oldHour = parseInt(gptOriginalTime.split(':')[0]);
      const oldMin = parseInt(gptOriginalTime.split(':')[1]);
      const newHour = parseInt(merged.time.split(':')[0]);
      const newMin = parseInt(merged.time.split(':')[1]);
      
      let fixedText = response.reply_text;
      
      if (oldHour !== newHour || oldMin !== newMin) {
        fixedText = fixedText.replace(new RegExp(oldTimeDisplay.replace(':', '[:\\.]'), 'g'), newTimeDisplay);
        
        if (oldHour !== newHour) {
          fixedText = fixedText.replace(
            new RegExp(`(alle|ore)\\s+${oldHour}(?!:\\d|\\d)`, 'gi'),
            `$1 ${newHour}`
          );
        }
      }
      
      if (fixedText !== response.reply_text) {
        console.log(`📝 FIX v3.9.6: Corretto reply_text: "${oldTimeDisplay}" → "${newTimeDisplay}"`);
        response.reply_text = fixedText;
      }
    }
    
    if (response._dateWasCorrected) {
      console.log(`📝 FIX v3.9.11: Data corretta a ${merged.date} - costruisco messaggio appropriato`);
      
      const dateDisplay = DateManager.formatForDisplay(merged.date, lang);
      
      if (!merged.time) {
        if (lang === "en-US") {
          response.reply_text = `OK, ${dateDisplay}. What time would you like to book?`;
        } else {
          response.reply_text = `OK, ${dateDisplay}. A che ora vorresti prenotare?`;
        }
        response.action = "ask_time";
      } else if (!merged.people) {
        if (lang === "en-US") {
          response.reply_text = `OK, ${dateDisplay} at ${TimeManager.formatForDisplay(merged.time)}. How many people?`;
        } else {
          response.reply_text = `OK, ${dateDisplay} alle ${TimeManager.formatForDisplay(merged.time)}. Per quante persone?`;
        }
        response.action = "ask_people";
      } else if (!merged.name) {
        if (lang === "en-US") {
          response.reply_text = `OK, ${dateDisplay} at ${TimeManager.formatForDisplay(merged.time)} for ${merged.people} people. What name for the reservation?`;
        } else {
          response.reply_text = `OK, ${dateDisplay} alle ${TimeManager.formatForDisplay(merged.time)} per ${merged.people} persone. A che nome?`;
        }
        response.action = "ask_name";
      } else {
        if (lang === "en-US") {
          response.reply_text = `OK, ${dateDisplay} at ${TimeManager.formatForDisplay(merged.time)} for ${merged.people} people, name ${merged.name}. Would you like to provide an email for confirmation?`;
        } else {
          response.reply_text = `OK, ${dateDisplay} alle ${TimeManager.formatForDisplay(merged.time)} per ${merged.people} persone a nome ${merged.name}. Vuoi lasciare un'email per la conferma?`;
        }
        response.action = "ask_email";
      }
      
      console.log(`📝 FIX v3.9.11: Nuova reply: "${response.reply_text}"`);
      delete response._dateWasCorrected;
      delete response._correctedDateMessage;
    }
    
    const emailRefusalPatterns = /\b(no thanks|no thank you|no grazie|no email|non ho email|niente email|skip|don'?t have|not necessary|call me|chiamami|chiamatemi)\b/i;
    
    if (response.action === "ask_email" && emailRefusalPatterns.test(userText)) {
      const hasAllEssentials = reservation.date && reservation.time && reservation.people && reservation.name;
      
      if (hasAllEssentials) {
        console.log(`⚠️ FIX v3.9.18: Cliente rifiuta email ma abbiamo tutti i dati → create_reservation`);
        response.action = "create_reservation";
        
        const dateDisplay = DateManager.formatForDisplay(reservation.date, lang);
        const timeDisplay = TimeManager.formatForDisplay(reservation.time);
        const firstName = reservation.name.split(' ')[0];
        
        if (lang === "en-US") {
          response.reply_text = `Your reservation for ${reservation.people} people on ${dateDisplay} at ${timeDisplay} is confirmed, ${firstName}. See you soon!`;
        } else {
          response.reply_text = `Prenotazione confermata per ${reservation.people} persone ${dateDisplay} alle ${timeDisplay}, ${firstName}. A presto!`;
        }
        console.log(`⚠️ FIX v3.9.18: Nuova reply: "${response.reply_text}"`);
      }
    }
    
    console.log("✅ ValidationPipeline completato");
    return response;
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 15: GPT SERVICE (FIX v3.9.21 BUG-003/004 - Soglia gruppi)
// 🆕 v3.9.31: Usa orari/chiusure dinamici dal config del ristorante
// ═══════════════════════════════════════════════════════════════════════════════

const GPTService = {
  buildSystemPrompt(context, reservation, callId, lang = "it-IT") {
    const restaurantName = context?.restaurant?.name || CONFIG.DEFAULT_RESTAURANT_NAME;
    const restaurantEmail = context?.restaurant?.email || CONFIG.OWNER_EMAIL_DEFAULT;
    const openingHours = context?.restaurant?.openingHoursText || "";
    const menuSummary = context?.menu?.summaryText || "";
    
    // 🆕 v3.9.31: Usa thresholds dal config del ristorante
    const thresholds = ConfigHelper.getThresholds(callId);
    const largeGroupThreshold = thresholds.largeGroup;
    
    // 🆕 v3.9.31: Usa receptionist name dal config del ristorante
    const receptionistName = ConfigHelper.getReceptionistName(callId);
    
    // 🆕 v3.9.31: buildCalendar usa closed_days dinamici
    const calendar = DateManager.buildCalendar(10, callId);
    const calendarText = calendar.map(d => {
      let label = d.label ? ` (${d.label})` : "";
      if (d.isClosed) label += " ⛔ CHIUSO";
      return `  ${d.dayName}: ${d.date}${label}`;
    }).join('\n');
    
    const now = DateManager.getNow();
    const todayISO = DateManager.toISO(now);
    
    // 🆕 v3.9.31: Usa orari e chiusure dinamici
    const closuresText = ConfigHelper.buildClosuresText(callId, lang);
    const openingHoursText = ConfigHelper.buildOpeningHoursText(callId);
    
    let stateText = "";
    if (reservation && (reservation.date || reservation.time || reservation.people || reservation.name)) {
      stateText = `
DATI GIÀ RACCOLTI:
${reservation.date ? `- Data: ${reservation.date}` : ""}
${reservation.time ? `- Ora: ${reservation.time}` : ""}
${reservation.people ? `- Persone: ${reservation.people}` : ""}
${reservation.name ? `- Nome: ${reservation.name}` : ""}
${reservation.customerEmail ? `- Email: ${reservation.customerEmail}` : ""}

Se l'utente conferma, usa action="create_reservation" con questi dati!`;
    }

    const langInstruction = lang === "en-US"
      ? `⚠️ LANGUAGE: This conversation is in ENGLISH. You MUST reply ONLY in English!`
      : `⚠️ LINGUA: Questa conversazione è in ITALIANO. Rispondi SOLO in italiano!`;

    return `Sei ${receptionistName}, receptionist di ${restaurantName}.

${langInstruction}

OGGI: ${DateManager.DAYS_IT[now.getDay()]} ${now.getDate()} ${DateManager.MONTHS_IT[now.getMonth()]} ${now.getFullYear()} (${todayISO})

CALENDARIO:
${calendarText}

CHIUSURE:
- ${closuresText}
- NON inventare altre chiusure (festività, ecc.)

${stateText}

STILE:
- Frasi brevi (5-7 secondi)
- Professionale ma amichevole
- Una domanda alla volta

OBIETTIVO: Raccogliere giorno, orario, persone, nome (email opzionale)

ORDINE DOMANDE:
1. Giorno (se non specificato) - NON assumere "oggi"
2. Orario
3. Persone
4. Nome
5. Email (opzionale, DOPO il nome)

⚠️ REGOLA CRITICA - NON INVENTARE:
- NON inventare informazioni su accessibilità, parcheggio, servizi speciali
- Se il cliente chiede info che non conosci (es. "siete accessibili?", "avete parcheggio?"), rispondi: "${lang === "en-US" ? "I don't have that information, I recommend contacting the restaurant directly" : "Non ho questa informazione, ti consiglio di contattare direttamente il ristorante"}"
- Puoi comunque procedere con la prenotazione dopo

🆕 NOTE CLIENTE (allergie, richieste speciali, occasioni):
- Se il cliente menziona: allergie, intolleranze, celiaco, vegetariano, vegano, seggiolone, bambini, sedia a rotelle, anniversario, compleanno, occasione speciale, tavolo romantico, finestra, esterno, interno
- REGISTRA nel campo "notes" della reservation
- CONFERMA che hai preso nota (es. "Ho annotato che sei celiaca")
- Includi la nota nella conferma finale

IMPORTANTE GRUPPI: Solo per ${largeGroupThreshold + 1} o più persone dire "prenotazione soggetta a conferma del ristoratore".
Per gruppi fino a ${largeGroupThreshold} persone: prenotazione NORMALE, NON dire "soggetta a conferma".

ORARI: "alle 8" senza specificare = 20:00 (sera)
ORARI APERTURA: ${openingHoursText}
${openingHours ? `INFO AGGIUNTIVE: ${openingHours}` : ""}
MENU: ${menuSummary || "Cucina italiana"}
EMAIL RISTORANTE: ${restaurantEmail}

FORMATO RISPOSTA (SOLO JSON):
{
  "reply_text": "frase da dire",
  "action": "none|ask_date|ask_time|ask_people|ask_name|ask_email|answer_menu|answer_generic|create_reservation",
  "reservation": {
    "date": "YYYY-MM-DD o null",
    "time": "HH:MM:SS o null",
    "people": numero o null,
    "name": "nome o null",
    "customerEmail": "email o null",
    "notes": "note cliente (allergie, richieste, occasioni) o null"
  }
}

REGOLE ACTION:
- create_reservation: SOLO con date + time + name
- ask_*: per dati mancanti
- answer_*: domande informative (reservation tutto null)

RISPOSTA FINALE: conferma e "Ti aspettiamo, buona serata."`;
  },

  async ask(callId, userText, lang = "it-IT") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY non impostata");
    
    await ContextService.ensureForCall(callId);
    const context = StateManager.getContext(callId);
    const reservation = StateManager.getReservation(callId);
    
    let convo = StateManager.getConversation(callId);
    const systemPrompt = this.buildSystemPrompt(context, reservation, callId, lang);
    console.log(`🌍 GPT system prompt con lingua: ${lang}`);
    
    if (!convo) {
      convo = { messages: [{ role: "system", content: systemPrompt }] };
    } else {
      convo.messages[0] = { role: "system", content: systemPrompt };
    }
    
    convo.messages.push({ role: "user", content: userText });
    
    if (convo.messages.length > 12) {
      const systemMsg = convo.messages[0];
      const recent = convo.messages.slice(-10);
      convo.messages = [systemMsg, ...recent];
    }
    
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: CONFIG.GPT_MODEL,
        messages: convo.messages,
        max_completion_tokens: CONFIG.GPT_MAX_TOKENS,
        temperature: CONFIG.GPT_TEMPERATURE,
        response_format: { type: "json_object" },
      }),
    });
    
    if (!response.ok) {
      const err = await response.text();
      console.error("❌ GPT error:", response.status, err);
      throw new Error(`GPT API error: ${response.status}`);
    }
    
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";
    console.log("🧠 GPT:", content.substring(0, 150));
    
    let parsed = this.parseResponse(content);
    
    convo.messages.push({ role: "assistant", content });
    StateManager.setConversation(callId, convo);
    
    parsed = await ValidationPipeline.validate(parsed, userText, callId);
    
    return parsed;
  },
  
  parseResponse(raw) {
    const fallback = {
      reply_text: "Scusa, puoi ripetere?",
      action: "none",
      reservation: { date: null, time: null, people: null, name: null, customerEmail: null },
    };
    
    if (!raw) return fallback;
    
    try {
      const jsonMatch = raw.match(/{[\s\S]*}/);
      const jsonStr = jsonMatch ? jsonMatch[0] : raw;
      const parsed = JSON.parse(jsonStr);
      
      if (!parsed || typeof parsed !== "object") return fallback;
      if (!parsed.reply_text) parsed.reply_text = fallback.reply_text;
      if (!parsed.action) parsed.action = "none";
      if (!parsed.reservation) parsed.reservation = fallback.reservation;
      
      if (parsed.reservation.customer_email && !parsed.reservation.customerEmail) {
        parsed.reservation.customerEmail = parsed.reservation.customer_email;
      }
      if (parsed.reservation.customerEmail) {
        parsed.reservation.customerEmail = sanitizeEmail(parsed.reservation.customerEmail);
      }
      
      return parsed;
    } catch (e) {
      console.error("❌ JSON parse error:", e);
      return fallback;
    }
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 16: TWILIO HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

const TwilioHelpers = {
  detectLanguageSwitch(text) {
    const t = (text || "").toLowerCase();
    if (t.includes("speak english") || t.includes("in english")) return "en-US";
    if (t.includes("parla italiano") || t.includes("in italiano")) return "it-IT";
    return null;
  },
  
  detectLanguageFromContent(text) {
    const t = (text || "").toLowerCase();
    
    const englishPatterns = [
      /^hi\b|^hello\b|^hey\b/,
      /\b(hi|hello|hey)\b.*\b(like|want|need)\b/,
      /\bplease\b|\bthank you\b|\bthanks\b/,
      /\bi('d| would| want| need| have| am)\b/,
      /\bwe (need|want|are|have)\b/,
      /\b(can|could|may|would) (i|we|you)\b/,
      /\b(book|booking|reservation)\b/,
      /\btable\b/,
      /\bfor (dinner|lunch|breakfast)\b/,
      /\bat (dinner|lunch|breakfast)\b/,
      /\b(tonight|tomorrow|today)\b/,
      /\bday after tomorrow\b/,
      /\b(this|next) (week|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/,
      /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/,
      /\b\d{1,2}\s*(pm|am)\b/,
      /\bat \d{1,2}(:\d{2})?\b/,
      /\bfor \d+ (people|persons|guests)\b/,
      /\b\d+ (people|persons|guests)\b/,
      /\bparty of \d+\b/,
      /\b(the name is|my name is|name is|under the name|under)\b/,
      /\bdo you have\b|\bis there\b|\bare there\b/,
      /\bwhat time\b|\bwhat day\b/,
      /\b(cancel|change|modify|reschedule)\b/,
      /\bi need to\b|\bi want to\b|\bi have to\b/,
    ];
    
    for (const pattern of englishPatterns) {
      if (pattern.test(t)) {
        console.log(`🌍 Lingua rilevata: en-US (pattern: ${pattern})`);
        return "en-US";
      }
    }
    
    return null;
  },
  
  isAskingRestaurantEmail(text) {
    const t = (text || "").toLowerCase();
    if (t.includes("mia mail") || t.includes("my email")) return false;
    return (
      t.includes("mail del ristorante") || t.includes("email del ristorante") ||
      t.includes("vostra mail") || t.includes("vostra email") ||
      t.includes("restaurant email") || t.includes("your email")
    );
  },
  
  spellEmail(email, lang = "it-IT") {
    if (!email) return "";
    const [local, domain] = email.split("@");
    if (!local || !domain) return email;
    
    const [domainName, ...tld] = domain.split(".");
    const commonDomains = ["gmail", "outlook", "hotmail", "yahoo", "icloud"];
    
    const localSpelled = lang === "en-US"
      ? local.split("").join(" ")
      : local.split("").map(c => c === "w" ? "doppia vù" : c).join(" ");
    
    const domainSpoken = commonDomains.includes(domainName.toLowerCase())
      ? domainName : domainName.split("").join(" ");
    
    const tldSpoken = tld.join(".");
    
    return lang === "en-US"
      ? `${localSpelled} at ${domainSpoken} dot ${tldSpoken}`
      : `${localSpelled} chiocciola ${domainSpoken} punto ${tldSpoken}`;
  },
  
  isThanksOnly(text) {
    const t = (text || "").toLowerCase();
    return /grazie|thank you|thanks/.test(t) && !/cambia|change|sposta|modifica/.test(t);
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 17: EXPRESS MIDDLEWARE
// ═══════════════════════════════════════════════════════════════════════════════

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 18: ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

app.get("/", (req, res) => {
  res.status(200).send("✅ Prenow Gateway v3.9.21 attivo!");
});

app.post("/calendar", async (req, res) => {
  try {
    console.log("📩 /calendar:", req.body);
    const result = await CalendarService.createReservation(req.body);
    res.status(200).json({ success: true, fromAppsScript: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTE PRINCIPALE: /twilio (v3 con State Machine)
// ═══════════════════════════════════════════════════════════════════════════════

app.post("/twilio", async (req, res) => {
  const { CallSid, SpeechResult, text, From, To, Language } = req.body || {};
  const { postFinal } = req.query || {};
  
  const isDebug = !!text && !SpeechResult;
  const callId = CallSid || (isDebug ? `debug-${Date.now()}` : `unknown-${Date.now()}`);
  const userText = (SpeechResult || text || "").trim();
  
  console.log(`\n📞 /twilio [${isDebug ? 'DEBUG' : 'VOICE'}] callId=${callId}`);
  console.log(`   From: ${From}, To: ${To}`);
  console.log(`   Text: "${userText.substring(0, 80)}"`);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // BENVENUTO (nessun testo)
  // ═══════════════════════════════════════════════════════════════════════════
  if (!userText && !isDebug) {
    StateManager.setLanguage(callId, "it-IT");
    if (To) await Registry.getConfigForCall(callId, To);
    await ContextService.ensureForCall(callId);
    const restaurantName = ContextService.getRestaurantName(callId);
    
    const welcomeText = `Ciao, sono ${CONFIG.RECEPTIONIST_NAME} di ${restaurantName}. Come posso aiutarti?`;
    
    const twiml = `
      <Response>
        <Gather input="speech" language="it-IT" action="${CONFIG.BASE_URL}/twilio" method="POST" timeout="5" speechTimeout="auto">
          <Say language="it-IT" bargeIn="true">${escapeXml(welcomeText)}</Say>
        </Gather>
        <Say language="it-IT">Non ho ricevuto risposta. Richiamaci. Grazie.</Say>
      </Response>
    `.trim();
    return res.status(200).type("text/xml").send(twiml);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // POST-FINAL
  // ═══════════════════════════════════════════════════════════════════════════
  if (postFinal === "1" && !isDebug) {
    const lang = StateManager.getLanguage(callId);
    if (TwilioHelpers.isThanksOnly(userText)) {
      StateManager.clearCall(callId);
      const twiml = `
        <Response>
          <Say language="${lang}">${escapeXml(lang === "en-US" ? "Thank you, goodbye." : "Grazie, buona giornata.")}</Say>
          <Hangup/>
        </Response>
      `.trim();
      return res.status(200).type("text/xml").send(twiml);
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // FLUSSO PRINCIPALE
  // ═══════════════════════════════════════════════════════════════════════════
  try {
    if (isDebug && To) await Registry.getConfigForCall(callId, To);
    
    StateManager.appendUserText(callId, userText);
    
    const langSwitch = TwilioHelpers.detectLanguageSwitch(userText);
    if (langSwitch) StateManager.setLanguage(callId, langSwitch);
    if (Language?.startsWith("en")) StateManager.setLanguage(callId, "en-US");
    if (Language?.startsWith("it")) StateManager.setLanguage(callId, "it-IT");
    if (StateManager.getLanguage(callId) === "it-IT") {
      const detectedLang = TwilioHelpers.detectLanguageFromContent(userText);
      if (detectedLang) {
        console.log(`🌍 Lingua rilevata dal contenuto: ${detectedLang}`);
        StateManager.setLanguage(callId, detectedLang);
      }
    }
    const lang = StateManager.getLanguage(callId);
    console.log(`🗣️ Lingua conversazione: ${lang}`);
    
    await ContextService.ensureForCall(callId);
    
    // ═══════════════════════════════════════════════════════════════════════
    // RILEVA INTENT E CERCA PRENOTAZIONE (solo primo messaggio)
    // FIX v3.9.25 E4: Cerca prenotazione anche per intent CREATE
    // ═══════════════════════════════════════════════════════════════════════
    if (!StateManager.getInitialIntent(callId)) {
      const detectedIntent = IntentDetector.detectIntent(userText);
      StateManager.setInitialIntent(callId, detectedIntent);
      
      // FIX v3.9.25 E4: Cerca prenotazione per TUTTI gli intent (non solo cancel/modify)
      // 🆕 FIX F9: Usa findAllReservations per gestire multi-prenotazioni
      if (From) {
        try {
          const allRes = await CalendarService.findAllReservations(From, callId);
          if (allRes.found && allRes.count > 0) {
            // Salva la prima prenotazione per retrocompatibilità
            StateManager.setExistingReservation(callId, allRes.reservation);
            
            // 🆕 FIX F9: Salva TUTTE le prenotazioni
            if (allRes.count > 1) {
              StateManager.setAllReservations(callId, allRes.reservations);
              console.log(`📋 FIX F9: Cliente ha ${allRes.count} prenotazioni`);
            }
            
            if (detectedIntent === 'cancel' || detectedIntent === 'modify') {
              // 🆕 FIX F9: Se più prenotazioni, chiedi quale
              if (allRes.count > 1) {
                StateManager.setPhase(callId, 'awaiting_which_reservation');
              } else {
                StateManager.setPhase(callId, 'awaiting_name');
              }
            }
            // Per intent CREATE, lascia phase=initial, gestiremo dopo
          }
        } catch (err) {
          console.log(`⚠️ Errore ricerca:`, err.message);
        }
      }
    }
    
    const initialIntent = StateManager.getInitialIntent(callId);
    const existingRes = StateManager.getExistingReservation(callId);
    const phase = StateManager.getPhase(callId);
    
    // ═══════════════════════════════════════════════════════════════════════
    // FIX v3.9.25 E4: PROATTIVITÀ - Intent CREATE ma cliente ha già prenotazione
    // FIX v3.9.27 ZF9B: Skip se cliente dice esplicitamente "altra/nuova prenotazione"
    //                   Salva flag per TUTTI i turn successivi
    // ═══════════════════════════════════════════════════════════════════════
    
    // FIX v3.9.27 ZF9B: Controlla pattern "altra/nuova prenotazione" nel messaggio corrente
    const wantsExplicitlyNew = /\b(altra|nuova|second\w*|aggiung\w*)\s+(prenotazion|reservation)/i.test(userText) ||
                               /\bvorrei\s+(anche\s+)?(fare|prenotare|aggiungere)/i.test(userText);
    if (wantsExplicitlyNew) {
      StateManager.setWantsNewReservation(callId, true);
    }
    
    // FIX v3.9.27 ZF9B: Se flag è già settato, skip proattività E4
    const hasWantsNewFlag = StateManager.getWantsNewReservation(callId);
    
    if (initialIntent === 'create' && existingRes && phase === 'initial') {
      if (hasWantsNewFlag) {
        console.log(`[INFO] FIX v3.9.27 ZF9B: Flag wantsNewReservation attivo, skip proattività`);
        // Non facciamo nulla qui, il flusso continuerà normalmente verso GPT per CREATE
      } else {
        console.log(`[INFO] FIX v3.9.25 E4: Intent CREATE ma cliente ha prenotazione esistente`);
      
      const dateDisplay = DateManager.formatForDisplay(existingRes.date, lang);
      const timeDisplay = TimeManager.formatForDisplay(existingRes.time);
      
      const replyText = lang === "en-US"
        ? `I see you already have a reservation for ${existingRes.people} people on ${dateDisplay} at ${timeDisplay}. Would you like to modify that reservation, or make a new one?`
        : `Vedo che hai già una prenotazione per ${existingRes.people} persone ${dateDisplay} alle ${timeDisplay}. Vuoi modificare quella prenotazione, o farne una nuova?`;
      
      StateManager.setPhase(callId, 'awaiting_create_or_modify');
      
      if (isDebug) {
        return res.status(200).json({ reply_text: replyText, action: "ask_create_or_modify", reservation: existingRes });
      }
      const twiml = `
        <Response>
          <Gather input="speech" language="${lang}" action="${CONFIG.BASE_URL}/twilio" method="POST" timeout="5" speechTimeout="auto">
            <Say language="${lang}" bargeIn="true">${escapeXml(replyText)}</Say>
          </Gather>
        </Response>
      `.trim();
      return res.status(200).type("text/xml").send(twiml);
      } // Fine else di FIX v3.9.27 ZF9B
    }
    
    // FIX v3.9.25 E4: Gestione risposta a "modificare o nuova?"
    if (phase === 'awaiting_create_or_modify') {
      const wantsModify = /modific|cambi|spostar|quella|esistente|modify|change|that one|existing/i.test(userText);
      const wantsNew = /nuov|altra|second|new|another|different/i.test(userText);
      
      if (wantsModify) {
        console.log(`[INFO] FIX v3.9.25 E4: Cliente vuole modificare`);
        // FIX v3.9.27 E4: Usa forceInitialIntent per sovrascrivere intent "create"
        StateManager.forceInitialIntent(callId, 'modify');
        
        // FIX v3.9.26 E4-FLUSSO: Verifica se il nome è già stato detto nella risposta
        const saidName = RecapManager.extractName(userText);
        const nameMatches = saidName && existingRes?.name && 
          RecapManager.nameMatches(userText, existingRes.name);
        
        if (nameMatches) {
          console.log(`[INFO] FIX v3.9.26 E4-FLUSSO: Nome "${saidName}" corrisponde, skip verifica nome`);
          StateManager.setPhase(callId, 'awaiting_modify_details');
          
          const firstName = existingRes.name?.split(' ')[0] || existingRes.name;
          const replyText = RecapManager.buildAskWhatToModify(existingRes, lang);
          
          if (isDebug) {
            return res.status(200).json({ reply_text: replyText, action: "ask_modify_details", reservation: existingRes });
          }
          const twiml = `
            <Response>
              <Gather input="speech" language="${lang}" action="${CONFIG.BASE_URL}/twilio" method="POST" timeout="5" speechTimeout="auto">
                <Say language="${lang}" bargeIn="true">${escapeXml(replyText)}</Say>
              </Gather>
            </Response>
          `.trim();
          return res.status(200).type("text/xml").send(twiml);
        }
        
        // Nome non verificato, chiedi conferma nome
        StateManager.setPhase(callId, 'awaiting_name');
        
        const replyText = RecapManager.buildAskNameMessage(lang);
        
        if (isDebug) {
          return res.status(200).json({ reply_text: replyText, action: "verify_name", reservation: existingRes });
        }
        const twiml = `
          <Response>
            <Gather input="speech" language="${lang}" action="${CONFIG.BASE_URL}/twilio" method="POST" timeout="5" speechTimeout="auto">
              <Say language="${lang}" bargeIn="true">${escapeXml(replyText)}</Say>
            </Gather>
          </Response>
        `.trim();
        return res.status(200).type("text/xml").send(twiml);
      }
      else if (wantsNew) {
        console.log(`[INFO] FIX v3.9.25 E4: Cliente vuole nuova prenotazione`);
        // FIX v3.9.27 ZF9B: Salva flag per tutti i turn successivi
        StateManager.setWantsNewReservation(callId, true);
        // Resetta lo stato per procedere con nuova prenotazione
        StateManager.clearExistingReservation(callId);
        StateManager.setPhase(callId, 'initial');
        // Continua con il flusso CREATE normale (va a GPT)
      }
      else {
        // Non chiaro, richiedi
        const replyText = lang === "en-US"
          ? "Would you like to modify your existing reservation, or make a completely new one?"
          : "Vuoi modificare la prenotazione esistente, oppure farne una completamente nuova?";
        
        if (isDebug) {
          return res.status(200).json({ reply_text: replyText, action: "ask_create_or_modify", reservation: existingRes });
        }
        const twiml = `
          <Response>
            <Gather input="speech" language="${lang}" action="${CONFIG.BASE_URL}/twilio" method="POST" timeout="5" speechTimeout="auto">
              <Say language="${lang}" bargeIn="true">${escapeXml(replyText)}</Say>
            </Gather>
          </Response>
        `.trim();
        return res.status(200).type("text/xml").send(twiml);
      }
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // SHORTCUT: Email ristorante
    // ═══════════════════════════════════════════════════════════════════════
    if (TwilioHelpers.isAskingRestaurantEmail(userText)) {
      const email = ContextService.getRestaurantEmail(callId);
      const spelled = TwilioHelpers.spellEmail(email, lang);
      const reply = lang === "en-US"
        ? `The restaurant email is ${email}. Spelled: ${spelled}.`
        : `L'email del ristorante è ${email}. Te la detto: ${spelled}.`;
      
      if (isDebug) {
        return res.status(200).json({ reply_text: reply, action: "answer_generic", reservation: null });
      }
      const twiml = `
        <Response>
          <Gather input="speech" language="${lang}" action="${CONFIG.BASE_URL}/twilio" method="POST" timeout="5" speechTimeout="auto">
            <Say language="${lang}" bargeIn="true">${escapeXml(reply)}</Say>
          </Gather>
        </Response>
      `.trim();
      return res.status(200).type("text/xml").send(twiml);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // FIX v3.5: CANCEL/MODIFY senza prenotazione trovata
    // ═══════════════════════════════════════════════════════════════════════
    if ((initialIntent === 'cancel' || initialIntent === 'modify') && !existingRes && phase === 'initial') {
      console.log(`⚠️ Intent ${initialIntent} ma nessuna prenotazione trovata per ${From}`);
      
      const replyText = lang === "en-US"
        ? "I'm sorry, I couldn't find a reservation under your phone number. Could you please provide the name on the reservation, or would you like to make a new booking?"
        : "Mi dispiace, non ho trovato prenotazioni con questo numero di telefono. Puoi dirmi il nome della prenotazione, oppure vuoi fare una nuova prenotazione?";
      
      StateManager.setPhase(callId, 'no_reservation_found');
      
      if (isDebug) {
        return res.status(200).json({ reply_text: replyText, action: "none", reservation: null });
      }
      const twiml = `
        <Response>
          <Gather input="speech" language="${lang}" action="${CONFIG.BASE_URL}/twilio" method="POST" timeout="5" speechTimeout="auto">
            <Say language="${lang}" bargeIn="true">${escapeXml(replyText)}</Say>
          </Gather>
        </Response>
      `.trim();
      return res.status(200).type("text/xml").send(twiml);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // FIX v3.7: Intercetta risposte dopo prenotazione PENDING (gruppi >10)
    // 🆕 FIX v3.9.30 D10: Resta in pending_large_group finché cliente non chiude
    // ═══════════════════════════════════════════════════════════════════════
    if (phase === 'pending_large_group') {
      console.log(`📍 Fase pending_large_group: cliente ha risposto dopo prenotazione PENDING`);
      
      // Riconosci se il cliente vuole chiudere la conversazione
      const wantsToClose = /\b(ok|va bene|capito|grazie|thanks|got it|understood|perfetto|d'accordo|ciao|arrivederci|goodbye|bye)\b/i.test(userText);
      
      // Riconosci se il cliente chiede conferma immediata o insiste
      const wantsImmediateConfirm = /\b(conferma|confermata|sicur|adesso|subito|ora|confirm|sure|now|immediately)\b/i.test(userText);
      
      let replyText;
      
      if (wantsToClose && !wantsImmediateConfirm) {
        // Cliente accetta e chiude
        console.log(`📍 FIX v3.9.30 D10: Cliente accetta prenotazione PENDING, chiudo conversazione`);
        replyText = lang === "en-US"
          ? "Perfect! Your request has been registered. The restaurant will contact you soon to confirm. Have a great day!"
          : "Perfetto! La tua richiesta è stata registrata. Il ristorante ti contatterà presto per confermare. Buona giornata!";
        
        StateManager.setPhase(callId, 'completed');
      } else {
        // Cliente insiste o chiede conferma immediata
        console.log(`📍 FIX v3.9.30 D10: Cliente insiste, ribadisco che è in attesa di conferma`);
        replyText = lang === "en-US"
          ? "I understand, but for groups over 10 people the reservation must be confirmed by the restaurant. They will contact you shortly at this number or by email. Is there anything else I can help you with?"
          : "Capisco, ma per gruppi superiori a 10 persone la prenotazione deve essere confermata dal ristorante. Ti contatteranno a breve a questo numero o via email. Posso aiutarti con altro?";
        
        // 🆕 Resta in pending_large_group, NON passare a completed
        // così il prossimo messaggio sarà ancora gestito qui
      }
      
      if (isDebug) {
        return res.status(200).json({ reply_text: replyText, action: "none", reservation: null, phase: StateManager.getPhase(callId) });
      }
      const twiml = `
        <Response>
          <Gather input="speech" language="${lang}" action="${CONFIG.BASE_URL}/twilio" method="POST" timeout="5" speechTimeout="auto">
            <Say language="${lang}" bargeIn="true">${escapeXml(replyText)}</Say>
          </Gather>
        </Response>
      `.trim();
      return res.status(200).type("text/xml").send(twiml);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // FIX v3.9.26 F4-UX: Riconosce chiusura conversazione quando nessuna prenotazione
    // FIX v3.9.27 F4-UX: Gestisce anche confusione/sorpresa del cliente
    // ═══════════════════════════════════════════════════════════════════════
    if (phase === 'no_reservation_found') {
      const wantsToClose = /\b(va bene grazie|ok grazie|grazie lo stesso|thanks anyway|never\s*mind|that's ok|no worries)\b/i.test(userText);
      
      // FIX v3.9.27 F4-UX: Rileva confusione/sorpresa ("ma come?", "ero sicuro", "impossibile")
      const isConfused = /\b(ma come|ero sicur|impossibile|strano|how come|i'm sure|that's strange|impossible)\b/i.test(userText);
      
      if (wantsToClose) {
        console.log(`📋 FIX v3.9.26 F4-UX: Cliente chiude conversazione senza prenotazione`);
        
        const replyText = lang === "en-US"
          ? "No problem! If you need anything else, feel free to call back. Have a great day!"
          : "Nessun problema! Se hai bisogno di altro, richiamaci pure. Buona giornata!";
        
        StateManager.setPhase(callId, 'completed');
        
        if (isDebug) {
          return res.status(200).json({ reply_text: replyText, action: "none", reservation: null });
        }
        const twiml = `
          <Response>
            <Say language="${lang}">${escapeXml(replyText)}</Say>
            <Hangup/>
          </Response>
        `.trim();
        return res.status(200).type("text/xml").send(twiml);
      }
      
      if (isConfused) {
        console.log(`📋 FIX v3.9.27 F4-UX: Cliente confuso, suggerisco alternative`);
        
        const replyText = lang === "en-US"
          ? "I'm sorry, I really can't find any reservation with this phone number. Maybe it was booked with a different number? Or would you like to make a new reservation?"
          : "Mi dispiace, non trovo davvero prenotazioni con questo numero. Forse è stata fatta con un altro numero? Oppure vuoi fare una nuova prenotazione?";
        
        // Resta in fase no_reservation_found per gestire la risposta
        
        if (isDebug) {
          return res.status(200).json({ reply_text: replyText, action: "offer_alternatives", reservation: null });
        }
        const twiml = `
          <Response>
            <Gather input="speech" language="${lang}" action="${CONFIG.BASE_URL}/twilio" method="POST" timeout="5" speechTimeout="auto">
              <Say language="${lang}" bargeIn="true">${escapeXml(replyText)}</Say>
            </Gather>
          </Response>
        `.trim();
        return res.status(200).type("text/xml").send(twiml);
      }
      // Se non vuole chiudere e non è confuso, continua con GPT
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // v3.2: FLUSSO CON VERIFICA NOME per CANCEL/MODIFY
    // FIX v3.9.21: BUG-001 verifica nome, BUG-010 retry
    // ═══════════════════════════════════════════════════════════════════════
    if (existingRes && (initialIntent === 'cancel' || initialIntent === 'modify')) {
      let replyText = "";
      let action = "none";
      let shouldHangup = false;
      
      // ═══════════════════════════════════════════════════════════════════════
      // FIX v3.9.27 F5-UX: Se cliente dice un nome sbagliato, suggerisci quello corretto
      // ═══════════════════════════════════════════════════════════════════════
      if (phase === 'initial') {
        const saidName = RecapManager.extractName(userText);
        if (saidName && !RecapManager.nameMatches(userText, existingRes.name)) {
          console.log(`📋 FIX v3.9.27 F5-UX: Cliente ha detto "${saidName}" ma prenotazione è "${existingRes.name}"`);
          
          replyText = lang === "en-US"
            ? `I don't find a reservation under "${saidName}", but I see one under "${existingRes.name}". Is that the one?`
            : `Non trovo prenotazioni a nome "${saidName}", ma ne vedo una a nome "${existingRes.name}". È quella?`;
          
          StateManager.setPhase(callId, 'verifying_name');
          
          if (isDebug) {
            return res.status(200).json({ reply_text: replyText, action: "clarify_name", reservation: existingRes });
          }
          const twiml = `
            <Response>
              <Gather input="speech" language="${lang}" action="${CONFIG.BASE_URL}/twilio" method="POST" timeout="5" speechTimeout="auto">
                <Say language="${lang}" bargeIn="true">${escapeXml(replyText)}</Say>
              </Gather>
            </Response>
          `.trim();
          return res.status(200).type("text/xml").send(twiml);
        }
      }
      
      // 🆕 FIX F9: FASE MULTI-PRENOTAZIONE - Chiedi quale prenotazione
      if (phase === 'awaiting_which_reservation') {
        const allRes = StateManager.getAllReservations(callId);
        
        // Prima volta: mostra le prenotazioni e chiedi quale
        if (!StateManager.getAskedWhichReservation(callId)) {
          StateManager.setAskedWhichReservation(callId, true);
          
          // Costruisci messaggio con tutte le prenotazioni
          const resDescriptions = allRes.map((r, i) => {
            const dateDisplay = DateManager.formatForDisplay(r.date, lang);
            const timeDisplay = TimeManager.formatForDisplay(r.time);
            return lang === "en-US"
              ? `${i + 1}) ${r.people} people on ${dateDisplay} at ${timeDisplay}`
              : `${i + 1}) ${r.people} persone ${dateDisplay} alle ${timeDisplay}`;
          }).join("; ");
          
          replyText = lang === "en-US"
            ? `I see you have ${allRes.length} reservations: ${resDescriptions}. Which one would you like to ${initialIntent}?`
            : `Vedo che hai ${allRes.length} prenotazioni: ${resDescriptions}. Quale vuoi ${initialIntent === 'cancel' ? 'cancellare' : 'modificare'}?`;
          
          console.log(`📋 FIX F9: Chiedo quale delle ${allRes.length} prenotazioni`);
        } else {
          // Cliente ha risposto, trova quale prenotazione ha scelto
          const chosen = findChosenReservation(userText, allRes, lang);
          
          if (chosen) {
            console.log(`✅ FIX F9: Cliente ha scelto prenotazione:`, chosen);
            StateManager.setExistingReservation(callId, chosen);
            
            // 🆕 FIX v3.9.29 F9: Skip awaiting_name, procedi direttamente
            // Il cliente ha già identificato quale prenotazione vuole, non serve chiedere nome
            const firstName = chosen.name?.split(' ')[0] || chosen.name || "Cliente";
            const dateDisplay = DateManager.formatForDisplay(chosen.date, lang);
            const timeDisplay = TimeManager.formatForDisplay(chosen.time);
            
            if (initialIntent === 'cancel') {
              // Chiedi conferma cancellazione diretta
              StateManager.setPhase(callId, 'awaiting_cancel_confirm');
              replyText = lang === "en-US"
                ? `Okay ${firstName}, so I'm cancelling your reservation for ${chosen.people} people on ${dateDisplay} at ${timeDisplay}. Do you confirm?`
                : `Ok ${firstName}, cancello la prenotazione per ${chosen.people} persone ${dateDisplay} alle ${timeDisplay}. Confermi?`;
              console.log(`🆕 FIX v3.9.29 F9: Skip verifica nome, chiedo conferma cancellazione`);
            } else {
              // Chiedi cosa vuole modificare
              StateManager.setPhase(callId, 'awaiting_modify_details');
              replyText = lang === "en-US"
                ? `Okay ${firstName}, what would you like to change about your reservation for ${dateDisplay} at ${timeDisplay}?`
                : `Ok ${firstName}, cosa vuoi modificare della prenotazione ${dateDisplay} alle ${timeDisplay}?`;
              console.log(`🆕 FIX v3.9.29 F9: Skip verifica nome, chiedo dettagli modifica`);
            }
          } else {
            // Non capito, richiedi
            const resDescriptions = allRes.map((r, i) => {
              const dateDisplay = DateManager.formatForDisplay(r.date, lang);
              return lang === "en-US" ? `${dateDisplay}` : `${dateDisplay}`;
            }).join(", ");
            
            replyText = lang === "en-US"
              ? `Sorry, I didn't understand. You have reservations for: ${resDescriptions}. Which date?`
              : `Scusa, non ho capito. Hai prenotazioni per: ${resDescriptions}. Quale data?`;
          }
        }
      }
      // FASE COMUNE: AWAITING_NAME
      else if (phase === 'awaiting_name') {
        replyText = RecapManager.buildAskNameMessage(lang);
        StateManager.setPhase(callId, 'verifying_name');
        console.log(`📍 Chiedo nome per verifica`);
      }
      else if (phase === 'verifying_name') {
        // FIX v3.9.21 BUG-001: Verifica con risposta completa + retry
        const saidName = RecapManager.extractName(userText);
        console.log(`📍 Nome detto: "${userText}", Estratto: "${saidName}", Atteso: "${existingRes.name}"`);
        
        if (RecapManager.nameMatches(userText, existingRes.name)) {
          console.log(`✅ Nome verificato!`);
          
          if (initialIntent === 'cancel') {
            // FIX v3.9.25 BUG-023: Controlla se il cliente ha già confermato nella stessa frase
            const alsoConfirmed = RecapManager.isConfirmingCancellation(userText);
            if (alsoConfirmed) {
              console.log(`✅ FIX v3.9.25: Cliente ha anche confermato cancellazione nella stessa frase`);
              console.log(`🗑️ Eseguo cancellazione diretta...`);
              const result = await CalendarService.cancelReservation({
                source: isDebug ? "debug" : "twilio",
                name: existingRes.name,
                date: existingRes.date,
                time: existingRes.time,
                phone: From,
              }, callId);
              
              if (result?.success) {
                replyText = RecapManager.buildCancellationDoneMessage(existingRes, lang);
                action = "cancel_reservation";
                shouldHangup = true;
                StateManager.setPhase(callId, 'completed');
              } else {
                replyText = lang === "en-US"
                  ? "I'm sorry, there was a problem. Please contact the restaurant directly."
                  : "Mi dispiace, c'è stato un problema. Contatta direttamente il ristorante.";
              }
            } else {
              replyText = RecapManager.buildCancelRecapMessage(existingRes, lang);
              StateManager.setPhase(callId, 'awaiting_cancel_confirm');
            }
          } else {
            replyText = RecapManager.buildModifyRecapMessage(existingRes, "", lang);
            StateManager.setPhase(callId, 'awaiting_modify_details');
          }
        } else {
          // FIX v3.9.21 BUG-010: Retry
          const retries = StateManager.incrementNameVerificationRetries(callId);
          console.log(`❌ Nome non corrisponde! Tentativo ${retries}/2`);
          
          if (retries >= 2) {
            replyText = RecapManager.buildNameMismatchMessage(saidName || userText, lang, true);
            StateManager.setPhase(callId, 'completed');
          } else {
            replyText = RecapManager.buildNameMismatchMessage(saidName || userText, lang, false);
          }
        }
      }
      
      // CANCELLAZIONE: Conferma esplicita
      else if (initialIntent === 'cancel' && phase === 'awaiting_cancel_confirm') {
        if (RecapManager.isConfirming(userText)) {
          console.log(`🗑️ Eseguo cancellazione...`);
          const result = await CalendarService.cancelReservation({
            source: isDebug ? "debug" : "twilio",
            name: existingRes.name,
            date: existingRes.date,
            time: existingRes.time,
            phone: From,
          }, callId);
          
          if (result?.success) {
            replyText = RecapManager.buildCancellationDoneMessage(existingRes, lang);
            action = "cancel_reservation";
            shouldHangup = true;
            StateManager.setPhase(callId, 'completed');
          } else {
            replyText = lang === "en-US"
              ? "I'm sorry, there was a problem. Please contact the restaurant directly."
              : "Mi dispiace, c'è stato un problema. Contatta direttamente il ristorante.";
          }
          
          if (isDebug) {
            return res.status(200).json({ 
              reply_text: replyText, action, reservation: existingRes, 
              calendarResult: result, phase: StateManager.getPhase(callId) 
            });
          }
        }
        else if (RecapManager.isDenying(userText)) {
          replyText = lang === "en-US"
            ? "No problem, the reservation stays confirmed. Anything else I can help with?"
            : "Nessun problema, la prenotazione resta confermata. Posso aiutarti con altro?";
          StateManager.setPhase(callId, 'completed');
        }
        else {
          replyText = lang === "en-US"
            ? "Do you confirm the cancellation? Say yes or no."
            : "Confermi la cancellazione? Dimmi sì o no.";
        }
      }
      
      // MODIFICA: Raccolta dettagli e conferma
      else if (initialIntent === 'modify') {
        
        if (phase === 'awaiting_modify_details') {
          // FIX v3.9.26 E10-UX: Riconosce "lascia perdere, va bene così" come annullamento
          // FIX v3.9.27: Aggiunto pattern "va bene come"
          const wantsToKeepOriginal = /\b(lascia perdere|lascia stare|va bene cos[iì]|non importa|forget it|never\s*mind|keep it as is|va bene.*come)\b/i.test(userText);
          
          if (wantsToKeepOriginal) {
            console.log(`[INFO] FIX v3.9.26 E10-UX: Cliente vuole mantenere prenotazione originale`);
            const dateDisplay = DateManager.formatForDisplay(existingRes.date, lang);
            const timeDisplay = TimeManager.formatForDisplay(existingRes.time);
            
            replyText = lang === "en-US"
              ? `No problem! Your reservation for ${existingRes.people} people on ${dateDisplay} at ${timeDisplay} stays confirmed. See you then!`
              : `Nessun problema! La tua prenotazione per ${existingRes.people} persone ${dateDisplay} alle ${timeDisplay} resta confermata. A presto!`;
            
            StateManager.setPhase(callId, 'completed');
            shouldHangup = true;
            
            if (isDebug) {
              return res.status(200).json({ reply_text: replyText, action: "keep_reservation", reservation: existingRes });
            }
            const twiml = `
              <Response>
                <Say language="${lang}">${escapeXml(replyText)}</Say>
                <Hangup/>
              </Response>
            `.trim();
            return res.status(200).type("text/xml").send(twiml);
          }
          
          const modification = RecapManager.extractModification(userText, existingRes);
          
          if (modification.newTime || modification.newDate || modification.newPeople) {
            STATE.pendingModifications = STATE.pendingModifications || new Map();
            STATE.pendingModifications.set(callId, modification);
            
            const firstName = existingRes.name?.split(' ')[0] || existingRes.name;
            
            // FIX v3.9.25 E3/E5/E9: Check disponibilità PRIMA di chiedere conferma
            const checkDate = modification.newDate || existingRes.date;
            const checkTime = modification.newTime || existingRes.time;
            const checkPeople = modification.newPeople || existingRes.people;
            
            // FIX v3.9.27 E4: Skip check SOLO se stesso slot E persone diminuiscono o uguali
            const isSameSlot = !modification.newDate && !modification.newTime;
            const isPeopleDecreaseOrSame = modification.newPeople && modification.newPeople <= existingRes.people;
            const canSkipCheck = isSameSlot && isPeopleDecreaseOrSame;
            
            // Prima controlla se il giorno è chiuso
            if (modification.newDate) {
              const closureCheck = await ClosureChecker.isOpen(modification.newDate, callId);
              if (!closureCheck.open) {
                console.log(`⚠️ FIX v3.9.25: Check preventivo MODIFY - giorno chiuso`);
                replyText = ClosureChecker.buildClosedMessage(modification.newDate, closureCheck, lang);
                // Non cambiamo fase, resta in awaiting_modify_details
                
                if (isDebug) {
                  return res.status(200).json({ reply_text: replyText, action: "ask_date", phase: 'awaiting_modify_details' });
                }
                const twiml = `
                  <Response>
                    <Gather input="speech" language="${lang}" action="${CONFIG.BASE_URL}/twilio" method="POST" timeout="5" speechTimeout="auto">
                      <Say language="${lang}" bargeIn="true">${escapeXml(replyText)}</Say>
                    </Gather>
                  </Response>
                `.trim();
                return res.status(200).type("text/xml").send(twiml);
              }
            }
            
            // Poi controlla disponibilità slot
            // FIX v3.9.27 E4: Skip check se stesso slot E persone diminuiscono (no rischio overbooking)
            if (canSkipCheck) {
              console.log(`⏭️ FIX v3.9.27 E4: Skip check - stesso slot, persone ${existingRes.people}→${modification.newPeople} (diminuzione)`);
            } else {
              // 🆕 FIX v3.9.29 E3/E9: Passa existingPeople per escluderli dal conteggio
              // - Stesso giorno: passa sempre existingPeople (slot si sovrappongono o si liberano)
              // - Giorno diverso: non passare (nuovo giorno non ha i tuoi pax)
              const isSameDay = !modification.newDate || modification.newDate === existingRes.date;
              const existingPeopleForCheck = isSameDay ? existingRes.people : 0;
              console.log(`🔍 FIX v3.9.29 E3/E9: Check preventivo MODIFY - ${checkDate} ${checkTime} per ${checkPeople} pax (stesso giorno: ${isSameDay}, esistenti da escludere: ${existingPeopleForCheck})`);
              const availability = await CalendarService.checkAvailability(checkDate, checkTime, checkPeople, callId, existingPeopleForCheck);
              
              if (!availability.available && availability.reason !== "day_closed") {
                console.log(`⚠️ FIX v3.9.25: Check preventivo MODIFY - slot pieno, propongo alternative`);
                const alternatives = await CalendarService.findAlternatives(checkDate, checkTime, checkPeople, callId);
                const isLargeGroup = checkPeople > CONFIG.LARGE_GROUP_THRESHOLD;
                replyText = CalendarService.buildAlternativesMessage(alternatives, lang, isLargeGroup);
                // Non cambiamo fase, resta in awaiting_modify_details
                
                if (isDebug) {
                  return res.status(200).json({ reply_text: replyText, action: "ask_time", phase: 'awaiting_modify_details' });
                }
                const twiml = `
                  <Response>
                    <Gather input="speech" language="${lang}" action="${CONFIG.BASE_URL}/twilio" method="POST" timeout="5" speechTimeout="auto">
                      <Say language="${lang}" bargeIn="true">${escapeXml(replyText)}</Say>
                    </Gather>
                  </Response>
                `.trim();
                return res.status(200).type("text/xml").send(twiml);
              }
            }
            
            console.log(`✅ FIX v3.9.25: Check preventivo MODIFY - disponibile, chiedo conferma`);
            
            // Disponibile! Chiedi conferma
            const modCount = (modification.newTime ? 1 : 0) + (modification.newDate ? 1 : 0) + (modification.newPeople ? 1 : 0);
            
            if (modCount >= 2) {
              let changes = [];
              if (modification.newTime) changes.push(lang === "en-US" ? `${TimeManager.formatForDisplay(modification.newTime)}` : `alle ${TimeManager.formatForDisplay(modification.newTime)}`);
              if (modification.newDate) changes.push(lang === "en-US" ? `${DateManager.formatForDisplay(modification.newDate, lang)}` : `${DateManager.formatForDisplay(modification.newDate, lang)}`);
              if (modification.newPeople) changes.push(lang === "en-US" ? `${modification.newPeople} people` : `${modification.newPeople} persone`);
              
              replyText = lang === "en-US"
                ? `Okay ${firstName}, changing to: ${changes.join(", ")}. Confirm?`
                : `Ok ${firstName}, modifico: ${changes.join(", ")}. Confermi?`;
            }
            else if (modification.newTime) {
              replyText = lang === "en-US"
                ? `Okay ${firstName}, moving to ${TimeManager.formatForDisplay(modification.newTime)}. Confirm?`
                : `Ok ${firstName}, sposto alle ${TimeManager.formatForDisplay(modification.newTime)}. Confermi?`;
            } else if (modification.newDate) {
              replyText = lang === "en-US"
                ? `Okay ${firstName}, moving to ${DateManager.formatForDisplay(modification.newDate, lang)}. Confirm?`
                : `Ok ${firstName}, sposto a ${DateManager.formatForDisplay(modification.newDate, lang)}. Confermi?`;
            } else if (modification.newPeople) {
              replyText = lang === "en-US"
                ? `Okay ${firstName}, changing to ${modification.newPeople} people. Confirm?`
                : `Ok ${firstName}, cambio a ${modification.newPeople} persone. Confermi?`;
            }
            
            StateManager.setPhase(callId, 'awaiting_modify_confirm');
            console.log(`📍 MODIFY: dettagli ricevuti, attendo conferma`);
          }
          else {
            replyText = RecapManager.buildAskWhatToModify(existingRes, lang);
          }
        }
        else if (phase === 'awaiting_modify_confirm') {
          // FIX v3.9.27 E10-UX: Riconosce "lascia perdere" anche in fase conferma
          const wantsToKeepOriginal = /\b(lascia perdere|lascia stare|va bene cos[iì]|non importa|forget it|never\s*mind|keep it as is|va bene.*come)\b/i.test(userText);
          
          if (wantsToKeepOriginal) {
            console.log(`[INFO] FIX v3.9.27 E10-UX: Cliente annulla modifica in corso, mantiene originale`);
            const dateDisplay = DateManager.formatForDisplay(existingRes.date, lang);
            const timeDisplay = TimeManager.formatForDisplay(existingRes.time);
            
            replyText = lang === "en-US"
              ? `No problem! Your reservation for ${existingRes.people} people on ${dateDisplay} at ${timeDisplay} stays confirmed. See you then!`
              : `Nessun problema! La tua prenotazione per ${existingRes.people} persone ${dateDisplay} alle ${timeDisplay} resta confermata. A presto!`;
            
            StateManager.setPhase(callId, 'completed');
            shouldHangup = true;
            
            if (isDebug) {
              return res.status(200).json({ reply_text: replyText, action: "keep_reservation", reservation: existingRes });
            }
            const twiml = `
              <Response>
                <Say language="${lang}">${escapeXml(replyText)}</Say>
                <Hangup/>
              </Response>
            `.trim();
            return res.status(200).type("text/xml").send(twiml);
          }
          
          if (RecapManager.isConfirming(userText)) {
            const pending = STATE.pendingModifications?.get(callId) || {};
            const updatedRes = { ...existingRes };
            
            if (pending.newTime) updatedRes.time = pending.newTime;
            if (pending.newDate) updatedRes.date = pending.newDate;
            if (pending.newPeople) updatedRes.people = pending.newPeople;
            
            if (pending.newDate) {
              const closureCheck = await ClosureChecker.isOpen(pending.newDate, callId);
              if (!closureCheck.open) {
                replyText = ClosureChecker.buildClosedMessage(pending.newDate, closureCheck, lang);
                StateManager.setPhase(callId, 'awaiting_modify_details');
                
                if (isDebug) {
                  return res.status(200).json({ reply_text: replyText, action: "ask_date", phase: 'awaiting_modify_details' });
                }
                const twiml = `
                  <Response>
                    <Gather input="speech" language="${lang}" action="${CONFIG.BASE_URL}/twilio" method="POST" timeout="5" speechTimeout="auto">
                      <Say language="${lang}" bargeIn="true">${escapeXml(replyText)}</Say>
                    </Gather>
                  </Response>
                `.trim();
                return res.status(200).type("text/xml").send(twiml);
              }
            }
            
            console.log(`📝 Eseguo modifica:`, pending);
            const result = await CalendarService.createReservation({
              source: isDebug ? "debug" : "twilio",
              name: updatedRes.name,
              people: updatedRes.people,
              date: updatedRes.date,
              time: updatedRes.time,
              phone: From,
              customerEmail: updatedRes.email || "",
              notes: updatedRes.notes || "",  // 🆕 FIX v3.9.30 J1-J10
            }, callId);
            
            if (result?.success) {
              replyText = RecapManager.buildModificationDoneMessage(updatedRes, lang);
              action = "modify_reservation";
              shouldHangup = true;
              StateManager.setPhase(callId, 'completed');
            } else if (result?.reason === "slot_full") {
              const alternatives = await CalendarService.findAlternatives(
                updatedRes.date, updatedRes.time, updatedRes.people, callId
              );
              const isLargeGroup = updatedRes.people > CONFIG.LARGE_GROUP_THRESHOLD;
              replyText = CalendarService.buildAlternativesMessage(alternatives, lang, isLargeGroup);
              StateManager.setPhase(callId, 'awaiting_modify_details');
            } else {
              replyText = lang === "en-US"
                ? "Sorry, there was a problem. Try a different option?"
                : "Mi dispiace, c'è stato un problema. Prova un'altra opzione?";
              StateManager.setPhase(callId, 'awaiting_modify_details');
            }
            
            if (isDebug) {
              return res.status(200).json({ 
                reply_text: replyText, action, reservation: updatedRes, 
                calendarResult: result, phase: StateManager.getPhase(callId) 
              });
            }
          }
          else if (RecapManager.isDenying(userText)) {
            replyText = RecapManager.buildAskWhatToModify(existingRes, lang);
            StateManager.setPhase(callId, 'awaiting_modify_details');
          }
          else {
            const newMod = RecapManager.extractModification(userText, existingRes);
            if (newMod.newTime || newMod.newDate || newMod.newPeople) {
              STATE.pendingModifications.set(callId, newMod);
              const firstName = existingRes.name?.split(' ')[0] || existingRes.name;
              const modCount = (newMod.newTime ? 1 : 0) + (newMod.newDate ? 1 : 0) + (newMod.newPeople ? 1 : 0);
              
              if (modCount >= 2) {
                let changes = [];
                if (newMod.newTime) changes.push(lang === "en-US" ? `${TimeManager.formatForDisplay(newMod.newTime)}` : `alle ${TimeManager.formatForDisplay(newMod.newTime)}`);
                if (newMod.newDate) changes.push(lang === "en-US" ? `${DateManager.formatForDisplay(newMod.newDate, lang)}` : `${DateManager.formatForDisplay(newMod.newDate, lang)}`);
                if (newMod.newPeople) changes.push(lang === "en-US" ? `${newMod.newPeople} people` : `${newMod.newPeople} persone`);
                
                replyText = lang === "en-US"
                  ? `Okay ${firstName}, changing to: ${changes.join(", ")}. Confirm?`
                  : `Ok ${firstName}, modifico: ${changes.join(", ")}. Confermi?`;
              }
              else if (newMod.newTime) {
                replyText = lang === "en-US"
                  ? `Okay ${firstName}, moving to ${TimeManager.formatForDisplay(newMod.newTime)}. Confirm?`
                  : `Ok ${firstName}, sposto alle ${TimeManager.formatForDisplay(newMod.newTime)}. Confermi?`;
              } else if (newMod.newDate) {
                replyText = lang === "en-US"
                  ? `Okay ${firstName}, moving to ${DateManager.formatForDisplay(newMod.newDate, lang)}. Confirm?`
                  : `Ok ${firstName}, sposto a ${DateManager.formatForDisplay(newMod.newDate, lang)}. Confermi?`;
              } else if (newMod.newPeople) {
                replyText = lang === "en-US"
                  ? `Okay ${firstName}, changing to ${newMod.newPeople} people. Confirm?`
                  : `Ok ${firstName}, cambio a ${newMod.newPeople} persone. Confermi?`;
              }
            } else {
              replyText = lang === "en-US"
                ? "Sorry, I didn't catch that. Do you confirm the change?"
                : "Scusa, non ho capito. Confermi la modifica?";
            }
          }
        }
        else if (phase === 'completed') {
          console.log(`📍 MODIFY completed, passo a GPT`);
        }
      }
      
      if (initialIntent === 'cancel' && phase === 'completed') {
        console.log(`📍 CANCEL completed, passo a GPT`);
      }
      
      if (replyText && phase !== 'completed') {
        if (isDebug) {
          return res.status(200).json({ 
            reply_text: replyText, action, reservation: existingRes, phase: StateManager.getPhase(callId) 
          });
        }
        
        let twiml;
        if (shouldHangup) {
          twiml = `
            <Response>
              <Gather input="speech" language="${lang}" action="${CONFIG.BASE_URL}/twilio?postFinal=1" method="POST" timeout="5" speechTimeout="auto">
                <Say language="${lang}" bargeIn="true">${escapeXml(replyText)}</Say>
              </Gather>
              <Say language="${lang}">${escapeXml(lang === "en-US" ? "Thank you, goodbye." : "Grazie, a presto.")}</Say>
              <Hangup/>
            </Response>
          `.trim();
        } else {
          twiml = `
            <Response>
              <Gather input="speech" language="${lang}" action="${CONFIG.BASE_URL}/twilio" method="POST" timeout="5" speechTimeout="auto">
                <Say language="${lang}" bargeIn="true">${escapeXml(replyText)}</Say>
              </Gather>
              <Say language="${lang}">${escapeXml(lang === "en-US" ? "I didn't hear. Please call back." : "Non ho sentito. Richiamaci.")}</Say>
            </Response>
          `.trim();
        }
        return res.status(200).type("text/xml").send(twiml);
      }
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // FLUSSO GPT NORMALE (nuove prenotazioni o dopo fase completed)
    // ═══════════════════════════════════════════════════════════════════════
    const gptResponse = await GPTService.ask(callId, userText, lang);
    
    let replyText = gptResponse.reply_text;
    let action = gptResponse.action;
    const reservation = gptResponse.reservation;
    
    console.log(`[OUT] GPT: action=${action}, reply="${replyText.substring(0, 60)}..."`);
    
    // ═══════════════════════════════════════════════════════════════════════
    // GESTIONE CREATE_RESERVATION
    // ═══════════════════════════════════════════════════════════════════════
    if (action === "create_reservation" && reservation?.date && reservation?.time && reservation?.name) {
      const thresholds = ContextService.getThresholds(callId);
      const people = reservation.people || 2;
      const isLargeGroup = people > thresholds.largeGroup;
      
      if (people >= thresholds.event) {
        const email = ContextService.getRestaurantEmail(callId);
        replyText = lang === "en-US"
          ? `For groups over ${thresholds.event}, please email ${email}.`
          : `Per gruppi oltre ${thresholds.event} persone, scrivi a ${email}.`;
        action = "none";
      }
      else if (isLargeGroup) {
        // FIX v3.9.24: Skip check se prenotazione già creata (è un update)
        const existingEventId = StateManager.getCreatedEventId(callId);
        if (existingEventId) {
          console.log(`⏭️ FIX v3.9.24: Skip check flusso principale, prenotazione già creata (eventId: ${existingEventId})`);
          // Procedi direttamente con update (non serve rifare check)
          const calResult = await CalendarService.createReservation({
            source: isDebug ? "debug" : "twilio",
            name: reservation.name,
            people,
            date: reservation.date,
            time: reservation.time,
            phone: From || "unknown",
            customerEmail: reservation.customerEmail,
            forceNew: StateManager.getWantsNewReservation(callId),  // 🆕 FIX ZF9B
            notes: StateManager.getReservation(callId).notes || reservation.notes || "",  // 🆕 FIX v3.9.30 J1-J10
          }, callId);
          
          if (calResult?.success) {
            const firstName = reservation.name.split(' ')[0];
            const dateDisplay = DateManager.formatForDisplay(reservation.date, lang);
            const timeDisplay = reservation.time.substring(0, 5);
            replyText = lang === "en-US"
              ? `Updated! Your reservation for ${people} people on ${dateDisplay} at ${timeDisplay} is confirmed, ${firstName}.`
              : `Aggiornato! La prenotazione per ${people} persone ${dateDisplay} alle ${timeDisplay} è confermata, ${firstName}.`;
            if (isDebug) gptResponse.calendarResult = calResult;
          }
        } else {
          const availability = await CalendarService.checkAvailability(
            reservation.date, reservation.time, people, callId
          );
          
          if (!availability.available) {
            if (availability.reason === "day_closed") {
              replyText = lang === "en-US"
                ? "We're closed that day. Would you like another day?"
                : "Quel giorno siamo chiusi. Vuoi provare un altro giorno?";
              action = "ask_date";
            } else {
              const alternatives = await CalendarService.findAlternatives(
                reservation.date, reservation.time, people, callId
              );
              replyText = CalendarService.buildAlternativesMessage(alternatives, lang, isLargeGroup);
              action = "ask_time";
            }
          } else {
            const calResult = await CalendarService.createReservation({
              source: isDebug ? "debug" : "twilio",
              name: reservation.name,
              people,
              date: reservation.date,
              time: reservation.time,
              phone: From || "unknown",
              customerEmail: reservation.customerEmail,
              forceNew: StateManager.getWantsNewReservation(callId),  // 🆕 FIX ZF9B
              notes: StateManager.getReservation(callId).notes || reservation.notes || "",  // 🆕 FIX v3.9.30 J1-J10
            }, callId);
            
            if (calResult?.success) {
              // FIX v3.9.23 BUG-020: Salva eventId per evitare falsi "al completo" su update
              if (calResult.eventId) {
                StateManager.setCreatedEventId(callId, calResult.eventId);
              }
              
              const firstName = reservation.name.split(' ')[0];
              const dateDisplay = DateManager.formatForDisplay(reservation.date, lang);
              const timeDisplay = reservation.time.substring(0, 5);
              replyText = lang === "en-US"
                ? `Thank you ${firstName}! Request registered for ${people} people on ${dateDisplay} at ${timeDisplay}. The restaurant will confirm shortly.`
                : `Grazie ${firstName}! Richiesta registrata per ${people} persone ${dateDisplay} alle ${timeDisplay}. Il ristoratore confermerà a breve.`;
              
              StateManager.setPhase(callId, 'pending_large_group');
              
              if (isDebug) gptResponse.calendarResult = calResult;
            } else {
              replyText = lang === "en-US"
                ? "Sorry, technical problem. Please try again."
                : "Mi dispiace, problema tecnico. Riprova.";
              action = "none";
            }
          }
        }
      }
      else {
        // FIX v3.9.24: Skip check se prenotazione già creata (è un update)
        const existingEventId = StateManager.getCreatedEventId(callId);
        if (existingEventId) {
          console.log(`⏭️ FIX v3.9.24: Skip check flusso normale, prenotazione già creata (eventId: ${existingEventId})`);
          // Procedi direttamente con update
          const calResult = await CalendarService.createReservation({
            source: isDebug ? "debug" : "twilio",
            name: reservation.name,
            people,
            date: reservation.date,
            time: reservation.time,
            phone: From || "unknown",
            customerEmail: reservation.customerEmail,
            forceNew: StateManager.getWantsNewReservation(callId),  // 🆕 FIX ZF9B
            notes: StateManager.getReservation(callId).notes || reservation.notes || "",  // 🆕 FIX v3.9.30 J1-J10
          }, callId);
          
          if (calResult?.success) {
            const firstName = reservation.name.split(' ')[0];
            const dateDisplay = DateManager.formatForDisplay(reservation.date, lang);
            const timeDisplay = reservation.time.substring(0, 5);
            replyText = lang === "en-US"
              ? `Your reservation for ${people} people on ${dateDisplay} at ${timeDisplay} is confirmed, ${firstName}. See you soon!`
              : `La prenotazione per ${people} persone ${dateDisplay} alle ${timeDisplay} è confermata, ${firstName}. Ti aspettiamo!`;
            if (isDebug) gptResponse.calendarResult = calResult;
          }
        } else {
          const availability = await CalendarService.checkAvailability(
            reservation.date, reservation.time, people, callId
          );
          
          if (!availability.available) {
            if (availability.reason === "day_closed") {
              replyText = lang === "en-US"
                ? "We're closed that day. Another day?"
                : "Quel giorno siamo chiusi. Un altro giorno?";
              action = "ask_date";
            } else {
              const alternatives = await CalendarService.findAlternatives(
                reservation.date, reservation.time, people, callId
              );
              replyText = CalendarService.buildAlternativesMessage(alternatives, lang);
              action = "ask_time";
            }
          } else {
            const calResult = await CalendarService.createReservation({
              source: isDebug ? "debug" : "twilio",
              name: reservation.name,
              people,
              date: reservation.date,
              time: reservation.time,
              phone: From || "unknown",
              customerEmail: reservation.customerEmail,
              forceNew: StateManager.getWantsNewReservation(callId),  // 🆕 FIX ZF9B
              notes: StateManager.getReservation(callId).notes || reservation.notes || "",  // 🆕 FIX v3.9.30 J1-J10
            }, callId);
            
            if (calResult?.success) {
              // FIX v3.9.23 BUG-020: Salva eventId per evitare falsi "al completo" su update
              if (calResult.eventId) {
                StateManager.setCreatedEventId(callId, calResult.eventId);
              }
              
              const firstName = reservation.name.split(' ')[0];
              const dateDisplay = DateManager.formatForDisplay(reservation.date, lang);
              const timeDisplay = reservation.time.substring(0, 5);
              replyText = lang === "en-US"
                ? `Your reservation for ${people} people on ${dateDisplay} at ${timeDisplay} is confirmed, ${firstName}. See you soon!`
                : `La prenotazione per ${people} persone ${dateDisplay} alle ${timeDisplay} è confermata, ${firstName}. Ti aspettiamo!`;
              
              if (isDebug) gptResponse.calendarResult = calResult;
            } else if (calResult?.reason === "slot_full") {
              const alternatives = await CalendarService.findAlternatives(
                reservation.date, reservation.time, people, callId
              );
              replyText = CalendarService.buildAlternativesMessage(alternatives, lang);
              action = "ask_time";
            } else {
              replyText = lang === "en-US"
                ? "Sorry, problem occurred. Try another time?"
                : "Mi dispiace, c'è stato un problema. Prova un altro orario?";
              action = "ask_time";
            }
          }
        }
      }
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // RISPOSTA
    // ═══════════════════════════════════════════════════════════════════════
    if (isDebug) {
      return res.status(200).json({
        reply_text: replyText,
        action,
        reservation,
        calendarResult: gptResponse.calendarResult,
      });
    }
    
    const shouldHangup = (
      action === "create_reservation" && !replyText.includes("?")
    );
    
    let twiml;
    if (shouldHangup) {
      twiml = `
        <Response>
          <Gather input="speech" language="${lang}" action="${CONFIG.BASE_URL}/twilio?postFinal=1" method="POST" timeout="5" speechTimeout="auto">
            <Say language="${lang}" bargeIn="true">${escapeXml(replyText)}</Say>
          </Gather>
          <Say language="${lang}">${escapeXml(lang === "en-US" ? "Thank you, goodbye." : "Grazie, a presto.")}</Say>
          <Hangup/>
        </Response>
      `.trim();
    } else {
      twiml = `
        <Response>
          <Gather input="speech" language="${lang}" action="${CONFIG.BASE_URL}/twilio" method="POST" timeout="5" speechTimeout="auto">
            <Say language="${lang}" bargeIn="true">${escapeXml(replyText)}</Say>
          </Gather>
          <Say language="${lang}">${escapeXml(lang === "en-US" ? "I didn't hear. Call back." : "Non ho sentito. Richiamaci.")}</Say>
        </Response>
      `.trim();
    }
    
    return res.status(200).type("text/xml").send(twiml);
    
  } catch (err) {
    console.error("❌ /twilio error:", err);
    
    if (isDebug) {
      return res.status(500).json({ error: err.message });
    }
    
    const errorTwiml = `
      <Response>
        <Say language="it-IT">Errore tecnico. Richiama più tardi.</Say>
        <Hangup/>
      </Response>
    `.trim();
    return res.status(500).type("text/xml").send(errorTwiml);
  }
});


// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 19: ROUTES GRANDI GRUPPI
// ═══════════════════════════════════════════════════════════════════════════════

app.get("/owner/large-group/confirm", async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).send("Token mancante.");
    
    const payload = JSON.parse(Buffer.from(token, "base64").toString("utf8"));
    
    const response = await fetch(CONFIG.APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "confirm_large_group", ...payload }),
    });
    
    const data = await response.json().catch(() => null);
    
    if (data?.success && data?.status === "CONFIRMED") {
      res.send(`
        <html><body style="font-family:system-ui;padding:24px;">
          <h2>✅ Prenotazione confermata</h2>
          <p>${payload.people} persone a nome <strong>${payload.name}</strong>.</p>
        </body></html>
      `);
    } else if (data?.reason === "slot_full") {
      res.send(`
        <html><body style="font-family:system-ui;padding:24px;">
          <h2>❌ Slot pieno</h2>
          <p>Impossibile confermare, slot al completo.</p>
        </body></html>
      `);
    } else {
      res.send(`
        <html><body style="font-family:system-ui;padding:24px;">
          <h2>⚠️ Errore</h2>
          <p>Verifica manualmente il calendario.</p>
        </body></html>
      `);
    }
  } catch (err) {
    console.error("❌ Confirm error:", err);
    res.status(500).send("Errore interno.");
  }
});

app.get("/owner/large-group/cancel", async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).send("Token mancante.");
    
    const payload = JSON.parse(Buffer.from(token, "base64").toString("utf8"));
    
    await fetch(CONFIG.APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "cancel_large_group", ...payload }),
    });
    
    res.send(`
      <html><body style="font-family:system-ui;padding:24px;">
        <h2>❌ Prenotazione annullata</h2>
        <p>Annullata per <strong>${payload.name}</strong> (${payload.people} persone).</p>
      </body></html>
    `);
  } catch (err) {
    console.error("❌ Cancel error:", err);
    res.status(500).send("Errore interno.");
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 20: AVVIO SERVER
// ═══════════════════════════════════════════════════════════════════════════════

app.listen(CONFIG.PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║  🚀 PRENOW GATEWAY v3.9.30 AVVIATO                            ║
║  📍 Porta: ${CONFIG.PORT}                                            ║
║  🌐 URL: ${CONFIG.BASE_URL}                         ║
║  ✨ FIX: D10, I4, J1-J10 (note cliente), J3, J8 (tempo rel.)  ║
╚═══════════════════════════════════════════════════════════════╝
  `);
});
