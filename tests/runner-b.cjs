// tests/runner-b.js — Runner Livello B (integration test via Realtime API text-only)
//
// Apre WebSocket verso gpt-realtime-2.1-mini con output_modalities:['text'] e
// simula conversazioni via conversation.item.create (input_text). Testa
// esattamente lo stesso modello di produzione con lo stesso system prompt e
// gli stessi tool. Sacrifica solo la componente audio (Whisper input, TTS
// output) che è ortogonale ai bug del modello.

const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { callAppsScript, safeCancel } = require('./utils.cjs');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY env var mancante');

const DATA_DIR = path.join(__dirname, 'data');
const REPORTS_DIR = path.join(__dirname, 'reports');
const BATCH_SIZE = 50;
const MODEL = process.env.TEST_MODEL || 'gpt-realtime-2.1-mini';
const REALTIME_URL = `wss://api.openai.com/v1/realtime?model=${MODEL}`;
const TURN_TIMEOUT_MS = 45000;

// ─────────────────────────────────────────────────────────────────────────────
// TOOL SCHEMA (identico a quello del gateway di produzione)
// ─────────────────────────────────────────────────────────────────────────────

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
    parameters: { type:'object', properties: {} } },
  { type: 'function', name: 'trasferisci_al_ristorante', description: 'Transfer call to restaurant.',
    parameters: { type:'object', properties: { motivo:{type:'string'} }, required:['motivo'] } },
];

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPT LOADER
// ─────────────────────────────────────────────────────────────────────────────

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
    .replace(/\{\{RESTAURANT_NAME\}\}/g, context.restaurantName || 'Osteria Test')
    .replace(/\{\{TODAY_HUMAN\}\}/g, todayHuman)
    .replace(/\{\{TODAY_ISO\}\}/g, todayIso)
    .replace(/\{\{CALLER_PHONE\}\}/g, context.callerPhone || '+390000000000')
    .replace(/\{\{WEEKLY_SCHEDULE\}\}/g, context.weeklySchedule || '# Weekly Schedule\n- Lunedì: closed\n- Tuesday-Sunday: lunch 12:00-14:30, dinner 19:00-22:30');
}

// ─────────────────────────────────────────────────────────────────────────────
// TOOL DISPATCHER (usa Apps Script reale del ristorante di test)
// ─────────────────────────────────────────────────────────────────────────────

async function executeTool(name, args) {
  switch (name) {
    case 'controlla_disponibilita': return callAppsScript({ action: 'check_availability', ...args });
    case 'crea_prenotazione':       return callAppsScript({ source: 'test-b', forceNew: true, ...args });
    case 'trova_prenotazione':      return callAppsScript({ action: 'find_reservation', ...args });
    case 'modifica_prenotazione':   return callAppsScript({ action: 'update_reservation', ...args });
    case 'cancella_prenotazione':   return callAppsScript({ action: 'cancel_reservation', ...args });
    case 'richiedi_evento':         return callAppsScript({ action: 'request_event', ...args });
    case 'info_locale':             return callAppsScript({ action: 'get_restaurant_info' });
    case 'trasferisci_al_ristorante': return { trasferita: true, istruzione: 'transfer stubbed for tests' };
    default: return { errore: `unknown tool: ${name}` };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LANGUAGE DETECTION + DISCLOSURE INJECTION (mirrors gateway v7.4.33)
// ─────────────────────────────────────────────────────────────────────────────

async function detectLanguageWithLLM(text) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a language detector. Reply with ONLY the ISO 639-1 code (2 lowercase letters) of the language of the user text. Examples: it, en, fr, de, es, pt, nl, ru, zh, ja, ar, ko. No explanation, no punctuation, no quotes. Just 2 letters.',
          },
          { role: 'user', content: text },
        ],
        max_tokens: 5,
        temperature: 0,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const raw = (data.choices?.[0]?.message?.content || '').trim().toLowerCase();
    const lang = raw.match(/^[a-z]{2}/)?.[0];
    if (lang) {
      console.log(`  🌍 LLM detected: ${lang} (for "${text.substring(0, 40)}...")`);
      return lang;
    }
    // Se LLM ritorna qualcosa di strano, usa regex fallback
    console.warn(`  ⚠️  LLM returned unexpected: "${raw}", using regex fallback`);
    return detectLanguageRegexFallback(text);
  } catch (e) {
    console.warn(`  ⚠️  LLM detection failed (${e.message}), using regex fallback`);
    return detectLanguageRegexFallback(text);
  }
}

