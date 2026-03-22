// ═══════════════════════════════════════════════════════════════════════════════
// PRENOW - MEDIA STREAM HANDLER v9.0.0
// ═══════════════════════════════════════════════════════════════════════════════

import { WebSocketServer } from 'ws';
import { OpenAIRealtimeClient } from './openai-realtime.js';

let callDataStore = null;

export function setupMediaStreamHandler(server, config) {
  callDataStore = config.callDataStore;

  const wss = new WebSocketServer({ server, path: '/media-stream' });

  console.log('📡 Media Stream WebSocket server attivo su /media-stream');

  wss.on('connection', (ws, req) => {
    console.log('🔌 Nuova connessione Media Stream');

    const session = {
      streamSid:        null,
      callSid:          null,
      from:             'unknown',
      to:               'unknown',
      openaiClient:     null,
      restaurantConfig: null,
      mediaPacketCount: 0,
    };

    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message);

        switch (data.event) {

          case 'connected':
            console.log('✅ Telnyx connected');
            break;

          case 'start': {
            session.streamSid = data.start?.streamSid || data.start?.stream_id || data.streamSid;
            session.callSid   = data.start?.callSid   || data.start?.call_control_id || data.callSid || data.call_control_id;

            console.log(`📞 Stream started — StreamSid: ${session.streamSid}, CallSid: ${session.callSid}`);
            console.log(`📨 Start payload:`, JSON.stringify(data, null, 2));

            // Recupera From/To dal callDataStore
            if (callDataStore && session.callSid) {
              const stored = callDataStore.get(session.callSid);
              if (stored) {
                session.from = stored.from;
                session.to   = stored.to;
                console.log(`💾 Store match esatto — From: ${session.from}, To: ${session.to}`);
              } else {
                // Match parziale (Telnyx può cambiare formato CallSid)
                for (const [key, value] of callDataStore.entries()) {
                  if (session.callSid.includes(key) || key.includes(session.callSid)) {
                    session.from = value.from;
                    session.to   = value.to;
                    console.log(`💾 Store match parziale — From: ${session.from}, To: ${session.to}`);
                    break;
                  }
                }
              }
            }

            // Fallback customParameters
            if (session.from === 'unknown' && data.start?.customParameters?.from) {
              session.from = data.start.customParameters.from;
            }
            if (session.to === 'unknown' && data.start?.customParameters?.to) {
              session.to = data.start.customParameters.to;
            }

            console.log(`📞 Final — From: ${session.from}, To: ${session.to}`);

            // Carica configurazione ristorante
            session.restaurantConfig = await config.getRestaurantConfig(session.to);
            if (!session.restaurantConfig) {
              console.error(`❌ Nessun ristorante per numero: ${session.to}`);
              ws.close();
              return;
            }

            console.log(`🍽️  Ristorante: ${session.restaurantConfig.restaurant_name}`);

            const dateContext = buildDateContext(session.restaurantConfig.timezone || 'Europe/Rome');
            console.log(`📅 Oggi: ${dateContext.todayFormatted}`);

            session.openaiClient = new OpenAIRealtimeClient({
              apiKey:           config.openaiApiKey,
              model:            config.model || 'gpt-4o-mini-realtime-preview',
              systemPrompt:     buildSystemPrompt(session.restaurantConfig, dateContext),
              tools:            config.tools,
              callSid:          session.callSid,
              callerPhone:      session.from !== 'unknown' ? session.from : null,
              restaurantConfig: session.restaurantConfig,
              onAudioDelta: (audioBase64) => {
                if (ws.readyState === 1) {
                  ws.send(JSON.stringify({
                    event:    'media',
                    stream_id: session.streamSid,
                    media:    { payload: audioBase64 },
                  }));
                }
              },
              onTranscript: (text, role) => {
                console.log(`💬 [${role}]: ${text}`);
              },
              onError: (error) => {
                console.error('❌ OpenAI error:', error);
              },
            });

            await session.openaiClient.connect();
            break;
          }

          case 'media':
            session.mediaPacketCount++;
            if (session.mediaPacketCount <= 3) {
              console.log(`🔊 Media packet #${session.mediaPacketCount} (${data.media?.payload?.length || 0} bytes)`);
            }
            if (session.mediaPacketCount % 200 === 0) {
              console.log(`📊 Media packets: ${session.mediaPacketCount}, OpenAI ready: ${!!session.openaiClient?.isConnected}`);
            }
            if (session.openaiClient?.isConnected && data.media?.payload) {
              session.openaiClient.sendAudio(data.media.payload);
            }
            break;

          case 'stop':
            console.log(`🛑 Stream stopped — CallSid: ${session.callSid}`);
            if (session.openaiClient) session.openaiClient.disconnect();
            break;

          default:
            break;
        }

      } catch (error) {
        console.error('❌ Errore parsing messaggio:', error);
      }
    });

    ws.on('close', () => {
      console.log(`🔌 Connessione chiusa — CallSid: ${session.callSid}`);
      if (session.openaiClient) session.openaiClient.disconnect();
    });

    ws.on('error', (error) => {
      console.error('❌ WebSocket error:', error);
    });
  });

  return wss;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DATE CONTEXT
