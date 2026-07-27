# Batch B-01 (tests 1-30)
Run: 2026-07-27T18:27:19.088Z | Model: gpt-realtime-2.1-mini | Total: 30 | Passed: 24 (80%) | Failed: 6

## ✅ Passed (24)

- **B04-001** `availability-edge`: Lunedì chiuso — cliente rifiutato (3011ms, 0 tool calls)
- **B04-002** `availability-edge`: Lunedì chiuso — cliente insiste, modello mantiene rifiuto (3416ms, 0 tool calls)
- **B04-003** `availability-edge`: Lunedì chiuso — cliente accetta spostare a martedì (20314ms, 3 tool calls)
- **B04-004** `availability-edge`: Lunedì chiuso — cliente accetta spostare a domenica (26933ms, 2 tool calls)
- **B04-006** `availability-edge`: Alle 16:00 — gap tra pranzo e cena, chiuso (3085ms, 0 tool calls)
- **B04-008** `availability-edge`: Alle 20:00 — prima apertura cena (21:00 config reale) (2541ms, 0 tool calls)
- **B04-009** `availability-edge`: Alle 20:30 — 30 minuti prima cena, cliente accetta 21:00 (19271ms, 2 tool calls)
- **B04-010** `availability-edge`: Alle 23:00 — dopo last booking (22:30) (2262ms, 0 tool calls)
- **B04-011** `availability-edge`: Dopo 22:30 — cliente accetta anticipare a 22:00 (23868ms, 2 tool calls)
- **B04-013** `availability-edge`: Data passata specifica poi correzione a futura (11 agosto = martedì aperto) (17411ms, 2 tool calls)
- **B04-014** `availability-edge`: Prenotazione last minute per domani sera (martedì aperto) (14638ms, 2 tool calls)
- **B04-015** `availability-edge`: 9 persone — sopra MAX (8), deve creare prenotazione pending owner e informare cliente (17271ms, 2 tool calls)
- **B04-017** `availability-edge`: 15 persone — large group, deve creare prenotazione pending owner (15305ms, 2 tool calls)
- **B04-019** `availability-edge`: 8 persone — limite superiore MAX_PEOPLE, deve passare come normale (17491ms, 2 tool calls)
- **B04-020** `availability-edge`: 1 sola persona — deve funzionare normalmente (17158ms, 2 tool calls)
- **B04-021** `availability-edge`: 'ora di pranzo' — modello chiede orario, cliente specifica 13:00 (16853ms, 2 tool calls)
- **B04-022** `availability-edge`: 'per cena' — modello chiede orario, cliente specifica 21:00 (17721ms, 2 tool calls)
- **B04-023** `availability-edge`: 'presto' — ambiguo, modello deve chiedere chiarimento (2629ms, 0 tool calls)
- **B04-024** `availability-edge`: 'tarda serata' — deve proporre ultimo slot (22:30) (16663ms, 2 tool calls)
- **B04-025** `availability-edge`: 'quando aprite' — cliente chiede orario apertura, poi prenota (17243ms, 2 tool calls)
- **B04-026** `availability-edge`: Ferragosto (15 agosto) — festivo, deve accettare (16167ms, 2 tool calls)
- **B04-027** `availability-edge`: Data lontana (dicembre) — deve accettare senza problemi (17572ms, 2 tool calls)
- **B04-028** `availability-edge`: Orario borderline — esattamente 22:30 (last booking) (17432ms, 2 tool calls)
- **B04-030** `availability-edge`: OVERBOOKING sabato 21:00 pieno, cliente accetta domenica [SEED: 30 pax sabato prossimo 21:00] (27251ms, 4 tool calls)

## ❌ Failed (6)

### B04-005 — `availability-edge`
**Description**: Alle 15:30 — dopo chiusura pranzo (14:30)

**Reason**: last reply not in 'it': mi dispiace, non possiamo prenotare alle 15:30: l’orario è fuori dal servizio pranzo/cena. vuole invece provare un orario pranzabile tra le 12:00 e le

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per venerdì prossimo alle 15:30, 2 persone, a nome Paolo Verdi

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[AI reply 2]**: Mi dispiace, non possiamo prenotare alle 15:30: l’orario è fuori dal servizio pranzo/cena. Vuole invece provare un orario pranzabile tra le 12:00 e le 14:30, oppure per cena tra le 21:00 e le 22:30?

**Tool calls made** (0):
```json
[]
```

**Duration**: 2629ms

---

### B04-007 — `availability-edge`
**Description**: Alle 11:00 — prima apertura pranzo (12:00)

**Reason**: last reply not in 'it': mi dispiace, alle 11:00 non è un orario disponibile per pranzo. vuole prenotare per un orario tra le 12:00 e le 14:30?

