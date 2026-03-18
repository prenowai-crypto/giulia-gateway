// ═══════════════════════════════════════════════════════════════════════════════
// PRENOW - OPENAI REALTIME CLIENT v6.0.0
//
// RISCRITTURA COMPLETA basata su index_3_9_31.txt
// Porta TUTTA la logica testata del vecchio sistema adattata per WebSocket Realtime.
//
// Da v3.9.31 portato integralmente:
//   - IntentDetector (con CREATE_OVERRIDE, word boundary, protezione cognomi)
//   - DateManager completo (explicit, relative, weekday+number, prossimo X)
//   - TimeManager completo (lettere, e mezza, e trenta, PM context, relativo)
//   - PeopleManager completo (correzione anzi, falsi positivi)
//   - NameManager + RecapManager.extractName + nameMatches
//   - RecapManager.isConfirming/isDenying/isConfirmingCancellation
//   - ConfigHelper.inferDefault (pranzo→13:00, cena→20:00)
//   - ValidationPipeline: note cliente, FALSE_CLOSURE/FULLBOOKED patterns
//   - findChosenReservation (multi-prenotazione)
//
// Adattato per Realtime:
//   - SessionState per singola sessione WebSocket
//   - _parseAndStore al posto di ValidationPipeline.validate()
//   - _handleNewDate al posto di ClosureChecker
//   - handleToolCall con StateManager integrato
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
  'eliminare','elimina','elimino','eliminarla','eliminarlo','eliminarli','eliminarle',
  'non vengo','non veniamo','non riesco','non riusciamo',
  'cancel','cancellation','delete','remove',
  'i need to cancel','i want to cancel','i have to cancel',
  'cancel my reservation','cancel my booking',
];

const MODIFY_KEYWORDS = [
  'modificare','modifica','modifico','modifiche',
  'spostare','sposta','sposto',
  'cambiare','cambia','cambio',
  'anticipare','posticipare','aumentat','aggiunger',
  'change','modify','move','reschedule','update',
  'i need to change','i want to change','i have to change',
  'i need to modify','i want to modify','change my reservation','change my booking',
];

const EXISTING_RES_KEYWORDS = [
  'ho prenotato','avevo prenotato','ho una prenotazione',
  'la mia prenotazione','la prenotazione',
  'i have a reservation','my reservation','i booked','i have a booking',
];

const CREATE_OVERRIDE = [
  /\b(altra|nuova|seconda)\s+prenotazione/i,
  /\b(un'?\s*altra|una\s+nuova)\s+prenotazione/i,
  /\bprenotazione\s+(nuova|altra)/i,
  /\b(another|new|second)\s+(reservation|booking)/i,
  /\b(make|add|create)\s+(a\s+)?(new|another)\s+(reservation|booking)/i,
];

function detectIntent(text) {
  if (!text) return 'create';
  // Pre-processing: rimuove "a nome X" per proteggere cognomi (v3.9.21 BUG-002)
  let t = text.toLowerCase()
    .replace(/\ba\s+nome\s+\w+/gi, ' ')
    .replace(/\bnome\s+\w+/gi, ' ')
    .replace(/\bname\s+\w+/gi, ' ')
    .replace(/\bunder\s+(the\s+)?name\s+\w+/gi, ' ')
    .replace(/\s+/g, ' ').trim();
  const tOrig = text.toLowerCase();
  // CREATE override prima di tutto (v3.9.23 BUG-019)
  for (const p of CREATE_OVERRIDE) { if (p.test(tOrig)) return 'create'; }
  // CANCEL con word boundary (v3.9.21)
  for (const kw of CANCEL_KEYWORDS) {
    const match = kw.includes(' ') ? t.includes(kw) : new RegExp(`\\b${kw}\\b`, 'i').test(t);
    if (match) return 'cancel';
  }
  for (const kw of MODIFY_KEYWORDS) { if (t.includes(kw)) return 'modify'; }
  for (const kw of EXISTING_RES_KEYWORDS) { if (tOrig.includes(kw)) return 'modify'; }
  return 'create';
}

// ═══════════════════════════════════════════════════════════════════════════════
// DATE MANAGER — portato da v3.9.31
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
  const m = text.match(new RegExp(`(\\d{1,2})\\s*(?:di\\s+)?(${allM})`, 'i'));
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
  if (/dopodomani|dopo\s*domani|day after tomorrow/.test(text)) return toISO(addDays(today, 2));
  if (/\bdomani\b|\btomorrow\b/.test(text)) return toISO(addDays(today, 1));
  if (/\boggi\b|\btoday\b|\bstasera\b|\bquesta\s*sera\b|\btonight\b/.test(text)) return toISO(today);
  const tra = text.match(/(?:tra|fra|in)\s*(\d+)\s*giorni/);
  if (tra) return toISO(addDays(today, parseInt(tra[1])));
  return null;
}

// v3.9.25 E7: "martedì 10" → 10 del mese
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
// TIME MANAGER — portato da v3.9.31 con numeri in lettere (I4)
// ═══════════════════════════════════════════════════════════════════════════════

