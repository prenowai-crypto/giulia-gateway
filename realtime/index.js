// ═══════════════════════════════════════════════════════════════════════════════
// PRENOW REALTIME GATEWAY v3.0
// ═══════════════════════════════════════════════════════════════════════════════
//
// 🆕 vC9 (2026-05-29): TeXML aggiornato per chiedere a Telnyx audio L16 a 16kHz
// invece di PCMU a 8kHz. L16 è PCM lineare 16-bit non compresso, qualità
// superiore. Il gateway converte poi 16kHz→24kHz e LE/BE per OpenAI Realtime.
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

app.get('/', (req, res) => res.send('✅ Prenow Realtime Gateway v3.0 (vC9-L16-24k)'));

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

  // 🆕 vC9: chiediamo a Telnyx L16 a 16kHz in entrambe le direzioni.
  //   - codec="L16": l'audio dal cliente arriva a noi come PCM16 lineare
  //   - bidirectionalCodec="L16": l'audio che mandiamo al cliente è PCM16 lineare
  //   - bidirectionalSamplingRate="16000": entrambe le direzioni a 16kHz
  // Prima usavamo PCMU 8kHz (G.711 µ-law compresso). L16 è non compresso,
  // più alta qualità, meglio digerito dall'encoder OpenAI. Il gateway converte
  // poi 16kHz↔24kHz per OpenAI Realtime API (che vuole audio/pcm a 24kHz).
  const texml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Start>
    <Stream url="${wsUrl}" track="inbound_track" codec="L16" bidirectionalMode="rtp" bidirectionalCodec="L16" bidirectionalSamplingRate="16000" />
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
║  🚀 PRENOW REALTIME GATEWAY v3.0 — vC9-L16-24k                ║
║  📍 Porta: ${String(PORT).padEnd(49)}║
║  🎤 OpenAI Model: gpt-realtime-mini                           ║
║  📞 TeXML: POST /twiml-stream (Telnyx, L16 16kHz)             ║
║  🔌 WebSocket: /media-stream                                  ║
╚═══════════════════════════════════════════════════════════════╝
  `);
});
