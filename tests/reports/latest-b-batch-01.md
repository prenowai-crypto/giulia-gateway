# Batch B-01 (tests 1-33)
Run: 2026-07-21T21:22:49.455Z | Model: gpt-realtime-2.1-mini | Total: 33 | Passed: 20 (61%) | Failed: 13

## ✅ Passed (20)

- **B-001** `booking-flow`: Standard Italian booking flow — 4 people Saturday 20:30, complete with confirmation (14414ms, 2 tool calls)
- **B-002** `multilingua`: English caller switch: must complete lunch booking in English (18432ms, 2 tool calls)
- **B-003** `security`: Anti-injection: refuse to list other customers' bookings (2334ms, 0 tool calls)
- **B02-001** `booking-basic`: Pranzo sabato 13:00 per 2 persone — Rossi (15073ms, 2 tool calls)
- **B02-003** `booking-basic`: Pranzo domenica 12:00 per 3 persone — Verdi (12409ms, 2 tool calls)
- **B02-004** `booking-basic`: Pranzo domenica 13:30 per 6 persone (gruppo medio) — Colombo (14780ms, 2 tool calls)
- **B02-005** `booking-basic`: Pranzo martedì 13:00 per 2 persone — Ferrari (13904ms, 2 tool calls)
- **B02-007** `booking-basic`: Pranzo domenica 12:15 (orario preciso non standard) per 4 persone — Marino (15423ms, 2 tool calls)
- **B02-008** `booking-basic`: Pranzo mercoledì 13:00 per 2 persone — Greco (12974ms, 2 tool calls)
- **B02-010** `booking-basic`: Pranzo martedì 14:15 (bordo range pranzo, poco prima chiusura 14:30) per 3 persone — Rinaldi (17676ms, 2 tool calls)
- **B02-012** `booking-basic`: Cena sabato 21:30 per 4 persone — Esposito (15857ms, 2 tool calls)
- **B02-014** `booking-basic`: Cena sabato 22:15 per 5 persone — Fontana (12800ms, 2 tool calls)
- **B02-015** `booking-basic`: Cena domenica 21:00 per 6 persone — Sanna (15695ms, 2 tool calls)
- **B02-016** `booking-basic`: Cena domenica 22:30 (bordo chiusura cena) per 2 persone — Palumbo (14951ms, 2 tool calls)
- **B02-018** `booking-basic`: Cena mercoledì 21:30 per 4 persone — Piras (14193ms, 2 tool calls)
- **B02-019** `booking-basic`: Cena giovedì 21:00 (giovedì è solo cena, verifica no pranzo confusione) per 3 persone — Rizzo (16107ms, 2 tool calls)
- **B02-020** `booking-basic`: Cena venerdì 21:30 (venerdì è solo cena) per 5 persone — Villa (14360ms, 2 tool calls)
- **B02-021** `booking-basic`: Variante linguistica: 'per domani sera' (deve derivare data corretta) (14659ms, 2 tool calls)
- **B02-022** `booking-basic`: Variante linguistica: numero persone scritto in lettere ('quattro') (14743ms, 2 tool calls)
- **B02-024** `booking-basic`: Variante linguistica: orario colloquiale 'nove e un quarto' (→ 21:15) (15137ms, 2 tool calls)

## ❌ Failed (13)

### B02-002 — `booking-basic`
**Description**: Pranzo sabato 12:30 per 4 persone — Bianchi

**Reason**: expected tool call 'controlla_disponibilita' with args {"persone":4} not found. Actual: [] | expected tool call 'crea_prenotazione' with args {"persone":4} not found. Actual: []

**Full transcript**:

**[User turn 1]**: Vorrei prenotare per sabato a pranzo, alle 12:30, siamo in 4

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

Per sabato a pranzo alle 12:30, mi servono il suo nome e quale sabato intende (data).

**[User turn 2]**: Bianchi

**[AI reply 2]**: "Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?"

Ho solo “Bianchi”. È il suo nome completo, o preferisce indicarci nome e cognome?

**[User turn 3]**: Confermo

**[AI reply 3]**: "Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?"

Perfetto, Bianchi e 4 persone. Che sabato preciso intende, con data?

**Tool calls made** (0):
```json
[]
```

**Duration**: 4423ms

---

### B02-006 — `booking-basic`
**Description**: Pranzo sabato 14:00 per 5 persone — Ricci

**Reason**: expected tool call 'controlla_disponibilita' with args {"persone":5} not found. Actual: [] | expected tool call 'crea_prenotazione' with args {"persone":5} not found. Actual: []

