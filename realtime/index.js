// ═══════════════════════════════════════════════════════════════════════════════
// PRENOW - REALTIME GATEWAY v2.2.0
// FIX CRITICO: Echo cancellation basata sul CONTENUTO
// ═══════════════════════════════════════════════════════════════════════════════

import express from 'express';
import { createServer } from 'http';
import { setupMediaStreamHandler } from './media-stream.js';
import { realtimeTools } from './tool-functions.js';

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURAZIONE
// ═══════════════════════════════════════════════════════════════════════════════

const CONFIG = {
  PORT: process.env.PORT || 10000,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_MODEL: 'gpt-4o-mini-realtime-preview',
  
  // Registry per multi-tenant
  REGISTRY_SHEET_ID: '1AdXq1EagVhPsX-UT4HENfuQ1mxUN39kWtECiY6he8bg',
  
  // Cache config ristoranti
  registryCache: null,
  registryCacheTime: 0,
  CACHE_TTL: 5 * 60 * 1000, // 5 minuti
};

// ═══════════════════════════════════════════════════════════════════════════════
// REGISTRY - CARICA CONFIG RISTORANTI
// ═══════════════════════════════════════════════════════════════════════════════

async function loadRegistry() {
  if (CONFIG.registryCache && (Date.now() - CONFIG.registryCacheTime < CONFIG.CACHE_TTL)) {
    return CONFIG.registryCache;
  }
  
  try {
    const url = `https://docs.google.com/spreadsheets/d/${CONFIG.REGISTRY_SHEET_ID}/gviz/tq?tqx=out:json&sheet=Registry`;
    const response = await fetch(url);
    const text = await response.text();
    
    const jsonMatch = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);?$/);
    if (!jsonMatch) throw new Error('Invalid response format');
    
    const data = JSON.parse(jsonMatch[1]);
    const rows = data.table.rows;
    const cols = data.table.cols.map(c => c.label?.toLowerCase().replace(/\s+/g, '_') || '');
    
    const registry = rows.map(row => {
      const obj = {};
      row.c.forEach((cell, i) => {
        if (cols[i]) {
          obj[cols[i]] = cell?.v ?? '';
        }
      });
      return obj;
    }).filter(r => r.active === true || r.active === 'TRUE');
    
    CONFIG.registryCache = registry;
    CONFIG.registryCacheTime = Date.now();
    
    console.log(`📋 Registry caricato: ${registry.length} ristoranti attivi`);
    return registry;
    
  } catch (error) {
    console.error('❌ Errore caricamento registry:', error);
    return CONFIG.registryCache || [];
  }
}

async function getRestaurantConfig(phoneNumber) {
  const registry = await loadRegistry();
  
  // Normalizza numero (rimuovi spazi, +, etc.)
  const normalized = phoneNumber.replace(/[\s\+\-\(\)]/g, '');
  
  console.log(`🔍 Cercando ristorante per numero: ${phoneNumber} (normalizzato: ${normalized})`);
  
  // Cerca match
  const config = registry.find(r => {
    const regNum = String(r.twilio_number || r.phone_number || '').replace(/[\s\+\-\(\)]/g, '');
    const match = regNum.includes(normalized) || normalized.includes(regNum);
    if (match) {
      console.log(`✅ Match trovato: ${regNum}`);
    }
    return match;
  });
  
  if (!config) {
    console.warn(`⚠️ Nessun ristorante per numero: ${phoneNumber}`);
    console.log(`📋 Numeri in registry:`, registry.map(r => r.twilio_number || r.phone_number));
    return null;
  }
  
  return {
    restaurant_id: config.restaurant_id || config.id,
    restaurant_name: config.restaurant_name || config.name || 'Ristorante',
    receptionist_name: config.receptionist_name || 'Giulia',
    owner_email: config.owner_email,
    language: config.language || 'it-IT',
    
    lunch_start: config.lunch_start || '12:00',
    lunch_end: config.lunch_end || '14:30',
    dinner_start: config.dinner_start || '19:00',
    dinner_end: config.dinner_end || '22:30',
    
    weekly_closing_days: parseIntArray(config.weekly_closing_days) || [1],
    lunch_closed_days: parseIntArray(config.lunch_closed_days) || [],
    dinner_closed_days: parseIntArray(config.dinner_closed_days) || [],
    
    slot_capacity: parseInt(config.slot_capacity) || 30,
    
    apps_script_url: config.apps_script_url || process.env.APPS_SCRIPT_URL,
    calendar_id: config.calendar_id,
  };
}

function parseIntArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(v => parseInt(v));
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(v => parseInt(v)) : [];
  } catch {
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPRESS SERVER
// ═══════════════════════════════════════════════════════════════════════════════

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/', (req, res) => {
  res.json({
    service: 'PRENOW Realtime Gateway',
    version: '2.2.0',
    status: 'ok',
    provider: 'Telnyx TeXML',
    endpoints: {
      twiml: '/twiml-stream',
      websocket: '/media-stream'
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// STORE per salvare From/To (CallSid -> {from, to})
// ═══════════════════════════════════════════════════════════════════════════════
const callDataStore = new Map();

// Pulisci dati vecchi ogni 5 minuti
setInterval(() => {
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
  for (const [callSid, data] of callDataStore.entries()) {
    if (data.timestamp < fiveMinutesAgo) {
      callDataStore.delete(callSid);
    }
  }
}, 60 * 1000);

// Export per uso in media-stream (passato tramite config)

// ═══════════════════════════════════════════════════════════════════════════════
// TWIML ENDPOINT - Telnyx/Twilio chiama questo per iniziare lo stream
// ═══════════════════════════════════════════════════════════════════════════════

app.post('/twiml-stream', (req, res) => {
  // Telnyx TeXML usa stesso formato di Twilio per i parametri
  const { From, To, CallSid } = req.body;
  
  console.log(`📞 Chiamata in arrivo - CallSid: ${CallSid}`);
  console.log(`   From: ${From}, To: ${To}`);
  console.log(`   Body completo:`, JSON.stringify(req.body, null, 2));
  
  // Salva From/To in memoria per recuperarli quando il WebSocket si connette
  if (CallSid) {
    callDataStore.set(CallSid, {
      from: From || 'unknown',
      to: To || 'unknown',
      timestamp: Date.now()
    });
    console.log(`💾 Salvato call data per CallSid: ${CallSid}`);
  }
  
  // URL WebSocket SENZA query params (più compatibile)
  const wsUrl = `wss://${req.get('host')}/media-stream`;
  
  console.log(`🔌 WebSocket URL: ${wsUrl}`);
  
  // TeXML: inbound_track = solo audio utente (NO echo!) + bidirectional per output AI
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Start>
    <Stream url="${wsUrl}" track="inbound_track" bidirectionalMode="rtp" bidirectionalCodec="PCMU" />
  </Start>
  <Pause length="60"/>
</Response>`;
  
  console.log(`📤 TeXML response:`, twiml);
  
  res.type('text/xml').send(twiml);
});

// GET per test
app.get('/twiml-stream', (req, res) => {
  const wsUrl = `wss://${req.get('host')}/media-stream`;
  
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Start>
    <Stream url="${wsUrl}" track="inbound_track" bidirectionalMode="rtp" bidirectionalCodec="PCMU" />
  </Start>
  <Pause length="60"/>
</Response>`;
  
  res.type('text/xml').send(twiml);
});

// ═══════════════════════════════════════════════════════════════════════════════
// AVVIO SERVER
// ═══════════════════════════════════════════════════════════════════════════════

const server = createServer(app);

// Setup WebSocket per Media Streams
setupMediaStreamHandler(server, {
  openaiApiKey: CONFIG.OPENAI_API_KEY,
  model: CONFIG.OPENAI_MODEL,
  tools: realtimeTools,
  getRestaurantConfig: getRestaurantConfig,
  callDataStore: callDataStore  // Passa il store
});

server.listen(CONFIG.PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║  🚀 PRENOW REALTIME GATEWAY v2.2.0                            ║
║  📍 Porta: ${CONFIG.PORT}                                            ║
║  🎤 OpenAI Model: ${CONFIG.OPENAI_MODEL}            ║
║  📞 TeXML: POST /twiml-stream (Telnyx compatible)             ║
║  🔌 WebSocket: /media-stream                                  ║
╚═══════════════════════════════════════════════════════════════╝
  `);
  
  if (!CONFIG.OPENAI_API_KEY) {
    console.warn('⚠️  ATTENZIONE: OPENAI_API_KEY non configurata!');
  }
});

export default app;
