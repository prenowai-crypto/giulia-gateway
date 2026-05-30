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
import { setupMediaStreamHandler } from './media-stream.js';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT     = process.env.PORT     || 10000;
const BASE_URL = process.env.BASE_URL || 'https://prenow-realtime.onrender.com';

app.get('/', (req, res) => res.send('✅ Minimal Bridge Test'));

app.post('/twiml-stream', (req, res) => {
  const callSid = req.body?.CallSid || `unknown-${Date.now()}`;
  const from    = req.body?.From    || '';
  const to      = req.body?.To      || '';
  console.log(`📞 Chiamata - CallSid: ${callSid} | From: ${from} | To: ${to}`);

  const wsUrl = `${BASE_URL.replace(/^http/, 'ws')}/media-stream`;
  const texml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Start>
    <Stream url="${wsUrl}" track="inbound_track" bidirectionalMode="rtp" bidirectionalCodec="PCMU" />
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
