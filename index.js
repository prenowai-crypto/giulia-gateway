// ===============================
// Receptionist AI Gateway - GPT + Calendar
// VERSIONE CON 7 FIX CRITICI:
// 1. Data/ora corrente dettagliata nel prompt
// 2. Stato persistente della prenotazione
// 3. Stop loop email - forza create_reservation
// 4. Modalità debug invia anche a Calendar
// 5. FIX: Data non sovrascritta + GPT chiusure + Debug risposta
// 6. FIX: Check anticipato disponibilità slot (UX critica)
// 7. FIX: Anti-allucinazione GPT chiusure + correzione action
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
// ═══════════════════════════════════════════════════════════════════════════
// MULTI-TENANT: Registry Google Sheet ID
// ═══════════════════════════════════════════════════════════════════════════
const REGISTRY_SHEET_ID = "1AdXq1EagVhPsX-UT4HENfuQ1mxUN39kWtECiY6he8bg";
const REGISTRY_SHEET_NAME = "Registry"; // Nome del foglio/tab

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
const LARGE_GROUP_THRESHOLD_DEFAULT = 10; // sopra → "grande gruppo", da confermare
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
// ═══════════════════════════════════════════════════════════════════════════
// MULTI-TENANT: Cache e funzioni per Registry
// ═══════════════════════════════════════════════════════════════════════════

// Cache del Registry (evita chiamate ripetute a Google Sheets)
let registryCache = null;
let registryCacheTime = 0;
const REGISTRY_CACHE_TTL = 5 * 60 * 1000; // 5 minuti

/**
 * Legge il Registry da Google Sheets (con cache)
 * @returns {Promise<Array>} Array di oggetti con le config dei ristoranti
 */
async function fetchRegistry() {
  const now = Date.now();
  
  // Se la cache è valida, usala
  if (registryCache && (now - registryCacheTime) < REGISTRY_CACHE_TTL) {
    console.log("📋 Registry: uso cache");
    return registryCache;
  }
  
  try {
    // Legge il foglio Registry via API pubblica di Google Sheets
    const url = `https://docs.google.com/spreadsheets/d/${REGISTRY_SHEET_ID}/gviz/tq?tqx=out:json&sheet=${REGISTRY_SHEET_NAME}`;
    console.log("🌐 Registry: fetch da Google Sheets...");
    
    const response = await fetch(url);
    const text = await response.text();
    
    // Google restituisce JSONP, dobbiamo estrarre il JSON
    const jsonMatch = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);?$/);
    if (!jsonMatch) {
      console.error("❌ Registry: formato risposta non valido");
      return registryCache || []; // fallback a cache vecchia se esiste
    }
    
    const data = JSON.parse(jsonMatch[1]);
    const rows = data.table.rows || [];
    const cols = data.table.cols || [];
    
    // Estrai headers dalla prima riga (cols contiene i nomi)
    const headers = cols.map(c => c.label || "");
    
    // Converti in array di oggetti
    const registry = rows.map(row => {
      const obj = {};
      row.c.forEach((cell, idx) => {
        const key = headers[idx];
        if (key) {
          obj[key] = cell ? (cell.v !== null ? cell.v : "") : "";
        }
      });
      return obj;
    });
    
    console.log(`✅ Registry: caricati ${registry.length} ristoranti`);
    
    // Aggiorna cache
    registryCache = registry;
    registryCacheTime = now;
    
    return registry;
  } catch (err) {
    console.error("❌ Registry: errore fetch:", err);
    return registryCache || []; // fallback a cache vecchia
  }
}

/**
 * Trova la configurazione del ristorante dal numero Twilio chiamato
 * @param {string} twilioNumber - Numero "To" dalla chiamata Twilio
 * @returns {Promise<Object|null>} Config del ristorante o null
 */
async function getRestaurantByTwilioNumber(twilioNumber) {
  if (!twilioNumber) {
    console.warn("⚠️ Registry: nessun numero Twilio fornito");
    return null;
  }
  
  const registry = await fetchRegistry();
  
  // Normalizza il numero (rimuovi spazi, assicura formato)
  const normalizedInput = twilioNumber.replace(/\s/g, "").trim();
  
  // Cerca nel registry
  const match = registry.find(r => {
    if (!r.twilio_number) return false;
    const normalizedRegistry = String(r.twilio_number).replace(/\s/g, "").trim();
    return normalizedRegistry === normalizedInput;
  });
  
  if (match) {
    console.log(`✅ Registry: trovato ristorante "${match.restaurant_name}" per numero ${twilioNumber}`);
    return match;
  }
  
  console.warn(`⚠️ Registry: nessun ristorante trovato per numero ${twilioNumber}`);
  return null;
}

// Mappa CallSid -> config ristorante (per non ri-cercare ad ogni turno)
const callRestaurantConfigs = new Map();

/**
 * Ottiene o carica la config del ristorante per una chiamata
 * @param {string} callId - CallSid della chiamata
 * @param {string} twilioNumber - Numero "To" (opzionale, usato solo al primo turno)
 * @returns {Promise<Object|null>}
 */
async function getRestaurantConfigForCall(callId, twilioNumber = null) {
  // Se già in cache per questa chiamata, usa quella
  if (callRestaurantConfigs.has(callId)) {
    return callRestaurantConfigs.get(callId);
  }
  
  // Altrimenti cerca nel registry
  if (twilioNumber) {
    const config = await getRestaurantByTwilioNumber(twilioNumber);
    if (config) {
      callRestaurantConfigs.set(callId, config);
      return config;
    }
  }
  
  return null;
}
// ═══════════════════════════════════════════════════════════════════════════
// FIX 2: FUNZIONI PER STATO PERSISTENTE DELLA PRENOTAZIONE
// ═══════════════════════════════════════════════════════════════════════════

// Funzione per ottenere lo stato attuale della prenotazione
function getReservationState(callId) {
  return callReservations.get(callId) || {
    date: null,
    time: null,
    people: null,
    name: null,
    customerEmail: null
  };
}

// Funzione per verificare se abbiamo tutti i dati obbligatori
function hasAllRequiredData(state) {
  return state && 
         state.date && String(state.date).trim() !== "" &&
         state.time && String(state.time).trim() !== "" &&
         state.people && state.people > 0 &&
         state.name && String(state.name).trim() !== "";
}

// Funzione per verificare se l'utente sta confermando
function isUserConfirming(userText) {
  const t = (userText || "").toLowerCase().trim();
  return /^(sì|si|yes|ok|va bene|perfetto|esatto|corretto|confermo|conferma|d'accordo|giusto|exactly|correct|that's right|right)/.test(t) ||
         /conferm|confirm/.test(t);
}

// Funzione per verificare se l'utente vuole cambiare qualcosa
function isUserChanging(userText) {
  const t = (userText || "").toLowerCase().trim();
  return /cambia|modifica|sposta|altro|diverso|change|different|move|switch|no,?\s*(vorrei|preferi|invece)/.test(t);
}

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
// ═══════════════════════════════════════════════════════════════════════════
// FIX 8a: ESTRAZIONE TIME/PEOPLE DAL TESTO UTENTE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Estrae l'orario dal testo utente
 * Es: "alle 20", "ore 21:30", "at 8pm", "20:30"
 */
