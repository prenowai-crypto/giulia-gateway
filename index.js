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

// URL per il get_context: usiamo lo stesso
const APPS_SCRIPT_CONTEXT_URL =
  process.env.APPS_SCRIPT_CONTEXT_URL || APPS_SCRIPT_URL;

// URL pubblico di questo server su Render
const BASE_URL = process.env.BASE_URL || "https://giulia-gateway.onrender.com";

// Soglie di fallback (se get_context non le fornisce)
const LARGE_GROUP_THRESHOLD_DEFAULT = 10; // sopra → “grande gruppo”, da confermare
const EVENT_THRESHOLD_DEFAULT = 45; // sopra → evento gigante, niente Calendar

// ---------- NOTE IMPORTANTI ----------
// Le soglie *reali* e l'email del ristorante vengono lette da get_context
// (Apps Script + Foglio Config). Questi valori sono solo fallback.

// invio mail al proprietario per gruppi enormi (evento) tramite Apps Script
async function sendOwnerEmail({ name, people, date, time, phone, customerEmail }) {
  try {
    const payload = {
      action: "notify_big_event", // gestito in Apps Script
      nome: name,
      persone: people,
      data: date,
      ora: time,
      telefono: phone || "",
      email: customerEmail || "",
    };

    console.log("📧 Invio richiesta evento grande a Apps Script:", payload);

    const response = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      data = { rawResponse: text };
    }

    if (!response.ok) {
      console.error("❌ Errore Apps Script (email proprietario):", data);
      return;
    }

    console.log("✉️ Risposta Apps Script (email proprietario):", data);
  } catch (err) {
    console.error("❌ Errore chiamando Apps Script per email proprietario:", err);
  }
}

// ---------- MAPPE STATO IN MEMORIA ----------

// Stato conversazioni per ogni chiamata (CallSid -> history GPT)
const conversations = new Map();

// Lingua della chiamata per Twilio STT/TTS (CallSid -> "it-IT" | "en-US")
const callLanguages = new Map();

// Cronologia grezza dei testi utente (CallSid -> [string])
const userTextHistory = new Map();

// Contesto ristorante per la chiamata (CallSid -> get_context JSON)
const callContexts = new Map();

// Stato della prenotazione per ogni chiamata (CallSid -> reservation cumulata)
const callReservations = new Map();

// ---------- MIDDLEWARE ----------
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ---------- HELPERS GENERICI ----------

// Escape per testo dentro XML (TwiML)
function escapeXml(unsafe = "") {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Leggi la lingua corrente della chiamata (default: it-IT)
function getCallLanguage(callId) {
  return callLanguages.get(callId) || "it-IT";
}

// Imposta/aggiorna la lingua della chiamata
function setCallLanguage(callId, lang) {
  if (!callId) return;
  callLanguages.set(callId, lang);
}

// Aggiunge testo utente grezzo alla cronologia della chiamata
function appendUserText(callId, text) {
  if (!callId || !text) return;
  const arr = userTextHistory.get(callId) || [];
  arr.push(text);
  userTextHistory.set(callId, arr);
}

// Ottiene tutta la conversazione utente (solo testo) in un'unica stringa
function getAllUserText(callId) {
  const arr = userTextHistory.get(callId);
  if (!arr || arr.length === 0) return "";
  return arr.join(" ");
}

// Utility: normalizza testo (minuscole + rimozione accenti)
function normalizeText(str) {
  return (str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// Utility: ora corrente in fuso Europe/Rome
function getNowInRome() {
  const nowString = new Date().toLocaleString("en-US", { timeZone: "Europe/Rome" });
  return new Date(nowString);
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, days) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

// 0 = Sunday ... 6 = Saturday
function getNextWeekday(today, targetWeekday) {
  const result = new Date(today.getTime());
  const diff = ((targetWeekday - result.getDay()) + 7) % 7 || 7; // sempre futuro
  result.setDate(result.getDate() + diff);
  return result;
}

// "questo sabato" = sabato di questa settimana (o prossimo se già passato)
function getThisSaturday(today) {
  const result = new Date(today.getTime());
  const day = result.getDay(); // 0..6
  const diff = (6 - day + 7) % 7; // 6 = sabato
  result.setDate(result.getDate() + diff);
  return result;
}

// "sabato prossimo" = sabato della settimana successiva
function getNextSaturday(today) {
  const thisSat = getThisSaturday(today);
  return addDays(thisSat, 7);
}

function toISODate(date) {
  if (!date || isNaN(date.getTime())) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ---------- GESTIONE LINGUA CHIAMATA ----------

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
        t.includes("not understanding") ||
        t.includes("don't understand") ||
        t.includes("dont understand") ||
        t.includes("non capisco")));

  if (wantsItalian) {
    setCallLanguage(callId, "it-IT");
  }
}

// ---------- RICONOSCIMENTO DOMANDE EMAIL RISTORANTE ----------

function isRestaurantEmailQuestion(text = "") {
  const t = text.toLowerCase();

  // se parla della "mia mail" / "my email" NON è la mail del ristorante
  if (
    t.includes("mia mail") ||
    t.includes("la mia mail") ||
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
    t.includes("indirizzo del ristorante") ||
    t.includes("mail del locale") ||
    t.includes("email del locale") ||
    t.includes("mail del posto") ||
    t.includes("email del posto") ||
    (t.includes("devo scrivere") && (t.includes("mail") || t.includes("email")))
  ) {
    return true;
  }

  // Inglese
  if (
    t.includes("restaurant email") ||
    t.includes("email of the restaurant") ||
    t.includes("restaurant's email") ||
    (t.includes("email address") && t.includes("restaurant")) ||
    (t.includes("where") && t.includes("email") && t.includes("restaurant"))
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
    t.includes("mi puoi fare lo spelling della mail") ||
    t.includes("come si scrive la vostra mail") ||
    t.includes("come si scrive la mail del ristorante") ||
    t.includes("how do you spell your email") ||
    t.includes("can you spell the email") ||
    t.includes("spell your email")
  );
}

// Converte un'email in una stringa "parlata" per il TTS
function spellEmailForTTS(email, lang = "it-IT") {
  if (!email || typeof email !== "string") return "";

  const [localPart, domainAndTld] = email.split("@");
  if (!localPart || !domainAndTld) return email;

  const domainParts = domainAndTld.split(".");
  const domain = domainParts[0] || "";
  const tld = domainParts.slice(1).join("."); // gestisce anche "co.uk"

  function spellCharIt(ch) {
    const lower = ch.toLowerCase();
    if (lower === "w") return "doppia vù";
    return ch; // Twilio leggerà la lettera
  }

  const localSpelled =
    lang === "en-US"
      ? localPart.split("").join(" ")
      : localPart
          .split("")
          .map(spellCharIt)
          .join(" ");

  const commonDomains = ["gmail", "outlook", "hotmail", "yahoo", "icloud"];
  const isCommonDomain = commonDomains.includes(domain.toLowerCase());

  const domainSpoken = isCommonDomain
    ? domain.toLowerCase() // "gmail", "outlook" ecc.
    : domain.split("").join(" ");

  const tldSpoken = tld || "";

  if (lang === "en-US") {
    let s = `${localSpelled} at ${domainSpoken}`;
    if (tldSpoken) s += ` dot ${tldSpoken}`;
    return s;
  } else {
    let s = `${localSpelled} chiocciola ${domainSpoken}`;
    if (tldSpoken) s += ` punto ${tldSpoken}`;
    return s;
  }
}

// Aggiunge un saluto finale se manca (per le risposte di chiusura)
function addClosingSalute(text = "", lang = "it-IT") {
  const t = text.toLowerCase();

  const hasItalianSalute =
    t.includes("buona serata") ||
    t.includes("a presto") ||
    t.includes("grazie");

  const hasEnglishSalute =
    t.includes("have a nice") ||
    t.includes("see you") ||
    t.includes("thank you");

  if (hasItalianSalute || hasEnglishSalute) return text;

  if (lang === "en-US") {
    return text + " Thank you, have a nice evening.";
  }

  return text + " Ti aspettiamo, buona serata.";
}

// Sanifica l'indirizzo email: rimuove tutti gli spazi
function sanitizeEmail(email) {
  if (!email || typeof email !== "string") return null;
  const cleaned = email.replace(/\s+/g, "");
  return cleaned || null;
}

// Estrae una email da una frase libera (se presente)
function extractEmailFromText(text) {
  if (!text || typeof text !== "string") return null;
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0] : null;
}

