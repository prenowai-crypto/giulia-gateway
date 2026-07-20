# Prenow — Automated Tests

Suite di test automatici per il gateway Prenow/Giulia. Due livelli:

- **Livello A** — Unit test backend (Apps Script). Veloce, deterministico, zero costi.
- **Livello B** — Integration test via **Realtime API text-only** verso `gpt-realtime-2.1-mini` (lo stesso modello di produzione). Verifica modello + tool + backend. ~5€ per run completo.

## Struttura

```
tests/
  data/                  — Test definitions in JSON
    a-*.json             — Test Livello A
    b-*.json             — Test Livello B
  reports/               — Report Markdown generati (batch da 50)
  utils.js               — Helper condivisi
  runner-a.js            — Esegue tutti i test A
  runner-b.js            — Esegue tutti i test B
  README.md              — Questo file
.github/workflows/
  tests.yml              — Workflow GitHub Actions
```

## Come lanciare i test

1. Vai su GitHub → repository `giulia-gateway` → tab **Actions**
2. Seleziona workflow **Automated Tests (A + B)** dalla lista di sinistra
3. Clicca **Run workflow** in alto a destra
4. Scegli quali livelli eseguire:
   - `both` — entrambi
   - `a-only` — solo backend (veloce)
   - `b-only` — solo integrazione modello
5. Clicca **Run workflow** (bottone verde)
6. Aspetta ~5-15 minuti
7. Vai nel run: due job (`runner-a`, `runner-b`)
8. Report generati automaticamente in `tests/reports/`:
   - `latest-a-batch-01.md`, `-02.md`, ecc. — batch da 50 test A
   - `latest-b-batch-01.md`, ecc. — batch da 50 test B
   - `summary-a.md`, `summary-b.md` — statistiche aggregate

I report vengono committati automaticamente sul branch main.

## Secrets richiesti su GitHub

Settings → Secrets and variables → Actions → New repository secret:

- `APPS_SCRIPT_URL` — URL completo del web app Apps Script del ristorante di test
- `OPENAI_API_KEY` — API key OpenAI (per runner B)

## Formato test A

```json
{
  "id": "A-042",
  "category": "booking-modify",
  "description": "Human-readable description",
  "setup": [ /* steps executed before test */ ],
  "steps": [
    {
      "action": "check_availability",
      "params": { "data": "$NEXT_WED", "ora": "21:00:00", "persone": 4 },
      "assert": [
        { "path": "esito", "equals": "libero" }
      ]
    }
  ],
  "cleanup": [ /* steps to clean up artefacts */ ]
}
```

Actions disponibili: `check_availability`, `create_reservation`, `find_reservation`, `update_reservation`, `cancel_reservation`, `request_event`, `get_restaurant_info`.

Placeholder dinamici: `$TODAY`, `$TOMORROW`, `$DAYS_+7`, `$NEXT_MONDAY`..`$NEXT_SUNDAY`, `$NEXT_LUNEDI`..`$NEXT_DOMENICA`, e variabili salvate via `save` (es. `$eventId`).

Asserzioni: `equals`, `contains`, `exists`, `gt`, `in`.

## Formato test B

```json
{
  "id": "B-042",
  "category": "multilingua",
  "description": "English caller must get English replies",
  "userTurns": [ "First user message", "Second turn", ... ],
  "expectedToolCalls": [ { "name": "controlla_disponibilita", "argsContain": { "persone": 2 } } ],
  "forbiddenToolCalls": [ "cancella_prenotazione" ],
  "replyMustContain": [ "confirmed" ],
  "replyMustNotContain": [ "un attimo", "certo" ],
  "replyLanguage": "en"
}
```

`replyLanguage` supportati: `it`, `en`, `fr`, `de`, `es`.

## Cleanup

Ogni test è responsabile del proprio cleanup. Il runner esegue comunque `cancel_reservation` per ogni `eventId` creato durante il test, come safety net.

## Costi

- Livello A: gratis (solo Apps Script quota Google).
- Livello B: usa `gpt-realtime-2.1-mini` via WebSocket in modalità text-only. Costo stimato: ~5€ per 100 test (varia con lunghezza conversazioni). Modalità text elimina i token audio, molto più economica rispetto a produzione.

## Modello di test

Il runner B usa **lo stesso modello di produzione** (`gpt-realtime-2.1-mini`) via WebSocket Realtime API. Configurato con `output_modalities: ['text']` per non generare audio. Questo permette di:
- Testare l'esatto comportamento del modello (uso tool, entity capture, multilingua, sicurezza)
- Evitare costi audio non necessari (Whisper input, TTS output)
- Eseguire i test 3-5x più veloci di test vocali

Il modello puoi cambiarlo via env variable `TEST_MODEL` (default `gpt-realtime-2.1-mini`).
