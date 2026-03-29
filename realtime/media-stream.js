// ═══════════════════════════════════════════════════════════════════════════════
// MEDIA STREAM HANDLER v3.0
// Gestisce WebSocket Telnyx ↔ OpenAI Realtime
// ═══════════════════════════════════════════════════════════════════════════════

import { WebSocketServer } from 'ws';
import { OpenAIRealtimeClient } from './openai-realtime.js';
import { DateManager } from './openai-realtime.js';

// ─── REGISTRY CACHE ──────────────────────────────────────────────────────────

const registryCache = { data: null, time: 0, ttl: 5 * 60 * 1000 };

async function fetchRegistry() {
  const now = Date.now();
  if (registryCache.data && (now - registryCache.time) < registryCache.ttl) {
    return registryCache.data;
  }

  const SHEET_ID   = process.env.REGISTRY_SHEET_ID || '1AdXq1EagVhPsX-UT4HENfuQ1mxUN39kWtECiY6he8bg';
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

// ─── SYSTEM PROMPT ───────────────────────────────────────────────────────────

function buildSystemPrompt(rc) {
  const now    = DateManager.getNow();
  const todayISO = DateManager.toISO(new Date(now.getFullYear(), now.getMonth(), now.getDate()));

  const closedDays = rc?.closed_days
    ? String(rc.closed_days).split(',').map(Number)
    : [1];
  const dayNames = ['domenica','lunedì','martedì','mercoledì','giovedì','venerdì','sabato'];
  const closedText = closedDays.map(d => dayNames[d]).join(', ');

  const ls = rc?.lunch_start  || '12:00';
  const le = rc?.lunch_end    || '14:30';
  const ds = rc?.dinner_start || '19:00';
  const de = rc?.dinner_end   || '22:30';

  const recName = rc?.receptionist_name || 'Giulia';
  const rName   = rc?.restaurant_name   || 'ristorante';

  return `Sei ${recName}, receptionist di ${rName}.
Parla in italiano, frasi brevi (max 2 frasi), tono professionale e cordiale.
Oggi è ${dayNames[now.getDay()]} ${todayISO}.
Orari: pranzo ${ls}-${le}, cena ${ds}-${de}.
Chiuso il: ${closedText}.
REGOLA ASSOLUTA: esegui SOLO le istruzioni [SISTEMA:...] che ricevi. Non aggiungere mai informazioni di tua iniziativa.`;
}

// ─── CALL STATE ───────────────────────────────────────────────────────────────

const callDataMap = new Map();

// ─── SETUP ───────────────────────────────────────────────────────────────────

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
    console.log('🔌 Nuova connessione');

    let openaiClient = null;
    let callId = null;
    let isConnected = false;

    telnyxWs.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      switch (msg.event) {
        case 'connected':
          console.log('✅ Telnyx connected');
          break;

        case 'start': {
          callId = msg.start?.call_sid || msg.start?.callSid || `call-${Date.now()}`;
          const toNumber   = msg.start?.to        || '';
          const streamSid  = msg.start?.stream_sid || callId;

          console.log(`📞 CallSid: ${callId}`);

          // Carica config ristorante
          const rc = await getRestaurantConfig(toNumber);

          // Crea client OpenAI Realtime
          openaiClient = new OpenAIRealtimeClient({
            apiKey:           process.env.OPENAI_API_KEY,
            restaurantConfig: rc,
            systemPrompt:     buildSystemPrompt(rc),
            onTranscript(text, role) {
              // già loggato internamente
            },
            onError(err) {
              console.error('❌ OpenAI error:', err);
            },
            onClose() {
              isConnected = false;
            },
          });

          // Connetti a OpenAI — connect() registra già il listener ws.on('message')
          await openaiClient.connect();

          // Intercetta messaggi OpenAI per audio → Telnyx
          // Lo facciamo DOPO connect() aggiungendo UN SOLO listener extra
          openaiClient.ws.on('message', (raw2) => {
            try {
              const m = JSON.parse(raw2);
              if (m.type === 'response.audio.delta' && m.delta && isConnected) {
                if (telnyxWs.readyState === 1) {
                  telnyxWs.send(JSON.stringify({
                    event: 'media',
                    stream_sid: streamSid,
                    media: { payload: m.delta },
                  }));
                }
              }
            } catch {}
          });

          isConnected = true;
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
      console.log('🔌 Chiuso');
      openaiClient?.close();
    });

    telnyxWs.on('error', (err) => {
      console.error('❌ Telnyx WS error:', err.message);
    });
  });

  console.log('📡 WebSocket attivo su /media-stream');
}