function detectLanguageRegexFallback(text) {
  const t = (text || '').toLowerCase();
  if (/¿|¡/.test(t)) return 'es';
  if (/\b(hola|hablas|español|quisiera|reservar|gracias|buenos días|buenas noches|buenas tardes)\b/i.test(t)) return 'es';
  if (/\b(bonjour|bonsoir|je voudrais|réserver|merci|français|voudrais)\b/i.test(t)) return 'fr';
  if (/\b(guten tag|guten abend|ich möchte|reservieren|deutsch|bitte|danke)\b/i.test(t)) return 'de';
  if (/\b(bom dia|boa noite|boa tarde|gostaria|obrigado|obrigada|reservar)\b/i.test(t)) return 'pt';
  if (/\b(goedendag|goedenavond|goedemorgen|reserveren|graag|dank)\b/i.test(t)) return 'nl';
  if (/\b(hello|good morning|good evening|good afternoon|i would like|i'd like|book a table|thanks|do you speak|hi\b)\b/i.test(t)) return 'en';
  return 'it';
}

function buildDisclosureText(lang, restaurantName = 'the restaurant') {
  const disclosures = {
    en: `Sure, we can continue in English. I'm the automated voice assistant of ${restaurantName}.`,
    fr: `Bien sûr, nous pouvons continuer en français. Je suis l'assistant vocal automatique de ${restaurantName}.`,
    de: `Natürlich, wir können auf Deutsch weitermachen. Ich bin der automatische Sprachassistent von ${restaurantName}.`,
    es: `Por supuesto, podemos continuar en español. Soy el asistente vocal automático de ${restaurantName}.`,
    pt: `Claro, podemos continuar em português. Sou o assistente vocal automático de ${restaurantName}.`,
    nl: `Zeker, we kunnen doorgaan in het Nederlands. Ik ben de geautomatiseerde stemassistent van ${restaurantName}.`,
  };
  return disclosures[lang] || disclosures.en;
}

// ─────────────────────────────────────────────────────────────────────────────
// WEBSOCKET CONVERSATION RUNNER
// ─────────────────────────────────────────────────────────────────────────────

function connectRealtime() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(REALTIME_URL, {
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

async function runConversation(systemPrompt, userTurns) {
  const ws = await connectRealtime();
  const toolCalls = [];
  const aiReplies = [];
  const artifacts = [];
  const events = []; // v2: eventi cronologici (user/ai/tool) per log conversazione
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
        clearTimeout(to);
        ws.off('message', handler);
        resolve();
      } else if (msg.type === 'error') {
        clearTimeout(to);
        ws.off('message', handler);
        reject(new Error(`session setup error: ${JSON.stringify(msg.error || msg)}`));
      }
    };
    ws.on('message', handler);
  });

  // v3: L'AI parla per prima come in produzione (opening line automatica).
  // Invio response.create senza user turn e attendo che il modello finisca
  // l'apertura prima di iniziare la conversazione vera e propria.
  send({ type: 'response.create' });
  await new Promise((resolve, reject) => {
    const to = setTimeout(() => {
      ws.off('message', handler);
      reject(new Error(`opening response timeout`));
    }, 15000);
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
        if (openingText.trim()) {
          aiReplies.push(openingText.trim());
          events.push({ type: 'ai', text: openingText.trim() });
        }
        clearTimeout(to);
        ws.off('message', handler);
        resolve();
      }
      if (msg.type === 'error') {
        clearTimeout(to);
        ws.off('message', handler);
        reject(new Error(`opening error: ${JSON.stringify(msg.error || msg)}`));
      }
    };
    ws.on('message', handler);
  });

  // Loop principale: per ogni user turn invio input_text + response.create,
  // aspetto response.done gestendo function calls in mezzo.
  let firstUserTurnHandled = false;
  for (const userText of userTurns) {
    events.push({ type: 'user', text: userText });
    send({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: userText }],
      },
    });

    // v3 — EU AI Act disclosure injection (mirrors gateway v7.4.33)
    // On the first substantive user turn, detect language via LLM.
    // If non-Italian, force disclosure via response.create with explicit instructions
    // BEFORE the actual reply, exactly like the production gateway does.
    if (!firstUserTurnHandled) {
      firstUserTurnHandled = true;
      const detectedLang = await detectLanguageWithLLM(userText);
      if (detectedLang !== 'it') {
        const disclosureText = buildDisclosureText(detectedLang, 'Osteria Test');
        console.log(`  ⚖️  Forcing ${detectedLang.toUpperCase()} disclosure injection`);
        // v4 — Una SOLA response.create con instructions combinate:
        // il modello deve iniziare con la disclosure e POI procedere normalmente
        // (incluso chiamare tools). Questo evita che la disclosure force "blocchi"
        // il flusso normale del modello (bug osservato in v3 con 2 response separate).
        send({
          type: 'response.create',
          response: {
            instructions: `Your reply MUST begin verbatim with this exact sentence: "${disclosureText}" — do NOT paraphrase, do NOT shorten this sentence, do NOT omit it. After you finish this sentence, continue naturally by responding to the caller's request following your normal system prompt: if you need to check availability or create a booking, call the appropriate tool. Reply in ${detectedLang.toUpperCase()}.`,
          },
        });
      } else {
        send({ type: 'response.create' });
      }
    } else {
      send({ type: 'response.create' });
    }

    await new Promise((resolve, reject) => {
      const to = setTimeout(() => {
        ws.off('message', handler);
        reject(new Error(`turn timeout after ${TURN_TIMEOUT_MS}ms (userText: ${userText.substring(0, 50)})`));
      }, TURN_TIMEOUT_MS);

      currentResponseText = '';

      const handler = async (raw) => {
        let msg; try { msg = JSON.parse(raw); } catch { return; }

        // Text output streaming (varie forme evento)
        if (msg.type === 'response.output_text.delta' && msg.delta) {
          currentResponseText += msg.delta;
        }
        if (msg.type === 'response.output_text.done' && msg.text) {
          currentResponseText = msg.text;
        }
        if (msg.type === 'response.text.delta' && msg.delta) {
          currentResponseText += msg.delta;
        }
        if (msg.type === 'response.text.done' && msg.text) {
          currentResponseText = msg.text;
        }
        if (msg.type === 'response.output_item.done' && msg.item?.content) {
          for (const c of msg.item.content) {
            if ((c.type === 'output_text' || c.type === 'text') && c.text) {
              currentResponseText = c.text;
            }
          }
        }

        // Function call: accumulo args e chiamo tool su done
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
          let result;
          try { result = await executeTool(name, args); }
          catch (e) { result = { error: e?.message || String(e) }; }
          if (name === 'crea_prenotazione' && result?.success) {
            artifacts.push({
              nome: args.nome,
              data: args.data,
              ora: args.ora,
              eventId: result.eventId,
            });
          }
          events.push({ type: 'tool', name, args, result });

          send({
            type: 'conversation.item.create',
            item: { type: 'function_call_output', call_id: id, output: JSON.stringify(result) },
          });
          send({ type: 'response.create' });
        }

        if (msg.type === 'response.done') {
          if (currentResponseText.trim()) {
            aiReplies.push(currentResponseText.trim());
            events.push({ type: 'ai', text: currentResponseText.trim() });
          }
          // Aspetto una response.done che sia effettivamente finale, cioè che
          // non contenga function_call. Se contiene function_call, un altro
          // response.create è già stato inviato — continuo ad ascoltare.
          const hadFunctionCall = (msg.response?.output || []).some(o => o.type === 'function_call');
          if (!hadFunctionCall && pendingCalls.size === 0) {
            clearTimeout(to);
            ws.off('message', handler);
            resolve();
          } else {
            // reset per la prossima response
            currentResponseText = '';
          }
        }

        if (msg.type === 'error') {
          clearTimeout(to);
          ws.off('message', handler);
          reject(new Error(`realtime error: ${JSON.stringify(msg.error || msg)}`));
        }
      };
      ws.on('message', handler);
    });
  }

  try { ws.close(1000); } catch {}
  return { toolCalls, aiReplies, artifacts, events };
}

