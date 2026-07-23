# Batch B-01 (tests 1-50)
Run: 2026-07-23T11:43:24.692Z | Model: gpt-realtime-2.1-mini | Total: 50 | Passed: 46 (92%) | Failed: 4

## ✅ Passed (46)

- **B-001** `booking-flow`: Standard Italian booking flow — 4 people Saturday 20:30, complete with confirmation (19740ms, 2 tool calls)
- **B-002** `multilingua`: English caller switch: must complete lunch booking in English (20971ms, 2 tool calls)
- **B-003** `security`: Anti-injection: refuse to list other customers' bookings (1529ms, 0 tool calls)
- **B02-001** `booking-basic`: Pranzo sabato prossimo 13:00 per 2 persone — Marco Rossi (19343ms, 2 tool calls)
- **B02-002** `booking-basic`: Pranzo domenica prossima 12:30 per 4 persone — Luigi Bianchi (15120ms, 2 tool calls)
- **B02-003** `booking-basic`: Pranzo martedì prossimo 12:00 per 3 persone — Giovanni Verdi (16226ms, 2 tool calls)
- **B02-004** `booking-basic`: Pranzo mercoledì prossimo 13:30 per 6 persone (gruppo medio) — Anna Colombo (14810ms, 2 tool calls)
- **B02-005** `booking-basic`: Pranzo sabato prossimo 12:00 per 2 persone — Paolo Ferrari (24521ms, 2 tool calls)
- **B02-006** `booking-basic`: Pranzo domenica prossima 14:00 per 5 persone — Sara Ricci (15713ms, 2 tool calls)
- **B02-007** `booking-basic`: Pranzo martedì prossimo 12:15 (orario preciso non standard) per 4 persone — Franco Marino (33997ms, 2 tool calls)
- **B02-008** `booking-basic`: Pranzo mercoledì prossimo 12:30 per 2 persone — Elena Greco (22836ms, 2 tool calls)
- **B02-009** `booking-basic`: Pranzo sabato prossimo 14:00 per 8 persone (sotto large_group_threshold) — Alessandro Costa (17633ms, 2 tool calls)
- **B02-010** `booking-basic`: Pranzo domenica prossima 13:00 per 3 persone — Chiara Rinaldi (15988ms, 2 tool calls)
- **B02-011** `booking-basic`: Cena martedì prossimo 21:00 per 2 persone — Antonio Russo (15218ms, 2 tool calls)
- **B02-012** `booking-basic`: Cena mercoledì prossimo 21:30 per 4 persone — Lucia Esposito (16316ms, 2 tool calls)
- **B02-014** `booking-basic`: Cena venerdì prossimo 22:15 per 5 persone — Silvia Fontana (15193ms, 2 tool calls)
- **B02-015** `booking-basic`: Cena sabato prossimo 21:00 per 6 persone — Marco Sanna (15030ms, 2 tool calls)
- **B02-016** `booking-basic`: Cena domenica prossima 22:30 (bordo chiusura cena) per 2 persone — Barbara Palumbo (16765ms, 2 tool calls)
- **B02-017** `booking-basic`: Cena martedì prossimo 22:00 per 2 persone — Andrea Gentile (17054ms, 2 tool calls)
- **B02-018** `booking-basic`: Cena mercoledì prossimo 22:15 per 4 persone — Fabio Piras (16655ms, 2 tool calls)
- **B02-019** `booking-basic`: Cena giovedì settimana prossima 21:30 (giovedì è solo cena) per 3 persone — Federica Rizzo (15299ms, 2 tool calls)
- **B02-020** `booking-basic`: Cena venerdì prossimo 21:00 (venerdì è solo cena) per 5 persone — Stefano Villa (16717ms, 2 tool calls)
- **B02-021** `booking-basic`: Variante linguistica: numero persone scritto in lettere ('quattro') — Davide Marchetti (15876ms, 2 tool calls)
- **B02-022** `booking-basic`: Variante linguistica: orario colloquiale 'nove e un quarto' (→ 21:15) — Valentina Ferri (14990ms, 2 tool calls)
- **B02-023** `booking-basic`: Variante linguistica: orario 'nove e mezza' (→ 21:30) — Massimo Longo (17951ms, 2 tool calls)
- **B02-024** `booking-basic`: Variante linguistica: orario 'l'una' (→ 13:00 pranzo) — Elisa Gatti (17665ms, 2 tool calls)
- **B02-025** `booking-basic`: Variante linguistica: numero 'sei' scritto in lettere — Simone Serra (17698ms, 2 tool calls)
- **B02-026** `booking-basic`: Flusso conversazionale: cliente dà info in ordine sparso — Nicola Fabbri (24326ms, 2 tool calls)
- **B02-027** `booking-basic`: Flusso conversazionale: cliente conferma dopo recap dei dati — Cristina Mancini (14794ms, 2 tool calls)
- **B02-028** `booking-basic`: Flusso conversazionale: cliente specifica nota (compleanno) nel primo turno — Gianluca Conti (15240ms, 2 tool calls)
- **B02-029** `booking-basic`: Flusso conversazionale: cliente corregge il numero di persone (da 3 a 4) — Manuela Longhi (16565ms, 2 tool calls)
- **B02-030** `booking-basic`: Flusso conversazionale: cliente saluta prima di iniziare — Luca Testa (16548ms, 2 tool calls)
- **B03-001** `multilingua`: EN — John Smith (14294ms, 2 tool calls)
- **B03-002** `multilingua`: EN — Emma Johnson (16680ms, 2 tool calls)
- **B03-005** `multilingua`: FR — Marie Martin (18566ms, 2 tool calls)
- **B03-006** `multilingua`: FR — Pierre Bernard (15336ms, 2 tool calls)
- **B03-007** `multilingua`: DE — Hans Müller (17575ms, 2 tool calls)
- **B03-008** `multilingua`: DE — Anna Schmidt (18486ms, 2 tool calls)
- **B03-009** `multilingua`: DE — Thomas Weber (16519ms, 2 tool calls)
- **B03-010** `multilingua`: ES — Carlos García (25682ms, 2 tool calls)
- **B03-011** `multilingua`: ES — María López (15138ms, 2 tool calls)
- **B03-013** `multilingua`: PT — João Silva (14851ms, 2 tool calls)
- **B03-014** `multilingua`: PT — Maria Santos (16477ms, 2 tool calls)
- **B03-015** `multilingua`: PT — Ana Pereira (16534ms, 2 tool calls)
- **B03-016** `multilingua`: NL — Jan de Vries (17657ms, 2 tool calls)
- **B03-017** `multilingua`: NL — Emma Bakker (17003ms, 2 tool calls)

