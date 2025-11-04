// =======================
// 📞 GIULIA GATEWAY SERVER
// =======================

import express from "express";
import bodyParser from "body-parser";
import { OpenAI } from "openai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

// ====== CONFIG ======
const PORT = process.env.PORT || 10000;
const BASE_URL = process.env.BASE_URL || "https://giulia-gateway.onrender.com";
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ====== FUNZIONE PRINCIPALE ======
async function askGiulia(userText) {
  try {
    console.log(`Utente dice: ${userText}`);

    const response = await openai.responses.create({
      model: "gpt-4o-mini",
      input: `
      Sei Giulia, la receptionist di un ristorante italiano.
      Rispondi in tono naturale, cordiale e realistico.
      Utente: "${userText}"
      `,
    });

    const replyText = response.output[0].content[0].text;
    console.log("Risposta di Giulia:", replyText);
    return replyText;
  } catch (error) {
    console.error("Errore dalla API OpenAI:", error);
    return "Si è verificato un errore del server. Ti chiediamo di richiamare più tardi.";
  }
}

// ====== ROTTA PRINCIPALE TWILIO ======
app.post("/twilio", async (req, res) => {
  try {
    const userSpeech = req.body.SpeechResult || "Nessun messaggio ricevuto.";
    console.log("Twilio body:", req.body);

    const replyText = await askGiulia(userSpeech);

    const twiml = `
      <Response>
        <Say language="it-IT">${replyText}</Say>
        <Hangup/>
      </Response>
    `.trim();

    return res.status(200).type("text/xml").send(twiml);

  } catch (error) {
    console.error("Errore generale /twilio:", error);
    const errorTwiML = `
      <Response>
        <Say language="it-IT">
          Si è verificato un errore del server. Ti chiediamo di richiamare più tardi.
        </Say>
        <Hangup/>
      </Response>
    `.trim();
    return res.status(500).type("text/xml").send(errorTwiML);
  }
});

// ====== AVVIO SERVER ======
app.listen(PORT, () => {
  console.log(`🚀 Server attivo sulla porta ${PORT}`);
  console.log(`👉 Available at your primary URL: ${BASE_URL}`);
});
