// ═══════════════════════════════════════════════════════════════════════════════
// OPENAI REALTIME CLIENT — GIULIA v1 MULTI-TENANT (Fase 1)
// ═══════════════════════════════════════════════════════════════════════════════
// Il client riceve dal media-stream:
//   - from: numero chiamante (per il find_reservation e il create)
//   - to:   numero chiamato Telnyx (già usato per il Registry lookup)
//   - restaurantConfig: oggetto restituito da registry.getConfigForNumber(to)
//
// Se restaurantConfig è null (numero non nel Registry), Giulia risponde con
// un messaggio educato di scuse e chiude. Non tenta di gestire prenotazioni.
//
// TUTTE le info nel prompt (nome ristorante, orari, chiusure, soglia gruppo,
// nome receptionist) e l'URL Apps Script sono letti da restaurantConfig.
// Niente hardcoded specifico di ristorante.
// ═══════════════════════════════════════════════════════════════════════════════

import WebSocket from 'ws';

console.log('🟢 openai-realtime.js GIULIA-v1-MT-2026-07-12 caricato');

const REALTIME_MODEL = process.env.REALTIME_MODEL || 'gpt-realtime-mini';
const REALTIME_URL   = `wss://api.openai.com/v1/realtime?model=${REALTIME_MODEL}`;

// ─── COSTANTI CONVERSAZIONALI (non config di ristorante) ─────────────────────
const DAY_NAMES_IT = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];

