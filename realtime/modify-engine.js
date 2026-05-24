/**
 * ModifyEngine — Motore MODIFY riscritto da zero
 *
 * Architettura:
 *   1 transcript = N operazioni strutturate
 *
 * State machine pulita:
 *   IDLE → SEARCH_BOOKING → CONFIRM_BOOKING → MODIFY_ACTIVE → CONFIRM_PATCH → DONE
 *
 * Ogni transcript produce operations[], non un singolo intent.
 * GPT estrae operazioni. Il motore decide il flow.
 */

export class ModifyEngine {

  constructor({ callAppsScript, say, buildInfoContext, mergeNotesStr, findReservationWithFallback, formatForDisplay, formatTimeForDisplay, isValidTime, restaurantConfig, apiKey, gptComplete, parseDate }) {
    // Dependencies injected
    this._callAppsScript              = callAppsScript;
    this._say                         = say;
    this._buildInfoContext             = buildInfoContext;
    this._mergeNotesStr               = mergeNotesStr;
    this._findReservationWithFallback = findReservationWithFallback;
    this._formatDate                  = formatForDisplay;
    this._formatTime                  = formatTimeForDisplay;
    this._isValidTime                 = isValidTime;
    this._restaurantConfig            = restaurantConfig;
    this._apiKey                      = apiKey;

    // parseDate: parser deterministico delle date (DateManager.parseFromText).
    // È l'AUTORITÀ sulle date — come in CREATE. GPT non deve calcolare i giorni
    // relativi (sbaglia: "sabato" → giovedì). Se non iniettato, nessun override.
    this._parseDate = parseDate || (() => null);

    // gptComplete: chiamata GPT iniettabile (per test offline).
    // Se non iniettata → default = fetch reale a OpenAI (produzione invariata).
    // Firma: async (messages, { model, temperature, max_tokens, timeoutMs }) → string|null
    this._gptComplete = gptComplete || this._defaultGptComplete.bind(this);

    this.reset();
  }

