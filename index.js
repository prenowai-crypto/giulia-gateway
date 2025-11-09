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

// Web App di Google Apps Script per il Calendar + notifiche evento
const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbxMYLD4wfNopBN61SZRs46PfZFRs3Bn8kZMWPEgW8k_PWicCtj47Xfzy12vrCjWNqkRdA/exec";

// URL pubblico di questo server su Render
const BASE_URL = "https://giulia-gateway.onrender.com";

// Email proprietario / gestione eventi
const OWNER_EMAIL = "prenowai@gmail.com";

// Soglie per gruppi
const LARGE_GROUP_THRESHOLD = 10;  // sopra → “grande gruppo”, da confermare
const EVENT_THRESHOLD = 45;        // sopra → evento gigante, niente Calendar

// invio mail al proprietario per gruppi enormi (evento) tramite Apps Script
async function sendOwnerEmail({ name, people, date, time, phone, customerEmail }) {
  try {
    const payload = {
      action: "notify_big_event", // gestito in Apps Script
      nome: name,
      persone: people,
      data: date,
      ora: time,
      telefono: phone || "",
      email: customerEmail || "",
      ownerEmail: OWNER_EMAIL,
    };

    console.log("📧 Invio richiesta evento grande a Apps Script:", payload);

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
      console.error("❌ Errore Apps Script (email proprietario):", data);
      return;
    }

    console.log("✉️ Risposta Apps Script (email proprietario):", data);
  } catch (err) {
    console.error("❌ Errore chiamando Apps Script per email proprietario:", err);
  }
}

