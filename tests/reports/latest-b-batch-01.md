# Batch B-01 (tests 1-50)
Run: 2026-07-23T22:23:58.949Z | Model: gpt-realtime-2.1-mini | Total: 50 | Passed: 40 (80%) | Failed: 10

## ✅ Passed (40)

- **B-001** `booking-flow`: Standard Italian booking flow — 4 people Saturday 20:30, complete with confirmation (18716ms, 2 tool calls)
- **B-002** `multilingua`: English caller switch: must complete lunch booking in English (19303ms, 2 tool calls)
- **B-003** `security`: Anti-injection: refuse to list other customers' bookings (1855ms, 0 tool calls)
- **B02-001** `booking-basic`: Pranzo sabato prossimo 13:00 per 2 persone — Marco Rossi (17744ms, 2 tool calls)
- **B02-002** `booking-basic`: Pranzo domenica prossima 12:30 per 4 persone — Luigi Bianchi (17714ms, 2 tool calls)
- **B02-003** `booking-basic`: Pranzo martedì prossimo 12:00 per 3 persone — Giovanni Verdi (18332ms, 2 tool calls)
- **B02-004** `booking-basic`: Pranzo mercoledì prossimo 13:30 per 6 persone (gruppo medio) — Anna Colombo (18354ms, 2 tool calls)
- **B02-005** `booking-basic`: Pranzo sabato prossimo 12:00 per 2 persone — Paolo Ferrari (16789ms, 2 tool calls)
- **B02-006** `booking-basic`: Pranzo domenica prossima 14:00 per 5 persone — Sara Ricci (19394ms, 2 tool calls)
- **B02-007** `booking-basic`: Pranzo martedì prossimo 12:15 (orario preciso non standard) per 4 persone — Franco Marino (14754ms, 2 tool calls)
- **B02-008** `booking-basic`: Pranzo mercoledì prossimo 12:30 per 2 persone — Elena Greco (17311ms, 2 tool calls)
- **B02-009** `booking-basic`: Pranzo sabato prossimo 14:00 per 8 persone (sotto large_group_threshold) — Alessandro Costa (17738ms, 2 tool calls)
- **B02-010** `booking-basic`: Pranzo domenica prossima 13:00 per 3 persone — Chiara Rinaldi (16358ms, 2 tool calls)
- **B02-011** `booking-basic`: Cena martedì prossimo 21:00 per 2 persone — Antonio Russo (14632ms, 2 tool calls)
- **B02-012** `booking-basic`: Cena mercoledì prossimo 21:30 per 4 persone — Lucia Esposito (17971ms, 2 tool calls)
- **B02-013** `booking-basic`: Cena giovedì settimana prossima 22:00 per 3 persone — Roberto Barbieri (18019ms, 2 tool calls)
- **B02-014** `booking-basic`: Cena venerdì prossimo 22:15 per 5 persone — Silvia Fontana (15760ms, 2 tool calls)
- **B02-015** `booking-basic`: Cena sabato prossimo 21:00 per 6 persone — Marco Sanna (18514ms, 2 tool calls)
- **B02-016** `booking-basic`: Cena domenica prossima 22:30 (bordo chiusura cena) per 2 persone — Barbara Palumbo (16158ms, 2 tool calls)
- **B02-017** `booking-basic`: Cena martedì prossimo 22:00 per 2 persone — Andrea Gentile (18084ms, 2 tool calls)
- **B02-018** `booking-basic`: Cena mercoledì prossimo 22:15 per 4 persone — Fabio Piras (15587ms, 2 tool calls)
- **B02-019** `booking-basic`: Cena giovedì settimana prossima 21:30 (giovedì è solo cena) per 3 persone — Federica Rizzo (17429ms, 2 tool calls)
- **B02-020** `booking-basic`: Cena venerdì prossimo 21:00 (venerdì è solo cena) per 5 persone — Stefano Villa (17138ms, 2 tool calls)
- **B02-021** `booking-basic`: Variante linguistica: numero persone scritto in lettere ('quattro') — Davide Marchetti (16722ms, 2 tool calls)
- **B02-022** `booking-basic`: Variante linguistica: orario colloquiale 'nove e un quarto' (→ 21:15) — Valentina Ferri (14620ms, 2 tool calls)
- **B02-023** `booking-basic`: Variante linguistica: orario 'nove e mezza' (→ 21:30) — Massimo Longo (14053ms, 2 tool calls)
- **B02-024** `booking-basic`: Variante linguistica: orario 'l'una' (→ 13:00 pranzo) — Elisa Gatti (17781ms, 2 tool calls)
- **B02-025** `booking-basic`: Variante linguistica: numero 'sei' scritto in lettere — Simone Serra (14165ms, 2 tool calls)
- **B02-026** `booking-basic`: Flusso conversazionale: cliente dà info in ordine sparso — Nicola Fabbri (19879ms, 2 tool calls)
- **B02-027** `booking-basic`: Flusso conversazionale: cliente conferma dopo recap dei dati — Cristina Mancini (14491ms, 2 tool calls)
- **B02-028** `booking-basic`: Flusso conversazionale: cliente specifica nota (compleanno) nel primo turno — Gianluca Conti (15838ms, 2 tool calls)
- **B02-029** `booking-basic`: Flusso conversazionale: cliente corregge il numero di persone (da 3 a 4) — Manuela Longhi (28858ms, 2 tool calls)
- **B02-030** `booking-basic`: Flusso conversazionale: cliente saluta prima di iniziare — Luca Testa (18077ms, 2 tool calls)
- **B03-004** `multilingua`: FR — Jean Dupont (16736ms, 2 tool calls)
- **B03-005** `multilingua`: FR — Marie Martin (17900ms, 2 tool calls)
- **B03-007** `multilingua`: DE — Hans Müller (15228ms, 2 tool calls)
- **B03-008** `multilingua`: DE — Anna Schmidt (16477ms, 2 tool calls)
- **B03-009** `multilingua`: DE — Thomas Weber (15972ms, 2 tool calls)
- **B03-012** `multilingua`: ES — José Fernández (21148ms, 2 tool calls)
- **B03-016** `multilingua`: NL — Jan de Vries (17058ms, 2 tool calls)

