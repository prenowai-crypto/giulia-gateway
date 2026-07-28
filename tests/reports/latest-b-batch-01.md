# Batch B-01 (tests 1-30)
Run: 2026-07-28T03:33:18.078Z | Model: gpt-realtime-2.1-mini | Total: 30 | Passed: 20 (67%) | Failed: 10

## ✅ Passed (20)

- **B05-001** `datetime-parsing`: Data formato numerico europeo 'gg/mm' → deve risolvere correttamente (17827ms, 2 tool calls)
- **B05-002** `datetime-parsing`: Data formato numerico completo 'gg/mm/aaaa' (17446ms, 2 tool calls)
- **B05-003** `datetime-parsing`: Data testuale 'il 31 luglio' (15955ms, 2 tool calls)
- **B05-005** `datetime-parsing`: Data formato ISO 'aaaa-mm-gg' (20162ms, 2 tool calls)
- **B05-009** `datetime-parsing`: 'weekend prossimo' — ambiguo (sabato o domenica?) deve chiedere (3543ms, 0 tool calls)
- **B05-010** `datetime-parsing`: 'primo venerdì di agosto' — 7 agosto 2026 (16486ms, 2 tool calls)
- **B05-011** `datetime-parsing`: Orario 'le nove di sera' = 21:00 (16135ms, 2 tool calls)
- **B05-012** `datetime-parsing`: Orario 'le 21 e mezza' = 21:30 (19307ms, 2 tool calls)
- **B05-013** `datetime-parsing`: Orario 'un quarto alle 22' = 21:45 (16575ms, 2 tool calls)
- **B05-014** `datetime-parsing`: Orario 'le 22 in punto' (18295ms, 2 tool calls)
- **B05-015** `datetime-parsing`: Orario 'le 21 e un quarto' = 21:15 (28031ms, 2 tool calls)
- **B05-016** `datetime-parsing`: 'le nove' senza mattina/sera — di mattino chiuso, deve dedurre sera o chiedere (16084ms, 2 tool calls)
- **B05-017** `datetime-parsing`: 'verso le 21' — accetta 21:00 come approssimazione (17553ms, 2 tool calls)
- **B05-019** `datetime-parsing`: 'un attimo prima della chiusura' — deve proporre 22:30 (18530ms, 2 tool calls)
- **B05-021** `datetime-parsing`: 'il 15' senza mese — di questo mese o del prossimo? (15 luglio è passato, deve dedurre 15 agosto o chiedere) (2747ms, 0 tool calls)
- **B05-023** `datetime-parsing`: Ferragosto — cliente dice 'il 15 agosto' esplicito, sabato, deve accettare (36574ms, 4 tool calls)
- **B05-025** `datetime-parsing`: Data ambigua 'il 3' e oggi 27/07 — 3 agosto (lunedì, chiuso!) → deve dire chiuso e proporre alternativa (3738ms, 0 tool calls)
- **B05-027** `datetime-parsing`: Cliente cambia giorno mid-conversation (36742ms, 4 tool calls)
- **B05-028** `datetime-parsing`: 'nel weekend' senza specificare giorno — deve chiedere sabato o domenica (2067ms, 0 tool calls)
- **B05-029** `datetime-parsing`: Data spelling 'il primo di agosto' — 1 agosto = sabato (SEED PIENO, deve gestire slot pieno o venerdì) (15342ms, 2 tool calls)

## ❌ Failed (10)

### B05-004 — `datetime-parsing`
**Description**: Data solo giorno del mese 'il 5' senza mese — deve chiedere chiarimento

**Reason**: forbidden tool call 'crea_prenotazione' was made | reply must contain 'mese' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Ok, controllo la disponibilità per quell’orario e gruppo, un attimo. Prenotazione confermata: Sara Neri, 5 agosto alle 

**Full transcript**:

**[User turn 1]**: Vorrei prenotare per il 5 alle 21, 2 persone, a nome Sara Neri

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[AI reply 2]**: Ok, controllo la disponibilità per quell’orario e gruppo, un attimo.

**[AI reply 3]**: Prenotazione confermata: Sara Neri, 5 agosto alle 21:00, per 2 persone. A presto!