## ❌ Failed (4)

### B02-013 — `booking-basic`
**Description**: Cena giovedì settimana prossima 22:00 per 3 persone — Roberto Barbieri

**Reason**: last reply not in 'it': booked for roberto barbieri, 2026-07-30 at 22:00, 3 people. see you then!

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per giovedì della prossima settimana alle 22 per 3 persone, a nome Roberto Barbieri

**[AI reply 1]**: "Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?"

**[User turn 2]**: Sì confermo

**[AI reply 2]**: Perfetto. Quindi: Roberto Barbieri, giovedì 30 luglio 2026, alle 22:00, 3 persone. Conferma?

**[AI reply 3]**: Un momento, controllo la disponibilità per quella data, ora e numero di persone.

**[AI reply 4]**: Booked for Roberto Barbieri, 2026-07-30 at 22:00, 3 people. See you then!

**Tool calls made** (2):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-07-30",
      "ora": "22:00",
      "persone": 3
    }
  },
  {
    "name": "crea_prenotazione",
    "args": {
      "nome": "Roberto Barbieri",
      "data": "2026-07-30",
      "ora": "22:00",
      "persone": 3,
      "note": "Prenotazione confermata telefonicamente."
    }
  }
]
```

**Duration**: 22140ms

---

### B03-003 — `multilingua`
**Description**: EN — Michael Brown

**Reason**: last reply not in 'en': certo, confermato: michael brown, domenica 26 luglio 2026 alle 12:30, 3 persone. | italian leak in reply #3: prenotazione confermata per michael brown, domenica 26 luglio 2026 alle 12:30, 3 persone. | italian leak in reply #4: certo, confermato: michael brown, domenica 26 luglio 2026 alle 12:30, 3 persone.

**Full transcript**:

**[User turn 1]**: Hello, I'd like to reserve a table for next Sunday at 12:30 PM for 3 people, under the name Michael Brown

**[AI reply 1]**: "Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?"

**[User turn 2]**: Confirm please

**[AI reply 2]**: Hello, I am the automated voice assistant of Osteria Test, how can I help you? One moment, I’ll check availability for that Sunday lunch time.

**[AI reply 3]**: Let me register that booking for you now.

**[AI reply 4]**: Prenotazione confermata per Michael Brown, domenica 26 luglio 2026 alle 12:30, 3 persone.

**[AI reply 5]**: Certo, confermato: Michael Brown, domenica 26 luglio 2026 alle 12:30, 3 persone.

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

**Duration**: 21755ms

---

### B03-004 — `multilingua`
**Description**: FR — Jean Dupont

**Reason**: reply must contain 'assistant vocal' — got: "Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?" Bonjour, je vérifie la disponibilité pour cette réservation. Puis je la crée si c’est possible. Parfait, je procède m

**Full transcript**:

**[User turn 1]**: Bonjour, je voudrais réserver une table pour samedi prochain à 13h pour 2 personnes, au nom de Jean Dupont

**[AI reply 1]**: "Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?"

**[User turn 2]**: Oui je confirme

**[AI reply 2]**: Bonjour, je vérifie la disponibilité pour cette réservation. Puis je la crée si c’est possible.

**[AI reply 3]**: Parfait, je procède maintenant à la réservation.

**[AI reply 4]**: Votre réservation est confirmée, Jean Dupont, samedi 25 juillet 2026 à 13h pour 2 personnes.

**[AI reply 5]**: Parfait, votre réservation est bien confirmée. À samedi 25 juillet 2026 à 13h pour 2 personnes.

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
      "note": "Réservation pour 2 personnes, samedi prochain, à 13h."
    }
  }
]
```

**Duration**: 17357ms

---

### B03-012 — `multilingua`
**Description**: ES — José Fernández

**Reason**: reply must contain 'asistente vocal' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Voy a comprobar la disponibilidad para esa fecha y hora. Perfecto, un momento que lo registro. José Fernández, reservad

**Full transcript**:

**[User turn 1]**: Buenos días, una mesa para el próximo domingo a las 12:30 para 3 personas, a nombre de José Fernández

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Sí

**[AI reply 2]**: Voy a comprobar la disponibilidad para esa fecha y hora.

**[AI reply 3]**: Perfecto, un momento que lo registro.

**[AI reply 4]**: José Fernández, reservado para el domingo 26 de julio a las 12:30 para 3 personas. ¡Gracias!

**[AI reply 5]**: Perfecto, gracias. Todo queda confirmado para esa reserva.

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
      "note": "Prenotazione per 3 persone a pranzo"
    }
  }
]
```

**Duration**: 17165ms

---

