# Batch B-01 (tests 1-30)
Run: 2026-07-22T15:04:56.126Z | Model: gpt-realtime-2.1-mini | Total: 30 | Passed: 26 (87%) | Failed: 4

## ✅ Passed (26)

- **B03-002** `multilingua`: EN — Lunch Sunday 12:30 for 4 — Emma Johnson (22144ms, 2 tool calls)
- **B03-003** `multilingua`: EN — Lunch Tuesday 12:00 for 3 — Michael Brown (19536ms, 2 tool calls)
- **B03-006** `multilingua`: EN — Dinner Sunday 22:00 for 2 — Jennifer Davis (20539ms, 2 tool calls)
- **B03-008** `multilingua`: EN — Dinner Wednesday 21:30 for 3 — Lisa Taylor (20944ms, 2 tool calls)
- **B03-009** `multilingua`: FR — Déjeuner samedi 13:00 pour 2 — Jean Dupont (17706ms, 2 tool calls)
- **B03-010** `multilingua`: FR — Déjeuner dimanche 12:30 pour 4 — Marie Martin (22284ms, 2 tool calls)
- **B03-011** `multilingua`: FR — Déjeuner mercredi 13:00 pour 3 — Pierre Bernard (19765ms, 2 tool calls)
- **B03-012** `multilingua`: FR — Déjeuner mardi 12:00 pour 5 — Sophie Petit (20433ms, 2 tool calls)
- **B03-013** `multilingua`: FR — Dîner samedi 21:00 pour 6 — Antoine Moreau (16990ms, 2 tool calls)
- **B03-014** `multilingua`: FR — Dîner dimanche 22:00 pour 2 — Camille Rousseau (18347ms, 2 tool calls)
- **B03-015** `multilingua`: FR — Dîner mardi 22:00 pour 4 — Julien Lefevre (18006ms, 2 tool calls)
- **B03-016** `multilingua`: FR — Dîner vendredi 21:30 pour 3 — Isabelle Girard (29352ms, 2 tool calls)
- **B03-017** `multilingua`: DE — Mittagessen Samstag 13:00 für 2 — Hans Müller (21487ms, 2 tool calls)
- **B03-018** `multilingua`: DE — Mittagessen Sonntag 12:30 für 4 — Anna Schmidt (26705ms, 2 tool calls)
- **B03-019** `multilingua`: DE — Mittagessen Mittwoch 13:00 für 3 — Thomas Weber (20962ms, 2 tool calls)
- **B03-020** `multilingua`: DE — Abendessen Samstag 21:00 für 5 — Petra Wagner (21815ms, 2 tool calls)
- **B03-021** `multilingua`: DE — Abendessen Sonntag 22:00 für 2 — Klaus Fischer (17097ms, 2 tool calls)
- **B03-022** `multilingua`: DE — Abendessen Dienstag 22:00 für 4 — Sabine Meyer (18942ms, 2 tool calls)
- **B03-023** `multilingua`: DE — Abendessen Freitag 21:30 für 3 — Wolfgang Bauer (19182ms, 2 tool calls)
- **B03-024** `multilingua`: ES — Almuerzo sábado 13:00 para 2 — Carlos García (19337ms, 2 tool calls)
- **B03-025** `multilingua`: ES — Almuerzo domingo 12:30 para 4 — María López (21825ms, 2 tool calls)
- **B03-026** `multilingua`: ES — Almuerzo miércoles 13:00 para 3 — José Fernández (17945ms, 2 tool calls)
- **B03-027** `multilingua`: ES — Cena sábado 21:00 para 5 — Ana Martínez (27813ms, 2 tool calls)
- **B03-028** `multilingua`: ES — Cena domingo 22:00 para 2 — Miguel Rodríguez (22821ms, 2 tool calls)
- **B03-029** `multilingua`: ES — Cena martes 22:00 para 4 — Elena Sánchez (22671ms, 2 tool calls)
- **B03-030** `multilingua`: ES — Cena viernes 21:30 para 3 — Antonio Pérez (18673ms, 2 tool calls)

## ❌ Failed (4)

### B03-001 — `multilingua`
**Description**: EN — Lunch Saturday 13:00 for 2 — John Smith

**Reason**: expected reply language 'en' — got: la prenotazione è confermata per john smith, 25 luglio alle 13:00, 2 persone.