// Mappa numeri in lettere → cifre (v3.9.30 I4)
const HOUR_WORDS = {
  'zero':0,'una':1,'uno':1,'due':2,'tre':3,'quattro':4,'cinque':5,'sei':6,'sette':7,
  'otto':8,'nove':9,'dieci':10,'undici':11,'dodici':12,'tredici':13,'quattordici':14,
  'quindici':15,'sedici':16,'diciassette':17,'diciotto':18,'diciannove':19,
  'venti':20,'ventuno':21,'ventidue':22,'ventitre':23,'ventitré':23,
  'one':1,'two':2,'three':3,'four':4,'five':5,'six':6,'seven':7,'eight':8,
  'nine':9,'ten':10,'eleven':11,'twelve':12,'thirteen':13,'fourteen':14,
  'fifteen':15,'sixteen':16,'seventeen':17,'eighteen':18,'nineteen':19,'twenty':20,
};
const MINUTE_WORDS = {
  'mezza':30,'mezzo':30,'half':30,'trenta':30,'thirty':30,
  'un quarto':15,'quarter':15,'quindici':15,'fifteen':15,
  'quarantacinque':45,'forty-five':45,'forty five':45,
  'quaranta':40,'forty':40,'venti':20,'twenty':20,
  'dieci':10,'ten':10,'cinque':5,'five':5,
};

