// ═══════════════════════════════════════════════════════════════════════════════
// PRENOW REALTIME v4.0 — OpenAI Realtime Client (Dual Session)
//
// Architettura file separati:
//   parsers.js      → DateManager, TimeManager, PeopleManager, ValidationPipeline
//   stt-session.js  → STTSession  (gpt-realtime-whisper, trascrizione PCMU)
//   tts-session.js  → TTSSession  (gpt-realtime-mini, TTS deterministico)
//   turn-manager.js → TurnManager (sliding timer, filtri allucinazioni, turn ID)
//   openai-realtime.js → OpenAIRealtimeClient (orchestrazione + business logic)
// ═══════════════════════════════════════════════════════════════════════════════

import WebSocket from 'ws';
import { DateManager, TimeManager, PeopleManager, IntentDetector,
         ValidationPipeline, isConfirming, isDenying } from './parsers.js';
import { STTSession }   from './stt-session.js';
import { TTSSession }   from './tts-session.js';
import { TurnManager }  from './turn-manager.js';

export { DateManager, TimeManager, PeopleManager, IntentDetector,
         ValidationPipeline, isConfirming, isDenying };

console.log('🟢 openai-realtime.js v11.DUAL-2026-05-15 caricato');

export class OpenAIRealtimeClient {
  constructor(opts = {}) {
    this.apiKey           = opts.apiKey;
    this.systemPrompt     = opts.systemPrompt || '';
    this.restaurantConfig = opts.restaurantConfig || {};

    // Callbacks verso media-stream.js
    this.onAudioDelta = opts.onAudioDelta || (() => {});
    this.onTranscript = opts.onTranscript || (() => {});
    this.onError      = opts.onError      || console.error;
    this.onClose      = opts.onClose      || (() => {});

    // Normalizza callerPhone
    const _rawPhone = opts.callerPhone || '';
    this.callerPhone = _rawPhone && !_rawPhone.startsWith('+') ? '+' + _rawPhone : _rawPhone;

    // ── Sessioni OpenAI ──────────────────────────────────────────────────────
    this.sttSession = null;
    this.ttsSession = null;
    this._ttsPlaying   = false;  // TTS sta riproducendo audio
    this._lastSaidAt   = 0;      // timestamp fine audio TTS (per deaf period)

    // ── Turn management (delegato a TurnManager) ───────────────────────────
    this.turnManager = null;   // istanziato in connect()
    // Nota: accumulazione transcript rimossa — TurnManager usa completed event

    // ── Stato business logic (invariato dal beta) ────────────────────────────
    this.data = { date: null, time: null, people: null, name: null, notes: null, alternativePhone: null };
    // FIX 5: entity provenance — traccia la sorgente di ogni campo
    // 'parser' = estratto deterministicamente | 'gpt' = gap fill da ambiguity resolver
    this._meta = { dateSource: null, timeSource: null, peopleSource: null, nameSource: null };
    this.phase         = 'collecting';
    this.intent        = null;
    this.existingRes   = null;
    this.availDone     = false;
    this.checkingSlot  = false;

    // Dialog state: context-aware parsing
    this._pendingQuestion = null; // 'date'|'time'|'people'|'name'|null

    // STEP 1: conversationLocked separato da phase=done (GPT suggestion)
    // phase=done = "esiste una prenotazione" — NON = "hard stop globale"
    // conversationLocked = true solo quando la conversazione è davvero chiusa
    this.conversationLocked = false;

    // MODIFY / CANCEL state machine
    this.modifyState       = null;
    this.cancelState       = null;
    this._smartModifyParams = null;
    this._noteCheck         = false;
    this.foundReservation  = null;

    // Anti-loop flags
    this._sessionReady     = false;
    this._processingModify = false;

    // STEP 6: Interrupt safety
    // true quando l'utente ha parlato sopra il bot — invalida la domanda corrente
    this.interrupted = false;

    // GPT name fallback cache — evita doppie inferenze su stesso transcript
    this._gptNameCache = new Map();

    // Conversational history buffer (ultimi 3 turni = 6 messaggi max)
    // Pattern GPT: "cosa significa questa frase nel contesto" → state machine decide
    this._conversationHistory = [];
    this._historyMaxTurns = 3;

    // FIX 4: Dedup anti-loop — evita re-resolution continua sullo stesso contesto
    // TTL breve: 2 turni — dopo di che il contesto è cambiato abbastanza
    this._lastAmbiguityResolution = null; // { transcript, result, turn }
    this._ambiguityTurnCounter = 0;

    // STEP 1 (GPT): Intent lock — quando siamo in modify/cancel flow attivo
    // l'intent globale NON deve mai sovrascrivere lo stato locale
    // flow state > transcript intent (regola fondamentale dialog engine)
    this.intentLocked = false;

    // STEP 3 (GPT): Topic memory — per follow-up su note senza ripetere keyword
    // es: "lo avete?" dopo aver parlato di seggiolone → risponde sulle note
    this._lastTopic = null; // 'notes' | 'date' | 'time' | 'people' | null

    // Lingua
    this.language = 'it';

    // Info ristorante (caricata async)
    this._restaurantInfo = null;
  }

  // ── Connect: crea le due sessioni in sequenza ─────────────────────────────
  //
  // ORDINE CRITICO:
  //   1. STT pronta → routing audio attivo
  //   2. TTS pronta → greeting inviato
  //
  // Se TTS parte prima che STT sia pronta → timeout STT (bug noto con Twilio/Telnyx)

  async connect() {
    // 1. STT Session
    // ── TurnManager: sliding timer + filtri ──────────────────────────────
    this.turnManager = new TurnManager({
      slidingMs:   1800,
      onTurnReady:  (transcript) => this._onTurnReady(transcript),
      onInterrupt: () => {
        // STEP 6: utente parla sopra il bot — cancella TTS e setta flag interrupted
        if (this._ttsPlaying) {
          this.ttsSession?.cancel();
          this._ttsPlaying = false;
        }
        if (!this.interrupted) {
          this.interrupted = true;
          console.log('🛑 Interrupt: utente parla sopra bot');
        }
      },
    });

    this.sttSession = new STTSession(this.apiKey, {
      language: 'it',
      onDelta:         (delta) => this.turnManager.onDelta(delta),
      onCompleted:     (text)  => this.turnManager.onCompleted(text),
      onSpeechStarted: ()      => this.turnManager.onSpeechStarted(),
      onError:         (err)   => this.onError(err),
      onClose:         (code)  => { if (code !== 1000) this.onClose(code); },
    });
    await this.sttSession.connect();

    // 2. TTS Session
    this.ttsSession = new TTSSession(this.apiKey, {
      voice: this.restaurantConfig?.voice || 'coral',
      onAudioDelta: (chunk) => this.onAudioDelta(chunk),
      onAudioDone:  ()      => {
        this._ttsPlaying = false;
        // Buffer 800ms: compensa latenza riproduzione Telnyx dopo generazione OpenAI
        setTimeout(() => { this._lastSaidAt = Date.now(); }, 800);
        console.log('🔊 [TTS] Fine audio');
      },
      onError: (err) => this.onError(err),
    });
    await this.ttsSession.connect();

    // 3. Carica info ristorante in background (non blocca)
    this._fetchAndInjectRestaurantInfo();

    // 4. Greeting — DOPO che entrambe le sessioni sono pronte
    if (!this._sessionReady) {
      this._sessionReady = true;
      this._onSessionReady();
    }
  }

  // ── Speech Started: nuovo turno in arrivo ────────────────────────────────
  // Usato solo per preparare lo stato — il turno vero parte con il primo delta

  // ── Bridge TurnManager → business logic ─────────────────────────────────
  // Chiamato da TurnManager quando il turno è finalizzato.
  async _onTurnReady(transcript) {
    // Filtro primo turno troppo breve (rumore di fondo)
    const _isFirstTurn = !this.data.date && !this.data.time && !this.data.people && !this.data.name;
    if (_isFirstTurn && transcript.split(/\s+/).length < 3) {
      console.log(`🛡️ Primo turno troppo breve → ignorato: "${transcript}"`);
      return;
    }

    if (this._isLowInformationTranscript(transcript)) return;

    // STEP 6: reset interrupted
    this.interrupted = false;

    console.log(`💬 [user]: ${transcript}`);

    // BUG 1: info query side channel — intercetta domande informative PRIMA del flow
    // NON muta state, risponde e continua (se non in booking flow attivo)
    // Side channel: segnali strutturali forti (menu, seggiolone, orari)
    // Il pre-routing in _processExtraction gestisce i casi semantici (dolci, primi, ecc.)
    if (this._isInformationalQuery(transcript) && !this.modifyState && !this.cancelState && this.phase !== 'done') {
      console.log('ℹ️ Info query strutturale → side channel risposta');
      const _handled = await this._handleInfoQuery(transcript);
      if (_handled) return;
    }
    this.lastTranscript = transcript;
    this.onTranscript(transcript, 'user');

    // Aggiorna history buffer — mantieni ultimi N turni
    this._ambiguityTurnCounter++; // FIX 4: incrementa per dedup TTL
    this._conversationHistory.push({ role: 'user', content: transcript });
    if (this._conversationHistory.length > this._historyMaxTurns * 2) {
      this._conversationHistory.splice(0, 2);
    }

    // Aggiorna lingua rilevata
    const detectedLang = this._detectLanguage(transcript);
    if (detectedLang !== 'it' && transcript.split(/\s+/).length >= 3) {
      this.language = detectedLang;
      console.log(`🌐 Lingua rilevata: ${this.language}`);
    }

    // Intercetta stati speciali PRIMA dell'estrazione
    if (this.cancelState === 'awaiting_confirm') {
      await this._handleCancelConfirmText(transcript).catch(console.error);
      return;
    }
    if (this.modifyState === 'awaiting_smart_confirm') {
      await this._handleSmartModifyConfirm(transcript).catch(console.error);
      return;
    }

    // Parsing locale + business logic
    const _notesHandled = await this._detectNotesAndPhone(transcript);
    if (_notesHandled) return; // BUG 6: note post-confirm già gestite con risposta — stop
    const args = await this._extractFromTranscript(transcript);
    await this._processExtraction(args).catch(err => console.error('❌ _processExtraction:', err));
  }


  // ── Filtro Whisper hallucination ─────────────────────────────────────────
  // Whisper su audio corto/silenzioso "completa" con pattern frequenti nel
  // training data (sottotitoli, watermark, ecc.). Questo filtro li scarta.
  // ── _applyExtraction() — mutazione stato centralizzata (STEP 5) ──────────────
  // Unico punto dove this.data viene aggiornato dai campi estratti.
  // NON mutare this.data altrove per i campi principali — passa sempre di qui.
  // Ritorna oggetto con i campi effettivamente cambiati per il logging.
  _applyExtraction(extracted) {
    const changed = {};
    const rc = this.restaurantConfig;

    // Date
    if (extracted.date && extracted.date !== 'null' && extracted.date !== this.data.date) {
      changed.date = { from: this.data.date, to: extracted.date };
      this.data.date = extracted.date;
      this._meta.dateSource = 'parser';
      if (this._pendingQuestion === 'date') this._pendingQuestion = null;
    }

    // Time
    if (extracted.time && extracted.time !== 'null' && extracted.time !== this.data.time) {
      changed.time = { from: this.data.time, to: extracted.time };
      this.data.time = extracted.time;
      this._meta.timeSource = 'parser';
      if (this._pendingQuestion === 'time') this._pendingQuestion = null;
    }

    // People — con lock anti-overwrite
    if (extracted.people && extracted.people !== 'null') {
      const newP = parseInt(extracted.people, 10);
      if (newP !== this.data.people) {
        const transcriptPeople = this.lastTranscript ? PeopleManager.parseFromText(this.lastTranscript) : null;
        if (transcriptPeople === null && this.data.people !== null) {
          console.log(`🔒 People locked (${this.data.people}): transcript senza numeri espliciti`);
        } else {
          changed.people = { from: this.data.people, to: newP };
          this.data.people = newP;
          if (this._pendingQuestion === 'people') this._pendingQuestion = null;
        }
      }
    }

    // Name — con protezione anti-overwrite involontario
    if (extracted.name && extracted.name !== 'null') {
      if (!this.data.name) {
        changed.name = { from: null, to: extracted.name };
        this.data.name = extracted.name;
        if (this._pendingQuestion === 'name') this._pendingQuestion = null;
      } else if (extracted.name !== this.data.name && this.lastTranscript &&
                 /\bmi chiamo\b|\bsono\b|\bil mio nome\b|\bno.*mi chiamo\b|\ba nome\b|\bchiamati\b/i.test(this.lastTranscript)) {
        changed.name = { from: this.data.name, to: extracted.name };
        this.data.name = extracted.name;
        if (this._pendingQuestion === 'name') this._pendingQuestion = null;
      }
    }

    // Log campi cambiati con provenance
    for (const [field, val] of Object.entries(changed)) {
      const icons = { date: '📅', time: '⏰', people: '👥', name: '👤' };
      console.log(`${icons[field] || '•'} ${field}: ${val.from ?? 'null'} → ${val.to}`);
    }

    return changed;
  }

  _isLowInformationTranscript(transcript) {
    if (!transcript) return true;
    const t = transcript.trim().toLowerCase();

    // Pattern noti di Whisper hallucination su silenzio/rumore PSTN
    const HALLUCINATION_PATTERNS = [
      'amara.org', 'sottotitoli', 'subscri', 'grazie per aver guardato',
      'iscriviti', 'metti mi piace', 'campana delle notifiche',
      'all rights reserved', 'copyright', 'traduzione', 'sottotitolat',
      'comunità amara', 'caption', 'transcript provided',
    ];

    for (const p of HALLUCINATION_PATTERNS) {
      if (t.includes(p)) {
        console.log('🚫 Hallucination filtrata: "' + transcript.substring(0, 60) + '"');
        return true;
      }
    }

    // Testo troppo corto per avere significato reale (< 2 parole utili)
    const words = t.replace(/[.,!?]/g, '').split(/\s+/).filter(w => w.length > 1);
    if (words.length === 0) {
      console.log('🚫 Transcript vuoto/minimo ignorato');
      return true;
    }

    return false;
  }

