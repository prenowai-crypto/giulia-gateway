# Batch B-01 (tests 1-30)
Run: 2026-07-22T15:31:47.086Z | Model: gpt-realtime-2.1-mini | Total: 30 | Passed: 27 (90%) | Failed: 3

## ✅ Passed (27)

- **B03-001** `multilingua`: EN — Lunch Saturday 13:00 for 2 — John Smith (20153ms, 2 tool calls)
- **B03-002** `multilingua`: EN — Lunch Sunday 12:30 for 4 — Emma Johnson (18518ms, 2 tool calls)
- **B03-003** `multilingua`: EN — Lunch Tuesday 12:00 for 3 — Michael Brown (21861ms, 2 tool calls)
- **B03-004** `multilingua`: EN — Lunch Wednesday 13:30 for 5 — Sarah Wilson (17148ms, 2 tool calls)
- **B03-005** `multilingua`: EN — Dinner Saturday 21:00 for 6 — David Miller (23345ms, 2 tool calls)
- **B03-006** `multilingua`: EN — Dinner Sunday 22:00 for 2 — Jennifer Davis (17740ms, 2 tool calls)
- **B03-008** `multilingua`: EN — Dinner Wednesday 21:30 for 3 — Lisa Taylor (19606ms, 2 tool calls)
- **B03-009** `multilingua`: FR — Déjeuner samedi 13:00 pour 2 — Jean Dupont (28482ms, 2 tool calls)
- **B03-010** `multilingua`: FR — Déjeuner dimanche 12:30 pour 4 — Marie Martin (18478ms, 2 tool calls)
- **B03-011** `multilingua`: FR — Déjeuner mercredi 13:00 pour 3 — Pierre Bernard (35194ms, 3 tool calls)
- **B03-012** `multilingua`: FR — Déjeuner mardi 12:00 pour 5 — Sophie Petit (20481ms, 2 tool calls)
- **B03-013** `multilingua`: FR — Dîner samedi 21:00 pour 6 — Antoine Moreau (17453ms, 2 tool calls)
- **B03-014** `multilingua`: FR — Dîner dimanche 22:00 pour 2 — Camille Rousseau (15344ms, 2 tool calls)
- **B03-015** `multilingua`: FR — Dîner mardi 22:00 pour 4 — Julien Lefevre (18684ms, 2 tool calls)
- **B03-016** `multilingua`: FR — Dîner vendredi 21:30 pour 3 — Isabelle Girard (18180ms, 2 tool calls)
- **B03-017** `multilingua`: DE — Mittagessen Samstag 13:00 für 2 — Hans Müller (20670ms, 2 tool calls)
- **B03-018** `multilingua`: DE — Mittagessen Sonntag 12:30 für 4 — Anna Schmidt (17473ms, 2 tool calls)
- **B03-020** `multilingua`: DE — Abendessen Samstag 21:00 für 5 — Petra Wagner (19702ms, 2 tool calls)
- **B03-021** `multilingua`: DE — Abendessen Sonntag 22:00 für 2 — Klaus Fischer (18383ms, 2 tool calls)
- **B03-022** `multilingua`: DE — Abendessen Dienstag 22:00 für 4 — Sabine Meyer (19075ms, 2 tool calls)
- **B03-023** `multilingua`: DE — Abendessen Freitag 21:30 für 3 — Wolfgang Bauer (24819ms, 2 tool calls)
- **B03-024** `multilingua`: ES — Almuerzo sábado 13:00 para 2 — Carlos García (17582ms, 2 tool calls)
- **B03-025** `multilingua`: ES — Almuerzo domingo 12:30 para 4 — María López (16899ms, 2 tool calls)
- **B03-026** `multilingua`: ES — Almuerzo miércoles 13:00 para 3 — José Fernández (18780ms, 2 tool calls)
- **B03-027** `multilingua`: ES — Cena sábado 21:00 para 5 — Ana Martínez (18957ms, 2 tool calls)
- **B03-029** `multilingua`: ES — Cena martes 22:00 para 4 — Elena Sánchez (18578ms, 2 tool calls)
- **B03-030** `multilingua`: ES — Cena viernes 21:30 para 3 — Antonio Pérez (24580ms, 2 tool calls)

## ❌ Failed (3)

### B03-007 — `multilingua`
**Description**: EN — Dinner Tuesday 22:00 for 4 — Robert Anderson

**Reason**: expected reply language 'en' — got: perfetto, prenotazione confermata. buon appetito e a presto!

**Full transcript**:

**[User turn 1]**: Good evening, I would like to book for next Tuesday evening at 10 PM for 4 people, name Robert Anderson

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Yes

**[AI reply 2]**: I’ll check availability for that date and time.

**[AI reply 3]**: Booked for Robert Anderson, Tuesday July 28 at 10:00 PM, for 4 people.

**[AI reply 4]**: Perfetto, prenotazione confermata. Buon appetito e a presto!

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
      "note": "Prenotazione telefonica per cena."
    }
  }
]
```

**Duration**: 16804ms

---

### B03-019 — `multilingua`
**Description**: DE — Mittagessen Mittwoch 13:00 für 3 — Thomas Weber

**Reason**: expected reply language 'de' — got: alles klar, ich habe es notiert. möchten sie noch etwas hinzufügen, oder sind sie fertig?

**Full transcript**:

**[User turn 1]**: Guten Tag, einen Tisch für nächsten Mittwoch um 13 Uhr für 3 Personen, auf den Namen Thomas Weber

**[AI reply 1]**: "Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?"

**[User turn 2]**: Ja bitte

**[AI reply 2]**: All set! Your reservation is confirmed for Thomas Weber, Wednesday 29 July 2026 at 13:00, for 3 people.

**[AI reply 3]**: Alles klar, ich habe es notiert. Möchten Sie noch etwas hinzufügen, oder sind Sie fertig?

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
      "nome": "Thomas Weber",
      "data": "2026-07-29",
      "ora": "13:00",
      "persone": 3,
      "note": ""
    }
  }
]
```

**Duration**: 20731ms

---

### B03-028 — `multilingua`
**Description**: ES — Cena domingo 22:00 para 2 — Miguel Rodríguez

**Reason**: expected reply language 'es' — got: bien, ¿puedes decirme qué quieres confirmar o ajustar?

**Full transcript**:

**[User turn 1]**: Buenas noches, una mesa para el próximo domingo a las 22 para 2 personas, a nombre de Miguel Rodríguez

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Sí, por favor

**[AI reply 2]**: Claro, podemos continuar en español. Soy el asistente vocal automático de Osteria Test — voy a verificar disponibilidad.

**[AI reply 3]**: Perfecto, voy a registrar la reserva ahora.

**[AI reply 4]**: Listo, Miguel Rodríguez, reservado el domingo 26 de julio a las 22:00 para 2 personas. ¡Nos vemos!

**[AI reply 5]**: Bien, ¿puedes decirme qué quieres confirmar o ajustar?

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
      "nome": "Miguel Rodríguez",
      "data": "2026-07-26",
      "ora": "22:00",
      "persone": 2,
      "note": "Reserva telefónica confirmada por el asistente automático."
    }
  }
]
```

**Duration**: 20993ms

---

