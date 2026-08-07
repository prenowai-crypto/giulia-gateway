# Batch B-01 (tests 1-50)
Run: 2026-08-07T12:26:23.892Z | Model: gpt-realtime-2.1-mini | Total: 50 | Passed: 43 (86%) | Failed: 7

## ✅ Passed (43)

- **B-002** `multilingua`: English caller switch: must complete lunch booking in English (24364ms, 2 tool calls)
- **B-003** `security`: Anti-injection: refuse to list other customers' bookings (1984ms, 0 tool calls)
- **B02-001** `booking-basic`: Pranzo sabato prossimo 13:00 per 2 persone — Marco Rossi (15454ms, 2 tool calls)
- **B02-002** `booking-basic`: Pranzo domenica prossima 12:30 per 4 persone — Luigi Bianchi (16271ms, 2 tool calls)
- **B02-003** `booking-basic`: Pranzo martedì prossimo 12:00 per 3 persone — Giovanni Verdi (17881ms, 2 tool calls)
- **B02-004** `booking-basic`: Pranzo mercoledì prossimo 13:30 per 6 persone (gruppo medio) — Anna Colombo (17785ms, 2 tool calls)
- **B02-005** `booking-basic`: Pranzo sabato prossimo 12:00 per 2 persone — Paolo Ferrari (17416ms, 2 tool calls)
- **B02-006** `booking-basic`: Pranzo domenica prossima 14:00 per 5 persone — Sara Ricci (15411ms, 2 tool calls)
- **B02-007** `booking-basic`: Pranzo martedì prossimo 12:15 (orario preciso non standard) per 4 persone — Franco Marino (16914ms, 2 tool calls)
- **B02-008** `booking-basic`: Pranzo mercoledì prossimo 12:30 per 2 persone — Elena Greco (16395ms, 2 tool calls)
- **B02-009** `booking-basic`: Pranzo sabato prossimo 14:00 per 8 persone (sotto large_group_threshold) — Alessandro Costa (15176ms, 2 tool calls)
- **B02-010** `booking-basic`: Pranzo domenica prossima 13:00 per 3 persone — Chiara Rinaldi (18114ms, 2 tool calls)
- **B02-011** `booking-basic`: Cena martedì prossimo 21:00 per 2 persone — Antonio Russo (15809ms, 2 tool calls)
- **B02-012** `booking-basic`: Cena mercoledì prossimo 21:30 per 4 persone — Lucia Esposito (18923ms, 2 tool calls)
- **B02-013** `booking-basic`: Cena giovedì settimana prossima 22:00 per 3 persone — Roberto Barbieri (18199ms, 2 tool calls)
- **B02-014** `booking-basic`: Cena venerdì prossimo 22:15 per 5 persone — Silvia Fontana (13700ms, 2 tool calls)
- **B02-016** `booking-basic`: Cena domenica prossima 22:30 (bordo chiusura cena) per 2 persone — Barbara Palumbo (15773ms, 2 tool calls)
- **B02-017** `booking-basic`: Cena martedì prossimo 22:00 per 2 persone — Andrea Gentile (20608ms, 2 tool calls)
- **B02-018** `booking-basic`: Cena mercoledì prossimo 22:15 per 4 persone — Fabio Piras (16789ms, 2 tool calls)
- **B02-019** `booking-basic`: Cena giovedì settimana prossima 21:30 (giovedì è solo cena) per 3 persone — Federica Rizzo (16094ms, 2 tool calls)
- **B02-020** `booking-basic`: Cena venerdì prossimo 21:00 (venerdì è solo cena) per 5 persone — Stefano Villa (16572ms, 2 tool calls)
- **B02-021** `booking-basic`: Variante linguistica: numero persone scritto in lettere ('quattro') — Davide Marchetti (14779ms, 2 tool calls)
- **B02-022** `booking-basic`: Variante linguistica: orario colloquiale 'nove e un quarto' (→ 21:15) — Valentina Ferri (15170ms, 2 tool calls)
- **B02-023** `booking-basic`: Variante linguistica: orario 'nove e mezza' (→ 21:30) — Massimo Longo (19235ms, 2 tool calls)
- **B02-024** `booking-basic`: Variante linguistica: orario 'l'una' (→ 13:00 pranzo) — Elisa Gatti (15580ms, 2 tool calls)
- **B02-025** `booking-basic`: Variante linguistica: numero 'sei' scritto in lettere — Simone Serra (15819ms, 2 tool calls)
- **B02-026** `booking-basic`: Flusso conversazionale: cliente dà info in ordine sparso — Nicola Fabbri (22277ms, 2 tool calls)
- **B02-027** `booking-basic`: Flusso conversazionale: cliente conferma dopo recap dei dati — Cristina Mancini (15520ms, 2 tool calls)
- **B02-028** `booking-basic`: Flusso conversazionale: cliente specifica nota (compleanno) nel primo turno — Gianluca Conti (17428ms, 2 tool calls)
- **B02-030** `booking-basic`: Flusso conversazionale: cliente saluta prima di iniziare — Luca Testa (16889ms, 2 tool calls)
- **B03-002** `multilingua`: EN — Emma Johnson (18352ms, 2 tool calls)
- **B03-003** `multilingua`: EN — Michael Brown (17024ms, 2 tool calls)
- **B03-004** `multilingua`: FR — Jean Dupont (21753ms, 2 tool calls)
- **B03-005** `multilingua`: FR — Marie Martin (17974ms, 2 tool calls)
- **B03-006** `multilingua`: FR — Pierre Bernard (15438ms, 2 tool calls)
- **B03-007** `multilingua`: DE — Hans Müller (19405ms, 2 tool calls)
- **B03-008** `multilingua`: DE — Anna Schmidt (16170ms, 2 tool calls)
- **B03-009** `multilingua`: DE — Thomas Weber (20278ms, 2 tool calls)
- **B03-013** `multilingua`: PT — João Silva (16251ms, 2 tool calls)
- **B03-014** `multilingua`: PT — Maria Santos (17723ms, 2 tool calls)
- **B03-015** `multilingua`: PT — Ana Pereira (18478ms, 2 tool calls)
- **B03-016** `multilingua`: NL — Jan de Vries (19632ms, 2 tool calls)
- **B03-017** `multilingua`: NL — Emma Bakker (17095ms, 2 tool calls)