**Full transcript**:

**[User turn 1]**: Vorrei prenotare sabato alle 14 per 5 persone

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?
Quale sabato intende? E qual è il nome, per favore?

**[User turn 2]**: Il nome è Ricci

**[AI reply 2]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?
Ricci registrato. Sabato 21 luglio? O il prossimo sabato?

**[User turn 3]**: Sì

**[AI reply 3]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?
Confermo Ricci, sabato 25 luglio alle 14:00 per 5 persone?

**Tool calls made** (0):
```json
[]
```

**Duration**: 6002ms

---

### B02-009 — `booking-basic`
**Description**: Pranzo sabato 12:30 per 8 persone (gruppo un po' più grande, sotto large_group_threshold) — Costa

**Reason**: expected tool call 'controlla_disponibilita' with args {"persone":8} not found. Actual: [] | expected tool call 'crea_prenotazione' with args {"persone":8} not found. Actual: []

**Full transcript**:

**[User turn 1]**: Salve, vorrei un tavolo per sabato alle 12:30, siamo 8 persone

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

Per prenotare, mi serve il suo nome.

**[User turn 2]**: Il cognome è Costa

**[AI reply 2]**: Perfetto, grazie.  
Il nome completo è Costa (solo il cognome) oppure può dirmi anche il nome e cognome?

**[User turn 3]**: Confermo

**[AI reply 3]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

Per confermare, mi serve il nome completo (non solo Costa) e il sabato preciso.

**Tool calls made** (0):
```json
[]
```

**Duration**: 3931ms

---

### B02-011 — `booking-basic`
**Description**: Cena sabato 21:00 per 2 persone — Russo

**Reason**: expected tool call 'controlla_disponibilita' with args {"persone":2} not found. Actual: [] | expected tool call 'crea_prenotazione' with args {"persone":2} not found. Actual: []

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare sabato prossimo alle 21 per 2 persone

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?
Mi servisce il nome per la prenotazione: qual è?

**[User turn 2]**: Russo

**[AI reply 2]**: Perfetto, Russo. Mi serve il nome completo per la prenotazione, per favore.

**[User turn 3]**: Sì

**[AI reply 3]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?
Il nome “Russo” è incompleto: mi serve il nome completo, perfetto.

**Tool calls made** (0):
```json
[]
```

**Duration**: 4549ms

---

### B02-013 — `booking-basic`
**Description**: Cena sabato 22:00 per 3 persone — Barbieri

**Reason**: expected tool call 'controlla_disponibilita' with args {"persone":3} not found. Actual: [] | expected tool call 'crea_prenotazione' with args {"persone":3} not found. Actual: [] | reply must contain 'Barbieri' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

Per sabato alle 22:00, che sabato intende esattamente? E come si chiama? Salve, sono l'assistente vocale automatico di

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per sabato alle 22 per 3

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

Per sabato alle 22:00, che sabato intende esattamente? E come si chiama?

**[User turn 2]**: Barbieri

**[AI reply 2]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

Quindi sei per sabato 25/07 alle 22:00, 3 persone. Qual è il nome completo da usare?

**[User turn 3]**: Sì confermo

**[AI reply 3]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

Mi conferma il nome completo e la data precisa del sabato?

**Tool calls made** (0):
```json
[]
```

**Duration**: 4009ms

---

### B02-017 — `booking-basic`
**Description**: Cena martedì 21:00 (feriale) per 2 persone — Gentile

**Reason**: expected tool call 'controlla_disponibilita' with args {"persone":2} not found. Actual: [] | expected tool call 'crea_prenotazione' with args {"persone":2} not found. Actual: []

**Full transcript**:

**[User turn 1]**: Vorrei prenotare martedì sera alle 21 per 2

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

Mi dia il nome sotto cui fare la prenotazione e la data precisa del martedì.

**[User turn 2]**: Gentile

**[AI reply 2]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

Il nome per la prenotazione, per favore?

**[User turn 3]**: Sì

**[AI reply 3]**: Il nome è Gentile? La data è martedì 21 luglio 2026 per 2 persone alle 21:00?

**Tool calls made** (0):
```json
[]
```

**Duration**: 3708ms

---

### B02-023 — `booking-basic`
**Description**: Variante linguistica: orario colloquiale 'otto e mezza' (→ 20:30, deve chiedere chiarimento perché fuori window cena 21:00-22:30)

**Reason**: expected tool call 'controlla_disponibilita' with args {"persone":2} not found. Actual: [] | expected tool call 'crea_prenotazione' with args {"persone":2} not found. Actual: []

**Full transcript**:

**[User turn 1]**: Vorrei prenotare sabato alle otto e mezza di sera per 2 persone

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?
Per chi la prenotiamo, con un nome completo?

**[User turn 2]**: Facciamo alle 21 allora

**[AI reply 2]**: Quale sabato preciso intende e con quale nome voglio registrarla?

**[User turn 3]**: Nome Longo

**[AI reply 3]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?
Certo, mi serve il nome completo (non solo “Longo”), e quale sabato intende.

**[User turn 4]**: Sì confermo

**[AI reply 4]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?
Mi serve la data specifica e il nome completo: “Longo” è solo un cognome?

**Tool calls made** (0):
```json
[]
```

**Duration**: 5665ms

---

### B02-025 — `booking-basic`
**Description**: Variante linguistica: 'un tavolo per stasera' — modello deve accettare o proporre alternative se ora già passata; usiamo 'stasera tardi'

**Reason**: expected tool call 'controlla_disponibilita' with args {"persone":2} not found. Actual: []

**Full transcript**:

**[User turn 1]**: Vorrei prenotare stasera tardi, verso le 22, per 2 persone

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

Potrei avere la data esatta, per esempio oggi o un altro giorno?

**[User turn 2]**: Serra

**[AI reply 2]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

Intendeva “sera” o vuole una data specifica?

**[User turn 3]**: Confermo

**[AI reply 3]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

Perfetto, ma mi servono nome e data esatta (oggi o un giorno preciso) per completare la prenotazione.

**Tool calls made** (0):
```json
[]
```

**Duration**: 3329ms

---

### B02-026 — `booking-basic`
**Description**: Flusso conversazionale: cliente dà info in ordine sparso (persone → data → ora → nome)

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":3} not found. Actual: [{"name":"controlla_disponibilita","args":{"data":"2026-07-25","ora":"21:30","persone":3}}] | reply must contain 'De Luca' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?  
Certo! Mi dica il nome, la data, l’orario e il numero di persone. Perfetto, 3 persone.  
Mi dica il nome, la data e l | expected reply language 'it' — got: ok, confermiamo?  
dimmi solo quale orario preferisci: 20:00 o 22:00, oppure un altro giorno.

**Full transcript**:

**[User turn 1]**: Salve, vorrei prenotare

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?  
Certo! Mi dica il nome, la data, l’orario e il numero di persone.

**[User turn 2]**: Siamo in 3

**[AI reply 2]**: Perfetto, 3 persone.  
Mi dica il nome, la data e l’orario, così verifico la disponibilità.

**[User turn 3]**: Sabato prossimo

**[AI reply 3]**: Sabato prossimo è il 25 luglio.  
Che orario preferisce, e qual è il nome per la prenotazione?

**[User turn 4]**: Alle 21:30

**[AI reply 4]**: Perfetto, 21:30.  
Qual è il nome da registrare, e confermiamo il 25 luglio per 3 persone?

**[User turn 5]**: A nome De Luca

**[AI reply 5]**: Un momento, controllo la disponibilità prima di creare la prenotazione.

**[User turn 6]**: Confermo

**[AI reply 6]**: Mi spiace, il sabato prossimo alle 21:30 è già pieno.  
Vuole un orario diverso, per esempio alle 20:00 o alle 22:00, o preferisce un altro giorno?

**[AI reply 7]**: Ok, confermiamo?  
Dimmi solo quale orario preferisci: 20:00 o 22:00, oppure un altro giorno.

**Tool calls made** (1):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-07-25",
      "ora": "21:30",
      "persone": 3
    }
  }
]
```

**Duration**: 7911ms

---

### B02-027 — `booking-basic`
**Description**: Flusso conversazionale: cliente conferma dopo recap dei dati

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":4} not found. Actual: [{"name":"controlla_disponibilita","args":{"data":"2026-07-25","ora":"21:00","persone":4}}] | reply must contain 'Mancini' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

Vuole sabato 25 luglio 2026 alle 21:00, o un altro sabato? Un attimo, controllo la disponibilità per quel sabato alle 

**Full transcript**:

**[User turn 1]**: Vorrei prenotare sabato alle 21 per 4 persone, a nome Mancini

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

Vuole sabato 25 luglio 2026 alle 21:00, o un altro sabato?

**[User turn 2]**: Sì, va bene tutto

**[AI reply 2]**: Un attimo, controllo la disponibilità per quel sabato alle 21.

**[AI reply 3]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

Il sabato alle 21 per 4 persone è pieno. Posso verificare un’altra data o un’altra ora.

**Tool calls made** (1):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-07-25",
      "ora": "21:00",
      "persone": 4
    }
  }
]
```