// Unisce la nuova reservation con quella già salvata per la chiamata
function mergeReservationForCall(callId, newRes = {}) {
  const prev = callReservations.get(callId) || {};

  const merged = {
    date: newRes.date ?? prev.date ?? null,
    time: newRes.time ?? prev.time ?? null,
    people:
      newRes.people !== undefined && newRes.people !== null
        ? newRes.people
        : prev.people ?? null,
    name: newRes.name ?? prev.name ?? null,
    customerEmail: newRes.customerEmail ?? prev.customerEmail ?? null,
  };

  callReservations.set(callId, merged);
  return merged;
}

// ---------- GESTIONE DATA/ORA DAL TESTO ----------

// Prende da TUTTA la conversazione utente parole tipo
// "domani", "dopo domani", "dopodomani", "stasera", "oggi",
// "tomorrow", "day after tomorrow", "tonight", "this evening", "today",
// "this weekend", "next saturday", giorni della settimana IT/EN, ecc.
function inferDateFromConversation(callId) {
  const allUserTextRaw = getAllUserText(callId);
  const t = normalizeText(allUserTextRaw);

  if (!t.trim()) return null;

  const nowRome = getNowInRome();
  const today = startOfDay(nowRome);
  let inferredDate = null;

  // Espressioni speciali: vigilia di Natale / Christmas Eve
  if (/vigilia di natale|christmas eve/.test(t)) {
    inferredDate = new Date(today.getFullYear(), 11, 24); // 24 dicembre
    const iso = toISODate(inferredDate);
    console.log("📆 Data inferita (Christmas Eve):", iso);
    return iso;
  }

  // Capodanno / New Year's Eve
  if (/capodanno|new years eve|new year's eve/.test(t)) {
    inferredDate = new Date(today.getFullYear(), 11, 31); // 31 dicembre
    const iso = toISODate(inferredDate);
    console.log("📆 Data inferita (New Year's Eve):", iso);
    return iso;
  }

  // stanotte / midnight -> consideriamo come 00:00 del giorno dopo
  if (/stanotte|a mezzanotte|tonight at midnight/.test(t) || /\bmidnight\b/.test(t)) {
    inferredDate = addDays(today, 1);
    const iso = toISODate(inferredDate);
    console.log("📆 Data inferita (stanotte/midnight):", iso);
    return iso;
  }

  // Espressioni relative IT/EN
  if (/day after tomorrow|dopodomani|dopo domani/.test(t)) {
    inferredDate = addDays(today, 2);
  } else if (/tomorrow|domani/.test(t)) {
    inferredDate = addDays(today, 1);
  } else if (/oggi\b|today\b/.test(t)) {
    inferredDate = today;
  } else if (/stasera|questa sera|tonight|this evening/.test(t)) {
    inferredDate = today;
  }

  // Se abbiamo già inferredDate dalle relative, usciamo
  if (inferredDate) {
    const iso = toISODate(inferredDate);
    console.log("📆 Data inferita (relative):", iso);
    return iso;
  }

  // this weekend / questo weekend
  const mentionsWeekend = t.includes("weekend") || t.includes("fine settimana");
  const mentionsSunday = t.includes("domenica") || t.includes("sunday");
  const mentionsSaturday = t.includes("sabato") || t.includes("saturday");

  // giorni della settimana (IT + EN)
  const weekdays = [
    { it: "domenica", en: "sunday", index: 0 },
    { it: "lunedi", en: "monday", index: 1 },
    { it: "martedi", en: "tuesday", index: 2 },
    { it: "mercoledi", en: "wednesday", index: 3 },
    { it: "giovedi", en: "thursday", index: 4 },
    { it: "venerdi", en: "friday", index: 5 },
    { it: "sabato", en: "saturday", index: 6 },
  ];

  let targetWeekday = null;

  // "sabato prossimo" / "next saturday" / "questo sabato" / "this saturday"
  // li gestiamo con logica dedicata
  if (t.includes("sabato prossimo") || t.includes("next saturday")) {
    inferredDate = getNextSaturday(today);
    const iso = toISODate(inferredDate);
    console.log("📆 Data inferita (sabato prossimo/next Saturday):", iso);
    return iso;
  }
  if (t.includes("questo sabato") || t.includes("this saturday")) {
    inferredDate = getThisSaturday(today);
    const iso = toISODate(inferredDate);
    console.log("📆 Data inferita (questo sabato/this Saturday):", iso);
    return iso;
  }

  // Giorni della settimana generici
  for (const w of weekdays) {
    if (t.includes(w.it) || t.includes(w.en)) {
      targetWeekday = w.index;
      break;
    }
  }

  if (targetWeekday !== null) {
    inferredDate = getNextWeekday(today, targetWeekday);
    const iso = toISODate(inferredDate);
    console.log("📆 Data inferita (weekday generico):", iso);
    return iso;
  }

  // "this weekend": se dice anche domenica → domenica, altrimenti sabato
  if (mentionsWeekend) {
    if (mentionsSunday) {
      inferredDate = getNextWeekday(today, 0); // domenica
    } else {
      inferredDate = getThisSaturday(today);
    }
    const iso = toISODate(inferredDate);
    console.log("📆 Data inferita (this weekend):", iso);
    return iso;
  }

  return null;
}