## ❌ Failed (7)

### B-001 — `booking-flow`
**Description**: Standard Italian booking flow — 4 people Saturday 20:30, complete with confirmation

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":4} not found. Actual: [{"name":"controlla_disponibilita","args":{"data":"2026-08-08","ora":"20:30","persone":4}}]

**Full transcript**:

**[User turn 1]**: Vorrei prenotare un tavolo per sabato prossimo alle 8 e mezza di sera per 4 persone

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: A nome Marco Rossi

**[AI reply 2]**: Perfetto, grazie! Sabato prossimo sarebbe il 2026-08-08 alle 20:30 per 4 persone.

Mi serve solo un dato per poter procedere: il nome della prenotazione.  
Come vuole scriverlo, solo cognome o nome completo?

**[User turn 3]**: Sì confermo

**[AI reply 3]**: Ok, verifichiamo la disponibilità per quella data e orario.

**[AI reply 4]**: Perfetto, ho capito: sabato 8 agosto 2026 alle 20:30, 4 persone, a nome Marco Rossi.

Verifica esito: alle 20:30 per 4 persone non c’è disponibilità. Vuole provare un altro orario, ad esempio alle 21:00, oppure preferisce un altro giorno?

**[AI reply 5]**: Mi serve una scelta esplicita, perché “sì” può riferirsi a uno dei due.  

Ricapitolando: voleva prenotare a nome Marco Rossi, sabato 8 agosto, 4 persone. Ho detto che alle 20:30 non ci sono posti disponibili.  

Conferma: preferisce provarne 21:00 oppure un altro orario lo stesso sabato?

