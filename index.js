// ===============================
// Giulia Gateway - v1.1 (Render + Apps Script)
// ===============================

import express from "express";
import bodyParser from "body-parser";
import cors from "cors";

const app = express();

// URL della Web App di Google Apps Script (Calendar)
const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbxMYLD4wfNopBN61SZRs46PfZFRs3Bn8kZMWPEgW8k_PWicCtj47Xfzy12vrCjWNqkRdA/exec";

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ===============================
// ROUTE DI TEST BASE
// ===============================
app.get("/", (req, res) => {
  res
    .status(200)
    .send("✅ Giulia Gateway è attiva e funzionante su Render!");
});

// ===============================
// ENDPOINT PER GOOGLE APPS SCRIPT / CALENDAR
// ===============================
//
// Chiamando POST /calendar con un JSON tipo:
// {
//   "nome": "Mirko",
//   "persone": 4,
//   "data": "2025-11-10",
//   "ora": "20:30:00"
// }
//
// il gateway inoltra questi dati alla Web App di Apps Script.
app.post("/calendar", async (req, res) => {
  try {
    console.log("📅 Richiesta in arrivo su /calendar:", req.body);

    const payload = req.body;

    const response = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const text = await response.text();
    let data;

    // Provo a parsare come JSON, altrimenti restituisco testo grezzo
    try {
      data = JSON.parse(text);
    } catch (e) {
      data = { rawResponse: text };
    }

    if (!response.ok) {
      console.error("Errore risposta Apps Script:", data);
      return res
        .status(500)
        .json({ success: false, fromAppsScript: data });
    }

    console.log("✅ Risposta da Apps Script:", data);
    return res.status(200).json({ success: true, fromAppsScript: data });
  } catch (error) {
    console.error("Errore /calendar:", error);
    return res
      .status(500)
      .json({ success: false, error: error.message });
  }
});

// ===============================
// ENDPOINT PER TWILIO (TEST VOCALE)
// ===============================
app.post("/twilio", async (req, res) => {
  try {
    console.log("📞 Richiesta da Twilio:", req.body);

    // Qui per ora rispondiamo solo con un messaggio fisso.
    // In futuro aggiungeremo tutta la logica di Giulia.
    const twiml = `
      <Response>
        <Say language="it-IT">
          Giulia è attiva e pronta ad aiutarti!
        </Say>
      </Response>
    `.trim();

    res
      .status(200)
      .type("text/xml")
      .send(twiml);
  } catch (error) {
    console.error("Errore /twilio:", error);
    res
      .status(500)
      .type("text/xml")
      .send(
        "<Response><Say>Si è verificato un errore del server.</Say></Response>"
      );
  }
});

// ===============================
// AVVIO SERVER
// ===============================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Server attivo sulla porta ${PORT}`);
});
