// ═══════════════════════════════════════════════════════════════════════════
// REPLAY HARNESS — ModifyEngine
//
// Testa la logica MODIFY SENZA telefonate, SENZA rete, SENZA OpenAI.
// Ogni scenario è una lista di transcript (stringhe). Il harness inietta
// dipendenze finte e fa assert su cosa dice il bot + stato finale dell'engine.
//
// Esecuzione:   node modify-engine.replay.test.js
// Exit code:    0 = tutti verdi, 1 = almeno un fallimento (usabile in CI)
//
// COME AGGIUNGERE UN BUG REGRESSIONE:
//   1. Riproduci il bug come scenario qui sotto (transcript + brain + backend).
//   2. Scrivi l'assert sul comportamento CORRETTO atteso.
//   3. D'ora in poi il bug non può più tornare silenziosamente.
// ═══════════════════════════════════════════════════════════════════════════

import assert from 'node:assert';
import { ModifyEngine } from './modify-engine.js';
import { DateManager, TimeManager, ValidationPipeline } from './parsers.js';

// ─── Config ristorante di test (orari standard) ─────────────────────────────
const RC = { lunch_start: '12:00', lunch_end: '14:30', dinner_start: '19:00', dinner_end: '22:30' };

// Date fisse note (2026-06-06 = sabato, 2026-06-08 = lunedì)
const SAT = '2026-06-06';
const MON = '2026-06-08';

// ─── Factory prenotazione canonica ──────────────────────────────────────────
function makeReservation(over = {}) {
  return {
    eventId: 'evt_test_1',
    name:    'Galli',
    date:    SAT,
    time:    '20:00:00',
    people:  4,
    phone:   '+393385354671',
    notes:   '',
    ...over,
  };
}

// ─── Brain GPT finto — instrada per system prompt ───────────────────────────
// I tre prompt dell'engine sono distinguibili dalla prima riga del system msg.
function makeGptComplete(brain) {
  return async (messages) => {
    const sys  = messages[0]?.content || '';
    const user = messages[messages.length - 1]?.content || '';

    if (sys.includes('estrattore di operazioni')) {
      const ops = brain.extractOperations ? brain.extractOperations(user) : [];
      return JSON.stringify({ operations: ops });
    }
    if (sys.includes('mostrato un recap')) {
      return brain.classify ? brain.classify(user) : 'correction';
    }
    if (sys.includes('Rispondi brevemente a questa domanda')) {
      return brain.infoAnswer ? brain.infoAnswer(user) : null;
    }
    return null;
  };
}

// ─── Runner di uno scenario ─────────────────────────────────────────────────
async function runScenario(s) {
  const said = [];               // tutto ciò che il bot "dice"
  const appsCalls = [];          // payload inviati ad Apps Script

  const backend = s.backend || {};
  const callAppsScript = async (payload) => {
    appsCalls.push(payload);
    const r = backend[payload.action];
    return typeof r === 'function' ? r(payload) : (r ?? { success: true });
  };

  // findReservationWithFallback: di default ritorna s.reservation; override con s.search
  const findReservationWithFallback = s.search
    ? async (name, date, log) => s.search(name, date, log)
    : async () => (s.reservation ?? null);

  const engine = new ModifyEngine({
    say:                         (m) => said.push(m),
    callAppsScript,
    findReservationWithFallback,
    buildInfoContext:            () => '',
    mergeNotesStr:               (a, b) => {
      const eArr = a ? a.split(/;\s*/).map(x => x.trim()).filter(Boolean) : [];
      const nArr = b ? b.split(/;\s*/).map(x => x.trim()).filter(Boolean) : [];
      nArr.forEach(n => { if (!eArr.includes(n)) eArr.push(n); });
      return eArr.join('; ');
    },
    formatForDisplay:     (d) => DateManager.formatForDisplay(d),
    formatTimeForDisplay: (t) => TimeManager.formatForDisplay(t),
    isValidTime:          (t, cfg) => ValidationPipeline.isValidTime(t, cfg),
    restaurantConfig:     RC,
    gptComplete:          makeGptComplete(s.brain || {}),
  });

  // Esegui i turni in sequenza
  for (const turn of s.turns) {
    const extracted = turn.extracted || {};
    await engine.handle(turn.transcript, extracted);
  }

  // Helper di assert offerti allo scenario
  const ctx = {
    engine,
    said,
    appsCalls,
    lastSaid: () => said[said.length - 1] || '',
    saidIncludes: (sub) => said.some(t => t.includes(sub)),
    appsCallWith: (action) => appsCalls.find(c => c.action === action),
  };

  s.expect(ctx);
}

