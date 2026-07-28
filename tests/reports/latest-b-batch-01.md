# Batch B-01 (tests 1-30)
Run: 2026-07-28T12:47:26.815Z | Model: gpt-realtime-2.1-mini | Total: 30 | Passed: 26 (87%) | Failed: 4

## ✅ Passed (26)

- **B06-001** `entity-capture`: Cognome con apostrofo — D'Angelo (23652ms, 2 tool calls)
- **B06-002** `entity-capture`: Cognome composto — De Luca (16471ms, 2 tool calls)
- **B06-003** `entity-capture`: Nome e cognome — deve catturare entrambi (16362ms, 2 tool calls)
- **B06-004** `entity-capture`: Cognome straniero (tedesco) — Schneider (16729ms, 2 tool calls)
- **B06-005** `entity-capture`: Cliente compita il cognome lettera per lettera (15835ms, 2 tool calls)
- **B06-007** `entity-capture`: Persone dette come 'siamo in quattro' (15101ms, 2 tool calls)
- **B06-008** `entity-capture`: Persone dette come 'io e mia moglie' → 2 persone (20555ms, 2 tool calls)
- **B06-009** `entity-capture`: Persone come 'una famiglia di cinque' → 5 (18838ms, 2 tool calls)
- **B06-010** `entity-capture`: Persone come 'in coppia' → 2 (14807ms, 2 tool calls)
- **B06-011** `entity-capture`: Persone come 'in tre coppie' → 6 (20799ms, 2 tool calls)
- **B06-013** `entity-capture`: Cliente aggiunge nota — allergia (21807ms, 2 tool calls)
- **B06-014** `entity-capture`: Cliente aggiunge nota — seggiolone per bambino (18451ms, 2 tool calls)
- **B06-015** `entity-capture`: Cliente chiede tavolo esterno (18333ms, 2 tool calls)
- **B06-016** `entity-capture`: Nota compleanno (13917ms, 2 tool calls)
- **B06-017** `entity-capture`: Nome con particella nobiliare — Della Valle (18469ms, 2 tool calls)
- **B06-018** `entity-capture`: Nome doppio — Maria Chiara Neri (15283ms, 2 tool calls)
- **B06-020** `entity-capture`: Cliente dà solo il cognome quando gli si chiede il nome (17621ms, 2 tool calls)
- **B06-021** `entity-capture`: Cognome fonicamente ambiguo — cliente ripete e conferma (27414ms, 4 tool calls)
- **B06-022** `entity-capture`: Nome tipicamente ambiguo al telefono — Villa vs Villani (26718ms, 5 tool calls)
- **B06-023** `entity-capture`: Cliente dice tutto in un turno — persone, ora, nome, nota (20028ms, 2 tool calls)
- **B06-024** `entity-capture`: Cliente dà nome mentre parla di altro — deve estrarlo comunque (17582ms, 2 tool calls)
- **B06-025** `entity-capture`: Doppia richiesta — allergia + tavolo lontano dalla porta (30806ms, 3 tool calls)
- **B06-026** `entity-capture`: Cliente aggiunge la nota DOPO la conferma iniziale (27996ms, 4 tool calls)
- **B06-027** `entity-capture`: Cliente ha un nome tipicamente maschile ma è donna che prenota per marito — cattura correttamente (18256ms, 2 tool calls)
- **B06-028** `entity-capture`: Il cliente NON dice il nome — Giulia deve chiederlo, il cliente risponde (20772ms, 2 tool calls)
- **B06-029** `entity-capture`: Cliente pronuncia il cognome in modo non chiaro — Giulia deve chiedere ripetizione (16552ms, 2 tool calls)

## ❌ Failed (4)

### B06-006 — `entity-capture`
**Description**: Cliente si corregge sul cognome

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":2,"nome":"Russo"} not found. Actual: [{"name":"controlla_disponibilita","args":{"data":"2026-07-31","ora":"21:00","persone":2}},{"name":"crea_prenotazione","args":{"nome":"Rossi","data":"2026-07-31","ora":"21:00","persone":2,"note":""}},{"name":"trova_prenotazione","args":{"nome":"Rossi"}},{"name":"modifica_prenotazione","args":{"nome":"Russo"}},{"name":"modifica_prenotazione","args":{"nome":"Russo","data":"2026-07-31","ora":"21:00","persone":2}}]

**Full transcript**:

**[User turn 1]**: Vorrei prenotare per venerdì prossimo alle nove di sera, due persone, a nome Rossi

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Aspetta, ho sbagliato, è Russo con la U

**[AI reply 2]**: Un attimo, controllo la disponibilità.

**[User turn 3]**: Sì confermo

**[AI reply 3]**: Perfetto, registro la prenotazione con questi dati.

**[AI reply 4]**: Prenotazione confermata: Rossi, venerdì alle 21:00, per 2 persone. A presto!

**[AI reply 5]**: Un attimo, controllo la prenotazione per correggere il nome.

**[AI reply 6]**: Un attimo, riprovo con i dati completi per aggiornare il nome.

**[AI reply 7]**: Fatto, ho aggiornato il nome in Russo.  
Prenotazione confermata per Russo, venerdì alle 21:00, per 2 persone.

**[AI reply 8]**: Perfetto, prenotazione confermata: Russo, venerdì alle 21:00, per 2 persone. A presto!

