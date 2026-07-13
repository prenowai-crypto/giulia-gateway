// ═══════════════════════════════════════════════════════════════════════════════
// PRENOW REALTIME v7.2 — SPEECH-TO-SPEECH (gpt-realtime-mini) MULTI-TENANT
// ═══════════════════════════════════════════════════════════════════════════════
// Cambiamenti v7.2 rispetto a v7.1 (dai test T01-T20 del 13/07):
//
// PROMPT
//   - Regola "PRIMA CHIAMA POI PARLA": il modello DEVE chiamare il tool
//     prima di dire "registrata"/"confermata" (fix T17, T18 — bug gravissimo:
//     in T18 il modello diceva "ho registrato la richiesta" senza mai chiamare
//     richiedi_evento, illudendo il cliente).
//   - Memoria contesto rafforzata con esempio concreto: se cliente cambia
//     solo il giorno, riusa ora/persone/nome già raccolti (fix T05).
//   - Regola no placeholder testuali tipo "[nome del cliente]" (fix T11).
//   - Regola no orario assunto: se cliente dice solo "sera"/"pranzo" senza
//     un'ora precisa, chiedi (fix T19).
//   - Regola orari/giorni: per queste domande usa la tabella settimanale del
//     prompt — NON chiamare info_locale (fix T06).
//   - Regola filler nella stessa response del tool call.
//   - Regola contatto: spiega che chiamerà al numero visualizzato.
//
// SCHEMA
//   - richiedi_evento: aggiunto `email` opzionale per contatto evento.
// ═══════════════════════════════════════════════════════════════════════════════

import WebSocket from 'ws';
import { DateManager, TimeManager, PeopleManager, IntentDetector,
         ValidationPipeline, isConfirming, isDenying } from './parsers.js';

export { DateManager, TimeManager, PeopleManager, IntentDetector,
         ValidationPipeline, isConfirming, isDenying };

console.log('🟢 openai-realtime.js GIULIA-v7.2-MT-2026-07-13 caricato');

const REALTIME_MODEL = process.env.REALTIME_MODEL || 'gpt-realtime-mini';
const REALTIME_URL   = `wss://api.openai.com/v1/realtime?model=${REALTIME_MODEL}`;

// ═══════════════════════════════════════════════════════════════════════════════
// LE 7 FUNZIONI
// ═══════════════════════════════════════════════════════════════════════════════

