# Batch B-01 (tests 1-50)
Run: 2026-07-24T11:25:26.052Z | Model: gpt-realtime-2.1-mini | Total: 50 | Passed: 43 (86%) | Failed: 7

## ✅ Passed (43)

- **B-002** `multilingua`: English caller switch: must complete lunch booking in English (17947ms, 2 tool calls)
- **B-003** `security`: Anti-injection: refuse to list other customers' bookings (1921ms, 0 tool calls)
- **B02-001** `booking-basic`: Pranzo sabato prossimo 13:00 per 2 persone — Marco Rossi (17508ms, 2 tool calls)
- **B02-002** `booking-basic`: Pranzo domenica prossima 12:30 per 4 persone — Luigi Bianchi (18918ms, 2 tool calls)
- **B02-003** `booking-basic`: Pranzo martedì prossimo 12:00 per 3 persone — Giovanni Verdi (19021ms, 2 tool calls)
- **B02-004** `booking-basic`: Pranzo mercoledì prossimo 13:30 per 6 persone (gruppo medio) — Anna Colombo (17338ms, 2 tool calls)
- **B02-005** `booking-basic`: Pranzo sabato prossimo 12:00 per 2 persone — Paolo Ferrari (17933ms, 2 tool calls)
- **B02-006** `booking-basic`: Pranzo domenica prossima 14:00 per 5 persone — Sara Ricci (15858ms, 2 tool calls)
- **B02-007** `booking-basic`: Pranzo martedì prossimo 12:15 (orario preciso non standard) per 4 persone — Franco Marino (17540ms, 2 tool calls)
- **B02-008** `booking-basic`: Pranzo mercoledì prossimo 12:30 per 2 persone — Elena Greco (16216ms, 2 tool calls)
- **B02-009** `booking-basic`: Pranzo sabato prossimo 14:00 per 8 persone (sotto large_group_threshold) — Alessandro Costa (18659ms, 2 tool calls)
- **B02-010** `booking-basic`: Pranzo domenica prossima 13:00 per 3 persone — Chiara Rinaldi (17181ms, 2 tool calls)
- **B02-011** `booking-basic`: Cena martedì prossimo 21:00 per 2 persone — Antonio Russo (16400ms, 2 tool calls)
- **B02-012** `booking-basic`: Cena mercoledì prossimo 21:30 per 4 persone — Lucia Esposito (17809ms, 2 tool calls)
- **B02-013** `booking-basic`: Cena giovedì settimana prossima 22:00 per 3 persone — Roberto Barbieri (16520ms, 2 tool calls)
- **B02-014** `booking-basic`: Cena venerdì prossimo 22:15 per 5 persone — Silvia Fontana (19496ms, 2 tool calls)
- **B02-015** `booking-basic`: Cena sabato prossimo 21:00 per 6 persone — Marco Sanna (16782ms, 2 tool calls)
- **B02-016** `booking-basic`: Cena domenica prossima 22:30 (bordo chiusura cena) per 2 persone — Barbara Palumbo (17963ms, 2 tool calls)
- **B02-017** `booking-basic`: Cena martedì prossimo 22:00 per 2 persone — Andrea Gentile (15757ms, 2 tool calls)
- **B02-018** `booking-basic`: Cena mercoledì prossimo 22:15 per 4 persone — Fabio Piras (17816ms, 2 tool calls)
- **B02-019** `booking-basic`: Cena giovedì settimana prossima 21:30 (giovedì è solo cena) per 3 persone — Federica Rizzo (14992ms, 2 tool calls)
- **B02-020** `booking-basic`: Cena venerdì prossimo 21:00 (venerdì è solo cena) per 5 persone — Stefano Villa (18257ms, 2 tool calls)
- **B02-021** `booking-basic`: Variante linguistica: numero persone scritto in lettere ('quattro') — Davide Marchetti (19499ms, 2 tool calls)
- **B02-022** `booking-basic`: Variante linguistica: orario colloquiale 'nove e un quarto' (→ 21:15) — Valentina Ferri (18118ms, 2 tool calls)
- **B02-023** `booking-basic`: Variante linguistica: orario 'nove e mezza' (→ 21:30) — Massimo Longo (16860ms, 2 tool calls)
- **B02-024** `booking-basic`: Variante linguistica: orario 'l'una' (→ 13:00 pranzo) — Elisa Gatti (20139ms, 2 tool calls)
- **B02-025** `booking-basic`: Variante linguistica: numero 'sei' scritto in lettere — Simone Serra (14675ms, 2 tool calls)
- **B02-027** `booking-basic`: Flusso conversazionale: cliente conferma dopo recap dei dati — Cristina Mancini (18255ms, 2 tool calls)
- **B02-028** `booking-basic`: Flusso conversazionale: cliente specifica nota (compleanno) nel primo turno — Gianluca Conti (21218ms, 2 tool calls)
- **B02-029** `booking-basic`: Flusso conversazionale: cliente corregge il numero di persone (da 3 a 4) — Manuela Longhi (19905ms, 2 tool calls)
- **B02-030** `booking-basic`: Flusso conversazionale: cliente saluta prima di iniziare — Luca Testa (18488ms, 2 tool calls)
- **B03-001** `multilingua`: EN — John Smith (18296ms, 2 tool calls)
- **B03-002** `multilingua`: EN — Emma Johnson (15534ms, 2 tool calls)
- **B03-003** `multilingua`: EN — Michael Brown (17603ms, 2 tool calls)
- **B03-004** `multilingua`: FR — Jean Dupont (15422ms, 2 tool calls)
- **B03-005** `multilingua`: FR — Marie Martin (16606ms, 2 tool calls)
- **B03-006** `multilingua`: FR — Pierre Bernard (16912ms, 2 tool calls)
- **B03-008** `multilingua`: DE — Anna Schmidt (16343ms, 2 tool calls)
- **B03-009** `multilingua`: DE — Thomas Weber (17427ms, 2 tool calls)
- **B03-013** `multilingua`: PT — João Silva (17470ms, 2 tool calls)
- **B03-014** `multilingua`: PT — Maria Santos (18256ms, 2 tool calls)
- **B03-016** `multilingua`: NL — Jan de Vries (16524ms, 2 tool calls)
- **B03-017** `multilingua`: NL — Emma Bakker (18081ms, 2 tool calls)

