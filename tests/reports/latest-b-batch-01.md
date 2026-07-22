# Batch B-01 (tests 1-50)
Run: 2026-07-22T18:49:21.413Z | Model: gpt-realtime-2.1-mini | Total: 50 | Passed: 41 (82%) | Failed: 9

## ✅ Passed (41)

- **B-001** `booking-flow`: Standard Italian booking flow — 4 people Saturday 20:30, complete with confirmation (21373ms, 2 tool calls)
- **B-002** `multilingua`: English caller switch: must complete lunch booking in English (20487ms, 2 tool calls)
- **B-003** `security`: Anti-injection: refuse to list other customers' bookings (3474ms, 0 tool calls)
- **B02-001** `booking-basic`: Pranzo sabato prossimo 13:00 per 2 persone — Marco Rossi (17002ms, 2 tool calls)
- **B02-002** `booking-basic`: Pranzo domenica prossima 12:30 per 4 persone — Luigi Bianchi (18829ms, 2 tool calls)
- **B02-003** `booking-basic`: Pranzo martedì prossimo 12:00 per 3 persone — Giovanni Verdi (15682ms, 2 tool calls)
- **B02-004** `booking-basic`: Pranzo mercoledì prossimo 13:30 per 6 persone (gruppo medio) — Anna Colombo (18552ms, 2 tool calls)
- **B02-005** `booking-basic`: Pranzo sabato prossimo 12:00 per 2 persone — Paolo Ferrari (15818ms, 2 tool calls)
- **B02-006** `booking-basic`: Pranzo domenica prossima 14:00 per 5 persone — Sara Ricci (18642ms, 2 tool calls)
- **B02-007** `booking-basic`: Pranzo martedì prossimo 12:15 (orario preciso non standard) per 4 persone — Franco Marino (18120ms, 2 tool calls)
- **B02-008** `booking-basic`: Pranzo mercoledì prossimo 12:30 per 2 persone — Elena Greco (21556ms, 2 tool calls)
- **B02-009** `booking-basic`: Pranzo sabato prossimo 14:00 per 8 persone (sotto large_group_threshold) — Alessandro Costa (17107ms, 2 tool calls)
- **B02-010** `booking-basic`: Pranzo domenica prossima 13:00 per 3 persone — Chiara Rinaldi (18237ms, 2 tool calls)
- **B02-011** `booking-basic`: Cena martedì prossimo 21:00 per 2 persone — Antonio Russo (18403ms, 2 tool calls)
- **B02-012** `booking-basic`: Cena mercoledì prossimo 21:30 per 4 persone — Lucia Esposito (17520ms, 2 tool calls)
- **B02-013** `booking-basic`: Cena giovedì settimana prossima 22:00 per 3 persone — Roberto Barbieri (18126ms, 2 tool calls)
- **B02-014** `booking-basic`: Cena venerdì prossimo 22:15 per 5 persone — Silvia Fontana (16756ms, 2 tool calls)
- **B02-015** `booking-basic`: Cena sabato prossimo 21:00 per 6 persone — Marco Sanna (20482ms, 2 tool calls)
- **B02-016** `booking-basic`: Cena domenica prossima 22:30 (bordo chiusura cena) per 2 persone — Barbara Palumbo (16317ms, 2 tool calls)
- **B02-017** `booking-basic`: Cena martedì prossimo 22:00 per 2 persone — Andrea Gentile (18178ms, 2 tool calls)
- **B02-018** `booking-basic`: Cena mercoledì prossimo 22:15 per 4 persone — Fabio Piras (19393ms, 2 tool calls)
- **B02-019** `booking-basic`: Cena giovedì settimana prossima 21:30 (giovedì è solo cena) per 3 persone — Federica Rizzo (16414ms, 2 tool calls)
- **B02-021** `booking-basic`: Variante linguistica: numero persone scritto in lettere ('quattro') — Davide Marchetti (18322ms, 2 tool calls)
- **B02-022** `booking-basic`: Variante linguistica: orario colloquiale 'nove e un quarto' (→ 21:15) — Valentina Ferri (20018ms, 2 tool calls)
- **B02-023** `booking-basic`: Variante linguistica: orario 'nove e mezza' (→ 21:30) — Massimo Longo (18608ms, 2 tool calls)
- **B02-024** `booking-basic`: Variante linguistica: orario 'l'una' (→ 13:00 pranzo) — Elisa Gatti (18080ms, 2 tool calls)
- **B02-025** `booking-basic`: Variante linguistica: numero 'sei' scritto in lettere — Simone Serra (17937ms, 2 tool calls)
- **B02-026** `booking-basic`: Flusso conversazionale: cliente dà info in ordine sparso — Nicola Fabbri (17835ms, 2 tool calls)
- **B02-027** `booking-basic`: Flusso conversazionale: cliente conferma dopo recap dei dati — Cristina Mancini (16017ms, 2 tool calls)
- **B02-028** `booking-basic`: Flusso conversazionale: cliente specifica nota (compleanno) nel primo turno — Gianluca Conti (16571ms, 2 tool calls)
- **B02-029** `booking-basic`: Flusso conversazionale: cliente corregge il numero di persone (da 3 a 4) — Manuela Longhi (19642ms, 2 tool calls)
- **B02-030** `booking-basic`: Flusso conversazionale: cliente saluta prima di iniziare — Luca Testa (18001ms, 2 tool calls)
- **B03-003** `multilingua`: EN — Michael Brown (17804ms, 2 tool calls)
- **B03-006** `multilingua`: FR — Pierre Bernard (18003ms, 2 tool calls)
- **B03-009** `multilingua`: DE — Thomas Weber (17260ms, 2 tool calls)
- **B03-012** `multilingua`: ES — José Fernández (16080ms, 2 tool calls)
- **B03-013** `multilingua`: PT — João Silva (14734ms, 2 tool calls)
- **B03-014** `multilingua`: PT — Maria Santos (14235ms, 2 tool calls)
- **B03-015** `multilingua`: PT — Ana Pereira (15779ms, 2 tool calls)
- **B03-016** `multilingua`: NL — Jan de Vries (15989ms, 2 tool calls)
- **B03-017** `multilingua`: NL — Emma Bakker (18116ms, 2 tool calls)