function extractTimeFromText(text) {
  if (!text) return null;
  
  const t = text.toLowerCase().trim();
  
  // Pattern: "alle 20", "alle 20:30", "ore 20", "ore 20:30"
  const itTimePattern = /(?:alle|ore)\s*(\d{1,2})(?::(\d{2}))?/i;
  const itMatch = t.match(itTimePattern);
  if (itMatch) {
    let hour = parseInt(itMatch[1]);
    const minutes = itMatch[2] ? parseInt(itMatch[2]) : 0;
    if (hour < 12 && hour >= 1 && !t.includes("mattina") && !t.includes("pranzo")) {
    hour += 12;
  }
    if (hour === 24) hour = 0;
    return `${String(hour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
  }
  
  // Pattern: "at 8", "at 8:30", "at 8pm"
  const enTimePattern = /at\s*(\d{1,2})(?::(\d{2}))?\s*(pm|am)?/i;
  const enMatch = t.match(enTimePattern);
  if (enMatch) {
    let hour = parseInt(enMatch[1]);
    const minutes = enMatch[2] ? parseInt(enMatch[2]) : 0;
    const ampm = enMatch[3] ? enMatch[3].toLowerCase() : null;
    
    if (ampm === 'pm' && hour < 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;
    if (!ampm && hour <= 12 && hour >= 1) hour += 12;
    
    return `${String(hour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
  }
  
  // Pattern: "20:30" diretto
  const directMatch = t.match(/\b(\d{1,2}):(\d{2})\b/);
  if (directMatch) {
    const hour = parseInt(directMatch[1]);
    const minutes = parseInt(directMatch[2]);
    if (hour >= 0 && hour <= 23 && minutes >= 0 && minutes <= 59) {
      return `${String(hour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
    }
  }
  
  return null;
}

/**
 * Estrae il numero di persone dal testo utente
 */
function extractPeopleFromText(text) {
  if (!text) return null;
  
  const t = text.toLowerCase().trim();
  
  const patterns = [
    /(?:per|siamo|saremo|in)\s*(\d+)\s*(?:person[ae]|pax)?/i,
    /(\d+)\s*(?:person[ae]|pax|coperti)/i,
    /(?:for|we are)\s*(\d+)\s*(?:people|persons)?/i,
    /(\d+)\s*(?:people|persons|guests)/i,
  ];
  
  for (const pattern of patterns) {
    const match = t.match(pattern);
    if (match) {
      const num = parseInt(match[1]);
      if (num > 0 && num < 100) return num;
    }
  }
  
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// FIX 8b: RILEVAMENTO PROPOSTE DATE ALTERNATIVE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Rileva se GPT sta proponendo date alternative (senza dire "chiuso")
 */
function detectAlternativeDateProposal(replyText) {
  if (!replyText) return { detected: false };
  
  const t = replyText.toLowerCase();
  
  // Pattern: "martedì 16 o giovedì 18"
  const giorni = ['lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica',
                  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  
  const orPattern = /(\w+)\s*(\d{1,2})?\s*(?:o|or|oppure)\s*(\w+)\s*(\d{1,2})?/i;
  const orMatch = t.match(orPattern);
  
  if (orMatch) {
    const word1 = orMatch[1].toLowerCase();
    const word2 = orMatch[3].toLowerCase();
    
    const isDay1 = giorni.some(g => word1.includes(g.substring(0, 4)));
    const isDay2 = giorni.some(g => word2.includes(g.substring(0, 4)));
    
    if (isDay1 && isDay2) {
      return { detected: true, reason: "alternative_days" };
    }
  }
  
  // Pattern: frasi che propongono
  const proposalPatterns = [
    /ti propongo/i,
    /che ne dici di/i,
    /posso offrirti/i,
    /preferisci (?:invece )?/i,
    /what about/i,
    /how about/i,
    /in alternativa/i,
  ];
  
  for (const pattern of proposalPatterns) {
    if (pattern.test(t)) {
      return { detected: true, reason: "proposal_phrase" };
    }
  }
  
  return { detected: false };
}

// ═══════════════════════════════════════════════════════════════════════════
// FIX 8c: PROTEZIONE DATA ORIGINALE
// ═══════════════════════════════════════════════════════════════════════════

const protectedDates = new Map();

function setProtectedDate(callId, date) {
  if (callId && date) {
    console.log(`🛡️ FIX 8c: Protezione data attivata: ${date}`);
    protectedDates.set(callId, date);
  }
}

function getProtectedDate(callId) {
  return protectedDates.get(callId) || null;
}

function clearProtectedDate(callId) {
  if (callId) {
    protectedDates.delete(callId);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FIX 8d: FUNZIONE UNIFICATA ANTI-ALLUCINAZIONE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Gestisce l'anti-allucinazione GPT - UNIFICATA per debug e Twilio
 */
async function handleAntiHallucinationFix(giulia, dateToCheck, userText, currentLang, callId, checkClosureFn) {
  if (!dateToCheck) return { corrected: false, giulia };
  
  const replyLower = (giulia.reply_text || "").toLowerCase();
  
  // STEP 1: Rileva se GPT menziona chiusure
  const gptMentionsClosure = (
    replyLower.includes("chius") ||
    replyLower.includes("closed") ||
    replyLower.includes("non possiamo") ||
    replyLower.includes("cannot") ||
    replyLower.includes("we're closed") ||
    replyLower.includes("is closed")
  );
  
  // STEP 2: FIX 8b - Rileva proposte alternative
  const alternativeProposal = detectAlternativeDateProposal(giulia.reply_text);
  
  // STEP 3: FIX 8c - Verifica cambio data
  const protectedDate = getProtectedDate(callId);
  const dateWasChanged = protectedDate && giulia.reservation?.date && 
                         protectedDate !== giulia.reservation.date;
  
 // ═══════════════════════════════════════════════════════════════════════════
   // FIX 12: NUOVA LOGICA - Attiva SOLO quando GPT allucina chiusura
   // NON attivare solo perché la data è cambiata (potrebbe essere il cliente!)
   // ═══════════════════════════════════════════════════════════════════════════
   
   // Se GPT NON menziona chiusure E NON propone alternative → lascia passare
   if (!gptMentionsClosure && !alternativeProposal.detected) {
     // Se il cliente ha cambiato idea, aggiorna la data protetta
     if (dateWasChanged && isUserChanging(userText)) {
       const newDate = giulia.reservation?.date;
       if (newDate) {
         console.log(`🔄 FIX 12: Cliente ha cambiato idea, aggiorno protectedDate: ${protectedDate} → ${newDate}`);
         setProtectedDate(callId, newDate);
       }
     }
     return { corrected: false, giulia };
   }
  
  console.log(`🔍 FIX 8: Rilevata possibile allucinazione chiusura:`, { gptMentionsClosure, alternativeProposal, dateWasChanged, protectedDate });
  
  // STEP 4: Verifica con Apps Script
  const closureCheck = await checkClosureFn(dateToCheck);
  
  if (closureCheck.isClosed) {
    console.log(`⛔ FIX 8: ${dateToCheck} è davvero CHIUSO`);
    clearProtectedDate(callId);
    return { corrected: false, giulia };
  }
  
  // STEP 5: GPT ha ALLUCINATO! Correggi
  console.log(`✅ FIX 8: ${dateToCheck} è APERTO - GPT ha allucinato!`);
  
  // Formatta data
  let dateDisplay = dateToCheck;
  try {
    const [y, m, d] = dateToCheck.split("-");
    const dateObj = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
    dateDisplay = dateObj.toLocaleDateString(currentLang === "en-US" ? "en-US" : "it-IT", 
      { weekday: 'long', day: 'numeric', month: 'long' });
  } catch (e) {}
  
  // FIX 8a: Estrai time/people da TUTTO il testo utente della conversazione
  const r = giulia.reservation || {};
  const allUserText = getAllUserText(callId) + " " + (userText || "");
  
  let hasTime = r.time && String(r.time).trim() !== "";
  let hasPeople = r.people && r.people > 0;
  let hasName = r.name && String(r.name).trim() !== "";
  
  // Se manca time, prova a estrarlo
  if (!hasTime) {
    const extracted = extractTimeFromText(allUserText);
    if (extracted) { 
      r.time = extracted; 
      hasTime = true; 
      console.log(`🔧 FIX 8a: Time estratto: ${extracted}`);
    }
  }
  
  // Se manca people, prova a estrarlo
  if (!hasPeople) {
    const extracted = extractPeopleFromText(allUserText);
    if (extracted) { 
      r.people = extracted; 
      hasPeople = true; 
      console.log(`🔧 FIX 8a: People estratto: ${extracted}`);
    }
  }
  
  // Ripristina data protetta
  r.date = dateToCheck;
  giulia.reservation = r;
  
  // Aggiorna stato persistente
  mergeReservationForCall(callId, r);
  
  // Costruisci risposta corretta
  if (!hasTime) {
    giulia.reply_text = currentLang === "en-US" 
      ? `Perfect, ${dateDisplay}. What time would you prefer?`
      : `Perfetto, ${dateDisplay}. A che ora preferisci?`;
    giulia.action = "ask_time";
  } else if (!hasPeople) {
    const timeDisplay = r.time.substring(0,5);
    giulia.reply_text = currentLang === "en-US"
      ? `Perfect, ${dateDisplay} at ${timeDisplay}. How many people?`
      : `Perfetto, ${dateDisplay} alle ${timeDisplay}. Quante persone?`;
    giulia.action = "ask_people";
  } else if (!hasName) {
    const timeDisplay = r.time.substring(0,5);
    giulia.reply_text = currentLang === "en-US"
      ? `Perfect, ${dateDisplay} at ${timeDisplay} for ${r.people}. Your name?`
      : `Perfetto, ${dateDisplay} alle ${timeDisplay} per ${r.people} persone. Il tuo nome?`;
    giulia.action = "ask_name";
  } else {
    const timeDisplay = r.time.substring(0,5);
    giulia.reply_text = currentLang === "en-US"
      ? `Perfect, ${dateDisplay} at ${timeDisplay} for ${r.people} under ${r.name}. Would you like to leave an email?`
      : `Perfetto, ${dateDisplay} alle ${timeDisplay} per ${r.people} persone a nome ${r.name}. Vuoi lasciarmi un'email?`;
    giulia.action = "ask_email";
  }
  
  console.log(`✅ FIX 8: Risposta corretta: "${giulia.reply_text}" (action=${giulia.action})`);
  return { corrected: true, giulia };
}// ═══════════════════════════════════════════════════════════════════════════
// FIX 9: ANTI-INVENZIONE ORARI (GPT inventa "solo pranzo" o "solo cena")
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Rileva se GPT sta inventando restrizioni di orario inesistenti
 */
function detectFakeTimeRestriction(replyText) {
  if (!replyText) return { detected: false };
  
  const t = replyText.toLowerCase();
  
  const restrictionPatterns = [
    /solo a pranzo/i,
    /solo a cena/i,
    /aperti solo/i,
    /only (?:for )?lunch/i,
    /only (?:for )?dinner/i,
    /open only/i,
    /non facciamo (?:servizio )?(?:a )?pranzo/i,
    /non facciamo (?:servizio )?(?:a )?cena/i,
    /chiudiamo prima/i,
    /we don't serve lunch/i,
    /we don't serve dinner/i,
  ];
  
  for (const pattern of restrictionPatterns) {
    if (pattern.test(t)) {
      return { detected: true, reason: "fake_time_restriction" };
    }
  }
  
  return { detected: false };
}

/**
 * Corregge la risposta se GPT inventa restrizioni di orario
 */
function fixFakeTimeRestriction(giulia, userText, currentLang, callId) {
  const fakeRestriction = detectFakeTimeRestriction(giulia.reply_text);
  
  if (!fakeRestriction.detected) {
    return { corrected: false, giulia };
  }
  
  console.log(`⚠️ FIX 9: GPT ha inventato restrizione orari! Correggo...`);
  
  const r = giulia.reservation || {};
  const allUserText = getAllUserText(callId) + " " + (userText || "");
  
  // Estrai time se non presente
  let hasTime = r.time && String(r.time).trim() !== "";
  if (!hasTime) {
    const extracted = extractTimeFromText(allUserText);
    if (extracted) {
      r.time = extracted;
      hasTime = true;
    }
  }
  
  // Estrai people se non presente
  let hasPeople = r.people && r.people > 0;
  if (!hasPeople) {
    const extracted = extractPeopleFromText(allUserText);
    if (extracted) {
      r.people = extracted;
      hasPeople = true;
    }
  }
  
  giulia.reservation = r;
  mergeReservationForCall(callId, r);
  
  // Formatta data
  let dateDisplay = r.date || "";
  if (r.date) {
    try {
      const [y, m, d] = r.date.split("-");
      const dateObj = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
      dateDisplay = dateObj.toLocaleDateString(currentLang === "en-US" ? "en-US" : "it-IT", 
        { weekday: 'long', day: 'numeric', month: 'long' });
    } catch (e) {}
  }
  
  // Costruisci risposta corretta
  const hasName = r.name && String(r.name).trim() !== "";
  const timeDisplay = hasTime ? r.time.substring(0,5) : "";
  
  if (!hasTime) {
    giulia.reply_text = currentLang === "en-US" 
      ? `Perfect, ${dateDisplay} for ${r.people || 2} people. What time would you prefer?`
      : `Perfetto, ${dateDisplay} per ${r.people || 2} persone. A che ora preferisci?`;
    giulia.action = "ask_time";
  } else if (!hasName) {
    giulia.reply_text = currentLang === "en-US"
      ? `Perfect, ${dateDisplay} at ${timeDisplay} for ${r.people || 2} people. May I have your name?`
      : `Perfetto, ${dateDisplay} alle ${timeDisplay} per ${r.people || 2} persone. Posso avere il tuo nome?`;
    giulia.action = "ask_name";
  } else {
    giulia.reply_text = currentLang === "en-US"
      ? `Perfect, ${dateDisplay} at ${timeDisplay} for ${r.people || 2} under ${r.name}. Would you like to leave an email?`
      : `Perfetto, ${dateDisplay} alle ${timeDisplay} per ${r.people || 2} a nome ${r.name}. Vuoi lasciarmi un'email?`;
    giulia.action = "ask_email";
  }
  
  console.log(`✅ FIX 9: Risposta corretta: "${giulia.reply_text}"`);
  return { corrected: true, giulia };
}
// ═══════════════════════════════════════════════════════════════════════════
// FIX 1: FUNZIONI PER CALCOLARE DATA/ORA CORRENTE IN MODO DETTAGLIATO
// ═══════════════════════════════════════════════════════════════════════════

// Ottiene la data/ora corrente nel fuso Europe/Rome
function getNowInRome() {
  const nowString = new Date().toLocaleString("en-US", { timeZone: "Europe/Rome" });
  return new Date(nowString);
}

// Calcola il calendario dei prossimi 14 giorni per aiutare GPT
function buildCalendarInfo() {
  const now = getNowInRome();
  const giorni = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
  const mesi = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 
                'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
  
  const giornoSettimana = giorni[now.getDay()];
  const giorno = now.getDate();
  const mese = mesi[now.getMonth()];
  const anno = now.getFullYear();
  const ore = now.getHours().toString().padStart(2, '0');
  const minuti = now.getMinutes().toString().padStart(2, '0');
  
  // Calcola le date per i prossimi 14 giorni
  const prossimiGiorni = [];
  for (let i = 0; i <= 14; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    const isoDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    prossimiGiorni.push({
      offset: i,
      giorno: giorni[d.getDay()],
      data: isoDate,
      display: `${d.getDate()}/${d.getMonth() + 1}`,
      dayOfWeek: d.getDay()
    });
  }
  
  // Trova "questo sabato" e "sabato prossimo"
  const questoSabato = prossimiGiorni.find(g => g.dayOfWeek === 6);
  const sabatoProssimo = prossimiGiorni.filter(g => g.dayOfWeek === 6)[1] || questoSabato;
  
  // Trova "questa domenica" e "domenica prossima"
  const questaDomenica = prossimiGiorni.find(g => g.dayOfWeek === 0);
  const domenicaProssima = prossimiGiorni.filter(g => g.dayOfWeek === 0)[1] || questaDomenica;
  
  return {
    now,
    giornoSettimana,
    giorno,
    mese,
    anno,
    ore,
    minuti,
    prossimiGiorni,
    questoSabato,
    sabatoProssimo,
    questaDomenica,
    domenicaProssima
  };
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

// ═══════════════════════════════════════════════════════════════════════════
// ESTRAE DATA DAL TESTO CORRENTE (es. "10 dicembre" → "2025-12-10")
// ═══════════════════════════════════════════════════════════════════════════
function extractDateFromText(text) {
  if (!text) return null;
  
  const t = normalizeText(text);
  const nowRome = getNowInRome();
  const today = startOfDay(nowRome);
  const currentYear = today.getFullYear();
  
  // Mappa mesi italiano/inglese → numero mese (0-indexed)
  const monthsIT = {
    "gennaio": 0, "febbraio": 1, "marzo": 2, "aprile": 3, "maggio": 4, "giugno": 5,
    "luglio": 6, "agosto": 7, "settembre": 8, "ottobre": 9, "novembre": 10, "dicembre": 11
  };
  const monthsEN = {
    "january": 0, "february": 1, "march": 2, "april": 3, "may": 4, "june": 5,
    "july": 6, "august": 7, "september": 8, "october": 9, "november": 10, "december": 11
  };
  
  // Pattern: "[giorno settimana] DD mese" (es. "mercoledì 10 dicembre", "10 dicembre")
  const allMonths = Object.keys(monthsIT).concat(Object.keys(monthsEN)).join("|");
  const dateRegex = new RegExp(`(\\d{1,2})\\s*(?:di\\s+)?(${allMonths})`, "i");
  
  const match = t.match(dateRegex);
  if (match) {
    const day = parseInt(match[1]);
    const monthName = match[2].toLowerCase();
    const month = monthsIT[monthName] !== undefined ? monthsIT[monthName] : monthsEN[monthName];
    
    if (month !== undefined && day >= 1 && day <= 31) {
      // Determina l'anno: se la data è nel passato, usa l'anno prossimo
      let year = currentYear;
      const candidateDate = new Date(year, month, day);
      if (candidateDate < today) {
        year = currentYear + 1;
      }
      
      const result = new Date(year, month, day);
      const iso = toISODate(result);
      console.log(`📆 Data estratta dal testo: "${text}" → ${iso}`);
      return iso;
    }
  }
  
  return null;
}

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

// ═══════════════════════════════════════════════════════════════════════════
// FIX 5a: Normalizza la data/ora - NON sovrascrivere data se già presente!
// ═══════════════════════════════════════════════════════════════════════════
function normalizeReservationForCalendar(reservation = {}, callId) {
  let { date, time, people, name, customerEmail } = reservation;

  // se il modello ha messo "null" come stringa, trattalo come null
  if (date === "null") date = null;

  // ═══════════════════════════════════════════════════════════════════════════
  // FIX 5a: SOVRASCRIVE LA DATA INFERITA SOLO SE GPT NON HA GIÀ UNA DATA VALIDA
  // ═══════════════════════════════════════════════════════════════════════════
  const hasValidDate = date && typeof date === "string" && date.trim() !== "" && /^\d{4}-\d{2}-\d{2}$/.test(date);
  
  if (!hasValidDate) {
    // Solo se GPT non ha fornito una data valida, usiamo l'inferenza
    const inferred = inferDateFromConversation(callId);
    if (inferred) {
      console.log(`🔧 FIX 5a: Data GPT mancante/invalida, uso inferita: ${inferred}`);
      date = inferred;
    }
  } else {
    console.log(`✅ FIX 5a: Data GPT valida (${date}), NON sovrascrivo con inferenza`);
  }
  
  // Se dopo tutto non abbiamo ancora una data valida, proviamo il parsing
  if (typeof date === "string" && date.trim() !== "" && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    // Data valida in formato ISO, verifichiamo che non sia nel passato
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
        while (candidate.getTime() < todayRome.getTime()) {
          candidate.setFullYear(candidate.getFullYear() + 1);
        }

        date = toISODate(candidate);
      }
    }
  }

  // Inferenza orario di default se mancante (pranzo/sera/stanotte/late)
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

// ═══════════════════════════════════════════════════════════════════════════
// 🔥 NUOVA FUNZIONE: Controllo chiusure straordinarie via Apps Script
// ═══════════════════════════════════════════════════════════════════════════
async function checkClosure(dateStr) {
  if (!dateStr) {
    return { isClosed: false, reason: "" };
  }

  try {
    console.log(`🔍 Check chiusura: ${dateStr}`);

    const response = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "check_closure",
        data: dateStr,
      }),
    });

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      console.error("❌ Risposta check_closure non JSON:", text);
      return { isClosed: false, reason: "" };
    }

    if (!response.ok) {
      console.error("❌ Errore check_closure:", data);
      return { isClosed: false, reason: "" };
    }

    console.log("✅ Check closure:", data);

    if (data.isClosed === true) {
      console.log(`⛔ GIORNO CHIUSO rilevato: ${dateStr} - ${data.reason}`);
      return { isClosed: true, reason: data.reason || "Giorno di chiusura" };
    }

    return { isClosed: false, reason: "" };
  } catch (err) {
    console.error("❌ Errore chiamata check_closure:", err);
    return { isClosed: false, reason: "" };
  }
}