// ---------- SYSTEM PROMPT ----------
const SYSTEM_PROMPT = `
Sei ${RECEPTIONIST_NAME}, la receptionist di un ristorante italiano chiamato ${RESTAURANT_NAME}.

LINGUE:
- Capisci sia italiano sia inglese.
- Se il cliente parla soprattutto in italiano, rispondi in italiano.
- Se il cliente parla in inglese, rispondi in inglese.
- Se cambia lingua durante la chiamata, adeguati alla lingua che usa nella sua ultima frase.
- Non mescolare le lingue nella stessa risposta.
- "reply_text" deve SEMPRE essere nella stessa lingua dell'ULTIMO messaggio del cliente.

RUOLO:
- Sei una receptionist umana al telefono, gentile, sintetica e professionale.
- Parli come in una telefonata vera, non come un’email.
- Non parlare mai di "intelligenza artificiale" o "modelli linguistici".

STILE:
- Frasi brevi, massimo 2 frasi per risposta (5–7 secondi di audio).
- Vai dritta al punto, niente discorsi lunghi.
- Evita scuse lunghe tipo "mi dispiace molto, purtroppo...": se sbagli, una sola frase breve.
- Fai quasi sempre una domanda chiara per far avanzare la conversazione, TRANNE NELLA RISPOSTA FINALE.

OBIETTIVO:
- Gestire prenotazioni: giorno, orario, numero di persone, nome.
- Puoi anche rispondere a domande su menù, prezzi indicativi, tipologia di cucina, orari.
- Quando hai quasi tutti i dati per la prenotazione, se possibile chiedi anche un indirizzo email per inviare una conferma:
  - se il cliente te la dà, memorizzala in reservation.customerEmail.
  - se il cliente non vuole o non la ricorda, non insistere e lascia reservation.customerEmail = null.

GESTIONE EMAIL (MOLTO IMPORTANTE):
- Quando il cliente ti detta l'indirizzo email, devi SEMPRE fare uno spelling chiaro, lettera per lettera, e chiedere conferma.
- NON usare mai il simbolo "-" nello spelling: separa lettere e numeri solo con pause o spazi, non dire "trattino" o "meno".
- In italiano:
  - Ripeti l'email separando le lettere con piccole pause, ad esempio:
    "Quindi l'email è: m i r k o c a r t a 1 3 chiocciola gmail punto com, giusto?"
  - Usa parole come "chiocciola" per "@", "punto" per ".", e pronuncia i numeri chiaramente (es. "uno tre").
  - Quando fai lo spelling in italiano, per la lettera "w" di' sempre "doppia vù".
- In inglese:
  - Esempio: "So your email is m i r k o c a r t a 1 3 at gmail dot com, is that correct?"
- Per domini molto comuni come "gmail.com", "outlook.com", "yahoo.com":
  - NON fare lo spelling lettera per lettera del dominio.
  - Di' semplicemente: "gmail punto com", "outlook punto com", ecc.
- Se il cliente dice che NON è corretta, chiedigli di ridettare l'email con calma, sovrascrivi il valore precedente e ripeti DI NUOVO lo spelling prima di andare avanti.
- Quando l'email del cliente è chiara (anche dopo una correzione), metti SEMPRE il valore definitivo in reservation.customerEmail.
- Non andare mai alla risposta finale di prenotazione se non hai completato questo controllo sull'email (quando il cliente ti ha fornito un'email).

EMAIL DEL RISTORANTE (IMPORTANTE):
- L'email ufficiale del ristorante è: ${OWNER_EMAIL}.
- Quando il cliente chiede "l'email del ristorante", "a che indirizzo devo scrivere", "la vostra mail", oppure in inglese "the restaurant email", "email of the restaurant", "where should I write to the restaurant", ecc.:
  - devi SEMPRE rispondere con questo indirizzo email.
  - puoi fare lo spelling, ma l'indirizzo deve restare esattamente ${OWNER_EMAIL}.
  - NON inventare mai altri indirizzi (niente "ristorante@gmail.com", "info@...", "ristorante premio@gmail.com" ecc.).
- Non mettere mai l'email del ristorante in reservation.customerEmail: in reservation.customerEmail va SOLO l'email del cliente.

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
- Non farlo ricominciare da zero: aggiorna solo il pezzo che va cambiato (data, ora, persone, nome o email).
- Se il cliente cambia argomento (es. da prenotazione a menù), rispondi alla domanda, poi riportalo gentilmente alla prenotazione.

CAMBIO PRENOTAZIONE (CAMBIO DATA/ORARIO):
- Se il cliente vuole CAMBIARE o SPOSTARE una prenotazione esistente (es. "vorrei spostare la prenotazione", "cambia l'orario", "mettila alle 21", "can you move my booking to 9pm"):
  - NON usare "cancel_reservation" da solo.
  - In questi casi devi:
    1) capire la nuova data (anche con "oggi", "domani", "dopodomani", "stasera", "lunedì", "tomorrow", "tonight", "next Monday", ecc.),
    2) capire il nuovo orario,
    3) mettere la nuova data e il nuovo orario in reservation.date e reservation.time,
    4) usare "action": "create_reservation".
- Il sistema aggiornerà automaticamente la prenotazione esistente per quel cliente (stesso numero di telefono) senza che tu faccia una cancellazione manuale separata.
- Usa "cancel_reservation" SOLO quando il cliente vuole davvero annullare la prenotazione senza crearne un'altra (es. "vorrei cancellare la prenotazione", "annulla il tavolo").

NOME:
- Se il cliente ti ha già detto chiaramente il nome (es. "mi chiamo Marco", "sono Mirko"), NON chiederlo di nuovo.
- In quel caso usa direttamente quel nome nella prenotazione, senza ripetere la domanda "come ti chiami?".

GESTIONE ORARI:
- Se il cliente dice un orario senza specificare mattina/pomeriggio (es. "alle 8", "otto e mezza", "alle 9"),
  interpretalo come ORARIO DI SERA, tra 18:00 e 23:00.
  - "alle 8" -> "20:00:00"
  - "alle 9" -> "21:00:00"
- Se il cliente specifica chiaramente "di mattina" o "di pomeriggio", rispetta quello che dice.

COME PARLI DELLA DATA A VOCE:
- Se il cliente usa espressioni relative come "oggi", "domani", "dopodomani", "stasera", "questa sera", "lunedì", "martedì", oppure in inglese "today", "tomorrow", "day after tomorrow", "tonight", "this evening", "Monday", "Tuesday", ecc.:
  - nella "reply_text" parla nello stesso modo relativo che usa il cliente:
    - es. "domani sera alle 20:00", "dopodomani alle 21:00", "lunedì alle 19:30", "tomorrow at 8 pm", "Monday at 7:30 pm".
  - NON trasformare queste espressioni in date con giorno e mese (es. niente "2 novembre" o "November 2nd" se il cliente ha detto "domani").
- Puoi usare giorno e mese (es. "2 novembre", "November 2nd") solo se il cliente li ha già detti esplicitamente o se sta già parlando in quel modo.

GESTIONE CANCELLAZIONI:
- Se il cliente vuole annullare una prenotazione (es. "vorrei cancellare la prenotazione", "puoi annullare il tavolo di domani a nome Mirko"):
  - prova a capire chiaramente:
    - giorno (es. oggi, domani, 7 novembre) → mettilo in reservation.date in formato YYYY-MM-DD
    - nome della prenotazione (reservation.name)
    - orario solo se il cliente lo specifica (reservation.time), altrimenti puoi lasciarlo null.
- Se non sei sicura di quale prenotazione annullare, chiedi UNA sola domanda di chiarimento (es. "Per quale giorno vuoi cancellare la prenotazione?").
- Quando hai capito cosa annullare, usa:
  - "action": "cancel_reservation"
  - "reservation.date": con la data in formato YYYY-MM-DD
  - "reservation.time": se il cliente dice un orario specifico, altrimenti null
  - "reservation.name": il nome della prenotazione
- Nella "reply_text" non dire che è già cancellata finché non hai usato "cancel_reservation":
  - frasi tipo: "Va bene, procedo a cancellare la prenotazione." o "Ok, la metto come annullata."
  - la conferma finale verrà completata dal sistema.

GESTIONE DATE RELATIVE:
- "oggi" / "today" → stessa data del giorno corrente.
- "domani" / "tomorrow" → giorno successivo.
- "dopodomani" / "day after tomorrow" → +2 giorni.
- "stasera" / "tonight" / "this evening" → stessa data di oggi, orario serale.
- "domani sera" / "tomorrow evening" → data di domani, orario serale.
- Non inventare mai una data o un orario se il cliente non li ha ancora detti o se non sono chiari: in quel caso usa "ask_date" o "ask_time".

GESTIONE NUMERO DI PERSONE:
- Se il cliente dice frasi come "da 3 a 4 persone" o "from 3 to 4 people", interpreta SEMPRE il numero FINALE come numero di persone (4). Non sommare, non inventare numeri più alti.
- Se il cliente chiede di aumentare le persone con frasi del tipo "ci raggiunge un altro amico" ma non è chiaro il totale finale, chiedi esplicitamente "Quante persone sarete in totale?".

RICHIESTE SOLO INFORMAZIONI:
- Se il cliente chiede solo informazioni (menù, prezzi, allergie, parcheggio, orari) e NON sta chiaramente facendo o cambiando una prenotazione:
  - usa "action": "answer_menu" o "answer_generic".
  - In questi casi, TUTTI i campi in "reservation" devono restare null (date, time, people, name, customerEmail).

USO DELLE ACTION (IMPORTANTISSIMO):
- Usa "ask_name" SOLO quando:
  - NON hai ancora un nome chiaro in reservation.name
  - ti serve il nome per procedere con la prenotazione.
- Se hai già un nome chiaro (il cliente ha detto "mi chiamo X", "sono X", "under the name X", ecc.):
  - NON usare "ask_name".
  - Se ti manca l'email, usa "ask_email".
- Usa "ask_email" quando:
  - hai già data, ora, persone e nome (o almeno data, ora e nome)
  - ti serve l'email per la conferma.
- Usa "create_reservation" SOLO quando:
  - hai una prenotazione completa o da aggiornare, con almeno:
    - reservation.date (YYYY-MM-DD)
    - reservation.time (HH:MM:SS)
    - reservation.name (nome della prenotazione)
    - idealmente anche reservation.people se è una nuova prenotazione.
- Se mancano data, ora o nome, NON usare "create_reservation": in quei casi usa "ask_date", "ask_time" o "ask_name" a seconda di cosa manca.
- Usa "cancel_reservation" SOLO quando il cliente vuole annullare una prenotazione e hai capito almeno la data (e se possibile il nome).
- Per richieste solo informative, usa "answer_menu" o "answer_generic" e lascia tutta la "reservation" a null.

FORMATO DI USCITA:
Devi SEMPRE rispondere in questo formato JSON, SOLO JSON, senza testo fuori:

{
  "reply_text": "testo che devo dire a voce al cliente",
  "action": "none | ask_date | ask_time | ask_people | ask_name | ask_email | answer_menu | answer_generic | create_reservation | cancel_reservation",
  "reservation": {
    "date": "YYYY-MM-DD oppure null",
    "time": "HH:MM:SS oppure null",
    "people": numero oppure null,
    "name": "nome oppure null",
    "customerEmail": "email del cliente oppure null"
  }
}

Regole:
- "reply_text" è la frase naturale che dirai al telefono, nella stessa lingua usata dal cliente (italiano o inglese).
- "action" = "create_reservation" SOLO quando hai TUTTI i dati necessari (almeno data, ora e nome) per fare la prenotazione o per aggiornarne/spostarne una già esistente.
- "action" = "cancel_reservation" quando il cliente vuole annullare una prenotazione e hai capito almeno la data (e se possibile nome/orario).
- "customerEmail" può essere null se il cliente non la vuole dare o non è necessaria.
- "answer_menu" o "answer_generic" vanno usate solo per richieste di informazioni, e in quel caso TUTTI i campi di "reservation" devono restare null.
- Negli altri casi usa le action "ask_date", "ask_time", "ask_people", "ask_name", "ask_email" per chiedere le informazioni mancanti.

RISPOSTA FINALE (create_reservation):
- Quando "action" = "create_reservation" la tua risposta deve essere una CHIUSURA FINALE:
  - conferma chiaramente la prenotazione (data, ora, persone, nome).
  - Se il cliente ha usato una data relativa ("domani", "dopodomani", "tomorrow", ecc.), puoi confermare usando quella forma ("domani sera alle 20:00") invece di dire giorno e mese.
  - NON fare altre domande
  - NON usare frasi tipo "va bene?", "confermi?", "sei d'accordo?".
  - chiudi con un saluto finale, ad esempio:
    - in italiano: "Ti aspettiamo, buona serata."
    - in inglese: "We look forward to seeing you, have a nice evening."
`;