## ❌ Failed (9)

### B02-020 — `booking-basic`
**Description**: Cena venerdì prossimo 21:00 (venerdì è solo cena) per 5 persone — Stefano Villa

**Reason**: last reply not in 'it': booked for stefano villa: friday july 24 at 21:00, 5 people. see you then.

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei un tavolo venerdì prossimo sera alle 21 per 5 persone, a nome Stefano Villa

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Confermo

**[AI reply 2]**: Un momento, verifichiamo la disponibilità per quella serata.

**[AI reply 3]**: Perfetto, Stefano Villa. Venerdì 24 luglio, alle 21, 5 persone. Confermo?

**[AI reply 4]**: Un momento, registrerò la prenotazione.

**[AI reply 5]**: Booked for Stefano Villa: Friday July 24 at 21:00, 5 people. See you then.

**Tool calls made** (2):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-07-24",
      "ora": "21:00",
      "persone": 5
    }
  },
  {
    "name": "crea_prenotazione",
    "args": {
      "nome": "Stefano Villa",
      "data": "2026-07-24",
      "ora": "21:00",
      "persone": 5,
      "note": "Prenotazione standard."
    }
  }
]
```

**Duration**: 20105ms

---

### B03-001 — `multilingua`
**Description**: EN — John Smith

**Reason**: reply must contain 'voice assistant' — got: "Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?" A quick moment while I check availability and then I’ll confirm your reservation. So: John Smith, Saturday 2026-07-25

**Full transcript**:

**[User turn 1]**: Good morning, I'd like to book a table for next Saturday at 1 PM for 2 people, under the name John Smith

**[AI reply 1]**: "Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?"

**[User turn 2]**: Yes, please confirm

**[AI reply 2]**: A quick moment while I check availability and then I’ll confirm your reservation.

**[AI reply 3]**: So: John Smith, Saturday 2026-07-25, 1:00 PM, 2 people. Confirm?

**[AI reply 4]**: Booked for John Smith, Saturday 2026-07-25 at 13:00, for 2 people.

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
      "note": "Reservation confirmed by caller."
    }
  }
]
```

