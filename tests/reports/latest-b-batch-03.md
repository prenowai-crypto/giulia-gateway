# Batch B-03 (tests 101-150)
Run: 2026-08-07T12:26:23.893Z | Model: gpt-realtime-2.1-mini | Total: 50 | Passed: 40 (80%) | Failed: 10

## ✅ Passed (40)

- **B05-009** `datetime-parsing`: 'weekend prossimo' — ambiguo (sabato o domenica?) deve chiedere (2941ms, 0 tool calls)
- **B05-010** `datetime-parsing`: 'primo venerdì di agosto' — 7 agosto 2026 (21270ms, 2 tool calls)
- **B05-011** `datetime-parsing`: Orario 'le nove di sera' = 21:00 (18841ms, 2 tool calls)
- **B05-012** `datetime-parsing`: Orario 'le 21 e mezza' = 21:30 (15854ms, 2 tool calls)
- **B05-014** `datetime-parsing`: Orario 'le 22 in punto' (21201ms, 2 tool calls)
- **B05-015** `datetime-parsing`: Orario 'le 21 e un quarto' = 21:15 (16346ms, 2 tool calls)
- **B05-016** `datetime-parsing`: 'le nove' senza mattina/sera — di mattino chiuso, deve dedurre sera o chiedere (20776ms, 2 tool calls)
- **B05-017** `datetime-parsing`: 'verso le 21' — accetta 21:00 come approssimazione (18478ms, 2 tool calls)
- **B05-018** `datetime-parsing`: Orario impossibile 'alle 25' — deve segnalare errore e chiedere chiarimento (2055ms, 0 tool calls)
- **B05-019** `datetime-parsing`: 'un attimo prima della chiusura' — deve proporre 22:30 (20563ms, 2 tool calls)
- **B05-023** `datetime-parsing`: Ferragosto — cliente dice 'il 15 agosto' esplicito, sabato, deve accettare (15104ms, 2 tool calls)
- **B05-024** `datetime-parsing`: Espressione festivo 'Ferragosto' senza data esplicita (17466ms, 2 tool calls)
- **B05-027** `datetime-parsing`: Cliente cambia giorno mid-conversation (19963ms, 3 tool calls)
- **B05-028** `datetime-parsing`: 'nel weekend' senza specificare giorno — deve chiedere sabato o domenica (1916ms, 0 tool calls)
- **B06-001** `entity-capture`: Cognome con apostrofo — D'Angelo (15239ms, 2 tool calls)
- **B06-002** `entity-capture`: Cognome composto — De Luca (16515ms, 2 tool calls)
- **B06-003** `entity-capture`: Nome e cognome — deve catturare entrambi (18006ms, 2 tool calls)
- **B06-004** `entity-capture`: Cognome straniero (tedesco) — Schneider (17327ms, 2 tool calls)
- **B06-005** `entity-capture`: Cliente compita il cognome lettera per lettera (18655ms, 2 tool calls)
- **B06-006** `entity-capture`: Cliente si corregge sul cognome (18415ms, 2 tool calls)
- **B06-007** `entity-capture`: Persone dette come 'siamo in quattro' (18239ms, 2 tool calls)
- **B06-008** `entity-capture`: Persone dette come 'io e mia moglie' → 2 persone (25791ms, 2 tool calls)
- **B06-009** `entity-capture`: Persone come 'una famiglia di cinque' → 5 (15855ms, 2 tool calls)
- **B06-010** `entity-capture`: Persone come 'in coppia' → 2 (15861ms, 2 tool calls)
- **B06-011** `entity-capture`: Persone come 'in tre coppie' → 6 (18122ms, 2 tool calls)
- **B06-012** `entity-capture`: Cliente si corregge sul numero di persone (18142ms, 2 tool calls)
- **B06-013** `entity-capture`: Cliente aggiunge nota — allergia (20181ms, 2 tool calls)
- **B06-014** `entity-capture`: Cliente aggiunge nota — seggiolone per bambino (17382ms, 2 tool calls)
- **B06-015** `entity-capture`: Cliente chiede tavolo esterno (22093ms, 2 tool calls)
- **B06-016** `entity-capture`: Nota compleanno (15095ms, 2 tool calls)
- **B06-017** `entity-capture`: Nome con particella nobiliare — Della Valle (17642ms, 2 tool calls)
- **B06-018** `entity-capture`: Nome doppio — Maria Chiara Neri (19137ms, 2 tool calls)
- **B06-020** `entity-capture`: Cliente dà solo il cognome quando gli si chiede il nome (18743ms, 2 tool calls)
- **B06-021** `entity-capture`: Cognome fonicamente ambiguo — cliente ripete e conferma (19897ms, 2 tool calls)
- **B06-022** `entity-capture`: Nome tipicamente ambiguo al telefono — Villa vs Villani (21918ms, 2 tool calls)
- **B06-023** `entity-capture`: Cliente dice tutto in un turno — persone, ora, nome, nota (19639ms, 2 tool calls)
- **B06-024** `entity-capture`: Cliente dà nome mentre parla di altro — deve estrarlo comunque (23408ms, 2 tool calls)
- **B06-025** `entity-capture`: Doppia richiesta — allergia + tavolo lontano dalla porta (20511ms, 2 tool calls)
- **B06-026** `entity-capture`: Cliente aggiunge la nota DOPO la conferma iniziale (20001ms, 2 tool calls)
- **B06-027** `entity-capture`: Cliente ha un nome tipicamente maschile ma è donna che prenota per marito — cattura correttamente (16840ms, 2 tool calls)

