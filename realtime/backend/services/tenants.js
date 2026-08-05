// ═══════════════════════════════════════════════════════════════════════════════
// TENANTS SERVICE — Lookup ristoranti con cache Redis
// ═══════════════════════════════════════════════════════════════════════════════
// Sostituisce Registry.getConfigForNumber() di index.js.
//
// Strategia cache:
//   - Chiave: `tenant:phone:+390299223311`
//   - TTL: 5 minuti (uguale a quello attuale)
//   - Invalidazione manuale via invalidateTenantCache()
//
// Latenza attesa:
//   - Cache hit: 5-15ms (Redis)
//   - Cache miss: 30-50ms (Postgres query + populate cache)
//   - Attuale (Google Sheet gviz): 500-1500ms
// ═══════════════════════════════════════════════════════════════════════════════

import { query } from '../db.js';
import { cacheGet, cacheSet, cacheDel, cacheDelPrefix } from '../cache.js';

const CACHE_PREFIX = 'tenant:phone:';
const CACHE_TTL_SECONDS = 5 * 60;  // 5 minuti, come Registry attuale

// Normalizza il numero telefonico (rimuove spazi, parentesi, trattini)
// ma tiene il +. Compatibile con come index.js fa la normalizzazione.
function normalizePhone(phone) {
  if (!phone) return '';
  return String(phone).replace(/[\s\-\(\)]/g, '').trim();
}

// Mappa la riga del DB al formato attuale usato da openai-realtime.js
// (deve essere compatibile con `restaurantConfig` esistente!)
function mapDbRowToRestaurantConfig(row) {
  return {
    // Campi identità
    restaurant_id:   row.restaurant_id,
    restaurantName:  row.restaurant_name,
    receptionistName: row.receptionist_name || 'Giulia',
    twilio_number:   row.phone_number,
    restaurantPhone: row.restaurant_phone || '',
    owner_email:     row.owner_email,
    plan:            row.plan || 'beta',
    active:          !!row.is_active,

    // Orari (già stringhe TIME dal DB, formato "HH:MM:SS" → tagliamo a HH:MM)
    lunchStart:      row.lunch_start  ? String(row.lunch_start).substring(0,5)  : '12:00',
    lunchEnd:        row.lunch_end    ? String(row.lunch_end).substring(0,5)    : '15:00',
    dinnerStart:     row.dinner_start ? String(row.dinner_start).substring(0,5) : '19:00',
    dinnerEnd:       row.dinner_end   ? String(row.dinner_end).substring(0,5)   : '22:30',

    // Chiusure (array PostgreSQL già parsato)
    closedDays:        row.closed_days        || [],
    lunchClosedDays:   row.lunch_closed_days  || [],
    dinnerClosedDays:  row.dinner_closed_days || [],

    // Soglie
    largeGroupThreshold: Number(row.large_group_threshold) || 10,
    eventThreshold:      Number(row.event_threshold)      || 45,
    total_seats:         Number(row.total_seats)          || 30,
    slot_minutes:        Number(row.slot_minutes)         || 90,

    // Google integration (per il mirror + calendar sync)
    google_calendar_id:  row.google_calendar_id || null,
    google_sheet_id:     row.google_sheet_id    || null,
    appsScriptUrl:       row.google_apps_script_url || '',

    // Timezone
    timezone:        row.timezone || 'Europe/Rome',
  };
}

// ─── PUBLIC API ────────────────────────────────────────────────────────────────

/**
 * getTenantByPhone(phoneNumber)
 *
 * Restituisce il tenant per il numero Telnyx passato.
 * Cerca prima in cache Redis, poi in Postgres.
 * Popola la cache se cache miss.
 *
 * Compatibile drop-in con Registry.getConfigForNumber(twilioNumber).
 *
 * @param {string} phoneNumber - Numero Telnyx (formato +39...)
 * @returns {Promise<object|null>} - restaurantConfig o null se non trovato
 */
export async function getTenantByPhone(phoneNumber) {
  if (!phoneNumber) return null;
  const normalized = normalizePhone(phoneNumber);
  const cacheKey = `${CACHE_PREFIX}${normalized}`;

  // 1. Prova cache
  const cached = await cacheGet(cacheKey);
  if (cached) {
    // Log solo in modo minimo per non intasare (era già loggato al primo lookup)
    return cached;
  }

  // 2. Query Postgres
  const start = Date.now();
  const result = await query(
    `SELECT * FROM tenants WHERE phone_number = $1 AND is_active = true LIMIT 1`,
    [phoneNumber]
  );
  const ms = Date.now() - start;

  if (result.rows.length === 0) {
    console.log(`⚠️  Tenant: nessun match per ${phoneNumber} (${ms}ms)`);
    return null;
  }

  const config = mapDbRowToRestaurantConfig(result.rows[0]);
  console.log(`✅ Tenant match: "${config.restaurantName}" per ${phoneNumber} (${ms}ms, from DB)`);

  // 3. Populate cache (fire-and-forget, non blocchiamo)
  cacheSet(cacheKey, config, CACHE_TTL_SECONDS).catch(() => {});

  return config;
}

/**
 * Invalida la cache per un tenant specifico.
 * Da chiamare quando modifichiamo il tenant (config, chiusure ecc.).
 */
export async function invalidateTenantCache(phoneNumber) {
  const normalized = normalizePhone(phoneNumber);
  const cacheKey = `${CACHE_PREFIX}${normalized}`;
  await cacheDel(cacheKey);
  console.log(`🗑  Cache invalidata per tenant ${phoneNumber}`);
}

/**
 * Invalida TUTTA la cache tenant.
 * Da chiamare dopo migrazioni bulk o modifiche multiple.
 */
export async function invalidateAllTenantsCache() {
  return await cacheDelPrefix(CACHE_PREFIX);
}

/**
 * Elenca tutti i tenant attivi (per script di admin, non per critical path).
 */
export async function listActiveTenants() {
  const result = await query(
    `SELECT id, restaurant_id, restaurant_name, phone_number, plan, created_at
     FROM tenants WHERE is_active = true ORDER BY restaurant_name`
  );
  return result.rows;
}
