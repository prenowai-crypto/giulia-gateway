import WebSocket from 'ws';

// ─── TTS SESSION (gpt-realtime-mini) ─────────────────────────────────────────
// Sessione dedicata SOLO alla generazione audio.
// Nessun input audio — nessun VAD — nessun function calling.
// Riceve testo dal server → emette audio PCMU a Telnyx.

class TTSSession {
  constructor(apiKey, opts = {}) {
    this.apiKey   = apiKey;
    this.voice    = opts.voice || 'coral';
    this.ws       = null;
    this.ready    = false;
    this._currentResponseId = null;
    this.onAudioDelta = opts.onAudioDelta || (() => {});
    this.onAudioDone  = opts.onAudioDone  || (() => {});
    this.onError      = opts.onError      || console.error;
    this.onClose      = opts.onClose      || (() => {});
  }

  async connect() {
    return new Promise((resolve, reject) => {
      const url = 'wss://api.openai.com/v1/realtime?model=gpt-realtime-mini';
      this.ws = new WebSocket(url, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      });

      this.ws.on('open', () => {
        console.log('🔊 TTS session connessa');
        this._configureSession();
      });

      this.ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }

        switch (msg.type) {
          case 'session.created':
            console.log(`📋 TTS session: ${msg.session?.id || 'ok'}`);
            break;

          case 'session.updated':
            if (!this.ready) {
              this.ready = true;
              console.log('✅ TTS session pronta');
              resolve();
            }
            break;

          case 'response.created':
            // Salva response_id per filtrare delta audio vecchi
            this._currentResponseId = msg.response?.id || null;
            break;

          case 'response.output_audio.delta':
            // Invia audio a Telnyx solo se appartiene alla response corrente
            if (msg.delta && msg.response_id === this._currentResponseId) {
              this.onAudioDelta(msg.delta);
            }
            break;

          case 'response.output_audio.done':
          case 'response.done':
            if (msg.response_id === this._currentResponseId ||
                msg.response?.id === this._currentResponseId) {
              this._currentResponseId = null;
              this.onAudioDone();
            }
            break;

          case 'response.output_audio_transcript.done':
            if (msg.transcript) {
              console.log(`💬 [AI]: ${msg.transcript}`);
            }
            break;

          case 'error':
            if (msg.error?.code !== 'response_cancel_not_active') {
              console.error('❌ TTS error:', msg.error);
              this.onError(msg.error);
            }
            break;

          default:
            if (msg.type && !msg.type.includes('delta') && !msg.type.includes('audio')) {
              console.log(`🔍 TTS event: ${msg.type}`);
            }
            break;
        }
      });

      this.ws.on('error', (err) => {
        console.error('❌ TTS WS error:', err.message);
        reject(err);
      });

      this.ws.on('close', (code) => {
        console.log(`🔴 TTS disconnessa (${code})`);
        this.ready = false;
        this.onClose(code);
      });

      setTimeout(() => {
        if (!this.ready) reject(new Error('TTS session timeout'));
      }, 10000);
    });
  }

  _configureSession() {
    this._send({
      type: 'session.update',
      session: {
        type: 'realtime',
        instructions: 'You are a TTS reader. Say EXACTLY the text provided, nothing more.',
        tool_choice: 'none',
        audio: {
          output: {
            format: { type: 'audio/pcmu' },  // G.711 μ-law per Telnyx
            voice: this.voice,
          },
        },
      },
    });
  }

  // Dice una frase esatta — conversation:none = ignora storia conversazione
  speak(text, lang) {
    this.cancel();  // Cancella audio in corso

    // FIX 5: istruzione ultra-restrittiva per evitare parafrasi
    // Il testo va SOLO nelle instructions, non nell'input (evita rielaborazione)
    const isIt = !lang || lang === 'it';
    const instruction = isIt
      ? `Leggi ad alta voce ESATTAMENTE questo testo, parola per parola, senza cambiare nulla: ${text}`
      : `Read aloud EXACTLY this text, word for word, do not change anything: ${text}`;

    this._send({
      type: 'response.create',
      response: {
        conversation: 'none',
        output_modalities: ['audio'],
        instructions: instruction,
        // NON includere input separato: evita che GPT "risponda" invece di leggere
      },
    });
  }

  // Traduzione live: GPT traduce e dice in lingua target
  speakTranslated(text, targetLang) {
    this.cancel();
    this._send({
      type: 'response.create',
      response: {
        conversation: 'none',
        output_modalities: ['audio'],
        instructions: `TRANSLATION ONLY. Translate this Italian text to ${targetLang} and say ONLY the translation, nothing else: "${text}"`,
        input: [{
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text }],
        }],
      },
    });
  }

  cancel() {
    this._send({ type: 'response.cancel' });
    this._currentResponseId = null;
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



export { TTSSession };
