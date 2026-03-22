// ═══════════════════════════════════════════════════════════════════════════════
// PRENOW - OPENAI REALTIME CLIENT v10.0.0 — MINIMAL
// Obiettivo: raccogliere data, orario, persone. Nient'altro.
// ═══════════════════════════════════════════════════════════════════════════════

import WebSocket from 'ws';

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY
// ─────────────────────────────────────────────────────────────────────────────

function getNowRome() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Rome' }));
}

function toISO(date) {
  if (!date || isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function normalizeText(str) {
  return (str || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// ─────────────────────────────────────────────────────────────────────────────
// PARSER DATA
// ─────────────────────────────────────────────────────────────────────────────

function parseDate(text) {
  if (!text) return null;
  const t = normalizeText(text);
  const now = getNowRome();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // DD/MM
  const slash = t.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  if (slash) {
    const day = parseInt(slash[1]), month = parseInt(slash[2]) - 1;
    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      let c = new Date(today.getFullYear(), month, day);
      if (c < today) c = new Date(today.getFullYear() + 1, month, day);
      return toISO(c);
    }
  }

  // "10 marzo"
  const months = {
    'gennaio':0,'febbraio':1,'marzo':2,'aprile':3,'maggio':4,'giugno':5,
    'luglio':6,'agosto':7,'settembre':8,'ottobre':9,'novembre':10,'dicembre':11,
  };
  const allM = Object.keys(months).join('|');
  const mEx = t.match(new RegExp(`(\\d{1,2})\\s*(?:di\\s+)?(${allM})`));
  if (mEx) {
    const day = parseInt(mEx[1]), mon = months[mEx[2]];
    if (mon !== undefined && day >= 1 && day <= 31) {
      let c = new Date(today.getFullYear(), mon, day);
      if (c < today) c = new Date(today.getFullYear() + 1, mon, day);
      return toISO(c);
    }
  }

  // Relativi
  if (/dopodomani|dopo\s*domani/.test(t)) return toISO(addDays(today, 2));
  if (/\bdomani\b/.test(t))               return toISO(addDays(today, 1));
  if (/\boggi\b|\bstasera\b|\bquesta\s*sera\b/.test(t)) return toISO(today);

  const tra = t.match(/(?:tra|fra|in)\s*(\d+)\s*giorni/);
  if (tra) return toISO(addDays(today, parseInt(tra[1])));

  // Giorno settimana
  const wdAll = [
    { p: ['domenica','sunday'],     i: 0 },
    { p: ['lunedi','monday'],       i: 1 },
    { p: ['martedi','tuesday'],     i: 2 },
    { p: ['mercoledi','wednesday'], i: 3 },
    { p: ['giovedi','thursday'],    i: 4 },
    { p: ['venerdi','friday'],      i: 5 },
    { p: ['sabato','saturday'],     i: 6 },
  ];

  // "sabato 15"
  for (const wd of wdAll) {
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

  // Solo giorno settimana (ultimo menzionato)
  let lastIdx = -1, lastPos = -1;
  for (const wd of wdAll) {
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
  const isLunch   = /\bpranzo\b|\blunch\b/.test(t);
  const isEvening = /\bcena\b|\bdinner\b|\bstasera\b|\bsera\b/.test(t);

  if (/mezzogiorno|noon/.test(t))         return '12:00';
  if (/mezzanotte|midnight/.test(t))      return '00:00';
  if (/\bl['']una\b|all'una\b/i.test(t)) return '13:00';

  const rel = _parseRelativeTime(t);
  if (rel) return rel;

  const HOUR_W = {
    'una':1,'uno':1,'due':2,'tre':3,'quattro':4,'cinque':5,'sei':6,'sette':7,
    'otto':8,'nove':9,'dieci':10,'undici':11,'dodici':12,'tredici':13,
    'quattordici':14,'quindici':15,'sedici':16,'diciassette':17,'diciotto':18,
    'diciannove':19,'venti':20,'ventuno':21,'ventidue':22,'ventitre':23,'ventitré':23,
  };
  const MIN_W = {
    'mezza':30,'mezzo':30,'trenta':30,'quindici':15,'quarantacinque':45,
    'quaranta':40,'venti':20,'dieci':10,'cinque':5,'un quarto':15,
  };

  let allTimes = [];
  let m;

  // "alle sette e mezza"
  const allHW = Object.keys(HOUR_W).join('|');
  const reW = new RegExp(`(?:alle|ore|per le|at)\\s+(${allHW})(?:\\s+e\\s+(un quarto|mezza|mezzo|trenta|quindici|quarantacinque|quaranta|venti|dieci|cinque))?`, 'gi');
  while ((m = reW.exec(t)) !== null) {
    let h = HOUR_W[m[1].toLowerCase()];
    if (h === undefined) continue;
    const minKey = m[2]?.toLowerCase();
    const min = minKey ? (MIN_W[minKey] || 0) : 0;
    if (h >= 1 && h <= 11 && !isLunch) h += 12;
    if (h >= 0 && h <= 23) allTimes.push({ pos: m.index, time: `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}` });
  }

  // "alle HH:MM" / "alle HH.MM"
  const re1 = /(?:alle|ore|per le|at)\s*(\d{1,2})[\.:](\d{2})/gi;
  while ((m = re1.exec(t)) !== null) {
    let h = parseInt(m[1]), min = parseInt(m[2]);
    if (h >= 1 && h <= 11 && !isLunch) h += 12;
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59)
      allTimes.push({ pos: m.index, time: `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}` });
  }

  // "alle HH" — escludi se seguito da parola-persona
  const re2 = /(?:alle|ore|per le|at)\s*(\d{1,2})\b/gi;
  while ((m = re2.exec(t)) !== null) {
    const after = t.substring(m.index + m[0].length).trimStart();
    if (/^person[ae]\b|^pax\b|^coperti\b|^ospiti\b/i.test(after)) continue;
    let h = parseInt(m[1]);
    if (h >= 1 && h <= 11 && !isLunch) h += 12;
    if (h >= 0 && h <= 23) allTimes.push({ pos: m.index, time: `${String(h).padStart(2,'0')}:00` });
  }

  // "HH e mezza / quarto / ..."
  const reEM_keys = Object.keys(MIN_W).filter(k => !k.includes(' ')).join('|');
  const reEM = new RegExp(`(?:alle|ore)?\\s*(\\d{1,2})\\s+e\\s+(${reEM_keys})\\b`, 'gi');
  while ((m = reEM.exec(t)) !== null) {
    let h = parseInt(m[1]);
    const min = MIN_W[m[2].toLowerCase()] || 0;
    if (h >= 1 && h <= 11 && !isLunch) h += 12;
    if (h >= 0 && h <= 23) allTimes.push({ pos: m.index, time: `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}` });
  }

  // Standalone "HH:MM"
  const re3 = /\b(\d{1,2})[\.:](\d{2})\b/g;
  while ((m = re3.exec(t)) !== null) {
    let h = parseInt(m[1]), min = parseInt(m[2]);
    if ((isEvening || !isLunch) && h >= 1 && h <= 11) h += 12;
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59)
      allTimes.push({ pos: m.index, time: `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}` });
  }

  if (allTimes.length === 0) return isLunch ? '13:00' : null;

  // Fix negazione: "non le 21 ma le 21:30"
  if (allTimes.length >= 2) {
    const negRe = /\b(non|no)\b/gi;
    let neg;
    while ((neg = negRe.exec(t)) !== null) {
      const negated = allTimes.find(x => x.pos > neg.index && x.pos < neg.index + 25);
      if (negated) {
        const remaining = allTimes.filter(x => x !== negated);
        if (remaining.length > 0) return remaining[remaining.length - 1].time;
      }
    }
  }

  allTimes.sort((a, b) => a.pos - b.pos);
  return allTimes[allTimes.length - 1].time;
}

function _parseRelativeTime(text) {
  const now = getNowRome();
  const patterns = [
    { re: /tra\s+mezz['']?\s*ora|fra\s+mezz['']?\s*ora/i, mins: 30 },
    { re: /tra\s+un['']?\s*ora|fra\s+un['']?\s*ora/i,     mins: 60 },
    { re: /tra\s+(\d+)\s*minut|fra\s+(\d+)\s*minut/i,    extract: true },
    { re: /tra\s+(\d+)\s*ore|fra\s+(\d+)\s*ore/i,        extract: true, hours: true },
  ];
  for (const p of patterns) {
    const match = text.match(p.re);
    if (match) {
      const offset = p.extract
        ? (p.hours ? parseInt(match[1] || match[2]) * 60 : parseInt(match[1] || match[2]))
        : p.mins;
      const target = new Date(now.getTime() + offset * 60000);
      const r = Math.ceil(target.getMinutes() / 15) * 15;
      target.setMinutes(r % 60);
      if (r >= 60) target.setHours(target.getHours() + 1);
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

  if (/ci sei|ci siete|mi senti|pronto|come stai/i.test(t)) return null;

  // "anzi" → ultimo numero
  if (/anzi|no aspetta|facciamo|meglio|diciamo/i.test(t)) {
    const nums = t.match(/\b(\d+)\b/g);
    if (nums && nums.length >= 2) {
      const n = parseInt(nums[nums.length - 1]);
      if (n > 0 && n < 100) return n;
    }
  }

  const patterns = [
    /(\d+)\s*in\s*totale/i,
    /siamo\s*(?:in\s*)?(\d+)/i,
    /(?:per|saremo)\s*(\d+)\s*(?:person[ae]|pax|coperti|guests|people)?/i,
    /(\d+)\s*(?:person[ae]|pax|coperti|guests|people)/i,
    /(?:tavolo|table)\s*(?:per|for)\s*(\d+)/i,
  ];
  for (const p of patterns) {
    const m = t.match(p);
    if (m) { const n = parseInt(m[1]); if (n > 0 && n < 100) return n; }
  }

  // Numeri in lettere — solo se non è contesto temporale
  const isTimeContext = /(?:alle|ore|per le|mezzogiorno|mezzanotte|pranzo|cena|mattina|sera|pomeriggio|\d\s*:\s*\d|\d\s*e\s*(?:mezza|mezzo|quarto))/i.test(t);
  if (!isTimeContext) {
    const words = { 'due':2,'tre':3,'quattro':4,'cinque':5,'sei':6,'sette':7,'otto':8,'nove':9,'dieci':10 };
    for (const [w, n] of Object.entries(words)) {
      if (new RegExp(`\\b${w}\\b`).test(t)) return n;
    }
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// RUMORE
// ─────────────────────────────────────────────────────────────────────────────

function isBackgroundNoise(text) {
  if (!text || text.trim().length < 3) return true;
  return /sottotitoli|amara\.org|copyright|subtitles?\s+by/i.test(text);
}

// ─────────────────────────────────────────────────────────────────────────────
// CLASSE PRINCIPALE
// ─────────────────────────────────────────────────────────────────────────────

export class OpenAIRealtimeClient {
  constructor(options) {
    this.apiKey           = options.apiKey;
    this.model            = options.model || 'gpt-4o-mini-realtime-preview';
    this.systemPrompt     = options.systemPrompt || '';
    this.restaurantConfig = options.restaurantConfig;
    this.callerPhone      = options.callerPhone || null;
    this.onAudioDelta     = options.onAudioDelta || (() => {});
    this.onTranscript     = options.onTranscript  || (() => {});
    this.onError          = options.onError       || console.error;

    this.ws          = null;
    this.isConnected = false;
    this.sessionId   = null;

    // Echo detection
    this.recentAiPhrases    = [];
    this.lastAiFinishedTime = 0;
    this.ECHO_WINDOW_MS     = 2500;

    // I 3 dati
    this.collected = { date: null, time: null, people: null };
    this.allCollected = false;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      const url = `wss://api.openai.com/v1/realtime?model=${this.model}`;
      this.ws = new WebSocket(url, {
        headers: { 'Authorization': `Bearer ${this.apiKey}`, 'OpenAI-Beta': 'realtime=v1' }
      });
      this.ws.on('open',    ()   => { this.isConnected = true; this._initSession(); resolve(); });
      this.ws.on('message', data => { this._handleMessage(JSON.parse(data.toString())); });
      this.ws.on('error',   err  => { this.onError(err); reject(err); });
      this.ws.on('close',   code => { console.log(`🔴 OpenAI disconnesso (${code})`); this.isConnected = false; });
    });
  }

  _initSession() {
    console.log('🟢 Connesso a OpenAI Realtime API');
    this._send({
      type: 'session.update',
      session: {
        modalities:  ['text', 'audio'],
        instructions: this.systemPrompt,
        voice:        'alloy',
        input_audio_format:  'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        input_audio_transcription: { model: 'whisper-1', language: 'it' },
        turn_detection: {
          type:                'server_vad',
          threshold:           0.4,
          prefix_padding_ms:   300,
          silence_duration_ms: 1200,
        },
        tools: [],
      }
    });

    this._send({
      type: 'conversation.item.create',
      item: {
        type: 'message', role: 'user',
        content: [{ type: 'input_text', text: '[Cliente in linea. Saluta cordialmente e chiedi per quale giorno vuole prenotare.]' }]
      }
    });
    this._send({ type: 'response.create' });
  }

  _handleMessage(msg) {
    switch (msg.type) {

      case 'session.created':
        this.sessionId = msg.session.id;
        console.log(`📋 Sessione: ${this.sessionId}`);
        break;

      case 'session.updated':
        console.log('✅ Sessione configurata');
        break;

      case 'response.audio.delta':
        if (msg.delta) this.onAudioDelta(msg.delta);
        break;

      case 'response.audio_transcript.done':
        if (msg.transcript) {
          this.recentAiPhrases.unshift(msg.transcript);
          if (this.recentAiPhrases.length > 10) this.recentAiPhrases.pop();
          this.lastAiFinishedTime = Date.now();
          console.log(`💬 [assistant]: ${msg.transcript}`);
          this.onTranscript(msg.transcript, 'assistant');
        }
        break;

      case 'input_audio_buffer.speech_started':
        console.log('🎤 Utente parla...');
        break;

      case 'input_audio_buffer.speech_stopped':
        console.log('🎤 Utente finito');
        break;

      case 'conversation.item.input_audio_transcription.completed':
        if (msg.transcript) {
          const t = msg.transcript.trim();
          if (this._isEcho(t))      { console.log(`🔇 Echo: "${t.substring(0,40)}"`);   return; }
          if (isBackgroundNoise(t)) { console.log(`🔇 Rumore: "${t.substring(0,40)}"`); return; }
          console.log(`💬 [user]: ${t}`);
          this.onTranscript(t, 'user');
          this._onTranscription(t);
        }
        break;

      case 'response.done':
        if (msg.response?.status === 'failed')
          console.error('❌ Response failed:', msg.response.status_details);
        break;

      case 'error':
        if (msg.error?.code !== 'conversation_already_has_active_response') {
          console.error('❌ OpenAI error:', msg.error);
          this.onError(msg.error);
        }
        break;

      default:
        if (process.env.DEBUG_REALTIME) console.log(`📨 ${msg.type}`);
    }
  }

  _onTranscription(transcript) {
    if (this.allCollected) return;

    // Data
    const date = parseDate(transcript);
    if (date && date !== this.collected.date) {
      console.log(`📅 date: "${this.collected.date}" → "${date}"`);
      this.collected.date = date;
    }

    // Orario
    const time = parseTime(transcript);
    if (time && time !== this.collected.time) {
      console.log(`⏰ time: "${this.collected.time}" → "${time}"`);
      this.collected.time = time;
    }

    // Persone
    const people = parsePeople(transcript);
    if (people && people !== this.collected.people) {
      console.log(`👥 people: ${this.collected.people} → ${people}`);
      this.collected.people = people;
    }

    console.log(`📊 collected: date=${this.collected.date} time=${this.collected.time} people=${this.collected.people}`);

    // Tutti e 3 pronti
    if (this.collected.date && this.collected.time && this.collected.people) {
      this.allCollected = true;
      console.log(`✅ COMPLETO:`, JSON.stringify(this.collected));
      this._send({
        type: 'conversation.item.create',
        item: {
          type: 'message', role: 'user',
          content: [{ type: 'input_text', text: `[SISTEMA: dati raccolti — data=${this.collected.date}, orario=${this.collected.time}, persone=${this.collected.people}. Di' solo "Perfetto, ho tutti i dati!"]` }]
        }
      });
      this._send({ type: 'response.create' });
    }
  }

  _isEcho(userText) {
    if (!userText) return true;
    const trimmed = userText.trim();
    if (trimmed.length <= 20) return false;
    const userWords = trimmed.toLowerCase().replace(/[.,!?;:'"()]/g,'').split(/\s+/).filter(w => w.length > 1);
    if (userWords.length <= 3) return false;
    if (Date.now() - this.lastAiFinishedTime > this.ECHO_WINDOW_MS) return false;
    for (const phrase of this.recentAiPhrases) {
      const aiWords = phrase.toLowerCase().replace(/[.,!?;:'"()]/g,'').split(/\s+/).filter(w => w.length > 1);
      if (!aiWords.length) continue;
      const matches = userWords.filter(w => aiWords.includes(w)).length;
      if (matches / userWords.length > 0.75 && matches >= 6) return true;
    }
    return false;
  }

  sendAudio(audioBase64) {
    if (!this.isConnected) return;
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