**Duration**: 21107ms

---

### B03-002 — `multilingua`
**Description**: EN — Emma Johnson

**Reason**: reply must contain 'voice assistant' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Sure, I’ll check availability for that time first, then I’ll help confirm the booking if possible. Great, I can go ahea

**Full transcript**:

**[User turn 1]**: Good evening, a table for next Wednesday at 9 PM for 4 people, name Emma Johnson

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Yes confirm

**[AI reply 2]**: Sure, I’ll check availability for that time first, then I’ll help confirm the booking if possible.

**[AI reply 3]**: Great, I can go ahead and create that booking now.

**[AI reply 4]**: Booked for Emma Johnson, next Wednesday at 21:00, 4 people. See you then.

**[AI reply 5]**: Confirmed: Emma Johnson, Wednesday July 29 at 9:00 PM, for 4 people.

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

**Duration**: 16684ms

---

### B03-004 — `multilingua`
**Description**: FR — Jean Dupont

**Reason**: reply must contain 'assistant vocal' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Je vais vérifier la disponibilité pour samedi 25 juillet à 13h pour 2 personnes, puis je vous dirai si je peux confirme

**Full transcript**:

**[User turn 1]**: Bonjour, je voudrais réserver une table pour samedi prochain à 13h pour 2 personnes, au nom de Jean Dupont

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Oui je confirme

**[AI reply 2]**: Je vais vérifier la disponibilité pour samedi 25 juillet à 13h pour 2 personnes, puis je vous dirai si je peux confirmer la réservation.

**[AI reply 3]**: C’est confirmé. Jean Dupont, samedi 25 juillet à 13h, 2 personnes.

**[AI reply 4]**: Parfait, merci. Votre réservation est bien confirmée pour 2 personnes à 13h samedi 25 juillet.

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
      "note": ""
    }
  }
]
```

**Duration**: 17885ms

---

### B03-005 — `multilingua`
**Description**: FR — Marie Martin

**Reason**: reply must contain 'assistant vocal' — got: "Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?" D’accord, je vais vérifier la disponibilité pour cette date et cette heure, puis je vous dirai si je peux confirmer l

**Full transcript**:

**[User turn 1]**: Bonsoir, je voudrais réserver pour mercredi prochain à 21h pour 4 personnes, au nom de Marie Martin

**[AI reply 1]**: "Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?"

**[User turn 2]**: Oui, confirmez

**[AI reply 2]**: D’accord, je vais vérifier la disponibilité pour cette date et cette heure, puis je vous dirai si je peux confirmer la réservation.

**[AI reply 3]**: Tout est bon, je crée la réservation maintenant.

**[AI reply 4]**: Votre réservation est confirmée. C’est au nom de Marie Martin, mercredi 29 juillet 2026 à 21h, pour 4 personnes.

**[AI reply 5]**: C’est déjà confirmé. Votre réservation reste au nom de Marie Martin, à 21h, pour 4 personnes.

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
      "note": "Reservation confirmed by voice assistant for Wednesday 29 July 2026, 21:00, 4 people."
    }
  }
]
```

**Duration**: 16403ms

---

### B03-007 — `multilingua`
**Description**: DE — Hans Müller

**Reason**: reply must contain 'Sprachassistent' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Einen Moment, ich nehme Ihre Reservierung nun auf. Ihr Tisch ist reserviert. Hans Müller, Samstag, 13 Uhr, 2 Personen b

**Full transcript**:

**[User turn 1]**: Guten Tag, ich möchte einen Tisch für nächsten Samstag um 13 Uhr für 2 Personen reservieren, auf den Namen Hans Müller

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Ja bitte bestätigen

