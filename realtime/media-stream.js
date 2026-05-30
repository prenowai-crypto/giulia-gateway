// ═══════════════════════════════════════════════════════════════════════════════
// MEDIA STREAM HANDLER — RESTORE vC6 (2026-05-30)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Ripristino del media-stream del 27 maggio (vC6). Include stream_sid nei
// messaggi media verso Telnyx, come l'originale funzionante.
// ═══════════════════════════════════════════════════════════════════════════════

import { WebSocketServer } from 'ws';
import { OpenAIRealtimeClient } from './openai-realtime.js';
import { DateManager } from './openai-realtime.js';

const registryCache = { data: null, time: 0, ttl: 5 * 60 * 1000 };

async function fetchRegistry() {
  const now = Date.now();
  if (registryCache.data && (now - registryCache.time) < registryCache.ttl) {
    return registryCache.data;
  }

  const SHEET_ID   = process.env.REGISTRY_SHEET_ID   || '1AdXq1EagVhPsX-UT4HENfuQ1mxUN39kWtECiY6he8bg';
  const SHEET_NAME = process.env.REGISTRY_SHEET_NAME || 'Registry';
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=${SHEET_NAME}`;

  try {
    const resp = await fetch(url);
    const text = await resp.text();
    const match = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);?$/);
    if (!match) return [];

    const data = JSON.parse(match[1]);
    const cols = data.table.cols || [];
    const rows = data.table.rows || [];

    let headers = cols.map(c => c.label || '');
    if (headers.every(h => h === '') && rows.length > 0) {
      headers = rows[0].c.map(cell => cell ? String(cell.v ?? '') : '');
      rows.shift();
    }

    const registry = rows.map(row => {
      const obj = {};
      row.c.forEach((cell, idx) => {
        if (headers[idx]) obj[headers[idx]] = cell ? (cell.v ?? '') : '';
      });
      return obj;
    });

    console.log(`📋 Registry caricato: ${registry.length} ristoranti attivi`);
    registryCache.data = registry;
    registryCache.time = now;
    return registry;
  } catch (err) {
    console.error('❌ Registry error:', err.message);
    return registryCache.data || [];
  }
}

async function getRestaurantConfig(telnyxNumber) {
  if (!telnyxNumber) return null;
  const registry = await fetchRegistry();
  const normalized = String(telnyxNumber).replace(/\D/g, '');

  console.log(`🔍 Cercando ristorante per numero: ${telnyxNumber} (normalizzato: ${normalized})`);

  const match = registry.find(r => {
    const rNum = String(r.telnyx_number || r.twilio_number || '').replace(/\D/g, '');
    return rNum === normalized;
  });

  if (match) {
    console.log(`✅ Match trovato: ${normalized}`);
    console.log(`🍽️  ${match.restaurant_name}`);
  } else {
    console.log(`⚠️  Nessun match per ${normalized}`);
  }

  return match || null;
}

export function setupMediaStreamHandler(server, callDataMapExternal) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    if (req.url === '/media-stream') {
      wss.handleUpgrade(req, socket, head, ws => {
        wss.emit('connection', ws, req);
      });
    }
  });

  wss.on('connection', (telnyxWs) => {
    console.log('🔌 Nuova connessione Telnyx');

    let openaiClient = null;
    let streamSid    = null;
    let isConnected  = false;

    telnyxWs.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      switch (msg.event) {
        case 'connected':
          console.log('✅ Telnyx connected');
          break;

        case 'start': {
          const callId    = msg.start?.call_sid || msg.start?.callSid || `call-${Date.now()}`;
          const toNumber  = msg.start?.to   || '';
          const fromNumber = msg.start?.from || '';
          streamSid = msg.start?.stream_sid || callId;

          console.log(`📞 CallSid: ${callId} | From: ${fromNumber} | To: ${toNumber}`);

          const rc = await getRestaurantConfig(toNumber);

          openaiClient = new OpenAIRealtimeClient({
            apiKey:           process.env.OPENAI_API_KEY,
            restaurantConfig: rc,
            systemPrompt:     '',
            callerPhone:      fromNumber,

            // Audio TTS → Telnyx — INCLUDE stream_sid come nel vC6 originale
            onAudioDelta: (chunk) => {
              if (telnyxWs.readyState === 1) {
                telnyxWs.send(JSON.stringify({
                  event:      'media',
                  stream_sid: streamSid,
                  media:      { payload: chunk },
                }));
              }
            },

            onTranscript() {},
            onError(err) {
              console.error('❌ OpenAI error:', err);
            },
            onClose(code) {
              isConnected = false;
              console.log(`🔴 OpenAI chiuso (${code})`);
            },
          });

          await openaiClient.connect();
          isConnected = true;
          console.log('✅ Dual session pronta, chiamata attiva');
          break;
        }

        case 'media':
          if (openaiClient && isConnected && msg.media?.payload) {
            openaiClient.sendAudio(msg.media.payload);
          }
          break;

        case 'stop':
          console.log('🛑 Stop');
          openaiClient?.close();
          telnyxWs.close();
          break;
      }
    });

    telnyxWs.on('close', () => {
      console.log('🔌 Telnyx chiuso');
      openaiClient?.close();
      isConnected = false;
    });

    telnyxWs.on('error', (err) => {
      console.error('❌ Telnyx WS error:', err.message);
    });
  });

  console.log('📡 WebSocket handler attivo su /media-stream');
}
