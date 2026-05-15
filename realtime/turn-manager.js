// ─── TURN MANAGER ─────────────────────────────────────────────────────────────
// Gestisce il rilevamento del fine-turno.
//
// Architettura corretta (da GPT):
//   - delta  → SOLO interrupt detection (reset timer + interrompi TTS)
//              NON usare come testo — le delta possono riscrivere parole precedenti
//   - completed → transcript AUTORITATIVO → business logic
//
// Il sliding timer su delta serve solo a capire "l'utente sta ancora parlando".
// Il testo reale viene da onCompleted.
// ─────────────────────────────────────────────────────────────────────────────

export class TurnManager {
  /**
   * @param {object}   opts
   * @param {number}   opts.slidingMs    Timeout sliding in ms (default 1800)
   * @param {function} opts.onTurnReady  (transcript: string) => void
   * @param {function} opts.onInterrupt  () => void — interrompi TTS
   */
  constructor(opts = {}) {
    this.slidingMs    = opts.slidingMs    || 1800;
    this.onTurnReady  = opts.onTurnReady  || (() => {});
    this.onInterrupt  = opts.onInterrupt  || (() => {});

    // Stato interno
    this._timer        = null;    // sliding timer handle
    this._speaking     = false;   // utente sta parlando (delta arrivano)
    this._pendingText  = null;    // transcript completed in attesa del timer
    this._turnId       = 0;       // anti-race
    this._finalized    = false;   // previene doppia esecuzione
  }

  // ── Chiamato su ogni transcription.delta ─────────────────────────────────
  // NON accumula testo — serve solo per:
  //   1. segnalare che l'utente sta parlando
  //   2. interrompere TTS
  //   3. resettare il sliding timer
  onDelta(_delta) {
    this._finalized = false;
    this._speaking  = true;
    this.onInterrupt();
    this._resetTimer();
  }

  // ── Chiamato su transcription.completed ──────────────────────────────────
  // Questo è il transcript AUTORITATIVO.
  // Lo salviamo e aspettiamo che il timer scada (silenzio reale).
  onCompleted(text) {
    if (!text || text.trim().length < 2) return;
    this._pendingText = text.trim();
    this._speaking    = false;
    // Resettiamo il timer: aspettiamo ancora un po' prima di finalizzare
    // nel caso l'utente stia per riprendere a parlare
    this._resetTimer();
  }

  // ── Chiamato su speech_started ───────────────────────────────────────────
  onSpeechStarted() {
    this._finalized = false;
    this._speaking  = true;
    this.onInterrupt();
  }

  // ── Sliding Timer ─────────────────────────────────────────────────────────
  _resetTimer() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this._finalize(), this.slidingMs);
  }

  // ── Finalizza il turno ────────────────────────────────────────────────────
  async _finalize() {
    if (this._finalized) return;

    // Usa il transcript completed come fonte autoritativa
    const transcript = this._pendingText;
    this._pendingText = null;
    this._speaking    = false;

    if (!transcript || transcript.length < 2) {
      this._finalized = false;
      return;
    }

    this._finalized = true;
    this._turnId++;
    const myId = this._turnId;

    try {
      await this.onTurnReady(transcript);
    } catch (err) {
      console.error('❌ [TurnManager] onTurnReady error:', err);
    } finally {
      // Anti-race: se nel frattempo è arrivato un altro turno non resettare
      if (myId === this._turnId) {
        this._finalized = false;
      }
    }
  }

  // ── Reset completo ────────────────────────────────────────────────────────
  reset() {
    clearTimeout(this._timer);
    this._pendingText = null;
    this._speaking    = false;
    this._finalized   = false;
  }
}
