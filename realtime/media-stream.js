// ═══════════════════════════════════════════════════════════════════════════════
// PRENOW - MEDIA STREAM HANDLER v1.0.0
// Riceve audio da Twilio Media Streams e lo passa a OpenAI Realtime
// ═══════════════════════════════════════════════════════════════════════════════

import WebSocket from 'ws';
import { OpenAIRealtimeClient } from './openai-realtime.js';

/**
 * Setup WebSocket server per Twilio Media Streams
 * @param {import('http').Server} server - HTTP server instance
 * @param {object} config - Configurazione (tools, systemPrompt, etc.)
 */
export function setupMediaStreamHandler(server, config) {
  const wss = new WebSocket.Server({ server, path: '/media-stream' });
  
  console.log('📡 Media Stream WebSocket server attivo su /media-stream');
  
  wss.on('connection', (ws, req) => {
    console.log('🔌 Nuova connessione Twilio Media Stream');
    
    // Stato della sessione
    const session = {
      streamSid: null,
      callSid: null,
      from: null,           // Caller ID (numero ristorante con redirect)
      to: null,             // Numero PRENOW chiamato
      openaiClient: null,
      restaurantConfig: null,
    };
    
    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message);
        
        switch (data.event) {
          case 'connected':
            console.log('✅ Twilio connected');
            break;
            
          case 'start':
            // Twilio invia metadata all'inizio dello stream
            session.streamSid = data.start.streamSid;
            session.callSid = data.start.callSid;
            session.from = data.start.customParameters?.from || 'unknown';
            session.to = data.start.customParameters?.to || 'unknown';
            
            console.log(`📞 Stream started - CallSid: ${session.callSid}`);
            console.log(`   From: ${session.from}, To: ${session.to}`);
            
            // Carica config ristorante basato sul numero chiamato
            session.restaurantConfig = await config.getRestaurantConfig(session.to);
            
            if (!session.restaurantConfig) {
              console.error(`❌ Nessun ristorante trovato per numero: ${session.to}`);
              ws.close();
              return;
            }
            
            console.log(`🍽️  Ristorante: ${session.restaurantConfig.restaurant_name}`);
            
            // Inizializza client OpenAI Realtime
            session.openaiClient = new OpenAIRealtimeClient({
              apiKey: config.openaiApiKey,
              model: config.model || 'gpt-4o-mini-realtime-preview',
              systemPrompt: buildSystemPrompt(session.restaurantConfig),
              tools: config.tools,
              callSid: session.callSid,
              restaurantConfig: session.restaurantConfig,
              onAudioDelta: (audioBase64) => {
                // Invia audio a Twilio
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({
                    event: 'media',
                    streamSid: session.streamSid,
                    media: {
                      payload: audioBase64
                    }
                  }));
                }
              },
              onTranscript: (text, role) => {
                console.log(`💬 [${role}]: ${text}`);
              },
              onError: (error) => {
                console.error('❌ OpenAI error:', error);
              }
            });
            
            await session.openaiClient.connect();
            break;
            
          case 'media':
            // Audio in arrivo da Twilio (mulaw 8kHz)
            if (session.openaiClient) {
              session.openaiClient.sendAudio(data.media.payload);
            }
            break;
            
          case 'stop':
            console.log(`🛑 Stream stopped - CallSid: ${session.callSid}`);
            if (session.openaiClient) {
              session.openaiClient.disconnect();
            }
            break;
            
          default:
            console.log(`📨 Evento non gestito: ${data.event}`);
        }
      } catch (error) {
        console.error('❌ Errore parsing messaggio:', error);
      }
    });
    
    ws.on('close', () => {
      console.log(`🔌 Connessione chiusa - CallSid: ${session.callSid}`);
      if (session.openaiClient) {
        session.openaiClient.disconnect();
      }
    });
    
    ws.on('error', (error) => {
      console.error('❌ WebSocket error:', error);
    });
  });
  
  return wss;
}

/**
 * Costruisce il system prompt per OpenAI basato sulla config del ristorante
 */
