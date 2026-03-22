import WebSocket from 'ws';

// ─── UTILITY ──────────────────────────────────────────────────────────────────

const DAY_IT = ['domenica','lunedì','martedì','mercoledì','giovedì','venerdì','sabato'];

function getNowRome() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Rome' }));
}

function toISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function addDays(d, n) {
  const r = new Date(d); r.setDate(r.getDate() + n); return r;
}

function norm(s) {
  return (s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function timeToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(m) {
  return `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
}

function isNoise(text) {
  if (!text || text.trim().length < 3) return true;
  return /sottotitoli|amara\.org|copyright/i.test(text);
}

// ─── PARSER DATA ──────────────────────────────────────────────────────────────

function parseDate(text) {
  if (!text) return null;
  const t = norm(text);
  const now = getNowRome();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // DD/MM
  const s = t.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  if (s) {
    const d = parseInt(s[1]), mo = parseInt(s[2])-1;
    if (mo>=0 && mo<=11 && d>=1 && d<=31) {
      let c = new Date(today.getFullYear(), mo, d);
      if (c < today) c = new Date(today.getFullYear()+1, mo, d);
      return toISO(c);
    }
  }

  // "10 marzo"
  const MO = { gennaio:0,febbraio:1,marzo:2,aprile:3,maggio:4,giugno:5,luglio:6,agosto:7,settembre:8,ottobre:9,novembre:10,dicembre:11 };
  const me = t.match(new RegExp(`(\\d{1,2})\\s*(?:di\\s+)?(${Object.keys(MO).join('|')})`));
  if (me) {
    const d = parseInt(me[1]), mo = MO[me[2]];
    if (d>=1 && d<=31) {
      let c = new Date(today.getFullYear(), mo, d);
      if (c < today) c = new Date(today.getFullYear()+1, mo, d);
      return toISO(c);
    }
  }

  // Relativi
  if (/dopodomani|dopo\s*domani/.test(t)) return toISO(addDays(today,2));
  if (/\bdomani\b/.test(t))               return toISO(addDays(today,1));
  if (/\boggi\b|\bstasera\b|\bquesta\s*sera\b/.test(t)) return toISO(today);

  const tra = t.match(/(?:tra|fra)\s*(\d+)\s*giorni/);
  if (tra) return toISO(addDays(today, parseInt(tra[1])));

  // Giorni settimana
  const WD = [
    {p:['domenica'],i:0},{p:['lunedi'],i:1},{p:['martedi'],i:2},
    {p:['mercoledi'],i:3},{p:['giovedi'],i:4},{p:['venerdi'],i:5},{p:['sabato'],i:6}
  ];

  // "sabato 15"
  for (const wd of WD) for (const p of wd.p) {
    const m = t.match(new RegExp(`\\b${p}\\s+(\\d{1,2})\\b`));
    if (m) {
      const n = parseInt(m[1]);
      if (n>=1 && n<=31) {
        let c = new Date(today.getFullYear(), today.getMonth(), n);
        if (c < today) c = new Date(today.getFullYear(), today.getMonth()+1, n);
        return toISO(c);
      }
    }
  }

  // Solo giorno settimana (ultimo menzionato)
  let li=-1, lp=-1;
  for (const wd of WD) for (const p of wd.p) {
    const pos = t.lastIndexOf(p);
    if (pos > lp) { lp=pos; li=wd.i; }
  }
  if (li !== -1) {
    const diff = ((li - today.getDay())+7)%7;
    return toISO(addDays(today, diff===0 ? 7 : diff));
  }

  return null;
}

// ─── PARSER ORARIO ────────────────────────────────────────────────────────────

function parseTime(text) {
  if (!text) return null;
  const t = text.toLowerCase().trim();
  const isLunch = /\bpranzo\b|\blunch\b/.test(t);

  if (/mezzogiorno/.test(t)) return '12:00';
  if (/mezzanotte/.test(t))  return '00:00';
  if (/\bl['']una\b|all'una\b/i.test(t)) return '13:00';

  const HWMAP = {
    'una':1,'uno':1,'due':2,'tre':3,'quattro':4,'cinque':5,'sei':6,'sette':7,
    'otto':8,'nove':9,'dieci':10,'undici':11,'dodici':12,'tredici':13,
    'quattordici':14,'quindici':15,'sedici':16,'diciassette':17,'diciotto':18,
    'diciannove':19,'venti':20,'ventuno':21,'ventidue':22,'ventitre':23
  };
  const MWMAP = {
    'mezza':30,'mezzo':30,'trenta':30,'quindici':15,'quarantacinque':45,
    'quaranta':40,'venti':20,'dieci':10,'cinque':5,'un quarto':15
  };

  const times = [];
  let m;

  // "alle sette e mezza" / "alle sette e un quarto"
  const allHW = Object.keys(HWMAP).join('|');
  const rW = new RegExp(`(?:alle|ore|per le)\\s+(${allHW})(?:\\s+e\\s+(un quarto|mezza|mezzo|trenta|quindici|quarantacinque|quaranta|venti|dieci|cinque))?`, 'gi');
  while ((m=rW.exec(t))!==null) {
    let h = HWMAP[m[1].toLowerCase()]; if (!h) continue;
    const minKey = m[2]?.toLowerCase();
    const min = minKey ? (MWMAP[minKey]||0) : 0;
    if (h>=1 && h<=11 && !isLunch) h+=12;
    times.push({pos:m.index, t:`${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`});
  }

  // "alle HH:MM" / "alle HH.MM"
  const r1 = /(?:alle|ore|per le)\s*(\d{1,2})[\.:](\d{2})/gi;
  while ((m=r1.exec(t))!==null) {
    let h=parseInt(m[1]), min=parseInt(m[2]);
    if (h>=1&&h<=11&&!isLunch) h+=12;
    if (h>=0&&h<=23&&min>=0&&min<=59) times.push({pos:m.index, t:`${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`});
  }

  // "alle HH" — NON cattura se seguito da parola-persona
  const r2 = /(?:alle|ore|per le)\s*(\d{1,2})\b/gi;
  while ((m=r2.exec(t))!==null) {
    const after = t.substring(m.index+m[0].length).trimStart();
    if (/^person[ae]\b|^pax\b|^coperti\b/i.test(after)) continue;
    let h=parseInt(m[1]);
    if (h>=1&&h<=11&&!isLunch) h+=12;
    if (h>=0&&h<=23) times.push({pos:m.index, t:`${String(h).padStart(2,'0')}:00`});
  }

  // "HH e mezza/quarto/..." — include "un quarto"
  const mwk = Object.keys(MWMAP).filter(k=>!k.includes(' ')).join('|');
  const rEM = new RegExp(`(?:alle|ore)?\\s*(\\d{1,2})\\s+(?:e\\s+|è\\s+)?(un quarto|${mwk})\\b`, 'gi');
  while ((m=rEM.exec(t))!==null) {
    let h=parseInt(m[1]);
    const min = MWMAP[m[2].toLowerCase()]||0;
    if (h>=1&&h<=11&&!isLunch) h+=12;
    if (h>=0&&h<=23) times.push({pos:m.index, t:`${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`});
  }

  // "HH:MM" standalone
  const r3 = /\b(\d{1,2})[\.:](\d{2})\b/g;
  while ((m=r3.exec(t))!==null) {
    let h=parseInt(m[1]), min=parseInt(m[2]);
    if (h>=1&&h<=11&&!isLunch) h+=12;
    if (h>=0&&h<=23&&min>=0&&min<=59) times.push({pos:m.index, t:`${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`});
  }

  if (times.length===0) return isLunch ? '13:00' : null;

  // Fix negazione: "non le 21 ma le 21:30"
  if (times.length >= 2) {
    const negRe = /\b(non|no)\b/gi;
    let neg;
    while ((neg=negRe.exec(t))!==null) {
      const negated = times.find(x => x.pos > neg.index && x.pos < neg.index+25);
      if (negated) {
        const remaining = times.filter(x => x !== negated);
        if (remaining.length > 0) return remaining[remaining.length-1].t;
      }
    }
  }

  times.sort((a,b) => a.pos-b.pos);
  return times[times.length-1].t;
}

// ─── PARSER PERSONE ───────────────────────────────────────────────────────────

function parsePeople(text) {
  if (!text) return null;
  const t = text.toLowerCase();

  if (/ci sei|ci siete|mi senti|pronto|come stai/i.test(t)) return null;

  // "anzi" → ultimo numero
  if (/anzi|no aspetta|facciamo|meglio|diciamo/i.test(t)) {
    const nums = t.match(/\b(\d+)\b/g);
    if (nums?.length >= 2) { const n=parseInt(nums[nums.length-1]); if (n>0&&n<100) return n; }
  }

  // Numero + parola-persona (priorità massima, anche con orario nella frase)
  const m1 = t.match(/(\d+)\s*(?:person[ae]|pax|coperti)/i);
  if (m1) { const n=parseInt(m1[1]); if (n>0&&n<100) return n; }

  // Parola-numero + parola-persona (priorità massima)
  const WN = { 'due':2,'tre':3,'quattro':4,'cinque':5,'sei':6,'sette':7,'otto':8,'nove':9,'dieci':10 };
  for (const [w,n] of Object.entries(WN)) {
    if (new RegExp(`\\b${w}\\s+(?:person[ae]|pax|coperti)\\b`).test(t)) return n;
  }

  // Pattern numerici
  const patterns = [
    /(\d+)\s*in\s*totale/i,
    /siamo\s*(?:in\s*)?(\d+)/i,
    /(?:per|saremo)\s*(\d+)(?:\s+(?:person[ae]|pax|coperti))?/i,
    /(?:tavolo|table)\s*(?:per|for)\s*(\d+)/i,
  ];
  for (const p of patterns) {
    const m=t.match(p); if (m) { const n=parseInt(m[1]); if (n>0&&n<100) return n; }
  }

  // Parola-numero standalone — solo se non è contesto temporale
  const isTime = /(?:alle|ore|per le|mezzogiorno|mezzanotte|\d\s*:\s*\d|\d\s*e\s*(?:mezza|mezzo|quarto))/i.test(t);
  if (!isTime) {
    for (const [w,n] of Object.entries(WN)) {
      if (new RegExp(`\\b${w}\\b`).test(t)) return n;
    }
  }

  return null;
}

// ─── CHECK ① giorno chiuso ────────────────────────────────────────────────────

function checkDayClosed(date, rc) {
  const dow = new Date(date + 'T12:00:00').getDay();
  if ((rc.weekly_closing_days||[]).includes(dow)) {
    return `Siamo chiusi il ${DAY_IT[dow]}. Comunicalo al cliente e chiedi un altro giorno.`;
  }
  return null;
}

// ─── CHECK ②③ fascia + range ─────────────────────────────────────────────────

function checkTimeFeasibility(date, time, rc) {
  const dow  = new Date(date + 'T12:00:00').getDay();
  const mins = timeToMinutes(time);
  const isLunch = mins < 15 * 60;

  if (isLunch) {
    if ((rc.lunch_closed_days||[]).includes(dow)) {
      return `Siamo chiusi a pranzo il ${DAY_IT[dow]}. Comunicalo e chiedi se vuole venire a cena o in un altro giorno.`;
    }
    const start = timeToMinutes(rc.lunch_start||'12:00');
    const end   = timeToMinutes(rc.lunch_end  ||'14:30');
    if (mins < start || mins >= end) {
      return `L'orario ${time} è fuori dalla fascia pranzo (${rc.lunch_start||'12:00'}-${rc.lunch_end||'14:30'}). Comunica gli orari corretti e chiedi un nuovo orario.`;
    }
  } else {
    if ((rc.dinner_closed_days||[]).includes(dow)) {
      return `Siamo chiusi a cena il ${DAY_IT[dow]}. Comunicalo e chiedi se vuole venire a pranzo o in un altro giorno.`;
    }
    const start = timeToMinutes(rc.dinner_start||'19:00');
    const end   = timeToMinutes(rc.dinner_end  ||'22:30');
    if (mins < start || mins >= end) {
      return `L'orario ${time} è fuori dalla fascia cena (${rc.dinner_start||'19:00'}-${rc.dinner_end||'22:30'}). Comunica gli orari corretti e chiedi un nuovo orario.`;
    }
  }
  return null;
}

// ─── CHECK ④ Apps Script ─────────────────────────────────────────────────────

async function checkSlot(date, time, people, rc) {
  const url = rc.apps_script_url;
  if (!url) {
    console.warn('⚠️ apps_script_url mancante — slot considerato disponibile');
    return { available: true };
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'check_availability',
        data: date, ora: time, persone: people,
        calendarId: rc.calendar_id
      })
    });
    const json = await res.json();
    return json.success ? { available: true } : { available: false, reason: json.reason||'slot_full' };
  } catch(e) {
    console.error('❌ checkSlot error:', e);
    return { available: true }; // fail-open
  }
}

