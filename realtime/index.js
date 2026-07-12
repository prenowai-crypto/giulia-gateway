// ═══════════════════════════════════════════════════════════════════════════════
// PRENOW REALTIME GATEWAY — GIULIA v1 MULTI-TENANT (Fase 1)
// ═══════════════════════════════════════════════════════════════════════════════
// Single-file gateway (stile v3.9.31): Registry inline, niente moduli extra.
//
// Flow:
//   1. call.initiated (webhook HTTP)
//      → Registry.getConfigForNumber(to) → cerca il ristorante nel Sheet pubblico
//      → salva callInfo = { from, to, restaurantConfig } nella Map
//      → invia ANSWER
//   2. call.answered
//      → streaming_start con stream_url che include ?callControlId=<id>
//   3. WS /media-stream?callControlId=<id>
//      → media-stream.js recupera callInfo dalla Map
//      → propaga restaurantConfig al client Realtime
//   4. call.hangup → cleanup Map
//
// Se il numero chiamato NON è nel Registry, callInfo.restaurantConfig = null.
// Il client Realtime lo riconosce e apre la chiamata con un messaggio di
// scusa educato senza tentare di gestire prenotazioni.
// ═══════════════════════════════════════════════════════════════════════════════

import express from 'express';
import { createServer } from 'http';
import { readdirSync, readFileSync, statSync } from 'fs';
import { setupMediaStreamHandler, buildWavFromMulawRaw, CAPTURE_DIR } from './media-stream.js';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 1: CONFIGURAZIONE
// ═══════════════════════════════════════════════════════════════════════════════

const PORT            = process.env.PORT            || 10000;
const BASE_URL        = process.env.BASE_URL        || 'https://prenow-realtime.onrender.com';
const TELNYX_API_KEY  = process.env.TELNYX_API_KEY;
const TELNYX_API_BASE = 'https://api.telnyx.com/v2';

const REGISTRY_SHEET_ID   = process.env.REGISTRY_SHEET_ID   || '1AdXq1EagVhPsX-UT4HENfuQ1mxUN39kWtECiY6he8bg';
const REGISTRY_SHEET_NAME = process.env.REGISTRY_SHEET_NAME || 'Sheet1';
const REGISTRY_CACHE_TTL  = 5 * 60 * 1000;

if (!TELNYX_API_KEY) {
  console.warn('⚠️  TELNYX_API_KEY non configurata. Call Control non funzionerà.');
}

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 2: STATO IN MEMORIA
// ═══════════════════════════════════════════════════════════════════════════════

// Mappa: callControlId → { from, to, restaurantConfig, initiatedAt }
const callInfoByCallControlId = new Map();
const CALL_INFO_TTL_MS = 30 * 60 * 1000;

// Cache Registry
const STATE = {
  registryCache:     null,
  registryCacheTime: 0,
};

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 3: REGISTRY MULTI-TENANT
// ═══════════════════════════════════════════════════════════════════════════════
// Lookup del ristorante dal Registry Sheet pubblico via endpoint gviz/tq
// (senza autenticazione — il Sheet deve essere condiviso in lettura pubblica).
//
// Colonne attese: twilio_number, restaurant_id, restaurant_name, plan,
// sheet_id, calendar_id, apps_script_url, owner_email, active,
// closed_days, lunch_start, lunch_end, dinner_start, dinner_end,
// large_group_threshold, event_threshold, receptionist_name,
// lunch_closed_days, dinner_closed_days
// ═══════════════════════════════════════════════════════════════════════════════

