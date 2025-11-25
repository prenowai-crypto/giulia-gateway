// ===============================
// Receptionist AI Gateway - GPT + Calendar
// ===============================

import express from "express";
import bodyParser from "body-parser";
import cors from "cors";

const app = express();

// ---------- CONFIG ----------

// Nome generico (puoi cambiarlo, oppure usare RECEPTIONIST_NAME come env)
const RECEPTIONIST_NAME = process.env.RECEPTIONIST_NAME || "Receptionist";

// Nome di fallback del ristorante se get_context non risponde
const DEFAULT_RESTAURANT_NAME = process.env.RESTAURANT_NAME || "Ristorante";

// Email di fallback del ristorante (usata solo se get_context non la fornisce)
const OWNER_EMAIL_DEFAULT = process.env.OWNER_EMAIL || "prenowai@gmail.com";

// Web App di Google Apps Script (Giulia Calendar Gateway)
const APPS_SCRIPT_URL =
  process.env.APPS_SCRIPT_URL ||
  "https://script.google.com/macros/s/AKfycbx39h60wqJ0TwLy9PzZyZTqCPV_eGid4j0NOF1FsHJyi411mWyOtZZYC_Z68htZSonqlg/exec";

// URL per il get_context (uguale)
const APPS_SCRIPT_CONTEXT_URL =
  process.env.APPS_SCRIPT_CONTEXT_URL || APPS_SCRIPT_URL;

// URL pubblico di questo server su Render
const BASE_URL = process.env.BASE_URL || "https://giulia-gateway.onrender.com";

// Soglie di fallback (se get_context non risponde)
const LARGE_GROUP_THRESHOLD_DEFAULT = 10; 
const EVENT_THRESHOLD_DEFAULT = 45;

// ---------- EMAIL → OWNER (EVENTI GRANDI) ----------
async function sendOwnerEmail({ name, people, date, time, phone, customerEmail }) {
  try {
    const payload = {
      action: "notify_big_event",
      nome: name,
      persone: people,
      data: date,
      ora: time,
      telefono: phone || "",
      email: customerEmail || "",
    };

    console.log("📧 Invio richiesta evento grande:", payload);

    const response = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const text = await response.text();
    let data;

    try {
      data = JSON.parse(text);
    } catch {
      data = { rawResponse: text };
    }

    if (!response.ok) {
      console.error("❌ Errore Apps Script (email proprietario):", data);
      return;
    }

    console.log("✉️ Risposta evento grande:", data);
  } catch (err) {
    console.error("❌ Errore chiamando Apps Script per evento grande:", err);
  }
}

// ---------- MEMORY MAPS ----------
const conversations = new Map();
const callLanguages = new Map();
const userTextHistory = new Map();
const callContexts = new Map();
const callReservations = new Map();

