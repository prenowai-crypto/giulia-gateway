# Batch B-01 (tests 1-30)
Run: 2026-08-03T21:57:10.949Z | Model: gpt-realtime-2.1-mini | Total: 30 | Passed: 25 (83%) | Failed: 5

## ✅ Passed (25)

- **B07-001** `modify`: Cliente crea e poi corregge subito l'ora (21 → 22) (25002ms, 4 tool calls)
- **B07-002** `modify`: Cliente crea e poi corregge l'ora (21:00 → 21:30) (29838ms, 4 tool calls)
- **B07-003** `modify`: Cliente corregge subito il numero di persone (2 → 3) (46492ms, 4 tool calls)
- **B07-004** `modify`: Cliente corregge subito il numero di persone (4 → 2) (88951ms, 7 tool calls)
- **B07-005** `modify`: Cliente corregge il cognome (Rossi → Russo) (32669ms, 4 tool calls)
- **B07-006** `modify`: Cliente aggiunge il cognome (Giorgio → Giorgio Bianchi) (31861ms, 4 tool calls)
- **B07-007** `modify`: Cliente cambia il giorno (venerdì → giovedì) (28452ms, 5 tool calls)
- **B07-008** `modify`: Cliente cambia giorno da venerdì a domenica (28306ms, 5 tool calls)
- **B07-010** `modify`: Cliente cambia ora a orario fuori servizio — modello deve rifiutare la modifica (18352ms, 2 tool calls)
- **B07-012** `modify`: Cliente aggiunge una nota dopo la creazione (tavolo esterno) (27194ms, 4 tool calls)
- **B07-013** `modify`: Doppia correzione — cliente cambia sia ora sia persone (29481ms, 4 tool calls)
- **B07-014** `modify`: Modifica persone che porta a gruppo grande (pending owner) (26626ms, 4 tool calls)
- **B07-015** `modify`: Cliente cambia idea più volte — modello mantiene stato coerente (43242ms, 6 tool calls)
- **B07-017** `modify`: Cliente crea, ripensa, poi mantiene tutto uguale (idempotenza) (18207ms, 2 tool calls)
- **B07-018** `modify`: Cliente vuole modificare ma dà solo il cognome — modello usa quello (75791ms, 6 tool calls)
- **B07-020** `modify`: Cliente aggiunge nota compleanno dopo creazione (25634ms, 4 tool calls)
- **B07-021** `modify`: Cliente aggiunge nota cane dopo creazione (28113ms, 4 tool calls)
- **B07-022** `modify`: Cliente chiede di modificare una prenotazione inesistente — modello deve dire non trovata (9522ms, 1 tool calls)
- **B07-023** `modify`: Cliente crea e poi anticipa a stessa ora giorno precedente (62988ms, 6 tool calls)
- **B07-024** `modify`: Cliente chiede 'cancella e rifai' — modello deve preferire modifica (33481ms, 5 tool calls)
- **B07-025** `modify`: Cliente cambia persone da 8 a 9 (attraversa la soglia gruppi grandi) (24765ms, 4 tool calls)
- **B07-026** `modify`: Cliente cambia persone da 9 (large group) a 6 (torna a normale) (25694ms, 4 tool calls)
- **B07-027** `modify`: Cliente vuole modificare una nota già registrata (allergia → intolleranza) (23209ms, 4 tool calls)
- **B07-029** `modify`: Cliente crea, poi corregge il nome usando 'no, mi chiamo' (34024ms, 4 tool calls)
- **B07-030** `modify`: Cliente chiede modifica dopo aver confermato — flow completo (29051ms, 4 tool calls)

## ❌ Failed (5)

### B07-009 — `modify`
**Description**: Cliente cambia giorno a lunedì (chiuso) — modello deve rifiutare la modifica

**Reason**: expected tool call 'crea_prenotazione' with args {"nome":"Longo"} not found. Actual: []

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per venerdì prossimo alle nove di sera, due persone, a nome Longo

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Aspetta, la spostiamo a lunedì prossimo stessa ora

**[AI reply 2]**: Perfetto, controlliamo: Longo, venerdì 7 agosto 2026, alle 21:00, 2 persone. Vuole confermare la prenotazione?

**[AI reply 3]**: Mi spiace, lunedì prossimo siamo chiusi. Vuole spostare al martedì o a un altro giorno tra martedì e domenica, sempre alla stessa ora?

**Tool calls made** (0):
```json
[]
```

**Duration**: 6830ms

---

### B07-011 — `modify`
**Description**: Cliente aggiunge una nota dopo la creazione (allergia)

**Reason**: last reply not in 'it': di nulla, è sempre un piacere. a presto!

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per venerdì prossimo alle nove di sera, due persone, a nome Testa

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Ah dimenticavo, uno di noi è celiaco, potete aggiungerlo?

**[AI reply 2]**: Perfetto, controllo la disponibilità per venerdì alle 21:00. Un attimo.

**[User turn 3]**: Sì grazie