// Normalizza la data/ora della prenotazione per il Calendar
function normalizeReservationForCalendar(reservation = {}, callId) {
  let { date, time, people, name, customerEmail } = reservation;

  // se il modello ha messo "null" come stringa, trattalo come null
  if (date === "null") date = null;

  // 1) se riusciamo a capire "oggi/domani/dopodomani/tonight/tomorrow/this saturday", usiamo quella
  const inferred = inferDateFromConversation(callId);
  if (inferred) {
    date = inferred;
  } else if (typeof date === "string" && date.trim() !== "") {
    // 2) se è una data esplicita, evitiamo prenotazioni nel passato
    const parts = date.split("-");
    if (parts.length === 3) {
      let [y, m, d] = parts.map((p) => p.trim());
      const yearNum = parseInt(y, 10);
      const monthNum = parseInt(m, 10);
      const dayNum = parseInt(d, 10);

      if (!isNaN(yearNum) && !isNaN(monthNum) && !isNaN(dayNum)) {
        let candidate = new Date(yearNum, monthNum - 1, dayNum);
        const todayRome = startOfDay(getNowInRome());

        // Se la data è nel passato, spostala in avanti di anni
        // fino a quando non è almeno oggi (prossimo periodo).
        while (candidate.getTime() < todayRome.getTime()) {
          candidate.setFullYear(candidate.getFullYear() + 1);
        }

        date = toISODate(candidate);
      }
    }
  }

  // 3) Inferenza orario di default se mancante (pranzo/sera/stanotte/late)
  if (!time) {
    const allUserTextRaw = getAllUserText(callId);
    const t = normalizeText(allUserTextRaw);

    if (/stanotte|a mezzanotte|tonight at midnight/.test(t) || /\bmidnight\b/.test(t)) {
      time = "00:00:00";
    } else if (/pranzo|lunch\b/.test(t)) {
      time = "13:00:00";
    } else if (/sera\b|serale\b|evening\b|night\b|stasera|questa sera|tonight|this evening/.test(t)) {
      time = "20:00:00";
    } else if (/ultimo orario|ultima ora|late dinner|latest time|late booking|very late/.test(t)) {
      time = "22:30:00";
    }
  }

  // sanifica email se presente
  if (customerEmail) {
    customerEmail = sanitizeEmail(customerEmail);
  }

  return { date, time, people, name, customerEmail };
}

// Invio dati a Google Apps Script per creare/aggiornare/cancellare evento su Calendar
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
  } catch (e) {
    data = { rawResponse: text };
  }

  if (!response.ok) {
    console.error("❌ Errore Apps Script:", data);
    throw new Error("Errore Apps Script");
  }

  console.log("✅ Risposta da Apps Script:", data);
  return data;
}

// ---------- CONTESTO RISTORANTE (get_context) ----------

