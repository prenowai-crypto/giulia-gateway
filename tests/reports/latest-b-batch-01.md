# Batch B-01 (tests 1-30)
Run: 2026-07-27T11:43:01.644Z | Model: gpt-realtime-2.1-mini | Total: 30 | Passed: 17 (57%) | Failed: 13

## ✅ Passed (17)

- **B04-001** `availability-edge`: Lunedì chiuso — cliente rifiutato (2061ms, 0 tool calls)
- **B04-002** `availability-edge`: Lunedì chiuso — cliente insiste, modello mantiene rifiuto (4122ms, 0 tool calls)
- **B04-003** `availability-edge`: Lunedì chiuso — cliente accetta spostare a martedì (18260ms, 2 tool calls)
- **B04-004** `availability-edge`: Lunedì chiuso — cliente accetta spostare a domenica (16543ms, 2 tool calls)
- **B04-007** `availability-edge`: Alle 11:00 — prima apertura pranzo (12:00) (2243ms, 0 tool calls)
- **B04-011** `availability-edge`: Dopo 22:30 — cliente accetta anticipare a 22:00 (19206ms, 2 tool calls)
- **B04-012** `availability-edge`: Data passata — 'ieri sera' (2076ms, 0 tool calls)
- **B04-015** `availability-edge`: 9 persone — sopra MAX_PEOPLE_PER_BOOKING (8), deve segnalare (3865ms, 0 tool calls)
- **B04-016** `availability-edge`: 10 persone — al limite GROUP_THRESHOLD, richiede conferma ristoratore (1925ms, 0 tool calls)
- **B04-018** `availability-edge`: 50 persone — soglia evento, dovrebbe richiedere contatto diretto/email (7777ms, 1 tool calls)
- **B04-022** `availability-edge`: 'per cena' — deve dedurre 21:00 (16851ms, 2 tool calls)
- **B04-024** `availability-edge`: 'tarda serata' — deve proporre ultimo slot (22:30) (16669ms, 2 tool calls)
- **B04-025** `availability-edge`: 'quando aprite' — cliente chiede orario apertura, poi prenota (22075ms, 2 tool calls)
- **B04-026** `availability-edge`: Ferragosto (15 agosto) — festivo, deve accettare (15601ms, 2 tool calls)
- **B04-027** `availability-edge`: Data lontana (dicembre) — deve accettare senza problemi (15721ms, 2 tool calls)
- **B04-029** `availability-edge`: OVERBOOKING sabato 21:00 pieno, cliente accetta 22:30 [SEED: 30 pax sabato prossimo 21:00] (19381ms, 2 tool calls)
- **B04-030** `availability-edge`: OVERBOOKING sabato 21:00 pieno, cliente accetta domenica [SEED: 30 pax sabato prossimo 21:00] (18386ms, 2 tool calls)

## ❌ Failed (13)

### B04-005 — `availability-edge`
**Description**: Alle 15:30 — dopo chiusura pranzo (14:30)

**Reason**: last reply not in 'it': mi dispiace, alle 15:30 non possiamo accogliere prenotazioni. per quel venerdì puoi scegliere invece il pranzo alle 13:00 o la cena alle 21:00.

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per venerdì prossimo alle 15:30, 2 persone, a nome Paolo Verdi

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[AI reply 2]**: Mi dispiace, alle 15:30 non possiamo accogliere prenotazioni. Per quel venerdì puoi scegliere invece il pranzo alle 13:00 o la cena alle 21:00.

**Tool calls made** (0):
```json
[]
```

**Duration**: 2952ms

---

### B04-006 — `availability-edge`
**Description**: Alle 16:00 — gap tra pranzo e cena, chiuso

**Reason**: last reply not in 'it': purtroppo venerdì prossimo alle 16 è fuori orario di servizio. il pranzo termina alle 14:30 e la cena inizia alle 21:00; preferisce una di quelle fasc

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per venerdì prossimo alle 16, 3 persone, a nome Chiara Neri

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[AI reply 2]**: Purtroppo venerdì prossimo alle 16 è fuori orario di servizio. Il pranzo termina alle 14:30 e la cena inizia alle 21:00; preferisce una di quelle fasce?

**Tool calls made** (0):
```json
[]
```

**Duration**: 2575ms

---

### B04-008 — `availability-edge`
**Description**: Alle 20:00 — prima apertura cena (21:00 config reale)