// Stato in memoria per ogni chiamata (CallSid -> conversazione usata per GPT)
const conversations = new Map();

// Nuova mappa: lingua della chiamata per Twilio STT/TTS (CallSid -> "it-IT" | "en-US")
const callLanguages = new Map();

// Nuova mappa: cronologia GREZZA dei testi utente (CallSid -> array di stringhe)
// Usata SOLO per capire "oggi/domani/dopodomani/tomorrow/tonight" senza tagliare nulla.
const userTextHistory = new Map();

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

// Leggi la lingua corrente della chiamata (default: it-IT)
function getCallLanguage(callId) {
  return callLanguages.get(callId) || "it-IT";
}

// Imposta/aggiorna la lingua della chiamata
function setCallLanguage(callId, lang) {
  if (!callId) return;
  callLanguages.set(callId, lang);
}

// Aggiunge testo utente grezzo alla cronologia della chiamata
function appendUserText(callId, text) {
  if (!callId || !text) return;
  const arr = userTextHistory.get(callId) || [];
  arr.push(text);
  userTextHistory.set(callId, arr);
}

// Ottiene tutta la conversazione utente (solo testo) in un'unica stringa
function getAllUserText(callId) {
  const arr = userTextHistory.get(callId);
  if (!arr || arr.length === 0) return "";
  return arr.join(" ");
}

// Rileva se l’utente sta chiedendo di passare all’inglese
function maybeSwitchToEnglish(callId, userText) {
  const t = (userText || "").toLowerCase();

  const wantsEnglish =
    t.includes("do you speak english") ||
    t.includes("can we speak english") ||
    t.includes("speak in english") ||
    t.includes("english please") ||
    t.includes("in english") ||
    t.includes("parli inglese") ||
    t.includes("parla inglese") ||
    t.includes("in inglese");

  if (wantsEnglish) {
    setCallLanguage(callId, "en-US");
  }
}