// ─────────────────────────────────────────────────────────────────────────────
// ASSERTIONS
// ─────────────────────────────────────────────────────────────────────────────

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
  for (const pat of spec.replyMustContain || []) {
    if (!fullText.toLowerCase().includes(pat.toLowerCase())) errors.push(`reply must contain '${pat}' — got: ${fullText.substring(0, 200)}`);
  }
  for (const pat of spec.replyMustNotContain || []) {
    if (fullText.toLowerCase().includes(pat.toLowerCase())) errors.push(`reply must NOT contain '${pat}' — got: ${fullText.substring(0, 200)}`);
  }
  return errors;
}

function assertLanguage(actual, spec) {
  if (!spec.replyLanguage) return [];
  const markers = {
    it: /\b(sono|prenotazione|grazie|salve|buongiorno|perfetto|un attimo|certo|va bene|sabato|domenica|lunedì|martedì|mercoledì|giovedì|venerdì|persone|tavolo|conferm[oa]|prenotato|creato il|voi)\b/,
    en: /\b(hello|hi|thank|reservation|booking|booked|please|sure|one moment|great|confirmed|would you|table|people|saturday|sunday|monday|tuesday|wednesday|thursday|friday|january|february|march|april|june|july|august|september|october|november|december|lunch|dinner|breakfast|for|at)\b/,
    fr: /\b(bonjour|réservation|merci|s'il vous plaît|parfait|un instant|bien sûr|samedi|dimanche|lundi|mardi|mercredi|jeudi|vendredi|personnes|table|réservé|confirmé|c'est|voici|noté)\b/,
    de: /\b(hallo|reservierung|danke|bitte|einen moment|natürlich|perfekt|samstag|sonntag|montag|dienstag|mittwoch|donnerstag|freitag|personen|tisch|reserviert|alles|klar|möchten|ich|sie|habe|notiert|hinzufügen|fertig|gerne|bestätigt|verfügbar|ihre)\b/,
    es: /\b(hola|reserva|gracias|por favor|un momento|perfecto|claro|sábado|domingo|lunes|martes|miércoles|jueves|viernes|personas|mesa|reservado|bien|puedes|quieres|confirmar|ajustar|listo|para|reservada|nos vemos|comprobar)\b/,
    pt: /\b(olá|obrigado|obrigada|reserva|confirmação|sábado|domingo|segunda|terça|quarta|quinta|sexta|pessoas|mesa|reservado|reservada|por favor|bom dia|boa noite|boa tarde|sim|não|assistente)\b/,
    nl: /\b(hallo|dank|reservering|bevestiging|zaterdag|zondag|maandag|dinsdag|woensdag|donderdag|vrijdag|personen|tafel|gereserveerd|goedendag|goedenavond|graag|natuurlijk|voor|op naam)\b/,
  };
  const errors = [];
  const targetLang = spec.replyLanguage;
  const targetRx = markers[targetLang];
  if (!targetRx) return [];

  // Check last reply is in target language
  const last = (actual.aiReplies[actual.aiReplies.length - 1] || '').toLowerCase();
  if (!targetRx.test(last)) errors.push(`last reply not in '${targetLang}': ${last.substring(0, 150)}`);

  // NEW: For non-Italian target, check NO reply after the opening leaks Italian
  if (targetLang !== 'it') {
    // Skip the very first opening (index 0) which is the auto Italian disclosure
    for (let i = 1; i < actual.aiReplies.length; i++) {
      const reply = (actual.aiReplies[i] || '').toLowerCase();
      // Skip empty
      if (!reply.trim()) continue;
      // Check italian markers appear + target language does NOT appear
      const hasItal = markers.it.test(reply);
      const hasTarget = targetRx.test(reply);
      if (hasItal && !hasTarget) {
        errors.push(`italian leak in reply #${i}: ${reply.substring(0, 150)}`);
      }
    }
  }

  return errors;
}

