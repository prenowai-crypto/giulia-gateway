# Batch B-01 (tests 1-30)
Run: 2026-07-27T22:10:40.244Z | Model: gpt-realtime-2.1-mini | Total: 30 | Passed: 25 (83%) | Failed: 5

## ✅ Passed (25)

- **B04-002** `availability-edge`: Lunedì chiuso — cliente insiste, modello mantiene rifiuto (2548ms, 0 tool calls)
- **B04-003** `availability-edge`: Lunedì chiuso — cliente accetta spostare a martedì (23488ms, 2 tool calls)
- **B04-004** `availability-edge`: Lunedì chiuso — cliente accetta spostare a domenica (19282ms, 2 tool calls)
- **B04-006** `availability-edge`: Alle 16:00 — gap tra pranzo e cena, chiuso (3476ms, 0 tool calls)
- **B04-007** `availability-edge`: Alle 11:00 — prima apertura pranzo (12:00) (2099ms, 0 tool calls)
- **B04-009** `availability-edge`: Alle 20:30 — 30 minuti prima cena, cliente accetta 21:00 (17366ms, 2 tool calls)
- **B04-010** `availability-edge`: Alle 23:00 — dopo last booking (22:30) (2526ms, 0 tool calls)
- **B04-011** `availability-edge`: Dopo 22:30 — cliente accetta anticipare a 22:00 (19419ms, 2 tool calls)
- **B04-013** `availability-edge`: Data passata specifica poi correzione a futura (11 agosto = martedì aperto) (18952ms, 2 tool calls)
- **B04-014** `availability-edge`: Prenotazione last minute per domani sera (martedì aperto) (17868ms, 2 tool calls)
- **B04-015** `availability-edge`: 9 persone — sopra MAX (8), deve creare prenotazione pending owner e informare cliente (18292ms, 2 tool calls)
- **B04-016** `availability-edge`: 10 persone — large group, deve creare prenotazione pending owner (19307ms, 2 tool calls)
- **B04-017** `availability-edge`: 15 persone — large group, deve creare prenotazione pending owner (21018ms, 2 tool calls)
- **B04-019** `availability-edge`: 8 persone — limite superiore MAX_PEOPLE, deve passare come normale (19375ms, 2 tool calls)
- **B04-020** `availability-edge`: 1 sola persona — deve funzionare normalmente (17916ms, 2 tool calls)
- **B04-021** `availability-edge`: 'ora di pranzo' — modello chiede orario, cliente specifica 13:00 (21877ms, 2 tool calls)
- **B04-022** `availability-edge`: 'per cena' — modello chiede orario, cliente specifica 21:00 (28600ms, 2 tool calls)
- **B04-023** `availability-edge`: 'presto' — ambiguo, modello deve chiedere chiarimento (2429ms, 0 tool calls)
- **B04-024** `availability-edge`: 'tarda serata' — deve proporre ultimo slot (22:30) (19015ms, 2 tool calls)
- **B04-025** `availability-edge`: 'quando aprite' — cliente chiede orario apertura, poi prenota (18041ms, 2 tool calls)
- **B04-026** `availability-edge`: Ferragosto (15 agosto) — festivo, deve accettare (16279ms, 2 tool calls)
- **B04-027** `availability-edge`: Data lontana (dicembre) — deve accettare senza problemi (15876ms, 2 tool calls)
- **B04-028** `availability-edge`: Orario borderline — esattamente 22:30 (last booking) (21603ms, 2 tool calls)
- **B04-029** `availability-edge`: OVERBOOKING sabato 21:00 pieno, cliente accetta 22:30 [SEED: 30 pax sabato prossimo 21:00] (26996ms, 3 tool calls)
- **B04-030** `availability-edge`: OVERBOOKING sabato 21:00 pieno, cliente accetta domenica [SEED: 30 pax sabato prossimo 21:00] (21377ms, 3 tool calls)

## ❌ Failed (5)

### B04-001 — `availability-edge`
**Description**: Lunedì chiuso — cliente rifiutato

**Reason**: reply must contain 'chius' — got: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla? Mi dispiace, chiudiamo il lunedì. Vuole prenotare per martedì o un altro giorno tra martedì e domenica?

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per lunedì prossimo alle 21:30 per 2 persone, a nome Marco Bianchi

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[AI reply 2]**: Mi dispiace, chiudiamo il lunedì. Vuole prenotare per martedì o un altro giorno tra martedì e domenica?

**Tool calls made** (0):
```json
[]
```

**Duration**: 2614ms

---

### B04-005 — `availability-edge`
**Description**: Alle 15:30 — dopo chiusura pranzo (14:30)

**Reason**: last reply not in 'it': mi dispiace, alle 15:30 non possiamo prenotare — l’orario non è previsto per il pranzo.  
per pranzo possiamo prenotare fino alle 14:30, oppure per ce

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per venerdì prossimo alle 15:30, 2 persone, a nome Paolo Verdi

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[AI reply 2]**: Mi dispiace, alle 15:30 non possiamo prenotare — l’orario non è previsto per il pranzo.  
Per pranzo possiamo prenotare fino alle 14:30, oppure per cena dalle 21:00 alle 22:30. Vuole un’altra ora?

**Tool calls made** (0):
```json
[]
```

**Duration**: 2467ms

---

### B04-008 — `availability-edge`
**Description**: Alle 20:00 — prima apertura cena (21:00 config reale)

**Reason**: last reply not in 'it': per la cena non possiamo prenotare alle 20:00; il servizio inizia alle 21:00. vuole prenotare alle 21:00 invece?

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per venerdì prossimo alle 20, 4 persone, a nome Elena Ricci

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[AI reply 2]**: Per la cena non possiamo prenotare alle 20:00; il servizio inizia alle 21:00. Vuole prenotare alle 21:00 invece?

**Tool calls made** (0):
```json
[]
```

**Duration**: 4274ms

---

### B04-012 — `availability-edge`
**Description**: Data passata — 'ieri sera'

**Reason**: last reply not in 'it': mi dispiace, non posso prenotare per una data passata. vuole prenotare per un giorno futuro?

**Full transcript**:

**[User turn 1]**: Buonasera, vorrei prenotare per ieri sera alle 21, 2 persone, a nome Laura Bianchi

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[AI reply 2]**: Mi dispiace, non posso prenotare per una data passata. Vuole prenotare per un giorno futuro?

**Tool calls made** (0):
```json
[]
```

**Duration**: 1366ms

---

### B04-018 — `availability-edge`
**Description**: 50 persone — evento/large group, deve creare prenotazione pending owner

**Reason**: expected tool call 'crea_prenotazione' with args {"persone":50,"nome":"Riccardo Palumbo"} not found. Actual: []

**Full transcript**:

**[User turn 1]**: Buongiorno, avremmo un evento aziendale per venerdì prossimo alle 21, siamo in 50, a nome Riccardo Palumbo

**[AI reply 1]**: Salve, sono l'assistente vocale automatico di Osteria Test, come posso aiutarla?

**[User turn 2]**: Sì confermiamo

**[AI reply 2]**: Perfetto, mi occuperò della richiesta. Per registrare un evento aziendale, ho bisogno di un contatto email: me la può indicare?

**[AI reply 3]**: Grazie mille. Confermate la richiesta, ma ho bisogno di un’email per registrare l’evento aziendale. Può indicarla, per favore?

**Tool calls made** (0):
```json
[]
```

**Duration**: 3903ms

---

