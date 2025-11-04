import express from "express";
import bodyParser from "body-parser";

const app = express();

// per JSON e form-url-encoded (quello che usa Twilio)
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

// 🔍 Endpoint di test (se apri l'URL da browser)
app.get("/", (req, res) => {
  res.json({ message: "Giulia Gateway attivo 🚀" });
});

// 📞 Endpoint che userà Twilio per le chiamate voce
app.post("/twilio/voice", (req, res) => {
  const twiml = `
    <Response>
      <Say voice="alice" language="it-IT">
        Ciao, sono Giulia in versione test.
        Se senti questa voce, il collegamento tra Twilio e il server funziona correttamente.
      </Say>
    </Response>
  `;
  res.type("text/xml");
  res.send(twiml);
});

// (ci teniamo anche un endpoint finto per le prenotazioni future)
app.post("/api/reservation", (req, res) => {
  console.log("Nuova prenotazione:", req.body);
  res.json({ success: true, data: req.body });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server attivo sulla porta ${PORT}`));
