# Batch B-01 (tests 1-30)
Run: 2026-07-27T12:05:15.238Z | Model: gpt-realtime-2.1-mini | Total: 30 | Passed: 14 (47%) | Failed: 16

## ✅ Passed (14)

- **B04-001** `availability-edge`: Lunedì chiuso — cliente rifiutato (2825ms, 0 tool calls)
- **B04-002** `availability-edge`: Lunedì chiuso — cliente insiste, modello mantiene rifiuto (2990ms, 0 tool calls)
- **B04-003** `availability-edge`: Lunedì chiuso — cliente accetta spostare a martedì (20180ms, 3 tool calls)
- **B04-007** `availability-edge`: Alle 11:00 — prima apertura pranzo (12:00) (3194ms, 0 tool calls)
- **B04-008** `availability-edge`: Alle 20:00 — prima apertura cena (21:00 config reale) (5641ms, 0 tool calls)
- **B04-009** `availability-edge`: Alle 20:30 — 30 minuti prima cena, cliente accetta 21:00 (20177ms, 2 tool calls)
- **B04-010** `availability-edge`: Alle 23:00 — dopo last booking (22:30) (2679ms, 0 tool calls)
- **B04-011** `availability-edge`: Dopo 22:30 — cliente accetta anticipare a 22:00 (17833ms, 2 tool calls)
- **B04-017** `availability-edge`: 15 persone — large group, richiede conferma esplicita (2435ms, 0 tool calls)
- **B04-018** `availability-edge`: 50 persone — soglia evento, dovrebbe richiedere contatto diretto/email (2983ms, 0 tool calls)
- **B04-020** `availability-edge`: 1 sola persona — deve funzionare normalmente (18273ms, 2 tool calls)
- **B04-021** `availability-edge`: 'ora di pranzo' — deve dedurre 12:00 o 13:30 (14985ms, 2 tool calls)
- **B04-022** `availability-edge`: 'per cena' — deve dedurre 21:00 (18297ms, 2 tool calls)
- **B04-030** `availability-edge`: OVERBOOKING sabato 21:00 pieno, cliente accetta domenica [SEED: 30 pax sabato prossimo 21:00] (24047ms, 3 tool calls)

## ❌ Failed (16)

### B04-004 — `availability-edge`
**Description**: Lunedì chiuso — cliente accetta spostare a domenica

**Reason**: last reply not in 'it': booking confirmed for sofia marino, sunday august 2 at 21:30, 2 people. see you then!

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per lunedì alle 21:30, 2 persone, a nome Sofia Marino

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Domenica prossima stessa ora allora

**[AI reply 2]**: Mi dispiace, lunedì siamo chiusi. Vuole provare martedì o un altro giorno da martedì a domenica, sempre alle 21:30?

**[AI reply 3]**: Perfetto, faccio un controllo di disponibilità per quella data e orario.

**[AI reply 4]**: Booking confirmed for Sofia Marino, Sunday August 2 at 21:30, 2 people. See you then!