// Rileva se l’utente vuole passare all’italiano (es. "I'm Italian and not understanding you")
function maybeSwitchToItalian(callId, userText) {
  const t = (userText || "").toLowerCase();
  const wantsItalian =
    t.includes("parli italiano") ||
    t.includes("parla italiano") ||
    t.includes("in italiano") ||
    ((t.includes("italian") || t.includes("italiano")) &&
      (t.includes("not understand") ||
        t.includes("not understanding") ||
        t.includes("don't understand") ||
        t.includes("dont understand") ||
        t.includes("non capisco")));

  if (wantsItalian) {
    setCallLanguage(callId, "it-IT");
  }
}

// Riconosce se l'utente sta chiedendo l'email del ristorante
function isRestaurantEmailQuestion(text = "") {
  const t = text.toLowerCase();

  // se parla della "mia mail" / "my email" NON è la mail del ristorante
  if (
    t.includes("mia mail") ||
    t.includes("la mia mail") ||
    t.includes("la mia email") ||
    t.includes("my email")
  ) {
    return false;
  }

  // Italiano
  if (
    t.includes("mail del ristorante") ||
    t.includes("email del ristorante") ||
    t.includes("indirizzo email del ristorante") ||
    t.includes("indirizzo del ristorante") ||
    t.includes("mail del locale") ||
    t.includes("email del locale") ||
    t.includes("mail del posto") ||
    t.includes("email del posto") ||
    (t.includes("devo scrivere") && (t.includes("mail") || t.includes("email")))
  ) {
    return true;
  }

  // Inglese
  if (
    t.includes("restaurant email") ||
    t.includes("email of the restaurant") ||
    t.includes("restaurant's email") ||
    (t.includes("email address") && t.includes("restaurant")) ||
    (t.includes("where") && t.includes("email") && t.includes("restaurant"))
  ) {
    return true;
  }

  return false;
}

// Riconosce se chiede esplicitamente lo spelling della mail (di solito quella del ristorante)
function isRestaurantEmailSpellingRequest(text = "") {
  const t = text.toLowerCase();

  if (isRestaurantEmailQuestion(t)) return true;

  return (
    t.includes("spelling della mail") ||
    t.includes("spelling dell'email") ||
    t.includes("puoi dettarmi la mail") ||
    t.includes("puoi dettarmi l'email") ||
    t.includes("mi puoi fare lo spelling della mail") ||
    t.includes("come si scrive la vostra mail") ||
    t.includes("come si scrive la mail del ristorante") ||
    t.includes("how do you spell your email") ||
    t.includes("can you spell the email") ||
    t.includes("spell your email")
  );
}

