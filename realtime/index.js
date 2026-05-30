// ═══════════════════════════════════════════════════════════════════════════════
// PRENOW REALTIME GATEWAY — vC11 (2026-05-29)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Riscritto da zero seguendo il pattern raccomandato dalla documentazione ufficiale
// Telnyx + tutorial Telnyx OpenAI Realtime (maggio 2026) + sample ufficiale
// Twilio per OpenAI Realtime.
//
// CAMBIO ARCHITETTURALE CHIAVE rispetto al vC10:
//   TeXML <Start><Stream> + 5 Pause   →   TeXML <Connect><Stream>
//
// "<Start>" fa un FORK dell'audio (la chiamata continua in parallelo, l'audio
// è duplicato sullo stream). Usato per recording/monitoring.
// "<Connect>" instrada la chiamata STESSA sullo stream. Usato per voice agent
// bidirezionali. Niente fork, niente flussi paralleli, niente Pause artificiali
// per "tenere la chiamata in vita".
//
// Quote dalla docs Telnyx (developers.telnyx.com/docs/voice/texml/rest-api/streams):
//   "Asynchronous streaming via <Start>: streaming begins in parallel with
//    the ongoing call flow, allowing audio to be streamed without interrupting
//    or blocking other TeXML instructions."
//   "Synchronous streaming via <Connect>: the call flow waits for the streaming
//    operation to stop before proceeding to the next TeXML instruction."
// ═══════════════════════════════════════════════════════════════════════════════

import express from 'express';
import { createServer } from 'http';
import { setupMediaStreamHandler } from './media-stream.js';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT     = process.env.PORT     || 10000;
const BASE_URL = process.env.BASE_URL || 'https://prenow-realtime.onrender.com';

// Stato condiviso tra webhook TeXML e WS handler (per CallSid lookup se serve).
const callDataMap = new Map();

// ─── Health check ────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.send('✅ Prenow Realtime Gateway vC11'));

// ─── Webhook TeXML inbound da Telnyx ─────────────────────────────────────────
// Quando una chiamata arriva al numero Telnyx, Telnyx GET/POST a questo endpoint
// e si aspetta XML che descriva cosa fare. Noi rispondiamo "connetti la chiamata
// alla mia WebSocket", e Telnyx instrada audio bidirezionale lì fino a riaggancio.
app.post('/twiml-stream', (req, res) => {
  const body    = req.body || {};
  const callSid = body.CallSid || body.call_sid || `unknown-${Date.now()}`;
  const from    = body.From    || body.from    || '';
  const to      = body.To      || body.to      || '';

  console.log(`📞 Chiamata in arrivo - CallSid: ${callSid}`);
  console.log(`   From: ${from}, To: ${to}`);

  callDataMap.set(callSid, { from, to, callSid });

  const wsUrl = `${BASE_URL.replace(/^http/, 'ws')}/media-stream`;

  // <Connect><Stream> — pattern Twilio/Telnyx ufficiale per voice agent.
  // L'attributo bidirectionalMode="rtp" + bidirectionalCodec="PCMU" abilita
  // audio in entrambe le direzioni (cliente↔modello) sulla stessa WebSocket.
  // PCMU = G.711 µ-law 8kHz, formato nativo PSTN e accettato direttamente da
  // OpenAI Realtime senza conversioni (audio/pcmu).
  const texml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${wsUrl}" bidirectionalMode="rtp" bidirectionalCodec="PCMU" />
  </Connect>
</Response>`;

  console.log(`📤 TeXML response: ${texml.replace(/\n\s*/g, ' ')}`);
  res.type('text/xml').send(texml);
});

// ─── Avvio server HTTP + WebSocket ───────────────────────────────────────────
const server = createServer(app);
setupMediaStreamHandler(server, callDataMap);

server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║  🚀 PRENOW REALTIME GATEWAY — vC11                            ║
║  📍 Porta: ${String(PORT).padEnd(49)}║
║  🎤 OpenAI Model: gpt-realtime (full)                         ║
║  📞 TeXML: POST /twiml-stream  <Connect><Stream> PCMU         ║
║  🔌 WebSocket: /media-stream                                  ║
╚═══════════════════════════════════════════════════════════════╝
  `);
});
