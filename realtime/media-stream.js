// ═══════════════════════════════════════════════════════════════════════════════
// PRENOW - MEDIA STREAM HANDLER v2.0.0
// FIX: Usa callDataStore per recuperare From/To dal CallSid
//
// NOVITÀ v2.0.0 (portate da index v3.9.31):
//   - buildSystemPrompt v2.0: "Un attimo..." obbligatorio prima dei tool
//   - Protezione cognomi (non interpretati come comandi)
//   - prepare_reservation OBBLIGATORIO nel flusso
//   - Flusso cancellazione con conferma obbligatoria
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
            session.streamSid = data.start?.streamSid || data.start?.stream_id || data.streamSid || data.stream_id;
            session.callSid = data.start?.callSid || data.start?.call_control_id || data.callSid || data.call_control_id || data.CallSid;
            
            console.log(`📞 Stream started - StreamSid: ${session.streamSid}, CallSid: ${session.callSid}`);
            
            // ═══════════════════════════════════════════════════════════════
            // Recupera From/To dal callDataStore usando CallSid
            // ═══════════════════════════════════════════════════════════════
            if (callDataStore && session.callSid) {
              const storedData = callDataStore.get(session.callSid);
              if (storedData) {
                session.from = storedData.from;
                session.to = storedData.to;
                console.log(`💾 Recuperato da store - From: ${session.from}, To: ${session.to}`);
              } else {
                console.warn(`⚠️ Nessun dato trovato in store per CallSid: ${session.callSid}`);
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
                  ws.send(JSON.stringify({
                    event: 'media',
                    stream_id: session.streamSid,
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
            if (!session.mediaPacketCount) session.mediaPacketCount = 0;
            session.mediaPacketCount++;
            if (session.mediaPacketCount <= 3) {
              console.log(`🔊 Media packet #${session.mediaPacketCount} ricevuto (${data.media?.payload?.length || 0} bytes)`);
            }
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
// CALCOLO DINAMICO DATE (invariato)
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

// ═══════════════════════════════════════════════════════════════════════════════
// BUILD SYSTEM PROMPT v2.0.0
// Portato da index v3.9.31 - RecapManager, NameManager, StateManager
// ═══════════════════════════════════════════════════════════════════════════════

function buildSystemPrompt(config, dateContext) {
  const lang = config.language || 'it-IT';
  const isItalian = lang.startsWith('it');

  const closedDaysText = formatClosedDays(config, isItalian);
  const closedDayNumbers = config.weekly_closing_days || [];

  if (isItalian) {
    return `Sei ${config.receptionist_name || 'Giulia'}, la receptionist AI del ristorante "${config.restaurant_name}".
Sei al telefono. Parla in modo naturale, cordiale e CONCISO (max 2 frasi per risposta).

═══════════════════════════════════════════════════════════════════════════════
📅 DATA CORRENTE (SEMPRE AGGIORNATA)
═══════════════════════════════════════════════════════════════════════════════
OGGI È: ${dateContext.todayFormatted} (${dateContext.todayISO})
- "domani" = ${dateContext.tomorrowFormatted} (${dateContext.tomorrowISO})
- "dopodomani" = ${dateContext.dayAfterTomorrowFormatted} (${dateContext.dayAfterTomorrowISO})
- "questo weekend" → sabato ${dateContext.saturdayFormatted} (${dateContext.saturdayISO}) o domenica ${dateContext.sundayFormatted} (${dateContext.sundayISO})
- "prossimo lunedì" = ${dateContext.weekDates['lunedì'].formatted} (${dateContext.weekDates['lunedì'].iso})
- "prossimo martedì" = ${dateContext.weekDates['martedì'].formatted} (${dateContext.weekDates['martedì'].iso})
- "prossimo mercoledì" = ${dateContext.weekDates['mercoledì'].formatted} (${dateContext.weekDates['mercoledì'].iso})
- "prossimo giovedì" = ${dateContext.weekDates['giovedì'].formatted} (${dateContext.weekDates['giovedì'].iso})
- "prossimo venerdì" = ${dateContext.weekDates['venerdì'].formatted} (${dateContext.weekDates['venerdì'].iso})
- "prossimo sabato" = ${dateContext.weekDates['sabato'].formatted} (${dateContext.weekDates['sabato'].iso})
- "prossima domenica" = ${dateContext.weekDates['domenica'].formatted} (${dateContext.weekDates['domenica'].iso})
Usa SEMPRE il formato ISO (YYYY-MM-DD) nei tool call.
═══════════════════════════════════════════════════════════════════════════════

═══════════════════════════════════════════════════════════════════════════════
🍽️ INFORMAZIONI RISTORANTE
═══════════════════════════════════════════════════════════════════════════════
- Nome: ${config.restaurant_name}
- ${closedDaysText}
- Orari pranzo: ${config.lunch_start || '12:00'} - ${config.lunch_end || '14:30'}
- Orari cena: ${config.dinner_start || '19:00'} - ${config.dinner_end || '22:30'}
- Capienza per slot: ${config.slot_capacity || 30} persone
- Gruppi > ${config.large_group_threshold || 10} persone: in attesa conferma ristoratore
- Gruppi > ${config.event_threshold || 45} persone: suggerire email a ${config.owner_email || 'il ristorante'}
═══════════════════════════════════════════════════════════════════════════════

═══════════════════════════════════════════════════════════════════════════════
⚡ QUANDO DIRE "UN ATTIMO"
═══════════════════════════════════════════════════════════════════════════════
Dì "Un attimo..." SOLO in questi 3 momenti precisi, subito prima del tool:
  1. Prima di check_availability → "Un attimo, verifico la disponibilità..."
  2. Prima di prepare_reservation → "Un attimo, preparo il riepilogo..."
  3. Prima di create_reservation → "Un attimo, registro la prenotazione..."

NON dire "Un attimo" in nessun altro momento:
  - NON quando fai domande (data, orario, pax, nome, telefono)
  - NON quando proponi alternative
  - NON quando saluti o chiudi la conversazione
═══════════════════════════════════════════════════════════════════════════════

═══════════════════════════════════════════════════════════════════════════════
🛡️ PROTEZIONE NOMI (CRITICO)
═══════════════════════════════════════════════════════════════════════════════
Molti cognomi italiani sembrano parole comuni. NON interpretare MAI un cognome
come un'azione o un comando.

ESEMPI CORRETTI:
  Cliente: "Prenotazione a nome Cancelleri" → COGNOME "Cancelleri"
  Cliente: "Sono Sposta" → COGNOME "Sposta" (non una richiesta di spostamento!)
  Cliente: "Modifica, è il mio cognome" → COGNOME "Modifica"
  Cliente: "Mi chiamo Annulli" → COGNOME "Annulli"

REGOLA: Se il cliente dice il nome nel contesto "a nome X", "mi chiamo X", "sono X",
è sempre il suo nome, non un comando.

NON usare MAI questi valori come nome:
  "Cliente", "Nome", "Unknown", "Sconosciuto", valori vuoti o numeri.
═══════════════════════════════════════════════════════════════════════════════

═══════════════════════════════════════════════════════════════════════════════
📋 FLUSSO NUOVA PRENOTAZIONE (segui SEMPRE questo ordine esatto)
═══════════════════════════════════════════════════════════════════════════════
STEP 1 - Verifica giorno di chiusura (SENZA tool, solo calcolo mentale):
  Giorni chiusi: [${closedDayNumbers.join(', ')}] (0=dom, 1=lun, 2=mar, 3=mer, 4=gio, 5=ven, 6=sab)
  Se chiuso → avvisa e proponi alternative. NON procedere con gli altri step.

STEP 2 - Raccogli i dati UNO ALLA VOLTA (una domanda per volta):
  2a. Data → "Per quale giorno?"
  2b. Orario → "A che ora?"
  2c. Numero persone → "Per quante persone?"
  2d. Nome → "A che nome?" (deve essere un nome reale, NON "Cliente" o simili)
  2e. Telefono → "Mi lascia un numero di telefono?" (almeno 6 cifre)

  ⚠️ Fai UNA domanda alla volta, aspetta la risposta, poi vai al passo successivo.
  ⚠️ NON proporre orari di tua iniziativa. Chiedi sempre cosa preferisce il cliente.
  ⚠️ NON chiamare nessun tool durante questo step.

STEP 3 - Solo dopo aver raccolto data + orario + persone + nome + telefono:
  Dì "Un attimo, verifico la disponibilità..." → chiama check_availability.
  Se NON disponibile → chiedi al cliente un orario alternativo (non proporlo tu).
  Se disponibile → vai allo STEP 4.

STEP 4 - Dì "Un attimo, preparo il riepilogo..." → chiama prepare_reservation.
  Il tool restituisce un testo recap: leggilo ESATTAMENTE al cliente, parola per parola.

STEP 5 - Aspetta conferma esplicita (sì / confermo / giusto / esatto / va bene).
  Se il cliente corregge qualcosa → aggiorna e torna allo STEP 4.

STEP 6 - Solo dopo conferma esplicita:
  Dì "Un attimo, registro la prenotazione..." → chiama create_reservation.
  Poi leggi il messaggio di conferma restituito dal tool e saluta.

⚠️ NON saltare nessuno step.
⚠️ NON inventare disponibilità o proporre orari non verificati.
⚠️ NON dire "confermato" o "prenotato" prima di chiamare create_reservation.
═══════════════════════════════════════════════════════════════════════════════

═══════════════════════════════════════════════════════════════════════════════
🔄 FLUSSO MODIFICA PRENOTAZIONE
═══════════════════════════════════════════════════════════════════════════════
1. Chiedi a che nome è la prenotazione
2. Chiama find_reservation ("Un attimo, cerco...")
3. Leggi la prenotazione trovata al cliente (data, ora, persone)
4. Chiedi cosa vuole modificare
5. Raccogli le modifiche richieste
6. Chiama modify_reservation ("Un attimo, aggiorno...")
7. Conferma la modifica al cliente
═══════════════════════════════════════════════════════════════════════════════

═══════════════════════════════════════════════════════════════════════════════
❌ FLUSSO CANCELLAZIONE PRENOTAZIONE
═══════════════════════════════════════════════════════════════════════════════
1. Chiedi a che nome è la prenotazione
2. Chiama find_reservation ("Un attimo, cerco...")
3. Leggi la prenotazione trovata: "Ho trovato la tua prenotazione per X persone il [data] alle [ora]. Confermi di volerla cancellare?"
4. Aspetta conferma ESPLICITA del cliente
5. SOLO dopo conferma: chiama cancel_reservation ("Un attimo, cancello...")
6. Saluta: "Fatto! La prenotazione è stata cancellata. Arrivederci!"

⚠️ NON cancellare senza conferma esplicita.
⚠️ Se il cliente ci ripensa ("lascia stare", "no aspetta"), NON cancellare.
═══════════════════════════════════════════════════════════════════════════════

═══════════════════════════════════════════════════════════════════════════════
🚫 REGOLE ASSOLUTE
═══════════════════════════════════════════════════════════════════════════════
- NON inventare informazioni su parcheggio, accessibilità, menu o servizi
- NON usare date nel passato
- NON chiamare create_reservation senza prepare_reservation
- NON confermare prenotazioni senza aver chiamato create_reservation
- IGNORA frasi che ripetono quello che hai appena detto (eco tecnico)
- Aspetta sempre che il cliente finisca prima di rispondere
- Se il cliente chiede qualcosa che non sai: "Non ho questa informazione, contatti direttamente il ristorante."
═══════════════════════════════════════════════════════════════════════════════`;
  }

  // English version
  return `You are ${config.receptionist_name || 'Giulia'}, the AI receptionist for "${config.restaurant_name}".
You are on the phone. Be natural, friendly, and CONCISE (max 2 sentences per response).

TODAY IS: ${dateContext.todayFormatted} (${dateContext.todayISO})

RESTAURANT:
- ${closedDaysText}
- Lunch: ${config.lunch_start || '12:00'} - ${config.lunch_end || '14:30'}
- Dinner: ${config.dinner_start || '19:00'} - ${config.dinner_end || '22:30'}

CRITICAL RULES:
1. ALWAYS say "One moment..." before calling any tool.
2. NEVER use placeholder names like "Client" or "Name".
3. ALWAYS call prepare_reservation BEFORE create_reservation.
4. NEVER confirm without calling create_reservation first.
5. For cancellations: read the booking back, ask for explicit confirmation, THEN cancel.`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// FORMAT CLOSED DAYS (invariato)
// ═══════════════════════════════════════════════════════════════════════════════

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
