const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");

const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ROUTE DI TEST
app.get("/", (req, res) => {
  res.status(200).send("✅ Giulia Gateway è attiva e funzionante su Render!");
});

// ENDPOINT PER GOOGLE APPS SCRIPT
app.post("/calendar", async (req, res) => {
  console.log("📅 Richiesta da Apps Script:", req.body);
  res.status(200).json({ message: "Richiesta ricevuta correttamente da Giulia Gateway!" });
});

// ENDPOINT PER TWILIO
app.post("/twilio", async (req, res) => {
  console.log("📞 Richiesta da Twilio:", req.body);
  res.status(200).send("<Response><Say>Giulia è attiva e pronta ad aiutarti!</Say></Response>");
});

// AVVIO SERVER
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Server attivo sulla porta ${PORT}`);
});
