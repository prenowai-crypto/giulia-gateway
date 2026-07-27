# Batch B-01 (tests 1-30)
Run: 2026-07-27T12:50:19.980Z | Model: gpt-realtime-2.1-mini | Total: 30 | Passed: 15 (50%) | Failed: 15

## ✅ Passed (15)

- **B04-001** `availability-edge`: Lunedì chiuso — cliente rifiutato (2888ms, 0 tool calls)
- **B04-002** `availability-edge`: Lunedì chiuso — cliente insiste, modello mantiene rifiuto (2988ms, 0 tool calls)
- **B04-003** `availability-edge`: Lunedì chiuso — cliente accetta spostare a martedì (18538ms, 2 tool calls)
- **B04-004** `availability-edge`: Lunedì chiuso — cliente accetta spostare a domenica (18420ms, 2 tool calls)
- **B04-006** `availability-edge`: Alle 16:00 — gap tra pranzo e cena, chiuso (2300ms, 0 tool calls)
- **B04-007** `availability-edge`: Alle 11:00 — prima apertura pranzo (12:00) (2642ms, 0 tool calls)
- **B04-008** `availability-edge`: Alle 20:00 — prima apertura cena (21:00 config reale) (2646ms, 0 tool calls)
- **B04-009** `availability-edge`: Alle 20:30 — 30 minuti prima cena, cliente accetta 21:00 (18527ms, 2 tool calls)
- **B04-010** `availability-edge`: Alle 23:00 — dopo last booking (22:30) (2871ms, 0 tool calls)
- **B04-011** `availability-edge`: Dopo 22:30 — cliente accetta anticipare a 22:00 (18191ms, 2 tool calls)
- **B04-015** `availability-edge`: 9 persone — sopra MAX_PEOPLE_PER_BOOKING (8), deve segnalare (2808ms, 0 tool calls)
- **B04-017** `availability-edge`: 15 persone — large group, richiede conferma esplicita (4137ms, 0 tool calls)
- **B04-018** `availability-edge`: 50 persone — soglia evento, dovrebbe richiedere contatto diretto/email (2695ms, 0 tool calls)
- **B04-019** `availability-edge`: 8 persone — limite superiore MAX_PEOPLE, deve passare come normale (15549ms, 2 tool calls)
- **B04-020** `availability-edge`: 1 sola persona — deve funzionare normalmente (14754ms, 2 tool calls)

## ❌ Failed (15)

### B04-005 — `availability-edge`
**Description**: Alle 15:30 — dopo chiusura pranzo (14:30)

**Reason**: reply must contain 'cena' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Grazie Paolo. Alle 15:30 non è possibile per il pranzo perché è fuori dalla fascia oraria, che termina alle 14:30. Vuol

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per venerdì prossimo alle 15:30, 2 persone, a nome Paolo Verdi

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[AI reply 2]**: Grazie Paolo. Alle 15:30 non è possibile per il pranzo perché è fuori dalla fascia oraria, che termina alle 14:30. Vuole invece prenotare per un orario prettamente pranzo, ad esempio 12:00 o 14:00?

**Tool calls made** (0):
```json
[]
```

**Duration**: 1901ms

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

**Duration**: 2347ms

---

### B04-013 — `availability-edge`
**Description**: Data passata specifica poi correzione a futura

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":3,"nome":"Alessandro Ferri"} not found. Actual: []

**Full transcript**:

**[User turn 1]**: Vorrei prenotare per il 10 luglio alle 21, 3 persone, a nome Alessandro Ferri

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Ah scusi intendevo 10 agosto

**[AI reply 2]**: Non posso prenotare per una data passata. Vuole prenotare per un giorno futuro?

**[AI reply 3]**: Perfetto, grazie per la correzione. Purtroppo il 10 agosto è lunedì e siamo chiusi. Vuole provare un martedì o un altro giorno tra martedì e domenica?

**Tool calls made** (0):
```json
[]
```

