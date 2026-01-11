// ═══════════════════════════════════════════════════════════════════════════════
// PRENOW - RECEPTIONIST AI GATEWAY v3.9.18
// Architettura pulita con RECAP deterministico per cancel/modify
// 
// FIX v3.4-v3.9.14: (vedi versioni precedenti)
//
// FIX v3.9.15:
// - REVERTE FIX v3.9.1: "domenica" quando oggi è domenica → prossima domenica
// - NameManager: aggiunte parole italiane a excludeWords
//
// FIX v3.9.16:
// - SPOSTA correzione "fully booked" DOPO parsing data
//
// FIX v3.9.17:
// - ANTI-ALLUCINAZIONE DATA: Se GPT chiede ask_date ma abbiamo già una data
//   valida salvata, override action al prossimo step logico
//
// FIX v3.9.18:
// - GESTIONE RIFIUTO EMAIL: Se GPT chiede email ma cliente rifiuta ("no grazie",
//   "no thanks") E abbiamo tutti i dati essenziali → forza create_reservation
//   GPT a volte insiste sull'email anche se è opzionale
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
  // FIX P2: Pattern inglesi aggiunti
  CANCEL_KEYWORDS: [
    // Italiano
    'cancellare', 'cancella', 'cancello', 'cancellazione',
    'disdire', 'disdetta', 'disdico',
    'annullare', 'annulla', 'annullo', 'annullamento',
    'eliminare', 'elimina', 'elimino',
    'non vengo', 'non veniamo', 'non riesco', 'non riusciamo',
    // Inglese
    'cancel', 'cancellation', 'delete', 'remove',
    'i need to cancel', 'i want to cancel', 'i have to cancel',
    'cancel my reservation', 'cancel my booking',
  ],
  
  MODIFY_KEYWORDS: [
    // Italiano
    'modificare', 'modifica', 'modifico', 'modifiche',
    'spostare', 'sposta', 'sposto',
    'cambiare', 'cambia', 'cambio',
    'anticipare', 'posticipare',
    'aumentat', 'aggiunger',
    // Inglese
    'change', 'modify', 'move', 'reschedule', 'update',
    'i need to change', 'i want to change', 'i have to change',
    'i need to modify', 'i want to modify',
    'change my reservation', 'change my booking',
  ],
  
  // Keywords che indicano prenotazione esistente (anche senza modify/cancel esplicito)
  EXISTING_RESERVATION_KEYWORDS: [
    // Italiano
    'ho prenotato', 'avevo prenotato', 'ho una prenotazione',
    'la mia prenotazione', 'la prenotazione',
    // Inglese
    'i have a reservation', 'my reservation', 'i booked',
    'i have a booking', 'my booking',
  ],
  
  detectIntent(text) {
    if (!text) return 'create';
    const t = text.toLowerCase();
    
    // Prima: cancellazione (priorità alta)
    for (const kw of this.CANCEL_KEYWORDS) {
      if (t.includes(kw)) return 'cancel';
    }
    
    // Poi: modifica
    for (const kw of this.MODIFY_KEYWORDS) {
      if (t.includes(kw)) return 'modify';
    }
    
    // Poi: riferimento a prenotazione esistente (trattalo come modify)
    for (const kw of this.EXISTING_RESERVATION_KEYWORDS) {
      if (t.includes(kw)) return 'modify';
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
    // ═══════════════════════════════════════════════════════════════════════
    // FIX v3.9.4: Usa 'in' invece di ?? per permettere di settare null
    // Prima: date: newData.date ?? prev.date  ← BUG! null ?? prev = prev
    // Ora:   'date' in newData ? newData.date : prev.date  ← null viene salvato
    // ═══════════════════════════════════════════════════════════════════════
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
    console.log(`📋 Prenotazione esistente salvata:`, reservation);
  },
  
  // v3: Fase conversazione
  getPhase(callId) {
    return STATE.conversationPhases.get(callId) || 'initial';
  },
  setPhase(callId, phase) {
    STATE.conversationPhases.set(callId, phase);
    console.log(`📍 Fase conversazione: ${phase}`);
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
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 6: MULTI-TENANT REGISTRY (copiato da v2 - funziona)
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
// SEZIONE 7: DATE MANAGER (copiato da v2 - funziona)
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
    
    // ═══════════════════════════════════════════════════════════════════════
    // FIX v3.9.15: Se oggi È GIÀ il giorno cercato (diff=0), vai alla PROSSIMA settimana
    // Logica: se dici "domenica" e oggi è domenica, intendi domenica prossima
    // Se vuoi prenotare per oggi, dici "oggi" o "stasera", non il nome del giorno
    // REVERTE FIX v3.9.1 che usava OGGI (comportamento sbagliato)
    // ═══════════════════════════════════════════════════════════════════════
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
  
  // Parse date da testo (FIX17/18/24 inclusi)
  // FIX v3.9: Estrae SOLO dal messaggio corrente, MAI dalla cronologia
  parseFromText(text, callId = null) {
    if (!text) return null;
    const t = normalizeText(text);
    const now = this.getNow();
    const today = this.startOfDay(now);
    
    // 1. Data esplicita: "10 dicembre"
    const explicitDate = this._parseExplicitDate(t, today);
    if (explicitDate) {
      console.log(`📆 FIX v3.9: Data esplicita trovata: ${explicitDate}`);
      return explicitDate;
    }
    
    // 2. Data relativa: "domani", "dopodomani"
    const relativeDate = this._parseRelativeDate(t, today);
    if (relativeDate) {
      console.log(`📆 FIX v3.9: Data relativa trovata: ${relativeDate}`);
      return relativeDate;
    }
    
    // 3. Giorno settimana: "martedì" (usa ULTIMO menzionato - FIX24a)
    const weekdayDate = this._parseWeekdayDate(t, today);
    if (weekdayDate) {
      console.log(`📆 FIX v3.9: Giorno settimana trovato: ${weekdayDate}`);
      return weekdayDate;
    }
    
    // FIX v3.9: RIMOSSA ricerca nella cronologia!
    // La cronologia causava bug dove date/orari vecchi "avvelenavano" i nuovi messaggi
    // Ora il sistema usa SOLO i dati già salvati in StateManager.getReservation()
    
    return null;
  },
  
  _parseExplicitDate(text, today) {
    const monthsMap = {
      'gennaio': 0, 'febbraio': 1, 'marzo': 2, 'aprile': 3, 'maggio': 4, 'giugno': 5,
      'luglio': 6, 'agosto': 7, 'settembre': 8, 'ottobre': 9, 'novembre': 10, 'dicembre': 11,
      'january': 0, 'february': 1, 'march': 2, 'april': 3, 'may': 4, 'june': 5,
      'july': 6, 'august': 7, 'september': 8, 'october': 9, 'november': 10, 'december': 11,
    };
    
    // ═══════════════════════════════════════════════════════════════════════
    // FIX v3.9.9: Parsa prima il formato DD/MM o D/M (es. "3/2" = 3 febbraio)
    // Deve venire PRIMA del parsing con mese testuale
    // ═══════════════════════════════════════════════════════════════════════
    const slashMatch = text.match(/\b(\d{1,2})\/(\d{1,2})\b/);
    if (slashMatch) {
      const day = parseInt(slashMatch[1]);
      const month = parseInt(slashMatch[2]) - 1; // 0-indexed
      
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
    // FIX v3.5: "day after tomorrow" PRIMA di "tomorrow" per evitare match parziale
    if (/dopodomani|dopo domani|day after tomorrow/.test(text)) return this.toISO(this.addDays(today, 2));
    // "tomorrow" ma NON "day after tomorrow" (già gestito sopra)
    if (/\btomorrow\b/.test(text) || /\bdomani\b/.test(text)) return this.toISO(this.addDays(today, 1));
    if (/oggi|today|stasera|questa sera|tonight/.test(text)) return this.toISO(today);
    
    const traMatch = text.match(/(?:tra|fra|in)\s*(\d+)\s*giorni/);
    if (traMatch) return this.toISO(this.addDays(today, parseInt(traMatch[1])));
    
    return null;
  },
  
  _parseWeekdayDate(text, today) {
    // FIX24a: Trova l'ULTIMO giorno menzionato
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
      
      // ═══════════════════════════════════════════════════════════════════════
      // FIX v3.9.9: Se c'è "prossimo/prossima/next", salta alla settimana dopo
      // Es. oggi è sabato, "sabato prossimo" = +7 giorni, non oggi
      // ═══════════════════════════════════════════════════════════════════════
      const hasNextModifier = /\b(prossim[ao]|next)\b/i.test(text);
      
      let result = this.getNextWeekday(today, lastFoundIndex);
      
      // Se oggi È il giorno cercato E c'è "prossimo", aggiungi 7 giorni
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
// SEZIONE 8: TIME MANAGER (copiato da v2)
// ═══════════════════════════════════════════════════════════════════════════════

const TimeManager = {
  parseFromText(text) {
    if (!text) return null;
    const t = text.toLowerCase().trim();
    
    if (/mezzogiorno|noon/.test(t)) return "12:00:00";
    if (/mezzanotte|midnight/.test(t)) return "00:00:00";
    
    // ═══════════════════════════════════════════════════════════════════════
    // FIX v3.9.5: Raccoglie TUTTI gli orari con la loro POSIZIONE nel testo
    // e prende l'ULTIMO (quello più a destra)
    // Questo gestisce frasi come "aprite alle 12? Allora facciamo 12:30"
    // ═══════════════════════════════════════════════════════════════════════
    const allTimes = []; // Array di {position, time, pattern, match}
    let match;
    
    // Pattern 1: "alle 20", "alle 20:30", "ore 20", "per le 20"
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
    
    // Pattern 2: "le 22", "le 8" (SENZA "alle" davanti)
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
    
    // Pattern 3: "8pm", "8 pm", "8:30pm" (inglese)
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
    
    // Pattern 4: "at 8", "at 8:30" (inglese)
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
    
    // Pattern 5: "12:30", "20:30" diretto (HH:MM)
    // FIX v3.9.12: Se contesto serale E orario < 12, aggiungi 12 ore
    // FIX v3.9.13: Se orario AM (1-11) è fuori fascia ma PM è dentro → usa PM
    const eveningContext = /tonight|dinner|evening|sera|cena|stasera/i.test(t);
    const pattern5 = /\b(\d{1,2}):(\d{2})\b/g;
    while ((match = pattern5.exec(t)) !== null) {
      let hour = parseInt(match[1]);
      const minutes = parseInt(match[2]);
      
      // FIX v3.9.12: In contesto serale esplicito, orari 1-11 diventano PM
      if (eveningContext && hour >= 1 && hour <= 11) {
        console.log(`⏰ FIX v3.9.12: Contesto serale rilevato, ${hour}:${String(minutes).padStart(2,'0')} → ${hour+12}:${String(minutes).padStart(2,'0')}`);
        hour += 12;
      }
      // FIX v3.9.13: Se ora ambigua (1-11) è fuori orario apertura ma +12 è dentro → usa +12
      // Fasce orarie: Pranzo 12:00-15:00 (720-900min), Cena 19:00-22:30 (1140-1350min)
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
        // Evita duplicati: controlla se esiste già un match alla stessa posizione
        const isDuplicate = allTimes.some(t => 
          Math.abs(t.position - match.index) < 5 && t.time === timeStr
        );
        if (!isDuplicate) {
          allTimes.push({ position: match.index, time: timeStr, pattern: 'pattern5', match: match[0] });
        }
      }
    }
    
    if (allTimes.length === 0) return null;
    
    // Ordina per posizione e prendi l'ULTIMO
    allTimes.sort((a, b) => a.position - b.position);
    const lastTime = allTimes[allTimes.length - 1];
    
    // Log tutti gli orari trovati e quale viene scelto
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
// SEZIONE 9: PEOPLE MANAGER (copiato da v2)
// ═══════════════════════════════════════════════════════════════════════════════

const PeopleManager = {
  parseFromText(text) {
    if (!text) return null;
    const t = text.toLowerCase().trim();
    
    // ═══════════════════════════════════════════════════════════════════════
    // FIX v3.9.12: Pattern di correzione - quando l'utente si corregge,
    // prendi l'ULTIMO numero menzionato, non il primo
    // Es: "Siamo in 8... anzi no aspetta, facciamo 12" → 12 (non 8)
    // ═══════════════════════════════════════════════════════════════════════
    const correctionPatterns = /anzi|no aspetta|aspetta|facciamo|meglio|diciamo|actually|no wait|wait|let's say|make it|changed to|now it's/i;
    if (correctionPatterns.test(t)) {
      // Trova TUTTI i numeri nel testo
      const allNumbers = t.match(/\b(\d+)\b/g);
      if (allNumbers && allNumbers.length >= 2) {
        // Prendi l'ultimo numero
        const lastNum = parseInt(allNumbers[allNumbers.length - 1]);
        if (lastNum > 0 && lastNum < 100) {
          console.log(`👥 FIX v3.9.12: Correzione rilevata! Numeri trovati: [${allNumbers.join(', ')}] → uso ULTIMO: ${lastNum}`);
          return lastNum;
        }
      }
    }
    
    const patterns = [
      // Pattern specifici per modifiche
      /(\d+)\s*in\s*totale/i,                          // "4 in totale"
      /(\d+)\s*invece\s*di\s*\d+/i,                    // "5 invece di 4"
      /diventat[io]\s*(\d+)/i,                         // "diventati 5"
      /adesso\s*(?:siamo\s*)?(?:in\s*)?(\d+)/i,        // "adesso siamo in 5", "adesso 5"
      /siamo\s*(?:in\s*)?(\d+)/i,                      // "siamo in 5", "siamo 5"
      
      // Pattern standard
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
    
    // Pattern per "aggiungere altre X" - richiede contesto (non gestibile qui)
    
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
// SEZIONE 9B: NAME MANAGER (FIX v3.9.14)
// Estrae il nome SOLO da pattern espliciti per evitare false positive
// ═══════════════════════════════════════════════════════════════════════════════

const NameManager = {
  parseFromText(text) {
    if (!text) return null;
    const t = text.trim();
    
    // Lista di parole comuni da escludere (non sono nomi)
    // FIX v3.9.15: Aggiunte parole italiane comuni
    const excludeWords = [
      // Inglese
      'not', 'the', 'a', 'an', 'is', 'are', 'it', 'my', 'your', 'no', 'yes', 'ok', 'and', 'or',
      // Italiano
      'mio', 'mia', 'suo', 'sua', 'nostro', 'nostra', 'vostro', 'vostra', 'il', 'la', 'lo', 'un', 'una'
    ];
    
    // Pattern MOLTO conservativi - solo frasi esplicite
    const patterns = [
      // Inglese: "name is Brown", "name is Mary Jane"
      /\bname\s+is\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\b/i,
      // Inglese: "under the name Smith"
      /\bunder\s+(?:the\s+)?name\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\b/i,
      // Italiano: "a nome Rossi", "a nome di Rossi"
      /\ba\s+nome\s+(?:di\s+)?([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\b/i,
      // Italiano: "nome Bianchi" (a inizio frase o dopo virgola)
      /(?:^|,\s*)\s*nome\s+([A-Z][a-zA-Z]+)\b/i,
    ];
    
    for (const pattern of patterns) {
      const match = t.match(pattern);
      if (match && match[1]) {
        const name = match[1].trim();
        // Safeguard: almeno 2 caratteri e non parola comune
        if (name.length >= 2 && !excludeWords.includes(name.toLowerCase())) {
          console.log(`👤 FIX v3.9.14 NameManager: estratto "${name}" da "${t.substring(0,40)}..."`);
          return name;
        }
      }
    }
    
    return null;
  },
};


// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 10: CLOSURE CHECKER (copiato da v2)
// ═══════════════════════════════════════════════════════════════════════════════

const ClosureChecker = {
  async isOpen(dateISO, callId = null) {
    if (!dateISO) return { open: true, reason: null };
    
    console.log(`🔍 ClosureChecker: ${dateISO}...`);
    
    // Check chiusura settimanale
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
    
    // Check chiusure straordinarie
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
// SEZIONE 11: CALENDAR SERVICE (copiato da v2)
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
      console.log(`📋 Nessuna prenotazione per ${phone}`);
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
  
  buildAlternativesMessage(alternatives, lang = "it-IT") {
    const { sameDay, nextDays } = alternatives;
    
    if (sameDay?.length > 0) {
      const times = sameDay.map(s => s.time).slice(0, 3);
      if (lang === "en-US") {
        return times.length === 1
          ? `I'm sorry, we're full. I have ${times[0]}. Would that work?`
          : `I'm sorry, we're full. I have ${times.slice(0,-1).join(", ")} or ${times.slice(-1)}. Which do you prefer?`;
      }
      return times.length === 1
        ? `Mi dispiace, siamo al completo. Ho le ${times[0]}. Può andare?`
        : `Mi dispiace, siamo al completo. Ho le ${times.slice(0,-1).join(", ")} o le ${times.slice(-1)}. Quale preferisci?`;
    }
    
    if (nextDays?.length > 0) {
      const firstDay = nextDays[0];
      const times = firstDay.slots?.map(s => s.time).slice(0, 2) || [];
      return lang === "en-US"
        ? `I'm sorry, we're full today. Next availability is ${firstDay.dayName} at ${times.join(" or ")}. Would you like to book?`
        : `Mi dispiace, oggi siamo al completo. Prima disponibilità ${firstDay.dayName} alle ${times.join(" o ")}. Vuoi prenotare?`;
    }
    
    return lang === "en-US"
      ? "I'm sorry, we're fully booked. Would you like a different day?"
      : "Mi dispiace, siamo al completo. Vuoi provare un altro giorno?";
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 12: CONTEXT SERVICE (copiato da v2)
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
// SEZIONE 13: RECAP MANAGER (v3.1 SEMPLIFICATO)
// RECAP = solo trasparenza ("so chi sei dal numero")
// Dopo RECAP → conversazione normale
// ═══════════════════════════════════════════════════════════════════════════════

const RecapManager = {
  // Costruisce RECAP integrato per MODIFY
  // Include già la domanda su cosa vuole modificare
  buildModifyRecapMessage(existingRes, userText, lang = "it-IT") {
    const firstName = existingRes.name?.split(' ')[0] || existingRes.name;
    const dateDisplay = DateManager.formatForDisplay(existingRes.date, lang);
    const timeDisplay = TimeManager.formatForDisplay(existingRes.time);
    
    // Prova a capire cosa vuole modificare dal primo messaggio
    const modification = this.extractModification(userText, existingRes);
    
    // Conta quante modifiche
    const modCount = (modification.newTime ? 1 : 0) + (modification.newDate ? 1 : 0) + (modification.newPeople ? 1 : 0);
    
    if (modCount >= 2) {
      // Modifiche multiple
      let changes = [];
      if (modification.newTime) changes.push(lang === "en-US" ? `time to ${TimeManager.formatForDisplay(modification.newTime)}` : `orario alle ${TimeManager.formatForDisplay(modification.newTime)}`);
      if (modification.newDate) changes.push(lang === "en-US" ? `date to ${DateManager.formatForDisplay(modification.newDate, lang)}` : `data a ${DateManager.formatForDisplay(modification.newDate, lang)}`);
      if (modification.newPeople) changes.push(lang === "en-US" ? `${modification.newPeople} people` : `${modification.newPeople} persone`);
      
      return lang === "en-US"
        ? `Hi ${firstName}, I have your reservation for ${existingRes.people} people on ${dateDisplay} at ${timeDisplay}. You want to change: ${changes.join(" and ")}. Correct?`
        : `Ciao ${firstName}, ho la tua prenotazione per ${existingRes.people} persone ${dateDisplay} alle ${timeDisplay}. Vuoi cambiare: ${changes.join(" e ")}. Giusto?`;
    }
    
    if (modification.newTime) {
      // Ha già detto l'orario nuovo
      const newTimeDisplay = TimeManager.formatForDisplay(modification.newTime);
      return lang === "en-US"
        ? `Hi ${firstName}, I have your reservation for ${existingRes.people} people on ${dateDisplay} at ${timeDisplay}. You want to move it to ${newTimeDisplay}, correct?`
        : `Ciao ${firstName}, ho la tua prenotazione per ${existingRes.people} persone ${dateDisplay} alle ${timeDisplay}. Vuoi spostare alle ${newTimeDisplay}, giusto?`;
    }
    
    if (modification.newDate) {
      // Ha già detto il giorno nuovo
      const newDateDisplay = DateManager.formatForDisplay(modification.newDate, lang);
      return lang === "en-US"
        ? `Hi ${firstName}, I have your reservation for ${existingRes.people} people on ${dateDisplay} at ${timeDisplay}. You want to move it to ${newDateDisplay}, correct?`
        : `Ciao ${firstName}, ho la tua prenotazione per ${existingRes.people} persone ${dateDisplay} alle ${timeDisplay}. Vuoi spostare a ${newDateDisplay}, giusto?`;
    }
    
    if (modification.newPeople) {
      // Ha già detto le persone nuove
      return lang === "en-US"
        ? `Hi ${firstName}, I have your reservation for ${existingRes.people} people on ${dateDisplay} at ${timeDisplay}. You want to change to ${modification.newPeople} people, correct?`
        : `Ciao ${firstName}, ho la tua prenotazione per ${existingRes.people} persone ${dateDisplay} alle ${timeDisplay}. Vuoi cambiare a ${modification.newPeople} persone, giusto?`;
    }
    
    // Non ha specificato cosa vuole modificare → chiedi
    return lang === "en-US"
      ? `Hi ${firstName}, I have your reservation for ${existingRes.people} people on ${dateDisplay} at ${timeDisplay}. What would you like to change?`
      : `Ciao ${firstName}, ho la tua prenotazione per ${existingRes.people} persone ${dateDisplay} alle ${timeDisplay}. Cosa vorresti modificare?`;
  },
  
  // Costruisce RECAP per CANCEL (chiede sempre conferma esplicita)
  buildCancelRecapMessage(existingRes, lang = "it-IT") {
    const firstName = existingRes.name?.split(' ')[0] || existingRes.name;
    const dateDisplay = DateManager.formatForDisplay(existingRes.date, lang);
    const timeDisplay = TimeManager.formatForDisplay(existingRes.time);
    
    return lang === "en-US"
      ? `Hi ${firstName}, I have your reservation for ${existingRes.people} people on ${dateDisplay} at ${timeDisplay}. Do you confirm you want to cancel it?`
      : `Ciao ${firstName}, ho la tua prenotazione per ${existingRes.people} persone ${dateDisplay} alle ${timeDisplay}. Confermi di volerla cancellare?`;
  },
  
  // Estrae la modifica richiesta dal testo - TUTTI i campi
  extractModification(text, existingRes) {
    const result = { newTime: null, newDate: null, newPeople: null };
    if (!text) return result;
    
    // Estrai orario
    const time = TimeManager.parseFromText(text);
    if (time) {
      // Normalizza il formato dell'orario esistente per confronto
      const existingTimeNorm = existingRes.time?.includes(':') 
        ? (existingRes.time.length === 5 ? existingRes.time + ':00' : existingRes.time)
        : existingRes.time + ':00:00';
      if (time !== existingTimeNorm && time !== existingRes.time) {
        result.newTime = time;
      }
    }
    
    // Estrai data - usa tutto il testo della conversazione
    const date = DateManager.parseFromText(text);
    if (date && date !== existingRes.date) {
      result.newDate = date;
    }
    
    // Estrai persone
    const people = PeopleManager.parseFromText(text);
    if (people && people !== existingRes.people) {
      result.newPeople = people;
    }
    
    console.log(`🔍 extractModification: "${text.substring(0,50)}" → time=${result.newTime}, date=${result.newDate}, people=${result.newPeople}`);
    return result;
  },
  
  // Messaggio cancellazione completata
  buildCancellationDoneMessage(existingRes, lang = "it-IT") {
    return lang === "en-US"
      ? `Done! The reservation has been cancelled. We hope to see you again soon. Goodbye!`
      : `Fatto! La prenotazione è stata cancellata. Speriamo di rivederti presto. Buona giornata!`;
  },
  
  // Messaggio modifica completata
  buildModificationDoneMessage(reservation, lang = "it-IT") {
    const dateDisplay = DateManager.formatForDisplay(reservation.date, lang);
    const timeDisplay = TimeManager.formatForDisplay(reservation.time);
    const firstName = reservation.name?.split(' ')[0] || reservation.name;
    
    return lang === "en-US"
      ? `Perfect ${firstName}! Your reservation is updated: ${reservation.people} people on ${dateDisplay} at ${timeDisplay}. See you soon!`
      : `Perfetto ${firstName}! Prenotazione aggiornata: ${reservation.people} persone ${dateDisplay} alle ${timeDisplay}. Ti aspettiamo!`;
  },
  
  // Messaggio se prenotazione non trovata
  buildNotFoundMessage(lang = "it-IT") {
    return lang === "en-US"
      ? `I couldn't find a reservation with your phone number. Would you like to make a new one?`
      : `Non ho trovato prenotazioni associate a questo numero. Vuoi fare una nuova prenotazione?`;
  },
  
  // Messaggio per chiedere il nome (NUOVO!)
  buildAskNameMessage(lang = "it-IT") {
    return lang === "en-US"
      ? `Of course! What name is the reservation under?`
      : `Certo! A che nome è la prenotazione?`;
  },
  
  // Messaggio se nome non corrisponde (NUOVO!)
  buildNameMismatchMessage(saidName, lang = "it-IT") {
    return lang === "en-US"
      ? `I'm sorry, I don't find a reservation under the name "${saidName}" with this phone number. Can you check the name or call from the number used to book?`
      : `Mi dispiace, non trovo prenotazioni a nome "${saidName}" con questo numero. Può verificare il nome o chiamare dal numero usato per prenotare?`;
  },
  
  // Estrae il nome dal testo dell'utente (NUOVO!)
  extractName(text) {
    if (!text) return null;
    const t = text.trim();
    
    // Rimuovi prefissi comuni
    const cleaned = t
      .replace(/^(a nome|nome|sotto il nome|prenotazione|prenotato a nome|è|sono)\s*/i, '')
      .replace(/^(under|name|it's|i'm)\s*/i, '')
      .trim();
    
    // Se resta solo una o due parole, probabilmente è il nome
    const words = cleaned.split(/\s+/).filter(w => w.length > 1);
    if (words.length >= 1 && words.length <= 4) {
      // Capitalizza ogni parola
      return words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    }
    
    return null;
  },
  
  // Confronta nome detto con nome in prenotazione (NUOVO!)
  // Fuzzy match: "Rossi" deve matchare "Mario Rossi"
  nameMatches(saidName, reservationName) {
    if (!saidName || !reservationName) return false;
    
    const said = saidName.toLowerCase().trim();
    const reserved = reservationName.toLowerCase().trim();
    
    // Match esatto
    if (said === reserved) return true;
    
    // Match parziale: "rossi" in "mario rossi"
    if (reserved.includes(said)) return true;
    
    // Match per parola: "mario" o "rossi" matchano "mario rossi"
    const reservedWords = reserved.split(/\s+/);
    const saidWords = said.split(/\s+/);
    
    // Almeno una parola deve matchare
    for (const saidWord of saidWords) {
      if (saidWord.length < 2) continue; // Ignora parole troppo corte
      for (const resWord of reservedWords) {
        if (resWord === saidWord) return true;
        // Match parziale per cognomi lunghi (es. "cancel" in "cancelleri" - NO!)
        // Ma "cancelleri" in "cancelleri" - SI
        if (resWord.startsWith(saidWord) && saidWord.length >= 4) return true;
      }
    }
    
    return false;
  },
  
  // Verifica se utente sta confermando
  isConfirming(text) {
    const t = normalizeText(text || "");
    // IMPORTANTE: \b per word boundary, altrimenti "siamo" matcha "si"
    if (/^(si\b|sii\b|yes\b|esatto|corretto|giusto|confermo|certo|ok\b|va bene|proprio|quella|perfetto)/.test(t)) return true;
    if (/\b(conferm|esatt|corrett|giust|perfett)\b/.test(t)) return true;
    return false;
  },
  
  // Verifica se utente sta negando
  isDenying(text) {
    const t = normalizeText(text || "");
    if (/^(no[^n]|non |sbagliato|errato|altra|diversa)/.test(t)) return true;
    if (/\b(sbagliat|errat|non e quella)\b/.test(t)) return true;
    return false;
  },
  
  // Messaggio per chiedere cosa vuole modificare
  buildAskWhatToModify(existingRes, lang = "it-IT") {
    const firstName = existingRes.name?.split(' ')[0] || existingRes.name;
    return lang === "en-US"
      ? `${firstName}, what would you like to change? The time, day, or number of people?`
      : `${firstName}, cosa vorresti modificare? L'orario, il giorno, o il numero di persone?`;
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 14: VALIDATION PIPELINE (SEMPLIFICATO v3)
// Solo per nuove prenotazioni - cancel/modify gestiti da RecapManager
// ═══════════════════════════════════════════════════════════════════════════════

const ValidationPipeline = {
  // ═══════════════════════════════════════════════════════════════════════
  // FIX v3.9.2: Validazione orari DETERMINISTICA con orario chiusura
  // Il ristorante chiude alle 22:30 (ultima prenotazione), non 23:00
  // ═══════════════════════════════════════════════════════════════════════
  isValidTime(time, context = null) {
    if (!time) return false;
    const [hourStr, minStr] = time.split(':');
    const hour = parseInt(hourStr);
    const minutes = parseInt(minStr || '0');
    const totalMinutes = hour * 60 + minutes;
    
    // ═══════════════════════════════════════════════════════════════════════
    // FIX v3.9.4: Orari PRANZO + CENA
    // Pranzo: 12:00 - 15:00 (ultima prenotazione pranzo)
    // Cena:   19:00 - 22:30 (ultima prenotazione cena)
    // ═══════════════════════════════════════════════════════════════════════
    const lunchOpen = 12 * 60;         // 12:00
    const lunchClose = 15 * 60;        // 15:00
    const dinnerOpen = 19 * 60;        // 19:00
    const dinnerClose = 22 * 60 + 30;  // 22:30
    
    const isLunch = totalMinutes >= lunchOpen && totalMinutes <= lunchClose;
    const isDinner = totalMinutes >= dinnerOpen && totalMinutes <= dinnerClose;
    const isValid = isLunch || isDinner;
    
    if (!isValid) {
      console.log(`⏰ isValidTime: ${time} (${totalMinutes} min) fuori range pranzo ${lunchOpen}-${lunchClose} E cena ${dinnerOpen}-${dinnerClose}`);
    }
    return isValid;
  },
  
  // ═══════════════════════════════════════════════════════════════════════
  // FIX v3.9.9: Verifica coerenza giorno settimana + numero giorno
  // Quando l'utente dice "sabato 7" senza mese, verifichiamo che la data
  // calcolata sia effettivamente sabato E il giorno 7 del mese.
  // ═══════════════════════════════════════════════════════════════════════
  checkDayWeekNumberMismatch(userText, calculatedDate, lang = "it-IT") {
    if (!userText || !calculatedDate) return { mismatch: false };
    
    const text = normalizeText(userText);
    
    // Mappa giorni settimana (normalizzati senza accenti)
    const daysMap = {
      'domenica': 0, 'sunday': 0,
      'lunedi': 1, 'monday': 1,
      'martedi': 2, 'tuesday': 2,
      'mercoledi': 3, 'wednesday': 3,
      'giovedi': 4, 'thursday': 4,
      'venerdi': 5, 'friday': 5,
      'sabato': 6, 'saturday': 6,
    };
    
    // Nomi giorni per output
    const dayNamesIT = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
    const dayNamesEN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const monthNamesIT = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
                          'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
    const monthNamesEN = ['January', 'February', 'March', 'April', 'May', 'June',
                          'July', 'August', 'September', 'October', 'November', 'December'];
    
    // Cerca giorno della settimana menzionato
    let mentionedDayOfWeek = null;
    let mentionedDayName = null;
    for (const [dayName, dayIndex] of Object.entries(daysMap)) {
      if (text.includes(dayName)) {
        mentionedDayOfWeek = dayIndex;
        mentionedDayName = dayName;
        break;
      }
    }
    
    // Cerca numero giorno menzionato (solo se NON c'è un mese esplicito)
    const monthNames = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
                        'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre',
                        'january', 'february', 'march', 'april', 'may', 'june',
                        'july', 'august', 'september', 'october', 'november', 'december'];
    
    const hasExplicitMonth = monthNames.some(m => text.includes(m));
    
    // Se c'è un mese esplicito, non serve il check (la data è già precisa)
    if (hasExplicitMonth) return { mismatch: false };
    
    // Cerca numero giorno (1-31 isolato, non parte di orario come "20:30")
    // Escludiamo numeri che fanno parte di orari (seguiti da ":" o preceduti da "alle/ore")
    // FIX v3.9.12: Supporto ordinali inglesi (1st, 2nd, 3rd, 4th, 5th, etc.)
    const dayNumberMatch = text.match(/(?<!alle\s|ore\s|le\s|\d|:)\b([1-9]|[12][0-9]|3[01])(?:st|nd|rd|th)?\b(?!:|\d|pm|am)/i);
    let mentionedDayNumber = dayNumberMatch ? parseInt(dayNumberMatch[1]) : null;
    
    // FIX v3.9.10: Logica migliorata per distinguere numero giorno da orario
    // Se c'è già un orario ESPLICITO (es. "alle 21", "ore 20:30", "20:00", "7pm", "at 8")
    // allora un numero trovato separatamente è il GIORNO, non l'orario
    // FIX v3.9.13: Aggiunto supporto pattern inglesi (at X, Xpm, Xam)
    const explicitTimeMatch = text.match(/(?:alle|ore|per le)\s+(\d{1,2})(?:[:\.]\d{2})?/i) ||
                              text.match(/\b(\d{1,2}:\d{2})\b/) ||
                              text.match(/\b(\d{1,2})[:\.]\d{2}\b/) ||
                              text.match(/\bat\s+(\d{1,2})(?:[:\.]\d{2})?\b/i) ||   // FIX v3.9.13: "at 7", "at 8:30"
                              text.match(/\b(\d{1,2})\s*(?:pm|am)\b/i);              // FIX v3.9.13: "7pm", "8 am"
    
    if (explicitTimeMatch && mentionedDayNumber && mentionedDayNumber <= 12) {
      // C'è un orario esplicito - il numero trovato è il giorno
      const explicitTimeValue = explicitTimeMatch[1].split(/[:.]/)[0];
      if (mentionedDayNumber.toString() !== explicitTimeValue) {
        console.log(`📆 FIX v3.9.10: Numero ${mentionedDayNumber} è il giorno (orario esplicito trovato: ${explicitTimeMatch[0]})`);
        // Continua con il check mismatch - il numero è un giorno valido
      } else {
        // Il numero trovato È l'orario, non cercare giorno
        mentionedDayNumber = null;
      }
    } else if (!explicitTimeMatch && mentionedDayNumber && mentionedDayNumber <= 12) {
      // NON c'è orario esplicito - se c'è contesto orario generico, potrebbe essere l'ora
      const timeContext = /\b(alle|ore|per le|sera|pranzo|cena|mattina|pomeriggio|at|pm|am)\b/i.test(text);
      if (timeContext) {
        console.log(`📆 FIX v3.9.9: Numero ${mentionedDayNumber} ignorato (probabile orario, contesto time presente)`);
        return { mismatch: false };
      }
    }
    
    // Se NON abbiamo sia giorno settimana CHE numero, non c'è ambiguità da verificare
    if (mentionedDayOfWeek === null || mentionedDayNumber === null) {
      return { mismatch: false };
    }
    
    // Calcola giorno settimana e numero della data calcolata
    const [year, month, day] = calculatedDate.split('-').map(Number);
    const dateObj = new Date(year, month - 1, day);
    const actualDayOfWeek = dateObj.getDay();
    const actualDayNumber = dateObj.getDate();
    
    // Verifica se combaciano
    if (mentionedDayOfWeek !== actualDayOfWeek || mentionedDayNumber !== actualDayNumber) {
      console.log(`📆 FIX v3.9.10: Mismatch! Utente dice "${mentionedDayName} ${mentionedDayNumber}", calcolato ${calculatedDate} (dow=${actualDayOfWeek}, day=${actualDayNumber})`);
      
      // FIX v3.9.10: Cerca la data più vicina dove quel giorno cade su quel numero
      const suggestedDate = this._findNextMatchingDate(mentionedDayOfWeek, mentionedDayNumber);
      
      if (suggestedDate) {
        const suggestedDayName = lang === "en-US" ? dayNamesEN[mentionedDayOfWeek] : dayNamesIT[mentionedDayOfWeek];
        const suggestedMonthName = lang === "en-US" ? monthNamesEN[suggestedDate.getMonth()] : monthNamesIT[suggestedDate.getMonth()];
        const suggestedDateStr = `${suggestedDate.getFullYear()}-${String(suggestedDate.getMonth() + 1).padStart(2, '0')}-${String(suggestedDate.getDate()).padStart(2, '0')}`;
        
        console.log(`📆 FIX v3.9.10: Data più vicina trovata: ${suggestedDateStr} (${suggestedDayName} ${mentionedDayNumber} ${suggestedMonthName})`);
        
        // Costruisci messaggio con suggerimento
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
        // Fallback: chiedi il mese se non troviamo una data valida
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
  
  // FIX v3.9.10: Trova la data più vicina dove il giorno della settimana cade sul numero specificato
  _findNextMatchingDate(dayOfWeek, dayNumber) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Cerca nei prossimi 12 mesi
    for (let monthOffset = 0; monthOffset < 12; monthOffset++) {
      const testYear = today.getFullYear() + Math.floor((today.getMonth() + monthOffset) / 12);
      const testMonth = (today.getMonth() + monthOffset) % 12;
      
      const testDate = new Date(testYear, testMonth, dayNumber);
      
      // Verifica che il giorno esista in quel mese (es. 31 febbraio non esiste)
      if (testDate.getDate() !== dayNumber) continue;
      
      // Verifica che sia il giorno della settimana corretto
      if (testDate.getDay() !== dayOfWeek) continue;
      
      // Verifica che sia nel futuro (o oggi)
      if (testDate >= today) {
        return testDate;
      }
    }
    
    return null; // Non trovato nei prossimi 12 mesi
  },
  
  // ═══════════════════════════════════════════════════════════════════════
  // FIX v3.9.9: Pattern per rilevare false chiusure nella reply_text di GPT
  // ═══════════════════════════════════════════════════════════════════════
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
  
  // ═══════════════════════════════════════════════════════════════════════
  // FIX v3.9.15: Pattern per rilevare false "pieni" quando non abbiamo verificato
  // GPT a volte inventa "siamo pieni" senza che noi abbiamo fatto check
  // ═══════════════════════════════════════════════════════════════════════
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
    
    // ═══════════════════════════════════════════════════════════════════════
    // FIX v3.9.6: Salva orario/data originali di GPT per correggere reply_text
    // ═══════════════════════════════════════════════════════════════════════
    const gptOriginalTime = reservation.time;
    const gptOriginalDate = reservation.date;
    
    // ═══════════════════════════════════════════════════════════════════════
    // FIX v3.9.2: CARICA DATI SALVATI PRIMA DI TUTTO
    // Questo previene che GPT sovrascriva dati già confermati
    // ═══════════════════════════════════════════════════════════════════════
    const savedReservation = StateManager.getReservation(callId);
    
    // FIX v3.9.15/v3.9.16: Check "fully booked" spostato DOPO parsing data
    
    // ═══════════════════════════════════════════════════════════════════════
    // FIX v3.9.2: STEP 1 - Gestione DATA con protezione
    // Se il parser trova una data nel messaggio → override
    // Se NON trova una data → mantieni quella salvata (NON quella di GPT!)
    // ═══════════════════════════════════════════════════════════════════════
    let parsedDate = DateManager.parseFromText(userText, null);
    if (parsedDate) {
      // Cliente ha detto una data → override
      if (reservation.date && reservation.date !== parsedDate) {
        console.log(`📆 FIX v3.9 OVERRIDE DATA: ${reservation.date} → ${parsedDate}`);
      }
      reservation.date = parsedDate;
      
      // ═══════════════════════════════════════════════════════════════════════
      // FIX v3.9.9/v3.9.11: SAFETY NET PER DATE CON GIORNO+NUMERO SENZA MESE
      // Se l'utente dice "sabato 7" senza specificare il mese, verifichiamo
      // che la data calcolata sia effettivamente sabato E il giorno 7.
      // v3.9.11: Se troviamo una data suggerita, la USIAMO direttamente
      // invece di chiedere conferma (pre-commit della data corretta)
      // ═══════════════════════════════════════════════════════════════════════
      const dayWeekMismatch = this.checkDayWeekNumberMismatch(userText, parsedDate, lang);
      if (dayWeekMismatch.mismatch) {
        if (dayWeekMismatch.suggestedDate) {
          // FIX v3.9.11: Usa la data suggerita come "pre-commit"
          // Non blocchiamo il flusso, ma usiamo direttamente la data più vicina
          console.log(`⚠️ FIX v3.9.11: Mismatch rilevato! Uso data suggerita: ${dayWeekMismatch.suggestedDate}`);
          reservation.date = dayWeekMismatch.suggestedDate;
          parsedDate = dayWeekMismatch.suggestedDate;
          // Segna che abbiamo fatto una correzione per poi aggiornare il messaggio
          response._dateWasCorrected = true;
          response._correctedDateMessage = dayWeekMismatch.message.replace('?', '.');
        } else {
          // Fallback: chiedi il mese (caso raro dove non troviamo data nei 12 mesi)
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
      // Cliente NON ha detto una data → proteggi quella salvata
      if (reservation.date && reservation.date !== savedReservation.date) {
        console.log(`📆 FIX v3.9.2 PROTEZIONE DATA: GPT dice ${reservation.date}, mantengo ${savedReservation.date}`);
      }
      reservation.date = savedReservation.date;
    }
    
    // STEP 2: Check chiusura
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
      
      // ═══════════════════════════════════════════════════════════════════════
      // FIX v3.9.9: CORREZIONE REPLY_TEXT PER FALSE CHIUSURE
      // Se GPT ha detto "chiuso/lunedì/closed" ma il giorno è APERTO,
      // correggiamo la reply_text per evitare informazioni false al cliente
      // ═══════════════════════════════════════════════════════════════════════
      if (this.FALSE_CLOSURE_PATTERNS.some(p => p.test(response.reply_text))) {
        console.log(`📝 FIX v3.9.9: GPT dice "chiuso" ma ${reservation.date} è APERTO - correggo reply_text`);
        
        // Costruisci risposta corretta
        const dateDisplay = DateManager.formatForDisplay(reservation.date, lang);
        
        if (lang === "en-US") {
          response.reply_text = `Perfect, ${dateDisplay}! What time would you like to book?`;
        } else {
          response.reply_text = `Perfetto, ${dateDisplay}! A che ora vorresti prenotare?`;
        }
        response.action = "ask_time";
        console.log(`📝 FIX v3.9.9: Nuova reply: "${response.reply_text}"`);
      }
      
      // ═══════════════════════════════════════════════════════════════════════
      // FIX v3.9.16: CORREZIONE "FULLY BOOKED" FALSO (spostato qui da v3.9.15)
      // Se GPT dice "siamo pieni/fully booked" ma NON abbiamo ancora fatto
      // un check reale (mancano orario o persone), correggi il messaggio
      // ORA la data è già stata parsata, quindi possiamo usarla nel messaggio
      // ═══════════════════════════════════════════════════════════════════════
      const earlyTimeCheck = reservation.time || savedReservation.time;
      const earlyPeopleCheck = reservation.people || savedReservation.people;
      const gptSaysFullyBooked = this.FALSE_FULLYBOOOKED_PATTERNS.some(p => p.test(response.reply_text));
      
      if (gptSaysFullyBooked && (!earlyTimeCheck || !earlyPeopleCheck)) {
        console.log(`📝 FIX v3.9.16: GPT dice "pieni/fully booked" ma non abbiamo verificato - correggo`);
        
        // Usa la data PARSATA (ora disponibile!) per costruire il messaggio
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
      
      // FIX v3.9.11: La correzione messaggio per _dateWasCorrected avviene alla FINE del pipeline,
      // dopo che tutti i campi (time, people, name) sono stati estratti
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // FIX v3.9.17: ANTI-ALLUCINAZIONE DATA
    // Se GPT chiede ask_date ma abbiamo GIÀ una data valida salvata,
    // override action al prossimo step logico
    // ═══════════════════════════════════════════════════════════════════════
    const effectiveDate = reservation.date || savedReservation.date;
    if (response.action === "ask_date" && effectiveDate) {
      console.log(`⚠️ FIX v3.9.17: GPT chiede data ma abbiamo già ${effectiveDate} → skip`);
      
      // Assicurati che la data sia nel reservation object
      reservation.date = effectiveDate;
      
      // Determina il prossimo step basato su cosa manca
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
        // Abbiamo tutto tranne email → ask_email o create_reservation
        response.action = "ask_email";
        response.reply_text = lang === "en-US"
          ? "Would you like to provide an email for confirmation?"
          : "Vuoi fornire un'email per la conferma?";
      }
      console.log(`⚠️ FIX v3.9.17: Nuovo action: ${response.action}`);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // FIX v3.9.2: STEP 3 - Gestione ORARIO con protezione
    // Se il parser trova un orario nel messaggio → override
    // Se NON trova un orario → mantieni quello salvato (NON quello di GPT!)
    // ═══════════════════════════════════════════════════════════════════════
    const parsedTime = TimeManager.parseFromText(userText);
    if (parsedTime) {
      // Cliente ha detto un orario → override
      if (reservation.time && reservation.time !== parsedTime) {
        console.log(`⏰ FIX v3.9 OVERRIDE ORARIO: ${reservation.time} → ${parsedTime}`);
      }
      reservation.time = parsedTime;
    } else if (savedReservation.time) {
      // Cliente NON ha detto un orario → proteggi quello salvato
      if (reservation.time && reservation.time !== savedReservation.time) {
        console.log(`⏰ FIX v3.9.2 PROTEZIONE ORARIO: GPT dice ${reservation.time}, mantengo ${savedReservation.time}`);
      }
      reservation.time = savedReservation.time;
    } else if (!reservation.time) {
      // Nessun orario nel messaggio E nessuno salvato → prova inferire da "cena/pranzo"
      const defaultTime = TimeManager.inferDefault(userText);
      if (defaultTime) {
        console.log(`⏰ FIX v3.9: Orario inferito da "${userText.substring(0,20)}": ${defaultTime}`);
        reservation.time = defaultTime;
      }
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // FIX v3.9.3/v3.9.4: VERIFICA ORARIO INVALIDO - SEMPRE!
    // Se abbiamo un orario che è FUORI RANGE, dobbiamo chiedere un orario valido.
    // FIX v3.9.4: Messaggio include sia PRANZO (12:00-15:00) che CENA (19:00-22:30)
    // ═══════════════════════════════════════════════════════════════════════
    if (reservation.time && !this.isValidTime(reservation.time)) {
      // Rileva se il cliente sta CHIEDENDO info sugli orari
      const isAskingAboutTime = /\b(ultimo|prima|quale|quali|orari|apertura|chiusura|when|what time|available|hours)\b/i.test(userText);
      
      if (isAskingAboutTime) {
        // Cliente chiede info → lascia rispondere GPT ma resetta orario invalido
        console.log(`ℹ️ FIX v3.9.3: Orario ${reservation.time} invalido + cliente chiede info → resetto`);
        reservation.time = null;
      } else {
        // Orario invalido e cliente NON chiede info → forza ask_time con messaggio
        console.log(`⏰ FIX v3.9.4: Orario ${reservation.time} INVALIDO → forzo ask_time`);
        response.action = "ask_time";
        response.reply_text = lang === "en-US"
          ? "I'm sorry, that time is outside our opening hours. We're open for lunch 12:00-15:00 and dinner 19:00-22:30. What time works for you?"
          : "Mi dispiace, quell'orario è fuori dai nostri orari di apertura. Siamo aperti a pranzo 12:00-15:00 e a cena 19:00-22:30. A che ora preferisci?";
        reservation.time = null;  // Resetta così il cliente può dare un nuovo orario
      }
    }
    // Se orario è VALIDO, verifica anti-allucinazione (GPT che chiede orario inutilmente)
    else if (response.action === "ask_time" && reservation.time) {
      // Rileva se il cliente sta CHIEDENDO info sugli orari (non dando un orario)
      const isAskingAboutTime = /\b(ultimo|prima|quale|quali|orari|apertura|chiusura|when|what time|available|hours)\b/i.test(userText);
      
      if (isAskingAboutTime) {
        // Il cliente sta chiedendo INFO → lascia che GPT risponda
        console.log(`ℹ️ FIX v3.9: Cliente chiede info orari, lascio risposta GPT`);
      } else if (this.isValidTime(reservation.time)) {
        // Abbiamo un orario VALIDO e cliente NON sta chiedendo info → skip
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
    
    // ═══════════════════════════════════════════════════════════════════════
    // FIX v3.9.2: STEP 4 - Gestione PERSONE con protezione
    // Se il parser trova un numero nel messaggio → override
    // Se NON trova un numero → mantieni quello salvato (NON quello di GPT!)
    // ═══════════════════════════════════════════════════════════════════════
    const parsedPeople = PeopleManager.parseFromText(userText);
    if (parsedPeople) {
      if (reservation.people && reservation.people !== parsedPeople) {
        console.log(`👥 FIX v3.9 OVERRIDE PERSONE: ${reservation.people} → ${parsedPeople}`);
      }
      reservation.people = parsedPeople;
    } else if (savedReservation.people) {
      // Cliente NON ha detto un numero → proteggi quello salvato
      if (reservation.people && reservation.people !== savedReservation.people) {
        console.log(`👥 FIX v3.9.2 PROTEZIONE PERSONE: GPT dice ${reservation.people}, mantengo ${savedReservation.people}`);
      }
      reservation.people = savedReservation.people;
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // FIX v3.9.14: STEP 4B - Gestione NOME con estrazione conservativa
    // Estrae il nome SOLO da pattern espliciti come "name is Brown", "a nome Rossi"
    // ═══════════════════════════════════════════════════════════════════════
    const parsedName = NameManager.parseFromText(userText);
    if (parsedName) {
      if (!reservation.name) {
        reservation.name = parsedName;
      }
    } else if (savedReservation.name && !reservation.name) {
      // Proteggi nome salvato
      reservation.name = savedReservation.name;
    }
    
    // STEP 5: Gestione eventi grandi (≥45)
    if (reservation.people >= CONFIG.EVENT_THRESHOLD) {
      const email = ContextService.getRestaurantEmail(callId);
      response.action = "none";
      response.reply_text = lang === "en-US"
        ? `For events of ${reservation.people} people, please email us at ${email}. We'll be happy to help!`
        : `Per eventi di ${reservation.people} persone, ti chiedo di scriverci a ${email}. Saremo felici di organizzare!`;
      response.reservation = reservation;
      return response;
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // FIX v3.9.2: CHECK DISPONIBILITÀ ANTICIPATO (usa dati GIÀ CORRETTI)
    // Usa `reservation` (già aggiornato con override/protezioni) NON StateManager
    // ═══════════════════════════════════════════════════════════════════════
    const hasDateForCheck = reservation.date;
    const hasTimeForCheck = reservation.time;
    const hasPeopleForCheck = reservation.people;
    
    // Se abbiamo tutti e 3 i dati essenziali E GPT vuole procedere con nome/email
    if (hasDateForCheck && hasTimeForCheck && hasPeopleForCheck) {
      if (response.action === "ask_name" || response.action === "ask_email" || response.action === "create_reservation") {
        
        const dateToCheck = reservation.date;
        const timeToCheck = reservation.time;
        const peopleToCheck = reservation.people;
        
        // Verifica disponibilità
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
            // Reset data
            reservation.date = null;
            StateManager.mergeReservation(callId, { date: null });
          } else {
            // Slot pieno - cerca alternative
            const alternatives = await CalendarService.findAlternatives(
              dateToCheck, timeToCheck, peopleToCheck, callId
            );
            response.reply_text = CalendarService.buildAlternativesMessage(alternatives, lang);
            response.action = "ask_time";
            // Reset orario (mantieni data e persone)
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
    
    // STEP 6: Estrai email
    if (!reservation.customerEmail) {
      const email = extractEmailFromText(userText);
      if (email) reservation.customerEmail = sanitizeEmail(email);
    }
    
    // STEP 7: Merge e fix action
    const merged = StateManager.mergeReservation(callId, reservation);
    response.reservation = merged;
    
    // Safety net: create_reservation senza dati minimi
    if (response.action === "create_reservation") {
      if (!merged.date) response.action = "ask_date";
      else if (!merged.time) response.action = "ask_time";
      else if (!merged.people) response.action = "ask_people";
      else if (!merged.name) response.action = "ask_name";
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // FIX v3.9.6: CORREGGI reply_text SE ORARIO/DATA SONO STATI MODIFICATI
    // Quando facciamo override, GPT ha risposto con dati sbagliati.
    // Dobbiamo correggere il testo per evitare confusione al cliente.
    // ═══════════════════════════════════════════════════════════════════════
    if (response.reply_text && merged.time && gptOriginalTime && gptOriginalTime !== merged.time) {
      const oldTimeDisplay = TimeManager.formatForDisplay(gptOriginalTime); // "21:30"
      const newTimeDisplay = TimeManager.formatForDisplay(merged.time);     // "22:00"
      
      // Sostituisci tutte le varianti dell'orario sbagliato
      const oldHour = parseInt(gptOriginalTime.split(':')[0]);
      const oldMin = parseInt(gptOriginalTime.split(':')[1]);
      const newHour = parseInt(merged.time.split(':')[0]);
      const newMin = parseInt(merged.time.split(':')[1]);
      
      let fixedText = response.reply_text;
      
      // Pattern da sostituire: "21:30", "21.30", "alle 21:30", "alle 21", "ore 21:30", "ore 21"
      // Solo se i minuti sono diversi o l'ora è diversa
      if (oldHour !== newHour || oldMin !== newMin) {
        // Formato HH:MM
        fixedText = fixedText.replace(new RegExp(oldTimeDisplay.replace(':', '[:\\.]'), 'g'), newTimeDisplay);
        
        // Formato "alle X" o "ore X" (senza minuti) - solo se l'ora è diversa
        if (oldHour !== newHour) {
          // "alle 21" → "alle 22" (ma non "alle 21:30" che è già gestito sopra)
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
    
    // ═══════════════════════════════════════════════════════════════════════
    // FIX v3.9.11: CORREZIONE REPLY_TEXT PER DATA CORRETTA (PRE-COMMIT)
    // Se abbiamo corretto la data con suggestedDate, aggiorniamo il messaggio
    // per confermare la data e continuare il flusso (ask_time, ask_people, etc.)
    // POSIZIONE: Alla FINE del pipeline, dopo che time/people/name sono estratti
    // ═══════════════════════════════════════════════════════════════════════
    if (response._dateWasCorrected) {
      console.log(`📝 FIX v3.9.11: Data corretta a ${merged.date} - costruisco messaggio appropriato`);
      
      const dateDisplay = DateManager.formatForDisplay(merged.date, lang);
      
      // Determina cosa chiedere dopo in base a cosa manca VERAMENTE
      // A questo punto time, people, name sono già stati estratti dal messaggio utente
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
        // Ha già tutto! Chiedi solo email
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
    
    // ═══════════════════════════════════════════════════════════════════════
    // FIX v3.9.18: GESTIONE RIFIUTO EMAIL
    // Se GPT chiede email ma il cliente rifiuta ("no grazie", "no thanks")
    // E abbiamo tutti i dati essenziali → forza create_reservation
    // GPT a volte insiste sull'email anche se è opzionale
    // ═══════════════════════════════════════════════════════════════════════
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
// SEZIONE 15: GPT SERVICE (SEMPLIFICATO v3)
// System prompt snello - cancel/modify gestiti altrove
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
    
    // Stato prenotazione
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

    // FIX v3.6: Istruzione lingua ESPLICITA
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

Per gruppi >${largeGroupThreshold}: "prenotazione soggetta a conferma"

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
    
    // Validation Pipeline
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
  // FIX P3: Language detection migliorata
  detectLanguageSwitch(text) {
    const t = (text || "").toLowerCase();
    // Richiesta esplicita
    if (t.includes("speak english") || t.includes("in english")) return "en-US";
    if (t.includes("parla italiano") || t.includes("in italiano")) return "it-IT";
    return null;
  },
  
  // FIX P3 v3.5: Rileva se il testo è in inglese - pattern migliorati
  detectLanguageFromContent(text) {
    const t = (text || "").toLowerCase();
    
    // Pattern comuni inglesi (non presenti in italiano)
    const englishPatterns = [
      // Saluti e cortesie
      /^hi\b|^hello\b|^hey\b/,                    // Inizio con saluto
      /\b(hi|hello|hey)\b.*\b(like|want|need)\b/, // "Hi, I'd like..."
      /\bplease\b|\bthank you\b|\bthanks\b/,
      
      // Pronomi e verbi inglesi
      /\bi('d| would| want| need| have| am)\b/,   // I'd, I would, I want, I need, I have, I am
      /\bwe (need|want|are|have)\b/,              // We need, We want, We are
      /\b(can|could|may|would) (i|we|you)\b/,     // Can I, Could we, May I
      
      // Prenotazioni
      /\b(book|booking|reservation)\b/,
      /\btable\b/,                                 // "table" da solo
      /\bfor (dinner|lunch|breakfast)\b/,         // for dinner, for lunch
      /\bat (dinner|lunch|breakfast)\b/,          // at dinner, at lunch
      
      // Tempo
      /\b(tonight|tomorrow|today)\b/,
      /\bday after tomorrow\b/,
      /\b(this|next) (week|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/,
      
      // Giorni in inglese (senza "on")
      /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/,
      
      // Orari
      /\b\d{1,2}\s*(pm|am)\b/,                    // 8pm, 8 pm
      /\bat \d{1,2}(:\d{2})?\b/,                  // at 8, at 8:30
      
      // Numeri di persone
      /\bfor \d+ (people|persons|guests)\b/,      // for 4 people
      /\b\d+ (people|persons|guests)\b/,          // 4 people
      /\bparty of \d+\b/,                         // party of 4
      
      // Nome
      /\b(the name is|my name is|name is|under the name|under)\b/,
      
      // Domande
      /\bdo you have\b|\bis there\b|\bare there\b/,
      /\bwhat time\b|\bwhat day\b/,
      
      // Cancellazioni/Modifiche
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
  res.status(200).send("✅ Prenow Gateway v3.9.18 attivo!");
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
    // Multi-tenant
    if (isDebug && To) await Registry.getConfigForCall(callId, To);
    
    // Salva testo e gestisci lingua
    StateManager.appendUserText(callId, userText);
    
    // FIX P3: Language detection migliorata
    // Prima: richiesta esplicita ("speak english")
    const langSwitch = TwilioHelpers.detectLanguageSwitch(userText);
    if (langSwitch) StateManager.setLanguage(callId, langSwitch);
    // Twilio language header
    if (Language?.startsWith("en")) StateManager.setLanguage(callId, "en-US");
    if (Language?.startsWith("it")) StateManager.setLanguage(callId, "it-IT");
    // FIX P3: Rileva lingua dal contenuto (solo se non già impostata o default italiano)
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
    // ═══════════════════════════════════════════════════════════════════════
    if (!StateManager.getInitialIntent(callId)) {
      const detectedIntent = IntentDetector.detectIntent(userText);
      StateManager.setInitialIntent(callId, detectedIntent);
      
      // Se cancel/modify, cerca prenotazione esistente
      if ((detectedIntent === 'cancel' || detectedIntent === 'modify') && From) {
        try {
          const existing = await CalendarService.findExistingReservation(From, null, callId);
          if (existing) {
            StateManager.setExistingReservation(callId, existing);
            StateManager.setPhase(callId, 'awaiting_name'); // NUOVO: prima chiedi nome!
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
    // Se l'utente vuole cancellare/modificare ma non abbiamo trovato prenotazioni
    // ═══════════════════════════════════════════════════════════════════════
    if ((initialIntent === 'cancel' || initialIntent === 'modify') && !existingRes && phase === 'initial') {
      console.log(`⚠️ Intent ${initialIntent} ma nessuna prenotazione trovata per ${From}`);
      
      const replyText = lang === "en-US"
        ? "I'm sorry, I couldn't find a reservation under your phone number. Could you please provide the name on the reservation, or would you like to make a new booking?"
        : "Mi dispiace, non ho trovato prenotazioni con questo numero di telefono. Puoi dirmi il nome della prenotazione, oppure vuoi fare una nuova prenotazione?";
      
      // Cambia fase per evitare loop
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
      
      // Il cliente ha risposto dopo che gli abbiamo detto "il ristoratore confermerà"
      // Non deve poter "confermare" da solo!
      const replyText = lang === "en-US"
        ? "Your request has been registered. The restaurant will contact you to confirm the reservation. Is there anything else I can help you with?"
        : "La tua richiesta è stata registrata. Il ristorante ti contatterà per confermare la prenotazione. Posso aiutarti con altro?";
      
      // Dopo questa risposta, resetta la fase
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
    // v3.2: FLUSSO CON VERIFICA NOME per CANCEL/MODIFY
    // 1. Chiedi nome → 2. Verifica match → 3. RECAP → 4. Esegui
    // ═══════════════════════════════════════════════════════════════════════
    if (existingRes && (initialIntent === 'cancel' || initialIntent === 'modify')) {
      let replyText = "";
      let action = "none";
      let shouldHangup = false;
      
      // ═══════════════════════════════════════════════════════════════════
      // FASE COMUNE: AWAITING_NAME - Chiedi nome per double-check
      // ═══════════════════════════════════════════════════════════════════
      if (phase === 'awaiting_name') {
        // Primo messaggio: chiedi nome
        replyText = RecapManager.buildAskNameMessage(lang);
        StateManager.setPhase(callId, 'verifying_name');
        console.log(`📍 Chiedo nome per verifica`);
      }
      else if (phase === 'verifying_name') {
        // Utente ha detto il nome, verifichiamo
        const saidName = RecapManager.extractName(userText);
        console.log(`📍 Nome detto: "${saidName}", Nome prenotazione: "${existingRes.name}"`);
        
        if (saidName && RecapManager.nameMatches(saidName, existingRes.name)) {
          // MATCH! Procedi con RECAP
          console.log(`✅ Nome verificato! Match confermato.`);
          
          if (initialIntent === 'cancel') {
            replyText = RecapManager.buildCancelRecapMessage(existingRes, lang);
            StateManager.setPhase(callId, 'awaiting_cancel_confirm');
          } else {
            // Modify: mostra RECAP e chiedi cosa vuole modificare
            replyText = RecapManager.buildModifyRecapMessage(existingRes, "", lang);
            StateManager.setPhase(callId, 'awaiting_modify_details');
          }
        } else {
          // NO MATCH!
          console.log(`❌ Nome non corrisponde!`);
          replyText = RecapManager.buildNameMismatchMessage(saidName || userText, lang);
          StateManager.setPhase(callId, 'completed'); // Termina flusso
        }
      }
      
      // ═══════════════════════════════════════════════════════════════════
      // CANCELLAZIONE: Conferma esplicita (azione irreversibile)
      // ═══════════════════════════════════════════════════════════════════
      else if (initialIntent === 'cancel' && phase === 'awaiting_cancel_confirm') {
        if (RecapManager.isConfirming(userText)) {
          // Conferma ricevuta → esegui cancellazione
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
          // Non vuole più cancellare
          replyText = lang === "en-US"
            ? "No problem, the reservation stays confirmed. Anything else I can help with?"
            : "Nessun problema, la prenotazione resta confermata. Posso aiutarti con altro?";
          StateManager.setPhase(callId, 'completed');
        }
        else {
          // Non ho capito, richiedi conferma
          replyText = lang === "en-US"
            ? "Do you confirm the cancellation? Say yes or no."
            : "Confermi la cancellazione? Dimmi sì o no.";
        }
      }
      
      // ═══════════════════════════════════════════════════════════════════
      // MODIFICA: Raccolta dettagli e conferma
      // ═══════════════════════════════════════════════════════════════════
      else if (initialIntent === 'modify') {
        
        if (phase === 'awaiting_modify_details') {
          // Attendiamo che ci dica cosa vuole modificare
          const modification = RecapManager.extractModification(userText, existingRes);
          
          if (modification.newTime || modification.newDate || modification.newPeople) {
            // Ha detto cosa vuole → salva e chiedi conferma
            STATE.pendingModifications = STATE.pendingModifications || new Map();
            STATE.pendingModifications.set(callId, modification);
            
            const firstName = existingRes.name?.split(' ')[0] || existingRes.name;
            
            // Conta modifiche
            const modCount = (modification.newTime ? 1 : 0) + (modification.newDate ? 1 : 0) + (modification.newPeople ? 1 : 0);
            
            if (modCount >= 2) {
              // Modifiche multiple
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
            // Non ha specificato → chiedi di nuovo
            replyText = RecapManager.buildAskWhatToModify(existingRes, lang);
          }
        }
        else if (phase === 'awaiting_modify_confirm') {
          // Abbiamo proposto una modifica, attendiamo conferma
          if (RecapManager.isConfirming(userText)) {
            // Conferma → esegui la modifica pendente
            const pending = STATE.pendingModifications?.get(callId) || {};
            const updatedRes = { ...existingRes };
            
            if (pending.newTime) updatedRes.time = pending.newTime;
            if (pending.newDate) updatedRes.date = pending.newDate;
            if (pending.newPeople) updatedRes.people = pending.newPeople;
            
            // Verifica chiusura se cambia data
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
            
            // Esegui modifica
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
              replyText = CalendarService.buildAlternativesMessage(alternatives, lang);
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
            // Non vuole quella modifica → chiedi cosa vuole
            replyText = RecapManager.buildAskWhatToModify(existingRes, lang);
            StateManager.setPhase(callId, 'awaiting_modify_details');
          }
          else {
            // Potrebbe aver detto una nuova modifica
            const newMod = RecapManager.extractModification(userText, existingRes);
            if (newMod.newTime || newMod.newDate || newMod.newPeople) {
              // Nuova modifica → aggiorna pending e chiedi conferma
              STATE.pendingModifications.set(callId, newMod);
              const firstName = existingRes.name?.split(' ')[0] || existingRes.name;
              
              // Conta modifiche
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
              // Non capito → richiedi
              replyText = lang === "en-US"
                ? "Sorry, I didn't catch that. Do you confirm the change?"
                : "Scusa, non ho capito. Confermi la modifica?";
            }
          }
        }
        else if (phase === 'completed') {
          // Fall through to GPT
          console.log(`📍 MODIFY completed, passo a GPT`);
        }
      }
      
      // Se phase === 'completed' per cancel, passa a GPT
      if (initialIntent === 'cancel' && phase === 'completed') {
        console.log(`📍 CANCEL completed, passo a GPT`);
      }
      
      // Se abbiamo una risposta dal flusso deterministico, ritornala
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
    
    console.log(`📤 GPT: action=${action}, reply="${replyText.substring(0, 60)}..."`);
    
    // ═══════════════════════════════════════════════════════════════════════
    // GESTIONE CREATE_RESERVATION
    // ═══════════════════════════════════════════════════════════════════════
    if (action === "create_reservation" && reservation?.date && reservation?.time && reservation?.name) {
      const thresholds = ContextService.getThresholds(callId);
      const people = reservation.people || 2;
      const isLargeGroup = people > thresholds.largeGroup;
      
      // Evento gigante
      if (people >= thresholds.event) {
        const email = ContextService.getRestaurantEmail(callId);
        replyText = lang === "en-US"
          ? `For groups over ${thresholds.event}, please email ${email}.`
          : `Per gruppi oltre ${thresholds.event} persone, scrivi a ${email}.`;
        action = "none";
      }
      // Gruppo grande (>10 <45)
      else if (isLargeGroup) {
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
            const firstName = reservation.name.split(' ')[0];
            const dateDisplay = DateManager.formatForDisplay(reservation.date, lang);
            const timeDisplay = reservation.time.substring(0, 5);
            replyText = lang === "en-US"
              ? `Thank you ${firstName}! Request registered for ${people} people on ${dateDisplay} at ${timeDisplay}. The restaurant will confirm shortly.`
              : `Grazie ${firstName}! Richiesta registrata per ${people} persone ${dateDisplay} alle ${timeDisplay}. Il ristoratore confermerà a breve.`;
            
            // FIX v3.7: Salva stato PENDING per intercettare risposte successive
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
      // Prenotazione normale
      else {
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
║  🚀 PRENOW GATEWAY v3.9.18 AVVIATO                            ║
║  📍 Porta: ${CONFIG.PORT}                                            ║
║  🌐 URL: ${CONFIG.BASE_URL}                         ║
║  ✨ FIX: Gestione rifiuto email → create_reservation           ║
╚═══════════════════════════════════════════════════════════════╝
  `);
});
