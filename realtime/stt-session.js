import WebSocket from 'ws';

// ─── STT SESSION (gpt-realtime-whisper) ──────────────────────────────────────
// Sessione dedicata SOLO alla trascrizione audio.
// Nessun output audio — nessun VAD duplex — nessun function calling.
// Riceve PCMU 8kHz da Telnyx → emette transcript.delta ogni ~200ms durante il parlato.

class STTSession {
  constructor(apiKey, opts = {}) {
    this.apiKey    = apiKey;
    this.ws        = null;
    this.ready     = false;
    this.language  = opts.language || 'it';
    this.onDelta          = opts.onDelta          || (() => {});
    this.onCompleted      = opts.onCompleted      || (() => {});
    this.onSpeechStarted  = opts.onSpeechStarted  || (() => {});
    this.onError          = opts.onError          || console.error;
    this.onClose          = opts.onClose          || (() => {});
  }

  async connect() {
    return new Promise((resolve, reject) => {
      // gpt-realtime-whisper: sessione transcription dedicata
      const url = 'wss://api.openai.com/v1/realtime?model=gpt-realtime-whisper&intent=transcription';
      this.ws = new WebSocket(url, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      });

      this.ws.on('open', () => {
        console.log('🎙️  STT session connessa');
        this._configureSession();
      });

      this.ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }

        switch (msg.type) {
          case 'transcription_session.created':
          case 'session.created':
            console.log(`📋 STT session: ${msg.session?.id || 'ok'}`);
            break;

          case 'transcription_session.updated':
          case 'session.updated':
            if (!this.ready) {
              this.ready = true;
              console.log('✅ STT session pronta');
              resolve();
            }
            break;

          case 'conversation.item.input_audio_transcription.delta':
            if (msg.delta) this.onDelta(msg.delta);
            break;

          case 'input_audio_buffer.speech_started':
            console.log('🎤 Parla...');
            this.onSpeechStarted();
            break;

          case 'input_audio_buffer.speech_stopped':
            console.log('🎤 Fine (VAD)');
            break;

          case 'conversation.item.input_audio_transcription.completed':
            if (msg.transcript) this.onCompleted(msg.transcript);
            break;

          case 'error':
            if (msg.error?.code !== 'session_expired') {
              console.error('❌ STT error:', msg.error);
              this.onError(msg.error);
            }
            break;

          default:
            if (msg.type && !msg.type.includes('delta')) {
              console.log(`🔍 STT event: ${msg.type}`);
            }
            break;
        }
      });

      this.ws.on('error', (err) => {
        console.error('❌ STT WS error:', err.message);
        reject(err);
      });

      this.ws.on('close', (code) => {
        console.log(`🔴 STT disconnessa (${code})`);
        this.ready = false;
        this.onClose(code);
      });

      // Timeout connessione: 10 secondi
      setTimeout(() => {
        if (!this.ready) reject(new Error('STT session timeout'));
      }, 10000);
    });
  }

  _configureSession() {
    this._send({
      type: 'transcription_session.update',
      session: {
        input_audio_format: 'pcmu',  // G.711 μ-law — Telnyx nativo
        input_audio_transcription: {
          model: 'gpt-realtime-whisper',
          language: this.language,
        },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.55,            // telefonia: soglia più alta filtra comfort noise
          prefix_padding_ms: 500,
          silence_duration_ms: 1800,  // 1800ms ottimale per telefonia italiana
          create_response: false,     // NON creare response automatiche
        },
        noise_reduction: { type: 'far_field' },  // filtra rumore linea PSTN
      },
    });
  }

  sendAudio(pcmuBase64) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this._send({ type: 'input_audio_buffer.append', audio: pcmuBase64 });
    }
  }

  _send(obj) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  close() {
    this.ws?.close();
  }
}



export { STTSession };