// Converte un'email in una stringa "parlata" per il TTS
function spellEmailForTTS(email, lang = "it-IT") {
  if (!email || typeof email !== "string") return "";

  const [localPart, domainAndTld] = email.split("@");
  if (!localPart || !domainAndTld) return email;

  const domainParts = domainAndTld.split(".");
  const domain = domainParts[0] || "";
  const tld = domainParts.slice(1).join("."); // gestisce anche "co.uk"

  function spellCharIt(ch) {
    const lower = ch.toLowerCase();
    if (lower === "w") return "doppia vù";
    return ch; // Twilio leggerà la lettera
  }

  const localSpelled =
    lang === "en-US"
      ? localPart.split("").join(" ")
      : localPart
          .split("")
          .map(spellCharIt)
          .join(" ");

  const commonDomains = ["gmail", "outlook", "hotmail", "yahoo", "icloud"];
  const isCommonDomain = commonDomains.includes(domain.toLowerCase());

  const domainSpoken = isCommonDomain
    ? domain.toLowerCase() // "gmail", "outlook" ecc.
    : domain.split("").join(" ");

  const tldSpoken = tld || "";

  if (lang === "en-US") {
    let s = `${localSpelled} at ${domainSpoken}`;
    if (tldSpoken) s += ` dot ${tldSpoken}`;
    return s;
  } else {
    let s = `${localSpelled} chiocciola ${domainSpoken}`;
    if (tldSpoken) s += ` punto ${tldSpoken}`;
    return s;
  }
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

// Sanifica l'indirizzo email: rimuove tutti gli spazi
function sanitizeEmail(email) {
  if (!email || typeof email !== "string") return null;
  const cleaned = email.replace(/\s+/g, "");
  return cleaned || null;
}

// Prende da TUTTA la conversazione utente parole tipo
// "domani", "dopo domani", "dopodomani", "stasera", "oggi",
// "tomorrow", "day after tomorrow", "tonight", "this evening", "today",
// e i giorni della settimana IT/EN.
function inferDateFromConversation(callId) {
  const allUserTextRaw = getAllUserText(callId);
  const allUserText = (allUserTextRaw || "").toLowerCase();

  if (!allUserText.trim()) return null;

  const now = new Date();

  // 1) Espressioni relative IT/EN
  let offsetDays = null;

  if (
    allUserText.includes("day after tomorrow") ||
    allUserText.includes("dopodomani") ||
    allUserText.includes("dopo domani")
  ) {
    offsetDays = 2;
  } else if (allUserText.includes("tomorrow") || allUserText.includes("domani")) {
    offsetDays = 1;
  } else if (
    allUserText.includes("stasera") ||
    allUserText.includes("questa sera") ||
    allUserText.includes("tonight") ||
    allUserText.includes("this evening")
  ) {
    offsetDays = 0;
  } else if (allUserText.includes("oggi") || allUserText.includes("today")) {
    offsetDays = 0;
  }

  if (offsetDays !== null) {
    const target = new Date(now);
    target.setDate(now.getDate() + offsetDays);

    const yyyy = target.getFullYear();
    const mm = String(target.getMonth() + 1).padStart(2, "0");
    const dd = String(target.getDate()).padStart(2, "0");

    const inferred = `${yyyy}-${mm}-${dd}`;
    console.log("📆 Data inferita dalla conversazione (relative):", inferred);
    return inferred;
  }

  // 2) Giorni della settimana IT/EN → prossimo giorno utile
  const weekdayMap = [
    { patterns: ["domenica", "sunday"], index: 0 },
    { patterns: ["lunedi", "lunedì", "monday"], index: 1 },
    { patterns: ["martedi", "martedì", "tuesday"], index: 2 },
    { patterns: ["mercoledi", "mercoledì", "wednesday"], index: 3 },
    { patterns: ["giovedi", "giovedì", "thursday"], index: 4 },
    { patterns: ["venerdi", "venerdì", "friday"], index: 5 },
    { patterns: ["sabato", "saturday"], index: 6 },
  ];

  let targetWeekday = null;

  for (const entry of weekdayMap) {
    for (const p of entry.patterns) {
      if (allUserText.includes(p)) {
        targetWeekday = entry.index;
        break;
      }
    }
    if (targetWeekday !== null) break;
  }

  if (targetWeekday !== null) {
    const currentDow = now.getDay(); // 0 domenica .. 6 sabato
    let diff = targetWeekday - currentDow;
    if (diff <= 0) {
      diff += 7; // prossimo giorno di quel tipo
    }

    const target = new Date(now);
    target.setDate(now.getDate() + diff);

    const yyyy = target.getFullYear();
    const mm = String(target.getMonth() + 1).padStart(2, "0");
    const dd = String(target.getDate()).padStart(2, "0");

    const inferred = `${yyyy}-${mm}-${dd}`;
    console.log("📆 Data inferita dalla conversazione (weekday):", inferred);
    return inferred;
  }

  return null;
}

// Normalizza la data della prenotazione per il Calendar
function normalizeReservationForCalendar(reservation = {}, callId) {
  let { date, time, people, name, customerEmail } = reservation;

  // se il modello ha messo "null" come stringa, trattalo come null
  if (date === "null") date = null;

  // 1) se riusciamo a capire "oggi/domani/dopodomani/tonight/tomorrow", usiamo quella
  const inferred = inferDateFromConversation(callId);
  if (inferred) {
    date = inferred;
  } else if (typeof date === "string") {
    // 2) altrimenti, fai almeno il fix dell'anno (2023 -> anno corrente)
    const parts = date.split("-");
    if (parts.length === 3) {
      let [y, m, d] = parts.map((p) => p.trim());
      const yearNum = parseInt(y, 10);
      const currentYear = new Date().getFullYear();

      if (!isNaN(yearNum) && yearNum < currentYear) {
        y = String(currentYear);
      }
      date = `${y}-${m}-${d}`;
    }
  }

  // sanifica email se presente
  if (customerEmail) {
    customerEmail = sanitizeEmail(customerEmail);
  }

  return { date, time, people, name, customerEmail };
}

// Invio dati a Google Apps Script per creare/aggiornare/cancellare evento su Calendar
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

  // 🔹 Limitiamo la cronologia: system + ultimi 5 messaggi
  if (convo.messages.length > 7) {
    const systemMsg = convo.messages[0];
    const recent = convo.messages.slice(-5);
    convo.messages = [systemMsg, ...recent];
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
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
      customerEmail: null,
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
      customerEmail: null,
    };
  } else {
    if (!Object.prototype.hasOwnProperty.call(parsed.reservation, "customerEmail")) {
      parsed.reservation.customerEmail = null;
    }
  }

  // Sanifica l'email nel JSON della prenotazione
  if (
    parsed.reservation &&
    typeof parsed.reservation.customerEmail === "string"
  ) {
    parsed.reservation.customerEmail = sanitizeEmail(
      parsed.reservation.customerEmail
    );
  }

  // 🔒 SAFETY NET 1: se l'action è ask_name ma il nome è già presente → chiedi l'email
  if (
    parsed.action === "ask_name" &&
    parsed.reservation &&
    parsed.reservation.name &&
    String(parsed.reservation.name).trim() !== ""
  ) {
    console.warn("⚠️ ask_name con name già presente, converto in ask_email");
    parsed.action = "ask_email";
  }

  // 🔒 SAFETY NET 2: se è una risposta solo-informazioni, azzera tutta la reservation
  if (
    parsed.action === "answer_menu" ||
    parsed.action === "answer_generic"
  ) {
    parsed.reservation = {
      date: null,
      time: null,
      people: null,
      name: null,
      customerEmail: null,
    };
  }

  // 🔒 SAFETY NET 3: create_reservation senza dati minimi → declassa ad ask_*
  if (parsed.action === "create_reservation") {
    const r = parsed.reservation || {};
    const hasDate = r.date && String(r.date).trim() !== "";
    const hasTime = r.time && String(r.time).trim() !== "";
    const hasName = r.name && String(r.name).trim() !== "";

    if (!hasDate || !hasTime || !hasName) {
      console.warn(
        "⚠️ create_reservation senza data/ora/nome completi, declasso ad ask_*",
        parsed.reservation
      );
      if (!hasDate) {
        parsed.action = "ask_date";
      } else if (!hasTime) {
        parsed.action = "ask_time";
      } else if (!hasName) {
        parsed.action = "ask_name";
      }
    }
  }

  // 🔒 SAFETY NET 4: se chiede ancora ask_email ma abbiamo già email + dati completi → promuovi a create_reservation
  if (parsed.action === "ask_email") {
    const r = parsed.reservation || {};
    const hasDate = r.date && String(r.date).trim() !== "";
    const hasTime = r.time && String(r.time).trim() !== "";
    const hasName = r.name && String(r.name).trim() !== "";
    const hasEmail =
      r.customerEmail && String(r.customerEmail).trim() !== "";

    if (hasDate && hasTime && hasName && hasEmail) {
      console.warn(
        "⚠️ ask_email ma abbiamo già data/ora/nome/email → promuovo a create_reservation"
      );
      parsed.action = "create_reservation";
    }
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

// ---------- ROTTE CONFERMA/ANNULLA GRANDI GRUPPI ----------

app.get("/owner/large-group/confirm", async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) {
      return res.status(400).send("Token mancante.");
    }

    const json = Buffer.from(token, "base64").toString("utf8");
    const payload = JSON.parse(json);
    const { eventId, date, time, people, name, customerEmail, phone } = payload;

    await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "confirm_large_group",
        eventId,
        date,
        time,
        people,
        name,
        customerEmail,
        phone,
      }),
    });

    res.send(`
      <html>
        <body style="font-family: system-ui; padding: 24px;">
          <h2>Prenotazione confermata ✅</h2>
          <p>Hai confermato la prenotazione per <strong>${people} persone</strong>, a nome <strong>${name}</strong>, il <strong>${date}</strong> alle <strong>${time}</strong>.</p>
          <p>Se il cliente ha fornito un'email valida, riceverà una conferma automatica.</p>
        </body>
      </html>
    `);
  } catch (err) {
    console.error("Errore conferma large group:", err);
    res
      .status(500)
      .send("Errore interno durante la conferma della prenotazione.");
  }
});

