// ═══════════════════════════════════════════════════════════════════════════════
// REDIS CACHE — Upstash con protocollo REST HTTP
// ═══════════════════════════════════════════════════════════════════════════════
// Upstash Redis via HTTP REST è la scelta migliore per un ambiente serverless:
// - Zero connection pooling (no TCP)
// - Latenza tipica 5-15ms (endpoint EU)
// - Auto-scaling gestito da Upstash
// - Free tier generoso (500k richieste/mese)
//
// Usiamo il pacchetto ufficiale @upstash/redis che espone metodi simili a
// ioredis ma via HTTP.
// ═══════════════════════════════════════════════════════════════════════════════

import { Redis } from '@upstash/redis';

if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
  console.error('❌ UPSTASH_REDIS_REST_URL o UPSTASH_REDIS_REST_TOKEN mancante.');
  throw new Error('Upstash Redis env vars missing');
}

const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Verifica connessione allo startup
export async function verifyRedisConnection() {
  try {
    const start = Date.now();
    await redis.set('__healthcheck__', 'ok', { ex: 60 });
    const value = await redis.get('__healthcheck__');
    const ms = Date.now() - start;
    if (value === 'ok') {
      console.log(`✅ Redis connesso in ${ms}ms (Upstash)`);
      return true;
    }
    console.error('❌ Redis healthcheck: valore inatteso');
    return false;
  } catch (err) {
    console.error('❌ Redis verify FAILED:', err.message);
    return false;
  }
}

// ─── Cache helpers con serializzazione JSON automatica ─────────────────────────

// GET con parsing JSON automatico
export async function cacheGet(key) {
  try {
    const raw = await redis.get(key);
    if (raw === null || raw === undefined) return null;
    // Upstash restituisce già oggetti se il valore è JSON, non serve parse
    return raw;
  } catch (err) {
    console.warn(`⚠️  cacheGet(${key}) failed: ${err.message}`);
    return null;   // fail-open: se cache down, il chiamante legge dal DB
  }
}

// SET con TTL in secondi (default 5 minuti)
export async function cacheSet(key, value, ttlSeconds = 300) {
  try {
    await redis.set(key, value, { ex: ttlSeconds });
    return true;
  } catch (err) {
    console.warn(`⚠️  cacheSet(${key}) failed: ${err.message}`);
    return false;  // fail-open: se cache down, andiamo avanti senza cache
  }
}

// DEL: cancella una chiave (es. quando il tenant viene aggiornato)
export async function cacheDel(key) {
  try {
    await redis.del(key);
    return true;
  } catch (err) {
    console.warn(`⚠️  cacheDel(${key}) failed: ${err.message}`);
    return false;
  }
}

// Cancella tutte le chiavi con un prefisso (utile in dev/test)
export async function cacheDelPrefix(prefix) {
  try {
    let cursor = 0;
    let count = 0;
    do {
      const result = await redis.scan(cursor, { match: `${prefix}*`, count: 100 });
      cursor = result[0];
      const keys = result[1];
      if (keys.length > 0) {
        await redis.del(...keys);
        count += keys.length;
      }
    } while (cursor !== 0);
    console.log(`🗑  Cache invalidata: ${count} chiavi con prefisso "${prefix}"`);
    return count;
  } catch (err) {
    console.warn(`⚠️  cacheDelPrefix(${prefix}) failed: ${err.message}`);
    return 0;
  }
}

export default redis;
