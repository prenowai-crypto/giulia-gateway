// ═══════════════════════════════════════════════════════════════════════════════
// PRENOW - RECEPTIONIST AI GATEWAY v2.0
// Riscrittura completa con architettura pulita
// ═══════════════════════════════════════════════════════════════════════════════

import express from "express";
import bodyParser from "body-parser";
import cors from "cors";

const app = express();

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 1: CONFIGURAZIONE
// ═══════════════════════════════════════════════════════════════════════════════

const CONFIG = {
  // Nomi default
  RECEPTIONIST_NAME: process.env.RECEPTIONIST_NAME || "Giulia",
  DEFAULT_RESTAURANT_NAME: process.env.RESTAURANT_NAME || "Ristorante",
  OWNER_EMAIL_DEFAULT: process.env.OWNER_EMAIL || "prenowai@gmail.com",
  
  // Multi-tenant Registry
  REGISTRY_SHEET_ID: "1AdXq1EagVhPsX-UT4HENfuQ1mxUN39kWtECiY6he8bg",
  REGISTRY_SHEET_NAME: "Registry",
  REGISTRY_CACHE_TTL: 5 * 60 * 1000, // 5 minuti
  
  // Apps Script default
  APPS_SCRIPT_URL: process.env.APPS_SCRIPT_URL || 
    "https://script.google.com/macros/s/AKfycbx39h60wqJ0TwLy9PzZyZTqCPV_eGid4j0NOF1FsHJyi411mWyOtZZYC_Z68htZSonqlg/exec",
  
  // Server
  BASE_URL: process.env.BASE_URL || "https://giulia-gateway.onrender.com",
  PORT: process.env.PORT || 10000,
  
  // Soglie gruppi
  LARGE_GROUP_THRESHOLD: 10,
  EVENT_THRESHOLD: 45,
  
  // Giorni chiusura settimanale (0=Domenica, 1=Lunedì, ..., 6=Sabato)
  WEEKLY_CLOSING_DAYS: [1], // Lunedì
  
  // GPT
  GPT_MODEL: "gpt-4o-mini",
  GPT_MAX_TOKENS: 300,
  GPT_TEMPERATURE: 0.2,
};

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 2: STATO IN MEMORIA
// ═══════════════════════════════════════════════════════════════════════════════

