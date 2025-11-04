import express from "express";
import bodyParser from "body-parser";

const app = express();
app.use(bodyParser.json());

app.get("/", (req, res) => {
  res.json({ message: "Giulia Gateway attivo 🚀" });
});

app.post("/api/reservation", (req, res) => {
  console.log("Nuova prenotazione:", req.body);
  res.json({ success: true, data: req.body });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server attivo sulla porta ${PORT}`));
