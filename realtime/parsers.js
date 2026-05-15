// ─── PRENOW PARSERS & VALIDATORS ────────────────────────────────────────────
// DateManager, TimeManager, PeopleManager, IntentDetector, ValidationPipeline
// ─────────────────────────────────────────────────────────────────────────────

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