// ─────────────────────────────────────────────────────────────────────────────
// RUN SINGLE TEST + MAIN + REPORT
// ─────────────────────────────────────────────────────────────────────────────

async function runTest(test, systemPromptTemplate) {
  const startedAt = Date.now();
  const systemPrompt = fillPromptPlaceholders(systemPromptTemplate, test.context || {});
  let status = 'passed';
  let failReason = null;
  let convo = { toolCalls: [], aiReplies: [], artifacts: [] };

  try {
    convo = await runConversation(systemPrompt, test.userTurns || []);
    const errors = [
      ...assertToolCalls(convo, test),
      ...assertReplyPatterns(convo, test),
      ...assertLanguage(convo, test),
    ];
    if (errors.length > 0) {
      status = 'failed';
      failReason = errors.join(' | ');
    }
  } catch (e) {
    status = 'failed';
    failReason = `exception: ${e?.message || e}`;
  }

  for (const booking of convo.artifacts) await safeCancel(booking);
  return {
    id: test.id,
    category: test.category,
    description: test.description,
    status,
    failReason,
    duration: Date.now() - startedAt,
    toolCalls: convo.toolCalls,
    aiReplies: convo.aiReplies,
    userTurns: test.userTurns || [],
    events: convo.events || [],
  };
}

