import WebSocket from 'ws';

// ─── STT SESSION (gpt-realtime-whisper) ──────────────────────────────────────
// Flow corretto GA transcription:
//
//   STEP 1: POST /v1/realtime/transcription_sessions  → config + ephemeral token
//   STEP 2: WebSocket intent=transcription con ephemeral token come Authorization
//   STEP 3: append audio → ricevi transcript.delta
//
// NON usare session.update dopo la connessione — la sessione è già configurata.
// NON usare OpenAI-Beta header — gpt-realtime-whisper è GA only.
// ─────────────────────────────────────────────────────────────────────────────

class STTSession {
  constructor(apiKey, opts = {}) {
    this.apiKey           = apiKey;
    this.ws               = null;
    this.ready            = false;
    this.language         = opts.language || 'it';
    this.onDelta          = opts.onDelta          || (() => {});
    this.onCompleted      = opts.onCompleted      || (() => {});
    this.onSpeechStarted  = opts.onSpeechStarted  || (() => {});
    this.onError          = opts.onError          || console.error;
    this.onClose          = opts.onClose          || (() => {});
  }

  async connect() {
    // STEP 1: crea la sessione via REST e ottieni ephemeral token
    const ephemeralToken = await this._createSession();

    // STEP 2: connetti WebSocket con ephemeral token
    return this._connectWebSocket(ephemeralToken);
  }

  async _createSession() {
    console.log('🔑 Creazione STT session via REST...');

    const response = await fetch(
      'https://api.openai.com/v1/realtime/transcription_sessions',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input_audio_format: 'g711_ulaw',
          input_audio_transcription: {
            model: 'gpt-realtime-whisper',
            language: this.language,
          },
          turn_detection: {
            type: 'server_vad',
            threshold: 0.55,
            prefix_padding_ms: 500,
            silence_duration_ms: 1800,
          },
          input_audio_noise_reduction: {
            type: 'far_field',
          },
        }),
      }
    );

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`STT session REST error ${response.status}: ${err}`);
    }

    const session = await response.json();
    const token = session.client_secret?.value;

    if (!token) {
      throw new Error('STT session: client_secret.value mancante nella risposta REST');
    }

    console.log(`✅ STT session creata: ${session.id || 'ok'}`);
    return token;
  }

  _connectWebSocket(ephemeralToken) {
    return new Promise((resolve, reject) => {
      // STEP 2: WebSocket con ephemeral token, nessun OpenAI-Beta header
      const url = 'wss://api.openai.com/v1/realtime?intent=transcription';
      this.ws = new WebSocket(url, {
        headers: {
          'Authorization': `Bearer ${ephemeralToken}`,
        },
      });

      this.ws.on('open', () => {
        console.log('🎙️  STT WebSocket connesso');
        // STEP 3: nessun session.update — sessione già configurata via REST
      });

      this.ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }

        switch (msg.type) {
          case 'session.created':
          case 'transcription_session.created':
            console.log(`📋 STT session: ${msg.session?.id || 'ok'}`);
            // Sessione pronta — configurata via REST, non serve session.update
            if (!this.ready) {
              this.ready = true;
              console.log('✅ STT session pronta');
              resolve();
            }
            break;

          case 'session.updated':
          case 'transcription_session.updated':
            if (!this.ready) {
              this.ready = true;
              console.log('✅ STT session pronta (updated)');
              resolve();
            }
            break;

          case 'conversation.item.input_audio_transcription.delta':
            if (msg.delta) this.onDelta(msg.delta);
            break;

          case 'conversation.item.input_audio_transcription.completed':
            if (msg.transcript) this.onCompleted(msg.transcript);
            break;

          case 'input_audio_buffer.speech_started':
            console.log('🎤 Parla...');
            this.onSpeechStarted();
            break;

          case 'input_audio_buffer.speech_stopped':
            console.log('🎤 Fine (VAD)');
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

      // Timeout connessione WebSocket
      setTimeout(() => {
        if (!this.ready) reject(new Error('STT WebSocket timeout'));
      }, 10000);
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
