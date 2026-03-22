import WebSocket from 'ws';

// ─── UTILITY ──────────────────────────────────────────────────────────────────

const DAY_IT = ['domenica','lunedì','martedì','mercoledì','giovedì','venerdì','sabato'];

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

// ─── VALIDAZIONE VALORI DAL TOOL ──────────────────────────────────────────────

function validateDate(date) {
  if (!date || typeof date !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = new Date(date + 'T12:00:00');
  if (isNaN(d.getTime())) return false;
  // Non nel passato
  const today = new Date();
  today.setHours(0,0,0,0);
  return d >= today;
}

function validateTime(time) {
  if (!time || typeof time !== 'string') return false;
  return /^\d{2}:\d{2}$/.test(time);
}

function validatePeople(people) {
  return Number.isInteger(people) && people > 0 && people < 100;
}

// ─── CHECK ① giorno chiuso ────────────────────────────────────────────────────

function checkDayClosed(date, rc) {
  const dow = new Date(date + 'T12:00:00').getDay();
  if ((rc.weekly_closing_days||[]).includes(dow)) {
    return `Siamo chiusi il ${DAY_IT[dow]}. Comunicalo al cliente e chiedi un altro giorno.`;
  }
  return null;
}

// ─── CHECK ②③ fascia + range ──────────────────────────────────────────────────

function checkTimeFeasibility(date, time, rc) {
  const dow  = new Date(date + 'T12:00:00').getDay();
  const mins = timeToMinutes(time);
  const isLunch = mins < 15 * 60;

  if (isLunch) {
    if ((rc.lunch_closed_days||[]).includes(dow)) {
      return `Siamo chiusi a pranzo il ${DAY_IT[dow]}. Comunicalo e chiedi se vuole venire a cena o in un altro giorno.`;
    }
    const start = timeToMinutes(rc.lunch_start || '12:00');
    const end   = timeToMinutes(rc.lunch_end   || '14:30');
    if (mins < start || mins >= end) {
      return `L'orario ${time} è fuori dalla fascia pranzo (${rc.lunch_start||'12:00'}-${rc.lunch_end||'14:30'}). Comunica gli orari corretti e chiedi un nuovo orario.`;
    }
  } else {
    if ((rc.dinner_closed_days||[]).includes(dow)) {
      return `Siamo chiusi a cena il ${DAY_IT[dow]}. Comunicalo e chiedi se vuole venire a pranzo o in un altro giorno.`;
    }
    const start = timeToMinutes(rc.dinner_start || '19:00');
    const end   = timeToMinutes(rc.dinner_end   || '22:30');
    if (mins < start || mins >= end) {
      return `L'orario ${time} è fuori dalla fascia cena (${rc.dinner_start||'19:00'}-${rc.dinner_end||'22:30'}). Comunica gli orari corretti e chiedi un nuovo orario.`;
    }
  }
  return null;
}

// ─── CHECK ④ Apps Script ──────────────────────────────────────────────────────

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
    return json.success ? { available: true } : { available: false, reason: json.reason || 'slot_full' };
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
    const t = minutesToTime(candidate);
    const r = await checkSlot(date, t, people, rc);
    if (r.available) return t;
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

    this._checking = false;
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
        tools: [
          {
            type: 'function',
            name: 'collect_data',
            description: 'Chiama questo tool SOLO quando hai ricevuto dal cliente tutti e 3 i dati: data, orario e numero di persone. NON chiamarlo se manca anche solo uno dei 3.',
            parameters: {
              type: 'object',
              properties: {
                date:   { type: 'string',  description: 'Data in formato YYYY-MM-DD' },
                time:   { type: 'string',  description: 'Orario in formato HH:MM (24h)' },
                people: { type: 'integer', description: 'Numero di persone' },
              },
              required: ['date', 'time', 'people']
            }
          }
        ],
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
        }
        break;

      case 'response.function_call_arguments.done':
        this._handleToolCall(msg);
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

  // ─── TOOL CALL ────────────────────────────────────────────────────────────────

  async _handleToolCall(msg) {
    const { call_id, arguments: argsStr } = msg;

    let args;
    try { args = JSON.parse(argsStr); }
    catch(e) {
      console.error('❌ JSON malformato dal tool');
      this._toolResult(call_id, { ok: false, error: 'Argomenti non validi.' });
      this._send({ type: 'response.create' });
      return;
    }

    const { date, time, people } = args;
    console.log(`🔧 collect_data: date=${date} time=${time} people=${people}`);

    // Validazione base
    if (!validateDate(date)) {
      console.warn(`⚠️ Data non valida: ${date}`);
      this._toolResult(call_id, { ok: false, error: 'Data non valida o nel passato.' });
      this._send({ type:'response.create', response:{ instructions:'La data ricevuta non è valida o è nel passato. Chiedi al cliente di ripetere la data.' }});
      return;
    }
    if (!validateTime(time)) {
      console.warn(`⚠️ Orario non valido: ${time}`);
      this._toolResult(call_id, { ok: false, error: 'Orario non valido.' });
      this._send({ type:'response.create', response:{ instructions:'L\'orario ricevuto non è valido. Chiedi al cliente di ripetere l\'orario.' }});
      return;
    }
    if (!validatePeople(people)) {
      console.warn(`⚠️ Persone non valido: ${people}`);
      this._toolResult(call_id, { ok: false, error: 'Numero persone non valido.' });
      this._send({ type:'response.create', response:{ instructions:'Il numero di persone non è valido. Chiedi al cliente di ripetere.' }});
      return;
    }

    if (this._checking) {
      console.warn('⚠️ Check già in corso, ignoro');
      return;
    }
    this._checking = true;

    // ① Giorno chiuso
    const closedMsg = checkDayClosed(date, this.restaurantConfig);
    if (closedMsg) {
      console.log(`🚫 Giorno chiuso: ${date}`);
      this._toolResult(call_id, { ok: false, reason: 'day_closed' });
      this._sistema(call_id, closedMsg);
      this._checking = false;
      return;
    }

    // ②③ Fascia + range
    const timeMsg = checkTimeFeasibility(date, time, this.restaurantConfig);
    if (timeMsg) {
      console.log(`🚫 Orario non valido: ${time}`);
      this._toolResult(call_id, { ok: false, reason: 'invalid_time' });
      this._sistema(call_id, timeMsg);
      this._checking = false;
      return;
    }

    // ④ Apps Script
    console.log(`🔍 Check slot: ${date} ${time} per ${people}`);
    const result = await checkSlot(date, time, people, this.restaurantConfig);

    if (result.available) {
      console.log(`✅ Slot disponibile`);
      this._toolResult(call_id, { ok: true });
      this._sistema(call_id, `DISPONIBILE: ${date} alle ${time} per ${people} persone è libero. Chiedi il nome al cliente: "A che nome prenoto?"`);
    } else {
      console.log(`❌ Slot pieno — cerco alternative`);
      const alt = await findAlternative(date, time, people, this.restaurantConfig);
      if (alt) {
        console.log(`💡 Alternativa: ${alt}`);
        this._toolResult(call_id, { ok: false, reason: 'slot_full', alternative: alt });
        this._sistema(call_id, `SLOT PIENO: le ${time} è al completo. C'è disponibilità alle ${alt}. Di' al cliente: "Le ${time} è al completo, ma c'è posto alle ${alt}. Va bene?"`);
      } else {
        console.log(`❌ Nessuna alternativa`);
        this._toolResult(call_id, { ok: false, reason: 'fully_booked' });
        this._sistema(call_id, `TUTTO PIENO: nessuno slot disponibile per il ${date}. Di' al cliente che siamo al completo e chiedi se vuole un altro giorno.`);
      }
    }

    this._checking = false;
  }

  _toolResult(call_id, result) {
    this._send({
      type: 'conversation.item.create',
      item: { type:'function_call_output', call_id, output: JSON.stringify(result) }
    });
  }

  _sistema(call_id, text) {
    console.log(`💉 [SISTEMA]: ${text.substring(0,100)}`);
    this._send({
      type: 'response.create',
      response: { instructions: text }
    });
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