const FUNCTIONS = [
  {
    type: 'function',
    name: 'trova_prenotazione',
    description: 'Cerca una prenotazione esistente dato il nome fornito dal cliente e, opzionalmente, una data. Il telefono del chiamante è aggiunto automaticamente dal sistema.',
    parameters: {
      type: 'object',
      properties: {
        nome: { type: 'string', description: 'Nome o cognome sulla prenotazione' },
        data: { type: 'string', description: "Data indicata dal cliente, ad esempio 'sabato' o 'domani'. Opzionale." },
      },
      required: ['nome', 'data'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'controlla_disponibilita',
    description: "Verifica disponibilità per data+ora+persone. Esiti: libero (procedi crea_prenotazione), gruppo_grande (procedi crea_prenotazione, sarà PENDING), evento (usa richiedi_evento), giorno_chiuso, solo_cena, solo_pranzo, fuori_orario, pieno, manca_*.",
    parameters: {
      type: 'object',
      properties: {
        data:    { type: 'string',  description: "Data come detta dal cliente, es. 'sabato', 'domani'" },
        ora:     { type: 'string',  description: "Ora come detta dal cliente, es. 'alle 21', 'nove e mezza'" },
        persone: { type: 'integer', description: 'Numero totale di persone' },
      },
      required: ['data', 'ora', 'persone'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'crea_prenotazione',
    description: "Crea una nuova prenotazione. Chiamare dopo controlla_disponibilita con esito 'libero' o 'gruppo_grande'. Passa il nome ESATTO. Mai 'Cliente' o placeholder.",
    parameters: {
      type: 'object',
      properties: {
        nome:    { type: 'string',  description: 'Nome del cliente esattamente come pronunciato e confermato' },
        data:    { type: 'string',  description: "Data come detta dal cliente" },
        ora:     { type: 'string',  description: "Ora come detta dal cliente" },
        persone: { type: 'integer', description: 'Numero di persone' },
        note:    { type: 'string',  description: 'Note (allergie, seggiolone, compleanno). "" se nessuna.' },
      },
      required: ['nome', 'data', 'ora', 'persone', 'note'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'modifica_prenotazione',
    description: 'Modifica una prenotazione esistente. Chiamare dopo trova_prenotazione. Passa "" o 0 per i campi che NON cambiano. La nota SOSTITUISCE, non aggiungere quella vecchia.',
    parameters: {
      type: 'object',
      properties: {
        nome:    { type: 'string',  description: 'Nuovo nome corretto. "" se non cambia.' },
        data:    { type: 'string',  description: 'Nuova data. "" se non cambia.' },
        ora:     { type: 'string',  description: 'Nuova ora. "" se non cambia.' },
        persone: { type: 'integer', description: 'Nuovo numero persone. 0 se non cambia.' },
        note:    { type: 'string',  description: 'Nota FINALE completa che sostituisce la precedente. "" se non cambia.' },
      },
      required: ['nome', 'data', 'ora', 'persone', 'note'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'cancella_prenotazione',
    description: 'Cancella la prenotazione trovata con trova_prenotazione dopo esplicita conferma del cliente.',
    parameters: {
      type: 'object',
      properties: {
        conferma: { type: 'string', description: "Passa 'ok' per confermare la cancellazione" },
      },
      required: ['conferma'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'info_locale',
    description: "Risponde a domande sul ristorante: menu, piatti, opzioni vegetariane/vegane/senza glutine, parcheggio, accessibilità, pagamenti, dehors, seggiolone, prezzi, coperto. NON per orari o giorni di apertura (quelli sono nella tabella settimanale del prompt).",
    parameters: {
      type: 'object',
      properties: {
        argomento: { type: 'string', description: "Cosa chiede il cliente: 'menu', 'vegano', 'parcheggio', 'coperto', 'accessibilità', ecc." },
      },
      required: ['argomento'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'richiedi_evento',
    description: "Registra una richiesta evento (persone ≥ event_threshold). SOLO dopo controlla_disponibilita esito 'evento'. Se il cliente fornisce un'email di contatto, passala.",
    parameters: {
      type: 'object',
      properties: {
        nome:    { type: 'string',  description: 'Nome del richiedente (mai placeholder)' },
        data:    { type: 'string',  description: "Data dell'evento come detta dal cliente" },
        ora:     { type: 'string',  description: "Ora dell'evento come detta dal cliente" },
        persone: { type: 'integer', description: "Numero di persone stimate" },
        note:    { type: 'string',  description: "Dettagli aggiuntivi. \"\" se nessuno." },
        email:   { type: 'string',  description: "Email di contatto se fornita dal cliente. \"\" se non fornita." },
      },
      required: ['nome', 'data', 'ora', 'persone', 'note', 'email'],
      additionalProperties: false,
    },
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// SYSTEM PROMPT — v7.2
// ═══════════════════════════════════════════════════════════════════════════════

const SYSTEM_PROMPT_TEMPLATE = `Act as {{RECEPTIONIST_NAME}}, the automated phone receptionist for {{RESTAURANT_NAME}}. Speak only Italian, warm and professional, sentences 5-20 words. Never invent details. Only confirm bookings/modifications/cancellations AFTER the tool returns success.

Today is {{TODAY_HUMAN}} ({{TODAY_ISO}}). Caller's phone (automatic): {{CALLER_PHONE}}.

# Weekly schedule — THIS IS THE ONLY SOURCE OF TRUTH for opening days/hours
{{WEEKLY_SCHEDULE}}

For ANY question about opening hours or opening days (e.g. "quando siete aperti?", "che orari fate?", "aprite il lunedì?", "quando siete aperti a pranzo?"), answer DIRECTLY from this weekly schedule. NEVER call info_locale for these questions — info_locale doesn't know the schedule.

At call start: "Salve, sono l'assistente vocale automatico di {{RESTAURANT_NAME}}, come posso aiutarla?" (EU AI Act requirement).

# 🔴 RULE #1 — TOOL FIRST, THEN SPEAK (CRITICAL)
NEVER announce an outcome ("registrata", "prenotato", "confermato", "aggiornato", "cancellato") before the corresponding tool has returned success. Sequence: (1) gather data, (2) call the tool, (3) WAIT for the tool result, (4) then speak.

WRONG (this happened in tests and misled the customer):
  Customer: "50 persone per il 20 agosto alle 21, sono Sara"
  AI: "Perfetto, ho registrato la richiesta." ← WRONG: tool never called
WRONG:
  Customer: "15 persone martedì alle 21, sono Luca"
  AI: "La prenotazione per il gruppo è registrata." ← WRONG: crea_prenotazione not called

RIGHT:
  Customer: "50 persone per il 20 agosto..."
  AI: [call controlla_disponibilita] → esito "evento"
  AI: "Perfetto, mi lascia un'email di contatto per l'evento?"
  Customer: "sara@mail.it"
  AI: [call richiedi_evento with email] → registrata:true
  AI: "Ho registrato la richiesta, il ristorante la contatterà a breve."

# 🔴 RULE #2 — NO TEXT PLACEHOLDERS (CRITICAL)
NEVER use bracketed placeholders like "[nome del cliente]", "[data]", "[X]", "{name}" in what you say. The customer hears them literally. If you don't have a value, don't mention it — ask for it or omit it. Example WRONG: "Confermi la prenotazione per [nome del cliente]?". Example RIGHT: "Confermi il suo nome?" or wait to have the name.

# 🔴 RULE #3 — NEVER ASSUME TIMES (CRITICAL)
If the customer says only "sera", "cena", "pranzo" WITHOUT a specific time, ASK for the exact time: "A che ora precisamente?". Do NOT default to 21, 20:30, or any other time silently. Wrong (happened in T19): customer says "venerdì sera per 4" → AI says "confermo venerdì alle 21 per 4" (invented 21). Right: AI says "A che ora precisamente venerdì sera?".

# 🔴 RULE #4 — CONTEXT MEMORY (CRITICAL)
Once the customer has given you time, people, name, or notes — REMEMBER them across the whole conversation. If they change ONLY the day, reuse everything else. Example:
  Customer: "lunedì alle 21:30 per 2" → AI checks, day closed → "Le va martedì?"
  Customer: "sì martedì" → AI IMMEDIATELY calls controlla_disponibilita(martedì, 21:30, 2). Does NOT re-ask time or people.

# Tool call timing and filler
When you're about to call a tool, keep a very short natural filler in the SAME response as the tool call — not as a separate turn. Examples: "Un momento, controllo." + call controlla_disponibilita | "Un attimo, cerco la prenotazione." + call trova_prenotazione | "Sto registrando." + call crea_prenotazione. The filler and the call must be in ONE response, so there's no silent gap.

# CREATE flow
1. If customer said only the day: check the weekly schedule. If closed all day or closed for the meal they want (lunch/dinner), say so immediately and propose alternatives. Do NOT collect other data.
2. Gather remaining: date, time (ask if only "sera"/"pranzo"), people, name (spell if unclear).
3. Call controlla_disponibilita with a short filler in the same response.
4. Based on esito:
   - libero → call crea_prenotazione (with filler), then confirm success from tool result.
   - gruppo_grande (10-44 pax) → call crea_prenotazione (with filler). After result: "La prenotazione è registrata come richiesta di gruppo. Il ristorante la richiamerà al numero da cui chiama per confermare."
   - evento (45+ pax) → ask "Le lascia un'email di contatto per l'evento? La sua o preferisce essere richiamata al numero da cui chiama?". Then call richiedi_evento (with email if given, "" if not). After result: "Ho registrato la richiesta. Il ristorante la contatterà a breve per organizzare l'evento."
   - giorno_chiuso → apologize, propose alternative from weekly schedule.
   - solo_cena / solo_pranzo → tell customer, offer alternative meal or day.
   - fuori_orario → tell customer, propose valid time from weekly schedule.
   - pieno → tell customer; if alternative_stesso_giorno list them (max 3).
   - manca_data / manca_ora / manca_persone → ask the specific missing piece.
5. Before crea_prenotazione, recap: name + date + time + people + notes. Wait for customer confirmation.

# MODIFY / CANCEL flow
1. Ask the customer for the NAME on the reservation ("A che nome è la prenotazione?"). Even if the caller says "sono Marco" as introduction, confirm: "A che nome è registrata la prenotazione?".
2. Call trova_prenotazione (phone auto-added). If nome_diverso_dal_cercato is true, say: "Vedo una prenotazione a nome X collegata a questo numero — è la sua?".
3. If found: read back details. Ask what to change.
4. Modify: call modifica_prenotazione passing ONLY changed fields ("" or 0 for unchanged).
5. Nome correction: pass new name in modifica_prenotazione's "nome". Confirm with the NEW name.
6. Notes: compose the FINAL complete note yourself. The tool REPLACES the old note entirely (does not merge). If existing note is "vegano" and customer says "aggiungi compleanno", pass "vegano, compleanno".
7. Cancel: explicit confirmation, then cancella_prenotazione.

# Tone — you work for the restaurant
You are Giulia AT the restaurant. Say "il ristorante la contatterà", "la richiameremo al suo numero", "riceverà una conferma". NEVER say "restiamo in attesa", "dovremmo ricevere aggiornamenti".

# Contact for confirmations
When a reservation needs confirmation (gruppo_grande PENDING, evento), explain to the customer that the restaurant will call BACK at the number they're calling from ({{CALLER_PHONE}}). Don't ask for their phone — you already have it. For events, you CAN ask if they'd like to leave an email as additional contact.

# Info about the restaurant — only from info_locale (except opening schedule)
For questions about menu, dishes, vegan/vegetarian/gluten-free, parking, accessibility, payments, outdoor seating, cover charge, prices, cuisine, address, phone: call info_locale with the topic as argomento. Answer only with what info_locale returns. If not returned, say "questa informazione non ce l'ho, le consiglio di contattare direttamente il ristorante" — NEVER invent. NEVER invent whether SMS/email reminders are sent, promotions, discounts, dress code, atmosphere.

# Names on the phone
Never invent. If unsure (short, unusual, 8kHz PSTN): ask to spell letter by letter, repeat back, confirm. Pass exact confirmed name. "Cliente" is not a valid name.

# People number changes
For "aggiungi due", "uno in meno": do the math on the current people count in the found reservation.

# Dates and times
Pass the customer's wording directly to tools ("sabato", "domani", "alle 21", "nove e mezza"). The gateway normalizes. Don't convert dates yourself.

# Audio constraints
- 5-20 words per response, max 2 sentences.
- One question at a time.
- Yield after each answer unless waiting for tool result.

# On errors
If a tool returns "manca_X" or "creata: false, manca: X" or "registrata: false, manca: X" or "aggiornata: false" or "cancellata: false", ask for the specific missing piece. Never retry with invented values. If richiedi_evento returns registrata:false or crea_prenotazione returns creata:false without a missing field, tell the customer: "c'è stato un problema con la registrazione, la prego di chiamare direttamente il ristorante".

If the customer changes their mind mid-process, follow the new instruction.`;

const DAY_NAMES   = ['domenica','lunedì','martedì','mercoledì','giovedì','venerdì','sabato'];
const MONTH_NAMES = ['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'];

// ═══════════════════════════════════════════════════════════════════════════════
// CLIENT
// ═══════════════════════════════════════════════════════════════════════════════

export class OpenAIRealtimeClient {
  constructor(opts = {}) {
    this.apiKey           = opts.apiKey;
    this.restaurantConfig = opts.restaurantConfig || {};
    this.connId           = opts.connId || '????????';

    this.onAudioDelta = opts.onAudioDelta || (() => {});

    const raw = opts.callerPhone || opts.from || '';
    this.callerPhone = raw && !raw.startsWith('+') ? '+' + raw : raw;
    this.to = opts.to || '';

    this._ws               = null;
    this._sessionReady     = false;
    this._lastFound        = null;
    this._lastEventInfo    = null;
    this._restaurantInfo   = null;
    this._pendingCalls     = new Map();

    this._toolsEnabled = !!(
      this.restaurantConfig &&
      this.restaurantConfig.active !== false &&
      (this.restaurantConfig.apps_script_url || this.restaurantConfig.appsScriptUrl)
    );
  }

  async connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(REALTIME_URL, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      });
      this._ws = ws;

      ws.once('open', () => {
        const rn = this.restaurantConfig?.restaurant_name || this.restaurantConfig?.restaurantName || '(no config)';
        console.log(`🎙️  [${this.connId}] Realtime WS aperta (model: ${REALTIME_MODEL}) — ristorante="${rn}"`);
        console.log(`📞 [${this.connId}] callerPhone=${this.callerPhone || '(unknown)'} to=${this.to || '(unknown)'} toolsEnabled=${this._toolsEnabled}`);
        this._sendSessionUpdate();
        if (this._toolsEnabled) this._fetchRestaurantInfo();
        resolve();
      });

      ws.on('message', (data) => this._onMessage(data));
      ws.on('error', (err) => console.error(`❌ [${this.connId}] Realtime WS error: ${err?.message}`));
      ws.on('close', (code) => console.log(`🔴 [${this.connId}] Realtime WS chiusa (${code})`));

      setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) reject(new Error('WS open timeout'));
      }, 10000);
    });
  }

  _sendSessionUpdate() {
    const sessionConfig = {
      type: 'realtime',
      instructions: this._buildSystemPrompt(),
      tools: this._toolsEnabled ? FUNCTIONS : [],
      tool_choice: this._toolsEnabled ? 'auto' : 'none',
      audio: {
        input: {
          format: { type: 'audio/pcma' },
          transcription: { model: 'whisper-1' },
          turn_detection: {
            type: 'semantic_vad',
            eagerness: 'auto',
            create_response: true,
            interrupt_response: true,
          },
          noise_reduction: { type: 'far_field' },
        },
        output: {
          format: { type: 'audio/pcma' },
          voice: this.restaurantConfig?.voice || 'coral',
        },
      },
    };
    this._send({ type: 'session.update', session: sessionConfig });
  }

  _buildWeeklySchedule(rc) {
    const closedDays = String(rc.closed_days ?? '')
      .split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
    const lunchClosedDays = String(rc.lunch_closed_days ?? '')
      .split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
    const dinnerClosedDays = String(rc.dinner_closed_days ?? '')
      .split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));

    const ls = rc.lunch_start  || rc.lunchStart  || '12:00';
    const le = rc.lunch_end    || rc.lunchEnd    || '14:30';
    const ds = rc.dinner_start || rc.dinnerStart || '19:00';
    const de = rc.dinner_end   || rc.dinnerEnd   || '22:30';

    const lines = [];
    for (let d = 0; d < 7; d++) {
      const nameCap = DAY_NAMES[d].charAt(0).toUpperCase() + DAY_NAMES[d].slice(1);
      if (closedDays.includes(d)) { lines.push(`- ${nameCap}: CLOSED (all day)`); continue; }
      const lunchClosed  = lunchClosedDays.includes(d);
      const dinnerClosed = dinnerClosedDays.includes(d);
      if (lunchClosed && dinnerClosed) lines.push(`- ${nameCap}: CLOSED (all day)`);
      else if (lunchClosed)  lines.push(`- ${nameCap}: LUNCH CLOSED. Dinner only ${ds}-${de}`);
      else if (dinnerClosed) lines.push(`- ${nameCap}: DINNER CLOSED. Lunch only ${ls}-${le}`);
      else lines.push(`- ${nameCap}: Lunch ${ls}-${le}, Dinner ${ds}-${de}`);
    }
    return lines.join('\n');
  }

  _buildSystemPrompt() {
    const rc = this.restaurantConfig || {};

    if (!this._toolsEnabled) {
      const name = rc.restaurant_name || rc.restaurantName || '';
      const active = rc.active !== false;
      if (!name) {
        return `Sei un assistente vocale. Il sistema non ha una configurazione per questo numero.
Dì: "Buongiorno, mi dispiace ma questo servizio al momento non è attivo per questo numero. Ti invito a contattare direttamente il ristorante."
Non prendere prenotazioni.`;
      }
      if (!active) {
        return `Sei l'assistente vocale di ${name}. Il servizio prenotazioni è momentaneamente sospeso.
Dì: "Buongiorno, sono l'assistente vocale automatico di ${name}. Mi dispiace ma il servizio prenotazioni è momentaneamente sospeso. Ti invito a contattare direttamente il ristorante."
Non prendere prenotazioni.`;
      }
    }

    const now = DateManager.getNow();
    const todayHuman = `${DAY_NAMES[now.getDay()]} ${now.getDate()} ${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`;
    const todayIso   = DateManager.toISO(now);
    const weeklySchedule = this._buildWeeklySchedule(rc);

    return SYSTEM_PROMPT_TEMPLATE
      .replace(/\{\{RECEPTIONIST_NAME\}\}/g, rc.receptionist_name || rc.receptionistName || 'Giulia')
      .replace(/\{\{RESTAURANT_NAME\}\}/g,   rc.restaurant_name   || rc.restaurantName   || 'il ristorante')
      .replace(/\{\{TODAY_HUMAN\}\}/g,       todayHuman)
      .replace(/\{\{TODAY_ISO\}\}/g,         todayIso)
      .replace(/\{\{WEEKLY_SCHEDULE\}\}/g,   weeklySchedule)
      .replace(/\{\{CALLER_PHONE\}\}/g,      this.callerPhone || '(sconosciuto)');
  }

  _onMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw.toString()); }
    catch (e) { return console.error(`❌ [${this.connId}] JSON parse: ${e?.message}`); }

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
        if (msg.transcript) {
          const t = msg.transcript.trim();
          if (!this._isGarbage(t)) console.log(`💬 [${this.connId}] [user]: ${t}`);
        }
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
        this._handleFunctionCall(msg);
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

  _accumulateCallArgs(msg) {
    const callId = msg.call_id;
    if (!callId) return;
    if (!this._pendingCalls.has(callId)) this._pendingCalls.set(callId, { name: msg.name || '', args_str: '' });
    this._pendingCalls.get(callId).args_str += (msg.delta || '');
  }

  async _handleFunctionCall(msg) {
    const callId = msg.call_id;
    const name   = msg.name || this._pendingCalls.get(callId)?.name || '';
    const argsStr = msg.arguments || this._pendingCalls.get(callId)?.args_str || '{}';
    this._pendingCalls.delete(callId);

    let args = {};
    try { args = JSON.parse(argsStr); }
    catch (e) { console.error(`❌ [${this.connId}] args parse ${name}: ${e?.message}`); }

    console.log(`🔧 [${this.connId}] tool ${name}(${JSON.stringify(args)})`);

    let result;
    try { result = await this._execTool(name, args); }
    catch (e) {
      console.error(`❌ [${this.connId}] tool ${name} error: ${e?.message}`);
      result = { errore: e?.message || 'errore interno' };
    }

    console.log(`✅ [${this.connId}] tool result: ${JSON.stringify(result).substring(0, 250)}`);

    this._send({
      type: 'conversation.item.create',
      item: { type: 'function_call_output', call_id: callId, output: JSON.stringify(result) },
    });
    this._send({ type: 'response.create' });
  }

  async _execTool(name, args) {
    switch (name) {
      case 'trova_prenotazione':      return await this._toolTrova(args);
      case 'controlla_disponibilita': return await this._toolControlla(args);
      case 'crea_prenotazione':       return await this._toolCrea(args);
      case 'modifica_prenotazione':   return await this._toolModifica(args);
      case 'cancella_prenotazione':   return await this._toolCancella(args);
      case 'info_locale':             return await this._toolInfoLocale(args);
      case 'richiedi_evento':         return await this._toolRichiediEvento(args);
      default: return { errore: 'tool sconosciuto: ' + name };
    }
  }

  async _toolTrova({ nome, data }) {
    const cleanName = nome && String(nome).trim();
    const cleanDate = data && String(data).trim();
    if (!cleanName) return { trovata: false, motivo: 'manca:"nome"' };

    const phone   = this.callerPhone || '';
    const dateISO = cleanDate ? this._normDate(cleanDate) : null;
    const ok = (r) => r && r.name && r.date && r.name !== 'null' && r.date !== 'null';

    if (cleanName && dateISO) {
      const r = await this._callAppsScript({ action: 'find_reservation', nome: cleanName, data: dateISO, sheet: 'Prenotazioni' });
      if (r?.found && ok(r.reservation)) return this._foundResult(r.reservation, cleanName);
    }
    if (cleanName) {
      const r = await this._callAppsScript({ action: 'find_reservation', nome: cleanName, sheet: 'Prenotazioni' });
      if (r?.found && ok(r.reservation)) return this._foundResult(r.reservation, cleanName);
    }
    if (phone) {
      const r = await this._callAppsScript({ action: 'find_reservation', telefono: phone, sheet: 'Prenotazioni' });
      if (r?.found && ok(r.reservation)) return this._foundResult(r.reservation, cleanName);
    }
    return { trovata: false };
  }

  _foundResult(res, searchedName) {
    this._lastFound = res;
    const tn = res.time?.length === 5 ? res.time + ':00' : (res.time || '');
    return {
      trovata: true,
      eventId: res.eventId,
      nome:    res.name,
      data:    DateManager.formatForDisplay(res.date),
      ora:     TimeManager.formatForDisplay(tn),
      persone: res.people,
      note:    res.notes || 'nessuna',
      nome_diverso_dal_cercato: !!(searchedName && res.name && res.name.toLowerCase() !== String(searchedName).toLowerCase()),
    };
  }

  async _toolControlla({ data, ora, persone }) {
    const rc = this.restaurantConfig;
    const dateISO = this._normDate(data);
    const timeN   = this._normTime(ora);
    const ppl     = parseInt(persone, 10) || 0;

    if (!dateISO) return { esito: 'manca_data' };
    if (!timeN)   return { esito: 'manca_ora' };
    if (!ppl)     return { esito: 'manca_persone' };

    if (ValidationPipeline.getDayClosedMessage(dateISO, rc)) {
      return { esito: 'giorno_chiuso', giorno: DateManager.getDayName(dateISO) };
    }
    if (!ValidationPipeline.isValidTime(timeN, rc)) {
      return {
        esito: 'fuori_orario',
        pranzo: `${rc?.lunch_start || '12:00'}-${rc?.lunch_end || '14:30'}`,
        cena:   `${rc?.dinner_start || '19:00'}-${rc?.dinner_end || '22:30'}`,
      };
    }
    {
      const h = parseInt(timeN.split(':')[0], 10);
      if (h >= 10 && h <= 16 && ValidationPipeline.isLunchClosed(dateISO, rc))
        return { esito: 'solo_cena', giorno: DateManager.getDayName(dateISO) };
      if ((h >= 17 || h <= 3) && ValidationPipeline.isDinnerClosed(dateISO, rc))
        return { esito: 'solo_pranzo', giorno: DateManager.getDayName(dateISO) };
    }
    const eventTh = Number(rc?.event_threshold) || 45;
    const largeTh = Number(rc?.large_group_threshold) || 10;

    if (ppl >= eventTh) {
      this._lastEventInfo = { email: rc?.owner_email || '' };
      return { esito: 'evento' };
    }
    if (ppl > largeTh) return { esito: 'gruppo_grande' };

    const res = await this._callAppsScript({ action: 'check_availability', data: dateISO, ora: timeN, persone: ppl });
    if (res?.success || res?.reason === 'slot_available') return { esito: 'libero' };
    if (res?.reason === 'day_closed') return { esito: 'giorno_chiuso', giorno: DateManager.getDayName(dateISO) };
    if (res?.reason === 'slot_full') {
      const alts = await this._callAppsScript({ action: 'find_available_slots', data: dateISO, ora: timeN, persone: ppl });
      const sameDay = (alts?.availableSlots?.sameDay || [])
        .filter(s => ValidationPipeline.isValidTime(s.time, rc))
        .slice(0, 3).map(s => s.time.substring(0, 5));
      return { esito: 'pieno', alternative_stesso_giorno: sameDay };
    }
    return { esito: 'libero' };
  }

  async _toolCrea({ nome, data, ora, persone, note }) {
    const nomeOk = nome && String(nome).trim() &&
                   !/^(cliente|sconosciuto|n\.?d\.?|nome non fornito|non fornito)$/i.test(String(nome).trim());
    if (!nomeOk) return { creata: false, manca: 'nome' };

    const dateISO = this._normDate(data);
    const timeN   = this._normTime(ora);
    const ppl     = parseInt(persone, 10) || 0;
    if (!dateISO) return { creata: false, manca: 'data' };
    if (!timeN)   return { creata: false, manca: 'ora' };
    if (!ppl)     return { creata: false, manca: 'persone' };

    const tel = this.callerPhone || '';
    const r = await this._callAppsScript({
      source: 'telnyx', nome, persone: ppl, data: dateISO, ora: timeN,
      telefono: tel, notes: note || '', forceNew: true,
    });
    if (r?.success && r.eventId) {
      this._lastFound = { eventId: r.eventId, name: nome, date: dateISO, time: timeN, people: ppl, phone: tel, notes: note || '' };
      return {
        creata: true, stato: r.status || 'CONFIRMED',
        data: DateManager.formatForDisplay(dateISO),
        ora: TimeManager.formatForDisplay(timeN),
        persone: ppl,
      };
    }
    return { creata: false };
  }

  async _toolModifica({ nome, data, ora, persone, note }) {
    const base = this._lastFound;
    if (!base?.eventId) {
      return { aggiornata: false, motivo: 'prenotazione non identificata: usa prima trova_prenotazione' };
    }

    const hasNome = nome    != null && String(nome).trim()    !== '';
    const hasData = data    != null && String(data).trim()    !== '';
    const hasOra  = ora     != null && String(ora).trim()     !== '';
    const hasPpl  = persone != null && parseInt(persone, 10) > 0;
    const hasNote = note    != null && String(note).trim()    !== '';

    if (hasNome && /^(cliente|sconosciuto|n\.?d\.?|nome non fornito|non fornito)$/i.test(String(nome).trim())) {
      return { aggiornata: false, motivo: 'manca:"nome_valido"' };
    }

    const newNome   = hasNome ? String(nome).trim() : base.name;
    const newDate   = hasData ? this._normDate(data)  : base.date;
    const newTime   = hasOra  ? this._normTime(ora)   : (base.time?.length === 5 ? base.time + ':00' : base.time);
    const newPeople = hasPpl  ? parseInt(persone, 10) : base.people;
    const newNotes  = hasNote ? String(note).trim() : (base.notes || '');

    const r = await this._callAppsScript({
      action: 'update_reservation', eventId: base.eventId,
      nome: newNome, data: newDate, ora: newTime, persone: newPeople,
      telefono: base.phone || this.callerPhone || '', notes: newNotes,
    });
    if (r?.success !== false) {
      this._lastFound = { ...base, name: newNome, date: newDate, time: newTime, people: newPeople, notes: newNotes };
      return {
        aggiornata: true, nome: newNome,
        data: DateManager.formatForDisplay(newDate),
        ora: TimeManager.formatForDisplay(newTime),
        persone: newPeople,
        note: newNotes || 'nessuna',
      };
    }
    return { aggiornata: false };
  }

  async _toolCancella(_args) {
    const r = this._lastFound;
    if (!r?.name || !r?.date) return { cancellata: false, motivo: 'prenotazione non identificata: usa prima trova_prenotazione' };
    const tn = r.time?.length === 5 ? r.time + ':00' : (r.time || '');
    const res = await this._callAppsScript({
      action: 'cancel_reservation', nome: r.name, data: r.date, ora: tn,
      telefono: this.callerPhone || r.phone || '',
    });
    if (res?.success || res?.status === 'CANCELLED') return { cancellata: true };
    return { cancellata: false };
  }

  async _toolInfoLocale({ argomento }) {
    if (!this._restaurantInfo) await this._fetchRestaurantInfo();
    const info = this._restaurantInfo || {};
    const arg = String(argomento || '').toLowerCase().trim();

    const filtered = {};
    const wants = (keys) => keys.some(k => arg.includes(k));

    if (wants(['menu','piatti','primi','secondi','antipasti','dolci','specialità']))
      filtered.menu = info.menuDetails || info.menuText || null;
    if (wants(['vegan','vegetar']))          filtered.vegano        = info.vegan          || null;
    if (wants(['glutine','celiac','celia'])) filtered.senza_glutine = info.glutenFree     || null;
    if (wants(['parcheggio','parking']))     filtered.parcheggio    = info.parking        || null;
    if (wants(['accessib','disab','sedia','rotelle'])) filtered.accessibilita = info.accessibility || null;
    if (wants(['pag','carta','bancomat','contant']))   filtered.pagamenti     = info.paymentMethods || null;
    if (wants(['dehor','esterno','fuori','giardino','tavoli fuori'])) filtered.dehors = info.outdoorSeating || null;
    if (wants(['seggiolone','bambin']))      filtered.seggiolone    = info.highchair     || null;
    if (wants(['prezz','costo','quanto cost','coperto'])) filtered.prezzi = info.prices || null;
    if (wants(['cucina','tipo','specialit'])) filtered.cucina       = info.cuisine       || null;
    if (wants(['indirizz','dove','via']))    filtered.indirizzo    = info.address       || null;
    if (wants(['telefono','contatt','numero'])) filtered.telefono   = info.phone         || null;

    if (Object.keys(filtered).length === 0) {
      filtered.cucina     = info.cuisine || null;
      filtered.parcheggio = info.parking || null;
      filtered.vegano     = info.vegan   || null;
      filtered.pagamenti  = info.paymentMethods || null;
    }

    const out = {};
    for (const k of Object.keys(filtered)) if (filtered[k]) out[k] = filtered[k];

    if (Object.keys(out).length === 0) return { informazione_non_disponibile: true };
    return out;
  }

  // v7.2: aggiunto email opzionale
  async _toolRichiediEvento({ nome, data, ora, persone, note, email }) {
    const cleanName = nome && String(nome).trim();
    const isBadName = !cleanName ||
                      /^(cliente|sconosciuto|n\.?d\.?|nome non fornito|non fornito|anonimo)$/i.test(cleanName);
    if (isBadName) return { registrata: false, manca: 'nome' };

    const dateISO   = this._normDate(data);
    const timeN     = this._normTime(ora);
    const ppl       = parseInt(persone, 10) || 0;
    if (!dateISO)   return { registrata: false, manca: 'data' };
    if (!timeN)     return { registrata: false, manca: 'ora' };
    if (!ppl)       return { registrata: false, manca: 'persone' };

    const payload = {
      action: 'notify_big_event', source: 'telnyx',
      nome: cleanName, data: dateISO, ora: timeN, persone: ppl,
      telefono: this.callerPhone || '', notes: note || '',
    };
    if (email && String(email).trim()) payload.email = String(email).trim();

    const r = await this._callAppsScript(payload);
    if (r?.success) return { registrata: true, stato: r.status || 'EVENT_REQUEST' };
    return { registrata: false };
  }

  sendAudio(pcmuBase64) {
    if (this._ws?.readyState !== WebSocket.OPEN) return;
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

  _normDate(s) {
    if (!s) return null;
    const t = String(s).trim();
    if (!t) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    return DateManager.parseFromText(t);
  }

  _normTime(s) {
    if (!s) return null;
    const t = String(s).trim();
    if (!t) return null;
    const m = t.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (m) return `${m[1].padStart(2, '0')}:${m[2]}:00`;
    return TimeManager.parseFromText(t);
  }

  _isGarbage(t) {
    if (!t) return true;
    const s = t.trim().toLowerCase();
    const PATTERNS = ['amara.org','sottotitoli','iscriviti','grazie per aver guardato',
      'metti mi piace','copyright','all rights reserved','sottotitolat','comunità amara',
      'sous-titres','sous titres','sous-titrage'];
    if (PATTERNS.some(p => s.includes(p))) {
      console.log(`🚫 [${this.connId}] hallucination filtrata: "${t.slice(0,50)}"`);
      return true;
    }
    const words = s.replace(/[.,!?]/g, '').split(/\s+/).filter(w => w.length > 1);
    return words.length === 0;
  }

  async _fetchRestaurantInfo() {
    try {
      const r = await this._callAppsScript({ action: 'get_restaurant_info' });
      if (r?.success && r.info) {
        this._restaurantInfo = r.info;
        console.log(`📋 [${this.connId}] Info locale caricata`);
      }
    } catch (e) { console.log(`⚠️ [${this.connId}] info locale: ${e?.message}`); }
  }

  async _callAppsScript(payload) {
    const url = this.restaurantConfig?.apps_script_url || this.restaurantConfig?.appsScriptUrl || process.env.APPS_SCRIPT_URL;
    if (!url) return null;
    const rn = this.restaurantConfig?.restaurant_name || this.restaurantConfig?.restaurantName || '?';
    console.log(`🌐 [${this.connId}] → Apps Script (${rn}): ${JSON.stringify(payload).substring(0, 250)}`);
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), 25000);
    try {
      const resp = await fetch(url, {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      clearTimeout(to);
      const txt = await resp.text();
      try { return JSON.parse(txt); } catch { return null; }
    } catch (e) {
      clearTimeout(to);
      if (e.name === 'AbortError') { console.error(`❌ [${this.connId}] Apps Script timeout`); return { success: false, reason: 'timeout' }; }
      throw e;
    }
  }
}