**Tool calls made** (2):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-08-05",
      "ora": "21:00",
      "persone": 2
    }
  },
  {
    "name": "crea_prenotazione",
    "args": {
      "nome": "Sara Neri",
      "data": "2026-08-05",
      "ora": "21:00",
      "persone": 2,
      "note": ""
    }
  }
]
```

**Duration**: 16300ms

---

### B05-006 — `datetime-parsing`
**Description**: Espressione relativa 'tra tre giorni' — oggi è lunedì 27/07, tra 3 giorni = giovedì 30/07

**Reason**: reply must contain 'giovedì' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Un attimo, controllo la disponibilità per quella data e orario. prenotazione confermata per Elena Ferri, venerdì 31 lug

**Full transcript**:

**[User turn 1]**: Vorrei prenotare tra tre giorni alle 21, 2 persone, a nome Elena Ferri

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Sì confermo

**[AI reply 2]**: Un attimo, controllo la disponibilità per quella data e orario.

**[AI reply 3]**: prenotazione confermata per Elena Ferri, venerdì 31 luglio alle 21:00, per 2 persone. A presto!

**[AI reply 4]**: Perfetto, grazie! La prenotazione è già registrata. A presto!

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
      "nome": "Elena Ferri",
      "data": "2026-07-31",
      "ora": "21:00",
      "persone": 2,
      "note": "Prenotazione effettuata via assistente vocale automatico. Slot disponibile."
    }
  }
]
```

**Duration**: 16252ms

---

### B05-007 — `datetime-parsing`
**Description**: 'domani' — oggi lunedì 27/07, domani martedì 28/07

**Reason**: reply must contain 'martedì' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Un attimo, controllo la disponibilità per quella data e ora. Perfetto! Prenotazione confermata: Giulia Marino, domani a

**Full transcript**:

**[User turn 1]**: Vorrei prenotare per domani alle 21, 2 persone, a nome Giulia Marino

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Sì confermo

**[AI reply 2]**: Un attimo, controllo la disponibilità per quella data e ora.

**[AI reply 3]**: Perfetto! Prenotazione confermata: Giulia Marino, domani alle 21:00, per 2 persone. A presto!

**[AI reply 4]**: Perfetto, grazie mille! La prenotazione è confermata. A presto!

**Tool calls made** (2):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-07-29",
      "ora": "21:00",
      "persone": 2
    }
  },
  {
    "name": "crea_prenotazione",
    "args": {
      "nome": "Giulia Marino",
      "data": "2026-07-29",
      "ora": "21:00",
      "persone": 2,
      "note": ""
    }
  }
]
```

**Duration**: 14321ms

---

### B05-008 — `datetime-parsing`
**Description**: 'dopodomani' — mercoledì 29/07

**Reason**: reply must contain 'mercoledì' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Un attimo, controllo la disponibilità per quella data e orario. Prenotazione confermata: Roberto Lombardi, dopodomani a

**Full transcript**:

**[User turn 1]**: Vorrei prenotare per dopodomani alle 13, 2 persone, a nome Roberto Lombardi

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Sì

**[AI reply 2]**: Un attimo, controllo la disponibilità per quella data e orario.

**[AI reply 3]**: Prenotazione confermata: Roberto Lombardi, dopodomani alle 13:00, per 2 persone. A presto!

**[AI reply 4]**: Perfetto, a presto! Buona giornata e grazie per la prenotazione.

**Tool calls made** (2):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-07-30",
      "ora": "13:00",
      "persone": 2
    }
  },
  {
    "name": "crea_prenotazione",
    "args": {
      "nome": "Roberto Lombardi",
      "data": "2026-07-30",
      "ora": "13:00",
      "persone": 2,
      "note": "Prenotazione telefonica tramite assistente vocale."
    }
  }
]
```

**Duration**: 18372ms

---

### B05-018 — `datetime-parsing`
**Description**: Orario impossibile 'alle 25' — deve segnalare errore e chiedere chiarimento

**Reason**: reply must contain 'orario' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Perfetto, Nicola. Venerdì prossimo vale il 31 luglio. A che ora vorrebbe prenotare, ad esempio 12:00 o 21:00?

**Full transcript**:

**[User turn 1]**: Vorrei prenotare per venerdì prossimo alle 25, 2 persone, a nome Nicola Basile

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[AI reply 2]**: Perfetto, Nicola. Venerdì prossimo vale il 31 luglio. A che ora vorrebbe prenotare, ad esempio 12:00 o 21:00?

**Tool calls made** (0):
```json
[]
```

**Duration**: 5272ms

---

### B05-020 — `datetime-parsing`
**Description**: Orario 'le venti e trenta' = 20:30 — fuori orario cena (21:00-22:30)

**Reason**: last reply not in 'it': mi spiace, alle 20:30 non possiamo prenotare. la cena inizia alle 21:00. vuole prenotare alle 21:00 invece?

**Full transcript**:

**[User turn 1]**: Vorrei prenotare per venerdì prossimo alle venti e trenta, 2 persone, a nome Beatrice Testa

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[AI reply 2]**: Mi spiace, alle 20:30 non possiamo prenotare. La cena inizia alle 21:00. Vuole prenotare alle 21:00 invece?

**Tool calls made** (0):
```json
[]
```

**Duration**: 1995ms

---

### B05-022 — `datetime-parsing`
**Description**: Giorno + data incoerenti 'sabato 12 agosto' ma 12 agosto è mercoledì — deve correggere

**Reason**: reply must contain 'mercoledì' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Perfetto! Il nome è Simone De Luca, per 2 persone alle 21:00.  
Però il 12 agosto non è sabato: intende sabato 12 agost

