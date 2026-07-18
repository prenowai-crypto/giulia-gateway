// ═══════════════════════════════════════════════════════════════════════════════
// PRENOW REALTIME GATEWAY — Batch 1 (v7.4.0)
// - Rimossi endpoint /captures e /captures/:name (compliance GDPR)
// - Registry fallback lookup passato al media-stream (fix race deploy)
// ═══════════════════════════════════════════════════════════════════════════════

import express from 'express';
import { createServer } from 'http';
import { setupMediaStreamHandler } from './media-stream.js';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

const callInfoByCallControlId = new Map();
const CALL_INFO_TTL_MS = 30 * 60 * 1000;

const STATE = {
  registryCache:     null,
  registryCacheTime: 0,
};

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
      const jsonMatch = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);?$/);
      if (!jsonMatch) {
        console.error('❌ Registry: formato risposta non valido');
        return STATE.registryCache || [];
      }
      const data = JSON.parse(jsonMatch[1]);
      const rows = data.table.rows || [];
      const cols = data.table.cols || [];
      let headers = cols.map(c => c.label || '');

      // v7.4.7 Fix parsing Registry: se TUTTE le labels sono vuote, usa la prima
      // riga come header. Se ALCUNE sono vuote (es. colonne nuove aggiunte dopo
      // il setup gviz), fill-in dalla prima riga solo per quelle vuote,
      // preservando quelle già valide.
      const allEmpty = headers.every(h => h === '');
      const someEmpty = !allEmpty && headers.some(h => h === '');

      if (allEmpty && rows.length > 0 && rows[0].c) {
        headers = rows[0].c.map(cell => cell ? (cell.v !== null ? String(cell.v) : '') : '');
        rows.shift();
      } else if (someEmpty && rows.length > 0 && rows[0].c) {
        // Alcune labels vuote → prendi il valore dalla prima riga per quelle
        const firstRow = rows[0].c;
        let matches = 0;
        let totalKnown = 0;
        for (let i = 0; i < headers.length; i++) {
          if (headers[i] !== '' && firstRow[i]) {
            totalKnown++;
            if (String(firstRow[i].v || '') === headers[i]) matches++;
          }
        }
        // Se la maggior parte dei valori della prima riga = labels note,
        // allora la prima riga è header row → riempi vuote e shift
        const isFirstRowHeader = totalKnown > 0 && (matches / totalKnown) > 0.6;
        for (let i = 0; i < headers.length; i++) {
          if (headers[i] === '' && firstRow[i]) {
            headers[i] = String(firstRow[i].v || '').trim();
          }
        }
        if (isFirstRowHeader) rows.shift();
      }
      console.log(`📋 Registry headers: [${headers.filter(Boolean).join(', ')}]`);
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

  _normalizeNumber(n) {
    return String(n || '').replace(/[\s\+\-\(\)]/g, '').trim();
  },
  _parseDaysList(str) {
    if (!str && str !== 0) return [];
    const s = String(str).replace(/\s/g, '');
    if (!s) return [];
    return s.split(',').map(d => parseInt(d, 10)).filter(d => !isNaN(d));
  },

  async getConfigForNumber(twilioNumber) {
    if (!twilioNumber) return null;
    try {
      const registry = await this.fetch();
      const normalized = this._normalizeNumber(twilioNumber);
      const match = registry.find(r => this._normalizeNumber(r.twilio_number) === normalized);
      if (!match) {
        console.log(`⚠️  Registry: nessun match per ${twilioNumber} (normalizzato: ${normalized})`);
        return null;
      }
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
        // v7.4.6 Batch 3: numero fisico del ristorante per transfer chiamata
        restaurantPhone: (match.restaurant_phone || '').trim(),
      };
      console.log(`✅ Registry match: "${enriched.restaurantName}" (${enriched.receptionistName}) per ${twilioNumber}`);
      console.log(`    Apps Script: ${enriched.appsScriptUrl ? '✓' : '✗ MANCANTE'}`);
      console.log(`    Restaurant phone: ${enriched.restaurantPhone || '(non configurato)'}`);
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

function pruneOldCallInfo() {
  const now = Date.now();
  for (const [id, info] of callInfoByCallControlId.entries()) {
    if (now - info.initiatedAt > CALL_INFO_TTL_MS) {
      callInfoByCallControlId.delete(id);
    }
  }
}
setInterval(pruneOldCallInfo, 5 * 60 * 1000).unref();

async function telnyxApiCall(path, payload = {}) {
  try {
    const response = await fetch(`${TELNYX_API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${TELNYX_API_KEY}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
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

app.get('/', (req, res) => res.send('✅ Prenow Realtime Gateway — v7.4.0 (Batch 1 GDPR compliance).'));

app.post('/admin/registry/refresh', (req, res) => {
  Registry.invalidateCache();
  res.json({ ok: true });
});

app.post('/webhooks/telnyx', async (req, res) => {
  res.status(200).send('ok');
  const data = req.body?.data || {};
  const eventType = data.event_type || 'unknown';
  const payload = data.payload || {};
  const callControlId = payload.call_control_id;
  const from = payload.from;
  const to = payload.to;
  const direction = payload.direction;

  console.log(`📩 Webhook: ${eventType} | CallControlId: ${callControlId} | From: ${from} | To: ${to} | Direction: ${direction}`);

  if (direction && direction !== 'incoming') return;

  switch (eventType) {
    case 'call.initiated': {
      console.log(`📞 [${callControlId}] Chiamata in arrivo`);
      const restaurantConfig = await Registry.getConfigForNumber(to);
      if (!restaurantConfig) console.warn(`⚠️  [${callControlId}] Nessuna config per ${to}`);
      else if (!restaurantConfig.active) console.warn(`⚠️  [${callControlId}] "${restaurantConfig.restaurantName}" NON attivo`);

      if (callControlId) {
        callInfoByCallControlId.set(callControlId, {
          from: from || '', to: to || '', restaurantConfig, initiatedAt: Date.now(),
        });
      }
      await telnyxApiCall(`/calls/${callControlId}/actions/answer`, {});
      break;
    }
    case 'call.answered': {
      console.log(`✅ [${callControlId}] Chiamata risposta → invio STREAMING_START`);
      const wsUrl = `${BASE_URL.replace(/^http/, 'ws')}/media-stream?callControlId=${encodeURIComponent(callControlId)}`;
      await telnyxApiCall(`/calls/${callControlId}/actions/streaming_start`, {
        stream_url: wsUrl, stream_track: 'inbound_track', stream_codec: 'PCMA',
        stream_bidirectional_mode: 'rtp', stream_bidirectional_codec: 'PCMA',
        stream_bidirectional_sampling_rate: 8000, send_silence_when_idle: false,
      });
      break;
    }
    case 'streaming.started': console.log(`🎧 [${callControlId}] Streaming attivo`); break;
    case 'streaming.stopped': console.log(`🔇 [${callControlId}] Streaming fermato`); break;
    case 'streaming.failed': console.error(`❌ [${callControlId}] Streaming failed:`, payload); break;
    case 'call.hangup':
      console.log(`☎️  [${callControlId}] Chiamata terminata (${payload.hangup_cause})`);
      if (callControlId) callInfoByCallControlId.delete(callControlId);
      break;
  }
});

app.post('/twiml-stream', (req, res) => {
  const callSid = req.body?.CallSid || `unknown-${Date.now()}`;
  const from = req.body?.From || '';
  const to = req.body?.To || '';
  console.log(`📞 [LEGACY TeXML] CallSid: ${callSid} | From: ${from} | To: ${to}`);
  const wsUrl = `${BASE_URL.replace(/^http/, 'ws')}/media-stream`;
  res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Start><Stream url="${wsUrl}" track="inbound_track" bidirectionalMode="rtp" bidirectionalCodec="PCMA" /></Start>
  <Pause length="60"/><Pause length="60"/><Pause length="60"/><Pause length="60"/><Pause length="60"/>
</Response>`);
});

const server = createServer(app);
server.keepAliveTimeout = 120000;
server.headersTimeout = 120000;

setupMediaStreamHandler(
  server,
  callInfoByCallControlId,
  Registry.getConfigForNumber.bind(Registry)
);

setInterval(() => {
  const mem = process.memoryUsage();
  console.log(`💾 mem: rss=${Math.round(mem.rss/1024/1024)}MB heapUsed=${Math.round(mem.heapUsed/1024/1024)}MB | callInfo entries: ${callInfoByCallControlId.size}`);
}, 30000).unref();

server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║  🚀 PRENOW REALTIME — v7.4.0 (Batch 1)                        ║
║  📍 Port: ${String(PORT).padEnd(50)}║
║  🎤 OpenAI: gpt-realtime-mini + function calling              ║
║  🔒 GDPR: no audio capture, no biometric data storage         ║
║  🍽️  Backend: Apps Script per-ristorante (via Registry)        ║
║  📞 Webhook: POST /webhooks/telnyx                            ║
║  🔑 TELNYX_API_KEY: ${(TELNYX_API_KEY ? '✅' : '❌ MISSING').padEnd(42)}║
╚═══════════════════════════════════════════════════════════════╝
  `);
});
