# Batch B-01 (tests 1-30)
Run: 2026-07-27T21:53:43.291Z | Model: gpt-realtime-2.1-mini | Total: 30 | Passed: 17 (57%) | Failed: 13

## ✅ Passed (17)

- **B04-001** `availability-edge`: Lunedì chiuso — cliente rifiutato (3013ms, 0 tool calls)
- **B04-002** `availability-edge`: Lunedì chiuso — cliente insiste, modello mantiene rifiuto (3265ms, 0 tool calls)
- **B04-003** `availability-edge`: Lunedì chiuso — cliente accetta spostare a martedì (41567ms, 3 tool calls)
- **B04-004** `availability-edge`: Lunedì chiuso — cliente accetta spostare a domenica (19350ms, 2 tool calls)
- **B04-007** `availability-edge`: Alle 11:00 — prima apertura pranzo (12:00) (2264ms, 0 tool calls)
- **B04-010** `availability-edge`: Alle 23:00 — dopo last booking (22:30) (3490ms, 0 tool calls)
- **B04-013** `availability-edge`: Data passata specifica poi correzione a futura (11 agosto = martedì aperto) (18866ms, 2 tool calls)
- **B04-014** `availability-edge`: Prenotazione last minute per domani sera (martedì aperto) (20532ms, 2 tool calls)
- **B04-021** `availability-edge`: 'ora di pranzo' — modello chiede orario, cliente specifica 13:00 (20932ms, 2 tool calls)
- **B04-023** `availability-edge`: 'presto' — ambiguo, modello deve chiedere chiarimento (2602ms, 0 tool calls)
- **B04-024** `availability-edge`: 'tarda serata' — deve proporre ultimo slot (22:30) (23217ms, 2 tool calls)
- **B04-025** `availability-edge`: 'quando aprite' — cliente chiede orario apertura, poi prenota (22965ms, 3 tool calls)
- **B04-026** `availability-edge`: Ferragosto (15 agosto) — festivo, deve accettare (17891ms, 2 tool calls)
- **B04-027** `availability-edge`: Data lontana (dicembre) — deve accettare senza problemi (17671ms, 2 tool calls)
- **B04-028** `availability-edge`: Orario borderline — esattamente 22:30 (last booking) (16707ms, 2 tool calls)
- **B04-029** `availability-edge`: OVERBOOKING sabato 21:00 pieno, cliente accetta 22:30 [SEED: 30 pax sabato prossimo 21:00] (21284ms, 3 tool calls)
- **B04-030** `availability-edge`: OVERBOOKING sabato 21:00 pieno, cliente accetta domenica [SEED: 30 pax sabato prossimo 21:00] (24241ms, 3 tool calls)

## ❌ Failed (13)

### B04-005 — `availability-edge`
**Description**: Alle 15:30 — dopo chiusura pranzo (14:30)

**Reason**: last reply not in 'it': mi dispiace, alle 15:30 non è un orario prenotabile: per pranzo l’ultimo ingresso è alle 14:30, e la cena inizia alle 21:00. vuole prenotare a pranzo 

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per venerdì prossimo alle 15:30, 2 persone, a nome Paolo Verdi

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[AI reply 2]**: Mi dispiace, alle 15:30 non è un orario prenotabile: per pranzo l’ultimo ingresso è alle 14:30, e la cena inizia alle 21:00. Vuole prenotare a pranzo tra 12:00 e 14:30, oppure a cena alle 21:00?

**Tool calls made** (0):
```json
[]
```

**Duration**: 2880ms

---

### B04-006 — `availability-edge`
**Description**: Alle 16:00 — gap tra pranzo e cena, chiuso

**Reason**: last reply not in 'it': volentieri! purtroppo il venerdì alle 16:00 è fuori orario di servizio.

per pranzo è disponibile fino alle 14:30, oppure possiamo prenotare per cena 

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per venerdì prossimo alle 16, 3 persone, a nome Chiara Neri

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[AI reply 2]**: Volentieri! Purtroppo il venerdì alle 16:00 è fuori orario di servizio.

Per pranzo è disponibile fino alle 14:30, oppure possiamo prenotare per cena tra 21:00 e 22:30. Quale orario preferisce?

