// ═══════════════════════════════════════════════════════════════════════════════
// MEDIA STREAM HANDLER — vC11 (2026-05-29)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Riscritto seguendo il pattern del tutorial ufficiale Telnyx per OpenAI Realtime
// (telnyx.com/resources/outbound-ai-calls-python-openai-realtime, maggio 2026).
//
// CAMBI RISPETTO AL vC10:
//   - I messaggi 'media' inviati a Telnyx NON includono più stream_sid.
//     Il tutorial ufficiale Telnyx invia solo { event: 'media', media: { payload } }.
//     stream_sid lo richiede Twilio, non Telnyx, e ce lo eravamo portati dietro
//     per errore.
//   - Lifecycle semplificato: la chiamata vive finché la WebSocket vive
//     (grazie a <Connect> nel TeXML). Niente più gestione di pause artificiali.
// ═══════════════════════════════════════════════════════════════════════════════

import { WebSocketServer } from 'ws';
import { OpenAIRealtimeClient } from './openai-realtime.js';
import { DateManager } from './openai-realtime.js';

// ─── Cache Registry (Google Sheet multi-tenant) ──────────────────────────────
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

// ─── WebSocket handler /media-stream ─────────────────────────────────────────
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
          // Telnyx ha aperto la WS. Non è ancora arrivata la chiamata.
          console.log('✅ Telnyx connected');
          break;

        case 'start': {
          // La chiamata è agganciata alla WS. Adesso conosciamo CallSid, From, To.
          const callId     = msg.start?.call_sid  || msg.start?.callSid || `call-${Date.now()}`;
          const toNumber   = msg.start?.to        || '';
          const fromNumber = msg.start?.from      || '';
          streamSid        = msg.start?.stream_sid || callId;

          console.log(`📞 CallSid: ${callId} | From: ${fromNumber} | To: ${toNumber}`);

          // Recupera config ristorante dal registry (multi-tenant by phone number).
          const rc = await getRestaurantConfig(toNumber);

          // Crea il client OpenAI Realtime. Il callback onAudioDelta viene impostato
          // PRIMA di connect() così l'audio del saluto iniziale (che il modello
          // genera appena la sessione è pronta) trova già il canale di ritorno aperto.
          openaiClient = new OpenAIRealtimeClient({
            apiKey:           process.env.OPENAI_API_KEY,
            restaurantConfig: rc,
            callerPhone:      fromNumber,

            // Audio del modello → Telnyx.
            // FORMATO TELNYX UFFICIALE: { event: 'media', media: { payload: base64 } }
            // NIENTE stream_sid (era un residuo Twilio nel vC10). Confermato dal
            // tutorial Telnyx OpenAI Realtime di maggio 2026.
            onAudioDelta: (audioBase64) => {
              if (telnyxWs.readyState === 1) {
                telnyxWs.send(JSON.stringify({
                  event: 'media',
                  media: { payload: audioBase64 },
                }));
              }
            },

            onError: (err) => console.error('❌ OpenAI error:', err),
            onClose: (code) => {
              isConnected = false;
              console.log(`🔴 OpenAI chiuso (${code})`);
            },
          });

          await openaiClient.connect();
          isConnected = true;
          console.log('✅ Sessione pronta, chiamata attiva');
          break;
        }

        case 'media':
          // Audio del cliente (PCMU 8kHz base64) → OpenAI Realtime, pass-through.
          if (openaiClient && isConnected && msg.media?.payload) {
            openaiClient.sendAudio(msg.media.payload);
          }
          break;

        case 'stop':
          console.log('🛑 Stop');
          openaiClient?.close();
          try { telnyxWs.close(); } catch {}
          break;

        case 'dtmf':
          // Toni del tastierino. Per ora non li gestiamo.
          console.log('☎️  DTMF:', msg.dtmf);
          break;

        case 'error':
          console.error('❌ Telnyx stream error:', msg);
          break;

        // 'mark', 'clear' e altri eventi: ignorati silenziosamente per ora.
      }
    });

    telnyxWs.on('close', () => {
      console.log('🔌 Telnyx WS chiusa');
      openaiClient?.close();
      isConnected = false;
    });

    telnyxWs.on('error', (err) => {
      console.error('❌ Telnyx WS error:', err.message);
    });
  });

  console.log('📡 WebSocket handler attivo su /media-stream');
}