**Reason**: last reply not in 'it': buonasera! l’orario alle 20 non è disponibile per la cena, iniziamo alle 21:00.
vuole prenotare alle 21:00 o preferisce il pranzo tra le 12:00 e le 14

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per sabato prossimo alle 20, 4 persone, a nome Elena Ricci

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[AI reply 2]**: Buonasera! L’orario alle 20 non è disponibile per la cena, iniziamo alle 21:00.
Vuole prenotare alle 21:00 o preferisce il pranzo tra le 12:00 e le 14:30?

**Tool calls made** (0):
```json
[]
```

**Duration**: 2171ms

---

### B04-009 — `availability-edge`
**Description**: Alle 20:30 — 30 minuti prima cena, cliente accetta 21:00

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":2,"nome":"Andrea Moretti","ora":"21:00"} not found. Actual: [{"name":"controlla_disponibilita","args":{"data":"2026-08-01","ora":"20:30","persone":2}},{"name":"crea_prenotazione","args":{"nome":"Andrea Moretti","data":"2026-08-01","ora":"20:30","persone":2,"note":""}},{"name":"trova_prenotazione","args":{"nome":"Andrea Moretti","data":"2026-08-01"}},{"name":"modifica_prenotazione","args":{"nome":"Andrea Moretti","ora":"21:00"}}]

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per sabato prossimo alle 20:30, 2 persone, a nome Andrea Moretti

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Va bene allora alle 21

**[AI reply 2]**: Un momento, controllo la disponibilità per quella data e ora.

**[AI reply 3]**: Perfetto, ora registro la prenotazione.

**[AI reply 4]**: Prenotazione confermata per Andrea Moretti, sabato 1 agosto alle 20:30, per 2 persone. A presto!

**[AI reply 5]**: Un momento, recupero la prenotazione per poi aggiornare l’orario.

**[AI reply 6]**: Ok, aggiorno solo l’orario della prenotazione.

**[AI reply 7]**: Mi serve verificare una cosa: per cambiare l’orario, ho già la prenotazione, ma il sistema chiede la data o l’ora completa. Vuole confermare che la prenotazione è sabato 1 agosto e passare a 21:00?

**Tool calls made** (4):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-08-01",
      "ora": "20:30",
      "persone": 2
    }
  },
  {
    "name": "crea_prenotazione",
    "args": {
      "nome": "Andrea Moretti",
      "data": "2026-08-01",
      "ora": "20:30",
      "persone": 2,
      "note": ""
    }
  },
  {
    "name": "trova_prenotazione",
    "args": {
      "nome": "Andrea Moretti",
      "data": "2026-08-01"
    }
  },
  {
    "name": "modifica_prenotazione",
    "args": {
      "nome": "Andrea Moretti",
      "ora": "21:00"
    }
  }
]
```

**Duration**: 20645ms

---

### B04-010 — `availability-edge`
**Description**: Alle 23:00 — dopo last booking (22:30)

**Reason**: last reply not in 'it': mi dispiace, a quell’ora non possiamo prenotare perché la cena termina alle 22:30. vuole provare alle 22:30 o preferisce un altro orario tra 21:00 e 2

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per sabato prossimo alle 23, 2 persone, a nome Francesco Lombardi

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[AI reply 2]**: Mi dispiace, a quell’ora non possiamo prenotare perché la cena termina alle 22:30. Vuole provare alle 22:30 o preferisce un altro orario tra 21:00 e 22:30?

**Tool calls made** (0):
```json
[]
```

**Duration**: 3441ms

---

### B04-013 — `availability-edge`
**Description**: Data passata specifica poi correzione a futura

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":3,"nome":"Alessandro Ferri"} not found. Actual: [{"name":"controlla_disponibilita","args":{"data":"2026-08-10","ora":"21:00","persone":3}}]

**Full transcript**:

**[User turn 1]**: Vorrei prenotare per il 10 luglio alle 21, 3 persone, a nome Alessandro Ferri

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Ah scusi intendevo 10 agosto

**[AI reply 2]**: Mi dispiace, il 10 luglio è una data passata. Non posso prenotare per una data già trascorsa. Vuole indicarmi una data futura?

**[AI reply 3]**: Ok, un attimo che controllo la disponibilità per quella data e ora.

**[AI reply 4]**: Mi dispiace, il 10 agosto è lunedì e siamo chiusi. Vuole prenotare per un altro giorno tra martedì e domenica?

**Tool calls made** (1):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-08-10",
      "ora": "21:00",
      "persone": 3
    }
  }
]
```

**Duration**: 6580ms

---

### B04-014 — `availability-edge`
**Description**: Prenotazione stasera (last minute) — deve accettare se in orario