**Tool calls made** (0):
```json
[]
```

**Duration**: 3102ms

---

### B04-008 — `availability-edge`
**Description**: Alle 20:00 — prima apertura cena (21:00 config reale)

**Reason**: last reply not in 'it': mi dispiace, alle 20:00 non possiamo accettare prenotazioni. vuole prenotare alle 21:00 o alle 21:30?

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per sabato prossimo alle 20, 4 persone, a nome Elena Ricci

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[AI reply 2]**: Mi dispiace, alle 20:00 non possiamo accettare prenotazioni. Vuole prenotare alle 21:00 o alle 21:30?

**Tool calls made** (0):
```json
[]
```

**Duration**: 3589ms

---

### B04-009 — `availability-edge`
**Description**: Alle 20:30 — 30 minuti prima cena, cliente accetta 21:00

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":2,"nome":"Andrea Moretti","ora":"21:00"} not found. Actual: [{"name":"controlla_disponibilita","args":{"data":"2026-08-01","ora":"21:00","persone":2}}] | reply must contain 'Moretti' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Mi dispiace, alle 20:30 non possiamo accettare prenotazioni — la cena inizia alle 21:00. Vuole prenotare per le 21:00 o | last reply not in 'it': mi spiace, il saturday alle 21:00 è già pieno. vuole provare un’altra ora valida, ad esempio 21:30?

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per sabato prossimo alle 20:30, 2 persone, a nome Andrea Moretti

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Va bene allora alle 21

**[AI reply 2]**: Mi dispiace, alle 20:30 non possiamo accettare prenotazioni — la cena inizia alle 21:00. Vuole prenotare per le 21:00 oppure per un’altra ora valida?

**[AI reply 3]**: Perfetto, controllo la disponibilità per quell’orario prima di registrare la prenotazione.

**[AI reply 4]**: Mi spiace, il Saturday alle 21:00 è già pieno. Vuole provare un’altra ora valida, ad esempio 21:30?

**Tool calls made** (1):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-08-01",
      "ora": "21:00",
      "persone": 2
    }
  }
]
```

**Duration**: 8325ms

---

### B04-011 — `availability-edge`
**Description**: Dopo 22:30 — cliente accetta anticipare a 22:00

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":2,"nome":"Roberto Greco"} not found. Actual: [{"name":"controlla_disponibilita","args":{"data":"2026-08-01","ora":"22:00","persone":2}},{"name":"controlla_disponibilita","args":{"data":"2026-08-01","ora":"21:30","persone":2}}] | reply must contain 'Greco' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Mi dispiace, alla 23:30 non possiamo prenotare: l’ultimo ingresso della sera è alle 22:30. Vuole spostarlo alle 21:30, 

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per sabato prossimo alle 23:30, 2 persone, a nome Roberto Greco

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Va bene allora alle 22

**[AI reply 2]**: Mi dispiace, alla 23:30 non possiamo prenotare: l’ultimo ingresso della sera è alle 22:30. Vuole spostarlo alle 21:30, oppure preferisce un altro orario di pranzo o cena?

**[AI reply 3]**: Un attimo, controllo la disponibilità per quell’orario e la registrerò se è libero.

**[AI reply 4]**: Un attimo, non è disponibile alle 22:00; controllo un’alternativa possibile.

**[AI reply 5]**: Purtroppo sabato prossimo alle 22:00 e alle 21:30 sono entrambi pieni. Vuole provare un orario prima, per pranzo, o scegliere un’altra giornata tra martedì e domenica?

**Tool calls made** (2):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-08-01",
      "ora": "22:00",
      "persone": 2
    }
  },
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-08-01",
      "ora": "21:30",
      "persone": 2
    }
  }
]
```

**Duration**: 9919ms

---

### B04-012 — `availability-edge`
**Description**: Data passata — 'ieri sera'

**Reason**: last reply not in 'it': mi dispiace, non posso prenotare per una data passata. vuole prenotare per un giorno futuro, magari oggi o un’altra data?

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per ieri sera alle 21, 2 persone, a nome Laura Bianchi

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[AI reply 2]**: Mi dispiace, non posso prenotare per una data passata. Vuole prenotare per un giorno futuro, magari oggi o un’altra data?

