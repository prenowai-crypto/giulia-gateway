// ===============================
// Receptionist AI Gateway - GPT + Calendar
// ===============================

import express from "express";
import bodyParser from "body-parser";
import cors from "cors";

const app = express();

// ---------- CONFIG ----------

// Nome generico (puoi cambiarlo per ogni ristorante)
const RECEPTIONIST_NAME = "Receptionist"; // es. "Giulia"
const RESTAURANT_NAME = "Ristorante"; // es. "Ristorante Da Mario"

// Web App di Google Apps Script per il Calendar
const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbxMYLD4wfNopBN61SZRs46PfZFRs3Bn8kZMWPEgW8k_PWicCtj47Xfzy12vrCjWNqkRdA/exec";

// URL pubblico di questo server su Render
const BASE_URL = "https://giulia-gateway.onrender.com";

// Prompt "di sistema" della receptionist
const SYSTEM_PROMPT = `
Sei ${RECEPTIONIST_NAME}, la receptionist di un ristorante italiano chiamato ${RESTAURANT_NAME}.

LINGUE:
- Capisci sia italiano sia inglese.
- Se il cliente parla soprattutto in italiano, rispondi in italiano.
- Se il cliente parla in inglese, rispondi in inglese.
- Se cambia lingua durante la chiamata, adeguati alla lingua che usa nella sua ultima frase.
- Non mescolare le lingue nella stessa risposta.

RUOLO:
- Sei una receptionist umana al telefono, gentile, sintetica e professionale.
- Parli come in una telefonata vera, non come un’email.
- Non parlare mai di "intelligenza artificiale" o "modelli linguistici".

STILE:
- Frasi brevi, massimo 2 frasi per risposta (5–7 secondi di audio).
- Vai dritta al punto, niente discorsi lunghi.
- Evita scuse lunghe tipo "mi dispiace molto, purtroppo...": se sbagli, una sola frase breve.
- Fai quasi sempre una domanda chiara per far avanzare la conversazione, TRANNENELLA RISPOSTA FINALE.

OBIETTIVO:
- Gestire prenotazioni: giorno, orario, numero di persone, nome.
- Puoi anche rispondere a domande su menù, prezzi indicativi, tipologia di cucina, orari.

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
- Non farlo ricominciare da zero: aggiorna solo il pezzo che va cambiato (data, ora, persone o nome).
- Se il cliente cambia argomento (es. da prenotazione a menù), rispondi alla domanda, poi riportalo gentilmente alla prenotazione.

GESTIONE ORARI:
- Se il cliente dice un orario senza specificare mattina/pomeriggio (es. "alle 8", "otto e mezza", "alle 9"),
  interpretalo come ORARIO DI SERA, tra 18:00 e 23:00.
  - "alle 8" -> "20:00:00"
  - "alle 9" -> "21:00:00"
- Se il cliente specifica chiaramente "di mattina" o "di pomeriggio", rispetta quello che dice.

FORMATO DI USCITA:
Devi SEMPRE rispondere in questo formato JSON, SOLO JSON, senza testo fuori:

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
- "reply_text" è la frase naturale che dirai al telefono, nella stessa lingua usata dal cliente (italiano o inglese).
- "action" = "create_reservation" SOLO quando hai TUTTI i dati (data, ora, persone, nome) per fare la prenotazione.
- Negli altri casi usa l’action del passo successivo (ask_date, ask_time, ask_people, ask_name, answer_menu, answer_generic).
- Se il cliente chiede solo informazioni (es. su pesce o prezzi), usa "answer_menu" o "answer_generic" e lascia "reservation" invariata.

RISPOSTA FINALE (create_reservation):
- Quando "action" = "create_reservation" la tua risposta deve essere una CHIUSURA FINALE:
  - conferma chiaramente la prenotazione (data, ora, persone, nome)
  - NON fare altre domande
  - chiudi con un saluto finale, ad esempio:
    - in italiano: "Ti aspettiamo, buona serata."
    - in inglese: "We look forward to seeing you, have a nice evening."
`;

// Stato in memoria per ogni chiamata (CallSid -> conversazione)
const conversations = new Map();

// ---------- MIDDLEWARE ----------
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ---------- HELPERS ----------

