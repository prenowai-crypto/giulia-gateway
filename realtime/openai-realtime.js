// ═══════════════════════════════════════════════════════════════════════════════
// PRENOW REALTIME v3.0 - Logic Engine ibrido
// 
// Architettura:
//   Telnyx audio → Whisper STT → LogicEngine → GPT istruito → audio risposta
//
// GPT NON decide nulla — decide il LogicEngine deterministico.
// GPT è solo la voce: riceve istruzioni precise e le esegue.
//
// Ported from index_v3_9_31.js:
//   - DateManager (tutti i casi edge date italiane)
//   - TimeManager (numeri in lettere, "anzi", contesto sera)
//   - PeopleManager (correzioni, pattern robusti)
//   - StateManager (fasi precise per ogni chiamata)
//   - IntentDetector (CREATE/MODIFY/CANCEL deterministico)
//   - ValidationPipeline (check chiusure, orari, capacità)
//   - RecapManager (MODIFY/CANCEL flows)
// ═══════════════════════════════════════════════════════════════════════════════

import WebSocket from 'ws';

// ─── UTILITY ─────────────────────────────────────────────────────────────────

function normalizeText(str) {
  return (str || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// ─── DATE MANAGER ────────────────────────────────────────────────────────────

export const DateManager = {
  DAYS_IT: ['domenica','lunedì','martedì','mercoledì','giovedì','venerdì','sabato'],
  MONTHS_IT: ['gennaio','febbraio','marzo','aprile','maggio','giugno',
               'luglio','agosto','settembre','ottobre','novembre','dicembre'],

  getNow() {
    const s = new Date().toLocaleString('en-US', { timeZone: 'Europe/Rome' });
    return new Date(s);
  },

  toISO(date) {
    if (!date || isNaN(date.getTime())) return null;
    const y = date.getFullYear();
    const m = String(date.getMonth()+1).padStart(2,'0');
    const d = String(date.getDate()).padStart(2,'0');
    return `${y}-${m}-${d}`;
  },

  addDays(date, days) {
    const d = new Date(date.getTime());
    d.setDate(d.getDate() + days);
    return d;
  },

  getDayOfWeek(dateISO) {
    if (!dateISO) return null;
    const [y,m,d] = dateISO.split('-').map(Number);
    return new Date(y, m-1, d).getDay();
  },

  getDayName(dateISO) {
    const dow = this.getDayOfWeek(dateISO);
    return dow !== null ? this.DAYS_IT[dow] : null;
  },

  formatForDisplay(dateISO) {
    if (!dateISO) return '';
    try {
      const [y,m,d] = dateISO.split('-').map(Number);
      const date = new Date(y, m-1, d);
      return date.toLocaleDateString('it-IT', { weekday:'long', day:'numeric', month:'long' });
    } catch(e) { return dateISO; }
  },

  getNextWeekday(fromDate, targetWeekday) {
    const result = new Date(fromDate.getTime());
    const diff = ((targetWeekday - result.getDay()) + 7) % 7;
    const daysToAdd = diff === 0 ? 7 : diff;
    result.setDate(result.getDate() + daysToAdd);
    return result;
  },

  parseFromText(text) {
    if (!text) return null;
    const t = normalizeText(text);
    const now = this.getNow();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Relative
    if (/dopodomani|dopo domani/.test(t)) return this.toISO(this.addDays(today, 2));
    if (/\bdomani\b/.test(t)) return this.toISO(this.addDays(today, 1));
    if (/\boggi\b|\bstasera\b|\bquesta sera\b/.test(t)) return this.toISO(today);

    const traMatch = t.match(/(?:tra|fra|in)\s*(\d+)\s*giorni/);
    if (traMatch) return this.toISO(this.addDays(today, parseInt(traMatch[1])));

    // Explicit date (DD/MM or "N mese")
    const slashMatch = t.match(/\b(\d{1,2})\/(\d{1,2})\b/);
    if (slashMatch) {
      const day = parseInt(slashMatch[1]);
      const month = parseInt(slashMatch[2]) - 1;
      if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
        let year = today.getFullYear();
        let candidate = new Date(year, month, day);
        if (candidate < today) candidate = new Date(year+1, month, day);
        return this.toISO(candidate);
      }
    }

    const monthsMap = {
      'gennaio':0,'febbraio':1,'marzo':2,'aprile':3,'maggio':4,'giugno':5,
      'luglio':6,'agosto':7,'settembre':8,'ottobre':9,'novembre':10,'dicembre':11
    };
    const allMonths = Object.keys(monthsMap).join('|');
    const monthRegex = new RegExp(`(\\d{1,2})\\s*(?:di\\s+)?(${allMonths})`, 'i');
    const monthMatch = t.match(monthRegex);
    if (monthMatch) {
      const day = parseInt(monthMatch[1]);
      const month = monthsMap[monthMatch[2].toLowerCase()];
      if (month !== undefined && day >= 1 && day <= 31) {
        let year = today.getFullYear();
        let candidate = new Date(year, month, day);
        if (candidate < today) candidate = new Date(year+1, month, day);
        return this.toISO(candidate);
      }
    }

    // Weekday with day number ("martedì 10")
    const weekdayWithNum = this._parseWeekdayWithDayNumber(t, today);
    if (weekdayWithNum) return weekdayWithNum;

    // Weekday name
    const weekdays = [
      { patterns:['domenica'], index:0 },
      { patterns:['lunedi','lunedì'], index:1 },
      { patterns:['martedi','martedì'], index:2 },
      { patterns:['mercoledi','mercoledì'], index:3 },
      { patterns:['giovedi','giovedì'], index:4 },
      { patterns:['venerdi','venerdì'], index:5 },
      { patterns:['sabato'], index:6 },
    ];

    let lastFoundIndex = -1, lastFoundPosition = -1;
    for (const wd of weekdays) {
      for (const pattern of wd.patterns) {
        const pos = t.lastIndexOf(pattern);
        if (pos !== -1 && pos > lastFoundPosition) {
          lastFoundPosition = pos;
          lastFoundIndex = wd.index;
        }
      }
    }

    if (lastFoundIndex !== -1) {
      return this.toISO(this.getNextWeekday(today, lastFoundIndex));
    }

    return null;
  },

  _parseWeekdayWithDayNumber(text, today) {
    const patterns = [
      { pattern:/\b(?:domenica)\s+(\d{1,2})\b/i, index:0 },
      { pattern:/\b(?:lunedi|lunedì)\s+(\d{1,2})\b/i, index:1 },
      { pattern:/\b(?:martedi|martedì)\s+(\d{1,2})\b/i, index:2 },
      { pattern:/\b(?:mercoledi|mercoledì)\s+(\d{1,2})\b/i, index:3 },
      { pattern:/\b(?:giovedi|giovedì)\s+(\d{1,2})\b/i, index:4 },
      { pattern:/\b(?:venerdi|venerdì)\s+(\d{1,2})\b/i, index:5 },
      { pattern:/\b(?:sabato)\s+(\d{1,2})\b/i, index:6 },
    ];
    for (const wp of patterns) {
      const match = text.match(wp.pattern);
      if (match) {
        const dayNum = parseInt(match[1]);
        if (dayNum >= 1 && dayNum <= 31) {
          let candidate = new Date(today.getFullYear(), today.getMonth(), dayNum);
          if (candidate < today) candidate = new Date(today.getFullYear(), today.getMonth()+1, dayNum);
          return this.toISO(candidate);
        }
      }
    }
    return null;
  },
};

// ─── TIME MANAGER ─────────────────────────────────────────────────────────────

export const TimeManager = {
  parseFromText(text) {
    if (!text) return null;
    const t = text.toLowerCase().trim();

    if (/mezzogiorno/.test(t)) return '12:00:00';
    if (/mezzanotte/.test(t)) return '00:00:00';

    const numberMap = {
      'zero':0,'una':1,'uno':1,'due':2,'tre':3,'quattro':4,'cinque':5,'sei':6,
      'sette':7,'otto':8,'nove':9,'dieci':10,'undici':11,'dodici':12,
      'tredici':13,'quattordici':14,'quindici':15,'sedici':16,'diciassette':17,
      'diciotto':18,'diciannove':19,'venti':20,'ventuno':21,'ventidue':22,
      'ventitre':23,'ventitré':23
    };
    const minuteMap = {
      'mezza':30,'mezzo':30,'un quarto':15,'trenta':30,'quindici':15,
      'quaranta':40,'quarantacinque':45,'venti':20,'dieci':10,'cinque':5
    };

    const allTimes = [];
    let match;

    // "alle venti e trenta" / "alle otto e mezza"
    const allHourWords = Object.keys(numberMap).join('|');
    const patternWords = new RegExp(
      `(?:alle|ore|per le)\\s+(${allHourWords})(?:\\s+e\\s+(mezza|mezzo|un quarto|trenta|quindici|quaranta|quarantacinque|venti|dieci|cinque))?`,
      'gi'
    );
    while ((match = patternWords.exec(t)) !== null) {
      const hourWord = match[1].toLowerCase();
      const minuteWord = match[2] ? match[2].toLowerCase() : null;
      let hour = numberMap[hourWord];
      if (hour === undefined) continue;
      let minutes = minuteWord && minuteMap[minuteWord] !== undefined ? minuteMap[minuteWord] : 0;
      if (hour >= 1 && hour <= 11 && !/mattina|pranzo/.test(t)) hour += 12;
      if (hour >= 0 && hour <= 23) {
        allTimes.push({ position: match.index, time: `${String(hour).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:00` });
      }
    }

    // "alle 21" / "alla 21" / "alle 21.30" / "alle 21:30"
    const pattern1 = /(?:alle|alla|ore|per le)\s*(\d{1,2})(?:[.:](\d{2}))?/gi;
    while ((match = pattern1.exec(t)) !== null) {
      let hour = parseInt(match[1]);
      const minutes = match[2] ? parseInt(match[2]) : 0;
      if (hour >= 1 && hour <= 11 && !/mattina|pranzo/.test(t)) hour += 12;
      if (hour >= 0 && hour <= 23)
        allTimes.push({ position: match.index, time: `${String(hour).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:00` });
    }

    // "e un quarto" / "e mezza" after an hour
    const pattern2 = /\b(\d{1,2})\s+e\s+(un quarto|mezza|mezzo|trenta)/gi;
    while ((match = pattern2.exec(t)) !== null) {
      let hour = parseInt(match[1]);
      const minuteWord = match[2].toLowerCase();
      const minutes = minuteMap[minuteWord] || 0;
      if (hour >= 1 && hour <= 11 && !/mattina|pranzo/.test(t)) hour += 12;
      if (hour >= 0 && hour <= 23)
        allTimes.push({ position: match.index, time: `${String(hour).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:00` });
    }

    // Plain HH:MM or HH-MM (es. "19:30", "19.30", "19-30")
    const pattern3 = /\b(\d{1,2})[.:\-](\d{2})\b/g;
    while ((match = pattern3.exec(t)) !== null) {
      let hour = parseInt(match[1]);
      const minutes = parseInt(match[2]);
      if (/sera|cena|stasera/.test(t) && hour >= 1 && hour <= 11) hour += 12;
      if (hour >= 0 && hour <= 23 && minutes >= 0 && minutes <= 59)
        allTimes.push({ position: match.index, time: `${String(hour).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:00` });
    }

    if (allTimes.length === 0) return null;

    // Prefer last time mentioned (handles "anzi alle 21.30")
    allTimes.sort((a,b) => a.position - b.position);
    const last = allTimes[allTimes.length - 1];
    return last.time;
  },

  inferDefault(text) {
    if (!text) return null;
    const t = normalizeText(text);
    if (/pranzo|lunch/.test(t)) return '13:00:00';
    if (/sera|serale|cena|dinner/.test(t)) return '20:00:00';
    return null;
  },

  formatForDisplay(timeStr) {
    if (!timeStr) return '';
    return timeStr.substring(0, 5);
  },
};

// ─── PEOPLE MANAGER ──────────────────────────────────────────────────────────

export const PeopleManager = {
  parseFromText(text) {
    if (!text) return null;
    const t = text.toLowerCase().trim();

    // ── Rimuovi orari dal testo prima di parsare le persone ──────────────────
    // Evita che "alle 21.30 per due persone" → people=30
    const tClean = t
      .replace(/\b\d{1,2}[.:]\d{2}\b/g, '')           // rimuove 21.30, 21:30
      .replace(/\b(?:alle|alla|ore|per le)\s*\d{1,2}\b/gi, '') // rimuove "alle 21", "alla 21"
      .replace(/\s+/g, ' ').trim();

    // Correction pattern: usa ULTIMO numero (sia cifre che parole)
    if (/anzi|no aspetta|aspetta|facciamo|meglio|diciamo/.test(tClean)) {
      // Prima prova con cifre
      const allNums = tClean.match(/\b(\d+)\b/g);
      if (allNums && allNums.length >= 2) {
        const last = parseInt(allNums[allNums.length - 1]);
        if (last > 0 && last <= 45) return last;
      }
      // Poi prova con parole numeriche — cerca l'ULTIMA nel testo
      const wordNums = {
        'una':1,'uno':1,'due':2,'tre':3,'quattro':4,'cinque':5,'sei':6,
        'sette':7,'otto':8,'nove':9,'dieci':10,'undici':11,'dodici':12,
      };
      let lastFound = null;
      let lastPos = -1;
      for (const [word, num] of Object.entries(wordNums)) {
        const regex = new RegExp(`\\b${word}\\b`, 'gi');
        let m;
        while ((m = regex.exec(tClean)) !== null) {
          if (m.index > lastPos) {
            lastPos = m.index;
            lastFound = num;
          }
        }
      }
      if (lastFound !== null) return lastFound;
    }

    const patterns = [
      /(\d+)\s*in\s*totale/i,
      /siamo\s*(?:in\s*)?(\d+)/i,
      /(?:per|siamo|saremo|in)\s*(\d+)\s*(?:person[ae]|pax)?/i,
      /(\d+)\s*(?:person[ae]|pax|coperti)/i,
      /tavolo\s*(?:per|for)\s*(\d+)/i,
    ];

    for (const p of patterns) {
      const match = tClean.match(p);
      if (match) {
        const num = parseInt(match[1]);
        if (num > 0 && num <= 45) return num;
      }
    }

    const wordNumbers = {
      'una':1,'uno':1,'due':2,'tre':3,'quattro':4,'cinque':5,'sei':6,
      'sette':7,'otto':8,'nove':9,'dieci':10,'undici':11,'dodici':12,
    };
    for (const [word, num] of Object.entries(wordNumbers)) {
      const regex = new RegExp(`\\b${word}\\b`, 'i');
      if (regex.test(tClean)) return num;
    }

    return null;
  },
};

// ─── INTENT DETECTOR ─────────────────────────────────────────────────────────

export const IntentDetector = {
  CANCEL_KEYWORDS: [
    'cancellare','cancella','cancello','cancellarla','cancellarmi',
    'disdire','disdetta','disdico','disdirla',
    'annullare','annulla','annullo','annullarla',
    'eliminare','elimina','eliminarla',
    'non vengo','non veniamo',
  ],
  MODIFY_KEYWORDS: [
    'modificare','modifica','modifico',
    'spostare','sposta','sposto',
    'cambiare','cambia','cambio',
    'anticipare','posticipare',
  ],

  _preprocess(text) {
    let t = (text||'').toLowerCase();
    t = t.replace(/\ba\s+nome\s+\w+/gi, ' ');
    t = t.replace(/\bnome\s+\w+/gi, ' ');
    return t.replace(/\s+/g,' ').trim();
  },

  detect(text) {
    if (!text) return 'create';
    const t = this._preprocess(text);

    // Override: "altra/nuova prenotazione" → always CREATE
    if (/\b(altra|nuova|second\w*)\s+(prenotazion)/i.test(text)) return 'create';

    for (const kw of this.CANCEL_KEYWORDS) {
      const regex = new RegExp(`\\b${kw}\\b`, 'i');
      if (regex.test(t)) return 'cancel';
    }
    for (const kw of this.MODIFY_KEYWORDS) {
      if (t.includes(kw)) return 'modify';
    }
    if (/ho prenotato|ho una prenotazione|la mia prenotazione/.test(text.toLowerCase())) return 'modify';

    return 'create';
  },
};

// ─── CONFIRM / DENY HELPERS ──────────────────────────────────────────────────

export function isConfirming(text) {
  const t = normalizeText(text || '');
  return /^(si\b|sii\b|esatto|corretto|giusto|confermo|certo|ok\b|va bene|perfetto|proprio)/.test(t) ||
         /\b(conferm|esatt|corrett|giust|perfett)\b/.test(t);
}

export function isDenying(text) {
  const t = normalizeText(text || '');
  return /^(no[^n]|non |sbagliato|errato)/.test(t) ||
         /\b(non cancell|lascia stare|lascia perdere|teniamo|mantieni)\b/i.test(text||'');
}

// ─── VALIDATION PIPELINE ─────────────────────────────────────────────────────

export const ValidationPipeline = {
  isValidTime(time, rc) {
    if (!time) return false;
    const [h, m] = time.split(':').map(Number);
    const mins = h * 60 + (m||0);

    const lunchStart = this._toMins(rc?.lunch_start || '12:00');
    const lunchEnd   = this._toMins(rc?.lunch_end   || '14:30');
    const dinnerStart = this._toMins(rc?.dinner_start || '19:00');
    const dinnerEnd   = this._toMins(rc?.dinner_end   || '22:30');

    return (mins >= lunchStart && mins <= lunchEnd) ||
           (mins >= dinnerStart && mins <= dinnerEnd);
  },

  isLunchClosed(dateISO, rc) {
    if (!dateISO || !rc?.lunch_closed_days) return false;
    const dow = DateManager.getDayOfWeek(dateISO);
    const days = String(rc.lunch_closed_days).split(',').map(Number);
    return days.includes(dow);
  },

  isDinnerClosed(dateISO, rc) {
    if (!dateISO || !rc?.dinner_closed_days) return false;
    const dow = DateManager.getDayOfWeek(dateISO);
    const days = String(rc.dinner_closed_days).split(',').map(Number);
    return days.includes(dow);
  },

  getDayClosedMessage(dateISO, rc) {
    if (!dateISO) return null;
    const dow = DateManager.getDayOfWeek(dateISO);
    const closedDays = rc?.closed_days
      ? String(rc.closed_days).split(',').map(Number)
      : [1];
    if (closedDays.includes(dow)) {
      const dayName = DateManager.getDayName(dateISO);
      return `Il ristorante è chiuso il ${dayName}. Per quale altro giorno vuole prenotare?`;
    }
    return null;
  },

  getTimeInvalidMessage(time, dateISO, rc) {
    const ls = rc?.lunch_start || '12:00';
    const le = rc?.lunch_end   || '14:30';
    const ds = rc?.dinner_start || '19:00';
    const de = rc?.dinner_end   || '22:30';

    if (dateISO) {
      const dow = DateManager.getDayOfWeek(dateISO);
      const [h] = (time||'').split(':').map(Number);
      const isPranzish = h >= 10 && h <= 16;

      if (isPranzish && this.isLunchClosed(dateISO, rc)) {
        const dayName = DateManager.getDayName(dateISO);
        return `Il ${dayName} siamo aperti solo a cena (${ds}-${de}). Vuole prenotare per cena?`;
      }
      if (!isPranzish && this.isDinnerClosed(dateISO, rc)) {
        const dayName = DateManager.getDayName(dateISO);
        return `Il ${dayName} siamo aperti solo a pranzo (${ls}-${le}). Vuole prenotare per pranzo?`;
      }
    }

    return `Quell'orario è fuori dai nostri orari. Pranzo ${ls}-${le}, cena ${ds}-${de}. Che orario preferisce?`;
  },

  _toMins(timeStr) {
    const [h,m] = (timeStr||'0:0').split(':').map(Number);
    return h * 60 + (m||0);
  },
};

// ─── OPENAI REALTIME CLIENT ───────────────────────────────────────────────────

export class OpenAIRealtimeClient {
  constructor(opts = {}) {
    this.apiKey          = opts.apiKey;
    this.model           = opts.model || 'gpt-4o-mini-realtime-preview';
    this.systemPrompt    = opts.systemPrompt || '';
    this.restaurantConfig = opts.restaurantConfig || {};

    // Callbacks
    this.onTranscript = opts.onTranscript || (() => {});
    this.onError      = opts.onError      || console.error;
    this.onClose      = opts.onClose      || (() => {});

    this.ws = null;
    this.callerPhone   = opts.callerPhone || '';

    // ── State (dalla logica del vecchio index) ──────────────────────────────
    this.data = { date: null, time: null, people: null, name: null, notes: null, alternativePhone: null };
    this.phase         = 'collecting';   // collecting | checking | naming | done
    this.intent        = null;           // create | modify | cancel
    this.existingRes   = null;           // prenotazione trovata per modify/cancel
    this.availDone     = false;
    this.checkingSlot  = false;

    // ── MODIFY / CANCEL state machine ────────────────────────────────────────
    this.modifyState      = null;   // null | 'awaiting_search' | 'awaiting_changes'
    this.cancelState      = null;   // null | 'awaiting_search' | 'awaiting_confirm'
    this.foundReservation = null;   // dati prenotazione trovata da find_reservation

    // Anti-loop flags
    this._checkingDay  = false;
    this._checkingTime = false;
    this._sessionReady = false;      // evita doppio greeting
    this._awaitingExtraction = false; // in attesa di JSON estrazione da GPT

    // ── Lingua rilevata automaticamente da Whisper ───────────────────────────
    this.language = 'it';  // default italiano, aggiornato al primo messaggio
  }

  // ── Connect ──────────────────────────────────────────────────────────────

  async connect() {
    return new Promise((resolve, reject) => {
      const url = `wss://api.openai.com/v1/realtime?model=${this.model}`;
      this.ws = new WebSocket(url, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'OpenAI-Beta': 'realtime=v1',
        },
      });

      this.ws.on('open', () => {
        this._configureSession();
        resolve();
      });
      this.ws.on('message', (raw) => this._onMessage(raw));
      this.ws.on('error', reject);
      this.ws.on('close', (code) => {
        console.log(`🔴 Disconnesso (${code})`);
        this.onClose(code);
      });
    });
  }

  _configureSession() {
    const now = DateManager.getNow();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayISO = DateManager.toISO(today);
    const dayName = DateManager.DAYS_IT[now.getDay()];

    // Calendario esplicito dei prossimi 7 giorni
    const dayNames = ['domenica','lunedì','martedì','mercoledì','giovedì','venerdì','sabato'];
    const nextDays = [];
    for (let i = 1; i <= 7; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      nextDays.push(`${dayNames[d.getDay()]}=${DateManager.toISO(d)}`);
    }
    const calendarStr = nextDays.join(', ');

    this._send({
      type: 'session.update',
      session: {
        modalities: ['audio', 'text'],
        voice: 'alloy',
        instructions: this.systemPrompt,
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        input_audio_transcription: { model: 'whisper-1' }, // lingua rilevata automaticamente
        turn_detection: {
          type: 'server_vad',
          threshold: 0.4,
          prefix_padding_ms: 300,
          silence_duration_ms: 1200,
          create_response: false,
        },
        tools: [{
          type: 'function',
          name: 'extract_booking_data',
          description: `Estrai i dati di prenotazione dall'audio. Oggi è ${dayName} ${todayISO}. Prossimi giorni: ${calendarStr}. Chiama SEMPRE questa funzione dopo ogni messaggio del cliente. Per i campi non presenti usa "null".`,
          parameters: {
            type: 'object',
            properties: {
              date: {
                type: 'string',
                description: `Data ISO YYYY-MM-DD oppure "null". USA il calendario nel campo description della funzione. Esempi: "mercoledì"=data mercoledì dal calendario, "sabato"=data sabato dal calendario, "domani"=domani.`
              },
              time: {
                type: 'string',
                description: 'Orario HH:MM:SS oppure "null". Esempi: "alle 21"=21:00:00, "all\'una"=13:00:00, "nove e mezza di sera"=21:30:00, "all\'una e mezza"=13:30:00, "ventuno"=21:00:00, "mezzogiorno"=12:00:00.'
              },
              people: {
                type: 'string',
                description: 'Numero di persone come stringa oppure "null". Esempi: "per due"=2, "siamo in quattro"=4, "per me"=1.'
              },
              name: {
                type: 'string',
                description: 'Nome del cliente per la prenotazione oppure "null". Esempi IT: "mi chiamo Luca"=Luca, "nome Rossi"=Rossi, "a nome di Giovanni"=Giovanni. Esempi EN: "my name is Smith"=Smith, "I\'m Johnson"=Johnson, "under the name Brown"=Brown, "name Ferrari"=Ferrari.'
              },
              intent: {
                type: 'string',
                enum: ['create', 'modify', 'cancel', 'unknown'],
                description: 'Intenzione del cliente: create=nuova prenotazione, modify=modifica, cancel=cancellazione, unknown=non chiaro.'
              },
              language: {
                type: 'string',
                description: 'ISO 639-1 language code of the customer message. Examples: "it" for Italian, "en" for English, "fr" for French, "de" for German, "es" for Spanish.'
              }
            },
            required: ['date', 'time', 'people', 'name', 'intent', 'language']
          }
        }],
        tool_choice: 'auto',
      },
    });
    console.log('✅ Sessione configurata');
  }

  // ── Message Handler ───────────────────────────────────────────────────────

  _onMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'session.created':
        console.log(`📋 Sessione: ${msg.session?.id}`);
        break;
      case 'session.updated':
        if (!this._sessionReady) {
          this._sessionReady = true;
          console.log('✅ Sessione ok');
          this._onSessionReady();
        }
        break;
      case 'response.audio_transcript.done':
        if (msg.transcript) {
          console.log(`💬 [AI]: ${msg.transcript}`);
          this.onTranscript(msg.transcript, 'assistant');
        }
        break;
      case 'response.audio.done':
        // Audio finito di generare → aggiorna il timestamp per il deaf period
        this._lastSaidAt = Date.now();
        // Segnala a _waitForAudioDone() che l'audio è terminato
        if (this._audioDoneResolve) {
          const r = this._audioDoneResolve;
          this._audioDoneResolve = null;
          r();
        }
        break;
      case 'conversation.item.input_audio_transcription.completed':
        if (msg.transcript) {
          const t = msg.transcript.trim();
          if (!t || t.length < 2) return;
          console.log(`💬 [user]: ${t}`);
          this.onTranscript(t, 'user');

          // Rileva lingua automaticamente da Whisper (al primo messaggio significativo)
          if (msg.language && msg.language !== this.language) {
            this.language = msg.language;
            console.log(`🌐 Lingua rilevata: ${this.language}`);
          }

          // Se in attesa di conferma cancellazione, gestisce qui via testo grezzo
          if (this.cancelState === 'awaiting_confirm') {
            this._handleCancelConfirmText(t).catch(err => console.error('❌ _handleCancelConfirmText:', err));
            return;
          }
          // Rileva note e telefono alternativo
          this._detectNotesAndPhone(t);
        }
        break;
      case 'input_audio_buffer.speech_started':
        console.log('🎤 Parla...');
        break;
      case 'input_audio_buffer.speech_stopped':
        console.log('🎤 Fine');
        // Deaf period: ignora speech_stopped per 1500ms dopo la fine dell'audio
        // Parte da response.audio.done (momento corretto) non da _say()
        if (this._lastSaidAt && (Date.now() - this._lastSaidAt) < 1500) {
          console.log(`🔇 speech_stopped ignorato (deaf period: ${Date.now() - this._lastSaidAt}ms < 1500ms)`);
          break;
        }
        if (this.cancelState === 'awaiting_confirm') {
          // Cancella la risposta auto-VAD, lascia gestire a _handleCancelConfirmText via Whisper
          this._send({ type: 'response.cancel' });
        } else if (!this.checkingSlot) {
          // Cancella sempre la risposta auto-VAD prima della nostra estrazione
          this._send({ type: 'response.cancel' });
          this._triggerExtraction();
        }
        break;
      case 'response.text.done':
        // Cattura il JSON di estrazione dati
        if (this._awaitingExtraction && msg.text) {
          this._awaitingExtraction = false;
          try {
            const json = msg.text.trim().replace(/```json|```/g, '').trim();
            const args = JSON.parse(json);
            console.log(`🔧 GPT ha estratto:`, JSON.stringify(args));
            this._processGPTData(args).catch(err => console.error('❌ _processGPTData:', err));
          } catch (err) {
            console.error('❌ Parsing JSON estrazione:', err, '| Testo ricevuto:', msg.text);
            // GPT non ha restituito JSON valido — chiedi di nuovo il dato mancante
            if (!this.data.date) this._ask('date');
            else if (!this.data.time) this._ask('time');
            else if (!this.data.people) this._ask('people');
          }
        }
        break;
      case 'response.function_call_arguments.done':
        // GPT ha usato function calling — sia JSON text che function call sono validi
        try {
          const args = JSON.parse(msg.arguments);
          console.log(`🔧 GPT function call:`, JSON.stringify(args));
          // NON mandiamo function_call_output: evita risposta automatica GPT rogue
          // Il controllo torna a noi via _processGPTData → _say
          this._awaitingExtraction = false;
          this._processGPTData(args).catch(err => console.error('❌ _processGPTData:', err));
        } catch (err) {
          console.error('❌ Errore function call:', err);
        }
        break;
      case 'response.done':
        if (msg.response?.status === 'failed') console.error('❌ Response failed');
        break;
      case 'error':
        if (msg.error?.code !== 'conversation_already_has_active_response' &&
            msg.error?.code !== 'response_cancel_not_active') {
          console.error('❌ OpenAI:', msg.error);
          this.onError(msg.error);
        }
        break;
      default:
        // Debug: logga tutti gli eventi non-audio per capire il flusso
        if (msg.type && !msg.type.includes('audio.delta') && !msg.type.includes('audio_transcript.delta')) {
          console.log(`🔍 OpenAI event: ${msg.type}`);
        }
        break;
    }
  }

  // ── Session Ready → Greeting ──────────────────────────────────────────────

  _onSessionReady() {
    const rc = this.restaurantConfig;
    const nome = rc?.restaurant_name || 'ristorante';
    this._say(`Buongiorno! Benvenuto a ${nome}. Per quale giorno desidera prenotare?`);
  }

  // ── Trigger GPT Extraction ────────────────────────────────────────────────

  _triggerExtraction() {
    const now = DateManager.getNow();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayISO = DateManager.toISO(today);
    const dayName = DateManager.DAYS_IT[now.getDay()];

    // Costruisce il calendario dei prossimi 7 giorni in modo esplicito
    const nextDays = [];
    for (let i = 1; i <= 7; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      nextDays.push(`${DateManager.DAYS_IT[d.getDay()]}=${DateManager.toISO(d)}`);
    }
    const calendarStr = nextDays.join(', ');

    this._awaitingExtraction = true;
    this._send({
      type: 'response.create',
      response: {
        modalities: ['text'],
        instructions: `Oggi è ${dayName} ${todayISO}. Prossimi giorni: ${calendarStr}.

Analizza l'audio appena ricevuto e rispondi SOLO con un oggetto JSON esattamente in questo formato, senza nessun altro testo:
{"date":"YYYY-MM-DD o null","time":"HH:MM:SS o null","people":"numero o null","name":"nome o null","intent":"create/modify/cancel/unknown"}

REGOLE INTENT:
- create = vuole fare UNA NUOVA prenotazione ("vorrei prenotare", "un tavolo per", "prenoto")
- modify = vuole cambiare una prenotazione ESISTENTE ("modificare", "spostare", "cambiare", "ho prenotato e vorrei")
- cancel = vuole cancellare ("cancellare", "annullare", "disdire")
- unknown = saluto, ringraziamento, domanda informativa, niente di chiaro

REGOLE DATE/ORA:
- "alle 21" → time: "21:00:00"
- "all'una" / "all'uno" → time: "13:00:00"
- "alle nove di sera" / "alle 9 di sera" → time: "21:00:00"
- "alle nove" senza contesto → time: "09:00:00"
- "sabato" → data sabato dal calendario sopra
- "venerdì" → data venerdì dal calendario sopra
- "alla stessa ora" → time: null (non inventare)

REGOLE NOME+DATA insieme:
- "a nome Rossi per sabato" → name: "Rossi", date: data sabato
- "la prenotazione Ferrari per venerdì" → name: "Ferrari", date: data venerdì
- "prenotazione Bianchi del 18" → name: "Bianchi", date: ${todayISO.substring(0,8)}18

Rispondi SOLO con il JSON, nessun'altra parola. Aggiungi sempre il campo "language" con il codice ISO 639-1 della lingua del cliente (es: "it", "en", "fr", "de", "es").`,
        max_output_tokens: 80,
      },
    });
  }

  // ── Processa dati estratti da GPT ─────────────────────────────────────────

  async _processGPTData(args) {
    if (this.checkingSlot) return;

    const rc = this.restaurantConfig;

    const newDate   = (args.date   && args.date   !== 'null') ? args.date   : null;
    const newTime   = (args.time   && args.time   !== 'null') ? args.time   : null;
    const newPeople = (args.people && args.people !== 'null') ? parseInt(args.people) : null;
    const newName   = (args.name   && args.name   !== 'null') ? args.name.trim() : null;

    // ── Aggiorna lingua rilevata da GPT ──────────────────────────────────────
    if (args.language && args.language !== this.language) {
      this.language = args.language;
      console.log(`🌐 Lingua rilevata da GPT: ${this.language}`);
    }

    // ── Fix 1: CANCEL confirm intercetta anche qui (GPT più veloce di Whisper) ─
    if (this.cancelState === 'awaiting_confirm') {
      // Non fare nulla — la conferma è gestita via testo in _onUserText
      // ma se GPT rileva un cancel/unknown, ignoriamo per non interferire
      return;
    }

    // ── Fix 3: Phase=done — gestisce saluti, ringraziamenti e nuovi intent ────
    if (this.phase === 'done') {
      const intent = args.intent;

      // Nuovo intent modify → usa lastReservation se disponibile, altrimenti cerca
      if (intent === 'modify') {
        this.intent = 'modify';
        this.modifyState = null;
        this.foundReservation = null;
        console.log('🔄 Phase=done: nuovo intent modify rilevato');

        // Se abbiamo la prenotazione appena gestita, usala direttamente
        if (this.lastReservation?.eventId) {
          this.foundReservation = this.lastReservation;
          this.modifyState = 'awaiting_changes';

          // Se il messaggio contiene già la modifica esplicita, applicala subito
          // MA solo se almeno un campo è effettivamente diverso da lastReservation
          // (evita doppio aggiornamento quando il cliente dice "grazie" e GPT estrae il contesto residuo)
          if (newName || newDate || newTime || newPeople) {
            const r = this.lastReservation;
            const timeNorm = r.time?.length === 5 ? r.time + ':00' : (r.time || '');
            const actuallyChanged =
              (newName   && newName   !== r.name)   ||
              (newDate   && newDate   !== r.date)   ||
              (newTime   && newTime   !== timeNorm) ||
              (newPeople && Number(newPeople) !== Number(r.people));

            if (!actuallyChanged) {
              console.log(`💾 Phase=done MODIFY: dati identici a lastReservation, ignoro`);
              this._say('Grazie a lei! Posso aiutarla con altro?');
              return;
            }

            console.log(`💾 Phase=done MODIFY: applico cambio diretto su lastReservation`);
            await this._handleModifyFlow(newDate, newTime, newPeople, newName);
            return;
          }

          // Altrimenti mostra la prenotazione trovata e chiedi cosa modificare
          const r = this.lastReservation;
          const timeNorm = r.time?.length === 5 ? r.time + ':00' : (r.time || '');
          const dateDisplay = DateManager.formatForDisplay(r.date);
          const timeDisplay = TimeManager.formatForDisplay(timeNorm);
          console.log(`💾 Phase=done MODIFY: uso lastReservation direttamente (${r.name}, ${r.date})`);
          this._injectContext(r);
          this._say(`Ho trovato: ${r.name}, ${dateDisplay} alle ${timeDisplay} per ${r.people} persone. Cosa vuole modificare?`);
          return;
        }

        await this._handleModifyFlow(newDate, newTime, newPeople, newName);
        return;
      }

      // Nuovo intent cancel → avvia CANCEL flow
      if (intent === 'cancel') {
        this.intent = 'cancel';
        this.cancelState = null;
        this.foundReservation = null;
        console.log('🔄 Phase=done: nuovo intent cancel rilevato');
        await this._handleCancelFlow(newDate, newName);
        return;
      }

      // Nuovo intent create → reset e riparte
      if (intent === 'create') {
        this.intent = 'create';
        this.phase = 'collecting';
        this.data = { date: null, time: null, people: null, name: null, notes: null, alternativePhone: null };
        this.modifyState = null;
        this.cancelState = null;
        this.foundReservation = null;
        this.checkingSlot = false;
        this.availDone = false;
        console.log('🔄 Phase=done: nuovo intent create — reset e riparto');
        await this._processGPTData(args);
        return;
      }

      // Intent unknown (saluti, ringraziamenti, note aggiuntive, "posso aiutarti con altro?")
      console.log('💬 Phase=done: intent unknown — risposta cortese');

      // Se ci sono nuove note rilevate dalla trascrizione e abbiamo lastReservation, aggiorna
      // (es: "siamo celiaci" dopo la prenotazione confermata)
      // La rilevazione note avviene in _detectNotesAndPhone via Whisper transcript
      // Il controllo lo facciamo qui: se this.data.notes è cambiato rispetto a lastReservation
      if (this.lastReservation?.eventId && this.data.notes &&
          this.data.notes !== this.lastReservation.notes) {
        const updatedNotes = this.data.notes;
        console.log(`📝 Phase=done: nuove note rilevate, aggiorno lastReservation: "${updatedNotes}"`);
        this._callAppsScript({
          action: 'update_reservation',
          eventId: this.lastReservation.eventId,
          nome: this.lastReservation.name,
          data: this.lastReservation.date,
          ora: this.lastReservation.time,
          persone: this.lastReservation.people,
          telefono: this.lastReservation.phone,
          notes: updatedNotes,
        }).then(r => {
          console.log(`✅ Note aggiornate su prenotazione: ${r?.status}`);
          if (this.lastReservation) this.lastReservation.notes = updatedNotes;
        }).catch(err => console.error('❌ Errore aggiornamento note:', err));
      }
      this._send({
        type: 'response.create',
        response: {
          instructions: `Respond in ${this.language || 'it'}. Il cliente ha appena completato una prenotazione o operazione con successo. Rispondi in modo cordiale e naturale: se ringrazia di' "Grazie a lei!" oppure "Prego, è stato un piacere!"; poi chiedi se puoi aiutarlo con altro. Max 2 frasi. Non inventare informazioni sul ristorante.`,
        },
      });
      return;
    }

    // ── Intent ───────────────────────────────────────────────────────────────
    if (!this.intent && args.intent && args.intent !== 'unknown') {
      this.intent = args.intent;
      console.log(`🎯 Intent (GPT): ${this.intent}`);
    }

    const prevDate = this.data.date;
    const prevTime = this.data.time;

    // Se intent=unknown, lascia rispondere GPT con i dati reali iniettati esplicitamente
    if (!args.intent || args.intent === 'unknown') {

      // Se abbiamo date+time+people completi, il cliente sta chiedendo disponibilità
      // con intenzione implicita di prenotare → inferisci create
      const hasDate   = args.date   && args.date   !== 'null';
      const hasTime   = args.time   && args.time   !== 'null';
      const hasPeople = args.people && args.people !== 'null';

      if (hasDate && hasTime && hasPeople) {
        console.log(`💬 Intent unknown con dati completi → inferisco create (data=${args.date}, ora=${args.time}, people=${args.people})`);
        args.intent = 'create';
        // Riprocessa con intent=create
        return this._processGPTData(args);
      }

      console.log('💬 Intent unknown — GPT risponde liberamente con dati reali');
      const rc = this.restaurantConfig;
      const ls = rc?.lunch_start  || '12:00';
      const le = rc?.lunch_end    || '14:30';
      const ds = rc?.dinner_start || '19:00';
      const de = rc?.dinner_end   || '22:30';
      const dayNames = ['domenica','lunedì','martedì','mercoledì','giovedì','venerdì','sabato'];
      const closedDays = rc?.closed_days ? String(rc.closed_days).split(',').map(Number) : [1];
      const lunchClosedDays = rc?.lunch_closed_days ? String(rc.lunch_closed_days).split(',').map(Number) : [];
      const dinnerClosedDays = rc?.dinner_closed_days ? String(rc.dinner_closed_days).split(',').map(Number) : [];
      const allDays = [0,1,2,3,4,5,6];
      const openForLunch = allDays.filter(d => !closedDays.includes(d) && !lunchClosedDays.includes(d)).map(d => dayNames[d]).join(', ');
      const openForDinner = allDays.filter(d => !closedDays.includes(d) && !dinnerClosedDays.includes(d)).map(d => dayNames[d]).join(', ');
      const closedText = closedDays.map(d => dayNames[d]).join(', ');

      this._send({
        type: 'response.create',
        response: {
          instructions: `Respond in ${this.language || 'it'}. Rispondi alla domanda del cliente usando ESCLUSIVAMENTE questi dati, senza aggiungere nulla:
- Pranzo ${ls}-${le}: aperto ${openForLunch || 'nessun giorno'}
- Cena ${ds}-${de}: aperto ${openForDinner || 'nessun giorno'}
- Chiuso il: ${closedText}
Max 2 frasi. Non inventare nulla.`,
        },
      });
      return;
    }

    // ── MODIFY flow ──────────────────────────────────────────────────────────
    if (this.intent === 'modify') {
      await this._handleModifyFlow(newDate, newTime, newPeople, newName);
      return;
    }

    // ── CANCEL flow ──────────────────────────────────────────────────────────
    if (this.intent === 'cancel') {
      // confirm phase gestita direttamente via testo in _onUserText
      if (this.cancelState !== 'awaiting_confirm') {
        await this._handleCancelFlow(newDate, newName);
      }
      return;
    }

    if (newDate   && newDate   !== this.data.date)   { console.log(`📅 date:   ${this.data.date} → ${newDate}`);     this.data.date   = newDate; }
    if (newTime   && newTime   !== this.data.time)   { console.log(`⏰ time:   ${this.data.time} → ${newTime}`);     this.data.time   = newTime; }
    if (newPeople && newPeople !== this.data.people) { console.log(`👥 people: ${this.data.people} → ${newPeople}`); this.data.people = newPeople; }
    if (newName   && !this.data.name)                { console.log(`👤 name:   ${newName}`);                         this.data.name   = newName; }

    console.log(`📊 date=${this.data.date} time=${this.data.time} people=${this.data.people} name=${this.data.name}`);

    // ── Fase naming: se siamo già in naming basta il nome ────────────────────
    if (this.phase === 'naming') {
      this._processNaming(this.data.name ? '__name_already_set__' : (newName || ''));
      return;
    }

    // ── Fase collecting ──────────────────────────────────────────────────────

    // ① Check giorno chiuso
    if (this.data.date && this.data.date !== prevDate) {
      const msg = ValidationPipeline.getDayClosedMessage(this.data.date, rc);
      if (msg) {
        console.log(`🚫 Giorno chiuso: ${this.data.date}`);
        this.data.date = null;
        this._say(msg);
        return;
      }
    }

    // ② Check orario valido + pranzo/cena chiuso
    // Triggera quando time OPPURE date cambia (es: stesso orario, giorno diverso)
    if (this.data.date && this.data.time &&
        (this.data.time !== prevTime || this.data.date !== prevDate)) {
      if (!ValidationPipeline.isValidTime(this.data.time, rc)) {
        const msg = ValidationPipeline.getTimeInvalidMessage(this.data.time, this.data.date, rc);
        console.log(`🚫 Orario non valido: ${this.data.time}`);
        this.data.time = null;
        this._say(msg);
        return;
      }

      // ③ Check pranzo/cena chiuso
      const [h] = this.data.time.split(':').map(Number);
      const isPranzo = h >= 10 && h <= 16;
      if (isPranzo && ValidationPipeline.isLunchClosed(this.data.date, rc)) {
        const dayName = DateManager.getDayName(this.data.date);
        const ds = rc?.dinner_start || '21:00';
        const de = rc?.dinner_end   || '22:30';
        this.data.time = null;
        this._say(`Il ${dayName} siamo aperti solo a cena (${ds}-${de}). Vuole prenotare per cena?`);
        return;
      }
      const isCena = h >= 17 || h <= 3;
      if (isCena && ValidationPipeline.isDinnerClosed(this.data.date, rc)) {
        const dayName = DateManager.getDayName(this.data.date);
        const ls = rc?.lunch_start || '12:00';
        const le = rc?.lunch_end   || '14:30';
        this.data.time = null;
        this._say(`Il ${dayName} siamo aperti solo a pranzo (${ls}-${le}). Vuole prenotare per pranzo?`);
        return;
      }
    }

    // ④ Tutti e 3 → check slot
    if (this.data.date && this.data.time && this.data.people && !this.checkingSlot) {
      await this._checkSlot();
      return;
    }

    // Chiedi dato mancante
    if (!this.data.date)   { this._ask('date');   }
    else if (!this.data.time)   { this._ask('time');   }
    else if (!this.data.people) { this._ask('people'); }
  }

  // ── Note e Telefono Alternativo ───────────────────────────────────────────

  _detectNotesAndPhone(text) {
    const t = text.toLowerCase();

    // ── Keyword note ─────────────────────────────────────────────────────────
    const noteKeywords = [
      { pattern: /celiac[oai]|ciliac[oai]|senza\s+glutine|intolleranz[ae]\s+glutine|celiac|gluten[\s-]free/i, note: 'Intolleranza glutine' },
      { pattern: /lattosio|lactose|lactose[\s-]intolerant/i,               note: 'Intolleranza lattosio' },
      { pattern: /allergi[ao]|allerg[iy]/i,                                note: 'Allergia (verifica con cliente)' },
      { pattern: /arachidi|arachide|frutta\s*secca|noci|peanut|tree\s*nut/i, note: 'Allergia frutta secca' },
      { pattern: /vegetarian[oai]|vegetarian/i,                            note: 'Vegetariano' },
      { pattern: /vegan[oai]|vegan/i,                                      note: 'Vegano' },
      { pattern: /seggiol[eo]n[eo]|seggiolino|highchair|high\s*chair/i,   note: 'Richiesto seggiolone' },
      { pattern: /bambino\s*piccolo|neonat[oi]|bimb[oi]\s*piccol|baby|infant/i, note: 'Neonato/bambino piccolo' },
      { pattern: /anniversario|anniversary/i,                              note: 'Anniversario' },
      { pattern: /compleanno|birthday/i,                                   note: 'Compleanno' },
      { pattern: /propost[ae]\s*di\s*matrimonio|fidanzamento|proposal|engagement/i, note: 'Proposta di matrimonio' },
      { pattern: /occasion[ei]\s*speciale|special\s*occasion/i,           note: 'Occasione speciale' },
      { pattern: /romantico|romantica|romantic/i,                          note: 'Cena romantica' },
      { pattern: /finestra|vista|window\s*seat|window\s*table/i,          note: 'Tavolo vicino finestra' },
      { pattern: /esterno|terrazza|giardino|dehor|outdoor|terrace/i,      note: 'Tavolo esterno/terrazza' },
      { pattern: /sedia\s*a\s*rotelle|disabil|carrozzin|wheelchair|disabled/i, note: 'Accessibilità disabili' },
      { pattern: /tranquill[oa]|riservat[oa]|quiet|private/i,             note: 'Tavolo tranquillo/riservato' },
    ];

    const newNotes = [];
    for (const { pattern, note } of noteKeywords) {
      if (pattern.test(text)) {
        // Evita duplicati
        if (!this.data.notes || !this.data.notes.includes(note)) {
          newNotes.push(note);
          console.log(`📝 Nota rilevata: "${note}"`);
        }
      }
    }

    if (newNotes.length > 0) {
      const toAdd = newNotes.join('; ');
      this.data.notes = this.data.notes
        ? `${this.data.notes}; ${toAdd}`
        : toAdd;
    }

    // ── Telefono alternativo ─────────────────────────────────────────────────
    const phonePattern = /(?:numero|telefono|cell(?:ulare)?|phone|number|contatt).*?(\+?\d[\d\s\-]{6,14}\d)/i;
    const phoneMatch = text.match(phonePattern);
    if (phoneMatch && !this.data.alternativePhone) {
      const phoneNumber = phoneMatch[1].replace(/[\s\-]/g, '');
      this.data.alternativePhone = phoneNumber;
      const phoneNote = `Tel. alternativo: ${phoneNumber}`;
      console.log(`📞 Telefono alternativo: "${phoneNumber}"`);
      if (!this.data.notes || !this.data.notes.includes('Tel. alternativo')) {
        this.data.notes = this.data.notes
          ? `${this.data.notes}; ${phoneNote}`
          : phoneNote;
      }
    }
  }

  // ── Core Logic Engine ─────────────────────────────────────────────────────

  async _onUserText(text) {
    if (this.checkingSlot) return;

    // ── CANCEL: conferma sì/no via testo grezzo — intercetta PRIMA di tutto ──
    if (this.cancelState === 'awaiting_confirm') {
      await this._handleCancelConfirmText(text);
      return;
    }

    // Dopo phase=done, la logica è gestita da _processGPTData (via extraction)
    if (this.phase === 'done') return;

    // Rileva note e telefono alternativo su ogni messaggio
    this._detectNotesAndPhone(text);

    // Detect intent on first message
    if (!this.intent) {
      this.intent = IntentDetector.detect(text);
      console.log(`🎯 Intent: ${this.intent}`);
    }

    // ── COLLECT PHASE ─────────────────────────────────────────────────────
    if (this.phase === 'collecting') {
      await this._processCollecting(text);
    }
    // ── NAMING PHASE (dopo check slot ok) ─────────────────────────────────
    else if (this.phase === 'naming') {
      this._processNaming(text);
    }
  }

  async _processCollecting(text) {
    const rc = this.restaurantConfig;

    const prevDate = this.data.date;
    const prevTime = this.data.time;

    // Parse
    const date   = DateManager.parseFromText(text);
    const time   = TimeManager.parseFromText(text);
    const people = PeopleManager.parseFromText(text);

    if (date   && date   !== this.data.date)   { console.log(`📅 date:   ${this.data.date} → ${date}`);     this.data.date=date; }
    if (time   && time   !== this.data.time)   { console.log(`⏰ time:   ${this.data.time} → ${time}`);     this.data.time=time; }
    if (people && people !== this.data.people) { console.log(`👥 people: ${this.data.people} → ${people}`); this.data.people=people; }

    // Estrai nome anticipato se già presente nel messaggio (es. "sabato alle 21 per 2, nome Luca")
    if (!this.data.name) {
      const earlyName = this._extractName(text);
      if (earlyName) {
        this.data.name = earlyName;
        console.log(`👤 Nome anticipato: ${earlyName}`);
      }
    }

    console.log(`📊 date=${this.data.date} time=${this.data.time} people=${this.data.people}`);

    // ① Check giorno chiuso
    if (this.data.date && this.data.date !== prevDate) {
      const msg = ValidationPipeline.getDayClosedMessage(this.data.date, rc);
      if (msg) {
        console.log(`🚫 Giorno chiuso: ${this.data.date}`);
        this.data.date = null;
        this._say(msg);
        return;
      }
    }

    // ②③ Check fascia oraria + pranzo/cena chiuso
    if (this.data.date && this.data.time && this.data.time !== prevTime) {
      if (!ValidationPipeline.isValidTime(this.data.time, rc)) {
        const msg = ValidationPipeline.getTimeInvalidMessage(this.data.time, this.data.date, rc);
        console.log(`🚫 Orario non valido: ${this.data.time}`);
        this.data.time = null;
        this._say(msg);
        return;
      }

      // ② Check pranzo chiuso per quel giorno
      const [h] = this.data.time.split(':').map(Number);
      const isPranzo = h >= 10 && h <= 16;
      if (isPranzo && ValidationPipeline.isLunchClosed(this.data.date, rc)) {
        const dayName = DateManager.getDayName(this.data.date);
        const ds = rc?.dinner_start || '21:00';
        const de = rc?.dinner_end   || '22:30';
        const msg = `Il ${dayName} siamo aperti solo a cena (${ds}-${de}). Vuole prenotare per cena?`;
        console.log(`🚫 Pranzo chiuso: ${this.data.date}`);
        this.data.time = null;
        this._say(msg);
        return;
      }

      // ③ Check cena chiusa per quel giorno
      const isCena = h >= 17 || h <= 3;
      if (isCena && ValidationPipeline.isDinnerClosed(this.data.date, rc)) {
        const dayName = DateManager.getDayName(this.data.date);
        const ls = rc?.lunch_start || '12:00';
        const le = rc?.lunch_end   || '14:30';
        const msg = `Il ${dayName} siamo aperti solo a pranzo (${ls}-${le}). Vuole prenotare per pranzo?`;
        console.log(`🚫 Cena chiusa: ${this.data.date}`);
        this.data.time = null;
        this._say(msg);
        return;
      }

      // Orario ok — se abbiamo anche le persone vai al check slot
      if (this.data.people) {
        await this._checkSlot();
        return;
      }
      this._ask('people');
      return;
    }

    // ④ Tutti e 3 → check slot
    if (this.data.date && this.data.time && this.data.people && !this.checkingSlot) {
      await this._checkSlot();
      return;
    }

    // Chiedi dato mancante
    if (!this.data.date) {
      this._ask('date');
    } else if (!this.data.time) {
      this._ask('time');
    } else if (!this.data.people) {
      this._ask('people');
    }
  }

  _processNaming(text) {
    const rc = this.restaurantConfig;

    // Se il nome è già stato settato da GPT, conferma direttamente
    if (text === '__name_already_set__' && this.data.name) {
      console.log(`👤 Nome (GPT): ${this.data.name}`);
      this._confirmReservation();
      return;
    }

    // ── Controlla se l'utente sta correggendo i dati prima di dare il nome ──
    // ── Controlla correzioni dati in fase naming ──────────────────────────────
    // Anche senza parole trigger esplicite, se il cliente menziona dati diversi
    // da quelli già raccolti, trattiamo come correzione
    {
      let changed = false;

      const newPeople = PeopleManager.parseFromText(
        text.replace(/\bnon\s+(?:in\s+)?\w+/gi, '')
      );
      const newTime   = TimeManager.parseFromText(text);

      // Per la data: rimuovi contesto negativo ("non per sabato") prima di parsare
      const textForDate = text.replace(/\bnon\s+per\s+\w+/gi, '');
      const correctedDate = DateManager.parseFromText(textForDate);

      if (newPeople && newPeople !== this.data.people) {
        console.log(`👥 Correzione persone in naming: ${this.data.people} → ${newPeople}`);
        this.data.people = newPeople;
        changed = true;
      }
      if (newTime && newTime !== this.data.time) {
        console.log(`⏰ Correzione orario in naming: ${this.data.time} → ${newTime}`);
        this.data.time = newTime;
        changed = true;
      }
      if (correctedDate && correctedDate !== this.data.date) {
        console.log(`📅 Correzione data in naming: ${this.data.date} → ${correctedDate}`);
        this.data.date = correctedDate;
        changed = true;
      }

      if (changed) {
        // Controlla se il nome era già nella stessa frase della correzione
        const nameInCorrection = this._extractName(text);
        if (nameInCorrection) {
          this.data.name = nameInCorrection;
          console.log(`👤 Nome trovato nella correzione: ${nameInCorrection}`);
        }
        this.phase = 'collecting';
        this.availDone = false;
        this.checkingSlot = false;
        this._checkSlot();
        return;
      }
    }

    // ── Estrai nome ───────────────────────────────────────────────────────────
    const name = this._extractName(text);
    if (name) {
      this.data.name = name;
      console.log(`👤 Nome: ${name}`);
      this._confirmReservation();
    } else {
      this._say('A che nome faccio la prenotazione?');
    }
  }

  // ── MODIFY flow ───────────────────────────────────────────────────────────

  // Helper: ricerca a 3 stadi (nome+data → solo nome → solo telefono)
  // Valida che il risultato abbia almeno date e name non null
  async _findReservationWithFallback(searchName, searchDate, logPrefix) {
    const phone = this.callerPhone || '';

    const isValid = (r) => r && r.date && r.name && r.date !== 'null' && r.name !== 'null';

    // Stadio 1: nome + data
    if (searchName && searchDate) {
      console.log(`🔍 ${logPrefix} cerca: nome=${searchName}, data=${searchDate}`);
      const r1 = await this._callAppsScript({ action: 'find_reservation', nome: searchName, data: searchDate });
      if (r1?.found && isValid(r1.reservation)) return r1.reservation;
    }

    // Stadio 2: solo nome
    if (searchName) {
      console.log(`🔍 ${logPrefix} fallback: solo nome=${searchName}`);
      const r2 = await this._callAppsScript({ action: 'find_reservation', nome: searchName });
      if (r2?.found && isValid(r2.reservation)) return r2.reservation;
    }

    // Stadio 3: solo telefono
    if (phone) {
      console.log(`🔍 ${logPrefix} fallback: solo telefono=${phone}`);
      const r3 = await this._callAppsScript({ action: 'find_reservation', telefono: phone });
      if (r3?.found && isValid(r3.reservation)) return r3.reservation;
    }

    return null;
  }

  async _handleModifyFlow(newDate, newTime, newPeople, newName) {
    // Phase 1: primo messaggio modify → se contiene già nome e data, salta il prompt
    if (!this.modifyState) {
      this.modifyState = 'awaiting_search';

      // Se il primo messaggio contiene già nome E data, cerca subito
      if (newName && newDate) {
        if (newName) this.data.name = newName;
        if (newDate) this.data.date = newDate;
        const r = await this._sayThenDo('Un momento, cerco la prenotazione...', () => this._findReservationWithFallback(newName, newDate, 'MODIFY primo msg'));
        if (r) {
          this.foundReservation = r;
          const timeNorm = r.time?.length === 5 ? r.time + ':00' : (r.time || '');
          const dateDisplay = DateManager.formatForDisplay(r.date);
          const timeDisplay = TimeManager.formatForDisplay(timeNorm);
          this.modifyState = 'awaiting_changes';
          this._injectContext(r);
          this._say(`Ho trovato: ${r.name}, ${dateDisplay} alle ${timeDisplay} per ${r.people} persone. Cosa vuole modificare?`);
        } else {
          this._say(`Non trovo nessuna prenotazione a nome ${newName}. Può riprovare con un altro nome o data?`);
        }
        return;
      }

      // Se abbiamo solo il nome (senza data), cerca subito per nome/telefono
      if (newName && !newDate) {
        if (newName) this.data.name = newName;
        console.log(`🔍 MODIFY primo msg: solo nome=${newName}, cerco senza data`);
        const r = await this._sayThenDo('Un momento, cerco la prenotazione...', () => this._findReservationWithFallback(newName, null, 'MODIFY solo nome'));
        if (r) {
          this.foundReservation = r;
          const timeNorm = r.time?.length === 5 ? r.time + ':00' : (r.time || '');
          const dateDisplay = DateManager.formatForDisplay(r.date);
          const timeDisplay = TimeManager.formatForDisplay(timeNorm);
          this.modifyState = 'awaiting_changes';
          this._injectContext(r);
          this._say(`Ho trovato: ${r.name}, ${dateDisplay} alle ${timeDisplay} per ${r.people} persone. Cosa vuole modificare?`);
        } else {
          this._say('A che nome è la prenotazione e per quale data?');
        }
        return;
      }

      // Altrimenti chiedi nome e data
      this._say('Certo! A che nome è la prenotazione e per quale data?');
      return;
    }

    // Phase 2: cerca la prenotazione
    if (this.modifyState === 'awaiting_search') {
      const searchName = newName || this.data.name;
      const searchDate = newDate || this.data.date;

      // Aggiorna dati locali per mantenere contesto
      if (newName) this.data.name = newName;
      if (newDate) this.data.date = newDate;

      if (!searchName && !searchDate) {
        this._say('Può dirmi a che nome è la prenotazione e per quale data?');
        return;
      }
      if (!searchName) {
        this._say('A che nome è la prenotazione?');
        return;
      }
      if (!searchDate) {
        this._say('Per quale data è la prenotazione?');
        return;
      }

      const r = await this._sayThenDo('Un momento, cerco la prenotazione...', () => this._findReservationWithFallback(searchName, searchDate, 'MODIFY'));
      if (r) {
        this.foundReservation = r;
        const timeNorm = r.time?.length === 5 ? r.time + ':00' : (r.time || '');
        const dateDisplay = DateManager.formatForDisplay(r.date);
        const timeDisplay = TimeManager.formatForDisplay(timeNorm);
        this.modifyState = 'awaiting_changes';
        this._injectContext(r);
        this._say(`Ho trovato: ${r.name}, ${dateDisplay} alle ${timeDisplay} per ${r.people} persone. Cosa vuole modificare?`);
      } else {
        this._say(`Non trovo nessuna prenotazione a nome ${searchName}. Può riprovare con un altro nome o data?`);
      }
      return;
    }

    // Phase 3: applica le modifiche
    if (this.modifyState === 'awaiting_changes') {
      const r = this.foundReservation;
      if (!r) { this.modifyState = null; return; }

      const timeOrig = r.time?.length >= 5 ? (r.time.length === 5 ? r.time + ':00' : r.time) : null;

      if (!timeOrig && !newTime) {
        this._say(`Non riesco a leggere l'orario della prenotazione. A che ora era prevista?`);
        return;
      }

      const timeChangedExplicitly = newTime && newTime !== timeOrig;

      const updDate   = newDate   || r.date;
      const updTime   = timeChangedExplicitly ? newTime : timeOrig;
      const updPeople = newPeople || Number(r.people);
      const updName   = newName   || r.name;

      const dateChanged   = newDate   && newDate   !== r.date;
      const timeChanged   = timeChangedExplicitly;
      const peopleChanged = newPeople && newPeople !== Number(r.people);

      if (!dateChanged && !timeChanged && !peopleChanged && !newName) {
        this._say('Non ho capito cosa vuole modificare. Vuole cambiare la data, l\'orario o il numero di persone?');
        return;
      }

      // Se data/ora/persone cambiano → check disponibilità
      if (dateChanged || timeChanged || (peopleChanged && updPeople > Number(r.people))) {
        console.log(`🔍 MODIFY check disponibilità: ${updDate} ${updTime} per ${updPeople}`);
        const checkResult = await this._sayThenDo('Un attimo che verifico la disponibilità...', () => this._callAppsScript({
          action: 'check_availability',
          data: updDate,
          ora: updTime,
          persone: updPeople,
          existingPeople: Number(r.people),
        }));

        if (!checkResult?.success && checkResult?.reason !== 'slot_available') {
          this._say(`Mi dispiace, quell'orario non è disponibile. Vuole provare un altro orario?`);
          return;
        }
      }

      console.log(`✏️ MODIFY aggiorna eventId=${r.eventId}: ${updDate} ${updTime} ${updPeople} pax ${updName}`);
      const updateResult = await this._sayThenDo('Perfetto, aggiorno subito...', () => this._callAppsScript({
        action: 'update_reservation',
        eventId: r.eventId,
        nome: updName,
        data: updDate,
        ora: updTime,
        persone: updPeople,
        telefono: r.phone || this.callerPhone || '',
        notes: this.data.notes || r.notes || '',
      }));

      this.phase = 'done';
      if (updateResult?.success) {
        const dateDisplay = DateManager.formatForDisplay(updDate);
        const timeDisplay = TimeManager.formatForDisplay(updTime);
        const firstName = (updName || '').split(' ')[0];
        // Salva riferimento alla prenotazione aggiornata per uso post-done
        this.lastReservation = {
          eventId: r.eventId,
          name: updName,
          date: updDate,
          time: updTime,
          people: updPeople,
          phone: r.phone || this.callerPhone || '',
          notes: this.data.notes || r.notes || '',
        };
        console.log(`💾 lastReservation aggiornato dopo MODIFY: eventId=${r.eventId}`);
        this._say(`Perfetto ${firstName}! Ho aggiornato la prenotazione: ${dateDisplay} alle ${timeDisplay} per ${updPeople} persone. Ti aspettiamo!`);
      } else {
        this._say(`Mi dispiace, c'è stato un problema nell'aggiornamento. Può richiamare?`);
      }
    }
  }

  // ── CANCEL flow ───────────────────────────────────────────────────────────

  async _handleCancelFlow(newDate, newName) {
    // Phase 1: primo messaggio cancel → se contiene già nome e data, cerca subito
    if (!this.cancelState) {
      this.cancelState = 'awaiting_search';

      if (newName && newDate) {
        if (newName) this.data.name = newName;
        if (newDate) this.data.date = newDate;
        const r = await this._sayThenDo('Un momento, cerco la prenotazione...', () => this._findReservationWithFallback(newName, newDate, 'CANCEL primo msg'));
        if (r) {
          this.foundReservation = r;
          const timeNorm = r.time?.length === 5 ? r.time + ':00' : (r.time || '');
          const dateDisplay = DateManager.formatForDisplay(r.date);
          const timeDisplay = TimeManager.formatForDisplay(timeNorm);
          this.cancelState = 'awaiting_confirm';
          this._injectContext(r);
          this._say(`Ho trovato: ${r.name}, ${dateDisplay} alle ${timeDisplay} per ${r.people} persone. Conferma la cancellazione?`);
        } else {
          this._say(`Non trovo nessuna prenotazione a nome ${newName}.`);
        }
        return;
      }

      this._say('Certo! A che nome è la prenotazione e per quale data?');
      return;
    }

    // Phase 2: cerca la prenotazione
    if (this.cancelState === 'awaiting_search') {
      const searchName = newName || this.data.name;
      const searchDate = newDate || this.data.date;

      if (newName) this.data.name = newName;
      if (newDate) this.data.date = newDate;

      if (!searchName && !searchDate) {
        this._say('Può dirmi a che nome è la prenotazione e per quale data?');
        return;
      }
      if (!searchName) {
        this._say('A che nome è la prenotazione?');
        return;
      }
      if (!searchDate) {
        this._say('Per quale data è la prenotazione?');
        return;
      }

      const r = await this._sayThenDo('Un momento, cerco la prenotazione...', () => this._findReservationWithFallback(searchName, searchDate, 'CANCEL'));
      if (r) {
        this.foundReservation = r;
        const timeNorm = r.time?.length === 5 ? r.time + ':00' : (r.time || '');
        const dateDisplay = DateManager.formatForDisplay(r.date);
        const timeDisplay = TimeManager.formatForDisplay(timeNorm);
        this.cancelState = 'awaiting_confirm';
        this._injectContext(r);
        this._say(`Ho trovato: ${r.name}, ${dateDisplay} alle ${timeDisplay} per ${r.people} persone. Conferma la cancellazione?`);
      } else {
        this._say(`Non trovo nessuna prenotazione a nome ${searchName}.`);
      }
    }
  }

  // ── CANCEL conferma via testo grezzo ──────────────────────────────────────

  async _handleCancelConfirmText(text) {
    const t = text.toLowerCase().trim();
    const isYes = /\bsì|si\b|yes\b|certo\b|confermo\b|ok\b|esatto\b|giusto\b|procedi\b/i.test(t);
    const isNo  = /\bno\b|niente\b|lascia\s+perdere\b|annulla\b|stop\b/i.test(t);

    console.log(`🔤 CANCEL confirm text: "${text}" → yes=${isYes} no=${isNo}`);

    if (isNo) {
      this.phase = 'done';
      this._say('Nessun problema, la prenotazione rimane invariata. Arrivederci!');
      return;
    }

    if (isYes) {
      const r = this.foundReservation;
      if (!r) { this.phase = 'done'; return; }

      const timeNorm = r.time?.length === 5 ? r.time + ':00' : (r.time || '');
      console.log(`🗑️ CANCEL conferma: nome=${r.name}, data=${r.date}, ora=${timeNorm}`);

      const result = await this._sayThenDo('Un attimo che procedo con la cancellazione...', () => this._callAppsScript({
        action: 'cancel_reservation',
        nome: r.name,
        data: r.date,
        ora: timeNorm,
        telefono: r.phone || this.callerPhone || '',
      }));

      this.phase = 'done';
      if (result?.success || result?.status === 'CANCELLED') {
        this._say('La prenotazione è stata cancellata. Speriamo di rivederla presto!');
      } else {
        this._say(`Mi dispiace, c'è stato un problema nella cancellazione. Può richiamare?`);
      }
      return;
    }

    // Risposta non chiara
    this._say('Non ho capito. Conferma la cancellazione? Dica sì o no.');
  }

  // ── Ask Next Field ────────────────────────────────────────────────────────

  _ask(field) {
    const msgs = {
      date:   'Per quale giorno vuole prenotare?',
      time:   'A che ora desidera il tavolo?',
      people: 'Per quante persone?',
      name:   'A che nome faccio la prenotazione?',
    };
    this._say(msgs[field] || 'Può ripetere?');
  }

  // ── Check Slot ────────────────────────────────────────────────────────────

  async _checkSlot() {
    if (this.checkingSlot) return;
    this.checkingSlot = true;

    const { date, time, people } = this.data;
    const rc = this.restaurantConfig;
    console.log(`🔍 Check slot: ${date} ${time} per ${people}`);

    // ── TEST 9: Gruppi grandi ─────────────────────────────────────────────────
    const eventThreshold = Number(rc?.event_threshold) || 45;
    const largeGroupThreshold = Number(rc?.large_group_threshold) || 10;
    const ownerEmail = rc?.owner_email || '';

    if (people >= eventThreshold) {
      console.log(`🎉 Evento: ${people} persone (soglia: ${eventThreshold})`);
      this.checkingSlot = false;
      this._say(`Per eventi di ${people} persone o più, ti chiedo di contattarci via email a ${ownerEmail}. Saremo felici di organizzare!`);
      return;
    }

    if (people > largeGroupThreshold) {
      console.log(`👥 Gruppo grande: ${people} persone (soglia: ${largeGroupThreshold})`);
      this.checkingSlot = false;
      this.phase = 'naming';
      this.availDone = true;
      this._say(`Per gruppi superiori a ${largeGroupThreshold} persone la prenotazione è soggetta a conferma del ristoratore. A che nome la registro?`);
      return;
    }

    try {
      const result = await this._sayThenDo('Un attimo che verifico la disponibilità...', async () => this._callAppsScript({
        action: 'check_availability',
        data: date,
        ora: time,
        persone: people,
      }));

      if (result?.success || result?.reason === 'slot_available') {
        console.log('✅ Slot disponibile');
        this.phase = 'naming';
        this.checkingSlot = false;
        this.availDone = true;
        this._lastAsked = null;
        // Piccolo delay per assicurarsi che la risposta di estrazione sia completata
        await new Promise(r => setTimeout(r, 300));
        if (this.data.name) {
          this._confirmReservation();
        } else {
          this._say('Perfetto! A che nome faccio la prenotazione?');
        }
      } else if (result?.reason === 'slot_full') {
        console.log('❌ Slot pieno');
        this.checkingSlot = false;

        // Cerca slot realmente disponibili invece di dire orari hardcoded
        try {
          const alts = await this._callAppsScript({
            action: 'find_available_slots',
            data: date,
            ora: time,
            persone: people,
          });

          const sameDay = alts?.availableSlots?.sameDay || [];
          const nextDays = alts?.availableSlots?.nextDays || [];

          // Filtra solo orari nei nostri orari di apertura
          const validSameDay = sameDay.filter(s =>
            ValidationPipeline.isValidTime(s.time, rc)
          );

          if (validSameDay.length > 0) {
            const times = validSameDay.slice(0, 3).map(s => s.time.substring(0,5)).join(', ');
            console.log(`✅ Alternative stesso giorno (filtrate): ${times}`);
            this.data.time = null;
            this._say(`Mi dispiace, quell'orario è al completo. Oggi ho disponibilità alle ${times}. Quale preferisce?`);
          } else if (nextDays.length > 0) {
            const first = nextDays[0];
            const dayName = first.dayName || '';
            // Filtra anche i prossimi giorni
            const validSlots = (first.slots || []).filter(s =>
              ValidationPipeline.isValidTime(s.time, rc)
            );
            const times = validSlots.slice(0, 2).map(s => s.time.substring(0,5)).join(' o ');
            console.log(`✅ Alternative prossimi giorni: ${dayName} ${times}`);
            this.data.date = null;
            this.data.time = null;
            this._say(`Mi dispiace, siamo al completo per quel giorno. Prima disponibilità ${dayName} alle ${times}. Vuole prenotare?`);
          } else {
            console.log('❌ Nessuna alternativa valida trovata');
            this.data.date = null;
            this.data.time = null;
            this._say('Mi dispiace, siamo al completo per quel giorno. Vuole provare un altro giorno?');
          }
        } catch (err) {
          console.error('❌ Errore ricerca alternative:', err);
          this.data.time = null;
          const ds = rc?.dinner_start || '21:00';
          const de = rc?.dinner_end   || '22:30';
          this._say(`Mi dispiace, quell'orario è al completo. Abbiamo disponibilità in altre fasce tra le ${ds} e le ${de}. Quale preferisce?`);
        }
      } else if (result?.reason === 'day_closed') {
        console.log('🚫 Giorno chiuso (da Apps Script)');
        this.data.date = null;
        this.checkingSlot = false;
        this._say('Mi dispiace, quel giorno siamo chiusi. Per quale altro giorno vuole prenotare?');
      } else {
        console.log('⚠️ Check incerto, procedo');
        this.phase = 'naming';
        this.checkingSlot = false;
        this.availDone = true;
        this._say('A che nome faccio la prenotazione?');
      }
    } catch (err) {
      console.error('❌ Errore check slot:', err);
      this.phase = 'naming';
      this.checkingSlot = false;
      this.availDone = true;
      this._say('A che nome faccio la prenotazione?');
    }
  }

  // ── Confirm Reservation ───────────────────────────────────────────────────

  _confirmReservation() {
    const { date, time, people, name } = this.data;
    const dateDisplay  = DateManager.formatForDisplay(date);
    const timeDisplay  = TimeManager.formatForDisplay(time);
    const firstName    = (name || '').split(' ')[0];

    this.phase = 'done';

    this._say(
      `Perfetto ${firstName}! Ho prenotato per ${people} persone ${dateDisplay} alle ${timeDisplay}. Ti aspettiamo!`
    );

    // Crea prenotazione in background
    this._callAppsScript({
      source: 'telnyx',
      nome: name,
      persone: people,
      data: date,
      ora: time,
      telefono: this.callerPhone || '',
      notes: this.data.notes || '',
      forceNew: true,
    }).then(result => {
      console.log('📅 Prenotazione creata:', result?.success ? '✅' : '❌', result);
      if (this.data.notes) console.log(`📝 Note inviate: "${this.data.notes}"`);
      // Salva riferimento alla prenotazione appena creata per uso post-done
      if (result?.success && result.eventId) {
        this.lastReservation = {
          eventId: result.eventId,
          name: name,
          date: date,
          time: time,
          people: people,
          phone: this.callerPhone || '',
          notes: this.data.notes || '',
        };
        console.log(`💾 lastReservation salvato: eventId=${result.eventId}`);
      }
    }).catch(err => {
      console.error('❌ Errore creazione prenotazione:', err);
    });
  }

  // ── Name Extractor ────────────────────────────────────────────────────────

  _extractName(text) {
    if (!text) return null;

    const excluded = ['si','no','ok','perfetto','grazie','esatto','confermo',
                      'nome','certo','quello','quella','giusto','pronto'];

    // Pulizia: rimuovi congiunzioni inserite da Whisper tra "nome" e il nome vero
    // es. "Nome e Mirko" → "Nome Mirko", "Nome è Mirko" → "Nome Mirko"
    let t = text.trim();
    t = t.replace(/\bnome\s+[eè]\s+/i, 'Nome ');
    t = t.replace(/\bil\s+nome\s+è\s+/i, 'Nome ');
    t = t.replace(/\bil\s+nome\s+/i, 'Nome ');

    const patterns = [
      // Italiano
      /\bmi\s+chiamo\s+([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)?)/i,
      /\bsono\s+([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)?)/i,
      /\ba\s+nome\s+(?:di\s+)?([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)*)/i,
      /\bnome\s+([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)?)/i,
      /^(?:no[,\s]+)?a\s+([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)?)[\s.,!]*$/i,
      // Inglese / universale
      /\bmy\s+name\s+is\s+([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)?)/i,
      /\bi(?:'m|\s+am)\s+([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)?)/i,
      /\bunder\s+(?:the\s+)?name\s+(?:of\s+)?([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)*)/i,
      /\bname\s+([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)?)/i,
      /\bbook(?:ing)?\s+(?:for|under)\s+([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)?)/i,
      // Francese
      /\bje\s+m['']appelle\s+([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)?)/i,
      /\bau\s+nom\s+(?:de\s+)?([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)*)/i,
      // Spagnolo
      /\bme\s+llamo\s+([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)?)/i,
      /\ba\s+nombre\s+(?:de\s+)?([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)*)/i,
      // Generico — nome da solo o ultima parola (fallback)
      /^([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)?)[\s.,!]*$/i,
    ];

    for (const p of patterns) {
      const match = t.match(p);
      if (match && match[1] && match[1].length >= 2) {
        const words = match[1].trim().split(/\s+/);
        const name = excluded.includes(words[0].toLowerCase())
          ? words.slice(1).join(' ')
          : match[1].trim();

        if (name.length >= 2 && !excluded.includes(name.toLowerCase())) {
          // Capitalizza prima lettera di ogni parola (Whisper trascrive spesso in minuscolo)
          return name.replace(/\b\w/g, c => c.toUpperCase());
        }
      }
    }
    return null;
  }

  // ── Say / Send ────────────────────────────────────────────────────────────

  // Attende che response.audio.done arrivi (max 3s per sicurezza)
  _waitForAudioDone() {
    return new Promise(resolve => {
      const timeout = setTimeout(resolve, 3000);
      this._audioDoneResolve = () => {
        clearTimeout(timeout);
        resolve();
      };
    });
  }

  // Frasi thinking pre-tradotte — evita che GPT usi il context per hallucinate
  static THINKING_PHRASES = {
    // ── Thinking operativi ───────────────────────────────────────────────────
    'Un attimo che verifico la disponibilità...': {
      en: 'Just a moment while I check availability...',
      fr: 'Un instant, je vérifie la disponibilité...',
      es: 'Un momento mientras verifico la disponibilidad...',
      de: 'Einen Moment, ich prüfe die Verfügbarkeit...',
    },
    'Un momento, cerco la prenotazione...': {
      en: 'Just a moment, looking for your reservation...',
      fr: 'Un instant, je cherche votre réservation...',
      es: 'Un momento, busco su reserva...',
      de: 'Einen Moment, ich suche Ihre Reservierung...',
    },
    'Perfetto, aggiorno subito...': {
      en: 'Perfect, updating right away...',
      fr: 'Parfait, je mets à jour immédiatement...',
      es: 'Perfecto, actualizando ahora mismo...',
      de: 'Perfekt, ich aktualisiere sofort...',
    },
    'Un attimo che procedo con la cancellazione...': {
      en: 'Just a moment while I process the cancellation...',
      fr: 'Un instant pendant que je procède à l\'annulation...',
      es: 'Un momento mientras proceso la cancelación...',
      de: 'Einen Moment, ich bearbeite die Stornierung...',
    },
    // ── MODIFY / CANCEL — domande statiche ───────────────────────────────────
    'Certo! A che nome è la prenotazione e per quale data?': {
      en: 'Of course! What name is the reservation under and for what date?',
      fr: 'Bien sûr ! Quel est le nom de la réservation et pour quelle date ?',
      es: 'Por supuesto! ¿A qué nombre está la reserva y para qué fecha?',
      de: 'Natürlich! Auf welchen Namen läuft die Reservierung und für welches Datum?',
    },
    'Può dirmi a che nome è la prenotazione e per quale data?': {
      en: 'Could you tell me the name on the reservation and the date?',
      fr: 'Pouvez-vous me dire le nom de la réservation et la date ?',
      es: '¿Puede decirme el nombre de la reserva y la fecha?',
      de: 'Können Sie mir den Namen der Reservierung und das Datum nennen?',
    },
    'A che nome è la prenotazione?': {
      en: 'What name is the reservation under?',
      fr: 'Quel est le nom de la réservation ?',
      es: '¿A qué nombre está la reserva?',
      de: 'Auf welchen Namen läuft die Reservierung?',
    },
    'Per quale data è la prenotazione?': {
      en: 'What date is the reservation for?',
      fr: 'Pour quelle date est la réservation ?',
      es: '¿Para qué fecha es la reserva?',
      de: 'Für welches Datum ist die Reservierung?',
    },
    'Non ho capito cosa vuole modificare. Vuole cambiare la data, l\'orario o il numero di persone?': {
      en: 'I didn\'t quite catch that. Would you like to change the date, the time, or the number of people?',
      fr: 'Je n\'ai pas bien compris. Voulez-vous changer la date, l\'heure ou le nombre de personnes ?',
      es: 'No he entendido bien. ¿Desea cambiar la fecha, la hora o el número de personas?',
      de: 'Ich habe das nicht ganz verstanden. Möchten Sie das Datum, die Uhrzeit oder die Personenanzahl ändern?',
    },
    'Nessun problema, la prenotazione rimane invariata. Arrivederci!': {
      en: 'No problem, your reservation remains unchanged. Goodbye!',
      fr: 'Pas de problème, votre réservation reste inchangée. Au revoir !',
      es: 'Sin problema, su reserva permanece sin cambios. ¡Hasta pronto!',
      de: 'Kein Problem, Ihre Reservierung bleibt unverändert. Auf Wiedersehen!',
    },
    'Non ho capito. Conferma la cancellazione? Dica sì o no.': {
      en: 'I didn\'t understand. Do you confirm the cancellation? Please say yes or no.',
      fr: 'Je n\'ai pas compris. Confirmez-vous l\'annulation ? Dites oui ou non.',
      es: 'No he entendido. ¿Confirma la cancelación? Diga sí o no.',
      de: 'Ich habe das nicht verstanden. Bestätigen Sie die Stornierung? Bitte sagen Sie ja oder nein.',
    },
    'Perfetto! A che nome faccio la prenotazione?': {
      en: 'Perfect! What name should I put the reservation under?',
      fr: 'Parfait ! À quel nom dois-je faire la réservation ?',
      es: '¡Perfecto! ¿A qué nombre hago la reserva?',
      de: 'Perfekt! Auf welchen Namen soll ich die Reservierung machen?',
    },
    'A che nome faccio la prenotazione?': {
      en: 'What name should I put the reservation under?',
      fr: 'À quel nom dois-je faire la réservation ?',
      es: '¿A qué nombre hago la reserva?',
      de: 'Auf welchen Namen soll ich die Reservierung machen?',
    },
  };

  // Dice una frase "thinking" pre-tradotta e aspetta che finisca prima di eseguire l'operazione lenta
  async _sayThenDo(italianMsg, asyncOperation) {
    const lang = this.language || 'it';
    // Usa la versione pre-tradotta se disponibile, altrimenti usa l'italiano
    const translated = OpenAIRealtimeClient.THINKING_PHRASES[italianMsg]?.[lang];
    const textToSay = (lang !== 'it' && translated) ? translated : italianMsg;
    // _sayDirect: dice la frase ESATTAMENTE senza passare per GPT translation
    // (evita hallucination da context window)
    this._sayDirect(textToSay);
    await this._waitForAudioDone();
    return await asyncOperation();
  }

  // Dice una frase esatta senza traduzione GPT (per frasi pre-tradotte)
  _sayDirect(text) {
    console.log(`💉 [say]: ${text.substring(0, 100)}`);
    const lang = this.language || 'it';
    const instruction = lang === 'it'
      ? `Di' ESATTAMENTE e SOLO questa frase, senza aggiungere nulla: "${text}"`
      : `Say EXACTLY and ONLY this phrase with correct ${lang} pronunciation, nothing else: "${text}"`;
    this._send({
      type: 'response.create',
      response: { instructions: instruction },
    });
  }

  _say(text) {
    console.log(`💉 [say]: ${text.substring(0, 100)}`);
    const lang = this.language || 'it';

    // Se la frase è pre-tradotta, usa _sayDirect (nessun rischio hallucination)
    const preTranslated = OpenAIRealtimeClient.THINKING_PHRASES[text]?.[lang];
    if (lang !== 'it' && preTranslated) {
      this._sayDirect(preTranslated);
      return;
    }

    // Italiano: frase esatta
    if (lang === 'it') {
      this._send({
        type: 'response.create',
        response: { instructions: `Di' ESATTAMENTE e SOLO questa frase, senza aggiungere nulla: "${text}"` },
      });
      return;
    }

    // Frase dinamica in lingua straniera: GPT traduce
    this._send({
      type: 'response.create',
      response: { instructions: `TRANSLATION TASK ONLY. Translate this exact Italian text to ${lang} and say ONLY the translation. Do NOT use any other information from the conversation. Do NOT add anything. Translate word for word: "${text}"` },
    });
  }

  _send(obj) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  // ── Inietta dati reali nel context di GPT prima di _say() ─────────────────
  // Evita che GPT "corregga" la risposta con dati estratti nel turno precedente
  _injectContext(r) {
    if (!r) return;
    const text = `[Dati reali trovati: nome="${r.name}", data="${r.date}", ora="${r.time}", persone="${r.people}"]`;
    this._send({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text }],
      },
    });
  }

  // ── Audio ─────────────────────────────────────────────────────────────────

  sendAudio(pcmuBase64) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this._send({ type: 'input_audio_buffer.append', audio: pcmuBase64 });
    }
  }

  close() {
    this.ws?.close();
  }

  // ── Apps Script ───────────────────────────────────────────────────────────

  async _callAppsScript(payload) {
    const url = this.restaurantConfig?.apps_script_url || process.env.APPS_SCRIPT_URL;
    if (!url) return null;

    // Timeout di 15 secondi — Apps Script può essere lento su cold start
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const text = await response.text();
      try { return JSON.parse(text); } catch { return null; }
    } catch (err) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        console.error('❌ Apps Script timeout (15s)');
        return { success: false, reason: 'timeout' };
      }
      throw err;
    }
  }
}