// ─── PROMPT BUILDER DINAMICO ─────────────────────────────────────────────────
function buildInstructions({ from, todayISO, todayHuman, restaurantConfig }) {
  // Caso fallback: numero non nel Registry
  if (!restaurantConfig) {
    return `Sei un assistente vocale. Il sistema non ha una configurazione per questo numero.
All'inizio della chiamata dici cortesemente in italiano:
"Buongiorno, mi dispiace ma questo servizio al momento non è attivo per questo numero. Ti invito a contattare direttamente il ristorante. Buona giornata."
Poi rimani cordiale ma non fornire altre informazioni e non prendere prenotazioni.`;
  }

  // Caso fallback: ristorante trovato ma non attivo
  if (!restaurantConfig.active) {
    return `Sei ${restaurantConfig.receptionistName || 'Giulia'}. Il ristorante ${restaurantConfig.restaurantName} risulta non attivo al momento.
All'inizio della chiamata dici cortesemente in italiano:
"Buongiorno, sono ${restaurantConfig.receptionistName || 'Giulia'} di ${restaurantConfig.restaurantName}. Mi dispiace ma il servizio prenotazioni è momentaneamente sospeso. Ti invito a richiamare più tardi o a contattare direttamente il ristorante. Grazie."
Poi non prendere prenotazioni.`;
  }

  const {
    receptionistName,
    restaurantName,
    lunchStart, lunchEnd,
    dinnerStart, dinnerEnd,
    closedDays, lunchClosedDays, dinnerClosedDays,
    largeGroupThreshold,
  } = restaurantConfig;

  // ─── Costruisci descrizione chiusure in italiano ──────────────────────────
  const closureLines = [];

  if (closedDays.length > 0) {
    const names = closedDays.map(d => DAY_NAMES_IT[d]).filter(Boolean);
    closureLines.push(`- ${capitalizeFirst(names.join(', il '))}: chiuso tutto il giorno`);
  }

  const lunchOnlyClosed = lunchClosedDays.filter(d => !closedDays.includes(d));
  if (lunchOnlyClosed.length > 0) {
    const names = lunchOnlyClosed.map(d => DAY_NAMES_IT[d]).filter(Boolean);
    closureLines.push(`- ${capitalizeFirst(names.join(', il '))}: chiuso a pranzo, aperto a cena`);
  }

  const dinnerOnlyClosed = dinnerClosedDays.filter(d => !closedDays.includes(d));
  if (dinnerOnlyClosed.length > 0) {
    const names = dinnerOnlyClosed.map(d => DAY_NAMES_IT[d]).filter(Boolean);
    closureLines.push(`- ${capitalizeFirst(names.join(', il '))}: chiuso a cena, aperto a pranzo`);
  }

  const closuresText = closureLines.length > 0
    ? closureLines.join('\n')
    : '- Aperti tutti i giorni';

  const phoneKnown = from && from.length > 3;

  return `Sei ${receptionistName}, receptionist di ${restaurantName}.

ORARI DI APERTURA
- Pranzo: ${lunchStart} – ${lunchEnd}
- Cena: ${dinnerStart} – ${dinnerEnd}

CHIUSURE SETTIMANALI
${closuresText}

OGGI è ${todayHuman} (${todayISO}).

TELEFONO DEL CHIAMANTE
${phoneKnown
  ? `- Il numero del chiamante è già noto al sistema (${from}). NON chiederlo mai al cliente.`
  : `- Il numero del chiamante NON è disponibile automaticamente. Se serve confermarlo, chiedilo con calma.`}

STILE VOCE
- Frasi brevi, 5-15 parole. Naturale, cordiale, professionale.
- Una domanda alla volta.
- Se non capisci, chiedi di ripetere una cosa specifica ("scusa, per quante persone?").
- NON leggere i numeri di telefono come cifre unite, scandiscili con pause.
- NON inventare informazioni che non hai (menu specifici, allergie, parcheggio, ecc.). Se ti chiedono qualcosa che non sai, dì: "questa informazione non ce l'ho, ti conviene contattare direttamente il ristorante".

COSA SAI FARE
Puoi gestire tre operazioni tramite le funzioni disponibili:
1. Creare una nuova prenotazione (create_reservation)
2. Modificare una prenotazione esistente (modify_reservation)
3. Cancellare una prenotazione esistente (cancel_reservation)

Per modificare o cancellare, prima usa find_reservation per trovare le prenotazioni del cliente (il sistema cerca automaticamente per numero di telefono).

FLUSSO CREATE
1. Saluta e chiedi come puoi aiutare.
2. Se il cliente vuole prenotare, raccogli in ordine: giorno, orario, numero persone, nome.
3. Verifica mentalmente che il giorno non sia una chiusura settimanale (vedi sopra). Se lo è, spiegalo e proponi un giorno alternativo PRIMA di chiamare la funzione.
4. Se tutto ok, chiama create_reservation.
5. Alla risposta: se success=true, conferma con una frase breve ("Perfetto Marco, ti aspettiamo giovedì alle 21 per 4 persone").
6. Se lo slot non è disponibile o il ristorante è chiuso quel giorno, spiega e proponi alternative.

FLUSSO FIND + MODIFY / CANCEL
1. Se il cliente dice "vorrei modificare/spostare/cancellare la mia prenotazione", chiama SUBITO find_reservation (senza chiedere il telefono, ce l'hai già).
2. Se trova una sola prenotazione, riepilogala ("Ho trovato la tua prenotazione per venerdì alle 21 per 3 persone. Cosa vuoi cambiare?").
3. Se ne trova più di una, chiedi quale (per data).
4. Se non trova nulla, chiedi il nome con cui era stata fatta e riprova con find_reservation passando il nome.
5. Per modificare: raccogli i nuovi dati e chiama modify_reservation. Passa SOLO i campi cambiati (gli altri lasciali vuoti/null).
6. Per cancellare: chiedi conferma esplicita ("Confermi che vuoi cancellare la prenotazione di venerdì alle 21?"), poi chiama cancel_reservation.

GRUPPI GRANDI
- Per gruppi di più di ${largeGroupThreshold} persone, procedi con la prenotazione ma avvisa: "per gruppi sopra le ${largeGroupThreshold} persone la prenotazione è soggetta a conferma del ristorante, ti richiameranno per confermare".

DATE
- "Oggi" = ${todayISO}. "Domani" = il giorno successivo, e così via.
- Se il cliente dice solo l'ora senza specificare "pranzo" o "cena", chiedi.
- "Alle 8" senza contesto sono le 20:00 (cena), ma conferma sempre.
- Formato data per le funzioni: YYYY-MM-DD. Formato ora: HH:MM (24h).

Inizia salutando con: "${restaurantName} buongiorno, sono ${receptionistName}, come posso aiutarti?"`;
}