// ═══════════════════════════════════════════════════════════════════════════════

function buildDateContext(timezone = 'Europe/Rome') {
  const now = new Date();
  const localDate = new Date(now.toLocaleString('en-US', { timeZone: timezone }));

  const dayNames   = ['domenica','lunedì','martedì','mercoledì','giovedì','venerdì','sabato'];
  const monthNames = ['gennaio','febbraio','marzo','aprile','maggio','giugno',
                      'luglio','agosto','settembre','ottobre','novembre','dicembre'];

  const todayDow    = localDate.getDay();
  const todayDate   = localDate.getDate();
  const todayMonth  = localDate.getMonth();
  const todayYear   = localDate.getFullYear();
  const todayISO    = formatDateISO(localDate);
  const todayFormatted = `${dayNames[todayDow]} ${todayDate} ${monthNames[todayMonth]} ${todayYear}`;

  const tomorrow = new Date(localDate); tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowFormatted = `${dayNames[tomorrow.getDay()]} ${tomorrow.getDate()} ${monthNames[tomorrow.getMonth()]}`;

  const dayAfter = new Date(localDate); dayAfter.setDate(dayAfter.getDate() + 2);
  const dayAfterTomorrowFormatted = `${dayNames[dayAfter.getDay()]} ${dayAfter.getDate()} ${monthNames[dayAfter.getMonth()]}`;

  const daysUntilSat = (6 - todayDow + 7) % 7;
  const saturday = new Date(localDate);
  saturday.setDate(saturday.getDate() + (daysUntilSat === 0 ? 7 : daysUntilSat));
  const saturdayFormatted = `sabato ${saturday.getDate()} ${monthNames[saturday.getMonth()]}`;

  const sunday = new Date(saturday); sunday.setDate(sunday.getDate() + 1);
  const sundayFormatted = `domenica ${sunday.getDate()} ${monthNames[sunday.getMonth()]}`;

  // Prossimo giorno della settimana per ognuno dei 7 giorni
  const weekDates = {};
  for (let i = 0; i < 7; i++) {
    const diff = ((i - todayDow) + 7) % 7;
    const d = new Date(localDate);
    d.setDate(d.getDate() + (diff === 0 ? 7 : diff));
    weekDates[dayNames[i]] = {
      formatted: `${d.getDate()} ${monthNames[d.getMonth()]}`,
      iso: formatDateISO(d),
    };
  }

  // Prossimi 30 giorni con data → ISO (per risolvere "8 marzo", "15 aprile", ecc.)
  const absoluteDates = {};
  for (let i = 0; i <= 30; i++) {
    const d = new Date(localDate);
    d.setDate(d.getDate() + i);
    const key = `${d.getDate()} ${monthNames[d.getMonth()]}`;
    absoluteDates[key] = formatDateISO(d);
  }

  return {
    todayFormatted, todayISO, todayDow,
    tomorrowFormatted,       tomorrowISO: formatDateISO(tomorrow),
    dayAfterTomorrowFormatted, dayAfterTomorrowISO: formatDateISO(dayAfter),
    saturdayFormatted,       saturdayISO: formatDateISO(saturday),
    sundayFormatted,         sundayISO:   formatDateISO(sunday),
    weekDates,
    absoluteDates,
    year: todayYear,
  };
}