async function fetchRestaurantContext() {
  try {
    const url = `${APPS_SCRIPT_URL}?action=get_context`;
    console.log("🌐 Chiamata get_context:", url);

    const response = await fetch(url);
    const text = await response.text();
    let data;

    try {
      data = JSON.parse(text);
    } catch (e) {
      console.error("❌ Risposta get_context non JSON:", text);
      data = null;
    }

    if (!response.ok || !data || data.success === false) {
      console.error("❌ Errore get_context:", data);
      throw new Error("get_context non valido");
    }

    console.log("✅ Context ricevuto:", JSON.stringify(data, null, 2));
    return data;
  } catch (err) {
    console.error("❌ Errore chiamando get_context:", err);

    // Fallback minimale ma valido
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
  if (callContexts.has(callId)) {
    return callContexts.get(callId);
  }
  const ctx = await fetchRestaurantContext();
  callContexts.set(callId, ctx);
  return ctx;
}

function getContextForCall(callId) {
  return callContexts.get(callId) || null;
}

function getThresholdsForCall(callId) {
  const ctx = getContextForCall(callId);
  const largeGroupThreshold =
    ctx && ctx.rules && typeof ctx.rules.largeGroupThreshold === "number"
      ? ctx.rules.largeGroupThreshold
      : LARGE_GROUP_THRESHOLD_DEFAULT;
  const eventThreshold =
    ctx && ctx.rules && typeof ctx.rules.eventThreshold === "number"
      ? ctx.rules.eventThreshold
      : EVENT_THRESHOLD_DEFAULT;
  return { largeGroupThreshold, eventThreshold };
}

function getRestaurantEmailForCall(callId) {
  const ctx = getContextForCall(callId);
  if (ctx && ctx.restaurant && ctx.restaurant.email) {
    return ctx.restaurant.email;
  }
  return OWNER_EMAIL_DEFAULT;
}

function getRestaurantNameForCall(callId) {
  const ctx = getContextForCall(callId);
  if (ctx && ctx.restaurant && ctx.restaurant.name) {
    return ctx.restaurant.name;
  }
  return DEFAULT_RESTAURANT_NAME;
}

// ---------- SYSTEM PROMPT DINAMICO ----------

function buildSystemPrompt(context) {
  const restaurantName =
    (context && context.restaurant && context.restaurant.name) ||
    DEFAULT_RESTAURANT_NAME;
  const restaurantEmail =
    (context && context.restaurant && context.restaurant.email) ||
    OWNER_EMAIL_DEFAULT;
  const address =
    (context && context.restaurant && context.restaurant.address) || "";
  const phone =
    (context && context.restaurant && context.restaurant.phone) || "";
  const timezone =
    (context && context.restaurant && context.restaurant.timezone) ||
    "Europe/Rome";
  const openingHoursText =
    (context &&
      context.restaurant &&
      context.restaurant.openingHoursText) ||
    "";
  const closingRulesText =
    (context &&
      context.restaurant &&
      context.restaurant.closingRulesText) ||
    "";

  const menuSummaryText =
    (context && context.menu && context.menu.summaryText) || "";
  const vegetarianText =
    (context && context.menu && context.menu.vegetarianText) || "";
  const glutenFreeText =
    (context && context.menu && context.menu.glutenFreeText) || "";
  const priceRangeText =
    (context && context.menu && context.menu.priceRangeText) || "";

  const largeGroupThreshold =
    context && context.rules && typeof context.rules.largeGroupThreshold === "number"
      ? context.rules.largeGroupThreshold
      : LARGE_GROUP_THRESHOLD_DEFAULT;
  const eventThreshold =
    context && context.rules && typeof context.rules.eventThreshold === "number"
      ? context.rules.eventThreshold
      : EVENT_THRESHOLD_DEFAULT;
  const outdoorSeatingText =
    (context && context.rules && context.rules.outdoorSeatingText) || "";
  const bookingPolicyText =
    (context && context.rules && context.rules.bookingPolicyText) || "";

  const basePrompt = `
Sei ${RECEPTIONIST_NAME}, la receptionist di un ristorante italiano chiamato ${restaurantName}.

SYSTEM PROMPT DEFINITIVO — BLOCCO 1/3
=====================================

INTRODUZIONE E REGOLE FONDAMENTALI

Sei GIULIA, la receptionist virtuale del ristorante.
Il tuo compito è parlare in modo naturale, umano, professionale e sintetico,
rispondendo sempre e solo attraverso un oggetto JSON valido.

LINGUA
- Rispondi nella stessa lingua dell’ultimo messaggio del cliente (IT o EN).
- Non mescolare mai le lingue.
- Tono caldo, educato, telefonico, NON da email.

STILE
- Risposte brevi: 1–2 frasi (5–7 secondi di audio).
- Mai frasi inutili, mai monologhi.
- Fai quasi sempre una domanda, tranne nella risposta finale (create_reservation).

REGOLE TELEFONICHE
- Sei una receptionist umana, NON un chatbot.
- NON citare mai IA, modelli linguistici o tecnologia.
- Non dire mai “JSON”, “action”, “sistema”, ecc. nel reply_text.
- Il reply_text deve sembrare un audio reale.

OBIETTIVO
- Gestire prenotazioni, cambi prenotazione, cancellazioni.
- Rispondere a domande su menu, orari, prezzi, allergie.

FORMATO DI USCITA (rigidissimo)
Rispondi SOLO con:

{
  "reply_text": "...",
  "action": "none | ask_date | ask_time | ask_people | ask_name | ask_email | answer_menu | answer_generic | create_reservation | cancel_reservation",
  "reservation": {
    "date": "YYYY-MM-DD oppure null",
    "time": "HH:MM:SS oppure null",
    "people": numero oppure null,
    "name": "nome oppure null",
    "customerEmail": "email del cliente oppure null"
  }
}

TUTTO fuori da questo JSON è vietato.

RICHIAMI IMPORTANTI
- Mai multiple actions.
- Mai testo fuori JSON.
- Mai testo prima o dopo il JSON.
- Mai campi extra.
- Mai scrivere domande nella risposta finale (create_reservation).


SYSTEM PROMPT DEFINITIVO — BLOCCO 2/3
=====================================

GESTIONE PRENOTAZIONI — LOGICA CENTRALE

1) RACCOLTA INIZIALE
- Se il cliente vuole prenotare, inizia sempre chiedendo DUE informazioni insieme:
  IT: "Per quando e per quante persone?"
  EN: "For what day and how many people?"
- Evita micro-domande separate se puoi combinarle.

2) RICONOSCIMENTO DATE
- Interpreta sempre espressioni relative:
  "oggi" → oggi
  "domani" → +1 giorno
  "dopodomani" → +2 giorni
  "stasera" / "questa sera" → oggi, orario serale
  "domani sera" → domani, orario serale
  EN:
  "today" → today
  "tomorrow" → +1 day
  "day after tomorrow" → +2 days
  "tonight" / "this evening" → today evening
- Nei reply_text mantieni la forma relativa:
  es. “domani sera alle 20:00”.
- In reservation.date usa sempre YYYY-MM-DD.

3) RICONOSCIMENTO ORARI
- “alle 8 / alle 9” → 20:00 / 21:00.
- Se specifica mattina/pomeriggio → rispetta.
- In reservation.time usa HH:MM:SS.

4) NUMERO PERSONE
- “da 3 a 4 persone” → 4.
- “ci raggiunge un amico” → “Quante persone in totale?”
- Se cambia idea → sovrascrivi.

5) NOME
- Se lo ha già detto → NON chiedere.

6) EMAIL
- Normale → facoltativa.
- Grandi gruppi → raccomandata.
- Eventi → quasi obbligatoria.
- Spelling IT/EN + conferma obbligatoria.

7) LOGICA ASK
- ask_date → manca data
- ask_time → manca ora
- ask_people → mancano persone
- ask_name → manca nome
- ask_email → manca email
- answer_menu / answer_generic → info (reservation = null)

8) CREATE_RESERVATION → risposta finale
- Nessuna domanda.
- Saluto finale.
- Tutti i campi essenziali compilati.

9) CANCELLAZIONE
- Usa cancel_reservation solo se vuole annullare davvero.

10) CAMBIO PRENOTAZIONE
- Usare create_reservation (aggiorna automaticamente).

SYSTEM PROMPT DEFINITIVO — BLOCCO 3/3
=====================================

GESTIONE GRANDI GRUPPI
- people > largeGroupThreshold e < eventThreshold:
  - raccogli info complete
  - email raccomandata
  - prenotazione soggetta a conferma
  - anche senza email → procedi
  - action = create_reservation

GESTIONE EVENTI
- >= eventThreshold:
  - NON rifiutare
  - spiegare che è un evento
  - raccogli tutto + email
  - anche senza email → procedi
  - action = create_reservation

RISPOSTE INFORMATIVE
- answer_menu o answer_generic
- reservation.* = null

REGOLE SICUREZZA
- Mai creare prenotazione senza data/orario/nome
- Mai chiedere email se inutile
- Mai testo fuori JSON
- Mai campi extra
- Una sola domanda se cliente confuso

REGOLA FINALE (create_reservation)
- Conferma + saluto
- Mai domande
- Linguaggio naturale

VALIDITÀ JSON
- JSON deve essere sempre valido, con le 5 chiavi.
`;

  const contextBlock = `
CONTESTO RISTORANTE (AGGIORNATO DAL GESTIONALE):

- Nome ristorante: ${restaurantName}
- Email ufficiale: ${restaurantEmail}
- Indirizzo: ${address || "non specificato"}
- Telefono: ${phone || "non specificato"}
- Fuso orario: ${timezone}
- Orari di apertura: ${openingHoursText || "non specificati"}
- Regole di chiusura: ${closingRulesText || "non specificate"}

INFORMAZIONI SU MENÙ E PREZZI:
- Descrizione menù: ${menuSummaryText || "non specificata"}
- Opzioni vegetariane: ${vegetarianText || "non specificate"}
- Opzioni senza glutine: ${glutenFreeText || "non specificate"}
- Fascia di prezzo indicativa: ${priceRangeText || "non specificata"}

REGOLE E POLICY:
- Soglia gruppi numerosi: ${largeGroupThreshold} persone.
- Soglia eventi privati: ${eventThreshold} persone.
- Posti all'aperto: ${outdoorSeatingText || "non specificati"}
- Policy prenotazione tavolo: ${bookingPolicyText || "non specificata"}

Quando rispondi ai clienti, usa SEMPRE queste informazioni come fonte principale.
`;

  return basePrompt + contextBlock;
}


// ---------- GPT: helpers per JSON ----------

function extractJsonFromText(text = "") {
  const match = text.match(/{[\s\S]*}/);
  if (match) return match[0];
  return text;
}

// ---------- GPT: funzione ottimizzata ----------
async function askGiulia(callId, userText) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    console.error("❌ Manca OPENAI_API_KEY nelle Environment Variables di Render");
    throw new Error("OPENAI_API_KEY non impostata");
  }

  // Assicura che il contesto del ristorante sia caricato
  await ensureContextForCall(callId);
  const context = getContextForCall(callId);

  let convo = conversations.get(callId);
  if (!convo) {
    // Primo messaggio: system con prompt dinamico + contesto ristorante
    const systemPrompt = buildSystemPrompt(context);
    convo = {
      messages: [{ role: "system", content: systemPrompt }],
    };
  }

  // Aggiungiamo il messaggio dell’utente
  convo.messages.push({ role: "user", content: userText });

  // Limitiamo la cronologia: system + ultimi 5 messaggi
  if (convo.messages.length > 7) {
    const systemMsg = convo.messages[0];
    const recent = convo.messages.slice(-5);
    convo.messages = [systemMsg, ...recent];
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: convo.messages,
      max_completion_tokens: 200,
      temperature: 0.3,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("❌ Errore dalla API OpenAI:", response.status, errorText);
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const data = await response.json();
  console.log("📦 FULL OpenAI response:", JSON.stringify(data, null, 2));

  const content = data.choices?.[0]?.message?.content;
  let raw = "";

  if (typeof content === "string") {
    raw = content.trim();
  } else if (Array.isArray(content)) {
    raw = content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part.text === "string") return part.text;
        if (part && typeof part.content === "string") return part.content;
        return "";
      })
      .join("")
      .trim();
  }

  console.log("🧠 Risposta raw da GPT:", raw || "<vuoto>");

  const fallback = {
    reply_text:
      "Scusa, c'è stato un problema tecnico, puoi ripetere per favore?",
    action: "none",
    reservation: {
      date: null,
      time: null,
      people: null,
      name: null,
      customerEmail: null,
    },
  };

  let parsed = fallback;

  if (!raw) {
    console.warn("⚠️ Nessun contenuto nel messaggio GPT, uso fallback.");
  } else {
    const jsonCandidate = extractJsonFromText(raw);
    try {
      parsed = JSON.parse(jsonCandidate);
    } catch (e) {
      console.error("❌ JSON non valido restituito da GPT, uso fallback:", e);
      parsed = fallback;
    }
  }

  if (!parsed || typeof parsed !== "object") {
    parsed = fallback;
  }
  if (typeof parsed.reply_text !== "string" || !parsed.reply_text.trim()) {
    parsed.reply_text =
      "Scusa, non ho capito bene. Puoi ripetere per favore?";
  }
  if (!parsed.action) {
    parsed.action = "none";
  }
  if (!parsed.reservation || typeof parsed.reservation !== "object") {
    parsed.reservation = {
      date: null,
      time: null,
      people: null,
      name: null,
      customerEmail: null,
    };
  } else {
    // Alias di sicurezza: se il modello usa "customer_email" invece di "customerEmail"
    if (
      Object.prototype.hasOwnProperty.call(
        parsed.reservation,
        "customer_email"
      ) &&
      !Object.prototype.hasOwnProperty.call(
        parsed.reservation,
        "customerEmail"
      )
    ) {
      parsed.reservation.customerEmail = parsed.reservation.customer_email;
    }

    if (
      !Object.prototype.hasOwnProperty.call(
        parsed.reservation,
        "customerEmail"
      )
    ) {
      parsed.reservation.customerEmail = null;
    }
  }

  // Sanifica l'email nel JSON della prenotazione
  if (
    parsed.reservation &&
    typeof parsed.reservation.customerEmail === "string"
  ) {
    parsed.reservation.customerEmail = sanitizeEmail(
      parsed.reservation.customerEmail
    );
  }

  // 1) Se manca customerEmail ma nella frase c'è un indirizzo email, estrailo dal testo utente
  if (parsed.reservation && !parsed.reservation.customerEmail) {
    const fromText = extractEmailFromText(userText);
    if (fromText) {
      parsed.reservation.customerEmail = sanitizeEmail(fromText);
    }
  }

  // 2) Unisci la reservation attuale con quella già salvata per questa chiamata
  parsed.reservation = mergeReservationForCall(
    callId,
    parsed.reservation || {}
  );

  // SAFETY NET 1: se l'action è ask_name ma il nome è già presente → chiedi l'email
  if (
    parsed.action === "ask_name" &&
    parsed.reservation &&
    parsed.reservation.name &&
    String(parsed.reservation.name).trim() !== ""
  ) {
    console.warn("⚠️ ask_name con name già presente, converto in ask_email");
    parsed.action = "ask_email";
  }

  // SAFETY NET 2: se è una risposta solo-informazioni, azzera tutta la reservation
  if (parsed.action === "answer_menu" || parsed.action === "answer_generic") {
    parsed.reservation = {
      date: null,
      time: null,
      people: null,
      name: null,
      customerEmail: null,
    };
  }

  // SAFETY NET 3: create_reservation senza dati minimi → declassa ad ask_*
  if (parsed.action === "create_reservation") {
    const r = parsed.reservation || {};
    const hasDate = r.date && String(r.date).trim() !== "";
    const hasTime = r.time && String(r.time).trim() !== "";
    const hasName = r.name && String(r.name).trim() !== "";

    if (!hasDate || !hasTime || !hasName) {
      console.warn(
        "⚠️ create_reservation senza data/ora/nome completi, declasso ad ask_*",
        parsed.reservation
      );
      if (!hasDate) {
        parsed.action = "ask_date";
      } else if (!hasTime) {
        parsed.action = "ask_time";
      } else if (!hasName) {
        parsed.action = "ask_name";
      }
    }
  }

  // SAFETY NET 4: se chiede ancora ask_email ma abbiamo già email + dati completi
  // → promuovi a create_reservation SOLO se la reply_text NON è una domanda
  if (parsed.action === "ask_email") {
    const r = parsed.reservation || {};
    const hasDate = r.date && String(r.date).trim() !== "";
    const hasTime = r.time && String(r.time).trim() !== "";
    const hasName = r.name && String(r.name).trim() !== "";
    const hasEmail =
      r.customerEmail && String(r.customerEmail).trim() !== "";

    const isQuestion =
      typeof parsed.reply_text === "string" &&
      parsed.reply_text.includes("?");

    if (hasDate && hasTime && hasName && hasEmail && !isQuestion) {
      console.warn(
        "⚠️ ask_email ma abbiamo già data/ora/nome/email e la risposta non è una domanda → promuovo a create_reservation"
      );
      parsed.action = "create_reservation";
    }
  }

  convo.messages.push({
    role: "assistant",
    content: raw || JSON.stringify(parsed),
  });
  conversations.set(callId, convo);

  return parsed;
}

