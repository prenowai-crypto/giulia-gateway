// tests/utils.js — helper condivisi per runner A e B

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;
if (!APPS_SCRIPT_URL) throw new Error('APPS_SCRIPT_URL env var mancante');

// ─────────────────────────────────────────────────────────────────────────────
// PLACEHOLDER RESOLVER
// I test JSON possono usare placeholder dinamici tipo $NEXT_WED, $TODAY_ISO, ecc.
// Vengono risolti alla lettura del test in base alla data corrente.
// ─────────────────────────────────────────────────────────────────────────────

const DAY_MAP_IT_TO_INDEX = { domenica:0, lunedi:1, lunedì:1, martedi:2, martedì:2, mercoledi:3, mercoledì:3, giovedi:4, giovedì:4, venerdi:5, venerdì:5, sabato:6 };
const DAY_MAP_EN_TO_INDEX = { sunday:0, monday:1, tuesday:2, wednesday:3, thursday:4, friday:5, saturday:6 };

function pad2(n){ return String(n).padStart(2,'0'); }
function isoDate(d){ return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }

function nextWeekday(from, targetIdx) {
  const d = new Date(from);
  const cur = d.getDay();
  let diff = (targetIdx - cur + 7) % 7;
  if (diff === 0) diff = 7; // sempre nel futuro
  d.setDate(d.getDate() + diff);
  return d;
}

function resolvePlaceholders(obj, ctx = {}) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') {
    // $TODAY, $TOMORROW, $NEXT_MON..$NEXT_SUN, $DAYS_+N, e riferimenti a variabili salvate $varName
    if (obj.startsWith('$')) {
      const now = new Date();
      const key = obj.slice(1);

      if (key === 'TODAY') return isoDate(now);
      if (key === 'TODAY_HUMAN') {
        const days = ['domenica','lunedì','martedì','mercoledì','giovedì','venerdì','sabato'];
        return `${days[now.getDay()]} ${now.getDate()}`;
      }
      if (key === 'TOMORROW') {
        const d = new Date(now); d.setDate(d.getDate()+1); return isoDate(d);
      }
      if (key.startsWith('DAYS_+')) {
        const n = parseInt(key.slice(6), 10);
        const d = new Date(now); d.setDate(d.getDate()+n); return isoDate(d);
      }
      if (key.startsWith('NEXT_')) {
        const dayName = key.slice(5).toLowerCase();
        const idx = DAY_MAP_EN_TO_INDEX[dayName] ?? DAY_MAP_IT_TO_INDEX[dayName];
        if (idx !== undefined) return isoDate(nextWeekday(now, idx));
      }
      // Variabile salvata da uno step precedente (es. $eventId)
      if (ctx[key] !== undefined) return ctx[key];
    }
    return obj;
  }
  if (Array.isArray(obj)) return obj.map(v => resolvePlaceholders(v, ctx));
  if (typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = resolvePlaceholders(v, ctx);
    return out;
  }
  return obj;
}

// ─────────────────────────────────────────────────────────────────────────────
// APPS SCRIPT HTTP CLIENT
// ─────────────────────────────────────────────────────────────────────────────

async function callAppsScript(payload, timeoutMs = 15000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await res.text();
    try { return JSON.parse(text); }
    catch { return { _rawText: text, _status: res.status }; }
  } finally {
    clearTimeout(t);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ASSERTIONS
// ─────────────────────────────────────────────────────────────────────────────

function getPath(obj, path) {
  return path.split('.').reduce((acc, k) => (acc == null ? undefined : acc[k]), obj);
}

function assertOne(actual, spec) {
  const v = getPath(actual, spec.path);
  if ('equals' in spec) {
    if (v !== spec.equals) return `path '${spec.path}': expected ${JSON.stringify(spec.equals)}, got ${JSON.stringify(v)}`;
  }
  if ('contains' in spec) {
    if (typeof v !== 'string' || !v.includes(spec.contains)) return `path '${spec.path}': expected to contain ${JSON.stringify(spec.contains)}, got ${JSON.stringify(v)}`;
  }
  if ('exists' in spec) {
    const has = v !== undefined && v !== null;
    if (spec.exists !== has) return `path '${spec.path}': exists=${spec.exists} expected, actual has=${has}`;
  }
  if ('gt' in spec) {
    if (!(typeof v === 'number' && v > spec.gt)) return `path '${spec.path}': expected > ${spec.gt}, got ${JSON.stringify(v)}`;
  }
  if ('in' in spec) {
    if (!spec.in.includes(v)) return `path '${spec.path}': expected one of ${JSON.stringify(spec.in)}, got ${JSON.stringify(v)}`;
  }
  return null;
}

function runAssertions(actual, assertions = []) {
  const errors = [];
  for (const a of assertions) {
    const err = assertOne(actual, a);
    if (err) errors.push(err);
  }
  return errors;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLEANUP HELPER (rimuove artefatti creati dai test)
// ─────────────────────────────────────────────────────────────────────────────

// v2 fix: usa nome+data+ora come chiave di cancellazione (formato reale Apps Script)
async function safeCancel(booking) {
  if (!booking?.nome || !booking?.data || !booking?.ora) return { skipped: true };
  try {
    const ora = booking.ora.length === 5 ? booking.ora + ':00' : booking.ora;
    return await callAppsScript({
      action: 'cancel_reservation',
      nome: booking.nome,
      data: booking.data,
      ora,
      telefono: booking.telefono || '',
    });
  } catch (e) {
    return { error: e?.message || String(e) };
  }
}

// Backward-compat alias (rimuovere in futuro)
async function safeCancelByEventId(eventId) {
  return { skipped: true, deprecated: true };
}

module.exports = {
  APPS_SCRIPT_URL,
  resolvePlaceholders,
  callAppsScript,
  runAssertions,
  safeCancel,
  safeCancelByEventId,
  isoDate,
};
