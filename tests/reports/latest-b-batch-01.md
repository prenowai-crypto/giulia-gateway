# Batch B-01 (tests 1-50)
Run: 2026-07-22T23:29:40.810Z | Model: gpt-realtime-2.1-mini | Total: 50 | Passed: 36 (72%) | Failed: 14

## ✅ Passed (36)

- **B-001** `booking-flow`: Standard Italian booking flow — 4 people Saturday 20:30, complete with confirmation (17781ms, 2 tool calls)
- **B-002** `multilingua`: English caller switch: must complete lunch booking in English (19767ms, 2 tool calls)
- **B-003** `security`: Anti-injection: refuse to list other customers' bookings (2597ms, 0 tool calls)
- **B02-001** `booking-basic`: Pranzo sabato prossimo 13:00 per 2 persone — Marco Rossi (16282ms, 2 tool calls)
- **B02-002** `booking-basic`: Pranzo domenica prossima 12:30 per 4 persone — Luigi Bianchi (15613ms, 2 tool calls)
- **B02-003** `booking-basic`: Pranzo martedì prossimo 12:00 per 3 persone — Giovanni Verdi (14792ms, 2 tool calls)
- **B02-004** `booking-basic`: Pranzo mercoledì prossimo 13:30 per 6 persone (gruppo medio) — Anna Colombo (16326ms, 2 tool calls)
- **B02-005** `booking-basic`: Pranzo sabato prossimo 12:00 per 2 persone — Paolo Ferrari (17573ms, 2 tool calls)
- **B02-006** `booking-basic`: Pranzo domenica prossima 14:00 per 5 persone — Sara Ricci (16151ms, 2 tool calls)
- **B02-007** `booking-basic`: Pranzo martedì prossimo 12:15 (orario preciso non standard) per 4 persone — Franco Marino (15898ms, 2 tool calls)
- **B02-008** `booking-basic`: Pranzo mercoledì prossimo 12:30 per 2 persone — Elena Greco (16051ms, 2 tool calls)
- **B02-009** `booking-basic`: Pranzo sabato prossimo 14:00 per 8 persone (sotto large_group_threshold) — Alessandro Costa (15369ms, 2 tool calls)
- **B02-010** `booking-basic`: Pranzo domenica prossima 13:00 per 3 persone — Chiara Rinaldi (15723ms, 2 tool calls)
- **B02-011** `booking-basic`: Cena martedì prossimo 21:00 per 2 persone — Antonio Russo (15273ms, 2 tool calls)
- **B02-012** `booking-basic`: Cena mercoledì prossimo 21:30 per 4 persone — Lucia Esposito (14070ms, 2 tool calls)
- **B02-014** `booking-basic`: Cena venerdì prossimo 22:15 per 5 persone — Silvia Fontana (17395ms, 2 tool calls)
- **B02-015** `booking-basic`: Cena sabato prossimo 21:00 per 6 persone — Marco Sanna (14678ms, 2 tool calls)
- **B02-016** `booking-basic`: Cena domenica prossima 22:30 (bordo chiusura cena) per 2 persone — Barbara Palumbo (15147ms, 2 tool calls)
- **B02-017** `booking-basic`: Cena martedì prossimo 22:00 per 2 persone — Andrea Gentile (14246ms, 2 tool calls)
- **B02-018** `booking-basic`: Cena mercoledì prossimo 22:15 per 4 persone — Fabio Piras (16243ms, 2 tool calls)
- **B02-019** `booking-basic`: Cena giovedì settimana prossima 21:30 (giovedì è solo cena) per 3 persone — Federica Rizzo (15656ms, 2 tool calls)
- **B02-020** `booking-basic`: Cena venerdì prossimo 21:00 (venerdì è solo cena) per 5 persone — Stefano Villa (16260ms, 2 tool calls)
- **B02-021** `booking-basic`: Variante linguistica: numero persone scritto in lettere ('quattro') — Davide Marchetti (19093ms, 2 tool calls)
- **B02-022** `booking-basic`: Variante linguistica: orario colloquiale 'nove e un quarto' (→ 21:15) — Valentina Ferri (14681ms, 2 tool calls)
- **B02-023** `booking-basic`: Variante linguistica: orario 'nove e mezza' (→ 21:30) — Massimo Longo (14956ms, 2 tool calls)
- **B02-024** `booking-basic`: Variante linguistica: orario 'l'una' (→ 13:00 pranzo) — Elisa Gatti (15177ms, 2 tool calls)
- **B02-025** `booking-basic`: Variante linguistica: numero 'sei' scritto in lettere — Simone Serra (15195ms, 2 tool calls)
- **B02-026** `booking-basic`: Flusso conversazionale: cliente dà info in ordine sparso — Nicola Fabbri (19447ms, 2 tool calls)
- **B02-027** `booking-basic`: Flusso conversazionale: cliente conferma dopo recap dei dati — Cristina Mancini (16121ms, 2 tool calls)
- **B02-028** `booking-basic`: Flusso conversazionale: cliente specifica nota (compleanno) nel primo turno — Gianluca Conti (17611ms, 2 tool calls)
- **B02-029** `booking-basic`: Flusso conversazionale: cliente corregge il numero di persone (da 3 a 4) — Manuela Longhi (19184ms, 2 tool calls)
- **B02-030** `booking-basic`: Flusso conversazionale: cliente saluta prima di iniziare — Luca Testa (17837ms, 2 tool calls)
- **B03-013** `multilingua`: PT — João Silva (15907ms, 2 tool calls)
- **B03-014** `multilingua`: PT — Maria Santos (19577ms, 2 tool calls)
- **B03-016** `multilingua`: NL — Jan de Vries (14366ms, 2 tool calls)
- **B03-017** `multilingua`: NL — Emma Bakker (17440ms, 2 tool calls)

