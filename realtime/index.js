// ═══════════════════════════════════════════════════════════════════════════════
// PRENOW REALTIME GATEWAY — MINIMAL BRIDGE TEST (2026-05-30)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Setup MINIMO per isolare la pipeline audio Telnyx ↔ OpenAI Realtime.
//
// Niente:
//   - Registry / multi-tenant
//   - System prompt complesso
//   - Functions / Apps Script / DateManager
//   - Audio buffer / pacer
//   - Cleanup elaborato
//
// Solo: chiamata arriva → bridge audio bidirezionale → "Ciao sono un test".
//
// Obiettivo diagnostico: se i contatori audio IN sono stabili a 99 chunk
// per tutte le chiamate consecutive, la pipeline base è solida e il problema
// del nostro sistema sta sopra (prompt, functions, Apps Script).
// Se sono ballerini anche qui, il problema è infrastrutturale.
// ═══════════════════════════════════════════════════════════════════════════════

import express from 'express';
import { createServer } from 'http';
import { readdirSync, readFileSync, statSync } from 'fs';
import { setupMediaStreamHandler, buildWavFromMulawRaw, CAPTURE_DIR } from './media-stream.js';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT     = process.env.PORT     || 10000;
const BASE_URL = process.env.BASE_URL || 'https://prenow-realtime.onrender.com';

app.get('/', (req, res) => res.send('✅ Minimal Bridge + DIAG. GET /captures per lista, GET /captures/{id}.wav per scaricare.'));

// ⚡ ENDPOINT DIAG: lista capture disponibili
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

// ⚡ ENDPOINT DIAG: scarica capture come WAV (genera header al volo)
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

app.post('/twiml-stream', (req, res) => {
  const callSid = req.body?.CallSid || `unknown-${Date.now()}`;
  const from    = req.body?.From    || '';
  const to      = req.body?.To      || '';
  console.log(`📞 Chiamata - CallSid: ${callSid} | From: ${from} | To: ${to}`);

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

// ⚡ FIX RACCOMANDATO DALLA DOCS RENDER per WebSocket / connessioni intermittenti.
//
// Default Node.js: keepAliveTimeout=5s, headersTimeout=60s.
// Default Load Balancer Render: tiene connessioni più a lungo.
// Mismatch = connessioni "fantasma" lato LB che accumulano dopo ogni chiamata,
// causando degradazione progressiva sulle successive (esattamente il nostro pattern).
//
// Fonte: https://render.com/docs/troubleshooting-deploys
// "Try increasing the values for server.keepAliveTimeout and server.headersTimeout
//  (such as to 120000 for 120 seconds)"
server.keepAliveTimeout = 120000;  // 120 secondi (era 5s default)
server.headersTimeout   = 120000;  // 120 secondi (era 60s default)

setupMediaStreamHandler(server);

server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║  🧪 MINIMAL BRIDGE TEST                                       ║
║  📍 Port: ${String(PORT).padEnd(50)}║
║  🎤 OpenAI: gpt-realtime-mini                                 ║
║  📞 TeXML: POST /twiml-stream                                 ║
╚═══════════════════════════════════════════════════════════════╝
  `);
});
