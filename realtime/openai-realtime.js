// ═══════════════════════════════════════════════════════════════════════════════
// OPENAI REALTIME CLIENT — MINIMAL BRIDGE TEST (2026-05-30)
// ═══════════════════════════════════════════════════════════════════════════════
// Client minimale: connect, session.update con prompt triviale, forward audio
// bidirezionale, log diagnostico contatore byte.
//
// Niente functions, niente DateManager, niente Apps Script, niente buffer.
// Solo: ascolto, capisco, rispondo.
// ═══════════════════════════════════════════════════════════════════════════════

import WebSocket from 'ws';

console.log('🟢 openai-realtime.js MINIMAL-BRIDGE+DIAG+PCMA+RTW-IT-2026-05-31 caricato');

const REALTIME_MODEL = process.env.REALTIME_MODEL || 'gpt-realtime-mini';
const REALTIME_URL   = `wss://api.openai.com/v1/realtime?model=${REALTIME_MODEL}`;

const INSTRUCTIONS = `Sei un assistente vocale di test in italiano. Parli solo italiano.
All'inizio della chiamata saluti dicendo: "Ciao, sono un test, dimmi qualcosa così verifichiamo se ci sentiamo bene."
Poi quando l'utente parla, rispondi in modo breve e conversazionale, frasi corte (5-15 parole).
Non hai compiti specifici, scopo del test è solo verificare che ci si senta.`;

export class OpenAIRealtimeClient {
  constructor(opts = {}) {
    this.apiKey       = opts.apiKey;
    this.onAudioDelta = opts.onAudioDelta || (() => {});
    this.connId       = opts.connId || '????????';  // UUID per tracciare
    this._ws          = null;
    this._sessionReady = false;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(REALTIME_URL, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      });
      this._ws = ws;

      ws.once('open', () => {
        console.log(`🎙️  [${this.connId}] Realtime WS aperta (model: ${REALTIME_MODEL})`);
        console.log(`📊 [${this.connId}] listener openaiWs all'apertura: message=${ws.listenerCount('message')} close=${ws.listenerCount('close')} error=${ws.listenerCount('error')}`);
        this._sendSessionUpdate();
        resolve();
      });

      ws.on('message', (data) => this._onMessage(data));
      ws.on('error', (err) => console.error(`❌ [${this.connId}] Realtime WS error: ${err?.message}`));
      ws.on('close', (code) => {
        console.log(`🔴 [${this.connId}] Realtime WS chiusa (${code})`);
        console.log(`📊 [${this.connId}] listener openaiWs alla chiusura: message=${ws.listenerCount('message')} close=${ws.listenerCount('close')}`);
      });

      setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) reject(new Error('WS open timeout'));
      }, 10000);
    });
  }

  _sendSessionUpdate() {
    this._send({
      type: 'session.update',
      session: {
        type: 'realtime',
        instructions: INSTRUCTIONS,
        audio: {
          input: {
            format: { type: 'audio/pcma' },
            transcription: { model: 'gpt-realtime-whisper', language: 'it' },
            turn_detection: { type: 'server_vad' },
          },
          output: {
            format: { type: 'audio/pcma' },
            voice: 'coral',
          },
        },
      },
    });
  }

  _onMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    switch (msg.type) {
      case 'session.created':
        console.log(`📋 session.created: ${msg.session?.id}`);
        break;

      case 'session.updated':
        if (!this._sessionReady) {
          this._sessionReady = true;
          console.log('✅ session.updated → richiedo saluto iniziale');
          this._send({ type: 'response.create' });
        }
        break;

      case 'conversation.item.input_audio_transcription.completed':
        if (msg.transcript) console.log(`💬 [user]: ${msg.transcript.trim()}`);
        break;

      case 'response.output_audio.delta':
        if (msg.delta) this.onAudioDelta(msg.delta);
        break;

      case 'response.output_audio_transcript.done':
        if (msg.transcript) console.log(`💬 [AI]: ${msg.transcript}`);
        break;

      case 'input_audio_buffer.speech_started':
        console.log('🎙️  cliente: speech_started');
        break;

      case 'input_audio_buffer.speech_stopped':
        console.log('🎙️  cliente: speech_stopped');
        break;

      case 'response.done':
        if (msg.response?.usage) {
          const u = msg.response.usage;
          console.log(`📊 tokens: total=${u.total_tokens} in=${u.input_tokens} out=${u.output_tokens}`);
        }
        break;

      case 'error':
        console.error('❌ Realtime error:', JSON.stringify(msg.error || msg));
        break;
    }
  }

  sendAudio(pcmuBase64) {
    if (this._ws?.readyState !== WebSocket.OPEN) return;

    // Contatore diagnostico ogni 2s
    if (!this._stats) this._stats = { chunks: 0, bytes: 0, lastLog: Date.now() };
    this._stats.chunks++;
    this._stats.bytes += pcmuBase64.length;
    const now = Date.now();
    if (now - this._stats.lastLog >= 2000) {
      console.log(`🎤 audio IN (ultimi 2s): ${this._stats.chunks} chunk, ${this._stats.bytes} byte`);
      this._stats = { chunks: 0, bytes: 0, lastLog: now };
    }

    // Pass-through immediato a OpenAI, niente buffer
    this._send({ type: 'input_audio_buffer.append', audio: pcmuBase64 });
  }

  close() {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      try { this._ws.close(1000); } catch {}
    }
  }

  _send(event) {
    if (this._ws?.readyState !== WebSocket.OPEN) return;
    try { this._ws.send(JSON.stringify(event)); }
    catch (e) { console.error('❌ WS send:', e?.message); }
  }
}