**Duration**: 7071ms

---

### B02-028 — `booking-basic`
**Description**: Flusso conversazionale: cliente aggiunge nota (compleanno)

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":4} not found. Actual: [{"name":"controlla_disponibilita","args":{"data":"2026-07-25","ora":"21:30","persone":4}}]

**Full transcript**:

**[User turn 1]**: Vorrei prenotare sabato alle 21:30 per 4 persone

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

Per sabato alle 21:30 per 4 persone, che nome dobbiamo usare e quale sabato intende?

**[User turn 2]**: Nome Conti

**[AI reply 2]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

Confermo: sabato 25 luglio 2026 alle 21:30, 4 persone, nome Conti. È così?

**[User turn 3]**: Volevo segnalare che è un compleanno

**[AI reply 3]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

Confermiamo Conti, sabato alle 21:30 per 4 persone, e aggiungo un compleanno. È il sabato 25 luglio 2026?

**[User turn 4]**: Sì confermo

**[AI reply 4]**: Perfetto, controllerò la disponibilità per quel sabato e ora.

**[AI reply 5]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

Sono spiacente: quel sabato alle 21:30 è pieno. Vuole un orario diverso o un altro giorno?

**Tool calls made** (1):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-07-25",
      "ora": "21:30",
      "persone": 4
    }
  }
]
```

**Duration**: 9976ms

---

### B02-029 — `booking-basic`
**Description**: Flusso conversazionale: cliente corregge il numero di persone (da 3 a 4)

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":4} not found. Actual: [{"name":"controlla_disponibilita","args":{"data":"2026-07-25","ora":"21:00","persone":4}}] | reply must contain 'Rinaldi' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

Mi serva il nome con cui vuole prenotare, per favore. Perfetto, allora siamo a 4.

Quale sabato intende? Il prossimo è

**Full transcript**:

**[User turn 1]**: Salve, vorrei prenotare sabato alle 21 per 3 persone

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

Mi serva il nome con cui vuole prenotare, per favore.

**[User turn 2]**: Anzi, aspetta, siamo in 4

**[AI reply 2]**: Perfetto, allora siamo a 4.

Quale sabato intende? Il prossimo è il 25 luglio. Mi dia il nome, così verifico la disponibilità.

**[User turn 3]**: Nome Rinaldi

**[AI reply 3]**: Un momento, controllo la disponibilità per sabato alle 21.

**[User turn 4]**: Confermo

**[AI reply 4]**: Sabato alle 21 è già pieno. Potrebbe scegliere un’altra ora, o un altro giorno.

**[AI reply 5]**: Perfetto. Valeva per sabato alle 21, ma è pieno.

Vuole un’altra ora sabato, o un altro giorno?

**Tool calls made** (1):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-07-25",
      "ora": "21:00",
      "persone": 4
    }
  }
]
```

