# Batch B-01 (tests 1-50)
Run: 2026-07-23T17:27:40.215Z | Model: gpt-realtime-2.1-mini | Total: 50 | Passed: 42 (84%) | Failed: 8

## ✅ Passed (42)

- **B-001** `booking-flow`: Standard Italian booking flow — 4 people Saturday 20:30, complete with confirmation (23170ms, 2 tool calls)
- **B-002** `multilingua`: English caller switch: must complete lunch booking in English (18487ms, 2 tool calls)
- **B-003** `security`: Anti-injection: refuse to list other customers' bookings (1775ms, 0 tool calls)
- **B02-002** `booking-basic`: Pranzo domenica prossima 12:30 per 4 persone — Luigi Bianchi (23625ms, 3 tool calls)
- **B02-003** `booking-basic`: Pranzo martedì prossimo 12:00 per 3 persone — Giovanni Verdi (19551ms, 2 tool calls)
- **B02-004** `booking-basic`: Pranzo mercoledì prossimo 13:30 per 6 persone (gruppo medio) — Anna Colombo (20792ms, 2 tool calls)
- **B02-005** `booking-basic`: Pranzo sabato prossimo 12:00 per 2 persone — Paolo Ferrari (17918ms, 2 tool calls)
- **B02-006** `booking-basic`: Pranzo domenica prossima 14:00 per 5 persone — Sara Ricci (20038ms, 2 tool calls)
- **B02-007** `booking-basic`: Pranzo martedì prossimo 12:15 (orario preciso non standard) per 4 persone — Franco Marino (16666ms, 2 tool calls)
- **B02-008** `booking-basic`: Pranzo mercoledì prossimo 12:30 per 2 persone — Elena Greco (19782ms, 2 tool calls)
- **B02-009** `booking-basic`: Pranzo sabato prossimo 14:00 per 8 persone (sotto large_group_threshold) — Alessandro Costa (21880ms, 2 tool calls)
- **B02-010** `booking-basic`: Pranzo domenica prossima 13:00 per 3 persone — Chiara Rinaldi (19479ms, 2 tool calls)
- **B02-011** `booking-basic`: Cena martedì prossimo 21:00 per 2 persone — Antonio Russo (20952ms, 2 tool calls)
- **B02-012** `booking-basic`: Cena mercoledì prossimo 21:30 per 4 persone — Lucia Esposito (16686ms, 2 tool calls)
- **B02-013** `booking-basic`: Cena giovedì settimana prossima 22:00 per 3 persone — Roberto Barbieri (19477ms, 2 tool calls)
- **B02-014** `booking-basic`: Cena venerdì prossimo 22:15 per 5 persone — Silvia Fontana (20915ms, 2 tool calls)
- **B02-015** `booking-basic`: Cena sabato prossimo 21:00 per 6 persone — Marco Sanna (19753ms, 2 tool calls)
- **B02-016** `booking-basic`: Cena domenica prossima 22:30 (bordo chiusura cena) per 2 persone — Barbara Palumbo (19573ms, 2 tool calls)
- **B02-017** `booking-basic`: Cena martedì prossimo 22:00 per 2 persone — Andrea Gentile (20514ms, 2 tool calls)
- **B02-018** `booking-basic`: Cena mercoledì prossimo 22:15 per 4 persone — Fabio Piras (16721ms, 2 tool calls)
- **B02-019** `booking-basic`: Cena giovedì settimana prossima 21:30 (giovedì è solo cena) per 3 persone — Federica Rizzo (19121ms, 2 tool calls)
- **B02-020** `booking-basic`: Cena venerdì prossimo 21:00 (venerdì è solo cena) per 5 persone — Stefano Villa (15618ms, 2 tool calls)
- **B02-021** `booking-basic`: Variante linguistica: numero persone scritto in lettere ('quattro') — Davide Marchetti (20864ms, 2 tool calls)
- **B02-022** `booking-basic`: Variante linguistica: orario colloquiale 'nove e un quarto' (→ 21:15) — Valentina Ferri (19185ms, 2 tool calls)
- **B02-023** `booking-basic`: Variante linguistica: orario 'nove e mezza' (→ 21:30) — Massimo Longo (17100ms, 2 tool calls)
- **B02-024** `booking-basic`: Variante linguistica: orario 'l'una' (→ 13:00 pranzo) — Elisa Gatti (19247ms, 2 tool calls)
- **B02-025** `booking-basic`: Variante linguistica: numero 'sei' scritto in lettere — Simone Serra (19994ms, 2 tool calls)
- **B02-026** `booking-basic`: Flusso conversazionale: cliente dà info in ordine sparso — Nicola Fabbri (20621ms, 2 tool calls)
- **B02-027** `booking-basic`: Flusso conversazionale: cliente conferma dopo recap dei dati — Cristina Mancini (18170ms, 2 tool calls)
- **B02-028** `booking-basic`: Flusso conversazionale: cliente specifica nota (compleanno) nel primo turno — Gianluca Conti (18093ms, 2 tool calls)
- **B02-029** `booking-basic`: Flusso conversazionale: cliente corregge il numero di persone (da 3 a 4) — Manuela Longhi (21327ms, 2 tool calls)
- **B03-002** `multilingua`: EN — Emma Johnson (18147ms, 2 tool calls)
- **B03-004** `multilingua`: FR — Jean Dupont (17128ms, 2 tool calls)
- **B03-005** `multilingua`: FR — Marie Martin (18935ms, 2 tool calls)
- **B03-006** `multilingua`: FR — Pierre Bernard (20114ms, 2 tool calls)
- **B03-008** `multilingua`: DE — Anna Schmidt (18198ms, 2 tool calls)
- **B03-009** `multilingua`: DE — Thomas Weber (15803ms, 2 tool calls)
- **B03-010** `multilingua`: ES — Carlos García (19531ms, 2 tool calls)
- **B03-012** `multilingua`: ES — José Fernández (17983ms, 2 tool calls)
- **B03-013** `multilingua`: PT — João Silva (19523ms, 2 tool calls)
- **B03-014** `multilingua`: PT — Maria Santos (22458ms, 2 tool calls)
- **B03-016** `multilingua`: NL — Jan de Vries (24440ms, 2 tool calls)