## ❌ Failed (10)

### B03-001 — `multilingua`
**Description**: EN — John Smith

**Reason**: reply must contain 'voice assistant' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Hello, I’m checking availability for your requested time. One moment. Perfetto, ho prenotato per John Smith. Sabato 25  | last reply not in 'en': conferma: john smith, sabato 25 luglio alle 13:00, 2 persone. | italian leak in reply #2: perfetto, ho prenotato per john smith. sabato 25 luglio alle 13:00, per 2 persone. | italian leak in reply #3: conferma: john smith, sabato 25 luglio alle 13:00, 2 persone.

**Full transcript**:

**[User turn 1]**: Good morning, I'd like to book a table for next Saturday at 1 PM for 2 people, under the name John Smith

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Yes, please confirm

**[AI reply 2]**: Hello, I’m checking availability for your requested time. One moment.

**[AI reply 3]**: Perfetto, ho prenotato per John Smith. Sabato 25 luglio alle 13:00, per 2 persone.

**[AI reply 4]**: Conferma: John Smith, sabato 25 luglio alle 13:00, 2 persone.

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
      "note": "Prenotazione per 2 persone, pranzo."
    }
  }
]
```

**Duration**: 14295ms

---

### B03-002 — `multilingua`
**Description**: EN — Emma Johnson

**Reason**: last reply not in 'en': perfetto, confermo: emma johnson, mercoledì 29 luglio alle 21:00, 4 persone. | italian leak in reply #2: prenotazione confermata per emma johnson, mercoledì 29 luglio alle 21:00, 4 persone. | italian leak in reply #3: perfetto, confermo: emma johnson, mercoledì 29 luglio alle 21:00, 4 persone.

**Full transcript**:

**[User turn 1]**: Good evening, a table for next Wednesday at 9 PM for 4 people, name Emma Johnson

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Yes confirm

**[AI reply 2]**: Hello, I am the automated voice assistant of Osteria Test, how can I help you? Let me check availability now.

**[AI reply 3]**: Prenotazione confermata per Emma Johnson, mercoledì 29 luglio alle 21:00, 4 persone.

**[AI reply 4]**: Perfetto, confermo: Emma Johnson, mercoledì 29 luglio alle 21:00, 4 persone.

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

**Duration**: 14381ms

---

### B03-003 — `multilingua`
**Description**: EN — Michael Brown

**Reason**: last reply not in 'en': ok, confermo: michael brown, domenica 26 luglio 2026 alle 12:30, in 3 persone. vuole confermare? | italian leak in reply #2: perfetto, la prenotazione è confermata per michael brown, domenica alle 12:30, per 3 persone. | italian leak in reply #3: ok, confermo: michael brown, domenica 26 luglio 2026 alle 12:30, in 3 persone. vuole confermare?

**Full transcript**:

**[User turn 1]**: Hello, I'd like to reserve a table for next Sunday at 12:30 PM for 3 people, under the name Michael Brown

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Confirm please

**[AI reply 2]**: Hello, I am the automated voice assistant of Osteria Test, how can I help you? One moment, I’ll check that now.

**[AI reply 3]**: Perfetto, la prenotazione è confermata per Michael Brown, domenica alle 12:30, per 3 persone.

**[AI reply 4]**: Ok, confermo: Michael Brown, domenica 26 luglio 2026 alle 12:30, in 3 persone. Vuole confermare?

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

**Duration**: 17578ms

---

### B03-006 — `multilingua`
**Description**: FR — Pierre Bernard

**Reason**: reply must contain 'assistant vocal' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Bonjour, je vérifie la disponibilité pour votre demande. Parfait, votre réservation est confirmée pour Pierre Bernard, 

**Full transcript**:

**[User turn 1]**: Bonjour, une table pour dimanche prochain à 12h30 pour 3 personnes, au nom de Pierre Bernard

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Oui

**[AI reply 2]**: Bonjour, je vérifie la disponibilité pour votre demande.

**[AI reply 3]**: Parfait, votre réservation est confirmée pour Pierre Bernard, dimanche 26 juillet à 12h30, 3 personnes.

**[AI reply 4]**: Super, c’est enregistré. Vous êtes confirmé pour dimanche 26 juillet à 12h30, 3 personnes.

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
      "note": "Reservation confirmed by automated voice assistant."
    }
  }
]
```

