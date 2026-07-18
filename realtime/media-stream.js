// ═══════════════════════════════════════════════════════════════════════════════
// MEDIA STREAM HANDLER — Batch 1 (v7.4.0)
// - Rimosso capture WAV completo (compliance GDPR: no biometric data storage)
// - Fallback Registry lookup se callInfo mancante (race condition deploy)
// ═══════════════════════════════════════════════════════════════════════════════

import { WebSocketServer } from 'ws';
import { OpenAIRealtimeClient } from './openai-realtime.js';
import { randomUUID } from 'crypto';

// setupMediaStreamHandler(server, callInfoByCallControlId, registryLookupFn?)
export function setupMediaStreamHandler(server, callInfoByCallControlId = new Map(), registryLookupFn = null) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    if (req.url && req.url.startsWith('/media-stream')) {
      wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
    }
  });

  wss.on('connection', (telnyxWs, req) => {
    const connId = randomUUID().substring(0, 8);
    console.log(`🔌 [${connId}] Nuova connessione Telnyx (url=${req.url})`);

    let callControlId = null;
    try {
      const u = new URL(req.url, `http://${req.headers.host || 'x'}`);
      callControlId = u.searchParams.get('callControlId');
    } catch {}

    let callInfo = callControlId ? callInfoByCallControlId.get(callControlId) : null;
    let from = callInfo?.from || '';
    let to = callInfo?.to || '';
    let restaurantConfig = callInfo?.restaurantConfig || null;

    if (callInfo) {
      const rn = restaurantConfig?.restaurantName || '(nessuna config)';
      console.log(`✅ [${connId}] callControlId=${callControlId} from=${from} to=${to} ristorante="${rn}"`);
    } else {
      console.log(`⚠️  [${connId}] callControlId=${callControlId || '(mancante)'} — nessuna callInfo (probabile race deploy)`);
    }

    let openaiClient = null;
    let streamSid    = null;

    telnyxWs.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      switch (msg.event) {
        case 'connected':
          console.log(`✅ [${connId}] Telnyx connected`);
          break;

        case 'start': {
          streamSid = msg.start?.stream_sid || `stream-${Date.now()}`;
          console.log(`📞 [${connId}] Start - streamSid: ${streamSid} - CallSid: ${msg.start?.call_sid}`);

          if (!restaurantConfig && registryLookupFn) {
            const startFrom = msg.start?.from;
            const startTo   = msg.start?.to;
            if (startTo) {
              console.log(`🔄 [${connId}] Fallback Registry lookup via msg.start (to=${startTo})...`);
              try {
                const cfg = await registryLookupFn(startTo);
                if (cfg) {
                  restaurantConfig = cfg;
                  from = startFrom || '';
                  to   = startTo   || '';
                  console.log(`✅ [${connId}] Fallback riuscito → ristorante="${cfg.restaurantName}"`);
                } else {
                  console.warn(`⚠️  [${connId}] Fallback Registry lookup: nessun match per ${startTo}`);
                }
              } catch (e) {
                console.error(`❌ [${connId}] Errore fallback lookup: ${e.message}`);
              }
            }
          }

          openaiClient = new OpenAIRealtimeClient({
            apiKey: process.env.OPENAI_API_KEY,
            connId,
            from,
            to,
            callControlId,
            restaurantConfig,
            onAudioDelta: (chunk) => {
              if (telnyxWs.readyState === 1) {
                telnyxWs.send(JSON.stringify({
                  event: 'media',
                  stream_sid: streamSid,
                  media: { payload: chunk },
                }));
              }
            },
          });

          await openaiClient.connect();
          console.log(`✅ [${connId}] Bridge attivo`);
          break;
        }

        case 'media':
          // v7.4.0 GDPR: no capture WAV. Solo forward audio a OpenAI.
          if (openaiClient && msg.media?.payload) {
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
      console.log(`🔌 [${connId}] Telnyx chiuso`);
      if (openaiClient) openaiClient.close();
    });

    telnyxWs.on('error', (err) => {
      console.error(`❌ [${connId}] Telnyx WS error: ${err?.message}`);
    });
  });

  return wss;
}