**Duration**: 3551ms

---

### B04-014 — `availability-edge`
**Description**: Prenotazione stasera (last minute) — deve accettare se in orario

**Reason**: expected tool call 'controlla_disponibilita' with args {"persone":2} not found. Actual: [] | expected tool call 'crea_prenotazione' with args {"persone":2,"nome":"Beatrice Testa"} not found. Actual: [] | reply must contain 'Testa' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Mi dispiace, stasera siamo chiusi. Vuole prenotare per un altro giorno tra martedì e domenica, oppure un orario valido 

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per stasera alle 22, 2 persone, a nome Beatrice Testa

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[AI reply 2]**: Mi dispiace, stasera siamo chiusi. Vuole prenotare per un altro giorno tra martedì e domenica, oppure un orario valido per pranzo o cena?

**Tool calls made** (0):
```json
[]
```

**Duration**: 2954ms

---

### B04-016 — `availability-edge`
**Description**: 10 persone — al limite GROUP_THRESHOLD, richiede conferma ristoratore

**Reason**: reply must contain 'conferma' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Per 10 persone non posso prenotare in una sola prenotazione: il limite è 8.  
Vuole che suddivida in due prenotazioni (

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per sabato prossimo alle 21, 10 persone, a nome Michele Barbieri

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[AI reply 2]**: Per 10 persone non posso prenotare in una sola prenotazione: il limite è 8.  
Vuole che suddivida in due prenotazioni (8 e 2), oppure ridurre a 8?

**Tool calls made** (0):
```json
[]
```

**Duration**: 3120ms

---

### B04-021 — `availability-edge`
**Description**: 'ora di pranzo' — deve dedurre 12:00 o 13:30

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":2,"nome":"Simone De Luca"} not found. Actual: [] | reply must contain 'De Luca' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**Full transcript**:

**[User turn 1]**: Buongiorno, vorrei prenotare per sabato prossimo all'ora di pranzo, 2 persone, a nome Simone De Luca

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Sì va bene

**Tool calls made** (0):
```json
[]
```

**Duration**: 1493ms

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

**Duration**: 1073ms

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

**Duration**: 1164ms

---

### B04-024 — `availability-edge`
**Description**: 'tarda serata' — deve proporre ultimo slot (22:30)

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":3,"nome":"Ilaria Marchetti","ora":"22:30"} not found. Actual: [] | reply must contain '22:30' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per sabato prossimo in tarda serata, 3 persone, a nome Ilaria Marchetti

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Va bene alle 22:30

**Tool calls made** (0):
```json
[]
```

**Duration**: 1483ms

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

**Duration**: 1626ms

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

**Duration**: 1285ms

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

**Duration**: 890ms

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

**Duration**: 1172ms

---

### B04-029 — `availability-edge`
**Description**: OVERBOOKING sabato 21:00 pieno, cliente accetta 22:30 [SEED: 30 pax sabato prossimo 21:00]

**Reason**: expected tool call 'controlla_disponibilita' with args {"persone":4} not found. Actual: [] | expected tool call 'crea_prenotazione' with args {"persone":4,"nome":"Matteo Fumagalli","ora":"22:30"} not found. Actual: [] | reply must contain 'Fumagalli' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per sabato prossimo alle 21, 4 persone, a nome Matteo Fumagalli

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Va bene alle 22:30 allora

**Tool calls made** (0):
```json
[]
```

**Duration**: 1861ms

---

### B04-030 — `availability-edge`
**Description**: OVERBOOKING sabato 21:00 pieno, cliente accetta domenica [SEED: 30 pax sabato prossimo 21:00]

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":4,"nome":"Davide Sala"} not found. Actual: [] | reply must contain 'Sala' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per sabato prossimo alle 21, 4 persone, a nome Davide Sala

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: No grazie, allora domenica prossima stessa ora

**Tool calls made** (0):
```json
[]
```

**Duration**: 2016ms

---