## ❌ Failed (7)

### B-001 — `booking-flow`
**Description**: Standard Italian booking flow — 4 people Saturday 20:30, complete with confirmation

**Reason**: forbidden tool call 'modifica_prenotazione' was made

**Full transcript**:

**[User turn 1]**: Vorrei prenotare un tavolo per sabato prossimo alle 8 e mezza di sera per 4 persone

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: A nome Marco Rossi

**[AI reply 2]**: Un momento, verifico la disponibilità per quel momento.

**[User turn 3]**: Sì confermo

**[AI reply 3]**: Perfetto, ora posso registrare la prenotazione.

**[AI reply 4]**: Prenotato per 4 persone, sabato prossimo alle 20:30. A nome del chiamante.

**[AI reply 5]**: Un attimo, controllo la prenotazione e poi aggiornare il nome.

**[AI reply 6]**: Mi serve la data o l’ora da confermare per aggiornare il nome.

**[AI reply 7]**: Va bene, confermo: Marco Rossi, sabato 25 luglio 2026, 20:30, 4 persone. Ora aggiorno la prenotazione.

**[AI reply 8]**: Tutto aggiornato: Marco Rossi, sabato 25 luglio 2026 alle 20:30, 4 persone.

**Tool calls made** (5):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-07-25",
      "ora": "20:30",
      "persone": 4
    }
  },
  {
    "name": "crea_prenotazione",
    "args": {
      "nome": "Caller",
      "data": "2026-07-25",
      "ora": "20:30",
      "persone": 4,
      "note": "Prenotazione effettuata per telefono."
    }
  },
  {
    "name": "trova_prenotazione",
    "args": {
      "nome": "Caller"
    }
  },
  {
    "name": "modifica_prenotazione",
    "args": {
      "nome": "Marco Rossi"
    }
  },
  {
    "name": "modifica_prenotazione",
    "args": {
      "nome": "Marco Rossi",
      "data": "2026-07-25",
      "ora": "20:30",
      "persone": 4,
      "note": "Aggiornamento nome prenotazione."
    }
  }
]
```

**Duration**: 32851ms

---

### B02-026 — `booking-basic`
**Description**: Flusso conversazionale: cliente dà info in ordine sparso — Nicola Fabbri

**Reason**: forbidden tool call 'modifica_prenotazione' was made

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Siamo in 3

**[AI reply 2]**: Certo! Mi servono nome, data, orario e numero di persone. Quale data e a che ora vorrebbe venire?

**[User turn 3]**: Domenica prossima

**[AI reply 3]**: Perfetto, grazie! Quale data preferite e a che ora, per 3 persone? E qual è il nome da mettere sulla prenotazione?

**[User turn 4]**: Alle 21:30

**[AI reply 4]**: Ok, Domenica prossima, 3 persone. Qual è il nome da mettere in prenotazione? E a che ora preferite?

**[User turn 5]**: A nome Nicola Fabbri

**[AI reply 5]**: Un momento, controllo la disponibilità per quella data e ora.

**[User turn 6]**: Confermo

**[AI reply 6]**: Ok, registro la prenotazione adesso.

**[AI reply 7]**: Perfetto, la prenotazione è confermata: nome Piazza, domenica 26 luglio 2026 alle 21:30, 3 persone.

**[AI reply 8]**: Un attimo, verifico la prenotazione e aggiorno il nome.

**[AI reply 9]**: Mi dispiace, c’è stato un errore: il sistema dice che data e ora non sono disponibili.  
Ti ricordo che mi serve confermare “domenica 26 luglio 2026 alle 21:30” prima di aggiornare il nome.

**[AI reply 10]**: Ok, aggiorno la prenotazione con il nome corretto.

**[AI reply 11]**: Perfetto, la prenotazione è aggiornata. È confermata per Nicola Fabbri, domenica 26 luglio 2026 alle 21:30 per 3 persone.

**Tool calls made** (5):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-07-26",
      "ora": "21:30",
      "persone": 3
    }
  },
  {
    "name": "crea_prenotazione",
    "args": {
      "nome": "Piazza",
      "data": "2026-07-26",
      "ora": "21:30",
      "persone": 3,
      "note": ""
    }
  },
  {
    "name": "trova_prenotazione",
    "args": {
      "nome": "Piazza"
    }
  },
  {
    "name": "modifica_prenotazione",
    "args": {
      "nome": "Nicola Fabbri"
    }
  },
  {
    "name": "modifica_prenotazione",
    "args": {
      "nome": "Nicola Fabbri",
      "data": "2026-07-26",
      "ora": "21:30"
    }
  }
]
```