function capitalizeFirst(s) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── TOOL DEFINITIONS ────────────────────────────────────────────────────────
const TOOLS = [
  {
    type: 'function',
    name: 'create_reservation',
    description: 'Crea una nuova prenotazione. Usa solo quando hai raccolto giorno, orario, numero persone e nome. Il numero di telefono viene aggiunto automaticamente dal sistema.',
    parameters: {
      type: 'object',
      properties: {
        date:   { type: 'string', description: 'Data in formato YYYY-MM-DD' },
        time:   { type: 'string', description: 'Ora in formato HH:MM (24h)' },
        people: { type: 'integer', description: 'Numero di persone', minimum: 1 },
        name:   { type: 'string', description: 'Nome del cliente (nome o nome+cognome)' },
      },
      required: ['date', 'time', 'people', 'name'],
    },
  },
  {
    type: 'function',
    name: 'find_reservation',
    description: 'Cerca prenotazioni esistenti. Usalo per modifiche o cancellazioni prima di chiedere altri dettagli. La ricerca usa automaticamente il numero del chiamante. Passa il nome solo se il cliente lo specifica esplicitamente (es. "l\'ho fatta a nome Marco").',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Nome del cliente sotto cui è la prenotazione (opzionale)' },
      },
      required: [],
    },
  },
  {
    type: 'function',
    name: 'modify_reservation',
    description: 'Modifica una prenotazione esistente. Chiama find_reservation prima. Passa solo i campi che il cliente vuole cambiare (gli altri come null).',
    parameters: {
      type: 'object',
      properties: {
        original_date: { type: 'string', description: 'Data originale della prenotazione da modificare (YYYY-MM-DD)' },
        original_time: { type: 'string', description: 'Ora originale della prenotazione da modificare (HH:MM)' },
        new_date:      { type: ['string', 'null'], description: 'Nuova data YYYY-MM-DD, oppure null se non cambia' },
        new_time:      { type: ['string', 'null'], description: 'Nuova ora HH:MM, oppure null se non cambia' },
        new_people:    { type: ['integer', 'null'], description: 'Nuovo numero persone, oppure null se non cambia' },
        name:          { type: 'string', description: 'Nome del cliente' },
      },
      required: ['original_date', 'name'],
    },
  },
  {
    type: 'function',
    name: 'cancel_reservation',
    description: 'Cancella una prenotazione esistente. Chiama find_reservation prima e chiedi conferma esplicita al cliente prima di usarla.',
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Data della prenotazione da cancellare (YYYY-MM-DD)' },
        name: { type: 'string', description: 'Nome del cliente sotto cui è la prenotazione' },
      },
      required: ['date', 'name'],
    },
  },
];