// ---------- MIDDLEWARE ----------
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ---------- HELPERS GENERICI ----------
function escapeXml(unsafe = "") {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function getCallLanguage(callId) {
  return callLanguages.get(callId) || "it-IT";
}
function setCallLanguage(callId, lang) {
  if (!callId) return;
  callLanguages.set(callId, lang);
}

function appendUserText(callId, text) {
  if (!callId || !text) return;
  const arr = userTextHistory.get(callId) || [];
  arr.push(text);
  userTextHistory.set(callId, arr);
}

function getAllUserText(callId) {
  const arr = userTextHistory.get(callId);
  return arr?.join(" ") || "";
}

function normalizeText(str) {
  return (str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function getNowInRome() {
  const nowString = new Date().toLocaleString("en-US", { timeZone: "Europe/Rome" });
  return new Date(nowString);
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function toISODate(date) {
  if (!date) return null;
  return date.toISOString().split("T")[0];
}
// ---------- LANGUAGE SWITCH ----------
function maybeSwitchToEnglish(callId, userText) {
  const t = (userText || "").toLowerCase();

  const wantsEnglish =
    t.includes("do you speak english") ||
    t.includes("can we speak english") ||
    t.includes("speak in english") ||
    t.includes("english please") ||
    t.includes("in english") ||
    t.includes("parli inglese") ||
    t.includes("parla inglese") ||
    t.includes("in inglese");

  if (wantsEnglish) {
    setCallLanguage(callId, "en-US");
  }
}

function maybeSwitchToItalian(callId, userText) {
  const t = (userText || "").toLowerCase();
  const wantsItalian =
    t.includes("parli italiano") ||
    t.includes("parla italiano") ||
    t.includes("in italiano") ||
    ((t.includes("italian") || t.includes("italiano")) &&
      (t.includes("not understand") ||
        t.includes("don't understand") ||
        t.includes("non capisco")));

  if (wantsItalian) {
    setCallLanguage(callId, "it-IT");
  }
}

// ---------- EMAIL INTERPRETATION ----------
function isRestaurantEmailQuestion(text = "") {
  const t = text.toLowerCase();

  // Escludi "la mia email"
  if (
    t.includes("mia mail") ||
    t.includes("la mia email") ||
    t.includes("my email")
  ) {
    return false;
  }

  // Italiano
  if (
    t.includes("mail del ristorante") ||
    t.includes("email del ristorante") ||
    t.includes("indirizzo email del ristorante") ||
    t.includes("mail del locale") ||
    t.includes("email del locale")
  ) {
    return true;
  }

  // Inglese
  if (
    t.includes("restaurant email") ||
    t.includes("email of the restaurant") ||
    t.includes("restaurant's email")
  ) {
    return true;
  }

  return false;
}

function isRestaurantEmailSpellingRequest(text = "") {
  const t = text.toLowerCase();

  if (isRestaurantEmailQuestion(t)) return true;

  return (
    t.includes("spelling della mail") ||
    t.includes("spelling dell'email") ||
    t.includes("puoi dettarmi la mail") ||
    t.includes("puoi dettarmi l'email") ||
    t.includes("how do you spell your email") ||
    t.includes("spell your email") ||
    t.includes("can you spell the email")
  );
}

function spellEmailForTTS(email, lang = "it-IT") {
  if (!email) return "";
  const [local, domainAndTld] = email.split("@");
  if (!local || !domainAndTld) return email;

  const domainParts = domainAndTld.split(".");
  const domain = domainParts[0];
  const tld = domainParts.slice(1).join(".");

  const localSpelled =
    lang === "en-US"
      ? local.split("").join(" ")
      : local.split("").map((ch) => (ch === "w" ? "doppia vù" : ch)).join(" ");

  const common = ["gmail", "outlook", "hotmail", "yahoo", "icloud"];
  const domainSpoken = common.includes(domain.toLowerCase())
    ? domain
    : domain.split("").join(" ");

  return lang === "en-US"
    ? `${localSpelled} at ${domainSpoken} dot ${tld}`
    : `${localSpelled} chiocciola ${domainSpoken} punto ${tld}`;
}

function sanitizeEmail(email) {
  if (!email) return null;
  return email.replace(/\s+/g, "") || null;
}

function extractEmailFromText(text) {
  if (!text) return null;
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0] : null;
}

// ---------- RESERVATION MERGE ----------
function mergeReservationForCall(callId, newRes = {}) {
  const old = callReservations.get(callId) || {};
  const merged = {
    date: newRes.date ?? old.date ?? null,
    time: newRes.time ?? old.time ?? null,
    people:
      newRes.people !== undefined && newRes.people !== null
        ? newRes.people
        : old.people ?? null,
    name: newRes.name ?? old.name ?? null,
    customerEmail: newRes.customerEmail ?? old.customerEmail ?? null,
  };
  callReservations.set(callId, merged);
  return merged;
}

// ---------- DATE INFERENCE ----------
function inferDateFromConversation(callId) {
  const t = normalizeText(getAllUserText(callId));
  if (!t.trim()) return null;

  const now = getNowInRome();
  const today = startOfDay(now);

  // Base
  if (/dopodomani|day after tomorrow/.test(t)) return toISODate(addDays(today, 2));
  if (/domani|tomorrow/.test(t)) return toISODate(addDays(today, 1));
  if (/\boggi\b|\btoday\b/.test(t)) return toISODate(today);

  // Weekend
  if (t.includes("weekend") || t.includes("fine settimana")) {
    return toISODate(addDays(today, (6 - today.getDay() + 7) % 7)); // Sabato
  }

  // Giorni della settimana (null → sistema calcola)
  const weekdays = [
    { it: "domenica", en: "sunday", index: 0 },
    { it: "lunedi", en: "monday", index: 1 },
    { it: "martedi", en: "tuesday", index: 2 },
    { it: "mercoledi", en: "wednesday", index: 3 },
    { it: "giovedi", en: "thursday", index: 4 },
    { it: "venerdi", en: "friday", index: 5 },
    { it: "sabato", en: "saturday", index: 6 },
  ];
  for (const w of weekdays) {
    if (t.includes(w.it) || t.includes(w.en)) {
      return null; // gestione demandata al sistema
    }
  }

  return null;
}
// ---------- NORMALIZZAZIONE PRENOTAZIONE PER IL CALENDAR ----------
function normalizeReservationForCalendar(reservation = {}, callId) {
  let { date, time, people, name, customerEmail } = reservation;

  // Stringa "null" → null reale
  if (date === "null") date = null;

  // 1) Data inferita (domani, dopodomani, ecc.)
  const inferred = inferDateFromConversation(callId);
  if (inferred) {
    date = inferred;
  }

  // 2) Se la data è esplicita, assicurati che non sia nel passato
  if (date && typeof date === "string") {
    const parts = date.split("-");
    if (parts.length === 3) {
      const y = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10);
      const d = parseInt(parts[2], 10);

      if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
        let candidate = new Date(y, m - 1, d);
        const today = startOfDay(getNowInRome());

        // Evita date nel passato → sposta avanti di un anno
        while (candidate < today) {
          candidate.setFullYear(candidate.getFullYear() + 1);
        }

        date = toISODate(candidate);
      }
    }
  }

  // 3) Inferenza orario se mancante
  if (!time) {
    const t = normalizeText(getAllUserText(callId));

    if (/stanotte|a mezzanotte|midnight/.test(t)) time = "00:00:00";
    else if (/pranzo|lunch/.test(t)) time = "13:00:00";
    else if (/sera|evening|night|stasera|questa sera/.test(t)) time = "20:00:00";
    else if (/ultimo orario|latest time|very late/.test(t)) time = "22:30:00";
  }

  // 4) Email sanificata
  if (customerEmail) customerEmail = sanitizeEmail(customerEmail);

  return { date, time, people, name, customerEmail };
}

// ---------- INVIO DATI A GOOGLE APPS SCRIPT (CALENDAR) ----------
async function sendToCalendar(payload) {
  console.log("📅 Invio dati a Apps Script:", payload);

  const response = await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  let data;

  try {
    data = JSON.parse(text);
  } catch (err) {
    data = { rawResponse: text };
  }

  if (!response.ok) {
    console.error("❌ Errore Apps Script:", data);
    throw new Error("Errore Apps Script");
  }

  console.log("✅ Risposta da Apps Script:", data);
  return data;
}

// ---------- CONTESTO (CARICAMENTO DA APPS SCRIPT) ----------
async function fetchRestaurantContext() {
  try {
    const url = `${APPS_SCRIPT_URL}?action=get_context`;
    console.log("🌐 get_context:", url);

    const response = await fetch(url);
    const text = await response.text();
    let json;

    try {
      json = JSON.parse(text);
    } catch {
      console.error("❌ get_context non JSON:", text);
      json = null;
    }

    if (!response.ok || !json || json.success === false) {
      console.error("❌ Errore get_context:", json);
      throw new Error("Contesto non valido");
    }

    console.log("✅ Context ricevuto:", JSON.stringify(json, null, 2));
    return json;
  } catch (err) {
    console.error("❌ Errore get_context:", err);

    // Fallback minimo
    return {
      success: false,
      restaurant: {
        name: DEFAULT_RESTAURANT_NAME,
        email: OWNER_EMAIL_DEFAULT,
        address: "",
        phone: "",
        timezone: "Europe/Rome",
        openingHoursText: "",
        closingRulesText: "",
      },
      menu: {
        summaryText: "",
        vegetarianText: "",
        glutenFreeText: "",
        priceRangeText: "",
      },
      rules: {
        largeGroupThreshold: LARGE_GROUP_THRESHOLD_DEFAULT,
        eventThreshold: EVENT_THRESHOLD_DEFAULT,
        outdoorSeatingText: "",
        bookingPolicyText: "",
      },
    };
  }
}

async function ensureContextForCall(callId) {
  if (callContexts.has(callId)) return callContexts.get(callId);
  const ctx = await fetchRestaurantContext();
  callContexts.set(callId, ctx);
  return ctx;
}

function getContextForCall(callId) {
  return callContexts.get(callId) || null;
}

function getThresholdsForCall(callId) {
  const ctx = getContextForCall(callId);
  return {
    largeGroupThreshold:
      ctx?.rules?.largeGroupThreshold ?? LARGE_GROUP_THRESHOLD_DEFAULT,
    eventThreshold:
      ctx?.rules?.eventThreshold ?? EVENT_THRESHOLD_DEFAULT,
  };
}

function getRestaurantEmailForCall(callId) {
  return (
    getContextForCall(callId)?.restaurant?.email || OWNER_EMAIL_DEFAULT
  );
}

function getRestaurantNameForCall(callId) {
  return (
    getContextForCall(callId)?.restaurant?.name || DEFAULT_RESTAURANT_NAME
  );
}
// -------------------------------------------------------
// 🧠 SYSTEM PROMPT DINAMICO PER LA CHIAMATA
// -------------------------------------------------------
function buildSystemPrompt(context, callId) {
  const r = context.restaurant;
  const menu = context.menu;
  const rules = context.rules;

  return `
You are Giulia, the AI receptionist of the restaurant "${r.name}".
Your job is to manage reservations in perfect Italian or English,
depending on the user's language.

----- RESTAURANT INFO -----
Name: ${r.name}
Email: ${r.email}
Address: ${r.address}
Phone: ${r.phone}
Opening hours: ${r.openingHoursText}
Closing rules: ${r.closingRulesText}

----- MENU INFO -----
Summary: ${menu.summaryText}
Vegetarian: ${menu.vegetarianText}
Gluten free: ${menu.glutenFreeText}
Price range: ${menu.priceRangeText}

----- RESERVATION RULES -----
Large group threshold: ${rules.largeGroupThreshold}
Event threshold (private events): ${rules.eventThreshold}
Outdoor seating: ${rules.outdoorSeatingText}
Booking policy: ${rules.bookingPolicyText}

----- IMPORTANT LOGIC -----
1. If user gives date / time / name / people, return {action: "create_reservation"}.
2. If user misses some field, ask only for the missing part.
3. If the user gives an email, ALWAYS confirm the spelled-out version.
4. If the user confirms his own email spelling → accept it.
5. If the group is >= eventThreshold → action = "event_private".
6. If the group is > largeGroupThreshold → booking is "subject to confirmation".
7. YOU DO NOT CHECK AVAILABILITY. That is done externally by the server.
8. Your goal is ONLY to produce a JSON response with the structure:

{
  "reply_text": "...",
  "action": "...",
  "reservation": {
    "date": "...",
    "time": "...",
    "people": ...,
    "name": "...",
    "customerEmail": "..."
  }
}

DO NOT add extra fields. DO NOT use markdown. Only JSON.

----- CONTEXT OF CALL -----
Call ID: ${callId}
Restaurant timezone: ${r.timezone}

Your tone is always calm, friendly, concise and helpful.
Never mention that you are an AI.`;
}


// -------------------------------------------------------
// 🧠 INVIO DELLA RICHIESTA A GPT (askGiulia)
// -------------------------------------------------------
async function askGiulia(systemPrompt, userText, currentLang) {
  try {
    const langModel =
      currentLang === "en-US"
        ? "gpt-4o-mini-2024-07-18"
        : "gpt-4o-mini-2024-07-18";

    const payload = {
      model: langModel,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userText },
      ],
      temperature: 0.2,
    };

    console.log("📤 OpenAI request:", JSON.stringify(payload, null, 2));

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    console.log("📦 FULL OpenAI response:", JSON.stringify(data, null, 2));

    const msg = data.choices?.[0]?.message?.content;
    if (!msg) {
      console.error("❌ Nessun contenuto da GPT:", data);
      return null;
    }

    let parsed;
    try {
      parsed = JSON.parse(msg);
    } catch (err) {
      console.error("❌ JSON non valido:", msg);
      return null;
    }

    console.log("🧠 Risposta raw da GPT:", parsed);
    return parsed;
  } catch (err) {
    console.error("❌ Errore askGiulia:", err);
    return null;
  }
}
// -------------------------------------------------------
// 🧹 NORMALIZZAZIONE TESTO SPEECH-TO-TEXT
// -------------------------------------------------------
function cleanSpeechText(text = "") {
  if (!text) return "";
  return text
    .replace(/\s+/g, " ")
    .replace(/’/g, "'")
    .trim();
}