**Duration**: 32035ms

---

### B03-007 — `multilingua`
**Description**: DE — Hans Müller

**Reason**: italian leak in reply #2: prima hai detto: hans müller, 13:00, il prossimo sabato, 2 persone. ho registrato la prenotazione.

**Full transcript**:

**[User turn 1]**: Guten Tag, ich möchte einen Tisch für nächsten Samstag um 13 Uhr für 2 Personen reservieren, auf den Namen Hans Müller

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Ja bitte bestätigen

**[AI reply 2]**: Hallo, ich bin der automatisierte Sprachassistent von Osteria Test. Wie kann ich Ihnen helfen? Ich prüfe jetzt die Verfügbarkeit für Ihr gewünschtes Datum.

**[AI reply 3]**: Prima hai detto: Hans Müller, 13:00, il prossimo sabato, 2 persone. Ho registrato la prenotazione.

**[AI reply 4]**: Alles bestätigt: Hans Müller, nächste Samstag um 13 Uhr, 2 Personen. Ihre Reservierung ist vermerkt.

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
      "note": "Reservierung"
    }
  }
]
```

**Duration**: 17636ms

---

### B03-010 — `multilingua`
**Description**: ES — Carlos García

**Reason**: reply must contain 'asistente vocal' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Hola, soy el asistente de voz automático de Osteria Test. ¿En qué puedo ayudarle? Voy a comprobar la disponibilidad. It

**Full transcript**:

**[User turn 1]**: Buenos días, quisiera reservar una mesa para el próximo sábado a las 13 para 2 personas, a nombre de Carlos García

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Sí confirmo

**[AI reply 2]**: Hola, soy el asistente de voz automático de Osteria Test. ¿En qué puedo ayudarle? Voy a comprobar la disponibilidad.

**[AI reply 3]**: It’s booked: Carlos García, Saturday at 13:00, for 2 people. See you then.

**[AI reply 4]**: Perfecto, la reserva queda confirmada. ¿Hay algo más en lo que pueda ayudarte?

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
      "nome": "Carlos García",
      "data": "2026-07-25",
      "ora": "13:00",
      "persone": 2,
      "note": "Reservación realizada por asistente."
    }
  }
]
```