// ─── HELPER DATA ODIERNA (fuso Europe/Rome) ──────────────────────────────────
function todayInRome() {
  const now = new Date();
  const romeStr = now.toLocaleString('it-IT', {
    timeZone: 'Europe/Rome',
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  const yyyy = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric' }).format(now);
  const mm   = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', month: '2-digit' }).format(now);
  const dd   = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', day: '2-digit' }).format(now);
  return { todayISO: `${yyyy}-${mm}-${dd}`, todayHuman: romeStr };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLIENT
// ═══════════════════════════════════════════════════════════════════════════════

export class OpenAIRealtimeClient {
  constructor(opts = {}) {
    this.apiKey           = opts.apiKey;
    this.onAudioDelta     = opts.onAudioDelta || (() => {});
    this.connId           = opts.connId || '????????';
    this.from             = opts.from || '';
    this.to               = opts.to   || '';
    this.restaurantConfig = opts.restaurantConfig || null;
    this._ws              = null;
    this._sessionReady    = false;

    // Se non c'è config o è inattivo, i tools vengono disabilitati
    this._toolsEnabled = !!(this.restaurantConfig && this.restaurantConfig.active && this.restaurantConfig.appsScriptUrl);

    this._pendingCalls = new Map();
  }

  async connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(REALTIME_URL, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      });
      this._ws = ws;

      ws.once('open', () => {
        const rn = this.restaurantConfig?.restaurantName || '(no config)';
        console.log(`🎙️  [${this.connId}] Realtime WS aperta (model: ${REALTIME_MODEL}) — ristorante="${rn}"`);
        console.log(`📞 [${this.connId}] from=${this.from || '(unknown)'} to=${this.to || '(unknown)'} toolsEnabled=${this._toolsEnabled}`);
        this._sendSessionUpdate();
        resolve();
      });

      ws.on('message', (data) => this._onMessage(data));
      ws.on('error', (err) => console.error(`❌ [${this.connId}] Realtime WS error: ${err?.message}`));
      ws.on('close', (code) => {
        console.log(`🔴 [${this.connId}] Realtime WS chiusa (${code})`);
      });

      setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) reject(new Error('WS open timeout'));
      }, 10000);
    });
  }

  _sendSessionUpdate() {
    const { todayISO, todayHuman } = todayInRome();
    const instructions = buildInstructions({
      from: this.from,
      todayISO,
      todayHuman,
      restaurantConfig: this.restaurantConfig,
    });

    this._send({
      type: 'session.update',
      session: {
        type: 'realtime',
        instructions,
        tools: this._toolsEnabled ? TOOLS : [],
        tool_choice: this._toolsEnabled ? 'auto' : 'none',
        audio: {
          input: {
            format: { type: 'audio/pcma' },
            transcription: { model: 'gpt-realtime-whisper', language: 'it' },
            turn_detection: { type: 'semantic_vad', eagerness: 'high' },
          },
          output: {
            format: { type: 'audio/pcma' },
            voice: 'coral',
          },
        },
      },
    });
  }

  _onMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    switch (msg.type) {
      case 'session.created':
        console.log(`📋 [${this.connId}] session.created: ${msg.session?.id}`);
        break;

      case 'session.updated':
        if (!this._sessionReady) {
          this._sessionReady = true;
          console.log(`✅ [${this.connId}] session.updated → richiedo saluto iniziale`);
          this._send({ type: 'response.create' });
        }
        break;

      case 'conversation.item.input_audio_transcription.completed':
        if (msg.transcript) console.log(`💬 [${this.connId}] [user]: ${msg.transcript.trim()}`);
        break;

      case 'response.output_audio.delta':
        if (msg.delta) this.onAudioDelta(msg.delta);
        break;

      case 'response.output_audio_transcript.done':
        if (msg.transcript) console.log(`💬 [${this.connId}] [AI]: ${msg.transcript}`);
        break;

      case 'input_audio_buffer.speech_started':
        console.log(`🎙️  [${this.connId}] cliente: speech_started`);
        break;

      case 'input_audio_buffer.speech_stopped':
        console.log(`🎙️  [${this.connId}] cliente: speech_stopped`);
        break;

      case 'response.function_call_arguments.delta':
        this._accumulateCallArgs(msg);
        break;

      case 'response.function_call_arguments.done':
        this._handleFunctionCallDone(msg);
        break;

      case 'response.done':
        if (msg.response?.usage) {
          const u = msg.response.usage;
          console.log(`📊 [${this.connId}] tokens: total=${u.total_tokens} in=${u.input_tokens} out=${u.output_tokens}`);
        }
        break;

      case 'error':
        console.error(`❌ [${this.connId}] Realtime error:`, JSON.stringify(msg.error || msg));
        break;
    }
  }

  // ─── FUNCTION CALLS ──────────────────────────────────────────────────────
  _accumulateCallArgs(msg) {
    const callId = msg.call_id;
    if (!callId) return;
    if (!this._pendingCalls.has(callId)) {
      this._pendingCalls.set(callId, { name: msg.name || '', args_str: '' });
    }
    this._pendingCalls.get(callId).args_str += (msg.delta || '');
  }

  async _handleFunctionCallDone(msg) {
    const callId = msg.call_id;
    const name   = msg.name || this._pendingCalls.get(callId)?.name || '';
    const argsStr = msg.arguments || this._pendingCalls.get(callId)?.args_str || '{}';
    this._pendingCalls.delete(callId);

    let args = {};
    try { args = JSON.parse(argsStr); } catch (e) {
      console.error(`❌ [${this.connId}] function call ${name}: JSON parse fallito (${e.message})`);
    }

    console.log(`🛠️  [${this.connId}] tool call: ${name}(${JSON.stringify(args)})`);

    let output;
    try {
      output = await this._executeTool(name, args);
    } catch (err) {
      console.error(`❌ [${this.connId}] tool ${name} errore: ${err.message}`);
      output = { success: false, error: err.message };
    }

    console.log(`🛠️  [${this.connId}] tool result: ${JSON.stringify(output).substring(0, 300)}`);

    this._send({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: callId,
        output: JSON.stringify(output),
      },
    });
    this._send({ type: 'response.create' });
  }

  // ─── DISPATCH SULL'APPS SCRIPT DEL RISTORANTE ───────────────────────────
  async _executeTool(name, args) {
    if (!this._toolsEnabled) {
      return { success: false, error: 'tools_disabled_no_restaurant_config' };
    }

    switch (name) {
      case 'create_reservation':
        return this._callAppsScript({
          source:   'gateway',
          nome:     args.name,
          persone:  args.people,
          data:     args.date,
          ora:      this._normalizeTime(args.time),
          telefono: this.from,
        });

      case 'find_reservation':
        return this._callAppsScript({
          action:   'find_all_reservations',
          telefono: this.from,
          nome:     args.name || '',
        });

      case 'modify_reservation': {
        const payload = {
          action:   'update_reservation',
          source:   'gateway',
          nome:     args.name,
          telefono: this.from,
          data:     args.original_date,
          ora:      this._normalizeTime(args.original_time),
        };
        if (args.new_date)   payload.new_date   = args.new_date;
        if (args.new_time)   payload.new_time   = this._normalizeTime(args.new_time);
        if (args.new_people) payload.new_people = args.new_people;
        return this._callAppsScript(payload);
      }

      case 'cancel_reservation':
        return this._callAppsScript({
          action:   'cancel_reservation',
          source:   'gateway',
          nome:     args.name,
          telefono: this.from,
          data:     args.date,
        });

      default:
        return { success: false, error: `Tool sconosciuto: ${name}` };
    }
  }

  _normalizeTime(t) {
    if (!t) return t;
    return t.length === 5 ? `${t}:00` : t;
  }

  async _callAppsScript(payload) {
    const url = this.restaurantConfig?.appsScriptUrl;
    if (!url) {
      return { success: false, error: 'apps_script_url_mancante' };
    }
    console.log(`🌐 [${this.connId}] → Apps Script (${this.restaurantConfig.restaurantName}): ${JSON.stringify(payload).substring(0, 300)}`);
    const response = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
      signal:  AbortSignal.timeout(15000),
    });
    const text = await response.text();
    let result;
    try { result = JSON.parse(text); }
    catch { result = { raw: text.substring(0, 500) }; }
    return result;
  }

  // ─── AUDIO IN ────────────────────────────────────────────────────────────
  sendAudio(pcmuBase64) {
    if (this._ws?.readyState !== WebSocket.OPEN) return;

    if (!this._stats) this._stats = { chunks: 0, bytes: 0, lastLog: Date.now() };
    this._stats.chunks++;
    this._stats.bytes += pcmuBase64.length;
    const now = Date.now();
    if (now - this._stats.lastLog >= 2000) {
      console.log(`🎤 [${this.connId}] audio IN (ultimi 2s): ${this._stats.chunks} chunk, ${this._stats.bytes} byte`);
      this._stats = { chunks: 0, bytes: 0, lastLog: now };
    }

    this._send({ type: 'input_audio_buffer.append', audio: pcmuBase64 });
  }

  close() {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      try { this._ws.close(1000); } catch {}
    }
  }

  _send(event) {
    if (this._ws?.readyState !== WebSocket.OPEN) return;
    try { this._ws.send(JSON.stringify(event)); }
    catch (e) { console.error(`❌ [${this.connId}] WS send: ${e?.message}`); }
  }
}
