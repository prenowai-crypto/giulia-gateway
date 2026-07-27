# Batch B-01 (tests 1-30)
Run: 2026-07-27T17:56:03.522Z | Model: gpt-realtime-2.1-mini | Total: 30 | Passed: 17 (57%) | Failed: 13

## ✅ Passed (17)

- **B04-001** `availability-edge`: Lunedì chiuso — cliente rifiutato (2855ms, 0 tool calls)
- **B04-002** `availability-edge`: Lunedì chiuso — cliente insiste, modello mantiene rifiuto (3652ms, 0 tool calls)
- **B04-003** `availability-edge`: Lunedì chiuso — cliente accetta spostare a martedì (18151ms, 2 tool calls)
- **B04-004** `availability-edge`: Lunedì chiuso — cliente accetta spostare a domenica (19988ms, 2 tool calls)
- **B04-005** `availability-edge`: Alle 15:30 — dopo chiusura pranzo (14:30) (2808ms, 0 tool calls)
- **B04-006** `availability-edge`: Alle 16:00 — gap tra pranzo e cena, chiuso (2492ms, 0 tool calls)
- **B04-007** `availability-edge`: Alle 11:00 — prima apertura pranzo (12:00) (2947ms, 0 tool calls)
- **B04-008** `availability-edge`: Alle 20:00 — prima apertura cena (21:00 config reale) (2477ms, 0 tool calls)
- **B04-009** `availability-edge`: Alle 20:30 — 30 minuti prima cena, cliente accetta 21:00 (18754ms, 2 tool calls)
- **B04-011** `availability-edge`: Dopo 22:30 — cliente accetta anticipare a 22:00 (19319ms, 2 tool calls)
- **B04-016** `availability-edge`: 10 persone — al limite GROUP_THRESHOLD, richiede conferma ristoratore (2720ms, 0 tool calls)
- **B04-017** `availability-edge`: 15 persone — large group, richiede conferma esplicita (2531ms, 0 tool calls)
- **B04-018** `availability-edge`: 50 persone — soglia evento, dovrebbe richiedere contatto diretto/email (3208ms, 0 tool calls)
- **B04-019** `availability-edge`: 8 persone — limite superiore MAX_PEOPLE, deve passare come normale (18147ms, 2 tool calls)
- **B04-020** `availability-edge`: 1 sola persona — deve funzionare normalmente (16391ms, 2 tool calls)
- **B04-028** `availability-edge`: Orario borderline — esattamente 22:30 (last booking) (16076ms, 2 tool calls)
- **B04-030** `availability-edge`: OVERBOOKING sabato 21:00 pieno, cliente accetta domenica [SEED: 30 pax sabato prossimo 21:00] (18957ms, 2 tool calls)

## ❌ Failed (13)

### B04-010 — `availability-edge`
**Description**: Alle 23:00 — dopo last booking (22:30)

**Reason**: last reply not in 'it': mi dispiace, l’orario 23:00 non è disponibile. l’ultimo ingresso per cena è alle 22:30 — vuole prenotare alle 22:30?

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per sabato prossimo alle 23, 2 persone, a nome Francesco Lombardi

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[AI reply 2]**: Mi dispiace, l’orario 23:00 non è disponibile. L’ultimo ingresso per cena è alle 22:30 — vuole prenotare alle 22:30?

**Tool calls made** (0):
```json
[]
```

**Duration**: 3043ms

---

### B04-012 — `availability-edge`
**Description**: Data passata — 'ieri sera'

**Reason**: last reply not in 'it': mi dispiace, non posso prenotare per una data passata. vuole prenotare per un giorno futuro, per esempio domani o un’altra data?

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per ieri sera alle 21, 2 persone, a nome Laura Bianchi

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[AI reply 2]**: Mi dispiace, non posso prenotare per una data passata. Vuole prenotare per un giorno futuro, per esempio domani o un’altra data?

**Tool calls made** (0):
```json
[]
```

**Duration**: 1512ms

---

### B04-013 — `availability-edge`
**Description**: Data passata specifica poi correzione a futura

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":3,"nome":"Alessandro Ferri"} not found. Actual: []

**Full transcript**:

