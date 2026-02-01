// ═══════════════════════════════════════════════════════════════════════════════
// PRENOW - RECEPTIONIST AI GATEWAY v3.9.26
// Architettura pulita con RECAP deterministico per cancel/modify
// 
// FIX v3.9.26 - MINI BUG FIXES:
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
  WEEKLY_CLOSING_DAYS: [1], // Lunedì
  
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
      date: null, time: null, people: null, name: null, customerEmail: null,
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
  
  buildCalendar(days = 14) {
    const now = this.getNow();
    const today = this.startOfDay(now);
    const calendar = [];
    
    for (let i = 0; i <= days; i++) {
      const d = this.addDays(today, i);
      const iso = this.toISO(d);
      const dayOfWeek = d.getDay();
      const isClosed = CONFIG.WEEKLY_CLOSING_DAYS.includes(dayOfWeek);
      
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
  parseFromText(text) {
    if (!text) return null;
    const t = text.toLowerCase().trim();
    
    if (/mezzogiorno|noon/.test(t)) return "12:00:00";
    if (/mezzanotte|midnight/.test(t)) return "00:00:00";
    
    const allTimes = [];
    let match;
    
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
// ═══════════════════════════════════════════════════════════════════════════════

const ClosureChecker = {
  async isOpen(dateISO, callId = null) {
    if (!dateISO) return { open: true, reason: null };
    
    console.log(`🔍 ClosureChecker: ${dateISO}...`);
    
    const dayOfWeek = DateManager.getDayOfWeek(dateISO);
    if (CONFIG.WEEKLY_CLOSING_DAYS.includes(dayOfWeek)) {
      const dayName = DateManager.getDayName(dateISO, "it-IT");
      const dayNameEN = DateManager.getDayName(dateISO, "en-US");
      console.log(`⛔ CHIUSO: ${dayName}`);
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
  
  async checkAvailability(date, time, people, callId = null) {
    if (!date || !time || !people) return { available: true };
    
    const appsScriptUrl = Registry.getAppsScriptUrl(callId);
    console.log(`🔍 Check slot ${date} ${time} per ${people} pax`);
    
    try {
      const response = await fetch(appsScriptUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "check_availability",
          data: date,
          ora: time,
          persone: people,
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
  
  getThresholds(callId) {
    const ctx = StateManager.getContext(callId);
    return {
      largeGroup: ctx?.rules?.largeGroupThreshold || CONFIG.LARGE_GROUP_THRESHOLD,
      event: ctx?.rules?.eventThreshold || CONFIG.EVENT_THRESHOLD,
    };
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
  isValidTime(time, context = null) {
    if (!time) return false;
    const [hourStr, minStr] = time.split(':');
    const hour = parseInt(hourStr);
    const minutes = parseInt(minStr || '0');
    const totalMinutes = hour * 60 + minutes;
    
    const lunchOpen = 12 * 60;
    const lunchClose = 15 * 60;
    const dinnerOpen = 19 * 60;
    const dinnerClose = 22 * 60 + 30;
    
    const isLunch = totalMinutes >= lunchOpen && totalMinutes <= lunchClose;
    const isDinner = totalMinutes >= dinnerOpen && totalMinutes <= dinnerClose;
    const isValid = isLunch || isDinner;
    
    if (!isValid) {
      console.log(`⏰ isValidTime: ${time} (${totalMinutes} min) fuori range pranzo ${lunchOpen}-${lunchClose} E cena ${dinnerOpen}-${dinnerClose}`);
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
      if (gptOriginalDate && gptOriginalDate !== parsedDate) {
        const italianMonths = "gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre";
        const englishMonths = "January|February|March|April|May|June|July|August|September|October|November|December";
        const italianDatePattern = new RegExp(`\\b(\\d{1,2})\\s+(${italianMonths})\\b`, 'gi');
        const englishDatePattern = new RegExp(`\\b(${englishMonths})\\s+(\\d{1,2})\\b`, 'gi');
        
        const correctDateDisplay = DateManager.formatForDisplay(parsedDate, lang);
        
        if (response.reply_text && (italianDatePattern.test(response.reply_text) || englishDatePattern.test(response.reply_text))) {
          let correctedReply = response.reply_text;
          // Reset regex lastIndex
          italianDatePattern.lastIndex = 0;
          englishDatePattern.lastIndex = 0;
          correctedReply = correctedReply.replace(italianDatePattern, correctDateDisplay);
          correctedReply = correctedReply.replace(englishDatePattern, correctDateDisplay);
          
          if (correctedReply !== response.reply_text) {
            console.log(`📝 FIX v3.9.23 BUG-021: Corretto reply_text con data calcolata: "${correctDateDisplay}"`);
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
        
        const italianMonths = "gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre";
        const englishMonths = "January|February|March|April|May|June|July|August|September|October|November|December";
        const italianDatePattern = new RegExp(`\\b(\\d{1,2})\\s+(${italianMonths})\\b`, 'gi');
        const englishDatePattern = new RegExp(`\\b(${englishMonths})\\s+(\\d{1,2})\\b`, 'gi');
        
        const correctDateDisplay = DateManager.formatForDisplay(savedReservation.date, lang);
        
        if (italianDatePattern.test(response.reply_text) || englishDatePattern.test(response.reply_text)) {
          let correctedReply = response.reply_text;
          correctedReply = correctedReply.replace(italianDatePattern, correctDateDisplay);
          correctedReply = correctedReply.replace(englishDatePattern, correctDateDisplay);
          
          if (correctedReply !== response.reply_text) {
            console.log(`📝 FIX v3.9.19: Corretto reply_text con data protetta: "${correctDateDisplay}"`);
            response.reply_text = correctedReply;
          }
        }
      }
      reservation.date = savedReservation.date;
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
    
    if (reservation.time && !this.isValidTime(reservation.time)) {
      const isAskingAboutTime = /\b(ultimo|prima|quale|quali|orari|apertura|chiusura|when|what time|available|hours)\b/i.test(userText);
      
      if (isAskingAboutTime) {
        console.log(`ℹ️ FIX v3.9.3: Orario ${reservation.time} invalido + cliente chiede info → resetto`);
        reservation.time = null;
      } else {
        console.log(`⏰ FIX v3.9.4: Orario ${reservation.time} INVALIDO → forzo ask_time`);
        response.action = "ask_time";
        response.reply_text = lang === "en-US"
          ? "I'm sorry, that time is outside our opening hours. We're open for lunch 12:00-15:00 and dinner 19:00-22:30. What time works for you?"
          : "Mi dispiace, quell'orario è fuori dai nostri orari di apertura. Siamo aperti a pranzo 12:00-15:00 e a cena 19:00-22:30. A che ora preferisci?";
        reservation.time = null;
      }
    }
    else if (response.action === "ask_time" && reservation.time) {
      const isAskingAboutTime = /\b(ultimo|prima|quale|quali|orari|apertura|chiusura|when|what time|available|hours)\b/i.test(userText);
      
      if (isAskingAboutTime) {
        console.log(`ℹ️ FIX v3.9: Cliente chiede info orari, lascio risposta GPT`);
      } else if (this.isValidTime(reservation.time)) {
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
    
    // FIX v3.9.27 ZG-NOME: Se GPT chiede nome ma abbiamo già un nome (da questo turn O da turn precedenti), skip
    const knownName = reservation.name || savedReservation.name;
    if (response.action === "ask_name" && knownName) {
      console.log(`[OUT] FIX v3.9.27 ZG-NOME: Nome "${knownName}" già noto, override ask_name → ask_email`);
      response.action = "ask_email";
      response.reply_text = lang === "en-US"
        ? "Do you have an email for the confirmation? It's optional."
        : "Hai un'email per la conferma? È opzionale.";
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
// ═══════════════════════════════════════════════════════════════════════════════

const GPTService = {
  buildSystemPrompt(context, reservation, callId, lang = "it-IT") {
    const restaurantName = context?.restaurant?.name || CONFIG.DEFAULT_RESTAURANT_NAME;
    const restaurantEmail = context?.restaurant?.email || CONFIG.OWNER_EMAIL_DEFAULT;
    const openingHours = context?.restaurant?.openingHoursText || "";
    const menuSummary = context?.menu?.summaryText || "";
    const largeGroupThreshold = context?.rules?.largeGroupThreshold || CONFIG.LARGE_GROUP_THRESHOLD;
    
    const calendar = DateManager.buildCalendar(10);
    const calendarText = calendar.map(d => {
      let label = d.label ? ` (${d.label})` : "";
      if (d.isClosed) label += " ⛔ CHIUSO";
      return `  ${d.dayName}: ${d.date}${label}`;
    }).join('\n');
    
    const now = DateManager.getNow();
    const todayISO = DateManager.toISO(now);
    
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

    return `Sei ${CONFIG.RECEPTIONIST_NAME}, receptionist di ${restaurantName}.

${langInstruction}

OGGI: ${DateManager.DAYS_IT[now.getDay()]} ${now.getDate()} ${DateManager.MONTHS_IT[now.getMonth()]} ${now.getFullYear()} (${todayISO})

CALENDARIO:
${calendarText}

CHIUSURE:
- LUNEDÌ sempre chiuso (${lang === "en-US" ? "Mondays" : "lunedì"})
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

IMPORTANTE GRUPPI: Solo per 11 o più persone dire "prenotazione soggetta a conferma del ristoratore".
Per gruppi fino a 10 persone: prenotazione NORMALE, NON dire "soggetta a conferma".

ORARI: "alle 8" senza specificare = 20:00 (sera)
ORARI APERTURA: Pranzo 12:00-15:00, Cena 19:00-22:30. Ultima prenotazione alle 22:30.
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
    "customerEmail": "email o null"
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
      if (From) {
        try {
          const existing = await CalendarService.findExistingReservation(From, null, callId);
          if (existing) {
            StateManager.setExistingReservation(callId, existing);
            if (detectedIntent === 'cancel' || detectedIntent === 'modify') {
              StateManager.setPhase(callId, 'awaiting_name');
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
        StateManager.setInitialIntent(callId, 'modify');
        
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
    // ═══════════════════════════════════════════════════════════════════════
    if (phase === 'pending_large_group') {
      console.log(`📍 Fase pending_large_group: cliente ha risposto dopo prenotazione PENDING`);
      
      const replyText = lang === "en-US"
        ? "Your request has been registered. The restaurant will contact you to confirm the reservation. Is there anything else I can help you with?"
        : "La tua richiesta è stata registrata. Il ristorante ti contatterà per confermare la prenotazione. Posso aiutarti con altro?";
      
      StateManager.setPhase(callId, 'completed');
      
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
      
      // FASE COMUNE: AWAITING_NAME
      if (phase === 'awaiting_name') {
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
          const wantsToKeepOriginal = /\b(lascia perdere|lascia stare|va bene cos[iì]|non importa|forget it|never\s*mind|keep it as is)\b/i.test(userText);
          
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
            console.log(`🔍 FIX v3.9.25: Check preventivo MODIFY - ${checkDate} ${checkTime} per ${checkPeople} pax`);
            const availability = await CalendarService.checkAvailability(checkDate, checkTime, checkPeople, callId);
            
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
║  🚀 PRENOW GATEWAY v3.9.25 AVVIATO                            ║
║  📍 Porta: ${CONFIG.PORT}                                            ║
║  🌐 URL: ${CONFIG.BASE_URL}                         ║
║  ✨ FIX: BUG-023, E3-E10, check MODIFY, proattività numero    ║
╚═══════════════════════════════════════════════════════════════╝
  `);
});