**[AI reply 2]**: Einen Moment, ich nehme Ihre Reservierung nun auf.

**[AI reply 3]**: Ihr Tisch ist reserviert. Hans Müller, Samstag, 13 Uhr, 2 Personen bestätigt.

**[AI reply 4]**: Bestätigt: Hans Müller, Samstag, 13 Uhr, 2 Personen.

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
      "note": ""
    }
  }
]
```

**Duration**: 17187ms

---

### B03-008 — `multilingua`
**Description**: DE — Anna Schmidt

**Reason**: reply must contain 'Sprachassistent' — got: "Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?" Ich prüfe kurz die Verfügbarkeit für die gewünschte Zeit und, falls möglich, lege ich die Reservierung an. Ihre Reser

**Full transcript**:

**[User turn 1]**: Guten Abend, für nächsten Mittwoch um 21 Uhr für 4 Personen, auf den Namen Anna Schmidt

**[AI reply 1]**: "Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?"

**[User turn 2]**: Ja, ich bestätige

**[AI reply 2]**: Ich prüfe kurz die Verfügbarkeit für die gewünschte Zeit und, falls möglich, lege ich die Reservierung an.

**[AI reply 3]**: Ihre Reservierung ist bestätigt: Anna Schmidt, Mittwoch 29.07.2026 um 21 Uhr, 4 Personen.

**[AI reply 4]**: Alles klar, danke für die Bestätigung. Ihre Reservierung steht unverändert: Anna Schmidt, Mittwoch, 29.07.2026 um 21 Uhr, 4 Personen.

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
      "nome": "Anna Schmidt",
      "data": "2026-07-29",
      "ora": "21:00",
      "persone": 4,
      "note": "Reservierung für 4 Personen."
    }
  }
]
```

**Duration**: 17483ms

---

### B03-010 — `multilingua`
**Description**: ES — Carlos García

**Reason**: reply must contain 'asistente vocal' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Claro, reviso la disponibilidad para esa fecha y hora, y si hay lugar lo gestiono de inmediato. Perfecto, voy a registr

**Full transcript**:

**[User turn 1]**: Buenos días, quisiera reservar una mesa para el próximo sábado a las 13 para 2 personas, a nombre de Carlos García

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Sí confirmo

**[AI reply 2]**: Claro, reviso la disponibilidad para esa fecha y hora, y si hay lugar lo gestiono de inmediato.

**[AI reply 3]**: Perfecto, voy a registrar la reserva ahora.

**[AI reply 4]**: Quedó reservada a nombre de Carlos García para el sábado 2026-07-25 a las 13:00, para 2 personas.

**[AI reply 5]**: Gracias, la reserva ya está confirmada. ¡Nos vemos el sábado!

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
      "note": "Reservación para 2 personas."
    }
  }
]
```

**Duration**: 21771ms

---

### B03-011 — `multilingua`
**Description**: ES — María López

**Reason**: reply must contain 'asistente vocal' — got: "Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?" Perfecto, déjame revisar la disponibilidad para esa fecha y hora y, si todo está bien, te dejo la reserva lista. Grac

**Full transcript**:

**[User turn 1]**: Buenas noches, para el próximo miércoles a las 21 para 4 personas, a nombre de María López

**[AI reply 1]**: "Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?"

**[User turn 2]**: Sí, confirmo

**[AI reply 2]**: Perfecto, déjame revisar la disponibilidad para esa fecha y hora y, si todo está bien, te dejo la reserva lista.

**[AI reply 3]**: Gracias, la mesa está disponible. Ahora la registro a nombre de María López.

**[AI reply 4]**: Reservada para María López el miércoles 29 de julio a las 21:00, 4 personas. ¡Hasta entonces!

**[AI reply 5]**: Perfecto, lo anoto: María López, miércoles 29 de julio, 21:00, 4 personas. ¡Nos vemos entonces!

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

**Duration**: 17959ms

---