**[AI reply 3]**: Prenotazione confermata: Testa, venerdì alle 21:00, per 2 persone. A presto!

**[AI reply 4]**: Un attimo, aggiorno la prenotazione con la nota relativa al celiaco.

**[AI reply 5]**: Fatto, ho aggiunto la nota sulla celiachia. A presto!

**[AI reply 6]**: Di nulla, è sempre un piacere. A presto!

**Tool calls made** (4):
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
    "name": "crea_prenotazione",
    "args": {
      "nome": "Testa",
      "data": "2026-08-07",
      "ora": "21:00",
      "persone": 2,
      "note": ""
    }
  },
  {
    "name": "trova_prenotazione",
    "args": {
      "nome": "Testa",
      "data": "2026-08-07"
    }
  },
  {
    "name": "modifica_prenotazione",
    "args": {
      "nome": "Testa",
      "data": "2026-08-07",
      "ora": "21:00",
      "persone": 2,
      "note": "Celiaco: obbligo di attenzione per contaminazione crostacei/allergeni.",
      "eventId": "vn9r2or7pa995jd79kl9ie7m64@google.com"
    }
  }
]
```

**Duration**: 27807ms

---

### B07-016 — `modify`
**Description**: Cliente chiede modifica senza specificare cosa — modello deve chiedere

**Reason**: reply must contain 'cosa' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Un attimo, controllo la disponibilità. Perfetto, ora registro la prenotazione. Prenotazione confermata: Marchetti, vene

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per venerdì prossimo alle nove di sera, due persone, a nome Marchetti

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Vorrei modificare la prenotazione

**[AI reply 2]**: Un attimo, controllo la disponibilità.

**[AI reply 3]**: Perfetto, ora registro la prenotazione.

**[AI reply 4]**: Prenotazione confermata: Marchetti, venerdì alle 21:00, per 2 persone. A presto!

**[AI reply 5]**: Un attimo, controllo la prenotazione per aggiornarla.

**[AI reply 6]**: Perfetto, la prenotazione è trovata. L’ultima data e ora sono venerdì 7 agosto alle 21:00, per 2 persone. Vuole cambiare uno di questi dettagli (data, ora, persone) o aggiungere una nota?

**Tool calls made** (3):
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
    "name": "crea_prenotazione",
    "args": {
      "nome": "Marchetti",
      "data": "2026-08-07",
      "ora": "21:00",
      "persone": 2,
      "note": ""
    }
  },
  {
    "name": "trova_prenotazione",
    "args": {
      "nome": "Marchetti",
      "data": "2026-08-07"
    }
  }
]
```

**Duration**: 21723ms

---

### B07-019 — `modify`
**Description**: Cliente vuole spostare la prenotazione a un giorno con seed pieno (sabato)

**Reason**: reply must contain 'complet' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Perfetto, controllo subito la disponibilità per quel orario. Prenotazione confermata: Vitale, venerdì alle 21:00, per 4

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per venerdì prossimo alle nove di sera, quattro persone, a nome Vitale

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Aspetta, la spostiamo a sabato prossimo stessa ora

**[AI reply 2]**: Perfetto, controllo subito la disponibilità per quel orario.

**[AI reply 3]**: Prenotazione confermata: Vitale, venerdì alle 21:00, per 4 persone. A presto!

**[AI reply 4]**: Capito, sposto la prenotazione al sabato alle 21:00. Un attimo, controllo la disponibilità.

**[AI reply 5]**: Mi dispiace, sabato alle 21:00 è già pieno. Vuole provare un orario diverso, sempre sabato sera, o un altro giorno?

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

**Duration**: 18424ms

---

### B07-028 — `modify`
**Description**: Cliente vuole rimuovere una nota già registrata

**Reason**: expected tool call 'modifica_prenotazione' with args {"nome":"Grasso"} not found. Actual: [{"name":"controlla_disponibilita","args":{"data":"2026-08-07","ora":"21:00","persone":4}},{"name":"crea_prenotazione","args":{"nome":"Grasso","data":"2026-08-07","ora":"21:00","persone":4,"note":""}}]

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per venerdì prossimo alle nove di sera, quattro persone, a nome Grasso. Se possibile tavolo esterno

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Non importa più del tavolo esterno, va bene qualsiasi

**[AI reply 2]**: Perfetto, confermo: Grasso, venerdì prossimo alle 21:00, 4 persone. Vuole procedere così, con tavolo esterno segnato nella prenotazione?

**[User turn 3]**: Sì confermo

**[AI reply 3]**: Ok, controllo la disponibilità per quel momento.

**[AI reply 4]**: Prenotazione confermata: Grasso, venerdì alle 21:00, per 4 persone. A presto!

**[AI reply 5]**: Perfetto, confermato: Grasso, venerdì alle 21:00, 4 persone. A presto!

**Tool calls made** (2):
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
      "nome": "Grasso",
      "data": "2026-08-07",
      "ora": "21:00",
      "persone": 4,
      "note": ""
    }
  }
]
```

**Duration**: 20182ms

---

