# Batch B-02 (tests 51-60)
Run: 2026-08-10T12:09:04.531Z | Model: gpt-realtime-2.1-mini | Total: 10 | Passed: 10 (100%) | Failed: 0

## ✅ Passed (10)

- **B06-021** `entity-capture`: Cognome fonicamente ambiguo — cliente ripete e conferma (19744ms, 2 tool calls)
- **B06-022** `entity-capture`: Nome tipicamente ambiguo al telefono — Villa vs Villani (17703ms, 2 tool calls)
- **B06-023** `entity-capture`: Cliente dice tutto in un turno — persone, ora, nome, nota (18362ms, 2 tool calls)
- **B06-024** `entity-capture`: Cliente dà nome mentre parla di altro — deve estrarlo comunque (18724ms, 2 tool calls)
- **B06-025** `entity-capture`: Doppia richiesta — allergia + tavolo lontano dalla porta (18665ms, 2 tool calls)
- **B06-026** `entity-capture`: Cliente aggiunge la nota DOPO la conferma iniziale (16071ms, 2 tool calls)
- **B06-027** `entity-capture`: Cliente ha un nome tipicamente maschile ma è donna che prenota per marito — cattura correttamente (21223ms, 2 tool calls)
- **B06-028** `entity-capture`: Il cliente NON dice il nome — Giulia deve chiederlo, il cliente risponde (29165ms, 2 tool calls)
- **B06-029** `entity-capture`: Cliente pronuncia il cognome in modo non chiaro — Giulia deve chiedere ripetizione (20958ms, 2 tool calls)
- **B06-030** `entity-capture`: Cliente dà informazioni sparse in molti turni (20617ms, 2 tool calls)

