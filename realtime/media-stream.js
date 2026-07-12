// ═══════════════════════════════════════════════════════════════════════════════
// MEDIA STREAM HANDLER — GIULIA v1 MULTI-TENANT (Fase 1)
// ═══════════════════════════════════════════════════════════════════════════════
// Differenze rispetto al minimal bridge:
//   - Accetta `callInfoByCallControlId` (Map) da index.js.
//   - Estrae `callControlId` dalla query dell'URL WS.
//   - Recupera { from, to, restaurantConfig } dalla Map e li passa al client.
//
// Diagnostica invariata: UUID connId, capture WAV, log hex primi 5 chunk.
// ═══════════════════════════════════════════════════════════════════════════════

import { WebSocketServer } from 'ws';
import { OpenAIRealtimeClient } from './openai-realtime.js';
import { randomUUID } from 'crypto';
import { writeFileSync, appendFileSync, readFileSync, mkdirSync } from 'fs';

const CAPTURE_DIR = '/tmp/captures';
const CAPTURE_SECONDS = 15;
const CAPTURE_MAX_BYTES = 8000 * CAPTURE_SECONDS;

try { mkdirSync(CAPTURE_DIR, { recursive: true }); } catch {}

export { CAPTURE_DIR };

// ─── Helper: costruisce un WAV μ-law da raw PCMU ────────────────────────────
export function buildWavFromMulawRaw(rawBuf) {
  const dataLen = rawBuf.length;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLen, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(7, 20);       // audio format 7 = μ-law
  header.writeUInt16LE(1, 22);       // channels
  header.writeUInt32LE(8000, 24);    // sample rate
  header.writeUInt32LE(8000, 28);    // byte rate
  header.writeUInt16LE(1, 32);       // block align
  header.writeUInt16LE(8, 34);       // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(dataLen, 40);
  return Buffer.concat([header, rawBuf]);
}

// ═══════════════════════════════════════════════════════════════════════════════
// setupMediaStreamHandler
// ═══════════════════════════════════════════════════════════════════════════════
export function setupMediaStreamHandler(server, callInfoByCallControlId = new Map()) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    if (req.url && req.url.startsWith('/media-stream')) {
      wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
    }
  });

  wss.on('connection', (telnyxWs, req) => {
    const connId = randomUUID().substring(0, 8);
    console.log(`🔌 [${connId}] Nuova connessione Telnyx (url=${req.url})`);

    // ─── Estrai callControlId dalla query string ─────────────────────────
    let callControlId = null;
    try {
      const u = new URL(req.url, `http://${req.headers.host || 'x'}`);
      callControlId = u.searchParams.get('callControlId');
    } catch {}

    const callInfo = callControlId ? callInfoByCallControlId.get(callControlId) : null;
    const from = callInfo?.from || '';
    const to   = callInfo?.to   || '';
    const restaurantConfig = callInfo?.restaurantConfig || null;

    if (callInfo) {
      const rn = restaurantConfig?.restaurantName || '(nessuna config)';
      console.log(`✅ [${connId}] callControlId=${callControlId} from=${from} to=${to} ristorante="${rn}"`);
    } else {
      console.log(`⚠️  [${connId}] callControlId=${callControlId || '(mancante)'} — nessuna callInfo`);
    }

    console.log(`📊 [${connId}] listener telnyxWs all'apertura: message=${telnyxWs.listenerCount('message')} close=${telnyxWs.listenerCount('close')} error=${telnyxWs.listenerCount('error')}`);

    let openaiClient = null;
    let streamSid    = null;

    // Capture diagnostico
    const capturePath = `${CAPTURE_DIR}/capture-${connId}.raw`;
    let captureBytesWritten = 0;
    let chunkLogCount = 0;

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
          console.log(`🔬 [${connId}] msg.start payload: ${JSON.stringify(msg.start).substring(0, 500)}`);

          try { writeFileSync(capturePath, Buffer.alloc(0)); } catch (e) {
            console.error(`❌ [${connId}] errore creazione capture file: ${e.message}`);
          }

          openaiClient = new OpenAIRealtimeClient({
            apiKey: process.env.OPENAI_API_KEY,
            connId,
            from,
            to,
            restaurantConfig,   // 🆕 config del ristorante (dal Registry)
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
            if (chunkLogCount < 5) {
              const buf = Buffer.from(msg.media.payload, 'base64');
              console.log(`🔬 [${connId}] chunk #${chunkLogCount + 1}: len=${buf.length} hex=${buf.subarray(0, 16).toString('hex')}`);
              chunkLogCount++;
            }
            if (captureBytesWritten < CAPTURE_MAX_BYTES) {
              try {
                const buf = Buffer.from(msg.media.payload, 'base64');
                const remaining = CAPTURE_MAX_BYTES - captureBytesWritten;
                const toWrite = buf.length <= remaining ? buf : buf.subarray(0, remaining);
                appendFileSync(capturePath, toWrite);
                captureBytesWritten += toWrite.length;
                if (captureBytesWritten >= CAPTURE_MAX_BYTES) {
                  const wavPath = `${CAPTURE_DIR}/${connId}.wav`;
                  try {
                    const rawBuf = readFileSync(capturePath);
                    writeFileSync(wavPath, buildWavFromMulawRaw(rawBuf));
                    console.log(`💾 [${connId}] capture completata: ${captureBytesWritten} byte → ${wavPath}`);
                  } catch (e) {
                    console.error(`❌ [${connId}] errore build wav: ${e.message}`);
                  }
                }
              } catch {}
            }

            openaiClient.sendAudio(msg.media.payload);
          }
          break;

        case 'stop':
          console.log(`🛑 [${connId}] Stop`);
          if (openaiClient) openaiClient.close();
          break;
      }
    });

    telnyxWs.on('close', () => {
      console.log(`🔌 [${connId}] Telnyx chiuso - capture: ${captureBytesWritten} byte salvati in ${capturePath}`);
      console.log(`📊 [${connId}] listener telnyxWs alla chiusura: message=${telnyxWs.listenerCount('message')} close=${telnyxWs.listenerCount('close')}`);
      if (openaiClient) openaiClient.close();
    });

    telnyxWs.on('error', (err) => {
      console.error(`❌ [${connId}] Telnyx WS error: ${err?.message}`);
    });
  });

  return wss;
}