// 🔥 PATCH CRITICA: Controllo preventivo disponibilità slot
async function checkSlotAvailability(dateStr, timeStr, people) {
  if (!dateStr || !timeStr || !people) {
    return { available: true }; // se mancano dati, lascia proseguire
  }

  try {
    console.log(`🔍 Check preventivo slot: ${dateStr} ${timeStr} per ${people} pax`);
    
    const response = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "check_availability",
        data: dateStr,
        ora: timeStr,
        persone: people,
      }),
    });

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      console.error("❌ Risposta check_availability non JSON:", text);
      return { available: true }; // in caso di errore, non blocchiamo
    }

    if (!response.ok) {
      console.error("❌ Errore check_availability:", data);
      return { available: true }; // fallback: non blocchiamo
    }

    console.log("✅ Check availability:", data);

    // 🔥 PATCH: gestione giorno chiuso da check_availability
    if (data.reason === "day_closed") {
      console.log("⛔ GIORNO CHIUSO rilevato da check_availability");
      return { available: false, reason: "day_closed", closureReason: data.closureReason || "" };
    }

    if (data.reason === "slot_full") {
      console.log("⛔ SLOT PIENO rilevato dal check preventivo");
      return { available: false, reason: "slot_full" };
    }

    return { available: true };
  } catch (err) {
    console.error("❌ Errore chiamata check_availability:", err);
    return { available: true }; // fallback: in caso di errore non blocchiamo
  }
}
/**
 * Cerca slot disponibili tramite Apps Script
 * @param {string} dateStr - Data (YYYY-MM-DD)
 * @param {string} timeStr - Ora richiesta (HH:MM:SS)
 * @param {number} people - Numero persone
 * @returns {Object} { success, sameDay: [...], nextDays: [...] }
 */
async function findAvailableSlots(dateStr, timeStr, people) {
  if (!dateStr || !people) {
    return { success: false, sameDay: [], nextDays: [] };
  }

  try {
    console.log(`🔍 Ricerca slot disponibili: ${dateStr} ${timeStr || ''} per ${people} pax`);

    const response = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "find_available_slots",
        data: dateStr,
        ora: timeStr || "20:00:00",
        persone: people,
      }),
    });

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      console.error("❌ Risposta find_available_slots non JSON:", text);
      return { success: false, sameDay: [], nextDays: [] };
    }

    if (!response.ok || !data.success) {
      console.error("❌ Errore find_available_slots:", data);
      return { success: false, sameDay: [], nextDays: [] };
    }

    console.log("✅ Slot disponibili trovati:", JSON.stringify(data.availableSlots));
    return {
      success: true,
      sameDay: data.availableSlots?.sameDay || [],
      nextDays: data.availableSlots?.nextDays || []
    };
  } catch (err) {
    console.error("❌ Errore chiamata find_available_slots:", err);
    return { success: false, sameDay: [], nextDays: [] };
  }
}

/**
 * Costruisce un messaggio con gli slot alternativi disponibili
 * @param {Object} slots - { sameDay: [...], nextDays: [...] }
 * @param {string} lang - "it-IT" o "en-US"
 * @returns {string} Messaggio con alternative
 */