## ❌ Failed (10)

### B05-008 — `datetime-parsing`
**Description**: 'dopodomani' — mercoledì 29/07

**Reason**: reply must contain 'mercoledì' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Perfetto, ricapitolando: dopodomani, 9 agosto, alle 13:00, per 2 persone, a nome Roberto Lombardi. Confermo questa pren

**Full transcript**:

**[User turn 1]**: Vorrei prenotare per dopodomani alle 13, 2 persone, a nome Roberto Lombardi

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Sì

**[AI reply 2]**: Perfetto, ricapitolando: dopodomani, 9 agosto, alle 13:00, per 2 persone, a nome Roberto Lombardi. Confermo questa prenotazione?

**[AI reply 3]**: Prenotazione confermata per Roberto Lombardi, sabato 9 agosto alle 13:00, per 2 persone. A presto!

**Tool calls made** (2):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-08-09",
      "ora": "13:00",
      "persone": 2
    }
  },
  {
    "name": "crea_prenotazione",
    "args": {
      "nome": "Roberto Lombardi",
      "data": "2026-08-09",
      "ora": "13:00",
      "persone": 2,
      "note": ""
    }
  }
]
```

**Duration**: 15006ms

---

### B05-013 — `datetime-parsing`
**Description**: Orario 'un quarto alle 22' = 21:45

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":2,"nome":"Valentina Colombo","ora":"21:45"} not found. Actual: [{"name":"controlla_disponibilita","args":{"data":"2026-08-14","ora":"22:15","persone":2}},{"name":"crea_prenotazione","args":{"nome":"Valentina Colombo","data":"2026-08-14","ora":"22:15","persone":2,"note":""}}] | reply must contain '21:45' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Perfetto, ho capito: prenotazione per venerdì 14 agosto alle 22:15, per 2 persone, a nome Valentina Colombo. Confermo? 

**Full transcript**:

**[User turn 1]**: Vorrei prenotare per venerdì prossimo un quarto alle 22, 2 persone, a nome Valentina Colombo

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Sì confermo

**[AI reply 2]**: Perfetto, ho capito: prenotazione per venerdì 14 agosto alle 22:15, per 2 persone, a nome Valentina Colombo. Confermo?

**[AI reply 3]**: Prenotazione confermata per Valentina Colombo: venerdì 14 agosto alle 22:15, per 2 persone. A presto!

**Tool calls made** (2):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-08-14",
      "ora": "22:15",
      "persone": 2
    }
  },
  {
    "name": "crea_prenotazione",
    "args": {
      "nome": "Valentina Colombo",
      "data": "2026-08-14",
      "ora": "22:15",
      "persone": 2,
      "note": ""
    }
  }
]
```

**Duration**: 16066ms

---

### B05-020 — `datetime-parsing`
**Description**: Orario 'le venti e trenta' = 20:30 — fuori orario cena (21:00-22:30)

**Reason**: reply must contain '21' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Ricapitolando: venerdì 14 agosto alle 20:30, 2 persone, a nome Beatrice Testa. Confermo questa prenotazione?

**Full transcript**:

