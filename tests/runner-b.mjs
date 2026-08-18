// ═══════════════════════════════════════════════════════════════════════════════
// RUNNER B — Variante ESM per Render Shell (usa backend Postgres Neon)
// ═══════════════════════════════════════════════════════════════════════════════
// Speculare a runner-b.cjs (che gira su GitHub Actions contro Apps Script),
// ma esegue le tool call sul backend Postgres reale importando direttamente
// i tool wrapper del gateway.
//
// UTILIZZO SU RENDER SHELL:
//   cd /opt/render/project/src/tests
//   node runner-b.mjs --batch B02                   # solo B02
//   node runner-b.mjs --batch B02,B04               # B02 e B04
//   node runner-b.mjs --batch B02-B07               # range
//   node runner-b.mjs --batch all                   # tutti
//   node runner-b.mjs --list                        # lista batch disponibili
//   node runner-b.mjs --cleanup-only                # solo cleanup residui
//
// ENVIRONMENT (già presenti su Render):
//   OPENAI_API_KEY               (deve esserci)
//   DATABASE_URL                 (Neon Postgres)
//   UPSTASH_REDIS_REST_URL       (Redis cache)
//   UPSTASH_REDIS_REST_TOKEN
//   TEST_TENANT_PHONE (opzionale, default +390299223311 = Osteria Test)
//
// OUTPUT:
//   tests/reports/render-YYYY-MM-DD-HH-mm.md
//   tests/reports/latest-conversations.md (sovrascritto ogni run)
//
// CLEANUP:
//   Ogni test scrive nelle notes 'TEST_RUNNER_B_<runId>_<testId>' → a fine batch
//   DELETE FROM reservations WHERE notes LIKE 'TEST_RUNNER_B_%'
//   Anche se il runner crasha, il prossimo run pulisce tutti i residui.
// ═══════════════════════════════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

// ─── Import dei tool wrapper del backend (Postgres) ─────────────────────────
// Path relativo: tests/runner-b.mjs → ../realtime/backend/...
import { getTenantByPhone, invalidateTenantCache } from '../realtime/backend/services/tenants.js';
import { query } from '../realtime/backend/db.js';
import { controllaDisponibilitaTool } from '../realtime/backend/tools/check-availability.js';
import { creaPrenotazioneTool }        from '../realtime/backend/tools/crea-prenotazione.js';
import { trovaPrenotazioneTool }       from '../realtime/backend/tools/trova-prenotazione.js';
import { modificaPrenotazioneTool }    from '../realtime/backend/tools/modifica-prenotazione.js';
import { cancellaPrenotazioneTool }    from '../realtime/backend/tools/cancella-prenotazione.js';
import { richiediEventoTool }          from '../realtime/backend/tools/richiedi-evento.js';
import { infoLocaleTool }              from '../realtime/backend/tools/info-locale.js';

// ─── Costanti ────────────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const DATA_DIR    = path.join(__dirname, 'data');
const REPORTS_DIR = path.join(__dirname, 'reports');
const BATCH_SIZE  = 50;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) { console.error('❌ OPENAI_API_KEY mancante'); process.exit(1); }

const MODEL         = 'gpt-realtime-2.1-mini';
const REALTIME_URL  = `wss://api.openai.com/v1/realtime?model=${MODEL}`;
const TURN_TIMEOUT_MS = 45000;

const TENANT_PHONE = process.env.TEST_TENANT_PHONE || '+390299223311';
const RUN_ID       = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
const TEST_MARKER  = `TEST_RUNNER_B_${RUN_ID}`;

// ─── Tools schema (identico al gateway) ──────────────────────────────────────
const TOOLS = [
  { type: 'function', name: 'trova_prenotazione', description: 'Find existing reservation by name and optionally date.',
    parameters: { type:'object', properties: { nome:{type:'string'}, data:{type:'string'} }, required:['nome'] } },
  { type: 'function', name: 'controlla_disponibilita', description: 'Check availability for date+time+people.',
    parameters: { type:'object', properties: { data:{type:'string'}, ora:{type:'string'}, persone:{type:'integer'} }, required:['data','ora','persone'] } },
  { type: 'function', name: 'crea_prenotazione', description: 'Create reservation.',
    parameters: { type:'object', properties: { nome:{type:'string'}, data:{type:'string'}, ora:{type:'string'}, persone:{type:'integer'}, note:{type:'string'} }, required:['nome','data','ora','persone','note'] } },
  { type: 'function', name: 'modifica_prenotazione', description: 'Modify reservation.',
    parameters: { type:'object', properties: { nome:{type:'string'}, data:{type:'string'}, ora:{type:'string'}, persone:{type:'integer'}, note:{type:'string'} } } },
  { type: 'function', name: 'cancella_prenotazione', description: 'Cancel reservation.',
    parameters: { type:'object', properties: { nome:{type:'string'} }, required:['nome'] } },
  { type: 'function', name: 'richiedi_evento', description: 'Register event request.',
    parameters: { type:'object', properties: { nome:{type:'string'}, data:{type:'string'}, ora:{type:'string'}, persone:{type:'integer'}, note:{type:'string'}, email:{type:'string'} }, required:['nome','data','ora','persone','note','email'] } },
  { type: 'function', name: 'info_locale', description: 'Get restaurant info.',
    parameters: { type:'object', properties: { argomento:{type:'string'} } } },
  { type: 'function', name: 'trasferisci_al_ristorante', description: 'Transfer call to restaurant.',
    parameters: { type:'object', properties: { motivo:{type:'string'} }, required:['motivo'] } },
];

