// ═══════════════════════════════════════════════════════════════════════════════
// PRENOW REALTIME v5.0 — OPZIONE B: AGENTE A TOOL CALLING
//
// Cambio di paradigma rispetto all'orchestratore precedente:
//   PRIMA:  il codice decide il flow, GPT riempie i buchi (3200 righe, 17 punti
//           di decisione, regex intent, state machine, cancelState/modifyState…)
//   ORA:    il modello decide il flow chiamando 5 tool; il codice esegue soltanto.
//
//   STT (invariato) → AGENTE (gpt-4o-mini, tool calling) → TOOL → TTS (invariato)
//
// File invariati e RIUSATI: parsers.js, stt-session.js, tts-session.js,
//   media-stream.js, index.js, Apps Script. Stesse export e stessa interfaccia
//   di classe (OpenAIRealtimeClient + DateManager) → niente altro da toccare.
// ═══════════════════════════════════════════════════════════════════════════════

import { DateManager, TimeManager, PeopleManager, IntentDetector,
         ValidationPipeline, isConfirming, isDenying } from './parsers.js';
import { STTSession }   from './stt-session.js';
import { TTSSession }   from './tts-session.js';
import { TurnManager }  from './turn-manager.js';

// Re-export per compatibilità con media-stream.js (che importa anche DateManager)
export { DateManager, TimeManager, PeopleManager, IntentDetector,
         ValidationPipeline, isConfirming, isDenying };

console.log('🟢 openai-realtime.js vB2-FILLER-2026-05-27 caricato');

// ─── Modello del "cervello" ──────────────────────────────────────────────────
// gpt-4o-mini è il default sicuro (tool calling + italiano collaudati su Chat
// Completions). Per passare a gpt-5.4-mini basta impostare la variabile BRAIN_MODEL
// su Render — nessuna modifica al codice. Se gpt-5.4-mini desse errore con questo
// endpoint, torna a gpt-4o-mini.
const BRAIN_MODEL = process.env.BRAIN_MODEL || 'gpt-4o-mini';
const MAX_TOOL_ROUNDS = 5;     // sicurezza anti-loop nel ciclo agente
const HISTORY_TURNS   = 8;     // ultimi 8 messaggi (~4 turni) per tenere basso il costo

// ─── Riempitivi vocali ───────────────────────────────────────────────────────
// Tutti i tool toccano Apps Script (4–8s di attesa, soprattutto la create).
// Prima di eseguirli Giulia dice una frase breve per coprire il silenzio.
// REGOLA: le frasi annunciano l'AZIONE, non l'ESITO (così restano corrette
// anche se il tool poi fallisce o dà esito negativo).
const FILLERS = {
  trova_prenotazione:      ['Un attimo, controllo…', 'Vediamo, cerco la prenotazione…'],
  controlla_disponibilita: ['Un attimo, verifico la disponibilità…', 'Controllo subito…'],
  crea_prenotazione:       ['Un attimo, procedo con la prenotazione…', 'Perfetto, registro subito…'],
  modifica_prenotazione:   ['Un attimo, aggiorno la prenotazione…', 'Va bene, modifico subito…'],
  cancella_prenotazione:   ['Un attimo, procedo…', 'Va bene, sistemo subito…'],
};

