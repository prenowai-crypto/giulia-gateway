// ═══════════════════════════════════════════════════════════════════════════════
// PRENOW REALTIME v7.1 — SPEECH-TO-SPEECH (gpt-realtime-mini) MULTI-TENANT
// ═══════════════════════════════════════════════════════════════════════════════
// Cambiamenti v7.1 rispetto a v7 (fix dai log del 12/07 sera):
//
// SCHEMA
//   - modifica_prenotazione: aggiunto campo `nome` (era impossibile correggere
//     un nome sbagliato — il modello mentiva "aggiornata con X" senza cambiare
//     nulla nel DB).
//   - info_locale: aggiunta keyword 'coperto' → mappata al campo prices.
//
// PROMPT
//   - Tabella settimanale ESPLICITA di aperture/chiusure (pranzo + cena giorno
//     per giorno). Il modello non deve più dedurre dalle regole generiche
//     "closed_days" e "lunch_closed_days".
//   - Rimossa l'istruzione "always say a short filler phrase to cover the
//     silence while the tool is working". Sulla Realtime API la filler crea
//     una response separata dalla tool call → il modello aspetta un nuovo
//     turno del cliente prima di chiamare la function.
//   - Regola esplicita di distinzione gruppo_grande (10-44 pax → crea_prenotazione,
//     status PENDING_OWNER) vs evento (45+ pax → richiedi_evento).
//   - Regola memoria contesto: se il cliente cambia solo il giorno, riusa
//     ora/persone/nome già raccolti.
//   - Regola tono receptionist: parla come dipendente del ristorante, mai
//     "restiamo in attesa" (tono da cliente).
//   - Regola solo-info-locale per info sul ristorante, mai inventare.
//   - Se il cliente dice solo la data, verifica subito la tabella settimanale.
//
// LOGIC
//   - _toolModifica accetta `nome` come parametro e lo passa ad Apps Script;
//     aggiorna anche `_lastFound.name`.
//   - _toolModifica: NIENTE merge automatico delle note — il modello passa
//     la nota FINALE completa (il tool sostituisce, non concatena). Fine
//     duplicati tipo "vegana; vegana, compleanno".
//   - _toolControlla: non espone owner_email nel result quando esito=evento
//     (era stata detta al cliente come sua email).
//   - _toolRichiediEvento: guard esteso contro nomi placeholder ("nome non
//     fornito", "cliente", ecc.).
// ═══════════════════════════════════════════════════════════════════════════════

import WebSocket from 'ws';
import { DateManager, TimeManager, PeopleManager, IntentDetector,
         ValidationPipeline, isConfirming, isDenying } from './parsers.js';

export { DateManager, TimeManager, PeopleManager, IntentDetector,
         ValidationPipeline, isConfirming, isDenying };