// ═══════════════════════════════════════════════════════════════════════════
// SCENARI
// ═══════════════════════════════════════════════════════════════════════════
const scenarios = [

  // ── 1. Happy path: match diretto, cambio data+ora, conferma ───────────────
  {
    name: 'Match diretto → cambio data+ora → conferma → DONE',
    reservation: makeReservation(),
    backend: { check_availability: { success: true }, update_reservation: { success: true } },
    brain: {
      extractOperations: () => [
        { type: 'update_date', mode: 'set', value: SAT },
        { type: 'update_time', mode: 'set', value: '21:00:00' },
      ],
    },
    turns: [
      { transcript: 'vorrei spostare la prenotazione di Galli a sabato alle 21', extracted: { newName: 'Galli', newDate: SAT } },
      { transcript: 'sì confermo', extracted: {} },
    ],
    expect: (c) => {
      assert.strictEqual(c.engine.state, 'DONE', 'stato finale deve essere DONE');
      assert(c.saidIncludes('Confermo?'), 'deve aver proposto un recap con Confermo?');
      assert(c.saidIncludes('21:00'), 'recap/conferma deve citare il nuovo orario');
      assert(c.saidIncludes('Ho aggiornato'), 'deve confermare l\'aggiornamento');
      assert(c.appsCallWith('update_reservation'), 'deve aver chiamato update_reservation');
    },
  },

  // ── 2. DELTA persone (il bug storico) — 4 + "altre due" = 6, NON 2 ────────
  {
    name: 'Delta persone: 4 + "si sono aggiunte due" = 6',
    reservation: makeReservation({ people: 4 }),
    backend: { update_reservation: { success: true } },
    brain: {
      extractOperations: () => [{ type: 'update_people', mode: 'delta', value: 2 }],
    },
    turns: [
      { transcript: 'per la prenotazione di Galli, si sono aggiunte due persone', extracted: { newName: 'Galli' } },
      { transcript: 'sì', extracted: {} },
    ],
    expect: (c) => {
      assert.strictEqual(c.engine.state, 'DONE');
      assert(c.saidIncludes('6 persone'), `recap deve dire 6 persone, detto: ${JSON.stringify(c.said)}`);
      const call = c.appsCallWith('update_reservation');
      assert.strictEqual(call.persone, 6, 'update_reservation deve salvare 6, non 2');
    },
  },

  // ── 3. ASSOLUTO persone — "diventiamo 6" = 6 ──────────────────────────────
  {
    name: 'Assoluto persone: "diventiamo 6" = 6',
    reservation: makeReservation({ people: 4 }),
    backend: { update_reservation: { success: true } },
    brain: {
      extractOperations: () => [{ type: 'update_people', mode: 'absolute', value: 6 }],
    },
    turns: [
      { transcript: 'Galli, diventiamo sei', extracted: { newName: 'Galli' } },
      { transcript: 'sì', extracted: {} },
    ],
    expect: (c) => {
      assert.strictEqual(c.engine.state, 'DONE');
      assert.strictEqual(c.appsCallWith('update_reservation').persone, 6);
    },
  },

  // ── 4. FUZZY match → conferma "sì" → applica richiesta ORIGINALE ──────────
  //     (il fix di oggi: il "sì" NON deve essere parsato come nuova prenotazione)
  {
    name: 'Fuzzy match → "sì" → CONFIRM_PATCH con richiesta originale',
    search: async () => ({
      requiresConfirmation: true,
      fuzzyCandidate: makeReservation({ name: 'Galli', people: 4 }),
    }),
    backend: { check_availability: { success: true }, update_reservation: { success: true } },
    brain: {
      // _firstTranscript = la richiesta originale del turno 1
      extractOperations: (user) => user.includes('21')
        ? [{ type: 'update_time', mode: 'set', value: '21:00:00' }]
        : [],
    },
    turns: [
      { transcript: 'vorrei spostare la prenotazione di Gally alle 21', extracted: { newName: 'Gally' } },
      { transcript: 'sì esatto', extracted: {} },
    ],
    expect: (c) => {
      assert(c.saidIncludes('È quella che vuole modificare?'), 'deve presentare il candidato fuzzy');
      assert.strictEqual(c.engine.state, 'CONFIRM_PATCH', 'dopo il sì deve proporre il recap, non ripartire');
      assert(c.saidIncludes('21:00'), 'recap deve riflettere la richiesta originale (alle 21)');
    },
  },

  // ── 5. FUZZY match → "no" → torna a chiedere il nome ──────────────────────
  {
    name: 'Fuzzy match → "no" → SEARCH_BOOKING (richiede nome)',
    search: async () => ({
      requiresConfirmation: true,
      fuzzyCandidate: makeReservation({ name: 'Gallo' }),
    }),
    brain: {},
    turns: [
      { transcript: 'modifica prenotazione Galli', extracted: { newName: 'Galli' } },
      { transcript: 'no', extracted: {} },
    ],
    expect: (c) => {
      assert.strictEqual(c.engine.state, 'SEARCH_BOOKING');
      assert(c.saidIncludes('A che nome'), 'deve richiedere il nome dopo il rifiuto');
    },
  },

  // ── 6. RICERCA multi-turno: nome assente al turno 1, fornito al turno 2 ────
  //     Verifica che _firstTranscript preservi la richiesta di modifica.
  {
    name: 'Ricerca multi-turno: preserva richiesta originale',
    reservation: makeReservation({ people: 4 }),
    backend: { update_reservation: { success: true } },
    brain: {
      // la richiesta vera ("siamo in 6") è nel PRIMO transcript
      extractOperations: (user) => user.includes('sei') || user.includes('6')
        ? [{ type: 'update_people', mode: 'absolute', value: 6 }]
        : [],
    },
    turns: [
      { transcript: 'vorrei modificare, ora siamo in sei', extracted: {} },          // nessun nome
      { transcript: 'Galli', extracted: { newName: 'Galli' } },                       // nome → trova → applica primo transcript
      { transcript: 'sì', extracted: {} },
    ],
    expect: (c) => {
      assert.strictEqual(c.engine.state, 'DONE');
      assert(c.saidIncludes('A che nome'), 'turno 1 senza nome deve chiedere il nome');
      assert.strictEqual(c.appsCallWith('update_reservation').persone, 6,
        'deve applicare la modifica del PRIMO transcript (6 persone)');
    },
  },

  // ── 7. day_closed sulla nuova data → resta MODIFY_ACTIVE, richiede giorno ──
  {
    name: 'Cambio data su giorno chiuso → resta in MODIFY_ACTIVE',
    reservation: makeReservation({ date: SAT }),
    backend: { check_availability: { success: false, reason: 'day_closed' } },
    brain: {
      extractOperations: () => [{ type: 'update_date', mode: 'set', value: MON }],
    },
    turns: [
      { transcript: 'Galli, spostare a lunedì', extracted: { newName: 'Galli' } },
      { transcript: 'sì', extracted: {} },
    ],
    expect: (c) => {
      assert(c.saidIncludes('chiusi'), 'deve segnalare che il giorno è chiuso');
      assert.strictEqual(c.engine.state, 'MODIFY_ACTIVE', 'deve permettere un nuovo tentativo');
      assert(!c.appsCallWith('update_reservation'), 'NON deve aggiornare se il giorno è chiuso');
    },
  },

  // ── 8. Correzione al recap: recap dice 5, utente "no, siamo in 4" → 4 ──────
  {
    name: 'Correzione al recap: 5 → 4',
    reservation: makeReservation({ people: 3 }),
    backend: { update_reservation: { success: true } },
    brain: {
      // primo giro: assoluto 5 ; correzione: assoluto 4
      extractOperations: (user) => user.includes('quattro') || user.includes('4')
        ? [{ type: 'update_people', mode: 'absolute', value: 4 }]
        : [{ type: 'update_people', mode: 'absolute', value: 5 }],
      // "no siamo in 4" ha una cifra → euristica classifica già 'correction' senza GPT
    },
    turns: [
      { transcript: 'Galli, saremo cinque', extracted: { newName: 'Galli' } },
      { transcript: 'no aspetta, siamo in quattro', extracted: {} },
      { transcript: 'sì perfetto', extracted: {} },
    ],
    expect: (c) => {
      assert.strictEqual(c.engine.state, 'DONE');
      assert(c.saidIncludes('5 persone'), 'primo recap a 5');
      assert(c.saidIncludes('4 persone'), 'recap corretto a 4');
      assert.strictEqual(c.appsCallWith('update_reservation').persone, 4, 'salva il valore corretto (4)');
    },
  },

  // ── 9. Solo note (nessun cambio slot) → salva note, niente check disponib. ─
  {
    name: 'Solo nota (allergia) → update_notes, niente slot change',
    reservation: makeReservation({ notes: '' }),
    backend: { update_notes: { success: true } },
    brain: {
      extractOperations: () => [{ type: 'add_note', value: 'Allergia noci' }],
    },
    turns: [
      { transcript: 'Galli, segnate che siamo allergici alle noci', extracted: { newName: 'Galli' } },
    ],
    expect: (c) => {
      assert.strictEqual(c.engine.state, 'DONE');
      assert(c.saidIncludes('Allergia noci') || c.saidIncludes('annotato'), 'conferma la nota');
      assert(c.appsCallWith('update_notes'), 'usa update_notes, non update_reservation');
      assert(!c.appsCallWith('check_availability'), 'nessun check disponibilità per sole note');
    },
  },

  // ── 10. INFO QUERY che coesiste col booking (il problema #4) ──────────────
  //      "a che ora chiude la cucina? comunque spostatemi a sabato alle 21"
  //      → risponde all'info E propone il recap della modifica, senza bloccare.
  {
    name: 'Info query + modifica nello stesso turno → risponde a entrambe',
    reservation: makeReservation({ date: MON, time: '20:00:00' }),
    backend: { check_availability: { success: true }, update_reservation: { success: true } },
    brain: {
      extractOperations: () => [
        { type: 'info_query', topic: 'orario chiusura cucina' },
        { type: 'update_date', mode: 'set', value: SAT },
        { type: 'update_time', mode: 'set', value: '21:00:00' },
      ],
      infoAnswer: () => 'La cucina chiude alle 22:30.',
    },
    turns: [
      { transcript: 'a che ora chiude la cucina? comunque spostatemi a sabato alle 21', extracted: { newName: 'Galli' } },
      { transcript: 'sì', extracted: {} },
    ],
    expect: (c) => {
      assert.strictEqual(c.engine.state, 'DONE');
      assert(c.saidIncludes('22:30'), 'deve rispondere alla domanda info (cucina chiude 22:30)');
      assert(c.saidIncludes('Confermo?'), 'deve comunque proporre il recap della modifica');
      assert(c.saidIncludes('21:00'), 'recap col nuovo orario');
    },
  },

  // ── 11. Reject al recap → DONE senza aggiornare ───────────────────────────
  {
    name: 'Reject al recap → nessun aggiornamento',
    reservation: makeReservation({ people: 4 }),
    backend: { update_reservation: { success: true } },
    brain: {
      extractOperations: () => [{ type: 'update_people', mode: 'absolute', value: 6 }],
    },
    turns: [
      { transcript: 'Galli, diventiamo sei', extracted: { newName: 'Galli' } },
      { transcript: 'no lascia perdere', extracted: {} },
    ],
    expect: (c) => {
      assert.strictEqual(c.engine.state, 'DONE');
      assert(!c.appsCallWith('update_reservation'), 'reject NON deve aggiornare');
      assert(c.saidIncludes('invariata'), 'deve dire che la prenotazione resta invariata');
    },
  },

  // ── 12. Nome non trovato → messaggio chiaro, niente crash ─────────────────
  {
    name: 'Prenotazione non trovata',
    search: async () => null,
    brain: {},
    turns: [
      { transcript: 'modifica prenotazione Sconosciuto', extracted: { newName: 'Sconosciuto' } },
    ],
    expect: (c) => {
      assert(c.saidIncludes('Non trovo'), 'deve dire che non trova la prenotazione');
    },
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// RUNNER
// ═══════════════════════════════════════════════════════════════════════════
(async () => {
  let pass = 0, fail = 0;
  console.log('\n🧪 REPLAY HARNESS — ModifyEngine\n' + '─'.repeat(60));
  for (const s of scenarios) {
    try {
      await runScenario(s);
      console.log(`✅ ${s.name}`);
      pass++;
    } catch (err) {
      console.log(`❌ ${s.name}`);
      console.log(`   → ${err.message}`);
      fail++;
    }
  }
  console.log('─'.repeat(60));
  console.log(`Risultato: ${pass} verdi, ${fail} rossi su ${scenarios.length} scenari\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