**Tool calls made** (2):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-08-02",
      "ora": "21:30",
      "persone": 2
    }
  },
  {
    "name": "crea_prenotazione",
    "args": {
      "nome": "Sofia Marino",
      "data": "2026-08-02",
      "ora": "21:30",
      "persone": 2,
      "note": "Prenotazione per 2 persone, domenica prossima alle 21:30."
    }
  }
]
```

**Duration**: 20823ms

---

### B04-005 — `availability-edge`
**Description**: Alle 15:30 — dopo chiusura pranzo (14:30)

**Reason**: last reply not in 'it': mi dispiace, alle 15:30 non siamo in servizio. vuole prenotare per pranzo alle 14:30, oppure per cena alle 21:00?

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per venerdì prossimo alle 15:30, 2 persone, a nome Paolo Verdi

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[AI reply 2]**: Mi dispiace, alle 15:30 non siamo in servizio. Vuole prenotare per pranzo alle 14:30, oppure per cena alle 21:00?

**Tool calls made** (0):
```json
[]
```

**Duration**: 2028ms

---

### B04-006 — `availability-edge`
**Description**: Alle 16:00 — gap tra pranzo e cena, chiuso

**Reason**: last reply not in 'it': chiuso… o meglio, ora non è possibile prenotare: 16:00 è fuori orario di servizio. vuole provare per pranzo alle 13:00 o per cena alle 21:00, sempre l

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per venerdì prossimo alle 16, 3 persone, a nome Chiara Neri

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[AI reply 2]**: Chiuso… o meglio, ora non è possibile prenotare: 16:00 è fuori orario di servizio. Vuole provare per pranzo alle 13:00 o per cena alle 21:00, sempre lo stesso venerdì prossimo?

**Tool calls made** (0):
```json
[]
```

**Duration**: 2387ms

---

### B04-012 — `availability-edge`
**Description**: Data passata — 'ieri sera'

**Reason**: last reply not in 'it': non posso prenotare per una data passata. vuole prenotare per un giorno futuro?

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per ieri sera alle 21, 2 persone, a nome Laura Bianchi

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[AI reply 2]**: Non posso prenotare per una data passata. Vuole prenotare per un giorno futuro?

**Tool calls made** (0):
```json
[]
```

**Duration**: 1738ms

---

### B04-013 — `availability-edge`
**Description**: Data passata specifica poi correzione a futura

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":3,"nome":"Alessandro Ferri"} not found. Actual: []

**Full transcript**:

**[User turn 1]**: Vorrei prenotare per il 10 luglio alle 21, 3 persone, a nome Alessandro Ferri

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Ah scusi intendevo 10 agosto

**[AI reply 2]**: Non posso prenotare per una data passata. Vuole prenotare per un giorno futuro?

**[AI reply 3]**: Purtroppo lunedì siamo chiusi. Vuole provare il 9 o il 11 agosto, o un altro giorno da martedì a domenica?

**Tool calls made** (0):
```json
[]
```

**Duration**: 2905ms

---

### B04-014 — `availability-edge`
**Description**: Prenotazione stasera (last minute) — deve accettare se in orario

**Reason**: expected tool call 'controlla_disponibilita' with args {"persone":2} not found. Actual: [] | expected tool call 'crea_prenotazione' with args {"persone":2,"nome":"Beatrice Testa"} not found. Actual: [] | reply must contain 'Testa' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Mi dispiace, stasera non possiamo prenotare perché siamo chiusi. Vuole provare domani o un altro giorno tra martedì e d

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per stasera alle 22, 2 persone, a nome Beatrice Testa

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[AI reply 2]**: Mi dispiace, stasera non possiamo prenotare perché siamo chiusi. Vuole provare domani o un altro giorno tra martedì e domenica?

**Tool calls made** (0):
```json
[]
```

**Duration**: 1426ms

---

### B04-015 — `availability-edge`
**Description**: 9 persone — sopra MAX_PEOPLE_PER_BOOKING (8), deve segnalare

**Reason**: forbidden tool call 'crea_prenotazione' was made

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per sabato prossimo alle 21, 9 persone, a nome Federico Rossi

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[AI reply 2]**: Un attimo, controllo la disponibilità per l’orario richiesto.

**[AI reply 3]**: Perfetto, procede con la prenotazione.

**[AI reply 4]**: Prenotato per Federico Rossi, sabato 2026-08-01 alle 21:00, per 9 persone. A presto!

**Tool calls made** (2):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-08-01",
      "ora": "21:00",
      "persone": 9
    }
  },
  {
    "name": "crea_prenotazione",
    "args": {
      "nome": "Federico Rossi",
      "data": "2026-08-01",
      "ora": "21:00",
      "persone": 9,
      "note": "Prenotazione ricevuta tramite assistente vocale."
    }
  }
]
```

**Duration**: 17309ms

---

### B04-016 — `availability-edge`
**Description**: 10 persone — al limite GROUP_THRESHOLD, richiede conferma ristoratore

**Reason**: reply must contain 'conferma' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Un momento, controllo la disponibilità per quel periodo. Booked for Michele Barbieri, Saturday at 21:00, for 10 people. | last reply not in 'it': booked for michele barbieri, saturday at 21:00, for 10 people. see you then.

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per sabato prossimo alle 21, 10 persone, a nome Michele Barbieri

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[AI reply 2]**: Un momento, controllo la disponibilità per quel periodo.

**[AI reply 3]**: Booked for Michele Barbieri, Saturday at 21:00, for 10 people. See you then.

