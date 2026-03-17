// ═══════════════════════════════════════════════════════════════════════════════
// PRENOW - OPENAI REALTIME CLIENT v3.0.0
//
// 🆕 v3.0.0 - SERVER-SIDE STATE MANAGER (anti-hallucination):
//   - Parsing deterministico di data/ora/persone/nome da ogni trascrizione
//   - sessionState.collectedData: fonte di verità lato server
//   - GPT non può inventare dati: prepare_reservation usa collectedData
//   - "Un attimo..." automatico prima di ogni tool call (via system prompt)
//
// FIX v2.2.1 (ereditate):
//   - Constructor: salva callerPhone
//   - sessionState: aggiunto foundReservation
//   - handleToolCall: passa callerPhone al context
// ═══════════════════════════════════════════════════════════════════════════════

import WebSocket from 'ws';

// ─────────────────────────────────────────────────────────────────────────────
// 🆕 v3.0.0: PARSING DETERMINISTICO (porta logica da v3.9.31)
// ─────────────────────────────────────────────────────────────────────────────


// ═══════════════════════════════════════════════════════════════════════════════
// PRENOW REALTIME — PARSING MODULE v1.0
// Portato da index_3_9_31.txt e adattato per Whisper (lowercase)
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY
// ─────────────────────────────────────────────────────────────────────────────

