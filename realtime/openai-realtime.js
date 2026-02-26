// ═══════════════════════════════════════════════════════════════════════════════
// PRENOW - OPENAI REALTIME CLIENT v2.0.0
// FIX CRITICO: Echo cancellation basata sul CONTENUTO
// 
// Il problema: con Telnyx both_tracks, l'AI sente la propria voce che torna
// indietro come echo. Whisper la trascrive e l'AI risponde a se stessa.
//
// Soluzione: Confrontare ogni trascrizione utente con le ultime risposte AI.
// Se sono simili (>30% parole in comune), è ECHO → ignora.
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
    
    this.onAudioDelta = options.onAudioDelta || (() => {});
    this.onTranscript = options.onTranscript || (() => {});
    this.onError = options.onError || console.error;
    
    this.ws = null;
    this.isConnected = false;
    this.sessionId = null;
    this.audioBuffer = [];
    
    // ═══════════════════════════════════════════════════════════════════════════
    // v2.0.0: Echo cancellation basata sul contenuto
    // ═══════════════════════════════════════════════════════════════════════════
    this.recentAiTranscripts = [];      // Ultime N trascrizioni AI
    this.MAX_AI_TRANSCRIPTS = 5;        // Quante trascrizioni AI tenere
    this.isAiSpeaking = false;          // True mentre AI sta generando audio
    this.lastAiSpeakingTime = 0;        // Timestamp ultimo audio AI
    this.ECHO_WINDOW_MS = 4000;         // Finestra temporale per echo (4 secondi)
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
          threshold: 0.7,            // Threshold medio
          prefix_padding_ms: 400,    // Padding ragionevole
          silence_duration_ms: 1200  // 1.2 secondi di silenzio
        },
        tools: this.tools.map(t => ({
          type: 'function',
          name: t.name,
          description: t.description,
          parameters: t.parameters
        }))
      }
    });
    
    // Trigger saluto iniziale
    this.isAiSpeaking = true; // L'AI sta per parlare
    
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
  
  // ═══════════════════════════════════════════════════════════════════════════
  // v2.0.0: Calcola similarità tra due frasi (Jaccard su parole)
  // ═══════════════════════════════════════════════════════════════════════════
  calculateSimilarity(text1, text2) {
    if (!text1 || !text2) return 0;
    
    // Normalizza e tokenizza
    const normalize = (t) => t.toLowerCase()
      .replace(/[.,!?;:'"]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2); // Solo parole > 2 caratteri
    
    const words1 = new Set(normalize(text1));
    const words2 = new Set(normalize(text2));
    
    if (words1.size === 0 || words2.size === 0) return 0;
    
    // Intersezione
    const intersection = new Set([...words1].filter(w => words2.has(w)));
    
    // Jaccard similarity
    const union = new Set([...words1, ...words2]);
    const similarity = intersection.size / union.size;
    
    return similarity;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // v2.0.0: Verifica se una trascrizione utente è echo dell'AI
  // ═══════════════════════════════════════════════════════════════════════════
  isEcho(userTranscript) {
    if (!userTranscript || userTranscript.trim().length < 3) {
      return true; // Trascrizioni troppo corte sono probabilmente rumore
    }
    
    const timeSinceAiSpoke = Date.now() - this.lastAiSpeakingTime;
    
    // Se l'AI non ha parlato di recente, non può essere echo
    if (timeSinceAiSpoke > this.ECHO_WINDOW_MS) {
      console.log(`🔊 v2.0.0: AI ha parlato ${timeSinceAiSpoke}ms fa (>${this.ECHO_WINDOW_MS}ms), non è echo`);
      return false;
    }
    
    // Confronta con le ultime trascrizioni AI
    for (const aiTranscript of this.recentAiTranscripts) {
      const similarity = this.calculateSimilarity(userTranscript, aiTranscript);
      
      if (similarity > 0.3) { // 30% di parole in comune = probabilmente echo
        console.log(`🔇 v2.0.0: ECHO RILEVATO! Similarità ${(similarity * 100).toFixed(0)}%`);
        console.log(`   AI disse: "${aiTranscript.substring(0, 50)}..."`);
        console.log(`   Ricevuto: "${userTranscript.substring(0, 50)}..."`);
        return true;
      }
    }
    
    // Controlla anche parole chiave tipiche dell'AI
    const aiKeywords = ['buongiorno', 'benvenuto', 'osteria', 'posso aiutarti', 'come posso', 'prenotare', 'tavolo'];
    const userLower = userTranscript.toLowerCase();
    
    let keywordMatches = 0;
    for (const kw of aiKeywords) {
      if (userLower.includes(kw)) keywordMatches++;
    }
    
    if (keywordMatches >= 2 && timeSinceAiSpoke < 3000) {
      console.log(`🔇 v2.0.0: ECHO (keywords): ${keywordMatches} parole chiave AI in "${userTranscript.substring(0, 30)}..."`);
      return true;
    }
    
    console.log(`🔊 v2.0.0: Input valido: "${userTranscript.substring(0, 50)}..."`);
    return false;
  }
  
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
        // AI sta parlando - marca il timestamp
        this.isAiSpeaking = true;
        this.lastAiSpeakingTime = Date.now();
        
        if (message.delta) {
          this.onAudioDelta(message.delta);
        }
        break;
        
      case 'response.audio_transcript.done':
        // Trascrizione AI completata - salvala per echo detection
        if (message.transcript) {
          this.recentAiTranscripts.unshift(message.transcript);
          // Mantieni solo le ultime N
          if (this.recentAiTranscripts.length > this.MAX_AI_TRANSCRIPTS) {
            this.recentAiTranscripts.pop();
          }
          console.log(`💬 [assistant]: ${message.transcript}`);
          this.onTranscript(message.transcript, 'assistant');
        }
        break;
        
      case 'response.done':
        // AI ha finito di parlare
        this.isAiSpeaking = false;
        this.lastAiSpeakingTime = Date.now(); // Marca quando ha FINITO
        
        if (message.response?.status === 'failed') {
          console.error('❌ Risposta fallita:', message.response.status_details);
        }
        break;
        
      case 'conversation.item.input_audio_transcription.completed':
        // ═══════════════════════════════════════════════════════════════════
        // v2.0.0: PUNTO CRITICO - Verifica se è echo prima di processare
        // ═══════════════════════════════════════════════════════════════════
        if (message.transcript) {
          const transcript = message.transcript.trim();
          
          if (this.isEcho(transcript)) {
            console.log(`🔇 v2.0.0: Trascrizione ignorata (echo): "${transcript.substring(0, 40)}..."`);
            
            // IMPORTANTE: Cancella il buffer audio per evitare che OpenAI risponda
            this.send({ type: 'input_audio_buffer.clear' });
            
            // NON chiamare onTranscript - ignora completamente
            return;
          }
          
          // Input valido - procedi normalmente
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
        
      case 'input_audio_buffer.speech_started':
        console.log('🎤 Utente sta parlando...');
        break;
        
      case 'input_audio_buffer.speech_stopped':
        console.log('🎤 Utente ha finito di parlare');
        break;
        
      default:
        if (process.env.DEBUG_REALTIME) {
          console.log(`📨 ${message.type}`);
        }
    }
  }
  
  async handleToolCall(message) {
    const { call_id, name, arguments: argsString } = message;
    
    console.log(`🔧 Tool call: ${name}`);
    
    try {
      const args = JSON.parse(argsString);
      const tool = this.tools.find(t => t.name === name);
      
      if (!tool) {
        throw new Error(`Tool non trovato: ${name}`);
      }
      
      const result = await tool.handler(args, {
        callSid: this.callSid,
        restaurantConfig: this.restaurantConfig
      });
      
      console.log(`✅ Tool result:`, result);
      
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
  
  sendAudio(audioBase64) {
    if (!this.isConnected) return;
    
    // ═══════════════════════════════════════════════════════════════════════════
    // v2.0.0: NON bloccare l'audio in ingresso - lascia che OpenAI gestisca il VAD
    // Il filtraggio avviene a livello di TRASCRIZIONE, non di audio
    // ═══════════════════════════════════════════════════════════════════════════
    
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