**[User turn 1]**: Vorrei prenotare per venerdì prossimo alle venti e trenta, 2 persone, a nome Beatrice Testa

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[AI reply 2]**: Ricapitolando: venerdì 14 agosto alle 20:30, 2 persone, a nome Beatrice Testa. Confermo questa prenotazione?

**Tool calls made** (1):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-08-14",
      "ora": "20:30",
      "persone": 2
    }
  }
]
```

**Duration**: 5151ms

---

### B05-021 — `datetime-parsing`
**Description**: 'il 15' senza mese — di questo mese o del prossimo? (15 luglio è passato, deve dedurre 15 agosto o chiedere)

**Reason**: reply must contain 'mese' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Ricapitolando: 15 agosto alle 21, per 2 persone, a nome Emanuele Costa. Confermo la prenotazione?

**Full transcript**:

**[User turn 1]**: Vorrei prenotare per il 15 alle 21, 2 persone, a nome Emanuele Costa

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[AI reply 2]**: Ricapitolando: 15 agosto alle 21, per 2 persone, a nome Emanuele Costa. Confermo la prenotazione?

**Tool calls made** (1):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-08-15",
      "ora": "21:00",
      "persone": 2
    }
  }
]
```

**Duration**: 4508ms

---

### B05-022 — `datetime-parsing`
**Description**: Giorno + data incoerenti 'sabato 12 agosto' ma 12 agosto è mercoledì — deve correggere

**Reason**: reply must contain 'mercoledì' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Perfetto, ricapitolando: sabato 12 agosto alle 21, per 2 persone, a nome Simone De Luca. Confermo?

Nota: se ci sono ri

**Full transcript**:

**[User turn 1]**: Vorrei prenotare per sabato 12 agosto alle 21, 2 persone, a nome Simone De Luca

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[AI reply 2]**: Perfetto, ricapitolando: sabato 12 agosto alle 21, per 2 persone, a nome Simone De Luca. Confermo?

Nota: se ci sono richieste speciali, come una sedia alta o tavolo esterno, me lo dica pure prima di confermare.

**Tool calls made** (1):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-08-12",
      "ora": "21:00",
      "persone": 2
    }
  }
]
```

**Duration**: 3944ms

---

### B05-025 — `datetime-parsing`
**Description**: Data ambigua 'il 3' e oggi 27/07 — 3 agosto (lunedì, chiuso!) → deve dire chiuso e proporre alternativa

**Reason**: reply must contain 'chius' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Perfetto, ho capito: una prenotazione per il 3 settembre alle 21, per 2 persone, a nome Matteo Barbieri. Confermo prima

**Full transcript**:

**[User turn 1]**: Vorrei prenotare per il 3 alle 21, 2 persone, a nome Matteo Barbieri

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[AI reply 2]**: Perfetto, ho capito: una prenotazione per il 3 settembre alle 21, per 2 persone, a nome Matteo Barbieri. Confermo prima di registrarla?

**Tool calls made** (1):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-09-03",
      "ora": "21:00",
      "persone": 2
    }
  }
]
```

**Duration**: 6613ms

---

### B05-026 — `datetime-parsing`
**Description**: Cliente cambia ora mid-conversation

**Reason**: reply must contain '22:00' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Perfetto. Ho capito: venerdì 14 agosto alle 21, per 2 persone, a nome Riccardo Grasso. Confermo questo riassunto? Certo

**Full transcript**:

**[User turn 1]**: Vorrei prenotare per venerdì prossimo alle 21, 2 persone, a nome Riccardo Grasso

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Aspetta, cambio: alle 22 invece

**[AI reply 2]**: Perfetto. Ho capito: venerdì 14 agosto alle 21, per 2 persone, a nome Riccardo Grasso. Confermo questo riassunto?

**[User turn 3]**: Sì confermo

**[AI reply 3]**: Certo. Ricapitulando: sempre venerdì 14 agosto, 2 persone, a nome Riccardo Grasso, ma spostiamo l’orario alle 22. Confermo così?

**[AI reply 4]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? (translation disclosure already established earlier; now proceeding to create booking.)

**[AI reply 5]**: Prenotazione confermata: Riccardo Grasso, venerdì 14 agosto alle 22, per 2 persone. A presto!

