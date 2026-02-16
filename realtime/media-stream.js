// ═══════════════════════════════════════════════════════════════════════════════
// PRENOW - MEDIA STREAM HANDLER v1.1.0
// Riceve audio da Twilio Media Streams e lo passa a OpenAI Realtime
// FIX: Aggiunto calcolo dinamico date nel system prompt
// ═══════════════════════════════════════════════════════════════════════════════

import { WebSocketServer } from 'ws';
import { OpenAIRealtimeClient } from './openai-realtime.js';

/**
 * Setup WebSocket server per Twilio Media Streams
 * @param {import('http').Server} server - HTTP server instance
 * @param {object} config - Configurazione (tools, systemPrompt, etc.)
 */
export function setupMediaStreamHandler(server, config) {
  const wss = new WebSocketServer({ server, path: '/media-stream' });
  
  console.log('📡 Media Stream WebSocket server attivo su /media-stream');
  
  wss.on('connection', (ws, req) => {
    console.log('🔌 Nuova connessione Twilio Media Stream');
    
    // Stato della sessione
    const session = {
      streamSid: null,
      callSid: null,
      from: null,
      to: null,
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
            session.streamSid = data.start.streamSid;
            session.callSid = data.start.callSid;
            session.from = data.start.customParameters?.from || 'unknown';
            session.to = data.start.customParameters?.to || 'unknown';
            
            console.log(`📞 Stream started - CallSid: ${session.callSid}`);
            console.log(`   From: ${session.from}, To: ${session.to}`);
            
            session.restaurantConfig = await config.getRestaurantConfig(session.to);
            
            if (!session.restaurantConfig) {
              console.error(`❌ Nessun ristorante trovato per numero: ${session.to}`);
              ws.close();
              return;
            }
            
            console.log(`🍽️  Ristorante: ${session.restaurantConfig.restaurant_name}`);
            
            // ═══════════════════════════════════════════════════════════════
            // FIX v1.1.0: Passa la data corrente al system prompt
            // ═══════════════════════════════════════════════════════════════
            const dateContext = buildDateContext(session.restaurantConfig.timezone || 'Europe/Rome');
            console.log(`📅 Date context: Oggi è ${dateContext.todayFormatted}`);
            
            session.openaiClient = new OpenAIRealtimeClient({
              apiKey: config.openaiApiKey,
              model: config.model || 'gpt-4o-mini-realtime-preview',
              systemPrompt: buildSystemPrompt(session.restaurantConfig, dateContext),
              tools: config.tools,
              callSid: session.callSid,
              restaurantConfig: session.restaurantConfig,
              onAudioDelta: (audioBase64) => {
                if (ws.readyState === 1) { // WebSocket.OPEN
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
            // Ignora eventi non gestiti
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
// FIX v1.1.0: CALCOLO DINAMICO DATE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Calcola il contesto temporale corrente per il ristorante
 * @param {string} timezone - Timezone del ristorante (es. 'Europe/Rome')
 * @returns {object} Contesto date con oggi, domani, weekend, etc.
 */
function buildDateContext(timezone = 'Europe/Rome') {
  const now = new Date();
  
  // Converti in timezone del ristorante
  const options = { timeZone: timezone };
  const localDate = new Date(now.toLocaleString('en-US', options));
  
  const dayNames = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
  const monthNames = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 
                      'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
  
  // Oggi
  const todayDayOfWeek = localDate.getDay();
  const todayDate = localDate.getDate();
  const todayMonth = localDate.getMonth();
  const todayYear = localDate.getFullYear();
  const todayFormatted = `${dayNames[todayDayOfWeek]} ${todayDate} ${monthNames[todayMonth]} ${todayYear}`;
  const todayISO = formatDateISO(localDate);
  
  // Domani
  const tomorrow = new Date(localDate);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowFormatted = `${dayNames[tomorrow.getDay()]} ${tomorrow.getDate()} ${monthNames[tomorrow.getMonth()]}`;
  const tomorrowISO = formatDateISO(tomorrow);
  
  // Dopodomani
  const dayAfterTomorrow = new Date(localDate);
  dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);
  const dayAfterTomorrowFormatted = `${dayNames[dayAfterTomorrow.getDay()]} ${dayAfterTomorrow.getDate()} ${monthNames[dayAfterTomorrow.getMonth()]}`;
  const dayAfterTomorrowISO = formatDateISO(dayAfterTomorrow);
  
  // Prossimo weekend (sabato e domenica)
  const daysUntilSaturday = (6 - todayDayOfWeek + 7) % 7;
  const saturday = new Date(localDate);
  saturday.setDate(saturday.getDate() + (daysUntilSaturday === 0 ? 7 : daysUntilSaturday));
  const saturdayFormatted = `sabato ${saturday.getDate()} ${monthNames[saturday.getMonth()]}`;
  const saturdayISO = formatDateISO(saturday);
  
  const sunday = new Date(saturday);
  sunday.setDate(sunday.getDate() + 1);
  const sundayFormatted = `domenica ${sunday.getDate()} ${monthNames[sunday.getMonth()]}`;
  const sundayISO = formatDateISO(sunday);
  
  // Calcola le date per ogni giorno della settimana prossima
  const weekDates = {};
  for (let i = 0; i < 7; i++) {
    const date = new Date(localDate);
    // Trova il prossimo giorno i (se oggi è quel giorno, prendi la settimana prossima)
    const daysUntil = (i - todayDayOfWeek + 7) % 7;
    date.setDate(date.getDate() + (daysUntil === 0 && i !== todayDayOfWeek ? 7 : daysUntil));
    // Se è oggi, il prossimo lunedì è tra 7 giorni
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

/**
 * Formatta una data in ISO (YYYY-MM-DD)
 */
function formatDateISO(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Costruisce il system prompt per OpenAI basato sulla config del ristorante
 * @param {object} config - Configurazione ristorante
 * @param {object} dateContext - Contesto date calcolato dinamicamente
 */
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
- "questo weekend" / "questo fine settimana" = ${dateContext.saturdayFormatted} (${dateContext.saturdayISO}) o ${dateContext.sundayFormatted} (${dateContext.sundayISO})
- "prossimo lunedì" = ${dateContext.weekDates['lunedì'].formatted} (${dateContext.weekDates['lunedì'].iso})
- "prossimo martedì" = ${dateContext.weekDates['martedì'].formatted} (${dateContext.weekDates['martedì'].iso})
- "prossimo mercoledì" = ${dateContext.weekDates['mercoledì'].formatted} (${dateContext.weekDates['mercoledì'].iso})
- "prossimo giovedì" = ${dateContext.weekDates['giovedì'].formatted} (${dateContext.weekDates['giovedì'].iso})
- "prossimo venerdì" = ${dateContext.weekDates['venerdì'].formatted} (${dateContext.weekDates['venerdì'].iso})
- "prossimo sabato" = ${dateContext.weekDates['sabato'].formatted} (${dateContext.weekDates['sabato'].iso})
- "prossima domenica" = ${dateContext.weekDates['domenica'].formatted} (${dateContext.weekDates['domenica'].iso})

ATTENZIONE: Quando chiami i tool, usa SEMPRE il formato data ISO (YYYY-MM-DD) indicato sopra!
NON inventare date! Se il cliente dice "lunedì", usa la data ISO corrispondente dalla lista sopra.
═══════════════════════════════════════════════════════════════════════════════

REGOLE COMUNICAZIONE:
- Parla in italiano, in modo naturale e cordiale
- Sei al telefono, quindi sii concisa (max 2 frasi per risposta)
- Non inventare informazioni su accessibilità, parcheggio o altri servizi

INFORMAZIONI RISTORANTE:
- Nome: ${config.restaurant_name}
- ${closedDaysText}
- Orari pranzo: ${config.lunch_start || '12:00'} - ${config.lunch_end || '14:30'}
- Orari cena: ${config.dinner_start || '21:00'} - ${config.dinner_end || '23:00'}
- Capienza per slot: ${config.slot_capacity || 30} persone

═══════════════════════════════════════════════════════════════════════════════
⚠️ VERIFICA PRELIMINARE (PRIMA di raccogliere altri dati!)
═══════════════════════════════════════════════════════════════════════════════
Quando il cliente dice un GIORNO o una DATA:
1. Calcola quale data ISO corrisponde usando la tabella sopra
2. Verifica se quel giorno è nella lista chiusure: [${closedDayNumbers.join(', ')}] (0=domenica, 1=lunedì, ...)
3. SE È CHIUSO: Comunica SUBITO "Mi dispiace, ${closedDaysText.toLowerCase()}. Posso proporle un altro giorno?"
4. SE È APERTO: Procedi a chiedere orario/persone/nome/telefono

Quando il cliente dice un ORARIO:
- Orari validi pranzo: ${config.lunch_start || '12:00'} - ${config.lunch_end || '14:30'}
- Orari validi cena: ${config.dinner_start || '21:00'} - ${config.dinner_end || '23:00'}
- SE FUORI ORARIO (es. 18:00): Comunica SUBITO gli orari disponibili!
═══════════════════════════════════════════════════════════════════════════════

FLUSSO PRENOTAZIONE:
1. Raccogli: data, orario, numero persone, nome, telefono
2. USA SEMPRE check_availability con la data in formato ISO (YYYY-MM-DD)
3. USA SEMPRE create_reservation per creare la prenotazione
4. Solo dopo success:true puoi confermare al cliente

═══════════════════════════════════════════════════════════════════════════════
🚫 ERRORI DA EVITARE ASSOLUTAMENTE
═══════════════════════════════════════════════════════════════════════════════
- NON dire MAI "confermato" senza aver chiamato create_reservation!
- NON usare nome="Cliente" o valori placeholder
- NON inventare numeri di telefono! Se il cliente dice "il numero da cui chiamo", chiedi di dettarlo
- NON usare date nel passato (oggi è ${dateContext.todayISO})
- NON confondere i giorni della settimana con le date
═══════════════════════════════════════════════════════════════════════════════

GRUPPI GRANDI:
- Oltre ${config.large_group_threshold || 10} persone: va in attesa conferma ristoratore
- Oltre ${config.event_threshold || 45} persone: suggerisci email a ${config.owner_email || 'il ristorante'}

IMPORTANTE: Chiedi SEMPRE il numero di telefono del cliente!`;
  }
  
  // English version
  return `You are ${config.receptionist_name || 'Giulia'}, the AI receptionist for "${config.restaurant_name}".

═══════════════════════════════════════════════════════════════════════════════
📅 CURRENT DATE AND TIME (IMPORTANT - USE THESE DATES!)
═══════════════════════════════════════════════════════════════════════════════
TODAY IS: ${dateContext.todayFormatted} (${dateContext.todayISO})
- "tomorrow" = ${dateContext.tomorrowISO}
- "day after tomorrow" = ${dateContext.dayAfterTomorrowISO}
- "this weekend" = ${dateContext.saturdayISO} or ${dateContext.sundayISO}

When calling tools, ALWAYS use the ISO date format (YYYY-MM-DD) listed above!
═══════════════════════════════════════════════════════════════════════════════

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

/**
 * Formatta i giorni di chiusura in modo leggibile
 */
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