  // ─── Default GPT completion — fetch reale a OpenAI ─────────────────────────
  // Unico punto HTTP verso OpenAI nell'engine. Ritorna il contenuto del messaggio
  // (stringa trimmata) oppure null su errore/timeout. I caller fanno il parsing.
  async _defaultGptComplete(messages, opts = {}) {
    const { model = 'gpt-4o-mini', temperature = 0, max_tokens = 200, timeoutMs = 5000 } = opts;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this._apiKey}` },
        body: JSON.stringify({ model, temperature, max_tokens, messages }),
      });
      clearTimeout(timeout);
      const data = await response.json();
      return data?.choices?.[0]?.message?.content?.trim() ?? null;
    } catch (err) {
      clearTimeout(timeout);
      console.log('⚠️ gptComplete error:', err?.message);
      return null;
    }
  }

  // ─── Stato pubblico ───────────────────────────────────────────────────────
  reset() {
    this.state           = 'IDLE';       // IDLE | SEARCH_BOOKING | CONFIRM_BOOKING | MODIFY_ACTIVE | CONFIRM_PATCH | DONE
    this.activeBooking   = null;         // prenotazione canonica trovata
    this.pendingOps      = [];           // operations[] da applicare (pre-confirm)
    this.pendingUpdate   = null;         // { updDate, updTime, updPeople, mergedNotes } calcolato
    this.infoAnswers     = [];           // risposte info_query da dare insieme al recap
    this._processing     = false;
    this._firstTranscript = null;        // primo transcript con la richiesta originale
    this._allTranscripts  = [];          // tutti i transcript della sessione modify
    this._pendingForcedNote = null;      // nota forzata (telefono) da iniettare in _collectAndApply
  }

  get isDone()   { return this.state === 'DONE'; }
  get isActive() { return this.state !== 'IDLE' && this.state !== 'DONE'; }

  // ─── Entry point principale ────────────────────────────────────────────────
  // Chiamato da _processExtraction ogni volta che intent=modify
  async handle(transcript, extractedData) {
    const { newDate, newTime, newPeople, newName, forcedNote } = extractedData;

    // Nota forzata dall'orchestratore (es. telefono alternativo rilevato in modo
    // deterministico, che GPT non estrae come operazione). Verrà iniettata come
    // add_note in _collectAndApply.
    if (forcedNote) this._pendingForcedNote = forcedNote;

    // Accumula tutti i transcript della sessione modify
    if (transcript && transcript.trim()) {
      if (!this._firstTranscript) this._firstTranscript = transcript;
      this._allTranscripts.push(transcript);
    }

    switch (this.state) {

      case 'IDLE':
      case 'SEARCH_BOOKING':
        await this._searchBooking(transcript, newName, newDate, newTime, newPeople);
        break;

      case 'CONFIRM_BOOKING':
        await this._handleBookingConfirmation(transcript, newName, newDate);
        break;

      case 'MODIFY_ACTIVE':
        await this._collectAndApply(transcript);
        break;

      case 'CONFIRM_PATCH':
        await this._handleConfirmation(transcript);
        break;

      case 'DONE':
        // Già completato — ignora
        break;
    }
  }

  // ─── FASE 1: Trova la prenotazione ────────────────────────────────────────
  async _searchBooking(transcript, newName, newDate, newTime, newPeople) {
    this.state = 'SEARCH_BOOKING';

    const searchName = newName;
    const searchDate = newDate;

    // Prova ricerca diretta se abbiamo abbastanza dati
    if (searchName) {
      this._say('Un momento, cerco la prenotazione...');
      const r = await this._findReservationWithFallback(searchName, searchDate, 'MODIFY');

      if (!r) {
        this._say(`Non trovo nessuna prenotazione a nome ${searchName}. Può riprovare con un altro nome o data?`);
        return;
      }

      if (r.requiresConfirmation) {
        const c = r.fuzzyCandidate;
        this.activeBooking = c;            // provvisorio fino a conferma
        this.state = 'CONFIRM_BOOKING';
        const timeNorm = c.time?.length === 5 ? c.time + ':00' : (c.time || '');
        this._say(`Ho trovato una prenotazione a nome ${c.name}, ${this._formatDate(c.date)} alle ${this._formatTime(timeNorm)} per ${c.people} persone. È quella che vuole modificare?`);
        return;
      }

      this.activeBooking = r;
      this.state = 'MODIFY_ACTIVE';

      // Booking trovato: estrai operazioni dal transcript ORIGINALE (il primo con la richiesta)
      // Non dal transcript corrente che potrebbe contenere solo nome/data
      const _bestTranscript = this._firstTranscript || transcript;
      await this._collectAndApply(_bestTranscript);
      return;
    }

    // Nessun nome → chiedi
    this._say('Certo! A che nome è la prenotazione e per quale data?');
  }

  // ─── FASE 2: Estrai operazioni e proponi recap ─────────────────────────────
  async _collectAndApply(transcript) {
    const r = this.activeBooking;
    if (!r) { this.reset(); return; }

    // Estrai operazioni dal transcript
    let ops = await this._extractOperations(transcript, r);
    console.log(`🔧 Operations: ${JSON.stringify(ops)}`);

    // ── AUTORITÀ DATE: il parser deterministico vince su GPT ──────────────────
    // GPT sbaglia il calcolo dei giorni relativi ("sabato" → giovedì). Come in
    // CREATE, la data corretta la calcola DateManager dal transcript. Se il parser
    // trova una data, sovrascrive quella (eventualmente errata) prodotta da GPT.
    if (ops && ops.length > 0) {
      const _parsedDate = this._parseDate(transcript);
      if (_parsedDate) {
        for (const op of ops) {
          if (op.type === 'update_date' && op.mode === 'set' && op.value !== _parsedDate) {
            console.log(`📅 Date override: GPT="${op.value}" → parser="${_parsedDate}"`);
            op.value = _parsedDate;
          }
        }
      }
    }

    // ── Nota forzata (telefono alternativo) → add_note ────────────────────────
    // L'orchestratore rileva il telefono in modo deterministico; GPT non lo estrae
    // come operazione. Lo aggiungiamo qui, in modo idempotente (no doppioni).
    if (this._pendingForcedNote) {
      const _fn = this._pendingForcedNote;
      this._pendingForcedNote = null;
      const _alreadyInNotes = String(r.notes || '').includes('Tel. alternativo');
      const _alreadyInOps = (ops || []).some(o => o.type === 'add_note' && o.value === _fn);
      if (!_alreadyInNotes && !_alreadyInOps) {
        if (!ops) ops = [];
        ops.push({ type: 'add_note', value: _fn });
        console.log(`📞 Nota forzata aggiunta alle operations: "${_fn}"`);
      }
    }

    if (!ops || ops.length === 0) {
      this._say('Non ho capito cosa vuole modificare. Vuole cambiare data, orario o numero di persone?');
      return;
    }

    // Separa operazioni per tipo
    const slotOps  = ops.filter(o => ['update_people','update_time','update_date'].includes(o.type));
    const noteOps  = ops.filter(o => o.type === 'add_note');
    const infoOps  = ops.filter(o => o.type === 'info_query');

    // Rispondi subito alle info query (non bloccano il flow)
    this.infoAnswers = [];
    for (const op of infoOps) {
      const answer = await this._answerInfoQuery(op.topic, r);
      if (answer) this.infoAnswers.push(answer);
    }

    // Accumula note
    const newNotesStr = noteOps.map(o => o.value).filter(Boolean).join('; ');
    const mergedNotes = this._mergeNotesStr(r.notes || '', newNotesStr, []);

    // Se ci sono solo info query e note, senza slot changes
    if (slotOps.length === 0) {
      // Rispondi alle info query
      const infoMsg = this.infoAnswers.join(' ');

      if (noteOps.length > 0) {
        const noteDisplay = noteOps.map(o => o.value).join('; ');
        this._say(`${infoMsg ? infoMsg + ' ' : ''}Ho annotato: ${noteDisplay}. C'è altro che posso fare per lei?`);
        // Salva le note subito
        await this._saveNotesOnly(r, mergedNotes);
      } else if (infoMsg) {
        this._say(infoMsg + ' C\'è altro che posso fare per lei?');
      } else {
        this._say('Non ho capito cosa vuole modificare. Vuole cambiare data, orario o numero di persone?');
      }
      return;
    }

    // Calcola i valori aggiornati
    const { updDate, updTime, updPeople } = this._applySlotOps(r, slotOps);

    // Valida orario
    const timeOrig = r.time?.length === 5 ? r.time + ':00' : (r.time || '21:00:00');
    if (updTime !== timeOrig && !this._isValidTime(updTime, this._restaurantConfig)) {
      const rc = this._restaurantConfig;
      const lunch  = rc?.lunch_hours  || '12:00-14:30';
      const dinner = rc?.dinner_hours || '21:00-22:30';
      this._say(`Quell'orario è fuori dai nostri orari. Pranzo ${lunch}, cena ${dinner}. Che orario preferisce?`);
      return;
    }

    // Salva pending update
    this.pendingOps    = ops;
    this.pendingUpdate = { updDate, updTime, updPeople, mergedNotes };
    this.state         = 'CONFIRM_PATCH';

    // Mostra recap con eventuali risposte info
    const recap = this._buildRecap(r, updDate, updTime, updPeople, noteOps, this.infoAnswers);
    this._say(recap);
  }

  // ─── FASE 3: Gestisci la risposta alla conferma ───────────────────────────
  async _handleConfirmation(transcript) {
    const responseType = await this._classifyResponse(transcript);
    console.log(`🔍 Confirmation type: ${responseType}`);

    if (responseType === 'confirm') {
      await this._executeUpdate();

    } else if (responseType === 'reject') {
      this._say('Ok, la prenotazione rimane invariata. Posso aiutarla con altro?');
      this.state = 'DONE';

    } else {
      // CORRECTION: ri-estrai operazioni dalla correzione
      // "ma perché 5? siamo in 4" → re-collect
      this.state = 'MODIFY_ACTIVE';
      await this._collectAndApply(transcript);
    }
  }

  // ─── FASE 1b: Conferma "è questa la prenotazione?" (fuzzy match) ───────────
  async _handleBookingConfirmation(transcript, newName, newDate) {
    const responseType = await this._classifyResponse(transcript);
    console.log(`🔍 Booking confirmation type: ${responseType}`);

    if (responseType === 'confirm') {
      // Confermata: applica la richiesta di modifica ORIGINALE
      // (non il "sì" corrente, che non contiene operazioni)
      this.state = 'MODIFY_ACTIVE';
      await this._collectAndApply(this._firstTranscript || transcript);
      return;
    }

    if (responseType === 'reject') {
      this.activeBooking = null;
      this.state = 'SEARCH_BOOKING';
      this._say('Va bene. A che nome è la prenotazione e per quale data?');
      return;
    }

    // Correzione (es. "no, è a nome Bianchi") → nuovo tentativo di ricerca
    this.activeBooking = null;
    this.state = 'SEARCH_BOOKING';
    await this._searchBooking(transcript, newName || null, newDate || null, null, null);
  }

  // ─── Esecuzione finale ────────────────────────────────────────────────────
  async _executeUpdate() {
    if (this._processing) return;
    this._processing = true;

    const r = this.activeBooking;
    const { updDate, updTime, updPeople, mergedNotes } = this.pendingUpdate;
    const timeOrig = r.time?.length === 5 ? r.time + ':00' : (r.time || '');
    const slotChanged = updDate !== r.date || updTime !== timeOrig;

    if (slotChanged) {
      this._say('Un attimo che verifico la disponibilità...');
      const checkResult = await this._callAppsScript({
        action:  'check_availability',
        data:    updDate,
        ora:     updTime,
        persone: updPeople,
        existingPeople: 0,
      });

      if (!checkResult?.success && checkResult?.reason !== 'slot_available') {
        this._processing = false;
        this.state = 'MODIFY_ACTIVE'; // Permetti di riprovare

        if (checkResult?.reason === 'day_closed') {
          this._say('Mi dispiace, quel giorno siamo chiusi. Vuole provare un altro giorno?');
        } else {
          this._say('Mi dispiace, quell\'orario non è disponibile. Vuole provare un altro orario?');
        }
        return;
      }
    }

    this._say('Perfetto, aggiorno subito...');
    console.log(`✏️ MODIFY esegue: eventId=${r.eventId} ${updDate} ${updTime} ${updPeople}pax`);

    const updateResult = await this._callAppsScript({
      action:   'update_reservation',
      eventId:  r.eventId,
      nome:     r.name,
      data:     updDate,
      ora:      updTime,
      persone:  updPeople,
      telefono: r.phone || '',
      notes:    mergedNotes,
    });

    this._processing = false;
    this.state = 'DONE';

    if (updateResult?.success) {
      const dateDisplay = this._formatDate(updDate);
      const timeDisplay = this._formatTime(updTime);
      this._say(`Perfetto ${r.name}! Ho aggiornato la prenotazione: ${dateDisplay} alle ${timeDisplay} per ${updPeople} persone. Ti aspettiamo!`);

      // Aggiorna activeBooking con i nuovi dati
      this.activeBooking = { ...r, date: updDate, time: updTime, people: updPeople, notes: mergedNotes };
    } else {
      this._say('Mi dispiace, si è verificato un problema nell\'aggiornamento. Riprovi tra un momento.');
    }
  }

  // ─── Salva solo note (senza slot change) ──────────────────────────────────
  async _saveNotesOnly(r, mergedNotes) {
    try {
      await this._callAppsScript({
        action:  'update_notes',
        eventId: r.eventId,
        notes:   mergedNotes,
      });
      this.activeBooking = { ...r, notes: mergedNotes };
      console.log(`📝 update_notes: OK`);
    } catch (e) {
      console.log('⚠️ update_notes error:', e?.message);
    }
    this.state = 'DONE';
  }

  // ─── GPT: Estrai operazioni dal transcript ────────────────────────────────
  async _extractOperations(transcript, r) {
    try {
      const timeNorm    = r.time?.length === 5 ? r.time + ':00' : (r.time || '');
      const dateDisplay = this._formatDate(r.date);
      const timeDisplay = this._formatTime(timeNorm);

      const raw = await this._gptComplete([{
        role: 'system',
        content: `Sei un estrattore di operazioni per un sistema prenotazioni ristorante.

Prenotazione attuale:
- Nome: ${r.name}
- Data: ${dateDisplay}
- Orario: ${timeDisplay}
- Persone: ${r.people}
- Note: ${r.notes || 'nessuna'}

Analizza il messaggio e restituisci SOLO JSON con un array di operazioni.

Tipi disponibili:
- update_people: { "type": "update_people", "mode": "absolute"|"delta", "value": N }
  * absolute = numero finale ("siamo in 4", "diventiamo 6")
  * delta = aggiunta/rimozione ("si aggiungono 2", "uno in meno")
  * IMPORTANTE: allergie/note NON sono update_people

- update_time: { "type": "update_time", "mode": "set"|"delta_minutes", "value": "HH:MM:SS"|N }

- update_date: { "type": "update_date", "mode": "set", "value": "YYYY-MM-DD" }
  * Oggi è ${new Date().toISOString().split('T')[0]}

- add_note: { "type": "add_note", "value": "testo nota conciso" }
  * allergie, intolleranze, richieste speciali, occasioni

- info_query: { "type": "info_query", "topic": "argomento" }
  * domande sul ristorante: menu, seggiolone, orari, ecc.

Rispondi SOLO con: {"operations": [...]}
Se nessuna operazione chiara: {"operations": []}`
      }, {
        role: 'user',
        content: transcript
      }], { max_tokens: 200, timeoutMs: 5000 });

      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return parsed?.operations || [];

    } catch (err) {
      console.log('⚠️ _extractOperations error:', err?.message);
      return [];
    }
  }

  // ─── GPT: Classifica risposta (confirm/reject/correction) ─────────────────
  async _classifyResponse(transcript) {
    // Heuristica veloce prima di chiamare GPT
    const t = transcript.toLowerCase();
    const hasSi = /(^|[\s,!?])s[ìi]($|[\s,!?.,])/i.test(transcript) || /^s[ìi]$/i.test(transcript.trim());
    const isExplicitYes = hasSi || /\b(certo|confermo|esatto|giusto|perfetto|ok|okay|va bene|procedi|aggiorna)\b/i.test(t);
    const isExplicitNo  = /^no$/i.test(t.trim()) && transcript.trim().split(/\s+/).length <= 2;

    if (isExplicitYes) return 'confirm';
    if (isExplicitNo)  return 'reject';

    // Se contiene nuovi numeri, date, nomi o note → quasi certamente correzione
    // Numeri sia in cifre che in lettere ("siamo in quattro" è una correzione, non un rifiuto)
    const hasNewEntity = /\b\d+\b/.test(transcript) ||
                         /\b(una|uno|due|tre|quattro|cinque|sei|sette|otto|nove|dieci|undici|dodici)\b/i.test(transcript) ||
                         /\b(lunedì|martedì|mercoledì|giovedì|venerdì|sabato|domenica)\b/i.test(transcript) ||
                         /\b(allergi|intolleran|celiac|vegano|seggiolone|bambino)\b/i.test(transcript);

    if (hasNewEntity) return 'correction';

    // Rifiuto esplicito con parole chiave
    if (/\b(no|annulla|lascia|lasci|fermati|stop|aspetta|cambia)\b/i.test(t)) return 'reject';

    // GPT per i casi ambigui
    try {
      const r = (await this._gptComplete([{
        role: 'system',
        content: 'Il sistema ha mostrato un recap di modifica prenotazione. Classifica la risposta utente. Rispondi SOLO con una parola: confirm, reject, o correction.'
      }, {
        role: 'user',
        content: transcript
      }], { max_tokens: 10, timeoutMs: 2000 }))?.toLowerCase();
      if (['confirm','reject','correction'].includes(r)) return r;
    } catch {}

    return 'correction'; // default safe
  }

  // ─── Applica operazioni slot alla prenotazione ────────────────────────────
  _applySlotOps(r, slotOps) {
    const timeOrig = r.time?.length === 5 ? r.time + ':00' : (r.time || '21:00:00');
    let updDate   = r.date;
    let updTime   = timeOrig;
    let updPeople = Number(r.people);

    for (const op of slotOps) {
      if (op.type === 'update_people') {
        if (op.mode === 'delta') {
          updPeople = Math.max(1, Math.min(50, updPeople + Number(op.value)));
        } else {
          updPeople = Math.max(1, Math.min(50, Number(op.value)));
        }
      }
      if (op.type === 'update_time') {
        if (op.mode === 'set') {
          updTime = op.value.length === 5 ? op.value + ':00' : op.value;
        } else if (op.mode === 'delta_minutes') {
          const [h, m] = timeOrig.split(':').map(Number);
          const total  = h * 60 + m + Number(op.value);
          const nh = Math.floor(total / 60) % 24;
          const nm = total % 60;
          updTime = `${String(nh).padStart(2,'0')}:${String(nm).padStart(2,'0')}:00`;
        }
      }
      if (op.type === 'update_date' && op.mode === 'set') {
        updDate = op.value;
      }
    }

    return { updDate, updTime, updPeople };
  }

  // ─── Risposta info query ──────────────────────────────────────────────────
  async _answerInfoQuery(topic, r) {
    // ── 1) Note-recall: "avete segnato X?" è una domanda su cosa è registrato
    //    SU QUESTA prenotazione → rispondi dalle note (r.notes), non dalla GPT
    //    info-ristorante (che torna null/"Null" perché non è info del locale).
    const notes = (r && r.notes ? String(r.notes) : '').trim();
    if (notes) {
      const topicNorm = (topic || '').toLowerCase();
      // richiesta generica di note/allergie, oppure topic specifico già presente nelle note
      const _generic = /\bnot[ae]\b|allerg|intoller|segnat|annotat|\bdieta\b|celiac|vegan|vegetar/.test(topicNorm);
      const notesNorm = notes.toLowerCase();
      const _topicHit = topicNorm.split(/\s+/).filter(w => w.length >= 4)
        .some(w => notesNorm.includes(w.slice(0, 5)));
      if (_generic || _topicHit) {
        // pulizia note per il cliente: togli annotazioni interne tra parentesi
        const clean = notes.replace(/\s*\([^)]*\)/g, '').replace(/\s*;\s*/g, '; ').trim();
        return clean ? `Sì, risulta annotato: ${clean}.` : null;
      }
    }

    // ── 2) Altrimenti è una domanda sul locale → GPT, con guard null ROBUSTO
    try {
      const context = this._buildInfoContext ? this._buildInfoContext(r) : '';
      const ans = await this._gptComplete([{
        role: 'system',
        content: `Rispondi brevemente a questa domanda sul ristorante. Max 1 frase. Se non hai l'informazione, rispondi null.\n${context}`
      }, {
        role: 'user',
        content: topic
      }], { max_tokens: 80, timeoutMs: 3000 });
      // guard robusto: strip punteggiatura/spazi finali, poi confronta con "null"
      const cleaned = (ans || '').trim().replace(/[.!?\s]+$/, '');
      if (!cleaned || /^null$/i.test(cleaned)) return null;
      return ans;
    } catch {
      return null;
    }
  }

  // ─── Costruisce il messaggio recap ────────────────────────────────────────
  _buildRecap(r, updDate, updTime, updPeople, noteOps, infoAnswers) {
    const dateDisplay = this._formatDate(updDate);
    const timeDisplay = this._formatTime(updTime);

    let msg = `Perfetto ${r.name}! Modifico la sua prenotazione: ${dateDisplay} alle ${timeDisplay} per ${updPeople} persone.`;

    if (noteOps.length > 0) {
      const noteTxt = noteOps.map(o => o.value).join(', ');
      msg += ` Ho aggiunto: ${noteTxt}.`;
    }

    if (infoAnswers.length > 0) {
      msg += ' ' + infoAnswers.join(' ');
    }

    msg += ' Confermo?';
    return msg;
  }

  // ─── Stato leggibile per logging ──────────────────────────────────────────
  getStatus() {
    return {
      state:         this.state,
      activeBooking: this.activeBooking ? `${this.activeBooking.name} ${this.activeBooking.date}` : null,
      pendingOps:    this.pendingOps.length,
    };
  }
}
