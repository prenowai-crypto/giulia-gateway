# Batch B-01 (tests 1-30)
Run: 2026-07-22T16:12:29.592Z | Model: gpt-realtime-2.1-mini | Total: 30 | Passed: 27 (90%) | Failed: 3

## ✅ Passed (27)

- **B03-001** `multilingua`: EN — Lunch Saturday 13:00 for 2 — John Smith (24078ms, 2 tool calls)
- **B03-002** `multilingua`: EN — Lunch Sunday 12:30 for 4 — Emma Johnson (19607ms, 2 tool calls)
- **B03-003** `multilingua`: EN — Lunch Tuesday 12:00 for 3 — Michael Brown (19613ms, 2 tool calls)
- **B03-004** `multilingua`: EN — Lunch Wednesday 13:30 for 5 — Sarah Wilson (20865ms, 2 tool calls)
- **B03-005** `multilingua`: EN — Dinner Saturday 21:00 for 6 — David Miller (27110ms, 2 tool calls)
- **B03-007** `multilingua`: EN — Dinner Tuesday 22:00 for 4 — Robert Anderson (23441ms, 2 tool calls)
- **B03-008** `multilingua`: EN — Dinner Wednesday 21:30 for 3 — Lisa Taylor (20120ms, 2 tool calls)
- **B03-009** `multilingua`: FR — Déjeuner samedi 13:00 pour 2 — Jean Dupont (23985ms, 2 tool calls)
- **B03-010** `multilingua`: FR — Déjeuner dimanche 12:30 pour 4 — Marie Martin (18487ms, 2 tool calls)
- **B03-011** `multilingua`: FR — Déjeuner mercredi 13:00 pour 3 — Pierre Bernard (18995ms, 2 tool calls)
- **B03-012** `multilingua`: FR — Déjeuner mardi 12:00 pour 5 — Sophie Petit (19489ms, 2 tool calls)
- **B03-013** `multilingua`: FR — Dîner samedi 21:00 pour 6 — Antoine Moreau (17881ms, 2 tool calls)
- **B03-014** `multilingua`: FR — Dîner dimanche 22:00 pour 2 — Camille Rousseau (18146ms, 2 tool calls)
- **B03-015** `multilingua`: FR — Dîner mardi 22:00 pour 4 — Julien Lefevre (25059ms, 2 tool calls)
- **B03-016** `multilingua`: FR — Dîner vendredi 21:30 pour 3 — Isabelle Girard (19855ms, 2 tool calls)
- **B03-017** `multilingua`: DE — Mittagessen Samstag 13:00 für 2 — Hans Müller (20633ms, 2 tool calls)
- **B03-018** `multilingua`: DE — Mittagessen Sonntag 12:30 für 4 — Anna Schmidt (18125ms, 2 tool calls)
- **B03-019** `multilingua`: DE — Mittagessen Mittwoch 13:00 für 3 — Thomas Weber (21296ms, 2 tool calls)
- **B03-020** `multilingua`: DE — Abendessen Samstag 21:00 für 5 — Petra Wagner (21683ms, 2 tool calls)
- **B03-021** `multilingua`: DE — Abendessen Sonntag 22:00 für 2 — Klaus Fischer (18897ms, 2 tool calls)
- **B03-022** `multilingua`: DE — Abendessen Dienstag 22:00 für 4 — Sabine Meyer (23758ms, 2 tool calls)
- **B03-023** `multilingua`: DE — Abendessen Freitag 21:30 für 3 — Wolfgang Bauer (16932ms, 2 tool calls)
- **B03-025** `multilingua`: ES — Almuerzo domingo 12:30 para 4 — María López (19911ms, 2 tool calls)
- **B03-027** `multilingua`: ES — Cena sábado 21:00 para 5 — Ana Martínez (25233ms, 2 tool calls)
- **B03-028** `multilingua`: ES — Cena domingo 22:00 para 2 — Miguel Rodríguez (22675ms, 2 tool calls)
- **B03-029** `multilingua`: ES — Cena martes 22:00 para 4 — Elena Sánchez (18750ms, 2 tool calls)
- **B03-030** `multilingua`: ES — Cena viernes 21:30 para 3 — Antonio Pérez (17982ms, 2 tool calls)

