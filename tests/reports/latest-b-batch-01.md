# Batch B-01 (tests 1-30)
Run: 2026-07-27T11:32:00.430Z | Model: gpt-realtime-2.1-mini | Total: 30 | Passed: 10 (33%) | Failed: 20

## ✅ Passed (10)

- **B04-001** `availability-edge`: Lunedì chiuso — cliente rifiutato (2845ms, 0 tool calls)
- **B04-002** `availability-edge`: Lunedì chiuso — cliente insiste, modello mantiene rifiuto (3652ms, 0 tool calls)
- **B04-003** `availability-edge`: Lunedì chiuso — cliente accetta spostare a martedì (18649ms, 2 tool calls)
- **B04-004** `availability-edge`: Lunedì chiuso — cliente accetta spostare a domenica (16565ms, 2 tool calls)
- **B04-008** `availability-edge`: Alle 20:00 — prima apertura cena (21:00 config reale) (3567ms, 0 tool calls)
- **B04-009** `availability-edge`: Alle 20:30 — 30 minuti prima cena, cliente accetta 21:00 (19014ms, 2 tool calls)
- **B04-010** `availability-edge`: Alle 23:00 — dopo last booking (22:30) (2781ms, 0 tool calls)
- **B04-015** `availability-edge`: 9 persone — sopra MAX_PEOPLE_PER_BOOKING (8), deve segnalare (2644ms, 0 tool calls)
- **B04-017** `availability-edge`: 15 persone — large group, richiede conferma esplicita (3390ms, 0 tool calls)
- **B04-018** `availability-edge`: 50 persone — soglia evento, dovrebbe richiedere contatto diretto/email (2523ms, 0 tool calls)

## ❌ Failed (20)

### B04-005 — `availability-edge`
**Description**: Alle 15:30 — dopo chiusura pranzo (14:30)

**Reason**: last reply not in 'it': mi dispiace, venerdì 31 luglio alle 15:30 è fuori orario di servizio. posso prenotare per il pranzo, ad esempio alle 13:00, oppure per la cena alle 21

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per venerdì prossimo alle 15:30, 2 persone, a nome Paolo Verdi

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[AI reply 2]**: Mi dispiace, venerdì 31 luglio alle 15:30 è fuori orario di servizio. Posso prenotare per il pranzo, ad esempio alle 13:00, oppure per la cena alle 21:00.

**Tool calls made** (0):
```json
[]
```

**Duration**: 3045ms

---

### B04-006 — `availability-edge`
**Description**: Alle 16:00 — gap tra pranzo e cena, chiuso

**Reason**: last reply not in 'it': mi serve confermare un orario valido: 16:00 non è tra i nostri slot di servizio. vuole prenotare per pranzo (entro le 14:30) o per cena alle 21:00?

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per venerdì prossimo alle 16, 3 persone, a nome Chiara Neri

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[AI reply 2]**: Mi serve confermare un orario valido: 16:00 non è tra i nostri slot di servizio. Vuole prenotare per pranzo (entro le 14:30) o per cena alle 21:00?

**Tool calls made** (0):
```json
[]
```

**Duration**: 3420ms

---

### B04-007 — `availability-edge`
**Description**: Alle 11:00 — prima apertura pranzo (12:00)

**Reason**: last reply not in 'it': c’è un problema con l’orario: apriamo a pranzo alle 12:00. vuole prenotare per le 12:00 o la sera?

**Full transcript**:

**[User turn 1]**: Buongiorno, vorrei prenotare per sabato prossimo alle 11, 2 persone, a nome Giovanni Costa

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[AI reply 2]**: C’è un problema con l’orario: apriamo a pranzo alle 12:00. Vuole prenotare per le 12:00 o la sera?

**Tool calls made** (0):
```json
[]
```

**Duration**: 5976ms

---

### B04-011 — `availability-edge`
**Description**: Dopo 22:30 — cliente accetta anticipare a 22:00

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":2,"nome":"Roberto Greco"} not found. Actual: [{"name":"controlla_disponibilita","args":{"data":"2026-08-01","ora":"22:00","persone":2}}]

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per sabato prossimo alle 23:30, 2 persone, a nome Roberto Greco

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Va bene allora alle 22

**[AI reply 2]**: Grazie, Roberto. Sabato prossimo è valido, ma alle 23:30 siamo fuori orario: l’ultimo ingresso serale è alle 22:30. Vuole prenotare alle 21:30 o scegliere un’altra ora tra le 21:00 e le 22:30?

**[AI reply 3]**: Va bene, verifichiamo la disponibilità per questa prenotazione.

**[AI reply 4]**: Perfetto, grazie per la scelta! Conferma: Roberto Greco, sabato 1 agosto alle 22:00, 2 persone.

