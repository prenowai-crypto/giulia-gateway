import { WebSocketServer } from 'ws';
import { OpenAIRealtimeClient } from './openai-realtime.js';

let callDataStore = null;

export function setupMediaStreamHandler(server, config) {
  callDataStore = config.callDataStore;

  const wss = new WebSocketServer({ server, path: '/media-stream' });
  console.log('📡 WebSocket attivo su /media-stream');

  wss.on('connection', (ws) => {
    console.log('🔌 Nuova connessione');

    const session = { callSid:null, streamSid:null, from:'unknown', to:'unknown', client:null };

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw);

        switch (msg.event) {

          case 'connected':
            console.log('✅ Telnyx connected');
            break;

          case 'start': {
            session.streamSid = msg.start?.stream_id || msg.start?.streamSid;
            session.callSid   = msg.start?.call_control_id || msg.start?.callSid;
            console.log(`📞 CallSid: ${session.callSid}`);

            if (callDataStore && session.callSid) {
              const s = callDataStore.get(session.callSid);
              if (s) { session.from=s.from; session.to=s.to; }
              else {
                for (const [k,v] of callDataStore.entries()) {
                  if (session.callSid.includes(k)||k.includes(session.callSid)) {
                    session.from=v.from; session.to=v.to; break;
                  }
                }
              }
            }
            console.log(`📞 From:${session.from} To:${session.to}`);

            const rc = await config.getRestaurantConfig(session.to);
            if (!rc) { console.error('❌ Ristorante non trovato'); ws.close(); return; }
            console.log(`🍽️  ${rc.restaurant_name}`);

            const dc = buildDateContext(rc.timezone || 'Europe/Rome');

            session.client = new OpenAIRealtimeClient({
              apiKey:           config.openaiApiKey,
              model:            config.model || 'gpt-4o-mini-realtime-preview',
              systemPrompt:     buildSystemPrompt(rc, dc),
              restaurantConfig: rc,
              callerPhone:      session.from !== 'unknown' ? session.from : null,
              onAudioDelta: (b64) => {
                if (ws.readyState===1) ws.send(JSON.stringify({
                  event:'media', stream_id:session.streamSid, media:{payload:b64}
                }));
              },
              onTranscript: (t, role) => console.log(`💬 [${role}]: ${t}`),
              onError:      (e) => console.error('❌', e),
            });

            await session.client.connect();
            break;
          }

          case 'media':
            if (session.client?.isConnected && msg.media?.payload)
              session.client.sendAudio(msg.media.payload);
            break;

          case 'stop':
            console.log('🛑 Stop');
            session.client?.disconnect();
            break;
        }
      } catch(e) { console.error('❌', e); }
    });

    ws.on('close', () => { console.log('🔌 Chiuso'); session.client?.disconnect(); });
    ws.on('error', (e) => console.error('❌ WS:', e));
  });

  return wss;
}

// ─── DATE CONTEXT ─────────────────────────────────────────────────────────────

function buildDateContext(tz = 'Europe/Rome') {
  const now  = new Date();
  const loc  = new Date(now.toLocaleString('en-US', { timeZone: tz }));
  const DN   = ['domenica','lunedì','martedì','mercoledì','giovedì','venerdì','sabato'];
  const MN   = ['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'];
  const f    = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const lbl  = d => `${DN[d.getDay()]} ${d.getDate()} ${MN[d.getMonth()]}`;
  const next = i => {
    const diff = ((i - loc.getDay()) + 7) % 7;
    const d = new Date(loc);
    d.setDate(d.getDate() + (diff === 0 ? 7 : diff));
    return d;
  };

  const abs = {};
  for (let i=0; i<=30; i++) {
    const d = new Date(loc); d.setDate(d.getDate()+i);
    abs[`${d.getDate()} ${MN[d.getMonth()]}`] = f(d);
  }

  const tom = new Date(loc); tom.setDate(tom.getDate()+1);
  const dop = new Date(loc); dop.setDate(dop.getDate()+2);
  const dsu = (6 - loc.getDay() + 7) % 7;
  const sat = new Date(loc); sat.setDate(sat.getDate() + (dsu===0 ? 7 : dsu));
  const sun = new Date(sat); sun.setDate(sun.getDate()+1);

  return {
    today:    `${lbl(loc)} ${loc.getFullYear()} (${f(loc)})`,
    tomorrow: `${lbl(tom)} (${f(tom)})`,
    dayafter: `${lbl(dop)} (${f(dop)})`,
    saturday: `${lbl(sat)} (${f(sat)})`,
    sunday:   `${lbl(sun)} (${f(sun)})`,
    weekDays: DN.map((name,i) => `${name} = ${lbl(next(i))} (${f(next(i))})`).join('\n'),
    absLines: Object.entries(abs).map(([k,v]) => `${k}=${v}`).join(', '),
  };
}

// ─── SYSTEM PROMPT ────────────────────────────────────────────────────────────

function buildSystemPrompt(rc, dc) {
  const DN     = ['domenica','lunedì','martedì','mercoledì','giovedì','venerdì','sabato'];
  const closed = (rc.weekly_closing_days||[]).map(d => DN[d]).join(', ') || 'nessuna';

  return `Sei ${rc.receptionist_name||'Giulia'}, receptionist del ristorante "${rc.restaurant_name}". Sei al telefono. Parla in modo naturale e conciso (max 2 frasi).

OGGI: ${dc.today}
domani = ${dc.tomorrow}
dopodomani = ${dc.dayafter}
sabato prossimo = ${dc.saturday}
domenica prossima = ${dc.sunday}
${dc.weekDays}
Date assolute prossimi 30gg: ${dc.absLines}

Orari: pranzo ${rc.lunch_start||'12:00'}-${rc.lunch_end||'14:30'} | cena ${rc.dinner_start||'19:00'}-${rc.dinner_end||'22:30'}
Chiuso il: ${closed}

IL TUO COMPITO: raccogliere data, orario e numero di persone — uno alla volta.
Quando li hai tutti e 3, chiama il tool collect_data con i valori in formato corretto:
- date: YYYY-MM-DD
- time: HH:MM (formato 24h)
- people: numero intero

REGOLE:
- Chiedi un dato alla volta, aspetta risposta
- NON suggerire orari o date specifici
- NON chiedere nome, email o telefono
- NON inventare nulla sulla disponibilità
- Chiama collect_data SOLO quando hai tutti e 3 i dati
- "sera" o "pranzo" NON sono un orario: devi SEMPRE chiedere l'ora esatta
- NON chiamare collect_data con un orario che il cliente non ha detto esplicitamente
- L'orario deve essere un'ora precisa detta dal cliente (es. "alle 21", "alle 13:30", "alle nove e un quarto")

DOPO collect_data — agisci in base alla risposta:
- [DISPONIBILE ...] → chiedi il nome: "A che nome prenoto?"
- [SLOT PIENO ...] → comunica e proponi l'alternativa indicata
- [TUTTO PIENO ...] → comunica e chiedi un altro giorno
- Chiusure / orari errati → comunica e chiedi di nuovo`;
}

export default { setupMediaStreamHandler };