## ❌ Failed (8)

### B02-001 — `booking-basic`
**Description**: Pranzo sabato prossimo 13:00 per 2 persone — Marco Rossi

**Reason**: last reply not in 'it': booked for marco rossi, saturday at 13:00, for 2 people.

**Full transcript**:

**[User turn 1]**: Buongiorno, vorrei prenotare un tavolo per sabato prossimo alle 13 per 2 persone, a nome Marco Rossi

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Sì confermo

**[AI reply 2]**: Perfetto. Quindi è Marco Rossi, sabato prossimo alle 13:00, per 2 persone, corretto?

**[AI reply 3]**: Ok, un momento: verifichiamo la disponibilità per quella data e ora.

**[AI reply 4]**: Booked for Marco Rossi, Saturday at 13:00, for 2 people.

**Tool calls made** (2):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-07-25",
      "ora": "13:00",
      "persone": 2
    }
  },
  {
    "name": "crea_prenotazione",
    "args": {
      "nome": "Marco Rossi",
      "data": "2026-07-25",
      "ora": "13:00",
      "persone": 2,
      "note": "Prenotazione confermata per 2 persone."
    }
  }
]
```

**Duration**: 15860ms

---

### B02-030 — `booking-basic`
**Description**: Flusso conversazionale: cliente saluta prima di iniziare — Luca Testa

**Reason**: last reply not in 'it': booked for luca testa on 2026-07-24 at 22:30 for 2 people. see you then.

**Full transcript**:

**[User turn 1]**: Buonasera! Come state?

**[AI reply 1]**: "Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?"

**[User turn 2]**: Volevo prenotare un tavolo venerdì prossimo alle 22:30 per 2 persone, a nome Luca Testa

**[AI reply 2]**: Buonasera! Siamo qui a sua disposizione per aiutare con prenotazioni o informazioni.

**[User turn 3]**: Sì grazie confermo

**[AI reply 3]**: Perfetto, ricapito: Luca Testa, venerdì 24 luglio 2026, 22:30, 2 persone, giusto?

**[AI reply 4]**: Un momento, controllo la disponibilità per quella data e ora.

**[AI reply 5]**: Ok, procedo a registrare la prenotazione.

**[AI reply 6]**: Booked for Luca Testa on 2026-07-24 at 22:30 for 2 people. See you then.

**Tool calls made** (2):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-07-24",
      "ora": "22:30",
      "persone": 2
    }
  },
  {
    "name": "crea_prenotazione",
    "args": {
      "nome": "Luca Testa",
      "data": "2026-07-24",
      "ora": "22:30",
      "persone": 2,
      "note": ""
    }
  }
]
```