**Tool calls made** (0):
```json
[]
```

**Duration**: 1361ms

---

### B04-015 — `availability-edge`
**Description**: 9 persone — sopra MAX (8), deve creare prenotazione pending owner e informare cliente

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":9,"nome":"Federico Rossi"} not found. Actual: [{"name":"controlla_disponibilita","args":{"data":"2026-08-01","ora":"21:00","persone":9}}] | reply must contain 'conferma' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Perfetto, controllo la disponibilità per quella data e ora. Un attimo. Purtroppo sabato prossimo alle 21:00 è già preno | last reply not in 'it': ok, procediamo con un’altra opzione. l’ultimo slot alle 21 è pieno, hai un’altra ora in mente?

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per sabato prossimo alle 21, 9 persone, a nome Federico Rossi

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Sì procediamo

**[AI reply 2]**: Perfetto, controllo la disponibilità per quella data e ora. Un attimo.

**[AI reply 3]**: Purtroppo sabato prossimo alle 21:00 è già prenotato. Vuole provare un’altra ora di sabato, o un altro giorno?

**[AI reply 4]**: Ok, procediamo con un’altra opzione. L’ultimo slot alle 21 è pieno, hai un’altra ora in mente?

**Tool calls made** (1):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-08-01",
      "ora": "21:00",
      "persone": 9
    }
  }
]
```

**Duration**: 7959ms

---

### B04-016 — `availability-edge`
**Description**: 10 persone — large group, deve creare prenotazione pending owner

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":10,"nome":"Michele Barbieri"} not found. Actual: [{"name":"controlla_disponibilita","args":{"data":"2026-08-01","ora":"21:00","persone":10}}]

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per sabato prossimo alle 21, 10 persone, a nome Michele Barbieri

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Sì procediamo

**[AI reply 2]**: Perfetto, controllo la disponibilità per questo orario.

**[AI reply 3]**: Mi dispiace, il sabato prossimo alle 21 è già pieno. Per 10 persone la prenotazione è trattata in attesa di conferma; posso provare 22:00 o un altro sabato, se va bene.

**[AI reply 4]**: Mi dispiace, quel sabato alle 21 è già pieno. Non posso registrare la prenotazione. Vuole provare un altro sabato o un orario diverso?

**Tool calls made** (1):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-08-01",
      "ora": "21:00",
      "persone": 10
    }
  }
]
```

**Duration**: 11928ms

---

### B04-017 — `availability-edge`
**Description**: 15 persone — large group, deve creare prenotazione pending owner

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":15,"nome":"Giulia Ferrari"} not found. Actual: [{"name":"controlla_disponibilita","args":{"data":"2026-08-01","ora":"21:00","persone":15}}]

**Full transcript**:

**[User turn 1]**: Buonasera, vorremmo prenotare per sabato prossimo alle 21, siamo in 15, a nome Giulia Ferrari

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Sì confermiamo

**[AI reply 2]**: Ok, controllo la disponibilità per questa richiesta e poi procedo con la registrazione.

**[AI reply 3]**: Mi spiace, sabato prossimo alle 21 non è disponibile per la capienza. Per un gruppo di questa dimensione la prenotazione sarebbe comunque in attesa di conferma dal ristorante.

Vuole provarlo per pranzo tra 12:00 e 14:30, o scegliere un altro giorno tra martedì e domenica?

**[AI reply 4]**: Ottimo, conferma! Per un gruppo così grande, la richiesta sarà registrata in attesa di conferma dal ristorante.

Quale giorno tra martedì e domenica preferite, e a che ora? Dimmi un orario preciso (HH:MM), così posso verificare subito.

