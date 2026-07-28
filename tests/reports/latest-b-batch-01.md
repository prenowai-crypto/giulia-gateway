# Batch B-01 (tests 1-30)
Run: 2026-07-28T12:11:07.455Z | Model: gpt-realtime-2.1-mini | Total: 30 | Passed: 18 (60%) | Failed: 12

## ✅ Passed (18)

- **B06-001** `entity-capture`: Cognome con apostrofo — D'Angelo (26605ms, 2 tool calls)
- **B06-002** `entity-capture`: Cognome composto — De Luca (19769ms, 2 tool calls)
- **B06-003** `entity-capture`: Nome e cognome — deve catturare entrambi (15915ms, 2 tool calls)
- **B06-004** `entity-capture`: Cognome straniero (tedesco) — Schneider (17975ms, 2 tool calls)
- **B06-007** `entity-capture`: Persone dette come 'siamo in quattro' (16427ms, 2 tool calls)
- **B06-008** `entity-capture`: Persone dette come 'io e mia moglie' → 2 persone (17757ms, 2 tool calls)
- **B06-009** `entity-capture`: Persone come 'una famiglia di cinque' → 5 (17753ms, 2 tool calls)
- **B06-010** `entity-capture`: Persone come 'in coppia' → 2 (14210ms, 2 tool calls)
- **B06-013** `entity-capture`: Cliente aggiunge nota — allergia (17138ms, 2 tool calls)
- **B06-014** `entity-capture`: Cliente aggiunge nota — seggiolone per bambino (20336ms, 2 tool calls)
- **B06-015** `entity-capture`: Cliente chiede tavolo esterno (18448ms, 2 tool calls)
- **B06-017** `entity-capture`: Nome con particella nobiliare — Della Valle (29402ms, 2 tool calls)
- **B06-018** `entity-capture`: Nome doppio — Maria Chiara Neri (35367ms, 3 tool calls)
- **B06-021** `entity-capture`: Cognome fonicamente ambiguo — cliente ripete e conferma (40293ms, 5 tool calls)
- **B06-022** `entity-capture`: Nome tipicamente ambiguo al telefono — Villa vs Villani (32748ms, 5 tool calls)
- **B06-023** `entity-capture`: Cliente dice tutto in un turno — persone, ora, nome, nota (20455ms, 2 tool calls)
- **B06-027** `entity-capture`: Cliente ha un nome tipicamente maschile ma è donna che prenota per marito — cattura correttamente (20693ms, 2 tool calls)
- **B06-030** `entity-capture`: Cliente dà informazioni sparse in molti turni (21175ms, 2 tool calls)

## ❌ Failed (12)

### B06-005 — `entity-capture`
**Description**: Cliente compita il cognome lettera per lettera

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":2,"nome":"Ceccarelli"} not found. Actual: [] | reply must contain 'Ceccarelli' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Perfetto! Per venerdì prossimo alle 21:00, due persone.  
Ho bisogno del nome della persona per la prenotazione. Come s

**Full transcript**:

**[User turn 1]**: Vorrei prenotare per venerdì prossimo alle nove di sera, due persone

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Il cognome è Ceccarelli: CI, E, CI, CI, A, ERRE, E, ELLE, ELLE, I

**[AI reply 2]**: Perfetto! Per venerdì prossimo alle 21:00, due persone.  
Ho bisogno del nome della persona per la prenotazione. Come si chiama?

**[User turn 3]**: Sì confermo

**[AI reply 3]**: Perfetto, grazie per il cognome Ci… mi serve il nome di persona per la prenotazione.  
Come si chiama la persona a cui intestare la prenotazione, nome o cognome?

**[AI reply 4]**: Ok, grazie per la conferma!  
Mi serve però un nome di persona per la prenotazione, non solo il cognome.  
Come si chiama la persona a cui devo intestarla?

**Tool calls made** (0):
```json
[]
```

**Duration**: 3681ms

---

### B06-006 — `entity-capture`
**Description**: Cliente si corregge sul cognome

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":2,"nome":"Russo"} not found. Actual: [{"name":"controlla_disponibilita","args":{"data":"2026-07-31","ora":"21:00","persone":2}},{"name":"crea_prenotazione","args":{"nome":"Rossi","data":"2026-07-31","ora":"21:00","persone":2,"note":"Prenotazione per 2 persone alle 21:00."}},{"name":"trova_prenotazione","args":{"nome":"Rossi","data":"2026-07-31"}},{"name":"modifica_prenotazione","args":{"nome":"Russo"}},{"name":"modifica_prenotazione","args":{"nome":"Russo"}},{"name":"modifica_prenotazione","args":{"nome":"Russo","data":"2026-07-31","ora":"21:00","persone":2,"note":"Correzione nome: da Rossi a Russo."}}]

