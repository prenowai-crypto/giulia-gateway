# Prenow — Automated Tests

Suite di test automatici per il gateway Prenow/Giulia. Testa il modello `gpt-realtime-2.1-mini` in modalità text-only via Realtime API (stesso modello usato nelle chiamate vocali di produzione).

## Struttura

```
tests/
  data/                  — Test definitions (JSON)
    b-*.json             — Test integration
  reports/               — Report Markdown generati (batch da 50)
  utils.cjs              — Helper condivisi
  runner-b.cjs           — Esegue tutti i test
  README.md              — Questo file
.github/workflows/
  tests.yml              — Workflow GitHub Actions
```

## Come lanciare i test

1. Vai su GitHub → repository → tab **Actions**
2. Seleziona workflow **Automated Tests**
3. Clicca **Run workflow** in alto a destra → **Run workflow** (bottone verde)
4. Aspetta ~5-40 minuti (dipende dal numero di test)
5. I report vengono committati automaticamente in `tests/reports/`:
   - `latest-b-batch-01.md`, `-02.md`, ecc. — batch da 50 test
   - `summary-b.md` — statistiche aggregate

## Secrets richiesti su GitHub

Settings → Secrets and variables → Actions:

- `APPS_SCRIPT_URL` — URL del web app Apps Script del ristorante di test
- `OPENAI_API_KEY` — API key OpenAI

## Cosa testano i test

Ogni test simula una conversazione testuale con `gpt-realtime-2.1-mini` via WebSocket:

- Il modello riceve gli stessi **system prompt** e **tool schema** della produzione
- I tool call chiamano davvero Apps Script (crea prenotazioni reali, poi le cancella in cleanup)
- Testa: uso corretto dei tool, entity capture (nome/data/ora/persone), multilingua, sicurezza, gestione errori, flusso conversazionale

Differenze rispetto alle chiamate vocali reali:
- Input testuale invece che audio (no Whisper)
- Output testuale invece che audio (no TTS, no VAD)
- Tutti gli altri comportamenti sono identici

## Formato test

```json
{
  "id": "B-042",
  "category": "multilingua",
  "description": "Human-readable description",
  "userTurns": [ "First user message", "Second turn", ... ],
  "expectedToolCalls": [
    { "name": "controlla_disponibilita" },
    { "name": "crea_prenotazione", "argsContain": { "persone": 4 } }
  ],
  "forbiddenToolCalls": [ "cancella_prenotazione" ],
  "replyMustContain": [ "confirmed" ],
  "replyMustNotContain": [ "un attimo", "certo" ],
  "replyLanguage": "en"
}
```

Lingue supportate per `replyLanguage`: `it`, `en`, `fr`, `de`, `es`.

## Cleanup

Ogni test cancella automaticamente le prenotazioni create durante la sua esecuzione.

## Costi

- ~5€ per run completo di 300 test (senza cache prompt)
- ~2€ per run successivi (con caching Apps Script prompt)
- Modello: `gpt-realtime-2.1-mini` in modalità `output_modalities: ['text']`