// ═══════════════════════════════════════════════════════════════════════════════
// SYSTEM PROMPT LOADER (identico al runner-b.cjs)
// ═══════════════════════════════════════════════════════════════════════════════
function loadSystemPromptTemplate() {
  const candidatePaths = [
    path.join(__dirname, '..', 'openai-realtime.js'),
    path.join(__dirname, '..', 'realtime', 'openai-realtime.js'),
  ];
  for (const p of candidatePaths) {
    if (!fs.existsSync(p)) continue;
    const src = fs.readFileSync(p, 'utf-8');
    const startMarker = 'const SYSTEM_PROMPT_TEMPLATE = `';
    const startIdx = src.indexOf(startMarker);
    if (startIdx === -1) continue;
    const afterStart = startIdx + startMarker.length;
    let endIdx = -1;
    for (let i = afterStart; i < src.length; i++) {
      if (src[i] === '`' && src[i - 1] !== '\\') { endIdx = i; break; }
    }
    if (endIdx === -1) continue;
    return src.substring(afterStart, endIdx);
  }
  throw new Error('SYSTEM_PROMPT_TEMPLATE not found in openai-realtime.js');
}

function fillPromptPlaceholders(template, context = {}) {
  const now = new Date();
  const days = ['domenica','lunedì','martedì','mercoledì','giovedì','venerdì','sabato'];
  const todayHuman = `${days[now.getDay()]} ${now.getDate()}`;
  const todayIso = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  return template
    .replace(/\{\{RECEPTIONIST_NAME\}\}/g, context.receptionistName || 'Giulia')
    .replace(/\{\{RESTAURANT_NAME\}\}/g,   context.restaurantName   || 'Osteria Test')
    .replace(/\{\{TODAY_HUMAN\}\}/g,       todayHuman)
    .replace(/\{\{TODAY_ISO\}\}/g,         todayIso)
    .replace(/\{\{CALLER_PHONE\}\}/g,      context.callerPhone      || '+390000000000')
    .replace(/\{\{WEEKLY_SCHEDULE\}\}/g,   context.weeklySchedule   || '');
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOOL DISPATCHER (Postgres backend invece di Apps Script)
// ═══════════════════════════════════════════════════════════════════════════════
// State globale: il tenant di test (caricato all'avvio dal DB)
let TEST_TENANT = null;

async function executeTool(name, args, testId) {
  const meta = { callId: `test-runner-${testId}`, callerPhone: '+390000000000' };

  // Marker su note per cleanup: ogni prenotazione test è identificabile
  const markedArgs = { ...args };
  if ((name === 'crea_prenotazione' || name === 'modifica_prenotazione' || name === 'richiedi_evento')) {
    const existingNote = String(args.note || '').trim();
    const marker = `${TEST_MARKER}_${testId}`;
    markedArgs.note = existingNote ? `${existingNote} [${marker}]` : `[${marker}]`;
  }

  try {
    switch (name) {
      case 'controlla_disponibilita': return await controllaDisponibilitaTool(TEST_TENANT, markedArgs, meta);
      case 'crea_prenotazione':       return await creaPrenotazioneTool(TEST_TENANT, markedArgs, meta);
      case 'trova_prenotazione':      return await trovaPrenotazioneTool(TEST_TENANT, markedArgs, meta);
      case 'modifica_prenotazione':   return await modificaPrenotazioneTool(TEST_TENANT, markedArgs, meta);
      case 'cancella_prenotazione':   return await cancellaPrenotazioneTool(TEST_TENANT, markedArgs, meta);
      case 'richiedi_evento':         return await richiediEventoTool(TEST_TENANT, markedArgs, meta);
      case 'info_locale':             return await infoLocaleTool(TEST_TENANT, markedArgs, meta);
      case 'trasferisci_al_ristorante': return { trasferita: true, istruzione: 'transfer stubbed for tests' };
      default: return { errore: `unknown tool: ${name}` };
    }
  } catch (err) {
    console.error(`   ⚠️  tool error [${name}]: ${err?.message || err}`);
    return { error: err?.message || String(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// WEBSOCKET CONVERSATION RUNNER (copiato da runner-b.cjs, adattato ESM)
// ═══════════════════════════════════════════════════════════════════════════════
function connectRealtime() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(REALTIME_URL, {
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

async function runConversation(systemPrompt, userTurns, testId) {
  const ws = await connectRealtime();
  const toolCalls = [];
  const aiReplies = [];
  const artifacts = [];
  const events = [];
  const pendingCalls = new Map();
  let currentResponseText = '';

  const send = (obj) => ws.send(JSON.stringify(obj));

  // Setup session
  await new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('session setup timeout')), 10000);
    const handler = (raw) => {
      let msg; try { msg = JSON.parse(raw); } catch { return; }
      if (msg.type === 'session.created') {
        send({
          type: 'session.update',
          session: {
            type: 'realtime',
            instructions: systemPrompt,
            tools: TOOLS,
            tool_choice: 'auto',
            output_modalities: ['text'],
          },
        });
      } else if (msg.type === 'session.updated') {
        clearTimeout(to); ws.off('message', handler); resolve();
      } else if (msg.type === 'error') {
        clearTimeout(to); ws.off('message', handler);
        reject(new Error(`session setup error: ${JSON.stringify(msg.error || msg)}`));
      }
    };
    ws.on('message', handler);
  });

  // Opening line
  send({ type: 'response.create' });
  await new Promise((resolve, reject) => {
    const to = setTimeout(() => { ws.off('message', handler); reject(new Error(`opening response timeout`)); }, 15000);
    let openingText = '';
    const handler = (raw) => {
      let msg; try { msg = JSON.parse(raw); } catch { return; }
      if (msg.type === 'response.output_text.delta' && msg.delta) openingText += msg.delta;
      if (msg.type === 'response.output_text.done' && msg.text) openingText = msg.text;
      if (msg.type === 'response.text.delta' && msg.delta) openingText += msg.delta;
      if (msg.type === 'response.text.done' && msg.text) openingText = msg.text;
      if (msg.type === 'response.output_item.done' && msg.item?.content) {
        for (const c of msg.item.content) {
          if ((c.type === 'output_text' || c.type === 'text') && c.text) openingText = c.text;
        }
      }
      if (msg.type === 'response.done') {
        if (openingText.trim()) { aiReplies.push(openingText.trim()); events.push({ type: 'ai', text: openingText.trim() }); }
        clearTimeout(to); ws.off('message', handler); resolve();
      }
      if (msg.type === 'error') { clearTimeout(to); ws.off('message', handler); reject(new Error(`opening error: ${JSON.stringify(msg.error || msg)}`)); }
    };
    ws.on('message', handler);
  });

  // Main loop
  for (const userText of userTurns) {
    events.push({ type: 'user', text: userText });
    send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: userText }] } });
    send({ type: 'response.create' });

    await new Promise((resolve, reject) => {
      const to = setTimeout(() => { ws.off('message', handler); reject(new Error(`turn timeout after ${TURN_TIMEOUT_MS}ms (userText: ${userText.substring(0, 50)})`)); }, TURN_TIMEOUT_MS);
      currentResponseText = '';
      // v7.7.5-runner: fix race condition.
      // OpenAI a volte manda response.done del turno PRECEDENTE prima di
      // iniziare il turno nuovo. Se non tracciamo response.created, chiudiamo
      // il turno troppo presto e perdiamo la vera risposta (specie quando
      // deve fare crea_prenotazione dopo conferma cliente).
      // Soluzione: ignora response.done finché non arriva un response.created
      // per il turno corrente. Reset del flag ad ogni response.create che il
      // runner invia (input cliente + dopo function_call_output).
      let responseStarted = false;

      const handler = async (raw) => {
        let msg; try { msg = JSON.parse(raw); } catch { return; }

        if (msg.type === 'response.created') responseStarted = true;

        if (msg.type === 'response.output_text.delta' && msg.delta) currentResponseText += msg.delta;
        if (msg.type === 'response.output_text.done' && msg.text) currentResponseText = msg.text;
        if (msg.type === 'response.text.delta' && msg.delta) currentResponseText += msg.delta;
        if (msg.type === 'response.text.done' && msg.text) currentResponseText = msg.text;
        if (msg.type === 'response.output_item.done' && msg.item?.content) {
          for (const c of msg.item.content) {
            if ((c.type === 'output_text' || c.type === 'text') && c.text) currentResponseText = c.text;
          }
        }

        if (msg.type === 'response.function_call_arguments.delta') {
          const id = msg.call_id;
          if (!pendingCalls.has(id)) pendingCalls.set(id, { name: msg.name || '', args_str: '' });
          pendingCalls.get(id).args_str += (msg.delta || '');
        }
        if (msg.type === 'response.function_call_arguments.done') {
          const id = msg.call_id;
          const entry = pendingCalls.get(id) || { name: msg.name, args_str: msg.arguments || '{}' };
          const name = entry.name || msg.name;
          let args = {};
          try { args = JSON.parse(entry.args_str || msg.arguments || '{}'); } catch {}
          pendingCalls.delete(id);

          toolCalls.push({ name, args });
          const result = await executeTool(name, args, testId);
          if ((name === 'crea_prenotazione' || name === 'richiedi_evento') && (result?.creata || result?.registrata || result?.eventId)) {
            artifacts.push({
              eventId: result.eventId,
              nome: args.nome, data: args.data, ora: args.ora,
            });
          }
          events.push({ type: 'tool', name, args, result });

          send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: id, output: JSON.stringify(result) } });
          send({ type: 'response.create' });
          // Reset: aspettiamo il response.created per la NUOVA response
          responseStarted = false;
        }

        if (msg.type === 'response.done') {
          // Ignora response.done che arrivano PRIMA di response.created (race).
          // Sono del turno precedente ancora in coda.
          if (!responseStarted) return;

          if (currentResponseText.trim()) { aiReplies.push(currentResponseText.trim()); events.push({ type: 'ai', text: currentResponseText.trim() }); }
          const hadFunctionCall = (msg.response?.output || []).some(o => o.type === 'function_call');
          if (!hadFunctionCall && pendingCalls.size === 0) {
            clearTimeout(to); ws.off('message', handler); resolve();
          } else {
            currentResponseText = '';
            // Se c'era function_call, aspetteremo un nuovo response.created
            // (già gestito nel branch function_call_arguments.done sopra)
          }
        }

        if (msg.type === 'error') { clearTimeout(to); ws.off('message', handler); reject(new Error(`realtime error: ${JSON.stringify(msg.error || msg)}`)); }
      };
      ws.on('message', handler);
    });
  }

  try { ws.close(1000); } catch {}
  return { toolCalls, aiReplies, artifacts, events };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ASSERTIONS (identiche a runner-b.cjs)
