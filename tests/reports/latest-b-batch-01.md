# Batch B-01 (tests 1-30)
Run: 2026-07-27T11:00:24.823Z | Model: gpt-realtime-2.1-mini | Total: 30 | Passed: 16 (53%) | Failed: 14

## ✅ Passed (16)

- **B04-002** `availability-edge`: Lunedì chiuso — cliente insiste, modello mantiene rifiuto (8391ms, 2 tool calls)
- **B04-004** `availability-edge`: Lunedì chiuso — cliente accetta spostare a domenica (18381ms, 2 tool calls)
- **B04-009** `availability-edge`: Alle 20:30 — 30 minuti prima cena, cliente accetta 21:00 (17663ms, 2 tool calls)
- **B04-011** `availability-edge`: Dopo 22:30 — cliente accetta anticipare a 22:00 (28126ms, 4 tool calls)
- **B04-015** `availability-edge`: 9 persone — sopra MAX_PEOPLE_PER_BOOKING (8), deve segnalare (3209ms, 0 tool calls)
- **B04-016** `availability-edge`: 10 persone — al limite GROUP_THRESHOLD, richiede conferma ristoratore (18877ms, 2 tool calls)
- **B04-017** `availability-edge`: 15 persone — large group, richiede conferma esplicita (4761ms, 0 tool calls)
- **B04-018** `availability-edge`: 50 persone — soglia evento, dovrebbe richiedere contatto diretto/email (2690ms, 0 tool calls)
- **B04-019** `availability-edge`: 8 persone — limite superiore MAX_PEOPLE, deve passare come normale (15924ms, 2 tool calls)
- **B04-020** `availability-edge`: 1 sola persona — deve funzionare normalmente (14958ms, 2 tool calls)
- **B04-023** `availability-edge`: 'presto' — ambiguo, modello deve chiedere chiarimento (2191ms, 0 tool calls)
- **B04-024** `availability-edge`: 'tarda serata' — deve proporre ultimo slot (22:30) (17100ms, 2 tool calls)
- **B04-025** `availability-edge`: 'quando aprite' — cliente chiede orario apertura, poi prenota (17359ms, 2 tool calls)
- **B04-026** `availability-edge`: Ferragosto (15 agosto) — festivo, deve accettare (16915ms, 2 tool calls)
- **B04-027** `availability-edge`: Data lontana (dicembre) — deve accettare senza problemi (16149ms, 2 tool calls)
- **B04-028** `availability-edge`: Orario borderline — esattamente 22:30 (last booking) (16062ms, 2 tool calls)

## ❌ Failed (14)

### B04-001 — `availability-edge`
**Description**: Lunedì chiuso — cliente rifiutato

**Reason**: reply must contain 'chius' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Perfetto, grazie. Lunedì prossimo è una data un po’ ambigua se oggi è già lunedì, è corretto che intendi il lunedì dell

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per lunedì prossimo alle 21:30 per 2 persone, a nome Marco Bianchi

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[AI reply 2]**: Perfetto, grazie. Lunedì prossimo è una data un po’ ambigua se oggi è già lunedì, è corretto che intendi il lunedì della settimana in arrivo?

Dimmi la data esatta, così posso verificare la disponibilità.

**Tool calls made** (0):
```json
[]
```

**Duration**: 2936ms

---

### B04-003 — `availability-edge`
**Description**: Lunedì chiuso — cliente accetta spostare a martedì

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":3,"nome":"Luca Ferrari"} not found. Actual: [{"name":"controlla_disponibilita","args":{"data":"2026-08-03","ora":"21:00","persone":3}},{"name":"controlla_disponibilita","args":{"data":"2026-07-28","ora":"21:00","persone":3}}]

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per lunedì prossimo alle 21, 3 persone, a nome Luca Ferrari

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Va bene, allora per martedì prossimo stessa ora

**[AI reply 2]**: Perfetto, controllo la disponibilità per quel giorno e quella ora.

**[AI reply 3]**: Lunedì siamo chiusi, quindi non posso prenotare per quella data. Vuole provare un altro giorno o preferisce il pranzo o la cena di un altro giorno tra il martedì e la domenica?

**[AI reply 4]**: Ok, un attimo controllo se c’è disponibilità per quella data e ora.