**Duration**: 18784ms

---

### B03-011 — `multilingua`
**Description**: ES — María López

**Reason**: reply must contain 'asistente vocal' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Hola, soy el asistente de voz automático de Osteria Test. ¿Cómo puedo ayudarle? Un momento, voy a revisar la disponibil

**Full transcript**:

**[User turn 1]**: Buenas noches, para el próximo miércoles a las 21 para 4 personas, a nombre de María López

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Sí, confirmo

**[AI reply 2]**: Hola, soy el asistente de voz automático de Osteria Test. ¿Cómo puedo ayudarle? Un momento, voy a revisar la disponibilidad.

**[AI reply 3]**: Perfecto. Ahora lo registro.

**[AI reply 4]**: He reservado para María López el miércoles 29 de julio a las 21:00, para 4 personas.

**[AI reply 5]**: Gracias, su reserva está confirmada. ¡Le esperamos!

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

**Duration**: 17122ms

---

### B03-012 — `multilingua`
**Description**: ES — José Fernández

**Reason**: reply must contain 'asistente vocal' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Hola, soy el asistente de voz automático de Osteria Test. ¿Cómo puedo ayudarle? Voy a comprobar la disponibilidad ahora

**Full transcript**:

**[User turn 1]**: Buenos días, una mesa para el próximo domingo a las 12:30 para 3 personas, a nombre de José Fernández

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Sí

**[AI reply 2]**: Hola, soy el asistente de voz automático de Osteria Test. ¿Cómo puedo ayudarle? Voy a comprobar la disponibilidad ahora.

**[AI reply 3]**: Perfecto, queda reservado para José Fernández el próximo domingo a las 12:30, para 3 personas.

**[AI reply 4]**: Perfecto, gracias por confirmar. Su reserva para el próximo domingo a las 12:30 para 3 personas queda confirmada.

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
      "nome": "José Fernández",
      "data": "2026-07-26",
      "ora": "12:30",
      "persone": 3,
      "note": ""
    }
  }
]
```

**Duration**: 14767ms

---

### B03-015 — `multilingua`
**Description**: PT — Ana Pereira

**Reason**: italian leak in reply #2: per ana pereira, domenica 26 luglio alle 12:30, 3 persone. prenotazione confermata.

**Full transcript**:

**[User turn 1]**: Bom dia, uma mesa para o próximo domingo às 12h30 para 3 pessoas, em nome de Ana Pereira

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Sim

**[AI reply 2]**: Olá, sou o assistente de voz automático da Osteria Test. Como posso ajudar? Vou verificar a disponibilidade para esse horário agora.

**[AI reply 3]**: Per Ana Pereira, domenica 26 luglio alle 12:30, 3 persone. Prenotazione confermata.

**[AI reply 4]**: Perfeito, obrigado. Se precisar, posso ajudar com mudanças ou outras informações.

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
      "note": ""
    }
  }
]
```

**Duration**: 18251ms

---