// ═══════════════════════════════════════════════════════════════════════════════
function assertToolCalls(actual, spec) {
  const errors = [];
  for (const expected of spec.expectedToolCalls || []) {
    const found = actual.toolCalls.find(tc =>
      tc.name === expected.name &&
      (!expected.argsContain || Object.entries(expected.argsContain).every(([k, v]) => tc.args[k] === v))
    );
    if (!found) errors.push(`expected tool call '${expected.name}'${expected.argsContain ? ` with args ${JSON.stringify(expected.argsContain)}` : ''} not found. Actual: ${JSON.stringify(actual.toolCalls)}`);
  }
  for (const forbidden of spec.forbiddenToolCalls || []) {
    if (actual.toolCalls.find(tc => tc.name === forbidden)) errors.push(`forbidden tool call '${forbidden}' was made`);
  }
  return errors;
}

function assertReplyPatterns(actual, spec) {
  const errors = [];
  const fullText = actual.aiReplies.join(' ');
  const lower = fullText.toLowerCase();

  // v.5: replyMustContain può essere:
  //   - array di stringhe (backward-compatible): AND, tutte devono matchare
  //   - oggetto {any_of:[...]}: OR, almeno una deve matchare
  //   - oggetto {all_of:[...]}: AND esplicito
  const mustContain = spec.replyMustContain;
  if (mustContain) {
    if (Array.isArray(mustContain)) {
      // Backward compat: AND
      for (const pat of mustContain) {
        if (!lower.includes(pat.toLowerCase())) errors.push(`reply must contain '${pat}' — got: ${fullText.substring(0, 200)}`);
      }
    } else if (mustContain.any_of && Array.isArray(mustContain.any_of)) {
      const matched = mustContain.any_of.some(pat => lower.includes(pat.toLowerCase()));
      if (!matched) errors.push(`reply must contain any of [${mustContain.any_of.join(', ')}] — got: ${fullText.substring(0, 200)}`);
    } else if (mustContain.all_of && Array.isArray(mustContain.all_of)) {
      for (const pat of mustContain.all_of) {
        if (!lower.includes(pat.toLowerCase())) errors.push(`reply must contain '${pat}' — got: ${fullText.substring(0, 200)}`);
      }
    }
  }

  for (const pat of spec.replyMustNotContain || []) {
    if (lower.includes(pat.toLowerCase())) errors.push(`reply must NOT contain '${pat}' — got: ${fullText.substring(0, 200)}`);
  }
  return errors;
}