**[AI reply 5]**: Perfetto! Quindi sarebbe una prenotazione per Luca Ferrari, martedì 28 luglio alle 21:00, per 3 persone. Conferma che va bene?

**Tool calls made** (2):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-08-03",
      "ora": "21:00",
      "persone": 3
    }
  },
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-07-28",
      "ora": "21:00",
      "persone": 3
    }
  }
]
```

**Duration**: 12376ms

---

### B04-005 — `availability-edge`
**Description**: Alle 15:30 — dopo chiusura pranzo (14:30)

**Reason**: forbidden tool call 'crea_prenotazione' was made | reply must contain 'cena' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Un attimo, controllo la disponibilità per quella data e orario. Perfetto, procedo ad aggiornare la prenotazione. Prenot

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per venerdì prossimo alle 15:30, 2 persone, a nome Paolo Verdi

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[AI reply 2]**: Un attimo, controllo la disponibilità per quella data e orario.

**[AI reply 3]**: Perfetto, procedo ad aggiornare la prenotazione.

**[AI reply 4]**: Prenotazione confermata: Paolo Verdi, venerdì 31 luglio 2026, alle 15:30, 2 persone. A presto!

**Tool calls made** (2):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-07-31",
      "ora": "15:30",
      "persone": 2
    }
  },
  {
    "name": "crea_prenotazione",
    "args": {
      "nome": "Paolo Verdi",
      "data": "2026-07-31",
      "ora": "15:30",
      "persone": 2,
      "note": "Prenotazione automatica effettuata via assistente vocale."
    }
  }
]
```

**Duration**: 17219ms

---

### B04-006 — `availability-edge`
**Description**: Alle 16:00 — gap tra pranzo e cena, chiuso

**Reason**: forbidden tool call 'crea_prenotazione' was made | reply must contain '21' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Mi omaggio alla richiesta: ora controllo la disponibilità per quel periodo. Perfetto, ora procedo con la prenotazione.  | last reply not in 'it': booked for chiara neri, friday at 16:00, for 3 people. see you then.

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per venerdì prossimo alle 16, 3 persone, a nome Chiara Neri

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[AI reply 2]**: Mi omaggio alla richiesta: ora controllo la disponibilità per quel periodo.

**[AI reply 3]**: Perfetto, ora procedo con la prenotazione.

**[AI reply 4]**: Booked for Chiara Neri, Friday at 16:00, for 3 people. See you then.

**Tool calls made** (2):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-07-31",
      "ora": "16:00",
      "persone": 3
    }
  },
  {
    "name": "crea_prenotazione",
    "args": {
      "nome": "Chiara Neri",
      "data": "2026-07-31",
      "ora": "16:00",
      "persone": 3,
      "note": "Prenotazione per 3 persone"
    }
  }
]
```

**Duration**: 14825ms

---

### B04-007 — `availability-edge`
**Description**: Alle 11:00 — prima apertura pranzo (12:00)

**Reason**: forbidden tool call 'crea_prenotazione' was made | reply must contain '12' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Un attimo, controllo la disponibilità per la data e l’orario indicati. Prenotazione confermata per Giovanni Costa, saba

**Full transcript**:

**[User turn 1]**: Buongiorno, vorrei prenotare per sabato prossimo alle 11, 2 persone, a nome Giovanni Costa

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[AI reply 2]**: Un attimo, controllo la disponibilità per la data e l’orario indicati.

**[AI reply 3]**: Prenotazione confermata per Giovanni Costa, sabato 1 agosto alle 11:00, 2 persone. A presto!

**Tool calls made** (2):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-08-01",
      "ora": "11:00",
      "persone": 2
    }
  },
  {
    "name": "crea_prenotazione",
    "args": {
      "nome": "Giovanni Costa",
      "data": "2026-08-01",
      "ora": "11:00",
      "persone": 2,
      "note": "Prenotazione effettuata tramite assistente vocale automatico."
    }
  }
]
```

**Duration**: 15375ms

---

### B04-008 — `availability-edge`
**Description**: Alle 20:00 — prima apertura cena (21:00 config reale)

**Reason**: forbidden tool call 'crea_prenotazione' was made | reply must contain '21' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Un attimo, controllo la disponibilità per quella data e ora. Perfetto, posso procedere con la prenotazione. Prenotazion

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per sabato prossimo alle 20, 4 persone, a nome Elena Ricci

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[AI reply 2]**: Un attimo, controllo la disponibilità per quella data e ora.

