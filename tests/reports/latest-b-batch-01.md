# Batch B-01 (tests 1-30)
Run: 2026-07-27T12:32:14.873Z | Model: gpt-realtime-2.1-mini | Total: 30 | Passed: 20 (67%) | Failed: 10

## ✅ Passed (20)

- **B04-001** `availability-edge`: Lunedì chiuso — cliente rifiutato (3461ms, 0 tool calls)
- **B04-002** `availability-edge`: Lunedì chiuso — cliente insiste, modello mantiene rifiuto (3693ms, 0 tool calls)
- **B04-003** `availability-edge`: Lunedì chiuso — cliente accetta spostare a martedì (16857ms, 2 tool calls)
- **B04-004** `availability-edge`: Lunedì chiuso — cliente accetta spostare a domenica (16478ms, 2 tool calls)
- **B04-005** `availability-edge`: Alle 15:30 — dopo chiusura pranzo (14:30) (4152ms, 0 tool calls)
- **B04-008** `availability-edge`: Alle 20:00 — prima apertura cena (21:00 config reale) (2677ms, 0 tool calls)
- **B04-010** `availability-edge`: Alle 23:00 — dopo last booking (22:30) (3114ms, 0 tool calls)
- **B04-011** `availability-edge`: Dopo 22:30 — cliente accetta anticipare a 22:00 (27826ms, 5 tool calls)
- **B04-015** `availability-edge`: 9 persone — sopra MAX_PEOPLE_PER_BOOKING (8), deve segnalare (3199ms, 0 tool calls)
- **B04-016** `availability-edge`: 10 persone — al limite GROUP_THRESHOLD, richiede conferma ristoratore (3040ms, 0 tool calls)
- **B04-018** `availability-edge`: 50 persone — soglia evento, dovrebbe richiedere contatto diretto/email (3166ms, 0 tool calls)
- **B04-019** `availability-edge`: 8 persone — limite superiore MAX_PEOPLE, deve passare come normale (16408ms, 2 tool calls)
- **B04-020** `availability-edge`: 1 sola persona — deve funzionare normalmente (23203ms, 2 tool calls)
- **B04-021** `availability-edge`: 'ora di pranzo' — deve dedurre 12:00 o 13:30 (20478ms, 2 tool calls)
- **B04-022** `availability-edge`: 'per cena' — deve dedurre 21:00 (16021ms, 2 tool calls)
- **B04-024** `availability-edge`: 'tarda serata' — deve proporre ultimo slot (22:30) (15858ms, 2 tool calls)
- **B04-026** `availability-edge`: Ferragosto (15 agosto) — festivo, deve accettare (20227ms, 2 tool calls)
- **B04-027** `availability-edge`: Data lontana (dicembre) — deve accettare senza problemi (17588ms, 2 tool calls)
- **B04-028** `availability-edge`: Orario borderline — esattamente 22:30 (last booking) (19218ms, 2 tool calls)
- **B04-030** `availability-edge`: OVERBOOKING sabato 21:00 pieno, cliente accetta domenica [SEED: 30 pax sabato prossimo 21:00] (18285ms, 3 tool calls)

## ❌ Failed (10)

### B04-006 — `availability-edge`
**Description**: Alle 16:00 — gap tra pranzo e cena, chiuso

**Reason**: last reply not in 'it': purtroppo alle 16 non siamo aperti. la cena inizia alle 21:00 e l’ultimo pranzo è 14:30. vuole provare un orario nella fascia tra 12:00 e 14:30, oppur

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per venerdì prossimo alle 16, 3 persone, a nome Chiara Neri

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[AI reply 2]**: Purtroppo alle 16 non siamo aperti. La cena inizia alle 21:00 e l’ultimo pranzo è 14:30. Vuole provare un orario nella fascia tra 12:00 e 14:30, oppure alle 21:00?

**Tool calls made** (0):
```json
[]
```

**Duration**: 2303ms

---

### B04-007 — `availability-edge`
**Description**: Alle 11:00 — prima apertura pranzo (12:00)

**Reason**: last reply not in 'it': mi dispiace, alle 11 non possiamo aprire: il pranzo inizia alle 12:00. preferisce prenotare alle 12:00 oppure per la cena alle 21:00?

**Full transcript**:

**[User turn 1]**: Buongiorno, vorrei prenotare per sabato prossimo alle 11, 2 persone, a nome Giovanni Costa

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[AI reply 2]**: Mi dispiace, alle 11 non possiamo aprire: il pranzo inizia alle 12:00. Preferisce prenotare alle 12:00 oppure per la cena alle 21:00?

**Tool calls made** (0):
```json
[]
```

**Duration**: 2542ms

---