  async _extractFromTranscript(transcript) {
    const pq = this._pendingQuestion;
    const isShort = transcript.trim().split(/\s+/).length <= 3;

    // PSTN normalization: Whisper su 8kHz trascrive "all'una" in vari modi
    // Normalizziamo prima di passare a qualsiasi parser
    let normalizedTranscript = transcript
      .replace(/\ba\s+luna\b/gi, "all'una")       // "a luna" → "all'una"
      .replace(/\balluna\b/gi, "all'una")            // "alluna" → "all'una"
      .replace(/\ball'\s*una\b/gi, "all'una")       // "all' una" → "all'una"
      .replace(/\bal\s+una\b/gi, "all'una");        // "al una" → "all'una"

    // FIX 4: pre-normalizza orari ambigui prima di passare a PeopleManager
    // "all'una" / "alle undici" / "all'una e mezza" contengono numeri che
    // PeopleManager potrebbe catturare come pax. Li mascheramo temporaneamente.
    const TIME_CLAIM_RE = /\b(?:all[ae]?['']?|ore?)\s*['']?\s*(?:una|uno|due|tre|quattro|cinque|sei|sette|otto|nove|dieci|undici|dodici|mezzanotte|mezzogiorno|\d{1,2})(?:\s+e\s+(?:mezza|mezzo|un quarto|quarto))?/gi;
    const transcriptForPeople = normalizedTranscript.replace(TIME_CLAIM_RE, '__ORARIO__');

    // Livello 1: estrazione opportunistica su tutti i campi
    const date   = DateManager.parseFromText(normalizedTranscript);
    const time   = TimeManager.parseFromText(normalizedTranscript);
    const people = PeopleManager.parseFromText(transcriptForPeople);

    // Livello 2: nome a 4 livelli di confidenza
    // L1 NAMING (pq=name o phase=naming)  → _extractName completo con fallback
    // L2 Frase breve (≤4 parole)          → _extractNameExplicit
    // L3 Frase lunga, pattern espliciti   → _extractNameSafe (no "sono X")
    // L4 Frase lunga, ambigua, no nota    → _extractNameWithGPT (async, 2s timeout)
    let name;
    const _wordCount = transcript.trim().split(/\s+/).length;
    if (pq === 'name' || this.phase === 'naming') {
      name = this._extractName(transcript);
    } else if (_wordCount <= 4) {
      name = this._extractNameExplicit(transcript);
    } else {
      // L3: pattern safe (mi chiamo, a nome, ecc.)
      name = this._extractNameSafe(transcript);

      // L4: GPT fallback — solo se safe non trova nulla, nome non già noto,
      // e il transcript non contiene parole chiave note/allergie
      if (!name && !this.data.name) {
        const _hasNoteKw = /(allerg|intoller|vegano|vegetar|seggiolone|carrozzina|celiaco|disabile)/i.test(transcript);
        if (!_hasNoteKw) {
          // Chiamata async — wrappata per non bloccare se GPT è lento
          name = await this._extractNameWithGPT(transcript).catch(() => null);
        }
      }
    }

    // Penalizza campi non attesi su risposte brevi con contesto noto
    const extracted = { date, time, people, name };
    if (pq && isShort) {
      console.log('\u{1F3AF} Guided extraction (short): pq=' + pq + ' "' + transcript + '"');
      if (pq === 'people') {
        extracted.name = null;
        extracted.date = null;
        extracted.time = null;
      } else if (pq === 'time') {
        extracted.name = null;
        extracted.people = null; // non sovrascrivere pax già acquisiti
      } else if (pq === 'date') {
        extracted.name = null;
      } else if (pq === 'name') {
        extracted.date = null;
        extracted.time = null;
        extracted.people = null;
      }
    }

    // STEP 6: se l'utente ha interrotto il bot, considera reset _pendingQuestion
    // solo se l'interrupt era significativo (bot stava parlando da > 500ms)
    // Per ora: mantieni il contesto — l'interrupt potrebbe essere rumore PSTN

    // STEP 3: _pendingQuestion persiste fino a slot acquisito o intent switch esplicito
    // GPT: la lunghezza della frase NON è indicatore di topic switch
    // es: "sì guardi siamo in quattro perché arriva anche mia moglie" > 6 parole ma è ancora people
    // Reset solo se non c'era nessun contesto attivo
    if (!pq) {
      this._pendingQuestion = null;
    }
    // Se c'era un contesto attivo (_pendingQuestion settato), lo manteniamo
    // Verrà resettato quando il campo viene acquisito con successo (in _processExtraction)

    let intent = IntentDetector.detect(transcript);
    const detectedLang = this._detectLanguage(transcript);
    if (detectedLang !== 'it' && transcript.split(/\s+/).length >= 3) {
      this.language = detectedLang;
      console.log('\u{1F310} Lingua: ' + this.language);
    }
    const note_check    = /(?:hai|avete)\s+(?:\w+\s+){0,2}(?:segnato|annotato|scritto)/i.test(transcript);
    const people_change = /\bcambiar[ei]\s+(?:il numero di\s+)?person[ae]\b/i.test(transcript);
    const unclear       = transcript.trim().split(/\s+/).length < 2;

    // ── STEP GPT: Conversational history resolution (solo se ambiguo) ─────────
    // Chiama GPT con gli ultimi 3 turni SOLO quando i parser locali non bastano
    // Costo aggiuntivo stimato: ~$0.20/mese su 1200 chiamate — trascurabile
    let _ambiguityResult = null;
    if (this._isAmbiguous(transcript, extracted)) {
      _ambiguityResult = await this._resolveAmbiguity(transcript).catch(() => null);
      if (_ambiguityResult) {
        // FIX 1+3 (GPT): il prompt non ritorna più "intent" — solo reference/entities
        // confirmation e correction come hint per la state machine
        if (_ambiguityResult.confirmation === true && intent === 'unknown') {
          console.log('🧠 Ambiguity: conferma rilevata dal contesto');
        }
        if (_ambiguityResult.correction === true) {
          console.log('🧠 Ambiguity: correzione rilevata dal contesto');
        }

        // FIX 1 HARDCODED (GPT): parser deterministico = authority ASSOLUTA
        // GPT può SOLO riempire buchi — MAI correggere, sostituire o reinterpretare il parser
        // Su transcript ≤ 3 parole: GPT non produce nuove entity strutturate (solo reference/confirm)
        const _transcriptWords = (transcript || '').trim().split(/\s+/).length;
        if (_ambiguityResult.entities && _transcriptWords > 3) {
          const e = _ambiguityResult.entities;
          // HARD RULE: if (local == null && gpt != null) → OK. if (local != null) → GPT ignorato.
          if (e.people != null && extracted.people == null) { extracted.people = e.people; this._meta.peopleSource = 'gpt'; }
          if (e.date   != null && extracted.date   == null) { extracted.date   = e.date;   this._meta.dateSource   = 'gpt'; }
          if (e.time   != null && extracted.time   == null) { extracted.time   = e.time;   this._meta.timeSource   = 'gpt'; }
          if (e.name   != null && extracted.name   == null) { extracted.name   = e.name;   this._meta.nameSource   = 'gpt'; }
          if (e.note   != null && !extracted.notes)         { extracted.notes  = [e.note]; }
        }
      }
    }

    return {
      date:              extracted.date   || 'null',
      time:              extracted.time   || 'null',
      people:            extracted.people ? String(extracted.people) : 'null',
      name:              extracted.name   || 'null',
      intent,
      language:          this.language,
      notes:             [],
      phone_alternative: null,
      note_check,
      people_change,
      unclear,
    };
  }


  // ── Rilevamento lingua semplice ────────────────────────────────────────────
  _detectLanguage(text) {
    const t = text.toLowerCase();
    if (/\b(the|is|are|hello|please|want|book|reservation|cancel)\b/.test(t)) return 'en';
    if (/\b(bonjour|réserver|je veux|merci|annuler)\b/.test(t)) return 'fr';
    if (/\b(hola|reservar|quiero|gracias|cancelar)\b/.test(t)) return 'es';
    if (/\b(danke|reservierung|möchte|bitte|stornieren)\b/.test(t)) return 'de';
    return 'it';
  }

  // ── Filtro allucinazioni Whisper note ─────────────────────────────────────

  // ── Session Ready → Greeting ──────────────────────────────────────────────
  _onSessionReady() {
    const rc = this.restaurantConfig;
    const nome = rc?.restaurant_name || 'ristorante';
    this._say(`Buongiorno! Benvenuto a ${nome}. Per quale giorno desidera prenotare?`);
  }

  // ── _say: routing al TTS session ─────────────────────────────────────────
  //
  // Tutte le risposte del bot passano da qui → nessuna risposta libera di GPT.
  // Stessa firma del vecchio _say() — nessuna modifica alla business logic.

  static THINKING_PHRASES = {
    'Un attimo che verifico la disponibilità...': {
      en: 'Just a moment while I check availability...',
      fr: 'Un instant, je vérifie la disponibilité...',
      es: 'Un momento mientras verifico la disponibilidad...',
      de: 'Einen Moment, ich prüfe die Verfügbarkeit...',
    },
    'Un momento, cerco la prenotazione...': {
      en: 'Just a moment, looking for your reservation...',
      fr: 'Un instant, je cherche votre réservation...',
      es: 'Un momento, busco su reserva...',
      de: 'Einen Moment, ich suche Ihre Reservierung...',
    },
    'Perfetto, aggiorno subito...': {
      en: 'Perfect, updating right away...',
      fr: 'Parfait, je mets à jour immédiatement...',
      es: 'Perfecto, actualizando ahora mismo...',
      de: 'Perfekt, ich aktualisiere sofort...',
    },
    'Un attimo che procedo con la cancellazione...': {
      en: 'Just a moment while I process the cancellation...',
      fr: 'Un instant pendant que je procède à l\'annulation...',
      es: 'Un momento mientras proceso la cancelación...',
      de: 'Einen Moment, ich bearbeite die Stornierung...',
    },
    'Perfetto! A che nome faccio la prenotazione?': {
      en: 'Perfect! What name should I put the reservation under?',
      fr: 'Parfait ! À quel nom dois-je faire la réservation ?',
      es: '¡Perfecto! ¿A qué nombre hago la reserva?',
      de: 'Perfekt! Auf welchen Namen soll ich die Reservierung machen?',
    },
    'A che nome faccio la prenotazione?': {
      en: 'What name should I put the reservation under?',
      fr: 'À quel nom dois-je faire la réservation ?',
      es: '¿A qué nombre hago la reserva?',
      de: 'Auf welchen Namen soll ich die Reservierung machen?',
    },
    'Certo! A che nome è la prenotazione e per quale data?': {
      en: 'Of course! What name is the reservation under and for what date?',
      fr: 'Bien sûr ! Quel est le nom de la réservation et pour quelle date ?',
      es: 'Por supuesto! ¿A qué nombre está la reserva y para qué fecha?',
      de: 'Natürlich! Auf welchen Namen läuft die Reservierung und für welches Datum?',
    },
    'Nessun problema, la prenotazione rimane invariata. Arrivederci!': {
      en: 'No problem, your reservation remains unchanged. Goodbye!',
      fr: 'Pas de problème, votre réservation reste inchangée. Au revoir !',
      es: 'Sin problema, su reserva permanece sin cambios. ¡Hasta pronto!',
      de: 'Kein Problem, Ihre Reservierung bleibt unverändert. Auf Wiedersehen!',
    },
    'Non ho capito. Conferma la cancellazione? Dica sì o no.': {
      en: 'I didn\'t understand. Do you confirm the cancellation? Please say yes or no.',
      fr: 'Je n\'ai pas compris. Confirmez-vous l\'annulation ? Dites oui ou non.',
      es: 'No he entendido. ¿Confirma la cancelación? Diga sí o no.',
      de: 'Ich habe das nicht verstanden. Bestätigen Sie die Stornierung? Bitte sagen Sie ja oder nein.',
    },
  };

  // FIX 2 (GPT): filtra filler/thinking messages dalla history
  // Salva SOLO messaggi semanticamente rilevanti — NON progress/filler
  _isSemanticMessage(text) {
    const NON_SEMANTIC = [
      'Un attimo', 'Verifico', 'Aggiorno', 'Controllo', 'Procedo',
      'Un momento', 'Cerco la prenotazione', 'verifico la disponibilità',
      'aggiorno subito', 'procedo con la cancellazione', 'Perfetto, aggiorno'
    ];
    return !NON_SEMANTIC.some(filler => text.includes(filler));
  }

  _say(text) {
    console.log(`💉 [say]: ${text.substring(0, 100)}`);
    // Registra SOLO messaggi semantici nella history — no filler/thinking phrases
    if (text && text.trim() && this._isSemanticMessage(text)) {
      this._conversationHistory.push({ role: 'assistant', content: text });
      if (this._conversationHistory.length > this._historyMaxTurns * 2) {
        this._conversationHistory.splice(0, 2);
      }
    }
    const lang = this.language || 'it';
    this._ttsPlaying = true;

    if (lang === 'it') {
      this.ttsSession.speak(text, 'it');
      return;
    }

    // Cerca frase pre-tradotta (evita allucinazioni)
    const preTranslated = OpenAIRealtimeClient.THINKING_PHRASES[text]?.[lang];
    if (preTranslated) {
      this.ttsSession.speak(preTranslated, lang);
      return;
    }

    // Frase dinamica → TTS con traduzione
    this.ttsSession.speakTranslated(text, lang);
  }

  // Compatibilità con il vecchio codice che usa _sayDirect
  _sayDirect(text) {
    this._say(text);
  }

  // ── Audio da Telnyx → STT session ─────────────────────────────────────────
  sendAudio(pcmuBase64) {
    this.sttSession?.sendAudio(pcmuBase64);
  }

  // ── Chiudi entrambe le sessioni ───────────────────────────────────────────
  close() {
    this.turnManager?.reset();
    this.sttSession?.close();
    this.ttsSession?.close();
  }



  async _processExtraction(args) {
    if (this.checkingSlot) return;

    const rc = this.restaurantConfig;

    // ── Walk-in detection: "tra X minuti/ora" ────────────────────────────────
    // Se il cliente chiede disponibilità immediata, calcola l'orario reale
    // e tratta come CREATE con data=oggi e time=adesso+offset
    // Scatta su qualsiasi intent, incluso unknown
    if (this.lastTranscript && this.phase !== 'done') {
      const _t = this.lastTranscript;
      // Pattern esteso: gestisce "mezz'ora" / "mezzora" come caso speciale
      const _walkInPat = /(?:tra|fra)\s+(?:(?:un[ao]?\s+)?(\w+)\s*(minuti?|quarti?\s+d['']?ora|mezz['']?ora|ora[e]?|quarto)|mezz['']?ora)/i;
      const _mWalk = _t.match(_walkInPat);
      if (_mWalk && !args._walkInHandled) {
        // Calcola offset in minuti
        const _numStr = (_mWalk[1] || '').toLowerCase();
        const _unit   = (_mWalk[2] || '').toLowerCase();
        // Caso speciale "tra mezz'ora" / "tra mezzora" senza gruppo catturato
        const _isMezzOra = /tra\s+mezz['']?ora/i.test(_t) || /fra\s+mezz['']?ora/i.test(_t);
        const _numMap = { uno:1, una:1, due:2, tre:3, quattro:4, cinque:5, sei:6,
                          sette:7, otto:8, nove:9, dieci:10, quindici:15, venti:20,
                          trenta:30, quaranta:40, cinquanta:50, sessanta:60, un:1, mezz:30, mezzo:30 };
        let _mins = _isMezzOra ? 30 : (_numMap[_numStr] || parseInt(_numStr) || 0);
        if (!_isMezzOra && /mezz/.test(_unit)) _mins = 30;
        else if (!_isMezzOra && /ora/.test(_unit) && !/mezz/.test(_numStr)) _mins = (_mins || 1) * 60;
        else if (!_isMezzOra && /quarto/.test(_unit)) _mins = 15;

        if (_mins > 0) {
          // Calcola orario adesso + offset nel fuso del ristorante
          const _tz = rc?.timezone || 'Europe/Rome';
          const _now = new Date();
          const _targetMs = _now.getTime() + _mins * 60000;
          const _target = new Date(_targetMs);
          const _hh = String(_target.toLocaleTimeString('it-IT', { timeZone: _tz, hour: '2-digit' })).padStart(2,'0');
          const _mm = String(_target.toLocaleTimeString('it-IT', { timeZone: _tz, minute: '2-digit' })).padStart(2,'0');
          const _calcTime = `${_hh}:${_mm}:00`;
          const _todayISO = _now.toLocaleDateString('sv-SE', { timeZone: _tz });
          console.log(`🚶 Walk-in rilevato: "${_t}" → +${_mins}min → ${_calcTime}`);
          // Resetta lastTranscript per evitare loop infinito al rientro
          this.lastTranscript = null;
          // Re-entra come CREATE con data=oggi e time calcolato
          await this._processExtraction({ ...args, intent: 'create', date: _todayISO, time: _calcTime,
                                        people: args.people || null, name: args.name || null, _walkInHandled: true });
          return;
        }
      }
    }

    let   newDate   = (args.date   && args.date   !== 'null') ? args.date   : null;
    let   newTime   = (args.time   && args.time   !== 'null') ? args.time   : null;
    let   newPeople = (args.people && args.people !== 'null') ? parseInt(args.people) : null;
    // BUG 1 FIX: pulizia nome — rimuove parole non-nome aggiunte da GPT
    // es: "Rossi Per Sabato" → "Rossi", "Ferrari Alle 21" → "Ferrari"
    const _rawName = (args.name && args.name !== 'null') ? args.name.trim() : null;
    const newName = _rawName
      ? _rawName.replace(/\s+(per|sabato|domenica|lunedì|martedì|mercoledì|giovedì|venerdì|sera|pranzo|cena|stasera|domani|oggi|alle|a|il|la|lo|le|un|una)\b.*/i, '').trim()
      : null;

    // 🆕 GPT-ONLY: cross-check data rimosso — GPT gestisce domani/oggi/stasera
    // con le regole esplicite nel prompt e il calendario iniettato.

    // Cross-check orario server-side: corregge GPT quando ignora la regola sera
    // Regola: ore 1-10 senza qualificatore mattina/pranzo → forza PM (es: "alle 9" → 21:00)
    if (newTime && this.lastTranscript) {
      const _tr = this.lastTranscript;
      const _tParts = newTime.split(':').map(Number);
      const _h = _tParts[0];
      const _m = _tParts[1] || 0;
      const _isSmallHour = _h >= 1 && _h <= 10;
      const _hasMattina = /\b(di mattina|mattina|colazione|a pranzo|pranzo|stamattina|stamani)\b/i.test(_tr);
      const _hasExplicitLargeHour = /\b(21|22|23|20|19|18|17|16|15|14|13)[:h]|alle\s+2[0-3]\b|alle\s+1[3-9]\b/i.test(_tr);
      if (_isSmallHour && !_hasMattina && !_hasExplicitLargeHour) {
        const _newH = _h + 12;
        const _newTime = String(_newH).padStart(2,'0') + ':' + String(_m).padStart(2,'0') + ':00';
        console.log(`⏰ Time cross-check: ${_h}:${String(_m).padStart(2,'0')} → ${_newTime} (regola sera server-side)`);
        args = { ...args, time: _newTime };
        newTime = _newTime; // aggiorna la variabile locale per tutti i check successivi
      }
    }

    // 🆕 GPT-ONLY: cross-check persone rimosso — GPT estrae il numero direttamente.

    // ── Note estratte da GPT ──────────────────────────────────────────────────
    // 🆕 ARCHITETTURA GPT-ONLY: GPT estrae le note direttamente dall'audio
    this._noteCheck    = args.note_check    === true; // 🆕 true se chiede di note esistenti
    this._peopleChange = args.people_change === true; // 🆕 true se vuole CAMBIARE le persone
    if (args.notes && Array.isArray(args.notes) && args.notes.length > 0) {
      args.notes.forEach(note => {
        const noteStr = String(note).trim();
        if (noteStr && (!this.data.notes || !this.data.notes.includes(noteStr))) {
          this.data.notes = this.data.notes ? `${this.data.notes}; ${noteStr}` : noteStr;
          console.log(`📝 Nota (GPT): "${noteStr}"`);
        }
      });
      // Se siamo in phase=done e abbiamo nuove note, aggiorna subito il Calendar
      if (this.phase === 'done' && this.lastReservation?.eventId) {
        const _mergedNotes = this._mergeNotesStr(this.lastReservation.notes || '', this.data.notes || '');
        if (_mergedNotes !== this.lastReservation.notes) {
          console.log(`📝 Phase=done: nuove note GPT, aggiorno Calendar: "${_mergedNotes}"`);
          this._callAppsScript({
            action: 'update_notes',
            eventId: this.lastReservation.eventId,
            notes: _mergedNotes,
          }).then(() => {
            if (this.lastReservation) this.lastReservation.notes = _mergedNotes;
          }).catch(err => console.error('❌ update_notes GPT:', err));
        }
      }
    }

    // ── Telefono alternativo estratto da GPT ──────────────────────────────────
    if (args.phone_alternative && args.phone_alternative !== 'null' && !this.data.alternativePhone) {
      const _rawPhone = String(args.phone_alternative).replace(/\D/g, '');
      if (_rawPhone.length >= 9) {
        const _formattedPhone = _rawPhone.startsWith('39') ? `+${_rawPhone}` : `+39${_rawPhone}`;
        this.data.alternativePhone = _formattedPhone;
        console.log(`📞 Telefono alternativo (GPT): "${_formattedPhone}"`);
        // Appende alle note così arriva ad Apps Script (non esiste campo dedicato)
        const _phoneNote = `Tel. alternativo: ${_formattedPhone}`;
        if (!this.data.notes || !this.data.notes.includes('Tel. alternativo')) {
          this.data.notes = this.data.notes ? `${this.data.notes}; ${_phoneNote}` : _phoneNote;
        }
      }
    }

    // ── Aggiorna lingua rilevata ─────────────────────────────────────────────
    // Guard: cambia lingua solo se il transcript corrente contiene almeno 3 parole
    // ed è coerente con la lingua rilevata. Evita false detections su parole corte
    // ambigue (es: "Salve" → es, "Merci" → fr su un singolo termine).
    if (args.language && args.language !== this.language) {
      const transcriptWordCount = this.lastTranscript ? this.lastTranscript.trim().split(/\s+/).length : 0;
      if (transcriptWordCount >= 3) {
        this.language = args.language;
        console.log(`🌐 Lingua rilevata da GPT: ${this.language}`);
      } else {
        console.log(`🌐 Lingua GPT=${args.language} ignorata (transcript troppo corto: "${this.lastTranscript}")`);
      }
    }

    // ── Fix 1: CANCEL confirm intercetta anche qui (GPT più veloce di Whisper) ─
    if (this.cancelState === 'awaiting_confirm') {
      // Non fare nulla — la conferma è gestita via testo in _onUserText
      // ma se GPT rileva un cancel/unknown, ignoriamo per non interferire
      return;
    }

    // 🆕 SMART MODIFY confirm: GPT ignorato durante attesa conferma
    if (this.modifyState === 'awaiting_smart_confirm') {
      console.log('🔒 GPT result ignorato: smart confirm MODIFY in attesa');
      return;
    }

    // ══ HARD LOCK: modifyState attivo → nessun reset automatico ══════════════
    // Nel modify flow l'utente PUÒ dire date/ore/numeri senza voler fare una nuova prenotazione.
    // Reset SOLO con frasi esplicite: "voglio fare una nuova prenotazione", "annulla tutto", ecc.
    if (this.modifyState && this.modifyState !== 'done' && this.modifyState !== 'idle' && this.modifyState !== 'awaiting_smart_confirm') {
      const _explicitExit = /\b(?:nuova\s+prenotazione|voglio\s+prenotare\s+(?:un|un')\s+altro|annulla\s+tutto|lasci\s+stare|ripartiamo|lasciate?\s+perdere)\b/i.test(this.lastTranscript || '');
      if (!_explicitExit) {
        console.log(`🔒 HARD LOCK: modifyState=${this.modifyState}, blocco reset`);
        args.intent = 'modify';
      }
    }


    // ══ PRE-ROUTING LAYER (GPT raccomandazione) ══════════════════════════════
    // Prima del booking flow: intercetta domande sul locale
    // Intent=create NON significa sempre "vuole prenotare" — è anche il fallback catch-all
    // Segnali strutturali (no entity + frame interrogativo) → GPT risponde dal menu
    if (!this.modifyState && !this.cancelState && this.phase !== 'done') {
      const _isInfoQ = await this._shouldHandleAsRestaurantInfo(this.lastTranscript || '', {
        date: newDate, time: newTime, people: newPeople
      });
      if (_isInfoQ) {
        const _handled = await this._handleInfoQuery(this.lastTranscript || '');
        if (_handled) return; // GPT ha risposto → stop, NON mutare phase
        // GPT dice NOT_RESTAURANT → continua il booking flow normalmente
      }
    }

    // ── Fix 3: Phase=done — gestisce saluti, ringraziamenti e nuovi intent ────
    if (this.phase === 'done') {
      const intent = args.intent;

      // Fix 3A: "Pronto?" = segnale telefonico
      if (this.lastTranscript) {
        const _prontoPat = /^(pronto|pronto\?|ci sei|mi senti|sei li|sei l[ìi]|sento|hello\?|are you there)[?!.\s]*$/i;
        if (_prontoPat.test(this.lastTranscript.trim())) {
          console.log('📞 "Pronto?" rilevato → risposta deterministica');
          this._say('Sì, sono qui! Posso aiutarla con altro?');
          return;
        }

        // Fix 3A2: saluti e ringraziamenti finali → congedo SEMPRE PRIMO
        // Deve scattare PRIMA di topic memory e ambiguity — ordine critico
        // Pattern esteso: "No, va benissimo, grazie mille", "Grazie buona giornata"
        const _farewellPat = /^(?:ok|sì|si|no|perfetto|benissimo|ottimo|capito|bene)?[,\s]*(?:va\s+bene(?:\s+così)?[,\s]*)?(?:grazie(?:\s+mille)?|arrivederci|arrivederla|a presto|ciao|buona(?:\s+serata|\s+giornata)?|salve)[!.\s]*$/i;
        // Pattern alternativo: frasi con "grazie" o congedo ovunque nella frase breve
        const _farewellAlt = /\b(?:grazie(?:\s+mille)?|arrivederci|arrivederla|buona\s+(?:serata|giornata|notte))[!.\s]*$/i;
        const _transcript = this.lastTranscript.trim();
        const _isFarewell = _farewellPat.test(_transcript) ||
                           (_transcript.split(/\s+/).length <= 8 && _farewellAlt.test(_transcript));
        if (_isFarewell) {
          console.log('👋 Saluto/ringraziamento finale → congedo senza reset');
          this._say('Grazie a lei! A presto.');
          return;
        }
      }

      // Fix 3B: Domanda su note esistenti — intercetta PRIMA di qualsiasi check intent
      // Es: "Avete segnato che sono allergico?" dopo un MODIFY → NON resettare, rispondere
      const _noteQGuard = /(?:hai|avete|avevate|aveva|avevi)\s+(?:\w+\s+){0,2}(?:segnato|annotato|scritto|indicato|aggiunto|inserito)|risulta\s+(?:ancora\s+)?segnato|è\s+(?:ancora\s+)?segnato|lo\s+avete\s+segnato|avete\s+(?:\w+\s+){0,2}(?:segnato|annotato|aggiunto)/i.test(this.lastTranscript || '');
      if (_noteQGuard && this.lastReservation?.eventId) {
        console.log('📋 Phase=done: domanda su note → risposta diretta senza reset');
        this._lastTopic = 'notes'; // STEP 3
        const _lrNotes = this.lastReservation.notes
          ? this.lastReservation.notes.split(';').map(n => n.replace(/\s*\([^)]*\)/g, '').trim()).filter(n => n.length > 0).join('; ')
          : '';
        if (_lrNotes) {
          this._say(`Sì, ho annotato: ${_lrNotes}.`);
        } else {
          this._say('Non risultano note salvate sulla sua prenotazione.');
        }
        return;
      }

      // Nuovo intent modify → usa lastReservation se disponibile, altrimenti cerca
      if (intent === 'modify') {
        // 🆕 FIX TEST1: se il cliente sta chiedendo delle note esistenti ("avete segnato X?"),
        // GPT restituisce intent=modify per via della frase ma non va avviato il MODIFY flow.
        // Lasciamo rispondere GPT normalmente con le note in contesto.
        const _noteQuestionGuard = /(?:hai|avete|avevate|aveva|avevi)\s+(?:\w+\s+){0,2}(?:segnato|annotato|scritto|indicato|aggiunto|inserito)|risulta\s+(?:ancora\s+)?segnato|è\s+(?:ancora\s+)?segnato|avete\s+(?:\w+\s+){0,2}(?:segnato|annotato|aggiunto)/i.test(this.lastTranscript || '');
        if (_noteQuestionGuard) {
          console.log('📋 Phase=done MODIFY: domanda su note → skip MODIFY, lascio GPT rispondere');
          // Costruisci contesto note per GPT
          const _lrN = this.lastReservation;
          const _notesCtxN = _lrN?.notes ? `Note salvate sulla prenotazione: "${_lrN.notes}".` : '';
          // Risposta deterministica: conferma note salvate
          const _noteAnswer = _notesCtxN
            ? `Sì, ho annotato: ${this._notesForClient(_lrN.notes)}.`
            : 'Non risultano note salvate sulla sua prenotazione.';
          this._say(_noteAnswer);
        }
        this.intent = 'modify';
        this.modifyState = null;
        // Fix X04: salva foundReservation prima del reset — potrebbe contenere la prenotazione
        // trovata durante un CANCEL abortito (es: "No anzi spostala a sabato")
        const _cancelFoundReservation = this.foundReservation;
        this.foundReservation = null;
        console.log('🔄 Phase=done: nuovo intent modify rilevato');

        // Guard anti-double: se stiamo già processando un MODIFY, ignora il secondo trigger
        if (this._processingModify) {
          console.log('🔒 Double MODIFY ignorato: _processingModify=true');
          return;
        }

        // Se abbiamo la prenotazione appena gestita, usala direttamente
        // Nota: funziona anche con eventId=null (es. timeout AS)
        // Fix X04: usa anche _cancelFoundReservation (da CANCEL abortito) se lastReservation è null
        const _refRes = (this.lastReservation?.name && this.lastReservation?.date)
          ? this.lastReservation
          : (_cancelFoundReservation?.name && _cancelFoundReservation?.date ? _cancelFoundReservation : null);

        if (_refRes) {
          if (!this.lastReservation?.name) {
            console.log(`🔄 Fix X04: uso foundReservation da CANCEL abortito (${_refRes.name}, ${_refRes.date}) come base MODIFY`);
          }
          this.foundReservation = _refRes;
          this.modifyState = 'awaiting_changes';

          // Fix 4: se solo le note cambiano (stessi data/ora/pax/nome), non fare MODIFY
          // Le note sono già state gestite da _detectNotesAndPhone → update_notes
          const _onlyNoteChange = !newName && !newDate && !newTime && !newPeople;
          if (_onlyNoteChange) {
            console.log('📝 Phase=done MODIFY: solo nota cambiata, già gestita da update_notes → skip MODIFY');
            // Fix: resetta intent e modifyState per evitare il MODIFY reminder sul saluto finale
            this.intent = 'done_modify';
            this.modifyState = 'done';
            // Fix 4: conferma verbale della nota al cliente
            if (this.data.notes) {
              const _lastNote = this.data.notes.split(';').pop().trim();
              this._say(`Ho annotato: ${_lastNote}. C'è altro che posso fare per lei?`);
            }
            return;
          }

          // Se il messaggio contiene già la modifica esplicita, applicala subito
          if (newName || newDate || newTime || newPeople) {
            console.log(`💾 Phase=done MODIFY: applico cambio diretto su _refRes (${_refRes.name}, ${_refRes.date})`);
            await this._handleModifyFlow(newDate, newTime, newPeople, newName);
            return;
          }

          // Altrimenti mostra la prenotazione trovata e chiedi cosa modificare
          const r = _refRes;
          const timeNorm = r.time?.length === 5 ? r.time + ':00' : (r.time || '');
          const dateDisplay = DateManager.formatForDisplay(r.date);
          const timeDisplay = TimeManager.formatForDisplay(timeNorm);
          console.log(`💾 Phase=done MODIFY: uso _refRes direttamente (${r.name}, ${r.date})`);
          this._say(`Ho trovato: ${r.name}, ${dateDisplay} alle ${timeDisplay} per ${r.people} persone. Cosa vuole modificare?`);
          return;
        }

        await this._handleModifyFlow(newDate, newTime, newPeople, newName);
        return;
      }

      // Nuovo intent cancel → avvia CANCEL flow
      if (intent === 'cancel') {
        this.intent = 'cancel';
        this.cancelState = null;
        this.foundReservation = null;
        console.log('🔄 Phase=done: nuovo intent cancel rilevato');
        await this._handleCancelFlow(newDate, newName);
        return;
      }

      // Nuovo intent create → reset e riparte
      if (intent === 'create') {
        // Guard anti-duplicato: se GPT ha estratto gli stessi dati dell'ultima prenotazione
        // confermata (es. dopo "grazie" ricorda il contesto), NON fare reset.
        // Si tratta di cortesia post-prenotazione, non di una nuova richiesta.
        const lr = this.lastReservation;
        if (lr && newDate === lr.date && newTime === lr.time &&
            String(newPeople) === String(lr.people) && newName === lr.name) {
          // Se la prenotazione è PENDING, lo diciamo esplicitamente al cliente
          if (lr.status === 'PENDING_OWNER') {
            console.log('⏳ Phase=done: prenotazione PENDING_OWNER → informo cliente');
            this._say('La tua prenotazione è in attesa di conferma dal ristorante. Ti contatteranno a breve per confermarla.');
            return;
          }
          console.log('🛡️ Phase=done: create con dati identici a lastReservation → saluto senza reset');
          // Fix: aggiorna note se rilevate PRIMA di rispondere, poi lascia GPT rispondere liberamente
          // (prima forzava "Prego! A presto!" saltando le note e causando loop)
          if (this.data.notes && this.data.notes !== lr.notes) {
            const updatedNotes = this.data.notes;
            console.log(`📝 Guard identici: nuove note rilevate, aggiorno: "${updatedNotes}"`);
            this._callAppsScript({
              action: 'update_reservation',
              eventId: lr.eventId,
              nome: lr.name,
              data: lr.date,
              ora: lr.time,
              persone: lr.people,
              telefono: lr.phone,
              notes: updatedNotes,
            }).then(r => {
              console.log(`✅ Note aggiornate (guard identici): ${r?.status}`);
              if (this.lastReservation) this.lastReservation.notes = updatedNotes;
            }).catch(err => console.error('❌ Errore aggiornamento note (guard):', err));
          }
          // Controlla prima se è una domanda info — risposta deterministica
          const _infoAnswerGuard = this._checkInfoQuestion(this.lastTranscript || '');
          if (_infoAnswerGuard !== null) {
            console.log('📋 Info question (guard identico) → risposta deterministica');
            this._say(_infoAnswerGuard);
            return;
          }
          // Lascia GPT rispondere liberamente alle domande post-prenotazione
          // senza resettare il contesto
          const _gLang = this.language || 'it';
          const _lr = this.lastReservation;
          const _notesInfo = _lr?.notes ? `Note salvate sulla prenotazione: "${_lr.notes}".` : 'Nessuna nota salvata.';
          // Risposta deterministica post-prenotazione
          const _postBookingInfo = this._checkInfoQuestion(this.lastTranscript || '');
          if (_postBookingInfo) {
            this._say(_postBookingInfo);
          } else if (this._noteCheck && this.lastReservation?.notes) {
            this._say(`Sì, ho annotato: ${this._notesForClient(this.lastReservation.notes)}.`);
          } else {
            this._say('C\'è altro che posso fare per lei?');
          }
        }

        // STEP 2: Post-confirm correction patching (GPT suggestion)
        // NON resettare mai per una correzione — è un "state patch"
        const _lrFix = this.lastReservation;

        // Caso A: solo nome fornito (no data/ora/persone) → correzione nome post-conferma
        // es: "Il mio nome è Franceschini" dopo che è stato confermato "Franceschi"
        // USA eventId direttamente — non cercare per nome (evita ricerca inutile e lenta)
        if (_lrFix?.eventId && newName && newName !== _lrFix.name &&
            !newDate && !newTime && !newPeople) {
          console.log(`🔄 Phase=done: correzione nome (${_lrFix.name} → ${newName}) → aggiorno direttamente`);
          this._say(`Un attimo, aggiorno il nome in ${newName}...`);
          try {
            const upd = await this._callAppsScript({
              action: 'update_reservation',
              eventId: _lrFix.eventId,
              nome: newName,
              data: _lrFix.date,
              ora: _lrFix.time,
              persone: _lrFix.people,
              telefono: _lrFix.phone || this.callerPhone || '',
              notes: _lrFix.notes || '',
            });
            if (upd?.success !== false) {
              this.lastReservation = { ..._lrFix, name: newName };
              this._say(`Perfetto ${newName}! Ho aggiornato il nome sulla prenotazione.`);
            } else {
              this._say(`Mi dispiace, non sono riuscita ad aggiornare il nome. La prenotazione rimane a nome ${_lrFix.name}.`);
            }
          } catch (err) {
            console.error('❌ Correzione nome post-confirm:', err);
            this._say(`Perfetto ${newName}! La prenotazione è aggiornata.`);
          }
          return;
        }

        // Caso B: stessi dati ma nome diverso → MODIFY nome
        // es: "Mi chiamo Russo, non Rossi" con tutti i dati presenti
        if (_lrFix?.eventId && newName && newName !== _lrFix.name &&
            newDate === _lrFix.date && newTime === _lrFix.time &&
            String(newPeople) === String(_lrFix.people)) {
          console.log(`🔄 Phase=done CREATE: solo nome cambiato (${_lrFix.name} → ${newName}) → MODIFY nome`);
          await this._handleModifyFlow(newDate, newTime, newPeople, newName);
          return;
        }

        // GUARD: se non c'è nessun dato prenotazione estratto (no data/ora/persone)
        // è quasi certamente una domanda o follow-up, non una nuova prenotazione
        const _hasBookingData = newDate || newTime || newPeople;
        if (!_hasBookingData) {
          console.log('💬 Phase=done: intent create senza dati → probabile domanda/follow-up');

          // STEP 3 (GPT): Topic memory — se l'ultimo topic era 'notes' e la frase è
          // breve/interrogativa, è un follow-up sulle note senza ripetere le keyword
          const _wordCount3 = (this.lastTranscript || '').trim().split(/\s+/).length;
          const _isFollowUp = _wordCount3 <= 8 && /\?|avete|c'è|posso|si può|ok|bene|sì|certo|capito/i.test(this.lastTranscript || '');
          // STEP 3: topic memory — ma NON se è un congedo
          const _isCongedoInFollowUp = /\b(?:grazie|arrivederci|buona\s+(?:giornata|serata)|ciao|a\s+presto)\b/i.test(this.lastTranscript || '');
          if (this._lastTopic === 'notes' && this.lastReservation?.notes && _isFollowUp && !_isCongedoInFollowUp) {
            const _notesClean = this._notesForClient(this.lastReservation.notes);
            console.log('💬 STEP 3: follow-up su notes (topic memory)');
            this._say(`Sì, ho già annotato: ${_notesClean}. C'è altro che posso fare per lei?`);
            return;
          }

          // Controlla keyword note esplicite nel transcript
          const _noteKeywords = /(seggiolone|allergi|celiaco|vegano|vegetar|carrozzin|disabil|lattosio|glutine|intolleranz)/i;
          if (this.lastReservation?.notes && _noteKeywords.test(this.lastTranscript || '')) {
            const _notesClean = this._notesForClient(this.lastReservation.notes);
            this._lastTopic = 'notes';
            this._say(`Sì, ho già annotato sulla sua prenotazione: ${_notesClean}. C'è altro che posso fare per lei?`);
            return;
          }

          // Domanda generica sul locale — rimanda al ristorante
          this._say('Per informazioni sul locale la invito a contattare direttamente il ristorante. Posso aiutarla con altro?');
          return;
        }

        this.intent = 'create';
        this.phase = 'collecting';
        this.data = { date: null, time: null, people: null, name: null, notes: null, alternativePhone: null };
        this.modifyState = null;
        this.cancelState = null;
        this.foundReservation = null;
        this.checkingSlot = false;
        this.availDone = false;
        this._pendingQuestion = null;
        console.log('🔄 Phase=done: nuovo intent create — reset e riparto');
        await this._processExtraction(args);
        return;
      }

      // Intent unknown (saluti, ringraziamenti, note aggiuntive, "posso aiutarti con altro?")

      // Fix A: controlla unclear PRIMA di tutto — anche in phase=done
      if (args.unclear === true || args.unclear === 'true') {
        console.log('🔁 Phase=done: frase incomprensibile → chiedo di ripetere');
        this._say('Non ho capito bene, può ripetere?');
        return;
      }

      console.log('💬 Phase=done: intent unknown — risposta cortese');

      // Se ci sono nuove note rilevate dalla trascrizione e abbiamo lastReservation, aggiorna
      // (es: "siamo celiaci" dopo la prenotazione confermata)
      // La rilevazione note avviene in _detectNotesAndPhone via Whisper transcript
      // Il controllo lo facciamo qui: se this.data.notes è cambiato rispetto a lastReservation
      if (this.lastReservation?.eventId && this.data.notes &&
          this.data.notes !== this.lastReservation.notes) {
        const updatedNotes = this.data.notes;
        console.log(`📝 Phase=done: nuove note rilevate, aggiorno lastReservation: "${updatedNotes}"`);
        this._callAppsScript({
          action: 'update_reservation',
          eventId: this.lastReservation.eventId,
          nome: this.lastReservation.name,
          data: this.lastReservation.date,
          ora: this.lastReservation.time,
          persone: this.lastReservation.people,
          telefono: this.lastReservation.phone,
          notes: updatedNotes,
        }).then(r => {
          console.log(`✅ Note aggiornate su prenotazione: ${r?.status}`);
          if (this.lastReservation) this.lastReservation.notes = updatedNotes;
        }).catch(err => console.error('❌ Errore aggiornamento note:', err));
      }
      // Fix: se il cliente saluta dopo un MODIFY fallito (slot_full),
      // ricordagli che la prenotazione originale è ancora attiva prima di congedarsi.
      // Evita che riattacchi convinto che la modifica sia andata a buon fine.
      const _modifyReminderRes = this.foundReservation || this.lastReservation;
      if (this.intent === 'modify' && this.modifyState !== 'done' && _modifyReminderRes?.eventId) {
        const r = _modifyReminderRes;
        const timeNorm = r.time?.length === 5 ? r.time + ':00' : (r.time || '');
        const dateDisplay = DateManager.formatForDisplay(r.date);
        const timeDisplay = TimeManager.formatForDisplay(timeNorm);
        console.log(`ℹ️ Phase=done MODIFY incomplete: ricorda prenotazione originale (${r.name}, ${r.date})`);
        this._say(`La sua prenotazione originale per ${r.people} persone ${dateDisplay} alle ${timeDisplay} è ancora attiva. Vuole mantenerla o cancellarla?`);
        return;
      }

      // FIX 3: domande informative sul locale (seggiolone, menu, ecc.) → _handleInfoQuery
      // GUARD: se è una domanda sulle NOTE della prenotazione → vai direttamente al note recall
      // Salta sia _handleInfoQuery che _checkInfoQuestion per evitare "Per informazioni sul locale"
      const _isNoteRecallQ = /\b(?:segnato|annotato|segnalato|ancora\s+segnata?|ancora\s+annotata?|ancora\s+assegnata?|hai\s+segnato|avete\s+segnato|l'avete|l'hai|avete\s+ancora\s+(?:la|il|i|le)\s+\w)/i.test(this.lastTranscript || '');

      // GPT risponde sia a domande sulle note della prenotazione che sul ristorante
      // Usa contesto completo: menuDetails + note prenotazione corrente
      if ((this._isInformationalQuery(this.lastTranscript || '') || _isNoteRecallQ) &&
          this._restaurantInfo && Object.keys(this._restaurantInfo).length > 0) {
        const _handled = await this._handleInfoQuery(this.lastTranscript || '');
        if (_handled) return;
      }

      // Controlla prima se è una domanda info — risposta deterministica
      const _infoAnswerDone = this._checkInfoQuestion(this.lastTranscript || '');
      if (_infoAnswerDone !== null) {
        console.log('📋 Info question (phase=done) → risposta deterministica');
        this._say(_infoAnswerDone);
        return;
      }
      const _lang = this.language || 'it';
      const _lrNotes = this.lastReservation?.notes;
      const _notesCtx = _lrNotes ? `Note salvate sulla prenotazione: "${_lrNotes}".` : '';
      // Risposta deterministica post-operazione
      const _postOpInfo = this._checkInfoQuestion(this.lastTranscript || '');
      if (_postOpInfo) {
        this._say(_postOpInfo);
      } else if (this.lastReservation?.notes && /nota|segnato|annotato|allergi/i.test(this.lastTranscript || '')) {
        this._say(`Sì, ho annotato: ${this._notesForClient(this.lastReservation.notes)}.`);
      } else {
        this._say('C\'è altro che posso fare per lei?');
      }
    }

    // ── Intent ───────────────────────────────────────────────────────────────
    // STEP 1 (GPT): Intent lock — flow state > transcript intent
    // Quando siamo in un flow guidato (modify/cancel attivo), l'intent GPT
    // NON deve mai resettare lo stato. L'utente sta rispondendo alla nostra domanda.
    const _modifyActive = this.intent === 'modify' && this.modifyState && this.modifyState !== 'done';
    const _cancelActive = this.intent === 'cancel' && this.cancelState;

    if (_modifyActive || _cancelActive) {
      // Solo cancel esplicito può uscire dal modify flow
      const _explicitCancel = /\b(?:cancell|disdic|annull|voglio cancellare)\b/i.test(this.lastTranscript || '');
      if (!_explicitCancel) {
        this.intentLocked = true;
        if (args.intent !== this.intent) {
          console.log(`🔒 Intent locked: GPT dice "${args.intent}" ma siamo in ${this.intent}/${this.modifyState || this.cancelState} — ignoro`);
          args.intent = this.intent;
        }
      } else {
        this.intentLocked = false;
      }
    } else {
      this.intentLocked = false;
    }

    // Override locale: frasi implicite di cancellazione che GPT classifica come modify
    const _impliedCancelPat = /non\s+(?:riusciamo|possiamo|riesco|posso|vengo|veniamo)\s+(?:più\s+)?(?:a\s+)?venire|non\s+(?:ci|vi)\s+saremo|abbiamo\s+(?:avuto\s+)?un\s+imprevisto|dobbiamo\s+(?:purtroppo\s+)?(?:cancellare|disdire|annullare)/i;
    if (!this.intentLocked && this.lastTranscript && _impliedCancelPat.test(this.lastTranscript)) {
      if (args.intent !== 'cancel') {
        console.log(`🎯 Intent override: ${args.intent} → cancel (frase implicita cancellazione)`);
        args.intent = 'cancel';
      }
    }

    if (!this.intent && args.intent && args.intent !== 'unknown') {
      this.intent = args.intent;
      console.log(`🎯 Intent (GPT): ${this.intent}`);
    }

    const prevDate = this.data.date;
    const prevTime = this.data.time;

    // Se intent=unknown, lascia rispondere GPT con i dati reali iniettati esplicitamente
    if (!args.intent || args.intent === 'unknown') {

      // Se GPT ha segnalato che la frase era incomprensibile → chiedi di ripetere
      if (args.unclear === true || args.unclear === 'true') {
        console.log('🔁 Frase incomprensibile rilevata da GPT → chiedo di ripetere');
        this._say('Non ho capito bene, può ripetere?');
        return;
      }

      console.log('💬 Intent unknown — GPT risponde liberamente con dati reali');

      // Fix: controlla PRIMA se è una domanda info ristorante — risposta deterministica
      // Questo ha priorità anche sul reminder MODIFY, per evitare che il reminder
      // soffochi domande legittime come "avete piatti vegani?"
      const _skipInfoCheck = (this.phase === 'collecting' && newName && newName !== 'null');
      if (!_skipInfoCheck) {
        const _infoAnswer = this._checkInfoQuestion(this.lastTranscript || '');
        if (_infoAnswer !== null) {
          console.log(`📋 Info question rilevata → risposta deterministica`);
          this._say(_infoAnswer);
          return;
        }
      }

      // Fix: se il cliente saluta dopo un MODIFY fallito (slot_full),
      // ricordagli che la prenotazione originale è ancora attiva.
      const _modifyReminderRes2 = this.foundReservation || this.lastReservation;
      if (this.intent === 'modify' && _modifyReminderRes2?.eventId) {
        const r = _modifyReminderRes2;
        const timeNorm = r.time?.length === 5 ? r.time + ':00' : (r.time || '');
        const dateDisplay = DateManager.formatForDisplay(r.date);
        const timeDisplay = TimeManager.formatForDisplay(timeNorm);
        console.log(`ℹ️ Intent-unknown MODIFY incomplete: ricorda prenotazione originale (${r.name}, ${r.date})`);
        this._say(`La sua prenotazione originale per ${r.people} persone ${dateDisplay} alle ${timeDisplay} è ancora attiva. Vuole mantenerla o cancellarla?`);
        return;
      } else {
        // Fix M07: se intent=unknown + nome presente in phase=collecting,
        // e NON abbiamo ancora nessun dato di prenotazione raccolto (no data/ora/pax),
        // il cliente probabilmente ha già una prenotazione → cerca automaticamente.
        // Se invece abbiamo già dei dati (siamo a metà del flusso CREATE), lascia GPT rispondere.
        const _noDataYet = !this.data.date && !this.data.time && !this.data.people;
        if (_noDataYet && newName && newName !== 'null') {
          console.log(`📋 Fix M07: intent=unknown + nome=${newName} senza dati → cerco prenotazione automaticamente`);
          this.intent = 'modify';
          this.modifyState = null;
          this.foundReservation = null;
          await this._handleModifyFlow(newDate, newTime, newPeople, newName);
          return;
        } else {
          console.log(`📋 Info question skippata: fase collecting con nome=${newName} e dati parziali → lascio GPT rispondere`);
        }
      }

      const rc = this.restaurantConfig;
      const ls = rc?.lunch_start  || '12:00';
      const le = rc?.lunch_end    || '14:30';
      const ds = rc?.dinner_start || '19:00';
      const de = rc?.dinner_end   || '22:30';
      const dayNames = ['domenica','lunedì','martedì','mercoledì','giovedì','venerdì','sabato'];
      const closedDays = rc?.closed_days ? String(rc.closed_days).split(',').map(Number) : [1];
      const lunchClosedDays = rc?.lunch_closed_days ? String(rc.lunch_closed_days).split(',').map(Number) : [];
      const dinnerClosedDays = rc?.dinner_closed_days ? String(rc.dinner_closed_days).split(',').map(Number) : [];
      const allDays = [0,1,2,3,4,5,6];
      const openForLunch = allDays.filter(d => !closedDays.includes(d) && !lunchClosedDays.includes(d)).map(d => dayNames[d]).join(', ');
      const openForDinner = allDays.filter(d => !closedDays.includes(d) && !dinnerClosedDays.includes(d)).map(d => dayNames[d]).join(', ');
      const closedText = closedDays.map(d => dayNames[d]).join(', ');

      const _langFree = this.language || 'it';
      const _scheduleData = `Lunch ${ls}-${le}: open ${openForLunch || 'no days'} / Dinner ${ds}-${de}: open ${openForDinner || 'no days'} / Closed: ${closedText}`;
      // Risposta deterministica orari
      const _orariRisp = `Pranzo ${ls}-${le} (${openForLunch || 'nessun giorno'}), cena ${ds}-${de} (${openForDinner || 'nessun giorno'}). Chiuso il: ${closedText}.`;
      this._say(_orariRisp);
      return;
    }

    // 🆕 Intent-switch create→modify in phase=collecting
    // Es: utente dice "ho una prenotazione, vorrei modificarla" → GPT dice modify ma this.intent='create'
    if (this.intent === 'create' && this.phase === 'collecting' && args.intent === 'modify') {
      // Fix B1: se il cliente ha già dato tutti i dati di prenotazione (date+time+people),
      // GPT dice modify solo perché sta correggendo un campo → NON avviare MODIFY flow,
      // semplicemente aggiornare i dati e restare in CREATE.
      // Il MODIFY flow ha senso solo se il cliente non ha ancora dati raccolti.
      // _anyDataCollected: se il cliente ha già dato ALMENO UN dato in questa sessione,
      // GPT sta interpretando una correzione come modify → resta in CREATE.
      // Se invece non c'è nessun dato (nuova chiamata), il MODIFY flow è legittimo.
      const _anyDataCollected = this.data.date || this.data.name || this.data.people || this.data.time;
      if (_anyDataCollected) {
        console.log(`🔄 Intent-switch collecting: create → modify IGNORATO (dati già presenti, è correzione CREATE)`);
        // Fix B2: reset foundReservation residuo da MODIFY fallback
        this.foundReservation = null;
        // Rientra in _processExtraction con intent=create corretto
        // così il flow normale (validazione orario, check slot, ecc.) viene eseguito
        await this._processExtraction({ ...args, intent: 'create' });
        return;
      }
      console.log(`🔄 Intent-switch collecting: create → modify, avvio MODIFY flow`);
      this.intent = 'modify';
      this.modifyState = null;
      this.foundReservation = null;  // Fix B2: reset esplicito
      await this._handleModifyFlow(newDate, newTime, newPeople, newName);
      return;
    }

    // 🆕 Guard intent-switch: se GPT dice create ma siamo in modify/cancel,
    // l'utente sta correggendo l'intenzione → reset completo e riparte da CREATE.
    const inModifyOrCancel = (this.intent === 'modify' || this.intent === 'cancel');
    const gptSaysCreate = (args.intent === 'create');
    if (inModifyOrCancel && gptSaysCreate && (newDate || newTime || newPeople)) {
      console.log(`🔄 Intent-switch rilevato: ${this.intent} → create, reset`);
      this.intent = 'create';
      this.phase = 'collecting';
      this.data = { date: null, time: null, people: null, name: null, notes: null, alternativePhone: null };
      this.modifyState = null;
      this.cancelState = null;
      this.foundReservation = null;
      this.checkingSlot = false;
      this.availDone = false;
      this.lastTranscript = null; // 🆕 evita che il cross-check parsePeople giri sul transcript precedente
      await this._processExtraction(args);
      return;
    }

    // ── MODIFY flow ──────────────────────────────────────────────────────────
    if (this.intent === 'modify') {
      // Intent-switch guard: se GPT dice 'cancel' durante MODIFY, passa subito al CANCEL flow
      // senza entrare in _handleModifyFlow (che farebbe check disponibilità invece di cancellare)
      if (args.intent === 'cancel') {
        console.log('🔄 Intent-switch MODIFY → cancel rilevato fuori phase=done');
        this.intent = 'cancel';
        // Se abbiamo già la prenotazione trovata (es. MODIFY slot_full), vai diretto alla conferma
        if (this.foundReservation?.eventId) {
          const r = this.foundReservation;
          const timeNorm = r.time?.length === 5 ? r.time + ':00' : (r.time || '');
          const dateDisplay = DateManager.formatForDisplay(r.date);
          const timeDisplay = TimeManager.formatForDisplay(timeNorm);
          this.cancelState = 'awaiting_confirm';
          console.log(`🗑️ CANCEL diretto su foundReservation: ${r.name}, ${r.date}`);
          this._say(`Ho trovato: ${r.name}, ${dateDisplay} alle ${timeDisplay} per ${r.people} persone. Conferma la cancellazione?`);
        } else {
          this.cancelState = null;
          this.foundReservation = null;
          await this._handleCancelFlow(newDate, newName);
        }
        return;
      }
      await this._handleModifyFlow(newDate, newTime, newPeople, newName);
      return;
    }

    // ── CANCEL flow ──────────────────────────────────────────────────────────
    if (this.intent === 'cancel') {
      // Fix X04: intent-switch cancel→modify — cliente cambia idea durante CANCEL
      // (es: "No anzi la sposto a sabato"). Riutilizza foundReservation già trovata.
      // Condizione tripla: siamo in cancel + GPT dice modify + prenotazione già trovata
      if (args.intent === 'modify' && this.foundReservation?.eventId) {
        console.log(`🔄 Intent-switch CANCEL → modify: uso foundReservation (${this.foundReservation.name}, ${this.foundReservation.date})`);
        this.intent = 'modify';
        this.cancelState = null;
        this.modifyState = 'awaiting_changes';
        await this._handleModifyFlow(newDate, newTime, newPeople, newName);
        return;
      }
      // confirm phase gestita direttamente via testo in _onUserText
      if (this.cancelState !== 'awaiting_confirm') {
        await this._handleCancelFlow(newDate, newName);
      }
      return;
    }

    // STEP 5: usa _applyExtraction() come unico punto di mutazione stato
    this._applyExtraction({
      date:   newDate,
      time:   newTime,
      people: newPeople ? String(newPeople) : null,
      name:   newName,
    });

    console.log(`📊 date=${this.data.date} time=${this.data.time} people=${this.data.people} name=${this.data.name}`);

    // ── Fase naming: se siamo già in naming basta il nome ────────────────────
    if (this.phase === 'naming') {
      this._processNaming(this.data.name ? '__name_already_set__' : (newName || ''));
      return;
    }

    // ── Fase collecting ──────────────────────────────────────────────────────

    // ① Check giorno chiuso
    if (this.data.date && this.data.date !== prevDate) {
      const msg = ValidationPipeline.getDayClosedMessage(this.data.date, rc);
      if (msg) {
        console.log(`🚫 Giorno chiuso: ${this.data.date}`);
        this.data.date = null;
        this._say(msg);
        return;
      }
    }

    // ② Check orario valido + pranzo/cena chiuso
    // Triggera quando time OPPURE date cambia (es: stesso orario, giorno diverso)
    if (this.data.date && this.data.time &&
        (this.data.time !== prevTime || this.data.date !== prevDate)) {
      if (!ValidationPipeline.isValidTime(this.data.time, rc)) {
        const msg = ValidationPipeline.getTimeInvalidMessage(this.data.time, this.data.date, rc);
        console.log(`🚫 Orario non valido: ${this.data.time}`);
        this.data.time = null;
        this._say(msg);
        // Fix B4: forza GPT a NON confermare prenotazioni dopo orario invalido
        return;
      }

      // ③ Check pranzo/cena chiuso
      const [h] = this.data.time.split(':').map(Number);
      const isPranzo = h >= 10 && h <= 16;
      if (isPranzo && ValidationPipeline.isLunchClosed(this.data.date, rc)) {
        const dayName = DateManager.getDayName(this.data.date);
        const ds = rc?.dinner_start || '21:00';
        const de = rc?.dinner_end   || '22:30';
        this.data.time = null;
        this._say(`Il ${dayName} siamo aperti solo a cena (${ds}-${de}). Vuole prenotare per cena?`);
        return;
      }
      const isCena = h >= 17 || h <= 3;
      if (isCena && ValidationPipeline.isDinnerClosed(this.data.date, rc)) {
        const dayName = DateManager.getDayName(this.data.date);
        const ls = rc?.lunch_start || '12:00';
        const le = rc?.lunch_end   || '14:30';
        this.data.time = null;
        this._say(`Il ${dayName} siamo aperti solo a pranzo (${ls}-${le}). Vuole prenotare per pranzo?`);
        return;
      }
    }

    // ④ Tutti e 3 → check slot
    if (this.data.date && this.data.time && this.data.people && !this.checkingSlot) {
      await this._checkSlot();
      return;
    }

    // Chiedi dato mancante
    if (!this.data.date)   { this._ask('date');   }
    else if (!this.data.time)   { this._ask('time');   }
    else if (!this.data.people) { this._ask('people'); }
  }

  // ── Note e Telefono Alternativo ───────────────────────────────────────────

  // ── GPT note extractor — label nota da contesto (sostituisce contextCapture) ──
  // Pattern GPT: note semantiche → GPT, entity strutturate → parser
  // Chiamata leggera: solo il label della nota, max 6 parole
  async _extractNoteWithGPT(text, category) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1500);
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          temperature: 0,
          max_tokens: 15,
          messages: [{
            role: 'system',
            content: `Estrai la nota specifica dalla frase per la categoria "${category}". Rispondi SOLO con il label della nota, max 4 parole in italiano, nessun altro testo. Esempi: "anniversario di matrimonio" → "Anniversario matrimonio". "sono allergico alle uova" → "Allergia uova". "mia moglie è celiaca" → "Celiachia (moglie)". "compleanno di mia figlia" → "Compleanno figlia".`
          }, {
            role: 'user', content: text
          }]
        })
      });
      clearTimeout(timeout);
      const data = await response.json();
      const label = data?.choices?.[0]?.message?.content?.trim();
      return label && label.length < 50 ? label : null;
    } catch (err) {
      return null;
    }
  }

  async _detectNotesAndPhone(text) {
    // Ritorna true se ha già gestito la risposta (update_notes post-confirm)
    // Il caller deve fare return immediatamente in quel caso
    const t = text.toLowerCase();

    // ── Keyword note ─────────────────────────────────────────────────────────
    // 🆕 FIX 4: campo `removes` per gestire note confliggenti (es. interno vs esterno)
    // NOTE: pattern = trigger strutturale (dice che c'è qualcosa da annotare)
    // note = fallback label se GPT non è disponibile o per note non-semantiche
    // gptCategory = hint per GPT su che tipo di nota estrarre
    // NO più contextCapture regex — label semantico estratto da GPT
    const noteKeywords = [
      // Allergie e intolleranze — GPT estrae l'allergene specifico
      { pattern: /celiac[oai]|ciliac[oai]|senza\s+glutine|intolleranz[ae]\s+glutine/i,
        note: 'Intolleranza glutine', gptCategory: 'intolleranza/celiachia' },
      { pattern: /lattosio|lactose/i,
        note: 'Intolleranza lattosio', gptCategory: 'intolleranza lattosio' },
      // Allergia generica: scatta SOLO se non ci sono allergeni specifici già coperti
      // Negazione: arachidi/uova/frutta secca/glutine hanno pattern dedicati → skip generico
      { pattern: /allergi[aoci]/i,
        note: 'Allergia (verifica con cliente)', gptCategory: 'allergia alimentare',
        negation: /arachidi|arachide|frutta\s*secca|noci|\buov[ao]\b|lattosio|glutine|celiaco/i },
      { pattern: /\buova\b|\buovo\b/i,
        note: 'Allergia uova', gptCategory: 'allergia uova' },
      { pattern: /arachidi|arachide|frutta\s*secca|noci/i,
        note: 'Allergia arachidi/frutta secca', gptCategory: 'allergia arachidi o frutta secca' },
      // Dieta — GPT può specificare "vegano (1 persona)", "vegetariana (moglie)" ecc.
      { pattern: /vegetarian[oai]/i,
        note: 'Vegetariano', gptCategory: 'dieta vegetariana' },
      { pattern: /vegan[oai]/i,
        note: 'Vegano', gptCategory: 'dieta vegana' },
      // Bambini (label già preciso, GPT non aggiunge valore)
      { pattern: /seggiol[eo]n[eo]|seggiolino|seggialone|seggilon[ei]|seggialino|highchair/i,
        note: 'Richiesto seggiolone' },
      { pattern: /bambino\s*piccolo|neonat[oi]|bimb[oi]\s*piccol/i,
        note: 'Neonato/bambino piccolo' },
      // Occasioni — GPT estrae contesto preciso (matrimonio, moglie, ecc.)
      { pattern: /anniversario/i,
        note: 'Anniversario', gptCategory: 'anniversario' },
      { pattern: /compleanno|birthday/i,
        note: 'Compleanno', gptCategory: 'compleanno' },
      { pattern: /propost[ae]\s*di\s*matrimonio|fidanzamento/i,
        note: 'Proposta di matrimonio' },
      { pattern: /occasion[ei]\s*speciale/i,
        note: 'Occasione speciale', gptCategory: 'occasione speciale' },
      { pattern: /romantico|romantica/i,
        note: 'Cena romantica' },
      { pattern: /finestra|vista/i,
        note: 'Tavolo vicino finestra' },
      // Tavolo — label deterministico, no GPT
      { pattern: /esterno|terrazza|giardino|dehor|\bfuori\b|all.aperto/i,
        note: 'Tavolo esterno/terrazza',
        negation: /\ball.interno\b|prefer[ei].{0,20}intern|non.{0,20}esterno|starei.{0,10}intern|\bdentro\b/i },
      { pattern: /\binterno\b|\bdentro\b|preferis[ce].{0,20}intern|star[ei].{0,10}dentro|vorrei.{0,10}dentro/i,
        note: 'Tavolo interno', removes: 'Tavolo esterno/terrazza' },
      { pattern: /sedia\s*a\s*rotelle|disabil|carrozzin/i,
        note: 'Accessibilità disabili' },
      { pattern: /tranquill[oa]|riservat[oa]/i,
        note: 'Tavolo tranquillo/riservato' },
    ];

    // 🆕 FIX 3B: se il cliente sta CHIEDENDO di note già esistenti → non rilevare note
    // Distingue "sono celiaco" (dichiarazione) da "avete segnato la celiachia?" (domanda)
    const _isNoteQuestion = /(?:hai|avete|avevate|aveva|avevi)\s+(?:\w+\s+){0,2}(?:segnato|annotato|scritto|indicato|aggiunto|inserito)|risulta\s+(?:ancora\s+)?segnato|è\s+(?:ancora\s+)?segnato|lo\s+avete\s+segnato|avete\s+(?:\w+\s+){0,2}(?:segnato|annotato|aggiunto)/i.test(text);

    // Pattern domanda info vegan/vegetariano: "avete piatti vegani?" → NON è nota
    const _isVeganInfoQuestion = /avete.{0,25}vegan|avete.{0,25}vegetar|piatti.{0,20}vegan|piatti.{0,20}vegetar|menu.{0,20}vegan|opzion.{0,20}vegan|opzion.{0,20}vegetar|c.è.{0,15}vegan|ci sono.{0,15}vegan|offrite.{0,15}vegan|servite.{0,15}vegan/i.test(text);

    if (_isNoteQuestion) {
      console.log(`📋 Domanda su note esistenti → skip rilevamento nota: "${text.substring(0,60)}"`);
      // Non rilevare nuove note ma non uscire — continuiamo per il telefono alternativo
    }

    const newNotes = [];
    if (!_isNoteQuestion) {
      for (let kw of noteKeywords) {
        const { pattern, negation, removes, contextCapture, contextPrefix } = kw;
        let note = kw.note;
        // Guard: "vegano" come domanda info non va annotato come nota
        if (note === 'Vegano' && _isVeganInfoQuestion) {
          console.log(`📋 Vegan rilevato come domanda info → skip nota`);
          continue;
        }
        if (note === 'Vegetariano' && _isVeganInfoQuestion) {
          console.log(`📋 Vegetariano rilevato come domanda info → skip nota`);
          continue;
        }
        if (pattern.test(text)) {
          // GPT estrae il label semantico se gptCategory è definito
          // Questo sostituisce il contextCapture regex — scala col cambiamento del linguaggio
          if (kw.gptCategory) {
            const _gptLabel = await this._extractNoteWithGPT(text, kw.gptCategory);
            if (_gptLabel) {
              note = _gptLabel;
              console.log(`🧠 Nota GPT: "${_gptLabel}" (categoria: ${kw.gptCategory})`);
            }
          }
          // 🆕 FIX 4: controlla negazione
          if (negation && negation.test(text)) {
            console.log(`📋 Nota "${note}" negata nel contesto → skip`);
            continue;
          }
          // 🆕 FIX 4: rimuovi nota confliggente da sessione corrente
          if (removes) {
            if (this.data.notes && this.data.notes.includes(removes)) {
              this.data.notes = this.data.notes.split('; ').filter(n => n !== removes).join('; ') || null;
            }
            // 🆕 FIX TEST7A: segna anche per rimozione dal Calendar (note di sessioni precedenti)
            if (!this.data.notesToRemove) this.data.notesToRemove = [];
            if (!this.data.notesToRemove.includes(removes)) {
              this.data.notesToRemove.push(removes);
              console.log(`📋 Nota "${removes}" marcata per rimozione da Calendar`);
            }
          }
          // Aggiungi la nota solo se non è null (es. "interno" ha note: null → serve solo per rimuovere)
          if (note !== null) {
            // Evita duplicati
            if (!this.data.notes || !this.data.notes.includes(note)) {
              newNotes.push(note);
              console.log(`📝 Nota rilevata: "${note}"`);
            this._lastTopic = 'notes'; // STEP 3: topic memory
            }
          }
        }
      }
    }

    if (newNotes.length > 0) {
      const toAdd = newNotes.join('; ');
      this.data.notes = this.data.notes
        ? `${this.data.notes}; ${toAdd}`
        : toAdd;

      // STEP 2 (GPT): Note post-conferma — update_notes + conferma vocale + return immediato
      // Successful mutation deve short-circuitare il flow (GPT raccomandazione)
      if (this.phase === 'done' && this.lastReservation?.eventId) {
        const _evId = this.lastReservation.eventId;
        const _notes = this.data.notes;
        this.lastReservation.notes = _notes;
        const _notesClean = this._notesForClient(_notes);
        console.log(`📝 Note post-conferma → update_notes su Calendar: "${_notes}"`);
        this._callAppsScript({ action: 'update_notes', eventId: _evId, notes: _notes })
          .then(r => console.log(`📝 update_notes: ${r?.success ? 'OK' : 'FAIL'}`))
          .catch(e => console.error('❌ update_notes error:', e));
        // Short-circuit: conferma vocale — ritorna true per segnalare al caller
        this._lastTopic = 'notes';
        if (_notesClean) {
          this._say(`Ho annotato: ${_notesClean}. C'è altro che posso fare per lei?`);
        } else {
          this._say("Ho aggiornato le note sulla sua prenotazione. C'è altro che posso fare?");
        }
        return true; // segnala al caller che ha già risposto
      }
    }
    return false; // nessuna gestione speciale

    // ── Telefono alternativo ─────────────────────────────────────────────────
    const phonePattern = /(?:numero|telefono|cell(?:ulare)?|phone|contatt).*?(\+?\d[\d\s\-]{6,14}\d)/i;
    const phoneMatch = text.match(phonePattern);
    if (phoneMatch && !this.data.alternativePhone) {
      const phoneNumber = phoneMatch[1].replace(/[\s\-]/g, '');
      this.data.alternativePhone = phoneNumber;
      const phoneNote = `Tel. alternativo: ${phoneNumber}`;
      console.log(`📞 Telefono alternativo: "${phoneNumber}"`);
      if (!this.data.notes || !this.data.notes.includes('Tel. alternativo')) {
        this.data.notes = this.data.notes
          ? `${this.data.notes}; ${phoneNote}`
          : phoneNote;
      }
    }
  }

  // ── Core Logic Engine ─────────────────────────────────────────────────────

  async _onUserText(text) {
    if (this.checkingSlot) return;

    // ── CANCEL: conferma sì/no via testo grezzo — intercetta PRIMA di tutto ──
    if (this.cancelState === 'awaiting_confirm') {
      await this._handleCancelConfirmText(text);
      return;
    }

    // STEP 1: usa conversationLocked invece di phase=done come hard stop
    // phase=done = "prenotazione esiste", conversationLocked = "conversazione chiusa"
    if (this.conversationLocked) return;

    // Rileva note e telefono alternativo su ogni messaggio
    const _notesHandled2 = await this._detectNotesAndPhone(text);
    if (_notesHandled2) return; // BUG 6: note già gestite

    // Detect intent on first message
    if (!this.intent) {
      this.intent = IntentDetector.detect(text);
      console.log(`🎯 Intent: ${this.intent}`);
    }

    // ── COLLECT PHASE ─────────────────────────────────────────────────────
    if (this.phase === 'collecting') {
      await this._processCollecting(text);
    }
    // ── NAMING PHASE (dopo check slot ok) ─────────────────────────────────
    else if (this.phase === 'naming') {
      this._processNaming(text);
    }
  }

  async _processCollecting(text) {
    const rc = this.restaurantConfig;

    const prevDate = this.data.date;
    const prevTime = this.data.time;

    // Parse
    const date   = DateManager.parseFromText(text);
    const time   = TimeManager.parseFromText(text);
    const people = PeopleManager.parseFromText(text);

    if (date   && date   !== this.data.date)   { console.log(`📅 date:   ${this.data.date} → ${date}`);     this.data.date=date; }
    if (time   && time   !== this.data.time)   { console.log(`⏰ time:   ${this.data.time} → ${time}`);     this.data.time=time; }
    if (people && people !== this.data.people) { console.log(`👥 people: ${this.data.people} → ${people}`); this.data.people=people; }

    // Estrai nome anticipato se già presente nel messaggio (es. "sabato alle 21 per 2, nome Luca")
    if (!this.data.name) {
      const earlyName = this._extractName(text);
      if (earlyName) {
        this.data.name = earlyName;
        console.log(`👤 Nome anticipato: ${earlyName}`);
      }
    }

    console.log(`📊 date=${this.data.date} time=${this.data.time} people=${this.data.people}`);

    // ① Check giorno chiuso
    if (this.data.date && this.data.date !== prevDate) {
      const msg = ValidationPipeline.getDayClosedMessage(this.data.date, rc);
      if (msg) {
        console.log(`🚫 Giorno chiuso: ${this.data.date}`);
        this.data.date = null;
        this._say(msg);
        return;
      }
    }

    // ②③ Check fascia oraria + pranzo/cena chiuso
    if (this.data.date && this.data.time && this.data.time !== prevTime) {
      if (!ValidationPipeline.isValidTime(this.data.time, rc)) {
        const msg = ValidationPipeline.getTimeInvalidMessage(this.data.time, this.data.date, rc);
        console.log(`🚫 Orario non valido: ${this.data.time}`);
        this.data.time = null;
        this._say(msg);
        return;
      }

      // ② Check pranzo chiuso per quel giorno
      const [h] = this.data.time.split(':').map(Number);
      const isPranzo = h >= 10 && h <= 16;
      if (isPranzo && ValidationPipeline.isLunchClosed(this.data.date, rc)) {
        const dayName = DateManager.getDayName(this.data.date);
        const ds = rc?.dinner_start || '21:00';
        const de = rc?.dinner_end   || '22:30';
        const msg = `Il ${dayName} siamo aperti solo a cena (${ds}-${de}). Vuole prenotare per cena?`;
        console.log(`🚫 Pranzo chiuso: ${this.data.date}`);
        this.data.time = null;
        this._say(msg);
        return;
      }

      // ③ Check cena chiusa per quel giorno
      const isCena = h >= 17 || h <= 3;
      if (isCena && ValidationPipeline.isDinnerClosed(this.data.date, rc)) {
        const dayName = DateManager.getDayName(this.data.date);
        const ls = rc?.lunch_start || '12:00';
        const le = rc?.lunch_end   || '14:30';
        const msg = `Il ${dayName} siamo aperti solo a pranzo (${ls}-${le}). Vuole prenotare per pranzo?`;
        console.log(`🚫 Cena chiusa: ${this.data.date}`);
        this.data.time = null;
        this._say(msg);
        return;
      }

      // Orario ok — se abbiamo anche le persone vai al check slot
      if (this.data.people) {
        await this._checkSlot();
        return;
      }
      this._ask('people');
      return;
    }

    // ④ Tutti e 3 → check slot
    if (this.data.date && this.data.time && this.data.people && !this.checkingSlot) {
      await this._checkSlot();
      return;
    }

    // Chiedi dato mancante
    if (!this.data.date) {
      this._ask('date');
    } else if (!this.data.time) {
      this._ask('time');
    } else if (!this.data.people) {
      this._ask('people');
    }
  }

  _processNaming(text) {
    const rc = this.restaurantConfig;

    // Se il nome è già stato settato da GPT, conferma direttamente
    if (text === '__name_already_set__' && this.data.name) {
      console.log(`👤 Nome (GPT): ${this.data.name}`);
      this._confirmReservation();
      return;
    }

    // ── Controlla se l'utente sta correggendo i dati prima di dare il nome ──
    // ── Controlla correzioni dati in fase naming ──────────────────────────────
    // Anche senza parole trigger esplicite, se il cliente menziona dati diversi
    // da quelli già raccolti, trattiamo come correzione
    {
      let changed = false;

      const newPeople = PeopleManager.parseFromText(
        text.replace(/\bnon\s+(?:in\s+)?\w+/gi, '')
      );
      const newTime   = TimeManager.parseFromText(text);

      // Per la data: rimuovi contesto negativo ("non per sabato") prima di parsare
      const textForDate = text.replace(/\bnon\s+per\s+\w+/gi, '');
      const correctedDate = DateManager.parseFromText(textForDate);

      if (newPeople && newPeople !== this.data.people) {
        console.log(`👥 Correzione persone in naming: ${this.data.people} → ${newPeople}`);
        this.data.people = newPeople;
        changed = true;
      }
      if (newTime && newTime !== this.data.time) {
        console.log(`⏰ Correzione orario in naming: ${this.data.time} → ${newTime}`);
        this.data.time = newTime;
        changed = true;
      }
      if (correctedDate && correctedDate !== this.data.date) {
        console.log(`📅 Correzione data in naming: ${this.data.date} → ${correctedDate}`);
        this.data.date = correctedDate;
        changed = true;
      }

      if (changed) {
        // Controlla se il nome era già nella stessa frase della correzione
        const nameInCorrection = this._extractName(text);
        if (nameInCorrection) {
          this.data.name = nameInCorrection;
          console.log(`👤 Nome trovato nella correzione: ${nameInCorrection}`);
        }
        this.phase = 'collecting';
        this.availDone = false;
        this.checkingSlot = false;
        this._checkSlot();
        return;
      }
    }

    // ── Estrai nome ───────────────────────────────────────────────────────────
    const name = this._extractName(text);
    if (name) {
      this.data.name = name;
      console.log(`👤 Nome: ${name}`);
      this._confirmReservation();
    } else {
      this._ask('name');
    }
  }

  // ── MODIFY flow ───────────────────────────────────────────────────────────

  // Helper: ricerca a 4 stadi con priorità sicura (STEP 4 anti-regressione)
  //
  // Logica:
  //   Stadio 1: nome + data      → se confidence >= 0.9 → ritorna subito
  //                              → se fuzzy incerto → salva come candidato, continua
  //   Stadio 2: solo nome        → idem
  //   Stadio 3: telefono         → PRIORITY: se trovato, usa SEMPRE (batte fuzzy incerto)
  //   Stadio 4: solo se tel fail → usa miglior fuzzy candidato raccolto (chiede conferma)
  //
  // Ritorna:
  //   - reservation object                             → match certo, procedi
  //   - { fuzzyCandidate, requiresConfirmation: true } → chiedi conferma
  //   - null                                           → non trovato
  async _findReservationWithFallback(searchName, searchDate, logPrefix) {
    const phone = this.callerPhone || '';
    const isValid = (r) => r && r.date && r.name && r.date !== 'null' && r.name !== 'null';

    let bestFuzzyCandidate = null; // miglior fuzzy incerto raccolto durante la ricerca

    // Stadio 1: nome + data
    if (searchName && searchDate) {
      console.log(`🔍 ${logPrefix} cerca: nome=${searchName}, data=${searchDate}`);
      const r1 = await this._callAppsScript({ action: 'find_reservation', nome: searchName, data: searchDate, sheet: 'Prenotazioni' });
      if (r1?.found && isValid(r1.reservation)) {
        const res = r1.reservation;
        if (!res.requiresConfirmation) return res; // match esatto → procedi subito
        // Fuzzy incerto → salva e continua verso telefono
        console.log(`🔍 Fuzzy candidato (${res.fuzzyConfidence?.toFixed(2)}): ${res.name} — cerco telefono prima`);
        if (!bestFuzzyCandidate || res.fuzzyConfidence > bestFuzzyCandidate.fuzzyConfidence) {
          bestFuzzyCandidate = res;
        }
      }
    }

    // Stadio 2: solo nome
    if (searchName) {
      console.log(`🔍 ${logPrefix} fallback: solo nome=${searchName}`);
      const r2 = await this._callAppsScript({ action: 'find_reservation', nome: searchName, sheet: 'Prenotazioni' });
      if (r2?.found && isValid(r2.reservation)) {
        const res = r2.reservation;
        if (!res.requiresConfirmation) return res;
        console.log(`🔍 Fuzzy candidato (${res.fuzzyConfidence?.toFixed(2)}): ${res.name} — cerco telefono prima`);
        if (!bestFuzzyCandidate || res.fuzzyConfidence > bestFuzzyCandidate.fuzzyConfidence) {
          bestFuzzyCandidate = res;
        }
      }
    }

    // Stadio 3: telefono — PRIORITY, batte sempre il fuzzy incerto
    // Comportamento identico a prima del STEP 4 — nessuna regressione possibile
    if (phone) {
      console.log(`🔍 ${logPrefix} fallback telefono: ${phone}`);
      const r3 = await this._callAppsScript({ action: 'find_reservation', telefono: phone, sheet: 'Prenotazioni' });
      if (r3?.found && isValid(r3.reservation)) {
        console.log(`✅ ${logPrefix} trovato per telefono → priorità su fuzzy`);
        return r3.reservation; // telefono vince sempre
      }
    }

    // Stadio 4: nessun match esatto né telefono — usa miglior fuzzy candidato
    if (bestFuzzyCandidate) {
      console.log(`🔍 Stadio 4: uso fuzzy candidato (${bestFuzzyCandidate.fuzzyConfidence?.toFixed(2)}): ${bestFuzzyCandidate.name}`);
      return { fuzzyCandidate: bestFuzzyCandidate, requiresConfirmation: true };
    }

    return null;
  }

  // STEP 4: gestisci fuzzy candidate — chiedi conferma all'utente
  _handleFuzzyCandidate(candidate, flowType) {
    // flowType: 'modify' | 'cancel'
    const timeNorm = candidate.time?.length === 5 ? candidate.time + ':00' : (candidate.time || '');
    const dateDisplay = DateManager.formatForDisplay(candidate.date);
    const timeDisplay = TimeManager.formatForDisplay(timeNorm);
    const action = flowType === 'cancel' ? 'cancellare' : 'modificare';

    console.log(`🔍 Fuzzy confirm: ${candidate.name} (${candidate.fuzzyConfidence?.toFixed(2)})`);

    // Salva il candidato e aspetta conferma
    this.foundReservation = candidate;
    if (flowType === 'modify') {
      this.modifyState = 'awaiting_smart_confirm';
      this._smartModifyParams = { date: candidate.date, time: candidate.time, people: candidate.people, name: candidate.name };
    } else {
      this.cancelState = 'awaiting_confirm';
    }

    this._say(
      `Ho trovato una prenotazione a nome ${candidate.name}, ${dateDisplay} alle ${timeDisplay} per ${candidate.people} persone. ` +
      `È quella che vuole ${action}?`
    );
  }

  // ── GPT people extractor per awaiting_changes ───────────────────────────────
  // Gestisce espressioni relative: "si sono aggiunte due", "altre due", "uno in meno"
  // PeopleManager non può fare aritmetica — GPT interpreta e ritorna il totale assoluto
  async _extractPeopleGPT(transcript, currentPeople) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          temperature: 0,
          max_tokens: 5,
          messages: [{
            role: 'system',
            content: `La prenotazione attuale è per ${currentPeople} persone. L'utente vuole modificare il numero. Rispondi SOLO con il numero intero totale finale. Se non capisci rispondi null.`
          }, {
            role: 'user', content: transcript
          }]
        })
      });
      clearTimeout(timeout);
      const data = await response.json();
      const raw = data?.choices?.[0]?.message?.content?.trim();
      const num = parseInt(raw);
      if (!isNaN(num) && num > 0 && num <= 50) {
        console.log(`🧠 People GPT: "${raw}" → ${num} (da ${currentPeople})`);
        return num;
      }
      return null;
    } catch (err) {
      return null;
    }
  }

  // ══ MODIFY PATCH SYSTEM (GPT semantic diff) ══════════════════════════════
  // Invece di parsare entità assolute, GPT interpreta il DELTA rispetto alla prenotazione corrente.
  // Output: { action, changes: { people: {mode,value}, time: {mode,value}, date: {mode,value} } }
  // action: "modify" | "reject" | "no_change"
  // mode: "delta" (relativo) | "set" (assoluto) | "delta_minutes" (per orario)
  async _resolveModifyPatch(transcript, r) {
    try {
      const timeNorm = r.time?.length === 5 ? r.time + ':00' : (r.time || '');
      const dateDisplay = DateManager.formatForDisplay(r.date);
      const timeDisplay = TimeManager.formatForDisplay(timeNorm);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          temperature: 0,
          max_tokens: 120,
          messages: [{
            role: 'system',
            content: `Sei un interprete di modifiche a prenotazioni ristorante. Analizza il messaggio utente rispetto alla prenotazione corrente e rispondi SOLO con JSON valido, nient'altro.

Prenotazione corrente:
- nome: ${r.name}
- persone: ${r.people}
- giorno: ${dateDisplay}
- orario: ${timeDisplay}

Regole:
- action="modify" se vuole cambiare qualcosa
- action="reject" se rifiuta esplicitamente (solo "no grazie", "annulla", "lasci perdere")
- action="no_change" se non si capisce cosa vuole modificare
- people mode="delta": positivo=aggiunge, negativo=riduce (es: "aggiunte 2" → delta +2)
- people mode="set": numero finale assoluto (es: "diventiamo 6" → set 6)
- time mode="set": orario finale HH:MM:SS
- time mode="delta_minutes": minuti in più/meno (es: "mezz'ora dopo" → +30)
- date mode="set": data finale YYYY-MM-DD
- Se una chiave non cambia, NON includerla in changes.

Esempio output:
{"action":"modify","changes":{"people":{"mode":"delta","value":2}}}`
          }, {
            role: 'user', content: transcript
          }]
        })
      });
      clearTimeout(timeout);
      const data = await response.json();
      const raw = data?.choices?.[0]?.message?.content?.trim();
      const patch = JSON.parse(raw);
      console.log(`🔧 ModifyPatch: ${JSON.stringify(patch)}`);
      return patch;
    } catch (err) {
      console.log('⚠️ _resolveModifyPatch error:', err?.message);
      return null;
    }
  }

  // Applica il patch alla prenotazione corrente → ritorna valori aggiornati
  _applyModifyPatch(r, patch) {
    const timeNorm = r.time?.length === 5 ? r.time + ':00' : (r.time || '21:00:00');
    let updDate   = r.date;
    let updTime   = timeNorm;
    let updPeople = Number(r.people);

    const changes = patch?.changes || {};

    if (changes.people) {
      if (changes.people.mode === 'delta') {
        updPeople = Number(r.people) + Number(changes.people.value);
      } else if (changes.people.mode === 'set') {
        updPeople = Number(changes.people.value);
      }
      updPeople = Math.max(1, Math.min(50, updPeople)); // clamp 1-50
    }

    if (changes.time) {
      if (changes.time.mode === 'set') {
        updTime = changes.time.value;
      } else if (changes.time.mode === 'delta_minutes') {
        const [h, m] = timeNorm.split(':').map(Number);
        const total = h * 60 + m + Number(changes.time.value);
        const nh = Math.floor(total / 60) % 24;
        const nm = total % 60;
        updTime = `${String(nh).padStart(2,'0')}:${String(nm).padStart(2,'0')}:00`;
      }
    }

    if (changes.date?.mode === 'set') {
      updDate = changes.date.value;
    }

    return { updDate, updTime, updPeople };
  }

  async _handleModifyFlow(newDate, newTime, newPeople, newName) {
    // Phase 1: primo messaggio modify → se contiene già nome e data, salta il prompt
    if (!this.modifyState) {
      this.modifyState = 'awaiting_search';
      // 🆕 Cancella eventuale risposta GPT in corso

      // Se il primo messaggio contiene già nome E data, cerca subito
      if (newName && newDate) {
        if (newName) this.data.name = newName;
        if (newDate) this.data.date = newDate;
        this._say('Un momento, cerco la prenotazione...');
        const r = await this._findReservationWithFallback(newName, newDate, 'MODIFY primo msg');
        if (this.intent !== 'modify') { console.log('🚫 MODIFY search abortita: intent cambiato durante ricerca'); return; }
        if (r) {
          // STEP 4: fuzzy candidate → chiedi conferma prima di procedere
          if (r.requiresConfirmation) { this._handleFuzzyCandidate(r.fuzzyCandidate, 'modify'); return; }
          this.foundReservation = r;
          const smartHandled = await this._trySmartModify(r, newDate, newTime, newPeople);
          if (!smartHandled) {
            const timeNorm = r.time?.length === 5 ? r.time + ':00' : (r.time || '');
            const dateDisplay = DateManager.formatForDisplay(r.date);
            const timeDisplay = TimeManager.formatForDisplay(timeNorm);
            this.modifyState = 'awaiting_changes';
            this._say(`Ho trovato: ${r.name}, ${dateDisplay} alle ${timeDisplay} per ${r.people} persone. Cosa vuole modificare?`);
          }
        } else {
          this._say(`Non trovo nessuna prenotazione a nome ${newName}. Può riprovare con un altro nome o data?`);
        }
        return;
      }

      // Se abbiamo solo il nome (senza data), cerca subito per nome/telefono
      if (newName && !newDate) {
        if (newName) this.data.name = newName;
        console.log(`🔍 MODIFY primo msg: solo nome=${newName}, cerco senza data`);
        this._say('Un momento, cerco la prenotazione...');
        const r = await this._findReservationWithFallback(newName, null, 'MODIFY solo nome');
        if (this.intent !== 'modify') { console.log('🚫 MODIFY search abortita: intent cambiato durante ricerca'); return; }
        if (r) {
          // STEP 4: fuzzy candidate → chiedi conferma
          if (r.requiresConfirmation) { this._handleFuzzyCandidate(r.fuzzyCandidate, 'modify'); return; }
          this.foundReservation = r;
          const smartHandled2 = await this._trySmartModify(r, r.date, newTime, newPeople);
          if (!smartHandled2) {
            const timeNorm = r.time?.length === 5 ? r.time + ':00' : (r.time || '');
            const dateDisplay = DateManager.formatForDisplay(r.date);
            const timeDisplay = TimeManager.formatForDisplay(timeNorm);
            this.modifyState = 'awaiting_changes';
            this._say(`Ho trovato: ${r.name}, ${dateDisplay} alle ${timeDisplay} per ${r.people} persone. Cosa vuole modificare?`);
          }
        } else {
          this._say('A che nome è la prenotazione e per quale data?');
        }
        return;
      }

      // Altrimenti chiedi nome e data
      this._say('Certo! A che nome è la prenotazione e per quale data?');
      return;
    }

    // Phase 2: cerca la prenotazione
    if (this.modifyState === 'awaiting_search') {
      const searchName = newName || this.data.name;
      const searchDate = newDate || this.data.date;

      // Aggiorna dati locali per mantenere contesto
      if (newName) this.data.name = newName;
      if (newDate) this.data.date = newDate;

      if (!searchName && !searchDate) {
        this._say('Può dirmi a che nome è la prenotazione e per quale data?');
        return;
      }
      if (!searchName) {
        this._say('A che nome è la prenotazione?');
        return;
      }
      if (!searchDate) {
        this._say('Per quale data è la prenotazione?');
        return;
      }

      this._say('Un momento, cerco la prenotazione...');
      const r = await this._findReservationWithFallback(searchName, searchDate, 'MODIFY');
      if (r) {
        this.foundReservation = r;
        // 🆕 SMART MODIFY: check anche nella fase awaiting_search
        const smartHandled3 = await this._trySmartModify(r, newDate, newTime, newPeople);
        if (!smartHandled3) {
          const timeNorm = r.time?.length === 5 ? r.time + ':00' : (r.time || '');
          const dateDisplay = DateManager.formatForDisplay(r.date);
          const timeDisplay = TimeManager.formatForDisplay(timeNorm);
          this.modifyState = 'awaiting_changes';
          this._say(`Ho trovato: ${r.name}, ${dateDisplay} alle ${timeDisplay} per ${r.people} persone. Cosa vuole modificare?`);
        }
      } else {
        this._say(`Non trovo nessuna prenotazione a nome ${searchName}. Può riprovare con un altro nome o data?`);
      }
      return;
    }

    // Phase 3: applica le modifiche
    if (this.modifyState === 'awaiting_changes') {
      const r = this.foundReservation;
      if (!r) { this.modifyState = null; return; }

      // ══ PATCH SYSTEM — GPT interpreta il delta semantico ══════════════════════
      // "si sono aggiunte due persone" → people delta +2 (non set 2)
      // "mezz'ora dopo" → time delta +30min
      // "No, diventiamo sei" → correzione, non rifiuto
      const _transcript = this.lastTranscript || '';
      const patch = await this._resolveModifyPatch(_transcript, r);

      if (!patch) {
        // GPT non disponibile → fallback vecchio sistema con parser
        this._say('Non ho capito cosa vuole modificare. Vuole cambiare la data, l\'orario o il numero di persone?');
        return;
      }

      if (patch.action === 'reject') {
        // Rifiuto ESPLICITO ("no grazie", "annulla", "lasci perdere")
        // NON resettare — chiedi cosa vuole fare
        this._say('Ok, la prenotazione rimane invariata. Posso aiutarla con altro?');
        this.modifyState = 'done';
        return;
      }

      if (patch.action === 'no_change' || !patch.changes || Object.keys(patch.changes).length === 0) {
        this._say('Non ho capito cosa vuole modificare. Vuole cambiare la data, l\'orario o il numero di persone?');
        return;
      }

      // Applica il patch → calcola valori aggiornati
      const { updDate, updTime, updPeople } = this._applyModifyPatch(r, patch);
      const updName = r.name;

      // Verifica che almeno qualcosa sia cambiato
      const timeOrig = r.time?.length === 5 ? r.time + ':00' : (r.time || '');
      const changed = updDate !== r.date || updTime !== timeOrig || updPeople !== Number(r.people);
      if (!changed) {
        this._say('Non ho capito cosa vuole modificare. Vuole cambiare la data, l\'orario o il numero di persone?');
        return;
      }

      // Mostra recap e chiedi conferma (path SMART MODIFY)
      const mergedNotes = this._mergeNotesStr(r.notes || '', this.data.notes || '', this.data.notesToRemove || []);
      const rNotesArr = r.notes ? r.notes.split('; ').map(s => s.trim()).filter(Boolean) : [];
      const mergedArr = mergedNotes ? mergedNotes.split('; ').map(s => s.trim()).filter(Boolean) : [];
      const addedNotes = mergedArr.filter(n => !rNotesArr.includes(n));
      const newNotesStr = addedNotes.length > 0 ? addedNotes.join(', ') : null;
      this._smartModifyParams = { r, updDate, updTime, updPeople, mergedNotes };
      this.modifyState = 'awaiting_smart_confirm';
      const msg = this._buildSmartModifyMsg(r, updDate, updTime, updPeople, false, newNotesStr);
      console.log(`🔧 PATCH→SMART: ${r.people}pax→${updPeople}pax ${timeOrig}→${updTime} ${r.date}→${updDate}`);
      this._say(msg);
      return;
      // ─── (il codice sotto è ora raggiunto solo da _handleSmartModifyConfirm) ─

      // Lock anti-double: impedisce al secondo GPT trigger di eseguire un altro MODIFY
      this._processingModify = true;

      // Se data/ora/persone cambiano → check disponibilità
      if (dateChanged || timeChanged || (peopleChanged && updPeople > Number(r.people))) {
        // Fix T2-B: valida l'orario PRIMA di fare il check disponibilità
        if (updTime && !ValidationPipeline.isValidTime(updTime, this.restaurantConfig)) {
          console.log(`🚫 MODIFY: orario non valido: ${updTime}`);
          const rc = this.restaurantConfig;
          const lunch = rc?.lunch_hours || '12:00-14:30';
          const dinner = rc?.dinner_hours || '21:00-22:30';
          this._processingModify = false;
          this._say(`Quell'orario è fuori dai nostri orari. Pranzo ${lunch}, cena ${dinner}. Che orario preferisce?`);
          // Fix B4 MODIFY: forza GPT a NON confermare dopo orario invalido
          return;
        }
        console.log(`🔍 MODIFY check disponibilità: ${updDate} ${updTime} per ${updPeople}`);
        // Fix: usa pending (success:true) per evitare rogue response di GPT durante il check
        this._say('Un attimo che verifico la disponibilità...');
        // Fix E3/E9: existingPeople va passato SOLO se il nuovo slot coincide con quello originale.
        // Se si sposta su data/ora diversa, i pax esistenti NON sono nel nuovo slot → existingPeople=0.
        const _sameSlot = (updDate === r.date && updTime === r.time);
        const _existingPeopleForCheck = _sameSlot ? Number(r.people) : 0;
        if (_existingPeopleForCheck > 0) {
          console.log(`🔍 MODIFY stesso slot → existingPeople=${_existingPeopleForCheck} (offset corretto)`);
        } else if (!_sameSlot) {
          console.log(`🔍 MODIFY slot diverso (${r.date} ${r.time} → ${updDate} ${updTime}) → existingPeople=0`);
        }
        const checkResult = await this._callAppsScript({
          action: 'check_availability',
          data: updDate,
          ora: updTime,
          persone: updPeople,
          existingPeople: _existingPeopleForCheck,
        });

        if (!checkResult?.success) {
          // 🆕 FIX day_closed: se il giorno è chiuso, dillo esplicitamente
          if (checkResult?.reason === 'day_closed') {
            const dayName = DateManager.getDayName(updDate) || 'quel giorno';
            this._processingModify = false;
            this._say(`Mi dispiace, il ${dayName} siamo chiusi. Vuole provare un altro giorno?`);
            return;
          }
          // Fix: cerca slot alternativi come fa il CREATE invece di rifiutare e basta
          this._processingModify = false;
          try {
            const alts = await this._callAppsScript({
              action: 'find_available_slots',
              data: updDate,
              ora: updTime,
              persone: updPeople,
            });

            const sameDay = alts?.availableSlots?.sameDay || [];
            const nextDays = alts?.availableSlots?.nextDays || [];

            const rc = this.restaurantConfig;
            const validSameDay = sameDay.filter(s =>
              ValidationPipeline.isValidTime(s.time, rc)
            );

            if (validSameDay.length > 0) {
              const times = validSameDay.slice(0, 3).map(s => s.time.substring(0,5)).join(', ');
              console.log(`✅ MODIFY alternative stesso giorno: ${times}`);
              this._say(`Mi dispiace, quell'orario è al completo. Per quel giorno ho disponibilità alle ${times}. Vuole spostare la prenotazione a uno di questi orari?`);
            } else if (nextDays.length > 0) {
              const first = nextDays[0];
              const dayName = first.dayName || '';
              const validSlots = (first.slots || []).filter(s =>
                ValidationPipeline.isValidTime(s.time, rc)
              );
              const times = validSlots.slice(0, 2).map(s => s.time.substring(0,5)).join(' o ');
              console.log(`✅ MODIFY alternative prossimi giorni: ${dayName} ${times}`);
              this._say(`Mi dispiace, siamo al completo per quel giorno. Prima disponibilità ${dayName} alle ${times}. Vuole spostare la prenotazione?`);
            } else {
              console.log('❌ MODIFY nessuna alternativa valida');
              this._say(`Mi dispiace, quell'orario non è disponibile. Vuole provare un altro giorno?`);
            }
          } catch (err) {
            console.error('❌ MODIFY errore ricerca alternative:', err);
            this._say(`Mi dispiace, quell'orario non è disponibile. Vuole provare un altro orario?`);
          }
          return;
        }
      }

      console.log(`✏️ MODIFY aggiorna eventId=${r.eventId}: ${updDate} ${updTime} ${updPeople} pax ${updName}`);
      this._say('Perfetto, aggiorno subito...');
      const updateResult = await this._callAppsScript({
        action: 'update_reservation',
        eventId: r.eventId,
        nome: updName,
        data: updDate,
        ora: updTime,
        persone: updPeople,
        telefono: this.callerPhone || r.phone || '',  // 🆕 FIX PHONE: callerPhone ha sempre + normalizzato
        // 🆕 FIX TEST2+TEST7A: merge note + rimuovi quelle marcate per rimozione
        notes: this._mergeNotesStr(r.notes || '', this.data.notes || '', this.data.notesToRemove || []),
      });

      this.phase = 'done';
      this._processingModify = false;  // reset: MODIFY completato
      if (updateResult?.success) {
        const dateDisplay = DateManager.formatForDisplay(updDate);
        const timeDisplay = TimeManager.formatForDisplay(updTime);
        const firstName = updName || ''; // usa nome completo (supporta nomi composti: De Luca, Di Maio, ecc.)
        // Salva riferimento alla prenotazione aggiornata per uso post-done
        this.lastReservation = {
          eventId: r.eventId,
          name: updName,
          date: updDate,
          time: updTime,
          people: updPeople,
          phone: this.callerPhone || r.phone || '',  // 🆕 FIX PHONE: callerPhone ha sempre + normalizzato
          // 🆕 FIX TEST2+TEST7A: merge per lastReservation + rimozioni
          notes: this._mergeNotesStr(r.notes || '', this.data.notes || '', this.data.notesToRemove || []),
        };
        console.log(`💾 lastReservation aggiornato dopo MODIFY: eventId=${r.eventId}`);
        // Reset intent a 'done' dopo MODIFY completato — evita che il MODIFY reminder
        // si attivi quando l'utente fa domande post-modifica (es: "hai segnato le note?")
        this.intent = 'done_modify';
        this._say(`Perfetto ${firstName}! Ho aggiornato la prenotazione: ${dateDisplay} alle ${timeDisplay} per ${updPeople} persone. Ti aspettiamo!`);

        // FIX: se la conferma conteneva anche una domanda sulle note, rispondi subito
        const _confirmTxt = this.lastTranscript || '';
        const _hadNoteQ = /\b(?:segnato|annotato|segnalato|ancora\s+segnata?|ancora\s+annotata?|ancora\s+assegnata?|hai\s+segnato|avete\s+segnato|l'avete|l'hai)/i.test(_confirmTxt);
        if (_hadNoteQ && this.lastReservation?.notes) {
          const _notesTxt = this._notesForClient(this.lastReservation.notes);
          if (_notesTxt) setTimeout(() => this._say(`Sì, ho ancora annotato: ${_notesTxt}.`), 1500);
        }
      } else {
        this._say(`Mi dispiace, c'è stato un problema nell'aggiornamento. Può richiamare?`);
      }
    }
  }

  // ── CANCEL flow ───────────────────────────────────────────────────────────

  // ════════════════════════════════════════════════════════════════════
  // 🆕 SMART MODIFY — conferma in un turno solo
  // ════════════════════════════════════════════════════════════════════

  /**
   * Costruisce il messaggio di recap per il smart MODIFY.
   * Mostra cosa cambia, risponde alle domande sulle note esistenti,
   * annuncia note nuove e chiede conferma in un unico messaggio.
   */
  // ── Helper: filtra note interne (tra parentesi) prima di leggerle al cliente ─
  _notesForClient(notesStr) {
    if (!notesStr) return '';
    return notesStr
      .split(';')
      .map(n => n.replace(/\s*\([^)]*\)/g, '').trim())
      .filter(n => n.length > 0)
      // Filtra campi interni Apps Script che non vanno letti al cliente
      .filter(n => !/^Gruppo\s*:/i.test(n) && !/^Group\s*:/i.test(n))
      .join('; ');
  }

  _buildSmartModifyMsg(r, updDate, updTime, updPeople, noteCheck, newNotesStr) {
    const dateDisplay = DateManager.formatForDisplay(updDate);
    const timeDisplay = TimeManager.formatForDisplay(updTime);
    const paxLabel   = `${updPeople} person${updPeople === 1 ? 'a' : 'e'}`;

    let msg = `Perfetto ${r.name}! Modifico la sua prenotazione: ${dateDisplay} alle ${timeDisplay} per ${paxLabel}.`;

    // Risponde alla domanda "avete ancora la nota X?"
    if (noteCheck && r.notes) {
      msg += ` Sì, ho ancora annotato: ${this._notesForClient(r.notes)}.`;
    }

    // Anuncia note nuove aggiunte
    if (newNotesStr) {
      msg += ` Ho aggiunto: ${newNotesStr}.`;
    }

    msg += ` Confermo?`;
    return msg;
  }

  /**
   * Rileva se il primo messaggio MODIFY contiene già le modifiche.
   * Se sì → mostra recap + chiede sì/no → salva in _smartModifyParams.
   * Returns true se lo ha gestito, false se si deve passare al flusso classico.
   */
  async _trySmartModify(r, newDate, newTime, newPeople) {
    const timeOrig = r.time?.length === 5 ? r.time + ':00' : (r.time || null);

    // FIX people: distingue cambio esplicito da rumore parser
    // "ho UNA prenotazione" → newPeople=1 ma NON è un cambio esplicito
    // "diventiamo quattro" / "siamo in 4" → cambio esplicito
    const _transcript = this.lastTranscript || '';
    const _explicitPeopleChange = /\bdiventiamo\b|\bsiamo\s+in\b|\bsaremo\b|\bsi\s+aggiunge\b|\bin\s+più\b|\bin\s+meno\b|\bpersone?\s+(?:in|total|\d)|\baggiungo\b|\baggiungiamo\b|\bun[oa]\s+in\s+più\b|\bsolo\s+\d/i.test(_transcript);
    const _peopleExtractedExplicitly = this._peopleChange === true || _explicitPeopleChange;
    const peopleChanged = newPeople && Number(newPeople) !== Number(r.people) && _peopleExtractedExplicitly;
    const timeChanged   = newTime   && newTime !== timeOrig;
    const dateChanged   = newDate   && newDate !== r.date;
    const hasNewNotes   = !!(this.data.notes && this.data.notes.length > 0);
    const noteCheck     = this._noteCheck === true;

    // Se non c'è nessuna informazione utile → flusso classico
    if (!peopleChanged && !timeChanged && !dateChanged && !hasNewNotes && !noteCheck) {
      return false;
    }

    // Calcola valori finali
    const updDate   = (dateChanged ? newDate : r.date);
    const updTime   = (timeChanged ? newTime : timeOrig);
    const updPeople = Number(peopleChanged ? newPeople : r.people);

    // Valida orario se cambiato
    if (timeChanged && !ValidationPipeline.isValidTime(updTime, this.restaurantConfig)) {
      const rc = this.restaurantConfig;
      const lunch  = rc?.lunch_hours  || '12:00-14:30';
      const dinner = rc?.dinner_hours || '21:00-22:30';
      this._say(`Quell'orario è fuori dai nostri orari. Pranzo ${lunch}, cena ${dinner}. Che orario preferisce?`);
      this.modifyState = 'awaiting_changes';
      return true;
    }

    // Calcola note finali e note nuove (da annunciare nel recap)
    const mergedNotes = this._mergeNotesStr(r.notes || '', this.data.notes || '', this.data.notesToRemove || []);
    const rNotesArr   = r.notes ? r.notes.split('; ').map(s => s.trim()).filter(Boolean) : [];
    const mergedArr   = mergedNotes ? mergedNotes.split('; ').map(s => s.trim()).filter(Boolean) : [];
    const addedNotes  = mergedArr.filter(n => !rNotesArr.includes(n));
    const newNotesStr = addedNotes.length > 0 ? addedNotes.join(', ') : null;

    // Salva per l'esecuzione post-conferma
    this._smartModifyParams = { r, updDate, updTime, updPeople, mergedNotes };
    this.modifyState = 'awaiting_smart_confirm';

    const msg = this._buildSmartModifyMsg(r, updDate, updTime, updPeople, noteCheck, newNotesStr);
    console.log(`🤖 SMART MODIFY: recap pronto (people=${updPeople}, time=${updTime}, date=${updDate})`);
    this._say(msg);
    return true;
  }

  /**
   * Gestisce la risposta sì/no al recap del smart MODIFY.
   * Chiamato dal transcript handler quando modifyState === 'awaiting_smart_confirm'.
   */
  async _handleSmartModifyConfirm(text) {
    // ⚠️ \b non funziona con caratteri accentati (ì, è...) in JS — pattern espliciti per sì/si
    const hasSi = /(^|[\s,!?])s[ìi]($|[\s,!?.,])/i.test(text) || /^s[ìi]$/i.test(text.trim());
    const yes = hasSi
             || /\b(certo|confermo|confermi|esatto|giusto|procedi|perfetto|aggiorna|va bene|ok|okay)\b/i.test(text);
    const no  = /\b(no|annulla|aspetta|fermati|stop|lascia perdere|cambia)\b/i.test(text);

    if (!yes && !no) {
      this._say('Non ho capito. Confermo la modifica? Dica sì o no.');
      return;
    }

    const params = this._smartModifyParams;
    this.modifyState       = null;
    this._smartModifyParams = null;

    if (no) {
      this._say('Ok, la sua prenotazione rimane invariata.');
      this.phase = 'done';
      return;
    }

    // ── Esegui la modifica ──────────────────────────────────────────
    const { r, updDate, updTime, updPeople, mergedNotes } = params;
    const timeOrig   = r.time?.length === 5 ? r.time + ':00' : (r.time || null);
    const slotChanged = updDate !== r.date || updTime !== timeOrig;

    this._processingModify = true;

    if (slotChanged) {
      this._say('Un attimo che verifico la disponibilità...');
      const checkResult = await this._callAppsScript({
        action: 'check_availability',
        data:   updDate,
        ora:    updTime,
        persone: updPeople,
        existingPeople: 0,
      });

      if (!checkResult?.success && checkResult?.reason !== 'slot_available') {
        this._processingModify = false;
        if (checkResult?.reason === 'day_closed') {
          const dayName = DateManager.getDayName(updDate) || 'quel giorno';
          this._say(`Mi dispiace, il ${dayName} siamo chiusi. Vuole provare un altro giorno?`);
        } else {
          this._say(`Mi dispiace, quell'orario non è disponibile. Vuole provare un altro orario?`);
        }
        // Ripristina per eventuale nuovo tentativo
        this.modifyState    = 'awaiting_changes';
        this.foundReservation = r;
        return;
      }
    }

    console.log(`✏️ SMART MODIFY esegue: eventId=${r.eventId} ${updDate} ${updTime} ${updPeople}pax`);
    this._say('Perfetto, aggiorno subito...');

    const updateResult = await this._callAppsScript({
      action:   'update_reservation',
      eventId:  r.eventId,
      nome:     r.name,
      data:     updDate,
      ora:      updTime,
      persone:  updPeople,
      telefono: this.callerPhone || r.phone || '',
      notes:    mergedNotes,
    });

    this._processingModify = false;
    this.phase = 'done';

    if (updateResult?.success) {
      const dateDisplay = DateManager.formatForDisplay(updDate);
      const timeDisplay = TimeManager.formatForDisplay(updTime);
      this.lastReservation = {
        eventId: r.eventId,
        name:    r.name,
        date:    updDate,
        time:    updTime,
        people:  updPeople,
        notes:   mergedNotes,
        phone:   this.callerPhone || r.phone || '',
        status:  'CONFIRMED',
      };
      console.log(`💾 lastReservation aggiornato dopo SMART MODIFY: eventId=${r.eventId}`);
      this._say(`Perfetto ${r.name}! Ho aggiornato la prenotazione: ${dateDisplay} alle ${timeDisplay} per ${updPeople} person${updPeople === 1 ? 'a' : 'e'}. Ti aspettiamo!`);
    } else {
      this._say(`Mi dispiace, errore durante l'aggiornamento. Riprovi più tardi.`);
    }
  }

  async _handleCancelFlow(newDate, newName) {
    // Phase 1: primo messaggio cancel → se contiene già nome e data, cerca subito
    if (!this.cancelState) {
      this.cancelState = 'awaiting_search';
      // 🆕 Cancella eventuale risposta GPT in corso: vogliamo controllare noi il dialogo

      if (newName && newDate) {
        if (newName) this.data.name = newName;
        if (newDate) this.data.date = newDate;
        this._say('Un momento, cerco la prenotazione...');
        const r = await this._findReservationWithFallback(newName, newDate, 'CANCEL primo msg');
        if (r) {
          this.foundReservation = r;
          const timeNorm = r.time?.length === 5 ? r.time + ':00' : (r.time || '');
          const dateDisplay = DateManager.formatForDisplay(r.date);
          const timeDisplay = TimeManager.formatForDisplay(timeNorm);
          this.cancelState = 'awaiting_confirm';
          // v3.9.35: se il nome trovato è diverso da quello cercato (fallback telefono),
          // avvisa l'utente invece di presentarlo silenziosamente come corretto
          const nameMismatch = newName && r.name && r.name.toLowerCase() !== newName.toLowerCase();
          if (nameMismatch) {
            this._say(`Tramite il suo numero ho trovato: ${r.name}, ${dateDisplay} alle ${timeDisplay} per ${r.people} persone. È la sua prenotazione? Conferma la cancellazione?`);
          } else {
            this._say(`Ho trovato: ${r.name}, ${dateDisplay} alle ${timeDisplay} per ${r.people} persone. Conferma la cancellazione?`);
          }
        } else {
          this._say(`Non trovo nessuna prenotazione a nome ${newName}.`);
        }
        return;
      }

      this._say('Certo! A che nome è la prenotazione e per quale data?');
      return;
    }

    // Phase 2: cerca la prenotazione
    if (this.cancelState === 'awaiting_search') {
      const searchName = newName || this.data.name;
      const searchDate = newDate || this.data.date;

      if (newName) this.data.name = newName;
      if (newDate) this.data.date = newDate;

      if (!searchName && !searchDate) {
        this._say('Può dirmi a che nome è la prenotazione e per quale data?');
        return;
      }
      if (!searchName) {
        this._say('A che nome è la prenotazione?');
        return;
      }
      if (!searchDate) {
        this._say('Per quale data è la prenotazione?');
        return;
      }

      this._say('Un momento, cerco la prenotazione...');
      const r = await this._findReservationWithFallback(searchName, searchDate, 'CANCEL');
      if (r) {
        this.foundReservation = r;
        const timeNorm = r.time?.length === 5 ? r.time + ':00' : (r.time || '');
        const dateDisplay = DateManager.formatForDisplay(r.date);
        const timeDisplay = TimeManager.formatForDisplay(timeNorm);
        this.cancelState = 'awaiting_confirm';
        const nameMismatch2 = searchName && r.name && r.name.toLowerCase() !== searchName.toLowerCase();
        if (nameMismatch2) {
          this._say(`Tramite il suo numero ho trovato: ${r.name}, ${dateDisplay} alle ${timeDisplay} per ${r.people} persone. È la sua prenotazione? Conferma la cancellazione?`);
        } else {
          this._say(`Ho trovato: ${r.name}, ${dateDisplay} alle ${timeDisplay} per ${r.people} persone. Conferma la cancellazione?`);
        }
      } else {
        this._say(`Non trovo nessuna prenotazione a nome ${searchName}.`);
      }
    }
  }

  // ── CANCEL conferma via testo grezzo ──────────────────────────────────────

  async _handleCancelConfirmText(text) {
    const t = text.toLowerCase().trim();
    const isYes = /\bsì|si\b|yes\b|certo\b|confermo\b|ok\b|esatto\b|giusto\b|procedi\b/i.test(t);
    const isNo  = /\bno\b|niente\b|lascia\s+perdere\b|annulla\b|stop\b/i.test(t);

    console.log(`🔤 CANCEL confirm text: "${text}" → yes=${isYes} no=${isNo}`);

    if (isNo) {
      this.phase = 'done';
      this.cancelState = null;        // 🆕 reset: utente ha rifiutato, uscire dalla confirm loop
      // Fix X04: NON azzerare foundReservation — se il cliente dice "No anzi spostala a sabato"
      // GPT ritornerà intent=modify e il blocco phase=done MODIFY userà foundReservation come base
      // this.foundReservation = null;
      this._say('Nessun problema, la prenotazione rimane invariata. Arrivederci!');
      return;
    }

    if (isYes) {
      const r = this.foundReservation;
      if (!r) { this.phase = 'done'; return; }

      const timeNorm = r.time?.length === 5 ? r.time + ':00' : (r.time || '');
      console.log(`🗑️ CANCEL conferma: nome=${r.name}, data=${r.date}, ora=${timeNorm}`);
      this._say('Un attimo che procedo con la cancellazione...');
      const result = await this._callAppsScript({
        action: 'cancel_reservation',
        nome: r.name,
        data: r.date,
        ora: timeNorm,
        telefono: this.callerPhone || r.phone || '',  // 🆕 FIX PHONE: callerPhone ha sempre + normalizzato
      });

      this.phase = 'done';
      if (result?.success || result?.status === 'CANCELLED') {
        this._say('La prenotazione è stata cancellata. Speriamo di rivederla presto!');
      } else {
        this._say(`Mi dispiace, c'è stato un problema nella cancellazione. Può richiamare?`);
      }
      return;
    }

    // Risposta non chiara
    this._say('Non ho capito. Conferma la cancellazione? Dica sì o no.');
  }

  // ── Ask Next Field ────────────────────────────────────────────────────────

  _ask(field) {
    const msgs = {
      date:   'Per quale giorno vuole prenotare?',
      time:   'A che ora desidera il tavolo?',
      people: 'Per quante persone?',
      name:   'A che nome faccio la prenotazione?',
    };
    this._pendingQuestion = field;
    console.log(`🎯 pendingQuestion: ${field}`);
    this._say(msgs[field] || 'Può ripetere?');
  }

  // ── Check Slot ────────────────────────────────────────────────────────────

  async _checkSlot() {
    if (this.checkingSlot) return;
    this.checkingSlot = true;

    const { date, time, people } = this.data;
    const rc = this.restaurantConfig;
    console.log(`🔍 Check slot: ${date} ${time} per ${people}`);

    // ── Gruppi grandi / eventi: gestiti PRIMA di "Un attimo" ─────────────────
    // Se non diciamo "Un attimo" e subito dopo un altro _say, evita la race condition
    // dove il secondo messaggio sovrascrive il primo e va perso
    const eventThreshold = Number(rc?.event_threshold) || 45;
    const largeGroupThreshold = Number(rc?.large_group_threshold) || 10;
    const ownerEmail = rc?.owner_email || '';

    if (people >= eventThreshold) {
      console.log(`🎉 Evento: ${people} persone (soglia: ${eventThreshold})`);
      this.checkingSlot = false;
      this._say(`Per eventi di ${people} persone o più, ti chiedo di contattarci via email a ${ownerEmail}. Saremo felici di organizzare!`);
      return;
    }

    if (people > largeGroupThreshold) {
      console.log(`👥 Gruppo grande: ${people} persone (soglia: ${largeGroupThreshold})`);
      this.checkingSlot = false;
      this.availDone = true;
      if (this.data.name) {
        // Nome già disponibile → PENDING diretto
        console.log(`👥 PENDING con nome già disponibile: ${this.data.name}`);
        this.phase = 'done';
        const _dateD = DateManager.formatForDisplay(this.data.date);
        const _timeD = TimeManager.formatForDisplay(this.data.time);
        this._say(`Perfetto ${this.data.name}! La prenotazione per ${people} persone ${_dateD} alle ${_timeD} è in attesa di conferma dal ristorante. La contatteremo presto!`);
        this._callAppsScript({
          source: 'telnyx', nome: this.data.name, persone: people,
          data: this.data.date, ora: this.data.time,
          telefono: this.callerPhone || '', notes: this.data.notes || '', forceNew: true,
        }).then(r => console.log('📅 PENDING creato:', r?.success ? '✅' : '❌'))
          .catch(e => console.error('❌ Errore PENDING:', e));
      } else {
        this.phase = 'naming';
        this._say(`Per gruppi superiori a ${largeGroupThreshold} persone la prenotazione è soggetta a conferma del ristoratore. A che nome la registro?`);
      }
      return;
    }

    this._say('Un attimo che verifico la disponibilità...');

    // Silenzio durante il check — GPT non parla fino al risultato

    try {
      const result = await this._callAppsScript({
        action: 'check_availability',
        data: date,
        ora: time,
        persone: people,
      });

      if (result?.success || result?.reason === 'slot_available') {
        console.log('✅ Slot disponibile');
        this.phase = 'naming';
        this.checkingSlot = false;
        this.availDone = true;
        this._lastAsked = null;
        // Piccolo delay per assicurarsi che la risposta di estrazione sia completata
        await new Promise(r => setTimeout(r, 300));
        if (this.data.name) {
          this._confirmReservation();
        } else {
          this._ask('name');
        }
      } else if (result?.reason === 'slot_full') {
        console.log('❌ Slot pieno');
        this.checkingSlot = false;

        // Cerca slot realmente disponibili invece di dire orari hardcoded
        try {
          const alts = await this._callAppsScript({
            action: 'find_available_slots',
            data: date,
            ora: time,
            persone: people,
          });

          const sameDay = alts?.availableSlots?.sameDay || [];
          const nextDays = alts?.availableSlots?.nextDays || [];

          // Filtra solo orari nei nostri orari di apertura
          const validSameDay = sameDay.filter(s =>
            ValidationPipeline.isValidTime(s.time, rc)
          );

          if (validSameDay.length > 0) {
            const times = validSameDay.slice(0, 3).map(s => s.time.substring(0,5)).join(', ');
            console.log(`✅ Alternative stesso giorno (filtrate): ${times}`);
            this.data.time = null;
            this._say(`Mi dispiace, quell'orario è al completo. Oggi ho disponibilità alle ${times}. Quale preferisce?`);
          } else if (nextDays.length > 0) {
            const first = nextDays[0];
            const dayName = first.dayName || '';
            // Filtra anche i prossimi giorni
            const validSlots = (first.slots || []).filter(s =>
              ValidationPipeline.isValidTime(s.time, rc)
            );
            const times = validSlots.slice(0, 2).map(s => s.time.substring(0,5)).join(' o ');
            console.log(`✅ Alternative prossimi giorni: ${dayName} ${times}`);
            this.data.date = null;
            this.data.time = null;
            this._say(`Mi dispiace, siamo al completo per quel giorno. Prima disponibilità ${dayName} alle ${times}. Vuole prenotare?`);
          } else {
            console.log('❌ Nessuna alternativa valida trovata');
            this.data.date = null;
            this.data.time = null;
            this._say('Mi dispiace, siamo al completo per quel giorno. Vuole provare un altro giorno?');
          }
        } catch (err) {
          console.error('❌ Errore ricerca alternative:', err);
          this.data.time = null;
          const ds = rc?.dinner_start || '21:00';
          const de = rc?.dinner_end   || '22:30';
          this._say(`Mi dispiace, quell'orario è al completo. Abbiamo disponibilità in altre fasce tra le ${ds} e le ${de}. Quale preferisce?`);
        }
      } else if (result?.reason === 'day_closed') {
        console.log('🚫 Giorno chiuso (da Apps Script)');
        this.data.date = null;
        this.checkingSlot = false;
        this._say('Mi dispiace, quel giorno siamo chiusi. Per quale altro giorno vuole prenotare?');
      } else {
        console.log('⚠️ Check incerto, procedo');
        this.phase = 'naming';
        this.checkingSlot = false;
        this.availDone = true;
        this._ask('name');
      }
    } catch (err) {
      console.error('❌ Errore check slot:', err);
      this.phase = 'naming';
      this.checkingSlot = false;
      this.availDone = true;
      this._ask('name');
    }
  }

  // ── Confirm Reservation ───────────────────────────────────────────────────

  _confirmReservation() {
    const { date, time, people, name } = this.data;

    // Fix 1: valida orario SEMPRE prima di confermare (evita bypass da turno multi-campo)
    if (time && !ValidationPipeline.isValidTime(time, this.restaurantConfig)) {
      console.log(`🚫 _confirmReservation: orario non valido ${time} → blocco`);
      const rc = this.restaurantConfig;
      const lunch = rc?.lunch_hours || '12:00-14:30';
      const dinner = rc?.dinner_hours || '21:00-22:30';
      // CRITICO: risolve function_call pendente PRIMA di _say, altrimenti GPT genera risposta autonoma
      this.phase = 'collecting';
      this.data.time = null;
      this._say(`Quell'orario è fuori dai nostri orari. Pranzo ${lunch}, cena ${dinner}. Che orario preferisce?`);
      // Fix B4: forza GPT a NON confermare prenotazioni dopo orario invalido
      return;
    }

    const dateDisplay  = DateManager.formatForDisplay(date);
    const timeDisplay  = TimeManager.formatForDisplay(time);
    const firstName    = name || ''; // usa nome completo (supporta nomi composti: De Luca, Di Maio, ecc.)

    this.phase = 'done';

    // Setta lastReservation SUBITO (prima dell'async) per bloccare double-booking
    this.lastReservation = {
      eventId: null, // verrà aggiornato dopo Apps Script
      name, date, time, people,
      phone: this.callerPhone || '',
      notes: this.data.notes || '',
    };

    // Determina se sarà PENDING in base alla soglia gruppo grande
    const _rc2 = this.restaurantConfig;
    const _largeThresh = Number(_rc2?.large_group_threshold) || 10;
    const _willBePending = people > _largeThresh;

    // Fix: includi note nel messaggio di conferma se presenti
    // Filtra le note interne (tra parentesi) che non vanno lette al cliente
    const _notesForClient = this.data.notes
      ? this.data.notes
          .split(';')
          .map(n => n.replace(/\s*\([^)]*\)/g, '').trim())  // rimuove "(verifica con cliente)" anche se preceduto da testo
          .filter(n => n.length > 0)
          .join('; ')
      : '';
    const _notesConfirmStr = _notesForClient ? ` Ho annotato: ${_notesForClient}.` : '';

    if (_willBePending) {
      const _callerNum = this.callerPhone ? ` Ti contatteremo al numero da cui stai chiamando.` : '';
      this._say(
        `Perfetto ${firstName}! Ho registrato la richiesta per ${people} persone ${dateDisplay} alle ${timeDisplay}.${_notesConfirmStr}${_callerNum} La prenotazione è in attesa di conferma dal ristorante. Se preferisci essere contattato su un altro numero, dimmelo ora!`
      );
    } else {
      this._say(
        `Perfetto ${firstName}! Ho prenotato per ${people} persone ${dateDisplay} alle ${timeDisplay}.${_notesConfirmStr} Ti aspettiamo!`
      );
    }

    // Crea prenotazione in background
    this._callAppsScript({
      source: 'telnyx',
      nome: name,
      persone: people,
      data: date,
      ora: time,
      telefono: this.callerPhone || '',
      notes: this.data.notes || '',
      forceNew: true,
    }).then(result => {
      console.log('📅 Prenotazione creata:', result?.success ? '✅' : '❌', result);
      if (this.data.notes) console.log(`📝 Note inviate: "${this.data.notes}"`);
      // Salva riferimento alla prenotazione appena creata per uso post-done
      if (result?.success && result.eventId) {
        this.lastReservation = {
          eventId: result.eventId,
          name: name,
          date: date,
          time: time,
          people: people,
          phone: this.callerPhone || '',
          notes: this.data.notes || '',
          status: result.status || 'CONFIRMED',
        };
        console.log(`💾 lastReservation salvato: eventId=${result.eventId} status=${result.status}`);
      }
    }).catch(err => {
      console.error('❌ Errore creazione prenotazione:', err);
    });
  }

  // ── Name Extractor ────────────────────────────────────────────────────────

  // ── Name Extractor (solo pattern espliciti) ──────────────────────────────
  // Usato da _extractFromTranscript() — NO pattern generico fallback.
  // Estrae nome solo quando c'è contesto esplicito (mi chiamo, a nome, ecc.)
  // Evita falsi positivi come "due" → "Due" quando l'utente risponde al numero persone.
  // ── Name Extractor SAFE — solo frasi lunghe fuori naming ───────────────────
  // Usa SOLO pattern inequivocabili: "mi chiamo X", "a nome X", "prenoto a nome X"
  // ESCLUSO: "sono X" (troppo ambiguo — "sono allergico agli arachidi")
  // ESCLUSO: pattern generico fallback (cattura qualsiasi parola sola)
  // ── Pre-routing: decide se la frase va gestita come domanda sul locale ──────
  // Pattern GPT: structural + contextual, NON regex sui piatti
  // Controlla frame linguistico interrogativo + assenza entity booking
  // NON altera mai lo state booking — è side conversation
  async _shouldHandleAsRestaurantInfo(transcript, extracted) {
    // Segnali espliciti di booking → mai info query, indipendentemente da tutto
    // "ho prenotato", "ho una prenotazione", "spostare", ecc. → sempre booking flow
    const _t = transcript.toLowerCase();
    const _clearBookingSignal = /\bho\s+(?:già\s+)?prenotat|\bho\s+una\s+prenotazione|\bprenotazione\s+a\s+nome|\bspostare\b|\bmodificare\b|\bcancellare\b|\bdisdire\b|\bannullare\b|\bvolevo\s+spostare\b|\bvolevo\s+modificare\b/.test(_t);
    if (_clearBookingSignal) return false;

    // FIX 2 (GPT): entity booking e intent informational possono coesistere
    const _hasEntities = !!(extracted.date || extracted.time || extracted.people);
    if (_hasEntities) {
      const _looksInformational = /\bfate\b|\bservite\b|\bc'è\b|\bposso\s+sapere\b|\bmen[uù]\b|\bparcheggio\b|\bseggiol\b|\borari\b|\baccessibil\b|\bpagament\b/.test(_t);
      // Rimosso \bavete\b — troppo broad ("avete segnato" è booking, non info)
      if (!_looksInformational) return false;
    }

    // Solo in fase collecting senza flow attivi
    if (this.modifyState || this.cancelState || this.phase === 'done') return false;

    // Deve avere restaurantInfo disponibile
    if (!this._restaurantInfo || Object.keys(this._restaurantInfo).length === 0) return false;

    const t = transcript.toLowerCase();

    // Frame linguistico interrogativo — NON nomi di piatti specifici
    // Segnali strutturali: domanda generica sul locale
    const infoPatterns = [
      /\bcosa\b/,           // "cosa avete", "cosa fate"
      /\bche\b.*\?/,       // "che dolci avete?"
      /\bavete\b/,          // "avete X"
      /\bfate\b/,           // "fate X"
      /\bservite\b/,
      /\bpreparate\b/,
      /\bmen[uù]\b/,        // "menu"
      /\bprimi\b/,          // categoria, non piatto
      /\bsecondi\b/,        // categoria
      /\bdolci\b/,          // categoria
      /\bantipasti\b/,      // categoria
      /\bsenza\s+glut/,     // "senza glutine"
      // vegan[oi] e vegetar rimossi — sono NOTE sulla prenotazione, non info query
      // Se qualcuno chiede "avete piatti vegani?" viene catturato da "fate/avete" o "menu"
      /\bvegetar.*\?/,  // solo se domanda esplicita (punto interrogativo)
      /\bparcheggio\b/,
      /\bindirizzo\b/,
      /\borari\b/,
      /\bseggiol/,           // "seggiolone" e varianti
      /\baccessibil/,
      /\bpagamento\b/,
      /\bprezzo\b/,
      /\bcosto\b/,
      /\bcucina\b/,
      /\bspecialit/,
      /posso\s+sapere/,      // "posso sapere..."
      /voglio\s+sapere/,     // "voglio sapere..."
      /vorrei\s+sapere/,
      /volevo\s+sapere/,
      /vorrei\s+chieder/,
      /ho\s+una\s+domanda/,
    ];

    const score = infoPatterns.filter(r => r.test(t)).length;
    if (score >= 1) {
      console.log(`🔍 Pre-routing: info query score=${score} → gestisco come domanda locale`);
      return true;
    }
    return false;
  }

  // ── Info query detector — domande informative sul ristorante ───────────────
  _isInformationalQuery(transcript) {
    const t = transcript.toLowerCase();
    if (/\b(?:carbonara|pizza|menu|menù|piatto|cucina|serv|prepar|vegano|vegetar|gluten|celiaco|pesce|carne|dolce|vino|birra)\b/.test(t)) return true;
    if (/\b(?:dove siete|indirizzo|come arriv|parcheggio|mappa|quartiere|zona)\b/.test(t)) return true;
    if (/\b(?:animali|cane|gatto|terrazza|dehor|accessibil|disabil|carrozzina)\b/.test(t)) return true;
    if (/\b(?:siete aperti|aprite|chiudete|orari|quando apre|quando chiude)\b/.test(t)) return true;
    return false;
  }

  // ── Info query handler — risponde da _restaurantInfo via GPT ───────────────
  // NON muta mai phase o stato booking — side conversation pura
  // Ritorna true se ha risposto, false se non era una domanda sul locale
  async _handleInfoQuery(transcript) {
    const infoSection = this._buildInfoSection ? this._buildInfoSection() : '';

    // Contesto prenotazione corrente (se esiste)
    // GPT usa ENTRAMBI i contesti: info ristorante + note prenotazione
    // Questo permette di rispondere a "avete segnata la celiachia?" senza regex
    const _lr = this.lastReservation || this.foundReservation;
    const _reservationContext = _lr ? `
=== PRENOTAZIONE CORRENTE DEL CLIENTE ===
- Nome: ${_lr.name || 'non specificato'}
- Data: ${_lr.date ? DateManager.formatForDisplay(_lr.date) : 'non specificata'}
- Orario: ${_lr.time ? TimeManager.formatForDisplay(_lr.time) : 'non specificato'}
- Persone: ${_lr.people || 'non specificato'}
- Note annotate: ${this._notesForClient(_lr.notes) || 'nessuna nota'}
` : '';

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          temperature: 0,
          max_tokens: 100,
          messages: [
            {
              role: 'system',
              content: `Sei l'assistente vocale di un ristorante. Rispondi in modo naturale e conversazionale usando il contesto disponibile.

REGOLE:
1. Puoi rispondere su: info ristorante (menu, orari, servizi) E note sulla prenotazione del cliente
2. Se la domanda riguarda le note della prenotazione (allergie, intolleranze, richieste speciali) → rispondi con quello che è annotato
3. Se è una domanda sul ristorante → usa le info del locale
4. Se non hai l'informazione richiesta → rispondi esattamente: null
5. Se la frase non è una domanda su nulla di pertinente → rispondi esattamente: NOT_RELEVANT
6. Massimo 2 frasi brevi in italiano. Non inventare nulla.
${_reservationContext}
${infoSection}`
            },
            { role: 'user', content: transcript }
          ]
        })
      });
      clearTimeout(timeout);
      const data = await response.json();
      const answer = data?.choices?.[0]?.message?.content?.trim();
      console.log(`ℹ️ Info query risposta: "${answer?.substring(0,60)}"`);

      if (!answer || answer === 'NOT_RELEVANT') {
        console.log('🔍 _handleInfoQuery: NOT_RELEVANT → return false');
        return false;
      }
      if (answer.toLowerCase() === 'null') {
        this._say('Non ho questa informazione, le consiglio di contattare direttamente il ristorante.');
      } else {
        this._say(answer);
      }
      return true;
    } catch (err) {
      clearTimeout(timeout);
      console.log('⚠️ _handleInfoQuery error:', err?.message);
      return false;
    }
  }


  // ── Ambiguity score — decide se serve context GPT ───────────────────────────
  // FIX 4 (GPT): score numerico invece di boolean puro
  // Riduce falsi positivi, evita trigger inutili
  // Threshold: score >= 3 → chiama GPT
  _isAmbiguous(transcript, extracted) {
    const words = transcript.trim().split(/\s+/);
    const wordCount = words.length;
    const noEntities = !extracted.date && !extracted.time && !extracted.people && !extracted.name;

    let score = 0;

    // HARD RULE (GPT): se ci sono entity estratte → MAI triggerare ambiguity GPT
    // "sabato alle 9", "siamo in quattro", "Ferrari" → parser deterministico basta
    const hasStrongEntity = !!(extracted.date || extracted.time || extracted.people || extracted.name);
    if (hasStrongEntity) return false; // zero ambiguity se parser ha già estratto

    // Risposta breve (≤ 4 parole) senza entity
    if (wordCount <= 4) score += 2;

    // FIX 3b: pronomi — rimuovi "la/le/li/lo" (troppo rumorosi in italiano PSTN)
    // Mantieni solo pronomi disambiguanti reali
    if (/\b(?:quello|quella|questo|questa|anche|invece)\b/i.test(transcript)) score += 2;

    // Nessuna entity estratta dai parser locali
    if (noEntities) score += 2;

    // Sì/No puro — sempre ambiguo senza contesto
    if (/^(?:sì|si|no|ok|bene|esatto|perfetto|certo|vai|procedi)[!.,\s]*$/i.test(transcript.trim())) score += 1;

    // Parole di correzione — quasi sempre richiedono contesto
    if (/\b(?:invece|anzi|aspetti|volevo dire|no aspetti|piuttosto)\b/i.test(transcript)) score += 2;

    // "anche" + qualcosa (es: "anche mia moglie", "anche il seggiolone")
    if (/\banche\b/i.test(transcript) && wordCount <= 6) score += 2;

    // Partial extraction conflict — parser ha trovato entity conflittuali
    if (extracted.time && extracted.people && wordCount <= 6) score += 1;

    // Nessuna entity e frase medio-corta
    if (noEntities && wordCount <= 8) score += 1;

    const isAmbig = score >= 3;
    if (isAmbig) console.log(`🔍 Ambiguity score: ${score}/10 → chiamo GPT context`);
    return isAmbig;
  }

  // ── GPT contextual resolver — chiama GPT con history solo se ambiguo ─────────
  // Ritorna un oggetto con i campi chiariti nel contesto
  // NON decide il flow — solo interpreta il significato
  async _resolveAmbiguity(transcript) {
    if (!this._conversationHistory || this._conversationHistory.length < 2) {
      return null;
    }

    // FIX 4: dedup anti-loop — se stesso transcript risolto negli ultimi 2 turni → skip
    const _cacheKey = transcript.trim().toLowerCase();
    if (this._lastAmbiguityResolution &&
        this._lastAmbiguityResolution.transcript === _cacheKey &&
        (this._ambiguityTurnCounter - this._lastAmbiguityResolution.turn) <= 2) {
      console.log('🔁 Ambiguity dedup: stesso contesto → uso cached result');
      return this._lastAmbiguityResolution.result;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);

    try {
      // Passa ultimi 3 turni (escludi il turno corrente già aggiunto)
      const historySlice = this._conversationHistory.slice(-6, -1); // ultimi 3 turni senza current

      // FIX 3 (GPT): prompt ristretto a contextual interpretation ONLY
      // NON chiedere intent globale — solo cosa riferisce e entity gap fill
      // Riduce semantic drift e over-interpretation
      // FIX 2: stato ridotto al minimo — solo phase/pendingQuestion/lastTopic
      // NON passare il booking completo: GPT deve solo capire il riferimento
      const systemPrompt = `Interpreta SOLO il significato contestuale dell'ultima frase dell'utente nel contesto di una conversazione per prenotazioni ristorante.\nNON decidere il flow conversazionale.\nNON inventare informazioni mancanti.\nNON inferire intent globali.\n\nContesto minimo:\n- Fase: ${this.phase || 'collecting'}\n- Domanda in attesa: ${this._pendingQuestion || 'nessuna'}\n- Ultimo argomento: ${this._lastTopic || 'nessuno'}\n\nRispondi SOLO con JSON valido, nessun testo aggiuntivo:\n{\n  \"reference\": \"cosa sta referenziando (es: seggiolone già menzionato, null)\",\n  \"confirmation\": true,\n  \"correction\": false,\n  \"entities\": {\n    \"date\": null,\n    \"time\": null,\n    \"people\": null,\n    \"name\": null,\n    \"note\": null\n  }\n}`;
      const messages = [
        { role: 'system', content: systemPrompt },
        ...historySlice,
        { role: 'user', content: `Interpreta questa frase nel contesto: "${transcript}"` }
      ];

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          temperature: 0,
          max_tokens: 150,
          messages,
        })
      });

      clearTimeout(timeout);
      if (!response.ok) return null;

      const data = await response.json();
      const raw = data?.choices?.[0]?.message?.content?.trim();
      if (!raw) return null;

      const clean = raw.replace(/```json|```/g, '').trim();
      const result = JSON.parse(clean);
      console.log(`🧠 Ambiguity resolved: "${transcript}" → ref="${result.reference}" confirm=${result.confirmation} correction=${result.correction}`);
      // Salva in dedup cache
      this._lastAmbiguityResolution = { transcript: _cacheKey, result, turn: this._ambiguityTurnCounter };
      return result;

    } catch (err) {
      clearTimeout(timeout);
      return null;
    }
  }

  // ── GPT name fallback — solo per casi semanticamente ambigui ────────────────
  // Chiamato SOLO quando: frase lunga, fuori naming, parser locale = null
  // Costo: ~pochi centesimi/mese su 1200 chiamate. Latenza: 250-700ms (OK su completed)
  async _extractNameWithGPT(transcript) {
    // Cache anti-repeat
    const cacheKey = transcript.trim().toLowerCase().replace(/\s+/g, ' ');
    if (this._gptNameCache.has(cacheKey)) {
      return this._gptNameCache.get(cacheKey);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          temperature: 0,
          max_tokens: 10,
          messages: [
            {
              role: 'system',
              content:
                "Estrai SOLO il nome della prenotazione dal testo. " +
                "Se NON c'è chiaramente un nome della persona, rispondi SOLO con NULL. " +
                "NON estrarre allergie, descrizioni, aggettivi, note o richieste. " +
                "Rispondi con una sola parola o cognome, oppure NULL."
            },
            {
              role: 'user',
              content: transcript
            }
          ]
        })
      });

      clearTimeout(timeout);

      if (!response.ok) { this._gptNameCache.set(cacheKey, null); return null; }

      const data = await response.json();
      const text = data?.choices?.[0]?.message?.content?.trim();

      if (!text || text.toUpperCase() === 'NULL') {
        this._gptNameCache.set(cacheKey, null);
        return null;
      }

      // Pulizia: solo lettere, spazi, apostrofi, trattini
      const cleaned = text.replace(/[^\p{L}\s''-]/gu, '').trim();
      if (!cleaned || cleaned.split(/\s+/).length > 3) {
        this._gptNameCache.set(cacheKey, null);
        return null;
      }

      const result = cleaned.replace(/\b\w/g, c => c.toUpperCase());
      console.log(`🤖 GPT name fallback: "${transcript.substring(0,40)}..." → ${result}`);
      this._gptNameCache.set(cacheKey, result);
      return result;

    } catch (err) {
      clearTimeout(timeout);
      return null;
    }
  }

  _extractNameSafe(text) {
    if (!text) return null;
    const t = text.trim();

    const safePatterns = [
      /\bmi\s+chiamo\s+([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)?)/i,
      /\ba\s+nome\s+(?:di\s+)?([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)*)/i,
      /\bil\s+(?:mio\s+)?nome\s+è\s+([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)?)/i,
      /\bprenoto\s+a\s+nome\s+([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)*)/i,
      /\bprenotaz(?:ione)?\s+a\s+nome\s+([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)*)/i,
      // Inglese
      /\bmy\s+name\s+is\s+([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)?)/i,
      /\bunder\s+(?:the\s+)?name\s+(?:of\s+)?([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)*)/i,
      // Francese
      /\bje\s+m['']appelle\s+([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)?)/i,
      /\bau\s+nom\s+(?:de\s+)?([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)*)/i,
      // Spagnolo
      /\bme\s+llamo\s+([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)?)/i,
    ];

    const excluded = ['si','no','ok','allergico','allergica','intollerante','celiaco',
                      'vegano','vegetariano','disponibile','libero','pronto'];

    for (const p of safePatterns) {
      const match = t.match(p);
      if (match && match[1] && match[1].length >= 2) {
        const name = match[1].trim();
        if (!excluded.includes(name.toLowerCase())) {
          return name.replace(/\b\w/g, c => c.toUpperCase());
        }
      }
    }
    return null;
  }

  _extractNameExplicit(text) {
    if (!text) return null;
    const t = text.trim();

    const explicitPatterns = [
      // Italiano
      /\bmi\s+chiamo\s+([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)?)/i,
      /\bsono\s+([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)?)/i,
      /\ba\s+nome\s+(?:di\s+)?([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)*)/i,
      /\bnome\s+([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)?)/i,
      // Inglese
      /\bmy\s+name\s+is\s+([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)?)/i,
      /\bi(?:'m|\s+am)\s+([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)?)/i,
      /\bunder\s+(?:the\s+)?name\s+(?:of\s+)?([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)*)/i,
      // Francese
      /\bje\s+m['']appelle\s+([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)?)/i,
      /\bau\s+nom\s+(?:de\s+)?([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)*)/i,
      // Spagnolo
      /\bme\s+llamo\s+([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)?)/i,
      /\ba\s+nombre\s+(?:de\s+)?([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)*)/i,
    ];

    // FIX 2: stopword italiane + parole mediche/dietetiche
    const excluded = ['si','no','ok','perfetto','grazie','esatto','confermo',
                      'nome','certo','quello','quella','giusto','pronto',
                      'di','dei','del','della','delle','degli','da','dal',
                      'a','al','alla','per','con','su','sul','sulla',
                      'un','una','uno','il','lo','la','le','gli','i',
                      'allergico','allergica','intollerante','celiaco','celiaca',
                      'vegano','vegana','vegetariano','vegetariana','diabetico','diabetica',
                      'disponibile','libero','libera','pronto','pronta'];

    for (const p of explicitPatterns) {
      const match = t.match(p);
      if (match && match[1] && match[1].length >= 2) {
        const name = match[1].trim();
        if (!excluded.includes(name.toLowerCase())) {
          return name.replace(/\b\w/g, c => c.toUpperCase());
        }
      }
    }
    return null;
  }

  _extractName(text) {
    if (!text) return null;

    // FIX 2: stopword italiane + parole mediche/dietetiche
    // "sono allergico", "sono celiaco" non sono nomi
    const excluded = ['si','no','ok','perfetto','grazie','esatto','confermo',
                      'nome','certo','quello','quella','giusto','pronto',
                      'di','dei','del','della','delle','degli','da','dal',
                      'a','al','alla','per','con','su','sul','sulla',
                      'un','una','uno','il','lo','la','le','gli','i',
                      // Parole mediche/dietetiche che seguono "sono"
                      'allergico','allergica','intollerante','celiaco','celiaca',
                      'vegano','vegana','vegetariano','vegetariana','diabetico','diabetica',
                      'iperteso','ipertesa','disabile','sordo','sorda',
                      // Altre parole comuni che non sono nomi
                      'disponibile','libero','libera','pronto','pronta','sicuro','sicura'];

    // Pulizia: rimuovi congiunzioni inserite da Whisper tra "nome" e il nome vero
    // es. "Nome e Mirko" → "Nome Mirko", "Nome è Mirko" → "Nome Mirko"
    let t = text.trim();
    t = t.replace(/\bnome\s+[eè]\s+/i, 'Nome ');
    t = t.replace(/\bil\s+nome\s+è\s+/i, 'Nome ');
    t = t.replace(/\bil\s+nome\s+/i, 'Nome ');

    const patterns = [
      // Italiano
      /\bmi\s+chiamo\s+([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)?)/i,
      // 'sono X' solo se X non è seguito da preposizioni (agli, alle, ecc.) — evita 'sono allergico agli'
      /\bsono\s+([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)?)(?!\s+(?:agli|alle|ai|al|allo|alla|dei|del|della|degli|alle|un|una|e\s))/i,
      /\ba\s+nome\s+(?:di\s+)?([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)*)/i,
      /\bnome\s+([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)?)/i,
      /^(?:no[,\s]+)?a\s+([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)?)[\s.,!]*$/i,
      // Inglese
      /\bmy\s+name\s+is\s+([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)?)/i,
      /\bi(?:'m|\s+am)\s+([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)?)/i,
      /\bunder\s+(?:the\s+)?name\s+(?:of\s+)?([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)*)/i,
      /\bname\s+([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)?)/i,
      // Francese
      /\bje\s+m['']appelle\s+([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)?)/i,
      /\bau\s+nom\s+(?:de\s+)?([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)*)/i,
      // Spagnolo
      /\bme\s+llamo\s+([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)?)/i,
      /\ba\s+nombre\s+(?:de\s+)?([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)*)/i,
      // Generico (fallback)
      /^([A-Z][a-zA-ZÀ-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÿ]+)?)[\s.,!]*$/i,
    ];

    for (const p of patterns) {
      const match = t.match(p);
      if (match && match[1] && match[1].length >= 2) {
        const words = match[1].trim().split(/\s+/);
        const name = excluded.includes(words[0].toLowerCase())
          ? words.slice(1).join(' ')
          : match[1].trim();

        if (name.length >= 2 && !excluded.includes(name.toLowerCase())) {
          // Capitalizza prima lettera di ogni parola (Whisper trascrive spesso in minuscolo)
          return name.replace(/\b\w/g, c => c.toUpperCase());
        }
      }
    }
    return null;
  }

  _checkInfoQuestion(text) {
    if (!text) return null;
    const t = text.toLowerCase();
    const ri = this._restaurantInfo || {};
    const lang = this.language || 'it';

    const noInfo = lang === 'it'
      ? 'Non ho questa informazione. Per dettagli pu\u00f2 contattare direttamente il ristorante.'
      : lang === 'en' ? 'I don\u2019t have this information. Please contact the restaurant directly.'
      : lang === 'fr' ? 'Je n\u2019ai pas cette information. Veuillez contacter le restaurant directement.'
      : lang === 'es' ? 'No tengo esta informaci\u00f3n. Por favor contacte el restaurante directamente.'
      : 'Non ho questa informazione. Per dettagli pu\u00f2 contattare direttamente il ristorante.';

    // Se la domanda riguarda la prenotazione stessa (note, conferma, ecc.) non intercettare
    if (/ha[i]?.{0,15}segna|l.ha[i]?.{0,15}segna|nelle.{0,10}note|lo.{0,5}sai|ha[i]?.{0,10}nota|ha[i]?.{0,10}registr|segni.{0,20}(amica|amico|ospite|bambino)|conferma.{0,10}prenot|la.{0,10}prenot/i.test(t)) {
      return null;
    }

    // ── MENU deterministico ──────────────────────────────────────────────────
    const _riMenu = this._restaurantInfo || {};
    
    if (_riMenu.menuDetails) {
      const menuText = _riMenu.menuDetails;

      // Helper: filtra sezione categoria
      const getSection = (cat) => {
        const lines = menuText.split('\n');
        let inSection = false, result = [];
        for (const line of lines) {
          if (line.trim().toUpperCase().startsWith(cat.toUpperCase() + ':') || line.trim().toUpperCase() === cat.toUpperCase()) {
            inSection = true; continue;
          }
          if (inSection && line.match(/^[A-Z]{3,}[:\s]/)) break; // nuova categoria
          if (inSection && line.trim()) {
            // Solo nome piatto, senza prezzo e descrizione
            const cleanLine = line.trim().replace(/^[-•]\s*/, '').split('€')[0].trim();
            result.push(cleanLine);
          }
        }
        return result.join(', ');
      };

      // Check coperto (INFO categoria)
      if (/coperto/i.test(t)) {
        const copertLine = menuText.split('\n').find(l => /coperto/i.test(l));
        if (copertLine) {
          const price = copertLine.match(/[€£]?\s*(\d+[.,]?\d*)/);
          if (price) { const pStr = parseFloat(price[1]).toFixed(2).replace('.', ','); return `Sì, applichiamo un coperto di ${pStr} euro a persona.`; }
        }
      }

      // Domanda su piatto specifico: ricerca diretta nome piatto nel transcript
      // Più robusto del regex dishMatch — gestisce STT distortion e frasi complesse
      const _hasCategoryKeyword = /antipast|prim[io].{0,10}piatt|second[io]|contorn|dolc|dessert/i.test(t);
      const _hasInquiry = /avete|fate|fann[oa]|fatt[ei]|dico|chiedevo|vorrei|c.è|c.era|avrebbe|offrite|servite|preparat|\?/i.test(t);
      if (!_hasCategoryKeyword && _hasInquiry) {
        const _stopWords = new Set(['alla','alle','allo','agli','della','dello','degli','delle','con','per','dal','del','nel','che','una','uno','dei','misti','misto','fresc','caso','cosa','tipo','forn','fritte','miste']);
        const _menuLines = menuText.split('\n').filter(l => /^\s*-/.test(l));
        for (const _mLine of _menuLines) {
          const _cleanDish = _mLine.trim().replace(/^[-•]\s*/, '').split('€')[0].trim();
          const _dishWords = _cleanDish.toLowerCase().split(/\s+/).filter(w => w.length >= 5 && !_stopWords.has(w));
          if (_dishWords.length > 0 && _dishWords.some(w => t.includes(w))) {
            console.log(`📋 Dish match: "${_cleanDish}"`);
            // Fix 5: se il cliente chiede "come/ingredienti/cosa c'è", includi la descrizione
            // Fix: fatt[ao] copre sia "fatto" (maschile) che "fatta" (femminile)
            const _askingDescription = /come.{0,15}(fat|prepar|cucinat|composto|fatt[ao])|ingredienti|cosa.{0,5}(c.è|hanno|ha|contiene|mett)|com.è.{0,15}(fatt[ao]|preparata?)|di cosa/i.test(t);
            if (_askingDescription) {
              // Fix: cerca la descrizione DOPO il prezzo (€XX) — ancora affidabile
              const _descMatch = _mLine.match(/€\s*[\d,.]+\s+(.+)$/);
              const _desc = _descMatch ? _descMatch[1].trim() : null;
              if (_desc) {
                console.log(`📋 Dish match con descrizione: "${_cleanDish}" → "${_desc}"`);
                return `La ${_cleanDish} è preparata con ${_desc.toLowerCase().replace(/[()]/g, '')}.`;
              }
            }
            return `Sì, abbiamo ${_cleanDish}`;
          }
        }
      }

      // Domanda per categoria
      if (/antipast/i.test(t)) { const s = getSection('ANTIPASTI'); if (s) return `I nostri antipasti: ${s}`; }
      if (/prim[io]/i.test(t) && !/primo.{0,5}piano/i.test(t)) { const s = getSection('PRIMI'); if (s) return `I nostri primi piatti: ${s}`; }
      if (/second[io]/i.test(t)) { const s = getSection('SECONDI'); if (s) return `I nostri secondi piatti: ${s}`; }
      if (/contorn/i.test(t)) { const s = getSection('CONTORNI'); if (s) return `I nostri contorni: ${s}`; }
      if (/dolc[ie]/i.test(t) && !/dolce.{0,10}vita/i.test(t)) { const s = getSection('DOLCI'); if (s) return `I nostri dolci: ${s}`; }
      if (/dessert/i.test(t)) { const s = getSection('DOLCI'); if (s) return `I nostri dessert: ${s}`; }

      // ── Domanda su ingrediente/prodotto specifico (pesce, carne, pasta...) ──
      // Cerca nel menuDetails: se trovato restituisce le righe; se non trovato → noInfo.
      // Evita che GPT inventi piatti non presenti nel menu.
      const _ingredientPatterns = [
        { re: /pesce|frutt.{0,10}mare|seafood|salmone|tonno|branzino|orat[ae]|cozze|vongole|calamari|gamberi|aragosta|polpo|merluzzo|spigola/i, label: 'pesce' },
        { re: /carne|bistecca|manzo|vitello|maiale|agnello|pollo|coniglio|anatra|cinghiale|selvaggina/i, label: 'carne' },
        { re: /pasta\b|tagliat|pappardel|rigatoni|spaghett|linguine|fettuccin|lasagn|gnocch|tortellini|ravioli/i, label: 'pasta' },
        { re: /risotto|ris[oa]\b/i, label: 'risotto' },
        { re: /zuppa|minestra|vellutata|crema.{0,10}(zucca|pomodoro|piselli)/i, label: 'zuppa' },
        { re: /pizza\b|focaccia/i, label: 'pizza' },
        { re: /salumi|affett|prosciutto|bresaola|mortadella|salame/i, label: 'salumi' },
        { re: /formagg|pecorino|parmigiano|burrata|mozzarella|gorgonzola/i, label: 'formaggio' },
        { re: /tartufo\b|funghi\b|porcini|finferli/i, label: 'tartufo/funghi' },
        { re: /fritto|frittura/i, label: 'fritto' },
      ];
      for (const { re, label } of _ingredientPatterns) {
        if (re.test(t)) {
          // Cerca righe del menu che contengono termini correlati
          const _matchingLines = menuText.split('\n').filter(l => re.test(l)).map(l => l.trim()).filter(Boolean);
          if (_matchingLines.length > 0) {
            console.log(`📋 Menu search: trovati ${_matchingLines.length} piatti con "${label}"`);
            return `Sì, abbiamo piatti a base di ${label}: ${_matchingLines.join('; ')}.`;
          } else {
            console.log(`📋 Menu search: "${label}" non trovato nel menu → noInfo`);
            return noInfo;
          }
        }
      }
      // ── fine ricerca ingrediente ──────────────────────────────────────────

      // Domanda generica sul menu
      if (/men[uù]|cosa.{0,15}avete|cosa.{0,15}mangiate|cosa.{0,15}si.{0,10}mang|che.{0,15}piatt/i.test(t)) {
        // Riassunto categorie disponibili
        const cats = [];
        if (menuText.match(/ANTIPASTI/i)) cats.push('antipasti');
        if (menuText.match(/PRIMI/i)) cats.push('primi');
        if (menuText.match(/SECONDI/i)) cats.push('secondi');
        if (menuText.match(/CONTORNI/i)) cats.push('contorni');
        if (menuText.match(/DOLCI/i)) cats.push('dolci');
        if (cats.length > 0) return `Il nostro menu comprende: ${cats.join(', ')}. Vuole sapere i dettagli di una categoria specifica?`;
      }
    }
    // ── fine MENU ────────────────────────────────────────────────────────────

    const checks = [
      {
        patterns: [/sedia.{0,20}rotel|sed[ae]r[ae].{0,10}rotel|rot[ae]ll[ae]|disabil|carrozzin|accessibil|mobilit.{0,10}ridott|handicap|wheelchair|entr[ae].{0,20}rotel/i],
        key: 'accessibility'
      },
      {
        patterns: [/parcheggi|posteggi|park|dove parcheg/i],
        key: 'parking'
      },
      {
        patterns: [/pagar|pagamento|cart[ae].{0,20}credit|credit.{0,15}card|bancomat|pos|contant|cash|visa|mastercard|bonifico|accetta.{0,15}cart|pagate.{0,10}cart|pagare.{0,10}cart/i],
        key: 'paymentMethods'
      },
      {
        patterns: [/esterno|all.aperto|terrazza|dehor|giardino|fuori/i],
        key: 'outdoorSeating'
      },
      {
        // Solo domande sul menu del ristorante, non dichiarazioni personali tipo "sono vegano"
        patterns: [/avete.{0,25}vegan|avete.{0,25}vegetar|piatti.{0,20}vegan|piatti.{0,20}vegetar|menu.{0,20}vegan|opzion.{0,20}vegan|opzion.{0,20}vegetar|vegan.{0,20}nel.{0,10}menu|si.{0,10}mangia.{0,20}vegan|cibo.{0,15}vegan/i],
        key: 'vegan'
      },
      {
        patterns: [/gluten|celiac|celiach|senza glutine/i],
        key: 'glutenFree'
      },
      {
        patterns: [/seggiol|seggialo|seggior|seggial|bambini.{0,15}segg|segg.{0,15}bambin|highchair|sediolin/i],
        key: 'highchair'
      },
      {
        patterns: [/quanto.{0,20}cost|prezz|menu.{0,20}cost|spende|tariffa|listino/i],
        key: 'prices'
      },
      {
        patterns: [/che tipo.{0,15}cucin|che cucin|tipo di cibo|specialit|che si mang|cosa si mang/i],
        key: 'cuisine'
      },
    ];

    for (const check of checks) {
      if (check.patterns.some(p => p.test(t))) {
        const val = ri[check.key];
        console.log(`📋 Info match: key=${check.key}, value=${val || '(vuoto)'}`);
        if (!val) return noInfo;
        // Se il valore è molto corto (es: "No", "Sì"), costruisci risposta più naturale
        const trimmed = val.trim();
        if (trimmed.length <= 3) {
          const isYes = /^(s[iì]|yes|oui|si)$/i.test(trimmed);
          const isNo  = /^(no|non|nein|nope)$/i.test(trimmed);
          if (isNo)  return lang === 'it' ? `No, mi dispiace, non abbiamo questa possibilità.` : `No, unfortunately we don't have this option.`;
          if (isYes) return lang === 'it' ? `Sì, certamente.` : `Yes, certainly.`;
        }
        return trimmed;
      }
    }
    return null; // non è una domanda info
  }

  // Carica le info ristorante da Apps Script e aggiorna il session prompt
  async _fetchAndInjectRestaurantInfo() {
    try {
      const result = await this._callAppsScript({ action: 'get_restaurant_info' });
      if (result?.success && result.info) {
        this._restaurantInfo = result.info;
        const _menuLen = result.info.menuDetails ? result.info.menuDetails.length : 0;
        console.log(`📋 Restaurant info caricata (menuDetails: ${_menuLen} chars)`);
        // In dual session, le info ristorante vengono usate localmente da _checkInfoQuestion().
        // Non è necessario iniettarle nel context della sessione TTS — tutte le risposte
        // passano attraverso _say() che usa testo deterministico.
      }
    } catch(err) {
      console.error('❌ Errore fetch restaurant info:', err);
    }
  }

  _buildInfoSection() {
    const ri = this._restaurantInfo || {};

    const lines = [];

    // Indirizzo e telefono
    if (ri.address) lines.push(`Indirizzo: ${ri.address}`);
    if (ri.phone)   lines.push(`Telefono ristorante: ${ri.phone}`);

    // Info operative
    if (ri.accessibility)  lines.push(`Accessibilità sedia a rotelle: ${ri.accessibility}`);
    if (ri.parking)        lines.push(`Parcheggio: ${ri.parking}`);
    if (ri.paymentMethods) lines.push(`Metodi di pagamento: ${ri.paymentMethods}`);
    if (ri.highchair)      lines.push(`Seggiolone: ${ri.highchair}`);
    if (ri.outdoorSeating) lines.push(`Zona esterna: ${ri.outdoorSeating}`);

    // Menu e cucina
    if (ri.cuisine)    lines.push(`Tipo di cucina: ${ri.cuisine}`);
    if (ri.vegan)      lines.push(`Opzioni vegane/vegetariane: ${ri.vegan}`);
    if (ri.glutenFree) lines.push(`Senza glutine: ${ri.glutenFree}`);
    if (ri.prices)     lines.push(`Prezzi: ${ri.prices}`);
    if (ri.menuUrl)    lines.push(`Menu online: ${ri.menuUrl}`);
    if (ri.menuText)   lines.push(`Menu: ${ri.menuText}`);
    if (ri.menuDetails) lines.push(`=== MENU COMPLETO ===\n${ri.menuDetails}`);

    if (lines.length === 0) return '';

    const sep = '\u2550'.repeat(80);
    return '\n\n' + sep + '\n📋 INFORMAZIONI RISTORANTE\n' + sep + '\n' +
      'REGOLA CRITICA: Rispondi SOLO con le informazioni elencate qui sotto.\n' +
      'NON inventare mai informazioni non presenti. Se una domanda riguarda qualcosa\n' +
      'non elencato (es: un piatto specifico, allergie non menzionate, orari diversi),\n' +
      'di\' ESATTAMENTE: "Non ho questa informazione, verifichi direttamente col ristorante."\n\n' +
      lines.join('\n') + '\n' + sep;
  }

  // notesToRemove: array di stringhe da escludere dal merge (es. ['Tavolo esterno/terrazza'])
  _mergeNotesStr(existing, newNotes, notesToRemove) {
    let eArr = existing ? existing.split(/;\s*/).map(s => s.trim()).filter(Boolean) : [];
    const nArr = newNotes ? newNotes.split(/;\s*/).map(s => s.trim()).filter(Boolean) : [];
    // 🆕 FIX TEST7A: rimuovi note marcate per rimozione (es. "interno" → rimuove "Tavolo esterno/terrazza")
    if (notesToRemove && notesToRemove.length > 0) {
      eArr = eArr.filter(n => !notesToRemove.includes(n));
    }
    nArr.forEach(n => { if (!eArr.includes(n)) eArr.push(n); });
    return eArr.join('; ');
  }


  // ── Apps Script ───────────────────────────────────────────────────────────

  async _callAppsScript(payload) {
    const url = this.restaurantConfig?.apps_script_url || process.env.APPS_SCRIPT_URL;
    if (!url) return null;

    // Timeout di 15 secondi — Apps Script può essere lento su cold start
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const text = await response.text();
      try { return JSON.parse(text); } catch { return null; }
    } catch (err) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        console.error('❌ Apps Script timeout (15s)');
        return { success: false, reason: 'timeout' };
      }
      throw err;
    }
  }
}