// ---------- ROUTE DI TEST ----------
app.get("/", (req, res) => {
  res
    .status(200)
    .send("✅ Receptionist AI Gateway è attivo e funzionante su Render!");
});

// ---------- /calendar ----------
app.post("/calendar", async (req, res) => {
  try {
    console.log("📩 Richiesta su /calendar:", req.body);
    const data = await sendToCalendar(req.body);
    return res.status(200).json({ success: true, fromAppsScript: data });
  } catch (error) {
    console.error("Errore /calendar:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// ---------- ROTTE CONFERMA/ANNULLA GRANDI GRUPPI ----------

app.get("/owner/large-group/confirm", async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) {
      return res.status(400).send("Token mancante.");
    }

    const json = Buffer.from(token, "base64").toString("utf8");
    const payload = JSON.parse(json);
    const { eventId, date, time, people, name, customerEmail, phone } =
      payload;

    const response = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "confirm_large_group",
        eventId,
        date,
        time,
        people,
        name,
        customerEmail,
        phone,
      }),
    });

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      console.error("❌ Risposta non JSON da Apps Script (confirm_large_group):", text);
      data = null;
    }

    if (!response.ok || !data) {
      console.error("❌ Errore Apps Script conferma large group:", data);
      return res.status(500).send(`
        <html>
          <body style="font-family: system-ui; padding: 24px;">
            <h2>Errore durante la conferma ⚠️</h2>
            <p>Si è verificato un problema tecnico durante la conferma della prenotazione.</p>
            <p>Ti consigliamo di verificare manualmente il calendario e le email e, in caso di dubbi, contattare il cliente.</p>
          </body>
        </html>
      `);
    }

    // Caso OK: confermata davvero
    if (data.success && data.status === "CONFIRMED") {
      return res.send(`
        <html>
          <body style="font-family: system-ui; padding: 24px;">
            <h2>Prenotazione confermata ✅</h2>
            <p>Hai confermato la prenotazione per <strong>${people} persone</strong>, a nome <strong>${name}</strong>, il <strong>${date}</strong> alle <strong>${time}</strong>.</p>
            <p>Se il cliente ha fornito un'email valida, ha ricevuto una conferma automatica.</p>
          </body>
        </html>
      `);
    }

    // Caso capacità piena: non confermata per capienza (usa reason = slot_full)
    if (data.reason === "slot_full") {
      return res.send(`
        <html>
          <body style="font-family: system-ui; padding: 24px;">
            <h2>Impossibile confermare la prenotazione ❌</h2>
            <p>Per motivi di <strong>capienza</strong> non è stato possibile confermare la prenotazione per <strong>${people} persone</strong>, a nome <strong>${name}</strong>, il <strong>${date}</strong> alle <strong>${time}</strong>.</p>
            <p>Il cliente è già stato avvisato via email della mancata conferma (se ha fornito un indirizzo email).</p>
            <p>Se lo ritieni opportuno, puoi contattarlo per proporre un altro giorno o orario.</p>
          </body>
        </html>
      `);
    }

    // Esito incerto/altro tipo di errore logico
    return res.send(`
      <html>
        <body style="font-family: system-ui; padding: 24px;">
          <h2>Esito non chiaro ⚠️</h2>
          <p>La richiesta di conferma non ha restituito uno stato chiaro.</p>
          <p>Ti consigliamo di controllare il calendario e le email per verificare la situazione di questa prenotazione.</p>
        </body>
      </html>
    `);
  } catch (err) {
    console.error("Errore conferma large group:", err);
    res
      .status(500)
      .send("Errore interno durante la conferma della prenotazione.");
  }
});