## ❌ Failed (3)

### B03-006 — `multilingua`
**Description**: EN — Dinner Sunday 22:00 for 2 — Jennifer Davis

**Reason**: reply must contain 'voice assistant' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Let me check availability now. Just a moment, I’ll create the reservation. Booked for Jennifer Davis, Sunday July 26 at

**Full transcript**:

**[User turn 1]**: Good evening, a table for next Sunday at 10 PM for 2 people, under the name Jennifer Davis

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Yes please confirm

**[AI reply 2]**: Let me check availability now.

**[AI reply 3]**: Just a moment, I’ll create the reservation.

**[AI reply 4]**: Booked for Jennifer Davis, Sunday July 26 at 10:00 PM for 2 people. See you then.

**[AI reply 5]**: Your reservation is confirmed for Jennifer Davis, Sunday July 26 at 10:00 PM for 2 people.

**Tool calls made** (2):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-07-26",
      "ora": "22:00",
      "persone": 2
    }
  },
  {
    "name": "crea_prenotazione",
    "args": {
      "nome": "Jennifer Davis",
      "data": "2026-07-26",
      "ora": "22:00",
      "persone": 2,
      "note": "Reservation requested via automated voice assistant."
    }
  }
]
```

**Duration**: 21078ms

---

### B03-024 — `multilingua`
**Description**: ES — Almuerzo sábado 13:00 para 2 — Carlos García

**Reason**: reply must contain 'asistente vocal' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Claro, revisaré la disponibilidad para ese día y hora. Perfecto, procederé a registrar la reserva ahora. Reservado para

**Full transcript**:

**[User turn 1]**: Buenos días, quisiera reservar una mesa para el próximo sábado a las 13 para 2 personas, a nombre de Carlos García

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Sí confirmo

**[AI reply 2]**: Claro, revisaré la disponibilidad para ese día y hora.

**[AI reply 3]**: Perfecto, procederé a registrar la reserva ahora.

**[AI reply 4]**: Reservado para Carlos García el sábado 25 de julio a las 13:00, para 2 personas.

**[AI reply 5]**: Perfecto, queda confirmada la reserva para 2 personas el sábado 25 de julio a las 13:00.

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
      "note": ""
    }
  }
]
```

**Duration**: 19401ms

---

### B03-026 — `multilingua`
**Description**: ES — Almuerzo miércoles 13:00 para 3 — José Fernández

**Reason**: reply must contain 'asistente vocal' — got: "Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?" Un momento, revisaré la disponibilidad para ese horario. Perfecto, voy a registrar la reserva ahora. Bien, está reser

**Full transcript**:

**[User turn 1]**: Buenos días, una mesa para el próximo miércoles a las 13 para 3 personas, a nombre de José Fernández

**[AI reply 1]**: "Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?"

**[User turn 2]**: Sí

**[AI reply 2]**: Un momento, revisaré la disponibilidad para ese horario.

**[AI reply 3]**: Perfecto, voy a registrar la reserva ahora.

**[AI reply 4]**: Bien, está reservada la mesa para José Fernández, el miércoles 29 de julio a las 13:00, para 3 personas.

**[AI reply 5]**: Perfecto, gracias. ¿Necesita algo más para su reserva?

**Tool calls made** (2):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-07-29",
      "ora": "13:00",
      "persone": 3
    }
  },
  {
    "name": "crea_prenotazione",
    "args": {
      "nome": "José Fernández",
      "data": "2026-07-29",
      "ora": "13:00",
      "persone": 3,
      "note": "Prenotazione per 3 persone al pranzo."
    }
  }
]
```

**Duration**: 18664ms

---