**Duration**: 7514ms

---

### B02-030 — `booking-basic`
**Description**: Flusso conversazionale: cliente saluta prima di iniziare

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":2} not found. Actual: [{"name":"controlla_disponibilita","args":{"data":"2026-07-25","ora":"21:00","persone":2}}] | reply must contain 'Testa' — got: "Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?"
Dimmi nome, data e orario, e per quante persone. Perfetto, manca solo il nome. Per chi faccio la prenotazione? Un att

**Full transcript**:

**[User turn 1]**: Buongiorno! Come state? Volevo prenotare un tavolo

**[AI reply 1]**: "Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?"
Dimmi nome, data e orario, e per quante persone.

**[User turn 2]**: Sabato prossimo alle 21 per 2 persone

**[AI reply 2]**: Perfetto, manca solo il nome. Per chi faccio la prenotazione?

**[User turn 3]**: Il nome è Testa

**[AI reply 3]**: Un attimo, controllo la disponibilità per sabato sera alle 21 per 2.

**[User turn 4]**: Sì grazie confermo

**[AI reply 4]**: Mi dispiace, alle 21 è pieno. Vuoi provare un altro orario o un altro giorno?

**[AI reply 5]**: Perfetto. Dimmi una nuova data e un orario, e la confermo subito.

**Tool calls made** (1):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-07-25",
      "ora": "21:00",
      "persone": 2
    }
  }
]
```

**Duration**: 8539ms

---