**Tool calls made** (2):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-08-01",
      "ora": "21:00",
      "persone": 10
    }
  },
  {
    "name": "crea_prenotazione",
    "args": {
      "nome": "Michele Barbieri",
      "data": "2026-08-01",
      "ora": "21:00",
      "persone": 10,
      "note": "Reservation request: 10 people for dinner at 21:00."
    }
  }
]
```

**Duration**: 15196ms

---

### B04-019 — `availability-edge`
**Description**: 8 persone — limite superiore MAX_PEOPLE, deve passare come normale

**Reason**: expected tool call 'controlla_disponibilita' with args {"persone":8} not found. Actual: [] | expected tool call 'crea_prenotazione' with args {"persone":8,"nome":"Stefano Galli"} not found. Actual: [] | reply must contain 'Galli' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per sabato prossimo alle 21, 8 persone, a nome Stefano Galli

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Sì confermo

**Tool calls made** (0):
```json
[]
```

**Duration**: 1523ms

---

### B04-023 — `availability-edge`
**Description**: 'presto' — ambiguo, modello deve chiedere chiarimento

**Reason**: reply must contain 'ora' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Certo. Presto a pranzo o a cena?

**Full transcript**:

**[User turn 1]**: Buongiorno, vorrei prenotare per sabato prossimo presto, 2 persone, a nome Fabio Pellegrini

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[AI reply 2]**: Certo. Presto a pranzo o a cena?

**Tool calls made** (0):
```json
[]
```

**Duration**: 2518ms

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

**Duration**: 1157ms

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

**Duration**: 1158ms

---

### B04-026 — `availability-edge`
**Description**: Ferragosto (15 agosto) — festivo, deve accettare

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":4,"nome":"Nicola Basile"} not found. Actual: [] | reply must contain 'Basile' — got:  | last reply not in 'it': 

**Full transcript**:

**[User turn 1]**: Buongiorno, vorrei prenotare per il 15 agosto alle 21, 4 persone, a nome Nicola Basile

**[User turn 2]**: Sì confermo

**Tool calls made** (0):
```json
[]
```

**Duration**: 868ms

---

### B04-027 — `availability-edge`
**Description**: Data lontana (dicembre) — deve accettare senza problemi

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":6,"nome":"Emanuele Costa"} not found. Actual: [] | reply must contain 'dicembre' — got:  | last reply not in 'it': 

**Full transcript**:

**[User turn 1]**: Buongiorno, vorrei prenotare per il 20 dicembre alle 21:30, 6 persone, a nome Emanuele Costa

**[User turn 2]**: Sì grazie

**Tool calls made** (0):
```json
[]
```

**Duration**: 737ms

---

### B04-028 — `availability-edge`
**Description**: Orario borderline — esattamente 22:30 (last booking)

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":2,"nome":"Silvia Conte","ora":"22:30"} not found. Actual: [] | reply must contain '22:30' — got:  | last reply not in 'it': 

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per sabato prossimo alle 22:30, 2 persone, a nome Silvia Conte

**[User turn 2]**: Sì

**Tool calls made** (0):
```json
[]
```

**Duration**: 677ms

---

### B04-029 — `availability-edge`
**Description**: OVERBOOKING sabato 21:00 pieno, cliente accetta 22:30 [SEED: 30 pax sabato prossimo 21:00]

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":4,"nome":"Matteo Fumagalli","ora":"22:30"} not found. Actual: [{"name":"controlla_disponibilita","args":{"data":"2026-08-01","ora":"21:00","persone":4}},{"name":"crea_prenotazione","args":{"nome":"Matteo Fumagalli","data":"2026-08-01","ora":"21:00","persone":4,"note":"Prenotazione standard"}},{"name":"trova_prenotazione","args":{"nome":"Matteo Fumagalli","data":"2026-08-01"}},{"name":"modifica_prenotazione","args":{"data":"2026-08-01","ora":"22:30"}}]

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per sabato prossimo alle 21, 4 persone, a nome Matteo Fumagalli

**[AI reply 1]**: Un attimo, controlo la disponibilità per quella data e ora.

**[User turn 2]**: Va bene alle 22:30 allora

**[AI reply 2]**: Perfetto, allora creo la prenotazione per lei.

**[AI reply 3]**: Prenotazione confermata per Matteo Fumagalli, sabato 1 agosto alle 21, 4 persone.

**[AI reply 4]**: Un attimo, localizzo la prenotazione e poi la aggiorno all’orario richiesto.

**[AI reply 5]**: Aggiornato: sempre sabato 1 agosto, ora 22:30, 4 persone per Matteo Fumagalli.

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
      "data": "2026-08-01",
      "ora": "22:30"
    }
  }
]
```

**Duration**: 30096ms

---