## ❌ Failed (14)

### B02-013 — `booking-basic`
**Description**: Cena giovedì settimana prossima 22:00 per 3 persone — Roberto Barbieri

**Reason**: expected tool call 'controlla_disponibilita' with args {"persone":3} not found. Actual: [] | expected tool call 'crea_prenotazione' with args {"persone":3} not found. Actual: []

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per giovedì della prossima settimana alle 22 per 3 persone, a nome Roberto Barbieri

**[AI reply 1]**: "Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?"

**[User turn 2]**: Sì confermo

**[AI reply 2]**: Mi serve un chiarimento sulla data. Intendi giovedì 23 luglio o giovedì 30 luglio?

**[AI reply 3]**: Perfetto, grazie. Quindi sarebbe Roberto Barbieri, giovedì 23 luglio, alle 22:00, 3 persone, corretto?

**Tool calls made** (0):
```json
[]
```

**Duration**: 4439ms

---

### B03-001 — `multilingua`
**Description**: EN — John Smith

**Reason**: reply must contain 'voice assistant' — got: "Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?" Sure, we can continue in English. I'm checking availability for next Saturday at 1 PM for two, then I’ll place the re

**Full transcript**:

**[User turn 1]**: Good morning, I'd like to book a table for next Saturday at 1 PM for 2 people, under the name John Smith

**[AI reply 1]**: "Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?"

**[User turn 2]**: Yes, please confirm

**[AI reply 2]**: Sure, we can continue in English. I'm checking availability for next Saturday at 1 PM for two, then I’ll place the reservation for John Smith.

**[AI reply 3]**: Great, your reservation is confirmed: John Smith, Saturday 2026-07-25 at 1:00 PM, for 2 people.

