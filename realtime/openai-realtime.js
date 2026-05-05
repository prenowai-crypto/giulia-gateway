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
    // Normalizza callerPhone: aggiunge '+' se mancante (Telnyx a volte lo omette)
    const _rawPhone = opts.callerPhone || '';
    this.callerPhone = _rawPhone && !_rawPhone.startsWith('+') ? '+' + _rawPhone : _rawPhone;

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
    this._processingModify = false;   // evita double MODIFY (doppio function call GPT)

    // ── Lingua rilevata da GPT ───────────────────────────────────────────────
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
    // Fetch restaurant info async, poi ri-aggiorna la sessione con le info reali
    this._fetchAndInjectRestaurantInfo();
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
        instructions: this.systemPrompt + this._buildInfoSection(),
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        input_audio_transcription: { model: 'whisper-1', language: 'it' }, // solo per log
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
                description: 'Nome del cliente per la prenotazione oppure "null". Esempi: "mi chiamo Luca"=Luca, "nome Rossi"=Rossi, "a nome di Giovanni"=Giovanni.'
              },
              intent: {
                type: 'string',
                enum: ['create', 'modify', 'cancel', 'unknown'],
                description: 'Intenzione del cliente: create=nuova prenotazione, modify=modifica prenotazione esistente, cancel=cancellazione, unknown=non chiaro. USA create quando il cliente dice "vorrei prenotare", "un tavolo", "prenoto", "ho bisogno di un tavolo" anche se non ha detto "nuovo" o "separato". USA modify SOLO se il cliente usa parole come "modificare", "spostare", "cambiare", "aggiornare" O se sta correggendo una prenotazione appena confermata nella stessa chiamata con parole come "no intendevo", "aspetta", "ho sbagliato".'
              },
              language: {
                type: 'string',
                description: 'ISO 639-1 language code of the customer message. Examples: "it"=Italian, "en"=English, "fr"=French, "de"=German, "es"=Spanish.'
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
        break;
      case 'conversation.item.input_audio_transcription.completed':
        if (msg.transcript) {
          const t = msg.transcript.trim();
          if (!t || t.length < 2) return;

          // 🛡️ Filtro durata: primo turno < 2s = rumore di fondo, ignora silenziosamente
          const _speechDuration = this._speechStartedAt ? (Date.now() - this._speechStartedAt) : 9999;
          const _isFirstTurn = !this.data.date && !this.data.time && !this.data.people && !this.data.name;
          if (_isFirstTurn && _speechDuration < 2000) {
            console.log(`🛡️ Primo turno troppo breve (${_speechDuration}ms < 2000ms) → ignorato: "${t}"`);
            // GPT potrebbe aver già generato una risposta in flight → cancella
            this._send({ type: 'response.cancel' });
            return;
          }

          // 🛡️ Whisper hallucination filter — frasi allucinatorie note sul silenzio
          const WHISPER_HALLUCINATIONS = [
            'sottotitoli creati dalla comunità amara.org',
            'sottotitoli e composizione',
            'amara.org',
            'grazie per aver visto il video',
            'iscriviti al canale',
            'metti mi piace',
            'sottotitoli a cura di',
            'sottotitolato da',
            'transcript by',
            'transcribed by',
            'subtitles by',
            'www.youtube.com',
            'copyright',
          ];
          const tLower = t.toLowerCase();
          if (WHISPER_HALLUCINATIONS.some(h => tLower.includes(h))) {
            console.log(`🛡️ Whisper hallucination scartata: "${t}"`);
            // GPT potrebbe aver già generato una risposta in flight → cancella
            this._send({ type: 'response.cancel' });
            return;
          }

          console.log(`💬 [user]: ${t}`);
          this.lastTranscript = t;   // 🆕 salva per cross-check people
          this.onTranscript(t, 'user');
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
        this._speechStartedAt = Date.now();
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
            // Strip sia ```json/``` (function call text) sia il prefisso "json\n" (GPT text mode)
            const json = msg.text.trim().replace(/^```json\s*|^```\s*|^json\s*/i, '').replace(/```\s*$/g, '').trim();
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
          // Salva call_id per poter mandare function_call_output in caso di errore di validazione
          this._lastFunctionCallId = msg.call_id || null;
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
    const tomorrowDate = new Date(today); tomorrowDate.setDate(today.getDate() + 1);
    const tomorrowISO = DateManager.toISO(tomorrowDate);
    const dayAfterDate = new Date(today); dayAfterDate.setDate(today.getDate() + 2);
    const dayAfterISO = DateManager.toISO(dayAfterDate);
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
{"date":"YYYY-MM-DD o null","time":"HH:MM:SS o null","people":"numero o null","name":"nome o null","intent":"create/modify/cancel/unknown","unclear":true/false}

REGOLE INTENT:
- create = il cliente vuole prenotare un tavolo: "vorrei prenotare", "un tavolo per", "prenoto", "ho bisogno di un tavolo", "posso prenotare". USA create anche se non dice esplicitamente "nuovo" o "separato". ATTENZIONE: "vorrei prenotare" e "voglio prenotare" sono SEMPRE create, MAI modify, anche se nella conversazione si è già parlato di prenotazioni.
- modify = il cliente usa parole di modifica ESPLICITE: "modificare", "spostare", "cambiare", "aggiornare", "anticipare", "posticipare" OPPURE sta correggendo qualcosa detto nella STESSA chiamata con "no intendevo", "aspetta", "ho sbagliato", "anzi", "fai una cosa spostala".
- cancel = vuole cancellare ("cancellare", "annullare", "disdire")
- unknown = saluto, ringraziamento, domanda informativa, niente di chiaro

REGOLA CRITICA — FRASE INCOMPRENSIBILE: restituisci unclear:true SOLO se la frase contiene parole che non esistono nella lingua italiana (es: "carabinare", "vaglo", "scala bonara", "prevocazione"). Se la frase ha senso compiuto in italiano — anche se non riguarda una prenotazione — restituisci unclear:false. Esempi di unclear:false: "fate la carbonara", "pronto", "grazie mille", "buongiorno", "avete il parcheggio". Esempi di unclear:true: "fatele carabinare", "vaglo", "scala bonara".

REGOLA CRITICA: se il cliente dice "vorrei prenotare" o simili → create SEMPRE, anche se nella chiamata si è già parlato di prenotazioni. Se il cliente dice "spostala", "cambiala", "modificala" riferendosi a una prenotazione appena confermata → modify.

REGOLE DATE/ORA:
- "alle 21" → time: "21:00:00"
- "all'una" / "all'uno" → time: "13:00:00"
- "alle nove di sera" / "alle 9 di sera" → time: "21:00:00"
- "alle nove" senza contesto → time: "09:00:00"
- "sabato" → data sabato dal calendario sopra
- "venerdì" → data venerdì dal calendario sopra
- "alla stessa ora" → time: null (non inventare)
- "sera" / "di sera" / "stasera" / "a cena" senza numero ora esplicito → time: null (NON inventare 21:00 o altri valori)
- "mattina" / "pranzo" senza numero → time: null
- REGOLA ASSOLUTA ORARIO: se il cliente NON ha detto un numero specifico di ora (es: "alle 21", "alle 20:30", "alle otto"), restituisci time: null. MAI inferire l'ora dal contesto.
- "stasera" / "questa sera" / "stanotte" → date: ${todayISO} (SEMPRE oggi, mai altra data)
- "oggi" → date: ${todayISO}
- "domani" → date: ${tomorrowISO} SEMPRE. È il giorno successivo a oggi. MAI il prossimo giorno con lo stesso nome della settimana.
- "dopodomani" → date: ${dayAfterISO} SEMPRE. È due giorni dopo oggi.
- REGOLA CRITICA ANCORE TEMPORALI: "domani" e "dopodomani" sono calcolati da OGGI (${todayISO}), MAI da date precedenti nella conversazione.

REGOLA CRITICA NOME: estrai il nome ESATTAMENTE come pronunciato nel messaggio ATTUALE (quello che stai analizzando ora), ignorando COMPLETAMENTE qualsiasi nome presente nel contesto precedente. Se il cliente dice "mi chiamo Marchetti" → name: "Marchetti" (non "Marchi"). Se il cliente corregge il nome ("mi chiamo X", "sono X", "il mio nome è X", "no mi chiamo X") → usa SEMPRE e SOLO X esattamente come pronunciato, senza troncarlo né modificarlo.

REGOLE NOME+DATA insieme:
- "a nome Rossi per sabato" → name: "Rossi", date: data sabato
- "la prenotazione Ferrari per venerdì" → name: "Ferrari", date: data venerdì
- "prenotazione Bianchi del 18" → name: "Bianchi", date: ${todayISO.substring(0,8)}18

Rispondi SOLO con il JSON, nessun'altra parola.`,
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
    let   newPeople = (args.people && args.people !== 'null') ? parseInt(args.people) : null;
    const newName   = (args.name   && args.name   !== 'null') ? args.name.trim() : null;

    // 🆕 Cross-check: valida GPT people con PeopleManager sul transcript Whisper
    // Evita che GPT estragga un numero sbagliato (es: "3 persone venerdì" → GPT dice 4)
    // Guard: scatta solo se il transcript contiene keyword legate alle persone,
    // evita falsi positivi da numeri casuali nel testo (es: "una cosa", "alle 21")
    if (newPeople && this.lastTranscript) {
      const hasPeopleKeyword = /(person[ae]|pax|coperti|siamo|saremo|in totale|tavolo per|per noi|ospiti|d+s*person|siamo in|saremo in)/i.test(this.lastTranscript);
      if (hasPeopleKeyword) {
        const parsedPeople = PeopleManager.parseFromText(this.lastTranscript);
        if (parsedPeople && parsedPeople !== newPeople) {
          console.log(`⚠️ People mismatch: GPT=${newPeople}, transcript="${this.lastTranscript}" → parsedPeople=${parsedPeople} — uso transcript`);
          newPeople = parsedPeople;
        }
      } else {
        console.log(`🔒 People cross-check skippato: nessuna keyword persone in transcript`);
      }
    }

    // ── Aggiorna lingua rilevata ─────────────────────────────────────────────
    // Guard: cambia lingua solo se il transcript corrente contiene almeno 3 parole
    // ed è coerente con la lingua rilevata. Evita false detections su parole corte
    // ambigue (es: "Salve" → es, "Merci" → fr su un singolo termine).
    if (args.language && args.language !== this.language) {
      const transcriptWordCount = this.lastTranscript ? this.lastTranscript.trim().split(/\s+/).length : 0;
      if (transcriptWordCount >= 3) {
        this.language = args.language;
        console.log(`🌐 Lingua rilevata da GPT: ${this.language}`);
      } else {
        console.log(`🌐 Lingua GPT=${args.language} ignorata (transcript troppo corto: "${this.lastTranscript}")`);
      }
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

      // Fix 3A: "Pronto?" = segnale telefonico (cliente non sentiva risposta)
      // Risposta deterministica, skip di tutto il resto
      if (this.lastTranscript) {
        const _prontoPat = /^(pronto|pronto\?|ci sei|mi senti|sei li|sei l[ìi]|sento|hello\?|are you there)[?!.\s]*$/i;
        if (_prontoPat.test(this.lastTranscript.trim())) {
          console.log('📞 "Pronto?" rilevato → risposta deterministica');
          this._say('Sì, sono qui! Posso aiutarla con altro?');
          return;
        }
      }

      // Nuovo intent modify → usa lastReservation se disponibile, altrimenti cerca
      if (intent === 'modify') {
        this.intent = 'modify';
        this.modifyState = null;
        // Fix X04: salva foundReservation prima del reset — potrebbe contenere la prenotazione
        // trovata durante un CANCEL abortito (es: "No anzi spostala a sabato")
        const _cancelFoundReservation = this.foundReservation;
        this.foundReservation = null;
        console.log('🔄 Phase=done: nuovo intent modify rilevato');

        // Guard anti-double: se stiamo già processando un MODIFY, ignora il secondo trigger
        if (this._processingModify) {
          console.log('🔒 Double MODIFY ignorato: _processingModify=true');
          return;
        }

        // Se abbiamo la prenotazione appena gestita, usala direttamente
        // Nota: funziona anche con eventId=null (es. timeout AS)
        // Fix X04: usa anche _cancelFoundReservation (da CANCEL abortito) se lastReservation è null
        const _refRes = (this.lastReservation?.name && this.lastReservation?.date)
          ? this.lastReservation
          : (_cancelFoundReservation?.name && _cancelFoundReservation?.date ? _cancelFoundReservation : null);

        if (_refRes) {
          if (!this.lastReservation?.name) {
            console.log(`🔄 Fix X04: uso foundReservation da CANCEL abortito (${_refRes.name}, ${_refRes.date}) come base MODIFY`);
          }
          this.foundReservation = _refRes;
          this.modifyState = 'awaiting_changes';

          // Fix 4: se solo le note cambiano (stessi data/ora/pax/nome), non fare MODIFY
          // Le note sono già state gestite da _detectNotesAndPhone → update_notes
          const _onlyNoteChange = !newName && !newDate && !newTime && !newPeople;
          if (_onlyNoteChange) {
            console.log('📝 Phase=done MODIFY: solo nota cambiata, già gestita da update_notes → skip MODIFY');
            // Fix 4: conferma verbale della nota al cliente
            if (this.data.notes) {
              const _lastNote = this.data.notes.split(';').pop().trim();
              this._say(`Ho annotato: ${_lastNote}. C'è altro che posso fare per lei?`);
            }
            return;
          }

          // Se il messaggio contiene già la modifica esplicita, applicala subito
          if (newName || newDate || newTime || newPeople) {
            console.log(`💾 Phase=done MODIFY: applico cambio diretto su _refRes (${_refRes.name}, ${_refRes.date})`);
            await this._handleModifyFlow(newDate, newTime, newPeople, newName);
            return;
          }

          // Altrimenti mostra la prenotazione trovata e chiedi cosa modificare
          const r = _refRes;
          const timeNorm = r.time?.length === 5 ? r.time + ':00' : (r.time || '');
          const dateDisplay = DateManager.formatForDisplay(r.date);
          const timeDisplay = TimeManager.formatForDisplay(timeNorm);
          console.log(`💾 Phase=done MODIFY: uso _refRes direttamente (${r.name}, ${r.date})`);
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
        // Guard anti-duplicato: se GPT ha estratto gli stessi dati dell'ultima prenotazione
        // confermata (es. dopo "grazie" ricorda il contesto), NON fare reset.
        // Si tratta di cortesia post-prenotazione, non di una nuova richiesta.
        const lr = this.lastReservation;
        if (lr && newDate === lr.date && newTime === lr.time &&
            String(newPeople) === String(lr.people) && newName === lr.name) {
          // Se la prenotazione è PENDING, lo diciamo esplicitamente al cliente
          if (lr.status === 'PENDING_OWNER') {
            console.log('⏳ Phase=done: prenotazione PENDING_OWNER → informo cliente');
            this._say('La tua prenotazione è in attesa di conferma dal ristorante. Ti contatteranno a breve per confermarla.');
            return;
          }
          console.log('🛡️ Phase=done: create con dati identici a lastReservation → saluto senza reset');
          // Fix: aggiorna note se rilevate PRIMA di rispondere, poi lascia GPT rispondere liberamente
          // (prima forzava "Prego! A presto!" saltando le note e causando loop)
          if (this.data.notes && this.data.notes !== lr.notes) {
            const updatedNotes = this.data.notes;
            console.log(`📝 Guard identici: nuove note rilevate, aggiorno: "${updatedNotes}"`);
            this._callAppsScript({
              action: 'update_reservation',
              eventId: lr.eventId,
              nome: lr.name,
              data: lr.date,
              ora: lr.time,
              persone: lr.people,
              telefono: lr.phone,
              notes: updatedNotes,
            }).then(r => {
              console.log(`✅ Note aggiornate (guard identici): ${r?.status}`);
              if (this.lastReservation) this.lastReservation.notes = updatedNotes;
            }).catch(err => console.error('❌ Errore aggiornamento note (guard):', err));
          }
          // Controlla prima se è una domanda info — risposta deterministica
          const _infoAnswerGuard = this._checkInfoQuestion(this.lastTranscript || '');
          if (_infoAnswerGuard !== null) {
            console.log('📋 Info question (guard identico) → risposta deterministica');
            this._say(_infoAnswerGuard);
            return;
          }
          // Lascia GPT rispondere liberamente alle domande post-prenotazione
          // senza resettare il contesto
          const _gLang = this.language || 'it';
          const _lr = this.lastReservation;
          const _notesInfo = _lr?.notes ? `Note salvate sulla prenotazione: "${_lr.notes}".` : 'Nessuna nota salvata.';
          this._send({
            type: 'response.create',
            response: {
              instructions: _gLang === 'it'
                ? `La prenotazione è già confermata. ${_notesInfo} Il cliente sta facendo una domanda o ringraziando. Rispondi in modo cordiale e naturale. Se chiede delle note conferma quelle salvate. Se fa una domanda su strutture (seggiolone, parcheggio) rispondi "Non ho questa informazione, può chiedere direttamente al ristorante". IMPORTANTE: non dire mai "ho annotato" o "ho preso nota" di qualcosa a meno che non sia già presente nelle note salvate. Non inventare ingredienti o dettagli del menu non esplicitamente indicati. Max 2 frasi. Non reinventare la prenotazione.`
                : `The reservation is already confirmed. ${_notesInfo} Reply warmly in ${_gLang}. If asked about notes confirm what was saved. If asked about facilities say "I don't have this information, please ask the restaurant directly". Max 2 sentences.`,
            },
          });
          return;
        }

        // Fix: se l'unica differenza con lastReservation è il nome → MODIFY del nome, non nuova prenotazione
        // Caso: "Mi chiamo Russo, non Rossi" → GPT estrae create+nome corretto+stessi dati
        const _lrFix = this.lastReservation;
        if (_lrFix?.eventId && newName && newName !== _lrFix.name &&
            newDate === _lrFix.date && newTime === _lrFix.time &&
            String(newPeople) === String(_lrFix.people)) {
          console.log(`🔄 Phase=done CREATE: solo nome cambiato (${_lrFix.name} → ${newName}) → MODIFY nome`);
          await this._handleModifyFlow(newDate, newTime, newPeople, newName);
          return;
        }

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

      // Fix A: controlla unclear PRIMA di tutto — anche in phase=done
      if (args.unclear === true || args.unclear === 'true') {
        console.log('🔁 Phase=done: frase incomprensibile → chiedo di ripetere');
        this._say('Non ho capito bene, può ripetere?');
        return;
      }

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
      // Fix: se il cliente saluta dopo un MODIFY fallito (slot_full),
      // ricordagli che la prenotazione originale è ancora attiva prima di congedarsi.
      // Evita che riattacchi convinto che la modifica sia andata a buon fine.
      const _modifyReminderRes = this.foundReservation || this.lastReservation;
      if (this.intent === 'modify' && this.modifyState !== 'done' && _modifyReminderRes?.eventId) {
        const r = _modifyReminderRes;
        const timeNorm = r.time?.length === 5 ? r.time + ':00' : (r.time || '');
        const dateDisplay = DateManager.formatForDisplay(r.date);
        const timeDisplay = TimeManager.formatForDisplay(timeNorm);
        console.log(`ℹ️ Phase=done MODIFY incomplete: ricorda prenotazione originale (${r.name}, ${r.date})`);
        this._say(`La sua prenotazione originale per ${r.people} persone ${dateDisplay} alle ${timeDisplay} è ancora attiva. Vuole mantenerla o cancellarla?`);
        return;
      }

      // Controlla prima se è una domanda info — risposta deterministica
      const _infoAnswerDone = this._checkInfoQuestion(this.lastTranscript || '');
      if (_infoAnswerDone !== null) {
        console.log('📋 Info question (phase=done) → risposta deterministica');
        this._say(_infoAnswerDone);
        return;
      }
      const _lang = this.language || 'it';
      const _lrNotes = this.lastReservation?.notes;
      const _notesCtx = _lrNotes ? `Note salvate sulla prenotazione: "${_lrNotes}".` : '';
      this._send({
        type: 'response.create',
        response: {
          instructions: _lang === 'it'
            ? `Il cliente ha appena completato una prenotazione o operazione con successo. ${_notesCtx} Rispondi in modo cordiale e naturale: se ringrazia di' "Grazie a lei!"; se chiede delle note conferma quelle salvate; poi chiedi se puoi aiutarlo con altro. Max 2 frasi. Non inventare informazioni sul ristorante.`
            : `The customer has just successfully completed a reservation or operation. ${_notesCtx} Reply warmly in ${_lang}: if they thank say "Thank you!"; if they ask about notes confirm what was saved. Max 2 sentences. Do not invent information.`,
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

      // Se GPT ha segnalato che la frase era incomprensibile → chiedi di ripetere
      if (args.unclear === true || args.unclear === 'true') {
        console.log('🔁 Frase incomprensibile rilevata da GPT → chiedo di ripetere');
        this._say('Non ho capito bene, può ripetere?');
        return;
      }

      console.log('💬 Intent unknown — GPT risponde liberamente con dati reali');

      // Fix: controlla PRIMA se è una domanda info ristorante — risposta deterministica
      // Questo ha priorità anche sul reminder MODIFY, per evitare che il reminder
      // soffochi domande legittime come "avete piatti vegani?"
      const _skipInfoCheck = (this.phase === 'collecting' && newName && newName !== 'null');
      if (!_skipInfoCheck) {
        const _infoAnswer = this._checkInfoQuestion(this.lastTranscript || '');
        if (_infoAnswer !== null) {
          console.log(`📋 Info question rilevata → risposta deterministica`);
          this._say(_infoAnswer);
          return;
        }
      }

      // Fix: se il cliente saluta dopo un MODIFY fallito (slot_full),
      // ricordagli che la prenotazione originale è ancora attiva.
      const _modifyReminderRes2 = this.foundReservation || this.lastReservation;
      if (this.intent === 'modify' && _modifyReminderRes2?.eventId) {
        const r = _modifyReminderRes2;
        const timeNorm = r.time?.length === 5 ? r.time + ':00' : (r.time || '');
        const dateDisplay = DateManager.formatForDisplay(r.date);
        const timeDisplay = TimeManager.formatForDisplay(timeNorm);
        console.log(`ℹ️ Intent-unknown MODIFY incomplete: ricorda prenotazione originale (${r.name}, ${r.date})`);
        this._say(`La sua prenotazione originale per ${r.people} persone ${dateDisplay} alle ${timeDisplay} è ancora attiva. Vuole mantenerla o cancellarla?`);
        return;
      } else {
        // Fix M07: se intent=unknown + nome presente in phase=collecting,
        // e NON abbiamo ancora nessun dato di prenotazione raccolto (no data/ora/pax),
        // il cliente probabilmente ha già una prenotazione → cerca automaticamente.
        // Se invece abbiamo già dei dati (siamo a metà del flusso CREATE), lascia GPT rispondere.
        const _noDataYet = !this.data.date && !this.data.time && !this.data.people;
        if (_noDataYet && newName && newName !== 'null') {
          console.log(`📋 Fix M07: intent=unknown + nome=${newName} senza dati → cerco prenotazione automaticamente`);
          this.intent = 'modify';
          this.modifyState = null;
          this.foundReservation = null;
          await this._handleModifyFlow(newDate, newTime, newPeople, newName);
          return;
        } else {
          console.log(`📋 Info question skippata: fase collecting con nome=${newName} e dati parziali → lascio GPT rispondere`);
        }
      }

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

      const _langFree = this.language || 'it';
      const _scheduleData = `Lunch ${ls}-${le}: open ${openForLunch || 'no days'} / Dinner ${ds}-${de}: open ${openForDinner || 'no days'} / Closed: ${closedText}`;
      this._send({
        type: 'response.create',
        response: {
          instructions: _langFree === 'it'
            ? `Rispondi alla domanda del cliente usando ESCLUSIVAMENTE questi dati, senza aggiungere nulla:\n- Pranzo ${ls}-${le}: aperto ${openForLunch || 'nessun giorno'}\n- Cena ${ds}-${de}: aperto ${openForDinner || 'nessun giorno'}\n- Chiuso il: ${closedText}\nMax 2 frasi. Non inventare nulla. Non suggerire mai prenotazioni proattivamente. Non proporre mai di venire al ristorante per degustare piatti.`
            : `Reply in ${_langFree}. Answer the customer's question using ONLY this data: ${_scheduleData}. Max 2 sentences. Do not invent anything.`,
        },
      });
      return;
    }

    // 🆕 Intent-switch create→modify in phase=collecting
    // Es: utente dice "ho una prenotazione, vorrei modificarla" → GPT dice modify ma this.intent='create'
    if (this.intent === 'create' && this.phase === 'collecting' && args.intent === 'modify') {
      // Fix B1: se il cliente ha già dato tutti i dati di prenotazione (date+time+people),
      // GPT dice modify solo perché sta correggendo un campo → NON avviare MODIFY flow,
      // semplicemente aggiornare i dati e restare in CREATE.
      // Il MODIFY flow ha senso solo se il cliente non ha ancora dati raccolti.
      // _anyDataCollected: se il cliente ha già dato ALMENO UN dato in questa sessione,
      // GPT sta interpretando una correzione come modify → resta in CREATE.
      // Se invece non c'è nessun dato (nuova chiamata), il MODIFY flow è legittimo.
      const _anyDataCollected = this.data.date || this.data.name || this.data.people;
      if (_anyDataCollected) {
        console.log(`🔄 Intent-switch collecting: create → modify IGNORATO (dati già presenti, è correzione CREATE)`);
        // Fix B2: reset foundReservation residuo da MODIFY fallback
        this.foundReservation = null;
        // Rientra in _processGPTData con intent=create corretto
        // così il flow normale (validazione orario, check slot, ecc.) viene eseguito
        await this._processGPTData({ ...args, intent: 'create' });
        return;
      }
      console.log(`🔄 Intent-switch collecting: create → modify, avvio MODIFY flow`);
      this.intent = 'modify';
      this.modifyState = null;
      this.foundReservation = null;  // Fix B2: reset esplicito
      await this._handleModifyFlow(newDate, newTime, newPeople, newName);
      return;
    }

    // 🆕 Guard intent-switch: se GPT dice create ma siamo in modify/cancel,
    // l'utente sta correggendo l'intenzione → reset completo e riparte da CREATE.
    const inModifyOrCancel = (this.intent === 'modify' || this.intent === 'cancel');
    const gptSaysCreate = (args.intent === 'create');
    if (inModifyOrCancel && gptSaysCreate && (newDate || newTime || newPeople)) {
      console.log(`🔄 Intent-switch rilevato: ${this.intent} → create, reset`);
      this.intent = 'create';
      this.phase = 'collecting';
      this.data = { date: null, time: null, people: null, name: null, notes: null, alternativePhone: null };
      this.modifyState = null;
      this.cancelState = null;
      this.foundReservation = null;
      this.checkingSlot = false;
      this.availDone = false;
      this.lastTranscript = null; // 🆕 evita che il cross-check parsePeople giri sul transcript precedente
      await this._processGPTData(args);
      return;
    }

    // ── MODIFY flow ──────────────────────────────────────────────────────────
    if (this.intent === 'modify') {
      // Intent-switch guard: se GPT dice 'cancel' durante MODIFY, passa subito al CANCEL flow
      // senza entrare in _handleModifyFlow (che farebbe check disponibilità invece di cancellare)
      if (args.intent === 'cancel') {
        console.log('🔄 Intent-switch MODIFY → cancel rilevato fuori phase=done');
        this.intent = 'cancel';
        this._resolveFunctionCallPending('switching to cancel');
        // Se abbiamo già la prenotazione trovata (es. MODIFY slot_full), vai diretto alla conferma
        if (this.foundReservation?.eventId) {
          const r = this.foundReservation;
          const timeNorm = r.time?.length === 5 ? r.time + ':00' : (r.time || '');
          const dateDisplay = DateManager.formatForDisplay(r.date);
          const timeDisplay = TimeManager.formatForDisplay(timeNorm);
          this.cancelState = 'awaiting_confirm';
          console.log(`🗑️ CANCEL diretto su foundReservation: ${r.name}, ${r.date}`);
          this._injectContext(r);
          this._say(`Ho trovato: ${r.name}, ${dateDisplay} alle ${timeDisplay} per ${r.people} persone. Conferma la cancellazione?`);
        } else {
          this.cancelState = null;
          this.foundReservation = null;
          await this._handleCancelFlow(newDate, newName);
        }
        return;
      }
      await this._handleModifyFlow(newDate, newTime, newPeople, newName);
      return;
    }

    // ── CANCEL flow ──────────────────────────────────────────────────────────
    if (this.intent === 'cancel') {
      // Fix X04: intent-switch cancel→modify — cliente cambia idea durante CANCEL
      // (es: "No anzi la sposto a sabato"). Riutilizza foundReservation già trovata.
      // Condizione tripla: siamo in cancel + GPT dice modify + prenotazione già trovata
      if (args.intent === 'modify' && this.foundReservation?.eventId) {
        console.log(`🔄 Intent-switch CANCEL → modify: uso foundReservation (${this.foundReservation.name}, ${this.foundReservation.date})`);
        this.intent = 'modify';
        this.cancelState = null;
        this.modifyState = 'awaiting_changes';
        await this._handleModifyFlow(newDate, newTime, newPeople, newName);
        return;
      }
      // confirm phase gestita direttamente via testo in _onUserText
      if (this.cancelState !== 'awaiting_confirm') {
        await this._handleCancelFlow(newDate, newName);
      }
      return;
    }

    if (newDate   && newDate   !== this.data.date)   { console.log(`📅 date:   ${this.data.date} → ${newDate}`);     this.data.date   = newDate; }
    if (newTime   && newTime   !== this.data.time)   { console.log(`⏰ time:   ${this.data.time} → ${newTime}`);     this.data.time   = newTime; }
    if (newPeople && newPeople !== this.data.people) {
      // 🔒 Lock: se il transcript corrente non contiene un numero esplicito di persone
      // e people è già stato validato, non sovrascrivere con il valore GPT.
      // Evita che al 2° GPT call (es: user dice "Ferrari.") GPT ri-estragga people
      // dal contesto della conversazione e sovrascriva il valore già corretto.
      const transcriptPeople = this.lastTranscript ? PeopleManager.parseFromText(this.lastTranscript) : null;
      if (transcriptPeople === null && this.data.people !== null) {
        console.log(`🔒 People locked (${this.data.people}): transcript senza numeri, ignoro GPT=${newPeople}`);
      } else {
        console.log(`👥 people: ${this.data.people} → ${newPeople}`);
        this.data.people = newPeople;
      }
    }
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
        this._resolveFailedFunctionCall(`giorno chiuso: ${this.data.date || ""}`);
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
        this._resolveFailedFunctionCall(`orario non valido: 20:30`);
        this._say(msg);
        // Fix B4: forza GPT a NON confermare prenotazioni dopo orario invalido
        this._send({ type: 'session.update', session: { instructions: this.systemPrompt + this._buildInfoSection() + `\n\nATTENZIONE CRITICA: orario NON valido, prenotazione NON effettuata. DEVI chiedere orario diverso. VIETATO dire prenotato.` } });
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
        this._resolveFailedFunctionCall(`pranzo chiuso`);
        this._say(`Il ${dayName} siamo aperti solo a cena (${ds}-${de}). Vuole prenotare per cena?`);
        return;
      }
      const isCena = h >= 17 || h <= 3;
      if (isCena && ValidationPipeline.isDinnerClosed(this.data.date, rc)) {
        const dayName = DateManager.getDayName(this.data.date);
        const ls = rc?.lunch_start || '12:00';
        const le = rc?.lunch_end   || '14:30';
        this.data.time = null;
        this._resolveFailedFunctionCall(`cena chiusa`);
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
      { pattern: /celiac[oai]|ciliac[oai]|senza\s+glutine|intolleranz[ae]\s+glutine/i, note: 'Intolleranza glutine' },
      { pattern: /lattosio|lactose/i,                               note: 'Intolleranza lattosio' },
      { pattern: /allergi[ao]/i,                                    note: 'Allergia (verifica con cliente)' },
      { pattern: /arachidi|arachide|frutta\s*secca|noci/i,          note: 'Allergia frutta secca' },
      { pattern: /vegetarian[oai]/i,                                note: 'Vegetariano' },
      { pattern: /vegan[oai]/i,                                     note: 'Vegano' },
      { pattern: /seggiol[eo]n[eo]|seggiolino|seggialone|seggilon[ei]|seggialino|highchair/i, note: 'Richiesto seggiolone' },
      { pattern: /bambino\s*piccolo|neonat[oi]|bimb[oi]\s*piccol/i, note: 'Neonato/bambino piccolo' },
      { pattern: /anniversario/i,                                   note: 'Anniversario' },
      { pattern: /compleanno|birthday/i,                            note: 'Compleanno' },
      { pattern: /propost[ae]\s*di\s*matrimonio|fidanzamento/i,     note: 'Proposta di matrimonio' },
      { pattern: /occasion[ei]\s*speciale/i,                        note: 'Occasione speciale' },
      { pattern: /romantico|romantica/i,                            note: 'Cena romantica' },
      { pattern: /finestra|vista/i,                                 note: 'Tavolo vicino finestra' },
      { pattern: /esterno|terrazza|giardino|dehor/i,                note: 'Tavolo esterno/terrazza' },
      { pattern: /sedia\s*a\s*rotelle|disabil|carrozzin/i,          note: 'Accessibilità disabili' },
      { pattern: /tranquill[oa]|riservat[oa]/i,                     note: 'Tavolo tranquillo/riservato' },
    ];

    // Pattern domanda info vegan/vegetariano: "avete piatti vegani?" → NON è nota
    const _isVeganInfoQuestion = /avete.{0,25}vegan|avete.{0,25}vegetar|piatti.{0,20}vegan|piatti.{0,20}vegetar|menu.{0,20}vegan|opzion.{0,20}vegan|opzion.{0,20}vegetar|c.è.{0,15}vegan|ci sono.{0,15}vegan|offrite.{0,15}vegan|servite.{0,15}vegan/i.test(text);

    const newNotes = [];
    for (const { pattern, note } of noteKeywords) {
      // Guard: "vegano" come domanda info non va annotato come nota
      if (note === 'Vegano' && _isVeganInfoQuestion) {
        console.log(`📋 Vegan rilevato come domanda info → skip nota`);
        continue;
      }
      if (note === 'Vegetariano' && _isVeganInfoQuestion) {
        console.log(`📋 Vegetariano rilevato come domanda info → skip nota`);
        continue;
      }
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

      // Note post-conferma → aggiorna Calendar in background
      if (this.phase === 'done' && this.lastReservation?.eventId) {
        const _evId = this.lastReservation.eventId;
        const _notes = this.data.notes;
        this.lastReservation.notes = _notes;
        console.log(`📝 Note post-conferma → update_notes su Calendar: "${_notes}"`);
        this._callAppsScript({ action: 'update_notes', eventId: _evId, notes: _notes })
          .then(r => console.log(`📝 update_notes: ${r?.success ? 'OK' : 'FAIL'}`))
          .catch(e => console.error('❌ update_notes error:', e));
      }
    }

    // ── Telefono alternativo ─────────────────────────────────────────────────
    const phonePattern = /(?:numero|telefono|cell(?:ulare)?|phone|contatt).*?(\+?\d[\d\s\-]{6,14}\d)/i;
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
      const r1 = await this._callAppsScript({ action: 'find_reservation', nome: searchName, data: searchDate, sheet: 'Prenotazioni' });
      if (r1?.found && isValid(r1.reservation)) return r1.reservation;
    }

    // Stadio 2: solo nome (GPT potrebbe aver estratto data di destinazione)
    if (searchName) {
      console.log(`🔍 ${logPrefix} fallback: solo nome=${searchName}`);
      const r2 = await this._callAppsScript({ action: 'find_reservation', nome: searchName, sheet: 'Prenotazioni' });
      if (r2?.found && isValid(r2.reservation)) return r2.reservation;
    }

    // Stadio 3: solo telefono (cliente corregge nome, es: "Conti"→"Conte")
    if (phone) {
      console.log(`🔍 ${logPrefix} fallback: solo telefono=${phone}`);
      const r3 = await this._callAppsScript({ action: 'find_reservation', telefono: phone, sheet: 'Prenotazioni' });
      if (r3?.found && isValid(r3.reservation)) return r3.reservation;
    }

    return null;
  }

  async _handleModifyFlow(newDate, newTime, newPeople, newName) {
    // Phase 1: primo messaggio modify → se contiene già nome e data, salta il prompt
    if (!this.modifyState) {
      this.modifyState = 'awaiting_search';
      // 🆕 Cancella eventuale risposta GPT in corso
      this._send({ type: 'response.cancel' });

      // Se il primo messaggio contiene già nome E data, cerca subito
      if (newName && newDate) {
        if (newName) this.data.name = newName;
        if (newDate) this.data.date = newDate;
        this._say('Un momento, cerco la prenotazione...');
        const r = await this._findReservationWithFallback(newName, newDate, 'MODIFY primo msg');
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
        this._say('Un momento, cerco la prenotazione...');
        const r = await this._findReservationWithFallback(newName, null, 'MODIFY solo nome');
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

      this._say('Un momento, cerco la prenotazione...');
      const r = await this._findReservationWithFallback(searchName, searchDate, 'MODIFY');
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

      // Guard v3.9.35: se l'utente fornisce un nome DIVERSO da quello trovato
      // (es: "No, io sono Rossi" dopo aver trovato "Sposta") → ri-cerca con il nome corretto
      // invece di aggiornare l'evento sbagliato.
      if (newName && r.name && newName.toLowerCase() !== r.name.toLowerCase()) {
        const onlyNameChanged = !newDate && !newTime && !newPeople;
        if (onlyNameChanged) {
          // Solo il nome è cambiato → è una correzione, non una modifica di campi
          console.log(`🔄 MODIFY: nome corretto "${r.name}" → "${newName}", ri-cerca`);
          this.modifyState = 'awaiting_search';
          this.data.name = newName;
          this.foundReservation = null;
          const found = await this._findReservationWithFallback(newName, r.date, 'MODIFY ri-cerca');
          if (found) {
            this.foundReservation = found;
            const timeNorm = found.time?.length === 5 ? found.time + ':00' : (found.time || '');
            const dateDisplay = DateManager.formatForDisplay(found.date);
            const timeDisplay = TimeManager.formatForDisplay(timeNorm);
            this.modifyState = 'awaiting_changes';
            this._say(`Ho trovato: ${found.name}, ${dateDisplay} alle ${timeDisplay} per ${found.people} persone. Cosa vuole modificare?`);
          } else {
            this._say(`Non trovo nessuna prenotazione a nome ${newName}. Può riprovare?`);
          }
          return;
        }
      }

      const timeOrig = r.time?.length >= 5 ? (r.time.length === 5 ? r.time + ':00' : r.time) : null;

      if (!timeOrig && !newTime) {
        // Non abbiamo né l'orario originale né uno nuovo — chiedi
        this._say(`Non riesco a leggere l'orario della prenotazione. A che ora era prevista?`);
        return;
      }

      // Fix 2: accetta newTime solo se diverso da timeOrig (evita che GPT inventi orari)
      // Se il cliente dice "stessa ora" o non menziona l'orario, GPT può estrarre un orario
      // diverso dalla conversazione precedente — lo ignoriamo e usiamo sempre timeOrig
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

      // Lock anti-double: impedisce al secondo GPT trigger di eseguire un altro MODIFY
      this._processingModify = true;

      // Se data/ora/persone cambiano → check disponibilità
      if (dateChanged || timeChanged || (peopleChanged && updPeople > Number(r.people))) {
        // Fix T2-B: valida l'orario PRIMA di fare il check disponibilità
        if (updTime && !ValidationPipeline.isValidTime(updTime, this.restaurantConfig)) {
          console.log(`🚫 MODIFY: orario non valido: ${updTime}`);
          const rc = this.restaurantConfig;
          const lunch = rc?.lunch_hours || '12:00-14:30';
          const dinner = rc?.dinner_hours || '21:00-22:30';
          this._processingModify = false;
          this._say(`Quell'orario è fuori dai nostri orari. Pranzo ${lunch}, cena ${dinner}. Che orario preferisce?`);
          return;
        }
        console.log(`🔍 MODIFY check disponibilità: ${updDate} ${updTime} per ${updPeople}`);
        // Fix: usa pending (success:true) per evitare rogue response di GPT durante il check
        this._resolveFunctionCallPending('checking availability');
        this._say('Un attimo che verifico la disponibilità...');
        // Fix E3/E9: existingPeople va passato SOLO se il nuovo slot coincide con quello originale.
        // Se si sposta su data/ora diversa, i pax esistenti NON sono nel nuovo slot → existingPeople=0.
        const _sameSlot = (updDate === r.date && updTime === r.time);
        const _existingPeopleForCheck = _sameSlot ? Number(r.people) : 0;
        if (_existingPeopleForCheck > 0) {
          console.log(`🔍 MODIFY stesso slot → existingPeople=${_existingPeopleForCheck} (offset corretto)`);
        } else if (!_sameSlot) {
          console.log(`🔍 MODIFY slot diverso (${r.date} ${r.time} → ${updDate} ${updTime}) → existingPeople=0`);
        }
        const checkResult = await this._callAppsScript({
          action: 'check_availability',
          data: updDate,
          ora: updTime,
          persone: updPeople,
          existingPeople: _existingPeopleForCheck,
        });

        if (!checkResult?.success && checkResult?.reason !== 'slot_available') {
          // Fix: cerca slot alternativi come fa il CREATE invece di rifiutare e basta
          this._processingModify = false;
          try {
            const alts = await this._callAppsScript({
              action: 'find_available_slots',
              data: updDate,
              ora: updTime,
              persone: updPeople,
            });

            const sameDay = alts?.availableSlots?.sameDay || [];
            const nextDays = alts?.availableSlots?.nextDays || [];

            const rc = this.restaurantConfig;
            const validSameDay = sameDay.filter(s =>
              ValidationPipeline.isValidTime(s.time, rc)
            );

            if (validSameDay.length > 0) {
              const times = validSameDay.slice(0, 3).map(s => s.time.substring(0,5)).join(', ');
              console.log(`✅ MODIFY alternative stesso giorno: ${times}`);
              this._say(`Mi dispiace, quell'orario è al completo. Per quel giorno ho disponibilità alle ${times}. Vuole spostare la prenotazione a uno di questi orari?`);
            } else if (nextDays.length > 0) {
              const first = nextDays[0];
              const dayName = first.dayName || '';
              const validSlots = (first.slots || []).filter(s =>
                ValidationPipeline.isValidTime(s.time, rc)
              );
              const times = validSlots.slice(0, 2).map(s => s.time.substring(0,5)).join(' o ');
              console.log(`✅ MODIFY alternative prossimi giorni: ${dayName} ${times}`);
              this._say(`Mi dispiace, siamo al completo per quel giorno. Prima disponibilità ${dayName} alle ${times}. Vuole spostare la prenotazione?`);
            } else {
              console.log('❌ MODIFY nessuna alternativa valida');
              this._say(`Mi dispiace, quell'orario non è disponibile. Vuole provare un altro giorno?`);
            }
          } catch (err) {
            console.error('❌ MODIFY errore ricerca alternative:', err);
            this._say(`Mi dispiace, quell'orario non è disponibile. Vuole provare un altro orario?`);
          }
          return;
        }
      }

      console.log(`✏️ MODIFY aggiorna eventId=${r.eventId}: ${updDate} ${updTime} ${updPeople} pax ${updName}`);
      this._resolveFunctionCallPending('updating reservation');
      this._say('Perfetto, aggiorno subito...');
      const updateResult = await this._callAppsScript({
        action: 'update_reservation',
        eventId: r.eventId,
        nome: updName,
        data: updDate,
        ora: updTime,
        persone: updPeople,
        telefono: r.phone || this.callerPhone || '',
        notes: this.data.notes || r.notes || '',
      });

      this.phase = 'done';
      this._processingModify = false;  // reset: MODIFY completato
      if (updateResult?.success) {
        const dateDisplay = DateManager.formatForDisplay(updDate);
        const timeDisplay = TimeManager.formatForDisplay(updTime);
        const firstName = updName || ''; // usa nome completo (supporta nomi composti: De Luca, Di Maio, ecc.)
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
        // Reset intent a 'done' dopo MODIFY completato — evita che il MODIFY reminder
        // si attivi quando l'utente fa domande post-modifica (es: "hai segnato le note?")
        this.intent = 'done_modify';
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
      // 🆕 Cancella eventuale risposta GPT in corso: vogliamo controllare noi il dialogo
      this._send({ type: 'response.cancel' });

      if (newName && newDate) {
        if (newName) this.data.name = newName;
        if (newDate) this.data.date = newDate;
        this._say('Un momento, cerco la prenotazione...');
        const r = await this._findReservationWithFallback(newName, newDate, 'CANCEL primo msg');
        if (r) {
          this.foundReservation = r;
          const timeNorm = r.time?.length === 5 ? r.time + ':00' : (r.time || '');
          const dateDisplay = DateManager.formatForDisplay(r.date);
          const timeDisplay = TimeManager.formatForDisplay(timeNorm);
          this.cancelState = 'awaiting_confirm';
          this._injectContext(r);
          // v3.9.35: se il nome trovato è diverso da quello cercato (fallback telefono),
          // avvisa l'utente invece di presentarlo silenziosamente come corretto
          const nameMismatch = newName && r.name && r.name.toLowerCase() !== newName.toLowerCase();
          if (nameMismatch) {
            this._say(`Tramite il suo numero ho trovato: ${r.name}, ${dateDisplay} alle ${timeDisplay} per ${r.people} persone. È la sua prenotazione? Conferma la cancellazione?`);
          } else {
            this._say(`Ho trovato: ${r.name}, ${dateDisplay} alle ${timeDisplay} per ${r.people} persone. Conferma la cancellazione?`);
          }
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

      this._say('Un momento, cerco la prenotazione...');
      const r = await this._findReservationWithFallback(searchName, searchDate, 'CANCEL');
      if (r) {
        this.foundReservation = r;
        const timeNorm = r.time?.length === 5 ? r.time + ':00' : (r.time || '');
        const dateDisplay = DateManager.formatForDisplay(r.date);
        const timeDisplay = TimeManager.formatForDisplay(timeNorm);
        this.cancelState = 'awaiting_confirm';
        this._injectContext(r);
        const nameMismatch2 = searchName && r.name && r.name.toLowerCase() !== searchName.toLowerCase();
        if (nameMismatch2) {
          this._say(`Tramite il suo numero ho trovato: ${r.name}, ${dateDisplay} alle ${timeDisplay} per ${r.people} persone. È la sua prenotazione? Conferma la cancellazione?`);
        } else {
          this._say(`Ho trovato: ${r.name}, ${dateDisplay} alle ${timeDisplay} per ${r.people} persone. Conferma la cancellazione?`);
        }
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
      this.cancelState = null;        // 🆕 reset: utente ha rifiutato, uscire dalla confirm loop
      // Fix X04: NON azzerare foundReservation — se il cliente dice "No anzi spostala a sabato"
      // GPT ritornerà intent=modify e il blocco phase=done MODIFY userà foundReservation come base
      // this.foundReservation = null;
      this._say('Nessun problema, la prenotazione rimane invariata. Arrivederci!');
      return;
    }

    if (isYes) {
      const r = this.foundReservation;
      if (!r) { this.phase = 'done'; return; }

      const timeNorm = r.time?.length === 5 ? r.time + ':00' : (r.time || '');
      console.log(`🗑️ CANCEL conferma: nome=${r.name}, data=${r.date}, ora=${timeNorm}`);
      this._say('Un attimo che procedo con la cancellazione...');
      const result = await this._callAppsScript({
        action: 'cancel_reservation',
        nome: r.name,
        data: r.date,
        ora: timeNorm,
        telefono: r.phone || this.callerPhone || '',
      });

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

    // ── Gruppi grandi / eventi: gestiti PRIMA di "Un attimo" ─────────────────
    // Se non diciamo "Un attimo" e subito dopo un altro _say, evita la race condition
    // dove il secondo messaggio sovrascrive il primo e va perso
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
      this.availDone = true;
      if (this.data.name) {
        // Nome già disponibile → PENDING diretto
        console.log(`👥 PENDING con nome già disponibile: ${this.data.name}`);
        this.phase = 'done';
        const _dateD = DateManager.formatForDisplay(this.data.date);
        const _timeD = TimeManager.formatForDisplay(this.data.time);
        this._say(`Perfetto ${this.data.name}! La prenotazione per ${people} persone ${_dateD} alle ${_timeD} è in attesa di conferma dal ristorante. La contatteremo presto!`);
        this._callAppsScript({
          source: 'telnyx', nome: this.data.name, persone: people,
          data: this.data.date, ora: this.data.time,
          telefono: this.callerPhone || '', notes: this.data.notes || '', forceNew: true,
        }).then(r => console.log('📅 PENDING creato:', r?.success ? '✅' : '❌'))
          .catch(e => console.error('❌ Errore PENDING:', e));
      } else {
        this.phase = 'naming';
        this._say(`Per gruppi superiori a ${largeGroupThreshold} persone la prenotazione è soggetta a conferma del ristoratore. A che nome la registro?`);
      }
      return;
    }

    this._say('Un attimo che verifico la disponibilità...');

    // Silenzio durante il check — GPT non parla fino al risultato

    try {
      const result = await this._callAppsScript({
        action: 'check_availability',
        data: date,
        ora: time,
        persone: people,
      });

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

    // Fix 1: valida orario SEMPRE prima di confermare (evita bypass da turno multi-campo)
    if (time && !ValidationPipeline.isValidTime(time, this.restaurantConfig)) {
      console.log(`🚫 _confirmReservation: orario non valido ${time} → blocco`);
      const rc = this.restaurantConfig;
      const lunch = rc?.lunch_hours || '12:00-14:30';
      const dinner = rc?.dinner_hours || '21:00-22:30';
      this._say(`Quell'orario è fuori dai nostri orari. Pranzo ${lunch}, cena ${dinner}. Che orario preferisce?`);
      this.phase = 'collecting';
      this.data.time = null;
      // Fix B4: forza GPT a NON confermare prenotazioni dopo orario invalido
        this._send({ type: 'session.update', session: { instructions: this.systemPrompt + this._buildInfoSection() + `\n\nATTENZIONE CRITICA: orario NON valido, prenotazione NON effettuata. DEVI chiedere orario diverso. VIETATO dire prenotato.` } });
      return;
    }

    const dateDisplay  = DateManager.formatForDisplay(date);
    const timeDisplay  = TimeManager.formatForDisplay(time);
    const firstName    = name || ''; // usa nome completo (supporta nomi composti: De Luca, Di Maio, ecc.)

    this.phase = 'done';

    // Setta lastReservation SUBITO (prima dell'async) per bloccare double-booking
    this.lastReservation = {
      eventId: null, // verrà aggiornato dopo Apps Script
      name, date, time, people,
      phone: this.callerPhone || '',
      notes: this.data.notes || '',
    };

    // Determina se sarà PENDING in base alla soglia gruppo grande
    const _rc2 = this.restaurantConfig;
    const _largeThresh = Number(_rc2?.large_group_threshold) || 10;
    const _willBePending = people > _largeThresh;

    // Fix: includi note nel messaggio di conferma se presenti
    const _notesConfirmStr = this.data.notes ? ` Ho annotato: ${this.data.notes}.` : '';

    if (_willBePending) {
      const _callerNum = this.callerPhone ? ` Ti contatteremo al numero da cui stai chiamando.` : '';
      this._say(
        `Perfetto ${firstName}! Ho registrato la richiesta per ${people} persone ${dateDisplay} alle ${timeDisplay}.${_notesConfirmStr}${_callerNum} La prenotazione è in attesa di conferma dal ristorante. Se preferisci essere contattato su un altro numero, dimmelo ora!`
      );
    } else {
      this._say(
        `Perfetto ${firstName}! Ho prenotato per ${people} persone ${dateDisplay} alle ${timeDisplay}.${_notesConfirmStr} Ti aspettiamo!`
      );
    }

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
          status: result.status || 'CONFIRMED',
        };
        console.log(`💾 lastReservation salvato: eventId=${result.eventId} status=${result.status}`);
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
      // Inglese
      /\bmy\s+name\s+is\s+([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)?)/i,
      /\bi(?:'m|\s+am)\s+([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)?)/i,
      /\bunder\s+(?:the\s+)?name\s+(?:of\s+)?([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)*)/i,
      /\bname\s+([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)?)/i,
      // Francese
      /\bje\s+m['']appelle\s+([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)?)/i,
      /\bau\s+nom\s+(?:de\s+)?([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)*)/i,
      // Spagnolo
      /\bme\s+llamo\s+([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)?)/i,
      /\ba\s+nombre\s+(?:de\s+)?([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)*)/i,
      // Generico (fallback)
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

  // Frasi operative pre-tradotte — evita hallucination da context window
  static THINKING_PHRASES = {
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
    'Certo! A che nome è la prenotazione e per quale data?': {
      en: 'Of course! What name is the reservation under and for what date?',
      fr: 'Bien sûr ! Quel est le nom de la réservation et pour quelle date ?',
      es: 'Por supuesto! ¿A qué nombre está la reserva y para qué fecha?',
      de: 'Natürlich! Auf welchen Namen läuft die Reservierung und für welches Datum?',
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
  };

  // Dice una frase: cerca prima nel dizionario pre-tradotto, poi usa GPT
  // Quando GPT usa function_call e la validazione fallisce, dobbiamo
  // ════════════════════════════════════════════════════════════════════════
  // 📋 SEZIONE INFO RISTORANTE — iniettata nel system prompt a ogni sessione
  // Usa i dati dalla Config sheet via restaurantConfig.
  // Se un campo è vuoto → Giulia risponde "non ho questa informazione".
  // ════════════════════════════════════════════════════════════════════════
  // Controlla se il testo è una domanda su info ristorante.
  // Ritorna la risposta esatta dal Config sheet, o stringa "non ho questa informazione",
  // oppure null se non è una domanda info.
  _checkInfoQuestion(text) {
    if (!text) return null;
    const t = text.toLowerCase();
    const ri = this._restaurantInfo || {};
    const lang = this.language || 'it';

    const noInfo = lang === 'it'
      ? 'Non ho questa informazione. Per dettagli pu\u00f2 contattare direttamente il ristorante.'
      : lang === 'en' ? 'I don\u2019t have this information. Please contact the restaurant directly.'
      : lang === 'fr' ? 'Je n\u2019ai pas cette information. Veuillez contacter le restaurant directement.'
      : lang === 'es' ? 'No tengo esta informaci\u00f3n. Por favor contacte el restaurante directamente.'
      : 'Non ho questa informazione. Per dettagli pu\u00f2 contattare direttamente il ristorante.';

    // Se la domanda riguarda la prenotazione stessa (note, conferma, ecc.) non intercettare
    if (/ha[i]?.{0,15}segna|l.ha[i]?.{0,15}segna|nelle.{0,10}note|lo.{0,5}sai|ha[i]?.{0,10}nota|ha[i]?.{0,10}registr|segni.{0,20}(amica|amico|ospite|bambino)|conferma.{0,10}prenot|la.{0,10}prenot/i.test(t)) {
      return null;
    }

    // ── MENU deterministico ──────────────────────────────────────────────────
    const _riMenu = this._restaurantInfo || {};
    
    if (_riMenu.menuDetails) {
      const menuText = _riMenu.menuDetails;

      // Helper: filtra sezione categoria
      const getSection = (cat) => {
        const lines = menuText.split('\n');
        let inSection = false, result = [];
        for (const line of lines) {
          if (line.trim().toUpperCase().startsWith(cat.toUpperCase() + ':') || line.trim().toUpperCase() === cat.toUpperCase()) {
            inSection = true; continue;
          }
          if (inSection && line.match(/^[A-Z]{3,}[:\s]/)) break; // nuova categoria
          if (inSection && line.trim()) {
            // Solo nome piatto, senza prezzo e descrizione
            const cleanLine = line.trim().replace(/^[-•]\s*/, '').split('€')[0].trim();
            result.push(cleanLine);
          }
        }
        return result.join(', ');
      };

      // Check coperto (INFO categoria)
      if (/coperto/i.test(t)) {
        const copertLine = menuText.split('\n').find(l => /coperto/i.test(l));
        if (copertLine) {
          const price = copertLine.match(/[€£]?\s*(\d+[.,]?\d*)/);
          if (price) { const pStr = parseFloat(price[1]).toFixed(2).replace('.', ','); return `Sì, applichiamo un coperto di ${pStr} euro a persona.`; }
        }
      }

      // Domanda su piatto specifico: ricerca diretta nome piatto nel transcript
      // Più robusto del regex dishMatch — gestisce STT distortion e frasi complesse
      const _hasCategoryKeyword = /antipast|prim[io].{0,10}piatt|second[io]|contorn|dolc|dessert/i.test(t);
      const _hasInquiry = /avete|fate|fann[oa]|fatt[ei]|dico|chiedevo|vorrei|c.è|c.era|avrebbe|offrite|servite|preparat|\?/i.test(t);
      if (!_hasCategoryKeyword && _hasInquiry) {
        const _stopWords = new Set(['alla','alle','allo','agli','della','dello','degli','delle','con','per','dal','del','nel','che','una','uno','dei','misti','misto','fresc','caso','cosa','tipo','forn','fritte','miste']);
        const _menuLines = menuText.split('\n').filter(l => /^\s*-/.test(l));
        for (const _mLine of _menuLines) {
          const _cleanDish = _mLine.trim().replace(/^[-•]\s*/, '').split('€')[0].trim();
          const _dishWords = _cleanDish.toLowerCase().split(/\s+/).filter(w => w.length >= 5 && !_stopWords.has(w));
          if (_dishWords.length > 0 && _dishWords.some(w => t.includes(w))) {
            console.log(`📋 Dish match: "${_cleanDish}"`);
            // Fix 5: se il cliente chiede "come/ingredienti/cosa c'è", includi la descrizione
            // Fix: fatt[ao] copre sia "fatto" (maschile) che "fatta" (femminile)
            const _askingDescription = /come.{0,15}(fat|prepar|cucinat|composto|fatt[ao])|ingredienti|cosa.{0,5}(c.è|hanno|ha|contiene|mett)|com.è.{0,15}(fatt[ao]|preparata?)|di cosa/i.test(t);
            if (_askingDescription) {
              // Fix: cerca la descrizione DOPO il prezzo (€XX) — ancora affidabile
              const _descMatch = _mLine.match(/€\s*[\d,.]+\s+(.+)$/);
              const _desc = _descMatch ? _descMatch[1].trim() : null;
              if (_desc) {
                console.log(`📋 Dish match con descrizione: "${_cleanDish}" → "${_desc}"`);
                return `La ${_cleanDish} è preparata con ${_desc.toLowerCase().replace(/[()]/g, '')}.`;
              }
            }
            return `Sì, abbiamo ${_cleanDish}`;
          }
        }
      }

      // Domanda per categoria
      if (/antipast/i.test(t)) { const s = getSection('ANTIPASTI'); if (s) return `I nostri antipasti: ${s}`; }
      if (/prim[io]/i.test(t) && !/primo.{0,5}piano/i.test(t)) { const s = getSection('PRIMI'); if (s) return `I nostri primi piatti: ${s}`; }
      if (/second[io]/i.test(t)) { const s = getSection('SECONDI'); if (s) return `I nostri secondi piatti: ${s}`; }
      if (/contorn/i.test(t)) { const s = getSection('CONTORNI'); if (s) return `I nostri contorni: ${s}`; }
      if (/dolc[ie]/i.test(t) && !/dolce.{0,10}vita/i.test(t)) { const s = getSection('DOLCI'); if (s) return `I nostri dolci: ${s}`; }
      if (/dessert/i.test(t)) { const s = getSection('DOLCI'); if (s) return `I nostri dessert: ${s}`; }

      // Domanda generica sul menu
      if (/men[uù]|cosa.{0,15}avete|cosa.{0,15}mangiate|cosa.{0,15}si.{0,10}mang|che.{0,15}piatt/i.test(t)) {
        // Riassunto categorie disponibili
        const cats = [];
        if (menuText.match(/ANTIPASTI/i)) cats.push('antipasti');
        if (menuText.match(/PRIMI/i)) cats.push('primi');
        if (menuText.match(/SECONDI/i)) cats.push('secondi');
        if (menuText.match(/CONTORNI/i)) cats.push('contorni');
        if (menuText.match(/DOLCI/i)) cats.push('dolci');
        if (cats.length > 0) return `Il nostro menu comprende: ${cats.join(', ')}. Vuole sapere i dettagli di una categoria specifica?`;
      }
    }
    // ── fine MENU ────────────────────────────────────────────────────────────

    const checks = [
      {
        patterns: [/sedia.{0,20}rotel|sed[ae]r[ae].{0,10}rotel|rot[ae]ll[ae]|disabil|carrozzin|accessibil|mobilit.{0,10}ridott|handicap|wheelchair|entr[ae].{0,20}rotel/i],
        key: 'accessibility'
      },
      {
        patterns: [/parcheggi|posteggi|park|dove parcheg/i],
        key: 'parking'
      },
      {
        patterns: [/pagar|pagamento|cart[ae].{0,20}credit|credit.{0,15}card|bancomat|pos|contant|cash|visa|mastercard|bonifico|accetta.{0,15}cart|pagate.{0,10}cart|pagare.{0,10}cart/i],
        key: 'paymentMethods'
      },
      {
        patterns: [/esterno|all.aperto|terrazza|dehor|giardino|fuori/i],
        key: 'outdoorSeating'
      },
      {
        // Solo domande sul menu del ristorante, non dichiarazioni personali tipo "sono vegano"
        patterns: [/avete.{0,25}vegan|avete.{0,25}vegetar|piatti.{0,20}vegan|piatti.{0,20}vegetar|menu.{0,20}vegan|opzion.{0,20}vegan|opzion.{0,20}vegetar|vegan.{0,20}nel.{0,10}menu|si.{0,10}mangia.{0,20}vegan|cibo.{0,15}vegan/i],
        key: 'vegan'
      },
      {
        patterns: [/gluten|celiac|celiach|senza glutine/i],
        key: 'glutenFree'
      },
      {
        patterns: [/seggiol|bambini.{0,15}segg|segg.{0,15}bambin|highchair|sediolin/i],
        key: 'highchair'
      },
      {
        patterns: [/quanto.{0,20}cost|prezz|menu.{0,20}cost|spende|tariffa|listino/i],
        key: 'prices'
      },
      {
        patterns: [/che tipo.{0,15}cucin|che cucin|tipo di cibo|specialit|che si mang|cosa si mang/i],
        key: 'cuisine'
      },
    ];

    for (const check of checks) {
      if (check.patterns.some(p => p.test(t))) {
        const val = ri[check.key];
        console.log(`📋 Info match: key=${check.key}, value=${val || '(vuoto)'}`);
        if (!val) return noInfo;
        // Se il valore è molto corto (es: "No", "Sì"), costruisci risposta più naturale
        const trimmed = val.trim();
        if (trimmed.length <= 3) {
          const isYes = /^(s[iì]|yes|oui|si)$/i.test(trimmed);
          const isNo  = /^(no|non|nein|nope)$/i.test(trimmed);
          if (isNo)  return lang === 'it' ? `No, mi dispiace, non abbiamo questa possibilità.` : `No, unfortunately we don't have this option.`;
          if (isYes) return lang === 'it' ? `Sì, certamente.` : `Yes, certainly.`;
        }
        return trimmed;
      }
    }
    return null; // non è una domanda info
  }

  // Carica le info ristorante da Apps Script e aggiorna il session prompt
  async _fetchAndInjectRestaurantInfo() {
    try {
      const result = await this._callAppsScript({ action: 'get_restaurant_info' });
      if (result?.success && result.info) {
        this._restaurantInfo = result.info;
        const _menuLen = result.info.menuDetails ? result.info.menuDetails.length : 0;
        console.log(`📋 Restaurant info caricata da Config sheet (menuDetails: ${_menuLen} chars)`);
        // Aggiorna la sessione con le info reali
        this._send({
          type: 'session.update',
          session: {
            instructions: this.systemPrompt + this._buildInfoSection(),
          }
        });
      }
    } catch(err) {
      console.error('❌ Errore fetch restaurant info:', err);
    }
  }

  _buildInfoSection() {
    const ri = this._restaurantInfo || {};

    const lines = [];

    // Indirizzo e telefono
    if (ri.address) lines.push(`Indirizzo: ${ri.address}`);
    if (ri.phone)   lines.push(`Telefono ristorante: ${ri.phone}`);

    // Info operative
    if (ri.accessibility)  lines.push(`Accessibilità sedia a rotelle: ${ri.accessibility}`);
    if (ri.parking)        lines.push(`Parcheggio: ${ri.parking}`);
    if (ri.paymentMethods) lines.push(`Metodi di pagamento: ${ri.paymentMethods}`);
    if (ri.highchair)      lines.push(`Seggiolone: ${ri.highchair}`);
    if (ri.outdoorSeating) lines.push(`Zona esterna: ${ri.outdoorSeating}`);

    // Menu e cucina
    if (ri.cuisine)    lines.push(`Tipo di cucina: ${ri.cuisine}`);
    if (ri.vegan)      lines.push(`Opzioni vegane/vegetariane: ${ri.vegan}`);
    if (ri.glutenFree) lines.push(`Senza glutine: ${ri.glutenFree}`);
    if (ri.prices)     lines.push(`Prezzi: ${ri.prices}`);
    if (ri.menuUrl)    lines.push(`Menu online: ${ri.menuUrl}`);
    if (ri.menuText)   lines.push(`Menu: ${ri.menuText}`);
    if (ri.menuDetails) lines.push(`=== MENU COMPLETO ===\n${ri.menuDetails}`);

    if (lines.length === 0) return '';

    const sep = '\u2550'.repeat(80);
    return '\n\n' + sep + '\n📋 INFORMAZIONI RISTORANTE\n' + sep + '\n' +
      'REGOLA CRITICA: Rispondi SOLO con le informazioni elencate qui sotto.\n' +
      'NON inventare mai informazioni non presenti. Se una domanda riguarda qualcosa\n' +
      'non elencato (es: un piatto specifico, allergie non menzionate, orari diversi),\n' +
      'di\' ESATTAMENTE: "Non ho questa informazione, verifichi direttamente col ristorante."\n\n' +
      lines.join('\n') + '\n' + sep;
  }

  // mandare function_call_output con errore prima di _say.
  // Senza questo, GPT ignora l'istruzione di _say e genera la sua risposta (es: conferma falsa).
  _resolveFailedFunctionCall(reason) {
    if (this._lastFunctionCallId) {
      console.log(`🔧 Resolving failed function_call ${this._lastFunctionCallId}: ${reason}`);
      this._send({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: this._lastFunctionCallId,
          output: JSON.stringify({ success: false, error: reason })
        }
      });
      this._lastFunctionCallId = null;
    }
  }

  // Risolve function_call pending per operazioni in corso (check/update).
  // Usa {success: true, status: 'pending'} invece di {success: false}
  // per evitare che GPT interpreti il resolve come un errore e generi rogue responses.
  _resolveFunctionCallPending(reason) {
    if (this._lastFunctionCallId) {
      console.log(`🔧 Resolving pending function_call ${this._lastFunctionCallId}: ${reason}`);
      this._send({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: this._lastFunctionCallId,
          output: JSON.stringify({ success: true, status: 'pending', message: reason })
        }
      });
      this._lastFunctionCallId = null;
    }
  }

  _say(text) {
    console.log(`💉 [say]: ${text.substring(0, 100)}`);
    const lang = this.language || 'it';

    // Frase italiana → non serve traduzione
    if (lang === 'it') {
      this._send({
        type: 'response.create',
        response: { instructions: `Di' ESATTAMENTE e SOLO questa frase, senza aggiungere nulla: "${text}"` },
      });
      return;
    }

    // Frase pre-tradotta disponibile → usa _sayDirect (no hallucination)
    const preTranslated = OpenAIRealtimeClient.THINKING_PHRASES[text]?.[lang];
    if (preTranslated) {
      this._sayDirect(preTranslated);
      return;
    }

    // Frase dinamica → GPT traduce (TRANSLATION TASK ONLY evita di usare il context)
    this._send({
      type: 'response.create',
      response: { instructions: `TRANSLATION TASK ONLY. Translate this Italian text to ${lang} and say ONLY the translation, nothing else. Do NOT use conversation context. Translate word for word: "${text}"` },
    });
  }

  // Dice una frase già nella lingua giusta senza passare per traduzione GPT
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
    const timeout = setTimeout(() => controller.abort(), 25000);

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