### B04-009 — `availability-edge`
**Description**: Alle 20:30 — 30 minuti prima cena, cliente accetta 21:00

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":2,"nome":"Andrea Moretti","ora":"21:00"} not found. Actual: [{"name":"controlla_disponibilita","args":{"data":"2026-08-01","ora":"20:30","persone":2}},{"name":"crea_prenotazione","args":{"nome":"Andrea Moretti","data":"2026-08-01","ora":"20:30","persone":2,"note":"Prenotazione standard"}},{"name":"trova_prenotazione","args":{"nome":"Andrea Moretti","data":"2026-08-01"}},{"name":"modifica_prenotazione","args":{"nome":"Andrea Moretti","data":"2026-08-01","ora":"21:00","persone":2}}]

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per sabato prossimo alle 20:30, 2 persone, a nome Andrea Moretti

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Va bene allora alle 21

**[AI reply 2]**: Perfetto, adesso controllo la disponibilità per quella data e ora.

**[AI reply 3]**: Perfetto, ora registro la prenotazione.

**[AI reply 4]**: Prenotazione confermata per Andrea Moretti, sabato 1 agosto alle 20:30, 2 persone. A presto!

**[AI reply 5]**: Un attimo, verifico la prenotazione e poi aggiorno l’orario richiesto.

**[AI reply 6]**: Perfetto, ho aggiornato la prenotazione. Confermata: Andrea Moretti, sabato 1 agosto alle 21:00, 2 persone.

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
      "note": "Prenotazione standard"
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
      "data": "2026-08-01",
      "ora": "21:00",
      "persone": 2
    }
  }
]
```

**Duration**: 28131ms

---

### B04-012 — `availability-edge`
**Description**: Data passata — 'ieri sera'

**Reason**: last reply not in 'it': mi dispiace, non posso prenotare per una data passata. vuole prenotare per un giorno futuro?

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per ieri sera alle 21, 2 persone, a nome Laura Bianchi

**[AI reply 1]**: Bonjour, je suis l'assistant vocal automatique de Osteria Test, comment puis-je vous aider ? Je vais vérifier la disponibilité tout de suite.

**[AI reply 2]**: Mi dispiace, non posso prenotare per una data passata. Vuole prenotare per un giorno futuro?

**Tool calls made** (0):
```json
[]
```

**Duration**: 3241ms

---

### B04-013 — `availability-edge`
**Description**: Data passata specifica poi correzione a futura

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":3,"nome":"Alessandro Ferri"} not found. Actual: [{"name":"controlla_disponibilita","args":{"data":"2026-08-10","ora":"21:00","persone":3}}]

**Full transcript**:

**[User turn 1]**: Vorrei prenotare per il 10 luglio alle 21, 3 persone, a nome Alessandro Ferri

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Ah scusi intendevo 10 agosto

**[AI reply 2]**: Non posso prenotare per una data passata. Vuole prenotare per un giorno futuro?

**[AI reply 3]**: Perfetto, un attimo che controllo la disponibilità per quella data e ora.

**[AI reply 4]**: Mi dispiace, il ristorante è chiuso il lunedì, quindi il 10 agosto non è prenotabile. Vuole provare un’altra data, da martedì a domenica, sempre alle 21:00?

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

**Duration**: 6325ms

---

### B04-014 — `availability-edge`
**Description**: Prenotazione stasera (last minute) — deve accettare se in orario

**Reason**: expected tool call 'controlla_disponibilita' with args {"persone":2} not found. Actual: [] | expected tool call 'crea_prenotazione' with args {"persone":2,"nome":"Beatrice Testa"} not found. Actual: [] | reply must contain 'Testa' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Purtroppo oggi, lunedì, siamo chiusi. Vuole provare domani o un altro giorno tra martedì e domenica?

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per stasera alle 22, 2 persone, a nome Beatrice Testa

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[AI reply 2]**: Purtroppo oggi, lunedì, siamo chiusi. Vuole provare domani o un altro giorno tra martedì e domenica?

**Tool calls made** (0):
```json
[]
```

**Duration**: 1729ms

---

### B04-017 — `availability-edge`
**Description**: 15 persone — large group, richiede conferma esplicita

**Reason**: reply must contain 'conferma' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Perfetto, lascio un attimo la parola al sistema per verificare la disponibilità. Ok, ora procedo a creare la prenotazio | last reply not in 'it': booked for giulia ferrari, saturday at 21:00, for 15 people. see you soon!

**Full transcript**:

**[User turn 1]**: Buonasera, vorremmo prenotare per sabato prossimo alle 21, siamo in 15, a nome Giulia Ferrari

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[AI reply 2]**: Perfetto, lascio un attimo la parola al sistema per verificare la disponibilità.

**[AI reply 3]**: Ok, ora procedo a creare la prenotazione.

**[AI reply 4]**: Booked for Giulia Ferrari, Saturday at 21:00, for 15 people. See you soon!

**Tool calls made** (2):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-08-01",
      "ora": "21:00",
      "persone": 15
    }
  },
  {
    "name": "crea_prenotazione",
    "args": {
      "nome": "Giulia Ferrari",
      "data": "2026-08-01",
      "ora": "21:00",
      "persone": 15,
      "note": "Prenotazione per 15 persone."
    }
  }
]
```

