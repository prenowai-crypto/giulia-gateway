// index.js - Giulia Gateway (Twilio -> OpenAI -> Apps Script)

import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import OpenAI from "openai";
import twilio from "twilio";

const VoiceResponse = twilio.twiml.VoiceResponse;

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL; // 🔗 URL Web App Apps Script
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 🔁 Memoria conversazione per ogni chiamata
const conversations = {}; // { [callSid]: ChatCompletionMessageParam[] }

const SYSTEM_PROMPT = `
Sei Giulia, la receptionist di un ristorante italiano.
Rispondi come una persona vera, amichevole ma professionale.
NON dire mai che sei un'intelligenza artificiale o un sistema automatico.

Devi SEMPRE rispondere in JSON con questa struttura:

{
  "reply_text": "testo da dire al cliente",
  "action": "none | create_reservation | update_reservation | ask_people | ask_date | ask_time | ask_new_time",
  "reservation": {
    "date": "YYYY-MM-DD o null se non definita",
    "time": "HH:MM:SS o null se non definita",
    "people": numero o null,
    "name": "nome cliente o null"
  }
}

Regole:
- Se l'utente chiede di prenotare, guida la conversazione fino ad avere: NOME, DATA, ORA, PERSONE.
- Quando hai tutte le info necessarie e il cliente conferma, usa "action": "create_reservation".
- Se il cliente modifica ora, data o numero di persone di una prenotazione appena fatta, usa "action": "update_reservation".
- Se ti manca solo il numero di persone, usa "action": "ask_people".
- Se ti manca solo la data, usa "action": "ask_date".
- Se ti manca solo l'ora, usa "action": "ask_time".
- Se il ristorante è pieno per un certo orario e ti viene comunicato dal sistema (tramite la risposta vocalmente al cliente), prosegui normalmente proponendo orari alternativi.

La lingua della risposta deve seguire la lingua del cliente (italiano o inglese).
`;

// 👉 Helpers

function formatDateYMD(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function inferDateFromText(text) {
  const now = new Date();

  const lower = (text || "").toLowerCase();

  // Espressioni relative
  if (lower.includes("dopodomani") || lower.includes("day after tomorrow")) {
    const d = new Date(now);
    d.setDate(d.getDate() + 2);
    return formatDateYMD(d);
  }

  if (lower.includes("domani") || lower.includes("tomorrow")) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return formatDateYMD(d);
  }

  if (lower.includes("oggi") || lower.includes("today") || lower.includes("stasera") || lower.includes("tonight")) {
    return formatDateYMD(now);
  }

  // Se l'utente ha detto esplicitamente una data tipo 2025-11-07
  const isoMatch = lower.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return isoMatch[0];
  }

  // Fallback: domani
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  return formatDateYMD(d);
}

async function sendToCalendar(payload) {
  try {
    console.log("📅 Invio dati a Apps Script:", payload);

    const res = await axios.post(APPS_SCRIPT_URL, payload, {
      headers: { "Content-Type": "application/json" },
    });

    console.log("✅ Risposta da Apps Script:", res.data);
    return res.data;
  } catch (err) {
    console.error("❌ Errore chiamata Apps Script:", err.response?.data || err.message);

    return {
      success: false,
      reason: "calendar_error",
      message: "Errore chiamata Apps Script",
      error: String(err.message || err),
    };
  }
}

