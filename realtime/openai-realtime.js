// ═══════════════════════════════════════════════════════════════════════════════
// PRENOW REALTIME v7 — SPEECH-TO-SPEECH (gpt-realtime-mini)
// Multi-tenant. Basato sul pattern v6.0 con parsers.js autoritari.
//
// Principio chiave: il modello NON normalizza mai date/orari. Passa parole
// umane ("domani", "sabato", "alle nove e mezza") ai tools; il gateway usa
// DateManager/TimeManager per convertire in ISO/HH:MM e ValidationPipeline
// per verificare chiusure prima di chiamare Apps Script.
//
// Risultato: il modello dice subito "lunedì siamo chiusi" al primo turno,
// perché il tool controlla_disponibilita risponde `giorno_chiuso` prima
// che vengano raccolti altri dati. Il modello non "verifica mentalmente".
// ═══════════════════════════════════════════════════════════════════════════════

import WebSocket from 'ws';
import { DateManager, TimeManager, PeopleManager, IntentDetector,
         ValidationPipeline, isConfirming, isDenying } from './parsers.js';

// Re-export per compat con eventuali consumatori
export { DateManager, TimeManager, PeopleManager, IntentDetector,
         ValidationPipeline, isConfirming, isDenying };

console.log('🟢 openai-realtime.js GIULIA-v7-MT-2026-07-12 caricato');

const REALTIME_MODEL = process.env.REALTIME_MODEL || 'gpt-realtime-mini';
const REALTIME_URL   = `wss://api.openai.com/v1/realtime?model=${REALTIME_MODEL}`;

// ═══════════════════════════════════════════════════════════════════════════════
// LE 7 FUNZIONI — nomi italiani, il modello passa parole umane
// ═══════════════════════════════════════════════════════════════════════════════

