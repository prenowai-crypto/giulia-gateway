// ═══════════════════════════════════════════════════════════════════════════════
// PRENOW - MEDIA STREAM HANDLER v1.6.0
// FIX: Usa callDataStore per recuperare From/To dal CallSid
// ═══════════════════════════════════════════════════════════════════════════════

import { WebSocketServer } from 'ws';
import { OpenAIRealtimeClient } from './openai-realtime.js';

// Importato da index.js - sarà passato come config
let callDataStore = null;

/**
 * Setup WebSocket server per Telnyx/Twilio Media Streams
 */
export function setupMediaStreamHandler(server, config) {
  // Salva reference al callDataStore
  callDataStore = config.callDataStore;
  
  const wss = new WebSocketServer({ server, path: '/media-stream' });
  
  console.log('📡 Media Stream WebSocket server attivo su /media-stream');
  
  wss.on('connection', (ws, req) => {
    console.log('🔌 Nuova connessione Twilio Media Stream');
    console.log(`   URL: ${req.url}`);
    console.log(`   Headers:`, JSON.stringify(req.headers, null, 2));
    
    // Stato della sessione - From/To verranno recuperati dal callDataStore
    const session = {
      streamSid: null,
      callSid: null,
      from: 'unknown',
      to: 'unknown',
      openaiClient: null,
      restaurantConfig: null,
    };
    
    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message);
        
        // Log primo messaggio per debug struttura Telnyx
        if (data.event === 'connected' || data.event === 'start') {
          console.log(`📨 Evento ${data.event}:`, JSON.stringify(data, null, 2));
        }
        
        switch (data.event) {
          case 'connected':
            console.log('✅ Twilio connected');
            break;
            
          case 'start':
            // Telnyx può usare struttura diversa da Twilio
            // Twilio: data.start.streamSid, data.start.callSid, data.start.customParameters
            // Telnyx: data.start.stream_id, data.start.call_control_id, etc.
            
            session.streamSid = data.start?.streamSid || data.start?.stream_id || data.streamSid || data.stream_id;
            session.callSid = data.start?.callSid || data.start?.call_control_id || data.callSid || data.call_control_id || data.CallSid;
            
            console.log(`📞 Stream started - StreamSid: ${session.streamSid}, CallSid: ${session.callSid}`);
            
            // ═══════════════════════════════════════════════════════════════
            // FIX v1.6.0: Recupera From/To dal callDataStore usando CallSid
            // ═══════════════════════════════════════════════════════════════
            if (callDataStore && session.callSid) {
              const storedData = callDataStore.get(session.callSid);
              if (storedData) {
                session.from = storedData.from;
                session.to = storedData.to;
                console.log(`💾 Recuperato da store - From: ${session.from}, To: ${session.to}`);
              } else {
                console.warn(`⚠️ Nessun dato trovato in store per CallSid: ${session.callSid}`);
                // Prova anche con varianti del CallSid (Telnyx può usare formati diversi)
                for (const [key, value] of callDataStore.entries()) {
                  if (session.callSid.includes(key) || key.includes(session.callSid)) {
                    session.from = value.from;
                    session.to = value.to;
                    console.log(`💾 Match parziale trovato - From: ${session.from}, To: ${session.to}`);
                    break;
                  }
                }
              }
            }
            
            // Fallback: prova customParameters (Twilio style)
            if (session.from === 'unknown' && data.start?.customParameters?.from) {
              session.from = data.start.customParameters.from;
            }
            if (session.to === 'unknown' && data.start?.customParameters?.to) {
              session.to = data.start.customParameters.to;
            }
            
            console.log(`📞 Final - From: ${session.from}, To: ${session.to}`);
            
            // Cerca config ristorante
            session.restaurantConfig = await config.getRestaurantConfig(session.to);
            
            if (!session.restaurantConfig) {
              console.error(`❌ Nessun ristorante trovato per numero: ${session.to}`);
              ws.close();
              return;
            }
            
            console.log(`🍽️  Ristorante: ${session.restaurantConfig.restaurant_name}`);
            
            // Calcola contesto date
            const dateContext = buildDateContext(session.restaurantConfig.timezone || 'Europe/Rome');
            console.log(`📅 Date context: Oggi è ${dateContext.todayFormatted}`);
            
            // Inizializza client OpenAI
            session.openaiClient = new OpenAIRealtimeClient({
              apiKey: config.openaiApiKey,
              model: config.model || 'gpt-4o-mini-realtime-preview',
              systemPrompt: buildSystemPrompt(session.restaurantConfig, dateContext),
              tools: config.tools,
              callSid: session.callSid,
              restaurantConfig: session.restaurantConfig,
              onAudioDelta: (audioBase64) => {
                if (ws.readyState === 1) {
                  // Telnyx usa stream_id, Twilio usa streamSid
                  ws.send(JSON.stringify({
                    event: 'media',
                    stream_id: session.streamSid,  // Telnyx format
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
            // DEBUG: Log primi 3 pacchetti audio per verificare che arrivino
            if (!session.mediaPacketCount) session.mediaPacketCount = 0;
            session.mediaPacketCount++;
            if (session.mediaPacketCount <= 3) {
              console.log(`🔊 Media packet #${session.mediaPacketCount} ricevuto (${data.media?.payload?.length || 0} bytes)`);
            }
            // Log ogni 100 pacchetti per vedere se continuano ad arrivare
            if (session.mediaPacketCount % 100 === 0) {
              console.log(`📊 Media packets totali: ${session.mediaPacketCount}, OpenAI ready: ${!!session.openaiClient?.isConnected}`);
            }
            
            if (session.openaiClient && session.openaiClient.isConnected && data.media?.payload) {
              session.openaiClient.sendAudio(data.media.payload);
            } else if (session.mediaPacketCount <= 5) {
              console.log(`⚠️ Media packet #${session.mediaPacketCount} PERSO - OpenAI non pronto`);
            }
            break;
            
          case 'stop':
            console.log(`🛑 Stream stopped - CallSid: ${session.callSid}`);
            if (session.openaiClient) {
              session.openaiClient.disconnect();
            }
            break;
            
          default:
            break;
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

// ═══════════════════════════════════════════════════════════════════════════════
// CALCOLO DINAMICO DATE
// ═══════════════════════════════════════════════════════════════════════════════

function buildDateContext(timezone = 'Europe/Rome') {
  const now = new Date();
  const options = { timeZone: timezone };
  const localDate = new Date(now.toLocaleString('en-US', options));
  
  const dayNames = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
  const monthNames = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 
                      'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
  
  const todayDayOfWeek = localDate.getDay();
  const todayDate = localDate.getDate();
  const todayMonth = localDate.getMonth();
  const todayYear = localDate.getFullYear();
  const todayFormatted = `${dayNames[todayDayOfWeek]} ${todayDate} ${monthNames[todayMonth]} ${todayYear}`;
  const todayISO = formatDateISO(localDate);
  
  const tomorrow = new Date(localDate);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowFormatted = `${dayNames[tomorrow.getDay()]} ${tomorrow.getDate()} ${monthNames[tomorrow.getMonth()]}`;
  const tomorrowISO = formatDateISO(tomorrow);
  
  const dayAfterTomorrow = new Date(localDate);
  dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);
  const dayAfterTomorrowFormatted = `${dayNames[dayAfterTomorrow.getDay()]} ${dayAfterTomorrow.getDate()} ${monthNames[dayAfterTomorrow.getMonth()]}`;
  const dayAfterTomorrowISO = formatDateISO(dayAfterTomorrow);
  
  const daysUntilSaturday = (6 - todayDayOfWeek + 7) % 7;
  const saturday = new Date(localDate);
  saturday.setDate(saturday.getDate() + (daysUntilSaturday === 0 ? 7 : daysUntilSaturday));
  const saturdayFormatted = `sabato ${saturday.getDate()} ${monthNames[saturday.getMonth()]}`;
  const saturdayISO = formatDateISO(saturday);
  
  const sunday = new Date(saturday);
  sunday.setDate(sunday.getDate() + 1);
  const sundayFormatted = `domenica ${sunday.getDate()} ${monthNames[sunday.getMonth()]}`;
  const sundayISO = formatDateISO(sunday);
  
  const weekDates = {};
  for (let i = 0; i < 7; i++) {
    const date = new Date(localDate);
    const daysUntil = (i - todayDayOfWeek + 7) % 7;
    date.setDate(date.getDate() + (daysUntil === 0 && i !== todayDayOfWeek ? 7 : daysUntil));
    if (i === todayDayOfWeek) {
      date.setDate(date.getDate() + 7);
    }
    weekDates[dayNames[i]] = {
      formatted: `${date.getDate()} ${monthNames[date.getMonth()]}`,
      iso: formatDateISO(date)
    };
  }
  
  return {
    todayFormatted,
    todayISO,
    todayDayOfWeek,
    todayDayName: dayNames[todayDayOfWeek],
    tomorrowFormatted,
    tomorrowISO,
    dayAfterTomorrowFormatted,
    dayAfterTomorrowISO,
    saturdayFormatted,
    saturdayISO,
    sundayFormatted,
    sundayISO,
    weekDates,
    year: todayYear,
    month: todayMonth,
    monthName: monthNames[todayMonth]
  };
}

function formatDateISO(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildSystemPrompt(config, dateContext) {
  const lang = config.language || 'it-IT';
  const isItalian = lang.startsWith('it');
  
  const closedDaysText = formatClosedDays(config, isItalian);
  const closedDayNumbers = config.weekly_closing_days || [];
  
  if (isItalian) {
    return `Sei ${config.receptionist_name || 'Giulia'}, la receptionist AI del ristorante "${config.restaurant_name}".

═══════════════════════════════════════════════════════════════════════════════
📅 DATA E ORA CORRENTE (IMPORTANTE - USA QUESTE DATE!)
═══════════════════════════════════════════════════════════════════════════════
OGGI È: ${dateContext.todayFormatted} (${dateContext.todayISO})
- "domani" = ${dateContext.tomorrowFormatted} (${dateContext.tomorrowISO})
- "dopodomani" = ${dateContext.dayAfterTomorrowFormatted} (${dateContext.dayAfterTomorrowISO})
- "questo weekend" = ${dateContext.saturdayFormatted} (${dateContext.saturdayISO}) o ${dateContext.sundayFormatted} (${dateContext.sundayISO})
- "prossimo lunedì" = ${dateContext.weekDates['lunedì'].formatted} (${dateContext.weekDates['lunedì'].iso})
- "prossimo martedì" = ${dateContext.weekDates['martedì'].formatted} (${dateContext.weekDates['martedì'].iso})
- "prossimo mercoledì" = ${dateContext.weekDates['mercoledì'].formatted} (${dateContext.weekDates['mercoledì'].iso})
- "prossimo giovedì" = ${dateContext.weekDates['giovedì'].formatted} (${dateContext.weekDates['giovedì'].iso})
- "prossimo venerdì" = ${dateContext.weekDates['venerdì'].formatted} (${dateContext.weekDates['venerdì'].iso})
- "prossimo sabato" = ${dateContext.weekDates['sabato'].formatted} (${dateContext.weekDates['sabato'].iso})
- "prossima domenica" = ${dateContext.weekDates['domenica'].formatted} (${dateContext.weekDates['domenica'].iso})

ATTENZIONE: Quando chiami i tool, usa SEMPRE il formato data ISO (YYYY-MM-DD)!
═══════════════════════════════════════════════════════════════════════════════

REGOLE COMUNICAZIONE:
- Parla in italiano, in modo naturale e cordiale
- Sei al telefono, quindi sii concisa (max 2 frasi per risposta)
- Non inventare informazioni su accessibilità, parcheggio o altri servizi
- IGNORA se senti ripetere quello che hai appena detto (è un echo tecnico)
- Aspetta sempre che il cliente finisca di parlare prima di rispondere

INFORMAZIONI RISTORANTE:
- Nome: ${config.restaurant_name}
- ${closedDaysText}
- Orari pranzo: ${config.lunch_start || '12:00'} - ${config.lunch_end || '14:30'}
- Orari cena: ${config.dinner_start || '19:00'} - ${config.dinner_end || '22:30'}
- Capienza per slot: ${config.slot_capacity || 30} persone

═══════════════════════════════════════════════════════════════════════════════
⚠️ VERIFICA PRELIMINARE
═══════════════════════════════════════════════════════════════════════════════
Quando il cliente dice un GIORNO o una DATA:
1. Calcola quale data ISO corrisponde
2. Verifica se quel giorno è nella lista chiusure: [${closedDayNumbers.join(', ')}] (0=dom, 1=lun...)
3. SE È CHIUSO: Comunica SUBITO "Mi dispiace, ${closedDaysText.toLowerCase()}. Posso proporle un altro giorno?"
4. SE È APERTO: Procedi a chiedere orario/persone/nome/telefono
═══════════════════════════════════════════════════════════════════════════════

FLUSSO PRENOTAZIONE:
1. Raccogli: data, orario, numero persone, nome, telefono
2. USA SEMPRE check_availability con la data in formato ISO (YYYY-MM-DD)
3. USA SEMPRE create_reservation per creare la prenotazione
4. Solo dopo success:true puoi confermare al cliente

═══════════════════════════════════════════════════════════════════════════════
🚫 ERRORI DA EVITARE
═══════════════════════════════════════════════════════════════════════════════
- NON dire MAI "confermato" senza aver chiamato create_reservation!
- NON usare nome="Cliente" o valori placeholder
- NON inventare numeri di telefono!
- NON usare date nel passato
═══════════════════════════════════════════════════════════════════════════════

GRUPPI GRANDI:
- Oltre ${config.large_group_threshold || 10} persone: va in attesa conferma ristoratore
- Oltre ${config.event_threshold || 45} persone: suggerisci email a ${config.owner_email || 'il ristorante'}

IMPORTANTE: Chiedi SEMPRE il numero di telefono del cliente!`;
  }
  
  return `You are ${config.receptionist_name || 'Giulia'}, the AI receptionist for "${config.restaurant_name}".

TODAY IS: ${dateContext.todayFormatted} (${dateContext.todayISO})

RESTAURANT INFO:
- Name: ${config.restaurant_name}
- ${closedDaysText}
- Lunch: ${config.lunch_start || '12:00'} - ${config.lunch_end || '14:30'}
- Dinner: ${config.dinner_start || '19:00'} - ${config.dinner_end || '22:30'}

RESERVATION FLOW:
1. Collect: date, time, number of people, name, phone
2. ALWAYS use check_availability with ISO date format
3. ALWAYS use create_reservation to create the booking
4. Only confirm after success:true

IMPORTANT: ALWAYS ask for the customer's phone number!`;
}

function formatClosedDays(config, isItalian) {
  const dayNames = isItalian
    ? ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato']
    : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  
  const parts = [];
  
  if (config.weekly_closing_days?.length > 0) {
    const days = config.weekly_closing_days.map(d => dayNames[d]).join(', ');
    parts.push(isItalian ? `Chiuso il: ${days}` : `Closed: ${days}`);
  }
  
  if (config.lunch_closed_days?.length > 0) {
    const days = config.lunch_closed_days.map(d => dayNames[d]).join(', ');
    parts.push(isItalian ? `Pranzo chiuso: ${days}` : `Lunch closed: ${days}`);
  }
  
  if (config.dinner_closed_days?.length > 0) {
    const days = config.dinner_closed_days.map(d => dayNames[d]).join(', ');
    parts.push(isItalian ? `Cena chiusa: ${days}` : `Dinner closed: ${days}`);
  }
  
  return parts.join('. ') || (isItalian ? 'Nessuna chiusura fissa' : 'No fixed closures');
}

export default { setupMediaStreamHandler };