**Tool calls made** (1):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-08-01",
      "ora": "22:00",
      "persone": 2
    }
  }
]
```

**Duration**: 8843ms

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

**Duration**: 2115ms

---

### B04-013 — `availability-edge`
**Description**: Data passata specifica poi correzione a futura

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":3,"nome":"Alessandro Ferri"} not found. Actual: [{"name":"controlla_disponibilita","args":{"data":"2026-08-10","ora":"21:00","persone":3}}] | reply must contain 'agosto' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Non posso prenotare per una data passata. Vuole prenotare per un giorno futuro? Perfetto, lascio un attimo la parola al

**Full transcript**:

**[User turn 1]**: Vorrei prenotare per il 10 luglio alle 21, 3 persone, a nome Alessandro Ferri

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Ah scusi intendevo 10 agosto

**[AI reply 2]**: Non posso prenotare per una data passata. Vuole prenotare per un giorno futuro?

**[AI reply 3]**: Perfetto, lascio un attimo la parola alla visibilità della disponibilità.

**[AI reply 4]**: Grazie, ho verificato: il lunedì il ristorante è chiuso. Vuole prenotare per un altro giorno, ad esempio il martedì alle 21 per 3 persone?

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

**Duration**: 7221ms

---

### B04-014 — `availability-edge`
**Description**: Prenotazione stasera (last minute) — deve accettare se in orario

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":2,"nome":"Beatrice Testa"} not found. Actual: [{"name":"controlla_disponibilita","args":{"data":"2026-07-27","ora":"22:00","persone":2}}] | reply must contain 'Testa' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Ok, verifico la disponibilità per quella ora. Un attimo. Mi spiace, lunedì siamo chiusi. Vuole prenotare per domani, op

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per stasera alle 22, 2 persone, a nome Beatrice Testa

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[AI reply 2]**: Ok, verifico la disponibilità per quella ora. Un attimo.

**[AI reply 3]**: Mi spiace, lunedì siamo chiusi. Vuole prenotare per domani, oppure un altro giorno tra martedì e domenica?

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

**Duration**: 5145ms

---

### B04-016 — `availability-edge`
**Description**: 10 persone — al limite GROUP_THRESHOLD, richiede conferma ristoratore

**Reason**: reply must contain 'conferma' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Certo, Michele Barbieri. Per una prenotazione su 10 persone è oltre il limite di 8 per singola prenotazione.

Posso far

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per sabato prossimo alle 21, 10 persone, a nome Michele Barbieri

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[AI reply 2]**: Certo, Michele Barbieri. Per una prenotazione su 10 persone è oltre il limite di 8 per singola prenotazione.

Posso fare due tavoli separati (8 e 2) o ridurre a 8 o meno. Come preferisce?

**Tool calls made** (0):
```json
[]
```

**Duration**: 7766ms

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

**Duration**: 1137ms

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

**Duration**: 1004ms

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

**Duration**: 848ms

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

**Duration**: 1399ms

---

### B04-023 — `availability-edge`
**Description**: 'presto' — ambiguo, modello deve chiedere chiarimento

**Reason**: reply must contain 'ora' — got:  | last reply not in 'it': 

**Full transcript**:

**[User turn 1]**: Buongiorno, vorrei prenotare per sabato prossimo presto, 2 persone, a nome Fabio Pellegrini

**Tool calls made** (0):
```json
[]
```

**Duration**: 696ms

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

**Duration**: 1506ms

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

**Duration**: 1636ms

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

**Duration**: 871ms

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

**Duration**: 899ms

---

### B04-028 — `availability-edge`
**Description**: Orario borderline — esattamente 22:30 (last booking)

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":2,"nome":"Silvia Conte","ora":"22:30"} not found. Actual: [] | reply must contain '22:30' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per sabato prossimo alle 22:30, 2 persone, a nome Silvia Conte

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Sì

**Tool calls made** (0):
```json
[]
```

**Duration**: 1442ms

---

### B04-029 — `availability-edge`
**Description**: OVERBOOKING sabato 21:00 pieno, cliente accetta 22:30 [SEED: 30 pax sabato prossimo 21:00]

**Reason**: expected tool call 'controlla_disponibilita' with args {"persone":4} not found. Actual: [] | expected tool call 'crea_prenotazione' with args {"persone":4,"nome":"Matteo Fumagalli","ora":"22:30"} not found. Actual: [] | reply must contain 'Fumagalli' — got:  | last reply not in 'it': 

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per sabato prossimo alle 21, 4 persone, a nome Matteo Fumagalli

**[User turn 2]**: Va bene alle 22:30 allora

**Tool calls made** (0):
```json
[]
```

**Duration**: 820ms

---

### B04-030 — `availability-edge`
**Description**: OVERBOOKING sabato 21:00 pieno, cliente accetta domenica [SEED: 30 pax sabato prossimo 21:00]

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":4,"nome":"Davide Sala"} not found. Actual: [] | reply must contain 'Sala' — got:  | last reply not in 'it': 

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per sabato prossimo alle 21, 4 persone, a nome Davide Sala

**[User turn 2]**: No grazie, allora domenica prossima stessa ora

**Tool calls made** (0):
```json
[]
```

**Duration**: 858ms

---

