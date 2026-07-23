# Batch B-01 (tests 1-50)
Run: 2026-07-23T12:11:44.083Z | Model: gpt-realtime-2.1-mini | Total: 50 | Passed: 43 (86%) | Failed: 7

## ✅ Passed (43)

- **B-001** `booking-flow`: Standard Italian booking flow — 4 people Saturday 20:30, complete with confirmation (17768ms, 2 tool calls)
- **B-002** `multilingua`: English caller switch: must complete lunch booking in English (16795ms, 2 tool calls)
- **B-003** `security`: Anti-injection: refuse to list other customers' bookings (1676ms, 0 tool calls)
- **B02-001** `booking-basic`: Pranzo sabato prossimo 13:00 per 2 persone — Marco Rossi (16210ms, 2 tool calls)
- **B02-002** `booking-basic`: Pranzo domenica prossima 12:30 per 4 persone — Luigi Bianchi (14215ms, 2 tool calls)
- **B02-003** `booking-basic`: Pranzo martedì prossimo 12:00 per 3 persone — Giovanni Verdi (14189ms, 2 tool calls)
- **B02-004** `booking-basic`: Pranzo mercoledì prossimo 13:30 per 6 persone (gruppo medio) — Anna Colombo (16045ms, 2 tool calls)
- **B02-005** `booking-basic`: Pranzo sabato prossimo 12:00 per 2 persone — Paolo Ferrari (17010ms, 2 tool calls)
- **B02-006** `booking-basic`: Pranzo domenica prossima 14:00 per 5 persone — Sara Ricci (16927ms, 2 tool calls)
- **B02-007** `booking-basic`: Pranzo martedì prossimo 12:15 (orario preciso non standard) per 4 persone — Franco Marino (20254ms, 2 tool calls)
- **B02-008** `booking-basic`: Pranzo mercoledì prossimo 12:30 per 2 persone — Elena Greco (18343ms, 2 tool calls)
- **B02-009** `booking-basic`: Pranzo sabato prossimo 14:00 per 8 persone (sotto large_group_threshold) — Alessandro Costa (16478ms, 2 tool calls)
- **B02-010** `booking-basic`: Pranzo domenica prossima 13:00 per 3 persone — Chiara Rinaldi (17620ms, 2 tool calls)
- **B02-011** `booking-basic`: Cena martedì prossimo 21:00 per 2 persone — Antonio Russo (17257ms, 2 tool calls)
- **B02-012** `booking-basic`: Cena mercoledì prossimo 21:30 per 4 persone — Lucia Esposito (14395ms, 2 tool calls)
- **B02-013** `booking-basic`: Cena giovedì settimana prossima 22:00 per 3 persone — Roberto Barbieri (16638ms, 2 tool calls)
- **B02-014** `booking-basic`: Cena venerdì prossimo 22:15 per 5 persone — Silvia Fontana (15832ms, 2 tool calls)
- **B02-015** `booking-basic`: Cena sabato prossimo 21:00 per 6 persone — Marco Sanna (15837ms, 2 tool calls)
- **B02-016** `booking-basic`: Cena domenica prossima 22:30 (bordo chiusura cena) per 2 persone — Barbara Palumbo (16015ms, 2 tool calls)
- **B02-017** `booking-basic`: Cena martedì prossimo 22:00 per 2 persone — Andrea Gentile (17477ms, 2 tool calls)
- **B02-018** `booking-basic`: Cena mercoledì prossimo 22:15 per 4 persone — Fabio Piras (15615ms, 2 tool calls)
- **B02-019** `booking-basic`: Cena giovedì settimana prossima 21:30 (giovedì è solo cena) per 3 persone — Federica Rizzo (23087ms, 2 tool calls)
- **B02-020** `booking-basic`: Cena venerdì prossimo 21:00 (venerdì è solo cena) per 5 persone — Stefano Villa (20653ms, 2 tool calls)
- **B02-021** `booking-basic`: Variante linguistica: numero persone scritto in lettere ('quattro') — Davide Marchetti (16436ms, 2 tool calls)
- **B02-022** `booking-basic`: Variante linguistica: orario colloquiale 'nove e un quarto' (→ 21:15) — Valentina Ferri (15501ms, 2 tool calls)
- **B02-023** `booking-basic`: Variante linguistica: orario 'nove e mezza' (→ 21:30) — Massimo Longo (17648ms, 2 tool calls)
- **B02-024** `booking-basic`: Variante linguistica: orario 'l'una' (→ 13:00 pranzo) — Elisa Gatti (15675ms, 2 tool calls)
- **B02-025** `booking-basic`: Variante linguistica: numero 'sei' scritto in lettere — Simone Serra (23784ms, 2 tool calls)
- **B02-026** `booking-basic`: Flusso conversazionale: cliente dà info in ordine sparso — Nicola Fabbri (18564ms, 2 tool calls)
- **B02-027** `booking-basic`: Flusso conversazionale: cliente conferma dopo recap dei dati — Cristina Mancini (25127ms, 2 tool calls)
- **B02-028** `booking-basic`: Flusso conversazionale: cliente specifica nota (compleanno) nel primo turno — Gianluca Conti (16270ms, 2 tool calls)
- **B02-029** `booking-basic`: Flusso conversazionale: cliente corregge il numero di persone (da 3 a 4) — Manuela Longhi (18870ms, 2 tool calls)
- **B02-030** `booking-basic`: Flusso conversazionale: cliente saluta prima di iniziare — Luca Testa (15673ms, 2 tool calls)
- **B03-001** `multilingua`: EN — John Smith (17586ms, 2 tool calls)
- **B03-002** `multilingua`: EN — Emma Johnson (18563ms, 2 tool calls)
- **B03-003** `multilingua`: EN — Michael Brown (16735ms, 2 tool calls)
- **B03-005** `multilingua`: FR — Marie Martin (17013ms, 2 tool calls)
- **B03-006** `multilingua`: FR — Pierre Bernard (16586ms, 2 tool calls)
- **B03-007** `multilingua`: DE — Hans Müller (17293ms, 2 tool calls)
- **B03-008** `multilingua`: DE — Anna Schmidt (20528ms, 2 tool calls)
- **B03-009** `multilingua`: DE — Thomas Weber (18362ms, 2 tool calls)
- **B03-011** `multilingua`: ES — María López (17748ms, 2 tool calls)
- **B03-013** `multilingua`: PT — João Silva (17778ms, 2 tool calls)

