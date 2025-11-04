// ===============================
// Giulia Gateway - GPT + Calendar
// ===============================

import express from "express";
import bodyParser from "body-parser";
import cors from "cors";

const app = express();

// ---------- CONFIG ----------

// Web App di Google Apps Script per il Calendar
const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbxMYLD4wfNopBN61SZRs46PfZFRs3Bn8kZMWPEgW8k_PWicCtj47Xfzy12vrCjWNqkRdA/exec";

// URL pubblico di questo server su Render
const BASE_URL = "https://giulia-gateway.onrender.com";

// Prompt "di sistema" di Giulia
const SYSTEM_PROMPT = `
Sei Giulia, la receptionist di un ristorante italiano.
Parli sempre in italiano, con tono gentile, sintetico e professionale.
Sei al telefono, quindi:
- le tue risposte devono essere brevi (massimo 2 frasi, 5–7 secondi di audio)
- non fare monologhi, vai dritta al punto
- alla fine di quasi ogni risposta fai una domanda chiara per far avanzare la conversazione,
  TRANNENEL CASO in cui la prenotazione sia già confermata.

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
- QUANDO "action" = "create_reservation":
  -> "reply_text" deve essere SOLO una frase di conferma della prenotazione,
     SENZA aggiungere domande finali (es. niente "Hai altre richieste?" o simili).
  -> Esempio: "Perfetto Luca, la tua prenotazione è confermata per domani alle 20:00 per 2 persone. Ti aspettiamo."
- In tutti gli altri casi usa l’action corrispondente al passo successivo (es. ask_time, ask_people…).
- Se il cliente chiede solo informazioni (es. sul pesce o sui prezzi), usa "answer_menu" o "answer_generic" e lascia "reservation" invariata.
- Non aggiungere mai altro fuori dal JSON. Solo JSON valido.
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
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
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

// Chiamata a GPT usando direttamente l'endpoint HTTP (come nel curl)
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

  convo.messages.push({ role: "user", content: userText });

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-5-nano",
      messages: convo.messages
      // ⚠️ niente temperature: gpt-5-nano non supporta valori diversi dal default
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("❌ Errore dalla API OpenAI:", response.status, errorText);
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content?.trim() || "";
  console.log("🧠 Risposta raw da GPT:", raw);

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error("❌ JSON non valido restituito da GPT, uso fallback:", e);
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

// ---------- /calendar (REST per altri canali) ----------
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

// ---------- /twilio (voce + test debug) ----------
//
// - Se viene chiamato da Twilio: usa CallSid + SpeechResult
// - Se lo chiami tu via curl con JSON { "text": "..." } → modalità debug (risposta JSON)
app.post("/twilio", async (req, res) => {
  const { CallSid, SpeechResult, text } = req.body || {};
  const isDebug = !!text && !SpeechResult;
  const callId = CallSid || (isDebug ? "debug-call" : "unknown-call");

  console.log("📞 /twilio body:", req.body);

  // ---- Modalità debug via curl (JSON in / out) ----
  if (isDebug) {
    try {
      const receptionist = await askReceptionist(callId, text.trim());
      return res.status(200).json(receptionist);
    } catch (error) {
      console.error("Errore /twilio debug:", error);
      return res.status(500).json({
        error: "Errore interno chiamando GPT",
        details: error.message,
      });
    }
  }

  // ---- Flusso normale Twilio (voce) ----

  // Primo ingresso: nessun SpeechResult -> messaggio di benvenuto
  if (!SpeechResult) {
    const welcomeText =
      `Ciao, sono ${RECEPTIONIST_NAME} di ${RESTAURANT_NAME}. ` +
      `Dimmi pure per che giorno e a che ora vuoi prenotare, oppure fammi una domanda sul menù.`;

    const twiml = `
      <Response>
        <Gather input="speech" language="it-IT" action="${BASE_URL}/twilio" method="POST">
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

    const receptionist = await askReceptionist(callId, userText);
    const replyText =
      receptionist.reply_text ||
      "Scusa, non ho capito bene. Puoi ripetere per favore?";

    // Se abbiamo tutto per creare una prenotazione, chiamiamo il Calendar
    if (receptionist.action === "create_reservation" && receptionist.reservation) {
      const { date, time, people, name } = receptionist.reservation;

      if (date && time && people && name) {
        try {
          await sendToCalendar({
            nome: name,
            persone: people,
            data: date,
            ora: time,
          });
          console.log("✅ Prenotazione creata:", receptionist.reservation);
        } catch (calErr) {
          console.error("❌ Errore nella creazione prenotazione:", calErr);
        }
      }
    }

    const shouldHangup = receptionist.action === "create_reservation";

    let twiml;
    if (shouldHangup) {
      twiml = `
        <Response>
          <Say language="it-IT">${escapeXml(replyText)}</Say>
          <Hangup/>
        </Response>
      `.trim();
    } else {
      twiml = `
        <Response>
          <Gather input="speech" language="it-IT" action="${BASE_URL}/twilio" method="POST">
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

          console.log("✅ Prenotazione creata da Giulia:", giulia.reservation);
        } catch (calErr) {
          console.error("❌ Errore nella creazione prenotazione:", calErr);
        }
      }
    }

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
