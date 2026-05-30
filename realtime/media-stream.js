// ═══════════════════════════════════════════════════════════════════════════════
// MEDIA STREAM HANDLER — MINIMAL BRIDGE + DIAG vC6-diag-2026-05-30
// ═══════════════════════════════════════════════════════════════════════════════
// Aggiunge diagnostici per identificare la causa della degradazione audio
// nelle chiamate consecutive:
//
//  1. UUID univoco per ogni connessione (loggato dappertutto)
//  2. Conteggio listener su telnyxWs e su openaiWs (deve restare a 1)
//  3. Dump audio raw PCMU su /tmp/capture-{uuid}.raw (primi 15 secondi)
//  4. Log hex primi 16 bytes dei primi 5 chunk audio
//  5. Endpoint HTTP per scaricare i capture come WAV
//
// L'idea (suggerimento dell'altra IA): se l'audio salvato suona italiano
// pulito, Telnyx è innocente e il problema è dopo. Se suona distorto,
// il problema è prima del gateway. Una sola prova ci elimina metà delle ipotesi.
// ═══════════════════════════════════════════════════════════════════════════════

import { WebSocketServer } from 'ws';
import { OpenAIRealtimeClient } from './openai-realtime.js';
import { randomUUID } from 'crypto';
import { writeFileSync, appendFileSync, existsSync } from 'fs';
import { mkdirSync } from 'fs';

const CAPTURE_DIR = '/tmp/captures';
const CAPTURE_SECONDS = 15;
const CAPTURE_MAX_BYTES = 8000 * CAPTURE_SECONDS; // 8kHz PCMU = 8000 byte/sec raw

// Crea cartella capture se non esiste
try { mkdirSync(CAPTURE_DIR, { recursive: true }); } catch {}

