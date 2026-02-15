// ═══════════════════════════════════════════════════════════════════════════════
// PRENOW - REALTIME GATEWAY v1.0.0
// Entry point per il nuovo sistema con OpenAI Realtime API
// 
// QUESTO FILE può essere:
// A) Aggiunto all'index.js esistente (integrazione)
// B) Eseguito separatamente per test (standalone)
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

/**
 * Carica il registry da Google Sheets
 */
async function loadRegistry() {
  // Usa cache se valida
  if (CONFIG.registryCache && (Date.now() - CONFIG.registryCacheTime < CONFIG.CACHE_TTL)) {
    return CONFIG.registryCache;
  }
  
  try {
    const url = `https://docs.google.com/spreadsheets/d/${CONFIG.REGISTRY_SHEET_ID}/gviz/tq?tqx=out:json&sheet=Registry`;
    const response = await fetch(url);
    const text = await response.text();
    
    // Parse Google Sheets JSON response
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

/**
 * Trova config ristorante dal numero chiamato
 */
async function getRestaurantConfig(phoneNumber) {
  const registry = await loadRegistry();
  
  // Normalizza numero (rimuovi spazi, +, etc.)
  const normalized = phoneNumber.replace(/[\s\+\-\(\)]/g, '');
  
  // Cerca match
  const config = registry.find(r => {
    const regNum = String(r.twilio_number || r.phone_number || '').replace(/[\s\+\-\(\)]/g, '');
    return regNum.includes(normalized) || normalized.includes(regNum);
  });
  
  if (!config) {
    console.warn(`⚠️ Nessun ristorante per numero: ${phoneNumber}`);
    return null;
  }
  
  // Normalizza config
  return {
    restaurant_id: config.restaurant_id || config.id,
    restaurant_name: config.restaurant_name || config.name || 'Ristorante',
    receptionist_name: config.receptionist_name || 'Giulia',
    owner_email: config.owner_email,
    language: config.language || 'it-IT',
    
    // Orari
    lunch_start: config.lunch_start || '12:00',
    lunch_end: config.lunch_end || '14:30',
    dinner_start: config.dinner_start || '19:00',
    dinner_end: config.dinner_end || '22:30',
    
    // Chiusure (parse JSON array)
    weekly_closing_days: parseIntArray(config.weekly_closing_days) || [1], // Default: lunedì
    lunch_closed_days: parseIntArray(config.lunch_closed_days) || [],
    dinner_closed_days: parseIntArray(config.dinner_closed_days) || [],
    
    // Capacità
    slot_capacity: parseInt(config.slot_capacity) || 30,
    
    // URLs
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
    version: '1.0.0',
    status: 'ok',
    endpoints: {
      twiml: '/twiml-stream',
      websocket: '/media-stream'
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TWIML ENDPOINT - Twilio chiama questo per iniziare lo stream
// ═══════════════════════════════════════════════════════════════════════════════

app.post('/twiml-stream', (req, res) => {
  const { From, To, CallSid } = req.body;
  
  console.log(`📞 Chiamata in arrivo - CallSid: ${CallSid}`);
  console.log(`   From: ${From}, To: ${To}`);
  
  // Costruisci URL WebSocket
  const wsUrl = `wss://${req.get('host')}/media-stream`;
  
  // TwiML che avvia Media Stream
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${wsUrl}">
      <Parameter name="from" value="${From || 'unknown'}"/>
      <Parameter name="to" value="${To || 'unknown'}"/>
    </Stream>
  </Connect>
</Response>`;
  
  res.type('text/xml').send(twiml);
});

// Anche GET per test
app.get('/twiml-stream', (req, res) => {
  const wsUrl = `wss://${req.get('host')}/media-stream`;
  
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${wsUrl}">
      <Parameter name="from" value="test"/>
      <Parameter name="to" value="test"/>
    </Stream>
  </Connect>
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
  getRestaurantConfig: getRestaurantConfig
});

server.listen(CONFIG.PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║  🚀 PRENOW REALTIME GATEWAY v1.0.0                            ║
║  📍 Porta: ${CONFIG.PORT}                                            ║
║  🎤 OpenAI Model: ${CONFIG.OPENAI_MODEL}            ║
║  📞 TwiML: POST /twiml-stream                                 ║
║  🔌 WebSocket: /media-stream                                  ║
╚═══════════════════════════════════════════════════════════════╝
  `);
  
  if (!CONFIG.OPENAI_API_KEY) {
    console.warn('⚠️  ATTENZIONE: OPENAI_API_KEY non configurata!');
  }
});

export default app;