**[AI reply 4]**: Just to confirm: John Smith, Saturday 2026-07-25, 1:00 PM, 2 people. All set—see you then!

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
      "note": "Lunch reservation"
    }
  }
]
```

**Duration**: 16780ms

---

### B03-002 — `multilingua`
**Description**: EN — Emma Johnson

**Reason**: reply must contain 'voice assistant' — got: "Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?" Sure, I’ll quickly check availability for that time and then we’ll get your booking set up if possible. Great, I’ll r

**Full transcript**:

**[User turn 1]**: Good evening, a table for next Wednesday at 9 PM for 4 people, name Emma Johnson

**[AI reply 1]**: "Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?"

**[User turn 2]**: Yes confirm

**[AI reply 2]**: Sure, I’ll quickly check availability for that time and then we’ll get your booking set up if possible.

**[AI reply 3]**: Great, I’ll register the reservation now.

**[AI reply 4]**: Emma Johnson, Wednesday 2026-07-29 at 21:00, 4 people. Your table is confirmed.

**[AI reply 5]**: All set—your reservation is confirmed for Emma Johnson, next Wednesday at 9:00 PM for 4.

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
      "nome": "Emma Johnson",
      "data": "2026-07-29",
      "ora": "21:00",
      "persone": 4,
      "note": ""
    }
  }
]
```

**Duration**: 15245ms

---

### B03-003 — `multilingua`
**Description**: EN — Michael Brown

**Reason**: reply must contain 'voice assistant' — got: "Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?" Sure, I’ll quickly check availability for next Sunday and then either reserve it or suggest alternatives. Confirmed: 

**Full transcript**:

**[User turn 1]**: Hello, I'd like to reserve a table for next Sunday at 12:30 PM for 3 people, under the name Michael Brown

**[AI reply 1]**: "Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?"

**[User turn 2]**: Confirm please

**[AI reply 2]**: Sure, I’ll quickly check availability for next Sunday and then either reserve it or suggest alternatives.

**[AI reply 3]**: Confirmed: Michael Brown, Sunday 2026-07-26 at 12:30 PM, for 3 people.

**[AI reply 4]**: Confirmed: Michael Brown, Sunday July 26, 2026 at 12:30 PM, for 3 people. Your reservation is set.

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
      "note": ""
    }
  }
]
```

**Duration**: 14875ms

---

### B03-004 — `multilingua`
**Description**: FR — Jean Dupont

**Reason**: reply must contain 'assistant vocal' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? D’accord, je vérifie la disponibilité pour cette date et cette heure, puis je procède à la réservation s’il reste de la

**Full transcript**:

**[User turn 1]**: Bonjour, je voudrais réserver une table pour samedi prochain à 13h pour 2 personnes, au nom de Jean Dupont

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Oui je confirme

**[AI reply 2]**: D’accord, je vérifie la disponibilité pour cette date et cette heure, puis je procède à la réservation s’il reste de la place.

**[AI reply 3]**: C’est confirmé pour Jean Dupont, samedi 25 juillet 2026 à 13:00, pour 2 personnes.

**[AI reply 4]**: Parfait. Réservé sous Jean Dupont, samedi 25 juillet 2026 à 13h, pour 2 personnes.

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
      "nome": "Jean Dupont",
      "data": "2026-07-25",
      "ora": "13:00",
      "persone": 2,
      "note": "Réservation confirmée"
    }
  }
]
```

**Duration**: 17357ms

---

### B03-005 — `multilingua`
**Description**: FR — Marie Martin

**Reason**: reply must contain 'assistant vocal' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Je vais vérifier la disponibilité pour cette date et cette heure, puis je vous confirmerai la réservation. Réservé pour

**Full transcript**:

**[User turn 1]**: Bonsoir, je voudrais réserver pour mercredi prochain à 21h pour 4 personnes, au nom de Marie Martin

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Oui, confirmez

**[AI reply 2]**: Je vais vérifier la disponibilité pour cette date et cette heure, puis je vous confirmerai la réservation.

**[AI reply 3]**: Réservé pour Marie Martin, mercredi 29 juillet 2026 à 21h, pour 4 personnes.

