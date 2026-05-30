// ═══════════════════════════════════════════════════════════════════════════════
// PRENOW REALTIME GATEWAY — RESTORE vC6 (2026-05-30)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Questo è il ripristino esatto del setup vC6-S2S-GA-2026-05-27 che aveva
// fatto la chiamata "Giovanni sabato 30 maggio alle 21" perfetta. Lo
// deployamo per avere una baseline funzionante certificata da cui ripartire.
//
// TeXML: <Start> + 5 Pause come nell'originale (NON <Connect>).
// ═══════════════════════════════════════════════════════════════════════════════

import express from 'express';
import { createServer } from 'http';
import { setupMediaStreamHandler } from './media-stream.js';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT    = process.env.PORT    || 10000;
const BASE_URL = process.env.BASE_URL || 'https://prenow-realtime.onrender.com';

const callDataMap = new Map();

app.get('/', (req, res) => res.send('✅ Prenow Realtime Gateway (restore vC6)'));

app.post('/twiml-stream', (req, res) => {
  const body = req.body || {};
  const callSid = body.CallSid || body.call_sid || `unknown-${Date.now()}`;
  const from    = body.From    || body.from    || '';
  const to      = body.To      || body.to      || '';

  console.log(`📞 Chiamata in arrivo - CallSid: ${callSid}`);
  console.log(`   From: ${from}, To: ${to}`);

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

const server = createServer(app);
setupMediaStreamHandler(server, callDataMap);

server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║  🚀 PRENOW REALTIME GATEWAY — RESTORE vC6                     ║
║  📍 Porta: ${String(PORT).padEnd(49)}║
║  🎤 OpenAI Model: gpt-realtime-mini                           ║
║  📞 TeXML: POST /twiml-stream  <Start>+Pauses PCMU            ║
║  🔌 WebSocket: /media-stream                                  ║
╚═══════════════════════════════════════════════════════════════╝
  `);
});
