// ===============================
// Giulia Gateway - v1.0
// Node.js + Express (Render Ready)
// ===============================

import express from "express";
import bodyParser from "body-parser";
import cors from "cors";

const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ===============================
// ROUTE BASE DI TEST
// ===============================
app.get("/", (req, res) => {
  res.status(200).send("✅ Giulia Gateway è attiva e funzionante!");
});

// ===============================
// ENDPOINT PER GOOGLE APPS SCRIPT
// ===============================
app.post("/calendar", async (req, res) => {
  try {
    console.log("📅 Nuova richiesta da Apps Script:", req.body);
    // Qui potrai aggiungere la logica per creare o leggere eventi su Google Calendar
    res.status(200).json({ message: "Richiesta ricevuta correttamente da Giulia Gateway!" });
  } catch (error) {
    console.error("Errore /calendar:", error);
    res.status(500).json({ error: "Errore interno del server" });
  }
});

// ===============================
// ENDPOINT PER TWILIO
// ===============================
app.post("/twilio", async (req, res) => {
  try {
    console.log("📞 Richiesta da Twilio:", req.body);
    // Qui aggiungerai la logica per gestire messaggi o chiamate da Twilio
    res.status(200).send("<Response><Say>Giulia è attiva e pronta ad aiutarti!</Say></Response>");
  } catch (error) {
    console.error("Errore /twilio:", error);
    res.status(500).send("<Response><Say>Errore del server</Say></Response>");
  }
});

// ===============================
// AVVIO SERVER
// ===============================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Server attivo sulla porta ${PORT}`);
});