**Full transcript**:

**[User turn 1]**: Vorrei prenotare per venerdì prossimo alle nove di sera, due persone, a nome Rossi

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Aspetta, ho sbagliato, è Russo con la U

**[AI reply 2]**: Un attimo, controllo la disponibilità per quella data, ora e numero di persone.

**[User turn 3]**: Sì confermo

**[AI reply 3]**: Perfetto! La prenotazione è confermata a nome Rossi, venerdì alle 21:00, per 2 persone. A presto!

**[AI reply 4]**: Capito, grazie per la correzione. Un attimo, verifico la prenotazione e la aggiorno.

**[AI reply 5]**: Un attimo, riprendo i dati e aggiorno solo il nome.

**[AI reply 6]**: Sono spiacente, il tentativo di aggiornare il nome non è riuscito perché mancano data e ora nel contesto.  

Puoi dirmi nuovamente la data e l’orario? Oppure confermare che la prenotazione è già per venerdì alle 21:00.

**[AI reply 7]**: Perfetto, allora aggiorno la prenotazione mantenendo data e ora già confermate.

**[AI reply 8]**: A posto! Ho aggiornato la prenotazione a nome Russo, sempre per venerdì alle 21:00, per 2 persone.

**Tool calls made** (6):
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
      "note": "Prenotazione per 2 persone alle 21:00."
    }
  },
  {
    "name": "trova_prenotazione",
    "args": {
      "nome": "Rossi",
      "data": "2026-07-31"
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
      "nome": "Russo"
    }
  },
  {
    "name": "modifica_prenotazione",
    "args": {
      "nome": "Russo",
      "data": "2026-07-31",
      "ora": "21:00",
      "persone": 2,
      "note": "Correzione nome: da Rossi a Russo."
    }
  }
]
```

**Duration**: 36851ms

---

### B06-011 — `entity-capture`
**Description**: Persone come 'in tre coppie' → 6

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":6,"nome":"Ricci"} not found. Actual: []

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per venerdì prossimo alle nove di sera, saremo tre coppie, a nome Ricci

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Sì confermo

**[AI reply 2]**: Perfetto. Posso avere il nome della persona a cui intestare la prenotazione?

**[AI reply 3]**: Perfetto, grazie. "Ricci" è sufficiente come nome da solo, o mi serve anche il nome completo della persona a cui intestare la prenotazione?

**Tool calls made** (0):
```json
[]
```

**Duration**: 7444ms

---

### B06-012 — `entity-capture`
**Description**: Cliente si corregge sul numero di persone

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":3,"nome":"Vitale"} not found. Actual: [] | reply must contain 'Vitale' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Perfetto, per due persone alle 21:00 va bene. Ho bisogno del nome completo a cui intestare la prenotazione, non solo il

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per venerdì prossimo alle nove di sera, due persone, a nome Vitale

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Aspetta, siamo in tre in realtà

**[AI reply 2]**: Perfetto, per due persone alle 21:00 va bene. Ho bisogno del nome completo a cui intestare la prenotazione, non solo il cognome.

**[User turn 3]**: Sì confermo

**[AI reply 3]**: Capisco, siamo in tre. Ho bisogno del nome completo della persona a cui intestare la prenotazione, nome e cognome.

**[AI reply 4]**: Perfetto, confermato il gruppo di 3. Mi serve però il nome completo: come si chiama la prenotazione, nome e cognome?

**Tool calls made** (0):
```json
[]
```

**Duration**: 5581ms

---

### B06-016 — `entity-capture`
**Description**: Nota compleanno

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":4,"nome":"Fabbri"} not found. Actual: [] | reply must contain 'compleanno' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Perfetto, grazie. A che nome devo intestare la prenotazione, nome e cognome? Perfetto, grazie. Mi serve ancora il nome 

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per venerdì prossimo alle nove di sera, quattro persone, a nome Fabbri. È il compleanno di mia figlia

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Sì confermo

**[AI reply 2]**: Perfetto, grazie. A che nome devo intestare la prenotazione, nome e cognome?

**[AI reply 3]**: Perfetto, grazie. Mi serve ancora il nome completo a cui intestare la prenotazione.

**Tool calls made** (0):
```json
[]
```

**Duration**: 4080ms

---

### B06-019 — `entity-capture`
**Description**: Cliente dà solo il nome, poi il cognome nel turno successivo

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":2,"nome":"Giorgio Bianchi"} not found. Actual: [{"name":"controlla_disponibilita","args":{"data":"2026-07-31","ora":"21:00","persone":2}},{"name":"crea_prenotazione","args":{"nome":"Giorgio","data":"2026-07-31","ora":"21:00","persone":2,"note":"Prenotazione standard per 2 persone, richiesta vocale."}},{"name":"trova_prenotazione","args":{"nome":"Giorgio","data":"2026-07-31"}},{"name":"modifica_prenotazione","args":{"nome":"Bianchi","data":"2026-07-31","ora":"21:00","persone":2,"note":"Aggiornamento cognome: prenotazione precedente a nome Giorgio, ora intestata a Bianchi."}}]

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per venerdì prossimo alle nove di sera per due persone, mi chiamo Giorgio

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Il cognome è Bianchi

**[AI reply 2]**: Perfetto, controllerò la disponibilità per quella data e ora. Un attimo.

**[User turn 3]**: Sì confermo

**[AI reply 3]**: Prenotazione confermata: Giorgio, venerdì 31 luglio alle 21:00 per 2 persone. A presto!

**[AI reply 4]**: Un attimo, recupero la prenotazione per controllare il nome.

**[AI reply 5]**: Perfetto, il cognome è aggiornato. La prenotazione resta confermata: Bianchi, venerdì alle 21:00 per 2 persone.

**[AI reply 6]**: Perfetto, grazie mille! La prenotazione è confermata a nome Bianchi, venerdì alle 21:00 per 2 persone.

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
      "note": "Prenotazione standard per 2 persone, richiesta vocale."
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
      "nome": "Bianchi",
      "data": "2026-07-31",
      "ora": "21:00",
      "persone": 2,
      "note": "Aggiornamento cognome: prenotazione precedente a nome Giorgio, ora intestata a Bianchi."
    }
  }
]
```