app.get("/owner/large-group/cancel", async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) {
      return res.status(400).send("Token mancante.");
    }

    const json = Buffer.from(token, "base64").toString("utf8");
    const payload = JSON.parse(json);
    const { eventId, date, time, people, name, customerEmail, phone } = payload;

    await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "cancel_large_group",
        eventId,
        date,
        time,
        people,
        name,
        customerEmail,
        phone,
      }),
    });

    res.send(`
      <html>
        <body style="font-family: system-ui; padding: 24px;">
          <h2>Prenotazione annullata ❌</h2>
          <p>Hai annullato la richiesta per <strong>${people} persone</strong>, a nome <strong>${name}</strong>, il <strong>${date}</strong> alle <strong>${time}</strong>.</p>
          <p>Se il cliente aveva lasciato un'email, potrebbe ricevere una comunicazione automatica di annullamento.</p>
        </body>
      </html>
    `);
  } catch (err) {
    console.error("Errore cancellazione large group:", err);
    res
      .status(500)
      .send("Errore interno durante l'annullamento della prenotazione.");
  }
});

// ---------- /twilio ----------
app.post("/twilio", async (req, res) => {
  const { CallSid, SpeechResult, text, From, Language } = req.body || {};
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

  // Primo ingresso: nessun SpeechResult -> messaggio di benvenuto (default IT)
  if (!SpeechResult) {
    setCallLanguage(callId, "it-IT");
    const welcomeText = `Ciao, sono ${RECEPTIONIST_NAME} del ${RESTAURANT_NAME}. Come posso aiutarti oggi?`;

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

  // ---- Gestione finestra finale: solo "grazie" → saluto e chiudi ----
  if (postFinal === "1") {
    const userTextRaw = SpeechResult.trim();
    const lower = userTextRaw.toLowerCase();
    console.log("👤 Utente dopo prenotazione:", userTextRaw);

    // memorizzo anche questo testo (non fa male per la history)
    appendUserText(callId, userTextRaw);
    maybeSwitchToEnglish(callId, userTextRaw);
    maybeSwitchToItalian(callId, userTextRaw);
    const currentLang = getCallLanguage(callId);

    const isThanksOnly =
      /grazie|thank you|thanks/.test(lower) &&
      !/cambia|change|sposta|modifica|orario|time/.test(lower);

    if (isThanksOnly) {
      const goodbyeText =
        currentLang === "en-US"
          ? "Thank you, have a nice evening."
          : "Grazie a te, buona serata.";

      const goodbyeTwiml = `
        <Response>
          <Say language="${currentLang}">
            ${escapeXml(goodbyeText)}
          </Say>
          <Hangup/>
        </Response>
      `.trim();

      return res.status(200).type("text/xml").send(goodbyeTwiml);
    }
  }

  // ---- Flusso normale Twilio (voce) ----
  try {
    const userText = SpeechResult.trim();
    console.log("👤 Utente dice:", userText);

    // allineo la lingua alla STT di Twilio (aiuta lo switch IT/EN)
    if (Language && typeof Language === "string") {
      const lowerLang = Language.toLowerCase();
      if (lowerLang.startsWith("en")) {
        setCallLanguage(callId, "en-US");
      } else if (lowerLang.startsWith("it")) {
        setCallLanguage(callId, "it-IT");
      }
    }

    // Salvo il testo utente nella cronologia "grezza" per inferDateFromConversation
    appendUserText(callId, userText);

    maybeSwitchToEnglish(callId, userText);
    maybeSwitchToItalian(callId, userText);
    const currentLang = getCallLanguage(callId);
    const sayLang = currentLang;

    // 🔹 Shortcut: l'utente chiede l'email del ristorante o lo spelling
    if (isRestaurantEmailQuestion(userText) || isRestaurantEmailSpellingRequest(userText)) {
      const restaurantEmail = OWNER_EMAIL;
      const spelled = spellEmailForTTS(restaurantEmail, currentLang);

      const reply =
        currentLang === "en-US"
          ? `The restaurant email is ${restaurantEmail}. I'll spell it: ${spelled}.`
          : `L'email del ristorante è ${restaurantEmail}. Te la scandisco: ${spelled}.`;

      const twimlEmail = `
        <Response>
          <Gather
            input="speech"
            language="${currentLang}"
            action="${BASE_URL}/twilio"
            method="POST"
            timeout="5"
            speechTimeout="auto"
          >
            <Say language="${sayLang}" bargeIn="true">
              ${escapeXml(reply)}
            </Say>
          </Gather>
          <Say language="${sayLang}">
            ${escapeXml(
              currentLang === "en-US"
                ? "If you need anything else, please call us again. Thank you."
                : "Se hai bisogno di altro, richiamaci pure. Grazie."
            )}
          </Say>
        </Response>
      `.trim();

      return res.status(200).type("text/xml").send(twimlEmail);
    }

    const giulia = await askGiulia(callId, userText);
    let replyText =
      giulia.reply_text ||
      "Scusa, non ho capito bene. Puoi ripetere per favore?";
    let action = giulia.action || "none";

    // 🔒 Protezione: se il modello manda create_reservation ma la frase contiene ancora
    // un punto interrogativo, NON consideriamo la prenotazione definitiva;
    // la trattiamo come una richiesta di chiarimento sull'orario.
    if (action === "create_reservation" && /\?/.test(replyText)) {
      console.warn(
        "⚠️ create_reservation con domanda nella reply_text, declasso ad ask_time"
      );
      action = "ask_time";
    }

    let slotFull = false;
    let isLargeGroupReservation = false;
    let isHugeEventReservation = false;

    // 🔹 Gestione cancellazione prenotazione standard
    if (action === "cancel_reservation" && giulia.reservation) {
      const normalizedRes = normalizeReservationForCalendar(
        giulia.reservation,
        callId
      );
      const { date, time, name } = normalizedRes;

      if (!date) {
        // non sappiamo cosa cancellare → chiedi la data
        if (currentLang === "en-US") {
          replyText =
            "I'm sorry, I didn't understand which booking you want to cancel. Could you please tell me the day of the reservation?";
        } else {
          replyText =
            "Mi dispiace, non ho capito quale prenotazione vuoi cancellare. Mi dici per quale giorno era la prenotazione?";
        }
        action = "ask_date";
      } else {
        try {
          const calendarRes = await sendToCalendar({
            action: "cancel_reservation",
            nome: name || "",
            data: date,
            ora: time || null,
            telefono: From,
          });

          if (calendarRes && calendarRes.success) {
            if (currentLang === "en-US") {
              replyText =
                "Your reservation has been cancelled. We hope to see you another time. Have a nice evening.";
            } else {
              replyText =
                "Ho cancellato la tua prenotazione. Speriamo di vederti un'altra volta, buona serata.";
            }
          } else if (
            calendarRes &&
            calendarRes.reason === "reservation_not_found"
          ) {
            if (currentLang === "en-US") {
              replyText =
                "I couldn't find any booking with these details. Please contact the restaurant directly to cancel.";
            } else {
              replyText =
                "Non ho trovato nessuna prenotazione con questi dati. Ti chiedo di contattare direttamente il ristorante per annullare.";
            }
            action = "none";
          } else {
            console.error(
              "❌ Errore da Apps Script per cancel_reservation:",
              calendarRes
            );
            if (currentLang === "en-US") {
              replyText =
                "I'm sorry, there was a technical problem while cancelling. Please contact the restaurant directly.";
            } else {
              replyText =
                "Mi dispiace, c'è stato un problema tecnico durante l'annullamento. Ti chiedo di contattare direttamente il ristorante.";
            }
            action = "none";
          }
        } catch (calErr) {
          console.error("❌ Errore tecnico cancel_reservation:", calErr);
          if (currentLang === "en-US") {
            replyText =
              "I'm sorry, there was a technical problem. Please contact the restaurant directly.";
          } else {
            replyText =
              "Mi dispiace, c'è stato un problema tecnico. Ti chiedo di contattare direttamente il ristorante.";
          }
          action = "none";
        }
      }
    }

    // 🔹 Se è una prenotazione finale, invia al Calendar (con controllo coperti)
    if (action === "create_reservation" && giulia.reservation) {
      const normalizedRes = normalizeReservationForCalendar(
        giulia.reservation,
        callId
      );
      let { date, time, people, name, customerEmail } = normalizedRes;

      // people può essere null nei casi di modifica (il cliente ha solo cambiato orario)
      // qui richiediamo solo data, ora e nome
      if (date && time && name) {
        const numericPeople =
          typeof people === "number" && !isNaN(people) ? people : null;

        // EVENTO GIGANTE: sopra EVENT_THRESHOLD
        if (numericPeople !== null && numericPeople >= EVENT_THRESHOLD) {
          isHugeEventReservation = true;

          await sendOwnerEmail({
            name,
            people: numericPeople,
            date,
            time,
            phone: From,
            customerEmail,
          });

          const spelledOwnerEmail = spellEmailForTTS(OWNER_EMAIL, currentLang);

          if (currentLang === "en-US") {
            replyText =
              `For bookings over ${EVENT_THRESHOLD} people we treat it as a private event. ` +
              `Please send an email to ${OWNER_EMAIL}; I'll spell it: ${spelledOwnerEmail}.`;
          } else {
            replyText =
              `Per prenotazioni sopra i ${EVENT_THRESHOLD} coperti le gestiamo come evento privato. ` +
              `Ti chiedo di mandare una mail a ${OWNER_EMAIL}; te la scandisco: ${spelledOwnerEmail}.`;
          }

          action = "none";
        } else {
          // Flusso normale: invio al Calendar ANCHE SE people è null
          try {
            const calendarRes = await sendToCalendar({
              nome: name,
              persone: numericPeople, // può essere null → Apps Script userà quelle esistenti se possibile
              data: date,
              ora: time,
              telefono: From,
              email: customerEmail || "",
            });

            if (!calendarRes.success && calendarRes.reason === "slot_full") {
              slotFull = true;
              console.log(
                "⛔ Prenotazione rifiutata per capienza:",
                calendarRes
              );

              if (currentLang === "en-US") {
                replyText =
                  "I'm sorry, we are fully booked at that time. Would you like to try a different time or another day?";
              } else {
                replyText =
                  "Mi dispiace, a quell'ora siamo al completo. Vuoi provare con un altro orario o un altro giorno?";
              }

              action = "ask_time";
            } else if (calendarRes && calendarRes.success) {
              console.log("✅ Prenotazione creata/aggiornata:", {
                reservation: normalizedRes,
                fromAppsScript: calendarRes,
              });

              // Grande gruppo (ma non evento gigante): messaggio chiaro "soggetto a conferma"
              if (numericPeople !== null && numericPeople > LARGE_GROUP_THRESHOLD) {
                isLargeGroupReservation = true;

                if (currentLang === "en-US") {
                  replyText =
                    `I've registered your request for a table for ${numericPeople} people. ` +
                    "For large groups the booking is subject to confirmation by the restaurant; you will receive a confirmation by email or phone. Thank you and have a nice evening.";
                } else {
                  replyText =
                    `Ho registrato la tua richiesta di prenotazione per ${numericPeople} persone. ` +
                    "Per i gruppi numerosi la prenotazione è soggetta a conferma da parte del ristorante: riceverai una conferma via email o telefono. Grazie e buona serata.";
                }
              }
            } else {
              console.error(
                "❌ Errore nella creazione/aggiornamento prenotazione (non slot_full):",
                calendarRes
              );
              if (currentLang === "en-US") {
                replyText =
                  "I'm sorry, there was a problem with your booking. Could we try a different time or another day?";
              } else {
                replyText =
                  "Mi dispiace, c'è stato un problema con la prenotazione. Possiamo provare con un altro orario o un altro giorno?";
              }
              action = "ask_time";
            }
          } catch (calErr) {
            console.error("❌ Errore nella creazione prenotazione:", calErr);
            if (currentLang === "en-US") {
              replyText =
                "I'm sorry, there was a technical problem. Please try again in a few minutes.";
            } else {
              replyText =
                "Mi dispiace, c'è stato un problema tecnico. Per favore riprova tra qualche minuto.";
            }
            action = "none";
          }
        }
      } else {
        console.warn(
          "⚠️ create_reservation senza data/ora/nome:",
          normalizedRes
        );
      }
    }

    // chiudi la chiamata per:
    // - prenotazione finale andata a buon fine
    // - cancellazione andata a buon fine
    // - evento gigante (mandiamo mail al ristorante e stop)
    const shouldHangup =
      ((action === "create_reservation" || action === "cancel_reservation") &&
        !slotFull) ||
      isHugeEventReservation;

    let twiml;
    if (shouldHangup) {
      // Per i grandi gruppi o eventi giganti NON aggiungo saluti extra, uso il testo così com'è.
      const finalReply =
        isLargeGroupReservation || isHugeEventReservation
          ? replyText
          : addClosingSalute(replyText);

      twiml = `
        <Response>
          <Gather
            input="speech"
            language="${currentLang}"
            action="${BASE_URL}/twilio?postFinal=1"
            method="POST"
            timeout="5"
            speechTimeout="auto"
          >
            <Say language="${sayLang}" bargeIn="true">
              ${escapeXml(finalReply)}
            </Say>
          </Gather>
          <Say language="${sayLang}">
            ${escapeXml(
              currentLang === "en-US"
                ? "Thank you again, goodbye."
                : "Grazie ancora, a presto."
            )}
          </Say>
          <Hangup/>
        </Response>
      `.trim();
    } else {
      twiml = `
        <Response>
          <Gather
            input="speech"
            language="${currentLang}"
            action="${BASE_URL}/twilio"
            method="POST"
            timeout="5"
            speechTimeout="auto"
          >
            <Say language="${sayLang}" bargeIn="true">
              ${escapeXml(replyText)}
            </Say>
          </Gather>
          <Say language="${sayLang}">
            ${escapeXml(
              currentLang === "en-US"
                ? "I didn't receive any answer. Please call us back if you still need help. Thank you."
                : "Non ho ricevuto risposta. Se hai ancora bisogno, richiamaci pure. Grazie."
            )}
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
