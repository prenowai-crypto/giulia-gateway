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

    // Anti-loop flags
    this._checkingDay  = false;
    this._checkingTime = false;
    this._sessionReady = false;  // evita doppio greeting
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
    const todayISO = DateManager.toISO(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
    const dayName = DateManager.DAYS_IT[now.getDay()];

    this._send({
      type: 'session.update',
      session: {
        modalities: ['audio', 'text'],
        voice: 'alloy',
        instructions: this.systemPrompt,
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
          description: `Estrai i dati di prenotazione dall'audio appena ascoltato. Oggi è ${dayName} ${todayISO}. Chiama SEMPRE questa funzione dopo ogni messaggio del cliente, anche se non hai capito tutti i campi. Per i campi non presenti usa la stringa "null".`,
          parameters: {
            type: 'object',
            properties: {
              date: {
                type: 'string',
                description: `Data ISO YYYY-MM-DD oppure "null". Calcola date relative: "domani"=domani, "sabato"=prossimo sabato, "mercoledì"=prossimo mercoledì. Oggi è ${todayISO}.`
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
                description: 'Intenzione del cliente: create=nuova prenotazione, modify=modifica, cancel=cancellazione, unknown=non chiaro.'
              }
            },
            required: ['date', 'time', 'people', 'name', 'intent']
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
      case 'conversation.item.input_audio_transcription.completed':
        if (msg.transcript) {
          const t = msg.transcript.trim();
          if (!t || t.length < 2) return;
          console.log(`💬 [user]: ${t}`);
          this.onTranscript(t, 'user');
          // Whisper usato solo per log — i dati vengono estratti da GPT via function calling
          this._detectNotesAndPhone(t);
        }
        break;
      case 'input_audio_buffer.speech_started':
        console.log('🎤 Parla...');
        break;
      case 'input_audio_buffer.speech_stopped':
        console.log('🎤 Fine');
        // Triggera estrazione dati via GPT function calling
        if (!this.checkingSlot && this.phase !== 'done') {
          this._triggerExtraction();
        }
        break;
      case 'response.function_call_arguments.done':
        if (msg.name === 'extract_booking_data') {
          try {
            const args = JSON.parse(msg.arguments);
            console.log(`🔧 GPT ha estratto:`, JSON.stringify(args));
            // Chiudi il turn con il risultato della funzione
            this._send({
              type: 'conversation.item.create',
              item: {
                type: 'function_call_output',
                call_id: msg.call_id,
                output: JSON.stringify({ status: 'received' }),
              },
            });
            // Processa i dati estratti
            this._processGPTData(args).catch(err => console.error('❌ _processGPTData:', err));
          } catch (err) {
            console.error('❌ Errore function call:', err);
          }
        }
        break;
      case 'response.done':
        if (msg.response?.status === 'failed') console.error('❌ Response failed');
        break;
      case 'error':
        if (msg.error?.code !== 'conversation_already_has_active_response') {
          console.error('❌ OpenAI:', msg.error);
          this.onError(msg.error);
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
    const todayISO = DateManager.toISO(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
    const dayName = DateManager.DAYS_IT[now.getDay()];

    this._send({
      type: 'response.create',
      response: {
        tool_choice: { type: 'function', function: { name: 'extract_booking_data' } },
        instructions: `Oggi è ${dayName} ${todayISO}. Analizza l'audio appena ricevuto e chiama extract_booking_data con tutti i dati che hai capito. Per i campi non menzionati usa "null".`,
        max_output_tokens: 150,
      },
    });
  }

  // ── Processa dati estratti da GPT ─────────────────────────────────────────

  async _processGPTData(args) {
    if (this.checkingSlot || this.phase === 'done') return;

    const rc = this.restaurantConfig;

    // ── Intent ───────────────────────────────────────────────────────────────
    if (!this.intent && args.intent && args.intent !== 'unknown') {
      this.intent = args.intent;
      console.log(`🎯 Intent (GPT): ${this.intent}`);
    }

    const prevDate = this.data.date;
    const prevTime = this.data.time;

    // ── Aggiorna dati ────────────────────────────────────────────────────────
    const newDate   = (args.date   && args.date   !== 'null') ? args.date   : null;
    const newTime   = (args.time   && args.time   !== 'null') ? args.time   : null;
    const newPeople = (args.people && args.people !== 'null') ? parseInt(args.people) : null;
    const newName   = (args.name   && args.name   !== 'null') ? args.name.trim() : null;

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

    // ② Check orario valido
    if (this.data.date && this.data.time && this.data.time !== prevTime) {
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
      { pattern: /celiac[oai]/i,                                   note: 'Intolleranza glutine' },
      { pattern: /lattosio|lactose/i,                               note: 'Intolleranza lattosio' },
      { pattern: /allergi[ao]/i,                                    note: 'Allergia (verifica con cliente)' },
      { pattern: /arachidi|arachide|frutta\s*secca|noci/i,          note: 'Allergia frutta secca' },
      { pattern: /vegetarian[oai]/i,                                note: 'Vegetariano' },
      { pattern: /vegan[oai]/i,                                     note: 'Vegano' },
      { pattern: /seggiol[eo]n[eo]|seggiolino|highchair/i,          note: 'Richiesto seggiolone' },
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
        // Se il nome è già stato salvato (dalla frase di correzione), conferma direttamente
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
      /\bmi\s+chiamo\s+([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)?)/i,
      /\bsono\s+([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)?)/i,
      /\ba\s+nome\s+(?:di\s+)?([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)*)/i,
      /\bnome\s+([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)?)/i,
      /^(?:no[,\s]+)?a\s+([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)?)[\s.,!]*$/i,
      /^([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)?)[\s.,!]*$/i,  // i flag: Whisper spesso trascrive in minuscolo
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

  _say(text) {
    console.log(`💉 [say]: ${text.substring(0, 100)}`);
    this._send({
      type: 'response.create',
      response: { instructions: `Di' ESATTAMENTE e SOLO questa frase, senza aggiungere nulla: "${text}"` },
    });
  }

  _send(obj) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
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

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    try { return JSON.parse(text); } catch { return null; }
  }
}