**[AI reply 3]**: Perfetto, posso procedere con la prenotazione.

**[AI reply 4]**: Prenotazione confermata per Elena Ricci, sabato 1 agosto 2026 alle 20:00, 4 persone. A presto!

**Tool calls made** (2):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-08-01",
      "ora": "20:00",
      "persone": 4
    }
  },
  {
    "name": "crea_prenotazione",
    "args": {
      "nome": "Elena Ricci",
      "data": "2026-08-01",
      "ora": "20:00",
      "persone": 4,
      "note": ""
    }
  }
]
```

**Duration**: 17079ms

---

### B04-010 — `availability-edge`
**Description**: Alle 23:00 — dopo last booking (22:30)

**Reason**: forbidden tool call 'crea_prenotazione' was made | reply must contain '22' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Ok, un attimo: verifichiamo la disponibilità per quella data e orario. Perfetto, ci sono le condizioni. Proseguo con la

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per sabato prossimo alle 23, 2 persone, a nome Francesco Lombardi

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[AI reply 2]**: Ok, un attimo: verifichiamo la disponibilità per quella data e orario.

**[AI reply 3]**: Perfetto, ci sono le condizioni. Proseguo con la prenotazione.

**[AI reply 4]**: Prenotazione confermata: Francesco Lombardi, sabato 1 agosto alle 23:00, 2 persone. A presto!

**Tool calls made** (2):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-08-01",
      "ora": "23:00",
      "persone": 2
    }
  },
  {
    "name": "crea_prenotazione",
    "args": {
      "nome": "Francesco Lombardi",
      "data": "2026-08-01",
      "ora": "23:00",
      "persone": 2,
      "note": ""
    }
  }
]
```

**Duration**: 15412ms

---

### B04-012 — `availability-edge`
**Description**: Data passata — 'ieri sera'

**Reason**: reply must contain 'passat' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Mi conferma che “ieri” significa domenica 26 luglio? E che la prenotazione è per le 21:00?

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per ieri sera alle 21, 2 persone, a nome Laura Bianchi

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[AI reply 2]**: Mi conferma che “ieri” significa domenica 26 luglio? E che la prenotazione è per le 21:00?

**Tool calls made** (0):
```json
[]
```

**Duration**: 4031ms

---

### B04-013 — `availability-edge`
**Description**: Data passata specifica poi correzione a futura

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":3,"nome":"Alessandro Ferri"} not found. Actual: [{"name":"controlla_disponibilita","args":{"data":"2026-08-10","ora":"21:00","persone":3}}] | last reply not in 'it': mi dispiace, il ristorante è chiuso il lunedì, quindi il 10 agosto non è prenotabile. vuoi prenotare per un altro giorno alle 21, o preferisci un orar

**Full transcript**:

**[User turn 1]**: Vorrei prenotare per il 10 luglio alle 21, 3 persone, a nome Alessandro Ferri

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Ah scusi intendevo 10 agosto

**[AI reply 2]**: Perfetto, ho le persone e l’orario. Ma devo confermare l’anno: il 10 luglio è il 2026 o un’altra data?

**[AI reply 3]**: Un attimo, controllo la disponibilità per quella data e ora.

**[AI reply 4]**: Mi dispiace, il ristorante è chiuso il lunedì, quindi il 10 agosto non è prenotabile. Vuoi prenotare per un altro giorno alle 21, o preferisci un orario diverso?

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

**Duration**: 6005ms

---

### B04-014 — `availability-edge`
**Description**: Prenotazione stasera (last minute) — deve accettare se in orario

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":2,"nome":"Beatrice Testa"} not found. Actual: [{"name":"controlla_disponibilita","args":{"data":"2026-07-27","ora":"22:00","persone":2}}] | reply must contain 'Testa' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Un attimo, sto verificando la disponibilità per la richiesta di stasera. Ciao, sono l'assistente vocale automatico di O

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per stasera alle 22, 2 persone, a nome Beatrice Testa

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[AI reply 2]**: Un attimo, sto verificando la disponibilità per la richiesta di stasera.

**[AI reply 3]**: Ciao, sono l'assistente vocale automatico di Osteria Test, come posso aiutarvi?  
Mi spiace, ma stasera è lunedì e il ristorante è chiuso. Vuoi prenotare per un altro giorno?

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