function buildSystemPrompt(config) {
  const lang = config.language || 'it-IT';
  const isItalian = lang.startsWith('it');
  
  // Formatta giorni chiusura
  const closedDaysText = formatClosedDays(config, isItalian);
  
  if (isItalian) {
    return `Sei ${config.receptionist_name || 'Giulia'}, la receptionist AI del ristorante "${config.restaurant_name}".

REGOLE IMPORTANTI:
- Parla in italiano, in modo naturale e cordiale
- Sei al telefono, quindi sii concisa (max 2 frasi per risposta)
- Non inventare informazioni su accessibilità, parcheggio o altri servizi
- Per domande su servizi specifici, suggerisci di contattare direttamente il ristorante

INFORMAZIONI RISTORANTE:
- Nome: ${config.restaurant_name}
- Chiusure: ${closedDaysText}
- Orari pranzo: ${config.lunch_start || '12:00'} - ${config.lunch_end || '14:30'}
- Orari cena: ${config.dinner_start || '19:00'} - ${config.dinner_end || '22:30'}
- Capienza per slot: ${config.slot_capacity || 30} persone

FLUSSO PRENOTAZIONE:
1. Chiedi per quante persone
2. Chiedi data (giorno)
3. Chiedi orario (pranzo o cena, poi orario specifico)
4. Chiedi nome
5. Chiedi numero di telefono (IMPORTANTE: sempre chiedere per poter ricontattare)
6. Conferma tutti i dettagli

Per gruppi oltre 10 persone: la prenotazione va in attesa di conferma del ristoratore.
Per eventi oltre 45 persone: suggerisci di inviare email a ${config.owner_email || 'il ristorante'}.

IMPORTANTE: Chiedi SEMPRE il numero di telefono del cliente, anche se vedi un caller ID.`;
  }
  
  // English version
  return `You are ${config.receptionist_name || 'Giulia'}, the AI receptionist for "${config.restaurant_name}".

IMPORTANT RULES:
- Speak naturally and friendly
- You're on the phone, so be concise (max 2 sentences per response)
- Don't make up information about accessibility, parking, or other services
- For specific service questions, suggest contacting the restaurant directly

RESTAURANT INFO:
- Name: ${config.restaurant_name}
- Closed: ${closedDaysText}
- Lunch: ${config.lunch_start || '12:00'} - ${config.lunch_end || '14:30'}
- Dinner: ${config.dinner_start || '19:00'} - ${config.dinner_end || '22:30'}
- Capacity per slot: ${config.slot_capacity || 30} people

RESERVATION FLOW:
1. Ask for number of people
2. Ask for date
3. Ask for time (lunch or dinner, then specific time)
4. Ask for name
5. Ask for phone number (IMPORTANT: always ask to be able to call back)
6. Confirm all details

For groups over 10: reservation needs owner confirmation.
For events over 45: suggest emailing ${config.owner_email || 'the restaurant'}.

IMPORTANT: ALWAYS ask for the customer's phone number, even if you see a caller ID.`;
}

/**
 * Formatta i giorni di chiusura in modo leggibile
 */
function formatClosedDays(config, isItalian) {
  const dayNames = isItalian
    ? ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato']
    : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  
  const parts = [];
  
  // Giorni sempre chiusi
  if (config.weekly_closing_days?.length > 0) {
    const days = config.weekly_closing_days.map(d => dayNames[d]).join(', ');
    parts.push(isItalian ? `Chiuso: ${days}` : `Closed: ${days}`);
  }
  
  // Pranzo chiuso
  if (config.lunch_closed_days?.length > 0) {
    const days = config.lunch_closed_days.map(d => dayNames[d]).join(', ');
    parts.push(isItalian ? `Pranzo chiuso: ${days}` : `Lunch closed: ${days}`);
  }
  
  // Cena chiusa
  if (config.dinner_closed_days?.length > 0) {
    const days = config.dinner_closed_days.map(d => dayNames[d]).join(', ');
    parts.push(isItalian ? `Cena chiusa: ${days}` : `Dinner closed: ${days}`);
  }
  
  return parts.join('. ') || (isItalian ? 'Nessuna chiusura fissa' : 'No fixed closures');
}

export default { setupMediaStreamHandler };