// ═══════════════════════════════════════════════════════════════════════════════
// LANGUAGE ANALYSIS — v.5 categorizzata (multilingua compliance)
// ═══════════════════════════════════════════════════════════════════════════════
// Restituisce diagnosi granulare invece di solo pass/fail:
//   - pass                    → tutto ok
//   - disclosure_l2_missing   → Phase 2 non contiene identity in target lang (AI Act)
//   - italian_leak_recap      → Phase 2 in lang ma recap/finale in italiano
//   - italian_leak_complete   → Nessuno switch di lingua, tutto in italiano
//   - pattern_last_reply      → Last reply non nella lingua target (fallback backward-compat)
// ═══════════════════════════════════════════════════════════════════════════════

// Keywords disclosure Phase 2 per ogni lingua (multiple varianti accettate)
const DISCLOSURE_L2_KEYWORDS = {
  en: ['voice assistant', 'voice ai', 'ai voice', 'automated voice', 'ai assistant'],
  fr: ['assistant vocal', 'assistante vocale', 'assistant ia', 'assistant automatique'],
  de: ['sprachassistent', 'sprach-ki', 'sprachassistentin', 'sprachbot', 'ki-assistent'],
  es: ['asistente vocal', 'asistente de voz', 'asistente virtual', 'asistente automático', 'asistente automática', 'asistente de ia'],
  pt: ['assistente de voz', 'assistente vocal', 'assistente virtual', 'assistente automático', 'assistente automática', 'assistente de ia'],
  nl: ['spraakassistent', 'stemassistent', 'stem-assistent', 'voice assistant'],
  pl: ['asystent', 'asystentem', 'głosow'],
  ru: ['голосов', 'ассистент', 'ai-ассистент'],
  ja: ['アシスタント', 'ボイス', '音声'],
  zh: ['语音助手', '语音助理', '智能助手', '自动'],
  ar: ['المساعد', 'الصوتي', 'مساعد'],
};

