// ─── TURN MANAGER ─────────────────────────────────────────────────────────────
// Gestisce il rilevamento del fine-turno via sliding timer su transcript.delta
// Separato dall'OpenAIRealtimeClient per testabilità e debug isolato
// ─────────────────────────────────────────────────────────────────────────────

const KNOWN_HALLUCINATIONS = [
  'sottotitoli creati dalla comunità amara.org',
  'sottotitoli e composizione',
  'amara.org',
  'grazie per aver visto il video',
  'iscriviti al canale',
  'metti mi piace',
  'sottotitoli a cura di',
  'sottotitolato da',
  'transcript by',
  'transcribed by',
  'subtitles by',
  'www.youtube.com',
  'copyright',
  'a nome della repubblica',
  'anno medosi',
];

export class TurnManager {
  /**
   * @param {object} opts
   * @param {number}   opts.slidingMs    Timeout sliding in ms (default 1800)
   * @param {function} opts.onTurnReady  (transcript: string) => void  — turno finalizzato
   * @param {function} opts.onInterrupt  ()                  => void  — interrompi TTS
   */
  constructor(opts = {}) {
    this.slidingMs   = opts.slidingMs   || 1800;
    this.onTurnReady = opts.onTurnReady || (() => {});
    this.onInterrupt = opts.onInterrupt || (() => {});

    // Stato interno
    this._transcript  = '';   // accumulo transcript corrente
    this._timer       = null; // sliding timer handle
    this._turnId      = 0;    // anti-race: incrementato a ogni nuovo turno
    this._finalized   = false; // previene doppia esecuzione sullo stesso turno
  }

  // ── Chiamato da STTSession.onDelta ───────────────────────────────────────
  onDelta(delta) {
    // Nuovo delta = turno in corso → reset flag + interrompi TTS se attivo
    this._finalized = false;
    this.onInterrupt();

    this._transcript += delta;
    this._resetTimer();
  }

  // ── Chiamato da STTSession.onCompleted ────────────────────────────────────
  // Belt-and-suspenders: il timer gestisce già tutto, ma se completed arriva
  // con transcript diverso dall'accumulato, lo usiamo come fonte autoritativa
  onCompleted(text) {
    if (!this._transcript.trim() && text.trim()) {
      this._transcript = text;
    }
    this._resetTimer();
  }

  // ── Chiamato da STTSession.onSpeechStarted ────────────────────────────────
  onSpeechStarted() {
    this._finalized = false;
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
    this._finalized = true;

    const transcript = this._transcript.trim();
    this._transcript = '';

    this._turnId++;
    const myId = this._turnId;

    // Filtro: transcript vuoto o troppo corto
    if (!transcript || transcript.length < 2) {
      this._finalized = false;
      return;
    }

    // Filtro: allucinazioni Whisper note
    const tLow = transcript.toLowerCase();
    if (KNOWN_HALLUCINATIONS.some(h => tLow.includes(h))) {
      console.log(`🛡️ [TurnManager] Hallucination filtrata: "${transcript.substring(0, 60)}"`);
      this._finalized = false;
      return;
    }

    // Anti-race: se nel frattempo è arrivato un altro turno, ignora
    if (myId !== this._turnId) {
      this._finalized = false;
      return;
    }

    // Passa il transcript al client per l'elaborazione
    try {
      await this.onTurnReady(transcript);
    } catch (err) {
      console.error('❌ [TurnManager] onTurnReady error:', err);
    } finally {
      // Reset flag: prossimo turno può procedere
      this._finalized = false;
    }
  }

  // ── Reset completo (es. fine chiamata) ────────────────────────────────────
  reset() {
    clearTimeout(this._timer);
    this._transcript = '';
    this._finalized  = false;
  }
}