// -------------------------------------------------------
// 🔢 CONVERSIONE NUMERI PARLATI IN CIFRE
// -------------------------------------------------------
function extractPeople(text = "") {
  if (!text) return null;

  const map = {
    uno: 1,
    una: 1,
    due: 2,
    tre: 3,
    quattro: 4,
    cinque: 5,
    sei: 6,
    sette: 7,
    otto: 8,
    nove: 9,
    dieci: 10,
    venti: 20,
  };

  const lower = text.toLowerCase();

  for (const word in map) {
    if (lower.includes(word)) return map[word];
  }

  const numberMatch = lower.match(/\b\d{1,2}\b/);
  return numberMatch ? parseInt(numberMatch[0]) : null;
}

// -------------------------------------------------------
// 📧 ESTRAZIONE EMAIL SE DETTA COMPLETAMENTE
// -------------------------------------------------------
function extractEmail(text = "") {
  if (!text) return null;
  const m = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0] : null;
}

// -------------------------------------------------------
// 🧍‍♂️ ESTRAZIONE NOME (SEMPLIFICATA)
// -------------------------------------------------------
function extractName(text = "") {
  if (!text) return null;

  const match = text.match(/nome\s+([A-Za-zàèìòù]+)/i);
  if (match) return match[1];

  // fallback: prima parola se user says “sono Marco”
  const match2 = text.match(/sono\s+([A-Za-zàèìòù]+)/i);
  if (match2) return match2[1];

  return null;
}