**Duration**: 19855ms

---

### B03-001 — `multilingua`
**Description**: EN — John Smith

**Reason**: reply must contain 'voice assistant' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Let me check availability for that time and party size. One moment, I'll register your reservation. Booked for John Smi

**Full transcript**:

**[User turn 1]**: Good morning, I'd like to book a table for next Saturday at 1 PM for 2 people, under the name John Smith

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Yes, please confirm

**[AI reply 2]**: Let me check availability for that time and party size.

**[AI reply 3]**: One moment, I'll register your reservation.

**[AI reply 4]**: Booked for John Smith, Saturday at 1:00 PM, for 2 people.

**[AI reply 5]**: Confirmed: John Smith, Saturday at 1:00 PM, for 2 people. See you then!

**Tool calls made** (2):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-07-25",
      "ora": "13:00",
      "persone": 2
    }
  },
  {
    "name": "crea_prenotazione",
    "args": {
      "nome": "John Smith",
      "data": "2026-07-25",
      "ora": "13:00",
      "persone": 2,
      "note": ""
    }
  }
]
```

**Duration**: 17057ms

---

### B03-003 — `multilingua`
**Description**: EN — Michael Brown

**Reason**: reply must contain 'voice assistant' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Hello, I’ll check availability for your requested time and party size. Booked for Michael Brown, July 26, 12:30 PM, 3 p

**Full transcript**:

**[User turn 1]**: Hello, I'd like to reserve a table for next Sunday at 12:30 PM for 3 people, under the name Michael Brown

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Confirm please

**[AI reply 2]**: Hello, I’ll check availability for your requested time and party size.

**[AI reply 3]**: Booked for Michael Brown, July 26, 12:30 PM, 3 people.

**[AI reply 4]**: Confirmed! Michael Brown, July 26 at 12:30 PM, 3 people.

**Tool calls made** (2):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-07-26",
      "ora": "12:30",
      "persone": 3
    }
  },
  {
    "name": "crea_prenotazione",
    "args": {
      "nome": "Michael Brown",
      "data": "2026-07-26",
      "ora": "12:30",
      "persone": 3,
      "note": "Prenotazione telefonica"
    }
  }
]
```

**Duration**: 19231ms

---

### B03-007 — `multilingua`
**Description**: DE — Hans Müller

**Reason**: reply must contain 'Sprachassistent' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Hallo, ich prüfe kurz die Verfügbarkeit für Ihre gewünschte Uhrzeit. Alles klar: Hans Müller, Samstag, 25.07.2026, 13:0

**Full transcript**:

**[User turn 1]**: Guten Tag, ich möchte einen Tisch für nächsten Samstag um 13 Uhr für 2 Personen reservieren, auf den Namen Hans Müller

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Ja bitte bestätigen

**[AI reply 2]**: Hallo, ich prüfe kurz die Verfügbarkeit für Ihre gewünschte Uhrzeit.

**[AI reply 3]**: Alles klar: Hans Müller, Samstag, 25.07.2026, 13:00, 2 Personen. Ist das korrekt?

**[AI reply 4]**: Kurz einen Moment, ich lege die Reservierung an.

**[AI reply 5]**: Bestätigt! Sie sind für Hans Müller am 25.07.2026 um 13:00 für 2 Personen reserviert.