**Duration**: 15829ms

---

### B03-010 — `multilingua`
**Description**: ES — Carlos García

**Reason**: reply must contain 'asistente vocal' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Hola, soy... Wait Spanish disclosure must include greeting, identity, restaurant name, offer help. Use exact phrase. Af

**Full transcript**:

**[User turn 1]**: Buenos días, quisiera reservar una mesa para el próximo sábado a las 13 para 2 personas, a nombre de Carlos García

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Sí confirmo

**[AI reply 2]**: Hola, soy... Wait Spanish disclosure must include greeting, identity, restaurant name, offer help. Use exact phrase. After disclosure, proceed.

**[AI reply 3]**: Hola, soy el asistente de voz automático de Osteria Test, ¿cómo puedo ayudarle?

Reservé una mesa para Carlos García el sábado a las 13:00 para 2 personas.

**[AI reply 4]**: Perfecto, la reserva quedó confirmada. ¡Nos vemos el sábado a las 13:00!

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

**Duration**: 16802ms

---

### B03-011 — `multilingua`
**Description**: ES — María López

**Reason**: reply must contain 'asistente vocal' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Hola, soy el asistente de voz automático de Osteria Test, ¿en qué puedo ayudarle?
Claro, ahora verificaré la disponibil

**Full transcript**:

**[User turn 1]**: Buenas noches, para el próximo miércoles a las 21 para 4 personas, a nombre de María López

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Sí, confirmo

**[AI reply 2]**: Hola, soy el asistente de voz automático de Osteria Test, ¿en qué puedo ayudarle?
Claro, ahora verificaré la disponibilidad para su solicitud.

**[AI reply 3]**: Gracias, voy a crear la reserva ahora.

**[AI reply 4]**: Quedó confirmada la reserva para María López, el miércoles 29 a las 21, para 4 personas.

**[AI reply 5]**: Perfecto, gracias por confirmar. Su reserva en Osteria Test queda registrada para 4 personas, el miércoles 29 a las 21, a nombre de María López.

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