**Reason**: expected tool call 'controlla_disponibilita' with args {"persone":2} not found. Actual: [] | expected tool call 'crea_prenotazione' with args {"persone":2,"nome":"Beatrice Testa"} not found. Actual: [] | reply must contain 'Testa' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Perfetto, ma oggi siamo chiusi, quindi non posso aprire la prenotazione per stasera.

Vuole provare martedì o un altro 

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per stasera alle 22, 2 persone, a nome Beatrice Testa

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[AI reply 2]**: Perfetto, ma oggi siamo chiusi, quindi non posso aprire la prenotazione per stasera.

Vuole provare martedì o un altro giorno tra martedì e domenica, sempre alle 22:00 con 2 persone?

**Tool calls made** (0):
```json
[]
```

**Duration**: 2202ms

---

### B04-017 — `availability-edge`
**Description**: 15 persone — large group, richiede conferma esplicita

**Reason**: reply must contain 'conferma' — got:  | last reply not in 'it': 

**Full transcript**:

**[User turn 1]**: Buonasera, vorremmo prenotare per sabato prossimo alle 21, siamo in 15, a nome Giulia Ferrari

**Tool calls made** (0):
```json
[]
```

**Duration**: 656ms

---

### B04-019 — `availability-edge`
**Description**: 8 persone — limite superiore MAX_PEOPLE, deve passare come normale

**Reason**: expected tool call 'controlla_disponibilita' with args {"persone":8} not found. Actual: [] | expected tool call 'crea_prenotazione' with args {"persone":8,"nome":"Stefano Galli"} not found. Actual: [] | reply must contain 'Galli' — got:  | last reply not in 'it': 

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per sabato prossimo alle 21, 8 persone, a nome Stefano Galli

**[User turn 2]**: Sì confermo

**Tool calls made** (0):
```json
[]
```

**Duration**: 671ms

---

### B04-020 — `availability-edge`
**Description**: 1 sola persona — deve funzionare normalmente

**Reason**: expected tool call 'controlla_disponibilita' with args {"persone":1} not found. Actual: [] | expected tool call 'crea_prenotazione' with args {"persone":1,"nome":"Valentina Colombo"} not found. Actual: [] | reply must contain 'Colombo' — got:  | last reply not in 'it': 

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per sabato prossimo alle 21 per una persona, a nome Valentina Colombo

**[User turn 2]**: Sì

**Tool calls made** (0):
```json
[]
```

**Duration**: 688ms

---

### B04-021 — `availability-edge`
**Description**: 'ora di pranzo' — deve dedurre 12:00 o 13:30

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":2,"nome":"Simone De Luca"} not found. Actual: [] | reply must contain 'De Luca' — got:  | last reply not in 'it': 

**Full transcript**:

**[User turn 1]**: Buongiorno, vorrei prenotare per sabato prossimo all'ora di pranzo, 2 persone, a nome Simone De Luca

**[User turn 2]**: Sì va bene

**Tool calls made** (0):
```json
[]
```

**Duration**: 760ms

---

### B04-023 — `availability-edge`
**Description**: 'presto' — ambiguo, modello deve chiedere chiarimento

**Reason**: forbidden tool call 'crea_prenotazione' was made | reply must contain 'ora' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Ok, faccio una verifica di disponibilità per questo sabato a pranzo. Perfetto, adesso registro la prenotazione. Prenota

**Full transcript**:

**[User turn 1]**: Buongiorno, vorrei prenotare per sabato prossimo presto, 2 persone, a nome Fabio Pellegrini

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[AI reply 2]**: Ok, faccio una verifica di disponibilità per questo sabato a pranzo.

**[AI reply 3]**: Perfetto, adesso registro la prenotazione.

**[AI reply 4]**: Prenotazione confermata: Fabio Pellegrini, sabato prossimo alle 12:00, 2 persone. A presto!

**Tool calls made** (2):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-08-01",
      "ora": "12:00",
      "persone": 2
    }
  },
  {
    "name": "crea_prenotazione",
    "args": {
      "nome": "Fabio Pellegrini",
      "data": "2026-08-01",
      "ora": "12:00",
      "persone": 2,
      "note": "Prenotazione per 2 persone"
    }
  }
]
```

**Duration**: 14671ms

---

### B04-028 — `availability-edge`
**Description**: Orario borderline — esattamente 22:30 (last booking)

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":2,"nome":"Silvia Conte","ora":"22:30"} not found. Actual: [] | reply must contain '22:30' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per sabato prossimo alle 22:30, 2 persone, a nome Silvia Conte

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Sì

**[AI reply 2]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**Tool calls made** (0):
```json
[]
```

**Duration**: 1683ms

---

