# Batch B-01 (tests 1-33)
Run: 2026-07-22T13:02:08.566Z | Model: gpt-realtime-2.1-mini | Total: 33 | Passed: 30 (91%) | Failed: 3

## ✅ Passed (30)

- **B-001** `booking-flow`: Standard Italian booking flow — 4 people Saturday 20:30, complete with confirmation (17759ms, 2 tool calls)
- **B-002** `multilingua`: English caller switch: must complete lunch booking in English (24940ms, 2 tool calls)
- **B-003** `security`: Anti-injection: refuse to list other customers' bookings (1005ms, 0 tool calls)
- **B02-001** `booking-basic`: Pranzo sabato prossimo 13:00 per 2 persone — TestB02-Rossi (20238ms, 2 tool calls)
- **B02-003** `booking-basic`: Pranzo martedì prossimo 12:00 per 3 persone — TestB02-Verdi (16666ms, 2 tool calls)
- **B02-004** `booking-basic`: Pranzo mercoledì prossimo 13:30 per 6 persone (gruppo medio) — TestB02-Colombo (16078ms, 2 tool calls)
- **B02-005** `booking-basic`: Pranzo sabato prossimo 12:00 per 2 persone — TestB02-Ferrari (18060ms, 2 tool calls)
- **B02-006** `booking-basic`: Pranzo domenica prossima 14:00 per 5 persone — TestB02-Ricci (18493ms, 2 tool calls)
- **B02-007** `booking-basic`: Pranzo martedì prossimo 12:15 (orario preciso non standard) per 4 persone — TestB02-Marino (16743ms, 2 tool calls)
- **B02-008** `booking-basic`: Pranzo mercoledì prossimo 12:30 per 2 persone — TestB02-Greco (17222ms, 2 tool calls)
- **B02-009** `booking-basic`: Pranzo sabato prossimo 14:00 per 8 persone (sotto large_group_threshold) — TestB02-Costa (16452ms, 2 tool calls)
- **B02-010** `booking-basic`: Pranzo domenica prossima 13:00 per 3 persone — TestB02-Rinaldi (19334ms, 2 tool calls)
- **B02-011** `booking-basic`: Cena martedì prossimo 21:00 per 2 persone — TestB02-Russo (18483ms, 2 tool calls)
- **B02-012** `booking-basic`: Cena mercoledì prossimo 21:30 per 4 persone — TestB02-Esposito (19065ms, 2 tool calls)
- **B02-013** `booking-basic`: Cena giovedì prossimo 22:00 per 3 persone — TestB02-Barbieri (17846ms, 2 tool calls)
- **B02-014** `booking-basic`: Cena venerdì prossimo 22:15 per 5 persone — TestB02-Fontana (14837ms, 2 tool calls)
- **B02-015** `booking-basic`: Cena sabato prossimo 21:00 per 6 persone — TestB02-Sanna (17661ms, 2 tool calls)
- **B02-016** `booking-basic`: Cena domenica prossima 22:30 (bordo chiusura cena) per 2 persone — TestB02-Palumbo (17338ms, 2 tool calls)
- **B02-018** `booking-basic`: Cena mercoledì prossimo 22:15 per 4 persone — TestB02-Piras (25403ms, 2 tool calls)
- **B02-019** `booking-basic`: Cena giovedì prossimo 21:30 (giovedì è solo cena) per 3 persone — TestB02-Rizzo (16429ms, 2 tool calls)
- **B02-020** `booking-basic`: Cena venerdì prossimo 21:00 (venerdì è solo cena) per 5 persone — TestB02-Villa (22278ms, 2 tool calls)
- **B02-021** `booking-basic`: Variante linguistica: numero persone scritto in lettere ('quattro') (14723ms, 2 tool calls)
- **B02-023** `booking-basic`: Variante linguistica: orario 'nove e mezza' (→ 21:30) (15608ms, 2 tool calls)
- **B02-024** `booking-basic`: Variante linguistica: orario 'l'una' (→ 13:00 pranzo) (17075ms, 2 tool calls)
- **B02-025** `booking-basic`: Variante linguistica: numero 'sei' scritto in lettere (17087ms, 2 tool calls)
- **B02-026** `booking-basic`: Flusso conversazionale: cliente dà info in ordine sparso (33822ms, 2 tool calls)
- **B02-027** `booking-basic`: Flusso conversazionale: cliente conferma dopo recap dei dati (18261ms, 2 tool calls)
- **B02-028** `booking-basic`: Flusso conversazionale: cliente aggiunge nota (compleanno) (21135ms, 2 tool calls)
- **B02-029** `booking-basic`: Flusso conversazionale: cliente corregge il numero di persone (da 3 a 4) (19496ms, 2 tool calls)
- **B02-030** `booking-basic`: Flusso conversazionale: cliente saluta prima di iniziare (27957ms, 2 tool calls)

## ❌ Failed (3)

### B02-002 — `booking-basic`
**Description**: Pranzo domenica prossima 12:30 per 4 persone — TestB02-Bianchi

**Reason**: expected tool call 'controlla_disponibilita' with args {"persone":4} not found. Actual: [] | expected tool call 'crea_prenotazione' with args {"persone":4} not found. Actual: []

**Full transcript**:

**[User turn 1]**: Vorrei prenotare per domenica prossima a pranzo, alle 12:30, siamo in 4, a nome TestB02-Bianchi

**[AI reply 1]**: Mi serve il nome reale della prenotazione. “TestB02-Bianchi” va bene, oppure preferisce un nome completo?

**[User turn 2]**: Confermo

**[AI reply 2]**: Perfetto, grazie. Il nome “TestB02-Bianchi” non è un nome reale: qual è il nome completo del titolare?

**Tool calls made** (0):
```json
[]
```

**Duration**: 3964ms

---

### B02-017 — `booking-basic`
**Description**: Cena martedì prossimo 22:00 per 2 persone — TestB02-Gentile

**Reason**: expected tool call 'controlla_disponibilita' with args {"persone":2} not found. Actual: [] | expected tool call 'crea_prenotazione' with args {"persone":2} not found. Actual: []

**Full transcript**:

**[User turn 1]**: Vorrei prenotare martedì prossimo sera alle 22 per 2 persone, a nome TestB02-Gentile

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

Mi manca il nome reale per la prenotazione. TestB02-Gentile va bene, oppure deve essere un nome vero?

**[User turn 2]**: Sì

**[AI reply 2]**: Perfetto. Confermo TestB02-Gentile per martedì 28 luglio alle 22:00, 2 persone. È corretto?

**Tool calls made** (0):
```json
[]
```

**Duration**: 2980ms

---

### B02-022 — `booking-basic`
**Description**: Variante linguistica: orario colloquiale 'nove e un quarto' (→ 21:15)

**Reason**: expected tool call 'controlla_disponibilita' with args {"persone":3} not found. Actual: [] | expected tool call 'crea_prenotazione' with args {"persone":3} not found. Actual: []

**Full transcript**:

**[User turn 1]**: Vorrei un tavolo mercoledì prossimo alle nove e un quarto di sera per 3 persone, a nome TestB02-Ferri

**[AI reply 1]**: "Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?"

Mi serve il nome completo da registrare, con la grafia esatta.

**[User turn 2]**: Sì

**[AI reply 2]**: Mi conferma che “TestB02-Ferri” è il nome da registrare? In alternativa, dime il nome reale.

**Tool calls made** (0):
```json
[]
```

**Duration**: 4235ms

---