console.log('🟢 openai-realtime.js GIULIA-v7.1-MT-2026-07-12 caricato');

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
    description: "Verifica se è possibile prenotare a una certa data/ora per un numero di persone. USA QUESTO SUBITO appena hai raccolto data+ora+persone, prima di crea_prenotazione. Esiti: libero (procedi con crea_prenotazione), gruppo_grande (procedi con crea_prenotazione, sarà PENDING), evento (usa richiedi_evento), giorno_chiuso, solo_cena, solo_pranzo, fuori_orario, pieno, manca_*.",
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
    description: "Crea una nuova prenotazione. Chiamare dopo controlla_disponibilita con esito 'libero' o 'gruppo_grande'. Passa il nome ESATTAMENTE come pronunciato dal cliente. Mai 'Cliente' o placeholder.",
    parameters: {
      type: 'object',
      properties: {
        nome:    { type: 'string',  description: 'Nome del cliente, esattamente come pronunciato e confermato' },
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
    description: 'Modifica una prenotazione esistente. Chiamare dopo trova_prenotazione. Passa "" (stringa vuota) o 0 per i campi che NON cambiano. La nota SOSTITUISCE quella vecchia, non aggiungere quella precedente.',
    parameters: {
      type: 'object',
      properties: {
        nome:    { type: 'string',  description: 'Nuovo nome corretto. "" se non cambia.' },
        data:    { type: 'string',  description: 'Nuova data (parole del cliente). "" se non cambia.' },
        ora:     { type: 'string',  description: 'Nuova ora (parole del cliente). "" se non cambia.' },
        persone: { type: 'integer', description: 'Nuovo numero totale di persone. 0 se non cambia.' },
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
    description: "Risponde a domande sul ristorante: menu, piatti, opzioni vegetariane/vegane/senza glutine, parcheggio, accessibilità, pagamenti, dehors, seggiolone, prezzi, coperto. Usa questo per QUALSIASI info sul ristorante — mai inventare.",
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
    description: "Registra una richiesta per un evento grande (persone ≥ event_threshold). Chiamare SOLO dopo che controlla_disponibilita ha risposto 'evento'.",
    parameters: {
      type: 'object',
      properties: {
        nome:    { type: 'string',  description: 'Nome del richiedente (mai placeholder)' },
        data:    { type: 'string',  description: "Data dell'evento come detta dal cliente" },
        ora:     { type: 'string',  description: "Ora dell'evento come detta dal cliente" },
        persone: { type: 'integer', description: "Numero di persone stimate" },
        note:    { type: 'string',  description: "Dettagli aggiuntivi. \"\" se nessuno." },
      },
      required: ['nome', 'data', 'ora', 'persone', 'note'],
      additionalProperties: false,
    },
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// SYSTEM PROMPT — v7.1 con fix per i bug B3, B5, B6, B7, B8, B10
// ═══════════════════════════════════════════════════════════════════════════════

const SYSTEM_PROMPT_TEMPLATE = `Act as {{RECEPTIONIST_NAME}}, the automated phone receptionist for {{RESTAURANT_NAME}}, helping customers create, modify, or cancel reservations by calling appropriate tools. Speak only Italian, warm, friendly, professional, and quick. Keep every response short: 1–2 sentences, 5–20 words. Never invent or assume details the customer hasn't provided — always explicitly ask for missing information (date, time, number of people, name) before calling any tool. For confirmations of bookings, modifications, or cancellations, only speak them AFTER the tool returns a result.

Today is {{TODAY_HUMAN}} ({{TODAY_ISO}}).

# Weekly schedule (this is the ONLY source of truth for opening days/hours — never contradict it, never invent)
{{WEEKLY_SCHEDULE}}

At the very start of each call, identify yourself as an automated voice assistant (EU AI Act requirement). Example: "Salve, sono l'assistente vocale automatico di {{RESTAURANT_NAME}}, come posso aiutarla?"

# Tool call timing — CRITICAL
Do NOT say a filler phrase like "un attimo che controllo" as a separate turn before calling a tool. The filler creates a pause where you wait for the customer to speak again, and the tool is never called. Instead: call the tool IMMEDIATELY when you have the required arguments. If some latency is unavoidable, keep the filler in the SAME response as the tool call (not before it as its own turn).

# Reservation flow — CREATE
1. Gather: date, time, number of people, name. Ask only for what's missing.
2. If the customer mentioned only the day (e.g. "vorrei prenotare per lunedì" without time), check the weekly schedule above IMMEDIATELY. If that day is fully CLOSED, say it and propose an alternative day without asking for time/people first. If the day is CLOSED at lunch (and the customer implied lunch), say it and offer dinner or another day.
3. Call controlla_disponibilita with data + ora + persone.
4. Handle the esito:
   - "libero" → call crea_prenotazione.
   - "gruppo_grande" (10-44 people) → call crea_prenotazione. Result will have stato "PENDING_OWNER". Tell customer: "La prenotazione per il gruppo è registrata: il ristorante la contatterà per confermare".
   - "evento" (45+ people) → call richiedi_evento (make sure you have collected the customer's name first). Then say: "Ho registrato la richiesta: il ristorante la contatterà a breve per organizzare l'evento".
   - "giorno_chiuso" → apologize, propose an alternative day (use the weekly schedule).
   - "solo_cena" / "solo_pranzo" → tell the customer, offer the alternative meal or another day.
   - "fuori_orario" → tell the customer, propose a valid time.
   - "pieno" → tell the customer, if the tool provided alternative_stesso_giorno list them (max 3).
   - "manca_data", "manca_ora", "manca_persone" → ask the specific missing piece, do not retry with invented values.
5. Before crea_prenotazione, confirm the full recap: name + date + time + people + notes if any. Wait for the customer's confirmation.

# Reservation flow — MODIFY / CANCEL
1. Call trova_prenotazione (the caller's phone is used automatically). Pass the customer's name if they mention one.
2. If found: read back the details ("Ho trovato la sua prenotazione per venerdì alle 21, tre persone, a nome X"). Then ask what to change.
3. Special case: if the found reservation has a different name from the caller (nome_diverso_dal_cercato: true), say so explicitly: "Vedo una prenotazione a nome X collegata a questo numero — è la sua?".
4. Modify: call modifica_prenotazione passing ONLY the fields that changed. Empty string "" or 0 = don't change.
5. Nome correction: if the customer corrects the name, pass the new correct name in modifica_prenotazione's "nome" field. Then confirm with the customer using the NEW name.
6. Notes: modifica_prenotazione's "note" field REPLACES the existing note entirely. If the customer says "aggiungi anche compleanno" and the existing note is "vegano", pass "vegano, compleanno" (you compose the final note; the tool will not merge).
7. Cancel: ask explicit confirmation ("Vuole davvero cancellare la prenotazione di venerdì alle 21?"), then call cancella_prenotazione.

# Context memory — CRITICAL
Once the customer has given you a piece of information (time, number of people, name, dietary notes), REMEMBER it across the rest of the conversation. If they change ONLY the day, reuse the time/people/name they already said — do not ask again. Example: customer wants Monday at 21:30 for 2, Monday is closed, customer says "let's do Tuesday" → immediately call controlla_disponibilita for Tuesday 21:30 for 2, don't re-ask.

# Tone — you are the restaurant's receptionist, not a customer
NEVER phrase things as if you are a customer waiting alongside the caller. Wrong: "restiamo in attesa", "dovremmo ricevere aggiornamenti", "sto aspettando conferma". Right: "il ristorante la contatterà per confermare", "riceverà una conferma a breve", "le farò sapere quando avremo notizie". You are Giulia, you work FOR the restaurant.

# Information about the restaurant — only from info_locale
For ANY question about the restaurant (menu, dishes, vegan / vegetarian / gluten-free options, parking, accessibility, payment methods, outdoor seating, prices, cover charge, cuisine, address, phone): call info_locale with the appropriate argomento. Answer ONLY from what info_locale returns. If a piece of info is not in the returned object, say "questa informazione non ce l'ho, le consiglio di contattare direttamente il ristorante" — NEVER invent. This includes: never invent whether the restaurant sends reminders / SMS / emails; never invent opening hours beyond the weekly schedule above; never invent prices or promotions.

# Names on the phone
Never invent a name. If unsure (short name, unusual surname, 8kHz PSTN line): ask the customer to spell it letter by letter, then repeat back and confirm before calling crea_prenotazione. Pass to the tool the EXACT name the customer confirmed. "Cliente" is not a valid name.

# Numbers changes
For changes in people numbers ("aggiungi due", "uno in meno"), do the math yourself based on the current people count in the found reservation.

# Dates and times
Pass the customer's wording directly to the tools (e.g. "sabato", "domani", "alle 21", "nove e mezza"). The gateway normalizes them into ISO/HH:MM. Do NOT try to convert dates yourself.

# Audio output constraints
- Every spoken response: 5–20 words, max 2 short sentences.
- One question at a time.
- Lively, quick, natural intonation.
- Yield to the customer after each answer, unless waiting for a tool result.

# Tool error messages
If a tool returns "manca_X" or "creata: false, manca: X", ask the customer specifically for X. Never retry with invented values.

If the customer changes their mind mid-process ("no, cancella invece"), follow the new instruction.`;

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
    this._lastFound        = null;   // ultima prenotazione trovata/creata
    this._lastEventInfo    = null;   // 🔧 v7.1: info interne evento (email owner) senza esporle al modello
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

  // 🔧 v7.1: costruisce tabella settimanale esplicita per il prompt
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
      const name = DAY_NAMES[d];
      const nameCap = name.charAt(0).toUpperCase() + name.slice(1);
      if (closedDays.includes(d)) {
        lines.push(`- ${nameCap}: CLOSED (all day)`);
        continue;
      }
      const lunchClosed  = lunchClosedDays.includes(d);
      const dinnerClosed = dinnerClosedDays.includes(d);
      if (lunchClosed && dinnerClosed) {
        lines.push(`- ${nameCap}: CLOSED (all day)`);
      } else if (lunchClosed) {
        lines.push(`- ${nameCap}: LUNCH CLOSED. Dinner only ${ds}-${de}`);
      } else if (dinnerClosed) {
        lines.push(`- ${nameCap}: DINNER CLOSED. Lunch only ${ls}-${le}`);
      } else {
        lines.push(`- ${nameCap}: Lunch ${ls}-${le}, Dinner ${ds}-${de}`);
      }
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
    const weeklySchedule = this._buildWeeklySchedule(rc);

    return SYSTEM_PROMPT_TEMPLATE
      .replace(/\{\{RECEPTIONIST_NAME\}\}/g, rc.receptionist_name || rc.receptionistName || 'Giulia')
      .replace(/\{\{RESTAURANT_NAME\}\}/g,   rc.restaurant_name   || rc.restaurantName   || 'il ristorante')
      .replace(/\{\{TODAY_HUMAN\}\}/g,       todayHuman)
      .replace(/\{\{TODAY_ISO\}\}/g,         todayIso)
      .replace(/\{\{WEEKLY_SCHEDULE\}\}/g,   weeklySchedule);
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

  // ─── TOOL 1: trova_prenotazione ──────────────────────────────────────────
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

    // 🔧 v7.1 fix B2: NON esporre owner_email nel result — salvala internamente
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

  // ─── TOOL 3: crea_prenotazione ───────────────────────────────────────────
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

  // ─── TOOL 4: modifica_prenotazione ───────────────────────────────────────
  // 🔧 v7.1: accetta nome + niente merge automatico note
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

    // Guard anti-invenzione nome anche in modify
    if (hasNome && /^(cliente|sconosciuto|n\.?d\.?|nome non fornito|non fornito)$/i.test(String(nome).trim())) {
      return { aggiornata: false, motivo: 'manca:"nome_valido"' };
    }

    const newNome   = hasNome ? String(nome).trim() : base.name;
    const newDate   = hasData ? this._normDate(data)  : base.date;
    const newTime   = hasOra  ? this._normTime(ora)   : (base.time?.length === 5 ? base.time + ':00' : base.time);
    const newPeople = hasPpl  ? parseInt(persone, 10) : base.people;
    // 🔧 v7.1 fix B9: la nota SOSTITUISCE, non concatena
    const newNotes  = hasNote ? String(note).trim() : (base.notes || '');

    const r = await this._callAppsScript({
      action: 'update_reservation', eventId: base.eventId,
      nome: newNome, data: newDate, ora: newTime, persone: newPeople,
      telefono: base.phone || this.callerPhone || '', notes: newNotes,
    });
    if (r?.success !== false) {
      this._lastFound = { ...base, name: newNome, date: newDate, time: newTime, people: newPeople, notes: newNotes };
      return {
        aggiornata: true,
        nome: newNome,
        data: DateManager.formatForDisplay(newDate),
        ora: TimeManager.formatForDisplay(newTime),
        persone: newPeople,
        note: newNotes || 'nessuna',
      };
    }
    return { aggiornata: false };
  }

  // ─── TOOL 5: cancella_prenotazione ───────────────────────────────────────
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
  // 🔧 v7.1: aggiunta keyword 'coperto' → mappata a prices
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

  // ─── TOOL 7: richiedi_evento ─────────────────────────────────────────────
  // 🔧 v7.1: guard esteso contro nomi placeholder tipo "nome non fornito"
  async _toolRichiediEvento({ nome, data, ora, persone, note }) {
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

    const r = await this._callAppsScript({
      action: 'notify_big_event', source: 'telnyx',
      nome: cleanName, data: dateISO, ora: timeN, persone: ppl,
      telefono: this.callerPhone || '', notes: note || '',
    });
    if (r?.success) return { registrata: true, stato: r.status || 'EVENT_REQUEST' };
    return { registrata: false };
  }

  // ─── Audio in ────────────────────────────────────────────────────────────
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
