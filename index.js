// ===============================
// Giulia Gateway - GPT-5 + Calendar
// ===============================

import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import OpenAI from "openai";

const app = express();

// ---------- CONFIG ----------
const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbxMYLD4wfNopBN61SZRs46PfZFRs3Bn8kZMWPEgW8k_PWicCtj47Xfzy12vrCjWNqkRdA/exec";

const BASE_URL = "https://giulia-gateway.onrender.com";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// prompt di Giulia
const SYSTEM_PROMPT = `
Sei Giulia, la receptionist di un ristorante italiano.
Parli sempre in italiano, con tono gentile, sintetico e professionale.
Sei al telefono, quindi:
- le tue risposte devono essere brevi (massimo 2 frasi, 5–7 secondi di audio)
- non fare monologhi, vai dritta al punto
- alla fine di quasi ogni risposta fai una domanda chiara per far avanzare la conversazione.

CONTESTO:
L’obiettivo principale è gestire prenotazioni:
- chiedi giorno, orario, numero di persone, nome
- puoi anche rispondere a domande su menù, prezzi indicativi, tipologia di cucina, orari.

GESTIONE CORREZIONI:
- Se il cliente dice cose come "no scusa", "ho sbagliato", "cambia", "non intendevo quello":
  -> interpreta quello che dice DOPO come la nuova intenzione, e ignora il dato precedente.
- Non costringerlo mai a ripartire da zero: aggiorna solo il pezzo che va cambiato.
- Se il cliente cambia argomento a metà (ad esempio da prenotazione a menù):
  -> rispondi alla nuova domanda, poi riportalo gentilmente alla prenotazione.

STILE DI RISPOSTA:
- Usa frasi corte, niente discorsi lunghi.
- Sii calorosa ma non esagerata.
- Non parlare mai di "intelligenza artificiale" o "modelli linguistici".
- Fingi di essere una receptionist umana vera.

FORMATO DI USCITA:
Devi SEMPRE rispondere in questo formato JSON:

{
  "reply_text": "testo che devo dire a voce al cliente",
  "action": "none | ask_date | ask_time | ask_people | ask_name | answer_menu | answer_generic | create_reservation",
  "reservation": {
    "date": "YYYY-MM-DD oppure null",
    "time": "HH:MM:SS oppure null",
    "people": numero oppure null,
    "name": "nome oppure null"
  }
}

Regole:
- "reply_text" è la frase naturale che dirai al telefono.
- "action" = "create_reservation" SOLO quando hai TUTTI i dati (data, ora, persone, nome) per fare la prenotazione.
- In tutti gli altri casi usa l’action corrispondente al passo successivo (es. ask_time, ask_people…).
- Se il cliente chiede solo informazioni (es. sul pesce o sui prezzi), usa "answer_menu" o "answer_generic" e lascia "reservation" invariata.
- Non aggiungere mai altro fuori dal JSON. Solo JSON valido.
`;

// stato in memoria per ogni chiamata
const conversations = new Map();

// ---------- MIDDLEWARE ----------
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ---------- HELPERS ----------

// escape per XML Twilio
function escapeXml(unsafe = "") {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// manda i dati al Calendar via Apps Script
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

// chiama GPT-5 per una certa chiamata
async function askGiulia(callId, userText) {
  let convo = conversations.get(callId);
  if (!convo) {
    convo = {
      messages: [{ role: "system", content: SYSTEM_PROMPT }],
    };
  }

  convo.messages.push({ role: "user", content: userText });

  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-mini", // puoi cambiare modello se vuoi
    messages: convo.messages,
    temperature: 0.4,
  });

  const raw = completion.choices[0]?.message?.content?.trim() || "";
  console.log("🧠 Risposta raw da GPT:", raw);

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error("❌ JSON non valido, uso fallback:", e);
    parsed = {
      reply_text:
        "Scusa, c'è stato un problema tecnico, puoi ripetere per favore?",
      action: "none",
      reservation: {
        date: null,
        time: null,
        people: null,
        name: null,
      },
    };
  }

  convo.messages.push({ role: "assistant", content: raw });
  conversations.set(callId, convo);

  return parsed;
}

// ---------- ROUTE DI TEST ----------
app.get("/", (req, res) => {
  res.status(200).send("✅ Giulia Gateway è attiva e funzionante su Render!");
});

// ---------- /calendar (REST) ----------
app.post("/calendar", async (req, res) => {
  try {
    console.log("📩 Richiesta su /calendar:", req.body);
    const data = await sendToCalendar(req.body);
    return res.status(200).json({ success: true, fromAppsScript: data });
  } catch (error) {
    console.error("Errore /calendar:", error);
    return res
      .status(500)
      .json({ success: false, error: error.message });
  }
});

// ---------- /twilio (voce con GPT) ----------
app.post("/twilio", async (req, res) => {
  const { CallSid, SpeechResult } = req.body || {};
  const callId = CallSid || "unknown-call";

  console.log("📞 /twilio body:", req.body);

  // Primo ingresso: nessun SpeechResult -> messaggio di benvenuto
  if (!SpeechResult) {
    const welcomeText =
      "Ciao, sono Giulia, la receptionist del ristorante. Dimmi pure per che giorno e a che ora vuoi prenotare, oppure fammi una domanda sul menù.";

    const twiml = `
      <Response>
        <Gather input="speech" action="${BASE_URL}/twilio" method="POST">
          <Say language="it-IT">${escapeXml(welcomeText)}</Say>
        </Gather>
        <Say language="it-IT">
          Non ho ricevuto risposta. Ti chiediamo di richiamare più tardi. Grazie e buona serata.
        </Say>
      </Response>
    `.trim();

    return res.status(200).type("text/xml").send(twiml);
  }

  // Turni successivi: abbiamo SpeechResult -> chiediamo a GPT
  try {
    const userText = SpeechResult.trim();
    console.log("👤 Utente dice:", userText);

    const giulia = await askGiulia(callId, userText);
    const replyText =
      giulia.reply_text ||
      "Scusa, non ho capito bene. Puoi ripetere per favore?";

    // Se abbiamo tutto per creare una prenotazione, chiamiamo il Calendar
    if (giulia.action === "create_reservation" && giulia.reservation) {
      const { date, time, people, name } = giulia.reservation;

      if (date && time && people && name) {
        try {
          await sendToCalendar({
            nome: name,
            persone: people,
            data: date,
            ora: time,
          });
          console.log("✅ Prenotazione creata da Giulia:", giulia.reservation);
        } catch (calErr) {
          console.error("❌ Errore nella creazione prenotazione:", calErr);
        }
      }
    }

    // Se l'azione è "create_reservation" chiudiamo la chiamata dopo la conferma
    const shouldHangup = giulia.action === "create_reservation";

    let twiml;
    if (shouldHangup) {
      twiml = `
        <Response>
          <Say language="it-IT">${escapeXml(replyText)}</Say>
          <Hangup/>
        </Response>
      `.trim();
    } else {
      // altrimenti restiamo in loop con Gather per la prossima frase
      twiml = `
        <Response>
          <Gather input="speech" action="${BASE_URL}/twilio" method="POST">
            <Say language="it-IT">${escapeXml(replyText)}</Say>
          </Gather>
          <Say language="it-IT">
            Non ho ricevuto risposta. Se hai ancora bisogno, richiamaci pure. Grazie.
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