const FUNCTIONS = [
  {
    type: 'function',
    name: 'trova_prenotazione',
    description: 'Cerca una prenotazione esistente dato il nome fornito dal cliente e, opzionalmente, una data.',
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
    description: 'Verifica se è possibile prenotare o spostare a una certa data, ora e numero di persone. USA QUESTO SUBITO appena hai raccolto data+ora+persone, prima di crea_prenotazione. Restituisce esito: libero, giorno_chiuso, solo_cena, solo_pranzo, fuori_orario, pieno, gruppo_grande, evento, manca_*.',
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
    description: "Crea una nuova prenotazione utilizzando i dati forniti dal cliente. Chiamare solo dopo controlla_disponibilita con esito 'libero' o 'gruppo_grande'.",
    parameters: {
      type: 'object',
      properties: {
        nome:    { type: 'string',  description: 'Nome del cliente, esattamente come pronunciato. Mai "Cliente".' },
        data:    { type: 'string',  description: "Data della prenotazione come detta dal cliente" },
        ora:     { type: 'string',  description: "Ora della prenotazione come detta dal cliente" },
        persone: { type: 'integer', description: 'Numero di persone' },
        note:    { type: 'string',  description: 'Note opzionali (allergie, seggiolone, occasione). Se nessuna, passa "".' },
      },
      required: ['nome', 'data', 'ora', 'persone', 'note'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'modifica_prenotazione',
    description: 'Applica modifiche a una prenotazione esistente. Chiamare dopo trova_prenotazione. Passa solo i campi che cambiano.',
    parameters: {
      type: 'object',
      properties: {
        data:    { type: 'string',  description: 'Nuova data (parole del cliente o YYYY-MM-DD). "" se non cambia.' },
        ora:     { type: 'string',  description: 'Nuova ora (parole del cliente o HH:MM). "" se non cambia.' },
        persone: { type: 'integer', description: 'Nuovo numero totale di persone. 0 se non cambia.' },
        note:    { type: 'string',  description: 'Nuova nota da aggiungere. "" se non cambia.' },
      },
      required: ['data', 'ora', 'persone', 'note'],
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
    description: 'Risponde a domande sul ristorante: menu, piatti, opzioni vegetariane/vegane/senza glutine, parcheggio, accessibilità, pagamenti, dehors, seggiolone.',
    parameters: {
      type: 'object',
      properties: {
        argomento: { type: 'string', description: "Cosa chiede il cliente: 'menu', 'vegano', 'parcheggio', 'pagamenti', 'accessibilità', ecc." },
      },
      required: ['argomento'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'richiedi_evento',
    description: "Registra una richiesta per un evento grande (in genere ≥ event_threshold persone) e avvisa il ristorante. Chiamare dopo che controlla_disponibilita ha risposto 'evento'.",
    parameters: {
      type: 'object',
      properties: {
        nome:    { type: 'string',  description: 'Nome del richiedente' },
        data:    { type: 'string',  description: "Data dell'evento come detta dal cliente" },
        ora:     { type: 'string',  description: "Ora dell'evento come detta dal cliente" },
        persone: { type: 'integer', description: "Numero di persone stimate" },
        note:    { type: 'string',  description: "Dettagli aggiuntivi. Passa \"\" se nessuno." },
      },
      required: ['nome', 'data', 'ora', 'persone', 'note'],
      additionalProperties: false,
    },
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// SYSTEM PROMPT — multi-tenant, con placeholders {{...}} sostituiti a runtime
// ═══════════════════════════════════════════════════════════════════════════════

const SYSTEM_PROMPT_TEMPLATE = `Act as {{RECEPTIONIST_NAME}}, the automated phone receptionist for {{RESTAURANT_NAME}}, helping customers create, modify, or cancel reservations by calling appropriate tools based on their intent. Speak only Italian, use a warm, friendly, professional, and quick tone. Keep every response short, with a maximum of 1–2 sentences. Never invent or assume details the customer hasn't provided—always explicitly ask for missing information, especially date, time, number of people, or name as needed, before calling any tool. For confirmations of bookings, modifications, or cancellations, only give these after the appropriate tool returns a result.

Today is {{TODAY_HUMAN}} ({{TODAY_ISO}}). Opening hours: lunch {{LUNCH_START}}–{{LUNCH_END}}, dinner {{DINNER_START}}–{{DINNER_END}}. Closed on {{CLOSED_DAYS_HUMAN}}.

At the very start of each call, identify yourself as an automated voice assistant (legal requirement under the EU AI Act). Use a natural phrasing in Italian, for example: "Salve, sono l'assistente vocale automatico di {{RESTAURANT_NAME}}, come posso aiutarla?"

When you need to check availability, create, modify, or cancel a reservation, always say a short filler phrase to cover the silence while the tool is working. Always announce the action being taken, not the outcome, before the result is known.

Do not handle normalizations of date or time—pass the customer's wording directly to the tools (e.g. "sabato", "alle 21", "domani"). The gateway normalizes them. Do not proceed if you are missing any critical information; instead, pause and ask for it.

For creating a new reservation, ALWAYS call controlla_disponibilita FIRST (with data, ora, persone) before crea_prenotazione. If controlla_disponibilita returns esito "giorno_chiuso", "solo_cena", "solo_pranzo", or "fuori_orario", immediately tell the customer and propose an alternative WITHOUT collecting more data. Only call crea_prenotazione when controlla_disponibilita returns "libero" or "gruppo_grande".

For modifications or cancellations, first find the reservation using trova_prenotazione, then read back the found details and ask for confirmation before proceeding. If the found reservation uses a different name but was matched via the customer's phone number, state this explicitly and confirm it is theirs before continuing.

For changes in people numbers, do the math yourself to calculate the final total, based on the current reservation, when the customer says things like "add two" or "one less."

For any question about the restaurant itself — menu, dishes, vegan/vegetarian/gluten-free options, parking, accessibility, payment methods, outdoor seating — call info_locale with the topic as argomento. Respond only with what info_locale returns. If the requested detail isn't available, invite the customer to contact the restaurant — never invent.

For very large group requests — when controlla_disponibilita returns esito "evento" — call richiedi_evento to register the request, then tell the customer the restaurant will get back to them.

Always pronounce long numbers such as phone numbers digit-by-digit for clarity.

Never yield the conversation to the user without either resolving their request or clearly stating what additional information you need.

# Tool Usage
- Only call tools after gathering all necessary customer information. Never call tools such as controlla_disponibilita or crea_prenotazione with invented data.
- Respect tool error messages (e.g., manca_ora, manca_persone, manca_data, manca:"nome")—never retry with invented values, always ask the user to provide the exact missing data.
- CRITICAL on names: never invent a name. If unsure of what you heard (short names, unusual surnames), ask the customer to spell it letter by letter. Pass to crea_prenotazione the EXACT name the customer said and confirmed, never a "plausible-sounding" Italian name you made up.

# Audio Output Constraints
- Keep all spoken responses short and conversational (5–20 words).
- Prefer breaking multi-step explanations into short back-and-forth dialogue.
- After outputting each short answer, yield to the user for the next turn unless explicitly waiting for a tool call result.
- Never string together three or more sentences in a single answer.
- Always use lively and emotive intonation, speaking quickly and clearly.

# Notes
- Always ask for exact missing values; never try to "guess" or fill them in.
- For modifications or cancellations, always confirm details found via trova_prenotazione with the customer before proceeding.
- Stick to Italian, friendly and professional tone, short sentences, and a natural phone pace.
- Only offer information actually present in info_locale's response.
- If a user changes their mind mid-process (e.g., "no, cancella invece"), follow their instruction—don't force a restart.
- When the tool returns an error due to missing data, repeat the specific question for the missing piece.
- "Cliente" is not a valid name; always ask for a real name.`;

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

    // Accetta callerPhone o from (compat con media-stream esistente)
    const raw = opts.callerPhone || opts.from || '';
    this.callerPhone = raw && !raw.startsWith('+') ? '+' + raw : raw;
    this.to = opts.to || '';

    // Stato conversazionale
    this._ws               = null;
    this._sessionReady     = false;
    this._lastFound        = null;   // ultima prenotazione trovata/creata
    this._restaurantInfo   = null;   // cache info_locale
    this._pendingCalls     = new Map();

    // Il modello ha tools se c'è una config attiva con apps_script_url
    this._toolsEnabled = !!(
      this.restaurantConfig &&
      this.restaurantConfig.active !== false &&
      (this.restaurantConfig.apps_script_url || this.restaurantConfig.appsScriptUrl)
    );
  }

  // ─── Connessione ─────────────────────────────────────────────────────────
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
        if (this._toolsEnabled) this._fetchRestaurantInfo(); // background, non blocca il saluto
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

  // ─── Session update ──────────────────────────────────────────────────────
  _sendSessionUpdate() {
    const sessionConfig = {
      type: 'realtime',
      instructions: this._buildSystemPrompt(),
      tools: this._toolsEnabled ? FUNCTIONS : [],
      tool_choice: this._toolsEnabled ? 'auto' : 'none',
      audio: {
        input: {
          format: { type: 'audio/pcma' },           // Telnyx Italia = PCMA (A-law)
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

  // ─── System prompt: sostituisce placeholders dal restaurantConfig ─────────
  _buildSystemPrompt() {
    const rc = this.restaurantConfig || {};

    // Se non c'è config valida → messaggio di fallback
    if (!this._toolsEnabled) {
      const name = rc.restaurant_name || rc.restaurantName || '';
      const active = rc.active !== false;
      if (!name) {
        return `Sei un assistente vocale. Il sistema non ha una configurazione per questo numero.
All'inizio della chiamata dì cortesemente: "Buongiorno, mi dispiace ma questo servizio al momento non è attivo per questo numero. Ti invito a contattare direttamente il ristorante."
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

    const closedCsv = rc.closed_days ?? '1';
    const closedHuman = String(closedCsv).split(',')
      .map(s => parseInt(s.trim(), 10))
      .filter(n => !isNaN(n) && n >= 0 && n <= 6)
      .map(i => DAY_NAMES[i])
      .join(', ') || 'lunedì';

    return SYSTEM_PROMPT_TEMPLATE
      .replace(/\{\{RECEPTIONIST_NAME\}\}/g, rc.receptionist_name || rc.receptionistName || 'Giulia')
      .replace(/\{\{RESTAURANT_NAME\}\}/g,   rc.restaurant_name   || rc.restaurantName   || 'il ristorante')
      .replace(/\{\{TODAY_HUMAN\}\}/g,       todayHuman)
      .replace(/\{\{TODAY_ISO\}\}/g,         todayIso)
      .replace(/\{\{LUNCH_START\}\}/g,       rc.lunch_start  || rc.lunchStart  || '12:30')
      .replace(/\{\{LUNCH_END\}\}/g,         rc.lunch_end    || rc.lunchEnd    || '14:30')
      .replace(/\{\{DINNER_START\}\}/g,      rc.dinner_start || rc.dinnerStart || '19:30')
      .replace(/\{\{DINNER_END\}\}/g,        rc.dinner_end   || rc.dinnerEnd   || '23:00')
      .replace(/\{\{CLOSED_DAYS_HUMAN\}\}/g, closedHuman);
  }

  // ─── Handler eventi Realtime ─────────────────────────────────────────────
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

  // ─── Dispatcher ──────────────────────────────────────────────────────────
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

  // ─── TOOL 1: trova_prenotazione ──────────────────────────────────────────
  // Fallback: nome+data → nome → telefono
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

  // ─── TOOL 2: controlla_disponibilita ─────────────────────────────────────
  // Il modello passa parole umane; qui normalizziamo e verifichiamo tutto
  // (chiusure, semi-chiusure, orari, capienza, soglie gruppo/evento).
  async _toolControlla({ data, ora, persone }) {
    const rc = this.restaurantConfig;
    const dateISO = this._normDate(data);
    const timeN   = this._normTime(ora);
    const ppl     = parseInt(persone, 10) || 0;

    // Guard anti-invenzione
    if (!dateISO) return { esito: 'manca_data' };
    if (!timeN)   return { esito: 'manca_ora' };
    if (!ppl)     return { esito: 'manca_persone' };

    // Chiusura settimanale
    if (ValidationPipeline.getDayClosedMessage(dateISO, rc)) {
      return { esito: 'giorno_chiuso', giorno: DateManager.getDayName(dateISO) };
    }
    // Fuori orari di servizio
    if (!ValidationPipeline.isValidTime(timeN, rc)) {
      return {
        esito: 'fuori_orario',
        pranzo: `${rc?.lunch_start || '12:30'}-${rc?.lunch_end || '14:30'}`,
        cena:   `${rc?.dinner_start || '19:30'}-${rc?.dinner_end || '23:00'}`,
      };
    }
    // Semi-chiusure (pranzo/cena)
    {
      const h = parseInt(timeN.split(':')[0], 10);
      if (h >= 10 && h <= 16 && ValidationPipeline.isLunchClosed(dateISO, rc))
        return { esito: 'solo_cena', giorno: DateManager.getDayName(dateISO) };
      if ((h >= 17 || h <= 3) && ValidationPipeline.isDinnerClosed(dateISO, rc))
        return { esito: 'solo_pranzo', giorno: DateManager.getDayName(dateISO) };
    }
    // Soglie
    const eventTh = Number(rc?.event_threshold) || 45;
    const largeTh = Number(rc?.large_group_threshold) || 10;
    if (ppl >= eventTh) return { esito: 'evento', email: rc?.owner_email || '' };
    if (ppl > largeTh)  return { esito: 'gruppo_grande' };

    // Verifica capienza sul backend
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

  // ─── TOOL 3: crea_prenotazione ───────────────────────────────────────────
  async _toolCrea({ nome, data, ora, persone, note }) {
    // Guard anti-invenzione nome
    const nomeOk = nome && String(nome).trim() &&
                   !/^(cliente|sconosciuto|n\.?d\.?)$/i.test(String(nome).trim());
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

  // ─── TOOL 4: modifica_prenotazione ───────────────────────────────────────
  // Opera su _lastFound. Campi vuoti/0 = non cambia.
  async _toolModifica({ data, ora, persone, note }) {
    const base = this._lastFound;
    if (!base?.eventId) return { aggiornata: false, motivo: 'prenotazione non identificata: usa prima trova_prenotazione' };

    const hasData = data    != null && String(data).trim() !== '';
    const hasOra  = ora     != null && String(ora).trim()  !== '';
    const hasPpl  = persone != null && parseInt(persone, 10) > 0;
    const hasNote = note    != null && String(note).trim() !== '';

    const newDate   = hasData ? this._normDate(data)  : base.date;
    const newTime   = hasOra  ? this._normTime(ora)   : (base.time?.length === 5 ? base.time + ':00' : base.time);
    const newPeople = hasPpl  ? parseInt(persone, 10) : base.people;
    const newNotes  = hasNote ? this._mergeNotes(base.notes, note) : (base.notes || '');

    const r = await this._callAppsScript({
      action: 'update_reservation', eventId: base.eventId,
      nome: base.name, data: newDate, ora: newTime, persone: newPeople,
      telefono: base.phone || this.callerPhone || '', notes: newNotes,
    });
    if (r?.success !== false) {
      this._lastFound = { ...base, date: newDate, time: newTime, people: newPeople, notes: newNotes };
      return {
        aggiornata: true,
        data: DateManager.formatForDisplay(newDate),
        ora: TimeManager.formatForDisplay(newTime),
        persone: newPeople,
      };
    }
    return { aggiornata: false };
  }

  // ─── TOOL 5: cancella_prenotazione ───────────────────────────────────────
  // Opera su _lastFound. Ignora l'argomento conferma (residuo schema strict).
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

  // ─── TOOL 6: info_locale ─────────────────────────────────────────────────
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
    if (wants(['prezz','costo','quanto cost'])) filtered.prezzi     = info.prices        || null;
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

  // ─── TOOL 7: richiedi_evento ─────────────────────────────────────────────
  async _toolRichiediEvento({ nome, data, ora, persone, note }) {
    const cleanName = nome && String(nome).trim();
    const dateISO   = this._normDate(data);
    const timeN     = this._normTime(ora);
    const ppl       = parseInt(persone, 10) || 0;
    if (!cleanName) return { registrata: false, manca: 'nome' };
    if (!dateISO)   return { registrata: false, manca: 'data' };
    if (!timeN)     return { registrata: false, manca: 'ora' };
    if (!ppl)       return { registrata: false, manca: 'persone' };

    const r = await this._callAppsScript({
      action: 'notify_big_event', source: 'telnyx',
      nome: cleanName, data: dateISO, ora: timeN, persone: ppl,
      telefono: this.callerPhone || '', notes: note || '',
    });
    if (r?.success) return { registrata: true, stato: r.status || 'EVENT_REQUEST' };
    return { registrata: false };
  }

  // ─── Audio in da Telnyx → Realtime ───────────────────────────────────────
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

  // ─── Helpers normalizzazione (DateManager/TimeManager sono autoritari) ──
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

  _mergeNotes(existing, add) {
    const arr = existing ? String(existing).split(/;\s*/).map(x => x.trim()).filter(Boolean) : [];
    String(add).split(/;\s*/).map(x => x.trim()).filter(Boolean).forEach(n => {
      if (!arr.includes(n)) arr.push(n);
    });
    return arr.join('; ');
  }

  // Filtra hallucination classiche di Whisper (frasi di YouTube subtitles)
  _isGarbage(t) {
    if (!t) return true;
    const s = t.trim().toLowerCase();
    const PATTERNS = ['amara.org','sottotitoli','iscriviti','grazie per aver guardato',
      'metti mi piace','copyright','all rights reserved','sottotitolat','comunità amara'];
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