**Tool calls made** (5):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-07-31",
      "ora": "21:00",
      "persone": 2
    }
  },
  {
    "name": "crea_prenotazione",
    "args": {
      "nome": "Rossi",
      "data": "2026-07-31",
      "ora": "21:00",
      "persone": 2,
      "note": ""
    }
  },
  {
    "name": "trova_prenotazione",
    "args": {
      "nome": "Rossi"
    }
  },
  {
    "name": "modifica_prenotazione",
    "args": {
      "nome": "Russo"
    }
  },
  {
    "name": "modifica_prenotazione",
    "args": {
      "nome": "Russo",
      "data": "2026-07-31",
      "ora": "21:00",
      "persone": 2
    }
  }
]
```

**Duration**: 26267ms

---

### B06-012 — `entity-capture`
**Description**: Cliente si corregge sul numero di persone

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":3,"nome":"Vitale"} not found. Actual: [{"name":"controlla_disponibilita","args":{"data":"2026-07-31","ora":"21:00","persone":2}},{"name":"crea_prenotazione","args":{"nome":"Vitale","data":"2026-07-31","ora":"21:00","persone":2,"note":""}},{"name":"trova_prenotazione","args":{"nome":"Vitale","data":"2026-07-31"}},{"name":"modifica_prenotazione","args":{"nome":"Vitale","data":"2026-07-31","ora":"21:00","persone":3}}]

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per venerdì prossimo alle nove di sera, due persone, a nome Vitale

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Aspetta, siamo in tre in realtà

**[AI reply 2]**: Un attimo, controllo la disponibilità per questo orario.

**[User turn 3]**: Sì confermo

**[AI reply 3]**: Perfetto, registro la prenotazione.

**[AI reply 4]**: Prenotazione confermata: Vitale, venerdì alle 21:00, per 2 persone. A presto!

**[AI reply 5]**: Un attimo, verifico la prenotazione per aggiornare il numero di persone.

**[AI reply 6]**: Perfetto, ho aggiornato la prenotazione a 3 persone per Vitale, venerdì alle 21:00. A presto!

**[AI reply 7]**: Perfetto, confermato. Prenotazione aggiornata a 3 persone per Vitale, venerdì alle 21:00.

**Tool calls made** (4):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-07-31",
      "ora": "21:00",
      "persone": 2
    }
  },
  {
    "name": "crea_prenotazione",
    "args": {
      "nome": "Vitale",
      "data": "2026-07-31",
      "ora": "21:00",
      "persone": 2,
      "note": ""
    }
  },
  {
    "name": "trova_prenotazione",
    "args": {
      "nome": "Vitale",
      "data": "2026-07-31"
    }
  },
  {
    "name": "modifica_prenotazione",
    "args": {
      "nome": "Vitale",
      "data": "2026-07-31",
      "ora": "21:00",
      "persone": 3
    }
  }
]
```

**Duration**: 33931ms

---

### B06-019 — `entity-capture`
**Description**: Cliente dà solo il nome, poi il cognome nel turno successivo

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":2,"nome":"Giorgio Bianchi"} not found. Actual: [{"name":"controlla_disponibilita","args":{"data":"2026-07-31","ora":"21:00","persone":2}},{"name":"crea_prenotazione","args":{"nome":"Giorgio","data":"2026-07-31","ora":"21:00","persone":2,"note":""}},{"name":"trova_prenotazione","args":{"nome":"Giorgio","data":"2026-07-31"}},{"name":"modifica_prenotazione","args":{"nome":"Giorgio Bianchi"}}]

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per venerdì prossimo alle nove di sera per due persone, mi chiamo Giorgio

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Il cognome è Bianchi

**[AI reply 2]**: Perfetto, ora controllo la disponibilità per quel giorno e orario.

**[User turn 3]**: Sì confermo

**[AI reply 3]**: Prenotazione confermata: Giorgio, venerdì alle 21:00, per 2 persone. A presto!

**[AI reply 4]**: Ho la prenotazione sotto il nome Giorgio. Vuole che aggiorni il nome a “Giorgio Bianchi” prima di procedere alla modifica?

**[AI reply 5]**: Un attimo, controllo la prenotazione con il nome precedente prima di aggiornarla.

**[AI reply 6]**: Ho ricevuto l’aggiornamento, ma il sistema richiede anche data o ora per la modifica. Vuole confermare ancora: 31 luglio alle 21:00, 2 persone, così completo l’aggiornamento del nome a “Giorgio Bianchi”?

**Tool calls made** (4):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-07-31",
      "ora": "21:00",
      "persone": 2
    }
  },
  {
    "name": "crea_prenotazione",
    "args": {
      "nome": "Giorgio",
      "data": "2026-07-31",
      "ora": "21:00",
      "persone": 2,
      "note": ""
    }
  },
  {
    "name": "trova_prenotazione",
    "args": {
      "nome": "Giorgio",
      "data": "2026-07-31"
    }
  },
  {
    "name": "modifica_prenotazione",
    "args": {
      "nome": "Giorgio Bianchi"
    }
  }
]
```

**Duration**: 23587ms

---

### B06-030 — `entity-capture`
**Description**: Cliente dà informazioni sparse in molti turni

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":2,"nome":"Amato"} not found. Actual: [] | reply must contain 'Amato' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Perfetto. Mi serve un nome per la prenotazione, e poi dirmi data, ora e numero di persone. Perfetto, per venerdì prossi

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Per venerdì prossimo

**[AI reply 2]**: Perfetto. Mi serve un nome per la prenotazione, e poi dirmi data, ora e numero di persone.

**[User turn 3]**: Alle nove di sera

**[AI reply 3]**: Perfetto, per venerdì prossimo. A che ora vuole prenotare (hh:mm)?

**[User turn 4]**: Due persone

**[AI reply 4]**: Perfetto, alle 21:00 di venerdì prossimo va bene. Quanti siete e che nome posso usare?

**[User turn 5]**: A nome Amato

**[AI reply 5]**: Perfetto. Per completare la prenotazione, mi serve un nome da usare, anche solo il cognome va bene.

**[User turn 6]**: Sì confermo

**Tool calls made** (0):
```json
[]
```

**Duration**: 7805ms

---