**[AI reply 4]**: Parfait, confirmé: Marie Martin, 29 juillet 2026 à 21h, 4 personnes. Merci !

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
      "nome": "Marie Martin",
      "data": "2026-07-29",
      "ora": "21:00",
      "persone": 4,
      "note": ""
    }
  }
]
```

**Duration**: 15795ms

---

### B03-006 — `multilingua`
**Description**: FR — Pierre Bernard

**Reason**: reply must contain 'assistant vocal' — got: "Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?" Je vérifie d’abord la disponibilité pour cette date et heure, puis je vous aide à finaliser la réservation. C’est con

**Full transcript**:

**[User turn 1]**: Bonjour, une table pour dimanche prochain à 12h30 pour 3 personnes, au nom de Pierre Bernard

**[AI reply 1]**: "Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?"

**[User turn 2]**: Oui

**[AI reply 2]**: Je vérifie d’abord la disponibilité pour cette date et heure, puis je vous aide à finaliser la réservation.

**[AI reply 3]**: C’est confirmé pour Pierre Bernard, dimanche 2026-07-26 à 12:30, 3 personnes.

**[AI reply 4]**: Parfait, c’est enregistré. Souhaitez-vous ajouter une note, comme un menu ou une préférence ?

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
      "nome": "Pierre Bernard",
      "data": "2026-07-26",
      "ora": "12:30",
      "persone": 3,
      "note": ""
    }
  }
]
```

**Duration**: 18115ms

---

### B03-007 — `multilingua`
**Description**: DE — Hans Müller

**Reason**: reply must contain 'Sprachassistent' — got: "Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?" Klar, ich prüfe kurz die Verfügbarkeit für diesen Termin, dann erstellen wir die Reservierung. Ihr Tisch ist reservie

**Full transcript**:

**[User turn 1]**: Guten Tag, ich möchte einen Tisch für nächsten Samstag um 13 Uhr für 2 Personen reservieren, auf den Namen Hans Müller

**[AI reply 1]**: "Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?"

**[User turn 2]**: Ja bitte bestätigen

**[AI reply 2]**: Klar, ich prüfe kurz die Verfügbarkeit für diesen Termin, dann erstellen wir die Reservierung.

**[AI reply 3]**: Ihr Tisch ist reserviert: Hans Müller, Samstag, 25. Juli, um 13 Uhr für 2 Personen.

**[AI reply 4]**: Alles klar: Hans Müller, 25. Juli, 13:00 Uhr, 2 Personen. Bestätigt.

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
      "note": "Reservierung für 2 Personen um 13 Uhr am nächsten Samstag."
    }
  }
]
```

**Duration**: 14868ms

---

### B03-008 — `multilingua`
**Description**: DE — Anna Schmidt

**Reason**: exception: realtime error: {"type":"invalid_request_error","code":"conversation_already_has_active_response","message":"Conversation already has an active response in progress: resp_E4aaZ63RFXAic2251B1PF. Wait until the response is finished before creating a new one.","param":null,"event_id":null}

**Full transcript**:

**[User turn 1]**: Guten Abend, für nächsten Mittwoch um 21 Uhr für 4 Personen, auf den Namen Anna Schmidt

**[User turn 2]**: Ja, ich bestätige

**Tool calls made** (0):
```json
[]
```

**Duration**: 4823ms

---

### B03-009 — `multilingua`
**Description**: DE — Thomas Weber

**Reason**: reply must contain 'Sprachassistent' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Ich prüfe zuerst die Verfügbarkeit für den gewünschten Termin, dann buche ich — falls möglich, den Tisch direkt. Buchun

**Full transcript**:

**[User turn 1]**: Guten Tag, einen Tisch für nächsten Sonntag um 12:30 Uhr für 3 Personen, auf den Namen Thomas Weber

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Ja

**[AI reply 2]**: Ich prüfe zuerst die Verfügbarkeit für den gewünschten Termin, dann buche ich — falls möglich, den Tisch direkt.

**[AI reply 3]**: Buchung ist bestätigt: Thomas Weber, Sonntag, 2026-07-26, 12:30 Uhr, 3 Personen.

**[AI reply 4]**: Perfekt, aufgenommen. Bis Sonntag, 12:30 Uhr, für 3 Personen unter Thomas Weber.

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
      "nome": "Thomas Weber",
      "data": "2026-07-26",
      "ora": "12:30",
      "persone": 3,
      "note": ""
    }
  }
]
```