**[User turn 1]**: Vorrei prenotare per il 10 luglio alle 21, 3 persone, a nome Alessandro Ferri

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Ah scusi intendevo 10 agosto

**[AI reply 2]**: Mi spiace, il 10 luglio è una data già passata rispetto ad oggi. Vuole prenotare per un giorno futuro?

**[AI reply 3]**: Non possiamo prenotare per il 10 agosto: è lunedì e siamo chiusi. Vuole provare martedì 11 o un altro giorno tra martedì e domenica?

**Tool calls made** (0):
```json
[]
```

**Duration**: 3402ms

---

### B04-014 — `availability-edge`
**Description**: Prenotazione stasera (last minute) — deve accettare se in orario

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":2,"nome":"Beatrice Testa"} not found. Actual: [{"name":"controlla_disponibilita","args":{"data":"2026-07-27","ora":"22:00","persone":2}}] | reply must contain 'Testa' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Un attimo, controllo la disponibilità per la cena stasera. Non possiamo prenotare stasera alle 22:00 perché oggi è lune

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per stasera alle 22, 2 persone, a nome Beatrice Testa

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[AI reply 2]**: Un attimo, controllo la disponibilità per la cena stasera.

**[AI reply 3]**: Non possiamo prenotare stasera alle 22:00 perché oggi è lunedì e siamo chiusi.

Vuole provare un altro giorno tra martedì e domenica? Posso verificare un orario in pranzo o cena.