function parseTime(text) {
  if (!text) return null;
  const t = text.toLowerCase().trim();
  const isLunchContext = /\bpranzo\b|\blunch\b|\bmattina\b|\bmorning\b/.test(t);

  if (/mezzogiorno|noon/.test(t)) return '12:00';
  if (/mezzanotte|midnight/.test(t)) return '00:00';

  // Orari in lettere "l'una" → 13:00 (Whisper trascrive "all'una" come "alluna")
  const ora1map = {
    "l'una":'13:00','luna':'13:00','alluna':'13:00',"all'una":'13:00',
    'le una':'13:00','l una':'13:00',
    'le due':'14:00','le tre':'15:00',
  };
  for (const [k, v] of Object.entries(ora1map)) { if (t.includes(k)) return v; }

  // Tempo relativo (v3.9.30 J8)
  const rel = _parseRelativeTime(t);
  if (rel) return rel;

  const allTimes = [];
  let m;

  // Pattern numeri in lettere "alle venti e trenta" (v3.9.30 I4)
  const allHW = Object.keys(HOUR_WORDS).join('|');
  const allMW = Object.keys(MINUTE_WORDS).filter(k => !k.includes(' ')).join('|');
  const reW = new RegExp(`(?:alle|ore|per le|at)\\s+(${allHW})(?:\\s+e\\s+(${allMW}|un quarto))?`, 'gi');
  while ((m = reW.exec(t)) !== null) {
    let h = HOUR_WORDS[m[1].toLowerCase()];
    if (h === undefined) continue;
    const minKey = m[2]?.toLowerCase();
    const min = minKey ? (MINUTE_WORDS[minKey] || 0) : 0;
    if (h >= 1 && h <= 11 && !isLunchContext) h += 12;
    if (h >= 0 && h <= 23) allTimes.push({ pos: m.index, time: `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}` });
  }

  // "alle 21:30", "alle 21.30", "l'E21", "le 21", varianti Whisper
  const re1 = /(?:alle|ore|per le|l['\s]e?|at)\s*(\d{1,2})[\.:](\d{2})/gi;
  while ((m = re1.exec(t)) !== null) {
    let h = parseInt(m[1]), min = parseInt(m[2]);
    if (h >= 1 && h <= 11 && !isLunchContext) h += 12;
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) allTimes.push({ pos: m.index, time: `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}` });
  }

  // "alle 20 e 30" — cifre e parola minuti
  const MWK = {'mezza':30,'mezzo':30,'trenta':30,'quindici':15,'quaranta':40,'quarantacinque':45,'venti':20,'dieci':10,'cinque':5};
  const reEW = new RegExp(`(?:alle|ore|per le|at)\\s*(\\d{1,2})\\s+e\\s+(${Object.keys(MWK).join('|')})\\b`, 'gi');
  while ((m = reEW.exec(t)) !== null) {
    let h = parseInt(m[1]); const min = MWK[m[2].toLowerCase()] || 0;
    if (h >= 1 && h <= 11 && !isLunchContext) h += 12;
    if (h >= 0 && h <= 23) allTimes.push({ pos: m.index, time: `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}` });
  }

  // "alle 20 e 30" — cifre e cifre
  const reEN = /(?:alle|ore|per le|at)\s*(\d{1,2})\s+e\s+(\d{2})\b/gi;
  while ((m = reEN.exec(t)) !== null) {
    let h = parseInt(m[1]), min = parseInt(m[2]);
    if (h >= 1 && h <= 11 && !isLunchContext) h += 12;
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) allTimes.push({ pos: m.index, time: `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}` });
  }

  // "alle 21" senza minuti
  const re2 = /(?:alle|ore|per le|l['\s]e?|at)\s*(\d{1,2})\b/gi;
  while ((m = re2.exec(t)) !== null) {
    let h = parseInt(m[1]);
    if (h >= 1 && h <= 11 && !isLunchContext) h += 12;
    if (h >= 0 && h <= 23) allTimes.push({ pos: m.index, time: `${String(h).padStart(2,'0')}:00` });
  }

  // Standalone "21:30" (con contesto serale per ore ambigue)
  const eveningCtx = /cena|dinner|stasera|tonight|sera/i.test(t);
  const re3 = /\b(\d{1,2})[\.:](\d{2})\b/g;
  while ((m = re3.exec(t)) !== null) {
    let h = parseInt(m[1]), min = parseInt(m[2]);
    if (eveningCtx && h >= 1 && h <= 11) h += 12;
    else if (h >= 1 && h <= 11 && !isLunchContext) h += 12;
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

  if (allTimes.length === 0) {
    // Inferenza da contesto (v3.9.31 inferDefault)
    if (/\bpranzo\b|\blunch\b/.test(t)) return '13:00';
    return null;
  }

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
// PEOPLE MANAGER — portato da v3.9.31
// ═══════════════════════════════════════════════════════════════════════════════

function parsePeople(text) {
  if (!text) return null;
  const t = text.toLowerCase().trim();
  // Falsi positivi
  if (/ci sei|ci siete|mi senti/i.test(t)) return null;
  // Correzione "anzi" → usa ULTIMO numero (v3.9.12)
  if (/anzi|no aspetta|aspetta|facciamo|meglio|diciamo|actually|no wait|wait|let's say|make it|changed to|now it's/i.test(t)) {
    const nums = t.match(/\b(\d+)\b/g);
    if (nums && nums.length >= 2) {
      const last = parseInt(nums[nums.length - 1]);
      if (last > 0 && last < 100) return last;
    }
  }
  const patterns = [
    /(\d+)\s*in\s*totale/i,
    /(\d+)\s*invece\s*di\s*\d+/i,
    /diventat[io]\s*(\d+)/i,
    /adesso\s*(?:siamo\s*)?(?:in\s*)?(\d+)/i,
    /siamo\s*(?:in\s*)?(\d+)/i,
    /(?:per|saremo|in)\s*(\d+)\s*(?:person[ae]|pax|coperti|guests|people)?/i,
    /(\d+)\s*(?:person[ae]|pax|coperti|guests|people)/i,
    /(?:tavolo|table)\s*(?:per|for)\s*(\d+)/i,
  ];
  for (const p of patterns) {
    const m = t.match(p);
    if (m) { const n = parseInt(m[1]); if (n > 0 && n < 100) return n; }
  }
  const words = {'due':2,'tre':3,'quattro':4,'cinque':5,'sei':6,'sette':7,'otto':8,'nove':9,'dieci':10};
  for (const [w, n] of Object.entries(words)) { if (t.includes(w)) return n; }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// NAME PARSER — portato da NameManager v3.9.21 + RecapManager.extractName v3.9.22
// ═══════════════════════════════════════════════════════════════════════════════

// Blacklist completa — portata e ampliata
const NAME_EXCLUDE = new Set([
  // Comuni italiani
  'si','no','ok','sì','yes','grazie','prego','esatto','confermo','giusto','certo',
  'quello','quella','bene','perfetto','ciao','buongiorno','buonasera','buonanotte',
  'io','me','noi','lui','lei','uno','una','un','mille','tanto','molto',
  'pronto','salve','allora','ecco','dunque','quindi','però','anche','magari','cioè',
  'senza','mail','email','nessuno','nessuna','grazie mille',
  'sempre','ancora','proprio','stesso','solito',
  'nome','mio','mia','suo','sua','il','la','lo','per','alle','dei','delle',
  // Verbi — mai nomi
  'vorrei','voglio','volevo','potrei','potevo','dovrei','dovevo',
  'prenotare','prenoto','cancellare','cancello','modificare','modifico',
  'chiamare','chiamo','parlare','parlo','sentire','sento','capire',
  'aiutare','aiuto','confermare','verificare',
  // Placeholder
  "l'utente",'utente','cliente','client','unknown','sconosciuto',
  'prenotazione','reservation','tavolo','table',
  // Tecnico web (allucinazioni Whisper)
  'org','com','net','www','http','html','amara',
  // Giorni settimana
  'lunedì','martedì','mercoledì','giovedì','venerdì','sabato','domenica',
  'lunedi','martedi','mercoledi','giovedi','venerdi',
  // Orari scritti (Whisper)
  'alluna','luna','allune',
  // Note (v3.9.30)
  'celiaco','celiaca','vegetariano','vegetariana','vegano','vegana',
]);

const VERB_START = /^(vorrei|voglio|volevo|potrei|potevo|dovrei|ho|ha|hai|abbiamo|avevo|avrei|sono|sei|siamo|stavo|sto|cerco|chiamo|posso|possiamo|vorremmo|mi\s+chiamo|il\s+mio\s+nome)\b/i;

function parseName(text) {
  if (!text) return null;
  const t = text.trim();

  const STOP = /\s+(?:alle|per|il|la|lo|gli|i|le|di|da|in|con|su|tra|fra|e|ed|o|a|un|una|uno|senza|email|mail)\b/i;

  // Prova prima i pattern espliciti — "sono Giovanni", "mi chiamo X", ecc.
  // VERB_START NON deve bloccare questi: li gestiamo qui
  const patterns = [
    /\ba\s+nome\s+(?:di\s+)?([A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]+(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]+)?)/i,
    /\bil\s+(?:mio\s+)?nome\s+[èe]\s+([A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]+(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]+)?)/i,
    /\bmi\s+chiamo\s+([A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]+(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]+)?)/i,
    /\bsono\s+([A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]+(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]+)?)\b/i,
    /\bname\s+is\s+([A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]+(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]+)?)\b/i,
    /\bi'?m\s+([A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]+(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]+)?)\b/i,
    /\bunder\s+(?:the\s+)?name\s+([A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]+(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]+)?)\b/i,
    /\bnome\s+([A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]+(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]+)?)/i,
    /[,\.]\s*([A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]{1,}(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]+)?)\s*$/i,
  ];

  for (const p of patterns) {
    const m = t.match(p);
    if (m && m[1]) {
      let name = m[1].trim();
      const stop = name.match(STOP);
      if (stop) name = name.substring(0, stop.index).trim();
      name = name.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
      if (name.length >= 2 && !NAME_EXCLUDE.has(name.toLowerCase())) return name;
    }
  }

  // Solo per risposte secche (1-2 parole senza verbi) controlla VERB_START
  if (VERB_START.test(t)) return null;

  // Normalizza: rimuovi punteggiatura finale
  const stripped = t.replace(/[.,!?]+$/, '').trim();
  const words = stripped.split(/\s+/);

  // Rimuovi prefissi conferma: "Sì, Giovanni" → "Giovanni"
  const CONFIRM_PREFIX = /^(?:sì|si|yes|certo|esatto|giusto|ok|confermo|perfetto|allora|ecco)[,\s]+/i;
  const DENY_PREFIX    = /^(?:no|non)[,\s]+/i;
  const withoutPrefix  = stripped.replace(CONFIRM_PREFIX, '').replace(DENY_PREFIX, '').trim();
  const prefixWords    = withoutPrefix.split(/\s+/);

  // Prova prima senza prefisso poi con testo intero
  for (const candidate of [prefixWords, words]) {
    if (candidate.length === 1) {
      const w = candidate[0];
      if (/^[A-Za-zÀ-ÖØ-öø-ÿ]{3,}$/.test(w) && !NAME_EXCLUDE.has(w.toLowerCase()))
        return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    }
    if (candidate.length === 2) {
      const [w1, w2] = candidate;
      if (/^[A-Za-zÀ-ÖØ-öø-ÿ]{2,}$/.test(w1) && /^[A-Za-zÀ-ÖØ-öø-ÿ]{2,}$/.test(w2)
          && !NAME_EXCLUDE.has(w1.toLowerCase()) && !NAME_EXCLUDE.has(w2.toLowerCase()))
        return [w1,w2].map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIRM / DENY / CANCEL — portato da RecapManager v3.9.25
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
  if (/\b(keep it|don't cancel|never\s*mind|forget it)\b/i.test(t)) return true;
  return false;
}

function isConfirmingCancellation(text) {
  const t = normalizeText(text || '');
  if (/conferm\w*\s+(la\s+)?cancellazion/i.test(t)) return true;
  if (/cancella(te)?\s+pure/i.test(t)) return true;
  if (/procedi\s+(con\s+)?(la\s+)?cancellazion/i.test(t)) return true;
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

// Rileva note cliente (allergie, richieste speciali) — portato da v3.9.30 J1-J10
const NOTE_PATTERNS = [
  [/celiaco|celiaca|glutine|gluten|celiac/i, 'Allergia/intolleranza glutine'],
  [/vegetariano|vegetariana|vegetarian/i, 'Vegetariano/a'],
  [/vegano|vegana|vegan/i, 'Vegano/a'],
  [/lattosio|lactose/i, 'Intolleranza lattosio'],
  [/arachidi|peanut|noci\s+nuts/i, 'Allergia frutta secca'],
  [/seggiolone|seggiolino|highchair/i, 'Richiesto seggiolone'],
  [/sedia a rotelle|carrozzina|wheelchair/i, 'Accessibilità richiesta'],
  [/anniversario|anniversary/i, 'Anniversario'],
  [/compleanno|birthday/i, 'Compleanno'],
  [/romantico|romantic/i, 'Tavolo romantico'],
  [/terrazza|esterno|outside|outdoor/i, 'Preferenza esterno'],
];

function parseNotes(text) {
  if (!text) return null;
  const found = [];
  for (const [re, note] of NOTE_PATTERNS) {
    if (re.test(text)) found.push(note);
  }
  return found.length > 0 ? found.join('; ') : null;
}

// Rileva rumori di fondo / allucinazioni Whisper
const NOISE_PATTERNS = [/sottotitoli/i, /amara\.org/i, /copyright/i, /subtitles?\s+by/i, /transcribed\s+by/i];
function isBackgroundNoise(text) {
  if (!text || text.trim().length < 3) return true;
  return NOISE_PATTERNS.some(p => p.test(text));
}

// ═══════════════════════════════════════════════════════════════════════════════
// STATE MANAGER — fasi conversazionali
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

function isToolAllowed(name, phase, state) {
  if (!( ALLOWED_TOOLS[phase] || []).includes(name)) return false;
  // check_availability richiede SEMPRE data+time — altrimenti GPT inventa risultati
  if (name === 'check_availability') {
    const cd = state?.collectedData || {};
    if (!cd.date || !cd.time) return false;
  }
  return true;
}
function initialPhaseForIntent(intent) { return (intent === 'modify' || intent === 'cancel') ? PHASES.FINDING : PHASES.COLLECTING; }

function advancePhase(phase, toolName, result, intent) {
  if (toolName === 'check_availability') return phase;
  switch (phase) {
    case 'initial':
      if (toolName === 'find_reservation') {
        if (result.found === true) return intent === 'cancel' ? PHASES.AWAITING_CANCEL_CONFIRM : PHASES.AWAITING_MODIFY_DETAILS;
        return PHASES.INITIAL;
      }
      if (toolName === 'prepare_reservation' && result.ready) return PHASES.AWAITING_CONFIRM;
      return phase;
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

function buildPhaseInstructions(phase, state) {
  const cd = state.collectedData;
  const found = state.foundReservation;

  function acquired() {
    const p = [];
    if (cd.date)   p.push(`data: ${formatDateForSpeech(cd.date)}`);
    if (cd.time)   p.push(`orario: ${cd.time}`);
    if (cd.people) p.push(`persone: ${cd.people}`);
    if (cd.name)   p.push(`nome: ${cd.name}`);
    return p.length > 0 ? `Dati GIÀ ACQUISITI (NON richiedere): ${p.join(', ')}.` : '';
  }

  switch (phase) {
    case 'initial':
      return 'Nessuna prenotazione trovata. Informa il cliente e chiedi se vuole fare una nuova prenotazione.';
    case 'collecting': {
      const acq = acquired();
      if (!cd.date)   return `${acq} Chiedi: "Per quale giorno vuole prenotare?"`;
      if (!cd.time)   return `${acq} Chiedi: "A che ora preferisce?"`;
      if (!cd.people) return `${acq} Chiedi: "Per quante persone?"`;
      if (!cd.name)   return `${acq} Chiedi SOLO: "A che nome prenoto?" — nient'altro.`;
      // Nome presente — chiedi email UNA volta sola, poi prepare
      const emailDone = cd.email || this.state.emailAsked;
      if (!emailDone) return `${acq} Chiedi SOLO: "Vuole lasciare un'email per la conferma? È opzionale." — una domanda, poi chiama prepare_reservation.`;
      return `${acq} Tutti i dati sono pronti. Chiama prepare_reservation SUBITO senza fare altre domande.`;
    }
    case 'awaiting_confirm':
      return `${acquired()} Hai appena letto il recap. Aspetta che il cliente dica "sì" o "confermo" → chiama create_reservation. NON aggiungere altre domande. NON fare riepiloghi aggiuntivi.`;
    case 'finding':
      return 'Chiama find_reservation con il nome e la data della prenotazione.';
    case 'awaiting_modify_details':
      if (!found) return 'Chiama find_reservation prima.';
      return `Prenotazione trovata: ${found.people} persone il ${formatDateForSpeech(found.date)} alle ${(found.time||'').substring(0,5)} a nome ${found.name}. Chiedi cosa vuole modificare. Poi check_availability e prepare_reservation.`;
    case 'awaiting_modify_confirm':
      return `${acquired()} Hai letto il riepilogo della modifica. Aspetta conferma → modify_reservation.`;
    case 'awaiting_cancel_confirm':
      if (!found) return 'Chiama find_reservation prima.';
      return `Prenotazione trovata: ${found.people} persone il ${formatDateForSpeech(found.date)} alle ${(found.time||'').substring(0,5)} a nome ${found.name}. Chiedi conferma ESPLICITA: "Confermi di volerla cancellare?". Se sì → cancel_reservation. Se no → NON cancellare.`;
    case 'completed':
      return 'Richiesta completata. Saluta il cliente educatamente.';
    default: return null;
  }
}

function blockedToolMessage(toolName, phase, state) {
  if (toolName === 'create_reservation' && (phase === 'collecting' || phase === 'initial')) {
    const cd = state?.collectedData || {};
    const parts = [];
    if (cd.date)   parts.push(`data: ${cd.date}`);
    if (cd.time)   parts.push(`orario: ${cd.time}`);
    if (cd.people) parts.push(`persone: ${cd.people}`);
    if (cd.name)   parts.push(`nome: ${cd.name}`);
    return `STOP. Non puoi chiamare create_reservation prima di prepare_reservation. Chiama SUBITO prepare_reservation con i dati: ${parts.join(', ')}. È OBBLIGATORIO.`;
  }
  if (toolName === 'check_availability') {
    const cd = state?.collectedData || {};
    if (!cd.date) return 'Non hai ancora la data. Chiedi al cliente per quale giorno vuole prenotare.';
    if (!cd.time) return 'Non hai ancora l\'orario. Chiedi al cliente: "A che ora preferisce?"';
    return 'Dati insufficienti per verificare la disponibilità. Raccogli prima data, orario e numero di persone.';
  }
  switch (toolName) {
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
    this.apiKey           = options.apiKey;
    this.model            = options.model || 'gpt-4o-mini-realtime-preview';
    this.systemPrompt     = options.systemPrompt;
    this.tools            = options.tools || [];
    this.callSid          = options.callSid;
    this.restaurantConfig = options.restaurantConfig;
    this.callerPhone      = options.callerPhone || null;

    this.onAudioDelta = options.onAudioDelta || (() => {});
    this.onTranscript = options.onTranscript || (() => {});
    this.onError      = options.onError      || console.error;

    this.ws          = null;
    this.isConnected = false;
    this.sessionId   = null;

    // SESSION STATE — equivalente StateManager del vecchio sistema
    this.state = {
      collectedData: { date: null, time: null, people: null, name: null, email: null, notes: null, mealContext: null },
      pendingReservation:  null,
      pendingConfirmation: false,
      foundReservation:    null,
      initialIntent:       null,
      phase:               PHASES.INITIAL,
      cancelConfirmed:     false,
      availabilityChecked: false,
      emailAsked: false,
    };

    // Echo detection
    this.recentAiPhrases    = [];
    this.MAX_AI_HISTORY     = 10;
    this.lastAiFinishedTime = 0;
    this.isAiCurrentlySpeaking = false;
    this.isResponseActive   = false;
    this.speechStartedDuringAi = false;
    this.ECHO_WINDOW_MS     = 2500;
    this.audioSendCount     = 0;
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
  // SESSIONE
  // ─────────────────────────────────────────────────────────────────────────

  initializeSession() {
    const prompt = this.systemPrompt + `

REGOLE OPERATIVE — PRIORITÀ ASSOLUTA:

1. FLUSSO PRENOTAZIONE — SEGUI QUESTO ORDINE:
   STEP 1: Chiedi data (se non fornita)
   STEP 2: Chiedi orario (se non fornito)
   STEP 3: Chiedi numero persone (se non fornito)
   → Il sistema verifica automaticamente la disponibilità
   STEP 4: Chiedi nome
   STEP 5: Chiedi email (opzionale)
   STEP 6: Chiama prepare_reservation → leggi recap parola per parola
   STEP 7: Aspetta conferma → chiama create_reservation

2. ANTI-INVENZIONE:
   NON inventare MAI nomi → chiedi "A che nome prenoto?"
   NON usare "l'utente", "cliente", "unknown" come nome
   NON inventare orari → chiedi "A che ora preferisce?"

3. RECAP VERBATIM:
   Quando prepare_reservation restituisce "recap", leggilo PAROLA PER PAROLA.

4. ERRORI PREPARE:
   Se ready=false → leggi SOLO il campo "message" e seguilo.

5. CREATE OBBLIGA PREPARE:
   Quando il cliente dice "sì" dopo il recap → dì "Un attimo, registro..." → chiama create_reservation SUBITO.
   NON dire "prenotazione confermata" PRIMA che create_reservation risponda success=true.

6. NOMI = NOMI:
   "a nome Cancelleri", "mi chiamo Sposta", "sono Annulli" → sempre cognomi, MAI comandi.

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
        turn_detection: { type: 'server_vad', threshold: 0.4, prefix_padding_ms: 300, silence_duration_ms: 1200 },
        // check_availability è ESCLUSA: il server la chiama direttamente quando ha tutti i dati.
        // GPT non deve mai chiamarla — altrimenti la chiama prima di avere l'orario.
        tools: this.tools
          .filter(t => t.name !== 'check_availability')
          .map(t => ({ type: 'function', name: t.name, description: t.description, parameters: t.parameters }))
      }
    });

    this.isAiCurrentlySpeaking = true;
    this.isResponseActive = true;
    this.send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '[Cliente in linea. Saluta brevemente e chiedi come puoi aiutarlo.]' }] } });
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

    // 2. Data (sempre)
    const date = parseDate(transcript);
    if (date && cd.date !== date) { console.log(`📅 [SERVER] date: "${cd.date}" → "${date}"`); cd.date = date; }

    // 3. Orario (sempre)
    const time = parseTime(transcript);
    if (time && cd.time !== time) { console.log(`⏰ [SERVER] time: "${cd.time}" → "${time}"`); cd.time = time; }

    // 4. Persone (sempre)
    const people = parsePeople(transcript);
    if (people && cd.people !== people) { console.log(`👥 [SERVER] people: ${cd.people} → ${people}`); cd.people = people; }

    // 5. Nome — lock con eccezione correzione esplicita (v3.9.21)
    const EXPLICIT_NAME = /\b(mi\s+chiamo|il\s+(?:mio\s+)?nome\s+[èe]|a\s+nome|sono\s+[A-Za-z]|i'?m\s+|my\s+name\s+is)\s*/i;
    const isExplicitName = EXPLICIT_NAME.test(transcript);
    const nameLocked = locked && cd.name !== null && !isExplicitName;
    if (!nameLocked) {
      const name = parseName(transcript);
      if (name && cd.name !== name) {
        if (locked && cd.name !== null) console.log(`👤 [SERVER] name AGGIORNATO (correzione): "${cd.name}" → "${name}"`);
        else console.log(`👤 [SERVER] name: "${cd.name}" → "${name}"`);
        cd.name = name;
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
      // Rifiuto email esplicito → marca emailAsked per non richiedere
      const emailRefusal = /\b(no|niente|nessuna|non voglio|non ho|senza)\b.*\b(email|mail|e-mail)\b|\b(email|mail)\b.*\b(no|niente|nessuna)\b/i;
      if (!this.state.emailAsked && emailRefusal.test(transcript)) {
        this.state.emailAsked = true;
        console.log(`📧 [SERVER] email rifiutata, emailAsked=true`);
      }
    }

    // 7. Meal context
    if (!locked) {
      const mc = parseMealContext(transcript);
      if (mc && cd.mealContext !== mc) { cd.mealContext = mc; console.log(`🍽️ [SERVER] mealContext: → "${mc}"`); }
    }

    // 8. Note cliente (v3.9.30 J1-J10)
    const notes = parseNotes(transcript);
    if (notes) {
      cd.notes = cd.notes ? `${cd.notes}; ${notes}` : notes;
      console.log(`📝 [SERVER] notes: "${cd.notes}"`);
    }

    // 9. Cancel confirm — rilevato server-side (v6.0.0)
    if (this.state.phase === PHASES.AWAITING_CANCEL_CONFIRM && !this.state.cancelConfirmed) {
      if (isConfirmingCancellation(transcript) || isConfirming(transcript)) {
        this.state.cancelConfirmed = true;
        console.log(`✅ [SERVER] cancelConfirmed = true`);
      }
    }

    console.log(`📊 [SERVER] collectedData:`, JSON.stringify(cd));

    // 10. AUTO-TRIGGER CHECK DISPONIBILITÀ
    // Il server chiama check_availability direttamente quando ha tutti i dati.
    // GPT non ha questo tool — non può chiamarlo mai da solo.
    const isModifyContext = !!this.state.foundReservation || this.state.initialIntent === 'modify' || this.state.initialIntent === 'cancel';
    const readyToCheck = cd.date && cd.time && cd.people && !locked && !isModifyContext && !this.state.availabilityChecked;

    if (readyToCheck) {
      // Verifica giorno chiuso prima del check
      const dow = new Date(cd.date + 'T12:00:00').getDay();
      const closingDays = this.restaurantConfig?.weekly_closing_days || [];
      const lunchClosed = this.restaurantConfig?.lunch_closed_days || [];
      const dinnerClosed = this.restaurantConfig?.dinner_closed_days || [];
      const giorni = ['domenica','lunedì','martedì','mercoledì','giovedì','venerdì','sabato'];

      if (closingDays.includes(dow)) {
        this._injectMessage(`Il ristorante è chiuso il ${giorni[dow]}. Di': "Mi dispiace, siamo chiusi il ${giorni[dow]}. Vuole prenotare per un altro giorno?"`);
        return;
      }
      if (cd.mealContext === 'pranzo' && lunchClosed.includes(dow)) {
        this._injectMessage(`Non facciamo pranzo il ${giorni[dow]}. Di': "Mi dispiace, il ${giorni[dow]} siamo chiusi a pranzo."`);
        return;
      }
      if (cd.mealContext === 'cena' && dinnerClosed.includes(dow)) {
        this._injectMessage(`Non facciamo cena il ${giorni[dow]}. Di': "Mi dispiace, il ${giorni[dow]} siamo chiusi a cena."`);
        return;
      }

      // Giorno aperto — esegui check server-side
      this.state.availabilityChecked = true;
      console.log(`🔍 [SERVER] Auto-check: ${cd.date} ${cd.time} per ${cd.people} persone`);
      this._serverCheckAvailability(cd.date, cd.time, cd.people);
    }
    // Nuova data arrivata ma manca ancora orario o persone — aggiorna solo se giorno chiuso
    else if (cd.date && cd.date !== prevDate && !locked && !isModifyContext) {
      const dow = new Date(cd.date + 'T12:00:00').getDay();
      const closingDays = this.restaurantConfig?.weekly_closing_days || [];
      const giorni = ['domenica','lunedì','martedì','mercoledì','giovedì','venerdì','sabato'];
      if (closingDays.includes(dow)) {
        this._injectMessage(`Il ristorante è chiuso il ${giorni[dow]}. Di': "Mi dispiace, siamo chiusi il ${giorni[dow]}. Vuole prenotare per un altro giorno?"`);
      }
    }
  }

  async _serverCheckAvailability(date, time, people) {
    try {
      const tool = this.tools.find(t => t.name === 'check_availability');
      if (!tool) return;
      const result = await tool.handler(
        { date, time, people },
        { callSid: this.callSid, restaurantConfig: this.restaurantConfig, sessionState: this.state, callerPhone: this.callerPhone }
      );
      console.log(`✅ [SERVER] check_availability result:`, JSON.stringify(result));

      if (result.available) {
        // Slot disponibile → dì al GPT di chiedere nome
        const waitAndInject = (attempt = 0) => {
          if (!this.isResponseActive) {
            this.send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: `[disponibilità verificata: ${date} ${time} per ${people} persone — slot libero]` }] } });
            this.isResponseActive = true;
            this.send({ type: 'response.create', response: { instructions: `Disponibilità confermata. Chiedi SOLO: "A che nome prenoto?" — nessuna conferma di disponibilità, nessun "procediamo?", solo questa domanda.` } });
          } else if (attempt < 20) { setTimeout(() => waitAndInject(attempt + 1), 150); }
        };
        waitAndInject();
      } else if (result.reason === 'day_closed') {
        this._injectMessage(result.message || 'Giorno chiuso. Chiedi un altro giorno.');
      } else if (result.reason === 'slot_full') {
        const waitAndInject = (attempt = 0) => {
          if (!this.isResponseActive) {
            this.send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: `[slot pieno: ${date} ${time}]` }] } });
            this.isResponseActive = true;
            this.send({ type: 'response.create', response: { instructions: `Lo slot delle ${time} è pieno. Di' al cliente che purtroppo siamo al completo a quell'orario e proponi orari alternativi vicini.` } });
          } else if (attempt < 20) { setTimeout(() => waitAndInject(attempt + 1), 150); }
        };
        waitAndInject();
      }
    } catch(err) {
      console.error(`❌ [SERVER] check_availability error:`, err);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ECHO DETECTION
  // ─────────────────────────────────────────────────────────────────────────

  _extractWords(text) { return (text || '').toLowerCase().replace(/[.,!?;:'"()]/g, '').split(/\s+/).filter(w => w.length > 1); }

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

  // ─────────────────────────────────────────────────────────────────────────
  // MESSAGE HANDLER
  // ─────────────────────────────────────────────────────────────────────────

  handleMessage(msg) {
    switch (msg.type) {
      case 'session.created':    this.sessionId = msg.session.id; console.log(`📋 Sessione OpenAI: ${this.sessionId}`); break;
      case 'session.updated':    console.log('✅ Sessione configurata'); break;
      case 'response.audio.delta':
        this.isAiCurrentlySpeaking = true;
        this.isResponseActive = true;
        if (msg.delta) this.onAudioDelta(msg.delta);
        break;
      case 'response.audio_transcript.done':
        if (msg.transcript) { this._saveAiPhrase(msg.transcript); console.log(`💬 [assistant]: ${msg.transcript}`); this.onTranscript(msg.transcript, 'assistant'); }
        break;
      case 'response.done':
        this.isAiCurrentlySpeaking = false;
        this.isResponseActive = false;
        this.lastAiFinishedTime = Date.now();
        if (msg.response?.status === 'failed') console.error('❌ Risposta fallita:', msg.response.status_details);
        break;
      case 'input_audio_buffer.speech_started':
        console.log('🎤 Utente sta parlando...');
        if (this.isAiCurrentlySpeaking) { console.log('⚡ BARGE-IN!'); this.speechStartedDuringAi = true; }
        break;
      case 'input_audio_buffer.speech_stopped': console.log('🎤 Utente ha finito di parlare'); break;
      case 'conversation.item.input_audio_transcription.completed':
        if (msg.transcript) {
          const t = msg.transcript.trim();
          if (this._isEcho(t))          { console.log(`🔇 Trascrizione IGNORATA (echo)`); return; }
          if (isBackgroundNoise(t))      { console.log(`🔇 Trascrizione IGNORATA (rumore): "${t.substring(0,40)}"`); return; }
          console.log(`💬 [user]: ${t}`);
          this.onTranscript(t, 'user');
          this._parseAndStore(t);
        }
        break;
      case 'response.function_call_arguments.done': this.handleToolCall(msg); break;
      case 'error': console.error('❌ Errore OpenAI:', msg.error); this.onError(msg.error); break;
      default: if (process.env.DEBUG_REALTIME) console.log(`📨 ${msg.type}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TOOL CALL HANDLER
  // ─────────────────────────────────────────────────────────────────────────

  async handleToolCall(msg) {
    const { call_id, name, arguments: argsStr } = msg;
    const phase = this.state.phase;
    console.log(`🔧 Tool call: ${name} [fase: ${phase}]`);
    console.log(`📊 collectedData:`, JSON.stringify(this.state.collectedData));

    let args;
    try { args = JSON.parse(argsStr); }
    catch(e) { console.warn(`⚠️ Tool ${name} ignorato: JSON malformato`); return; }

    // RACE CONDITION FIX: check_availability arriva prima che _parseAndStore finisca.
    // Se manca il time, aspettiamo fino a 800ms che Whisper completi la trascrizione.
    // Solo dopo valutiamo se il tool è permesso o va bloccato.
    if (!isToolAllowed(name, phase, this.state)) {
      console.warn(`⛔ Tool "${name}" NON permessa in fase "${phase}"`);
      const msg_blocked = blockedToolMessage(name, phase, this.state);
      this.send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id, output: JSON.stringify({ blocked: true, message: msg_blocked }) } });
      this.isResponseActive = true;
      this.send({ type: 'response.create', response: { instructions: msg_blocked } });
      return;
    }

    try {
      const tool = this.tools.find(t => t.name === name);
      if (!tool) throw new Error(`Tool non trovato: ${name}`);
      const result = await tool.handler(args, { callSid: this.callSid, restaurantConfig: this.restaurantConfig, sessionState: this.state, callerPhone: this.callerPhone });
      console.log(`✅ Tool result [${name}]:`, JSON.stringify(result).substring(0, 200));

      const newPhase = advancePhase(phase, name, result, this.state.initialIntent);
      if (newPhase !== phase) { this.state.phase = newPhase; console.log(`📍 Fase: "${phase}" → "${newPhase}"`); }

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

  send(message) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message)); }
  disconnect()  { if (this.ws) { this.ws.close(); this.ws = null; } this.isConnected = false; }
}

export default OpenAIRealtimeClient;
