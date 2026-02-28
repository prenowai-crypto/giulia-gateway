// ═══════════════════════════════════════════════════════════════════════════════
// PRENOW - OPENAI REALTIME CLIENT v2.2.1
//
// FIX v2.2.1:
//   - Constructor: salva callerPhone (numero chiamante automatico)
//   - sessionState: aggiunto foundReservation (usato da modify/cancel)
//   - handleToolCall: passa callerPhone al context dei tool handler
//
// NOVITÀ v2.2.0:
//   - sessionState: traccia dati prenotazione lato server
//   - sessionState passato ai tool handler
//
// Echo cancellation: INVARIATA da v2.1.0
// ═══════════════════════════════════════════════════════════════════════════════

import WebSocket from 'ws';

export class OpenAIRealtimeClient {
  constructor(options) {
    this.apiKey = options.apiKey;
    this.model = options.model || 'gpt-4o-mini-realtime-preview';
    this.systemPrompt = options.systemPrompt;
    this.tools = options.tools || [];
    this.callSid = options.callSid;
    this.restaurantConfig = options.restaurantConfig;
    this.callerPhone = options.callerPhone || null;  // ✅ FIX v2.2.1

    this.onAudioDelta = options.onAudioDelta || (() => {});
    this.onTranscript = options.onTranscript || (() => {});
    this.onError = options.onError || console.error;

    this.ws = null;
    this.isConnected = false;
    this.sessionId = null;

    // ─────────────────────────────────────────────────────────────────────────
    // SESSION STATE v2.2.1
    // ─────────────────────────────────────────────────────────────────────────
    this.sessionState = {
      pendingReservation: null,   // Dati dopo prepare_reservation
      pendingConfirmation: false, // True = recap letto, attesa conferma
      foundReservation: null,     // ✅ FIX v2.2.1: usato da modify/cancel
      phase: 'initial',
    };

    // ─────────────────────────────────────────────────────────────────────────
    // Echo detection
    // ─────────────────────────────────────────────────────────────────────────
    this.recentAiTranscripts = [];
    this.recentAiPhrases = [];
    this.MAX_AI_HISTORY = 10;
    this.lastAiFinishedTime = 0;
    this.isAiCurrentlySpeaking = false;
    this.speechStartedDuringAi = false;
    this.ECHO_WINDOW_MS = 5000;
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
    this.send({
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
        instructions: this.systemPrompt,
        voice: 'alloy',
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        input_audio_transcription: {
          model: 'whisper-1',
          language: 'it'
        },
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
        content: [{
          type: 'input_text',
          text: '[Il cliente ha appena chiamato. Salutalo brevemente e chiedi come puoi aiutarlo.]'
        }]
      }
    });

    this.send({ type: 'response.create' });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Echo detection (invariata)
  // ─────────────────────────────────────────────────────────────────────────

  extractWords(text) {
    if (!text) return [];
    return text.toLowerCase()
      .replace(/[.,!?;:'"()]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 1);
  }

  isEchoOfAi(userText) {
    if (!userText) return true;

    const trimmed = userText.trim();

    if (trimmed.length <= 15) {
      console.log(`🔊 Frase corta = INPUT REALE: "${trimmed}"`);
      return false;
    }

    const userWords = this.extractWords(trimmed);
    if (userWords.length <= 3) {
      console.log(`🔊 Poche parole = INPUT REALE: "${trimmed}"`);
      return false;
    }

    if (this.speechStartedDuringAi) {
      this.speechStartedDuringAi = false;
    }

    const timeSinceAiFinished = Date.now() - this.lastAiFinishedTime;

    if (timeSinceAiFinished > this.ECHO_WINDOW_MS) {
      console.log(`🔊 Fuori finestra echo (${timeSinceAiFinished}ms) = INPUT REALE`);
      return false;
    }

    for (const aiPhrase of this.recentAiPhrases) {
      const aiWords = this.extractWords(aiPhrase);
      if (aiWords.length === 0) continue;

      let matchCount = 0;
      for (const word of userWords) {
        if (aiWords.includes(word)) matchCount++;
      }

      const matchRatio = matchCount / userWords.length;

      if (matchRatio > 0.5 && matchCount >= 3) {
        console.log(`🔇 ECHO RILEVATO! Match: ${matchCount}/${userWords.length} (${(matchRatio * 100).toFixed(0)}%)`);
        return true;
      }
    }

    const greetingKeywords = [
      'buongiorno', 'buonasera', 'benvenuto', 'benvenuta',
      'osteria', 'ristorante', 'trattoria',
      'posso aiutarti', 'posso aiutarla', 'come posso',
      'prenotare', 'prenotazione', 'tavolo'
    ];

    let greetingMatches = 0;
    const textLower = trimmed.toLowerCase();
    for (const kw of greetingKeywords) {
      if (textLower.includes(kw)) greetingMatches++;
    }

    if (greetingMatches >= 3 && timeSinceAiFinished < 3000) {
      console.log(`🔇 ECHO (greeting): ${greetingMatches} keyword match`);
      return true;
    }

    console.log(`🔊 INPUT REALE: "${trimmed.substring(0, 50)}..."`);
    return false;
  }

  saveAiPhrase(transcript) {
    if (!transcript || transcript.trim().length < 5) return;

    this.recentAiTranscripts.unshift(transcript);
    if (this.recentAiTranscripts.length > this.MAX_AI_HISTORY) {
      this.recentAiTranscripts.pop();
    }

    this.recentAiPhrases.unshift(transcript);

    const words = transcript.split(/\s+/);
    if (words.length > 5) {
      this.recentAiPhrases.unshift(words.slice(0, Math.ceil(words.length / 2)).join(' '));
      this.recentAiPhrases.unshift(words.slice(Math.floor(words.length / 2)).join(' '));
    }

    while (this.recentAiPhrases.length > this.MAX_AI_HISTORY * 2) {
      this.recentAiPhrases.pop();
    }
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
        if (message.delta) {
          this.onAudioDelta(message.delta);
        }
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
        if (process.env.DEBUG_REALTIME) {
          console.log(`📨 ${message.type}`);
        }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TOOL CALL HANDLER v2.2.1
  // ─────────────────────────────────────────────────────────────────────────

  async handleToolCall(message) {
    const { call_id, name, arguments: argsString } = message;

    console.log(`🔧 Tool call: ${name}`);

    try {
      const args = JSON.parse(argsString);
      const tool = this.tools.find(t => t.name === name);

      if (!tool) {
        throw new Error(`Tool non trovato: ${name}`);
      }

      // ✅ FIX v2.2.1: passa callerPhone al context
      const result = await tool.handler(args, {
        callSid: this.callSid,
        restaurantConfig: this.restaurantConfig,
        sessionState: this.sessionState,
        callerPhone: this.callerPhone    // ← numero chiamante automatico
      });

      console.log(`✅ Tool result [${name}]:`, JSON.stringify(result).substring(0, 200));

      this.send({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: call_id,
          output: JSON.stringify(result)
        }
      });

      this.send({ type: 'response.create' });

    } catch (error) {
      console.error(`❌ Tool error (${name}):`, error);

      this.send({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: call_id,
          output: JSON.stringify({ error: error.message })
        }
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
    if (this.audioSendCount <= 3) {
      console.log(`📤 Invio audio #${this.audioSendCount} a OpenAI`);
    }

    this.send({
      type: 'input_audio_buffer.append',
      audio: audioBase64
    });
  }

  send(message) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }
}

export default OpenAIRealtimeClient;