const LANG_MARKERS = {
  it: /\b(sono|prenotazione|grazie|salve|buongiorno|perfetto|un attimo|certo|va bene|sabato|domenica|lunedì|martedì|mercoledì|giovedì|venerdì|persone|tavolo|conferm[oa]|prenotato|creato il|voi)\b/,
  en: /\b(hello|hi|thank|reservation|booking|booked|please|sure|one moment|great|confirmed|would you|table|people|saturday|sunday|monday|tuesday|wednesday|thursday|friday|january|february|march|april|june|july|august|september|october|november|december|lunch|dinner|breakfast|for|at)\b/,
  fr: /\b(bonjour|réservation|merci|s'il vous plaît|parfait|un instant|bien sûr|samedi|dimanche|lundi|mardi|mercredi|jeudi|vendredi|personnes|table|réservé|confirmé|c'est|voici|noté)\b/,
  de: /\b(hallo|reservierung|danke|bitte|einen moment|natürlich|perfekt|samstag|sonntag|montag|dienstag|mittwoch|donnerstag|freitag|personen|tisch|reserviert|alles|klar|möchten|ich|sie|habe|notiert|hinzufügen|fertig|gerne|bestätigt|verfügbar|ihre)\b/,
  es: /\b(hola|reserva|gracias|por favor|un momento|perfecto|claro|sábado|domingo|lunes|martes|miércoles|jueves|viernes|personas|mesa|reservado|bien|puedes|quieres|confirmar|ajustar|listo|para|reservada|nos vemos|comprobar)\b/,
  pt: /\b(olá|obrigado|obrigada|reserva|confirmação|sábado|domingo|segunda|terça|quarta|quinta|sexta|pessoas|mesa|reservado|reservada|por favor|bom dia|boa noite|boa tarde|sim|não|assistente)\b/,
  nl: /\b(hallo|dank|reservering|bevestiging|zaterdag|zondag|maandag|dinsdag|woensdag|donderdag|vrijdag|personen|tafel|gereserveerd|goedendag|goedenavond|graag|natuurlijk|voor|op naam)\b/,
  pl: /\b(dzień dobry|dobry wieczór|rezerwacja|dziękuję|proszę|potwierdzam|w porządku|sobota|niedziela|poniedziałek|wtorek|środa|czwartek|piątek|osoby|osób|stolik|zarezerwowane)\b/,
  ru: /\b(здравствуйте|привет|бронирование|спасибо|пожалуйста|подтверждаю|хорошо|суббота|воскресенье|понедельник|вторник|среда|четверг|пятница|человек|стол|забронирован)\b/,
  ja: /(こんにちは|予約|ありがとう|よろしく|承知|確認|土曜|日曜|月曜|火曜|水曜|木曜|金曜|人|テーブル|時)/,
  zh: /(你好|预订|谢谢|请|确认|好的|周六|周日|周一|周二|周三|周四|周五|人|桌|点)/,
  ar: /(مرحبا|حجز|شكرا|من فضلك|تأكيد|السبت|الأحد|الاثنين|الثلاثاء|الأربعاء|الخميس|الجمعة|أشخاص|طاولة)/,
};

/**
 * Analizza compliance linguistica di una conversazione multilingua.
 * @returns {object} { status, category, reason, details }
 *   status: 'pass' | 'fail'
 *   category: 'pass' | 'disclosure_l2_missing' | 'italian_leak_recap' | 'italian_leak_complete' | 'pattern_last_reply' | 'na'
 */
function analyzeLanguage(actual, spec) {
  if (!spec.replyLanguage) return { status: 'pass', category: 'na' };

  const targetLang = spec.replyLanguage;
  const targetRx = LANG_MARKERS[targetLang];

  // Se non ho marker per la lingua, skip (safe default)
  if (!targetRx) return { status: 'pass', category: 'na', details: `no markers for '${targetLang}'` };

  // Italiano richiesto: check last reply solo
  if (targetLang === 'it') {
    const last = (actual.aiReplies[actual.aiReplies.length - 1] || '').toLowerCase();
    if (!targetRx.test(last)) {
      return { status: 'fail', category: 'pattern_last_reply',
        reason: `last reply not in 'it': ${last.substring(0, 150)}` };
    }
    return { status: 'pass', category: 'pass' };
  }

  // Lingua NON italiana: analisi granulare
  const replies = actual.aiReplies || [];
  // Phase 1 = primo reply (sempre italiano per design v7.4.40+)
  // Phase 2 = da secondo reply in poi
  const phase2Replies = replies.slice(1);
  const phase2Text = phase2Replies.join(' ').toLowerCase();

  // Check 1: disclosure L2 presente in Phase 2?
  const disclKeywords = DISCLOSURE_L2_KEYWORDS[targetLang] || [];
  const hasDisclosureL2 = disclKeywords.some(kw => phase2Text.includes(kw.toLowerCase()));

  // Check 2: quanto italian leak in Phase 2?
  const italianMatches = (phase2Text.match(LANG_MARKERS.it) || []).length;
  const targetMatches = (phase2Text.match(targetRx) || []).length;

  // Check 3: la lingua target appare mai in Phase 2?
  const hasTargetLang = targetRx.test(phase2Text);

  // Categorizzazione (ordine di priorità: più grave prima)
  if (!hasTargetLang && italianMatches >= 3) {
    return {
      status: 'fail', category: 'italian_leak_complete',
      reason: `Italian leak COMPLETO — target '${targetLang}' mai attivato in Phase 2 (${italianMatches} italian markers)`,
      details: { has_disclosure_l2: false, italian_markers: italianMatches, target_markers: 0 }
    };
  }

  if (!hasDisclosureL2) {
    return {
      status: 'fail', category: 'disclosure_l2_missing',
      reason: `Disclosure Phase 2 SALTATA — no '${targetLang}' identity keywords (AI Act)`,
      details: { has_disclosure_l2: false, italian_markers: italianMatches, target_markers: targetMatches }
    };
  }

  // Ha disclosure + lingua target attiva → check italian leak nel recap/finale
  if (italianMatches >= 2 && targetMatches >= 2) {
    return {
      status: 'fail', category: 'italian_leak_recap',
      reason: `Italian leak nel recap/finale — target '${targetLang}' presente ma anche italiano (it:${italianMatches}, ${targetLang}:${targetMatches})`,
      details: { has_disclosure_l2: true, italian_markers: italianMatches, target_markers: targetMatches }
    };
  }

  return { status: 'pass', category: 'pass',
    details: { has_disclosure_l2: true, italian_markers: italianMatches, target_markers: targetMatches } };
}