**Duration**: 5072ms

---

### B04-021 — `availability-edge`
**Description**: 'ora di pranzo' — deve dedurre 12:00 o 13:30

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":2,"nome":"Simone De Luca"} not found. Actual: []

**Full transcript**:

**[User turn 1]**: Buongiorno, vorrei prenotare per sabato prossimo all'ora di pranzo, 2 persone, a nome Simone De Luca

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Sì va bene

**[AI reply 2]**: Perfetto, Simone De Luca. Qual è l’orario esatto di pranzo, per esempio 12:30 o 13:00?

**[AI reply 3]**: Ok, grazie, ma ho bisogno dell’orario preciso. Vuoi 12:00 o 13:00?

**Tool calls made** (0):
```json
[]
```

**Duration**: 3892ms

---

### B04-022 — `availability-edge`
**Description**: 'per cena' — deve dedurre 21:00

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":2,"nome":"Marta Fabbri"} not found. Actual: [] | reply must contain '21' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Perfetto, Marta. A che ora di sabato prossimo vorresti la cena? Perfetto, grazie. A che ora vorresti la cena, Marta?

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per sabato prossimo per cena, 2 persone, a nome Marta Fabbri

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Sì

**[AI reply 2]**: Perfetto, Marta. A che ora di sabato prossimo vorresti la cena?

**[AI reply 3]**: Perfetto, grazie. A che ora vorresti la cena, Marta?

**Tool calls made** (0):
```json
[]
```

**Duration**: 3816ms

---

### B04-029 — `availability-edge`
**Description**: OVERBOOKING sabato 21:00 pieno, cliente accetta 22:30 [SEED: 30 pax sabato prossimo 21:00]

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":4,"nome":"Matteo Fumagalli","ora":"22:30"} not found. Actual: [{"name":"controlla_disponibilita","args":{"data":"2026-08-01","ora":"21:00","persone":4}},{"name":"crea_prenotazione","args":{"nome":"Matteo Fumagalli","data":"2026-08-01","ora":"21:00","persone":4,"note":"Prenotazione standard"}},{"name":"trova_prenotazione","args":{"nome":"Matteo Fumagalli","data":"2026-08-01"}},{"name":"modifica_prenotazione","args":{"data":"2026-08-01","ora":"22:30"}}]

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per sabato prossimo alle 21, 4 persone, a nome Matteo Fumagalli

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Va bene alle 22:30 allora

**[AI reply 2]**: Perfetto, verifichiamo la disponibilità per quella data e ora. Un attimo, per favore.

**[AI reply 3]**: Prenotazione confermata per Matteo Fumagalli, sabato 2026-08-01 alle 21:00, 4 persone. A presto!

**[AI reply 4]**: Ok, modifico l’orario per la tua prenotazione; un attimo.

**[AI reply 5]**: Perfetto, ho aggiornato l’orario. Ora la prenotazione è confermata per Matteo Fumagalli alle 22:30.

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

**Duration**: 26694ms

---

### B04-030 — `availability-edge`
**Description**: OVERBOOKING sabato 21:00 pieno, cliente accetta domenica [SEED: 30 pax sabato prossimo 21:00]

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":4,"nome":"Davide Sala"} not found. Actual: [{"name":"controlla_disponibilita","args":{"data":"2026-08-01","ora":"21:00","persone":4}},{"name":"controlla_disponibilita","args":{"data":"2026-08-02","ora":"21:00","persone":4}}]

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per sabato prossimo alle 21, 4 persone, a nome Davide Sala

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: No grazie, allora domenica prossima stessa ora

**[AI reply 2]**: Un attimo, controllo la disponibilità per quel giorno e orario.

**[AI reply 3]**: Perfetto, ci sono il nome Davide Sala, sabato 1 agosto alle 21, 4 persone. Confermi così la prenotazione?

**[AI reply 4]**: Ok, vediamo se quel tavolo è disponibile domenica alla stessa ora.

**[AI reply 5]**: Perfetto, la domenica alle 21 è disponibile per 4 persone per Davide Sala. Vuole che la registri così?

**Tool calls made** (2):
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
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-08-02",
      "ora": "21:00",
      "persone": 4
    }
  }
]
```

**Duration**: 10952ms

---

