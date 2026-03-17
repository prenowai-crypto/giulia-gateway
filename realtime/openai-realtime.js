// ═══════════════════════════════════════════════════════════════════════════════
// PRENOW - OPENAI REALTIME CLIENT v5.0.0
//
// Riscrittura completa basata su index_3_9_31.txt (sistema testato e funzionante)
// adattata per WebSocket Realtime API (no webhook, no TwiML).
//
// ARCHITETTURA:
//   - SessionState: equivalente del vecchio StateManager (per singola chiamata)
//   - Parsing deterministico: tutti i parser del vecchio sistema adattati per Whisper
//   - IntentDetector: portato integralmente da v3.9.31
//   - ValidationPipeline: logica portata in _parseAndStore + tool guards
//   - Fasi conversazionali: collecting → awaiting_confirm → completed
//                           finding → awaiting_modify/cancel_confirm → completed
//   - Echo detection: invariata
// ═══════════════════════════════════════════════════════════════════════════════

import WebSocket from 'ws';

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITY
// ═══════════════════════════════════════════════════════════════════════════════

function normalizeText(str) {
  return (str || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function getNowRome() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Rome' }));
}

function addDays(date, days) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

function toISO(date) {
  if (!date || isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatDateForSpeech(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr + 'T12:00:00');
    const days = ['domenica','lunedì','martedì','mercoledì','giovedì','venerdì','sabato'];
    const months = ['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'];
    return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
  } catch { return dateStr; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// INTENT DETECTOR — portato integralmente da v3.9.31
// ═══════════════════════════════════════════════════════════════════════════════

const CANCEL_KEYWORDS = [
  'cancellare','cancella','cancello','cancellazione',
  'cancellarla','cancellarlo','cancellarli','cancellarle',
  'disdire','disdetta','disdico','disdirla','disdirlo','disdirli','disdirle',
  'annullare','annulla','annullo','annullamento',
  'annullarla','annullarlo','annullarli','annullarle',
  'eliminare','elimina','elimino','eliminarla','eliminarlo',
  'non vengo','non veniamo','non riesco','non riusciamo',
  'cancel','cancellation','delete','remove',
  'i need to cancel','i want to cancel','cancel my reservation',
];

const MODIFY_KEYWORDS = [
  'modificare','modifica','modifico','modifiche',
  'spostare','sposta','sposto',
  'cambiare','cambia','cambio',
  'anticipare','posticipare','aumentat','aggiunger',
  'change','modify','move','reschedule','update',
  'i need to change','i want to change','i need to modify','change my reservation',
];

const EXISTING_RES_KEYWORDS = [
  'ho prenotato','avevo prenotato','ho una prenotazione',
  'la mia prenotazione','la prenotazione',
  'i have a reservation','my reservation','i booked',
];

const CREATE_OVERRIDE = [
  /\b(altra|nuova|seconda)\s+prenotazione/i,
  /\b(un'?\s*altra|una\s+nuova)\s+prenotazione/i,
  /\b(another|new|second)\s+(reservation|booking)/i,
];

function detectIntent(text) {
  if (!text) return 'create';
  // Pre-processing: rimuove "a nome X" per proteggere cognomi
  let t = text.toLowerCase()
    .replace(/\ba\s+nome\s+\w+/gi, ' ')
    .replace(/\bnome\s+\w+/gi, ' ')
    .replace(/\s+/g, ' ').trim();
  const tOrig = text.toLowerCase();

  // CREATE override prima di tutto
  for (const p of CREATE_OVERRIDE) {
    if (p.test(tOrig)) return 'create';
  }
  // CANCEL con word boundary
  for (const kw of CANCEL_KEYWORDS) {
    const match = kw.includes(' ') ? t.includes(kw) : new RegExp(`\\b${kw}\\b`, 'i').test(t);
    if (match) return 'cancel';
  }
  // MODIFY
  for (const kw of MODIFY_KEYWORDS) {
    if (t.includes(kw)) return 'modify';
  }
  // EXISTING → modify
  for (const kw of EXISTING_RES_KEYWORDS) {
    if (tOrig.includes(kw)) return 'modify';
  }
  return 'create';
}

// ═══════════════════════════════════════════════════════════════════════════════
// DATE PARSER — portato da DateManager v3.9.31, adattato per Whisper (lowercase)
// ═══════════════════════════════════════════════════════════════════════════════

function parseDate(text) {
  if (!text) return null;
  const t = normalizeText(text);
  const today = startOfDay(getNowRome());

  return _parseExplicitDate(t, today)
    || _parseRelativeDate(t, today)
    || _parseWeekdayWithNumber(t, today)
    || _parseWeekdayDate(t, today)
    || null;
}

function _parseExplicitDate(text, today) {
  const monthsMap = {
    'gennaio':0,'febbraio':1,'marzo':2,'aprile':3,'maggio':4,'giugno':5,
    'luglio':6,'agosto':7,'settembre':8,'ottobre':9,'novembre':10,'dicembre':11,
    'january':0,'february':1,'march':2,'april':3,'may':4,'june':5,
    'july':6,'august':7,'september':8,'october':9,'november':10,'december':11,
  };
  // DD/MM
  const slash = text.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  if (slash) {
    const day = parseInt(slash[1]), month = parseInt(slash[2]) - 1;
    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      let y = today.getFullYear();
      let c = new Date(y, month, day);
      if (c < today) c = new Date(++y, month, day);
      return toISO(c);
    }
  }
  // "10 marzo" / "10 di marzo"
  const allM = Object.keys(monthsMap).join('|');
  const rx = new RegExp(`(\\d{1,2})\\s*(?:di\\s+)?(${allM})`, 'i');
  const m = text.match(rx);
  if (m) {
    const day = parseInt(m[1]), month = monthsMap[m[2].toLowerCase()];
    if (month !== undefined && day >= 1 && day <= 31) {
      let y = today.getFullYear();
      let c = new Date(y, month, day);
      if (c < today) c = new Date(++y, month, day);
      return toISO(c);
    }
  }
  return null;
}

function _parseRelativeDate(text, today) {
  if (/dopodomani|dopo\s*domani/.test(text)) return toISO(addDays(today, 2));
  if (/\bdomani\b|\btomorrow\b/.test(text)) return toISO(addDays(today, 1));
  if (/\boggi\b|\btoday\b|\bstasera\b|\bquesta\s*sera\b/.test(text)) return toISO(today);
  const tra = text.match(/(?:tra|fra|in)\s*(\d+)\s*giorni/);
  if (tra) return toISO(addDays(today, parseInt(tra[1])));
  return null;
}

function _parseWeekdayWithNumber(text, today) {
  const wds = [
    {p:['domenica','sunday'],i:0},{p:['lunedi','monday'],i:1},
    {p:['martedi','tuesday'],i:2},{p:['mercoledi','wednesday'],i:3},
    {p:['giovedi','thursday'],i:4},{p:['venerdi','friday'],i:5},
    {p:['sabato','saturday'],i:6},
  ];
  for (const wd of wds) {
    for (const p of wd.p) {
      const m = text.match(new RegExp(`\\b${p}\\s+(\\d{1,2})\\b`, 'i'));
      if (m) {
        const dayNum = parseInt(m[1]);
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
  const wds = [
    {p:['domenica','sunday'],i:0},{p:['lunedi','monday'],i:1},
    {p:['martedi','tuesday'],i:2},{p:['mercoledi','wednesday'],i:3},
    {p:['giovedi','thursday'],i:4},{p:['venerdi','friday'],i:5},
    {p:['sabato','saturday'],i:6},
  ];
  let lastIndex = -1, lastPos = -1;
  for (const wd of wds) {
    for (const p of wd.p) {
      const pos = text.lastIndexOf(p);
      if (pos !== -1 && pos > lastPos) { lastPos = pos; lastIndex = wd.i; }
    }
  }
  if (lastIndex === -1) return null;
  const hasNext = /\b(prossim[ao]|next)\b/i.test(text);
  const diff = ((lastIndex - today.getDay()) + 7) % 7;
  const d = addDays(today, diff === 0 ? 7 : diff);
  return toISO(hasNext && diff === 0 ? addDays(d, 7) : d);
}

// ═══════════════════════════════════════════════════════════════════════════════
// TIME PARSER — portato da TimeManager v3.9.31, adattato per Whisper
// ═══════════════════════════════════════════════════════════════════════════════

function parseTime(text) {
  if (!text) return null;
  const t = text.toLowerCase().trim();

  if (/mezzogiorno|noon/.test(t)) return '12:00';
  if (/mezzanotte|midnight/.test(t)) return '00:00';

  // Tempo relativo
  const rel = _parseRelativeTime(t);
  if (rel) return rel;

  const allTimes = [];
  let m;

  // Numeri in lettere: "alle venti e trenta"
  const HW = {'uno':1,'due':2,'tre':3,'quattro':4,'cinque':5,'sei':6,'sette':7,'otto':8,
    'nove':9,'dieci':10,'undici':11,'dodici':12,'tredici':13,'quattordici':14,
    'quindici':15,'sedici':16,'diciassette':17,'diciotto':18,'diciannove':19,
    'venti':20,'ventuno':21,'ventidue':22,'ventitre':23,'ventitré':23};
  const MW = {'mezza':30,'mezzo':30,'half':30,'trenta':30,'thirty':30,
    'quindici':15,'quarter':15,'un quarto':15,'quaranta':40,'quarantacinque':45,
    'venti':20,'twenty':20,'dieci':10,'ten':10,'cinque':5,'five':5};
  const reW = new RegExp(`(?:alle|ore|per le|at)\\s+(${Object.keys(HW).join('|')})(?:\\s+e\\s+(${Object.keys(MW).join('|')}))?`, 'gi');
  while ((m = reW.exec(t)) !== null) {
    let h = HW[m[1].toLowerCase()]; if (h === undefined) continue;
    const min = m[2] ? (MW[m[2].toLowerCase()] || 0) : 0;
    if (h >= 1 && h <= 11 && !/mattina|pranzo|morning|lunch/.test(t)) h += 12;
    if (h >= 0 && h <= 23) allTimes.push({ pos: m.index, time: `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}` });
  }

  // "alle 21:30", "alle 21.30", varianti Whisper "l'E21"
  const re1 = /(?:alle|ore|per le|l['\s]e?|at)\s*(\d{1,2})[\.:](\d{2})/gi;
  while ((m = re1.exec(t)) !== null) {
    let h = parseInt(m[1]), min = parseInt(m[2]);
    if (h >= 1 && h <= 11 && !/mattina|pranzo|morning|lunch/.test(t)) h += 12;
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) allTimes.push({ pos: m.index, time: `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}` });
  }

  // "alle 20 e 30" — cifre e parola minuti
  const MWK = {'mezza':30,'mezzo':30,'trenta':30,'quindici':15,'quaranta':40,'quarantacinque':45,'venti':20,'dieci':10,'cinque':5};
  const reEW = new RegExp(`(?:alle|ore|per le|at)\\s*(\\d{1,2})\\s+e\\s+(${Object.keys(MWK).join('|')})\\b`, 'gi');
  while ((m = reEW.exec(t)) !== null) {
    let h = parseInt(m[1]); const min = MWK[m[2].toLowerCase()] || 0;
    if (h >= 1 && h <= 11 && !/mattina|pranzo|morning|lunch/.test(t)) h += 12;
    if (h >= 0 && h <= 23) allTimes.push({ pos: m.index, time: `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}` });
  }

  // "alle 20 e 30" — cifre e cifre minuti
  const reEN = /(?:alle|ore|per le|at)\s*(\d{1,2})\s+e\s+(\d{2})\b/gi;
  while ((m = reEN.exec(t)) !== null) {
    let h = parseInt(m[1]), min = parseInt(m[2]);
    if (h >= 1 && h <= 11 && !/mattina|pranzo|morning|lunch/.test(t)) h += 12;
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) allTimes.push({ pos: m.index, time: `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}` });
  }

  // "alle 21" senza minuti, "l'21", "le 21"
  const re2 = /(?:alle|ore|per le|l['\s]e?|at)\s*(\d{1,2})\b/gi;
  while ((m = re2.exec(t)) !== null) {
    let h = parseInt(m[1]);
    if (h >= 1 && h <= 11 && !/mattina|pranzo|morning|lunch/.test(t)) h += 12;
    if (h >= 0 && h <= 23) allTimes.push({ pos: m.index, time: `${String(h).padStart(2,'0')}:00` });
  }

  // Standalone "21:30" o "21.30"
  const re3 = /\b(\d{1,2})[\.:](\d{2})\b/g;
  while ((m = re3.exec(t)) !== null) {
    let h = parseInt(m[1]), min = parseInt(m[2]);
    if (h >= 1 && h <= 11 && !/mattina|pranzo|morning|lunch/.test(t)) h += 12;
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) allTimes.push({ pos: m.index, time: `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}` });
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
  allTimes.sort((a, b) => a.pos - b.pos);
  const last = allTimes[allTimes.length - 1];
  if (allTimes.length > 1) console.log(`⏰ parseTime: trovati ${allTimes.length} orari, uso ULTIMO: "${last.time}"`);
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
      let offset = p.extract ? (p.hours ? parseInt(match[1]||match[2]||match[3])*60 : parseInt(match[1]||match[2]||match[3])) : p.mins;
      const target = new Date(now.getTime() + offset * 60000);
      const rounded = Math.ceil(target.getMinutes() / 15) * 15;
      target.setMinutes(rounded % 60);
      if (rounded >= 60) target.setHours(target.getHours() + 1);
      target.setSeconds(0);
      return `${String(target.getHours()).padStart(2,'0')}:${String(target.getMinutes()).padStart(2,'0')}`;
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PEOPLE PARSER — portato da PeopleManager v3.9.31
// ═══════════════════════════════════════════════════════════════════════════════

function parsePeople(text) {
  if (!text) return null;
  const t = text.toLowerCase().trim();
  // Correzione "anzi/aspetta" → usa ULTIMO numero
  if (/anzi|no aspetta|aspetta|facciamo|meglio|diciamo|actually|no wait/i.test(t)) {
    const nums = t.match(/\b(\d+)\b/g);
    if (nums && nums.length >= 2) {
      const last = parseInt(nums[nums.length - 1]);
      if (last > 0 && last < 100) return last;
    }
  }
  // Falsi positivi
  if (/ci sei|ci siete|mi senti/i.test(t)) return null;

  const patterns = [
    /(\d+)\s*in\s*totale/i,
    /siamo\s*(?:in\s*)?(\d+)/i,
    /(?:per|saremo|in)\s*(\d+)\s*(?:person[ae]|pax|coperti|guests|people)?/i,
    /(\d+)\s*(?:person[ae]|pax|coperti|guests|people)/i,
    /(?:tavolo|table)\s*(?:per|for)\s*(\d+)/i,
    /(\d+)\s*invece\s*di\s*\d+/i,
    /adesso\s*(?:siamo\s*)?(?:in\s*)?(\d+)/i,
    /diventat[io]\s*(\d+)/i,
  ];
  for (const p of patterns) {
    const m = t.match(p);
    if (m) { const n = parseInt(m[1]); if (n > 0 && n < 100) return n; }
  }
  // Numeri in lettere
  const words = {'due':2,'tre':3,'quattro':4,'cinque':5,'sei':6,'sette':7,'otto':8,'nove':9,'dieci':10};
  for (const [w, n] of Object.entries(words)) { if (t.includes(w)) return n; }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// NAME PARSER — portato da NameManager v3.9.21 + RecapManager.extractName v3.9.22
// Adattato per Whisper (testo già lowercase, no capitalizzazione)
// ═══════════════════════════════════════════════════════════════════════════════

const NAME_EXCLUDE = new Set([
  'si','no','ok','sì','yes','grazie','prego','esatto','confermo','giusto','certo',
  'quello','quella','bene','perfetto','ciao','buongiorno','buonasera','buonanotte',
  'io','me','noi','lui','lei','uno','una','un','mille','tanto','molto',
  'pronto','salve','allora','ecco','dunque','quindi','però','anche','magari','cioè',
  'senza','mail','email','nessuno','nessuna','grazie mille',
  'sempre','ancora','proprio','stesso','solito',
  'nome','mio','mia','suo','sua','il','la','lo','per','alle','dei','delle',
  // Verbi comuni — MAI nomi
  'vorrei','voglio','volevo','potrei','potevo','dovrei','dovevo',
  'prenotare','prenoto','cancellare','cancello','modificare','modifico',
  'chiamare','chiamo','parlare','parlo','sentire','sento','capire',
  'aiutare','aiuto','confermare','verificare',
  // Placeholder — MAI nomi reali
  "l'utente",'utente','cliente','client','unknown','sconosciuto',
  'prenotazione','reservation','tavolo','table',
  // Parole tecniche/web che Whisper trascrive a volte
  'org','com','net','www','http','html','amara',
]);

const VERB_START = /^(vorrei|voglio|volevo|potrei|potevo|dovrei|ho|ha|hai|abbiamo|avevo|avrei|sono|sei|siamo|stavo|sto|cerco|chiamo|posso|possiamo|vorremmo)\b/i;

function parseName(text) {
  if (!text) return null;
  const t = text.trim();
  // Frasi verbali → mai nomi
  if (VERB_START.test(t)) return null;

  const STOP = /\s+(?:alle|per|il|la|lo|gli|i|le|di|da|in|con|su|tra|fra|e|ed|o|a|un|una|uno|senza|email|mail)\b/i;

  const patterns = [
    /\ba\s+nome\s+(?:di\s+)?([A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]+(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]+)?)/i,
    /\bil\s+(?:mio\s+)?nome\s+[èe]\s+([A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]+(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]+)?)/i,
    /\bmi\s+chiamo\s+([A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]+(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]+)?)/i,
    /\bsono\s+([A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]+(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]+)?)\b/i,
    /\bname\s+is\s+([A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]+)\b/i,
    /\bi'?m\s+([A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]+)\b/i,
    /\bunder\s+(?:the\s+)?name\s+([A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]+)\b/i,
    /\bnome\s+([A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]+(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]+)?)/i,
    /[,\.]\s*([A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]{1,}(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]+)?)\s*$/i,
  ];

  for (const p of patterns) {
    const m = t.match(p);
    if (m && m[1]) {
      let name = m[1].trim();
      const stop = name.match(STOP);
      if (stop) name = name.substring(0, stop.index).trim();
      if (name.length >= 2 && !NAME_EXCLUDE.has(name.toLowerCase())) return name;
    }
  }

  // Risposta secca: 1 parola sola, min 3 caratteri
  const stripped = t.replace(/[.,!?]+$/, '').trim();
  if (!stripped.includes(' ') && /^[A-Za-zÀ-ÖØ-öø-ÿ]{3,}$/.test(stripped) && !NAME_EXCLUDE.has(stripped.toLowerCase())) {
    return stripped;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIRM / DENY / CANCEL HELPERS — da RecapManager v3.9.25
// ═══════════════════════════════════════════════════════════════════════════════

function isConfirming(text) {
  const t = normalizeText(text || '');
  if (/^(si\b|sii\b|yes\b|esatto|corretto|giusto|confermo|certo|ok\b|va bene|proprio|quella|perfetto)/.test(t)) return true;
  if (/\b(conferm|esatt|corrett|giust|perfett)\w*\b/.test(t)) return true;
  return false;
}

function isDenying(text) {
  const t = normalizeText(text || '');
  if (/^(no[^n]|non |sbagliato|errato|altra|diversa)/.test(t)) return true;
  if (/\b(teniamo|mantieni|manteniamo|lascia\s+stare|lascia\s+perdere|non\s+cancell)\b/i.test(t)) return true;
  if (/\b(keep it|don't cancel|never\s*mind)\b/i.test(t)) return true;
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

function parseEmail(text) {
  if (!text) return null;
  const m = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0] : null;
}

function parseMealContext(text) {
  if (!text) return null;
  const t = text.toLowerCase();
  if (/\bpranzo\b|\blunch\b|\bmeriggio\b|\bmezzogiorno\b/.test(t)) return 'pranzo';
  if (/\bcena\b|\bdinner\b|\bstasera\b|\bsera\b/.test(t)) return 'cena';
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STATE MANAGER — equivalente del vecchio StateManager ma per singola sessione
// ═══════════════════════════════════════════════════════════════════════════════

const PHASES = {
  INITIAL:                 'initial',
  COLLECTING:              'collecting',
  AWAITING_CONFIRM:        'awaiting_confirm',
  FINDING:                 'finding',
  AWAITING_MODIFY_DETAILS: 'awaiting_modify_details',
  AWAITING_MODIFY_CONFIRM: 'awaiting_modify_confirm',
  AWAITING_CANCEL_CONFIRM: 'awaiting_cancel_confirm',
  COMPLETED:               'completed',
};

// Tool permesse per fase
const ALLOWED_TOOLS = {
  initial:                  ['check_availability', 'find_reservation'],
  collecting:               ['check_availability', 'prepare_reservation'],
  awaiting_confirm:         ['create_reservation', 'prepare_reservation'],
  finding:                  ['find_reservation'],
  awaiting_modify_details:  ['check_availability', 'prepare_reservation', 'find_reservation'],
  awaiting_modify_confirm:  ['modify_reservation', 'prepare_reservation'],
  awaiting_cancel_confirm:  ['cancel_reservation'],
  completed:                [],
};

function isToolAllowed(name, phase) {
  return (ALLOWED_TOOLS[phase] || []).includes(name);
}

function initialPhaseForIntent(intent) {
  return (intent === 'modify' || intent === 'cancel') ? PHASES.FINDING : PHASES.COLLECTING;
}

function advancePhase(phase, toolName, result, intent) {
  if (toolName === 'check_availability') return phase;
  switch (phase) {
    case 'initial':
    case 'collecting':
      if (toolName === 'prepare_reservation' && result.ready) return PHASES.AWAITING_CONFIRM;
      return phase;
    case 'awaiting_confirm':
      if (toolName === 'create_reservation' && result.success) return PHASES.COMPLETED;
      if (toolName === 'prepare_reservation') return PHASES.AWAITING_CONFIRM;
      return phase;
    case 'finding':
      if (toolName === 'find_reservation') {
        if (result.found === true) return intent === 'cancel' ? PHASES.AWAITING_CANCEL_CONFIRM : PHASES.AWAITING_MODIFY_DETAILS;
        return PHASES.INITIAL;
      }
      return phase;
    case 'awaiting_modify_details':
      if (toolName === 'prepare_reservation' && result.ready) return PHASES.AWAITING_MODIFY_CONFIRM;
      return phase;
    case 'awaiting_modify_confirm':
      if (toolName === 'modify_reservation' && result.success) return PHASES.COMPLETED;
      if (toolName === 'prepare_reservation') return PHASES.AWAITING_MODIFY_CONFIRM;
      return phase;
    case 'awaiting_cancel_confirm':
      if (toolName === 'cancel_reservation' && result.success) return PHASES.COMPLETED;
      return phase;
    default: return phase;
  }
}

function buildPhaseInstructions(phase, sessionState) {
  const cd = sessionState.collectedData;
  const found = sessionState.foundReservation;
  switch (phase) {
    case 'initial':
      return 'Nessuna prenotazione trovata. Informa il cliente e chiedi se vuole fare una nuova prenotazione.';
    case 'collecting': {
      const missing = [];
      if (!cd.date) missing.push('la data');
      if (!cd.time) missing.push("l'orario");
      if (!cd.people) missing.push('il numero di persone');
      if (!cd.name) missing.push('il nome');
      if (missing.length === 0) return 'Tutti i dati sono pronti. Chiama prepare_reservation.';
      return `Dati mancanti: ${missing.join(', ')}. Chiedi solo il prossimo dato mancante, uno alla volta.`;
    }
    case 'awaiting_confirm':
      return 'Hai letto il riepilogo. Aspetta conferma esplicita ("sì/confermo/va bene") → create_reservation. Se corregge → aggiorna e richiama prepare_reservation.';
    case 'finding':
      return 'Chiama find_reservation con il nome e la data della prenotazione.';
    case 'awaiting_modify_details':
      if (!found) return 'Chiama find_reservation prima.';
      return `Prenotazione trovata: ${found.people} persone il ${formatDateForSpeech(found.date)} alle ${(found.time||'').substring(0,5)} a nome ${found.name}. Chiedi cosa vuole modificare (orario, data, persone). Poi check_availability e prepare_reservation.`;
    case 'awaiting_modify_confirm':
      return 'Hai letto il riepilogo della modifica. Aspetta conferma → modify_reservation. Se vuole cambiare → raccogli nuovi dati.';
    case 'awaiting_cancel_confirm':
      if (!found) return 'Chiama find_reservation prima.';
      return `Prenotazione trovata: ${found.people} persone il ${formatDateForSpeech(found.date)} alle ${(found.time||'').substring(0,5)} a nome ${found.name}. Chiedi conferma ESPLICITA: "Confermi di volerla cancellare?". Se sì → cancel_reservation. Se no → NON cancellare.`;
    case 'completed':
      return 'Richiesta completata. Saluta il cliente educatamente.';
    default: return null;
  }
}

function blockedToolMessage(toolName, phase) {
  switch (toolName) {
    case 'create_reservation': return `Non puoi creare senza prepare_reservation e conferma cliente. Fase: ${phase}.`;
    case 'cancel_reservation': return phase === 'finding' ? 'Prima trova la prenotazione con find_reservation.' : 'Prima chiedi conferma esplicita al cliente.';
    case 'modify_reservation': return phase === 'finding' ? 'Prima trova la prenotazione con find_reservation.' : 'Prima chiedi conferma con prepare_reservation.';
    case 'find_reservation':   return 'Stai creando una nuova prenotazione, non cercare prenotazioni esistenti.';
    default: return `Tool "${toolName}" non permessa in fase "${phase}".`;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLASSE PRINCIPALE
// ═══════════════════════════════════════════════════════════════════════════════

export class OpenAIRealtimeClient {
  constructor(options) {
    this.apiKey          = options.apiKey;
    this.model           = options.model || 'gpt-4o-mini-realtime-preview';
    this.systemPrompt    = options.systemPrompt;
    this.tools           = options.tools || [];
    this.callSid         = options.callSid;
    this.restaurantConfig = options.restaurantConfig;
    this.callerPhone     = options.callerPhone || null;

    this.onAudioDelta  = options.onAudioDelta  || (() => {});
    this.onTranscript  = options.onTranscript  || (() => {});
    this.onError       = options.onError       || console.error;

    this.ws          = null;
    this.isConnected = false;
    this.sessionId   = null;

    // SESSION STATE — equivalente del vecchio StateManager per singola chiamata
    this.state = {
      // Dati raccolti deterministicamente (fonte di verità)
      collectedData: { date: null, time: null, people: null, name: null, email: null, mealContext: null },
      // Prenotazione in attesa di conferma (pendingReservation del vecchio)
      pendingReservation: null,
      pendingConfirmation: false,
      // Prenotazione trovata per modify/cancel (existingReservation del vecchio)
      foundReservation: null,
      // Intent e fase (equivalente initialIntent + conversationPhase del vecchio)
      initialIntent: null,
      phase: PHASES.INITIAL,
      // Flag cancellazione confermata
      cancelConfirmed: false,
    };

    // Echo detection
    this.recentAiPhrases   = [];
    this.MAX_AI_HISTORY    = 10;
    this.lastAiFinishedTime = 0;
    this.isAiCurrentlySpeaking = false;
    this.isResponseActive  = false;  // true tra response.create e response.done
    this.speechStartedDuringAi = false;
    this.ECHO_WINDOW_MS    = 2500;
    this.audioSendCount    = 0;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CONNESSIONE
  // ─────────────────────────────────────────────────────────────────────────

  async connect() {
    return new Promise((resolve, reject) => {
      const url = `wss://api.openai.com/v1/realtime?model=${this.model}`;
      this.ws = new WebSocket(url, {
        headers: { 'Authorization': `Bearer ${this.apiKey}`, 'OpenAI-Beta': 'realtime=v1' }
      });
      this.ws.on('open',    ()     => { console.log('🟢 Connesso a OpenAI Realtime API'); this.isConnected = true; this.initializeSession(); resolve(); });
      this.ws.on('message', (data) => { this.handleMessage(JSON.parse(data.toString())); });
      this.ws.on('error',   (err)  => { console.error('❌ WebSocket error:', err); this.onError(err); reject(err); });
      this.ws.on('close',   (code) => { console.log(`🔴 OpenAI disconnesso (${code})`); this.isConnected = false; });
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SESSIONE — inizializzazione con system prompt completo
  // ─────────────────────────────────────────────────────────────────────────

  initializeSession() {
    const prompt = this.systemPrompt + `

REGOLE OPERATIVE — LEGGI PRIMA DI TUTTO:

1. ANTI-INVENZIONE (CRITICO):
   NON inventare MAI nomi. Se manca il nome → chiedi "A che nome prenoto?".
   NON usare MAI "l'utente", "cliente", "nome", "unknown" o qualsiasi placeholder come nome.
   NON inventare orari. Se manca → chiedi "A che ora preferisce?".

2. "UN ATTIMO" OBBLIGATORIO:
   Prima di OGNI tool call dì sempre una frase breve: "Un attimo...", "Un momento...".

3. RECAP VERBATIM:
   Quando prepare_reservation restituisce "recap", leggilo PAROLA PER PAROLA. Non riformularlo.

4. ERRORI PREPARE:
   Se prepare_reservation restituisce ready=false → leggi SOLO il campo "message" e seguilo.
   NON fare recap da solo. NON chiamare create_reservation senza prepare.

5. CONFERMA OBBLIGATORIA (CRITICO):
   Quando il cliente dice "sì", "confermo", "va bene" dopo il recap:
   → Dì "Un attimo, registro la prenotazione..." → chiama create_reservation IMMEDIATAMENTE.
   → NON dire mai "prenotazione confermata", "perfetto", "ti aspettiamo" PRIMA che create_reservation risponda con success=true.
   → Se non chiami create_reservation, la prenotazione NON ESISTE nel sistema. Zero eccezioni.
   cancel_reservation → SOLO dopo find E conferma esplicita del cliente.
   modify_reservation → SOLO dopo find, check, prepare E conferma esplicita.

6. NOMI = NOMI:
   Se il cliente dice "a nome Cancelleri", "mi chiamo Sposta", "sono Annulli" →
   è sempre il suo nome, NON un comando. Non interpretare cognomi come azioni.

FASE CORRENTE: ${this.state.phase.toUpperCase()}`;

    this.send({
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
        instructions: prompt,
        voice: 'alloy',
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        input_audio_transcription: { model: 'whisper-1', language: 'it' },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.4,
          prefix_padding_ms: 300,
          silence_duration_ms: 1200
        },
        tools: this.tools.map(t => ({ type: 'function', name: t.name, description: t.description, parameters: t.parameters }))
      }
    });

    this.isAiCurrentlySpeaking = true;
    this.isResponseActive = true;
    this.send({
      type: 'conversation.item.create',
      item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '[Cliente in linea. Saluta brevemente e chiedi come puoi aiutarlo.]' }] }
    });
    this.send({ type: 'response.create' });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PARSING E STORE — equivalente ValidationPipeline del vecchio sistema
  // ─────────────────────────────────────────────────────────────────────────

  _parseAndStore(transcript) {
    const cd = this.state.collectedData;
    const locked = this.state.pendingConfirmation;
    const prevDate = cd.date;

    // 1. Rileva intent alla prima frase
    if (!this.state.initialIntent) {
      const intent = detectIntent(transcript);
      this.state.initialIntent = intent;
      this.state.phase = initialPhaseForIntent(intent);
      console.log(`🎯 [SERVER] initialIntent: "${intent}" → phase: "${this.state.phase}"`);
    }

    // 2. Parsing data (sempre)
    const date = parseDate(transcript);
    if (date && cd.date !== date) { console.log(`📅 [SERVER] date: "${cd.date}" → "${date}"`); cd.date = date; }

    // 3. Parsing orario (sempre)
    const time = parseTime(transcript);
    if (time && cd.time !== time) { console.log(`⏰ [SERVER] time: "${cd.time}" → "${time}"`); cd.time = time; }

    // 4. Parsing persone (sempre)
    const people = parsePeople(transcript);
    if (people && cd.people !== people) { console.log(`👥 [SERVER] people: ${cd.people} → ${people}`); cd.people = people; }

    // 5. Nome: lock protegge il nome già acquisito, MA lascia passare correzioni esplicite
    // Es: "io mi chiamo Simone", "il mio nome è X", "a nome X" — sempre accettate
    const EXPLICIT_NAME = /\b(mi\s+chiamo|il\s+(?:mio\s+)?nome\s+[èe]|sono\s+[A-Za-z]|a\s+nome|i'?m\s+|my\s+name\s+is)\s+/i;
    const isExplicitName = EXPLICIT_NAME.test(transcript);
    const nameLocked = locked && cd.name !== null && !isExplicitName;
    if (!nameLocked) {
      const name = parseName(transcript);
      if (name && cd.name !== name) {
        if (locked && cd.name !== null) console.log(`👤 [SERVER] name AGGIORNATO (correzione esplicita): "${cd.name}" → "${name}"`);
        else console.log(`👤 [SERVER] name: "${cd.name}" → "${name}"`);
        cd.name = name;
        // Aggiorna anche pendingReservation se esiste
        if (this.state.pendingReservation) this.state.pendingReservation.name = name;
      }
    } else {
      const name = parseName(transcript);
      if (name && cd.name !== name) console.log(`🔒 [SERVER] name LOCKED (già: "${cd.name}") — ignorato: "${name}"`);
    }

    // 6. Email
    if (!locked) {
      const email = parseEmail(transcript);
      if (email && cd.email !== email) { console.log(`📧 [SERVER] email: "${cd.email}" → "${email}"`); cd.email = email; }
    }

    // 7. Meal context
    if (!locked) {
      const mc = parseMealContext(transcript);
      if (mc && cd.mealContext !== mc) { cd.mealContext = mc; console.log(`🍽️ [SERVER] mealContext: → "${mc}"`); }
    }

    console.log(`📊 [SERVER] collectedData:`, JSON.stringify(cd));

    // 8. Auto-trigger chiusura/disponibilità quando arriva una nuova data
    const isModifyContext = !!this.state.foundReservation || this.state.initialIntent === 'modify' || this.state.initialIntent === 'cancel';
    if (cd.date && cd.date !== prevDate && !locked && !isModifyContext) {
      // Se risposta attiva → aspetta che finisca, poi inietta
      if (this.isResponseActive) {
        const dateToCheck = cd.date;
        const mealToCheck = cd.mealContext;
        const waitAndInject = (attempt = 0) => {
          if (!this.isResponseActive) {
            this._handleNewDate(dateToCheck, mealToCheck);
          } else if (attempt < 15) { // max 3 secondi
            setTimeout(() => waitAndInject(attempt + 1), 200);
          }
        };
        setTimeout(() => waitAndInject(), 200);
      } else {
        this._handleNewDate(cd.date, cd.mealContext);
      }
    }
  }

  _handleNewDate(date, mealContext) {
    const dayOfWeek   = new Date(date + 'T12:00:00').getDay();
    const closingDays = this.restaurantConfig?.weekly_closing_days || [];
    const lunchClosed = this.restaurantConfig?.lunch_closed_days   || [];
    const dinnerClosed = this.restaurantConfig?.dinner_closed_days || [];
    const giorni = ['domenica','lunedì','martedì','mercoledì','giovedì','venerdì','sabato'];

    console.log(`🚀 [SERVER] Auto-trigger: data=${date} dayOfWeek=${dayOfWeek}`);

    if (closingDays.includes(dayOfWeek)) {
      this._injectMessage(`Il ristorante è chiuso il ${giorni[dayOfWeek]}. Di' subito: "Mi dispiace, siamo chiusi il ${giorni[dayOfWeek]}. Vuole prenotare per un altro giorno?"`);
    } else if (mealContext === 'pranzo' && lunchClosed.includes(dayOfWeek)) {
      this._injectMessage(`Non facciamo pranzo il ${giorni[dayOfWeek]}. Di' subito: "Mi dispiace, il ${giorni[dayOfWeek]} siamo chiusi a pranzo. Posso aiutarla per la cena o un altro giorno?"`);
    } else if (mealContext === 'cena' && dinnerClosed.includes(dayOfWeek)) {
      this._injectMessage(`Non facciamo cena il ${giorni[dayOfWeek]}. Di' subito: "Mi dispiace, il ${giorni[dayOfWeek]} siamo chiusi a cena. Posso aiutarla per il pranzo o un altro giorno?"`);
    } else {
      // Giorno aperto: spingi check_availability
      const cd = this.state.collectedData;
      const time = cd.time || '20:00';
      const people = cd.people || 2;
      const isPlaceholder = !cd.time;
      this._injectCheckHint(date, time, people, isPlaceholder);
    }
  }

  _injectMessage(instructions) {
    if (this.isResponseActive) this.send({ type: 'response.cancel' });
    setTimeout(() => {
      try {
        this.isResponseActive = true;
        this.send({ type: 'response.create', response: { instructions } });
      } catch(e) { console.error('❌ Errore inject:', e); }
    }, this.isResponseActive ? 300 : 50);
  }

  _injectCheckHint(date, time, people, isPlaceholder) {
    if (this.isResponseActive) this.send({ type: 'response.cancel' });
    setTimeout(() => {
      try {
        this.send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: `[verifica disponibilità per ${date}]` }] } });
        const instructions = isPlaceholder
          ? `Chiama check_availability con date="${date}", time="${time}", people=${people}. IMPORTANTE: l'orario è solo un placeholder — dopo il check, chiedi l'orario esplicito al cliente.`
          : `Chiama check_availability con date="${date}", time="${time}", people=${people}.`;
        this.isResponseActive = true;
        this.send({ type: 'response.create', response: { instructions } });
      } catch(e) { console.error('❌ Errore inject check:', e); }
    }, 200);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ECHO DETECTION — invariata
  // ─────────────────────────────────────────────────────────────────────────

  _extractWords(text) {
    return (text || '').toLowerCase().replace(/[.,!?;:'"()]/g, '').split(/\s+/).filter(w => w.length > 1);
  }

  _isEcho(userText) {
    if (!userText) return true;
    const trimmed = userText.trim();
    if (trimmed.length <= 20) { console.log(`🔊 Frase corta = INPUT REALE: "${trimmed}"`); return false; }
    const userWords = this._extractWords(trimmed);
    if (userWords.length <= 3) { console.log(`🔊 Poche parole = INPUT REALE: "${trimmed}"`); return false; }
    const elapsed = Date.now() - this.lastAiFinishedTime;
    if (elapsed > this.ECHO_WINDOW_MS) { console.log(`🔊 Fuori finestra echo (${elapsed}ms) = INPUT REALE`); return false; }
    for (const phrase of this.recentAiPhrases) {
      const aiWords = this._extractWords(phrase);
      if (!aiWords.length) continue;
      const matches = userWords.filter(w => aiWords.includes(w)).length;
      if (matches / userWords.length > 0.75 && matches >= 6) { console.log(`🔇 ECHO RILEVATO!`); return true; }
    }
    console.log(`🔊 INPUT REALE: "${trimmed.substring(0,50)}..."`);
    return false;
  }

  _saveAiPhrase(transcript) {
    if (!transcript || transcript.trim().length < 5) return;
    this.recentAiPhrases.unshift(transcript);
    if (this.recentAiPhrases.length > this.MAX_AI_HISTORY * 2) this.recentAiPhrases.pop();
  }

  // Rileva audio di sottofondo non pertinente (TV, radio, sottotitoli, ecc.)
  _isBackgroundNoise(text) {
    if (!text) return true;
    const t = text.toLowerCase().trim();

    // Pattern tipici di sottofondo TV/sottotitoli
    const noisePatterns = [
      /sottotitoli/i,
      /amara\.org/i,
      /alla\s+prossima/i,
      /copyright/i,
      /tutti\s+i\s+diritti/i,
      /^(ciao|ok|eh|ah|uhm|mhm|hmm)\s*$/i,
      /subtitles?\s+by/i,
      /transcribed\s+by/i,
    ];
    for (const p of noisePatterns) {
      if (p.test(t)) return true;
    }

    // Troppo corto E non contiene nulla di utile
    if (t.length < 3) return true;

    return false;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MESSAGE HANDLER
  // ─────────────────────────────────────────────────────────────────────────

  handleMessage(msg) {
    switch (msg.type) {
      case 'session.created':
        this.sessionId = msg.session.id;
        console.log(`📋 Sessione OpenAI: ${this.sessionId}`);
        break;
      case 'session.updated':
        console.log('✅ Sessione configurata');
        break;
      case 'response.audio.delta':
        this.isAiCurrentlySpeaking = true;
        this.isResponseActive = true;
        if (msg.delta) this.onAudioDelta(msg.delta);
        break;
      case 'response.audio_transcript.done':
        if (msg.transcript) {
          this._saveAiPhrase(msg.transcript);
          console.log(`💬 [assistant]: ${msg.transcript}`);
          this.onTranscript(msg.transcript, 'assistant');
        }
        break;
      case 'response.done':
        this.isAiCurrentlySpeaking = false;
        this.isResponseActive = false;
        this.lastAiFinishedTime = Date.now();
        if (msg.response?.status === 'failed') console.error('❌ Risposta fallita:', msg.response.status_details);
        break;
      case 'input_audio_buffer.speech_started':
        console.log('🎤 Utente sta parlando...');
        if (this.isAiCurrentlySpeaking) { console.log('⚡ BARGE-IN rilevato!'); this.speechStartedDuringAi = true; }
        break;
      case 'input_audio_buffer.speech_stopped':
        console.log('🎤 Utente ha finito di parlare');
        break;
      case 'conversation.item.input_audio_transcription.completed':
        if (msg.transcript) {
          const t = msg.transcript.trim();
          if (this._isEcho(t)) { console.log(`🔇 Trascrizione IGNORATA (echo)`); return; }
          // Filtro rumore di fondo: testo non pertinente a una prenotazione
          if (this._isBackgroundNoise(t)) { console.log(`🔇 Trascrizione IGNORATA (rumore): "${t.substring(0,40)}"`); return; }
          console.log(`💬 [user]: ${t}`);
          this.onTranscript(t, 'user');
          this._parseAndStore(t);
        }
        break;
      case 'response.function_call_arguments.done':
        this.handleToolCall(msg);
        break;
      case 'error':
        console.error('❌ Errore OpenAI:', msg.error);
        this.onError(msg.error);
        break;
      default:
        if (process.env.DEBUG_REALTIME) console.log(`📨 ${msg.type}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TOOL CALL HANDLER — con StateManager integrato
  // ─────────────────────────────────────────────────────────────────────────

  async handleToolCall(msg) {
    const { call_id, name, arguments: argsStr } = msg;
    const phase = this.state.phase;
    console.log(`🔧 Tool call: ${name} [fase: ${phase}]`);
    console.log(`📊 collectedData:`, JSON.stringify(this.state.collectedData));

    // Fix barge-in: JSON malformato → ignora
    let args;
    try { args = JSON.parse(argsStr); }
    catch(e) { console.warn(`⚠️ Tool ${name} ignorato: JSON malformato (barge-in)`); return; }

    // Guard fase
    if (!isToolAllowed(name, phase)) {
      console.warn(`⛔ Tool "${name}" NON permessa in fase "${phase}"`);
      this.send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id, output: JSON.stringify({ blocked: true, message: blockedToolMessage(name, phase) }) } });
      this.send({ type: 'response.create' });
      return;
    }

    try {
      const tool = this.tools.find(t => t.name === name);
      if (!tool) throw new Error(`Tool non trovato: ${name}`);

      const result = await tool.handler(args, {
        callSid: this.callSid,
        restaurantConfig: this.restaurantConfig,
        sessionState: this.state,
        callerPhone: this.callerPhone
      });

      console.log(`✅ Tool result [${name}]:`, JSON.stringify(result).substring(0, 200));

      // Avanza fase
      const newPhase = advancePhase(phase, name, result, this.state.initialIntent);
      if (newPhase !== phase) { this.state.phase = newPhase; console.log(`📍 Fase: "${phase}" → "${newPhase}"`); }

      // Istruzioni dinamiche per la nuova fase
      const phaseInstr = buildPhaseInstructions(newPhase, this.state);

      this.send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id, output: JSON.stringify(result) } });
      this.isResponseActive = true;
      this.send(phaseInstr ? { type: 'response.create', response: { instructions: phaseInstr } } : { type: 'response.create' });

    } catch(err) {
      console.error(`❌ Tool error (${name}):`, err);
      this.send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id, output: JSON.stringify({ error: err.message }) } });
      this.isResponseActive = true;
      this.send({ type: 'response.create' });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // AUDIO + UTILITY
  // ─────────────────────────────────────────────────────────────────────────

  sendAudio(audioBase64) {
    if (!this.isConnected) return;
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