**Duration**: 16242ms

---

### B04-023 — `availability-edge`
**Description**: 'presto' — ambiguo, modello deve chiedere chiarimento

**Reason**: reply must contain 'ora' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Perfetto, grazie! Posso chiederle una cosa: “presto” intende presto a pranzo o a cena?

**Full transcript**:

**[User turn 1]**: Buongiorno, vorrei prenotare per sabato prossimo presto, 2 persone, a nome Fabio Pellegrini

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[AI reply 2]**: Perfetto, grazie! Posso chiederle una cosa: “presto” intende presto a pranzo o a cena?

**Tool calls made** (0):
```json
[]
```

**Duration**: 2409ms

---

### B04-025 — `availability-edge`
**Description**: 'quando aprite' — cliente chiede orario apertura, poi prenota

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":2,"nome":"Camilla Vitale","ora":"12:00"} not found. Actual: [{"name":"controlla_disponibilita","args":{"data":"2026-08-01","ora":"13:00","persone":2}},{"name":"crea_prenotazione","args":{"nome":"Camilla Vitale","data":"2026-08-01","ora":"13:00","persone":2,"note":"Pranzo per sabato prossimo"}},{"name":"trova_prenotazione","args":{"nome":"Camilla Vitale","data":"2026-08-01"}}]

**Full transcript**:

**[User turn 1]**: Buongiorno, a che ora aprite per pranzo? Vorrei prenotare per sabato prossimo per 2 persone a nome Camilla Vitale

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Alle 12 allora, confermo

**[AI reply 2]**: Certo, un attimo: cerco la disponibilità per quel sabato a pranzo.

**[AI reply 3]**: Perfetto, ora creo la prenotazione.

**[AI reply 4]**: C'è riuscito! Prenotazione confermata per Camilla Vitale, sabato prossimo alle 13:00, per 2 persone.

**[AI reply 5]**: Perfetto, confermo: Camilla Vitale, sabato prossimo alle 12:00, per 2 persone.  
Puoi confermare così la modifica, per favore?

**Tool calls made** (3):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-08-01",
      "ora": "13:00",
      "persone": 2
    }
  },
  {
    "name": "crea_prenotazione",
    "args": {
      "nome": "Camilla Vitale",
      "data": "2026-08-01",
      "ora": "13:00",
      "persone": 2,
      "note": "Pranzo per sabato prossimo"
    }
  },
  {
    "name": "trova_prenotazione",
    "args": {
      "nome": "Camilla Vitale",
      "data": "2026-08-01"
    }
  }
]
```

**Duration**: 23651ms

---

### B04-029 — `availability-edge`
**Description**: OVERBOOKING sabato 21:00 pieno, cliente accetta 22:30 [SEED: 30 pax sabato prossimo 21:00]

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":4,"nome":"Matteo Fumagalli","ora":"22:30"} not found. Actual: [{"name":"controlla_disponibilita","args":{"data":"2026-08-01","ora":"21:00","persone":4}},{"name":"crea_prenotazione","args":{"nome":"Matteo Fumagalli","data":"2026-08-01","ora":"21:00","persone":4,"note":""}},{"name":"trova_prenotazione","args":{"nome":"Matteo Fumagalli","data":"2026-08-01"}},{"name":"modifica_prenotazione","args":{"nome":"Matteo Fumagalli","data":"2026-08-01","ora":"22:30","persone":4,"note":""}}]

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per sabato prossimo alle 21, 4 persone, a nome Matteo Fumagalli

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Va bene alle 22:30 allora

**[AI reply 2]**: Perfetto, vado a controllare la disponibilità per il tavolo. Un attimo.

**[AI reply 3]**: Perfetto, ora creo la prenotazione con i dati forniti. Un attimo.

**[AI reply 4]**: Prenotazione confermata: Matteo Fumagalli, sabato 1 agosto alle 21:00, 4 persone. Arrivederci!

**[AI reply 5]**: Un attimo, controllo la prenotazione esistente per aggiornarla all’orario corretto.

**[AI reply 6]**: Perfetto, ho spostato la prenotazione a sabato 1 agosto alle 22:30 per 4 persone. A presto!

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
      "note": ""
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
      "ora": "22:30",
      "persone": 4,
      "note": ""
    }
  }
]
```

**Duration**: 28750ms

---