**Duration**: 25420ms

---

### B06-020 — `entity-capture`
**Description**: Cliente dà solo il cognome quando gli si chiede il nome

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":2,"nome":"Ferrari"} not found. Actual: [] | reply must contain 'Ferrari' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Perfetto, venerdì prossimo alle 21:00 è possibile per due persone. Che nome devo mettere sulla prenotazione? Mi serve i

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per venerdì prossimo alle nove di sera per due persone

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: A nome Ferrari

**[AI reply 2]**: Perfetto, venerdì prossimo alle 21:00 è possibile per due persone. Che nome devo mettere sulla prenotazione?

**[User turn 3]**: Sì confermo

**[AI reply 3]**: Mi serve il nome completo per la prenotazione, non solo il cognome. Qual è il nome della persona?

**[AI reply 4]**: Perfetto. Mi serve però il nome completo: per registrare la prenotazione, come si chiama la persona?

**Tool calls made** (0):
```json
[]
```

**Duration**: 4286ms

---

### B06-024 — `entity-capture`
**Description**: Cliente dà nome mentre parla di altro — deve estrarlo comunque

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":2,"nome":"Esposito"} not found. Actual: []

**Full transcript**:

**[User turn 1]**: Buonasera, allora sarebbe per venerdì prossimo, poi vediamo se veniamo in due o tre, comunque a nome Esposito

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Diciamo due

**[AI reply 2]**: Capisco, prenotazione a nome Esposito. Mi serve però il nome proprio della persona — Esposito è un cognome.

**[User turn 3]**: Alle nove di sera

**[AI reply 3]**: Perfetto, abbiamo due persone.  
Mi serve ancora il nome proprio della persona a cui intestare la prenotazione, e l’orario — a che ora vuole per venerdì prossimo?

**[User turn 4]**: Sì confermo

**[AI reply 4]**: Ottimo, venerdì prossimo alle 21:00 per 2 persone.  
Mi serve il nome proprio della persona — "Esposito" è un cognome. Come si chiama?

**[AI reply 5]**: Perfetto, grazie.  
Però mi serve il nome proprio della persona di cui mi ha confermato la prenotazione — es: Marco Esposito.

**Tool calls made** (0):
```json
[]
```

**Duration**: 6678ms

---

### B06-025 — `entity-capture`
**Description**: Doppia richiesta — allergia + tavolo lontano dalla porta

**Reason**: reply must contain 'celia' — got: Salve, sono l’assistente vocale automatico di Osteria Test, come posso aiutarla? Un attimo, controllo la disponibilità per quell’orario e per il numero di persone. Perfetto, procedo con la registrazio

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per venerdì prossimo alle nove di sera, due persone, a nome Sanna. Sono celiaca e se possibile un tavolo lontano dalla porta