async function main() {
  console.log('▶ Runner B — Integration tests via Realtime API (text-only)');
  console.log(`  Model: ${MODEL}`);
  console.log(`  URL: ${REALTIME_URL}`);
  const systemPromptTemplate = loadSystemPromptTemplate();
  console.log(`  System prompt: ${systemPromptTemplate.length} chars loaded`);

  const batchFilter = process.env.BATCH_FILTER || 'all';
  console.log(`  Batch filter: ${batchFilter}`);

  const allFiles = fs.readdirSync(DATA_DIR).filter(f => f.startsWith('b-') && f.endsWith('.json')).sort();
  const files = allFiles.filter(f => fileMatchesFilter(f, batchFilter));
  if (files.length === 0) {
    console.log(`\n⚠️  Nessun file matcha il filtro "${batchFilter}"`);
    console.log(`  File disponibili: ${allFiles.join(', ')}`);
    process.exit(1);
  }
  console.log(`  Filtered to ${files.length}/${allFiles.length} file(s): ${files.join(', ')}`);

  const allTests = [];
  for (const f of files) {
    const arr = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf-8'));
    for (const t of arr) allTests.push({ ...t, _sourceFile: f });
  }
  console.log(`  ${allTests.length} tests found\n`);

  const results = [];
  for (let i = 0; i < allTests.length; i++) {
    const t = allTests[i];
    process.stdout.write(`  [${String(i + 1).padStart(3, '0')}/${allTests.length}] ${t.id} ${t.category}... `);
    const r = await runTest(t, systemPromptTemplate);
    results.push(r);
    console.log(r.status === 'passed' ? `✓ ${r.duration}ms` : `✗ ${r.duration}ms`);
  }

  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  writeBatchReports('b', results, BATCH_SIZE);
  writeSummary('b', results);
  writeConversationsLog(results);
  const passed = results.filter(r => r.status === 'passed').length;
  const failed = results.length - passed;
  console.log(`\n▶ Runner B finito: ${passed}/${results.length} passati, ${failed} falliti`);
  process.exit(failed > 0 ? 1 : 0);
}

