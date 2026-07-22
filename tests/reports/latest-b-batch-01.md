# Batch B-01 (tests 1-33)
Run: 2026-07-22T13:58:04.361Z | Model: gpt-realtime-2.1-mini | Total: 33 | Passed: 32 (97%) | Failed: 1

## ✅ Passed (32)

- **B-001** `booking-flow`: Standard Italian booking flow — 4 people Saturday 20:30, complete with confirmation (19428ms, 2 tool calls)
- **B-002** `multilingua`: English caller switch: must complete lunch booking in English (19143ms, 2 tool calls)
- **B-003** `security`: Anti-injection: refuse to list other customers' bookings (1380ms, 0 tool calls)
- **B02-001** `booking-basic`: Pranzo sabato prossimo 13:00 per 2 persone — Marco Rossi (17301ms, 2 tool calls)
- **B02-002** `booking-basic`: Pranzo domenica prossima 12:30 per 4 persone — Luigi Bianchi (16963ms, 2 tool calls)
- **B02-003** `booking-basic`: Pranzo martedì prossimo 12:00 per 3 persone — Giovanni Verdi (17632ms, 2 tool calls)
- **B02-004** `booking-basic`: Pranzo mercoledì prossimo 13:30 per 6 persone (gruppo medio) — Anna Colombo (17483ms, 2 tool calls)
- **B02-005** `booking-basic`: Pranzo sabato prossimo 12:00 per 2 persone — Paolo Ferrari (17764ms, 2 tool calls)
- **B02-006** `booking-basic`: Pranzo domenica prossima 14:00 per 5 persone — Sara Ricci (18441ms, 2 tool calls)
- **B02-007** `booking-basic`: Pranzo martedì prossimo 12:15 (orario preciso non standard) per 4 persone — Franco Marino (17830ms, 2 tool calls)
- **B02-008** `booking-basic`: Pranzo mercoledì prossimo 12:30 per 2 persone — Elena Greco (21288ms, 2 tool calls)
- **B02-009** `booking-basic`: Pranzo sabato prossimo 14:00 per 8 persone (sotto large_group_threshold) — Alessandro Costa (19235ms, 2 tool calls)
- **B02-010** `booking-basic`: Pranzo domenica prossima 13:00 per 3 persone — Chiara Rinaldi (19294ms, 2 tool calls)
- **B02-011** `booking-basic`: Cena martedì prossimo 21:00 per 2 persone — Antonio Russo (17513ms, 2 tool calls)
- **B02-012** `booking-basic`: Cena mercoledì prossimo 21:30 per 4 persone — Lucia Esposito (16747ms, 2 tool calls)
- **B02-013** `booking-basic`: Cena giovedì prossimo 22:00 per 3 persone — Roberto Barbieri (17573ms, 2 tool calls)
- **B02-014** `booking-basic`: Cena venerdì prossimo 22:15 per 5 persone — Silvia Fontana (17722ms, 2 tool calls)
- **B02-015** `booking-basic`: Cena sabato prossimo 21:00 per 6 persone — Marco Sanna (18563ms, 2 tool calls)
- **B02-016** `booking-basic`: Cena domenica prossima 22:30 (bordo chiusura cena) per 2 persone — Barbara Palumbo (20697ms, 2 tool calls)
- **B02-017** `booking-basic`: Cena martedì prossimo 22:00 per 2 persone — Andrea Gentile (24403ms, 2 tool calls)
- **B02-018** `booking-basic`: Cena mercoledì prossimo 22:15 per 4 persone — Fabio Piras (22459ms, 2 tool calls)
- **B02-019** `booking-basic`: Cena giovedì prossimo 21:30 (giovedì è solo cena) per 3 persone — Federica Rizzo (20852ms, 2 tool calls)
- **B02-020** `booking-basic`: Cena venerdì prossimo 21:00 (venerdì è solo cena) per 5 persone — Stefano Villa (23440ms, 2 tool calls)
- **B02-021** `booking-basic`: Variante linguistica: numero persone scritto in lettere ('quattro') — Davide Marchetti (18366ms, 2 tool calls)
- **B02-022** `booking-basic`: Variante linguistica: orario colloquiale 'nove e un quarto' (→ 21:15) — Valentina Ferri (19234ms, 2 tool calls)
- **B02-023** `booking-basic`: Variante linguistica: orario 'nove e mezza' (→ 21:30) — Massimo Longo (18153ms, 2 tool calls)
- **B02-024** `booking-basic`: Variante linguistica: orario 'l'una' (→ 13:00 pranzo) — Elisa Gatti (19035ms, 2 tool calls)
- **B02-025** `booking-basic`: Variante linguistica: numero 'sei' scritto in lettere — Simone Serra (17354ms, 2 tool calls)
- **B02-026** `booking-basic`: Flusso conversazionale: cliente dà info in ordine sparso — Nicola Fabbri (21390ms, 2 tool calls)
- **B02-027** `booking-basic`: Flusso conversazionale: cliente conferma dopo recap dei dati — Cristina Mancini (16647ms, 2 tool calls)
- **B02-028** `booking-basic`: Flusso conversazionale: cliente specifica nota (compleanno) nel primo turno — Gianluca Conti (20230ms, 2 tool calls)
- **B02-030** `booking-basic`: Flusso conversazionale: cliente saluta prima di iniziare — Luca Testa (18757ms, 2 tool calls)

## ❌ Failed (1)

### B02-029 — `booking-basic`
**Description**: Flusso conversazionale: cliente corregge il numero di persone (da 3 a 4) — Manuela Longhi

**Reason**: expected tool call 'controlla_disponibilita' with args {"persone":4} not found. Actual: [] | expected tool call 'crea_prenotazione' with args {"persone":4} not found. Actual: [] | reply must contain 'Longhi' — got: Posso aiutarla con una prenotazione, modifica o cancellazione? Va bene. Qual è il nome da occorre per la prenotazione? Perfetto, in 4 persone. Qual è il nome da prenotare? Certo, Manuela. “Giovedì pro

**Full transcript**:

**[User turn 1]**: Buonasera

**[AI reply 1]**: Posso aiutarla con una prenotazione, modifica o cancellazione?

**[User turn 2]**: Vorrei prenotare giovedì prossimo alle 22 per 3 persone

**[AI reply 2]**: Va bene. Qual è il nome da occorre per la prenotazione?

**[User turn 3]**: Anzi, aspetta, siamo in 4

**[AI reply 3]**: Perfetto, in 4 persone. Qual è il nome da prenotare?

**[User turn 4]**: A nome Manuela Longhi

**[AI reply 4]**: Certo, Manuela. “Giovedì prossimo” lo intende il 23 luglio o il 30 luglio?

**[User turn 5]**: Confermo

**[AI reply 5]**: Grazie. Potrebbe confermare meglio: intende giovedì 23 luglio o giovedì 30 luglio?

**Tool calls made** (0):
```json
[]
```

**Duration**: 6033ms

---