// ─── Definizione dei 5 tool (i "pulsanti" dell'agente) ───────────────────────
// IMPORTANTE: per data e ora il modello passa il testo COSÌ COME lo dice il
// cliente ("sabato", "domani", "alle 21"); la normalizzazione la fa il codice
// con DateManager/TimeManager → il parser resta l'autorità sulle date.
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'trova_prenotazione',
      description: 'Cerca una prenotazione esistente. Usalo quando il cliente vuole modificare o cancellare, o nomina una prenotazione già fatta. Restituisce i dettagli da leggere al cliente per conferma.',
      parameters: {
        type: 'object',
        properties: {
          nome: { type: 'string', description: 'Nome o cognome sulla prenotazione' },
          data: { type: 'string', description: "Data come detta dal cliente, es. 'sabato', 'domani', '15 giugno'. Opzionale." },
        },
        required: ['nome'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'controlla_disponibilita',
      description: 'Verifica se è possibile prenotare/spostare a una certa data, ora e numero di persone. Applica giorni di chiusura, orari, capienza e gruppi grandi. Chiamalo SEMPRE prima di creare o di applicare una modifica di data/ora/persone. Fidati del suo esito.',
      parameters: {
        type: 'object',
        properties: {
          data:    { type: 'string', description: "Data come detta dal cliente, es. 'sabato'" },
          ora:     { type: 'string', description: "Ora come detta dal cliente, es. 'alle 21', '21:30'" },
          persone: { type: 'integer', description: 'Numero di persone (totale finale)' },
        },
        required: ['data', 'ora', 'persone'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'crea_prenotazione',
      description: 'Crea una nuova prenotazione. Chiamalo solo dopo che controlla_disponibilita ha dato esito libero (o gruppo_grande) e hai il nome.',
      parameters: {
        type: 'object',
        properties: {
          nome:    { type: 'string' },
          data:    { type: 'string', description: "Come detta dal cliente, es. 'sabato'" },
          ora:     { type: 'string', description: "Come detta dal cliente, es. 'alle 21'" },
          persone: { type: 'integer' },
          note:    { type: 'string', description: 'Allergie, seggiolone, occasioni, tavolo, ecc. Opzionale.' },
        },
        required: ['nome', 'data', 'ora', 'persone'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'modifica_prenotazione',
      description: "Applica una modifica a una prenotazione già trovata con trova_prenotazione. Passa SOLO i campi che cambiano, in valore FINALE (se il cliente dice 'si aggiungono due' e ne aveva 4, passa persone: 6 — l'aritmetica la fai tu).",
      parameters: {
        type: 'object',
        properties: {
          data:    { type: 'string', description: "Nuova data, come detta dal cliente. Opzionale." },
          ora:     { type: 'string', description: 'Nuova ora. Opzionale.' },
          persone: { type: 'integer', description: 'Nuovo numero finale di persone. Opzionale.' },
          note:    { type: 'string', description: 'Nota da aggiungere. Opzionale.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancella_prenotazione',
      description: 'Cancella la prenotazione trovata con trova_prenotazione. Chiamalo solo dopo che il cliente ha confermato la cancellazione.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
];

export class OpenAIRealtimeClient {
  constructor(opts = {}) {
    this.apiKey           = opts.apiKey;
    this.restaurantConfig = opts.restaurantConfig || {};
    this.systemPrompt     = opts.systemPrompt || ''; // base da media-stream (non usato direttamente)

    this.onAudioDelta = opts.onAudioDelta || (() => {});
    this.onTranscript = opts.onTranscript || (() => {});
    this.onError      = opts.onError      || console.error;
    this.onClose      = opts.onClose      || (() => {});

    // Normalizza callerPhone con +
    const raw = opts.callerPhone || '';
    this.callerPhone = raw && !raw.startsWith('+') ? '+' + raw : raw;

    // Sessioni audio
    this.sttSession  = null;
    this.ttsSession  = null;
    this.turnManager = null;
    this._ttsPlaying = false;
    this._sessionReady = false;

    // Stato agente (minimale!)
    this._history        = [];    // [{role:'user'|'assistant', content}] — solo conversazione, pulita
    this._lastFound      = null;  // ultima prenotazione trovata/creata (per modifica/cancella)
    this._restaurantInfo = null;  // info locale (menu/orari) caricate async
    this._busy           = false; // un turno per volta
    this._lastFiller     = '';    // evita di ripetere lo stesso riempitivo di fila
  }

  // ── Connessione: STT → TTS → info locale → saluto ─────────────────────────
  async connect() {
    this.turnManager = new TurnManager({
      slidingMs: 1800,
      onTurnReady: (t) => this._onTurnReady(t),
      onInterrupt: () => {
        if (this._ttsPlaying) { this.ttsSession?.cancel(); this._ttsPlaying = false; }
      },
    });

    this.sttSession = new STTSession(this.apiKey, {
      language: 'it',
      onDelta:         (d) => this.turnManager.onDelta(d),
      onCompleted:     (t) => this.turnManager.onCompleted(t),
      onSpeechStarted: ()  => this.turnManager.onSpeechStarted(),
      onError:         (e) => this.onError(e),
      onClose:         (c) => { if (c !== 1000) this.onClose(c); },
    });
    await this.sttSession.connect();

    this.ttsSession = new TTSSession(this.apiKey, {
      voice: this.restaurantConfig?.voice || 'coral',
      onAudioDelta: (chunk) => this.onAudioDelta(chunk),
      onAudioDone:  ()      => { this._ttsPlaying = false; },
      onError:      (e)     => this.onError(e),
    });
    await this.ttsSession.connect();

    this._fetchRestaurantInfo(); // background, non blocca

    if (!this._sessionReady) {
      this._sessionReady = true;
      const nome = this.restaurantConfig?.restaurant_name || 'ristorante';
      // Disclosure AI (EU AI Act, ago 2026) integrata nel saluto.
      this._say(`Salve, sono l'assistente vocale automatico di ${nome}. Come posso aiutarla?`);
    }
  }

  // ── Turno utente → ciclo agente ───────────────────────────────────────────
  async _onTurnReady(transcript) {
    if (this._isGarbage(transcript)) return;
    if (this._busy) { console.log('⏳ turno ignorato: agente occupato'); return; }

    console.log(`💬 [user]: ${transcript}`);
    this.onTranscript(transcript, 'user');
    this._busy = true;
    try {
      await this._runAgent(transcript);
    } catch (e) {
      console.error('❌ _runAgent:', e);
      this._say('Mi scusi, può ripetere?');
    } finally {
      this._busy = false;
    }
  }

  // ── Il ciclo agente: 1 pensata → eventuali tool → risposta ────────────────
  async _runAgent(transcript) {
    this._history.push({ role: 'user', content: transcript });
    this._trimHistory();

    // messages locali a questo turno: system + storia pulita + i round-trip dei tool
    const messages = [{ role: 'system', content: this._buildSystemPrompt() }, ...this._history];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const msg = await this._chat(messages);
      if (!msg) { this._say('Mi scusi, può ripetere?'); return; }

      if (msg.tool_calls && msg.tool_calls.length > 0) {
        messages.push(msg); // l'assistant con le tool_calls DEVE precedere i risultati
        // Riempitivo vocale: copre il silenzio mentre Apps Script lavora.
        // Parte in parallelo (fire-and-forget), poi eseguiamo il tool.
        this._sayFiller(msg.tool_calls[0]?.function?.name);
        for (const tc of msg.tool_calls) {
          let args = {};
          try { args = JSON.parse(tc.function.arguments || '{}'); } catch {}
          const result = await this._execTool(tc.function.name, args);
          messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
        }
        continue; // ripensa con i risultati dei tool
      }

      // Nessun tool → risposta finale da pronunciare
      const text = (msg.content || '').trim();
      if (text) {
        this._history.push({ role: 'assistant', content: text }); // solo il testo finale entra in storia
        this._say(text);
      }
      return;
    }
    this._say('Mi scusi, può ripetere?'); // troppi round → sicurezza
  }

  // ── Chiamata al modello (Chat Completions + tool calling) ─────────────────
  async _chat(messages) {
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), 12000);
    try {
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: BRAIN_MODEL,
          messages,
          tools: TOOLS,
          tool_choice: 'auto',
          temperature: 0.2,
          max_tokens: 300,
        }),
      });
      clearTimeout(to);
      const data = await resp.json();
      if (data?.error) { console.log('⚠️ brain error:', data.error?.message); return null; }
      // Log token per stimare il costo reale (PARTE 6 della spec)
      const u = data?.usage;
      if (u) console.log(`📊 tokens: in=${u.prompt_tokens} out=${u.completion_tokens}`);
      return data?.choices?.[0]?.message || null;
    } catch (e) {
      clearTimeout(to);
      console.log('⚠️ brain exception:', e?.message);
      return null;
    }
  }

  // ── Dispatcher tool ───────────────────────────────────────────────────────
  async _execTool(name, args) {
    console.log(`🔧 tool ${name}(${JSON.stringify(args)})`);
    try {
      switch (name) {
        case 'trova_prenotazione':      return await this._toolTrova(args);
        case 'controlla_disponibilita': return await this._toolControlla(args);
        case 'crea_prenotazione':       return await this._toolCrea(args);
        case 'modifica_prenotazione':   return await this._toolModifica(args);
        case 'cancella_prenotazione':   return await this._toolCancella(args);
        default: return { errore: 'tool sconosciuto' };
      }
    } catch (e) {
      console.log('⚠️ tool error:', e?.message);
      return { errore: e?.message || 'errore interno' };
    }
  }

  // ─── TOOL 1: trova_prenotazione (fallback a 4 stadi: nome+data → nome → telefono)
  async _toolTrova({ nome, data }) {
    const phone   = this.callerPhone || '';
    const dateISO = data ? this._normDate(data) : null;
    const ok = (r) => r && r.name && r.date && r.name !== 'null' && r.date !== 'null';

    if (nome && dateISO) {
      const r = await this._callAppsScript({ action: 'find_reservation', nome, data: dateISO, sheet: 'Prenotazioni' });
      if (r?.found && ok(r.reservation)) return this._foundResult(r.reservation, nome);
    }
    if (nome) {
      const r = await this._callAppsScript({ action: 'find_reservation', nome, sheet: 'Prenotazioni' });
      if (r?.found && ok(r.reservation)) return this._foundResult(r.reservation, nome);
    }
    if (phone) {
      const r = await this._callAppsScript({ action: 'find_reservation', telefono: phone, sheet: 'Prenotazioni' });
      if (r?.found && ok(r.reservation)) return this._foundResult(r.reservation, nome);
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
      // se trovata tramite numero ma con nome diverso da quello cercato → avvisa il cliente
      nome_diverso_dal_cercato: !!(searchedName && res.name && res.name.toLowerCase() !== String(searchedName).toLowerCase()),
    };
  }

  // ─── TOOL 2: controlla_disponibilita (business rules + Apps Script)
  async _toolControlla({ data, ora, persone }) {
    const rc = this.restaurantConfig;
    const dateISO = this._normDate(data);
    const timeN   = this._normTime(ora);
    const ppl     = parseInt(persone, 10) || 0;

    if (!dateISO) return { esito: 'data_non_capita' };

    if (ValidationPipeline.getDayClosedMessage(dateISO, rc)) {
      return { esito: 'giorno_chiuso', giorno: DateManager.getDayName(dateISO) };
    }
    if (timeN && !ValidationPipeline.isValidTime(timeN, rc)) {
      return { esito: 'fuori_orario',
               pranzo: `${rc?.lunch_start || '12:00'}-${rc?.lunch_end || '14:30'}`,
               cena:   `${rc?.dinner_start || '19:00'}-${rc?.dinner_end || '22:30'}` };
    }
    if (timeN) {
      const h = parseInt(timeN.split(':')[0], 10);
      if (h >= 10 && h <= 16 && ValidationPipeline.isLunchClosed(dateISO, rc))
        return { esito: 'solo_cena', giorno: DateManager.getDayName(dateISO) };
      if ((h >= 17 || h <= 3) && ValidationPipeline.isDinnerClosed(dateISO, rc))
        return { esito: 'solo_pranzo', giorno: DateManager.getDayName(dateISO) };
    }

    const eventTh = Number(rc?.event_threshold) || 45;
    const largeTh = Number(rc?.large_group_threshold) || 10;
    if (ppl >= eventTh) return { esito: 'evento', email: rc?.owner_email || '' };
    if (ppl > largeTh)  return { esito: 'gruppo_grande' };

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
    return { esito: 'libero' }; // check incerto → procedi
  }

  // ─── TOOL 3: crea_prenotazione
  async _toolCrea({ nome, data, ora, persone, note }) {
    const dateISO = this._normDate(data);
    const timeN   = this._normTime(ora);
    const ppl     = parseInt(persone, 10) || 0;
    const tel     = this.callerPhone || '';
    const r = await this._callAppsScript({
      source: 'telnyx', nome, persone: ppl, data: dateISO, ora: timeN,
      telefono: tel, notes: note || '', forceNew: true,
    });
    if (r?.success && r.eventId) {
      this._lastFound = { eventId: r.eventId, name: nome, date: dateISO, time: timeN, people: ppl, phone: tel, notes: note || '' };
      return { creata: true, stato: r.status || 'CONFIRMED',
               data: DateManager.formatForDisplay(dateISO), ora: TimeManager.formatForDisplay(timeN), persone: ppl };
    }
    return { creata: false };
  }

  // ─── TOOL 4: modifica_prenotazione (merge sui campi non cambiati)
  async _toolModifica({ data, ora, persone, note }) {
    const base = this._lastFound;
    if (!base?.eventId) return { aggiornata: false, motivo: 'prenotazione non identificata: usa prima trova_prenotazione' };

    const newDate   = data    != null ? this._normDate(data) : base.date;
    const newTime   = ora     != null ? this._normTime(ora)  : (base.time?.length === 5 ? base.time + ':00' : base.time);
    const newPeople = persone != null ? parseInt(persone, 10) : base.people;
    const newNotes  = note    != null ? this._mergeNotes(base.notes, note) : (base.notes || '');

    const r = await this._callAppsScript({
      action: 'update_reservation', eventId: base.eventId,
      nome: base.name, data: newDate, ora: newTime, persone: newPeople,
      telefono: base.phone || this.callerPhone || '', notes: newNotes,
    });
    if (r?.success !== false) {
      this._lastFound = { ...base, date: newDate, time: newTime, people: newPeople, notes: newNotes };
      return { aggiornata: true, data: DateManager.formatForDisplay(newDate),
               ora: TimeManager.formatForDisplay(newTime), persone: newPeople };
    }
    return { aggiornata: false };
  }

  // ─── TOOL 5: cancella_prenotazione
  async _toolCancella() {
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

  // ── System prompt (snello = qualità intento + costo basso) ────────────────
  _buildSystemPrompt() {
    const rc = this.restaurantConfig;
    const now = DateManager.getNow();
    const dayNames = ['domenica','lunedì','martedì','mercoledì','giovedì','venerdì','sabato'];
    const todayISO = DateManager.toISO(new Date(now.getFullYear(), now.getMonth(), now.getDate()));

    const closedDays = rc?.closed_days ? String(rc.closed_days).split(',').map(Number) : [1];
    const closedTxt  = closedDays.map(d => dayNames[d]).join(', ');
    const ls = rc?.lunch_start || '12:00', le = rc?.lunch_end || '14:30';
    const ds = rc?.dinner_start || '19:00', de = rc?.dinner_end || '22:30';
    const nome = rc?.restaurant_name || 'ristorante';

    // Info locale (trim per non gonfiare il prompt). Lo zoccolo del costo: tienilo corto.
    const info = this._restaurantInfo || {};
    const infoLines = [];
    if (info.cuisine)        infoLines.push(`Cucina: ${info.cuisine}`);
    if (info.parking)        infoLines.push(`Parcheggio: ${info.parking}`);
    if (info.highchair)      infoLines.push(`Seggiolone: ${info.highchair}`);
    if (info.accessibility)  infoLines.push(`Accessibilità: ${info.accessibility}`);
    if (info.vegan)          infoLines.push(`Vegano/vegetariano: ${info.vegan}`);
    if (info.glutenFree)     infoLines.push(`Senza glutine: ${info.glutenFree}`);
    if (info.paymentMethods) infoLines.push(`Pagamenti: ${info.paymentMethods}`);
    if (info.menuDetails)    infoLines.push(`Menu:\n${String(info.menuDetails).slice(0, 1400)}`);

    return [
      `Sei Giulia, receptionist vocale di ${nome}. Parli italiano, frasi brevi (max 2), tono cordiale e professionale.`,
      `Oggi è ${dayNames[now.getDay()]} ${todayISO}.`,
      `Orari: pranzo ${ls}-${le}, cena ${ds}-${de}. Chiuso il ${closedTxt}.`,
      ``,
      `Il tuo compito: aiutare il cliente a CREARE, MODIFICARE o CANCELLARE una prenotazione, usando SEMPRE gli strumenti. Non confermare mai una prenotazione, modifica o cancellazione, né una disponibilità, senza aver chiamato il tool corrispondente. Non inventare.`,
      ``,
      `Regole:`,
      `- Per data e ora passa ai tool il testo COSÌ COME lo dice il cliente ("sabato", "domani", "alle 21"): al calcolo ci pensa il sistema.`,
      `- Per modificare o cancellare: prima chiama trova_prenotazione, poi LEGGI al cliente cosa hai trovato (nome, data, ora, persone) e chiedi conferma prima di procedere. Se nome_diverso_dal_cercato è true, di' che l'hai trovata tramite il suo numero e chiedi se è la sua.`,
      `- Persone: se il cliente dice "si aggiungono due" o "uno in meno", calcola TU il totale finale partendo dalle persone della prenotazione trovata, e passa il numero finale.`,
      `- Prima di creare o di applicare un cambio di data/ora/persone chiama controlla_disponibilita e rispetta l'esito (giorno_chiuso, fuori_orario, solo_cena/solo_pranzo, pieno con alternative, gruppo_grande = soggetto a conferma del ristorante, evento = invita a scrivere all'email).`,
      `- Leggi i numeri di telefono cifra per cifra.`,
      `- Le note (allergie, intolleranze, seggiolone, occasioni, tavolo) vanno nel campo "note" dei tool.`,
      `- Se il cliente cambia idea a metà (es. "no, anzi cancellala"), assecondalo chiamando il tool giusto: non serve ricominciare.`,
      `- Domande sul locale: rispondi con le informazioni qui sotto. Se non le hai, invita a contattare il ristorante. Non inventare.`,
      infoLines.length ? `\nInformazioni sul locale:\n${infoLines.join('\n')}` : '',
    ].join('\n');
  }

  // ── TTS ───────────────────────────────────────────────────────────────────
  _say(text) {
    if (!text) return;
    console.log(`💉 [say]: ${text.substring(0, 120)}`);
    this._ttsPlaying = true;
    this.ttsSession?.speak(this._speakNumbers(text), 'it');
  }
  // legge cifra-per-cifra i numeri lunghi (telefoni) per una TTS affidabile
  _speakNumbers(text) { return String(text).replace(/\d{7,}/g, (m) => m.split('').join(' ')); }

  // pronuncia un riempitivo per il tool in arrivo (se previsto), senza ripetere
  // due volte di fila la stessa frase
  _sayFiller(toolName) {
    const opts = FILLERS[toolName];
    if (!opts || !opts.length) return;
    let phrase = opts[Math.floor(Math.random() * opts.length)];
    if (phrase === this._lastFiller && opts.length > 1) {
      phrase = opts[(opts.indexOf(phrase) + 1) % opts.length];
    }
    this._lastFiller = phrase;
    this._say(phrase);
  }

  // ── Helper di normalizzazione (DateManager/TimeManager = autorità) ─────────
  _normDate(s) {
    if (!s) return null;
    const t = String(s).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;        // già ISO
    return DateManager.parseFromText(t);
  }
  _normTime(s) {
    if (!s) return null;
    const t = String(s).trim();
    const m = t.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (m) return `${m[1].padStart(2, '0')}:${m[2]}:00`;
    return TimeManager.parseFromText(t);
  }
  _mergeNotes(existing, add) {
    const arr = existing ? String(existing).split(/;\s*/).map(x => x.trim()).filter(Boolean) : [];
    String(add).split(/;\s*/).map(x => x.trim()).filter(Boolean).forEach(n => { if (!arr.includes(n)) arr.push(n); });
    return arr.join('; ');
  }

  _trimHistory() {
    if (this._history.length > HISTORY_TURNS) {
      this._history.splice(0, this._history.length - HISTORY_TURNS);
    }
  }

  // ── Filtro allucinazioni Whisper (audio corto/silenzio PSTN) ──────────────
  _isGarbage(t) {
    if (!t) return true;
    const s = t.trim().toLowerCase();
    const PATTERNS = ['amara.org','sottotitoli','iscriviti','grazie per aver guardato',
      'metti mi piace','copyright','all rights reserved','sottotitolat','comunità amara'];
    if (PATTERNS.some(p => s.includes(p))) { console.log(`🚫 hallucination filtrata: "${t.slice(0,50)}"`); return true; }
    const words = s.replace(/[.,!?]/g, '').split(/\s+/).filter(w => w.length > 1);
    return words.length === 0;
  }

  // ── Info locale (Apps Script) ─────────────────────────────────────────────
  async _fetchRestaurantInfo() {
    try {
      const r = await this._callAppsScript({ action: 'get_restaurant_info' });
      if (r?.success && r.info) {
        this._restaurantInfo = r.info;
        console.log(`📋 Info locale caricata (menu: ${r.info.menuDetails ? r.info.menuDetails.length : 0} chars)`);
      }
    } catch (e) { console.log('⚠️ info locale:', e?.message); }
  }

  // ── Apps Script ─────────────────────────────────────────────────────────
  async _callAppsScript(payload) {
    const url = this.restaurantConfig?.apps_script_url || process.env.APPS_SCRIPT_URL;
    if (!url) return null;
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), 25000);
    try {
      const resp = await fetch(url, {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      clearTimeout(to);
      const txt = await resp.text();
      try { return JSON.parse(txt); } catch { return null; }
    } catch (e) {
      clearTimeout(to);
      if (e.name === 'AbortError') { console.error('❌ Apps Script timeout'); return { success: false, reason: 'timeout' }; }
      throw e;
    }
  }

  // ── Audio Telnyx → STT ────────────────────────────────────────────────────
  sendAudio(pcmuBase64) { this.sttSession?.sendAudio(pcmuBase64); }

  // ── Chiusura ────────────────────────────────────────────────────────────
  close() {
    this.turnManager?.reset();
    this.sttSession?.close();
    this.ttsSession?.close();
  }
}