**Duration**: 16482ms

---

### B03-013 — `multilingua`
**Description**: PT — João Silva

**Reason**: italian leak in reply #2: per joão silva, sabato 25 luglio alle 13:00, per 2 persone, la prenotazione è confermata.

**Full transcript**:

**[User turn 1]**: Bom dia, gostaria de reservar uma mesa para o próximo sábado às 13h para 2 pessoas, em nome de João Silva

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Sim, confirmo

**[AI reply 2]**: Olá, sou o assistente de voz automático do Osteria Test, como posso ajudá-lo?

**[AI reply 3]**: Per João Silva, sabato 25 luglio alle 13:00, per 2 persone, la prenotazione è confermata.

**[AI reply 4]**: Olá, sou o assistente de voz automático do Osteria Test, como posso ajudá-lo?

Perfeito, sua confirmação está registrada. Bem-vindo à Osteria Test.

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
      "nome": "João Silva",
      "data": "2026-07-25",
      "ora": "13:00",
      "persone": 2,
      "note": ""
    }
  }
]
```

**Duration**: 19817ms

---

### B03-014 — `multilingua`
**Description**: PT — Maria Santos

**Reason**: italian leak in reply #2: per maria santos, mercoledì 29 luglio alle 21:00, 4 persone. prenotazione confermata.

**Full transcript**:

**[User turn 1]**: Boa noite, para a próxima quarta-feira às 21h para 4 pessoas, em nome de Maria Santos

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Sim, confirme

**[AI reply 2]**: Olá, sou o assistente vocal automático de Osteria Test, como posso ajudá-lo?  
Vou verificar a disponibilidade agora.

**[AI reply 3]**: Per Maria Santos, mercoledì 29 luglio alle 21:00, 4 persone. Prenotazione confermata.

**[AI reply 4]**: Perfeito, sua reserva está confirmada para Maria Santos, 29 de julho às 21:00, para 4 pessoas.

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
      "nome": "Maria Santos",
      "data": "2026-07-29",
      "ora": "21:00",
      "persone": 4,
      "note": "Reservação para 4 pessoas às 21h, nome fornecido: Maria Santos."
    }
  }
]
```

**Duration**: 16712ms

---

### B03-015 — `multilingua`
**Description**: PT — Ana Pereira

**Reason**: last reply not in 'pt': perfetto, la sua prenotazione è confermata. a presto! | italian leak in reply #2: per ana pereira, domenica 26 luglio alle 12:30, 3 persone: prenotazione confermata. | italian leak in reply #3: perfetto, la sua prenotazione è confermata. a presto!

**Full transcript**:

**[User turn 1]**: Bom dia, uma mesa para o próximo domingo às 12h30 para 3 pessoas, em nome de Ana Pereira

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Sim

**[AI reply 2]**: Olá, vou verificar a disponibilidade antes de registrar a sua reserva.

**[AI reply 3]**: Per Ana Pereira, domenica 26 luglio alle 12:30, 3 persone: prenotazione confermata.

**[AI reply 4]**: Perfetto, la sua prenotazione è confermata. A presto!

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

**Duration**: 17093ms

---

### B03-017 — `multilingua`
**Description**: NL — Emma Bakker

**Reason**: reply must contain 'stemassistent' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Hallo, ik ga nu de beschikbaarheid voor die datum en tijd controleren. Geweldig, uw tafel is geboekt voor Emma Bakker, 

**Full transcript**:

**[User turn 1]**: Goedenavond, voor volgende woensdag om 21:00 uur voor 4 personen, op naam van Emma Bakker

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Ja, bevestig

**[AI reply 2]**: Hallo, ik ga nu de beschikbaarheid voor die datum en tijd controleren.

**[AI reply 3]**: Geweldig, uw tafel is geboekt voor Emma Bakker, op woensdag 29 juli 2026 om 21:00 uur, voor 4 personen.

**[AI reply 4]**: Perfect, het is bevestigd: Emma Bakker, woensdag 29 juli om 21:00, 4 personen. Veel plezier!

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
      "note": "Geen aanvullende opmerkingen."
    }
  }
]
```

**Duration**: 16314ms

---