**Duration**: 16397ms

---

### B03-010 — `multilingua`
**Description**: ES — Carlos García

**Reason**: exception: realtime error: {"type":"invalid_request_error","code":"conversation_already_has_active_response","message":"Conversation already has an active response in progress: resp_E4aavfzKcArxR7U63qqrW. Wait until the response is finished before creating a new one.","param":null,"event_id":null}

**Full transcript**:

**[User turn 1]**: Buenos días, quisiera reservar una mesa para el próximo sábado a las 13 para 2 personas, a nombre de Carlos García

**[User turn 2]**: Sí confirmo

**Tool calls made** (0):
```json
[]
```

**Duration**: 5503ms

---

### B03-011 — `multilingua`
**Description**: ES — María López

**Reason**: exception: realtime error: {"type":"invalid_request_error","code":"conversation_already_has_active_response","message":"Conversation already has an active response in progress: resp_E4ab0jkryLhVUAbrnvPnp. Wait until the response is finished before creating a new one.","param":null,"event_id":null}

**Full transcript**:

**[User turn 1]**: Buenas noches, para el próximo miércoles a las 21 para 4 personas, a nombre de María López

**[User turn 2]**: Sí, confirmo

**Tool calls made** (0):
```json
[]
```

**Duration**: 4467ms

---

### B03-012 — `multilingua`
**Description**: ES — José Fernández

**Reason**: reply must contain 'asistente vocal' — got: "Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?" Por supuesto, puedo verificar la disponibilidad para esa fecha y hora. Mientras tanto, hago la consulta para confirma

**Full transcript**:

**[User turn 1]**: Buenos días, una mesa para el próximo domingo a las 12:30 para 3 personas, a nombre de José Fernández

**[AI reply 1]**: "Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?"

**[User turn 2]**: Sí

**[AI reply 2]**: Por supuesto, puedo verificar la disponibilidad para esa fecha y hora. Mientras tanto, hago la consulta para confirmar y, si hay mesa, la dejamos reservada a nombre de José Fernández.

**[AI reply 3]**: Listo: reservado para José Fernández el domingo 12:30 para 3 personas. Hasta entonces.

**[AI reply 4]**: Perfecto, gracias. Su reserva queda confirmada a nombre de José Fernández el domingo a las 12:30 para 3 personas.

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
      "note": "Prenotazione per 3 persone, orario pranzo."
    }
  }
]
```

**Duration**: 14682ms

---

### B03-015 — `multilingua`
**Description**: PT — Ana Pereira

**Reason**: italian leak in reply #2: per ana pereira, domenica 2026-07-26 alle 12:30, per 3 persone: prenotazione confermata.

**Full transcript**:

**[User turn 1]**: Bom dia, uma mesa para o próximo domingo às 12h30 para 3 pessoas, em nome de Ana Pereira

**[AI reply 1]**: "Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?"

**[User turn 2]**: Sim

**[AI reply 2]**: Claro, vou verificar a disponibilidade primeiro e, se houver mesa, faço a reserva em nome de Ana Pereira.

**[AI reply 3]**: Per Ana Pereira, domenica 2026-07-26 alle 12:30, per 3 persone: prenotazione confermata.

**[AI reply 4]**: Perfeito, obrigado por confirmar. Se precisar mudar algo, me avise.

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

**Duration**: 15096ms

---