app.get("/owner/large-group/cancel", async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) {
      return res.status(400).send("Token mancante.");
    }

    const json = Buffer.from(token, "base64").toString("utf8");
    const payload = JSON.parse(json);
    const { eventId, date, time, people, name, customerEmail, phone } =
      payload;

    await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "cancel_large_group",
        eventId,
        date,
        time,
        people,
        name,
        customerEmail,
        phone,
      }),
    });

    res.send(`
      <html>
        <body style="font-family: system-ui; padding: 24px;">
          <h2>Prenotazione annullata ❌</h2>
          <p>Hai annullato la richiesta per <strong>${people} persone</strong>, a nome <strong>${name}</strong>, il <strong>${date}</strong> alle <strong>${time}</strong>.</p>
          <p>Se il cliente aveva lasciato un'email, potrebbe ricevere una comunicazione automatica di annullamento.</p>
        </body>
      </html>
    `);
  } catch (err) {
    console.error("Errore cancellazione large group:", err);
    res
      .status(500)
      .send("Errore interno durante l'annullamento della prenotazione.");
  }
});

// ---------- /twilio ----------
app.post("/twilio", async (req, res) => {
  const { CallSid, SpeechResult, text, From, Language } = req.body || {};
  const { postFinal } = req.query || {};
  const isDebug = !!text && !SpeechResult;
  const callId = CallSid || (isDebug ? "debug-call" : "unknown-call");

  console.log("📞 /twilio body:", req.body);
  console.log("📲 Numero chiamante (From):", From, "postFinal:", postFinal);

  // Modalità debug via curl (JSON in/out)
  if (isDebug) {
    try {
      const giulia = await askGiulia(callId, text.trim());
      return res.status(200).json(giulia);
    } catch (error) {
      console.error("Errore /twilio debug:", error);
      return res.status(500).json({
        error: "Errore interno chiamando GPT",
        details: error.message,
      });
    }
  }

  // Primo ingresso: nessun SpeechResult -> messaggio di benvenuto (default IT)
  if (!SpeechResult) {
    setCallLanguage(callId, "it-IT");

    // Carico subito il contesto per avere il nome corretto del ristorante
    const ctx = await ensureContextForCall(callId);
    const restaurantName =
      (ctx && ctx.restaurant && ctx.restaurant.name) ||
      DEFAULT_RESTAURANT_NAME;

    const welcomeText = `Ciao, sono ${RECEPTIONIST_NAME} del ${restaurantName}. Come posso aiutarti oggi?`;

    const twiml = `
      <Response>
        <Gather
          input="speech"
          language="it-IT"
          action="${BASE_URL}/twilio"
          method="POST"
          timeout="5"
          speechTimeout="auto"
        >
          <Say language="it-IT" bargeIn="true">
            ${escapeXml(welcomeText)}
          </Say>
        </Gather>
        <Say language="it-IT">
          Non ho ricevuto risposta. Ti chiediamo di richiamare più tardi. Grazie e buona serata.
        </Say>
      </Response>
    `.trim();

    return res.status(200).type("text/xml").send(twiml);
  }

  // Gestione finestra finale: solo "grazie" → saluto e chiudi
  if (postFinal === "1") {
    const userTextRaw = SpeechResult.trim();
    const lower = userTextRaw.toLowerCase();
    console.log("👤 Utente dopo prenotazione:", userTextRaw);

    appendUserText(callId, userTextRaw);
    maybeSwitchToEnglish(callId, userTextRaw);
    maybeSwitchToItalian(callId, userTextRaw);
    const currentLang = getCallLanguage(callId);

    const isThanksOnly =
      /grazie|thank you|thanks/.test(lower) &&
      !/cambia|change|sposta|modifica|orario|time/.test(lower);

    if (isThanksOnly) {
      const goodbyeText =
        currentLang === "en-US"
          ? "Thank you, have a nice evening."
          : "Grazie a te, buona serata.";

      const goodbyeTwiml = `
        <Response>
          <Say language="${currentLang}">
            ${escapeXml(goodbyeText)}
          </Say>
          <Hangup/>
        </Response>
      `.trim();

      return res.status(200).type("text/xml").send(goodbyeTwiml);
    }
  }

  // Flusso normale Twilio (voce)
  try {
    const userText = SpeechResult.trim();
    console.log("👤 Utente dice:", userText);

    // Allineo la lingua alla STT di Twilio
    if (Language && typeof Language === "string") {
      const lowerLang = Language.toLowerCase();
      if (lowerLang.startsWith("en")) {
        setCallLanguage(callId, "en-US");
      } else if (lowerLang.startsWith("it")) {
        setCallLanguage(callId, "it-IT");
      }
    }

    // Assicuro contesto caricato
    await ensureContextForCall(callId);

    // Salvo il testo utente nella cronologia "grezza"
    appendUserText(callId, userText);

    maybeSwitchToEnglish(callId, userText);
    maybeSwitchToItalian(callId, userText);
    const currentLang = getCallLanguage(callId);
    const sayLang = currentLang;

    const restaurantEmail = getRestaurantEmailForCall(callId);

    // Shortcut: l'utente chiede l'email del ristorante o lo spelling
    if (
      isRestaurantEmailQuestion(userText) ||
      isRestaurantEmailSpellingRequest(userText)
    ) {
      const spelled = spellEmailForTTS(restaurantEmail, currentLang);

      const reply =
        currentLang === "en-US"
          ? `The restaurant email is ${restaurantEmail}. I'll spell it: ${spelled}.`
          : `L'email del ristorante è ${restaurantEmail}. Te la scandisco: ${spelled}.`;

      const twimlEmail = `
        <Response>
          <Gather
            input="speech"
            language="${currentLang}"
            action="${BASE_URL}/twilio"
            method="POST"
            timeout="5"
            speechTimeout="auto"
          >
            <Say language="${sayLang}" bargeIn="true">
              ${escapeXml(reply)}
            </Say>
          </Gather>
          <Say language="${sayLang}">
            ${escapeXml(
              currentLang === "en-US"
                ? "If you need anything else, please call us again. Thank you."
                : "Se hai bisogno di altro, richiamaci pure. Grazie."
            )}
          </Say>
        </Response>
      `.trim();

      return res.status(200).type("text/xml").send(twimlEmail);
    }

    const giulia = await askGiulia(callId, userText);
    let replyText =
      giulia.reply_text ||
      "Scusa, non ho capito bene. Puoi ripetere per favore?";
    let action = giulia.action || "none";

    // Protezione: create_reservation con ancora domanda → declassa ad ask_time
    if (action === "create_reservation" && /\?/.test(replyText)) {
      console.warn(
        "⚠️ create_reservation con domanda nella reply_text, declasso ad ask_time"
      );
      action = "ask_time";
    }

    let slotFull = false;
    let isLargeGroupReservation = false;
    let isHugeEventReservation = false;

    // 🔥 PATCH: gestisci EVENTO GIGANTE anche se il modello non usa create_reservation
    if (giulia.reservation) {
      const normalizedHuge = normalizeReservationForCalendar(
        giulia.reservation,
        callId
      );
      let { date, time, people, name, customerEmail } = normalizedHuge;

      const { eventThreshold } = getThresholdsForCall(callId);
      const numericPeople =
        typeof people === "number" && !isNaN(people) ? people : null;

      // Riconosci frasette tipo "Sì, è corretta", "Yes, that's correct", ecc.
      const userConfirmsEmail = (() => {
        const t = (userText || "").toLowerCase().trim();
        return (
          t === "si" ||
          t === "sì" ||
          t.startsWith("sì, è corretta") ||
          t.startsWith("si, è corretta") ||
          t.startsWith("sì è corretta") ||
          t.startsWith("si è corretta") ||
          t === "yes" ||
          t.startsWith("yes,") ||
          t.includes("it is correct") ||
          t.includes("it's correct") ||
          t.includes("that is correct") ||
          t.includes("that's correct")
        );
      })();

      if (
        action !== "create_reservation" && // se fosse create_reservation usiamo il ramo sotto
        numericPeople !== null &&
        numericPeople >= eventThreshold &&
        date &&
        time &&
        name &&
        customerEmail &&
        userConfirmsEmail
      ) {
        isHugeEventReservation = true;

        console.log(
          "🔥 Patch evento gigante: forzo notify_big_event per",
          numericPeople,
          "persone"
        );

        // Invio email al proprietario tramite Apps Script
        await sendOwnerEmail({
          name,
          people: numericPeople,
          date,
          time,
          phone: From,
          customerEmail,
        });

        const restaurantEmailForCall = getRestaurantEmailForCall(callId);
        const spelledOwnerEmail = spellEmailForTTS(
          restaurantEmailForCall,
          currentLang
        );

        if (currentLang === "en-US") {
          replyText =
            `For bookings over ${eventThreshold} people we treat it as a private event. ` +
            `Please send an email to ${restaurantEmailForCall}; I'll spell it: ${spelledOwnerEmail}.`;
        } else {
          replyText =
            `Per prenotazioni sopra i ${eventThreshold} coperti le gestiamo come evento privato. ` +
            `Ti chiedo di mandare una mail a ${restaurantEmailForCall}; te la scandisco: ${spelledOwnerEmail}.`;
        }

        action = "none";
      }
    }

    // Gestione cancellazione prenotazione standard
    if (action === "cancel_reservation" && giulia.reservation) {
      const normalizedRes = normalizeReservationForCalendar(
        giulia.reservation,
        callId
      );
      const { date, time, name } = normalizedRes;

      if (!date) {
        if (currentLang === "en-US") {
          replyText =
            "I'm sorry, I didn't understand which booking you want to cancel. Could you please tell me the day of the reservation?";
        } else {
          replyText =
            "Mi dispiace, non ho capito quale prenotazione vuoi cancellare. Mi dici per quale giorno era la prenotazione?";
        }
        action = "ask_date";
      } else {
        try {
          const calendarRes = await sendToCalendar({
            action: "cancel_reservation",
            source: "twilio",
            nome: name || "",
            data: date,
            ora: time || null,
            telefono: From,
          });

          if (calendarRes && calendarRes.success) {
            if (currentLang === "en-US") {
              replyText =
                "Your reservation has been cancelled. We hope to see you another time. Have a nice evening.";
            } else {
              replyText =
                "Ho cancellato la tua prenotazione. Speriamo di vederti un'altra volta, buona serata.";
            }
          } else if (
            calendarRes &&
            calendarRes.reason === "reservation_not_found"
          ) {
            if (currentLang === "en-US") {
              replyText =
                "I couldn't find any booking with these details. Please contact the restaurant directly to cancel.";
            } else {
              replyText =
                "Non ho trovato nessuna prenotazione con questi dati. Ti chiedo di contattare direttamente il ristorante per annullare.";
            }
            action = "none";
          } else {
            console.error(
              "❌ Errore da Apps Script per cancel_reservation:",
              calendarRes
            );
            if (currentLang === "en-US") {
              replyText =
                "I'm sorry, there was a technical problem while cancelling. Please contact the restaurant directly.";
            } else {
              replyText =
                "Mi dispiace, c'è stato un problema tecnico durante l'annullamento. Ti chiedo di contattare direttamente il ristorante.";
            }
            action = "none";
          }
        } catch (calErr) {
          console.error("❌ Errore tecnico cancel_reservation:", calErr);
          if (currentLang === "en-US") {
            replyText =
              "I'm sorry, there was a technical problem. Please contact the restaurant directly.";
          } else {
            replyText =
              "Mi dispiace, c'è stato un problema tecnico. Ti chiedo di contattare direttamente il ristorante.";
          }
          action = "none";
        }
      }
    }

    // Se è una prenotazione finale, invia al Calendar (con controllo coperti)
    if (action === "create_reservation" && giulia.reservation) {
      const normalizedRes = normalizeReservationForCalendar(
        giulia.reservation,
        callId
      );
      let { date, time, people, name, customerEmail } = normalizedRes;

      const { largeGroupThreshold, eventThreshold } =
        getThresholdsForCall(callId);

      if (date && time && name) {
        const numericPeople =
          typeof people === "number" && !isNaN(people) ? people : null;

        // EVENTO GIGANTE: sopra eventThreshold
        if (numericPeople !== null && numericPeople >= eventThreshold) {
          isHugeEventReservation = true;

          await sendOwnerEmail({
            name,
            people: numericPeople,
            date,
            time,
            phone: From,
            customerEmail,
          });

          const restaurantEmailForCall = getRestaurantEmailForCall(callId);
          const spelledOwnerEmail = spellEmailForTTS(
            restaurantEmailForCall,
            currentLang
          );

          if (currentLang === "en-US") {
            replyText =
              `For bookings over ${eventThreshold} people we treat it as a private event. ` +
              `Please send an email to ${restaurantEmailForCall}; I'll spell it: ${spelledOwnerEmail}.`;
          } else {
            replyText =
              `Per prenotazioni sopra i ${eventThreshold} coperti le gestiamo come evento privato. ` +
              `Ti chiedo di mandare una mail a ${restaurantEmailForCall}; te la scandisco: ${spelledOwnerEmail}.`;
          }

          action = "none";
        } else {
          // Flusso normale: invio al Calendar ANCHE SE people è null
          try {
            const calendarRes = await sendToCalendar({
              source: "twilio",
              nome: name,
              persone: numericPeople,
              data: date,
              ora: time,
              telefono: From,
              email: customerEmail || "",
            });

            if (!calendarRes.success && calendarRes.reason === "slot_full") {
              slotFull = true;
              console.log(
                "⛔ Prenotazione rifiutata per capienza:",
                calendarRes
              );

              if (currentLang === "en-US") {
                replyText =
                  "I'm sorry, we are fully booked at that time. Would you like to try a different time or another day?";
              } else {
                replyText =
                  "Mi dispiace, a quell'ora siamo al completo. Vuoi provare con un altro orario o un altro giorno?";
              }

              action = "ask_time";
            } else if (calendarRes && calendarRes.success) {
              console.log("✅ Prenotazione creata/aggiornata:", {
                reservation: normalizedRes,
                fromAppsScript: calendarRes,
              });

              // Grande gruppo (ma non evento gigante): messaggio chiaro "soggetto a conferma"
              if (
                numericPeople !== null &&
                numericPeople > largeGroupThreshold
              ) {
                isLargeGroupReservation = true;

                if (currentLang === "en-US") {
                  replyText =
                    `I've registered your request for a table for ${numericPeople} people. ` +
                    "For large groups the booking is subject to confirmation by the restaurant; you will receive a confirmation by email or phone. Thank you and have a nice evening.";
                } else {
                  replyText =
                    `Ho registrato la tua richiesta di prenotazione per ${numericPeople} persone. ` +
                    "Per i gruppi numerosi la prenotazione è soggetta a conferma da parte del ristorante: riceverai una conferma via email o telefono. Grazie e buona serata.";
                }
              }
            } else {
              console.error(
                "❌ Errore nella creazione/aggiornamento prenotazione (non slot_full):",
                calendarRes
              );
              if (currentLang === "en-US") {
                replyText =
                  "I'm sorry, there was a problem with your booking. Could we try a different time or another day?";
              } else {
                replyText =
                  "Mi dispiace, c'è stato un problema con la prenotazione. Possiamo provare con un altro orario o un altro giorno?";
              }
              action = "ask_time";
            }
          } catch (calErr) {
            console.error("❌ Errore nella creazione prenotazione:", calErr);
            if (currentLang === "en-US") {
              replyText =
                "I'm sorry, there was a technical problem. Please try again in a few minutes.";
            } else {
              replyText =
                "Mi dispiace, c'è stato un problema tecnico. Per favore riprova tra qualche minuto.";
            }
            action = "none";
          }
        }
      } else {
        console.warn(
          "⚠️ create_reservation senza data/ora/nome:",
          normalizedRes
        );
      }
    }

    // chiudi la chiamata per:
    // - prenotazione finale andata a buon fine
    // - cancellazione andata a buon fine
    // - evento gigante (mandiamo mail al ristorante e stop)
    const shouldHangup =
      ((action === "create_reservation" || action === "cancel_reservation") &&
        !slotFull) ||
      isHugeEventReservation;

    let twiml;
    if (shouldHangup) {
      const finalReply =
        isLargeGroupReservation || isHugeEventReservation
          ? replyText
          : addClosingSalute(replyText, currentLang);

      twiml = `
        <Response>
          <Gather
            input="speech"
            language="${currentLang}"
            action="${BASE_URL}/twilio?postFinal=1"
            method="POST"
            timeout="5"
            speechTimeout="auto"
          >
            <Say language="${sayLang}" bargeIn="true">
              ${escapeXml(finalReply)}
            </Say>
          </Gather>
          <Say language="${sayLang}">
            ${escapeXml(
              currentLang === "en-US"
                ? "Thank you again, goodbye."
                : "Grazie ancora, a presto."
            )}
          </Say>
          <Hangup/>
        </Response>
      `.trim();
    } else {
      twiml = `
        <Response>
          <Gather
            input="speech"
            language="${currentLang}"
            action="${BASE_URL}/twilio"
            method="POST"
            timeout="5"
            speechTimeout="auto"
          >
            <Say language="${sayLang}" bargeIn="true">
              ${escapeXml(replyText)}
            </Say>
          </Gather>
          <Say language="${sayLang}">
            ${escapeXml(
              currentLang === "en-US"
                ? "I didn't receive any answer. Please call us back if you still need help. Thank you."
                : "Non ho ricevuto risposta. Se hai ancora bisogno, richiamaci pure. Grazie."
            )}
          </Say>
        </Response>
      `.trim();
    }

    return res.status(200).type("text/xml").send(twiml);
  } catch (error) {
    console.error("Errore generale /twilio:", error);
    const errorTwiml = `
      <Response>
        <Say language="it-IT">
          Si è verificato un errore del server. Ti chiediamo di richiamare più tardi.
        </Say>
        <Hangup/>
      </Response>
    `.trim();
    return res.status(500).type("text/xml").send(errorTwiml);
  }
});

// ---------- AVVIO SERVER ----------
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Server attivo sulla porta ${PORT}`);
});