**Tool calls made** (3):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-08-14",
      "ora": "21:00",
      "persone": 2
    }
  },
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-08-14",
      "ora": "22:00",
      "persone": 2
    }
  },
  {
    "name": "crea_prenotazione",
    "args": {
      "nome": "Riccardo Grasso",
      "data": "2026-08-14",
      "ora": "22:00",
      "persone": 2,
      "note": ""
    }
  }
]
```

**Duration**: 19828ms

---

### B05-029 — `datetime-parsing`
**Description**: Data spelling 'il primo di agosto' — 1 agosto = sabato (SEED PIENO, deve gestire slot pieno o venerdì)

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":2,"nome":"Cristina Mancini"} not found. Actual: []

**Full transcript**:

**[User turn 1]**: Vorrei prenotare per il primo di agosto alle 13, 2 persone, a nome Cristina Mancini

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Sì confermo

**[AI reply 2]**: Certo, posso aiutarla. Le segnalo che il “primo di agosto” è già passato rispetto ad oggi.  
Vuole prenotare per una nuova data futura?  
Appena mi dà un giorno successivo (oppure un’altra data precisa), lo verifico e le preparo la conferma.

**[AI reply 3]**: Sì, grazie. Solo per essere sicura: la sua prenotazione precedente era “1° agosto alle 13” per 2 persone, a nome Cristina Mancini, ma quella data è già passata.  

Conferma che vuole prenotare per una nuova data futura e mi dica il giorno e l’orario, così controllo la disponibilità e procediamo.

**Tool calls made** (0):
```json
[]
```

**Duration**: 2975ms

---

### B05-030 — `datetime-parsing`
**Description**: Orario 24h vs 12h 'alle 9 di mattina' — colazione non serviamo, deve dire fuori orario

**Reason**: reply must contain '12' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

Perfetto, ricapitulando: venerdì 14 a

**Full transcript**:

**[User turn 1]**: Vorrei prenotare per venerdì prossimo alle 9 di mattina, 2 persone, a nome Marco Salvatori

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[AI reply 2]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

Perfetto, ricapitulando: venerdì 14 agosto alle 9, per 2 persone, a nome Marco Salvatori. Confermo la prenotazione?

**Tool calls made** (1):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-08-14",
      "ora": "09:00",
      "persone": 2
    }
  }
]
```

**Duration**: 4855ms

---

### B06-019 — `entity-capture`
**Description**: Cliente dà solo il nome, poi il cognome nel turno successivo

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":2,"nome":"Giorgio Bianchi"} not found. Actual: [{"name":"controlla_disponibilita","args":{"data":"2026-08-14","ora":"21:00","persone":2}},{"name":"trova_prenotazione","args":{"nome":"Giorgio","data":"2026-08-14"}}]

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per venerdì prossimo alle nove di sera per due persone, mi chiamo Giorgio

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Il cognome è Bianchi

**[AI reply 2]**: Ok, verifichiamo la disponibilità per quel venerdì sera con due persone.

**[User turn 3]**: Sì confermo

**[AI reply 3]**: Perfetto, ho capito. Venerdì 14 agosto alle 21, per 2 persone, a nome Giorgio. Confermo?

**[AI reply 4]**: Va bene, faccio una verifica della prenotazione esistente con il nome indicato prima, così possiamo aggiornare correttamente.

**[AI reply 5]**: Grazie per la correzione. Per registrare la prenotazione, però, ho bisogno del nome completo così come lo vuole inserito, non solo il cognome.

Ricapitolando: venerdì 14 agosto alle 21, per 2 persone. Con il solo cognome Bianchi non posso completarla, perché il nome potrebbe essere “Giorgio Bianchi” o altro.

Mi dia il nome completo, oppure lo corregga, e poi ricapitoliamo insieme e confermo la prenotazione.

**[AI reply 6]**: Ok, grazie. Ma l’ultima conferma riguarda una prenotazione con nome “Giorgio” o “Bianchi”? Per completare la prenotazione ho bisogno del nome completo così come lo vuole inserire.

Ora hai detto “confermo”, ma non abbiamo ancora deciso se il nome da usare è “Giorgio” o “Bianchi” (o impieghi entrambi nel formato completo).

Ricapitolando: venerdì 14 agosto alle 21, per 2 persone. Dimmi il nome completo, o la forma precisa da usare, e poi confermiamo subito.

**Tool calls made** (2):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-08-14",
      "ora": "21:00",
      "persone": 2
    }
  },
  {
    "name": "trova_prenotazione",
    "args": {
      "nome": "Giorgio",
      "data": "2026-08-14"
    }
  }
]
```

**Duration**: 13403ms

---