**Tool calls made** (1):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-08-01",
      "ora": "21:00",
      "persone": 15
    }
  }
]
```

**Duration**: 7791ms

---

### B04-018 — `availability-edge`
**Description**: 50 persone — evento/large group, deve creare prenotazione pending owner

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":50,"nome":"Riccardo Palumbo"} not found. Actual: []

**Full transcript**:

**[User turn 1]**: Buongiorno, avremmo un evento aziendale per sabato prossimo alle 21, siamo in 50, a nome Riccardo Palumbo

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Sì confermiamo

**[AI reply 2]**: Perfetto, grazie. Per registrare l’evento aziendale ho bisogno anche dell’email di contatto — può fornirmela?

**[AI reply 3]**: Perfetto, grazie per la conferma. Ora mi serve l’email di contatto per l’evento, così possiamo registrarlo.

**Tool calls made** (0):
```json
[]
```

**Duration**: 4416ms

---

### B04-019 — `availability-edge`
**Description**: 8 persone — limite superiore MAX_PEOPLE, deve passare come normale

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":8,"nome":"Stefano Galli"} not found. Actual: [{"name":"controlla_disponibilita","args":{"data":"2026-08-01","ora":"21:00","persone":8}}] | reply must contain 'Galli' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Perfetto, un attimo che controllo la disponibilità per quel sabato alle 21. Sabato alle 21:00 è già pieno. Vuole provar

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per sabato prossimo alle 21, 8 persone, a nome Stefano Galli

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Sì confermo

**[AI reply 2]**: Perfetto, un attimo che controllo la disponibilità per quel sabato alle 21.

**[AI reply 3]**: Sabato alle 21:00 è già pieno. Vuole provare un’altra ora a cena, oppure un altro giorno?

**[AI reply 4]**: Perfetto, grazie. Che ora vuole per sabato alle 21:00? Oppure ha un’altra data o tempo da confermare?

**Tool calls made** (1):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-08-01",
      "ora": "21:00",
      "persone": 8
    }
  }
]
```

**Duration**: 7761ms

---

### B04-020 — `availability-edge`
**Description**: 1 sola persona — deve funzionare normalmente

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":1,"nome":"Valentina Colombo"} not found. Actual: [{"name":"controlla_disponibilita","args":{"data":"2026-08-01","ora":"21:00","persone":1}}] | reply must contain 'Colombo' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Un attimo, controllo la disponibilità per quel sabato alle 21:00. Purtroppo alle 21:00 per sabato prossimo non c’è disp

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per sabato prossimo alle 21 per una persona, a nome Valentina Colombo

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Sì

**[AI reply 2]**: Un attimo, controllo la disponibilità per quel sabato alle 21:00.

**[AI reply 3]**: Purtroppo alle 21:00 per sabato prossimo non c’è disponibilità. Vuole provare un altro orario sabato (ad esempio 21:30) o scegliere un’altra data?

**[AI reply 4]**: Perfetto! Per sabato prossimo, potremmo provare alle 21:30. Vuole confermare quella ora, o preferisce un’altra data e un orario specifico?

**Tool calls made** (1):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-08-01",
      "ora": "21:00",
      "persone": 1
    }
  }
]
```

**Duration**: 8651ms

---

### B04-022 — `availability-edge`
**Description**: 'per cena' — modello chiede orario, cliente specifica 21:00

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":2,"nome":"Marta Fabbri"} not found. Actual: [{"name":"controlla_disponibilita","args":{"data":"2026-08-01","ora":"21:00","persone":2}}] | reply must contain 'Fabbri' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Perfetto, Marta, sabato prossimo per cena. Che ora preferisce, tra le 21:00 e le 22:30? Un attimo, controllo la disponi | last reply not in 'it': mi serve un orario preciso. preferisce 21:30 o 22:00?

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per sabato prossimo per cena, 2 persone, a nome Marta Fabbri

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Alle 21

**[AI reply 2]**: Perfetto, Marta, sabato prossimo per cena. Che ora preferisce, tra le 21:00 e le 22:30?

**[User turn 3]**: Sì confermo

**[AI reply 3]**: Un attimo, controllo la disponibilità per quel sabato alle 21:00.

**[AI reply 4]**: Purtroppo alle 21:00 è pieno. Vuole provare una delle slot a cena più vicine, ad esempio 21:30 o 22:00?

**[AI reply 5]**: Mi serve un orario preciso. Preferisce 21:30 o 22:00?

**Tool calls made** (1):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-08-01",
      "ora": "21:00",
      "persone": 2
    }
  }
]
```

**Duration**: 9647ms

---

