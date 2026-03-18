// ═══════════════════════════════════════════════════════════════════════════════
// PRENOW - OPENAI REALTIME CLIENT v7.0.0
//
// ARCHITETTURA:
//   GPT raccoglie: data → orario → persone → nome → email (opzionale)
//   Server verifica disponibilità automaticamente quando ha i 3 dati base
//   GPT non ha check_availability — non può chiamarla mai
//   GPT gestisce: prepare_reservation, create_reservation,
//                 find_reservation, modify_reservation, cancel_reservation
// ═══════════════════════════════════════════════════════════════════════════════

import WebSocket from 'ws';

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY
// ─────────────────────────────────────────────────────────────────────────────

function normalizeText(str) {
  return (str || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function getNowRome() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Rome' }));
}
function toISO(date) {
  if (!date || isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
function addDays(date, n) {
  const d = new Date(date); d.setDate(d.getDate() + n); return d;
}
function formatDateForSpeech(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso + 'T12:00:00');
    const days  = ['domenica','lunedì','martedì','mercoledì','giovedì','venerdì','sabato'];
    const months = ['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'];
    return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
  } catch { return iso; }
}

// ─────────────────────────────────────────────────────────────────────────────
// PARSER DATA
// ─────────────────────────────────────────────────────────────────────────────

function parseDate(text) {
  if (!text) return null;
  const t = normalizeText(text);
  const now = getNowRome();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const slash = t.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  if (slash) {
    const day = parseInt(slash[1]), month = parseInt(slash[2]) - 1;
    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      let c = new Date(today.getFullYear(), month, day);
      if (c < today) c = new Date(today.getFullYear() + 1, month, day);
      return toISO(c);
    }
  }
  const months = {
    'gennaio':0,'febbraio':1,'marzo':2,'aprile':3,'maggio':4,'giugno':5,
    'luglio':6,'agosto':7,'settembre':8,'ottobre':9,'novembre':10,'dicembre':11,
    'january':0,'february':1,'march':2,'april':3,'may':4,'june':5,
    'july':6,'august':7,'september':8,'october':9,'november':10,'december':11
  };
  const allM = Object.keys(months).join('|');
  const mEx = t.match(new RegExp(`(\\d{1,2})\\s*(?:di\\s+)?(${allM})`, 'i'));
  if (mEx) {
    const day = parseInt(mEx[1]), mon = months[mEx[2]];
    if (mon !== undefined && day >= 1 && day <= 31) {
      let c = new Date(today.getFullYear(), mon, day);
      if (c < today) c = new Date(today.getFullYear() + 1, mon, day);
      return toISO(c);
    }
  }

  if (/dopodomani|dopo\s*domani|day after tomorrow/.test(t)) return toISO(addDays(today, 2));
  if (/\bdomani\b|\btomorrow\b/.test(t)) return toISO(addDays(today, 1));
  if (/\boggi\b|\btoday\b|\bstasera\b|\bquesta\s*sera\b|\btonight\b/.test(t)) return toISO(today);
  const tra = t.match(/(?:tra|fra|in)\s*(\d+)\s*giorni/);
  if (tra) return toISO(addDays(today, parseInt(tra[1])));

  const wds = [
    {p:['domenica','sunday'],i:0},{p:['lunedi','monday'],i:1},
    {p:['martedi','tuesday'],i:2},{p:['mercoledi','wednesday'],i:3},
    {p:['giovedi','thursday'],i:4},{p:['venerdi','friday'],i:5},
    {p:['sabato','saturday'],i:6}
  ];
  for (const wd of wds) {
    for (const p of wd.p) {
      const m = t.match(new RegExp(`\\b${p}\\s+(\\d{1,2})\\b`));
      if (m) {
        const n = parseInt(m[1]);
        if (n >= 1 && n <= 31) {
          let c = new Date(today.getFullYear(), today.getMonth(), n);
          if (c < today) c = new Date(today.getFullYear(), today.getMonth() + 1, n);
          return toISO(c);
        }
      }
    }
  }
  let lastIdx = -1, lastPos = -1;
  for (const wd of wds) {
    for (const p of wd.p) {
      const pos = t.lastIndexOf(p);
      if (pos !== -1 && pos > lastPos) { lastPos = pos; lastIdx = wd.i; }
    }
  }
  if (lastIdx !== -1) {
    const diff = ((lastIdx - today.getDay()) + 7) % 7;
    return toISO(addDays(today, diff === 0 ? 7 : diff));
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// PARSER ORARIO
// ─────────────────────────────────────────────────────────────────────────────

function parseTime(text) {
  if (!text) return null;
  const t = text.toLowerCase().trim();
  const isLunch = /\bpranzo\b|\blunch\b/.test(t);

  if (/mezzogiorno|noon/.test(t)) return '12:00';
  if (/mezzanotte|midnight/.test(t)) return '00:00';
  if (/\bl['']una\b|alluna\b|all'una\b/i.test(t)) return '13:00';

  const rel = _parseRelativeTime(t);
  if (rel) return rel;

  const HOUR_W = {
    'una':1,'uno':1,'due':2,'tre':3,'quattro':4,'cinque':5,'sei':6,'sette':7,
    'otto':8,'nove':9,'dieci':10,'undici':11,'dodici':12,'tredici':13,
    'quattordici':14,'quindici':15,'sedici':16,'diciassette':17,'diciotto':18,
    'diciannove':19,'venti':20,'ventuno':21,'ventidue':22,'ventitre':23,'ventitré':23
  };
  const MIN_W = {
    'mezza':30,'mezzo':30,'trenta':30,'quindici':15,'quarantacinque':45,
    'quaranta':40,'venti':20,'dieci':10,'cinque':5
  };
  const allHW = Object.keys(HOUR_W).join('|');
  const allMW = Object.keys(MIN_W).join('|');
  const reW = new RegExp(`(?:alle|ore|per le|at)\\s+(${allHW})(?:\\s+e\\s+(${allMW}|un quarto))?`, 'gi');
  let m, times = [];
  while ((m = reW.exec(t)) !== null) {
    let h = HOUR_W[m[1].toLowerCase()];
    if (h === undefined) continue;
    const minKey = m[2]?.toLowerCase();
    const min = minKey ? (minKey === 'un quarto' ? 15 : (MIN_W[minKey] || 0)) : 0;
    if (h >= 1 && h <= 11 && !isLunch) h += 12;
    if (h >= 0 && h <= 23) times.push({ pos: m.index, time: `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}` });
  }

  const re1 = /(?:alle|ore|per le|at)\s*(\d{1,2})[\.:](\d{2})/gi;
  while ((m = re1.exec(t)) !== null) {
    let h = parseInt(m[1]), min = parseInt(m[2]);
    if (h >= 1 && h <= 11 && !isLunch) h += 12;
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) times.push({ pos: m.index, time: `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}` });
  }
  const re2 = /(?:alle|ore|per le|at)\s*(\d{1,2})\b/gi;
  while ((m = re2.exec(t)) !== null) {
    let h = parseInt(m[1]);
    if (h >= 1 && h <= 11 && !isLunch) h += 12;
    if (h >= 0 && h <= 23) times.push({ pos: m.index, time: `${String(h).padStart(2,'0')}:00` });
  }

  const reEM_keys = Object.keys(MIN_W).join('|');
  const reEM = new RegExp(`(?:alle|ore|per le|at)?\\s*(\\d{1,2})\\s+e\\s+(${reEM_keys})\\b`, 'gi');
  while ((m = reEM.exec(t)) !== null) {
    let h = parseInt(m[1]); const min = MIN_W[m[2].toLowerCase()] || 0;
    if (h >= 1 && h <= 11 && !isLunch) h += 12;
    if (h >= 0 && h <= 23) times.push({ pos: m.index, time: `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}` });
  }

  const eveningCtx = /cena|dinner|stasera|tonight|sera/i.test(t);
  const re3 = /\b(\d{1,2})[\.:](\d{2})\b/g;
  while ((m = re3.exec(t)) !== null) {
    let h = parseInt(m[1]), min = parseInt(m[2]);
    if ((eveningCtx || !isLunch) && h >= 1 && h <= 11) h += 12;
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) times.push({ pos: m.index, time: `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}` });
  }

  if (times.length === 0) {
    if (isLunch) return '13:00';
    return null;
  }
  times.sort((a,b) => a.pos - b.pos);

  // Se c'è una negazione prima di un orario ("non per le 21:00, per le 21:30")
  // usa l'orario che segue la virgola/congiunzione, non quello negato
  if (times.length >= 2) {
    const negPattern = /\b(non|no)\b/gi;
    let m;
    while ((m = negPattern.exec(t)) !== null) {
      const negPos = m.index;
      // Trova l'orario più vicino dopo la negazione
      const negated = times.find(x => x.pos > negPos && x.pos < negPos + 20);
      if (negated) {
        const remaining = times.filter(x => x !== negated);
        if (remaining.length > 0) return remaining[remaining.length - 1].time;
      }
    }
  }

  return times[times.length - 1].time;
}

function _parseRelativeTime(text) {
  const now = getNowRome();
  const patterns = [
    { re: /tra\s+mezz['']?\s*ora|fra\s+mezz['']?\s*ora/i, mins: 30 },
    { re: /tra\s+un['']?\s*ora|fra\s+un['']?\s*ora/i, mins: 60 },
    { re: /tra\s+(\d+)\s*minut|fra\s+(\d+)\s*minut/i, extract: true },
    { re: /tra\s+(\d+)\s*ore|fra\s+(\d+)\s*ore/i, extract: true, hours: true },
  ];
  for (const p of patterns) {
    const match = text.match(p.re);
    if (match) {
      let offset = p.extract ? (p.hours ? parseInt(match[1]||match[2])*60 : parseInt(match[1]||match[2])) : p.mins;
      const target = new Date(now.getTime() + offset * 60000);
      const r = Math.ceil(target.getMinutes() / 15) * 15;
      target.setMinutes(r % 60); if (r >= 60) target.setHours(target.getHours() + 1);
      return `${String(target.getHours()).padStart(2,'0')}:${String(target.getMinutes()).padStart(2,'0')}`;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// PARSER PERSONE
// ─────────────────────────────────────────────────────────────────────────────

function parsePeople(text) {
  if (!text) return null;
  const t = text.toLowerCase();
  if (/ci sei|ci siete|mi senti|pronto/i.test(t)) return null;
  if (/anzi|no aspetta|facciamo|meglio|diciamo/i.test(t)) {
    const nums = t.match(/\b(\d+)\b/g);
    if (nums && nums.length >= 2) { const n = parseInt(nums[nums.length-1]); if (n>0&&n<100) return n; }
  }
  const patterns = [
    /(\d+)\s*in\s*totale/i, /siamo\s*(?:in\s*)?(\d+)/i,
    /(?:per|saremo)\s*(\d+)\s*(?:person[ae]|pax|coperti|guests|people)?/i,
    /(\d+)\s*(?:person[ae]|pax|coperti|guests|people)/i,
    /(?:tavolo|table)\s*(?:per|for)\s*(\d+)/i,
  ];
  for (const p of patterns) {
    const m = t.match(p); if (m) { const n = parseInt(m[1]); if (n>0&&n<100) return n; }
  }
  const words = {'due':2,'tre':3,'quattro':4,'cinque':5,'sei':6,'sette':7,'otto':8,'nove':9,'dieci':10};
  for (const [w,n] of Object.entries(words)) { if (t.includes(w)) return n; }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// PARSER NOME
// ─────────────────────────────────────────────────────────────────────────────

const NAME_EXCLUDE = new Set([
  'si','no','ok','sì','yes','grazie','prego','esatto','confermo','giusto','certo',
  'quello','quella','bene','perfetto','ciao','buongiorno','buonasera','pronto',
  'io','me','noi','lui','lei','uno','una','mille','tanto','molto','ecco','allora',
  'senza','mail','email','nessuno','nessuna','nome','mio','mia','suo','sua',
  'il','la','lo','per','alle','dei','delle',
  'mai','sempre','ancora','forse','però','oppure','quindi',
  'vorrei','voglio','volevo','potrei','dovrei',
  "l'utente",'utente','cliente','unknown','sconosciuto',
  'prenotazione','reservation','tavolo','table',
  'lunedì','martedì','mercoledì','giovedì','venerdì','sabato','domenica',
  'lunedi','martedi','mercoledi','giovedi','venerdi',
  'alluna','luna','org','com','www',
]);
const VERB_START = /^(vorrei|voglio|volevo|potrei|dovrei|ho|hai|ha|avevo|sono|sei|siamo|stavo|sto|cerco|posso|possiamo|vorremmo)\b/i;
const CONFIRM_PREFIX = /^(?:sì|si|yes|certo|esatto|giusto|ok|confermo|perfetto|allora|ecco)[,\s]+/i;

function parseName(text) {
  if (!text) return null;
  const t = text.trim();
  const STOP = /\s+(?:alle|per|il|la|lo|gli|i|le|di|da|in|con|su|tra|fra|e|ed|o|a|un|una|uno|senza|email|mail)\b/i;

  const patterns = [
    /\ba\s+nome\s+(?:di\s+)?([A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]+(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]+)?)/i,
    /\bil\s+(?:mio\s+)?nome\s+[èe]\s+([A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]+(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]+)?)/i,
    /\bmi\s+chiamo\s+([A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]+(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]+)?)/i,
    /\bsono\s+([A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]+(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]+)?)\b/i,
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

  if (VERB_START.test(t)) return null;

  const stripped = t.replace(/[.,!?]+$/, '').trim();
  const words = stripped.split(/\s+/);
  const withoutPrefix = stripped.replace(CONFIRM_PREFIX, '').trim();
  const prefixWords = withoutPrefix.split(/\s+/);

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

// ─────────────────────────────────────────────────────────────────────────────
// ALTRI PARSER
// ─────────────────────────────────────────────────────────────────────────────

function parseEmail(text) {
  if (!text) return null;
  const m = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0] : null;
}

function isConfirming(text) {
  const t = normalizeText(text || '');
  if (/^(si\b|sii\b|yes\b|esatto|corretto|giusto|confermo|certo|ok\b|va bene|proprio|quella|perfetto)/.test(t)) return true;
  if (/\b(conferm|esatt|corrett|giust|perfett)\w*\b/.test(t)) return true;
  return false;
}

function isConfirmingCancellation(text) {
  const t = normalizeText(text || '');
  if (/conferm\w*\s+(la\s+)?cancellazion/i.test(t)) return true;
  if (/si\s*,?\s*cancella/i.test(t)) return true;
  if (/yes\s*,?\s*cancel/i.test(t)) return true;
  return false;
}

function detectIntent(text) {
  if (!text) return 'create';
  let t = text.toLowerCase()
    .replace(/\ba\s+nome\s+\w+/gi, ' ')
    .replace(/\bnome\s+\w+/gi, ' ').trim();
  const CREATE_OVERRIDE = [/\b(altra|nuova)\s+prenotazione/i, /\b(another|new)\s+(reservation|booking)/i];
  for (const p of CREATE_OVERRIDE) { if (p.test(text)) return 'create'; }
  const CANCEL = ['cancellare','cancella','cancello','disdire','disdetta','annullare','annulla',
    'cancellarla','cancellarlo','disdirla','annullarla','non vengo','non veniamo','cancel','delete'];
  const MODIFY = ['modificare','modifica','spostare','sposta','cambiare','cambia',
    'anticipare','posticipare','change','modify','move','reschedule'];
  for (const kw of CANCEL) {
    if (kw.includes(' ') ? t.includes(kw) : new RegExp(`\\b${kw}\\b`,'i').test(t)) return 'cancel';
  }
  for (const kw of MODIFY) { if (t.includes(kw)) return 'modify'; }
  if (/ho prenotato|ho una prenotazione|la mia prenotazione/i.test(text)) return 'modify';
  return 'create';
}

function isBackgroundNoise(text) {
  if (!text || text.trim().length < 3) return true;
  return /sottotitoli|amara\.org|copyright|subtitles?\s+by/i.test(text);
}

function parseMealContext(text) {
  if (!text) return null;
  if (/\bpranzo\b|\blunch\b/.test(text.toLowerCase())) return 'pranzo';
  if (/\bcena\b|\bdinner\b|\bstasera\b|\bsera\b/.test(text.toLowerCase())) return 'cena';
  return null;
}

const NOTE_PATTERNS = [
  [/celiaco|celiaca|glutine|gluten|celiac/i, 'Allergia/intolleranza glutine'],
  [/vegetariano|vegetariana|vegetarian/i, 'Vegetariano/a'],
  [/vegano|vegana|vegan/i, 'Vegano/a'],
  [/seggiolone|seggiolino|highchair/i, 'Richiesto seggiolone'],
  [/anniversario|anniversary/i, 'Anniversario'],
  [/compleanno|birthday/i, 'Compleanno'],
];

function parseNotes(text) {
  if (!text) return null;
  const found = [];
  for (const [re, note] of NOTE_PATTERNS) { if (re.test(text)) found.push(note); }
  return found.length > 0 ? found.join('; ') : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// ISTRUZIONI DI FASE
// ─────────────────────────────────────────────────────────────────────────────

function getPhaseInstructions(state) {
  const cd = state.collectedData;
  const found = state.foundReservation;

  const acq = () => {
    const p = [];
    if (cd.date)   p.push(`data: ${formatDateForSpeech(cd.date)}`);
    if (cd.time)   p.push(`orario: ${cd.time}`);
    if (cd.people) p.push(`persone: ${cd.people}`);
    if (cd.name)   p.push(`nome: ${cd.name}`);
    return p.length ? `[Già acquisito: ${p.join(', ')}] ` : '';
  };

  switch (state.phase) {
    case 'collecting':
      if (!cd.date)   return `${acq()}Chiedi per quale giorno vuole prenotare.`;
      if (!cd.time)   return `${acq()}Chiedi a che ora preferisce.`;
      if (!cd.people) return `${acq()}Chiedi per quante persone.`;
      if (!cd.name)   return `${acq()}Chiedi: "A che nome prenoto?" — NON chiamare prepare_reservation finché il cliente non dice il nome.`;
      return `${acq()}Chiedi se vuole lasciare un'email per la conferma (è opzionale), poi chiama prepare_reservation.`;

    case 'awaiting_confirm':
      return `${acq()}Hai letto il riepilogo. Aspetta "sì" o "confermo" → chiama create_reservation. Se vuole correggere qualcosa → aggiorna con prepare_reservation.`;

    case 'finding':
      return 'Chiama find_reservation per trovare la prenotazione del cliente.';

    case 'awaiting_modify_details':
      if (!found) return 'Chiama prima find_reservation.';
      return `Prenotazione trovata: ${found.people} persone il ${formatDateForSpeech(found.date)} alle ${(found.time||'').substring(0,5)} a nome ${found.name}. Chiedi cosa vuole modificare. Poi chiama prepare_reservation con i dati aggiornati.`;

    case 'awaiting_modify_confirm':
      return `${acq()}Hai letto il riepilogo della modifica. Aspetta conferma → chiama modify_reservation.`;

    case 'awaiting_cancel_confirm':
      if (!found) return 'Chiama prima find_reservation.';
      return `Prenotazione trovata: ${found.people} persone il ${formatDateForSpeech(found.date)} alle ${(found.time||'').substring(0,5)} a nome ${found.name}. Chiedi conferma esplicita: "Conferma di volerla cancellare?" → se sì chiama cancel_reservation, se no non fare nulla.`;

    case 'completed':
      return 'Operazione completata. Saluta cordialmente il cliente.';

    default:
      return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CLASSE PRINCIPALE
// ─────────────────────────────────────────────────────────────────────────────

export class OpenAIRealtimeClient {
  constructor(options) {
    this.apiKey           = options.apiKey;
    this.model            = options.model || 'gpt-4o-mini-realtime-preview';
    this.systemPrompt     = options.systemPrompt || '';
    this.tools            = options.tools || [];
    this.callSid          = options.callSid;
    this.restaurantConfig = options.restaurantConfig;
    this.callerPhone      = options.callerPhone || null;
    this.onAudioDelta     = options.onAudioDelta || (() => {});
    this.onTranscript     = options.onTranscript  || (() => {});
    this.onError          = options.onError       || console.error;

    this.ws               = null;
    this.isConnected      = false;
    this.sessionId        = null;
    this.isResponseActive = false;
    this.audioSendCount   = 0;

    // Echo detection
    this.recentAiPhrases    = [];
    this.lastAiFinishedTime = 0;
    this.ECHO_WINDOW_MS     = 2500;

    // Stato conversazione
    this.state = {
      phase:              'collecting',
      initialIntent:      null,
      collectedData:      { date: null, time: null, people: null, name: null, email: null, notes: null, mealContext: null },
      pendingReservation: null,
      pendingConfirmation:false,
      foundReservation:   null,
      cancelConfirmed:    false,
      availabilityDone:   false,
    };
  }

  // ────────────────────────────────────────────────
  // CONNESSIONE
  // ────────────────────────────────────────────────

  async connect() {
    return new Promise((resolve, reject) => {
      const url = `wss://api.openai.com/v1/realtime?model=${this.model}`;
      this.ws = new WebSocket(url, {
        headers: { 'Authorization': `Bearer ${this.apiKey}`, 'OpenAI-Beta': 'realtime=v1' }
      });
      this.ws.on('open',    ()    => { this.isConnected = true; this._initSession(); resolve(); });
      this.ws.on('message', data  => { this._handleMessage(JSON.parse(data.toString())); });
      this.ws.on('error',   err   => { this.onError(err); reject(err); });
      this.ws.on('close',   code  => { console.log(`🔴 OpenAI disconnesso (${code})`); this.isConnected = false; });
    });
  }

  // ────────────────────────────────────────────────
  // SESSIONE
  // ────────────────────────────────────────────────

  _initSession() {
    console.log('🟢 Connesso a OpenAI Realtime API');

    const instructions = this.systemPrompt + `

ISTRUZIONI:

Per prenotare raccogli IN QUESTO ORDINE, UNA COSA ALLA VOLTA:
1. Per quale giorno?
2. A che ora?
3. Per quante persone?
4. A che nome?
5. Email? (opzionale)
Poi chiama prepare_reservation. Poi aspetta "sì" e chiama create_reservation.

REGOLE ASSOLUTE:
- NON inventare dati (nomi, orari, date). Se non li hai, chiedi.
- NON dire "prenotazione confermata" senza che create_reservation risponda.
- NON chiamare prepare_reservation senza avere nome, data, orario e persone.
- I cognomi sono cognomi: "Cancelleri", "Sposta", "Annulli" non sono comandi.
- Per modifica/cancellazione: usa find_reservation prima di tutto.`;

    this._send({
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
        instructions,
        voice: 'alloy',
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        input_audio_transcription: { model: 'whisper-1', language: 'it' },
        turn_detection: { type: 'server_vad', threshold: 0.4, prefix_padding_ms: 300, silence_duration_ms: 1200 },
        // check_availability ESCLUSA — il server la chiama direttamente
        tools: this.tools
          .filter(t => t.name !== 'check_availability')
          .map(t => ({ type: 'function', name: t.name, description: t.description, parameters: t.parameters })),
      }
    });

    this.isResponseActive = true;
    this._send({ type: 'conversation.item.create', item: {
      type: 'message', role: 'user',
      content: [{ type: 'input_text', text: '[Cliente in linea. Saluta brevemente e chiedi come puoi aiutare.]' }]
    }});
    this._send({ type: 'response.create' });
  }

  // ────────────────────────────────────────────────
  // PARSE & STORE
  // ────────────────────────────────────────────────

  _parseAndStore(transcript) {
    const cd   = this.state.collectedData;
    const locked = this.state.pendingConfirmation;
    const prevDate = cd.date;

    // Intent — solo prima volta
    if (!this.state.initialIntent) {
      const intent = detectIntent(transcript);
      this.state.initialIntent = intent;
      if (intent === 'modify' || intent === 'cancel') this.state.phase = 'finding';
      console.log(`🎯 [SERVER] intent="${intent}" phase="${this.state.phase}"`);
    }

    // Data
    const date = parseDate(transcript);
    if (date && cd.date !== date) {
      console.log(`📅 [SERVER] date: "${cd.date}"→"${date}"`);
      cd.date = date;
      this.state.availabilityDone = false;
    }

    // Orario
    const time = parseTime(transcript);
    if (time && cd.time !== time) {
      console.log(`⏰ [SERVER] time: "${cd.time}"→"${time}"`);
      cd.time = time;
      this.state.availabilityDone = false;
    }

    // Persone
    const people = parsePeople(transcript);
    if (people && cd.people !== people) {
      console.log(`👥 [SERVER] people: ${cd.people}→${people}`);
      cd.people = people;
    }

    // Nome (con lock ma correzioni esplicite passano)
    const isExplicit = /\b(mi\s+chiamo|il\s+(?:mio\s+)?nome\s+[èe]|a\s+nome|sono\s+[A-Za-z])\s*/i.test(transcript);
    if (!locked || isExplicit) {
      const name = parseName(transcript);
      if (name && cd.name !== name) {
        console.log(`👤 [SERVER] name: "${cd.name}"→"${name}"`);
        cd.name = name;
        if (this.state.pendingReservation) this.state.pendingReservation.name = name;
      }
    }

    // Email
    if (!locked) {
      const email = parseEmail(transcript);
      if (email && cd.email !== email) { console.log(`📧 [SERVER] email→"${email}"`); cd.email = email; }
    }

    // Meal context
    if (!locked) {
      const mc = parseMealContext(transcript);
      if (mc && cd.mealContext !== mc) cd.mealContext = mc;
    }

    // Note
    const notes = parseNotes(transcript);
    if (notes) cd.notes = cd.notes ? `${cd.notes}; ${notes}` : notes;

    // Cancel confirm server-side
    if (this.state.phase === 'awaiting_cancel_confirm' && !this.state.cancelConfirmed) {
      if (isConfirmingCancellation(transcript) || isConfirming(transcript)) {
        this.state.cancelConfirmed = true;
        console.log(`✅ [SERVER] cancelConfirmed=true`);
      }
    }

    console.log(`📊 [SERVER] cd:`, JSON.stringify(cd));

    // Notifica giorno chiuso
    if (cd.date && cd.date !== prevDate) this._checkDayClosure(cd.date, cd.mealContext);

    // Auto-check disponibilità
    this._maybeCheckAvailability();

    // GUIDA RISPOSTA: se siamo in collecting e GPT sta generando liberamente,
    // cancelliamo e iniettiamo l'istruzione corretta per il prossimo dato da raccogliere.
    // Questo previene che GPT salti passi o improvvisi.
    if (this.state.phase === 'collecting' && !this.state.availabilityDone) {
      const instr = getPhaseInstructions(this.state);
      if (instr) {
        this._injectMessage(instr);
      }
    }
  }

  // ────────────────────────────────────────────────
  // CHECK DISPONIBILITÀ SERVER-SIDE
  // ────────────────────────────────────────────────

  _maybeCheckAvailability() {
    const cd = this.state.collectedData;
    if (this.state.phase !== 'collecting') return;
    if (this.state.initialIntent === 'modify' || this.state.initialIntent === 'cancel') return;
    if (!cd.date || !cd.time || !cd.people) return;
    if (this.state.availabilityDone) return;

    this.state.availabilityDone = true;
    console.log(`🔍 [SERVER] Auto-check: ${cd.date} ${cd.time} per ${cd.people}`);

    const tool = this.tools.find(t => t.name === 'check_availability');
    if (!tool) { console.error('❌ check_availability non trovato'); return; }

    tool.handler(
      { date: cd.date, time: cd.time, people: cd.people },
      { callSid: this.callSid, restaurantConfig: this.restaurantConfig, sessionState: this.state, callerPhone: this.callerPhone }
    ).then(result => {
      console.log(`✅ [SERVER] check:`, JSON.stringify(result));
      if (result.available) {
        const dateStr   = formatDateForSpeech(cd.date);
        const timeStr   = cd.time;
        const peopleStr = cd.people;

        // Se abbiamo già il nome → forza prepare_reservation direttamente
        // Se manca il nome → chiedilo. MAI "confermare" verbalmente senza chiamare i tool.
        const nameNow = this.state.collectedData.name;
        let instr;
        if (nameNow) {
          instr = `Slot disponibile per ${dateStr} alle ${timeStr} per ${peopleStr} persone a nome ${nameNow}. Chiama SUBITO prepare_reservation con questi dati. NON dire "prenotazione confermata" prima che prepare risponda.`;
        } else {
          instr = `Slot disponibile per ${dateStr} alle ${timeStr} per ${peopleStr} persone. Chiedi: "A che nome prenoto?" — poi quando il cliente risponde chiama prepare_reservation. NON dire "prenotazione confermata" senza chiamare i tool.`;
        }

        this._injectWithWait(
          `[disponibilità confermata: ${cd.date} ${timeStr} per ${peopleStr} persone]`,
          instr
        );
      } else if (result.reason === 'day_closed') {
        this._injectMessage(result.message || 'Giorno chiuso.');
        cd.date = null; this.state.availabilityDone = false;
      } else if (result.reason === 'slot_full') {
        this._injectWithWait(
          `[slot pieno: ${cd.date} ${cd.time}]`,
          `Lo slot delle ${cd.time} di ${formatDateForSpeech(cd.date)} è pieno. Comunicalo brevemente e chiedi se preferisce un altro orario.`
        );
        cd.time = null; this.state.availabilityDone = false;
      } else {
        this.state.availabilityDone = false;
      }
    }).catch(err => {
      console.error('❌ [SERVER] check error:', err);
      this.state.availabilityDone = false;
    });
  }

  _checkDayClosure(date, mealContext) {
    const dow = new Date(date + 'T12:00:00').getDay();
    const closingDays = this.restaurantConfig?.weekly_closing_days || [];
    const lunchClosed = this.restaurantConfig?.lunch_closed_days   || [];
    const dinnerClosed= this.restaurantConfig?.dinner_closed_days  || [];
    const g = ['domenica','lunedì','martedì','mercoledì','giovedì','venerdì','sabato'];
    if (closingDays.includes(dow)) {
      this._injectMessage(`Siamo chiusi il ${g[dow]}. Di': "Mi dispiace, siamo chiusi il ${g[dow]}. Per quale altro giorno posso aiutarla?"`);
      this.state.collectedData.date = null;
      this.state.availabilityDone = false;
    } else if (mealContext === 'pranzo' && lunchClosed.includes(dow)) {
      this._injectMessage(`Chiusi a pranzo il ${g[dow]}. Di': "Mi dispiace, il ${g[dow]} siamo aperti solo a cena."`);
    } else if (mealContext === 'cena' && dinnerClosed.includes(dow)) {
      this._injectMessage(`Chiusi a cena il ${g[dow]}. Di': "Mi dispiace, il ${g[dow]} siamo aperti solo a pranzo."`);
    }
  }

  _injectMessage(instructions) {
    if (this.isResponseActive) this._send({ type: 'response.cancel' });
    setTimeout(() => {
      this.isResponseActive = true;
      this._send({ type: 'response.create', response: { instructions } });
    }, this.isResponseActive ? 300 : 50);
  }

  _injectWithWait(contextText, instructions) {
    const doInject = (attempt = 0) => {
      if (!this.isResponseActive) {
        this._send({ type: 'conversation.item.create', item: {
          type: 'message', role: 'user',
          content: [{ type: 'input_text', text: contextText }]
        }});
        this.isResponseActive = true;
        this._send({ type: 'response.create', response: { instructions } });
      } else if (attempt < 20) {
        setTimeout(() => doInject(attempt + 1), 150);
      }
    };
    doInject();
  }

  // ────────────────────────────────────────────────
  // MESSAGE HANDLER
  // ────────────────────────────────────────────────

  _handleMessage(msg) {
    switch (msg.type) {
      case 'session.created':
        this.sessionId = msg.session.id;
        console.log(`📋 Sessione OpenAI: ${this.sessionId}`);
        break;
      case 'session.updated':
        console.log('✅ Sessione configurata');
        break;
      case 'response.audio.delta':
        this.isResponseActive = true;
        if (msg.delta) this.onAudioDelta(msg.delta);
        break;
      case 'response.audio_transcript.done':
        if (msg.transcript) {
          this.recentAiPhrases.unshift(msg.transcript);
          if (this.recentAiPhrases.length > 20) this.recentAiPhrases.pop();
          console.log(`💬 [assistant]: ${msg.transcript}`);
          this.onTranscript(msg.transcript, 'assistant');
        }
        break;
      case 'response.done':
        this.isResponseActive = false;
        this.lastAiFinishedTime = Date.now();
        if (msg.response?.status === 'failed') console.error('❌ Response failed:', msg.response.status_details);
        break;
      case 'input_audio_buffer.speech_started':
        console.log('🎤 Utente sta parlando...');
        break;
      case 'input_audio_buffer.speech_stopped':
        console.log('🎤 Utente ha finito di parlare');
        break;
      case 'conversation.item.input_audio_transcription.completed':
        if (msg.transcript) {
          const t = msg.transcript.trim();
          if (this._isEcho(t))     { console.log(`🔇 Echo ignorato`);  return; }
          if (isBackgroundNoise(t)){ console.log(`🔇 Rumore ignorato`); return; }
          console.log(`💬 [user]: ${t}`);
          this.onTranscript(t, 'user');
          this._parseAndStore(t);
        }
        break;
      case 'response.function_call_arguments.done':
        this._handleToolCall(msg);
        break;
      case 'error':
        if (msg.error?.code !== 'conversation_already_has_active_response') {
          console.error('❌ Errore OpenAI:', msg.error);
          this.onError(msg.error);
        }
        break;
      default:
        if (process.env.DEBUG_REALTIME) console.log(`📨 ${msg.type}`);
    }
  }

  // ────────────────────────────────────────────────
  // TOOL CALL HANDLER
  // ────────────────────────────────────────────────

  async _handleToolCall(msg) {
    const { call_id, name, arguments: argsStr } = msg;
    console.log(`🔧 Tool: ${name} [fase: ${this.state.phase}]`);
    console.log(`📊 cd:`, JSON.stringify(this.state.collectedData));

    let args;
    try { args = JSON.parse(argsStr); }
    catch(e) { console.warn(`⚠️ Tool ${name}: JSON malformato`); return; }

    const ALLOWED = {
      collecting:               ['prepare_reservation'],
      awaiting_confirm:         ['create_reservation', 'prepare_reservation'],
      finding:                  ['find_reservation'],
      awaiting_modify_details:  ['prepare_reservation', 'find_reservation'],
      awaiting_modify_confirm:  ['modify_reservation', 'prepare_reservation'],
      awaiting_cancel_confirm:  ['cancel_reservation'],
      completed:                [],
    };

    const allowed = ALLOWED[this.state.phase] || [];

    // BLOCCO HARD: prepare_reservation richiede cd.name dal server, non da GPT
    if (name === 'prepare_reservation' && !this.state.collectedData.name) {
      console.warn(`⛔ prepare bloccata: cd.name=null (GPT aveva: ${args.name})`);
      this._send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id, output: JSON.stringify({ ready: false, missing: 'name' }) } });
      this.isResponseActive = true;
      this._send({ type: 'response.create', response: { instructions: 'Dì SOLO: "A che nome prenoto?" — aspetta la risposta del cliente, non inventare nomi.' } });
      return;
    }
    if (!allowed.includes(name)) {
      console.warn(`⛔ "${name}" non permessa in fase "${this.state.phase}"`);
      const cd = this.state.collectedData;

      if (name === 'check_availability') {
        const serverCheckRunning = cd.date && cd.time && cd.people;

        if (serverCheckRunning) {
          // Server check in corso — dai istruzione ultra-specifica di aspettare in silenzio
          console.log(`⏳ check_availability bloccata — server check in corso`);
          this._send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id, output: JSON.stringify({ status: 'verifying' }) } });
          this.isResponseActive = true;
          this._send({ type: 'response.create', response: { instructions: 'Dì SOLO: "Un attimo..." — poi TACI e aspetta il risultato della verifica. NON aggiungere nulla.' } });
        } else {
          // Mancano dati — di' esattamente quale domanda fare
          let exact_phrase;
          if (!cd.date)        exact_phrase = 'Dì SOLO: "Per quale giorno vuole prenotare?"';
          else if (!cd.time)   exact_phrase = 'Dì SOLO: "A che ora preferisce?"';
          else if (!cd.people) exact_phrase = 'Dì SOLO: "Per quante persone?"';
          else                 exact_phrase = 'Dì SOLO: "Un attimo..."';
          console.log(`📋 check_availability bloccata — dati mancanti → "${exact_phrase}"`);
          this._send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id, output: JSON.stringify({ status: 'missing_data' }) } });
          this.isResponseActive = true;
          this._send({ type: 'response.create', response: { instructions: exact_phrase } });
        }
        return;
      }

      // Altri tool bloccati
      let blocked_msg = `Tool "${name}" non permessa in questa fase.`;
      if (name === 'create_reservation') {
        blocked_msg = `Devi chiamare prepare_reservation prima. Dati disponibili: data=${cd.date}, orario=${cd.time}, persone=${cd.people}, nome=${cd.name}. Chiama prepare_reservation ORA.`;
      }
      this._send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id, output: JSON.stringify({ blocked: true, message: blocked_msg }) } });
      this.isResponseActive = true;
      this._send({ type: 'response.create', response: { instructions: blocked_msg } });
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
      console.log(`✅ [${name}]:`, JSON.stringify(result).substring(0, 200));

      // Avanza fase
      const prev = this.state.phase;
      if (name === 'prepare_reservation' && result.ready)        this.state.phase = 'awaiting_confirm';
      else if (name === 'create_reservation' && result.success)  this.state.phase = 'completed';
      else if (name === 'find_reservation' && result.found) {
        this.state.phase = this.state.initialIntent === 'cancel' ? 'awaiting_cancel_confirm' : 'awaiting_modify_details';
      }
      else if (name === 'modify_reservation' && result.success)  this.state.phase = 'completed';
      else if (name === 'cancel_reservation' && result.success)  this.state.phase = 'completed';

      if (this.state.phase !== prev) console.log(`📍 Fase: "${prev}"→"${this.state.phase}"`);

      // Istruzione post-tool
      let instr = getPhaseInstructions(this.state);

      if (name === 'prepare_reservation' && result.ready === false) {
        // Race condition: _parseAndStore sta ancora aggiornando cd.name
        // Aspetta 300ms prima di rispondere
        await new Promise(r => setTimeout(r, 300));
        const cd = this.state.collectedData;
        if (!cd.name)   instr = 'Chiedi: "A che nome prenoto?"';
        else if (!cd.date)   instr = 'Chiedi: "Per quale giorno?"';
        else if (!cd.time)   instr = 'Chiedi: "A che ora preferisce?"';
        else if (!cd.people) instr = 'Chiedi: "Per quante persone?"';
        else {
          // Nome arrivato durante l'attesa — richiama prepare
          instr = `Hai tutti i dati: ${cd.date}, ${cd.time}, ${cd.people} persone, nome ${cd.name}. Chiama prepare_reservation ORA.`;
        }
      }

      this._send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id, output: JSON.stringify(result) } });
      this.isResponseActive = true;
      this._send(instr ? { type: 'response.create', response: { instructions: instr } } : { type: 'response.create' });

    } catch(err) {
      console.error(`❌ Tool error [${name}]:`, err);
      this._send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id, output: JSON.stringify({ error: err.message }) } });
      this.isResponseActive = true;
      this._send({ type: 'response.create' });
    }
  }

  // ────────────────────────────────────────────────
  // ECHO DETECTION
  // ────────────────────────────────────────────────

  _isEcho(userText) {
    if (!userText) return true;
    const trimmed = userText.trim();
    if (trimmed.length <= 20) return false;
    const userWords = trimmed.toLowerCase().replace(/[.,!?;:'"()]/g,'').split(/\s+/).filter(w=>w.length>1);
    if (userWords.length <= 3) return false;
    if (Date.now() - this.lastAiFinishedTime > this.ECHO_WINDOW_MS) return false;
    for (const phrase of this.recentAiPhrases) {
      const aiWords = phrase.toLowerCase().replace(/[.,!?;:'"()]/g,'').split(/\s+/).filter(w=>w.length>1);
      if (!aiWords.length) continue;
      const matches = userWords.filter(w => aiWords.includes(w)).length;
      if (matches / userWords.length > 0.75 && matches >= 6) return true;
    }
    return false;
  }

  // ────────────────────────────────────────────────
  // AUDIO
  // ────────────────────────────────────────────────

  sendAudio(audioBase64) {
    if (!this.isConnected) return;
    this.audioSendCount++;
    if (this.audioSendCount <= 3) console.log(`📤 Invio audio #${this.audioSendCount} a OpenAI`);
    this._send({ type: 'input_audio_buffer.append', audio: audioBase64 });
  }

  _send(message) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  disconnect() {
    if (this.ws) { this.ws.close(); this.ws = null; }
    this.isConnected = false;
  }
}

export default OpenAIRealtimeClient;
