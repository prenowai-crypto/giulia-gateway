// ═══════════════════════════════════════════════════════════════════════════════
// PRENOW REALTIME GATEWAY — CALL CONTROL + send_silence_when_idle (2026-05-31)
// ═══════════════════════════════════════════════════════════════════════════════
//
// MIGRAZIONE: da TeXML a Call Control API per supportare send_silence_when_idle.
//
// Differenza chiave dal sistema precedente (TeXML):
//   - send_silence_when_idle:true → Telnyx genera pacchetti RTP di silenzio
//     comfort noise quando l'app non sta mandando audio, mantenendo il flusso
//     costante a 50pps. Evita frammentazione VAD su OpenAI Realtime.
//
// Flow Call Control:
//   1. Chiamata arriva al numero → webhook POST /webhooks/telnyx con event_type=call.initiated
//   2. Risposta 200 OK + API call POST /v2/calls/{id}/actions/answer
//   3. Webhook event_type=call.answered
//   4. API call POST /v2/calls/{id}/actions/streaming_start (con send_silence_when_idle:true)
//   5. Telnyx apre WebSocket → handler esistente in media-stream.js gestisce audio
//
// L'endpoint legacy /twiml-stream è mantenuto per rollback rapido se serve.
// ═══════════════════════════════════════════════════════════════════════════════

import express from 'express';
import { createServer } from 'http';
import { readdirSync, readFileSync, statSync } from 'fs';
import { setupMediaStreamHandler, buildWavFromMulawRaw, CAPTURE_DIR } from './media-stream.js';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT            = process.env.PORT            || 10000;
const BASE_URL        = process.env.BASE_URL        || 'https://prenow-realtime.onrender.com';
const TELNYX_API_KEY  = process.env.TELNYX_API_KEY;
const TELNYX_API_BASE = 'https://api.telnyx.com/v2';

if (!TELNYX_API_KEY) {
  console.warn('⚠️  TELNYX_API_KEY non configurata. Call Control non funzionerà.');
}

// ─── Helper per chiamate API a Telnyx ───────────────────────────────────────
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

// ─── Endpoint diagnostici (immutati) ────────────────────────────────────────
app.get('/', (req, res) => res.send('✅ Call Control + DIAG. GET /captures per lista, GET /captures/{id}.wav per scaricare.'));

app.get('/captures', (req, res) => {
  try {
    const files = readdirSync(CAPTURE_DIR).filter(f => f.endsWith('.raw'));
    const list = files.map(f => {
      const s = statSync(`${CAPTURE_DIR}/${f}`);
      const id = f.replace('capture-', '').replace('.raw', '');
      return {
        id,
        bytes: s.size,
        seconds: Math.round(s.size / 8000),
        wav_url: `${BASE_URL}/captures/${id}.wav`,
        modified: s.mtime,
      };
    }).sort((a, b) => new Date(b.modified) - new Date(a.modified));
    res.json({ count: list.length, captures: list });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/captures/:id.wav', (req, res) => {
  try {
    const id = req.params.id;
    const rawPath = `${CAPTURE_DIR}/capture-${id}.raw`;
    const raw = readFileSync(rawPath);
    const wav = buildWavFromMulawRaw(raw);
    res.type('audio/wav');
    res.setHeader('Content-Disposition', `attachment; filename="capture-${id}.wav"`);
    res.send(wav);
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

// ─── ENDPOINT CALL CONTROL: webhook eventi Telnyx ──────────────────────────
app.post('/webhooks/telnyx', async (req, res) => {
  // Rispondi SUBITO a Telnyx (timeout 25s, dobbiamo essere veloci)
  res.status(200).json({ received: true });

  const event = req.body?.data;
  if (!event) return;

  const eventType     = event.event_type;
  const payload       = event.payload || {};
  const callControlId = payload.call_control_id;
  const from          = payload.from;
  const to            = payload.to;
  const direction     = payload.direction;

  console.log(`📩 Webhook: ${eventType} | CallControlId: ${callControlId} | From: ${from} | To: ${to} | Direction: ${direction}`);

  // Solo chiamate IN ENTRATA (incoming)
  if (direction && direction !== 'incoming') return;

  switch (eventType) {
    case 'call.initiated':
      console.log(`📞 [${callControlId}] Chiamata in arrivo → invio ANSWER`);
      // API call per rispondere alla chiamata
      await telnyxApiCall(`/calls/${callControlId}/actions/answer`, {});
      break;

    case 'call.answered':
      console.log(`✅ [${callControlId}] Chiamata risposta → invio STREAMING_START con send_silence_when_idle=true`);

      const wsUrl = `${BASE_URL.replace(/^http/, 'ws')}/media-stream`;

      // ⚡ QUESTA È LA CHIAMATA CRITICA: send_silence_when_idle:true
      await telnyxApiCall(`/calls/${callControlId}/actions/streaming_start`, {
        stream_url:                        wsUrl,
        stream_track:                      'inbound_track',
        stream_codec:                      'PCMA',
        stream_bidirectional_mode:         'rtp',
        stream_bidirectional_codec:        'PCMA',
        stream_bidirectional_sampling_rate: 8000,
        send_silence_when_idle:            true,   // ⚡ FIX PRINCIPALE
      });
      break;

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
      break;

    default:
      // Eventi non gestiti vengono solo loggati
      break;
  }
});

// ─── ENDPOINT LEGACY TeXML (mantenuto per rollback) ────────────────────────
app.post('/twiml-stream', (req, res) => {
  const callSid = req.body?.CallSid || `unknown-${Date.now()}`;
  const from    = req.body?.From    || '';
  const to      = req.body?.To      || '';
  console.log(`📞 [LEGACY TeXML] Chiamata - CallSid: ${callSid} | From: ${from} | To: ${to}`);

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

const server = createServer(app);

// Fix keepAliveTimeout per Render (raccomandato dalla docs)
server.keepAliveTimeout = 120000;
server.headersTimeout   = 120000;

setupMediaStreamHandler(server);

server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║  🧪 CALL CONTROL + send_silence_when_idle                     ║
║  📍 Port: ${String(PORT).padEnd(50)}║
║  🎤 OpenAI: gpt-realtime-mini                                 ║
║  📞 Webhook: POST /webhooks/telnyx                            ║
║  📞 Legacy TeXML: POST /twiml-stream                          ║
║  🔑 TELNYX_API_KEY: ${(TELNYX_API_KEY ? '✅ configured' : '❌ MISSING').padEnd(42)}║
╚═══════════════════════════════════════════════════════════════╝
  `);
});