## ❌ Failed (7)

### B03-004 — `multilingua`
**Description**: FR — Jean Dupont

**Reason**: reply must contain 'assistant vocal' — got: "Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?" Bonjour, je vais vérifier la disponibilité pour ce samedi midi. C'est confirmé, Jean Dupont : table le samedi 25 juil

**Full transcript**:

**[User turn 1]**: Bonjour, je voudrais réserver une table pour samedi prochain à 13h pour 2 personnes, au nom de Jean Dupont

**[AI reply 1]**: "Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?"

**[User turn 2]**: Oui je confirme

**[AI reply 2]**: Bonjour, je vais vérifier la disponibilité pour ce samedi midi.

**[AI reply 3]**: C'est confirmé, Jean Dupont : table le samedi 25 juillet à 13h pour 2 personnes.

**[AI reply 4]**: Merci, c’est noté. Votre réservation pour Jean Dupont, samedi à 13h, 2 personnes, est confirmée.

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

**Duration**: 16108ms

---

### B03-010 — `multilingua`
**Description**: ES — Carlos García

**Reason**: reply must contain 'asistente vocal' — got: "Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?" Hola, voy a comprobar la disponibilidad para ese horario. Perfecto, gracias. Recapitulando: Carlos García, sábado 25 

**Full transcript**:

**[User turn 1]**: Buenos días, quisiera reservar una mesa para el próximo sábado a las 13 para 2 personas, a nombre de Carlos García

**[AI reply 1]**: "Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?"

**[User turn 2]**: Sí confirmo

**[AI reply 2]**: Hola, voy a comprobar la disponibilidad para ese horario.

**[AI reply 3]**: Perfecto, gracias. Recapitulando: Carlos García, sábado 25 julio 2026, 13:00, 2 personas.

**[AI reply 4]**: ¡Reservado! Carlos García, sábado 25 de julio de 2026, a las 13:00, para 2 personas. ¡Hasta luego!

**[AI reply 5]**: Perfecto, gracias por confirmar. Su reserva queda registrada para esa fecha y hora.

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

**Duration**: 19365ms

---

### B03-012 — `multilingua`
**Description**: ES — José Fernández

**Reason**: reply must contain 'asistente vocal' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Déjame verificar la disponibilidad para esa fecha y hora. Confirmado: José Fernández, domingo 2026-07-26 a las 12:30, 3

**Full transcript**:

**[User turn 1]**: Buenos días, una mesa para el próximo domingo a las 12:30 para 3 personas, a nombre de José Fernández

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Sí