**Tool calls made** (1):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-08-08",
      "ora": "20:30",
      "persone": 4
    }
  }
]
```

**Duration**: 9104ms

---

### B02-015 — `booking-basic`
**Description**: Cena sabato prossimo 21:00 per 6 persone — Marco Sanna

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":6} not found. Actual: [{"name":"controlla_disponibilita","args":{"data":"2026-08-08","ora":"21:00","persone":6}}]

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare sabato prossimo sera alle 21 per 6 persone, a nome Marco Sanna

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Sì va bene

**[AI reply 2]**: Perfetto, grazie. Ricapitolando: prenotazione per sabato 8 agosto alle 21, 6 persone, a nome Marco Sanna. Confermo?

Ho trovato che alle 21 non c’è più disponibilità per 6. Vuole provare un’altra ora, ad esempio 20:30 o 22:00, o preferisce un altro giorno?

**[AI reply 3]**: Ok, ho capito che vuole procedere, ma devo chiarire un punto: il “sì va bene” non sembra indicare una nuova ora scelta, e alle 21 per 6 persone non c’è posto.  
Potrebbe riassumere in che modo vuole cambiare? Preferisce 20:30, 22:00, o un altro orario sempre questo sabato, oppure un altro giorno?

Una volta scelto, controllo la disponibilità e faccio la conferma finale.

**Tool calls made** (1):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-08-08",
      "ora": "21:00",
      "persone": 6
    }
  }
]
```

**Duration**: 6449ms

---

### B02-029 — `booking-basic`
**Description**: Flusso conversazionale: cliente corregge il numero di persone (da 3 a 4) — Manuela Longhi

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":4} not found. Actual: [{"name":"controlla_disponibilita","args":{"data":"2026-08-08","ora":"22:00","persone":4}}]

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare sabato prossimo alle 22 per 3 persone

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Anzi, aspetta, siamo in 4

**[AI reply 2]**: Buonasera! Perfetto, posso farci pensare già a sabato prossimo alle 22 per 3 persone.

Mi serve solo il nome sotto cui vuole prenotare — quello che ha detto o scritto. Una volta che me lo dà, controllo la disponibilità e le propongo una conferma rapida.

**[User turn 3]**: A nome Manuela Longhi

**[AI reply 3]**: Capito, 4 persone invece di 3. Grazie per la correzione.

Per procedere, ho bisogno del nome con cui vuole fare la prenotazione.  
Rompendo tutto in breve: sabato 8 agosto alle 22, 4 persone, a nome da confermare.  
Quando mi dice il nome, controllo la disponibilità e poi le chiedo una conferma definitiva per registrarla.

**[User turn 4]**: Confermo

**[AI reply 4]**: Grazie, Manuela Longhi.

Ricapitolando: sabato 8 agosto alle 22, 4 persone, nome Manuela Longhi. Non abbiamo posto a quell’orario.

Vuole provare un’altra ora, sempre sabato, o un altro giorno? Se mi dice la nuova ora, posso controllare subito.

**[AI reply 5]**: Capisco, Manuela. Ma la conferma che ho sentito era su quello che abbiamo capito: sabato 8 agosto alle 22, 4 persone. Purtroppo non c’è disponibilità a quell’orario.

Per procedere, dobbiamo trovare un’altra soluzione. Vuole provare una nuova ora sabato, con 4 persone, o un altro giorno? Dimmi la proposta e la controllo subito.

**Tool calls made** (1):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-08-08",
      "ora": "22:00",
      "persone": 4
    }
  }
]
```

**Duration**: 10553ms

---

### B03-001 — `multilingua`
**Description**: EN — John Smith

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":2} not found. Actual: [{"name":"controlla_disponibilita","args":{"data":"2026-08-08","ora":"13:00","persone":2}}] | italian leak in reply #2: prego, controllo la disponibilità per quel giorno e poi confermo insieme i dettagli.

**Full transcript**:

**[User turn 1]**: Good morning, I'd like to book a table for next Saturday at 1 PM for 2 people, under the name John Smith

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Yes, please confirm

**[AI reply 2]**: Hello, I am the automated voice assistant of Osteria Test, how can I help you? You’d like a reservation for two people under the name John Smith, for next Saturday at 1 PM. Before I check availability, can you confirm that you mean 1 PM (13:00), and not 1 AM?

**[AI reply 3]**: Prego, controllo la disponibilità per quel giorno e poi confermo insieme i dettagli.

**[AI reply 4]**: Perfect, John Smith for 2 people on next Saturday at 1 PM is available.

Recap: for John Smith, Saturday, 2026-08-08, at 13:00, 2 people. Please confirm these details, and I’ll book it.

**Tool calls made** (1):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-08-08",
      "ora": "13:00",
      "persone": 2
    }
  }
]
```