**Tool calls made** (1):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-07-27",
      "ora": "22:00",
      "persone": 2
    }
  }
]
```

**Duration**: 6720ms

---

### B04-015 — `availability-edge`
**Description**: 9 persone — sopra MAX_PEOPLE_PER_BOOKING (8), deve segnalare

**Reason**: reply must contain '8' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Non posso creare una prenotazione per 

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per sabato prossimo alle 21, 9 persone, a nome Federico Rossi

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[AI reply 2]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Non posso creare una prenotazione per 9 persone in una singola prenotazione: serve la conferma del proprietario. Preferisce che la trasferisca al ristorante o che prenda nota e la faccia richiamare?

**Tool calls made** (0):
```json
[]
```

**Duration**: 2654ms

---

### B04-021 — `availability-edge`
**Description**: 'ora di pranzo' — deve dedurre 12:00 o 13:30

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":2,"nome":"Simone De Luca"} not found. Actual: [] | reply must contain 'De Luca' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Perfetto, Simone. Per sabato prossimo a pranzo, a che ora vuole prenotare, tra le 12:00 e le 14:30? Ok, perfetto! Ti pr

**Full transcript**:

**[User turn 1]**: Buongiorno, vorrei prenotare per sabato prossimo all'ora di pranzo, 2 persone, a nome Simone De Luca

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Sì va bene

**[AI reply 2]**: Perfetto, Simone. Per sabato prossimo a pranzo, a che ora vuole prenotare, tra le 12:00 e le 14:30?

**[AI reply 3]**: Ok, perfetto! Ti propongo 12:00, va bene per la prenotazione?

**Tool calls made** (0):
```json
[]
```

**Duration**: 4142ms

---

### B04-022 — `availability-edge`
**Description**: 'per cena' — deve dedurre 21:00

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":2,"nome":"Marta Fabbri"} not found. Actual: [] | reply must contain '21' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per sabato prossimo per cena, 2 persone, a nome Marta Fabbri

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Sì

**Tool calls made** (0):
```json
[]
```

**Duration**: 1302ms

---

### B04-023 — `availability-edge`
**Description**: 'presto' — ambiguo, modello deve chiedere chiarimento

**Reason**: reply must contain 'ora' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**Full transcript**:

**[User turn 1]**: Buongiorno, vorrei prenotare per sabato prossimo presto, 2 persone, a nome Fabio Pellegrini

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**Tool calls made** (0):
```json
[]
```

**Duration**: 958ms

---

### B04-024 — `availability-edge`
**Description**: 'tarda serata' — deve proporre ultimo slot (22:30)

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":3,"nome":"Ilaria Marchetti","ora":"22:30"} not found. Actual: [] | reply must contain '22:30' — got:  | last reply not in 'it': 

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per sabato prossimo in tarda serata, 3 persone, a nome Ilaria Marchetti

**[User turn 2]**: Va bene alle 22:30

**Tool calls made** (0):
```json
[]
```

**Duration**: 667ms

---

### B04-025 — `availability-edge`
**Description**: 'quando aprite' — cliente chiede orario apertura, poi prenota

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":2,"nome":"Camilla Vitale","ora":"12:00"} not found. Actual: [] | reply must contain 'Vitale' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**Full transcript**:

**[User turn 1]**: Buongiorno, a che ora aprite per pranzo? Vorrei prenotare per sabato prossimo per 2 persone a nome Camilla Vitale

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Alle 12 allora, confermo

**Tool calls made** (0):
```json
[]
```

**Duration**: 1114ms

---

### B04-026 — `availability-edge`
**Description**: Ferragosto (15 agosto) — festivo, deve accettare

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":4,"nome":"Nicola Basile"} not found. Actual: [] | reply must contain 'Basile' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**Full transcript**:

**[User turn 1]**: Buongiorno, vorrei prenotare per il 15 agosto alle 21, 4 persone, a nome Nicola Basile

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Sì confermo

**Tool calls made** (0):
```json
[]
```

**Duration**: 1158ms

---

### B04-027 — `availability-edge`
**Description**: Data lontana (dicembre) — deve accettare senza problemi

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":6,"nome":"Emanuele Costa"} not found. Actual: [] | reply must contain 'dicembre' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**Full transcript**:

**[User turn 1]**: Buongiorno, vorrei prenotare per il 20 dicembre alle 21:30, 6 persone, a nome Emanuele Costa

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Sì grazie

**Tool calls made** (0):
```json
[]
```

**Duration**: 1340ms

---

### B04-029 — `availability-edge`
**Description**: OVERBOOKING sabato 21:00 pieno, cliente accetta 22:30 [SEED: 30 pax sabato prossimo 21:00]

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":4,"nome":"Matteo Fumagalli","ora":"22:30"} not found. Actual: [{"name":"controlla_disponibilita","args":{"data":"2026-08-01","ora":"21:00","persone":4}},{"name":"crea_prenotazione","args":{"nome":"Matteo Fumagalli","data":"2026-08-01","ora":"21:00","persone":4,"note":"Prenotazione standard"}},{"name":"trova_prenotazione","args":{"nome":"Matteo Fumagalli","data":"2026-08-01"}},{"name":"modifica_prenotazione","args":{"nome":"Matteo Fumagalli","data":"2026-08-01","ora":"22:30"}}]

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per sabato prossimo alle 21, 4 persone, a nome Matteo Fumagalli

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Va bene alle 22:30 allora

**[AI reply 2]**: Un momento, controllo la disponibilità per sabato prossimo alle 21:00.

**[AI reply 3]**: Perfetto, procedo con la prenotazione e la registro con i dati indicati.

**[AI reply 4]**: Prenotazione confermata: Matteo Fumagalli, sabato prossimo alle 21:00, per 4 persone. A presto!

**[AI reply 5]**: Un momento, controllo la prenotazione per verificare e aggiornare l’orario proposto.

**[AI reply 6]**: Perfetto, aggiorno l’orario alla nuova richiesta.

**[AI reply 7]**: Fatto! La prenotazione è confermata per Matteo Fumagalli, sabato prossimo alle 22:30, per 4 persone.

**Tool calls made** (4):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-08-01",
      "ora": "21:00",
      "persone": 4
    }
  },
  {
    "name": "crea_prenotazione",
    "args": {
      "nome": "Matteo Fumagalli",
      "data": "2026-08-01",
      "ora": "21:00",
      "persone": 4,
      "note": "Prenotazione standard"
    }
  },
  {
    "name": "trova_prenotazione",
    "args": {
      "nome": "Matteo Fumagalli",
      "data": "2026-08-01"
    }
  },
  {
    "name": "modifica_prenotazione",
    "args": {
      "nome": "Matteo Fumagalli",
      "data": "2026-08-01",
      "ora": "22:30"
    }
  }
]
```

**Duration**: 30018ms

---

