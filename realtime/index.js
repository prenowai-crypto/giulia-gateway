// ═══════════════════════════════════════════════════════════════════════════════
// PRENOW REALTIME GATEWAY v3.0
// ═══════════════════════════════════════════════════════════════════════════════

import express from 'express';
import { createServer } from 'http';
import { setupMediaStreamHandler } from './media-stream.js';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT    = process.env.PORT    || 10000;
const BASE_URL = process.env.BASE_URL || 'https://prenow-realtime.onrender.com';

// ─── CALL DATA (shared between webhook and WS handler) ───────────────────────

const callDataMap = new Map();

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────

app.get('/', (req, res) => res.send('✅ Prenow Realtime Gateway v3.0'));

// ─── TELNYX WEBHOOK → TeXML ──────────────────────────────────────────────────

app.post('/twiml-stream', (req, res) => {
  const body = req.body || {};
  const callSid = body.CallSid || body.call_sid || `unknown-${Date.now()}`;
  const from    = body.From    || body.from    || '';
  const to      = body.To      || body.to      || '';

  console.log(`📞 Chiamata in arrivo - CallSid: ${callSid}`);
  console.log(`   From: ${from}, To: ${to}`);

  // Salva dati chiamata per il WS handler
  callDataMap.set(callSid, { from, to, callSid });
  console.log(`💾 Salvato call data per CallSid: ${callSid}`);

  const wsUrl = `${BASE_URL.replace(/^http/, 'ws')}/media-stream`;
  console.log(`🔌 WebSocket URL: ${wsUrl}`);

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

  console.log(`📤 TeXML response: ${texml}`);
  res.type('text/xml').send(texml);
});

// ─── START SERVER ─────────────────────────────────────────────────────────────

const server = createServer(app);

setupMediaStreamHandler(server, callDataMap);

server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║  🚀 PRENOW REALTIME GATEWAY v3.0                              ║
║  📍 Porta: ${String(PORT).padEnd(49)}║
║  🎤 OpenAI Model: gpt-4o-mini-realtime-preview                ║
║  📞 TeXML: POST /twiml-stream (Telnyx compatible)             ║
║  🔌 WebSocket: /media-stream                                  ║
╚═══════════════════════════════════════════════════════════════╝
  `);
});