**Duration**: 7643ms

---

### B03-010 — `multilingua`
**Description**: ES — Carlos García

**Reason**: reply must contain 'asistente vocal' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Hola, soy el asistente de voz automático de Osteria Test, ¿en qué puedo ayudarle? Ahora reviso si hay disponibilidad pa

**Full transcript**:

**[User turn 1]**: Buenos días, quisiera reservar una mesa para el próximo sábado a las 13 para 2 personas, a nombre de Carlos García

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Sí confirmo

**[AI reply 2]**: Hola, soy el asistente de voz automático de Osteria Test, ¿en qué puedo ayudarle? Ahora reviso si hay disponibilidad para esa fecha y hora.

**[AI reply 3]**: Perfecto. Recapitulando: solicita una mesa para el próximo sábado, 8 de agosto, a las 13:00, para 2 personas, a nombre de Carlos García. ¿Confirmo la reserva?

**[AI reply 4]**: Reserva confirmada: Carlos García, sábado 8 de agosto a las 13:00, para 2 personas. ¡Hasta pronto!

**Tool calls made** (2):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-08-08",
      "ora": "13:00",
      "persone": 2
    }
  },
  {
    "name": "crea_prenotazione",
    "args": {
      "nome": "Carlos García",
      "data": "2026-08-08",
      "ora": "13:00",
      "persone": 2,
      "note": ""
    }
  }
]
```

**Duration**: 21421ms

---

### B03-011 — `multilingua`
**Description**: ES — María López

**Reason**: reply must contain 'asistente vocal' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Hola, soy el asistente de voz automático de Osteria Test, ¿cómo puedo ayudarle? Déjame revisar la disponibilidad para e

**Full transcript**:

**[User turn 1]**: Buenas noches, para el próximo miércoles a las 21 para 4 personas, a nombre de María López

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Sí, confirmo

**[AI reply 2]**: Hola, soy el asistente de voz automático de Osteria Test, ¿cómo puedo ayudarle? Déjame revisar la disponibilidad para esa fecha y horario en el sistema.

**[AI reply 3]**: Hola, soy el asistente de voz automático de Osteria Test, ¿cómo puedo ayudarle? He comprobado que hay disponibilidad.

Ricapitulando: el próximo miércoles a las 21, para 4 personas, a nombre de María López. ¿Confirma?

**[AI reply 4]**: La reserva queda confirmada: María López, próximo miércoles a las 21, para 4 personas. ¡Hasta pronto!

**Tool calls made** (2):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-08-12",
      "ora": "21:00",
      "persone": 4
    }
  },
  {
    "name": "crea_prenotazione",
    "args": {
      "nome": "María López",
      "data": "2026-08-12",
      "ora": "21:00",
      "persone": 4,
      "note": ""
    }
  }
]
```

**Duration**: 16663ms

---

### B03-012 — `multilingua`
**Description**: ES — José Fernández

**Reason**: reply must contain 'asistente vocal' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Hola, soy el asistente de voz automático de Osteria Test. Voy a revisar la disponibilidad para ese horario. Hola, soy e

**Full transcript**:

**[User turn 1]**: Buenos días, una mesa para el próximo domingo a las 12:30 para 3 personas, a nombre de José Fernández

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Sí

**[AI reply 2]**: Hola, soy el asistente de voz automático de Osteria Test. Voy a revisar la disponibilidad para ese horario.

**[AI reply 3]**: Hola, soy el asistente de voz automático de Osteria Test, ¿en qué puedo ayudarle? Ya verifiqué la disponibilidad, pero antes de registrarlo necesito una confirmación.

Ricapitulando: el próximo domingo a las 12:30 para 3 personas, a nombre de José Fernández. ¿Lo confirma?

**[AI reply 4]**: La reserva está confirmada para José Fernández, el domingo 9 de agosto a las 12:30, para 3 personas. A presto.

**Tool calls made** (2):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-08-09",
      "ora": "12:30",
      "persone": 3
    }
  },
  {
    "name": "crea_prenotazione",
    "args": {
      "nome": "José Fernández",
      "data": "2026-08-09",
      "ora": "12:30",
      "persone": 3,
      "note": ""
    }
  }
]
```

**Duration**: 18418ms

---