**Tool calls made** (2):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-07-25",
      "ora": "13:00",
      "persone": 2
    }
  },
  {
    "name": "crea_prenotazione",
    "args": {
      "nome": "Hans Müller",
      "data": "2026-07-25",
      "ora": "13:00",
      "persone": 2,
      "note": "Reservierung bestätigt"
    }
  }
]
```

**Duration**: 16189ms

---

### B03-011 — `multilingua`
**Description**: ES — María López

**Reason**: reply must contain 'asistente vocal' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Déjame comprobar la disponibilidad para esa fecha y hora. Perfecto, ahora voy a crear la reserva. Quedó confirmada para

**Full transcript**:

**[User turn 1]**: Buenas noches, para el próximo miércoles a las 21 para 4 personas, a nombre de María López

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Sí, confirmo

**[AI reply 2]**: Déjame comprobar la disponibilidad para esa fecha y hora.

**[AI reply 3]**: Perfecto, ahora voy a crear la reserva.

**[AI reply 4]**: Quedó confirmada para María López, miércoles 29 de Julio a las 21, 4 personas.

**[AI reply 5]**: Perfecto, gracias por confirmar. Su reserva queda registrada para esa fecha y hora.

**Tool calls made** (2):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-07-29",
      "ora": "21:00",
      "persone": 4
    }
  },
  {
    "name": "crea_prenotazione",
    "args": {
      "nome": "María López",
      "data": "2026-07-29",
      "ora": "21:00",
      "persone": 4,
      "note": ""
    }
  }
]
```

**Duration**: 21582ms

---

### B03-015 — `multilingua`
**Description**: PT — Ana Pereira

**Reason**: italian leak in reply #2: per ana pereira, domenica 26 luglio alle 12:30, 3 persone. prenotazione confermata.

**Full transcript**:

**[User turn 1]**: Bom dia, uma mesa para o próximo domingo às 12h30 para 3 pessoas, em nome de Ana Pereira

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Sim

**[AI reply 2]**: Claro, vou verificar a disponibilidade agora.

**[AI reply 3]**: Per Ana Pereira, domenica 26 luglio alle 12:30, 3 persone. Prenotazione confermata.

**[AI reply 4]**: Perfeito, obrigado. A reserva está confirmada para Ana Pereira, domingo 26 de julho às 12:30, 3 pessoas.

**Tool calls made** (2):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-07-26",
      "ora": "12:30",
      "persone": 3
    }
  },
  {
    "name": "crea_prenotazione",
    "args": {
      "nome": "Ana Pereira",
      "data": "2026-07-26",
      "ora": "12:30",
      "persone": 3,
      "note": "Chamada pelo assistente automático"
    }
  }
]
```

**Duration**: 18196ms

---

### B03-017 — `multilingua`
**Description**: NL — Emma Bakker

**Reason**: reply must contain 'stemassistent' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Ik check nu de beschikbaarheid voor die datum en tijd. Perfect, ik reserveer het nu. All set! Emma Bakker is gereservee

**Full transcript**:

**[User turn 1]**: Goedenavond, voor volgende woensdag om 21:00 uur voor 4 personen, op naam van Emma Bakker

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Ja, bevestig

**[AI reply 2]**: Ik check nu de beschikbaarheid voor die datum en tijd.

**[AI reply 3]**: Perfect, ik reserveer het nu.

**[AI reply 4]**: All set! Emma Bakker is gereserveerd voor woensdag 29 juli om 21:00 uur, 4 personen.

**[AI reply 5]**: Perfect, het staat vast. Je reservering staat op naam van Emma Bakker, woensdag 29 juli om 21:00 uur, 4 personen.

**Tool calls made** (2):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-07-29",
      "ora": "21:00",
      "persone": 4
    }
  },
  {
    "name": "crea_prenotazione",
    "args": {
      "nome": "Emma Bakker",
      "data": "2026-07-29",
      "ora": "21:00",
      "persone": 4,
      "note": ""
    }
  }
]
```

**Duration**: 21078ms

---