function buildAlternativeSlotsMessage(slots, lang = "it-IT") {
  const { sameDay, nextDays } = slots;

  // Caso 1: Ci sono slot nella stessa serata
  if (sameDay && sameDay.length > 0) {
    const times = sameDay.map(s => s.time).slice(0, 3);
    
    if (lang === "en-US") {
      if (times.length === 1) {
        return `I'm sorry, we're fully booked at that time. I have availability at ${times[0]}. Would that work for you?`;
      } else {
        const lastTime = times.pop();
        return `I'm sorry, we're fully booked at that time. I have availability at ${times.join(", ")} or ${lastTime}. Which would you prefer?`;
      }
    } else {
      if (times.length === 1) {
        return `Mi dispiace, a quell'ora siamo al completo. Ho disponibilità alle ${times[0]}. Può andare bene?`;
      } else {
        const lastTime = times.pop();
        return `Mi dispiace, a quell'ora siamo al completo. Ho disponibilità alle ${times.join(", ")} oppure alle ${lastTime}. Quale preferisci?`;
      }
    }
  }

  // Caso 2: Slot solo nei giorni successivi
  if (nextDays && nextDays.length > 0) {
    const firstDay = nextDays[0];
    const dayName = firstDay.dayName;
    const times = firstDay.slots.map(s => s.time).slice(0, 2);
    
    if (lang === "en-US") {
      return `I'm sorry, we're fully booked for tonight. The next availability is on ${dayName} at ${times.join(" or ")}. Would you like to book for then?`;
    } else {
      return `Mi dispiace, per stasera siamo al completo. La prima disponibilità è ${dayName} alle ${times.join(" o alle ")}. Vuoi prenotare per quel giorno?`;
    }
  }

  // Caso 3: Nessuna disponibilità trovata (fallback generico)
  if (lang === "en-US") {
    return "I'm sorry, we're fully booked. Would you like to try a different day?";
  } else {
    return "Mi dispiace, siamo al completo. Vuoi provare con un altro giorno?";
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 🔥 NUOVA FUNZIONE: Costruisce messaggio per giorno chiuso
// ═══════════════════════════════════════════════════════════════════════════
function buildClosedDayMessage(dateStr, reason, lang = "it-IT") {
  // Formatta la data in modo leggibile
  let dateDisplay = dateStr;
  try {
    const [y, m, d] = dateStr.split("-");
    const dateObj = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
    const options = { weekday: 'long', day: 'numeric', month: 'long' };
    dateDisplay = dateObj.toLocaleDateString(lang === "en-US" ? "en-US" : "it-IT", options);
  } catch (e) {
    // fallback: usa la data così com'è
  }

  if (lang === "en-US") {
    if (reason && reason.includes("lunedì")) {
      return `I'm sorry, but the restaurant is closed on Mondays. Would you like to book for another day?`;
    }
    return `I'm sorry, but the restaurant will be closed on ${dateDisplay}. Would you like to book for another day?`;
  } else {
    if (reason && reason.includes("lunedì")) {
      return `Mi dispiace, ma il ristorante è chiuso il lunedì. Vuoi prenotare per un altro giorno?`;
    }
    return `Mi dispiace, ma il ristorante sarà chiuso ${dateDisplay}. Vuoi prenotare per un altro giorno?`;
  }
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

// ═══════════════════════════════════════════════════════════════════════════
// FIX 1 + FIX 5b: SYSTEM PROMPT CON DATA/ORA DETTAGLIATA + GESTIONE CHIUSURE
// ═══════════════════════════════════════════════════════════════════════════

function buildSystemPrompt(context, reservationState = null) { 
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

  // ═══════════════════════════════════════════════════════════════════════════
  // FIX 1: CALCOLA DATA/ORA CORRENTE E CALENDARIO PROSSIMI GIORNI
  // ═══════════════════════════════════════════════════════════════════════════
  const calInfo = buildCalendarInfo();
  const todayDateIso = toISODate(calInfo.now);
  
  // Costruisci il calendario in formato leggibile CON indicazione lunedì chiuso
  const calendarioSettimana = calInfo.prossimiGiorni.slice(0, 10).map(g => {
    let label = "";
    if (g.offset === 0) label = " (OGGI)";
    else if (g.offset === 1) label = " (domani)";
    else if (g.offset === 2) label = " (dopodomani)";
    // FIX 5b: Marca i lunedì come CHIUSI nel calendario
    if (g.dayOfWeek === 1) label += " ⛔ CHIUSO";
    return `  ${g.giorno}: ${g.data}${label}`;
  }).join('\n');

  // ═══════════════════════════════════════════════════════════════════════════
  // FIX 2: INCLUDI LO STATO ATTUALE DELLA PRENOTAZIONE NEL PROMPT
  // ═══════════════════════════════════════════════════════════════════════════
  let statoPrenotazione = "";
  if (reservationState) {
    const datiRaccolti = [];
    if (reservationState.date) datiRaccolti.push(`- Data: ${reservationState.date}`);
    if (reservationState.time) datiRaccolti.push(`- Ora: ${reservationState.time}`);
    if (reservationState.people) datiRaccolti.push(`- Persone: ${reservationState.people}`);
    if (reservationState.name) datiRaccolti.push(`- Nome: ${reservationState.name}`);
    if (reservationState.customerEmail) datiRaccolti.push(`- Email: ${reservationState.customerEmail}`);
    
    if (datiRaccolti.length > 0) {
      statoPrenotazione = `

══════════════════════════════════════════════════════════════════════════════
⚠️ DATI GIÀ RACCOLTI PER QUESTA PRENOTAZIONE - NON PERDERE QUESTI DATI!
══════════════════════════════════════════════════════════════════════════════
${datiRaccolti.join('\n')}

IMPORTANTE: 
- Se l'utente conferma (dice "sì", "confermo", "ok", "va bene"), USA QUESTI DATI nel JSON!
- NON azzerare i campi già compilati!
- Se hai già date, time, people e name → usa action="create_reservation"
══════════════════════════════════════════════════════════════════════════════
`;
    }
  }

  const basePrompt = `
Sei ${RECEPTIONIST_NAME}, la receptionist di un ristorante italiano chiamato ${restaurantName}.

══════════════════════════════════════════════════════════════════════════════
📅 DATA E ORA ATTUALI - USA QUESTI DATI PER CALCOLARE LE DATE!
══════════════════════════════════════════════════════════════════════════════
OGGI È: ${calInfo.giornoSettimana} ${calInfo.giorno} ${calInfo.mese} ${calInfo.anno}, ore ${calInfo.ore}:${calInfo.minuti}
Data ISO di oggi: ${todayDateIso}

CALENDARIO PROSSIMI GIORNI (RIFERIMENTO ESATTO PER CONVERTIRE I GIORNI):
${calendarioSettimana}

REGOLE TASSATIVE PER LE DATE:
1. "domani" = ${calInfo.prossimiGiorni[1].data} (${calInfo.prossimiGiorni[1].giorno})
2. "dopodomani" = ${calInfo.prossimiGiorni[2].data} (${calInfo.prossimiGiorni[2].giorno})
3. Quando il cliente dice un giorno della settimana (es. "martedì", "sabato"):
   - CERCA nel calendario sopra il PROSSIMO giorno con quel nome
   - CONVERTI SEMPRE in data YYYY-MM-DD
   - NON lasciare date=null se il cliente ha detto un giorno!
4. "questo sabato" = ${calInfo.questoSabato ? calInfo.questoSabato.data : 'N/A'}
5. "sabato prossimo" = ${calInfo.sabatoProssimo ? calInfo.sabatoProssimo.data : 'N/A'}

══════════════════════════════════════════════════════════════════════════════
⛔ GIORNI DI CHIUSURA - GESTIONE IMMEDIATA (MOLTO IMPORTANTE!)
══════════════════════════════════════════════════════════════════════════════
Il ristorante è CHIUSO:
- TUTTI I LUNEDÌ (giorno di chiusura settimanale)
- Chiusure straordinarie: ${closingRulesText || "nessuna"}

REGOLA FONDAMENTALE:
Quando il cliente chiede di prenotare per un LUNEDÌ o per un giorno di chiusura straordinaria:
1. RIFIUTA IMMEDIATAMENTE la data
2. Spiega che siamo chiusi quel giorno
3. Proponi un giorno alternativo (es. martedì, mercoledì, ecc.)
4. NON procedere MAI con la raccolta di altri dati (orario, persone, nome) per un giorno chiuso!

Esempi di risposte corrette:
- Cliente: "Vorrei prenotare per lunedì"
  → "Mi dispiace, il lunedì siamo chiusi. Vuoi prenotare per martedì o un altro giorno?"
- Cliente: "Prenotazione per lunedì 8 dicembre"
  → "Purtroppo lunedì 8 dicembre siamo chiusi. Posso proporti martedì 9 o mercoledì 10?"
- Cliente: "Lunedì prossimo alle 20"
  → "Il lunedì il ristorante è chiuso. Preferisci prenotare per martedì alle 20?"

NON dire mai frasi come "Lunedì prossimo è il 15 dicembre. Quante persone sarete?" se il lunedì è chiuso!
══════════════════════════════════════════════════════════════════════════════
⚠️ REGOLA SUGLI ORARI - NON INVENTARE RESTRIZIONI!
══════════════════════════════════════════════════════════════════════════════
Gli orari di apertura (pranzo e cena) sono gli STESSI per TUTTI i giorni in cui siamo aperti.
- NON dire MAI che un giorno specifico (es. domenica, sabato) ha orari diversi dagli altri
- NON dire MAI "siamo aperti solo a pranzo" o "solo a cena" per un giorno specifico
- Se il cliente prenota per la domenica a cena, procedi normalmente come per qualsiasi altro giorno
- L'unica eccezione è il LUNEDÌ che è CHIUSO (niente pranzo né cena)

ESEMPI SBAGLIATI (da NON fare):
❌ "La domenica siamo aperti solo a pranzo"
❌ "Il sabato non facciamo servizio a pranzo"
❌ "Di domenica chiudiamo prima"

ESEMPIO CORRETTO:
✅ "Perfetto, domenica 21 dicembre alle 20:30 per 5 persone. Posso avere il tuo nome?"
══════════════════════════════════════════════════════════════════════════════
══════════════════════════════════════════════════════════════════════════════
${statoPrenotazione}
LINGUE:
- Capisci sia italiano sia inglese.
- Se il cliente parla soprattutto in italiano, rispondi in italiano.
- Se il cliente parla in inglese, rispondi in inglese.
- Se cambia lingua durante la chiamata, adeguati alla lingua che usa nella sua ultima frase.
- Non mescolare le lingue nella stessa risposta.
- "reply_text" deve SEMPRE essere nella stessa lingua dell'ULTIMO messaggio del cliente.
- Se il cliente usa un mix di lingue nello stesso messaggio (es. "Sorry la mia email è…"),
  mantieni la lingua principale del contesto della conversazione, cioè la lingua usata nella frase precedente,
  e NON cambiare lingua solo perché compaiono singole parole italiane o inglesi nella stessa frase.


RUOLO:
- Sei una receptionist umana al telefono, gentile, sintetica e professionale.
- Parli come in una telefonata vera, non come un'email.
- Non parlare mai di "intelligenza artificiale" o "modelli linguistici".

STILE:
- Frasi brevi, massimo 2 frasi per risposta (5–7 secondi di audio).
- Vai dritta al punto, niente discorsi lunghi.
- Evita scuse lunghe tipo "mi dispiace molto, purtroppo...": se sbagli, una sola frase breve.
- Fai quasi sempre una domanda chiara per far avanzare la conversazione, TRANNE NELLA RISPOSTA FINALE.

OBIETTIVO:
- Gestire prenotazioni: giorno, orario, numero di persone, nome.
- Puoi anche rispondere a domande su menù, prezzi indicativi, tipologia di cucina, orari.
- Quando hai quasi tutti i dati per la prenotazione, se possibile chiedi anche un indirizzo email per inviare una conferma.

GESTIONE EMAIL (MOLTO IMPORTANTE):
- Quando il cliente ti detta l'indirizzo email, devi SEMPRE fare uno spelling chiaro, lettera per lettera, e chiedere conferma.
- NON usare mai il simbolo "-" nello spelling: separa lettere e numeri solo con pause o spazi, non dire "trattino" o "meno".
- In italiano:
  - Ripeti l'email separando le lettere con piccole pause, ad esempio:
    "Quindi l'email è: m i r k o c a r t a 1 3 chiocciola gmail punto com, giusto?"
  - Usa parole come "chiocciola" per "@", "punto" per ".", e pronuncia i numeri chiaramente (es. "uno tre").
  - Quando fai lo spelling in italiano, per la lettera "w" di' sempre "doppia vù".
- In inglese:
  - Esempio: "So your email is m i r k o c a r t a 1 3 at gmail dot com, is that correct?"
- Per domini molto comuni come "gmail.com", "outlook.com", "yahoo.com":
  - NON fare lo spelling lettera per lettera del dominio.
  - Di' semplicemente: "gmail punto com", "outlook punto com", ecc.
- Se il cliente dice che NON è corretta, chiedigli di ridettare l'email con calma, sovrascrivi il valore precedente e ripeti DI NUOVO lo spelling prima di andare avanti.
- Quando l'email del cliente è chiara (anche dopo una correzione), metti SEMPRE il valore definitivo in reservation.customerEmail.
- Non andare mai alla risposta finale di prenotazione se non hai completato questo controllo sull'email (quando il cliente ti ha fornito un'email).
- Per tavoli fino a ${largeGroupThreshold} persone:
  - l'email è **consigliata ma non obbligatoria**.
  - se il cliente non vuole dare l'email, la prenotazione resta comunque valida.
- Per gruppi oltre ${largeGroupThreshold} persone:
  - l'email è **fortemente raccomandata** per permettere al ristorante di confermare o rifiutare la richiesta.
  - se il cliente rifiuta di dare l'email, NON bloccare la richiesta: spiega che il ristorante potrà contattarlo al numero di telefono da cui chiama, ma i tempi di risposta potrebbero essere meno rapidi.
- Quando chiedi l'email NON devi mai dire o implicare che è necessaria per confermare la prenotazione.
  Usa sempre frasi neutre come:
  "Vuoi lasciarmi anche un'email per mandarti la conferma?" oppure
  "Se vuoi posso inviarti una conferma via email, vuoi lasciarmela?"
  Evita frasi come: "serve per confermare", "è necessaria", "devo averla".

EMAIL DEL RISTORANTE (IMPORTANTE):
- L'email ufficiale del ristorante è: ${restaurantEmail}.
- Quando il cliente chiede "l'email del ristorante", "a che indirizzo devo scrivere", "la vostra mail", oppure in inglese "the restaurant email", "email of the restaurant", "where should I write to the restaurant", ecc.:
  - devi SEMPRE rispondere con questo indirizzo email.
  - puoi fare lo spelling, ma l'indirizzo deve restare esattamente ${restaurantEmail}.
  - NON inventare mai altri indirizzi (niente "ristorante@gmail.com", "info@...", ecc.).
- Non mettere mai l'email del ristorante in reservation.customerEmail: in reservation.customerEmail va SOLO l'email del cliente.

CONVERSAZIONE "SVEGLIA":
- Quando il cliente dice che vuole prenotare, chiedi SUBITO almeno due informazioni insieme, se possibile:
  - ad esempio: giorno E orario, oppure giorno E numero di persone, oppure orario E nome.
- Non fare troppi micro-passaggi tipo: prima chiedo il giorno, poi in un altro turno l'ora, poi in un altro le persone, se puoi combinarli.
- Se il cliente è vago ("domani sera"), prova a proporre tu degli orari: ad esempio:
  - in italiano: "Preferisci verso le 19:30 o le 20:30?"
  - in inglese: "Would you prefer around 7:30pm or 8:30pm?"

GESTIONE CORREZIONI:
- Se il cliente dice cose come "no scusa", "ho sbagliato", "cambia", "non intendevo quello":
  -> interpreta ciò che dice DOPO come il nuovo dato e sovrascrivi quello vecchio.
- Non farlo ricominciare da zero: aggiorna solo il pezzo che va cambiato (data, ora, persone, nome o email).
- Se il cliente cambia argomento (es. da prenotazione a menù), rispondi alla domanda, poi riportalo gentilmente alla prenotazione.

CAMBIO PRENOTAZIONE (CAMBIO DATA/ORARIO):
- Se il cliente vuole CAMBIARE o SPOSTARE una prenotazione esistente (es. "vorrei spostare la prenotazione", "cambia l'orario", "mettila alle 21", "can you move my booking to 9pm"):
  - NON usare "cancel_reservation" da solo.
  - In questi casi devi:
    1) capire la nuova data (anche con "oggi", "domani", "dopodomani", "stasera", "lunedì", "tomorrow", "tonight", "next Monday", ecc.),
    2) capire il nuovo orario,
    3) mettere la nuova data e il nuovo orario in reservation.date e reservation.time,
    4) usare "action": "create_reservation".
- Il sistema aggiornerà automaticamente la prenotazione esistente per quel cliente (stesso numero di telefono) senza che tu faccia una cancellazione manuale separata.
- Usa "cancel_reservation" SOLO quando il cliente vuole davvero annullare la prenotazione senza crearne un'altra (es. "vorrei cancellare la prenotazione", "annulla il tavolo").

NOME:
- Se il cliente ti ha già detto chiaramente il nome (es. "mi chiamo Marco", "sono Mirko"), NON chiederlo di nuovo.
- In quel caso usa direttamente quel nome nella prenotazione, senza ripetere la domanda "come ti chiami?".

GESTIONE ORARI:
- Se il cliente dice un orario senza specificare mattina/pomeriggio (es. "alle 8", "otto e mezza", "alle 9"),
  interpretalo come ORARIO DI SERA, tra 18:00 e 23:00.
  - "alle 8" -> "20:00:00"
  - "alle 9" -> "21:00:00"
- Se il cliente specifica chiaramente "di mattina" o "di pomeriggio", rispetta quello che dice.

COME PARLI DELLA DATA A VOCE:
- Se il cliente usa espressioni relative come "oggi", "domani", "dopodomani", "stasera", "questa sera", "lunedì", "martedì", oppure in inglese "today", "tomorrow", "day after tomorrow", "tonight", "this evening", "Monday", "Tuesday", ecc.:
  - nella "reply_text" parla nello stesso modo relativo che usa il cliente:
    - es. "domani sera alle 20:00", "dopodomani alle 21:00", "lunedì alle 19:30", "tomorrow at 8 pm", "Monday at 7:30 pm".
  - NON trasformare queste espressioni in date con giorno e mese (es. niente "2 novembre" o "November 2nd" se il cliente ha detto "domani").
- Puoi usare giorno e mese (es. "2 novembre", "November 2nd") solo se il cliente li ha già detti esplicitamente o se sta già parlando in quel modo.

GESTIONE CANCELLAZIONI:
- Se il cliente vuole annullare una prenotazione (es. "vorrei cancellare la prenotazione", "puoi annullare il tavolo di domani a nome Mirko"):
  - prova a capire chiaramente:
    - giorno (es. oggi, domani, 7 novembre) → mettilo in reservation.date in formato YYYY-MM-DD
    - nome della prenotazione (reservation.name)
    - orario solo se il cliente lo specifica (reservation.time), altrimenti puoi lasciarlo null.
- Se non sei sicura di quale prenotazione annullare, chiedi UNA sola domanda di chiarimento (es. "Per quale giorno vuoi cancellare la prenotazione?").
- Quando hai capito cosa annullare, usa:
  - "action": "cancel_reservation"
  - "reservation.date": con la data in formato YYYY-MM-DD
  - "reservation.time": se il cliente dice un orario specifico, altrimenti null
  - "reservation.name": il nome della prenotazione
- Nella "reply_text" non dire che è già cancellata finché non hai usato "cancel_reservation":
  - frasi tipo: "Va bene, procedo a cancellare la prenotazione." o "Ok, la metto come annullata."
  - la conferma finale verrà completata dal sistema.

GESTIONE DATE RELATIVE:
- "oggi" / "today" → stessa data del giorno corrente.
- "domani" / "tomorrow" → giorno successivo.
- "dopodomani" / "day after tomorrow" → +2 giorni.
- "stasera" / "tonight" / "this evening" → stessa data di oggi, orario serale.
- "domani sera" / "tomorrow evening" → data di domani, orario serale.
- Non inventare mai una data o un orario se il cliente non li ha ancora detti o se non sono chiari: in quel caso usa "ask_date" o "ask_time".

GESTIONE DATE RELATIVE AVANZATE (MOLTO IMPORTANTE — AGGIUNTA PATCH):
- Le seguenti espressioni indicano giorni futuri rispetto ad oggi.
- In tutti questi casi devi calcolare la data reale (YYYY-MM-DD) partendo dal giorno corrente:

  • "tra X giorni"  
  • "fra X giorni"  
  • "in X giorni"  
  • "entro X giorni"
  • "entro un paio di giorni"
  • "in un paio di giorni"
  • "in pochi giorni" = 3 giorni
  • "in alcuni giorni" = 3 giorni
  • "in X days"
  • "within X days"
  • "X days from now"
  • "two days from now", "three days from now", ecc.

- Regola:
  Se X è un numero esplicito → reservation.date = oggi + X giorni.

  Esempi:
  - "tra 2 giorni" → oggi +2 → YYYY-MM-DD
  - "fra 3 giorni" → oggi +3 → YYYY-MM-DD
  - "in 4 giorni" → oggi +4 → YYYY-MM-DD
  - "in 2 days" → oggi +2 → YYYY-MM-DD
  - "three days from now" → oggi +3 → YYYY-MM-DD

- Espressioni senza numero (interpretazione conservativa):
  - "in un paio di giorni" → +2 giorni
  - "in pochi giorni" → +3 giorni
  - "in alcuni giorni" → +3 giorni

GESTIONE NUMERO DI PERSONE:
- Se il cliente dice frasi come "da 3 a 4 persone" o "from 3 to 4 people", interpreta SEMPRE il numero FINALE come numero di persone (4). Non sommare, non inventare numeri più alti.
- Se il cliente chiede di aumentare le persone con frasi del tipo "ci raggiunge un altro amico" ma non è chiaro il totale finale, chiedi esplicitamente "Quante persone sarete in totale?".

GESTIONE GRUPPI NUMEROSI ED EVENTI (MOLTO IMPORTANTE):
- Usa le soglie così:
  - Tavoli normali: fino a ${largeGroupThreshold} persone.
  - Grandi gruppi: da ${largeGroupThreshold + 1} fino a ${eventThreshold - 1} persone.
  - Eventi: da ${eventThreshold} persone in su.

- Per tavoli fino a ${largeGroupThreshold} persone:
  - Gestisci la prenotazione normalmente.
  - Se c'è disponibilità, confermi direttamente.
  - Puoi chiedere l'email per inviare anche una conferma scritta, ma se il cliente non vuole, la prenotazione resta valida.

- Per grandi gruppi (da ${largeGroupThreshold + 1} a ${eventThreshold - 1} persone):
  - NON devi mai dire frasi come "non possiamo prendere più di ${largeGroupThreshold} persone" o "non accettiamo più di ${largeGroupThreshold} coperti".
  - Devi sempre:
    1) raccogliere data, orario, numero di persone e nome;
    2) registrare comunque la richiesta come prenotazione per grande gruppo;
    3) spiegare chiaramente che la prenotazione è **soggetta a conferma da parte del ristorante**;
    4) chiedere gentilmente un'email per poter inviare l'esito (conferma o rifiuto).
  - Se il cliente NON vuole dare l'email:
    - NON devi bloccare la richiesta.
    - Devi comunque inoltrare la richiesta e dire che il ristorante lo potrà ricontattare al numero di telefono da cui chiama per confermare o meno.

- Per eventi (da ${eventThreshold} persone in su):
  - Non presentare mai la situazione come un rifiuto secco.
  - Spiega che si tratta di un evento privato e che deve essere valutato dal ristorante.
  - Chiedi sempre un'email per permettere al ristorante di ricontattare il cliente e definire i dettagli.
  - Se il cliente non vuole dare l'email, spiega che la gestione è più difficile e che potrebbe essere necessario che il cliente mandi una mail al ristorante o che il ristorante lo ricontatti al telefono, ma NON dire che "non si può proprio fare".

IN GENERALE (molto importante):
- Non dire mai che il ristorante "non può accettare più di ${largeGroupThreshold} persone".
- Non usare MAI frasi che suggeriscono una conferma definitiva, come:
  "ti aspettiamo", "la prenotazione è confermata", "è tutto fissato", "a posto così".
- Per i gruppi numerosi e gli eventi la risposta finale deve essere SEMPRE neutra, ad esempio:
  "Perfetto, ho registrato la richiesta. Il ristorante ti ricontatterà per la conferma."
- Usa sempre espressioni come:
  "richiesta soggetta a conferma",
  "ti ricontatteremo per l'esito",
  "ti aggiorneremo appena possibile".
- Mai dare per scontata la conferma finale se le persone superano ${largeGroupThreshold}.

REGOLA ASSOLUTA (OVERRIDE):
- Se people > ${largeGroupThreshold}, indipendentemente dall'action (anche se è "create_reservation"):
  - La risposta verbale deve essere SEMPRE neutra.
  - NON devi mai dire frasi come:
    "ti aspettiamo", "la prenotazione è confermata", "è tutto fatto", "a posto così".
  - Devi sempre concludere con frasi come:
    "La richiesta è stata inoltrata. Il ristorante ti ricontatterà per la conferma."
    "Grazie, riceverai un aggiornamento appena possibile."
    "Perfetto, ho registrato tutto. Ti faremo sapere appena il ristorante avrà verificato la disponibilità."




RICHIESTE SOLO INFORMAZIONI:
- Se il cliente chiede solo informazioni (menù, prezzi, allergie, parcheggio, orari) e NON sta chiaramente facendo o cambiando una prenotazione:
  - usa "action": "answer_menu" o "answer_generic".
  - In questi casi, TUTTI i campi in "reservation" devono restare null (date, time, people, name, customerEmail).

USO DELLE ACTION (IMPORTANTISSIMO):
- Usa "ask_name" SOLO quando:
  - NON hai ancora un nome chiaro in reservation.name
  - ti serve il nome per procedere con la prenotazione.
- Se hai già un nome chiaro (il cliente ha detto "mi chiamo X", "sono X", "under the name X", ecc.):
  - NON usare "ask_name".
  - Se ti manca l'email, usa "ask_email".
- Usa "ask_email" quando:
  - hai già data, ora, persone e nome (o almeno data, ora e nome)
  - ti serve l'email per la conferma.
- Usa "create_reservation" SOLO quando:
  - hai una prenotazione completa o da aggiornare, con almeno:
    - reservation.date (YYYY-MM-DD)
    - reservation.time (HH:MM:SS)
    - reservation.name (nome della prenotazione)
    - idealmente anche reservation.people se è una nuova prenotazione.
- Se mancano data, ora o nome, NON usare "create_reservation": in quei casi usa "ask_date", "ask_time" o "ask_name" a seconda di cosa manca.
- Usa "cancel_reservation" SOLO quando il cliente vuole annullare una prenotazione e hai capito almeno la data (e se possibile nome).
- Per richieste solo informative, usa "answer_menu" o "answer_generic" e lascia tutta la "reservation" a null.

═══════════════════════════════════════════════════════════════════════════════
⚠️ REGOLA CRITICA - CONFERMA EMAIL E COMPLETAMENTO PRENOTAZIONE
═══════════════════════════════════════════════════════════════════════════════
Quando il cliente CONFERMA l'email (dice "sì", "confermo", "esatto", "corretto", "giusto"):
1. NON tornare a chiedere la data o altri dati già raccolti!
2. Se hai già date, time, people, name → USA action="create_reservation"
3. Mantieni TUTTI i dati già raccolti nel JSON di risposta
4. NON azzerare mai campi che erano già compilati
═══════════════════════════════════════════════════════════════════════════════

FORMATO DI USCITA:
Devi SEMPRE rispondere in questo formato JSON, SOLO JSON, senza testo fuori:

{
  "reply_text": "testo che devo dire a voce al cliente",
  "action": "none | ask_date | ask_time | ask_people | ask_name | ask_email | answer_menu | answer_generic | create_reservation | cancel_reservation",
  "reservation": {
    "date": "YYYY-MM-DD oppure null",
    "time": "HH:MM:SS oppure null",
    "people": numero oppure null,
    "name": "nome oppure null",
    "customerEmail": "email del cliente oppure null"
  }
}

Regole:
- "reply_text" è la frase naturale che dirai al telefono, nella stessa lingua usata dal cliente (italiano o inglese).
- "action" = "create_reservation" SOLO quando hai TUTTI i dati necessari (almeno data, ora e nome) per fare la prenotazione o per aggiornarne/spostarne una già esistente.
- "action" = "cancel_reservation" quando il cliente vuole annullare una prenotazione e hai capito almeno la data (e se possibile nome/orario).
- "customerEmail" può essere null se il cliente non la vuole dare o non è necessaria.
- "answer_menu" o "answer_generic" vanno usate solo per richieste di informazioni, e in quel caso TUTTI i campi di "reservation" devono restare null.
- Negli altri casi usa le action "ask_date", "ask_time", "ask_people", "ask_name", "ask_email" per chiedere le informazioni mancanti.

RISPOSTA FINALE (create_reservation):
- Quando "action" = "create_reservation" la tua risposta deve essere una CHIUSURA FINALE:
  - conferma chiaramente la prenotazione (data, ora, persone, nome).
  - Se il cliente ha usato una data relativa ("domani", "dopodomani", "tomorrow", ecc.), puoi confermare usando quella forma ("domani sera alle 20:00") invece di dire giorno e mese.
  - NON fare altre domande
  - NON usare frasi tipo "va bene?", "confermi?", "sei d'accordo?".
  - chiudi con un saluto finale, ad esempio:
    - in italiano: "Ti aspettiamo, buona serata."
    - in inglese: "We look forward to seeing you, have a nice evening."
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

Quando rispondi ai clienti, usa SEMPRE queste informazioni come fonte principale e non inventare altri dati diversi (su orari, menu, prezzi, politiche).
Se una domanda riguarda informazioni che non sono qui, rispondi in modo prudente e invita il cliente a contattare direttamente il ristorante per conferma.
`;

  return basePrompt + contextBlock;
}

// ---------- GPT: helpers per JSON ----------

function extractJsonFromText(text = "") {
  const match = text.match(/{[\s\S]*}/);
  if (match) return match[0];
  return text;
}

// ═══════════════════════════════════════════════════════════════════════════
// FIX 2 & 3: FUNZIONE askGiulia() CON STATO PERSISTENTE E FORZATURA CREATE
// ═══════════════════════════════════════════════════════════════════════════
async function askGiulia(callId, userText) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    console.error("❌ Manca OPENAI_API_KEY nelle Environment Variables di Render");
    throw new Error("OPENAI_API_KEY non impostata");
  }

  // Assicura che il contesto del ristorante sia caricato
  await ensureContextForCall(callId);
  const context = getContextForCall(callId);

  // FIX 2: Ottieni lo stato attuale della prenotazione
  const reservationState = getReservationState(callId);
  console.log("📊 Stato prenotazione PRE-GPT:", JSON.stringify(reservationState));

  let convo = conversations.get(callId);
  
  // FIX 1 & 2: Costruisci il system prompt con data corrente E stato prenotazione
  const systemPrompt = buildSystemPrompt(context, reservationState);
  
  if (!convo) {
    // Primo messaggio
    convo = {
      messages: [{ role: "system", content: systemPrompt }],
    };
  } else {
    // FIX 2: AGGIORNA il system prompt ad ogni turno con lo stato attuale
    convo.messages[0] = { role: "system", content: systemPrompt };
  }

  // Aggiungiamo il messaggio dell'utente
  convo.messages.push({ role: "user", content: userText });

  // Limitiamo la cronologia: system + ultimi 10 messaggi (aumentato da 5)
  if (convo.messages.length > 12) {
    const systemMsg = convo.messages[0];
    const recent = convo.messages.slice(-10);
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
      max_completion_tokens: 300, // Aumentato per risposte più complete
      temperature: 0.2, // Ridotto per più determinismo
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

  // ===============================
  // PATCH DATA INFERITA AUTOMATICA (FIX 7d: priorità a date esplicite)
  // ===============================
  // FIX 7d: PRIMA prova estrazione data ESPLICITA dal testo (es. "21 dicembre" → 2025-12-21)
  // SOLO come fallback usa inferDateFromConversation (es. "domenica" → prossima domenica)
  let finalInferredDate = extractDateFromText(userText);
  if (finalInferredDate) {
    console.log("🔥 FIX 7d: Data ESPLICITA estratta dal testo utente:", finalInferredDate);
  } else {
    // Fallback: inferisci da pattern relativi (domani, domenica, etc.)
    finalInferredDate = inferDateFromConversation(callId);
    if (finalInferredDate) {
      console.log("🔥 PATCH DATA: uso la data inferita (relativa):", finalInferredDate);
    }
  }
// ═══════════════════════════════════════════════════════════════════════════
  // FIX 8c: PROTEGGI LA DATA ORIGINALE
  // ═══════════════════════════════════════════════════════════════════════════
  const dateToProtect = parsed.reservation?.date || finalInferredDate;
  if (dateToProtect && /^\d{4}-\d{2}-\d{2}$/.test(dateToProtect)) {
    if (!isUserChanging(userText) && !getProtectedDate(callId)) {
      setProtectedDate(callId, dateToProtect);
    }
  }
  // FIX 5a: Se GPT non ha messo la data ma noi l'abbiamo inferita → inseriscila
  // MA solo se la reservation non ha già una data valida!
  if (parsed.reservation) {
    const hasValidDateInReservation = parsed.reservation.date && 
                                       typeof parsed.reservation.date === "string" && 
                                       parsed.reservation.date.trim() !== "" &&
                                       /^\d{4}-\d{2}-\d{2}$/.test(parsed.reservation.date);

    if (!hasValidDateInReservation && finalInferredDate) {
      console.log("🔥 PATCH DATA: applico data:", finalInferredDate);
      parsed.reservation.date = finalInferredDate;
      // Aggiorna anche lo stato persistente
      mergeReservationForCall(callId, { date: finalInferredDate });
    }

    // Se GPT non ha messo l'orario ma è stato inferito dal sistema (già fatto nel normalize)
    const finalInferredTime = parsed.reservation.time;
    if ((!parsed.reservation.time || parsed.reservation.time === null) 
        && finalInferredTime) {
      console.log("🔥 PATCH ORA: uso l'orario inferito:", finalInferredTime);
      parsed.reservation.time = finalInferredTime;
    }
  }

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

  // ═══════════════════════════════════════════════════════════════════════════
  // FIX 3: FORZA create_reservation SE ABBIAMO TUTTI I DATI E L'UTENTE CONFERMA
  // ═══════════════════════════════════════════════════════════════════════════
  const currentState = getReservationState(callId);
  console.log("📊 Stato prenotazione POST-MERGE:", JSON.stringify(currentState));
  
  if (hasAllRequiredData(currentState)) {
    const userConfirms = isUserConfirming(userText);
    const userChanges = isUserChanging(userText);
    
    console.log(`🔍 Check forzatura: hasAll=${true}, confirms=${userConfirms}, changes=${userChanges}, action=${parsed.action}`);
    
    // Se abbiamo tutti i dati E l'utente sta confermando E NON sta cambiando qualcosa
    if (userConfirms && !userChanges && 
        parsed.action !== "create_reservation" && 
        parsed.action !== "cancel_reservation" &&
        parsed.action !== "answer_menu" &&
        parsed.action !== "answer_generic") {
      
      console.log("🔧 FIX 3: FORZATURA create_reservation - abbiamo tutti i dati e l'utente conferma");
      
      parsed.action = "create_reservation";
      // Assicurati che la reservation abbia tutti i dati dallo stato persistente
      parsed.reservation = { ...currentState };
      
      // Genera un messaggio di conferma appropriato se GPT non l'ha fatto
      if (!parsed.reply_text.toLowerCase().includes("prenotazione") &&
          !parsed.reply_text.toLowerCase().includes("reservation") &&
          !parsed.reply_text.toLowerCase().includes("ti aspettiamo") &&
          !parsed.reply_text.toLowerCase().includes("we look forward")) {
        
        const nomeCliente = currentState.name?.split(' ')[0] || "";
        parsed.reply_text = `Perfetto${nomeCliente ? ' ' + nomeCliente : ''}! Ho registrato la tua prenotazione. Ti aspettiamo, buona serata!`;
      }
    }
  }

  // SAFETY NET 3: create_reservation senza dati minimi → declassa ad ask_*
  // (usa lo stato persistente per la verifica)
  if (parsed.action === "create_reservation") {
    const hasDate = currentState.date && String(currentState.date).trim() !== "";
    const hasTime = currentState.time && String(currentState.time).trim() !== "";
    const hasName = currentState.name && String(currentState.name).trim() !== "";

    if (!hasDate || !hasTime || !hasName) {
      console.warn(
        "⚠️ create_reservation senza data/ora/nome completi nello stato, declasso ad ask_*",
        currentState
      );
      if (!hasDate) {
        parsed.action = "ask_date";
      } else if (!hasTime) {
        parsed.action = "ask_time";
      } else if (!hasName) {
        parsed.action = "ask_name";
      }
    } else {
      // Abbiamo tutto! Assicuriamoci che la reservation nel JSON abbia tutti i dati
      parsed.reservation = { ...currentState };
      console.log("✅ create_reservation con dati completi:", JSON.stringify(parsed.reservation));
    }
  }

  // SAFETY NET 4: se chiede ancora ask_email ma abbiamo già email + dati completi
  // → promuovi a create_reservation SOLO se la reply_text NON è una domanda
  if (parsed.action === "ask_email") {
    const hasDate = currentState.date && String(currentState.date).trim() !== "";
    const hasTime = currentState.time && String(currentState.time).trim() !== "";
    const hasName = currentState.name && String(currentState.name).trim() !== "";
    const hasEmail =
      currentState.customerEmail && String(currentState.customerEmail).trim() !== "";

    const isQuestion =
      typeof parsed.reply_text === "string" &&
      parsed.reply_text.includes("?");

    if (hasDate && hasTime && hasName && hasEmail && !isQuestion) {
      console.warn(
        "⚠️ ask_email ma abbiamo già data/ora/nome/email e la risposta non è una domanda → promuovo a create_reservation"
      );
      parsed.action = "create_reservation";
      parsed.reservation = { ...currentState };
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

  // ═══════════════════════════════════════════════════════════════════════════
  // FIX 4 + FIX 5c: MODALITÀ DEBUG CON INVIO A CALENDAR + SOVRASCRITTURA RISPOSTA
  // ═══════════════════════════════════════════════════════════════════════════
  if (isDebug) {
    try {
      // Assicura contesto caricato (necessario per le soglie)
      await ensureContextForCall(callId);
      
      // Salva il testo utente nella cronologia per inferDateFromConversation
      appendUserText(callId, text.trim());
      
      const giulia = await askGiulia(callId, text.trim());
      
      // Determina la lingua per i messaggi di errore
      const currentLang = getCallLanguage(callId);
      
      // FIX 10: Corregge action=none quando GPT rileva chiusura
      if (giulia.action === "none" && /chius|closed/i.test(giulia.reply_text)) {
        giulia.action = "ask_date";
        console.log("🔧 FIX 10 DEBUG: action none→ask_date (chiusura rilevata)");
      }
      
  // ═══════════════════════════════════════════════════════════════════════════
      // FIX 8: ANTI-ALLUCINAZIONE UNIFICATO (DEBUG)
      // ═══════════════════════════════════════════════════════════════════════════
      const dateToCheckDebug = giulia.reservation?.date || getProtectedDate(callId);
      
      if (dateToCheckDebug) {
        const antiHallResult = await handleAntiHallucinationFix(
          giulia, dateToCheckDebug, text.trim(), currentLang, callId, checkClosure
        );
        
       if (antiHallResult.corrected) {
          console.log("🔧 FIX 8 DEBUG: Risposta corretta per anti-allucinazione");
        }
      }
      
      // FIX 9: Anti-invenzione orari
      const fix9ResultDebug = fixFakeTimeRestriction(giulia, text.trim(), currentLang, callId);
      if (fix9ResultDebug.corrected) {
        console.log("🔧 FIX 9 DEBUG: Corretta invenzione orari");
      }
      // ═══════════════════════════════════════════════════════════════════════════
      
      // Se è create_reservation, invia anche a Calendar
      
      // Se è create_reservation, invia anche a Calendar
      if (giulia.action === "create_reservation" && giulia.reservation) {
        // FIX 5a: Usa la data dalla reservation di GPT, non da normalizeReservationForCalendar
        // perché ora normalizeReservationForCalendar non sovrascrive più date valide
        const normalized = normalizeReservationForCalendar(giulia.reservation, callId);
        const { date, time, people, name, customerEmail } = normalized;
        
        if (date && time && name) {
          const { largeGroupThreshold, eventThreshold } = getThresholdsForCall(callId);
          const numericPeople = typeof people === "number" && !isNaN(people) ? people : 2;
          
          // Check se è evento gigante
          if (numericPeople >= eventThreshold) {
            console.log("🎪 DEBUG: Evento gigante rilevato, invio notifica proprietario");
            await sendOwnerEmail({
              name,
              people: numericPeople,
              date,
              time,
              phone: From || "debug",
              customerEmail: customerEmail || "",
            });
            giulia.calendarResult = { success: true, type: "huge_event_notified" };
          } else {
            // Check chiusura
            const closureCheck = await checkClosure(date);
            if (closureCheck.isClosed) {
              console.log("⛔ DEBUG: Giorno chiuso, prenotazione non inviata");
              giulia.calendarResult = { success: false, reason: "day_closed", closureReason: closureCheck.reason };
              
              // ═══════════════════════════════════════════════════════════════════════════
              // FIX 5c: SOVRASCRIVE LA RISPOSTA ANCHE IN DEBUG MODE
              // ═══════════════════════════════════════════════════════════════════════════
              giulia.reply_text = buildClosedDayMessage(date, closureCheck.reason, currentLang);
              giulia.action = "ask_date";
              // Reset della data nello stato
              giulia.reservation.date = null;
              mergeReservationForCall(callId, { date: null });
              clearProtectedDate(callId);
              console.log("🔧 FIX 5c DEBUG: Risposta sovrascritta per giorno chiuso");
              
            } else {
              // Check disponibilità slot
              const availCheck = await checkSlotAvailability(date, time, numericPeople);
              if (!availCheck.available) {
                console.log("⛔ DEBUG: Slot pieno, prenotazione non inviata");
                giulia.calendarResult = { success: false, reason: availCheck.reason };
                
                // FIX 5c: Sovrascrive la risposta anche per slot pieno
                if (availCheck.reason === "day_closed") {
                  giulia.reply_text = buildClosedDayMessage(date, availCheck.closureReason || "", currentLang);
                  giulia.action = "ask_date";
                } else {
                  // Cerca alternative
                  const alternativeSlots = await findAvailableSlots(date, time, numericPeople);
                  if (alternativeSlots.success && (alternativeSlots.sameDay.length > 0 || alternativeSlots.nextDays.length > 0)) {
                    giulia.reply_text = buildAlternativeSlotsMessage(alternativeSlots, currentLang);
                  } else {
                    giulia.reply_text = currentLang === "en-US" 
                      ? "I'm sorry, we're fully booked at that time. Would you like to try a different time or another day?"
                      : "Mi dispiace, a quell'ora siamo al completo. Vuoi provare con un altro orario o un altro giorno?";
                  }
                  giulia.action = "ask_time";
                }
                console.log("🔧 FIX 5c DEBUG: Risposta sovrascritta per slot pieno");
                
              } else {
                // Invia a Calendar
                console.log("📅 DEBUG: Invio prenotazione a Calendar");
                try {
                  const calendarRes = await sendToCalendar({
                    source: "debug",
                    nome: name,
                    persone: numericPeople,
                    data: date,
                    ora: time,
                    telefono: From || "debug-phone",
                    email: customerEmail || "",
                  });
                  giulia.calendarResult = calendarRes;
                  console.log("✅ DEBUG: Prenotazione inviata a Calendar:", calendarRes);
                } catch (calErr) {
                  console.error("❌ DEBUG: Errore invio Calendar:", calErr);
                  giulia.calendarResult = { success: false, error: calErr.message };
                }
              }
            }
          }
        } else {
          console.warn("⚠️ DEBUG: create_reservation ma dati incompleti, non invio a Calendar");
          giulia.calendarResult = { success: false, reason: "incomplete_data", missing: { date: !date, time: !time, name: !name } };
        }
      }
      
      // Se è cancel_reservation, gestisci anche la cancellazione
      if (giulia.action === "cancel_reservation" && giulia.reservation) {
        const normalized = normalizeReservationForCalendar(giulia.reservation, callId);
        const { date, time, name } = normalized;
        
        if (date) {
          console.log("🗑️ DEBUG: Invio cancellazione a Calendar");
          try {
            const calendarRes = await sendToCalendar({
              action: "cancel_reservation",
              source: "debug",
              nome: name || "",
              data: date,
              ora: time || null,
              telefono: From || "debug-phone",
            });
            giulia.calendarResult = calendarRes;
            console.log("✅ DEBUG: Cancellazione inviata a Calendar:", calendarRes);
          } catch (calErr) {
            console.error("❌ DEBUG: Errore cancellazione Calendar:", calErr);
            giulia.calendarResult = { success: false, error: calErr.message };
          }
        }
      }
      
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
  // Primo ingresso: nessun SpeechResult -> messaggio di benvenuto (default IT)
  if (!SpeechResult) {
    setCallLanguage(callId, "it-IT");

    // ═══════════════════════════════════════════════════════════════════════════
    // MULTI-TENANT: Identifica il ristorante dal numero Twilio chiamato (To)
    // ═══════════════════════════════════════════════════════════════════════════
    const twilioNumberCalled = req.body.To || null;
    console.log(`📞 Numero Twilio chiamato (To): ${twilioNumberCalled}`);
    
    let restaurantConfig = null;
    if (twilioNumberCalled) {
      restaurantConfig = await getRestaurantConfigForCall(callId, twilioNumberCalled);
      if (restaurantConfig) {
        console.log(`✅ MULTI-TENANT: Ristorante identificato: ${restaurantConfig.restaurant_name}`);
        console.log(`   - Apps Script URL: ${restaurantConfig.apps_script_url}`);
        console.log(`   - Sheet ID: ${restaurantConfig.sheet_id}`);
      } else {
        console.warn(`⚠️ MULTI-TENANT: Nessun ristorante trovato per ${twilioNumberCalled}, uso default`);
      }
    }

    // Carico subito il contesto per avere il nome corretto del ristorante
    // TODO: In futuro, passare restaurantConfig a ensureContextForCall per usare l'URL specifico
    const ctx = await ensureContextForCall(callId);
    
    // Usa il nome dal Registry se disponibile, altrimenti dal context
    const restaurantName = 
      (restaurantConfig && restaurantConfig.restaurant_name) ||
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

     // Pulizia stato alla fine della chiamata
      callReservations.delete(callId);
      conversations.delete(callId);
      protectedDates.delete(callId);

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

    // FIX 10: Corregge action=none quando GPT rileva chiusura
    if (action === "none" && /chius|closed/i.test(replyText)) {
      action = "ask_date";
      giulia.action = "ask_date";
      console.log("🔧 FIX 10 TWILIO: action none→ask_date (chiusura rilevata)");
    }

    // Protezione: create_reservation con ancora domanda → declassa ad ask_time
    if (action === "create_reservation" && /\?/.test(replyText)) {
      console.warn(
        "⚠️ create_reservation con domanda nella reply_text, declasso ad ask_time"
      );
      action = "ask_time";
    }

    let slotFull = false;
    let dayClosed = false;

    // ═══════════════════════════════════════════════════════════════════════════
    // 🔥 PATCH: FORZA INFERIMENTO DATA se GPT non l'ha messa
    // Questo è necessario perché GPT mette date=null per i giorni della settimana
    // ═══════════════════════════════════════════════════════════════════════════
    if (giulia.reservation && !giulia.reservation.date) {
      // Prima prova dalla history
      let forcedInferredDate = inferDateFromConversation(callId);
      
      // Se non trova nella history, estrai dal testo corrente
      if (!forcedInferredDate && text) {
        forcedInferredDate = extractDateFromText(text);
        console.log(`🔍 Tentativo estrazione data dal testo: "${text}" → ${forcedInferredDate || "non trovata"}`);
      }
      
      if (forcedInferredDate) {
        giulia.reservation.date = forcedInferredDate;
        mergeReservationForCall(callId, giulia.reservation);
        console.log(`🔥 FORZA DATA INFERITA nel flusso /twilio: ${forcedInferredDate}`);
      }
    }

   // ═══════════════════════════════════════════════════════════════════════════
    // FIX 8: ANTI-ALLUCINAZIONE UNIFICATO (TWILIO)
    // ═══════════════════════════════════════════════════════════════════════════
    let dateToCheck = giulia.reservation?.date || getProtectedDate(callId);
    
    // Se GPT non ha messo la data, proviamo a estrarla
    if (!dateToCheck) {
      const explicitDate = extractDateFromText(userText);
      if (explicitDate) {
        dateToCheck = explicitDate;
        console.log(`🔍 FIX 8: Data estratta dal testo utente: ${dateToCheck}`);
      } else {
        const inferredDate = inferDateFromConversation(callId);
        if (inferredDate) {
          dateToCheck = inferredDate;
          console.log(`🔍 FIX 8: Data inferita dalla conversazione: ${dateToCheck}`);
        }
      }
      
      // Aggiorna la reservation con la data trovata
      if (dateToCheck) {
        giulia.reservation = giulia.reservation || {};
        giulia.reservation.date = dateToCheck;
        mergeReservationForCall(callId, { date: dateToCheck });
        if (!getProtectedDate(callId)) {
          setProtectedDate(callId, dateToCheck);
        }
      }
    }
    
    if (dateToCheck) {
      // Prima: applica anti-allucinazione FIX 8
      const antiHallResult = await handleAntiHallucinationFix(
        giulia, dateToCheck, userText, currentLang, callId, checkClosure
      );
      
      if (antiHallResult.corrected) {
        replyText = giulia.reply_text;
        action = giulia.action;
        console.log("🔧 FIX 8 TWILIO: Risposta corretta per anti-allucinazione");
      }
      
      // FIX 9: Anti-invenzione orari (dopo FIX 8)
      const fix9Result = fixFakeTimeRestriction(giulia, userText, currentLang, callId);
      if (fix9Result.corrected) {
        replyText = giulia.reply_text;
        action = giulia.action;
        console.log("🔧 FIX 9 TWILIO: Corretta invenzione orari");
      }
      
      // Se non corretto da FIX 8 o FIX 9, verifica chiusura standard
      if (!antiHallResult.corrected && !fix9Result.corrected) {
        // Se non corretto da FIX 8, verifica chiusura standard
        const closureCheck = await checkClosure(dateToCheck);
        
        if (closureCheck.isClosed) {
          dayClosed = true;
          console.log(`⛔ GIORNO CHIUSO: ${dateToCheck} - ${closureCheck.reason}`);
          
          replyText = buildClosedDayMessage(dateToCheck, closureCheck.reason, currentLang);
          action = "ask_date";
          
          giulia.reservation.date = null;
          mergeReservationForCall(callId, giulia.reservation);
          clearProtectedDate(callId);
        }
      }
    } else {
      console.log(`⚠️ FIX 8: Nessuna data disponibile per check`);
    }
    // ═══════════════════════════════════════════════════════════════════════════
    // 🔥🔥 FIX 6: CHECK ANTICIPATO DISPONIBILITÀ SLOT (UX CRITICA)
    // ═══════════════════════════════════════════════════════════════════════════
    // Trigger IMMEDIATO appena abbiamo date + time + people, PRIMA di chiedere nome/email
    // Questo evita che il cliente investa 5-6 turni per poi scoprire che lo slot è pieno
    // ═══════════════════════════════════════════════════════════════════════════
    if (!dayClosed && !slotFull && giulia.reservation) {
      const r = giulia.reservation;
      
      // Verifica se abbiamo i 3 dati base
      const hasDate = r.date && String(r.date).trim() !== "";
      const hasTime = r.time && String(r.time).trim() !== "";
      const hasPeople = r.people && r.people > 0;
      
      // FIX 6: Trigger su QUALSIASI action quando abbiamo i 3 dati base
      // Escludiamo solo le azioni che non dovrebbero triggare il check
      const shouldCheckNow = (
        hasDate && hasTime && hasPeople &&
        action !== "create_reservation" &&  // evita doppio check (verrà fatto dopo)
        action !== "cancel_reservation" &&
        action !== "answer_menu" &&
        action !== "answer_generic"
      );
      
      if (shouldCheckNow) {
        console.log(`🔍 FIX 6 - Check anticipato slot (action=${action}): ${r.date} ${r.time} per ${r.people} pax`);
        
        try {
          const availCheck = await checkSlotAvailability(r.date, r.time, r.people);
          
          // Gestione giorno chiuso
          if (!availCheck.available && availCheck.reason === "day_closed") {
            dayClosed = true;
            console.log(`⛔ FIX 6 - GIORNO CHIUSO: ${r.date}`);
            
            replyText = buildClosedDayMessage(r.date, availCheck.closureReason, currentLang);
            action = "ask_date";
            
            giulia.reservation.date = null;
            mergeReservationForCall(callId, giulia.reservation);
            
         } else if (!availCheck.available) {
            // ❌ SLOT PIENO: cerca alternative SUBITO
            slotFull = true;
            console.log(`⛔ FIX 6 - SLOT PIENO rilevato ANTICIPATAMENTE (prima di chiedere nome/email)`);

            const alternativeSlots = await findAvailableSlots(r.date, r.time, r.people);
            
            if (alternativeSlots.success && (alternativeSlots.sameDay.length > 0 || alternativeSlots.nextDays.length > 0)) {
              replyText = buildAlternativeSlotsMessage(alternativeSlots, currentLang);
              console.log("📢 FIX 6 - RISPOSTA CON ALTERNATIVE:", replyText);
            } else {
              replyText = currentLang === "en-US" 
                ? "I'm sorry, we're fully booked at that time. Would you like to try a different time or another day?"
                : "Mi dispiace, a quell'ora siamo al completo. Vuoi provare con un altro orario o un altro giorno?";
              console.log("📢 FIX 6 - RISPOSTA FALLBACK:", replyText);
            }

            action = "ask_time";
            
            // Reset time per forzare la richiesta di un nuovo orario
            giulia.reservation.time = null;
            mergeReservationForCall(callId, giulia.reservation);
          } else {
            console.log(`✅ FIX 6 - Slot disponibile: ${r.date} ${r.time} per ${r.people} pax`);
          }
        } catch (err) {
          console.error("❌ FIX 6 - Errore check anticipato:", err);
          // In caso di errore, non blocchiamo il flusso
       }
      }
    } else {
      // Nessuna data disponibile - non possiamo verificare chiusure
      console.log(`⚠️ FIX 7c: Nessuna data disponibile per check chiusure`);
    }

    let isLargeGroupReservation = false;
    let isHugeEventReservation = false;

    // 🔥 PATCH: gestisci EVENTO GIGANTE anche se il modello non usa create_reservation
    // (solo se il giorno NON è chiuso)
    if (!dayClosed && giulia.reservation) {
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

    // 🔥🔥 PATCH PRINCIPALE: CONTROLLO SLOT PIENI PREVENTIVO
    // Se è una prenotazione finale, prima di inviare al Calendar controlliamo la disponibilità
    // (solo se il giorno NON è già stato rilevato come chiuso)
    if (!dayClosed && action === "create_reservation" && giulia.reservation) {
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
          // 🔥 CONTROLLO PREVENTIVO DISPONIBILITÀ SLOT
          const availCheck = await checkSlotAvailability(
            date,
            time,
            numericPeople || 2
          );

          // 🔥 NUOVO: gestione giorno chiuso da check_availability
          if (!availCheck.available && availCheck.reason === "day_closed") {
            dayClosed = true;
            console.log(`⛔ GIORNO CHIUSO (da check_availability in create_reservation): ${date}`);
            
            replyText = buildClosedDayMessage(date, availCheck.closureReason, currentLang);
            action = "ask_date";
          } else if (!availCheck.available) {
            // ❌ SLOT PIENO: cerca alternative
            slotFull = true;
            console.log("⛔ Slot pieno rilevato PRIMA della creazione prenotazione");

            // 🔥 NUOVA LOGICA: cerca slot disponibili
            const alternativeSlots = await findAvailableSlots(date, time, numericPeople || 2);
            
            if (alternativeSlots.success && (alternativeSlots.sameDay.length > 0 || alternativeSlots.nextDays.length > 0)) {
              replyText = buildAlternativeSlotsMessage(alternativeSlots, currentLang);
              console.log("📢 RISPOSTA CON ALTERNATIVE:", replyText);
            } else {
              if (currentLang === "en-US") {
                replyText = "I'm sorry, we're fully booked at that time. Would you like to try a different time or another day?";
              } else {
                replyText = "Mi dispiace, a quell'ora siamo al completo. Vuoi provare con un altro orario o un altro giorno?";
              }
              console.log("📢 RISPOSTA FALLBACK:", replyText);
            }

            action = "ask_time"; // torna a chiedere orario
          } else {
            // ✅ SLOT DISPONIBILE: procedi con la prenotazione normale
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

              // Doppio controllo: anche Apps Script potrebbe rifiutare
              if (!calendarRes.success && calendarRes.reason === "day_closed") {
                dayClosed = true;
                console.log(`⛔ GIORNO CHIUSO (conferma Apps Script): ${date}`);
                
                replyText = buildClosedDayMessage(date, calendarRes.closureReason || "", currentLang);
                action = "ask_date";
              } else if (!calendarRes.success && calendarRes.reason === "slot_full") {
                slotFull = true;
                console.log("⛔ Prenotazione rifiutata per capienza (conferma Apps Script):", calendarRes);

                // 🔥 NUOVA LOGICA: cerca slot disponibili
                const alternativeSlots = await findAvailableSlots(date, time, numericPeople || 2);
                
                if (alternativeSlots.success && (alternativeSlots.sameDay.length > 0 || alternativeSlots.nextDays.length > 0)) {
                  replyText = buildAlternativeSlotsMessage(alternativeSlots, currentLang);
                  console.log("📢 RISPOSTA CON ALTERNATIVE:", replyText);
                } else {
                  if (currentLang === "en-US") {
                    replyText = "I'm sorry, we're fully booked at that time. Would you like to try a different time or another day?";
                  } else {
                    replyText = "Mi dispiace, a quell'ora siamo al completo. Vuoi provare con un altro orario o un altro giorno?";
                  }
                }

                action = "ask_time";
              } else if (calendarRes && calendarRes.success) {
                console.log("✅ Prenotazione creata/aggiornata:", {
                  reservation: normalizedRes,
                  fromAppsScript: calendarRes,
                });

                // Grande gruppo (ma non evento gigante): messaggio "soggetto a conferma"
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
    // MA NON se il giorno era chiuso o lo slot era pieno
    const shouldHangup =
      ((action === "create_reservation" || action === "cancel_reservation") &&
        !slotFull && !dayClosed) ||
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