function normalizeText(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function getNowRome() {
  const s = new Date().toLocaleString('en-US', { timeZone: 'Europe/Rome' });
  return new Date(s);
}

function addDays(date, days) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

function toISO(date) {
  if (!date || isNaN(date.getTime())) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// ─────────────────────────────────────────────────────────────────────────────
// INTENT DETECTOR
// ─────────────────────────────────────────────────────────────────────────────

function detectIntent(text) {
  if (!text) return 'create';

  // Pre-processing: rimuove "a nome X" per evitare match su cognomi
  let t = text.toLowerCase();
  t = t.replace(/\ba\s+nome\s+\w+/gi, ' ');
  t = t.replace(/\bnome\s+\w+/gi, ' ');
  t = t.replace(/\s+/g, ' ').trim();

  const tOrig = text.toLowerCase();

  // CREATE override: "altra/nuova prenotazione" → sempre create
  if (/\b(altra|nuova|seconda|un'?altra|una\s+nuova)\s+prenotazione/i.test(tOrig)) return 'create';

  // CANCEL keywords (con word boundary)
  const cancelKws = [
    'cancellare','cancella','cancello','cancellazione',
    'cancellarla','cancellarlo','cancellarli','cancellarle',
    'disdire','disdetta','disdico','disdirla','disdirlo',
    'annullare','annulla','annullo','annullamento',
    'annullarla','annullarlo','annullarle',
    'eliminare','elimina','elimino',
    'non vengo','non veniamo','non riesco',
    'cancel','cancellation','delete','remove',
    'i need to cancel','i want to cancel','cancel my reservation',
  ];
  for (const kw of cancelKws) {
    if (kw.includes(' ')) {
      if (t.includes(kw)) return 'cancel';
    } else {
      if (new RegExp(`\\b${kw}\\b`, 'i').test(t)) return 'cancel';
    }
  }

  // MODIFY keywords
  const modifyKws = [
    'modificare','modifica','modifico',
    'spostare','sposta','sposto',
    'cambiare','cambia','cambio',
    'anticipare','posticipare',
    'change','modify','move','reschedule','update',
    'i need to change','i want to change','i need to modify',
    'change my reservation',
  ];
  for (const kw of modifyKws) {
    if (t.includes(kw)) return 'modify';
  }

  // Existing reservation keywords → modify
  const existingKws = [
    'ho prenotato','avevo prenotato','ho una prenotazione',
    'la mia prenotazione','la prenotazione',
    'i have a reservation','my reservation','i booked',
  ];
  for (const kw of existingKws) {
    if (tOrig.includes(kw)) return 'modify';
  }

  return 'create';
}

// ─────────────────────────────────────────────────────────────────────────────
// DATE PARSER
// ─────────────────────────────────────────────────────────────────────────────

const DAYS_IT = ['domenica','lunedì','martedì','mercoledì','giovedì','venerdì','sabato'];

function parseDate(text) {
  if (!text) return null;
  const t = normalizeText(text);
  const now = getNowRome();
  const today = startOfDay(now);

  // 1. Data esplicita (10 marzo, 10/03)
  const explicit = _parseExplicitDate(t, today);
  if (explicit) return explicit;

  // 2. Data relativa (domani, dopodomani, tra N giorni, stasera)
  const relative = _parseRelativeDate(t, today);
  if (relative) return relative;

  // 3. Giorno settimana + numero (martedì 10)
  const weekdayNum = _parseWeekdayWithNumber(t, today);
  if (weekdayNum) return weekdayNum;

  // 4. Giorno settimana (giovedì)
  const weekday = _parseWeekdayDate(t, today);
  if (weekday) return weekday;

  return null;
}

function _parseExplicitDate(text, today) {
  const monthsMap = {
    'gennaio':0,'febbraio':1,'marzo':2,'aprile':3,'maggio':4,'giugno':5,
    'luglio':6,'agosto':7,'settembre':8,'ottobre':9,'novembre':10,'dicembre':11,
    'january':0,'february':1,'march':2,'april':3,'may':4,'june':5,
    'july':6,'august':7,'september':8,'october':9,'november':10,'december':11,
  };

  // DD/MM
  const slashMatch = text.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  if (slashMatch) {
    const day = parseInt(slashMatch[1]), month = parseInt(slashMatch[2]) - 1;
    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      let year = today.getFullYear();
      let c = new Date(year, month, day);
      if (c < today) c = new Date(++year, month, day);
      return toISO(c);
    }
  }

  // "10 marzo" / "10 di marzo"
  const allMonths = Object.keys(monthsMap).join('|');
  const regex = new RegExp(`(\\d{1,2})\\s*(?:di\\s+)?(${allMonths})`, 'i');
  const match = text.match(regex);
  if (match) {
    const day = parseInt(match[1]);
    const month = monthsMap[match[2].toLowerCase()];
    if (month !== undefined && day >= 1 && day <= 31) {
      let year = today.getFullYear();
      let c = new Date(year, month, day);
      if (c < today) c = new Date(++year, month, day);
      return toISO(c);
    }
  }
  return null;
}

function _parseRelativeDate(text, today) {
  if (/dopodomani|dopo\s*domani|day after tomorrow/.test(text)) return toISO(addDays(today, 2));
  if (/\bdomani\b|\btomorrow\b/.test(text)) return toISO(addDays(today, 1));
  if (/\boggi\b|\btoday\b|\bstasera\b|\bquesta\s*sera\b|\btonight\b/.test(text)) return toISO(today);
  const tra = text.match(/(?:tra|fra|in)\s*(\d+)\s*giorni/);
  if (tra) return toISO(addDays(today, parseInt(tra[1])));
  return null;
}

function _parseWeekdayWithNumber(text, today) {
  const weekdays = [
    { patterns: ['domenica','sunday'], index: 0 },
    { patterns: ['lunedi','monday'], index: 1 },
    { patterns: ['martedi','tuesday'], index: 2 },
    { patterns: ['mercoledi','wednesday'], index: 3 },
    { patterns: ['giovedi','thursday'], index: 4 },
    { patterns: ['venerdi','friday'], index: 5 },
    { patterns: ['sabato','saturday'], index: 6 },
  ];
  for (const wd of weekdays) {
    for (const p of wd.patterns) {
      const regex = new RegExp(`\\b${p}\\s+(\\d{1,2})\\b`, 'i');
      const match = text.match(regex);
      if (match) {
        const dayNum = parseInt(match[1]);
        if (dayNum >= 1 && dayNum <= 31) {
          let c = new Date(today.getFullYear(), today.getMonth(), dayNum);
          if (c < today) c = new Date(today.getFullYear(), today.getMonth() + 1, dayNum);
          return toISO(c);
        }
      }
    }
  }
  return null;
}

function _parseWeekdayDate(text, today) {
  const weekdays = [
    { patterns: ['domenica','sunday'], index: 0 },
    { patterns: ['lunedi','monday'], index: 1 },
    { patterns: ['martedi','tuesday'], index: 2 },
    { patterns: ['mercoledi','wednesday'], index: 3 },
    { patterns: ['giovedi','thursday'], index: 4 },
    { patterns: ['venerdi','friday'], index: 5 },
    { patterns: ['sabato','saturday'], index: 6 },
  ];

  let lastIndex = -1, lastPos = -1;
  for (const wd of weekdays) {
    for (const p of wd.patterns) {
      const pos = text.lastIndexOf(p);
      if (pos !== -1 && pos > lastPos) { lastPos = pos; lastIndex = wd.index; }
    }
  }

  if (lastIndex === -1) return null;

  const hasNext = /\b(prossim[ao]|next)\b/i.test(text);
  const d = _getNextWeekday(today, lastIndex);
  if (hasNext && d.getDay() === today.getDay() && d.getDate() === today.getDate()) {
    return toISO(addDays(d, 7));
  }
  return toISO(d);
}

function _getNextWeekday(fromDate, targetWeekday) {
  const result = new Date(fromDate.getTime());
  const diff = ((targetWeekday - result.getDay()) + 7) % 7;
  result.setDate(result.getDate() + (diff === 0 ? 7 : diff));
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// TIME PARSER
// ─────────────────────────────────────────────────────────────────────────────

function parseTime(text) {
  if (!text) return null;
  const t = text.toLowerCase().trim();

  if (/mezzogiorno|noon/.test(t)) return '12:00';
  if (/mezzanotte|midnight/.test(t)) return '00:00';

  // Tempo relativo: "tra mezz'ora", "tra un'ora", "tra 30 minuti"
  const relTime = _parseRelativeTime(t);
  if (relTime) return relTime;

  const allTimes = [];
  let m;

  // Numeri in lettere: "alle venti e trenta", "alle otto e mezza"
  const hourWords = {
    'uno':1,'due':2,'tre':3,'quattro':4,'cinque':5,'sei':6,'sette':7,'otto':8,
    'nove':9,'dieci':10,'undici':11,'dodici':12,'tredici':13,'quattordici':14,
    'quindici':15,'sedici':16,'diciassette':17,'diciotto':18,'diciannove':19,
    'venti':20,'ventuno':21,'ventidue':22,'ventitre':23,'ventitré':23,
  };
  const minuteWords = {
    'mezza':30,'mezzo':30,'half':30,'trenta':30,'thirty':30,
    'quindici':15,'quarter':15,'un quarto':15,
    'quaranta':40,'forty':40,'quarantacinque':45,
    'venti':20,'twenty':20,'dieci':10,'ten':10,'cinque':5,'five':5,
  };
  const allHourKeys = Object.keys(hourWords).join('|');
  const allMinuteKeys = Object.keys(minuteWords).join('|');
  const reWords = new RegExp(
    `(?:alle|ore|per le|at)\\s+(${allHourKeys})(?:\\s+e\\s+(${allMinuteKeys}))?`, 'gi'
  );
  while ((m = reWords.exec(t)) !== null) {
    let h = hourWords[m[1].toLowerCase()];
    if (h === undefined) continue;
    const min = m[2] ? (minuteWords[m[2].toLowerCase()] || 0) : 0;
    if (h >= 1 && h <= 11 && !/mattina|pranzo|morning|lunch/.test(t)) h += 12;
    if (h >= 0 && h <= 23)
      allTimes.push({ pos: m.index, time: `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}` });
  }

  // "alle 21", "alle 21:30", varianti Whisper "l'E21", "le 21", "l'21"
  const re1 = /(?:alle|ore|per le|l['\s]e?|at)\s*(\d{1,2})[\.:](\d{2})/gi;
  while ((m = re1.exec(t)) !== null) {
    let h = parseInt(m[1]), min = parseInt(m[2]);
    if (h >= 1 && h <= 11 && !/mattina|pranzo|morning|lunch/.test(t)) h += 12;
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59)
      allTimes.push({ pos: m.index, time: `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}` });
  }

  const re2 = /(?:alle|ore|per le|l['\s]e?|at)\s*(\d{1,2})\b/gi;
  while ((m = re2.exec(t)) !== null) {
    let h = parseInt(m[1]);
    if (h >= 1 && h <= 11 && !/mattina|pranzo|morning|lunch/.test(t)) h += 12;
    if (h >= 0 && h <= 23)
      allTimes.push({ pos: m.index, time: `${String(h).padStart(2,'0')}:00` });
  }

  // Standalone "21:30" o "21.30"
  const re3 = /\b(\d{1,2})[\.:](\d{2})\b/g;
  while ((m = re3.exec(t)) !== null) {
    let h = parseInt(m[1]), min = parseInt(m[2]);
    if (h >= 1 && h <= 11 && !/mattina|pranzo|morning|lunch/.test(t)) h += 12;
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59)
      allTimes.push({ pos: m.index, time: `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}` });
  }

  // am/pm
  const re4 = /\b(\d{1,2})\s*(pm|am)\b/gi;
  while ((m = re4.exec(t)) !== null) {
    let h = parseInt(m[1]);
    if (m[2].toLowerCase() === 'pm' && h < 12) h += 12;
    if (m[2].toLowerCase() === 'am' && h === 12) h = 0;
    allTimes.push({ pos: m.index, time: `${String(h).padStart(2,'0')}:00` });
  }

  if (allTimes.length === 0) return null;

  // Usa ULTIMO orario (gestisce correzioni "anzi...")
  allTimes.sort((a, b) => a.pos - b.pos);
  const last = allTimes[allTimes.length - 1];
  if (allTimes.length > 1)
    console.log(`⏰ parseTime: trovati ${allTimes.length} orari, uso ULTIMO: "${last.time}"`);
  return last.time;
}

function _parseRelativeTime(text) {
  const now = getNowRome();
  const patterns = [
    { re: /tra\s+mezz['']?\s*ora|fra\s+mezz['']?\s*ora|in\s+(?:half\s+an?\s+hour|30\s*min)/i, mins: 30 },
    { re: /tra\s+un['']?\s*ora|fra\s+un['']?\s*ora|in\s+(?:an?\s+hour|one\s+hour|60\s*min)/i, mins: 60 },
    { re: /tra\s+(\d+)\s*minut|fra\s+(\d+)\s*minut|in\s+(\d+)\s*min/i, extract: true },
    { re: /tra\s+(\d+)\s*ore|fra\s+(\d+)\s*ore|in\s+(\d+)\s*hour/i, extract: true, hours: true },
  ];
  for (const p of patterns) {
    const match = text.match(p.re);
    if (match) {
      let offset;
      if (p.extract) {
        const num = parseInt(match[1] || match[2] || match[3]);
        offset = p.hours ? num * 60 : num;
      } else {
        offset = p.mins;
      }
      const target = new Date(now.getTime() + offset * 60000);
      const mins = target.getMinutes();
      const rounded = Math.ceil(mins / 15) * 15;
      target.setMinutes(rounded % 60);
      if (rounded >= 60) target.setHours(target.getHours() + 1);
      target.setSeconds(0);
      return `${String(target.getHours()).padStart(2,'0')}:${String(target.getMinutes()).padStart(2,'0')}`;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// PEOPLE PARSER
// ─────────────────────────────────────────────────────────────────────────────

function parsePeople(text) {
  if (!text) return null;
  const t = text.toLowerCase().trim();

  // Correzione "anzi/no aspetta → usa ULTIMO numero"
  if (/anzi|no aspetta|aspetta|facciamo|meglio|diciamo|actually|no wait/i.test(t)) {
    const nums = t.match(/\b(\d+)\b/g);
    if (nums && nums.length >= 2) {
      const last = parseInt(nums[nums.length - 1]);
      if (last > 0 && last < 100) return last;
    }
  }

  // Falsi positivi: non parsare come persone
  if (/ci sei|ci siete|mi senti/i.test(t)) return null;

  const patterns = [
    /(\d+)\s*in\s*totale/i,
    /siamo\s*(?:in\s*)?(\d+)/i,
    /(?:per|saremo|in)\s*(\d+)\s*(?:person[ae]|pax|coperti|guests|people)?/i,
    /(\d+)\s*(?:person[ae]|pax|coperti|guests|people)/i,
    /(?:tavolo|table)\s*(?:per|for)\s*(\d+)/i,
    /(\d+)\s*invece\s*di\s*\d+/i,
    /adesso\s*(?:siamo\s*)?(?:in\s*)?(\d+)/i,
  ];
  for (const p of patterns) {
    const match = t.match(p);
    if (match) {
      const n = parseInt(match[1]);
      if (n > 0 && n < 100) return n;
    }
  }

  // Numeri in lettere
  const words = { 'due':2,'tre':3,'quattro':4,'cinque':5,'sei':6,'sette':7,'otto':8,'nove':9,'dieci':10 };
  for (const [w, n] of Object.entries(words)) {
    if (t.includes(w)) return n;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// NAME PARSER
// ─────────────────────────────────────────────────────────────────────────────

function parseName(text) {
  if (!text) return null;
  const t = text.trim();

  const EXCLUDE = [
    'si','no','ok','sì','yes','grazie','prego','esatto','confermo','giusto','certo',
    'quello','quella','bene','perfetto','ciao','buongiorno','buonasera','buonanotte',
    'io','me','noi','lui','lei','uno','una','un','mille','tanto','molto',
    'pronto','salve','allora','ecco','dunque','quindi','però','anche','magari','cioè',
    'senza','mail','email','nessuno','nessuna',
    'ci sei','ci siete','mi senti','mi sentite','grazie mille',
    'always','sempre','ancora','proprio','stesso','solito',
    // parole comuni che Whisper trascrive come nomi
    'nome','mio','mia','suo','sua','il','la','lo','un','una','per','alle',
  ];

  const STOP_AFTER = /\s+(?:alle|per|il|la|lo|gli|i|le|di|da|in|con|su|tra|fra|e|ed|o|a|un|una|uno|senza|email|mail)\b/i;

  // Pattern espliciti (ordine priorità)
  const patterns = [
    /\ba\s+nome\s+(?:di\s+)?([A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]+(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]+)?)/i,
    /\bil\s+(?:mio\s+)?nome\s+[èe]\s+([A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]+(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]+)?)/i,
    /\bmi\s+chiamo\s+([A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]+)/i,
    /\bsono\s+([A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]+)\b/i,
    /\bname\s+is\s+([A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]+)\b/i,
    /\bi'?m\s+([A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]+)\b/i,
    /\bunder\s+(?:the\s+)?name\s+([A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]+)\b/i,
    // "nome Francesco" ovunque nella frase
    /\bnome\s+([A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]+(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]+)?)/i,
    // "per 4 persone, Nome Cognome" — dopo virgola/punto
    /[,\.]\s*([A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]{1,}(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]+)?)\s*$/i,
  ];

  for (const p of patterns) {
    const match = t.match(p);
    if (match && match[1]) {
      let name = match[1].trim();
      const stop = name.match(STOP_AFTER);
      if (stop) name = name.substring(0, stop.index).trim();
      if (name.length >= 2 && !EXCLUDE.includes(name.toLowerCase())) return name;
    }
  }

  // Risposta secca: 1-2 parole che sembrano un nome
  const stripped = t.replace(/[.,!?]+$/, '').trim();
  const words = stripped.split(/\s+/);
  if (words.length <= 2) {
    if (/^[A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]{1,}(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]+)?$/.test(stripped)
        && !EXCLUDE.includes(stripped.toLowerCase())) {
      return stripped;
    }
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// NAME MATCH (per verifica nome prenotazione)
// ─────────────────────────────────────────────────────────────────────────────

function nameMatches(userResponse, expectedName) {
  if (!expectedName || !userResponse) return false;

  const resp = userResponse.toLowerCase().trim();
  const exp = expectedName.toLowerCase().trim();

  // Negazione → non è un match
  const negations = [
    new RegExp(`\\bnon\\s+(sono|mi\\s+chiamo|è)\\s+${exp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'),
    new RegExp(`\\b(no|non)\\s+${exp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'),
  ];
  for (const n of negations) {
    if (n.test(resp)) return false;
  }

  // Match diretto
  if (resp.includes(exp)) return true;

  // Match per parola
  for (const word of exp.split(/\s+/).filter(w => w.length >= 2)) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(resp)) return true;
  }

  // Conferme implicite
  const confirms = [
    /^s[ìi]\s*$/,/^s[ìi]\s+(esatto|confermo|quello|giusto|certo)/i,
    /^esatto\s*$/i,/^confermo\s*$/i,/^giusto\s*$/i,
    /^yes\s*$/i,/^correct\s*$/i,/^right\s*$/i,
    /^that'?s?\s*(us|me|right|correct|it)/i,
  ];
  for (const p of confirms) {
    if (p.test(resp)) return true;
  }

  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIRM / DENY / CANCEL CONFIRM helpers
// ─────────────────────────────────────────────────────────────────────────────

function isConfirming(text) {
  const t = normalizeText(text || '');
  if (/^(si\b|sii\b|yes\b|esatto|corretto|giusto|confermo|certo|ok\b|va bene|proprio|quella|perfetto)/.test(t)) return true;
  if (/\b(conferm|esatt|corrett|giust|perfett)\w*\b/.test(t)) return true;
  return false;
}

function isDenying(text) {
  const t = normalizeText(text || '');
  if (/^(no[^n]|non |sbagliato|errato|altra|diversa)/.test(t)) return true;
  if (/\b(sbagliat|errat)\w*\b/.test(t)) return true;
  if (/\b(teniamo|mantieni|manteniamo|lascia\s+stare|lascia\s+perdere|non\s+cancell)\b/i.test(t)) return true;
  if (/\b(keep it|don't cancel|never\s*mind|forget it)\b/i.test(t)) return true;
  return false;
}

function isConfirmingCancellation(text) {
  const t = normalizeText(text || '');
  if (/conferm\w*\s+(la\s+)?cancellazion/i.test(t)) return true;
  if (/cancella(te)?\s+pure/i.test(t)) return true;
  if (/si\s*,?\s*cancella/i.test(t)) return true;
  if (/yes\s*,?\s*cancel/i.test(t)) return true;
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// EMAIL PARSER
// ─────────────────────────────────────────────────────────────────────────────

function parseEmail(text) {
  if (!text) return null;
  const m = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0] : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// MEAL CONTEXT
// ─────────────────────────────────────────────────────────────────────────────

function parseMealContext(text) {
  if (!text) return null;
  const t = text.toLowerCase();
  if (/\bpranzo\b|\blunch\b|\bmeriggio\b|\bmezzogiorno\b/.test(t)) return 'pranzo';
  if (/\bcena\b|\bdinner\b|\bstasera\b|\bsera\b/.test(t)) return 'cena';
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────


// ─────────────────────────────────────────────────────────────────────────────
// CLASSE PRINCIPALE
// ─────────────────────────────────────────────────────────────────────────────

export class OpenAIRealtimeClient {
  constructor(options) {
    this.apiKey = options.apiKey;
    this.model = options.model || 'gpt-4o-mini-realtime-preview';
    this.systemPrompt = options.systemPrompt;
    this.tools = options.tools || [];
    this.callSid = options.callSid;
    this.restaurantConfig = options.restaurantConfig;
    this.callerPhone = options.callerPhone || null;

    this.onAudioDelta = options.onAudioDelta || (() => {});
    this.onTranscript = options.onTranscript || (() => {});
    this.onError = options.onError || console.error;

    this.ws = null;
    this.isConnected = false;
    this.sessionId = null;

    // SESSION STATE v3.0.0
    this.sessionState = {
      pendingReservation: null,
      pendingConfirmation: false,
      foundReservation: null,
      initialIntent: null,  // 'create' | 'modify' | 'cancel' — rilevato alla prima frase

      // 🆕 v3.0.0: fonte di verità server-side (GPT non può sovrascrivere)
      collectedData: {
        date: null,
        time: null,
        people: null,
        name: null,
        email: null,
        mealContext: null,  // 'pranzo' | 'cena' | null
      }
    };

    // Echo detection
    this.recentAiTranscripts = [];
    this.recentAiPhrases = [];
    this.MAX_AI_HISTORY = 10;
    this.lastAiFinishedTime = 0;
    this.isAiCurrentlySpeaking = false;
    this.speechStartedDuringAi = false;
    this.ECHO_WINDOW_MS = 2500;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      const url = `wss://api.openai.com/v1/realtime?model=${this.model}`;
      this.ws = new WebSocket(url, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'OpenAI-Beta': 'realtime=v1'
        }
      });
      this.ws.on('open', () => {
        console.log('🟢 Connesso a OpenAI Realtime API');
        this.isConnected = true;
        this.initializeSession();
        resolve();
      });
      this.ws.on('message', (data) => {
        this.handleMessage(JSON.parse(data.toString()));
      });
      this.ws.on('error', (error) => {
        console.error('❌ OpenAI WebSocket error:', error);
        this.onError(error);
        reject(error);
      });
      this.ws.on('close', (code, reason) => {
        console.log(`🔴 OpenAI disconnesso (${code}): ${reason}`);
        this.isConnected = false;
      });
    });
  }

  initializeSession() {
    // 🆕 v3.0.0: aggiunge istruzioni anti-invenzione e "Un attimo..."
    const enhancedPrompt = this.systemPrompt + `

REGOLA CRITICA - TOOL CALLS:
Prima di chiamare QUALSIASI tool pronuncia SEMPRE una frase breve come "Un attimo..." o "Un momento..." per evitare silenzi. È OBBLIGATORIO.
NON annunciare mai data, orario o numero di persone PRIMA di aver chiamato il tool. Esempio SBAGLIATO: "Perfetto, per mercoledì alle 21, verifico..." → Esempio CORRETTO: "Un attimo, verifico la disponibilità..."

REGOLA ANTI-INVENZIONE:
NON inventare MAI dati non detti esplicitamente dal cliente.
Se manca il nome: chiedilo. NON inventarlo.
Se manca la data: chiedi. NON inventarla.
Se manca l'orario: chiedilo SEMPRE esplicitamente con "A che ora preferisce?". NON usare un orario di default. "Sera", "pranzo", "cena" NON sono orari: il cliente deve dire un'ora precisa come "alle 20", "alle 20:30", ecc. Finché non c'è un orario esplicito, NON chiamare check_availability.
Se l'email NON è stata fornita: NON includerla nel riepilogo. NON inventare email di esempio. Se email=null, non menzionarla.

REGOLA RECAP - CRITICA:
Quando prepare_reservation restituisce il campo "recap", devi leggerlo AL CLIENTE ESATTAMENTE COME È SCRITTO, parola per parola. NON riformularlo. NON usare orari o dati diversi da quelli nel recap. Il recap è la fonte di verità assoluta.

REGOLA CHIUSURA - MASSIMA PRIORITÀ, ESEGUIRE PRIMA DI QUALSIASI ALTRA COSA:
Appena il cliente menziona un giorno qualsiasi (es. "lunedì", "martedì", "domani", "giovedì prossimo"), devi chiamare IMMEDIATAMENTE check_availability con quella data, usando time="20:00" e people=2 come placeholder. NON chiedere orario, persone o altro — prima verifica se il giorno è aperto. Se il tool risponde day_closed, comunicalo subito e proponi un altro giorno. Solo se il giorno è APERTO, poi chiedi orario e persone.

FLUSSO PRENOTAZIONE - SOLO SE IL GIORNO È APERTO:
1. check_availability con la data appena disponibile (anche senza orario — usa placeholder)
2. Se aperto: chiedere orario esplicito, poi persone se mancanti
3. check_availability di nuovo con orario reale del cliente
   - Se "missing_time": chiedi "A che ora preferisce?"
   - Se "slot_full": di' che quello slot è pieno e chiedi un orario diverso. NON proporre tu un orario alternativo — lascia scegliere al cliente
   - Se "outside_hours": di' SOLO gli orari disponibili (es. "La cena è dalle 21:00 alle 22:30"). NON dire che un orario non verificato non è disponibile — hai solo verificato l'orario richiesto, non gli altri
   - Se disponibile: procedi al passo 4
4. Chiedere nome se non ancora noto
5. Chiedere email: "Vuole ricevere un'email di conferma?" — OBBLIGATORIO
6. prepare_reservation → leggere il riepilogo PAROLA PER PAROLA
7. Attendere conferma esplicita ("sì", "confermo", "va bene")
8. create_reservation (SOLO dopo prepare e conferma)
MAI saltare step. MAI chiamare create senza prepare.
MAI proporre orari di tua iniziativa: se uno slot non è disponibile, chiedi al cliente quale orario preferisce.

FLUSSO MODIFICA (MODIFY):
1. find_reservation → cerca la prenotazione del cliente
2. Se non trovata: informare il cliente e chiedere se vuole fare una nuova prenotazione
3. Se trovata: leggere i dati al cliente ("Ho trovato: X persone, giorno Y alle Z") e chiedere cosa vuole cambiare
4. Raccogliere il/i campi da modificare (orario, data, persone)
5. check_availability con i nuovi dati
6. prepare_reservation → riepilogo con i nuovi dati
7. Attendere conferma esplicita
8. modify_reservation (SOLO dopo prepare e conferma)
MAI chiamare modify senza prima trovare la prenotazione con find_reservation.

FLUSSO CANCELLAZIONE (CANCEL):
1. find_reservation → cerca la prenotazione del cliente
2. Se non trovata: informare il cliente
3. Se trovata: il tool cancel_reservation chiederà AUTOMATICAMENTE conferma — leggi il messaggio al cliente PAROLA PER PAROLA
4. Se cliente conferma ("sì", "cancella", "confermo"): imposta sessionState.cancelConfirmed=true e richiama cancel_reservation
5. Se cliente nega ("no", "lascia stare", "non cancellare"): NON cancellare, chiedere se può aiutare con altro
MAI cancellare senza conferma esplicita.

REGOLA CONFERMA - CRITICA:
Dopo che il cliente dice "sì", "confermo", "va bene" o qualsiasi conferma, devi OBBLIGATORIAMENTE chiamare il tool create_reservation. NON puoi dire "prenotazione confermata" o "a presto" senza aver prima chiamato create_reservation. Se non chiami create_reservation, la prenotazione NON esiste. La frase "Grazie, a presto!" va detta SOLO DOPO che create_reservation ha risposto con successo.`;

    this.send({
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
        instructions: enhancedPrompt,
        voice: 'alloy',
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        input_audio_transcription: { model: 'whisper-1', language: 'it' },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.4,
          prefix_padding_ms: 300,
          silence_duration_ms: 500
        },
        tools: this.tools.map(t => ({
          type: 'function',
          name: t.name,
          description: t.description,
          parameters: t.parameters
        }))
      }
    });

    this.isAiCurrentlySpeaking = true;
    this.send({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: '[Il cliente ha appena chiamato. Salutalo brevemente e chiedi come puoi aiutarlo.]' }]
      }
    });
    this.send({ type: 'response.create' });
  }

  // 🆕 v3.0.0: aggiorna collectedData parsando la trascrizione
  _parseAndStore(transcript) {
    const cd = this.sessionState.collectedData;
    const locked = this.sessionState.pendingConfirmation === true;
    const prevDate = cd.date;

    // 🆕 Rileva intent alla prima frase (solo se non ancora impostato)
    if (!this.sessionState.initialIntent) {
      const intent = detectIntent(transcript);
      this.sessionState.initialIntent = intent;
      console.log(`🎯 [SERVER] initialIntent: "${intent}"`);
    }

    const date = parseDate(transcript);
    if (date && cd.date !== date) {
      console.log(`📅 [SERVER] date: "${cd.date}" → "${date}"`);
      cd.date = date;
    }

    const time = parseTime(transcript);
    if (time && cd.time !== time) {
      console.log(`⏰ [SERVER] time: "${cd.time}" → "${time}"`);
      cd.time = time;
    }

    const people = parsePeople(transcript);
    if (people && cd.people !== people) {
      console.log(`👥 [SERVER] people: ${cd.people} → ${people}`);
      cd.people = people;
    }

    // 🛡️ Nome e email: non aggiornare se siamo in attesa di conferma
    if (!locked) {
      const name = parseName(transcript);
      if (name && cd.name !== name) {
        console.log(`👤 [SERVER] name: "${cd.name}" → "${name}"`);
        cd.name = name;
      }

      const email = parseEmail(transcript);
      if (email && cd.email !== email) {
        console.log(`📧 [SERVER] email: "${cd.email}" → "${email}"`);
        cd.email = email;
      }
    } else {
      const name = parseName(transcript);
      if (name && cd.name !== name) {
        console.log(`🔒 [SERVER] name LOCKED - ignorato: "${name}" (pendingConfirmation=true)`);
      }
    }

    console.log(`📊 [SERVER] collectedData:`, JSON.stringify(cd));

    // 🆕 Parsing contesto pasto (pranzo/cena) — non imposta orario ma serve per check chiusura
    if (!locked) {
      const tLower = transcript.toLowerCase();
      if (/\bpranzo\b|\blunch\b|\bmeriggio\b|\bmezzogiorno\b/.test(tLower) && cd.mealContext !== 'pranzo') {
        cd.mealContext = 'pranzo';
        console.log(`🍽️ [SERVER] mealContext: → "pranzo"`);
      } else if (/\bcena\b|\bdinner\b|\bstasera\b|\bsera\b/.test(tLower) && cd.mealContext !== 'cena') {
        cd.mealContext = 'cena';
        console.log(`🍽️ [SERVER] mealContext: → "cena"`);
      }
    }

    // 🆕 AUTO-TRIGGER: se è stata parsata una nuova data, verifica subito chiusura
    // NON scatta se siamo in contesto modifica/cancella (foundReservation presente O intent rilevato)
    // NON scatta se GPT sta già parlando (evita interferenze)
    const isModifyContext = !!this.sessionState.foundReservation ||
      this.sessionState.initialIntent === 'modify' ||
      this.sessionState.initialIntent === 'cancel';
    if (cd.date && cd.date !== prevDate && !locked && !isModifyContext && !this.isAiCurrentlySpeaking) {
      const dayOfWeek = new Date(cd.date + 'T12:00:00').getDay();
      const closingDays = this.restaurantConfig?.weekly_closing_days || [];
      const lunchClosedDays = this.restaurantConfig?.lunch_closed_days || [];
      const dinnerClosedDays = this.restaurantConfig?.dinner_closed_days || [];
      console.log(`🚀 [SERVER] Auto-trigger: data=${cd.date} dayOfWeek=${dayOfWeek} closingDays=${JSON.stringify(closingDays)} meal=${cd.mealContext}`);

      if (closingDays.includes(dayOfWeek)) {
        console.log(`🔒 [SERVER] Giorno chiuso rilevato server-side: ${cd.date}`);
        this._injectClosedDayMessage(cd.date, dayOfWeek, 'day');
      } else if (cd.mealContext === 'pranzo' && lunchClosedDays.includes(dayOfWeek)) {
        console.log(`🔒 [SERVER] Pranzo chiuso rilevato server-side: ${cd.date}`);
        this._injectClosedDayMessage(cd.date, dayOfWeek, 'lunch');
      } else if (cd.mealContext === 'cena' && dinnerClosedDays.includes(dayOfWeek)) {
        console.log(`🔒 [SERVER] Cena chiusa rilevata server-side: ${cd.date}`);
        this._injectClosedDayMessage(cd.date, dayOfWeek, 'dinner');
      } else {
        // Giorno aperto: trigger normale per check_availability
        const timeForCheck = cd.time || '20:00';
        const peopleForCheck = cd.people || 2;
        this._injectCheckAvailabilityHint(cd.date, timeForCheck, peopleForCheck);
      }
    } else if (cd.date && cd.date !== prevDate && isModifyContext) {
      console.log(`⏭️ [SERVER] Auto-trigger saltato: contesto modifica (foundReservation presente)`);
    }
  }

  // Comunica chiusura direttamente a GPT senza tool call
  _injectClosedDayMessage(date, dayOfWeek, type) {
    const giorni = ['domenica','lunedì','martedì','mercoledì','giovedì','venerdì','sabato'];
    const nomeGiorno = giorni[dayOfWeek] || 'quel giorno';
    let istruzioni;
    if (type === 'lunch') {
      istruzioni = `Non facciamo pranzo il ${nomeGiorno}. Di' subito al cliente: "Mi dispiace, il ${nomeGiorno} siamo chiusi a pranzo. Posso aiutarla a prenotare per la cena o per un altro giorno?"`;
    } else if (type === 'dinner') {
      istruzioni = `Non facciamo cena il ${nomeGiorno}. Di' subito al cliente: "Mi dispiace, il ${nomeGiorno} siamo chiusi a cena. Posso aiutarla a prenotare per il pranzo o per un altro giorno?"`;
    } else {
      istruzioni = `Il ristorante è chiuso il ${nomeGiorno}. Di' subito al cliente: "Mi dispiace, siamo chiusi il ${nomeGiorno}. Vuole prenotare per un altro giorno?"`;
    }
    try {
      this.send({ type: 'response.cancel' });
      setTimeout(() => {
        try {
          this.send({
            type: 'response.create',
            response: { instructions: istruzioni }
          });
        } catch(e) {
          console.error('❌ Errore inject closed day:', e);
        }
      }, 200);
    } catch(e) {
      console.error('❌ Errore cancel per closed day:', e);
    }
  }

  // Inietta un messaggio sistema che spinge GPT a chiamare check_availability subito
  _injectCheckAvailabilityHint(date, time, people) {
    const isPlaceholder = !this.sessionState.collectedData?.time;
    try {
      this.send({ type: 'response.cancel' });
      setTimeout(() => {
        try {
          this.send({
            type: 'conversation.item.create',
            item: {
              type: 'message',
              role: 'user',
              content: [{
                type: 'input_text',
                text: `[verifica disponibilità per ${date}]`
              }]
            }
          });
          const instructions = isPlaceholder
            ? `Chiama check_availability con date="${date}", time="${time}", people=${people}. IMPORTANTE: l'orario ${time} è solo un placeholder per verificare se il giorno è aperto — NON proporlo al cliente. Dopo il check, chiedi l'orario esplicito al cliente.`
            : `Chiama check_availability con date="${date}", time="${time}", people=${people}.`;
          this.send({
            type: 'response.create',
            response: { instructions }
          });
        } catch(e) {
          console.error('❌ Errore auto-trigger (delayed):', e);
        }
      }, 200);
    } catch(e) {
      console.error('❌ Errore auto-trigger:', e);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Echo detection (invariata)
  // ─────────────────────────────────────────────────────────────────────────

  extractWords(text) {
    if (!text) return [];
    return text.toLowerCase().replace(/[.,!?;:'"()]/g, '').split(/\s+/).filter(w => w.length > 1);
  }

  isEchoOfAi(userText) {
    if (!userText) return true;
    const trimmed = userText.trim();
    if (trimmed.length <= 20) { console.log(`🔊 Frase corta = INPUT REALE: "${trimmed}"`); return false; }
    const userWords = this.extractWords(trimmed);
    if (userWords.length <= 3) { console.log(`🔊 Poche parole = INPUT REALE: "${trimmed}"`); return false; }
    if (this.speechStartedDuringAi) this.speechStartedDuringAi = false;
    const timeSinceAiFinished = Date.now() - this.lastAiFinishedTime;
    if (timeSinceAiFinished > this.ECHO_WINDOW_MS) { console.log(`🔊 Fuori finestra echo (${timeSinceAiFinished}ms) = INPUT REALE`); return false; }
    for (const aiPhrase of this.recentAiPhrases) {
      const aiWords = this.extractWords(aiPhrase);
      if (aiWords.length === 0) continue;
      let matchCount = 0;
      for (const word of userWords) { if (aiWords.includes(word)) matchCount++; }
      const matchRatio = matchCount / userWords.length;
      if (matchRatio > 0.75 && matchCount >= 6) { console.log(`🔇 ECHO RILEVATO! Match: ${matchCount}/${userWords.length} (${(matchRatio * 100).toFixed(0)}%)`); return true; }
    }
    const greetingKeywords = ['buongiorno','buonasera','benvenuto','benvenuta','osteria','ristorante','trattoria','posso aiutarti','posso aiutarla','come posso','prenotare','prenotazione','tavolo'];
    let greetingMatches = 0;
    const textLower = trimmed.toLowerCase();
    for (const kw of greetingKeywords) { if (textLower.includes(kw)) greetingMatches++; }
    if (greetingMatches >= 4 && timeSinceAiFinished < 1500) { console.log(`🔇 ECHO (greeting): ${greetingMatches} keyword match`); return true; }
    console.log(`🔊 INPUT REALE: "${trimmed.substring(0, 50)}..."`);
    return false;
  }

  saveAiPhrase(transcript) {
    if (!transcript || transcript.trim().length < 5) return;
    this.recentAiTranscripts.unshift(transcript);
    if (this.recentAiTranscripts.length > this.MAX_AI_HISTORY) this.recentAiTranscripts.pop();
    this.recentAiPhrases.unshift(transcript);
    const words = transcript.split(/\s+/);
    if (words.length > 5) {
      this.recentAiPhrases.unshift(words.slice(0, Math.ceil(words.length / 2)).join(' '));
      this.recentAiPhrases.unshift(words.slice(Math.floor(words.length / 2)).join(' '));
    }
    while (this.recentAiPhrases.length > this.MAX_AI_HISTORY * 2) this.recentAiPhrases.pop();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MESSAGE HANDLER
  // ─────────────────────────────────────────────────────────────────────────

  handleMessage(message) {
    switch (message.type) {
      case 'session.created':
        this.sessionId = message.session.id;
        console.log(`📋 Sessione OpenAI: ${this.sessionId}`);
        break;

      case 'session.updated':
        console.log('✅ Sessione configurata');
        break;

      case 'response.audio.delta':
        this.isAiCurrentlySpeaking = true;
        if (message.delta) this.onAudioDelta(message.delta);
        break;

      case 'response.audio_transcript.done':
        if (message.transcript) {
          this.saveAiPhrase(message.transcript);
          console.log(`💬 [assistant]: ${message.transcript}`);
          this.onTranscript(message.transcript, 'assistant');
        }
        break;

      case 'response.done':
        this.isAiCurrentlySpeaking = false;
        this.lastAiFinishedTime = Date.now();
        if (message.response?.status === 'failed') {
          console.error('❌ Risposta fallita:', message.response.status_details);
        }
        break;

      case 'input_audio_buffer.speech_started':
        console.log('🎤 Utente sta parlando...');
        if (this.isAiCurrentlySpeaking) {
          console.log('⚡ BARGE-IN rilevato!');
          this.speechStartedDuringAi = true;
        }
        break;

      case 'input_audio_buffer.speech_stopped':
        console.log('🎤 Utente ha finito di parlare');
        break;

      case 'conversation.item.input_audio_transcription.completed':
        if (message.transcript) {
          const transcript = message.transcript.trim();
          if (this.isEchoOfAi(transcript)) {
            console.log(`🔇 Trascrizione IGNORATA (echo)`);
            return;
          }
          console.log(`💬 [user]: ${transcript}`);
          this.onTranscript(transcript, 'user');

          // 🆕 v3.0.0: parsing deterministico
          this._parseAndStore(transcript);
        }
        break;

      case 'response.function_call_arguments.done':
        this.handleToolCall(message);
        break;

      case 'error':
        console.error('❌ Errore OpenAI:', message.error);
        this.onError(message.error);
        break;

      default:
        if (process.env.DEBUG_REALTIME) console.log(`📨 ${message.type}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TOOL CALL HANDLER v3.0.0
  // ─────────────────────────────────────────────────────────────────────────

  async handleToolCall(message) {
    const { call_id, name, arguments: argsString } = message;
    console.log(`🔧 Tool call: ${name}`);
    console.log(`📊 collectedData:`, JSON.stringify(this.sessionState.collectedData));

    // 🛡️ Fix barge-in: se il JSON è troncato (utente ha interrotto), ignora silenziosamente
    let args;
    try {
      args = JSON.parse(argsString);
    } catch (e) {
      console.warn(`⚠️ Tool call ${name} ignorato: JSON malformato (barge-in durante tool call). argsString="${argsString?.substring(0,50)}"`);
      // Non mandare nulla a OpenAI — la risposta è già stata interrotta dal barge-in
      return;
    }
    try {
      const tool = this.tools.find(t => t.name === name);
      if (!tool) throw new Error(`Tool non trovato: ${name}`);

      const result = await tool.handler(args, {
        callSid: this.callSid,
        restaurantConfig: this.restaurantConfig,
        sessionState: this.sessionState,
        callerPhone: this.callerPhone
      });

      console.log(`✅ Tool result [${name}]:`, JSON.stringify(result).substring(0, 200));

      this.send({
        type: 'conversation.item.create',
        item: { type: 'function_call_output', call_id, output: JSON.stringify(result) }
      });
      this.send({ type: 'response.create' });

    } catch (error) {
      console.error(`❌ Tool error (${name}):`, error);
      this.send({
        type: 'conversation.item.create',
        item: { type: 'function_call_output', call_id, output: JSON.stringify({ error: error.message }) }
      });
      this.send({ type: 'response.create' });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // AUDIO
  // ─────────────────────────────────────────────────────────────────────────

  sendAudio(audioBase64) {
    if (!this.isConnected) return;
    if (!this.audioSendCount) this.audioSendCount = 0;
    this.audioSendCount++;
    if (this.audioSendCount <= 3) console.log(`📤 Invio audio #${this.audioSendCount} a OpenAI`);
    this.send({ type: 'input_audio_buffer.append', audio: audioBase64 });
  }

  send(message) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  disconnect() {
    if (this.ws) { this.ws.close(); this.ws = null; }
    this.isConnected = false;
  }
}

export default OpenAIRealtimeClient;
