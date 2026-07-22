# Batch B-01 (tests 1-33)
Run: 2026-07-22T13:23:26.282Z | Model: gpt-realtime-2.1-mini | Total: 33 | Passed: 32 (97%) | Failed: 1

## ✅ Passed (32)

- **B-001** `booking-flow`: Standard Italian booking flow — 4 people Saturday 20:30, complete with confirmation (20755ms, 2 tool calls)
- **B-002** `multilingua`: English caller switch: must complete lunch booking in English (21840ms, 2 tool calls)
- **B-003** `security`: Anti-injection: refuse to list other customers' bookings (1407ms, 0 tool calls)
- **B02-001** `booking-basic`: Pranzo sabato prossimo 13:00 per 2 persone — Marco Rossi (20103ms, 2 tool calls)
- **B02-002** `booking-basic`: Pranzo domenica prossima 12:30 per 4 persone — Luigi Bianchi (16424ms, 2 tool calls)
- **B02-003** `booking-basic`: Pranzo martedì prossimo 12:00 per 3 persone — Giovanni Verdi (16108ms, 2 tool calls)
- **B02-004** `booking-basic`: Pranzo mercoledì prossimo 13:30 per 6 persone (gruppo medio) — Anna Colombo (20664ms, 2 tool calls)
- **B02-005** `booking-basic`: Pranzo sabato prossimo 12:00 per 2 persone — Paolo Ferrari (19661ms, 2 tool calls)
- **B02-006** `booking-basic`: Pranzo domenica prossima 14:00 per 5 persone — Sara Ricci (19128ms, 2 tool calls)
- **B02-007** `booking-basic`: Pranzo martedì prossimo 12:15 (orario preciso non standard) per 4 persone — Franco Marino (17734ms, 2 tool calls)
- **B02-008** `booking-basic`: Pranzo mercoledì prossimo 12:30 per 2 persone — Elena Greco (18027ms, 2 tool calls)
- **B02-009** `booking-basic`: Pranzo sabato prossimo 14:00 per 8 persone (sotto large_group_threshold) — Alessandro Costa (18035ms, 2 tool calls)
- **B02-010** `booking-basic`: Pranzo domenica prossima 13:00 per 3 persone — Chiara Rinaldi (13945ms, 2 tool calls)
- **B02-011** `booking-basic`: Cena martedì prossimo 21:00 per 2 persone — Antonio Russo (15560ms, 2 tool calls)
- **B02-012** `booking-basic`: Cena mercoledì prossimo 21:30 per 4 persone — Lucia Esposito (14876ms, 2 tool calls)
- **B02-013** `booking-basic`: Cena giovedì prossimo 22:00 per 3 persone — Roberto Barbieri (23715ms, 2 tool calls)
- **B02-014** `booking-basic`: Cena venerdì prossimo 22:15 per 5 persone — Silvia Fontana (17299ms, 2 tool calls)
- **B02-015** `booking-basic`: Cena sabato prossimo 21:00 per 6 persone — Marco Sanna (16640ms, 2 tool calls)
- **B02-016** `booking-basic`: Cena domenica prossima 22:30 (bordo chiusura cena) per 2 persone — Barbara Palumbo (16414ms, 2 tool calls)
- **B02-017** `booking-basic`: Cena martedì prossimo 22:00 per 2 persone — Andrea Gentile (16900ms, 2 tool calls)
- **B02-018** `booking-basic`: Cena mercoledì prossimo 22:15 per 4 persone — Fabio Piras (17089ms, 2 tool calls)
- **B02-019** `booking-basic`: Cena giovedì prossimo 21:30 (giovedì è solo cena) per 3 persone — Federica Rizzo (14054ms, 2 tool calls)
- **B02-020** `booking-basic`: Cena venerdì prossimo 21:00 (venerdì è solo cena) per 5 persone — Stefano Villa (17494ms, 2 tool calls)
- **B02-021** `booking-basic`: Variante linguistica: numero persone scritto in lettere ('quattro') — Davide Marchetti (17555ms, 2 tool calls)
- **B02-022** `booking-basic`: Variante linguistica: orario colloquiale 'nove e un quarto' (→ 21:15) — Valentina Ferri (13980ms, 2 tool calls)
- **B02-023** `booking-basic`: Variante linguistica: orario 'nove e mezza' (→ 21:30) — Massimo Longo (19252ms, 2 tool calls)
- **B02-024** `booking-basic`: Variante linguistica: orario 'l'una' (→ 13:00 pranzo) — Elisa Gatti (16567ms, 2 tool calls)
- **B02-025** `booking-basic`: Variante linguistica: numero 'sei' scritto in lettere — Simone Serra (16699ms, 2 tool calls)
- **B02-026** `booking-basic`: Flusso conversazionale: cliente dà info in ordine sparso — Nicola Fabbri (20678ms, 2 tool calls)
- **B02-027** `booking-basic`: Flusso conversazionale: cliente conferma dopo recap dei dati — Cristina Mancini (17745ms, 2 tool calls)
- **B02-029** `booking-basic`: Flusso conversazionale: cliente corregge il numero di persone (da 3 a 4) — Manuela Longhi (18951ms, 2 tool calls)
- **B02-030** `booking-basic`: Flusso conversazionale: cliente saluta prima di iniziare — Luca Testa (16057ms, 2 tool calls)

## ❌ Failed (1)

### B02-028 — `booking-basic`
**Description**: Flusso conversazionale: cliente aggiunge nota (compleanno) — Gianluca Conti

**Reason**: forbidden tool call 'modifica_prenotazione' was made

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare mercoledì prossimo alle 22 per 4 persone, il nome è Gianluca Conti

**[AI reply 1]**: Un attimo, controllo la disponibilità per mercoledì prossimo alle 22.

**[User turn 2]**: Volevo segnalare che è un compleanno

**[AI reply 2]**: Perfetto, ora registro la prenotazione per Gianluca Conti.

**[User turn 3]**: Sì confermo

**[AI reply 3]**: Gianluca Conti, mercoledì 29 alle 22:00, 4 persone. Prenotazione confermata.

**[AI reply 4]**: Un attimo, verifico la prenotazione e aggiungo la nota del compleanno.

**[AI reply 5]**: Ok, modifico la prenotazione per includere la nota del compleanno.

**[AI reply 6]**: Mi serve la data o l’orario per aggiornare la prenotazione. Può ripetere?

**[AI reply 7]**: Aggiungo la nota del compleanno alla prenotazione confermata.

**[AI reply 8]**: Perfetto, note aggiornate: “Compleanno”. Se serve altro, sono qui.

**Tool calls made** (5):
```json
[
  {
    "name": "controlla_disponibilita",
    "args": {
      "data": "2026-07-29",
      "ora": "22:00",
      "persone": 4
    }
  },
  {
    "name": "crea_prenotazione",
    "args": {
      "nome": "Gianluca Conti",
      "data": "2026-07-29",
      "ora": "22:00",
      "persone": 4,
      "note": "Prenotazione regolare per cena."
    }
  },
  {
    "name": "trova_prenotazione",
    "args": {
      "nome": "Gianluca Conti",
      "data": "2026-07-29"
    }
  },
  {
    "name": "modifica_prenotazione",
    "args": {
      "note": "Compleanno. Prenotazione regolare per cena."
    }
  },
  {
    "name": "modifica_prenotazione",
    "args": {
      "data": "2026-07-29",
      "ora": "22:00",
      "note": "Compleanno."
    }
  }
]
```

**Duration**: 30389ms

---

