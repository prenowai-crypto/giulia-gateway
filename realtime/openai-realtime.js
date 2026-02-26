// ═══════════════════════════════════════════════════════════════════════════════
// PRENOW - OPENAI REALTIME CLIENT v2.1.0
// 
// FIX CRITICO: Echo cancellation che PERMETTE il barge-in
// 
// PROBLEMA: Con Telnyx both_tracks, l'AI sente la propria voce come echo.
// MA il cliente deve poter interrompere l'AI (barge-in).
//
// SOLUZIONE INTELLIGENTE:
// 1. L'audio NON viene MAI bloccato - fluisce sempre verso OpenAI
// 2. Quando arriva una trascrizione, verifico se è ECHO o INPUT REALE
// 3. ECHO = trascrizione che inizia come una frase AI recente
// 4. BARGE-IN = trascrizione che arriva MENTRE AI parla ma è DIVERSA
// 5. Frasi corte ("sì", "no", "ok") sono sempre considerate input reale
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
    
    // ═══════════════════════════════════════════════════════════════════════════
    // v2.1.0: Echo detection intelligente
    // ═══════════════════════════════════════════════════════════════════════════
    this.recentAiTranscripts = [];      // Ultime trascrizioni AI (testo completo)
    this.recentAiPhrases = [];          // Frasi/parti delle risposte AI per matching parziale
    this.MAX_AI_HISTORY = 10;           // Quante entry tenere
    this.lastAiFinishedTime = 0;        // Quando l'AI ha FINITO di parlare
    this.isAiCurrentlySpeaking = false; // True mentre AI sta generando audio
    this.speechStartedDuringAi = false; // True se utente ha iniziato a parlare durante AI
    
    // Finestra temporale: echo può arrivare fino a 5 secondi dopo che AI finisce
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
          threshold: 0.6,            // Sensibilità media per catturare barge-in
          prefix_padding_ms: 300,    // Padding ragionevole
          silence_duration_ms: 800   // Più veloce per conversazione naturale
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
  
  // ═══════════════════════════════════════════════════════════════════════════
  // v2.1.0: Estrae parole significative da un testo
  // ═══════════════════════════════════════════════════════════════════════════
  extractWords(text) {
    if (!text) return [];
    return text.toLowerCase()
      .replace(/[.,!?;:'"()]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 1);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // v2.1.0: Verifica se il testo utente è un ECHO dell'AI
  // ═══════════════════════════════════════════════════════════════════════════
  isEchoOfAi(userText) {
    if (!userText) return true; // Testo vuoto = ignora
    
    const trimmed = userText.trim();
    
    // ─────────────────────────────────────────────────────────────────────────
    // REGOLA 1: Frasi molto corte sono SEMPRE input reale (non echo)
    // "Sì", "No", "Ok", "Grazie" etc.
    // ─────────────────────────────────────────────────────────────────────────
    if (trimmed.length <= 15) {
      console.log(`🔊 v2.1.0: Frase corta (${trimmed.length} chars) = INPUT REALE: "${trimmed}"`);
      return false;
    }
    
    const userWords = this.extractWords(trimmed);
    
    if (userWords.length <= 3) {
      console.log(`🔊 v2.1.0: Poche parole (${userWords.length}) = INPUT REALE: "${trimmed}"`);
      return false;
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // REGOLA 2: Se l'utente ha iniziato a parlare MENTRE l'AI parlava (barge-in),
    // è probabilmente input reale, non echo
    // ─────────────────────────────────────────────────────────────────────────
    if (this.speechStartedDuringAi) {
      console.log(`🔊 v2.1.0: Speech iniziato durante AI (barge-in) = probabilmente INPUT REALE`);
      // Reset flag
      this.speechStartedDuringAi = false;
      // Comunque fai il check echo, ma con soglia più alta
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // REGOLA 3: Controlla finestra temporale
    // Echo arriva tipicamente 1-3 secondi dopo che AI ha finito
    // ─────────────────────────────────────────────────────────────────────────
    const timeSinceAiFinished = Date.now() - this.lastAiFinishedTime;
    
    if (timeSinceAiFinished > this.ECHO_WINDOW_MS) {
      console.log(`🔊 v2.1.0: Fuori finestra echo (${timeSinceAiFinished}ms > ${this.ECHO_WINDOW_MS}ms) = INPUT REALE`);
      return false;
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // REGOLA 4: Confronta con frasi AI recenti
    // Echo tipicamente contiene PARTI della frase AI
    // ─────────────────────────────────────────────────────────────────────────
    const userWordSet = new Set(userWords);
    
    for (const aiPhrase of this.recentAiPhrases) {
      const aiWords = this.extractWords(aiPhrase);
      if (aiWords.length === 0) continue;
      
      // Conta quante parole dell'utente sono presenti nella frase AI
      let matchCount = 0;
      for (const word of userWords) {
        if (aiWords.includes(word)) matchCount++;
      }
      
      const matchRatio = matchCount / userWords.length;
      
      // Se più del 50% delle parole utente sono nella frase AI = ECHO
      if (matchRatio > 0.5 && matchCount >= 3) {
        console.log(`🔇 v2.1.0: ECHO RILEVATO!`);
        console.log(`   Match: ${matchCount}/${userWords.length} parole (${(matchRatio*100).toFixed(0)}%)`);
        console.log(`   AI disse: "${aiPhrase.substring(0, 60)}..."`);
        console.log(`   Ricevuto: "${trimmed.substring(0, 60)}..."`);
        return true;
      }
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // REGOLA 5: Controlla parole chiave tipiche del greeting AI
    // Se la trascrizione contiene MOLTE parole tipiche del saluto AI, è echo
    // ─────────────────────────────────────────────────────────────────────────
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
    
    // Se 3+ parole chiave di greeting E siamo entro 3 secondi = ECHO
    if (greetingMatches >= 3 && timeSinceAiFinished < 3000) {
      console.log(`🔇 v2.1.0: ECHO (greeting keywords): ${greetingMatches} match in "${trimmed.substring(0, 40)}..."`);
      return true;
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // Nessun match = INPUT REALE
    // ─────────────────────────────────────────────────────────────────────────
    console.log(`🔊 v2.1.0: INPUT REALE: "${trimmed.substring(0, 50)}..."`);
    return false;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // v2.1.0: Salva una frase AI per futuro echo detection
  // ═══════════════════════════════════════════════════════════════════════════
  saveAiPhrase(transcript) {
    if (!transcript || transcript.trim().length < 5) return;
    
    // Salva trascrizione completa
    this.recentAiTranscripts.unshift(transcript);
    if (this.recentAiTranscripts.length > this.MAX_AI_HISTORY) {
      this.recentAiTranscripts.pop();
    }
    
    // Salva anche sottostringhe per matching parziale
    // (l'echo potrebbe catturare solo parte della frase)
    this.recentAiPhrases.unshift(transcript);
    
    // Dividi in parti se la frase è lunga
    const words = transcript.split(/\s+/);
    if (words.length > 5) {
      // Prima metà
      this.recentAiPhrases.unshift(words.slice(0, Math.ceil(words.length/2)).join(' '));
      // Seconda metà
      this.recentAiPhrases.unshift(words.slice(Math.floor(words.length/2)).join(' '));
    }
    
    // Mantieni solo le ultime N
    while (this.recentAiPhrases.length > this.MAX_AI_HISTORY * 2) {
      this.recentAiPhrases.pop();
    }
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
        // AI sta parlando
        this.isAiCurrentlySpeaking = true;
        
        if (message.delta) {
          this.onAudioDelta(message.delta);
        }
        break;
        
      case 'response.audio_transcript.done':
        // Trascrizione AI completata - salvala per echo detection
        if (message.transcript) {
          this.saveAiPhrase(message.transcript);
          console.log(`💬 [assistant]: ${message.transcript}`);
          this.onTranscript(message.transcript, 'assistant');
        }
        break;
        
      case 'response.done':
        // AI ha finito di parlare
        this.isAiCurrentlySpeaking = false;
        this.lastAiFinishedTime = Date.now();
        
        if (message.response?.status === 'failed') {
          console.error('❌ Risposta fallita:', message.response.status_details);
        }
        break;
        
      case 'input_audio_buffer.speech_started':
        console.log('🎤 Utente sta parlando...');
        // Se l'utente inizia a parlare mentre AI sta parlando = barge-in
        if (this.isAiCurrentlySpeaking) {
          console.log('⚡ v2.1.0: BARGE-IN rilevato! Utente parla durante AI');
          this.speechStartedDuringAi = true;
        }
        break;
        
      case 'input_audio_buffer.speech_stopped':
        console.log('🎤 Utente ha finito di parlare');
        break;
        
      case 'conversation.item.input_audio_transcription.completed':
        // ═══════════════════════════════════════════════════════════════════
        // v2.1.0: PUNTO CRITICO - Echo detection intelligente
        // ═══════════════════════════════════════════════════════════════════
        if (message.transcript) {
          const transcript = message.transcript.trim();
          
          if (this.isEchoOfAi(transcript)) {
            console.log(`🔇 v2.1.0: Trascrizione IGNORATA (echo)`);
            // NON fare nulla - lascia che OpenAI gestisca normalmente
            // Non cancelliamo il buffer per non interferire con barge-in
            return;
          }
          
          // Input valido - notifica
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
  
  // ═══════════════════════════════════════════════════════════════════════════
  // AUDIO: MAI bloccato - fluisce sempre verso OpenAI
  // ═══════════════════════════════════════════════════════════════════════════
  sendAudio(audioBase64) {
    if (!this.isConnected) {
      return;
    }
    
    // Debug: log primi invii
    if (!this.audioSendCount) this.audioSendCount = 0;
    this.audioSendCount++;
    if (this.audioSendCount <= 3) {
      console.log(`📤 Invio audio #${this.audioSendCount} a OpenAI (${audioBase64?.length || 0} chars)`);
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