function formatDateISO(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SYSTEM PROMPT v9.0.0
// ═══════════════════════════════════════════════════════════════════════════════

function buildSystemPrompt(config, dateContext) {
  const dayNames       = ['domenica','lunedì','martedì','mercoledì','giovedì','venerdì','sabato'];
  const closedDayNums  = config.weekly_closing_days || [];
  const closedDaysText = closedDayNums.map(d => dayNames[d]).join(', ') || 'nessuna';

  const absoluteDatesLines = Object.entries(dateContext.absoluteDates)
    .map(([label, iso]) => `${label}=${iso}`)
    .join(', ');

  return `Sei ${config.receptionist_name || 'Giulia'}, la receptionist AI del ristorante "${config.restaurant_name}".
Sei al telefono. Parla in modo naturale, cordiale e CONCISO (massimo 2 frasi per risposta).
NON usare formule ripetitive. NON fare elenchi. Rispondi come una persona reale.

═══════════════════════════════════════════════════════════════════════════════
📅 DATA CORRENTE
═══════════════════════════════════════════════════════════════════════════════
OGGI: ${dateContext.todayFormatted} (${dateContext.todayISO})
domani        = ${dateContext.tomorrowFormatted} (${dateContext.tomorrowISO})
dopodomani    = ${dateContext.dayAfterTomorrowFormatted} (${dateContext.dayAfterTomorrowISO})
sabato pros.  = ${dateContext.saturdayFormatted} (${dateContext.saturdayISO})
domenica pros.= ${dateContext.sundayFormatted} (${dateContext.sundayISO})
prossimo lunedì    = ${dateContext.weekDates['lunedì'].formatted}    (${dateContext.weekDates['lunedì'].iso})
prossimo martedì   = ${dateContext.weekDates['martedì'].formatted}   (${dateContext.weekDates['martedì'].iso})
prossimo mercoledì = ${dateContext.weekDates['mercoledì'].formatted} (${dateContext.weekDates['mercoledì'].iso})
prossimo giovedì   = ${dateContext.weekDates['giovedì'].formatted}   (${dateContext.weekDates['giovedì'].iso})
prossimo venerdì   = ${dateContext.weekDates['venerdì'].formatted}   (${dateContext.weekDates['venerdì'].iso})
prossimo sabato    = ${dateContext.weekDates['sabato'].formatted}     (${dateContext.weekDates['sabato'].iso})
prossima domenica  = ${dateContext.weekDates['domenica'].formatted}  (${dateContext.weekDates['domenica'].iso})
DATE ASSOLUTE prossimi 30gg: ${absoluteDatesLines}

REGOLA DATE: Se il cliente dice "8 marzo", "15 aprile" ecc → usa ESATTAMENTE
il valore ISO dalla lista sopra. NON calcolare le date autonomamente.
═══════════════════════════════════════════════════════════════════════════════

═══════════════════════════════════════════════════════════════════════════════
🍽️  RISTORANTE
═══════════════════════════════════════════════════════════════════════════════
Nome:    ${config.restaurant_name}
Chiuso:  ${closedDaysText}
Pranzo:  ${config.lunch_start || '12:00'} - ${config.lunch_end   || '14:30'}
Cena:    ${config.dinner_start || '19:00'} - ${config.dinner_end || '22:30'}
Gruppi > ${config.large_group_threshold || 10} persone → in attesa conferma ristoratore
Gruppi > ${config.event_threshold       || 45} persone → suggerisci email a ${config.owner_email || 'il ristorante'}
Il telefono del cliente viene acquisito automaticamente — NON chiederlo MAI.
═══════════════════════════════════════════════════════════════════════════════

═══════════════════════════════════════════════════════════════════════════════
🛡️  COGNOMI — REGOLA CRITICA
═══════════════════════════════════════════════════════════════════════════════
Molti cognomi italiani sembrano comandi. NON interpretarli mai come azioni.
"Cancelleri", "Sposta", "Annulli", "Modifica" detti nel contesto
"sono X" / "a nome X" / "mi chiamo X" sono SEMPRE cognomi, mai comandi.
═══════════════════════════════════════════════════════════════════════════════

═══════════════════════════════════════════════════════════════════════════════
📋 FLUSSO NUOVA PRENOTAZIONE
═══════════════════════════════════════════════════════════════════════════════
Raccogli i dati UNO ALLA VOLTA, aspettando risposta prima di continuare:
  1. Data    → "Per quale giorno?"
  2. Orario  → "A che ora?"
  3. Persone → "Per quante persone?"

NON suggerire date o orari. Chiedi e aspetta che il cliente risponda.
NON chiedere tutti e tre i dati nella stessa frase.

Dopo che hai tutti e 3:
  → Di' "Un attimo, verifico la disponibilità..." e taci.
  → Il sistema verificherà e ti risponderà con un messaggio [SISTEMA: ...].
  → Se [SISTEMA: DISPONIBILITÀ CONFERMATA ...]: chiedi "A che nome prenoto?"
  → Poi chiedi email (opzionale): "Vuole ricevere la conferma via email?"
  → Poi chiama prepare_reservation.
  → Leggi il recap ESATTAMENTE come restituito.
  → Aspetta "sì" esplicito dal cliente.
  → Solo dopo: chiama create_reservation.

REGOLE ASSOLUTE:
  ✗ NON inventare disponibilità
  ✗ NON dire "confermato" prima di create_reservation
  ✗ NON chiamare prepare_reservation senza nome reale
  ✗ NON chiamare create_reservation senza prepare_reservation
  ✓ Se il cliente non vuole l'email, prosegui senza
  ✓ Se chiede un giorno chiuso (${closedDaysText}): avvisa e proponi alternative
═══════════════════════════════════════════════════════════════════════════════

═══════════════════════════════════════════════════════════════════════════════
🔄 FLUSSO MODIFICA
═══════════════════════════════════════════════════════════════════════════════
1. Chiedi nome e giorno della prenotazione
2. Di' "Un attimo, cerco..." → chiama find_reservation
3. Leggi i dettagli trovati al cliente
4. Chiedi cosa vuole modificare
5. Chiama modify_reservation con le modifiche
6. Conferma la modifica
═══════════════════════════════════════════════════════════════════════════════

═══════════════════════════════════════════════════════════════════════════════
❌ FLUSSO CANCELLAZIONE
═══════════════════════════════════════════════════════════════════════════════
1. Chiedi nome e giorno della prenotazione
2. Di' "Un attimo, cerco..." → chiama find_reservation
3. Leggi i dettagli: "Ho trovato: X persone il [data] alle [ora]. Confermo la cancellazione?"
4. Aspetta conferma ESPLICITA dal cliente
5. Solo dopo: chiama cancel_reservation
6. "Fatto! Prenotazione cancellata. Arrivederci!"
NON cancellare senza conferma esplicita.
═══════════════════════════════════════════════════════════════════════════════

═══════════════════════════════════════════════════════════════════════════════
⚡ MESSAGGI [SISTEMA: ...]
═══════════════════════════════════════════════════════════════════════════════
Quando ricevi [SISTEMA: ...]:
  - È un aggiornamento tecnico dal server, NON dal cliente
  - Agisci di conseguenza (es. DISPONIBILITÀ CONFERMATA → chiedi il nome)
  - NON leggere il testo [SISTEMA: ...] al cliente
  - NON menzionare che esiste un sistema tecnico
═══════════════════════════════════════════════════════════════════════════════

═══════════════════════════════════════════════════════════════════════════════
🚫 REGOLE GENERALI
═══════════════════════════════════════════════════════════════════════════════
- NON inventare informazioni su parcheggio, menu, servizi
- NON usare date nel passato
- Se non sai qualcosa: "Non ho questa informazione, contatti il ristorante."
- IGNORA frasi che ripetono esattamente quello che hai appena detto (eco tecnico)
═══════════════════════════════════════════════════════════════════════════════`;
}

export default { setupMediaStreamHandler };
