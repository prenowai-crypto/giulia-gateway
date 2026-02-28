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

function normalizeText(str) {
  return (str || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function _getNowRome() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Rome' }));
}

function _toISO(d) {
  if (!d || isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function _addDays(d, n) {
  const r = new Date(d); r.setDate(r.getDate() + n); return r;
}

function parseDate(text) {
  if (!text) return null;
  const t = normalizeText(text);
  const now = _getNowRome();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (/dopodomani|dopo domani|day after tomorrow/.test(t)) return _toISO(_addDays(today, 2));
  if (/\bdomani\b|\btomorrow\b/.test(t)) return _toISO(_addDays(today, 1));
  if (/\boggi\b|\btoday\b|\bstasera\b|\btonig/.test(t)) return _toISO(today);

  const slashMatch = t.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  if (slashMatch) {
    const day = parseInt(slashMatch[1]), month = parseInt(slashMatch[2]) - 1;
    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      let d = new Date(today.getFullYear(), month, day);
      if (d < today) d = new Date(today.getFullYear() + 1, month, day);
      return _toISO(d);
    }
  }

  const monthsMap = {
    'gennaio':0,'febbraio':1,'marzo':2,'aprile':3,'maggio':4,'giugno':5,
    'luglio':6,'agosto':7,'settembre':8,'ottobre':9,'novembre':10,'dicembre':11,
    'january':0,'february':1,'march':2,'april':3,'may':4,'june':5,
    'july':6,'august':7,'september':8,'october':9,'november':10,'december':11,
  };
  const allMonths = Object.keys(monthsMap).join('|');
  const monthMatch = t.match(new RegExp(`(\\d{1,2})\\s*(?:di\\s+)?(${allMonths})`));
  if (monthMatch) {
    const day = parseInt(monthMatch[1]), month = monthsMap[monthMatch[2]];
    if (month !== undefined && day >= 1 && day <= 31) {
      let d = new Date(today.getFullYear(), month, day);
      if (d < today) d = new Date(today.getFullYear() + 1, month, day);
      return _toISO(d);
    }
  }

  const weekdays = [
    {patterns:['domenica','sunday'],  index:0},
    {patterns:['lunedi','monday'],    index:1},
    {patterns:['martedi','tuesday'],  index:2},
    {patterns:['mercoledi','wednesday'],index:3},
    {patterns:['giovedi','thursday'], index:4},
    {patterns:['venerdi','friday'],   index:5},
    {patterns:['sabato','saturday'],  index:6},
  ];
  let lastIdx = -1, lastPos = -1;
  for (const wd of weekdays) {
    for (const p of wd.patterns) {
      const pos = t.lastIndexOf(p);
      if (pos !== -1 && pos > lastPos) { lastPos = pos; lastIdx = wd.index; }
    }
  }
  if (lastIdx !== -1) {
    const diff = ((lastIdx - today.getDay()) + 7) % 7;
    return _toISO(_addDays(today, diff === 0 ? 7 : diff));
  }
  return null;
}

function parseTime(text) {
  if (!text) return null;
  const t = text.toLowerCase().trim();
  if (/mezzogiorno|noon/.test(t)) return '12:00';
  if (/mezzanotte|midnight/.test(t)) return '00:00';

  const m1 = t.match(/(?:alle|ore|per le|at)\s*(\d{1,2})(?::(\d{2}))?/i);
  if (m1) {
    let h = parseInt(m1[1]), min = m1[2] ? parseInt(m1[2]) : 0;
    if (h >= 1 && h <= 11 && !/mattina|morning|pranzo|lunch/.test(t)) h += 12;
    if (h >= 0 && h <= 23) return `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
  }

  const m2 = t.match(/\b(\d{1,2}):(\d{2})\b/);
  if (m2) {
    const h = parseInt(m2[1]), min = parseInt(m2[2]);
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59)
      return `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
  }

  const m3 = t.match(/\b(\d{1,2})\s*(pm|am)\b/i);
  if (m3) {
    let h = parseInt(m3[1]);
    if (m3[2].toLowerCase() === 'pm' && h < 12) h += 12;
    if (m3[2].toLowerCase() === 'am' && h === 12) h = 0;
    return `${String(h).padStart(2,'0')}:00`;
  }

  if (/\bpranzo\b|\blunch\b/.test(t)) return '13:00';
  if (/\bcena\b|\bdinner\b|\bsera\b/.test(t)) return '20:00';
  return null;
}

function parsePeople(text) {
  if (!text) return null;
  const t = text.toLowerCase().trim();
  const patterns = [
    /(\d+)\s*in\s*totale/i,
    /siamo\s*(?:in\s*)?(\d+)/i,
    /(?:per|siamo|saremo|in)\s*(\d+)\s*(?:person[ae]|pax|persone)?/i,
    /(\d+)\s*(?:person[ae]|pax|coperti|guests|people|persone)/i,
    /(?:tavolo|table)\s*(?:per|for)\s*(\d+)/i,
  ];
  for (const p of patterns) {
    const m = t.match(p);
    if (m) { const n = parseInt(m[1]); if (n > 0 && n < 100) return n; }
  }
  const wordNums = {
    'due':2,'tre':3,'quattro':4,'cinque':5,'sei':6,'sette':7,'otto':8,'nove':9,'dieci':10,
    'two':2,'three':3,'four':4,'five':5,'six':6,'seven':7,'eight':8,'nine':9,'ten':10
  };
  for (const [w, n] of Object.entries(wordNums)) {
    if (new RegExp(`\\b${w}\\b`).test(t)) return n;
  }
  return null;
}

function parseName(text) {
  if (!text) return null;
  const t = text.trim();
  const EXCLUDE = [
    'si','no','ok','sì','yes','grazie','prego','esatto','confermo','giusto','certo',
    'quello','quella','bene','perfetto','ciao','buongiorno','buonasera','buonanotte',
    'io','me','noi','lui','lei','uno','una','un'
  ];
  // Preposizioni/congiunzioni che interrompono il nome
  const STOP_AFTER_NAME = /\s+(?:alle|per|il|la|lo|gli|i|le|di|da|in|con|su|tra|fra|e|o|a|un|una|uno)\b/i;

  const patterns = [
    // "a nome Simone" / "a nome Simone Rossi" → si ferma prima di preposizioni/orari
    /\ba\s+nome\s+(?:di\s+)?([A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]+(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]+)?)/i,
    /\bmi\s+chiamo\s+([A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]+)/i,
    /\bsono\s+([A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]+)\b/i,
    /\bname\s+is\s+([A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]+)\b/i,
    /\bi'?m\s+([A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]+)\b/i,
    /\bunder\s+(?:the\s+)?name\s+([A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]+)\b/i,
    // Risposta secca: solo 1-2 parole che sembrano un nome (max 2 token)
    /^([A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]{1,}(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ]+)?)$/,
  ];
  for (const p of patterns) {
    const m = t.match(p);
    if (m && m[1]) {
      // Tronca il nome prima di stop words (es. "Simone alle" → "Simone")
      let name = m[1].trim();
      const stopMatch = name.match(STOP_AFTER_NAME);
      if (stopMatch) name = name.substring(0, stopMatch.index).trim();
      if (name.length >= 2 && !EXCLUDE.includes(name.toLowerCase())) return name;
    }
  }
  return null;
}

function parseEmail(text) {
  if (!text) return null;
  const m = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0] : null;
}

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

      // 🆕 v3.0.0: fonte di verità server-side (GPT non può sovrascrivere)
      collectedData: {
        date: null,
        time: null,
        people: null,
        name: null,
        email: null,
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

REGOLA ANTI-INVENZIONE:
NON inventare MAI dati non detti esplicitamente dal cliente.
Se manca il nome: chiedilo. NON inventarlo.
Se manca la data: chiedi. NON inventarla.`;

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
          silence_duration_ms: 1000
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

    console.log(`📊 [SERVER] collectedData:`, JSON.stringify(cd));
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

    try {
      const args = JSON.parse(argsString);
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