**Full transcript**:

**[User turn 1]**: Vorrei prenotare per sabato 12 agosto alle 21, 2 persone, a nome Simone De Luca

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[AI reply 2]**: Perfetto! Il nome è Simone De Luca, per 2 persone alle 21:00.  
Però il 12 agosto non è sabato: intende sabato 12 agosto o un sabato diverso?

**Tool calls made** (0):
```json
[]
```

**Duration**: 3219ms

---

### B05-024 — `datetime-parsing`
**Description**: Espressione festivo 'Ferragosto' senza data esplicita

**Reason**: reply must contain '15 agosto' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Un attimo, controllo la disponibilità per quella data e ora. Perfetto, ora procedo con la prenotazione. Prenotazione co

**Full transcript**:

**[User turn 1]**: Vorrei prenotare per Ferragosto alle 13, 2 persone, a nome Davide Fumagalli

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Sì confermo

**[AI reply 2]**: Un attimo, controllo la disponibilità per quella data e ora.

**[AI reply 3]**: Perfetto, ora procedo con la prenotazione.

**[AI reply 4]**: Prenotazione confermata per Davide Fumagalli, Ferragosto alle 13:00, per 2 persone. A presto!

**[AI reply 5]**: Perfetto, grazie per la conferma! A presto, ci vediamo al ristorante.

**Tool calls made** (2):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-08-15",
      "ora": "13:00",
      "persone": 2
    }
  },
  {
    "name": "crea_prenotazione",
    "args": {
      "nome": "Davide Fumagalli",
      "data": "2026-08-15",
      "ora": "13:00",
      "persone": 2,
      "note": "Prenotazione Ferragosto"
    }
  }
]
```

**Duration**: 16091ms

---

### B05-026 — `datetime-parsing`
**Description**: Cliente cambia ora mid-conversation

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":2,"nome":"Riccardo Grasso","ora":"22:00"} not found. Actual: [{"name":"controlla_disponibilita","args":{"data":"2026-07-31","ora":"21:00","persone":2}},{"name":"controlla_disponibilita","args":{"data":"2026-07-31","ora":"21:00","persone":2}},{"name":"crea_prenotazione","args":{"nome":"Riccardo Grasso","data":"2026-07-31","ora":"21:00","persone":2,"note":""}},{"name":"trova_prenotazione","args":{"nome":"Riccardo Grasso","data":"2026-07-31"}},{"name":"modifica_prenotazione","args":{"nome":"Riccardo Grasso","data":"2026-07-31","ora":"22:00"}}]

**Full transcript**:

**[User turn 1]**: Vorrei prenotare per venerdì prossimo alle 21, 2 persone, a nome Riccardo Grasso

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Aspetta, cambio: alle 22 invece

**[AI reply 2]**: Un attimo, controllo la disponibilità per quel venerdì alle 21.

**[User turn 3]**: Sì confermo

**[AI reply 3]**: Un attimo, riprovo la verifica della disponibilità.

**[AI reply 4]**: Prenotazione confermata: Riccardo Grasso, venerdì 31 luglio alle 21:00, per 2 persone. A presto!

**[AI reply 5]**: Un attimo, controllo la prenotazione e poi la aggiorno.

**[AI reply 6]**: Perfetto, aggiornata la prenotazione: Riccardo Grasso, venerdì 31 luglio alle 22:00, per 2 persone. A presto!

**[AI reply 7]**: Perfetto, confermato. Ti aspettiamo venerdì alle 22:00.

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
      "nome": "Riccardo Grasso",
      "data": "2026-07-31",
      "ora": "21:00",
      "persone": 2,
      "note": ""
    }
  },
  {
    "name": "trova_prenotazione",
    "args": {
      "nome": "Riccardo Grasso",
      "data": "2026-07-31"
    }
  },
  {
    "name": "modifica_prenotazione",
    "args": {
      "nome": "Riccardo Grasso",
      "data": "2026-07-31",
      "ora": "22:00"
    }
  }
]
```

**Duration**: 40514ms

---

### B05-030 — `datetime-parsing`
**Description**: Orario 24h vs 12h 'alle 9 di mattina' — colazione non serviamo, deve dire fuori orario

**Reason**: last reply not in 'it': per quell’orario siamo in pausa. per pranzo è possibile tra le 12:00 e le 14:30; oppure cena alle 21:00. quale preferisce?

**Full transcript**:

**[User turn 1]**: Vorrei prenotare per venerdì prossimo alle 9 di mattina, 2 persone, a nome Marco Salvatori

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[AI reply 2]**: Per quell’orario siamo in pausa. Per pranzo è possibile tra le 12:00 e le 14:30; oppure cena alle 21:00. Quale preferisce?

**Tool calls made** (0):
```json
[]
```

**Duration**: 3265ms

---

