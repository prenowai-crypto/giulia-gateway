import WebSocket from 'ws';

// ─── STT SESSION ─────────────────────────────────────────────────────────────
// Branch B: gpt-realtime-mini + whisper-1
// (fallback finché gpt-realtime-whisper non disponibile sull'account)
//
// Architettura:
//   - delta  → interrupt detection only (NON usare come testo)
//   - completed → transcript autoritativo → business logic
//   - create_response: false → sessione input-only
//   - cleanup conversation items dopo ogni completed
// ─────────────────────────────────────────────────────────────────────────────

class STTSession {
  constructor(apiKey, opts = {}) {
    this.apiKey          = apiKey;
    this.ws              = null;
    this.ready           = false;
    this._resolved       = false;   // protezione doppio resolve
    this._connectTimeout = null;    // per clearTimeout su connect
    this.language        = opts.language || 'it';

    this.onDelta         = opts.onDelta         || (() => {});   // solo interrupt hint
    this.onCompleted     = opts.onCompleted     || (() => {});   // transcript autoritativo
    this.onSpeechStarted = opts.onSpeechStarted || (() => {});
    this.onError         = opts.onError         || console.error;
    this.onClose         = opts.onClose         || (() => {});
  }

  async connect() {
    return new Promise((resolve, reject) => {
      // Branch B: gpt-realtime-mini con whisper-1
      const url = 'wss://api.openai.com/v1/realtime?model=gpt-realtime-mini';
      this.ws = new WebSocket(url, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      });

      // Timeout connessione — cancellato su resolve/reject/close
      this._connectTimeout = setTimeout(() => {
        if (!this._resolved) {
          this._resolved = true;
          reject(new Error('STT session timeout'));
        }
      }, 10000);

      const _resolve = () => {
        if (!this._resolved) {
          this._resolved = true;
          clearTimeout(this._connectTimeout);
          resolve();
        }
      };
      const _reject = (err) => {
        if (!this._resolved) {
          this._resolved = true;
          clearTimeout(this._connectTimeout);
          reject(err);
        }
      };

      this.ws.on('open', () => {
        console.log('🎙️  STT session connessa');
        this._configureSession();
      });

      this.ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }

        switch (msg.type) {

          case 'session.created':
            console.log(`📋 STT session: ${msg.session?.id || 'ok'}`);
            break;

          case 'session.updated':
            if (!this.ready) {
              this.ready = true;
              console.log('✅ STT session pronta (gpt-realtime-mini + whisper-1)');
              _resolve();
            }
            break;

          case 'conversation.item.input_audio_transcription.delta':
            // Delta = SOLO interrupt hint, NON testo definitivo
            if (msg.delta) this.onDelta(msg.delta);
            break;

          case 'conversation.item.input_audio_transcription.completed': {
            // Completed = transcript AUTORITATIVO → business logic
            const transcript = msg.transcript?.trim();
            if (transcript) {
              this.onCompleted(transcript);
              // Cleanup conversation item per evitare context/token growth
              if (msg.item_id) {
                this._send({
                  type: 'conversation.item.delete',
                  item_id: msg.item_id,
                });
              }
            }
            break;
          }

          case 'input_audio_buffer.speech_started':
            console.log('🎤 Parla...');
            this.onSpeechStarted();
            break;

          case 'input_audio_buffer.speech_stopped':
            console.log('🎤 Fine (VAD)');
            break;

          case 'error':
            if (msg.error?.code !== 'response_cancel_not_active') {
              console.error('❌ STT error:', msg.error);
              try { this.onError(msg.error); } catch(e) { console.error('❌ onError callback:', e); }
            }
            break;

          default:
            if (msg.type && !msg.type.includes('delta') && !msg.type.includes('audio')) {
              console.log(`🔍 STT event: ${msg.type}`);
            }
            break;
        }
      });

      this.ws.on('error', (err) => {
        console.error('❌ STT WS error:', err.message);
        _reject(err);
      });

      this.ws.on('close', (code) => {
        console.log(`🔴 STT disconnessa (${code})`);
        clearTimeout(this._connectTimeout);
        this.ready = false;
        this.onClose(code);
      });
    });
  }

  _configureSession() {
    // Branch B: session.update classico con gpt-realtime-mini + whisper-1
    // create_response: false → sessione input-only, nessun audio output
    this._send({
      type: 'session.update',
      session: {
        type: 'realtime',
        instructions: 'Transcription service only. Do not generate any response.',
        tool_choice: 'none',
        audio: {
          input: {
            format: { type: 'audio/pcmu' },
            transcription: {
              model: 'whisper-1',
              language: this.language,
            },
            turn_detection: {
              type: 'server_vad',
              threshold: 0.55,
              prefix_padding_ms: 500,
              silence_duration_ms: 1800,
              create_response: false,
              interrupt_response: false,
            },
          },
          // Nessun output audio — sessione input-only
        },
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
    clearTimeout(this._connectTimeout);
    this.ws?.close();
  }
}

export { STTSession };
