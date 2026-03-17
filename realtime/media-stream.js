// ═══════════════════════════════════════════════════════════════════════════════
// PRENOW - MEDIA STREAM HANDLER v2.1.0
// FIX v2.1.0:
//   - buildDateContext: aggiunto next14days per date assolute (8 marzo, ecc.)
//   - Passa callerPhone al context dei tool
//   - Email opzionale nel flusso nuova prenotazione
//   - Flusso modifica/cancellazione: chiede nome + data per find_reservation
// ═══════════════════════════════════════════════════════════════════════════════

import { WebSocketServer } from 'ws';
import { OpenAIRealtimeClient } from './openai-realtime.js';

let callDataStore = null;

export function setupMediaStreamHandler(server, config) {
  callDataStore = config.callDataStore;
  
  const wss = new WebSocketServer({ server, path: '/media-stream' });
  
  console.log('📡 Media Stream WebSocket server attivo su /media-stream');
  
  wss.on('connection', (ws, req) => {
    console.log('🔌 Nuova connessione Twilio Media Stream');
    
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
            
            if (session.from === 'unknown' && data.start?.customParameters?.from) {
              session.from = data.start.customParameters.from;
            }
            if (session.to === 'unknown' && data.start?.customParameters?.to) {
              session.to = data.start.customParameters.to;
            }
            
            console.log(`📞 Final - From: ${session.from}, To: ${session.to}`);
            
            session.restaurantConfig = await config.getRestaurantConfig(session.to);
            
            if (!session.restaurantConfig) {
              console.error(`❌ Nessun ristorante trovato per numero: ${session.to}`);
              ws.close();
              return;
            }
            
            console.log(`🍽️  Ristorante: ${session.restaurantConfig.restaurant_name}`);
            console.log(`🔒 Chiusure: weekly=${JSON.stringify(session.restaurantConfig.weekly_closing_days)} lunch=${JSON.stringify(session.restaurantConfig.lunch_closed_days)}`);
            
            const dateContext = buildDateContext(session.restaurantConfig.timezone || 'Europe/Rome');
            console.log(`📅 Date context: Oggi è ${dateContext.todayFormatted}`);
            
            session.openaiClient = new OpenAIRealtimeClient({
              apiKey: config.openaiApiKey,
              model: config.model || 'gpt-4o-mini-realtime-preview',
              systemPrompt: buildSystemPrompt(session.restaurantConfig, dateContext),
              tools: config.tools,
              callSid: session.callSid,
              // ✅ FIX: passa il numero del chiamante al context dei tool
              callerPhone: session.from !== 'unknown' ? session.from : null,
              restaurantConfig: session.restaurantConfig,
              onAudioDelta: (audioBase64) => {
                if (ws.readyState === 1) {
                  ws.send(JSON.stringify({
                    event: 'media',
                    stream_id: session.streamSid,
                    media: { payload: audioBase64 }
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
// CALCOLO DINAMICO DATE v2.1.0
// FIX: aggiunto next14days per risolvere date assolute (es. "8 marzo")
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
  
  // Prossimi giorni della settimana (invariato)
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

  // ✅ FIX: Prossimi 30 giorni con data → ISO
  // Permette all'AI di risolvere "8 marzo", "15 aprile", ecc.
  const absoluteDates = {};
  for (let i = 0; i <= 30; i++) {
    const date = new Date(localDate);
    date.setDate(date.getDate() + i);
    const day = date.getDate();
    const month = monthNames[date.getMonth()];
    const key = `${day} ${month}`; // es. "8 marzo"
    absoluteDates[key] = formatDateISO(date);
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
    absoluteDates,
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
// BUILD SYSTEM PROMPT v2.1.0
// ═══════════════════════════════════════════════════════════════════════════════

function buildSystemPrompt(config, dateContext) {
  const lang = config.language || 'it-IT';
  const isItalian = lang.startsWith('it');

  const closedDaysText = formatClosedDays(config, isItalian);
  const closedDayNumbers = config.weekly_closing_days || [];

  // Costruisce lista date assolute per il prompt (formato compatto)
  const absoluteDatesLines = Object.entries(dateContext.absoluteDates)
    .map(([label, iso]) => `${label}=${iso}`)
    .join(', ');

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

DATE ASSOLUTE prossimi 30 giorni: ${absoluteDatesLines}
⚠️ OBBLIGATORIO: Se il cliente dice una data come "8 marzo", "15 aprile" ecc. → cerca ESATTAMENTE in questa lista e usa quel valore ISO. NON calcolare le date da solo. NON inventare date.
═══════════════════════════════════════════════════════════════════════════════

═══════════════════════════════════════════════════════════════════════════════
🍽️ INFORMAZIONI RISTORANTE
═══════════════════════════════════════════════════════════════════════════════
- Nome: ${config.restaurant_name}
- Chiuso il: ${formatClosedDaysOnly(config, isItalian)}
- Orari pranzo: ${config.lunch_start || '12:00'} - ${config.lunch_end || '14:30'}
- Orari cena: ${config.dinner_start || '19:00'} - ${config.dinner_end || '22:30'}
- Capienza per slot: ${config.slot_capacity || 30} persone
- Gruppi > ${config.large_group_threshold || 10} persone: in attesa conferma ristoratore
- Gruppi > ${config.event_threshold || 45} persone: suggerire email a ${config.owner_email || 'il ristorante'}
═══════════════════════════════════════════════════════════════════════════════

⚠️ REGOLA CRITICA — CHIUSURE PARZIALI (pranzo/cena):
NON dire MAI al cliente che siamo "chiusi a pranzo" o "chiusi a cena" un giorno specifico
senza aver prima chiamato check_availability. Il tool restituirà l'informazione corretta.
Se non chiami check_availability, potresti dare informazioni false.
═══════════════════════════════════════════════════════════════════════════════

═══════════════════════════════════════════════════════════════════════════════
⚡ QUANDO DIRE "UN ATTIMO"
═══════════════════════════════════════════════════════════════════════════════
Dì "Un attimo..." SOLO in questi momenti precisi, subito prima del tool:
  1. Prima di check_availability → "Un attimo, verifico la disponibilità..."
  2. Prima di prepare_reservation → "Un attimo, preparo il riepilogo..."
  3. Prima di create_reservation → "Un attimo, registro la prenotazione..."
  4. Prima di find_reservation → "Un attimo, cerco la prenotazione..."
  5. Prima di modify_reservation → "Un attimo, aggiorno la prenotazione..."
  6. Prima di cancel_reservation → "Un attimo, cancello la prenotazione..."

NON dire "Un attimo" in nessun altro momento.
═══════════════════════════════════════════════════════════════════════════════

═══════════════════════════════════════════════════════════════════════════════
🛡️ PROTEZIONE NOMI (CRITICO)
═══════════════════════════════════════════════════════════════════════════════
Molti cognomi italiani sembrano parole comuni. NON interpretare MAI un cognome
come un'azione o un comando.

ESEMPI CORRETTI:
  Cliente: "Prenotazione a nome Cancelleri" → COGNOME "Cancelleri"
  Cliente: "Sono Sposta" → COGNOME "Sposta"
  Cliente: "Mi chiamo Annulli" → COGNOME "Annulli"

REGOLA: Se il cliente dice il nome nel contesto "a nome X", "mi chiamo X", "sono X",
è sempre il suo nome, non un comando.
═══════════════════════════════════════════════════════════════════════════════

═══════════════════════════════════════════════════════════════════════════════
📋 FLUSSO NUOVA PRENOTAZIONE (segui SEMPRE questo ordine esatto)
═══════════════════════════════════════════════════════════════════════════════
STEP 1 - Verifica giorno di chiusura (SENZA tool):
  Giorni chiusi: [${closedDayNumbers.join(', ')}] (0=dom, 1=lun, 2=mar, 3=mer, 4=gio, 5=ven, 6=sab)
  Se chiuso → avvisa e proponi alternative. NON procedere.

STEP 2 - Raccogli i dati UNO ALLA VOLTA (una domanda per volta, aspetta risposta):
  2a. Data → "Per quale giorno?"
  2b. Orario → "A che ora?"
  2c. Numero persone → "Per quante persone?"
  ⚠️ Solo questi 3 dati, poi vai allo STEP 3.
  ⚠️ NON chiedere nome o telefono qui.
  ⚠️ Il telefono viene acquisito automaticamente (NON chiederlo mai).

STEP 3 - Hai data + orario + persone:
  Dì "Un attimo, verifico la disponibilità..." → chiama check_availability.
  Se NON disponibile → chiedi al cliente una data o orario alternativo, torna allo STEP 2.
  Se disponibile → vai allo STEP 4.

STEP 4 - Chiedi il NOME (OBBLIGATORIO):
  "A che nome prenoto?" 
  Aspetta il nome reale. NON procedere senza un nome valido.
  ⚠️ NON usare "Cliente", "Nome", "Unknown" o qualsiasi placeholder.
  ⚠️ NON chiamare prepare_reservation senza un nome reale.

STEP 5 - Chiedi l'email (OPZIONALE):
  "Vuole ricevere l'email di conferma? Se sì, mi lascia il suo indirizzo?"
  Se non vuole o non ha email → prosegui senza.

STEP 6 - Hai nome + eventuale email:
  Dì "Un attimo, preparo il riepilogo..." → chiama prepare_reservation.
  Leggi il recap ESATTAMENTE come restituito dal tool.

STEP 7 - Aspetta conferma esplicita: "sì", "confermo", "giusto", "va bene".
  Se corregge → aggiorna il dato e torna allo STEP 6.
  Se non risponde → ripeti il recap e aspetta.

STEP 8 - Solo dopo conferma esplicita:
  Dì "Un attimo, registro la prenotazione..." → chiama create_reservation.
  Leggi il messaggio di conferma e saluta.

⚠️ ORDINE OBBLIGATORIO: check_availability → nome → email → prepare_reservation → conferma → create_reservation
⚠️ NON saltare nessuno step. NON chiamare prepare_reservation senza nome. NON chiamare create_reservation senza prepare_reservation.
⚠️ NON inventare disponibilità. NON dire "confermato" prima di create_reservation.
═══════════════════════════════════════════════════════════════════════════════

═══════════════════════════════════════════════════════════════════════════════
🔄 FLUSSO MODIFICA PRENOTAZIONE
═══════════════════════════════════════════════════════════════════════════════
1. Chiedi: "A che nome è la prenotazione e per quale giorno?"
   (Serve NOME + DATA per trovare la prenotazione corretta)
2. Dì "Un attimo, cerco..." → chiama find_reservation con nome e data
3. Leggi la prenotazione trovata al cliente
4. Chiedi cosa vuole modificare
5. Raccoglie le modifiche
6. Dì "Un attimo, aggiorno..." → chiama modify_reservation
7. Conferma la modifica al cliente
═══════════════════════════════════════════════════════════════════════════════

═══════════════════════════════════════════════════════════════════════════════
❌ FLUSSO CANCELLAZIONE PRENOTAZIONE
═══════════════════════════════════════════════════════════════════════════════
1. Chiedi: "A che nome è la prenotazione e per quale giorno?"
   (Serve NOME + DATA per trovare la prenotazione corretta)
2. Dì "Un attimo, cerco..." → chiama find_reservation con nome e data
3. Leggi la prenotazione trovata: "Ho trovato: X persone il [data] alle [ora]. Confermi la cancellazione?"
4. Aspetta conferma ESPLICITA
5. SOLO dopo conferma: dì "Un attimo, cancello..." → chiama cancel_reservation
6. "Fatto! Prenotazione cancellata. Arrivederci!"

⚠️ NON cancellare senza conferma esplicita.
═══════════════════════════════════════════════════════════════════════════════

═══════════════════════════════════════════════════════════════════════════════
🚫 REGOLE ASSOLUTE
═══════════════════════════════════════════════════════════════════════════════
- NON inventare informazioni su parcheggio, menu o servizi
- NON usare date nel passato
- NON chiamare create_reservation senza prepare_reservation
- NON confermare senza aver chiamato create_reservation
- IGNORA frasi che ripetono quello che hai appena detto (eco tecnico)
- Se non sai qualcosa: "Non ho questa informazione, contatti il ristorante."
═══════════════════════════════════════════════════════════════════════════════`;
  }

  return `You are ${config.receptionist_name || 'Giulia'}, the AI receptionist for "${config.restaurant_name}".
On the phone. Be natural, friendly, CONCISE (max 2 sentences).
TODAY IS: ${dateContext.todayFormatted} (${dateContext.todayISO})
Phone number is captured automatically from caller ID - do NOT ask for phone.
Email is optional - ask after availability check.
ALWAYS say "One moment..." before any tool call.`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// FORMAT CLOSED DAYS
// ═══════════════════════════════════════════════════════════════════════════════

// Solo chiusure settimanali totali (no pranzo/cena — gestite da check_availability)
function formatClosedDaysOnly(config, isItalian) {
  const dayNames = isItalian
    ? ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato']
    : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  if (config.weekly_closing_days?.length > 0) {
    const days = config.weekly_closing_days.map(d => dayNames[d]).join(', ');
    return isItalian ? days : days;
  }
  return isItalian ? 'Nessuna chiusura fissa' : 'No fixed closures';
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