async function findAlternative(date, time, people, rc) {
  const base     = timeToMinutes(time);
  const isLunch  = base < 15 * 60;
  const rangeStart = timeToMinutes(isLunch ? (rc.lunch_start||'12:00')  : (rc.dinner_start||'19:00'));
  const rangeEnd   = timeToMinutes(isLunch ? (rc.lunch_end  ||'14:30')  : (rc.dinner_end  ||'22:30'));

  for (const offset of [30, -30, 60, -60]) {
    const candidate = base + offset;
    if (candidate < rangeStart || candidate >= rangeEnd) continue;
    const ct = minutesToTime(candidate);
    const r = await checkSlot(date, ct, people, rc);
    if (r.available) return ct;
  }
  return null;
}

// ─── CLIENT ───────────────────────────────────────────────────────────────────

export class OpenAIRealtimeClient {
  constructor(opts) {
    this.apiKey           = opts.apiKey;
    this.model            = opts.model || 'gpt-4o-mini-realtime-preview';
    this.systemPrompt     = opts.systemPrompt || '';
    this.restaurantConfig = opts.restaurantConfig || {};
    this.callerPhone      = opts.callerPhone || null;
    this.onAudioDelta     = opts.onAudioDelta || (()=>{});
    this.onTranscript     = opts.onTranscript  || (()=>{});
    this.onError          = opts.onError       || console.error;

    this.ws          = null;
    this.isConnected = false;

    this.recentAI   = [];
    this.lastAITime = 0;
    this.ECHO_MS    = 2500;

    // Dati raccolti dal parser
    this.data = { date:null, time:null, people:null };

    // Flag
    this.availabilityDone     = false; // true dopo check ④ ok
    this._checkingDay         = false;
    this._checkingTime        = false;
    this._checkingSlot        = false;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      const url = `wss://api.openai.com/v1/realtime?model=${this.model}`;
      this.ws = new WebSocket(url, {
        headers: { 'Authorization':`Bearer ${this.apiKey}`, 'OpenAI-Beta':'realtime=v1' }
      });
      this.ws.on('open',    ()   => { this.isConnected=true; this._init(); resolve(); });
      this.ws.on('message', raw  => this._handle(JSON.parse(raw.toString())));
      this.ws.on('error',   err  => { this.onError(err); reject(err); });
      this.ws.on('close',   code => { console.log(`🔴 Disconnesso (${code})`); this.isConnected=false; });
    });
  }

  _init() {
    console.log('🟢 Connesso OpenAI');
    this._send({
      type: 'session.update',
      session: {
        modalities: ['text','audio'],
        instructions: this.systemPrompt,
        voice: 'alloy',
        input_audio_format:  'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        input_audio_transcription: { model:'whisper-1', language:'it' },
        turn_detection: { type:'server_vad', threshold:0.4, prefix_padding_ms:300, silence_duration_ms:1200 },
        tools: [], // nessun tool — il server gestisce tutto
      }
    });
    this._send({ type:'conversation.item.create', item:{
      type:'message', role:'user',
      content:[{ type:'input_text', text:'[Inizia: saluta brevemente e chiedi per quale giorno vuole prenotare.]' }]
    }});
    this._send({ type:'response.create' });
  }

  _handle(msg) {
    switch (msg.type) {
      case 'session.created':  console.log(`📋 Sessione: ${msg.session.id}`); break;
      case 'session.updated':  console.log('✅ Sessione ok'); break;
      case 'response.audio.delta':
        if (msg.delta) this.onAudioDelta(msg.delta); break;
      case 'response.audio_transcript.done':
        if (msg.transcript) {
          this.recentAI.unshift(msg.transcript);
          if (this.recentAI.length > 10) this.recentAI.pop();
          this.lastAITime = Date.now();
          console.log(`💬 [AI]: ${msg.transcript}`);
          this.onTranscript(msg.transcript, 'assistant');
        }
        break;
      case 'input_audio_buffer.speech_started': console.log('🎤 Parla...'); break;
      case 'input_audio_buffer.speech_stopped':  console.log('🎤 Fine');    break;
      case 'conversation.item.input_audio_transcription.completed':
        if (msg.transcript) {
          const t = msg.transcript.trim();
          if (this._echo(t)) { console.log(`🔇 Echo`);  return; }
          if (isNoise(t))    { console.log(`🔇 Noise`); return; }
          console.log(`💬 [user]: ${t}`);
          this.onTranscript(t, 'user');
          this._parse(t);
        }
        break;
      case 'response.done':
        if (msg.response?.status === 'failed') console.error('❌ Response failed');
        break;
      case 'error':
        if (msg.error?.code !== 'conversation_already_has_active_response') {
          console.error('❌ OpenAI:', msg.error); this.onError(msg.error);
        }
        break;
    }
  }

  // ─── PARSE & TRIGGER ──────────────────────────────────────────────────────

  _parse(text) {
    if (this.availabilityDone) return;

    const prevDate   = this.data.date;
    const prevTime   = this.data.time;

    const date   = parseDate(text);
    const time   = parseTime(text);
    const people = parsePeople(text);

    if (date   && date   !== this.data.date)   { console.log(`📅 date:   ${this.data.date} → ${date}`);     this.data.date=date; }
    if (time   && time   !== this.data.time)   { console.log(`⏰ time:   ${this.data.time} → ${time}`);     this.data.time=time; }
    if (people && people !== this.data.people) { console.log(`👥 people: ${this.data.people} → ${people}`); this.data.people=people; }

    console.log(`📊 date=${this.data.date} time=${this.data.time} people=${this.data.people}`);

    // ① Nuova data → controlla giorno chiuso
    if (this.data.date && this.data.date !== prevDate) {
      const wasClosed = this._checkDayClosed();
      if (wasClosed) return;
      // giorno aperto → continua a controllare orario se già presente
    }

    // ②③ Nuovo orario → controlla fascia + range
    if (this.data.date && this.data.time && this.data.time !== prevTime) {
      this._checkTimeFeasibility();
      return;
    }

    // ④ Tutti e 3 → check slot
    if (this.data.date && this.data.time && this.data.people && !this._checkingSlot) {
      this._checkSlot();
    }
  }

  // ─── CHECK ① ────────────────────────────────────────────────────────────────

  _checkDayClosed() {
    if (this._checkingDay) return false;
    this._checkingDay = true;
    const msg = checkDayClosed(this.data.date, this.restaurantConfig);
    this._checkingDay = false;
    if (msg) {
      console.log(`🚫 Giorno chiuso: ${this.data.date}`);
      this.data.date = null;
      this._sistema(msg);
      return true;
    }
    return false;
  }

  // ─── CHECK ②③ ────────────────────────────────────────────────────────────

  _checkTimeFeasibility() {
    if (this._checkingTime) return;
    this._checkingTime = true;
    const msg = checkTimeFeasibility(this.data.date, this.data.time, this.restaurantConfig);
    this._checkingTime = false;
    if (msg) {
      console.log(`🚫 Orario non valido: ${this.data.time}`);
      this.data.time = null;
      this._sistema(msg);
    }
  }

  // ─── CHECK ④ ────────────────────────────────────────────────────────────────

  async _checkSlot() {
    if (this._checkingSlot) return;
    this._checkingSlot = true;

    const { date, time, people } = this.data;
    console.log(`🔍 Check slot: ${date} ${time} per ${people}`);

    // Blocca GPT subito — prima che risponda inventando disponibilità
    this._sistema(`Sto verificando la disponibilità. Di' SOLO: "Un attimo, verifico la disponibilità..." e taci.`);

    const result = await checkSlot(date, time, people, this.restaurantConfig);

    if (result.available) {
      console.log(`✅ Slot disponibile`);
      this.availabilityDone = true;
      this._sistema(`DISPONIBILE: ${date} alle ${time} per ${people} persone è libero. Chiedi il nome al cliente: "A che nome prenoto?"`);
    } else {
      console.log(`❌ Slot pieno — cerco alternative`);
      const alt = await findAlternative(date, time, people, this.restaurantConfig);
      if (alt) {
        console.log(`💡 Alternativa: ${alt}`);
        this.data.time = null;
        this._sistema(`SLOT PIENO: le ${time} è al completo. C'è disponibilità alle ${alt}. Di' al cliente: "Le ${time} è al completo, ma c'è posto alle ${alt}. Va bene?"`);
      } else {
        console.log(`❌ Nessuna alternativa`);
        this.data.time = null;
        this._sistema(`TUTTO PIENO: nessuno slot disponibile per il ${date}. Comunica al cliente che siamo al completo e chiedi se vuole un altro giorno.`);
      }
    }

    this._checkingSlot = false;
  }

  // ─── INJECT ──────────────────────────────────────────────────────────────────

  _sistema(text) {
    console.log(`💉 [SISTEMA]: ${text.substring(0,120)}`);
    this._send({ type:'conversation.item.create', item:{
      type:'message', role:'user',
      content:[{ type:'input_text', text:`[SISTEMA: ${text}]` }]
    }});
    this._send({ type:'response.create' });
  }

  // ─── ECHO ────────────────────────────────────────────────────────────────────

  _echo(text) {
    if (!text || text.length <= 20) return false;
    const uw = text.toLowerCase().replace(/[.,!?]/g,'').split(/\s+/).filter(w=>w.length>1);
    if (uw.length <= 3 || Date.now()-this.lastAITime > this.ECHO_MS) return false;
    for (const phrase of this.recentAI) {
      const aw = phrase.toLowerCase().replace(/[.,!?]/g,'').split(/\s+/).filter(w=>w.length>1);
      const hits = uw.filter(w=>aw.includes(w)).length;
      if (hits/uw.length > 0.75 && hits >= 6) return true;
    }
    return false;
  }

  // ─── AUDIO ───────────────────────────────────────────────────────────────────

  sendAudio(b64) {
    if (this.isConnected) this._send({ type:'input_audio_buffer.append', audio:b64 });
  }

  _send(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  disconnect() {
    if (this.ws) { this.ws.close(); this.ws=null; }
    this.isConnected = false;
  }
}

export default OpenAIRealtimeClient;