async function askGiulia({ callSid, userText, language, from }) {
  console.log("👤 Utente dice:", userText);

  if (!conversations[callSid]) {
    conversations[callSid] = [];
  }

  const history = conversations[callSid];

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history,
    { role: "user", content: userText },
  ];

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini-2024-07-18",
    messages,
    temperature: 0.3,
  });

  console.log("📦 FULL OpenAI response:", JSON.stringify(completion, null, 2));

  const rawContent = completion.choices[0].message.content;
  console.log("🧠 Risposta raw da GPT:", rawContent);

  let parsed;
  try {
    parsed = JSON.parse(rawContent);
  } catch (err) {
    console.error("❌ Errore parsing JSON GPT:", err);
    parsed = {
      reply_text:
        language && language.startsWith("en")
          ? "Sorry, I had a problem understanding. Can you repeat, please?"
          : "Scusami, ho avuto un problema a capire. Puoi ripetere, per favore?",
      action: "none",
      reservation: { date: null, time: null, people: null, name: null },
    };
  }

  let replyText = parsed.reply_text || "";
  let action = parsed.action || "none";
  let reservation = parsed.reservation || {
    date: null,
    time: null,
    people: null,
    name: null,
  };

  let fromAppsScript = null;
  let finalReservation = null;

  // 🗓️ Se dobbiamo creare/aggiornare una prenotazione → chiama Apps Script
  if (
    (action === "create_reservation" || action === "update_reservation") &&
    reservation &&
    reservation.time
  ) {
    const inferredDate = inferDateFromText(userText);
    console.log("📆 Data inferita dalla conversazione:", inferredDate);

    const payload = {
      nome: reservation.name || "Cliente",
      persone: reservation.people || 2,
      data: inferredDate,
      ora: reservation.time,
      telefono: from || "",
    };

    fromAppsScript = await sendToCalendar(payload);

    // 🔴 Slot pieno → NON creiamo la prenotazione, Giulia propone altro orario
    if (fromAppsScript && !fromAppsScript.success && fromAppsScript.reason === "slot_full") {
      console.log("⛔ Prenotazione rifiutata per capienza:", fromAppsScript);

      if (language && language.startsWith("en")) {
        replyText =
          "I'm sorry, we are fully booked at that time. Would you like to try a different time or another day?";
      } else {
        replyText =
          "Mi dispiace, a quell'ora siamo al completo. Vuoi provare con un altro orario o un altro giorno?";
      }

      action = "ask_new_time"; // solo etichetta logica, non manda nulla al Calendar
      finalReservation = null;
    } else if (fromAppsScript && fromAppsScript.success) {
      finalReservation = {
        date: payload.data,
        time: payload.ora,
        people: payload.persone,
        name: payload.nome,
      };

      console.log("✅ Prenotazione creata:", {
        reservation: finalReservation,
        fromAppsScript,
      });
    }
  }

  // Aggiorno la storia conversazionale con ciò che Giulia ha DAVVERO detto
  history.push({ role: "user", content: userText });
  history.push({ role: "assistant", content: replyText });

  return { replyText, action, reservation: finalReservation, fromAppsScript };
}

function buildTwilioResponse(textToSay, language) {
  const twiml = new VoiceResponse();

  const lang = language && language.startsWith("en") ? "en-US" : "it-IT";

  const gather = twiml.gather({
    input: "speech",
    action: "/twilio",
    method: "POST",
    language: lang,
    speechTimeout: "auto",
  });

  // Se vuoi forzare una voce Google specifica, aggiungi "voice" qui (es. "Google.it-IT-Standard-A")
  gather.say({ language: lang }, textToSay);

  return twiml.toString();
}

// 🛎️ Endpoint Twilio

app.post("/twilio", async (req, res) => {
  try {
    console.log("📞 /twilio body:", req.body);

    const callSid = req.body.CallSid;
    const from = req.body.From;
    const speechResult = req.body.SpeechResult;
    const language = req.body.Language || "it-IT";
    const postFinal = req.body.postFinal || req.body.post_final;

    console.log("📲 Numero chiamante (From):", from, "postFinal:", postFinal);

    // Prima interazione: nessun SpeechResult -> saluto iniziale
    if (!speechResult) {
      const welcomeText =
        language && language.startsWith("en")
          ? "Hello, this is Giulia from the restaurant. How can I help you?"
          : "Ciao, sono Giulia del ristorante. Come posso aiutarti?";

      const twiml = buildTwilioResponse(welcomeText, language);
      res.type("text/xml");
      return res.send(twiml);
    }

    // Se vogliamo loggare in modo diverso dopo la prenotazione
    if (postFinal) {
      console.log("👤 Utente dopo prenotazione:", speechResult);
    }

    const { replyText } = await askGiulia({
      callSid,
      userText: speechResult,
      language,
      from,
    });

    const twiml = buildTwilioResponse(replyText, language);

    res.type("text/xml");
    res.send(twiml);
  } catch (err) {
    console.error("❌ Errore generale /twilio:", err);

    const fallback =
      "Siamo spiacenti, c'è stato un problema tecnico. Ti chiediamo di richiamare tra qualche minuto.";

    const twiml = buildTwilioResponse(fallback, "it-IT");
    res.type("text/xml");
    res.send(twiml);
  }
});

// 👋 Endpoint base
app.get("/", (req, res) => {
  res.send("Giulia Gateway è attivo.");
});

app.listen(PORT, () => {
  console.log(`🚀 Server in ascolto sulla porta ${PORT}`);
});