const Registry = {
  async fetch() {
    const now = Date.now();
    if (STATE.registryCache && (now - STATE.registryCacheTime) < REGISTRY_CACHE_TTL) {
      return STATE.registryCache;
    }

    try {
      const url = `https://docs.google.com/spreadsheets/d/${REGISTRY_SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(REGISTRY_SHEET_NAME)}`;
      console.log(`🌐 Registry: fetch ${REGISTRY_SHEET_NAME}...`);

      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
      const text = await response.text();

      // La risposta è avvolta in: google.visualization.Query.setResponse({...});
      const jsonMatch = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);?$/);
      if (!jsonMatch) {
        console.error('❌ Registry: formato risposta non valido');
        return STATE.registryCache || [];
      }

      const data = JSON.parse(jsonMatch[1]);
      const rows = data.table.rows || [];
      const cols = data.table.cols || [];

      // Headers: prova dai label delle colonne, altrimenti dalla prima riga
      let headers = cols.map(c => c.label || '');
      if (headers.every(h => h === '')) {
        if (rows.length > 0 && rows[0].c) {
          headers = rows[0].c.map(cell => cell ? (cell.v !== null ? String(cell.v) : '') : '');
          rows.shift();
        }
      }

      const registry = rows.map(row => {
        const obj = {};
        row.c.forEach((cell, idx) => {
          const key = headers[idx];
          if (key) obj[key] = cell ? (cell.v !== null ? cell.v : '') : '';
        });
        return obj;
      });

      console.log(`✅ Registry: ${registry.length} ristoranti caricati`);
      STATE.registryCache = registry;
      STATE.registryCacheTime = now;
      return registry;
    } catch (err) {
      console.error(`❌ Registry error: ${err.message}`);
      return STATE.registryCache || [];
    }
  },

  // Normalizza numero di telefono (rimuove +, spazi, trattini)
  _normalizeNumber(n) {
    return String(n || '').replace(/[\s\+\-\(\)]/g, '').trim();
  },

  // Parse "1,4,5" → [1,4,5]
  _parseDaysList(str) {
    if (!str && str !== 0) return [];
    const s = String(str).replace(/\s/g, '');
    if (!s) return [];
    return s.split(',')
      .map(d => parseInt(d, 10))
      .filter(d => !isNaN(d));
  },

  async getConfigForNumber(twilioNumber) {
    if (!twilioNumber) return null;

    try {
      const registry = await this.fetch();
      const normalized = this._normalizeNumber(twilioNumber);

      const match = registry.find(r => {
        const rowNum = this._normalizeNumber(r.twilio_number);
        return rowNum === normalized;
      });

      if (!match) {
        console.log(`⚠️  Registry: nessun match per ${twilioNumber} (normalizzato: ${normalized})`);
        return null;
      }

      // Enrichment: parse dei campi CSV in array
      const enriched = {
        ...match,
        closedDays:          this._parseDaysList(match.closed_days),
        lunchClosedDays:     this._parseDaysList(match.lunch_closed_days),
        dinnerClosedDays:    this._parseDaysList(match.dinner_closed_days),
        largeGroupThreshold: Number(match.large_group_threshold) || 10,
        eventThreshold:      Number(match.event_threshold)      || 45,
        receptionistName:    match.receptionist_name || 'Giulia',
        restaurantName:      match.restaurant_name   || 'il ristorante',
        appsScriptUrl:       (match.apps_script_url || '').trim(),
        lunchStart:  match.lunch_start  || '12:00',
        lunchEnd:    match.lunch_end    || '15:00',
        dinnerStart: match.dinner_start || '19:00',
        dinnerEnd:   match.dinner_end   || '22:30',
        active:      match.active === true || String(match.active).toUpperCase() === 'TRUE',
      };

      console.log(`✅ Registry match: "${enriched.restaurantName}" (${enriched.receptionistName}) per ${twilioNumber}`);
      console.log(`    Apps Script: ${enriched.appsScriptUrl ? '✓' : '✗ MANCANTE'}`);
      console.log(`    Chiusure: closed=[${enriched.closedDays}] lunch=[${enriched.lunchClosedDays}] dinner=[${enriched.dinnerClosedDays}]`);
      console.log(`    Orari: pranzo ${enriched.lunchStart}-${enriched.lunchEnd}, cena ${enriched.dinnerStart}-${enriched.dinnerEnd}`);
      console.log(`    Attivo: ${enriched.active}`);

      return enriched;
    } catch (err) {
      console.error(`❌ Registry.getConfigForNumber error: ${err.message}`);
      return null;
    }
  },

  invalidateCache() {
    STATE.registryCache = null;
    STATE.registryCacheTime = 0;
    console.log('🔄 Registry cache invalidata');
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 4: HELPER — CLEANUP MAP callInfo
// ═══════════════════════════════════════════════════════════════════════════════

function pruneOldCallInfo() {
  const now = Date.now();
  for (const [id, info] of callInfoByCallControlId.entries()) {
    if (now - info.initiatedAt > CALL_INFO_TTL_MS) {
      callInfoByCallControlId.delete(id);
    }
  }
}
setInterval(pruneOldCallInfo, 5 * 60 * 1000).unref();

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 5: TELNYX API HELPER
// ═══════════════════════════════════════════════════════════════════════════════

async function telnyxApiCall(path, payload = {}) {
  try {
    const response = await fetch(`${TELNYX_API_BASE}${path}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TELNYX_API_KEY}`,
        'Content-Type': 'application/json',
        'Accept':       'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const errText = await response.text();
      console.error(`❌ Telnyx API ${path} failed: ${response.status} ${errText}`);
      return null;
    }
    return await response.json();
  } catch (e) {
    console.error(`❌ Telnyx API ${path} exception: ${e.message}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 6: ENDPOINT DIAGNOSTICI
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/', (req, res) => res.send(
  '✅ Prenow Realtime Gateway — GIULIA v1 MULTI-TENANT. GET /captures per lista, GET /captures/{id}.wav per scaricare.'
));

app.get('/captures', (req, res) => {
  try {
    const files = readdirSync(CAPTURE_DIR)
      .filter(f => f.endsWith('.wav'))
      .map(f => {
        const stats = statSync(`${CAPTURE_DIR}/${f}`);
        return { name: f, size: stats.size, mtime: stats.mtime };
      })
      .sort((a, b) => b.mtime - a.mtime);
    res.json(files);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/captures/:name', (req, res) => {
  try {
    const filePath = `${CAPTURE_DIR}/${req.params.name}`;
    const buf = readFileSync(filePath);
    res.type('audio/wav').send(buf);
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

// Refresh manuale della cache Registry (utile quando aggiungi un ristorante)
app.post('/admin/registry/refresh', (req, res) => {
  Registry.invalidateCache();
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 7: WEBHOOK TELNYX (Call Control)
// ═══════════════════════════════════════════════════════════════════════════════

app.post('/webhooks/telnyx', async (req, res) => {
  res.status(200).send('ok');

  const data          = req.body?.data       || {};
  const eventType     = data.event_type      || 'unknown';
  const payload       = data.payload         || {};
  const callControlId = payload.call_control_id;
  const from          = payload.from;
  const to            = payload.to;
  const direction     = payload.direction;

  console.log(`📩 Webhook: ${eventType} | CallControlId: ${callControlId} | From: ${from} | To: ${to} | Direction: ${direction}`);

  if (direction && direction !== 'incoming') return;

  switch (eventType) {
    case 'call.initiated': {
      console.log(`📞 [${callControlId}] Chiamata in arrivo`);

      // Registry lookup: risolve `to` → config completa del ristorante
      const restaurantConfig = await Registry.getConfigForNumber(to);
      if (!restaurantConfig) {
        console.warn(`⚠️  [${callControlId}] Nessuna config nel Registry per ${to} — Giulia risponderà con messaggio di fallback`);
      } else if (!restaurantConfig.active) {
        console.warn(`⚠️  [${callControlId}] Ristorante "${restaurantConfig.restaurantName}" trovato ma NON attivo`);
      }

      if (callControlId) {
        callInfoByCallControlId.set(callControlId, {
          from: from || '',
          to:   to   || '',
          restaurantConfig,
          initiatedAt: Date.now(),
        });
      }

      await telnyxApiCall(`/calls/${callControlId}/actions/answer`, {});
      break;
    }

    case 'call.answered': {
      console.log(`✅ [${callControlId}] Chiamata risposta → invio STREAMING_START`);
      const wsUrl = `${BASE_URL.replace(/^http/, 'ws')}/media-stream?callControlId=${encodeURIComponent(callControlId)}`;
      await telnyxApiCall(`/calls/${callControlId}/actions/streaming_start`, {
        stream_url:                        wsUrl,
        stream_track:                      'inbound_track',
        stream_codec:                      'PCMA',
        stream_bidirectional_mode:         'rtp',
        stream_bidirectional_codec:        'PCMA',
        stream_bidirectional_sampling_rate: 8000,
        send_silence_when_idle:            false,
      });
      break;
    }

    case 'streaming.started':
      console.log(`🎧 [${callControlId}] Streaming attivo`);
      break;

    case 'streaming.stopped':
      console.log(`🔇 [${callControlId}] Streaming fermato`);
      break;

    case 'streaming.failed':
      console.error(`❌ [${callControlId}] Streaming failed:`, payload);
      break;

    case 'call.hangup':
      console.log(`☎️  [${callControlId}] Chiamata terminata (${payload.hangup_cause})`);
      if (callControlId) callInfoByCallControlId.delete(callControlId);
      break;

    default:
      break;
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 8: ENDPOINT LEGACY TeXML (mantenuto per rollback)
// ═══════════════════════════════════════════════════════════════════════════════

app.post('/twiml-stream', (req, res) => {
  const callSid = req.body?.CallSid || `unknown-${Date.now()}`;
  const from    = req.body?.From    || '';
  const to      = req.body?.To      || '';
  console.log(`📞 [LEGACY TeXML] CallSid: ${callSid} | From: ${from} | To: ${to}`);

  const wsUrl = `${BASE_URL.replace(/^http/, 'ws')}/media-stream`;
  const texml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Start>
    <Stream url="${wsUrl}" track="inbound_track" bidirectionalMode="rtp" bidirectionalCodec="PCMA" />
  </Start>
  <Pause length="60"/>
  <Pause length="60"/>
  <Pause length="60"/>
  <Pause length="60"/>
  <Pause length="60"/>
</Response>`;
  res.type('text/xml').send(texml);
});

// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 9: SERVER STARTUP
// ═══════════════════════════════════════════════════════════════════════════════

const server = createServer(app);
server.keepAliveTimeout = 120000;
server.headersTimeout   = 120000;

setupMediaStreamHandler(server, callInfoByCallControlId);

// Diagnostica memoria periodica
setInterval(() => {
  const mem = process.memoryUsage();
  const rss = Math.round(mem.rss / 1024 / 1024);
  const heap = Math.round(mem.heapUsed / 1024 / 1024);
  console.log(`💾 mem: rss=${rss}MB heapUsed=${heap}MB | callInfo entries: ${callInfoByCallControlId.size}`);
}, 30000).unref();

server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║  🚀 PRENOW REALTIME — GIULIA v1 MULTI-TENANT                  ║
║  📍 Port: ${String(PORT).padEnd(50)}║
║  🎤 OpenAI: gpt-realtime-mini + function calling              ║
║  🍽️  Backend: Apps Script per-ristorante (via Registry)        ║
║  📞 Webhook: POST /webhooks/telnyx                            ║
║  🔑 TELNYX_API_KEY: ${(TELNYX_API_KEY ? '✅' : '❌ MISSING').padEnd(42)}║
╚═══════════════════════════════════════════════════════════════╝
  `);
});