// -------------------------------------------------------
// ⏰ ESTRAZIONE ORA
// -------------------------------------------------------
function extractTime(text = "") {
  if (!text) return null;

  const m = text.match(/\b([01]?\d|2[0-3])[:.]?([0-5]\d)?\b/);
  if (!m) return null;

  const hh = m[1].padStart(2, "0");
  const mm = (m[2] || "00").padStart(2, "0");
  return `${hh}:${mm}:00`;
}

// -------------------------------------------------------
// 📅 ESTRAZIONE DATA (con parole: domani, dopodomani…)
// -------------------------------------------------------
function extractDate(text = "", now = new Date()) {
  const lower = text.toLowerCase();

  if (lower.includes("oggi")) {
    return now.toISOString().split("T")[0];
  }

  if (lower.includes("domani")) {
    const d = new Date(now);
    d.setDate(now.getDate() + 1);
    return d.toISOString().split("T")[0];
  }

  if (lower.includes("dopodomani")) {
    const d = new Date(now);
    d.setDate(now.getDate() + 2);
    return d.toISOString().split("T")[0];
  }

  // formati numerici
  const m = lower.match(/\b(\d{1,2})[\/\-](\d{1,2})\b/);
  if (m) {
    const dd = m[1].padStart(2, "0");
    const mm = m[2].padStart(2, "0");
    return `${new Date().getFullYear()}-${mm}-${dd}`;
  }

  return null;
}