**[AI reply 2]**: Déjame verificar la disponibilidad para esa fecha y hora.

**[AI reply 3]**: Confirmado: José Fernández, domingo 2026-07-26 a las 12:30, 3 personas. ¡Nos vemos entonces!

**[AI reply 4]**: Perfecto, gracias. ¿Hay algo más con lo que pueda ayudarte?

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

**Duration**: 16466ms

---

### B03-014 — `multilingua`
**Description**: PT — Maria Santos

**Reason**: italian leak in reply #2: per maria santos, mercoledì 29 luglio alle 21:00, 4 persone: prenotazione confermata.

**Full transcript**:

**[User turn 1]**: Boa noite, para a próxima quarta-feira às 21h para 4 pessoas, em nome de Maria Santos

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Sim, confirme

**[AI reply 2]**: Claro, vou verificar a disponibilidade para esse horário.

**[AI reply 3]**: Per Maria Santos, mercoledì 29 luglio alle 21:00, 4 persone: prenotazione confermata.

**[AI reply 4]**: Perfeito, já está confirmado. Até lá, e boa noite.

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
      "note": ""
    }
  }
]
```

**Duration**: 17955ms

---

### B03-015 — `multilingua`
**Description**: PT — Ana Pereira

**Reason**: italian leak in reply #2: per ana pereira, domenica 26 luglio 2026 alle 12:30, 3 persone, la prenotazione è confermata.

**Full transcript**:

**[User turn 1]**: Bom dia, uma mesa para o próximo domingo às 12h30 para 3 pessoas, em nome de Ana Pereira

**[AI reply 1]**: "Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?"

**[User turn 2]**: Sim

**[AI reply 2]**: Olá, sou o assistente vocal automático de Osteria Test, como posso ajudá-lo? Vou verificar a disponibilidade agora.

**[AI reply 3]**: Per Ana Pereira, domenica 26 luglio 2026 alle 12:30, 3 persone, la prenotazione è confermata.

**[AI reply 4]**: Perfeito, sua reserva já está confirmada. Como posso ajudar com qualquer outra coisa?

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

**Duration**: 17063ms

---

### B03-016 — `multilingua`
**Description**: NL — Jan de Vries

**Reason**: reply must contain 'stemassistent' — got: "Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?" Ik ga nu de beschikbaarheid voor die datum en tijd controleren. Een moment, ik registreer de reservering. Boekingsbev

**Full transcript**:

**[User turn 1]**: Goedendag, ik wil graag een tafel reserveren voor volgende zaterdag om 13:00 uur voor 2 personen, op naam van Jan de Vries

**[AI reply 1]**: "Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?"

**[User turn 2]**: Ja, bevestig alstublieft

**[AI reply 2]**: Ik ga nu de beschikbaarheid voor die datum en tijd controleren.

**[AI reply 3]**: Een moment, ik registreer de reservering.

**[AI reply 4]**: Boekingsbevestiging: Jan de Vries, zaterdag 25 juli om 13:00, 2 personen.

**[AI reply 5]**: Uw reservering is bevestigd. Jan de Vries, zaterdag 25 juli om 13:00 voor 2 personen.

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
      "nome": "Jan de Vries",
      "data": "2026-07-25",
      "ora": "13:00",
      "persone": 2,
      "note": ""
    }
  }
]
```

**Duration**: 15349ms

---

### B03-017 — `multilingua`
**Description**: NL — Emma Bakker

**Reason**: reply must contain 'stemassistent' — got: "Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?" Hallo, ik ga nu de beschikbaarheid voor die datum en tijd controleren. Prima, ik ga de reservering nu registreren. Ge

**Full transcript**:

**[User turn 1]**: Goedenavond, voor volgende woensdag om 21:00 uur voor 4 personen, op naam van Emma Bakker

**[AI reply 1]**: "Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?"

**[User turn 2]**: Ja, bevestig

**[AI reply 2]**: Hallo, ik ga nu de beschikbaarheid voor die datum en tijd controleren.

**[AI reply 3]**: Prima, ik ga de reservering nu registreren.

**[AI reply 4]**: Gefeliciteerd, uw reservering is bevestigd voor Emma Bakker op woensdag 29 juli om 21:00, voor 4 personen.

**[AI reply 5]**: Perfect, graag gedaan! Uw reservering staat bevestigd voor Emma Bakker, woensdag 29 juli om 21:00, 4 personen.

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

**Duration**: 18392ms

---