**Full transcript**:

**[User turn 1]**: Buongiorno, vorrei prenotare per sabato prossimo alle 11, 2 persone, a nome Giovanni Costa

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[AI reply 2]**: Mi dispiace, alle 11:00 non è un orario disponibile per pranzo. Vuole prenotare per un orario tra le 12:00 e le 14:30?

**Tool calls made** (0):
```json
[]
```

**Duration**: 2948ms

---

### B04-012 — `availability-edge`
**Description**: Data passata — 'ieri sera'

**Reason**: last reply not in 'it': mi dispiace, non posso prenotare una data passata. vuole prenotare per un giorno futuro?

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per ieri sera alle 21, 2 persone, a nome Laura Bianchi

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[AI reply 2]**: Mi dispiace, non posso prenotare una data passata. Vuole prenotare per un giorno futuro?

**Tool calls made** (0):
```json
[]
```

**Duration**: 2631ms

---

### B04-016 — `availability-edge`
**Description**: 10 persone — large group, deve creare prenotazione pending owner

**Reason**: reply must contain 'conferma' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Perfetto, verifichiamo la disponibilità per quella data e ora. Un attimo, poi procediamo. Ok, c'è disponibilità. Regist

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per sabato prossimo alle 21, 10 persone, a nome Michele Barbieri

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Sì procediamo

**[AI reply 2]**: Perfetto, verifichiamo la disponibilità per quella data e ora. Un attimo, poi procediamo.

**[AI reply 3]**: Ok, c'è disponibilità. Registro la prenotazione con i dati forniti.

**[AI reply 4]**: Prenotazione registrata: Michele Barbieri, sabato prossimo alle 21:00, per 10 persone. A presto!

**[AI reply 5]**: Perfetto, la prenotazione è stata registrata a nome Michele Barbieri, sabato alle 21:00, per 10 persone. A presto!

**Tool calls made** (2):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-08-01",
      "ora": "21:00",
      "persone": 10
    }
  },
  {
    "name": "crea_prenotazione",
    "args": {
      "nome": "Michele Barbieri",
      "data": "2026-08-01",
      "ora": "21:00",
      "persone": 10,
      "note": "Gruppo grande: prenotazione in attesa di conferma dal ristorante."
    }
  }
]
```

**Duration**: 16487ms

---

### B04-018 — `availability-edge`
**Description**: 50 persone — evento/large group, deve creare prenotazione pending owner

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":50,"nome":"Riccardo Palumbo"} not found. Actual: [] | reply must contain 'conferma' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Perfetto, per registrare l’evento ho bisogno di un contatto email per la richiesta.  
Può fornirmela, o preferisce aggi

**Full transcript**:

**[User turn 1]**: Buongiorno, avremmo un evento aziendale per sabato prossimo alle 21, siamo in 50, a nome Riccardo Palumbo

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Sì confermiamo

**[AI reply 2]**: Perfetto, per registrare l’evento ho bisogno di un contatto email per la richiesta.  
Può fornirmela, o preferisce aggiungere qualche nota sull’occasione?

**[AI reply 3]**: Perfetto, grazie!  
Mi manca ancora l’email di riferimento per la richiesta evento: me la può fornire?

**Tool calls made** (0):
```json
[]
```

**Duration**: 5154ms

---

### B04-029 — `availability-edge`
**Description**: OVERBOOKING sabato 21:00 pieno, cliente accetta 22:30 [SEED: 30 pax sabato prossimo 21:00]

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":4,"nome":"Matteo Fumagalli","ora":"22:30"} not found. Actual: [{"name":"controlla_disponibilita","args":{"data":"2026-08-01","ora":"21:00","persone":4}},{"name":"crea_prenotazione","args":{"nome":"Matteo Fumagalli","data":"2026-08-01","ora":"21:00","persone":4,"note":""}},{"name":"trova_prenotazione","args":{"nome":"Matteo Fumagalli","data":"2026-08-01"}},{"name":"modifica_prenotazione","args":{"nome":"Matteo Fumagalli","data":"2026-08-01","ora":"22:30","persone":4,"note":""}}]

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per sabato prossimo alle 21, 4 persone, a nome Matteo Fumagalli

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Va bene alle 22:30 allora

**[AI reply 2]**: Un attimo, controllo la disponibilità per l’orario richiesto.

**[AI reply 3]**: Prenotazione confermata: Matteo Fumagalli, sabato alle 21:00, per 4 persone. A presto!

**[AI reply 4]**: Un attimo, verifico la prenotazione e poi la aggiorno.

**[AI reply 5]**: La prenotazione è stata aggiornata a 22:30 per Matteo Fumagalli, sabato alle 22:30, per 4 persone. A presto!

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

**Duration**: 25211ms

---