const STATE = {
  // Conversazioni GPT per chiamata
  conversations: new Map(),
  
  // Lingua per chiamata (it-IT | en-US)
  languages: new Map(),
  
  // Cronologia testi utente
  userTexts: new Map(),
  
  // Contesto ristorante per chiamata
  contexts: new Map(),
  
  // Stato prenotazione per chiamata
  reservations: new Map(),
  
  // Config ristorante per chiamata (multi-tenant)
  restaurantConfigs: new Map(),
  
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
// SEZIONE 4: STATE MANAGEMENT FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

const StateManager = {
  // --- Lingua ---
  getLanguage(callId) {
    return STATE.languages.get(callId) || "it-IT";
  },
  
  setLanguage(callId, lang) {
    if (callId) STATE.languages.set(callId, lang);
  },
  
  // --- Testi utente ---
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
  
  // --- Prenotazione ---
  getReservation(callId) {
    return STATE.reservations.get(callId) || {
      date: null,
      time: null,
      people: null,
      name: null,
      customerEmail: null,
    };
  },
  
  setReservation(callId, reservation) {
    STATE.reservations.set(callId, reservation);
  },
  
  mergeReservation(callId, newData = {}) {
    const prev = this.getReservation(callId);
    const merged = {
      date: newData.date ?? prev.date,
      time: newData.time ?? prev.time,
      people: newData.people ?? prev.people,
      name: newData.name ?? prev.name,
      customerEmail: newData.customerEmail ?? prev.customerEmail,
    };
    this.setReservation(callId, merged);
    return merged;
  },
  
  // --- Contesto ristorante ---
  getContext(callId) {
    return STATE.contexts.get(callId) || null;
  },
  
  setContext(callId, context) {
    STATE.contexts.set(callId, context);
  },
  
  // --- Config ristorante (multi-tenant) ---
  getRestaurantConfig(callId) {
    return STATE.restaurantConfigs.get(callId) || null;
  },
  
  setRestaurantConfig(callId, config) {
    STATE.restaurantConfigs.set(callId, config);
  },
  
  // --- Conversazione GPT ---
  getConversation(callId) {
    return STATE.conversations.get(callId) || null;
  },
  
  setConversation(callId, convo) {
    STATE.conversations.set(callId, convo);
  },
  
  // --- Cleanup ---
  clearCall(callId) {
    STATE.conversations.delete(callId);
    STATE.languages.delete(callId);
    STATE.userTexts.delete(callId);
    STATE.contexts.delete(callId);
    STATE.reservations.delete(callId);
    STATE.restaurantConfigs.delete(callId);
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 5: MULTI-TENANT REGISTRY
// ═══════════════════════════════════════════════════════════════════════════════

const Registry = {
  async fetch() {
    const now = Date.now();
    
    // Cache valida?
    if (STATE.registryCache && (now - STATE.registryCacheTime) < CONFIG.REGISTRY_CACHE_TTL) {
      return STATE.registryCache;
    }
    
    try {
      const url = `https://docs.google.com/spreadsheets/d/${CONFIG.REGISTRY_SHEET_ID}/gviz/tq?tqx=out:json&sheet=${CONFIG.REGISTRY_SHEET_NAME}`;
      console.log("🌐 Registry: fetch da Google Sheets...");
      
      const response = await fetch(url);
      const text = await response.text();
      
      const jsonMatch = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);?$/);
      if (!jsonMatch) {
        console.error("❌ Registry: formato risposta non valido");
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
          if (key) {
            obj[key] = cell ? (cell.v !== null ? cell.v : "") : "";
          }
        });
        return obj;
      });
      
      console.log(`✅ Registry: caricati ${registry.length} ristoranti`);
      
      STATE.registryCache = registry;
      STATE.registryCacheTime = now;
      
      return registry;
    } catch (err) {
      console.error("❌ Registry: errore fetch:", err);
      return STATE.registryCache || [];
    }
  },
  
  async getByTwilioNumber(twilioNumber) {
    if (!twilioNumber) return null;
    
    const registry = await this.fetch();
    const normalizedInput = twilioNumber.replace(/\s/g, "").trim();
    
    const match = registry.find(r => {
      if (!r.twilio_number) return false;
      const normalizedRegistry = String(r.twilio_number).replace(/\s/g, "").trim();
      return normalizedRegistry === normalizedInput;
    });
    
    if (match) {
      console.log(`✅ Registry: trovato "${match.restaurant_name}" per ${twilioNumber}`);
    } else {
      console.warn(`⚠️ Registry: nessun ristorante per ${twilioNumber}`);
    }
    
    return match || null;
  },
  
  async getConfigForCall(callId, twilioNumber = null) {
    // Già in cache?
    const cached = StateManager.getRestaurantConfig(callId);
    if (cached) return cached;
    
    // Cerca nel registry
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
    if (config?.apps_script_url?.trim()) {
      return config.apps_script_url.trim();
    }
    return CONFIG.APPS_SCRIPT_URL;
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 6: DATE MANAGER (CENTRALIZZATO)
// ═══════════════════════════════════════════════════════════════════════════════

const DateManager = {
  // Giorni della settimana
  DAYS_IT: ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'],
  DAYS_EN: ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
  MONTHS_IT: ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 
              'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'],
  
  // Ottieni data/ora corrente in Rome
  getNow() {
    const nowString = new Date().toLocaleString("en-US", { timeZone: "Europe/Rome" });
    return new Date(nowString);
  },
  
  // Inizio giornata
  startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  },
  
  // Aggiungi giorni
  addDays(date, days) {
    const d = new Date(date.getTime());
    d.setDate(d.getDate() + days);
    return d;
  },
  
  // Converti in ISO (YYYY-MM-DD)
  toISO(date) {
    if (!date || isNaN(date.getTime())) return null;
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  },
  
  // Ottieni giorno della settimana da data ISO
  getDayOfWeek(dateISO) {
    if (!dateISO) return null;
    const [y, m, d] = dateISO.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    return date.getDay(); // 0=Domenica, 1=Lunedì, ...
  },
  
  // Ottieni nome giorno in italiano
  getDayName(dateISO, lang = "it-IT") {
    const dayOfWeek = this.getDayOfWeek(dateISO);
    if (dayOfWeek === null) return null;
    return lang === "en-US" ? this.DAYS_EN[dayOfWeek] : this.DAYS_IT[dayOfWeek];
  },
  
  // Formatta data per display
  formatForDisplay(dateISO, lang = "it-IT") {
    if (!dateISO) return "";
    try {
      const [y, m, d] = dateISO.split("-").map(Number);
      const date = new Date(y, m - 1, d);
      return date.toLocaleDateString(lang, { 
        weekday: 'long', 
        day: 'numeric', 
        month: 'long' 
      });
    } catch (e) {
      return dateISO;
    }
  },
  
  // Prossimo giorno della settimana (0=Dom, 1=Lun, ...)
  getNextWeekday(fromDate, targetWeekday) {
    const result = new Date(fromDate.getTime());
    const diff = ((targetWeekday - result.getDay()) + 7) % 7 || 7;
    result.setDate(result.getDate() + diff);
    return result;
  },
  
  // Questo sabato
  getThisSaturday(fromDate) {
    const day = fromDate.getDay();
    const diff = (6 - day + 7) % 7;
    const result = new Date(fromDate.getTime());
    result.setDate(result.getDate() + diff);
    return result;
  },
  
  // Sabato prossimo
  getNextSaturday(fromDate) {
    const thisSat = this.getThisSaturday(fromDate);
    return this.addDays(thisSat, 7);
  },
  
  // Costruisci calendario prossimi N giorni
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
        dayNameEN: this.DAYS_EN[dayOfWeek],
        isClosed,
        label: i === 0 ? "OGGI" : i === 1 ? "domani" : i === 2 ? "dopodomani" : null,
      });
    }
    
    return calendar;
  },
  
  // ═══════════════════════════════════════════════════════════════════════════
  // PARSING DATE DA TESTO (FUNZIONE PRINCIPALE)
  // ═══════════════════════════════════════════════════════════════════════════
  parseFromText(text, callId = null) {
    if (!text) return null;
    
    const t = normalizeText(text);
    const now = this.getNow();
    const today = this.startOfDay(now);
    
    // 1. Pattern espliciti: "10 dicembre", "21 december"
    const explicitDate = this._parseExplicitDate(t, today);
    if (explicitDate) {
      console.log(`📆 Data esplicita estratta: "${text}" → ${explicitDate}`);
      return explicitDate;
    }
    
    // 2. Pattern relativi: "domani", "dopodomani", "stasera"
    const relativeDate = this._parseRelativeDate(t, today);
    if (relativeDate) {
      console.log(`📆 Data relativa estratta: "${text}" → ${relativeDate}`);
      return relativeDate;
    }
    
    // 3. Giorni della settimana: "martedì", "sabato prossimo"
    const weekdayDate = this._parseWeekdayDate(t, today);
    if (weekdayDate) {
      console.log(`📆 Giorno settimana estratto: "${text}" → ${weekdayDate}`);
      return weekdayDate;
    }
    
    // 4. Se c'è cronologia, cerca anche lì
    if (callId) {
      const allText = StateManager.getAllUserText(callId);
      if (allText && allText !== text) {
        const fromHistory = this.parseFromText(allText, null);
        if (fromHistory) {
          console.log(`📆 Data da cronologia: ${fromHistory}`);
          return fromHistory;
        }
      }
    }
    
    return null;
  },
  
  // Parse data esplicita (es. "10 dicembre")
  _parseExplicitDate(text, today) {
    const monthsMap = {
      'gennaio': 0, 'febbraio': 1, 'marzo': 2, 'aprile': 3, 'maggio': 4, 'giugno': 5,
      'luglio': 6, 'agosto': 7, 'settembre': 8, 'ottobre': 9, 'novembre': 10, 'dicembre': 11,
      'january': 0, 'february': 1, 'march': 2, 'april': 3, 'may': 4, 'june': 5,
      'july': 6, 'august': 7, 'september': 8, 'october': 9, 'november': 10, 'december': 11,
    };
    
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
        
        // Se nel passato, usa anno prossimo
        if (candidate < today) {
          year++;
          candidate = new Date(year, month, day);
        }
        
        return this.toISO(candidate);
      }
    }
    
    return null;
  },
  
  // Parse data relativa (domani, dopodomani, stasera)
  _parseRelativeDate(text, today) {
    // Ordine importante: "dopodomani" prima di "domani"
    if (/dopodomani|dopo domani|day after tomorrow/.test(text)) {
      return this.toISO(this.addDays(today, 2));
    }
    
    if (/domani|tomorrow/.test(text)) {
      return this.toISO(this.addDays(today, 1));
    }
    
    if (/oggi|today|stasera|questa sera|tonight|this evening/.test(text)) {
      return this.toISO(today);
    }
    
    // "tra X giorni"
    const traMatch = text.match(/(?:tra|fra|in)\s*(\d+)\s*giorni/);
    if (traMatch) {
      const days = parseInt(traMatch[1]);
      return this.toISO(this.addDays(today, days));
    }
    
    // "X days from now"
    const daysFromMatch = text.match(/(\d+)\s*days?\s*(?:from now)?/);
    if (daysFromMatch) {
      const days = parseInt(daysFromMatch[1]);
      return this.toISO(this.addDays(today, days));
    }
    
    return null;
  },
  
  // Parse giorno della settimana
  _parseWeekdayDate(text, today) {
    // "sabato prossimo" / "next saturday"
    if (/sabato prossimo|next saturday/.test(text)) {
      return this.toISO(this.getNextSaturday(today));
    }
    
    // "questo sabato" / "this saturday"
    if (/questo sabato|this saturday/.test(text)) {
      return this.toISO(this.getThisSaturday(today));
    }
    
    // "domenica prossima" / "next sunday"
    if (/domenica prossima|next sunday/.test(text)) {
      return this.toISO(this.addDays(this.getNextWeekday(today, 0), 7));
    }
    
    // Giorni generici
    const weekdays = [
      { patterns: ['domenica', 'sunday'], index: 0 },
      { patterns: ['lunedi', 'monday'], index: 1 },
      { patterns: ['martedi', 'tuesday'], index: 2 },
      { patterns: ['mercoledi', 'wednesday'], index: 3 },
      { patterns: ['giovedi', 'thursday'], index: 4 },
      { patterns: ['venerdi', 'friday'], index: 5 },
      { patterns: ['sabato', 'saturday'], index: 6 },
    ];
    
    for (const wd of weekdays) {
      for (const pattern of wd.patterns) {
        if (text.includes(pattern)) {
          return this.toISO(this.getNextWeekday(today, wd.index));
        }
      }
    }
    
    return null;
  },
  
  // ═══════════════════════════════════════════════════════════════════════════
  // VALIDAZIONE GIORNO SETTIMANA
  // Verifica che la risposta GPT non abbia sbagliato
  // ═══════════════════════════════════════════════════════════════════════════
  validateDayInText(dateISO, textToCheck) {
    if (!dateISO || !textToCheck) return { valid: true };
    
    const actualDayOfWeek = this.getDayOfWeek(dateISO);
    const actualDayNameIT = this.DAYS_IT[actualDayOfWeek];
    const actualDayNameEN = this.DAYS_EN[actualDayOfWeek];
    
    const textLower = normalizeText(textToCheck);
    
    // Cerca se c'è un nome di giorno nel testo
    for (let i = 0; i < 7; i++) {
      const dayIT = normalizeText(this.DAYS_IT[i]);
      const dayEN = this.DAYS_EN[i];
      
      if (textLower.includes(dayIT) || textLower.includes(dayEN)) {
        // Trovato un giorno nel testo - corrisponde?
        if (i !== actualDayOfWeek) {
          console.warn(`⚠️ MISMATCH GIORNO: testo dice "${this.DAYS_IT[i]}" ma ${dateISO} è ${actualDayNameIT}`);
          return {
            valid: false,
            foundDay: this.DAYS_IT[i],
            actualDay: actualDayNameIT,
            actualDayEN: actualDayNameEN,
          };
        }
      }
    }
    
    return { valid: true };
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 7: TIME MANAGER
// ═══════════════════════════════════════════════════════════════════════════════

const TimeManager = {
  // Estrai orario dal testo
  parseFromText(text) {
    if (!text) return null;
    
    const t = text.toLowerCase().trim();
    
    // "mezzogiorno"
    if (/mezzogiorno|noon/.test(t)) {
      return "12:00:00";
    }
    
    // "mezzanotte"
    if (/mezzanotte|midnight/.test(t)) {
      return "00:00:00";
    }
    
    // "alle 20", "alle 20:30", "ore 20"
    const itMatch = t.match(/(?:alle|ore|per le)\s*(\d{1,2})(?::(\d{2}))?/i);
    if (itMatch) {
      let hour = parseInt(itMatch[1]);
      const minutes = itMatch[2] ? parseInt(itMatch[2]) : 0;
      
      // Assumi sera se ora ambigua (8 → 20)
      if (hour >= 1 && hour <= 11 && !t.includes("mattina") && !t.includes("pranzo")) {
        hour += 12;
      }
      
      return `${String(hour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
    }
    
    // "at 8", "at 8:30", "at 8pm"
    const enMatch = t.match(/at\s*(\d{1,2})(?::(\d{2}))?\s*(pm|am)?/i);
    if (enMatch) {
      let hour = parseInt(enMatch[1]);
      const minutes = enMatch[2] ? parseInt(enMatch[2]) : 0;
      const ampm = enMatch[3]?.toLowerCase();
      
      if (ampm === 'pm' && hour < 12) hour += 12;
      if (ampm === 'am' && hour === 12) hour = 0;
      if (!ampm && hour >= 1 && hour <= 11) hour += 12;
      
      return `${String(hour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
    }
    
    // "20:30" diretto
    const directMatch = t.match(/\b(\d{1,2}):(\d{2})\b/);
    if (directMatch) {
      const hour = parseInt(directMatch[1]);
      const minutes = parseInt(directMatch[2]);
      if (hour >= 0 && hour <= 23 && minutes >= 0 && minutes <= 59) {
        return `${String(hour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
      }
    }
    
    // "le nove e mezza", "le otto"
    const wordMatch = t.match(/le\s*([\w]+)(?:\s*e\s*(mezza|mezzo))?/i);
    if (wordMatch) {
      const numberWords = {
        'una': 13, 'due': 14, 'tre': 15, 'quattro': 16, 'cinque': 17,
        'sei': 18, 'sette': 19, 'otto': 20, 'nove': 21, 'dieci': 22,
        'undici': 23, 'dodici': 12,
      };
      const hourWord = wordMatch[1].toLowerCase();
      const halfHour = wordMatch[2] ? 30 : 0;
      
      if (numberWords[hourWord]) {
        const hour = numberWords[hourWord];
        return `${String(hour).padStart(2, '0')}:${String(halfHour).padStart(2, '0')}:00`;
      }
    }
    
    return null;
  },
  
  // Inferisci orario di default
  inferDefault(text) {
    if (!text) return null;
    
    const t = normalizeText(text);
    
    if (/pranzo|lunch/.test(t)) return "13:00:00";
    if (/sera|serale|cena|dinner|evening/.test(t)) return "20:00:00";
    if (/tardi|late/.test(t)) return "21:30:00";
    
    return null;
  },
  
  // Format per display
  formatForDisplay(timeStr) {
    if (!timeStr) return "";
    return timeStr.substring(0, 5); // "20:30:00" → "20:30"
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 8: PEOPLE MANAGER
// ═══════════════════════════════════════════════════════════════════════════════

const PeopleManager = {
  parseFromText(text) {
    if (!text) return null;
    
    const t = text.toLowerCase().trim();
    
    const patterns = [
      /(?:per|siamo|saremo|in)\s*(\d+)\s*(?:person[ae]|pax)?/i,
      /(\d+)\s*(?:person[ae]|pax|coperti|guests|people)/i,
      /(?:for|we are|we'll be)\s*(\d+)/i,
      /(?:tavolo|table)\s*(?:per|for)\s*(\d+)/i,
    ];
    
    for (const pattern of patterns) {
      const match = t.match(pattern);
      if (match) {
        const num = parseInt(match[1]);
        if (num > 0 && num < 100) return num;
      }
    }
    
    // Numeri in parole
    const wordNumbers = {
      'due': 2, 'tre': 3, 'quattro': 4, 'cinque': 5, 'sei': 6,
      'sette': 7, 'otto': 8, 'nove': 9, 'dieci': 10,
      'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6,
      'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
    };
    
    for (const [word, num] of Object.entries(wordNumbers)) {
      if (t.includes(word)) return num;
    }
    
    return null;
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 9: CLOSURE CHECKER (CENTRALIZZATO - SEMPRE ATTIVO)
// ═══════════════════════════════════════════════════════════════════════════════

const ClosureChecker = {
  // ═══════════════════════════════════════════════════════════════════════════
  // FUNZIONE PRINCIPALE: Verifica se un giorno è aperto
  // QUESTA FUNZIONE È CHIAMATA SEMPRE, NON DIPENDE DA COSA DICE GPT
  // ═══════════════════════════════════════════════════════════════════════════
  async isOpen(dateISO, callId = null) {
    if (!dateISO) {
      return { open: true, reason: null };
    }
    
    console.log(`🔍 ClosureChecker: verifico ${dateISO}...`);
    
    // STEP 1: Check chiusura settimanale (LOCALE - senza API call)
    const dayOfWeek = DateManager.getDayOfWeek(dateISO);
    
    if (CONFIG.WEEKLY_CLOSING_DAYS.includes(dayOfWeek)) {
      const dayName = DateManager.getDayName(dateISO, "it-IT");
      console.log(`⛔ CHIUSO: ${dateISO} è ${dayName} (chiusura settimanale)`);
      return {
        open: false,
        reason: `chiusura_settimanale`,
        dayName,
        message_it: `Il ristorante è chiuso il ${dayName}.`,
        message_en: `The restaurant is closed on ${DateManager.getDayName(dateISO, "en-US")}s.`,
      };
    }
    
    // STEP 2: Check chiusure straordinarie (API call ad Apps Script)
    try {
      const appsScriptUrl = Registry.getAppsScriptUrl(callId);
      
      const response = await fetch(appsScriptUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "check_closure",
          data: dateISO,
        }),
      });
      
      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        console.error("❌ ClosureChecker: risposta non JSON:", text);
        return { open: true, reason: null };
      }
      
      if (data.isClosed === true) {
        console.log(`⛔ CHIUSO: ${dateISO} - ${data.reason}`);
        return {
          open: false,
          reason: "chiusura_straordinaria",
          message_it: data.reason || "Giorno di chiusura straordinaria",
          message_en: "Exceptional closing day",
        };
      }
      
      console.log(`✅ APERTO: ${dateISO}`);
      return { open: true, reason: null };
      
    } catch (err) {
      console.error("❌ ClosureChecker: errore API:", err);
      // In caso di errore, non blocchiamo (fail-safe)
      return { open: true, reason: null };
    }
  },
  
  // Costruisce messaggio per giorno chiuso
  buildClosedMessage(dateISO, closureResult, lang = "it-IT") {
    const dateDisplay = DateManager.formatForDisplay(dateISO, lang);
    
    if (closureResult.reason === "chiusura_settimanale") {
      if (lang === "en-US") {
        return `I'm sorry, but the restaurant is closed on ${closureResult.dayName}s. Would you like to book for another day?`;
      } else {
        return `Mi dispiace, ma il ristorante è chiuso il ${closureResult.dayName}. Vuoi prenotare per un altro giorno?`;
      }
    }
    
    if (lang === "en-US") {
      return `I'm sorry, but the restaurant will be closed on ${dateDisplay}. Would you like to book for another day?`;
    } else {
      return `Mi dispiace, ma il ristorante sarà chiuso ${dateDisplay}. Vuoi prenotare per un altro giorno?`;
    }
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 10: NAME MANAGER (Protezione nome da comandi)
// ═══════════════════════════════════════════════════════════════════════════════

const NameManager = {
  // Parole che potrebbero essere confuse con comandi
  COMMAND_WORDS: [
    'cancella', 'cancello', 'cancellare', 'cancellazione',
    'disdetta', 'disdire', 'disdico',
    'annulla', 'annullare', 'annullo', 'annullamento',
    'elimina', 'eliminare', 'modifica', 'modificare',
    'cancel', 'delete', 'remove',
  ],
  
  // Pattern che indicano "sto dicendo il mio nome"
  NAME_PATTERNS: [
    /\b(?:mi chiamo|sono|a nome|nome è|il nome è)\s+(.+)/i,
    /\b(?:my name is|i'm|i am|the name is|under|call me)\s+(.+)/i,
  ],
  
  // Verifica se l'utente sta fornendo il nome
  isProvidingName(text) {
    if (!text) return false;
    const t = text.toLowerCase();
    return this.NAME_PATTERNS.some(p => p.test(t));
  },
  
  // Estrai nome dal testo
  extractName(text) {
    if (!text) return null;
    
    for (const pattern of this.NAME_PATTERNS) {
      const match = text.match(pattern);
      if (match && match[1]) {
        let name = match[1].trim().replace(/[.,!?]+$/, '').trim();
        if (name.length > 1) {
          // Capitalizza ogni parola
          return name.split(/\s+/)
            .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
            .join(' ');
        }
      }
    }
    
    return null;
  },
  
  // Estrai nome "bare" (senza pattern espliciti)
  extractBareName(text) {
    if (!text) return null;
    
    let cleaned = text.trim().replace(/[.,!?]+$/, '').trim();
    
    // Troppo lungo? Probabilmente non è un nome
    const words = cleaned.split(/\s+/);
    if (words.length > 4) return null;
    
    // Contiene numeri o simboli? Non è un nome
    if (/\d|@|#|\$|%/.test(cleaned)) return null;
    
    // Troppo corto?
    if (cleaned.length < 2) return null;
    
    // Capitalizza
    return words
      .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
  },
  
  // Verifica se il nome contiene parole "pericolose"
  containsCommandWord(name) {
    if (!name) return false;
    const t = name.toLowerCase();
    return this.COMMAND_WORDS.some(w => t.includes(w));
  },
  
  // Verifica se GPT sta confondendo un nome con un comando
  isGptConfusingName(action, replyText, reservationState) {
    if (action !== "cancel_reservation") return false;
    if (!replyText) return false;
    
    const reply = replyText.toLowerCase();
    
    // GPT menziona cancellazione?
    const mentionsCancellation = (
      reply.includes("cancell") ||
      reply.includes("disdett") ||
      reply.includes("annull") ||
      reply.includes("quale giorno vuoi cancellare")
    );
    
    if (!mentionsCancellation) return false;
    
    // Stavamo raccogliendo dati per una prenotazione?
    const hasDate = reservationState?.date;
    const hasTime = reservationState?.time;
    const hasPeople = reservationState?.people > 0;
    const hasName = reservationState?.name;
    
    // Se abbiamo già dati ma NON il nome → probabilmente stavamo chiedendo il nome
    if ((hasDate || hasTime || hasPeople) && !hasName) {
      return true;
    }
    
    return false;
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 11: CALENDAR SERVICE
// ═══════════════════════════════════════════════════════════════════════════════

const CalendarService = {
  // Invia prenotazione a Calendar
  async createReservation(data, callId = null) {
    const appsScriptUrl = Registry.getAppsScriptUrl(callId);
    console.log("📅 Calendar: creazione prenotazione", data);
    
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
    try {
      result = JSON.parse(text);
    } catch (e) {
      result = { rawResponse: text };
    }
    
    console.log("📅 Calendar: risposta", result);
    return result;
  },
  
  // Cancella prenotazione
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
    try {
      result = JSON.parse(text);
    } catch (e) {
      result = { rawResponse: text };
    }
    
    console.log("🗑️ Calendar: risposta", result);
    return result;
  },
  
  // Check disponibilità slot
  async checkAvailability(date, time, people, callId = null) {
    if (!date || !time || !people) {
      return { available: true };
    }
    
    const appsScriptUrl = Registry.getAppsScriptUrl(callId);
    console.log(`🔍 Calendar: check slot ${date} ${time} per ${people} pax`);
    
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
      try {
        data = JSON.parse(text);
      } catch (e) {
        return { available: true };
      }
      
      if (data.reason === "day_closed") {
        return { available: false, reason: "day_closed", closureReason: data.closureReason };
      }
      
      if (data.reason === "slot_full") {
        return { available: false, reason: "slot_full" };
      }
      
      return { available: true };
    } catch (err) {
      console.error("❌ Calendar: errore check availability:", err);
      return { available: true };
    }
  },
  
  // Trova slot alternativi
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
      try {
        data = JSON.parse(text);
      } catch (e) {
        return { success: false, sameDay: [], nextDays: [] };
      }
      
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
  
  // Costruisce messaggio con alternative
  buildAlternativesMessage(alternatives, lang = "it-IT") {
    const { sameDay, nextDays } = alternatives;
    
    if (sameDay?.length > 0) {
      const times = sameDay.map(s => s.time).slice(0, 3);
      
      if (lang === "en-US") {
        if (times.length === 1) {
          return `I'm sorry, we're fully booked at that time. I have availability at ${times[0]}. Would that work?`;
        }
        const last = times.pop();
        return `I'm sorry, we're fully booked. I have availability at ${times.join(", ")} or ${last}. Which would you prefer?`;
      } else {
        if (times.length === 1) {
          return `Mi dispiace, a quell'ora siamo al completo. Ho disponibilità alle ${times[0]}. Può andare bene?`;
        }
        const last = times.pop();
        return `Mi dispiace, siamo al completo. Ho disponibilità alle ${times.join(", ")} oppure alle ${last}. Quale preferisci?`;
      }
    }
    
    if (nextDays?.length > 0) {
      const firstDay = nextDays[0];
      const times = firstDay.slots?.map(s => s.time).slice(0, 2) || [];
      
      if (lang === "en-US") {
        return `I'm sorry, we're fully booked today. Next availability is ${firstDay.dayName} at ${times.join(" or ")}. Would you like to book?`;
      } else {
        return `Mi dispiace, per oggi siamo al completo. Prima disponibilità ${firstDay.dayName} alle ${times.join(" o ")}. Vuoi prenotare?`;
      }
    }
    
    return lang === "en-US" 
      ? "I'm sorry, we're fully booked. Would you like to try a different day?"
      : "Mi dispiace, siamo al completo. Vuoi provare con un altro giorno?";
  },
  
  // Notifica evento grande al proprietario
  async notifyLargeEvent(data, callId = null) {
    const appsScriptUrl = Registry.getAppsScriptUrl(callId);
    
    try {
      await fetch(appsScriptUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "notify_big_event",
          nome: data.name,
          persone: data.people,
          data: data.date,
          ora: data.time,
          telefono: data.phone || "",
          email: data.customerEmail || "",
        }),
      });
      console.log("📧 Notifica evento grande inviata");
    } catch (err) {
      console.error("❌ Errore notifica evento grande:", err);
    }
  },
};


// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 12: CONTEXT SERVICE (Caricamento contesto ristorante)
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
      try {
        data = JSON.parse(text);
      } catch (e) {
        console.error("❌ Context: risposta non JSON");
        return this.getDefault();
      }
      
      if (!response.ok || !data || data.success === false) {
        return this.getDefault();
      }
      
      console.log("✅ Context: caricato");
      return data;
    } catch (err) {
      console.error("❌ Context: errore:", err);
      return this.getDefault();
    }
  },
  
  getDefault() {
    return {
      success: false,
      restaurant: {
        name: CONFIG.DEFAULT_RESTAURANT_NAME,
        email: CONFIG.OWNER_EMAIL_DEFAULT,
        address: "",
        phone: "",
        timezone: "Europe/Rome",
        openingHoursText: "",
        closingRulesText: "",
      },
      menu: {
        summaryText: "",
        vegetarianText: "",
        glutenFreeText: "",
        priceRangeText: "",
      },
      rules: {
        largeGroupThreshold: CONFIG.LARGE_GROUP_THRESHOLD,
        eventThreshold: CONFIG.EVENT_THRESHOLD,
        outdoorSeatingText: "",
        bookingPolicyText: "",
      },
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
    if (ctx?.restaurant?.name) return ctx.restaurant.name;
    
    return CONFIG.DEFAULT_RESTAURANT_NAME;
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
// SEZIONE 13: VALIDATION PIPELINE (UNIFICATA)
// ═══════════════════════════════════════════════════════════════════════════════

const ValidationPipeline = {
  /**
   * PIPELINE PRINCIPALE DI VALIDAZIONE
   * Applica tutti i controlli in ordine
   */
  async validate(gptResponse, userText, callId) {
    console.log("🔄 ValidationPipeline: inizio validazione...");
    
    const lang = StateManager.getLanguage(callId);
    const reservationBefore = StateManager.getReservation(callId);
    let response = { ...gptResponse };
    let reservation = response.reservation || {};
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 1: Estrai/completa data dal testo utente - PRIORITÀ INPUT UTENTE
    // ═══════════════════════════════════════════════════════════════════════
    let gptOriginalDate = reservation.date; // Salva data originale GPT per correzione testo
    const parsedDate = DateManager.parseFromText(userText, callId);
    if (parsedDate) {
      // Se l'utente ha menzionato una data/giorno, quella ha SEMPRE priorità
      if (reservation.date && reservation.date !== parsedDate) {
        console.log(`📆 Data relativa estratta: "${userText}" → ${parsedDate}`);
        console.log(`⚠️ STEP 1: GPT aveva ${reservation.date}, utente ha detto ${parsedDate}. Correggo!`);
        
        // Correggi anche la data numerica nel reply_text (es. "30 dicembre" → "31 dicembre")
        if (response.reply_text) {
          const oldDate = new Date(reservation.date + 'T12:00:00');
          const newDate = new Date(parsedDate + 'T12:00:00');
          const oldDay = oldDate.getDate();
          const newDay = newDate.getDate();
          
          if (oldDay !== newDay) {
            // Sostituisci il numero del giorno nel testo
            // Pattern: "30 dicembre", "30 gennaio", etc.
            const months = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 
                           'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
            for (const month of months) {
              const pattern = new RegExp(`\\b${oldDay}\\s+${month}\\b`, 'gi');
              response.reply_text = response.reply_text.replace(pattern, `${newDay} ${month}`);
            }
            console.log(`✅ STEP 1: Corretto testo "${oldDay}" → "${newDay}" nel reply`);
          }
        }
      }
      reservation.date = parsedDate;
      console.log(`✅ STEP 1: Data estratta: ${parsedDate}`);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 2: CHECK CHIUSURA (SEMPRE - questo è il fix principale!)
    // ═══════════════════════════════════════════════════════════════════════
    if (reservation.date) {
      const closureCheck = await ClosureChecker.isOpen(reservation.date, callId);
      
      if (!closureCheck.open) {
        console.log(`⛔ STEP 2: Giorno chiuso! Correggo risposta.`);
        
        response.reply_text = ClosureChecker.buildClosedMessage(reservation.date, closureCheck, lang);
        response.action = "ask_date";
        reservation.date = null;
        
        // Aggiorna stato
        StateManager.mergeReservation(callId, { date: null });
        response.reservation = reservation;
        
        return response;
      }
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 3: Valida giorno settimana - PRIORITÀ ALL'INPUT UTENTE
    // ═══════════════════════════════════════════════════════════════════════
    if (reservation.date) {
      // Prima: controlla se l'UTENTE ha menzionato un giorno specifico
      const userDayValidation = DateManager.validateDayInText(reservation.date, userText);
      
      if (!userDayValidation.valid) {
        // L'utente ha detto un giorno diverso dalla data GPT!
        // CORREGGERE LA DATA per corrispondere al giorno dell'utente
        console.log(`⚠️ STEP 3: Utente ha detto "${userDayValidation.foundDay}" ma GPT ha generato data per ${userDayValidation.actualDay}`);
        
        // Trova l'indice del giorno menzionato dall'utente
        const userDayIndex = DateManager.DAYS_IT.findIndex(d => 
          normalizeText(d) === normalizeText(userDayValidation.foundDay)
        );
        
        if (userDayIndex !== -1) {
          // Ricalcola la data corretta per il giorno menzionato dall'utente
          const today = DateManager.getNow();
          const correctDate = DateManager.getNextWeekday(today, userDayIndex);
          const correctDateISO = DateManager.toISO(correctDate);
          
          console.log(`✅ STEP 3: Corretto DATA ${reservation.date} → ${correctDateISO} (${userDayValidation.foundDay})`);
          
          reservation.date = correctDateISO;
          
          // Aggiorna anche il testo di risposta se menziona il giorno sbagliato
          if (response.reply_text) {
            const wrongDayInReply = userDayValidation.actualDay;
            const correctDayForReply = userDayValidation.foundDay;
            const regex = new RegExp(wrongDayInReply, 'gi');
            response.reply_text = response.reply_text.replace(regex, correctDayForReply);
          }
        }
      } else if (response.reply_text) {
        // L'utente non ha menzionato un giorno, ma controlliamo il reply_text di GPT
        const replyValidation = DateManager.validateDayInText(reservation.date, response.reply_text);
        
        if (!replyValidation.valid) {
          // GPT ha scritto un giorno sbagliato nel testo, correggiamo solo il testo
          console.log(`⚠️ STEP 3: GPT ha scritto giorno sbagliato nel reply, correggo testo.`);
          const wrongDay = replyValidation.foundDay;
          const correctDay = replyValidation.actualDay;
          const regex = new RegExp(wrongDay, 'gi');
          response.reply_text = response.reply_text.replace(regex, correctDay);
          console.log(`✅ STEP 3: Corretto testo "${wrongDay}" → "${correctDay}"`);
        }
      }
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 4: Estrai/completa orario
    // ═══════════════════════════════════════════════════════════════════════
    if (!reservation.time) {
      const parsedTime = TimeManager.parseFromText(userText);
      if (parsedTime) {
        reservation.time = parsedTime;
        console.log(`✅ STEP 4: Orario estratto: ${parsedTime}`);
      } else {
        // Prova inferenza default
        const defaultTime = TimeManager.inferDefault(StateManager.getAllUserText(callId));
        if (defaultTime) {
          reservation.time = defaultTime;
          console.log(`✅ STEP 4: Orario inferito: ${defaultTime}`);
        }
      }
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 5: Estrai/completa persone
    // ═══════════════════════════════════════════════════════════════════════
    if (!reservation.people || reservation.people <= 0) {
      const parsedPeople = PeopleManager.parseFromText(userText);
      if (parsedPeople) {
        reservation.people = parsedPeople;
        console.log(`✅ STEP 5: Persone estratte: ${parsedPeople}`);
      }
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 6: Protezione nome da comandi
    // ═══════════════════════════════════════════════════════════════════════
    if (response.action === "cancel_reservation") {
      // Caso A: Utente sta chiaramente dicendo il nome
      if (NameManager.isProvidingName(userText)) {
        const extractedName = NameManager.extractName(userText);
        
        if (extractedName) {
          console.log(`⚠️ STEP 6: GPT ha confuso nome "${extractedName}" con cancellazione!`);
          
          reservation.name = extractedName;
          
          // Ripristina dati precedenti
          reservation.date = reservationBefore.date || reservation.date;
          reservation.time = reservationBefore.time || reservation.time;
          reservation.people = reservationBefore.people || reservation.people;
          
          // Costruisci risposta corretta
          response.action = "ask_email";
          response.reply_text = lang === "en-US"
            ? `Perfect, ${extractedName}. Would you like to leave an email for confirmation?`
            : `Perfetto, ${extractedName}. Vuoi lasciarmi un'email per la conferma?`;
          
          console.log(`✅ STEP 6: Corretto, nome salvato: ${extractedName}`);
        }
      }
      // Caso B: Contesto suggerisce che stavamo chiedendo il nome
      else if (NameManager.isGptConfusingName(response.action, response.reply_text, reservationBefore)) {
        const bareName = NameManager.extractBareName(userText);
        
        if (bareName) {
          console.log(`⚠️ STEP 6b: GPT ha confuso "${bareName}" con comando (contesto prenotazione)`);
          
          reservation.name = bareName;
          reservation.date = reservationBefore.date;
          reservation.time = reservationBefore.time;
          reservation.people = reservationBefore.people;
          
          response.action = "ask_email";
          response.reply_text = lang === "en-US"
            ? `Perfect, ${bareName}. Would you like to leave an email?`
            : `Perfetto, ${bareName}. Vuoi lasciarmi un'email?`;
          
          console.log(`✅ STEP 6b: Corretto, nome salvato: ${bareName}`);
        }
      }
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 7: Estrai email se presente
    // ═══════════════════════════════════════════════════════════════════════
    if (!reservation.customerEmail) {
      const email = extractEmailFromText(userText);
      if (email) {
        reservation.customerEmail = sanitizeEmail(email);
        console.log(`✅ STEP 7: Email estratta: ${reservation.customerEmail}`);
      }
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 8: Merge con stato esistente
    // ═══════════════════════════════════════════════════════════════════════
    const merged = StateManager.mergeReservation(callId, reservation);
    response.reservation = merged;
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 9: Correggi action incoerenti
    // ═══════════════════════════════════════════════════════════════════════
    response = this.fixIncoherentAction(response, merged, userText, lang);
    
    console.log("✅ ValidationPipeline: completato");
    return response;
  },
  
  /**
   * Corregge action incoerenti con i dati
   */
  fixIncoherentAction(response, reservation, userText, lang) {
    const hasDate = reservation.date && reservation.date !== "null";
    const hasTime = reservation.time && reservation.time !== "null";
    const hasPeople = reservation.people && reservation.people > 0;
    const hasName = reservation.name && reservation.name.trim() !== "";
    const hasEmail = reservation.customerEmail && reservation.customerEmail.trim() !== "";
    
    // SAFETY NET 1: ask_name ma nome già presente → ask_email
    if (response.action === "ask_name" && hasName) {
      console.log("⚠️ SAFETY NET 1: ask_name con nome presente → ask_email");
      response.action = "ask_email";
    }
    
    // SAFETY NET 2: create_reservation senza dati minimi
    if (response.action === "create_reservation") {
      if (!hasDate || !hasTime || !hasName) {
        console.warn("⚠️ SAFETY NET 2: create_reservation senza dati minimi");
        
        if (!hasDate) response.action = "ask_date";
        else if (!hasTime) response.action = "ask_time";
        else if (!hasPeople) response.action = "ask_people";
        else if (!hasName) response.action = "ask_name";
      }
    }
    
    // SAFETY NET 3: Utente conferma + tutti i dati → forza create_reservation
    if (this.isUserConfirming(userText) && hasDate && hasTime && hasPeople && hasName) {
      if (response.action !== "create_reservation" && 
          response.action !== "cancel_reservation" &&
          response.action !== "answer_menu" &&
          response.action !== "answer_generic") {
        
        console.log("🔧 SAFETY NET 3: Tutti i dati + conferma → create_reservation");
        response.action = "create_reservation";
        
        // Se la risposta non è già una conferma, generala
        if (!response.reply_text.toLowerCase().includes("prenotazione") &&
            !response.reply_text.toLowerCase().includes("ti aspettiamo")) {
          
          const firstName = hasName ? reservation.name.split(' ')[0] : "";
          response.reply_text = `Perfetto${firstName ? ' ' + firstName : ''}! Ho registrato la tua prenotazione. Ti aspettiamo, buona serata!`;
        }
      }
    }
    
    // SAFETY NET 4: answer_menu/answer_generic → azzera reservation
    if (response.action === "answer_menu" || response.action === "answer_generic") {
      // Non azzerare lo stato persistente, solo la risposta
    }
    
    // FIX: action=none ma GPT menziona chiusura → ask_date
    if (response.action === "none" && /chius|closed/i.test(response.reply_text)) {
      console.log("🔧 FIX: action none con menzione chiusura → ask_date");
      response.action = "ask_date";
    }
    
    return response;
  },
  
  isUserConfirming(text) {
    const t = (text || "").toLowerCase().trim();
    return /^(sì|si|yes|ok|va bene|perfetto|esatto|corretto|confermo|conferma|d'accordo|giusto)/.test(t) ||
           /conferm/.test(t);
  },
  
  isUserChanging(text) {
    const t = (text || "").toLowerCase().trim();
    return /cambia|modifica|sposta|altro|diverso|change|different|move|anzi|invece/.test(t);
  },
};


// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 14: GPT SERVICE
// ═══════════════════════════════════════════════════════════════════════════════

const GPTService = {
  buildSystemPrompt(context, reservation, callId) {
    const restaurantName = context?.restaurant?.name || CONFIG.DEFAULT_RESTAURANT_NAME;
    const restaurantEmail = context?.restaurant?.email || CONFIG.OWNER_EMAIL_DEFAULT;
    const openingHours = context?.restaurant?.openingHoursText || "";
    const closingRules = context?.restaurant?.closingRulesText || "";
    const menuSummary = context?.menu?.summaryText || "";
    const largeGroupThreshold = context?.rules?.largeGroupThreshold || CONFIG.LARGE_GROUP_THRESHOLD;
    const eventThreshold = context?.rules?.eventThreshold || CONFIG.EVENT_THRESHOLD;
    
    // Calendario prossimi giorni
    const calendar = DateManager.buildCalendar(10);
    const calendarText = calendar.map(d => {
      let label = d.label ? ` (${d.label})` : "";
      if (d.isClosed) label += " ⛔ CHIUSO";
      return `  ${d.dayName}: ${d.date}${label}`;
    }).join('\n');
    
    const now = DateManager.getNow();
    const todayISO = DateManager.toISO(now);
    
    // Stato prenotazione corrente
    let stateText = "";
    if (reservation && (reservation.date || reservation.time || reservation.people || reservation.name)) {
      stateText = `
═══════════════════════════════════════════════════════════════════════════════
⚠️ DATI GIÀ RACCOLTI - NON PERDERE QUESTI DATI!
═══════════════════════════════════════════════════════════════════════════════
${reservation.date ? `- Data: ${reservation.date}` : ""}
${reservation.time ? `- Ora: ${reservation.time}` : ""}
${reservation.people ? `- Persone: ${reservation.people}` : ""}
${reservation.name ? `- Nome: ${reservation.name}` : ""}
${reservation.customerEmail ? `- Email: ${reservation.customerEmail}` : ""}

IMPORTANTE: Se l'utente conferma, usa action="create_reservation" con questi dati!
═══════════════════════════════════════════════════════════════════════════════`;
    }

    return `Sei ${CONFIG.RECEPTIONIST_NAME}, la receptionist telefonica di ${restaurantName}.

═══════════════════════════════════════════════════════════════════════════════
📅 OGGI: ${DateManager.DAYS_IT[now.getDay()]} ${now.getDate()} ${DateManager.MONTHS_IT[now.getMonth()]} ${now.getFullYear()}
Data ISO: ${todayISO}

CALENDARIO PROSSIMI GIORNI:
${calendarText}

REGOLE DATE:
- "domani" = ${calendar[1]?.date}
- "dopodomani" = ${calendar[2]?.date}
- Converti SEMPRE i giorni della settimana in data YYYY-MM-DD
═══════════════════════════════════════════════════════════════════════════════

⛔ CHIUSURE:
- Il ristorante è CHIUSO il LUNEDÌ (tutti i lunedì)
- ${closingRules || "Nessuna chiusura straordinaria"}

QUANDO IL CLIENTE CHIEDE PER UN LUNEDÌ:
→ Rifiuta IMMEDIATAMENTE
→ Proponi un altro giorno (es. martedì)
→ NON chiedere orario/persone per un giorno chiuso!

⚠️ REGOLA CRITICA - NON INVENTARE CHIUSURE:
- Se un giorno NON ha "⛔ CHIUSO" nel calendario sopra → il ristorante è APERTO
- NON assumere MAI chiusure per festività (Capodanno, Natale, Pasqua, Ferragosto, ecc.)
- NON rifiutare MAI prenotazioni basandoti su festività generali
- Accetta SEMPRE prenotazioni per giorni che nel calendario risultano APERTI
- Le UNICHE chiusure valide sono: lunedì + quelle esplicitamente elencate sopra
${stateText}
═══════════════════════════════════════════════════════════════════════════════

STILE:
- Frasi brevi (5-7 secondi di audio)
- Rispondi nella lingua del cliente (italiano o inglese)
- Mai mescolare le lingue
- Professionale ma amichevole

OBIETTIVO:
- Raccogliere: giorno, orario, numero persone, nome
- Email: consigliata ma non obbligatoria
- Per gruppi >${largeGroupThreshold} persone: prenotazione soggetta a conferma

GESTIONE EMAIL:
- Chiedi email con: "Vuoi lasciarmi un'email per la conferma?"
- Se dice no, procedi comunque
- Quando ti detta l'email, fai spelling e chiedi conferma

EMAIL RISTORANTE: ${restaurantEmail}
(da dare SOLO se chiede "la vostra email" o "email del ristorante")

ORARI:
- Se dice "alle 8" senza specificare → interpreta come 20:00 (sera)
- Orari apertura: ${openingHours || "pranzo e cena"}

MENU:
${menuSummary || "Cucina tradizionale italiana"}

FORMATO RISPOSTA (SOLO JSON):
{
  "reply_text": "frase da dire al cliente",
  "action": "none|ask_date|ask_time|ask_people|ask_name|ask_email|answer_menu|answer_generic|create_reservation|cancel_reservation",
  "reservation": {
    "date": "YYYY-MM-DD o null",
    "time": "HH:MM:SS o null",
    "people": numero o null,
    "name": "nome o null",
    "customerEmail": "email o null"
  }
}

REGOLE ACTION:
- create_reservation: SOLO quando hai date + time + name (almeno)
- cancel_reservation: SOLO per cancellare una prenotazione esistente
- ask_*: per chiedere dati mancanti
- answer_*: per domande informative (in quel caso reservation tutto null)

RISPOSTA FINALE (create_reservation):
- Conferma la prenotazione
- NON fare altre domande
- Chiudi con "Ti aspettiamo, buona serata."`;
  },

  async ask(callId, userText) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY non impostata");
    
    // Assicura contesto caricato
    await ContextService.ensureForCall(callId);
    const context = StateManager.getContext(callId);
    const reservation = StateManager.getReservation(callId);
    
    // Costruisci/aggiorna conversazione
    let convo = StateManager.getConversation(callId);
    const systemPrompt = this.buildSystemPrompt(context, reservation, callId);
    
    if (!convo) {
      convo = { messages: [{ role: "system", content: systemPrompt }] };
    } else {
      convo.messages[0] = { role: "system", content: systemPrompt };
    }
    
    // Aggiungi messaggio utente
    convo.messages.push({ role: "user", content: userText });
    
    // Limita cronologia
    if (convo.messages.length > 12) {
      const systemMsg = convo.messages[0];
      const recent = convo.messages.slice(-10);
      convo.messages = [systemMsg, ...recent];
    }
    
    // Chiama GPT
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
    
    console.log("🧠 GPT raw:", content.substring(0, 200));
    
    // Parse JSON
    let parsed = this.parseResponse(content);
    
    // Salva in conversazione
    convo.messages.push({ role: "assistant", content });
    StateManager.setConversation(callId, convo);
    
    // ═══════════════════════════════════════════════════════════════════════
    // APPLICA VALIDATION PIPELINE
    // ═══════════════════════════════════════════════════════════════════════
    parsed = await ValidationPipeline.validate(parsed, userText, callId);
    
    return parsed;
  },
  
  parseResponse(raw) {
    const fallback = {
      reply_text: "Scusa, c'è stato un problema. Puoi ripetere?",
      action: "none",
      reservation: { date: null, time: null, people: null, name: null, customerEmail: null },
    };
    
    if (!raw) return fallback;
    
    try {
      // Estrai JSON dal testo
      const jsonMatch = raw.match(/{[\s\S]*}/);
      const jsonStr = jsonMatch ? jsonMatch[0] : raw;
      const parsed = JSON.parse(jsonStr);
      
      // Validazione base
      if (!parsed || typeof parsed !== "object") return fallback;
      if (!parsed.reply_text || typeof parsed.reply_text !== "string") {
        parsed.reply_text = fallback.reply_text;
      }
      if (!parsed.action) parsed.action = "none";
      if (!parsed.reservation) parsed.reservation = fallback.reservation;
      
      // Normalizza customerEmail
      if (parsed.reservation.customer_email && !parsed.reservation.customerEmail) {
        parsed.reservation.customerEmail = parsed.reservation.customer_email;
      }
      
      // Sanifica email
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
// SEZIONE 15: TWILIO HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

const TwilioHelpers = {
  // Gestione lingua
  detectLanguageSwitch(text) {
    const t = (text || "").toLowerCase();
    
    if (t.includes("speak english") || t.includes("in english") || t.includes("parli inglese")) {
      return "en-US";
    }
    if (t.includes("parla italiano") || t.includes("in italiano")) {
      return "it-IT";
    }
    
    return null;
  },
  
  // Verifica se chiede email ristorante
  isAskingRestaurantEmail(text) {
    const t = (text || "").toLowerCase();
    
    // Non è la mail del ristorante se dice "mia mail"
    if (t.includes("mia mail") || t.includes("my email")) return false;
    
    return (
      t.includes("mail del ristorante") ||
      t.includes("email del ristorante") ||
      t.includes("vostra mail") ||
      t.includes("vostra email") ||
      t.includes("restaurant email") ||
      t.includes("your email")
    );
  },
  
  // Spelling email per TTS
  spellEmail(email, lang = "it-IT") {
    if (!email) return "";
    
    const [local, domain] = email.split("@");
    if (!local || !domain) return email;
    
    const [domainName, ...tld] = domain.split(".");
    
    // Spelling locale
    const localSpelled = lang === "en-US"
      ? local.split("").join(" ")
      : local.split("").map(c => c === "w" ? "doppia vù" : c).join(" ");
    
    // Domini comuni non vanno spelled
    const commonDomains = ["gmail", "outlook", "hotmail", "yahoo", "icloud"];
    const domainSpoken = commonDomains.includes(domainName.toLowerCase())
      ? domainName
      : domainName.split("").join(" ");
    
    const tldSpoken = tld.join(".");
    
    if (lang === "en-US") {
      return `${localSpelled} at ${domainSpoken} dot ${tldSpoken}`;
    }
    return `${localSpelled} chiocciola ${domainSpoken} punto ${tldSpoken}`;
  },
  
  // Aggiungi saluto finale
  addClosingSalute(text, lang = "it-IT") {
    const t = (text || "").toLowerCase();
    
    const hasSalute = (
      t.includes("buona serata") ||
      t.includes("a presto") ||
      t.includes("have a nice") ||
      t.includes("see you")
    );
    
    if (hasSalute) return text;
    
    return lang === "en-US"
      ? text + " We look forward to seeing you, have a nice evening."
      : text + " Ti aspettiamo, buona serata.";
  },
  
  // Verifica se è solo "grazie"
  isThanksOnly(text) {
    const t = (text || "").toLowerCase();
    return (
      /grazie|thank you|thanks/.test(t) &&
      !/cambia|change|sposta|modifica/.test(t)
    );
  },
};


// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 16: EXPRESS MIDDLEWARE
// ═══════════════════════════════════════════════════════════════════════════════

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 17: ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// Health check
app.get("/", (req, res) => {
  res.status(200).send("✅ Prenow Gateway v2.0 attivo!");
});

// Calendar proxy
app.post("/calendar", async (req, res) => {
  try {
    console.log("📩 /calendar:", req.body);
    const result = await CalendarService.createReservation(req.body);
    res.status(200).json({ success: true, fromAppsScript: result });
  } catch (err) {
    console.error("❌ /calendar error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTE PRINCIPALE: /twilio
// Gestisce sia DEBUG (text) che VOCE (SpeechResult)
// ═══════════════════════════════════════════════════════════════════════════════

app.post("/twilio", async (req, res) => {
  const { CallSid, SpeechResult, text, From, To, Language } = req.body || {};
  const { postFinal } = req.query || {};
  
  const isDebug = !!text && !SpeechResult;
  const callId = CallSid || (isDebug ? `debug-${Date.now()}` : `unknown-${Date.now()}`);
  const userText = (SpeechResult || text || "").trim();
  
  console.log(`\n📞 /twilio [${isDebug ? 'DEBUG' : 'VOICE'}] callId=${callId}`);
  console.log(`   From: ${From}, To: ${To}`);
  console.log(`   Text: "${userText.substring(0, 100)}"`);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // PRIMO INGRESSO (nessun testo) → Messaggio di benvenuto
  // ═══════════════════════════════════════════════════════════════════════════
  if (!userText && !isDebug) {
    StateManager.setLanguage(callId, "it-IT");
    
    // Multi-tenant: identifica ristorante
    if (To) {
      await Registry.getConfigForCall(callId, To);
    }
    
    // Carica contesto
    await ContextService.ensureForCall(callId);
    const restaurantName = ContextService.getRestaurantName(callId);
    
    const welcomeText = `Ciao, sono ${CONFIG.RECEPTIONIST_NAME} di ${restaurantName}. Come posso aiutarti?`;
    
    const twiml = `
      <Response>
        <Gather input="speech" language="it-IT" action="${CONFIG.BASE_URL}/twilio" method="POST" timeout="5" speechTimeout="auto">
          <Say language="it-IT" bargeIn="true">${escapeXml(welcomeText)}</Say>
        </Gather>
        <Say language="it-IT">Non ho ricevuto risposta. Richiamaci pure. Grazie, buona serata.</Say>
      </Response>
    `.trim();
    
    return res.status(200).type("text/xml").send(twiml);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // POST-FINAL: Dopo prenotazione completata
  // ═══════════════════════════════════════════════════════════════════════════
  if (postFinal === "1" && !isDebug) {
    const lang = StateManager.getLanguage(callId);
    
    if (TwilioHelpers.isThanksOnly(userText)) {
      StateManager.clearCall(callId);
      
      const twiml = `
        <Response>
          <Say language="${lang}">${escapeXml(lang === "en-US" ? "Thank you, have a nice evening." : "Grazie a te, buona serata.")}</Say>
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
    // Multi-tenant (primo turno debug)
    if (isDebug && To) {
      await Registry.getConfigForCall(callId, To);
    }
    
    // Salva testo utente
    StateManager.appendUserText(callId, userText);
    
    // Gestione lingua
    const langSwitch = TwilioHelpers.detectLanguageSwitch(userText);
    if (langSwitch) StateManager.setLanguage(callId, langSwitch);
    if (Language?.startsWith("en")) StateManager.setLanguage(callId, "en-US");
    if (Language?.startsWith("it")) StateManager.setLanguage(callId, "it-IT");
    
    const lang = StateManager.getLanguage(callId);
    
    // Carica contesto
    await ContextService.ensureForCall(callId);
    
    // ═══════════════════════════════════════════════════════════════════════
    // SHORTCUT: Email ristorante
    // ═══════════════════════════════════════════════════════════════════════
    if (TwilioHelpers.isAskingRestaurantEmail(userText)) {
      const email = ContextService.getRestaurantEmail(callId);
      const spelled = TwilioHelpers.spellEmail(email, lang);
      
      const reply = lang === "en-US"
        ? `The restaurant email is ${email}. I'll spell it: ${spelled}.`
        : `L'email del ristorante è ${email}. Te la detto: ${spelled}.`;
      
      if (isDebug) {
        return res.status(200).json({
          reply_text: reply,
          action: "answer_generic",
          reservation: StateManager.getReservation(callId),
        });
      }
      
      const twiml = `
        <Response>
          <Gather input="speech" language="${lang}" action="${CONFIG.BASE_URL}/twilio" method="POST" timeout="5" speechTimeout="auto">
            <Say language="${lang}" bargeIn="true">${escapeXml(reply)}</Say>
          </Gather>
          <Say language="${lang}">Se hai bisogno di altro, richiamaci. Grazie.</Say>
        </Response>
      `.trim();
      
      return res.status(200).type("text/xml").send(twiml);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // CHIAMA GPT (con validation pipeline)
    // ═══════════════════════════════════════════════════════════════════════
    const gptResponse = await GPTService.ask(callId, userText);
    
    let replyText = gptResponse.reply_text;
    let action = gptResponse.action;
    const reservation = gptResponse.reservation;
    
    console.log(`📤 Response: action=${action}, reply="${replyText.substring(0, 80)}..."`);
    
    // ═══════════════════════════════════════════════════════════════════════
    // GESTIONE CREATE_RESERVATION
    // ═══════════════════════════════════════════════════════════════════════
    if (action === "create_reservation" && reservation?.date && reservation?.time && reservation?.name) {
      
      const thresholds = ContextService.getThresholds(callId);
      const people = reservation.people || 2;
      
      // EVENTO GIGANTE
      if (people >= thresholds.event) {
        console.log("🎪 Evento gigante, invio notifica");
        await CalendarService.notifyLargeEvent({
          name: reservation.name,
          people,
          date: reservation.date,
          time: reservation.time,
          phone: From,
          customerEmail: reservation.customerEmail,
        }, callId);
        
        const email = ContextService.getRestaurantEmail(callId);
        const spelled = TwilioHelpers.spellEmail(email, lang);
        
        replyText = lang === "en-US"
          ? `For groups over ${thresholds.event} people, please email us at ${email}. I'll spell it: ${spelled}.`
          : `Per gruppi oltre ${thresholds.event} persone, ti chiedo di scrivere a ${email}. Te la detto: ${spelled}.`;
        action = "none";
        
      } else {
        // CHECK DISPONIBILITÀ
        const availability = await CalendarService.checkAvailability(
          reservation.date, reservation.time, people, callId
        );
        
        if (!availability.available) {
          if (availability.reason === "day_closed") {
            // Giorno chiuso (già gestito da pipeline, ma double-check)
            replyText = lang === "en-US"
              ? "I'm sorry, we're closed that day. Would you like another day?"
              : "Mi dispiace, quel giorno siamo chiusi. Vuoi provare un altro giorno?";
            action = "ask_date";
            
          } else {
            // Slot pieno - cerca alternative
            const alternatives = await CalendarService.findAlternatives(
              reservation.date, reservation.time, people, callId
            );
            replyText = CalendarService.buildAlternativesMessage(alternatives, lang);
            action = "ask_time";
          }
          
        } else {
          // SLOT DISPONIBILE - CREA PRENOTAZIONE
          try {
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
              console.log("✅ Prenotazione creata!");
              
              // Grande gruppo → messaggio soggetto a conferma
              if (people > thresholds.largeGroup) {
                replyText = lang === "en-US"
                  ? `I've registered your request for ${people} people. For large groups, booking is subject to confirmation. You'll receive an update soon. Thank you!`
                  : `Ho registrato la richiesta per ${people} persone. Per gruppi numerosi la prenotazione è soggetta a conferma. Riceverai un aggiornamento. Grazie!`;
              } else {
                replyText = TwilioHelpers.addClosingSalute(replyText, lang);
              }
              
              // Aggiungi risultato calendar alla risposta debug
              if (isDebug) {
                gptResponse.calendarResult = calResult;
              }
              
            } else if (calResult?.reason === "slot_full") {
              // Double-check slot pieno
              const alternatives = await CalendarService.findAlternatives(
                reservation.date, reservation.time, people, callId
              );
              replyText = CalendarService.buildAlternativesMessage(alternatives, lang);
              action = "ask_time";
              
            } else {
              console.error("❌ Calendar error:", calResult);
              replyText = lang === "en-US"
                ? "I'm sorry, there was a problem. Could you try a different time?"
                : "Mi dispiace, c'è stato un problema. Puoi provare con un altro orario?";
              action = "ask_time";
            }
            
          } catch (err) {
            console.error("❌ Calendar exception:", err);
            replyText = lang === "en-US"
              ? "I'm sorry, technical problem. Please try again."
              : "Mi dispiace, problema tecnico. Riprova per favore.";
            action = "none";
          }
        }
      }
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // GESTIONE CANCEL_RESERVATION
    // ═══════════════════════════════════════════════════════════════════════
    if (action === "cancel_reservation" && reservation?.date) {
      try {
        const calResult = await CalendarService.cancelReservation({
          source: isDebug ? "debug" : "twilio",
          name: reservation.name,
          date: reservation.date,
          time: reservation.time,
          phone: From,
        }, callId);
        
        if (calResult?.success) {
          replyText = lang === "en-US"
            ? "Your reservation has been cancelled. Hope to see you another time. Goodbye!"
            : "Ho cancellato la prenotazione. Speriamo di vederti un'altra volta. Buona serata!";
        } else if (calResult?.reason === "reservation_not_found") {
          replyText = lang === "en-US"
            ? "I couldn't find that booking. Please contact the restaurant directly."
            : "Non ho trovato quella prenotazione. Ti chiedo di contattare direttamente il ristorante.";
          action = "none";
        }
        
        if (isDebug) {
          gptResponse.calendarResult = calResult;
        }
        
      } catch (err) {
        console.error("❌ Cancel error:", err);
        replyText = lang === "en-US"
          ? "I'm sorry, there was a problem cancelling. Please contact the restaurant."
          : "Mi dispiace, problema durante la cancellazione. Contatta il ristorante.";
        action = "none";
      }
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // RISPOSTA
    // ═══════════════════════════════════════════════════════════════════════
    
    // DEBUG: ritorna JSON
    if (isDebug) {
      return res.status(200).json({
        reply_text: replyText,
        action,
        reservation,
        calendarResult: gptResponse.calendarResult,
      });
    }
    
    // TWILIO: ritorna TwiML
    const shouldHangup = (
      (action === "create_reservation" || action === "cancel_reservation") &&
      !replyText.includes("?") // Non è una domanda
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
          <Say language="${lang}">${escapeXml(lang === "en-US" ? "I didn't hear anything. Please call back. Thank you." : "Non ho sentito. Richiamaci pure. Grazie.")}</Say>
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
        <Say language="it-IT">Si è verificato un errore. Richiama più tardi. Grazie.</Say>
        <Hangup/>
      </Response>
    `.trim();
    
    return res.status(500).type("text/xml").send(errorTwiml);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES: Conferma/Annulla grandi gruppi (link da email)
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
          <h2>Prenotazione confermata ✅</h2>
          <p>Confermata per <strong>${payload.people} persone</strong> a nome <strong>${payload.name}</strong>.</p>
        </body></html>
      `);
    } else if (data?.reason === "slot_full") {
      res.send(`
        <html><body style="font-family:system-ui;padding:24px;">
          <h2>Impossibile confermare ❌</h2>
          <p>Slot pieno per quella data/ora.</p>
        </body></html>
      `);
    } else {
      res.send(`
        <html><body style="font-family:system-ui;padding:24px;">
          <h2>Errore ⚠️</h2>
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
        <h2>Prenotazione annullata ❌</h2>
        <p>Annullata per <strong>${payload.people} persone</strong> a nome <strong>${payload.name}</strong>.</p>
      </body></html>
    `);
  } catch (err) {
    console.error("❌ Cancel error:", err);
    res.status(500).send("Errore interno.");
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 18: AVVIO SERVER
// ═══════════════════════════════════════════════════════════════════════════════

app.listen(CONFIG.PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║  🚀 PRENOW GATEWAY v2.0 AVVIATO                               ║
║  📍 Porta: ${CONFIG.PORT}                                            ║
║  🌐 URL: ${CONFIG.BASE_URL}                         ║
╚═══════════════════════════════════════════════════════════════╝
  `);
});
