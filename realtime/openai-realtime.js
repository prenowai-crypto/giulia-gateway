// ═══════════════════════════════════════════════════════════════════════════════
// PRENOW - OPENAI REALTIME CLIENT v1.0.0
// Client WebSocket per OpenAI Realtime API (gpt-4o-mini-realtime)
// ═══════════════════════════════════════════════════════════════════════════════

import WebSocket from 'ws';

/**
 * Client per OpenAI Realtime API
 * Gestisce: connessione WebSocket, audio bidirezionale, tool calls
 */
export class OpenAIRealtimeClient {
  constructor(options) {
    this.apiKey = options.apiKey;
    this.model = options.model || 'gpt-4o-mini-realtime-preview';
    this.systemPrompt = options.systemPrompt;
    this.tools = options.tools || [];
    this.callSid = options.callSid;
    this.restaurantConfig = options.restaurantConfig;
    
    // Callbacks
    this.onAudioDelta = options.onAudioDelta || (() => {});
    this.onTranscript = options.onTranscript || (() => {});
    this.onError = options.onError || console.error;
    
    // Stato
    this.ws = null;
    this.isConnected = false;
    this.sessionId = null;
    
    // Buffer per conversione audio Twilio (mulaw) → OpenAI (pcm16)
    this.audioBuffer = [];
  }
  
  /**
   * Connette a OpenAI Realtime API
   */
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
  
  /**
   * Inizializza la sessione con OpenAI
   */
initializeSession() {
    // Configura la sessione
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
          threshold: 0.7,
          prefix_padding_ms: 800,
          silence_duration_ms: 2000
        },
        tools: this.tools.map(t => ({
          type: 'function',
          name: t.name,
          description: t.description,
          parameters: t.parameters
        }))
      }
    });
    
    // Invia messaggio iniziale (il sistema saluta)
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
    
    // Triggera risposta
    this.send({ type: 'response.create' });
  }
  
  /**
   * Gestisce messaggi in arrivo da OpenAI
   */
  handleMessage(message) {
    switch (message.type) {
      case 'session.created':
        this.sessionId = message.session.id;
        console.log(`📋 Sessione OpenAI creata: ${this.sessionId}`);
        break;
        
      case 'session.updated':
        console.log('✅ Sessione configurata');
        break;
        
      case 'response.audio.delta':
        // Audio in uscita verso Twilio
        if (message.delta) {
          this.onAudioDelta(message.delta);
        }
        break;
        
      case 'response.audio_transcript.delta':
        // Trascrizione parziale di cosa sta dicendo l'AI
        // (opzionale, per logging)
        break;
        
      case 'response.audio_transcript.done':
        // Trascrizione completa risposta AI
        if (message.transcript) {
          this.onTranscript(message.transcript, 'assistant');
        }
        break;
        
      case 'conversation.item.input_audio_transcription.completed':
        // Trascrizione di cosa ha detto l'utente
        if (message.transcript) {
          this.onTranscript(message.transcript, 'user');
        }
        break;
        
      case 'response.function_call_arguments.done':
        // Tool call completata, esegui la funzione
        this.handleToolCall(message);
        break;
        
      case 'response.done':
        // Risposta completata
        if (message.response?.status === 'failed') {
          console.error('❌ Risposta fallita:', message.response.status_details);
        }
        break;
        
      case 'error':
        console.error('❌ Errore OpenAI:', message.error);
        this.onError(message.error);
        break;
        
      case 'input_audio_buffer.speech_started':
        console.log('🎤 Utente sta parlando...');
        break;
        
      case 'input_audio_buffer.speech_stopped':
        console.log('🎤 Utente ha finito di parlare');
        break;
        
      default:
        // Log eventi non gestiti esplicitamente (per debug)
        if (process.env.DEBUG_REALTIME) {
          console.log(`📨 ${message.type}`);
        }
    }
  }
  
  /**
   * Gestisce tool calls da OpenAI
   */
  async handleToolCall(message) {
    const { call_id, name, arguments: argsString } = message;
    
    console.log(`🔧 Tool call: ${name}`);
    
    try {
      const args = JSON.parse(argsString);
      
      // Trova il tool corrispondente
      const tool = this.tools.find(t => t.name === name);
      
      if (!tool) {
        throw new Error(`Tool non trovato: ${name}`);
      }
      
      // Esegui la funzione
      const result = await tool.handler(args, {
        callSid: this.callSid,
        restaurantConfig: this.restaurantConfig
      });
      
      console.log(`✅ Tool result:`, result);
      
      // Invia risultato a OpenAI
      this.send({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: call_id,
          output: JSON.stringify(result)
        }
      });
      
      // Triggera nuova risposta basata sul risultato
      this.send({ type: 'response.create' });
      
    } catch (error) {
      console.error(`❌ Tool error (${name}):`, error);
      
      // Invia errore a OpenAI
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
  
  /**
   * Invia audio a OpenAI (da Twilio)
   * @param {string} audioBase64 - Audio in formato mulaw base64
   */
  sendAudio(audioBase64) {
    if (!this.isConnected) return;
    
    this.send({
      type: 'input_audio_buffer.append',
      audio: audioBase64
    });
  }
  
  /**
   * Invia messaggio a OpenAI
   */
  send(message) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }
  
  /**
   * Disconnette da OpenAI
   */
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }
}

export default OpenAIRealtimeClient;