// Escape per testo dentro XML (TwiML)
function escapeXml(unsafe = "") {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Aggiunge un saluto finale se manca (per le risposte di chiusura)
function addClosingSalute(text = "") {
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

  if (/\b(tomorrow|pm|am|book|table)\b/i.test(t)) {
    return text + " Thank you, have a nice evening.";
  }

  return text + " Ti aspettiamo, buona serata.";
}

// Invio dati a Google Apps Script per creare evento su Calendar
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

  let convo = conversations.get(callId);
  if (!convo) {
    convo = {
      messages: [{ role: "system", content: SYSTEM_PROMPT }],
    };
  }

  // Aggiungiamo il messaggio dell’utente
  convo.messages.push({ role: "user", content: userText });

  // 🔹 Limitiamo la cronologia: system + ultimi 6 messaggi
  if (convo.messages.length > 8) {
    const systemMsg = convo.messages[0];
    const recent = convo.messages.slice(-7);
    convo.messages = [systemMsg, ...recent];
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini", // modello stabile
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
    };
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

// ---------- /twilio ----------
app.post("/twilio", async (req, res) => {
  const { CallSid, SpeechResult, text, From } = req.body || {};
  const { postFinal } = req.query || {};
  const isDebug = !!text && !SpeechResult;
  const callId = CallSid || (isDebug ? "debug-call" : "unknown-call");

  console.log("📞 /twilio body:", req.body);
  console.log("📲 Numero chiamante (From):", From, "postFinal:", postFinal);

  // ---- Modalità debug via curl (JSON in/out) ----
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

  // Primo ingresso: nessun SpeechResult -> messaggio di benvenuto
  if (!SpeechResult) {
    const welcomeText = `Ciao, ${RESTAURANT_NAME}, sono ${RECEPTIONIST_NAME}. Come posso aiutarti oggi?`;

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

  // QUI abbiamo sempre uno SpeechResult

  // ---- Finestra finale: se è solo un "grazie", chiudiamo gentili senza GPT ----
  if (postFinal === "1") {
    const userTextRaw = SpeechResult.trim();
    const lower = userTextRaw.toLowerCase();
    console.log("👤 Utente dopo prenotazione:", userTextRaw);

    const isThanksOnly =
      /grazie|thank you|thanks/.test(lower) &&
      !/cambia|change|sposta|modifica|orario|time/.test(lower);

    if (isThanksOnly) {
      const goodbyeTwiml = `
        <Response>
          <Say language="it-IT">
            ${escapeXml("Grazie a te, buona serata.")}
          </Say>
          <Hangup/>
        </Response>
      `.trim();

      return res.status(200).type("text/xml").send(goodbyeTwiml);
    }

    // Se NON è solo un grazie (es. "puoi cambiare la prenotazione..."),
    // continuiamo nel flusso normale e passiamo la frase a GPT.
  }

  // ---- Flusso normale Twilio (voce) ----
  try {
    const userText = SpeechResult.trim();
    console.log("👤 Utente dice:", userText);

    const giulia = await askGiulia(callId, userText);
    let replyText =
      giulia.reply_text ||
      "Scusa, non ho capito bene. Puoi ripetere per favore?";

    // Se è una prenotazione finale, invia al Calendar
    if (giulia.action === "create_reservation" && giulia.reservation) {
      const { date, time, people, name } = giulia.reservation || {};

      if (date && time && people && name) {
        sendToCalendar({
          nome: name,
          persone: people,
          data: date,
          ora: time,
          telefono: From,
        })
          .then((data) =>
            console.log("✅ Prenotazione creata:", {
              reservation: giulia.reservation,
              fromAppsScript: data,
            })
          )
          .catch((calErr) =>
            console.error("❌ Errore nella creazione prenotazione:", calErr)
          );
      } else {
        console.warn(
          "⚠️ create_reservation senza dati completi:",
          giulia.reservation
        );
      }
    }

    const shouldHangup = giulia.action === "create_reservation";

    let twiml;
    if (shouldHangup) {
      // garantiamo un saluto finale e poi una finestra di 5 secondi in ascolto
      const finalReply = addClosingSalute(replyText);

      twiml = `
        <Response>
          <Gather
            input="speech"
            language="it-IT"
            action="${BASE_URL}/twilio?postFinal=1"
            method="POST"
            timeout="5"
            speechTimeout="auto"
          >
            <Say language="it-IT" bargeIn="true">
              ${escapeXml(finalReply)}
            </Say>
          </Gather>
          <Say language="it-IT">
            Grazie ancora, a presto.
          </Say>
          <Hangup/>
        </Response>
      `.trim();
    } else {
      twiml = `
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
              ${escapeXml(replyText)}
            </Say>
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
