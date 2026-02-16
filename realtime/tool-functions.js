// ═══════════════════════════════════════════════════════════════════════════════
// PRENOW - TOOL FUNCTIONS v2.0.0
// Business logic COMPLETA integrata da index.js v3.9.31
// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 1: UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

function normalizeText(str) {
  return (str || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function sanitizePhone(phone) {
  if (!phone || typeof phone !== "string") return null;
  return phone.replace(/[^\d+]/g, "") || null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 2: DATE MANAGER (da index.js v3.9.31)
// ═══════════════════════════════════════════════════════════════════════════════

const DateManager = {
  DAYS_IT: ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'],
  DAYS_EN: ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
  MONTHS_IT: ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 
              'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'],
  
  getNow(timezone = 'Europe/Rome') {
    const nowString = new Date().toLocaleString("en-US", { timeZone: timezone });
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
  
  fromISO(isoString) {
    if (!isoString) return null;
    const [y, m, d] = isoString.split("-").map(Number);
    return new Date(y, m - 1, d);
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
  
  formatForSpeech(dateISO, lang = "it-IT") {
    if (!dateISO) return "";
    try {
      const [y, m, d] = dateISO.split("-").map(Number);
      const date = new Date(y, m - 1, d);
      const dayName = lang === "it-IT" ? this.DAYS_IT[date.getDay()] : this.DAYS_EN[date.getDay()];
      const monthName = lang === "it-IT" ? this.MONTHS_IT[date.getMonth()] : date.toLocaleDateString('en-US', { month: 'long' });
      return `${dayName} ${d} ${monthName}`;
    } catch (e) {
      return dateISO;
    }
  },
  
  getNextWeekday(fromDate, targetWeekday) {
    const result = new Date(fromDate.getTime());
    const diff = ((targetWeekday - result.getDay()) + 7) % 7;
    const daysToAdd = diff === 0 ? 7 : diff;
    result.setDate(result.getDate() + daysToAdd);
    return result;
  },
  
  parseFromText(text, timezone = 'Europe/Rome') {
    if (!text) return null;
    const t = normalizeText(text);
    const now = this.getNow(timezone);
    const today = this.startOfDay(now);
    
    // Date esplicite (15 febbraio, 20/02)
    const explicitDate = this._parseExplicitDate(t, today);
    if (explicitDate) return explicitDate;
    
    // Date relative (oggi, domani, dopodomani)
    const relativeDate = this._parseRelativeDate(t, today);
    if (relativeDate) return relativeDate;
    
    // Giorno settimana + numero (martedì 10)
    const weekdayWithDay = this._parseWeekdayWithDayNumber(t, today);
    if (weekdayWithDay) return weekdayWithDay;
    
    // Giorno della settimana (venerdì, sabato prossimo)
    const weekdayDate = this._parseWeekdayDate(t, today);
    if (weekdayDate) return weekdayDate;
    
    return null;
  },
  
  _parseExplicitDate(text, today) {
    const monthsMap = {
      'gennaio': 0, 'febbraio': 1, 'marzo': 2, 'aprile': 3, 'maggio': 4, 'giugno': 5,
      'luglio': 6, 'agosto': 7, 'settembre': 8, 'ottobre': 9, 'novembre': 10, 'dicembre': 11
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
    if (/dopodomani|dopo domani/.test(text)) return this.toISO(this.addDays(today, 2));
    if (/\bdomani\b/.test(text)) return this.toISO(this.addDays(today, 1));
    if (/oggi|stasera|questa sera/.test(text)) return this.toISO(today);
    
    const traMatch = text.match(/(?:tra|fra)\s*(\d+)\s*giorni/);
    if (traMatch) return this.toISO(this.addDays(today, parseInt(traMatch[1])));
    
    return null;
  },
  
  _parseWeekdayWithDayNumber(text, today) {
    const weekdayPatterns = [
      { pattern: /\b(?:domenica)\s+(\d{1,2})\b/i, index: 0 },
      { pattern: /\b(?:lunedi)\s+(\d{1,2})\b/i, index: 1 },
      { pattern: /\b(?:martedi)\s+(\d{1,2})\b/i, index: 2 },
      { pattern: /\b(?:mercoledi)\s+(\d{1,2})\b/i, index: 3 },
      { pattern: /\b(?:giovedi)\s+(\d{1,2})\b/i, index: 4 },
      { pattern: /\b(?:venerdi)\s+(\d{1,2})\b/i, index: 5 },
      { pattern: /\b(?:sabato)\s+(\d{1,2})\b/i, index: 6 },
    ];
    
    for (const wp of weekdayPatterns) {
      const match = text.match(wp.pattern);
      if (match) {
        const dayNum = parseInt(match[1]);
        if (dayNum >= 1 && dayNum <= 31) {
          let candidate = new Date(today.getFullYear(), today.getMonth(), dayNum);
          if (candidate < today) {
            candidate = new Date(today.getFullYear(), today.getMonth() + 1, dayNum);
          }
          return this.toISO(candidate);
        }
      }
    }
    return null;
  },
  
  _parseWeekdayDate(text, today) {
    const weekdays = [
      { patterns: ['domenica'], index: 0 },
      { patterns: ['lunedi'], index: 1 },
      { patterns: ['martedi'], index: 2 },
      { patterns: ['mercoledi'], index: 3 },
      { patterns: ['giovedi'], index: 4 },
      { patterns: ['venerdi'], index: 5 },
      { patterns: ['sabato'], index: 6 },
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
      const hasNextModifier = /\b(prossim[ao])\b/i.test(text);
      let result = this.getNextWeekday(today, lastFoundIndex);
      if (hasNextModifier && result.getDay() === today.getDay() && result.getDate() === today.getDate()) {
        result = this.addDays(result, 7);
      }
      return this.toISO(result);
    }
    return null;
  },
  
  isInPast(dateISO, timezone = 'Europe/Rome') {
    if (!dateISO) return false;
    const today = this.toISO(this.getNow(timezone));
    return dateISO < today;
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 3: TIME MANAGER
// ═══════════════════════════════════════════════════════════════════════════════

const TimeManager = {
  wordsToNumber: {
    'una': 1, 'due': 2, 'tre': 3, 'quattro': 4, 'cinque': 5, 'sei': 6, 'sette': 7,
    'otto': 8, 'nove': 9, 'dieci': 10, 'undici': 11, 'dodici': 12, 'tredici': 13,
    'quattordici': 14, 'quindici': 15, 'sedici': 16, 'diciassette': 17, 'diciotto': 18,
    'diciannove': 19, 'venti': 20, 'ventuno': 21, 'ventidue': 22, 'ventitre': 23
  },
  
  minuteWords: { 'mezza': 30, 'mezzo': 30, 'trenta': 30, 'quindici': 15, 'quarantacinque': 45 },
  
  parseRelativeTime(text, timezone = 'Europe/Rome') {
    if (!text) return null;
    const t = text.toLowerCase().trim();
    
    const patterns = [
      { pattern: /tra\s+mezz['']?\s*ora/i, minutes: 30 },
      { pattern: /tra\s+un['']?\s*ora/i, minutes: 60 },
      { pattern: /tra\s+(\d+)\s*minut/i, extract: true },
      { pattern: /tra\s+(\d+)\s*ore/i, extract: true, hours: true },
    ];
    
    for (const p of patterns) {
      const match = t.match(p.pattern);
      if (match) {
        let minutesOffset = p.extract ? (p.hours ? parseInt(match[1]) * 60 : parseInt(match[1])) : p.minutes;
        const nowString = new Date().toLocaleString("en-US", { timeZone: timezone });
        const now = new Date(nowString);
        const targetTime = new Date(now.getTime() + minutesOffset * 60 * 1000);
        const mins = targetTime.getMinutes();
        const roundedMins = Math.ceil(mins / 15) * 15;
        targetTime.setMinutes(roundedMins % 60);
        if (roundedMins >= 60) targetTime.setHours(targetTime.getHours() + 1);
        const hour = targetTime.getHours();
        const minute = targetTime.getMinutes();
        return { time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`, isToday: true };
      }
    }
    return null;
  },
  
  parseFromText(text) {
    if (!text) return null;
    const t = text.toLowerCase().trim();
    
    const relativeResult = this.parseRelativeTime(text);
    if (relativeResult) return relativeResult.time;
    
    if (/mezzogiorno/.test(t)) return "12:00";
    if (/mezzanotte/.test(t)) return "00:00";
    
    const allTimes = [];
    let match;
    
    // Pattern per numeri in lettere
    const hourWords = Object.keys(this.wordsToNumber).join('|');
    const patternWords = new RegExp(`(?:alle|ore|per le)\\s+(${hourWords})(?:\\s+e\\s+(mezza|mezzo|trenta|quindici))?`, 'gi');
    
    while ((match = patternWords.exec(t)) !== null) {
      const hourWord = match[1].toLowerCase();
      const minuteWord = match[2] ? match[2].toLowerCase() : null;
      let hour = this.wordsToNumber[hourWord];
      if (hour === undefined) continue;
      let minutes = minuteWord && this.minuteWords[minuteWord] !== undefined ? this.minuteWords[minuteWord] : 0;
      if (hour >= 1 && hour <= 11 && !t.includes("pranzo")) hour += 12;
      if (hour >= 0 && hour <= 23) {
        allTimes.push({ position: match.index, time: `${String(hour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}` });
      }
    }
    
    // Pattern "alle 20:30", "ore 8"
    const pattern1 = /(?:alle|ore|per le)\s*(\d{1,2})(?::(\d{2}))?/gi;
    while ((match = pattern1.exec(t)) !== null) {
      let hour = parseInt(match[1]);
      const minutes = match[2] ? parseInt(match[2]) : 0;
      if (hour >= 1 && hour <= 11 && !t.includes("pranzo")) hour += 12;
      if (hour >= 0 && hour <= 23) {
        allTimes.push({ position: match.index, time: `${String(hour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}` });
      }
    }
    
    // Pattern standalone "20:30"
    const pattern5 = /\b(\d{1,2}):(\d{2})\b/g;
    while ((match = pattern5.exec(t)) !== null) {
      let hour = parseInt(match[1]);
      const minutes = parseInt(match[2]);
      if (hour >= 1 && hour <= 11) hour += 12;
      if (hour >= 0 && hour <= 23 && minutes >= 0 && minutes <= 59) {
        const timeStr = `${String(hour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
        const isDuplicate = allTimes.some(t => Math.abs(t.position - match.index) < 5 && t.time === timeStr);
        if (!isDuplicate) allTimes.push({ position: match.index, time: timeStr });
      }
    }
    
    if (allTimes.length === 0) return null;
    allTimes.sort((a, b) => a.position - b.position);
    return allTimes[allTimes.length - 1].time;
  },
  
  formatForDisplay(timeStr) {
    if (!timeStr) return "";
    return timeStr.substring(0, 5);
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 4: CONFIG HELPER
// ═══════════════════════════════════════════════════════════════════════════════

const ConfigHelper = {
  getClosedDays(config) {
    return config?.weekly_closing_days && Array.isArray(config.weekly_closing_days) ? config.weekly_closing_days : [1];
  },
  
  getLunchClosedDays(config) {
    return config?.lunch_closed_days && Array.isArray(config.lunch_closed_days) ? config.lunch_closed_days : [];
  },
  
  getDinnerClosedDays(config) {
    return config?.dinner_closed_days && Array.isArray(config.dinner_closed_days) ? config.dinner_closed_days : [];
  },
  
  getOpeningHours(config) {
    const parseTime = (timeStr, defaultVal) => {
      if (!timeStr) return defaultVal;
      const [h, m] = String(timeStr).split(':').map(Number);
      return isNaN(h) ? defaultVal : h * 60 + (m || 0);
    };
    return {
      lunchStart: parseTime(config?.lunch_start, 720),
      lunchEnd: parseTime(config?.lunch_end, 900),
      dinnerStart: parseTime(config?.dinner_start, 1140),
      dinnerEnd: parseTime(config?.dinner_end, 1350),
    };
  },
  
  isValidTime(timeStr, config) {
    if (!timeStr) return false;
    const [hourStr, minStr] = timeStr.split(':');
    const totalMinutes = parseInt(hourStr) * 60 + parseInt(minStr || '0');
    const hours = this.getOpeningHours(config);
    return (totalMinutes >= hours.lunchStart && totalMinutes <= hours.lunchEnd) ||
           (totalMinutes >= hours.dinnerStart && totalMinutes <= hours.dinnerEnd);
  },
  
  getMealType(timeStr, config) {
    if (!timeStr) return "unknown";
    const hours = this.getOpeningHours(config);
    const [h, m] = String(timeStr).split(':').map(Number);
    if (isNaN(h)) return "unknown";
    const timeMinutes = h * 60 + (m || 0);
    if (timeMinutes >= hours.lunchStart - 30 && timeMinutes <= hours.lunchEnd + 30) return "lunch";
    if (timeMinutes >= hours.dinnerStart - 30 && timeMinutes <= hours.dinnerEnd + 30) return "dinner";
    if (h >= 11 && h <= 15) return "lunch";
    if (h >= 18 || h <= 2) return "dinner";
    return "unknown";
  },
  
  buildInvalidTimeMessage(config, lang = "it-IT") {
    const ls = config?.lunch_start || "12:00", le = config?.lunch_end || "15:00";
    const ds = config?.dinner_start || "19:00", de = config?.dinner_end || "22:30";
    return lang === "en-US"
      ? `That time is outside our hours. Lunch ${ls}-${le}, dinner ${ds}-${de}.`
      : `Quell'orario è fuori dai nostri orari. Pranzo ${ls}-${le}, cena ${ds}-${de}.`;
  },
  
  getThresholds(config) {
    return { largeGroup: Number(config?.large_group_threshold) || 10, event: Number(config?.event_threshold) || 45 };
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 5: CLOSURE CHECKER
// ═══════════════════════════════════════════════════════════════════════════════

const ClosureChecker = {
  isOpen(dateISO, config) {
    if (!dateISO) return { open: true, reason: null };
    const dayOfWeek = DateManager.getDayOfWeek(dateISO);
    const closedDays = ConfigHelper.getClosedDays(config);
    if (closedDays.includes(dayOfWeek)) {
      const dayName = DateManager.getDayName(dateISO, "it-IT");
      return { open: false, reason: "chiusura_settimanale", dayName, message_it: `Il ristorante è chiuso il ${dayName}.` };
    }
    return { open: true, reason: null };
  },
  
  isOpenForMeal(dateISO, mealType, config) {
    const baseCheck = this.isOpen(dateISO, config);
    if (!baseCheck.open) return baseCheck;
    if (!mealType || mealType === "unknown") return baseCheck;
    
    const dayOfWeek = DateManager.getDayOfWeek(dateISO);
    const dayName = DateManager.getDayName(dateISO, "it-IT");
    
    if (mealType === "lunch") {
      const lunchClosedDays = ConfigHelper.getLunchClosedDays(config);
      if (lunchClosedDays.includes(dayOfWeek)) {
        const ds = config?.dinner_start || "19:00", de = config?.dinner_end || "22:30";
        return { open: false, reason: "pranzo_chiuso", message_it: `Il ${dayName} siamo aperti solo a cena (${ds}-${de}). Vuoi prenotare per cena?` };
      }
    }
    
    if (mealType === "dinner") {
      const dinnerClosedDays = ConfigHelper.getDinnerClosedDays(config);
      if (dinnerClosedDays.includes(dayOfWeek)) {
        const ls = config?.lunch_start || "12:00", le = config?.lunch_end || "15:00";
        return { open: false, reason: "cena_chiusa", message_it: `Il ${dayName} siamo aperti solo a pranzo (${ls}-${le}). Vuoi prenotare per pranzo?` };
      }
    }
    return { open: true, reason: null };
  },
  
  buildClosedMessage(dateISO, closureResult, lang = "it-IT") {
    if (closureResult.message_it) return closureResult.message_it;
    const dayName = closureResult.dayName || DateManager.getDayName(dateISO, lang);
    return `Mi dispiace, il ristorante è chiuso il ${dayName}. Vuoi prenotare per un altro giorno?`;
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 6: HELPER APPS SCRIPT
// ═══════════════════════════════════════════════════════════════════════════════

function getAppsScriptUrl(restaurantConfig) {
  return restaurantConfig?.apps_script_url || process.env.APPS_SCRIPT_URL;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 7: TOOL FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

export const realtimeTools = [
  {
    name: 'check_availability',
    description: 'Verifica disponibilità slot. Valida automaticamente data, orario, chiusure.',
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Data YYYY-MM-DD' },
        time: { type: 'string', description: 'Orario HH:MM' },
        people: { type: 'integer', description: 'Numero persone' }
      },
      required: ['date', 'time', 'people']
    },
    handler: async (args, context) => {
      const { date, time, people } = args;
      const { restaurantConfig } = context;
      const lang = restaurantConfig?.language || 'it-IT';
      
      console.log(`🔍 check_availability: ${date} ${time} per ${people} pax`);
      
      if (DateManager.isInPast(date, restaurantConfig?.timezone)) {
        return { available: false, reason: 'past_date', message: 'Non posso prenotare per una data passata.' };
      }
      
      const closureCheck = ClosureChecker.isOpen(date, restaurantConfig);
      if (!closureCheck.open) {
        return { available: false, reason: 'closed_day', message: ClosureChecker.buildClosedMessage(date, closureCheck, lang) };
      }
      
      if (!ConfigHelper.isValidTime(time, restaurantConfig)) {
        return { available: false, reason: 'invalid_time', message: ConfigHelper.buildInvalidTimeMessage(restaurantConfig, lang) };
      }
      
      const mealType = ConfigHelper.getMealType(time, restaurantConfig);
      const mealCheck = ClosureChecker.isOpenForMeal(date, mealType, restaurantConfig);
      if (!mealCheck.open) {
        return { available: false, reason: mealCheck.reason, message: mealCheck.message_it };
      }
      
      try {
        const appsScriptUrl = getAppsScriptUrl(restaurantConfig);
        if (!appsScriptUrl) return { available: true, message: 'Slot disponibile.' };
        
        const response = await fetch(appsScriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'check_availability', data: date, ora: time, persone: people })
        });
        const result = await response.json();
        
        if (result.success || result.available) {
          return { available: true, message: 'Lo slot è disponibile.' };
        }
        return { available: false, reason: result.reason || 'slot_full', message: result.message || 'Orario al completo.', alternatives: result.alternatives || [] };
      } catch (error) {
        console.error('❌ check_availability error:', error);
        return { available: true, message: 'Procedo con la prenotazione.' };
      }
    }
  },
  
  {
    name: 'create_reservation',
    description: 'Crea prenotazione. Richiede: nome, persone, data, orario, telefono. NON usare nome="Cliente"!',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Nome cliente (NO placeholder!)' },
        people: { type: 'integer', description: 'Numero persone' },
        date: { type: 'string', description: 'Data YYYY-MM-DD' },
        time: { type: 'string', description: 'Orario HH:MM' },
        phone: { type: 'string', description: 'Telefono (OBBLIGATORIO!)' },
        notes: { type: 'string', description: 'Note opzionali' }
      },
      required: ['name', 'people', 'date', 'time', 'phone']
    },
    handler: async (args, context) => {
      const { name, people, date, time, phone, notes } = args;
      const { restaurantConfig } = context;
      const lang = restaurantConfig?.language || 'it-IT';
      
      console.log(`📝 create_reservation: ${name}, ${people} pax, ${date} ${time}, tel: ${phone}`);
      
      // Validazioni dati
      if (!name || name.toLowerCase() === 'cliente' || name.length < 2) {
        return { success: false, reason: 'missing_name', message: 'Mi serve il tuo nome. Come ti chiami?' };
      }
      if (!phone || phone.length < 6) {
        return { success: false, reason: 'missing_phone', message: 'Mi serve il numero di telefono.' };
      }
      if (!people || people < 1) {
        return { success: false, reason: 'missing_people', message: 'Per quante persone?' };
      }
      if (!date) {
        return { success: false, reason: 'missing_date', message: 'Per quale giorno?' };
      }
      if (!time) {
        return { success: false, reason: 'missing_time', message: 'A che ora?' };
      }
      
      // Validazioni business
      if (DateManager.isInPast(date, restaurantConfig?.timezone)) {
        return { success: false, reason: 'past_date', message: 'Non posso prenotare per una data passata.' };
      }
      
      const closureCheck = ClosureChecker.isOpen(date, restaurantConfig);
      if (!closureCheck.open) {
        return { success: false, reason: 'closed_day', message: ClosureChecker.buildClosedMessage(date, closureCheck, lang) };
      }
      
      if (!ConfigHelper.isValidTime(time, restaurantConfig)) {
        return { success: false, reason: 'invalid_time', message: ConfigHelper.buildInvalidTimeMessage(restaurantConfig, lang) };
      }
      
      const mealType = ConfigHelper.getMealType(time, restaurantConfig);
      const mealCheck = ClosureChecker.isOpenForMeal(date, mealType, restaurantConfig);
      if (!mealCheck.open) {
        return { success: false, reason: mealCheck.reason, message: mealCheck.message_it };
      }
      
      const thresholds = ConfigHelper.getThresholds(restaurantConfig);
      if (people >= thresholds.event) {
        const email = restaurantConfig?.owner_email || 'il ristorante';
        return { success: false, reason: 'event_size', message: `Per ${people} persone, scrivi a ${email}.` };
      }
      
      try {
        const appsScriptUrl = getAppsScriptUrl(restaurantConfig);
        if (!appsScriptUrl) return { success: false, message: 'Errore configurazione.' };
        
        const response = await fetch(appsScriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source: 'realtime_api', nome: name, persone: people, data: date,
            ora: time, telefono: sanitizePhone(phone), notes: notes || '', forceNew: true
          })
        });
        const result = await response.json();
        
        if (result.success) {
          const dateFormatted = DateManager.formatForSpeech(date, lang);
          const timeFormatted = TimeManager.formatForDisplay(time);
          const firstName = name.split(' ')[0];
          
          if (result.status === 'PENDING_OWNER' || people > thresholds.largeGroup) {
            return { success: true, status: 'PENDING_OWNER', eventId: result.eventId,
              message: `Richiesta registrata per ${people} persone a nome ${firstName}, ${dateFormatted} alle ${timeFormatted}. Il ristoratore confermerà.` };
          }
          
          return { success: true, status: 'CONFIRMED', eventId: result.eventId,
            message: `Perfetto ${firstName}! Confermato per ${people} persone, ${dateFormatted} alle ${timeFormatted}. Ti aspettiamo!` };
        }
        
        if (result.reason === 'slot_full') {
          return { success: false, reason: 'slot_full', message: 'Orario al completo. Altro orario?', alternatives: result.alternatives || [] };
        }
        return { success: false, reason: result.reason || 'unknown', message: result.message || 'Problema. Riprova?' };
      } catch (error) {
        console.error('❌ create_reservation error:', error);
        return { success: false, reason: 'error', message: 'Errore tecnico. Riprova.' };
      }
    }
  },
  
  {
    name: 'find_reservation',
    description: 'Cerca prenotazione per telefono o nome.',
    parameters: {
      type: 'object',
      properties: {
        phone: { type: 'string', description: 'Telefono cliente' },
        name: { type: 'string', description: 'Nome cliente' }
      },
      required: []
    },
    handler: async (args, context) => {
      const { phone, name } = args;
      const { restaurantConfig } = context;
      const lang = restaurantConfig?.language || 'it-IT';
      
      if (!phone && !name) {
        return { found: false, message: 'Mi serve nome o telefono per cercare.' };
      }
      
      try {
        const appsScriptUrl = getAppsScriptUrl(restaurantConfig);
        if (!appsScriptUrl) return { found: false, message: 'Errore configurazione.' };
        
        const response = await fetch(appsScriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'find_all_reservations', telefono: sanitizePhone(phone) || '', nome: name || '' })
        });
        const result = await response.json();
        
        if (result.found && result.reservations?.length > 0) {
          const reservations = result.reservations.map(r => ({
            eventId: r.eventId,
            date: r.data || r.date,
            time: r.ora || r.time,
            people: r.persone || r.people,
            name: r.nome || r.name,
            displayText: `${DateManager.formatForSpeech(r.data || r.date, lang)} alle ${TimeManager.formatForDisplay(r.ora || r.time)} per ${r.persone || r.people} persone`
          }));
          
          return { found: true, count: reservations.length, reservations,
            message: reservations.length === 1 ? `Trovata: ${reservations[0].displayText}.` : `Trovate ${reservations.length} prenotazioni.` };
        }
        return { found: false, message: `Non ho trovato prenotazioni${name ? ` a nome ${name}` : ''}.` };
      } catch (error) {
        console.error('❌ find_reservation error:', error);
        return { found: false, message: 'Errore ricerca. Riprova.' };
      }
    }
  },
  
  {
    name: 'modify_reservation',
    description: 'Modifica prenotazione. Usa find_reservation prima per eventId.',
    parameters: {
      type: 'object',
      properties: {
        eventId: { type: 'string', description: 'ID prenotazione' },
        newDate: { type: 'string', description: 'Nuova data YYYY-MM-DD' },
        newTime: { type: 'string', description: 'Nuovo orario HH:MM' },
        newPeople: { type: 'integer', description: 'Nuovo numero persone' }
      },
      required: ['eventId']
    },
    handler: async (args, context) => {
      const { eventId, newDate, newTime, newPeople } = args;
      const { restaurantConfig } = context;
      const lang = restaurantConfig?.language || 'it-IT';
      
      if (!eventId) return { success: false, message: 'Cerca prima la prenotazione.' };
      
      if (newDate) {
        if (DateManager.isInPast(newDate, restaurantConfig?.timezone)) {
          return { success: false, reason: 'past_date', message: 'Non posso spostare a data passata.' };
        }
        const closureCheck = ClosureChecker.isOpen(newDate, restaurantConfig);
        if (!closureCheck.open) {
          return { success: false, reason: 'closed_day', message: ClosureChecker.buildClosedMessage(newDate, closureCheck, lang) };
        }
      }
      
      if (newTime && !ConfigHelper.isValidTime(newTime, restaurantConfig)) {
        return { success: false, reason: 'invalid_time', message: ConfigHelper.buildInvalidTimeMessage(restaurantConfig, lang) };
      }
      
      if (newDate && newTime) {
        const mealType = ConfigHelper.getMealType(newTime, restaurantConfig);
        const mealCheck = ClosureChecker.isOpenForMeal(newDate, mealType, restaurantConfig);
        if (!mealCheck.open) return { success: false, reason: mealCheck.reason, message: mealCheck.message_it };
      }
      
      try {
        const appsScriptUrl = getAppsScriptUrl(restaurantConfig);
        if (!appsScriptUrl) return { success: false, message: 'Errore configurazione.' };
        
        const response = await fetch(appsScriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'modify_reservation', eventId, data: newDate, ora: newTime, persone: newPeople })
        });
        const result = await response.json();
        
        if (result.success) {
          const changes = [];
          if (newDate) changes.push(DateManager.formatForSpeech(newDate, lang));
          if (newTime) changes.push(`alle ${TimeManager.formatForDisplay(newTime)}`);
          if (newPeople) changes.push(`${newPeople} persone`);
          return { success: true, message: `Modificato: ${changes.join(', ')}. Ti aspettiamo!` };
        }
        if (result.reason === 'slot_full') {
          return { success: false, reason: 'slot_full', message: 'Nuovo orario non disponibile.', alternatives: result.alternatives || [] };
        }
        return { success: false, message: result.message || 'Non ho potuto modificare.' };
      } catch (error) {
        console.error('❌ modify_reservation error:', error);
        return { success: false, message: 'Errore modifica. Riprova.' };
      }
    }
  },
  
  {
    name: 'cancel_reservation',
    description: 'Cancella prenotazione. Chiedi SEMPRE conferma prima!',
    parameters: {
      type: 'object',
      properties: {
        eventId: { type: 'string', description: 'ID prenotazione' }
      },
      required: ['eventId']
    },
    handler: async (args, context) => {
      const { eventId } = args;
      const { restaurantConfig } = context;
      
      if (!eventId) return { success: false, message: 'Cerca prima la prenotazione.' };
      
      try {
        const appsScriptUrl = getAppsScriptUrl(restaurantConfig);
        if (!appsScriptUrl) return { success: false, message: 'Errore configurazione.' };
        
        const response = await fetch(appsScriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'cancel_reservation', eventId })
        });
        const result = await response.json();
        
        if (result.success) return { success: true, message: 'Cancellata. Speriamo di rivederti!' };
        return { success: false, message: result.message || 'Non ho potuto cancellare.' };
      } catch (error) {
        console.error('❌ cancel_reservation error:', error);
        return { success: false, message: 'Errore cancellazione. Riprova.' };
      }
    }
  }
];

export { DateManager, TimeManager, ConfigHelper, ClosureChecker };
export default realtimeTools;
