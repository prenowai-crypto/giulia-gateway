# Backend Prenow — Giorno 1

Sostituisce Apps Script per le tool call del gateway.

## Struttura

```
backend/
├── db.js                  # Postgres pool (Neon)
├── cache.js               # Redis client (Upstash)
├── services/
│   └── tenants.js         # Lookup ristorante con cache
└── tests/
    └── smoke.js           # Test connessioni + primo lookup
```

## Setup locale

1. Aggiungi al file `.env` (in `realtime/`):
   ```
   DATABASE_URL=postgresql://...
   UPSTASH_REDIS_REST_URL=https://...
   UPSTASH_REDIS_REST_TOKEN=AXX...
   ```

2. Installa le nuove dipendenze:
   ```bash
   cd realtime
   npm install
   ```

3. Esegui lo smoke test:
   ```bash
   npm run smoke
   ```

   Output atteso:
   ```
   ✅ Postgres connesso in XXms
   ✅ Redis connesso in XXms (Upstash)
   ✅ Tenant attivi trovati: 1
   ✅ Cache miss lookup: XXms — "Osteria Test"
   ✅ Cache hit lookup: XXms — più veloce del miss ✓
   ✅ TUTTI I TEST SUPERATI
   ```

## Setup Render

Nel dashboard Render → giulia-gateway → Environment → Add Variable, aggiungi:
- `DATABASE_URL`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

Al prossimo deploy, il backend sarà disponibile.

## Note

- **Non tocca `openai-realtime.js`**: la vecchia Registry via Google Sheets è ancora attiva.
- Il nuovo `getTenantByPhone()` è pronto ma NON usato dal gateway finché non facciamo il cutover al Giorno 3.
- La cache Redis ha TTL 5 minuti, uguale a quella attuale in `index.js`.
