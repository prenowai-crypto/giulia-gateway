# Batch B-01 (tests 1-30)
Run: 2026-08-03T17:24:48.432Z | Model: gpt-realtime-2.1-mini | Total: 30 | Passed: 27 (90%) | Failed: 3

## ✅ Passed (27)

- **B07-001** `modify`: Cliente crea e poi corregge subito l'ora (21 → 22) (42582ms, 4 tool calls)
- **B07-003** `modify`: Cliente corregge subito il numero di persone (2 → 3) (29740ms, 4 tool calls)
- **B07-004** `modify`: Cliente corregge subito il numero di persone (4 → 2) (29735ms, 4 tool calls)
- **B07-005** `modify`: Cliente corregge il cognome (Rossi → Russo) (46593ms, 5 tool calls)
- **B07-006** `modify`: Cliente aggiunge il cognome (Giorgio → Giorgio Bianchi) (33258ms, 4 tool calls)
- **B07-007** `modify`: Cliente cambia il giorno (venerdì → giovedì) (47024ms, 5 tool calls)
- **B07-008** `modify`: Cliente cambia giorno da venerdì a domenica (36904ms, 5 tool calls)
- **B07-009** `modify`: Cliente cambia giorno a lunedì (chiuso) — modello deve rifiutare la modifica (28174ms, 2 tool calls)
- **B07-010** `modify`: Cliente cambia ora a orario fuori servizio — modello deve rifiutare la modifica (19065ms, 2 tool calls)
- **B07-011** `modify`: Cliente aggiunge una nota dopo la creazione (allergia) (30853ms, 4 tool calls)
- **B07-012** `modify`: Cliente aggiunge una nota dopo la creazione (tavolo esterno) (30051ms, 4 tool calls)
- **B07-013** `modify`: Doppia correzione — cliente cambia sia ora sia persone (29963ms, 4 tool calls)
- **B07-014** `modify`: Modifica persone che porta a gruppo grande (pending owner) (29804ms, 4 tool calls)
- **B07-015** `modify`: Cliente cambia idea più volte — modello mantiene stato coerente (40492ms, 5 tool calls)
- **B07-016** `modify`: Cliente chiede modifica senza specificare cosa — modello deve chiedere (19755ms, 2 tool calls)
- **B07-017** `modify`: Cliente crea, ripensa, poi mantiene tutto uguale (idempotenza) (45475ms, 4 tool calls)
- **B07-018** `modify`: Cliente vuole modificare ma dà solo il cognome — modello usa quello (29819ms, 4 tool calls)
- **B07-020** `modify`: Cliente aggiunge nota compleanno dopo creazione (30267ms, 4 tool calls)
- **B07-021** `modify`: Cliente aggiunge nota cane dopo creazione (32213ms, 5 tool calls)
- **B07-023** `modify`: Cliente crea e poi anticipa a stessa ora giorno precedente (35856ms, 5 tool calls)
- **B07-024** `modify`: Cliente chiede 'cancella e rifai' — modello deve preferire modifica (34562ms, 5 tool calls)
- **B07-025** `modify`: Cliente cambia persone da 8 a 9 (attraversa la soglia gruppi grandi) (29321ms, 4 tool calls)
- **B07-026** `modify`: Cliente cambia persone da 9 (large group) a 6 (torna a normale) (30193ms, 4 tool calls)
- **B07-027** `modify`: Cliente vuole modificare una nota già registrata (allergia → intolleranza) (29415ms, 5 tool calls)
- **B07-028** `modify`: Cliente vuole rimuovere una nota già registrata (30544ms, 4 tool calls)
- **B07-029** `modify`: Cliente crea, poi corregge il nome usando 'no, mi chiamo' (25155ms, 4 tool calls)
- **B07-030** `modify`: Cliente chiede modifica dopo aver confermato — flow completo (57246ms, 7 tool calls)

## ❌ Failed (3)

### B07-002 — `modify`
**Description**: Cliente crea e poi corregge l'ora (21:00 → 21:30)

**Reason**: expected tool call 'modifica_prenotazione' with args {"nome":"Ricci","ora":"21:30"} not found. Actual: [{"name":"controlla_disponibilita","args":{"data":"2026-08-07","ora":"21:00","persone":2}},{"name":"controlla_disponibilita","args":{"data":"2026-08-07","ora":"21:00","persone":2}},{"name":"crea_prenotazione","args":{"nome":"Ricci","data":"2026-08-07","ora":"21:00","persone":2,"note":""}},{"name":"trova_prenotazione","args":{"nome":"Ricci","data":"2026-08-07"}},{"name":"trova_prenotazione","args":{"nome":"Ricci","data":"2026-08-07"}},{"name":"modifica_prenotazione","args":{"eventId":"tkp4mgigq7e7dfig3af4d7pc00@google.com","time":"21:30","nome":"Ricci","data":"2026-08-07","ora":"21:00","persone":2}}]

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per venerdì prossimo alle nove di sera, due persone, a nome Ricci

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Ah scusa, era per le nove e mezza

