// ═══════════════════════════════════════════════════════════════════════════════
// MEDIA STREAM HANDLER — MINIMAL BRIDGE TEST
// ═══════════════════════════════════════════════════════════════════════════════
// Bridge nudo: Telnyx ↔ OpenAI Realtime. Niente altro.
// ═══════════════════════════════════════════════════════════════════════════════

import { WebSocketServer } from 'ws';
import { OpenAIRealtimeClient } from './openai-realtime.js';

export function setupMediaStreamHandler(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    if (req.url === '/media-stream') {
      wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
    }
  });

  wss.on('connection', (telnyxWs) => {
    console.log('🔌 Nuova connessione Telnyx');

    let openaiClient = null;
    let streamSid    = null;

    telnyxWs.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      switch (msg.event) {
        case 'connected':
          console.log('✅ Telnyx connected');
          break;

        case 'start':
          streamSid = msg.start?.stream_sid || `stream-${Date.now()}`;
          console.log(`📞 Start - streamSid: ${streamSid}`);

          openaiClient = new OpenAIRealtimeClient({
            apiKey: process.env.OPENAI_API_KEY,
            onAudioDelta: (chunk) => {
              if (telnyxWs.readyState === 1) {
                telnyxWs.send(JSON.stringify({
                  event:      'media',
                  stream_sid: streamSid,
                  media:      { payload: chunk },
                }));
              }
            },
          });

          await openaiClient.connect();
          console.log('✅ Bridge attivo');
          break;

        case 'media':
          if (openaiClient && msg.media?.payload) {
            openaiClient.sendAudio(msg.media.payload);
          }
          break;

        case 'stop':
          console.log('🛑 Stop');
          openaiClient?.close();
          break;
      }
    });

    telnyxWs.on('close', () => {
      console.log('🔌 Telnyx chiuso');
      openaiClient?.close();
    });

    telnyxWs.on('error', (err) => {
      console.error('❌ Telnyx WS error:', err.message);
    });
  });

  console.log('📡 WebSocket handler attivo su /media-stream');

  // Monitor memoria ogni 30s (diagnostico)
  setInterval(() => {
    const m = process.memoryUsage();
    const mb = (n) => Math.round(n / 1024 / 1024);
    console.log(`💾 mem: rss=${mb(m.rss)}MB heapUsed=${mb(m.heapUsed)}MB`);
  }, 30000);
}