// -------------------------------------------------------
// 🧠 GESTIONE DELLO “STATO” DELLA CONVERSAZIONE
// -------------------------------------------------------
function initGiuliaState(callId) {
  return {
    callId,
    missing: {
      name: false,
      date: false,
      time: false,
      people: false,
      email: false,
    },
    reservation: {
      name: null,
      date: null,
      time: null,
      people: null,
      customerEmail: null,
    },
  };
}

function updateGiuliaState(giulia, parsed) {
  if (!parsed) return giulia;

  if (parsed.reservation) {
    const r = parsed.reservation;
    if (r.name) giulia.reservation.name = r.name;
    if (r.date) giulia.reservation.date = r.date;
    if (r.time) giulia.reservation.time = r.time;
    if (r.people) giulia.reservation.people = r.people;
    if (r.customerEmail) giulia.reservation.customerEmail = r.customerEmail;
  }
  return giulia;
}
// ===================================================================
// 📞 ROUTE PRINCIPALE /twilio — GESTIONE COMPLETA DEL TURNO DI CHIAMATA
// ===================================================================
app.post("/twilio", async (req, res) => {
  const callId = req.body.CallSid || "no-call-id";
  const From = req.body.From || "";
  const currentLang = req.body.Language || "it-IT";

  console.log("📞 /twilio body:", JSON.stringify(req.body, null, 2));
  console.log("📲 Numero chiamante (From):", From, "postFinal:", req.body.postFinal);

  // ------------------------------
  // 🧹 NORMALIZZIAMO IL TESTO
  // ------------------------------
  let userText = "";
  if (req.body.SpeechResult) {
    userText = cleanSpeechText(req.body.SpeechResult);
  } else if (req.body.text) {
    userText = cleanSpeechText(req.body.text);
  }

  console.log("👤 Utente dice:", userText);

  // ------------------------------------------------------
  // 🧠 INIZIALIZZA O AGGIORNA STATO GIULIA PER LA CHIAMATA
  // ------------------------------------------------------
  if (!global.conversations) global.conversations = {};
  if (!global.conversations[callId]) {
    global.conversations[callId] = initGiuliaState(callId);
  }
  let giulia = global.conversations[callId];

  // ------------------------------------------------------
  // 📦 CHIAMATA CONTEXT → MENU, REGOLE, OPENING HOURS ecc.
  // ------------------------------------------------------
  console.log("🌐 Chiamata get_context:", APPS_SCRIPT_URL + "?action=get_context");
  let context = null;

  try {
    const contextRes = await fetch(APPS_SCRIPT_URL + "?action=get_context");
    context = await contextRes.json();
    console.log("✅ Context ricevuto:", context);
  } catch (err) {
    console.error("❌ Errore get_context:", err);
    context = {
      restaurant: {
        name: DEFAULT_RESTAURANT_NAME,
        email: OWNER_EMAIL_DEFAULT,
        openingHoursText: "",
        closingRulesText: "",
      },
      menu: {},
      rules: {
        largeGroupThreshold: 10,
        eventThreshold: 40,
      },
    };
  }

  // -------------------------------------------------------------------------------------
  // 🔍 PRIMA PASSATA DI PARSING (NOME, PERSONE, DATA, ORA, EMAIL) — Riempiamo mancanze
  // -------------------------------------------------------------------------------------
  const extractedName = extractName(userText);
  const extractedPeople = extractPeople(userText);
  const extractedEmail = extractEmail(userText);
  const extractedTime = extractTime(userText);
  const extractedDate = extractDate(userText, new Date());

  if (extractedName) giulia.reservation.name = extractedName;
  if (extractedPeople) giulia.reservation.people = extractedPeople;
  if (extractedEmail) giulia.reservation.customerEmail = extractedEmail;
  if (extractedTime) giulia.reservation.time = extractedTime;
  if (extractedDate) giulia.reservation.date = extractedDate;

  // -----------------------------------------------------
  // 🧠 INVOCAZIONE GPT → CHIEDIAMO A GIULIA COSA FARE
  // -----------------------------------------------------
  const gptPayload = {
    user_text: userText,
    context: context,
    state: giulia,
  };

  let gptRaw;
  try {
    gptRaw = await askGiulia(gptPayload);
  } catch (err) {
    console.error("❌ Errore GPT askGiulia:", err);

    const fallback = currentLang === "en-US"
      ? "I'm sorry, I didn't understand. Could you repeat that?"
      : "Mi dispiace, non ho capito. Puoi ripetere?";
    
    const tw = `
      <Response>
        <Gather input="speech" language="${currentLang}" action="${BASE_URL}/twilio">
          <Say language="${currentLang}" bargeIn="true">${escapeXml(fallback)}</Say>
        </Gather>
      </Response>`;
    
    return res.status(200).type("text/xml").send(tw);
  }

  console.log("🧠 Risposta raw da GPT:", gptRaw);

  // -------------------------------------------------------------------------
  // 🎯 AGGIORNIAMO STATO GIULIA CON QUELLO CHE DICE GPT (GIULIA → PARSED JSON)
  // -------------------------------------------------------------------------
  try {
    giulia = updateGiuliaState(giulia, gptRaw);
    global.conversations[callId] = giulia;
  } catch (err) {
    console.error("❌ Errore updateGiuliaState:", err);
  }

  // -----------------------------------------------------
  // 📌 ESTRAIAMO CAMPi RICHIESTI DA GPT
  // -----------------------------------------------------
  const replyText = gptRaw.reply_text || "";
  let action = gptRaw.action || "none";

  // -----------------------------------------------------
  // 🧪 SE GIULIA NON RICHIEDE AZIONI SPECIALI → RISPOSTA NORMALE
  // -----------------------------------------------------
  if (action !== "ask_email" &&
      action !== "create_reservation" &&
      action !== "ask_date" &&
      action !== "ask_time") {

    const tw = `
      <Response>
        <Gather input="speech" language="${currentLang}" action="${BASE_URL}/twilio">
          <Say language="${currentLang}" bargeIn="true">${escapeXml(replyText)}</Say>
        </Gather>
      </Response>
    `;

    return res.status(200).type("text/xml").send(tw);
  }

  // ---------------------------------------------
  // ⏭️ SE QUI ARRIVIAMO, È UN'AZIONE “SPECIALE”
  // ---------------------------------------------
  req.giulia = giulia;
  req.gptRaw = gptRaw;
  req.context = context;

  // Continuerà con il blocco successivo (precheck + create_reservation)
});
// ===================================================================
// 🔥 BLOCCO 7 — PRECHECK SLOT + CREATE_RESERVATION
// ===================================================================
app.post("/twilio", async (req, res, next) => {

  // Questi sono stati salvati nel BLOCCO 6
  const giulia = req.giulia;
  const gptRaw = req.gptRaw;
  const context = req.context;

  const callId = req.body.CallSid || "no-call-id";
  const From = req.body.From || "";
  const currentLang = req.body.Language || "it-IT";

  let action = gptRaw.action || "none";

  // ---------------------------------------------------------
  // 📦 Normalizziamo la prenotazione per Calendar
  // ---------------------------------------------------------
  const normalized = normalizeReservationForCalendar(
    giulia.reservation,
    callId
  );

  const { date, time, people, name, customerEmail } = normalized;

  // ===================================================================
  // 1️⃣ PRECHECK ANTICIPATO (PRIMA DI CHIEDERE EMAIL)
  // ===================================================================
  if (action === "ask_email") {
    // se non hai data / tempo / persone / nome, non testare
    if (date && time && people && name) {
      
      console.log("📅 PRECHECK EARLY:", {
        nome: name,
        persone: people,
        data: date,
        ora: time,
      });

      const precheck = await sendToCalendar({
        source: "twilio_precheck_early",
        nome: name,
        persone: people,
        data: date,
        ora: time,
        telefono: From,
        email: customerEmail || "",
        action: "check_availability"
      });

      console.log("📌 Risposta PRECHECK:", precheck);

      // -------- SLOT PIENO --------
      if (precheck && precheck.reason === "slot_full") {
        const reply =
          currentLang === "en-US"
            ? "I'm sorry, we are fully booked at that time. Would you like to try another hour or another day?"
            : "Mi dispiace, a quell’ora siamo al completo. Vuoi provare un altro orario o un altro giorno?";

        const tw = `
          <Response>
            <Gather input="speech" language="${currentLang}" action="${BASE_URL}/twilio">
              <Say language="${currentLang}" bargeIn="true">${escapeXml(reply)}</Say>
            </Gather>
          </Response>
        `.trim();

        return res.status(200).type("text/xml").send(tw);
      }
    }

    // SLOT LIBERO → ora chiediamo l’email normalmente
    const tw = `
      <Response>
        <Gather input="speech" language="${currentLang}" action="${BASE_URL}/twilio">
          <Say language="${currentLang}" bargeIn="true">${escapeXml(
            gptRaw.reply_text
          )}</Say>
        </Gather>
      </Response>
    `;
    return res.status(200).type("text/xml").send(tw);
  }

  // ===================================================================
  // 2️⃣ DOPO LA MAIL — CREAZIONE PRENOTAZIONE
  // ===================================================================
  if (action === "create_reservation") {

    console.log("📆 CREAZIONE PRENOTAZIONE — NORMALIZED:", normalized);

    const calendarRes = await sendToCalendar({
      source: "twilio_final_create",
      nome: name,
      persone: people,
      data: date,
      ora: time,
      telefono: From,
      email: customerEmail || "",
      action: "create_reservation"
    });

    console.log("📌 Risposta CREATE:", calendarRes);

    // -------- ERRORE: SLOT PIENO --------
    if (calendarRes && calendarRes.reason === "slot_full") {
      const reply =
        currentLang === "en-US"
          ? "Unfortunately we are fully booked at that time. Would you like another hour?"
          : "Purtroppo siamo al completo a quell’ora. Vuoi provare un altro orario?";

      const tw = `
        <Response>
          <Gather input="speech" language="${currentLang}" action="${BASE_URL}/twilio">
            <Say language="${currentLang}" bargeIn="true">${escapeXml(reply)}</Say>
          </Gather>
        </Response>
      `;
      return res.status(200).type("text/xml").send(tw);
    }

    // -------- SUCCESSO --------
    const successMsg =
      currentLang === "en-US"
        ? "All set! Your table is confirmed. We look forward to seeing you!"
        : "Perfetto! La tua prenotazione è confermata. Ti aspettiamo!";

    const tw = `
      <Response>
        <Say language="${currentLang}">${escapeXml(successMsg)}</Say>
        <Hangup/>
      </Response>
    `;
    return res.status(200).type("text/xml").send(tw);
  }

  // ===================================================================
  // 3️⃣ SE NON ERA NIENTE DI QUESTO → fallback
  // ===================================================================
  const fallback = `
    <Response>
      <Gather input="speech" language="${currentLang}" action="${BASE_URL}/twilio">
        <Say language="${currentLang}" bargeIn="true">${escapeXml(
          gptRaw.reply_text || "Puoi ripetere?"
        )}</Say>
      </Gather>
    </Response>
  `;
  return res.status(200).type("text/xml").send(fallback);
});
// ===================================================================
// 🔥 BLOCCO 8 — FALLBACK XML + CLEANUP SESSIONE
// ===================================================================

// Gestione errori XML globali
app.use((err, req, res, next) => {
  console.error("❌ ERRORE GENERALE:", err);

  const lang = req.body?.Language || "it-IT";
  const msg =
    lang === "en-US"
      ? "I'm sorry, there was a technical error. Please try again later."
      : "Mi dispiace, si è verificato un errore tecnico. Per favore riprova più tardi.";

  const tw = `
    <Response>
      <Say language="${lang}">${escapeXml(msg)}</Say>
      <Hangup/>
    </Response>
  `;

  return res.status(200).type("text/xml").send(tw);
});

// ===================================================================
// 🔥 Cleanup Sessione dopo ogni risposta
// ===================================================================
app.use((req, res, next) => {
  try {
    if (req.giulia) {
      // Manteniamo solo ciò che serve per la singola chiamata
      req.giulia = {};
    }
  } catch (e) {
    console.error("Errore cleanup session:", e);
  }
  next();
});

// ===================================================================
// 🔥 BLOCCO 8 — DEFAULT ROOT (Non usato da Twilio, solo debug)
// ===================================================================
app.get("/", (req, res) => {
  res.send("PrenoAI Giulia — Gateway attivo.");
});