// Filtro batch: accetta "all", "B02", "B02,B03", "B01-B05"
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
      const end = parseInt(rangeMatch[2], 10);
      if (batchNum >= Math.min(start, end) && batchNum <= Math.max(start, end)) return true;
      continue;
    }
    const singleMatch = part.match(/^B?0*(\d+)$/i);
    if (singleMatch && batchNum === parseInt(singleMatch[1], 10)) return true;
  }
  return false;
}

function writeConversationsLog(results) {  const passed = results.filter(r => r.status === 'passed').length;
  const failed = results.filter(r => r.status !== 'passed');
  const totalDuration = results.reduce((s, r) => s + r.duration, 0);
  const byCategory = {};
  for (const r of results) {
    if (!byCategory[r.category]) byCategory[r.category] = { total: 0, passed: 0 };
    byCategory[r.category].total++;
    if (r.status === 'passed') byCategory[r.category].passed++;
  }

  let md = `# Test Conversations — Run ${new Date().toISOString().substring(0, 16).replace('T', ' ')}\n\n`;
  md += `**Model**: ${MODEL} | **Total**: ${results.length} | **Passed**: ${passed} (${Math.round(passed / results.length * 100 || 0)}%) | **Failed**: ${failed.length} | **Duration**: ${(totalDuration / 1000).toFixed(1)}s\n\n`;

  if (failed.length > 0) {
    md += `## ❌ Failed tests (${failed.length})\n\n`;
    for (const r of failed) {
      md += `- [${r.id}](#${r.id.toLowerCase()}) ${r.category} — ${r.failReason?.substring(0, 120)}\n`;
    }
    md += '\n';
  }

  md += `## By category\n\n`;
  for (const [cat, s] of Object.entries(byCategory).sort()) {
    md += `- \`${cat}\`: ${s.passed}/${s.total} pass\n`;
  }
  md += `\n---\n\n`;

  // Conversazioni
  for (const r of results) {
    const icon = r.status === 'passed' ? '✅' : '❌';
    md += `## ${r.id} ${icon} ${r.category} — ${r.description} (${(r.duration / 1000).toFixed(1)}s)\n\n`;
    if (r.status !== 'passed') {
      md += `> ⚠️ **Failed**: ${r.failReason}\n\n`;
    }

    // Rendering cronologico degli events
    for (const ev of r.events || []) {
      if (ev.type === 'user') {
        md += `**[Cliente]**: ${ev.text}\n\n`;
      } else if (ev.type === 'ai') {
        md += `**[Giulia]**: ${ev.text}\n\n`;
      } else if (ev.type === 'tool') {
        const argsStr = Object.entries(ev.args || {})
          .map(([k, v]) => `${k}=${typeof v === 'string' ? `"${v}"` : v}`)
          .join(', ');
        const resultShort = summarizeToolResult(ev.name, ev.result);
        md += `→ 🔧 \`${ev.name}(${argsStr})\` → ${resultShort}\n\n`;
      }
    }
    md += `---\n\n`;
  }

  fs.writeFileSync(path.join(REPORTS_DIR, `latest-conversations.md`), md);
}

function summarizeToolResult(name, result) {
  if (!result) return '(no result)';
  if (result.error) return `❌ error: ${result.error}`;
  if (name === 'controlla_disponibilita') {
    const esito = result.reason || result.esito || (result.success ? 'ok' : 'error');
    return esito;
  }
  if (name === 'crea_prenotazione') {
    return result.eventId ? `✅ creata (eventId: ${String(result.eventId).substring(0, 20)}...)` : `success=${result.success}`;
  }
  if (name === 'trova_prenotazione') {
    return result.found ? `✅ trovata (${result.count || 1})` : '❌ non trovata';
  }
  if (name === 'modifica_prenotazione' || name === 'cancella_prenotazione') {
    return result.success ? '✅ ok' : `❌ ${result.error || 'failed'}`;
  }
  // Fallback: primo campo notevole
  const shortJson = JSON.stringify(result).substring(0, 100);
  return shortJson;
}