// Backward-compat: funzione originale ora wraps analyzeLanguage
function assertLanguage(actual, spec) {
  const result = analyzeLanguage(actual, spec);
  if (result.status === 'pass') return [];
  return [result.reason];
}

// ═══════════════════════════════════════════════════════════════════════════════
// RUN SINGLE TEST
// ═══════════════════════════════════════════════════════════════════════════════
async function runTest(test, systemPromptTemplate) {
  const startedAt = Date.now();
  const systemPrompt = fillPromptPlaceholders(systemPromptTemplate, test.context || {});
  let status = 'passed';
  let failReason = null;
  let convo = { toolCalls: [], aiReplies: [], artifacts: [], events: [] };
  let checks = {
    functional: { status: 'pass', errors: [] },
    reply_pattern: { status: 'pass', errors: [] },
    language: { status: 'pass', category: 'na' },
  };

  try {
    convo = await runConversation(systemPrompt, test.userTurns || [], test.id);

    // Check 1: Functional (tool calls + forbidden)
    const toolErrors = assertToolCalls(convo, test);
    if (toolErrors.length > 0) checks.functional = { status: 'fail', errors: toolErrors };

    // Check 2: Reply patterns
    const patternErrors = assertReplyPatterns(convo, test);
    if (patternErrors.length > 0) checks.reply_pattern = { status: 'fail', errors: patternErrors };

    // Check 3: Language (categorizzato)
    checks.language = analyzeLanguage(convo, test);

    // Overall: pass solo se TUTTI i check passano
    const allErrors = [
      ...checks.functional.errors,
      ...checks.reply_pattern.errors,
      ...(checks.language.status === 'fail' ? [checks.language.reason] : []),
    ];
    if (allErrors.length > 0) { status = 'failed'; failReason = allErrors.join(' | '); }
  } catch (e) {
    status = 'failed';
    failReason = `exception: ${e?.message || e}`;
    checks.functional = { status: 'fail', errors: [failReason] };
  }

  return {
    id: test.id,
    category: test.category,
    description: test.description,
    status,
    failReason,
    checks,     // v.5: dettaglio per categoria
    duration: Date.now() - startedAt,
    toolCalls: convo.toolCalls,
    aiReplies: convo.aiReplies,
    userTurns: test.userTurns || [],
    events: convo.events || [],
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLEANUP - cancella tutte le prenotazioni di test (marker nelle notes)
// ═══════════════════════════════════════════════════════════════════════════════
async function cleanupTestReservations() {
  try {
    const result = await query(
      `DELETE FROM reservations 
        WHERE tenant_id = $1 
          AND notes LIKE '%TEST_RUNNER_B_%'
        RETURNING id`,
      [TEST_TENANT.id]
    );
    return result.rows.length;
  } catch (err) {
    console.error(`⚠️  Cleanup error: ${err.message}`);
    return -1;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// REPORT WRITERS (identici a runner-b.cjs)
// ═══════════════════════════════════════════════════════════════════════════════
function summarizeToolResult(name, result) {
  if (!result) return '(no result)';
  if (result.error) return `❌ error: ${result.error}`;
  if (name === 'controlla_disponibilita') {
    return result.esito || (result.libero ? 'libero' : 'unknown');
  }
  if (name === 'crea_prenotazione') {
    return result.eventId ? `✅ creata (eventId: ${String(result.eventId).substring(0, 20)}...)` : `creata=${result.creata}`;
  }
  if (name === 'trova_prenotazione') return result.trovata ? `✅ trovata` : '❌ non trovata';
  if (name === 'modifica_prenotazione') return result.aggiornata ? '✅ ok' : `❌ ${result.motivo || 'failed'}`;
  if (name === 'cancella_prenotazione') return result.cancellata ? '✅ cancellata' : `❌ ${result.motivo || 'failed'}`;
  if (name === 'richiedi_evento') return result.registrata ? '✅ evento registrato' : `❌ ${result.motivo || 'failed'}`;
  if (name === 'info_locale') return `tipo=${result.tipo || 'info'}`;
  return JSON.stringify(result).substring(0, 100);
}

function writeConversationsLog(results, outputPath) {
  const passed = results.filter(r => r.status === 'passed').length;
  const failed = results.filter(r => r.status !== 'passed');
  const totalDuration = results.reduce((s, r) => s + r.duration, 0);
  const byCategory = {};
  for (const r of results) {
    if (!byCategory[r.category]) byCategory[r.category] = { total: 0, passed: 0 };
    byCategory[r.category].total++;
    if (r.status === 'passed') byCategory[r.category].passed++;
  }

  // v.5: raggruppa fail per tipologia di check
  const failBreakdown = {
    functional: [],           // tool call missing / forbidden triggered / exception
    reply_pattern: [],        // replyMustContain non trovato
    disclosure_l2_missing: [],// AI Act violation
    italian_leak_complete: [],// grave: mai switcha
    italian_leak_recap: [],   // medio: switcha ma recap italiano
    pattern_last_reply: [],   // last reply non nella lingua (backward-compat)
  };
  for (const r of failed) {
    if (!r.checks) { failBreakdown.functional.push(r.id); continue; }
    if (r.checks.functional?.status === 'fail') failBreakdown.functional.push(r.id);
    if (r.checks.reply_pattern?.status === 'fail') failBreakdown.reply_pattern.push(r.id);
    const langCat = r.checks.language?.category;
    if (langCat && failBreakdown[langCat]) failBreakdown[langCat].push(r.id);
  }

  let md = `# Test Conversations (Render/Neon) — Run ${new Date().toISOString().substring(0, 16).replace('T', ' ')}\n\n`;
  md += `**Backend**: Postgres Neon (via ESM tool wrappers) | **Model**: ${MODEL}\n`;
  md += `**Total**: ${results.length} | **Passed**: ${passed} (${Math.round(passed / results.length * 100 || 0)}%) | **Failed**: ${failed.length} | **Duration**: ${(totalDuration / 1000).toFixed(1)}s\n\n`;

  if (failed.length > 0) {
    md += `## ❌ Failed tests (${failed.length})\n\n`;
    for (const r of failed) md += `- ${r.id} ${r.category} — ${r.failReason || '(no reason)'}\n`;
    md += '\n';

    // v.5: breakdown per categoria di failure
    const hasAnyLangFail = failBreakdown.disclosure_l2_missing.length + failBreakdown.italian_leak_complete.length +
                          failBreakdown.italian_leak_recap.length + failBreakdown.pattern_last_reply.length > 0;
    const hasBreakdown = failBreakdown.functional.length + failBreakdown.reply_pattern.length > 0 || hasAnyLangFail;
    if (hasBreakdown) {
      md += `## Failures breakdown (by check category)\n\n`;
      const label = {
        functional: '🔧 Functional (tool call missing / forbidden triggered / exception)',
        reply_pattern: '📝 Reply pattern (replyMustContain / MustNotContain)',
        disclosure_l2_missing: '🚨 Disclosure Phase 2 SALTATA — **AI Act violation**',
        italian_leak_complete: '🔥 Italian leak COMPLETO — modello mai switcha lingua (grave)',
        italian_leak_recap: '⚠️  Italian leak nel recap/finale (medio)',
        pattern_last_reply: '🗣  Last reply non nella lingua target (backward-compat)',
      };
      for (const [key, ids] of Object.entries(failBreakdown)) {
        if (ids.length === 0) continue;
        md += `- **${label[key]}**: ${ids.length} test\n`;
        md += `  ${ids.join(', ')}\n`;
      }
      md += '\n';
    }
  }

  md += `## By category\n\n`;
  for (const [cat, s] of Object.entries(byCategory).sort()) md += `- \`${cat}\`: ${s.passed}/${s.total} pass\n`;
  md += `\n---\n\n`;

  for (const r of results) {
    const icon = r.status === 'passed' ? '✅' : '❌';
    md += `## ${r.id} ${icon} ${r.category} — ${r.description} (${(r.duration / 1000).toFixed(1)}s)\n\n`;
    if (r.status !== 'passed') {
      md += `> ⚠️ **Failed**: ${r.failReason}\n\n`;
      // v.5: aggiungi tag categoria language se failed language check
      if (r.checks?.language?.status === 'fail') {
        md += `> 🏷️  **Language check**: \`${r.checks.language.category}\`\n\n`;
      }
    }

    for (const ev of r.events || []) {
      if (ev.type === 'user') md += `**[Cliente]**: ${ev.text}\n\n`;
      else if (ev.type === 'ai') md += `**[Giulia]**: ${ev.text}\n\n`;
      else if (ev.type === 'tool') {
        const argsStr = Object.entries(ev.args || {}).map(([k, v]) => `${k}=${typeof v === 'string' ? `"${v}"` : v}`).join(', ');
        md += `→ 🔧 \`${ev.name}(${argsStr})\` → ${summarizeToolResult(ev.name, ev.result)}\n\n`;
      }
    }
    md += `---\n\n`;
  }

  fs.writeFileSync(outputPath, md);
  fs.writeFileSync(path.join(REPORTS_DIR, 'latest-conversations.md'), md);
}

// ═══════════════════════════════════════════════════════════════════════════════
// BATCH FILTER (identico a runner-b.cjs)
// ═══════════════════════════════════════════════════════════════════════════════
function fileMatchesFilter(filename, filter) {
  if (!filter || filter === 'all' || filter === '') return true;
  const m = filename.match(/^b-0*(\d+)-/i);
  if (!m) return false;
  const batchNum = parseInt(m[1], 10);
  const parts = filter.split(',').map(s => s.trim());
  for (const part of parts) {
    const rangeMatch = part.match(/^B?0*(\d+)\s*-\s*B?0*(\d+)$/i);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end   = parseInt(rangeMatch[2], 10);
      if (batchNum >= Math.min(start, end) && batchNum <= Math.max(start, end)) return true;
      continue;
    }
    const singleMatch = part.match(/^B?0*(\d+)$/i);
    if (singleMatch && batchNum === parseInt(singleMatch[1], 10)) return true;
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLI ARGS PARSER
// ═══════════════════════════════════════════════════════════════════════════════
function parseCliArgs() {
  const args = process.argv.slice(2);
  const flags = { batch: 'all', list: false, cleanupOnly: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--batch' && args[i+1]) { flags.batch = args[i+1]; i++; }
    else if (args[i] === '--list') flags.list = true;
    else if (args[i] === '--cleanup-only') flags.cleanupOnly = true;
    else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
Runner B (ESM/Neon)

USAGE:
  node runner-b.mjs [--batch <filter>] [--list] [--cleanup-only]

OPTIONS:
  --batch <filter>   Batch filter (default: all)
                     Examples: B02, B02,B04, B01-B05, all
  --list             List available batches and exit
  --cleanup-only     Cleanup residual test data only (no test run)
  --help, -h         Show this help

ENVIRONMENT:
  OPENAI_API_KEY               (required)
  DATABASE_URL                 (required, Neon Postgres)
  UPSTASH_REDIS_REST_URL/TOKEN (required, cache)
  TEST_TENANT_PHONE            (optional, default +390299223311)
`);
      process.exit(0);
    }
  }
  return flags;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════
async function main() {
  const flags = parseCliArgs();

  console.log('▶ Runner B — Render Shell / Neon Postgres backend');
  console.log(`  Model: ${MODEL}`);
  console.log(`  Tenant: ${TENANT_PHONE}`);
  console.log(`  Run ID: ${RUN_ID}`);

  // ─── Carico tenant di test dal DB ──────────────────────────────────────────
  invalidateTenantCache?.(TENANT_PHONE);
  TEST_TENANT = await getTenantByPhone(TENANT_PHONE);
  if (!TEST_TENANT) {
    console.error(`❌ Tenant non trovato per phone ${TENANT_PHONE}. Verifica DATABASE_URL e tabella tenants.`);
    process.exit(1);
  }
  console.log(`  Tenant name: "${TEST_TENANT.restaurantName || TEST_TENANT.restaurant_name || '?'}"`);
  console.log(`  Tenant id: ${TEST_TENANT.id}`);

  // ─── Cleanup residui pre-run (in caso di crash precedente) ────────────────
  const preCleanup = await cleanupTestReservations();
  if (preCleanup > 0) console.log(`  🧹 Pre-cleanup: rimossi ${preCleanup} test residui`);

  if (flags.cleanupOnly) {
    console.log(`\n✅ Cleanup completato (${preCleanup} righe rimosse). Exit.`);
    process.exit(0);
  }

  // ─── Prompt template ───────────────────────────────────────────────────────
  const systemPromptTemplate = loadSystemPromptTemplate();
  console.log(`  System prompt: ${systemPromptTemplate.length} chars loaded`);

  // ─── Filtro batch ──────────────────────────────────────────────────────────
  const allFiles = fs.readdirSync(DATA_DIR).filter(f => f.startsWith('b-') && f.endsWith('.json')).sort();

  if (flags.list) {
    console.log(`\n📋 Batch disponibili:\n`);
    for (const f of allFiles) {
      const arr = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf-8'));
      console.log(`  ${f} — ${arr.length} test`);
    }
    process.exit(0);
  }

  const files = allFiles.filter(f => fileMatchesFilter(f, flags.batch));
  if (files.length === 0) {
    console.log(`\n⚠️  Nessun file matcha "${flags.batch}"`);
    console.log(`  Disponibili: ${allFiles.join(', ')}`);
    process.exit(1);
  }
  console.log(`  Filter "${flags.batch}" → ${files.length}/${allFiles.length} file: ${files.join(', ')}`);

  const allTests = [];
  for (const f of files) {
    const arr = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf-8'));
    for (const t of arr) allTests.push({ ...t, _sourceFile: f });
  }
  console.log(`  ${allTests.length} tests found\n`);

  // ─── Run ───────────────────────────────────────────────────────────────────
  const results = [];
  // v7.7.5-runner: delay tra test per evitare TPM throttling di OpenAI Realtime.
  // Con prompt di ~23K chars a test, dopo 8-9 test consecutivi il modello
  // inizia a rispondere con response.done vuoto (senza tool call) — sintomo
  // di soft-throttling TPM. Un delay di 3s tra test riduce la pressione.
  // Configurabile via env INTER_TEST_DELAY_MS (default 3000).
  const INTER_TEST_DELAY_MS = Number(process.env.INTER_TEST_DELAY_MS ?? 3000);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  for (let i = 0; i < allTests.length; i++) {
    const t = allTests[i];
    process.stdout.write(`  [${String(i + 1).padStart(3, '0')}/${allTests.length}] ${t.id} ${t.category}... `);
    const r = await runTest(t, systemPromptTemplate);
    results.push(r);
    console.log(r.status === 'passed' ? `✓ ${r.duration}ms` : `✗ ${r.duration}ms`);

    // v7.7.5-runner-v3: cleanup DOPO OGNI TEST invece che a fine batch.
    // Prima: tutte le prenotazioni di test si accumulavano in un solo slot
    // (es. venerdì 21:00) → dopo ~15 test slot_full → tutti i test successivi
    // fallivano falsamente.
    // Ora ogni test parte da DB pulito. Overhead trascurabile (~50ms/test).
    await cleanupTestReservations();

    // Delay prima del prossimo test (non dopo l'ultimo)
    if (i < allTests.length - 1 && INTER_TEST_DELAY_MS > 0) {
      await sleep(INTER_TEST_DELAY_MS);
    }
  }

  // ─── Cleanup post-run ──────────────────────────────────────────────────────
  const postCleanup = await cleanupTestReservations();
  console.log(`\n  🧹 Cleanup: rimossi ${postCleanup} test`);

  // ─── Report ────────────────────────────────────────────────────────────────
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const outputPath = path.join(REPORTS_DIR, `render-${RUN_ID}.md`);
  writeConversationsLog(results, outputPath);

  const passed = results.filter(r => r.status === 'passed').length;
  const failed = results.length - passed;
  console.log(`\n▶ Runner B (Neon) finito: ${passed}/${results.length} passati, ${failed} falliti`);
  console.log(`  Report: ${outputPath}`);
  console.log(`  Report (alias): ${path.join(REPORTS_DIR, 'latest-conversations.md')}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  // Prova comunque cleanup
  if (TEST_TENANT) cleanupTestReservations().finally(() => process.exit(1));
  else process.exit(1);
});