**[AI reply 1]**: Salve, sono l’assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Sì confermo

**[AI reply 2]**: Un attimo, controllo la disponibilità per quell’orario e per il numero di persone.

**[AI reply 3]**: Perfetto, procedo con la registrazione della prenotazione.

**[AI reply 4]**: Prenotazione confermata: Sanna, venerdì alle 21:00, per 2 persone. Cercheremo di assegnare un tavolo lontano dalla porta.

**[AI reply 5]**: Perfetto, allora la prenotazione è confermata. A presto!

**Tool calls made** (2):
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
      "nome": "Sanna",
      "data": "2026-07-31",
      "ora": "21:00",
      "persone": 2,
      "note": "Clientela celiaca: richiede tavolo lontano dalla porta."
    }
  }
]
```

**Duration**: 17540ms

---

### B06-026 — `entity-capture`
**Description**: Cliente aggiunge la nota DOPO la conferma iniziale

**Reason**: reply must contain 'cane' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Perfetto, controllerò la disponibilità per quella data e ora. Prenotazione confermata: Greco, venerdì 31 luglio alle 21

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per venerdì prossimo alle nove di sera, quattro persone, a nome Greco

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Ah dimenticavo, siamo con un cane, va bene?

**[AI reply 2]**: Perfetto, controllerò la disponibilità per quella data e ora.

**[User turn 3]**: Ok grazie confermo

**[AI reply 3]**: Prenotazione confermata: Greco, venerdì 31 luglio alle 21:00, per 4 persone. A presto!

**[AI reply 4]**: Un attimo, controllo le informazioni del locale per capire la policy sugli animali.

**[AI reply 5]**: Mi dispiace, non ho informazioni sulla policy per animali. Posso aiutarti con detti prenotati o con altre richiesta?

**[AI reply 6]**: Perfetto, grazie per la conferma. La prenotazione è registrata, a presto!

**Tool calls made** (3):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-07-31",
      "ora": "21:00",
      "persone": 4
    }
  },
  {
    "name": "crea_prenotazione",
    "args": {
      "nome": "Greco",
      "data": "2026-07-31",
      "ora": "21:00",
      "persone": 4,
      "note": ""
    }
  },
  {
    "name": "info_locale",
    "args": {}
  }
]
```

**Duration**: 22280ms

---

### B06-028 — `entity-capture`
**Description**: Il cliente NON dice il nome — Giulia deve chiederlo, il cliente risponde

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":2,"nome":"Palermo"} not found. Actual: []

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per venerdì prossimo alle nove di sera per due persone

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Ah scusi, Palermo, si scrive come la città

**[AI reply 2]**: Perfetto, mi serve il nome della prenotazione. Con chi devo registrarla, per favore?

**[User turn 3]**: Sì confermo

**[AI reply 3]**: Capisco, grazie. Ho bisogno del nome personale, nome o cognome, non del nome della città — puoi ripetere il nome con cui intestare la prenotazione?

**[AI reply 4]**: Capisco, grazie. Ma "Palermo" non è un nome di persona per la prenotazione. Mi serve il nome propio, nome o cognome, con cui intestarla.

**Tool calls made** (0):
```json
[]
```

**Duration**: 4065ms

---

### B06-029 — `entity-capture`
**Description**: Cliente pronuncia il cognome in modo non chiaro — Giulia deve chiedere ripetizione

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":2,"nome":"Sciarrone"} not found. Actual: [] | last reply not in 'it': mi serve ancora il nome proprio o completo da intestare. "sciarrone" da solo non basta.

**Full transcript**:

**[User turn 1]**: Vorrei prenotare per venerdì prossimo alle nove di sera, due persone

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: A nome Sciarrone

**[AI reply 2]**: Perfetto, ho le informazioni principali: 2 persone per venerdì prossimo alle 21:00. Mi serve ancora il nome della persona da intestarla.

**[User turn 3]**: Sciarrone: esse ci a due erre o ne e

**[AI reply 3]**: Perfetto, grazie. Mi serve però il nome completo o il nome proprio della persona, non solo Sciarrone, per intestarla.

**[User turn 4]**: Sì confermo

**[AI reply 4]**: Grazie! Mi serve il nome proprio della persona, o il nome completo, in modo da intestarla correttamente. Qual è?

**[AI reply 5]**: Mi serve ancora il nome proprio o completo da intestare. "Sciarrone" da solo non basta.

**Tool calls made** (0):
```json
[]
```

**Duration**: 5086ms

---