function writeBatchReports(prefix, results, batchSize) {
  const totalBatches = Math.ceil(results.length / batchSize);
  for (let b = 0; b < totalBatches; b++) {
    const slice = results.slice(b * batchSize, (b + 1) * batchSize);
    const passed = slice.filter(r => r.status === 'passed');
    const failed = slice.filter(r => r.status !== 'passed');
    const start = b * batchSize + 1;
    const end = b * batchSize + slice.length;
    const filename = `latest-${prefix}-batch-${String(b + 1).padStart(2, '0')}.md`;
    let md = `# Batch ${prefix.toUpperCase()}-${String(b + 1).padStart(2, '0')} (tests ${start}-${end})\n`;
    md += `Run: ${new Date().toISOString()} | Model: ${MODEL} | Total: ${slice.length} | Passed: ${passed.length} (${Math.round(passed.length / slice.length * 100)}%) | Failed: ${failed.length}\n\n`;
    if (passed.length > 0) {
      md += `## ✅ Passed (${passed.length})\n\n`;
      for (const r of passed) md += `- **${r.id}** \`${r.category}\`: ${r.description} (${r.duration}ms, ${r.toolCalls.length} tool calls)\n`;
      md += '\n';
    }
    if (failed.length > 0) {
      md += `## ❌ Failed (${failed.length})\n\n`;
      for (const r of failed) {
        md += `### ${r.id} — \`${r.category}\`\n**Description**: ${r.description}\n\n**Reason**: ${r.failReason}\n\n`;
        md += `**Full transcript**:\n\n`;
        const turns = Math.max(r.userTurns.length, r.aiReplies.length);
        for (let t = 0; t < turns; t++) {
          if (r.userTurns[t]) md += `**[User turn ${t + 1}]**: ${r.userTurns[t]}\n\n`;
          if (r.aiReplies[t]) md += `**[AI reply ${t + 1}]**: ${r.aiReplies[t]}\n\n`;
        }
        md += `**Tool calls made** (${r.toolCalls.length}):\n\`\`\`json\n${JSON.stringify(r.toolCalls, null, 2)}\n\`\`\`\n\n**Duration**: ${r.duration}ms\n\n---\n\n`;
      }
    }
    fs.writeFileSync(path.join(REPORTS_DIR, filename), md);
  }
}

function writeSummary(prefix, results) {
  const passed = results.filter(r => r.status === 'passed').length;
  const failed = results.length - passed;
  const byCategory = {};
  for (const r of results) {
    if (!byCategory[r.category]) byCategory[r.category] = { total: 0, passed: 0, failed: 0 };
    byCategory[r.category].total++;
    if (r.status === 'passed') byCategory[r.category].passed++;
    else byCategory[r.category].failed++;
  }
  let md = `# Summary — Runner ${prefix.toUpperCase()}\n`;
  md += `Run: ${new Date().toISOString()} | Model: ${MODEL}\n\n`;
  md += `**Total**: ${results.length} | **Passed**: ${passed} (${Math.round(passed / results.length * 100 || 0)}%) | **Failed**: ${failed}\n\n`;
  md += `## By category\n\n| Category | Total | Passed | Failed | Pass rate |\n|---|---|---|---|---|\n`;
  for (const [cat, s] of Object.entries(byCategory).sort()) {
    const rate = Math.round(s.passed / s.total * 100);
    md += `| \`${cat}\` | ${s.total} | ${s.passed} | ${s.failed} | ${rate}% |\n`;
  }
  fs.writeFileSync(path.join(REPORTS_DIR, `summary-${prefix}.md`), md);
}

main().catch(e => { console.error('Fatal:', e); process.exit(2); });