**Full transcript**:

**[User turn 1]**: Good morning, I'd like to book a table for next Saturday at 1 PM for 2 people, under the name John Smith

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Yes, please confirm

**[AI reply 2]**: Just a moment, I’ll check availability for that time.

**[AI reply 3]**: Perfect, I’ll register the reservation now.

**[AI reply 4]**: Prenotato per John Smith, sabato 25 luglio 2026 alle 13:00, per 2 persone.

**[AI reply 5]**: La prenotazione è confermata per John Smith, 25 luglio alle 13:00, 2 persone.

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

**Duration**: 17798ms

---

### B03-004 — `multilingua`
**Description**: EN — Lunch Wednesday 13:30 for 5 — Sarah Wilson

**Reason**: expected reply language 'en' — got: certo, confermo: sarah wilson, mercoledì 29 luglio alle 13:30, 5 persone. la prenotazione è registrata.

**Full transcript**:

**[User turn 1]**: Hello, I would like a table for next Wednesday at 1:30 PM for 5 people, under the name Sarah Wilson

**[AI reply 1]**: "Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?"

**[User turn 2]**: Yes, confirm please

**[AI reply 2]**: Un attimo, controllo la disponibilità per questa data e ora prima di registrare la prenotazione.

**[AI reply 3]**: Perfetto, prenotato per Sarah Wilson, mercoledì 29 luglio alle 13:30, 5 persone.

**[AI reply 4]**: Certo, confermo: Sarah Wilson, mercoledì 29 luglio alle 13:30, 5 persone. La prenotazione è registrata.

**Tool calls made** (2):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-07-29",
      "ora": "13:30",
      "persone": 5
    }
  },
  {
    "name": "crea_prenotazione",
    "args": {
      "nome": "Sarah Wilson",
      "data": "2026-07-29",
      "ora": "13:30",
      "persone": 5,
      "note": "Prenotazione per 5 persone alle 13:30."
    }
  }
]
```

**Duration**: 19444ms

---

### B03-005 — `multilingua`
**Description**: EN — Dinner Saturday 21:00 for 6 — David Miller

**Reason**: expected reply language 'en' — got: perfetto, confermato. la prenotazione è registrata per sabato 25 luglio alle 21:00, 6 persone.

**Full transcript**:

**[User turn 1]**: Good evening, I would like to book a table for next Saturday at 9 PM for 6 people, name David Miller

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Yes confirm

**[AI reply 2]**: I’ll check availability for that date and time now.

**[AI reply 3]**: Prenotazione confermata per David Miller, sabato 25 luglio alle 21:00, 6 persone.

**[AI reply 4]**: Perfetto, confermato. La prenotazione è registrata per sabato 25 luglio alle 21:00, 6 persone.

**Tool calls made** (2):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-07-25",
      "ora": "21:00",
      "persone": 6
    }
  },
  {
    "name": "crea_prenotazione",
    "args": {
      "nome": "David Miller",
      "data": "2026-07-25",
      "ora": "21:00",
      "persone": 6,
      "note": ""
    }
  }
]
```

**Duration**: 15877ms

---

### B03-007 — `multilingua`
**Description**: EN — Dinner Tuesday 22:00 for 4 — Robert Anderson

**Reason**: expected reply language 'en' — got: perfetto, la prenotazione è confermata. ti aspettiamo alle 22:00 con 4 persone.

**Full transcript**:

**[User turn 1]**: Good evening, I would like to book for next Tuesday evening at 10 PM for 4 people, name Robert Anderson

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Yes

**[AI reply 2]**: I’ll check availability for that time and party size. One moment.

**[AI reply 3]**: The slot is available. I’ll register the booking now.

**[AI reply 4]**: Prenotazione confermata: Robert Anderson, martedì 28 luglio alle 22:00, 4 persone.

**[AI reply 5]**: Perfetto, la prenotazione è confermata. Ti aspettiamo alle 22:00 con 4 persone.

**Tool calls made** (2):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-07-28",
      "ora": "22:00",
      "persone": 4
    }
  },
  {
    "name": "crea_prenotazione",
    "args": {
      "nome": "Robert Anderson",
      "data": "2026-07-28",
      "ora": "22:00",
      "persone": 4,
      "note": ""
    }
  }
]
```

**Duration**: 18569ms

---