export function setupMediaStreamHandler(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    if (req.url === '/media-stream') {
      wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
    }
  });

  wss.on('connection', (telnyxWs) => {
    // ⚡ DIAG 1: UUID univoco per ogni connessione
    const connId = randomUUID().substring(0, 8);
    console.log(`🔌 [${connId}] Nuova connessione Telnyx`);

    // ⚡ DIAG 2: conteggio listener
    console.log(`📊 [${connId}] listener telnyxWs all'apertura: message=${telnyxWs.listenerCount('message')} close=${telnyxWs.listenerCount('close')} error=${telnyxWs.listenerCount('error')}`);

    let openaiClient = null;
    let streamSid    = null;

    // ⚡ DIAG 3+4: stato dump audio
    const capturePath = `${CAPTURE_DIR}/capture-${connId}.raw`;
    let captureBytesWritten = 0;
    let chunkLogCount = 0; // log hex dei primi 5 chunk

    telnyxWs.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      switch (msg.event) {
        case 'connected':
          console.log(`✅ [${connId}] Telnyx connected`);
          break;

        case 'start':
          streamSid = msg.start?.stream_sid || `stream-${Date.now()}`;
          console.log(`📞 [${connId}] Start - streamSid: ${streamSid} - CallSid: ${msg.start?.call_sid}`);

          // Crea file capture vuoto
          try { writeFileSync(capturePath, Buffer.alloc(0)); } catch (e) {
            console.error(`❌ [${connId}] errore creazione capture file: ${e.message}`);
          }

          openaiClient = new OpenAIRealtimeClient({
            apiKey: process.env.OPENAI_API_KEY,
            connId,  // passa l'UUID al client per tracciare
            onAudioDelta: (chunk) => {
              if (telnyxWs.readyState === 1) {
                telnyxWs.send(JSON.stringify({
                  event:      'media',
                  stream_sid: streamSid,
                  media:      { payload: chunk },
                }));
              }
            },
          });

          await openaiClient.connect();
          console.log(`✅ [${connId}] Bridge attivo`);
          break;

        case 'media':
          if (openaiClient && msg.media?.payload) {
            // ⚡ DIAG 4: log hex primi 16 bytes dei primi 5 chunk
            if (chunkLogCount < 5) {
              const buf = Buffer.from(msg.media.payload, 'base64');
              console.log(`🔬 [${connId}] chunk #${chunkLogCount + 1}: len=${buf.length} hex=${buf.subarray(0, 16).toString('hex')}`);
              chunkLogCount++;
            }

            // ⚡ DIAG 3: dump audio raw su file (primi 15 secondi)
            if (captureBytesWritten < CAPTURE_MAX_BYTES) {
              try {
                const buf = Buffer.from(msg.media.payload, 'base64');
                appendFileSync(capturePath, buf);
                captureBytesWritten += buf.length;
                if (captureBytesWritten >= CAPTURE_MAX_BYTES) {
                  console.log(`💾 [${connId}] capture completata: ${captureBytesWritten} byte → /captures/${connId}.wav`);
                }
              } catch (e) {
                console.error(`❌ [${connId}] errore append capture: ${e.message}`);
              }
            }

            openaiClient.sendAudio(msg.media.payload);
          }
          break;

        case 'stop':
          console.log(`🛑 [${connId}] Stop`);
          openaiClient?.close();
          break;
      }
    });

    telnyxWs.on('close', () => {
      console.log(`🔌 [${connId}] Telnyx chiuso - capture: ${captureBytesWritten} byte salvati in ${capturePath}`);
      console.log(`📊 [${connId}] listener telnyxWs alla chiusura: message=${telnyxWs.listenerCount('message')} close=${telnyxWs.listenerCount('close')}`);
      openaiClient?.close();
    });

    telnyxWs.on('error', (err) => {
      console.error(`❌ [${connId}] Telnyx WS error: ${err.message}`);
    });
  });

  console.log('📡 WebSocket handler attivo su /media-stream');

  // Monitor memoria + WSS listeners ogni 30s
  setInterval(() => {
    const m = process.memoryUsage();
    const mb = (n) => Math.round(n / 1024 / 1024);
    console.log(`💾 mem: rss=${mb(m.rss)}MB heapUsed=${mb(m.heapUsed)}MB | WSS clients: ${wss.clients.size} | WSS listenerCount('connection'): ${wss.listenerCount('connection')}`);
  }, 30000);
}

// ─── Endpoint per scaricare i capture come WAV ──────────────────────────────
// PCMU 8kHz mono → WAV format=7 (WAVE_FORMAT_MULAW)
// Lo header WAV viene generato al volo dal file raw.
export function buildWavFromMulawRaw(rawBuf) {
  const dataLen = rawBuf.length;
  const header = Buffer.alloc(58);
  let p = 0;
  header.write('RIFF', p); p += 4;
  header.writeUInt32LE(50 + dataLen, p); p += 4;  // ChunkSize
  header.write('WAVE', p); p += 4;
  header.write('fmt ', p); p += 4;
  header.writeUInt32LE(18, p); p += 4;       // Subchunk1Size (18 per non-PCM)
  header.writeUInt16LE(7, p); p += 2;        // AudioFormat: 7 = µ-law
  header.writeUInt16LE(1, p); p += 2;        // NumChannels: mono
  header.writeUInt32LE(8000, p); p += 4;     // SampleRate
  header.writeUInt32LE(8000, p); p += 4;     // ByteRate (8000 * 1 * 8/8)
  header.writeUInt16LE(1, p); p += 2;        // BlockAlign
  header.writeUInt16LE(8, p); p += 2;        // BitsPerSample
  header.writeUInt16LE(0, p); p += 2;        // cbSize
  header.write('fact', p); p += 4;
  header.writeUInt32LE(4, p); p += 4;        // fact chunk size
  header.writeUInt32LE(dataLen, p); p += 4;  // num samples
  header.write('data', p); p += 4;
  header.writeUInt32LE(dataLen, p); p += 4;
  return Buffer.concat([header, rawBuf]);
}

export { CAPTURE_DIR };