**[AI reply 2]**: Un attimo, controllo la disponibilità per quella data e orario.

**[User turn 3]**: Sì confermo

**[AI reply 3]**: Un momento, riprovo a verificare la disponibilità per quell’orario.

**[AI reply 4]**: Prenotazione confermata: Ricci, venerdì alle 21:00, per 2 persone. A presto!

**[AI reply 5]**: Ok, aggiorno l’orario. Un attimo, controllo la prenotazione e poi la modifico.

**[AI reply 6]**: Mi spiace, non ho trovato la prenotazione. Potrebbe ripetere il nome o confermare la data di venerdì 7 agosto 2026? Una volta verificato, aggiorno l’orario a 21:30.

**[AI reply 7]**: Perfetto, allora aggiorno l’orario. Un attimo, controllo la prenotazione e poi la modifico.

**[AI reply 8]**: Fatto, ora è confermato per le 21:30. Ricci, venerdì alle 21:30, sempre 2 persone.

**Tool calls made** (6):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-08-07",
      "ora": "21:00",
      "persone": 2
    }
  },
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-08-07",
      "ora": "21:00",
      "persone": 2
    }
  },
  {
    "name": "crea_prenotazione",
    "args": {
      "nome": "Ricci",
      "data": "2026-08-07",
      "ora": "21:00",
      "persone": 2,
      "note": ""
    }
  },
  {
    "name": "trova_prenotazione",
    "args": {
      "nome": "Ricci",
      "data": "2026-08-07"
    }
  },
  {
    "name": "trova_prenotazione",
    "args": {
      "nome": "Ricci",
      "data": "2026-08-07"
    }
  },
  {
    "name": "modifica_prenotazione",
    "args": {
      "eventId": "tkp4mgigq7e7dfig3af4d7pc00@google.com",
      "time": "21:30",
      "nome": "Ricci",
      "data": "2026-08-07",
      "ora": "21:00",
      "persone": 2
    }
  }
]
```

**Duration**: 59023ms

---

### B07-019 — `modify`
**Description**: Cliente vuole spostare la prenotazione a un giorno con seed pieno (sabato)

**Reason**: reply must contain 'complet' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Un attimo, controllo la disponibilità per quella data e ora. Prenotazione confermata per Vitale, venerdì alle 21:00, pe

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per venerdì prossimo alle nove di sera, quattro persone, a nome Vitale

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Aspetta, la spostiamo a sabato prossimo stessa ora

**[AI reply 2]**: Un attimo, controllo la disponibilità per quella data e ora.

**[AI reply 3]**: Prenotazione confermata per Vitale, venerdì alle 21:00, per 4 persone. A presto!

**[AI reply 4]**: Un attimo, controllo la disponibilità per sabato alla stessa ora.

**[AI reply 5]**: Sabato prossimo alle 21:00 è già full. Vuole un’altra ora o un altro giorno.

**Tool calls made** (3):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-08-07",
      "ora": "21:00",
      "persone": 4
    }
  },
  {
    "name": "crea_prenotazione",
    "args": {
      "nome": "Vitale",
      "data": "2026-08-07",
      "ora": "21:00",
      "persone": 4,
      "note": ""
    }
  },
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-08-08",
      "ora": "21:00",
      "persone": 4
    }
  }
]
```

**Duration**: 20615ms

---

### B07-022 — `modify`
**Description**: Cliente chiede di modificare una prenotazione inesistente — modello deve dire non trovata

**Reason**: expected tool call 'trova_prenotazione' with args {"nome":"Franceschini"} not found. Actual: [] | reply must contain 'trovat' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Mi serve un dettaglio: quale giovedì intende, giovedì 6 agosto o quello della settimana successiva?  
E per “stessa ora | last reply not in 'it': mi serve un dettaglio: quale giovedì intende, giovedì 6 agosto o quello della settimana successiva?  
e per “stessa ora”, può ripetere l’orario precis

**Full transcript**:

**[User turn 1]**: Buonasera, avevo una prenotazione a nome Franceschini per venerdì prossimo, vorrei cambiarla in giovedì stessa ora

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[AI reply 2]**: Mi serve un dettaglio: quale giovedì intende, giovedì 6 agosto o quello della settimana successiva?  
E per “stessa ora”, può ripetere l’orario preciso?

**Tool calls made** (0):
```json
[]
```

**Duration**: 6030ms

---

