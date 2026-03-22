import WebSocket from 'ws';

// ─── UTILITY ──────────────────────────────────────────────────────────────────

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
  return (s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
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

  // Solo giorno (ultimo menzionato)
  let li=-1, lp=-1;
  for (const wd of WD) for (const p of wd.p) {
    const pos = t.lastIndexOf(p);
    if (pos>lp) { lp=pos; li=wd.i; }
  }
  if (li!==-1) {
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

  // "alle sette e mezza"
  const allHW = Object.keys(HWMAP).join('|');
  const rW = new RegExp(`(?:alle|ore|per le)\\s+(${allHW})(?:\\s+e\\s+(un quarto|mezza|mezzo|trenta|quindici|quarantacinque|quaranta|venti|dieci|cinque))?`,'gi');
  while ((m=rW.exec(t))!==null) {
    let h = HWMAP[m[1].toLowerCase()]; if (!h) continue;
    const min = m[2] ? (MWMAP[m[2].toLowerCase()]||0) : 0;
    if (h>=1 && h<=11 && !isLunch) h+=12;
    times.push({pos:m.index, t:`${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`});
  }

  // "alle HH:MM"
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

  // "HH e mezza"
  const mwk = Object.keys(MWMAP).filter(k=>!k.includes(' ')).join('|');
  const rEM = new RegExp(`(?:alle|ore)?\\s*(\\d{1,2})\\s+e\\s+(${mwk})\\b`,'gi');
  while ((m=rEM.exec(t))!==null) {
    let h=parseInt(m[1]); const min=MWMAP[m[2].toLowerCase()]||0;
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
  times.sort((a,b)=>a.pos-b.pos);
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

  // Numero esplicito + parola-persona (sempre, anche con orario nella frase)
  const m1 = t.match(/(\d+)\s*(?:person[ae]|pax|coperti)/i);
  if (m1) { const n=parseInt(m1[1]); if (n>0&&n<100) return n; }

  // Parola-numero + parola-persona (sempre, anche con orario nella frase)
  const WN = { 'due':2,'tre':3,'quattro':4,'cinque':5,'sei':6,'sette':7,'otto':8,'nove':9,'dieci':10 };
  for (const [w,n] of Object.entries(WN)) {
    if (new RegExp(`\\b${w}\\s+(?:person[ae]|pax|coperti)\\b`).test(t)) return n;
  }

  // Pattern numerici senza parola-persona
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

// ─── NOISE ────────────────────────────────────────────────────────────────────

function isNoise(text) {
  if (!text || text.trim().length < 3) return true;
  return /sottotitoli|amara\.org|copyright/i.test(text);
}

// ─── CLIENT ───────────────────────────────────────────────────────────────────

export class OpenAIRealtimeClient {
  constructor(opts) {
    this.apiKey       = opts.apiKey;
    this.model        = opts.model || 'gpt-4o-mini-realtime-preview';
    this.systemPrompt = opts.systemPrompt || '';
    this.onAudioDelta = opts.onAudioDelta || (()=>{});
    this.onTranscript = opts.onTranscript  || (()=>{});
    this.onError      = opts.onError       || console.error;

    this.ws          = null;
    this.isConnected = false;

    // Echo detection
    this.recentAI       = [];
    this.lastAITime     = 0;
    this.ECHO_MS        = 2500;

    // Stato raccolta
    this.data = { date:null, time:null, people:null };
    this.done = false;
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
        tools: [],
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
      case 'session.created':   console.log(`📋 Sessione: ${msg.session.id}`); break;
      case 'session.updated':   console.log('✅ Sessione ok'); break;
      case 'response.audio.delta':
        if (msg.delta) this.onAudioDelta(msg.delta); break;
      case 'response.audio_transcript.done':
        if (msg.transcript) {
          this.recentAI.unshift(msg.transcript);
          if (this.recentAI.length>10) this.recentAI.pop();
          this.lastAITime = Date.now();
          console.log(`💬 [AI]: ${msg.transcript}`);
          this.onTranscript(msg.transcript, 'assistant');
        }
        break;
      case 'input_audio_buffer.speech_started': console.log('🎤 Parla...'); break;
      case 'input_audio_buffer.speech_stopped':  console.log('🎤 Fine'); break;
      case 'conversation.item.input_audio_transcription.completed':
        if (msg.transcript) {
          const t = msg.transcript.trim();
          if (this._echo(t)) { console.log(`🔇 Echo: "${t.substring(0,40)}"`); return; }
          if (isNoise(t))    { console.log(`🔇 Noise: "${t.substring(0,40)}"`); return; }
          console.log(`💬 [user]: ${t}`);
          this.onTranscript(t, 'user');
          this._parse(t);
        }
        break;
      case 'response.done':
        if (msg.response?.status==='failed') console.error('❌ Response failed'); break;
      case 'error':
        if (msg.error?.code !== 'conversation_already_has_active_response') {
          console.error('❌ OpenAI:', msg.error); this.onError(msg.error);
        }
        break;
    }
  }

  _parse(text) {
    if (this.done) return;

    const date   = parseDate(text);
    const time   = parseTime(text);
    const people = parsePeople(text);

    if (date   && date   !== this.data.date)   { console.log(`📅 date:   ${this.data.date} → ${date}`);     this.data.date=date; }
    if (time   && time   !== this.data.time)   { console.log(`⏰ time:   ${this.data.time} → ${time}`);     this.data.time=time; }
    if (people && people !== this.data.people) { console.log(`👥 people: ${this.data.people} → ${people}`); this.data.people=people; }

    console.log(`📊 data=${this.data.date} time=${this.data.time} people=${this.data.people}`);

    if (this.data.date && this.data.time && this.data.people) {
      this.done = true;
      console.log(`✅ RACCOLTO: ${JSON.stringify(this.data)}`);
      // Qui in futuro chiameremo il prossimo step
    }
  }

  _echo(text) {
    if (!text || text.length<=20) return false;
    const uw = text.toLowerCase().replace(/[.,!?]/g,'').split(/\s+/).filter(w=>w.length>1);
    if (uw.length<=3 || Date.now()-this.lastAITime>this.ECHO_MS) return false;
    for (const phrase of this.recentAI) {
      const aw = phrase.toLowerCase().replace(/[.,!?]/g,'').split(/\s+/).filter(w=>w.length>1);
      const hits = uw.filter(w=>aw.includes(w)).length;
      if (hits/uw.length>0.75 && hits>=6) return true;
    }
    return false;
  }

  sendAudio(b64) {
    if (this.isConnected) this._send({ type:'input_audio_buffer.append', audio:b64 });
  }

  _send(msg) {
    if (this.ws?.readyState===WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  disconnect() {
    if (this.ws) { this.ws.close(); this.ws=null; }
    this.isConnected = false;
  }
}

export default OpenAIRealtimeClient;
