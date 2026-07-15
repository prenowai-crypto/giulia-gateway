// ═══════════════════════════════════════════════════════════════════════════════
// PRENOW REALTIME v7.3 — SPEECH-TO-SPEECH (gpt-realtime-mini) MULTI-TENANT
// ═══════════════════════════════════════════════════════════════════════════════
// Cambiamenti v7.3 rispetto a v7.2 (dai test 15:58 del 13/07):
//
// PROMPT
//   P1 - Separazione netta: prenotazione normale = CONFERMATA subito,
//        gruppo_grande/evento = "il ristorante la richiamerà".
//   P2 - Se cliente annulla, MAI dire "il ristorante la ricontatterà".
//   P3 - Memoria contesto rafforzata con esempio letterale.
//   P4 - Tabella settimanale COMPLETAMENTE in italiano (era mista, il modello
//        interpretava male "Lunch/Dinner" e saltava domenica).
//   P5 - MAI dire "contatti direttamente il ristorante" — SEI il ristorante.
//   P6 - MAI creare senza aver chiesto persone. Se hai appena creato e il
//        cliente corregge, USA modifica_prenotazione (mai seconda create).
//   P7 - Regola tool-first per gruppo_grande con esempio WRONG/RIGHT esplicito.
// ═══════════════════════════════════════════════════════════════════════════════

import WebSocket from 'ws';
import { DateManager, TimeManager, PeopleManager, IntentDetector,
         ValidationPipeline, isConfirming, isDenying } from './parsers.js';

export { DateManager, TimeManager, PeopleManager, IntentDetector,
         ValidationPipeline, isConfirming, isDenying };

console.log('🟢 openai-realtime.js GIULIA-v7.4.0-MT-2026-07-14 caricato (Batch 1: GDPR log masking, no ownership check)');

const REALTIME_MODEL = process.env.REALTIME_MODEL || 'gpt-realtime-mini';
const REALTIME_URL   = `wss://api.openai.com/v1/realtime?model=${REALTIME_MODEL}`;

// ═══════════════════════════════════════════════════════════════════════════════
// LE 7 FUNZIONI
// ═══════════════════════════════════════════════════════════════════════════════

const FUNCTIONS = [
  {
    type: 'function',
    name: 'trova_prenotazione',
    description: 'Cerca una prenotazione esistente dato il nome e opzionalmente una data. Il telefono del chiamante è aggiunto automaticamente dal sistema.',
    parameters: {
      type: 'object',
      properties: {
        nome: { type: 'string', description: 'Nome o cognome sulla prenotazione' },
        data: { type: 'string', description: "Data indicata dal cliente. Opzionale, passa \"\" se non specificata." },
      },
      required: ['nome', 'data'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'controlla_disponibilita',
    description: "Verifica disponibilità per data+ora+persone. Esiti: libero (procedi crea), gruppo_grande (procedi crea, sarà PENDING), evento (usa richiedi_evento), giorno_chiuso, solo_cena, solo_pranzo, fuori_orario, pieno, manca_*.",
    parameters: {
      type: 'object',
      properties: {
        data:    { type: 'string',  description: "Data come detta dal cliente" },
        ora:     { type: 'string',  description: "Ora come detta dal cliente" },
        persone: { type: 'integer', description: 'Numero totale di persone (mai inventare, sempre chiedere)' },
      },
      required: ['data', 'ora', 'persone'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'crea_prenotazione',
    description: "Crea una nuova prenotazione. SOLO dopo controlla_disponibilita con esito 'libero' o 'gruppo_grande'. Nome esatto come pronunciato. Mai 'Cliente'.",
    parameters: {
      type: 'object',
      properties: {
        nome:    { type: 'string',  description: 'Nome esatto del cliente' },
        data:    { type: 'string',  description: "Data come detta dal cliente" },
        ora:     { type: 'string',  description: "Ora come detta dal cliente" },
        persone: { type: 'integer', description: 'Numero di persone (mai inventato)' },
        note:    { type: 'string',  description: 'Note. "" se nessuna.' },
      },
      required: ['nome', 'data', 'ora', 'persone', 'note'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'modifica_prenotazione',
    description: 'Modifica una prenotazione esistente. USA QUESTO anche se hai appena creato una prenotazione e il cliente corregge un dettaglio (MAI creare una seconda). Passa "" o 0 per i campi che NON cambiano. Nota FINALE completa (sostituisce).',
    parameters: {
      type: 'object',
      properties: {
        nome:    { type: 'string',  description: 'Nuovo nome. "" se non cambia.' },
        data:    { type: 'string',  description: 'Nuova data. "" se non cambia.' },
        ora:     { type: 'string',  description: 'Nuova ora. "" se non cambia.' },
        persone: { type: 'integer', description: 'Nuovo numero persone. 0 se non cambia.' },
        note:    { type: 'string',  description: 'Nota FINALE completa. "" se non cambia.' },
      },
      required: ['nome', 'data', 'ora', 'persone', 'note'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'cancella_prenotazione',
    description: 'Cancella la prenotazione trovata con trova_prenotazione. Chiamare SOLO dopo che il cliente ha già dato conferma esplicita (es. "sì confermo", "sì cancella", "esatto grazie"). NON chiedere al cliente di dire una parola specifica come conferma — accetta qualsiasi conferma affermativa naturale.',
    parameters: {
      type: 'object',
      properties: {
        placeholder: { type: 'string', description: 'Campo tecnico ignorato dal sistema. Passa "confirmed".' },
      },
      required: ['placeholder'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'info_locale',
    description: "Info sul ristorante: menu, piatti, opzioni vegetariane/vegane/senza glutine, parcheggio, accessibilità, pagamenti, dehors, seggiolone, prezzi, coperto. NON per orari o giorni di apertura (quelli sono nella tabella del prompt).",
    parameters: {
      type: 'object',
      properties: {
        argomento: { type: 'string', description: "Argomento richiesto" },
      },
      required: ['argomento'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'richiedi_evento',
    description: "Registra richiesta evento (persone ≥ event_threshold). SOLO dopo controlla_disponibilita esito 'evento'.",
    parameters: {
      type: 'object',
      properties: {
        nome:    { type: 'string',  description: 'Nome del richiedente' },
        data:    { type: 'string',  description: "Data" },
        ora:     { type: 'string',  description: "Ora" },
        persone: { type: 'integer', description: "Persone stimate" },
        note:    { type: 'string',  description: "Dettagli. \"\" se nessuno." },
        email:   { type: 'string',  description: "Email di contatto. \"\" se non fornita." },
      },
      required: ['nome', 'data', 'ora', 'persone', 'note', 'email'],
      additionalProperties: false,
    },
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// SYSTEM PROMPT — v7.3
// ═══════════════════════════════════════════════════════════════════════════════

const SYSTEM_PROMPT_TEMPLATE = `Sei {{RECEPTIONIST_NAME}}, receptionist vocale automatica di {{RESTAURANT_NAME}}. Parla solo italiano, tono caldo e professionale. Ogni risposta: 1-2 frasi brevi, 5-20 parole. Non inventare mai dettagli. Conferma prenotazioni/modifiche/cancellazioni SOLO dopo che il tool ha restituito successo.

Oggi è {{TODAY_HUMAN}} ({{TODAY_ISO}}). Numero del chiamante (automatico): {{CALLER_PHONE}}.

# Orari settimanali — UNICA FONTE DI VERITÀ per giorni e orari
{{WEEKLY_SCHEDULE}}

Per QUALSIASI domanda su orari o giorni di apertura ("quando siete aperti?", "che orari fate?", "aprite lunedì?", "aperti a pranzo?", "aperti domenica?"), rispondi DIRETTAMENTE dagli orari qui sopra leggendoli attentamente. Elenca TUTTI i giorni pertinenti (non saltarne nessuno). Non chiamare mai info_locale per domande su orari o giorni.

Se ti chiedono "aperti a pranzo?" elenca TUTTI i giorni con "Pranzo" scritto sopra. Se ti chiedono "domenica?" leggi la riga della domenica e dì esattamente quello che c'è scritto (se dice "Pranzo X-Y, Cena W-Z" significa aperto sia a pranzo che a cena, MAI dire "solo a pranzo").

Apertura chiamata: "Salve, sono l'assistente vocale automatico di {{RESTAURANT_NAME}}, come posso aiutarla?" (obbligo AI Act).

# 🔴🔴🔴 REGOLA #0 — CHECKLIST OBBLIGATORIA PRIMA DI OGNI crea_prenotazione (CRITICA — FALLIMENTI GRAVI)
Prima di chiamare crea_prenotazione DEVI verificare mentalmente questa checklist. Se anche solo UNA voce è NO, NON chiamare il tool — chiedi al cliente il dato mancante.

☐ 1. Il cliente ha detto ESPLICITAMENTE il GIORNO? (es. "martedì", "sabato", "domani", "il 20 agosto")
☐ 2. Il cliente ha detto ESPLICITAMENTE l'ORA? (es. "alle 21", "alle nove e mezza", "a pranzo alle 13")
☐ 3. Il cliente ha detto ESPLICITAMENTE il NUMERO di PERSONE? (es. "in 4", "siamo 2", "per tre persone")
☐ 4. Il cliente ha detto ESPLICITAMENTE il NOME? (es. "sono Marco", "a nome Rossi")

Nessuno di questi 4 dati può essere:
- Inventato da te ("Luca", "Marco", "Cliente", "chiamante", "martedì" quando il cliente non l'ha detto)
- Dedotto da conversazioni precedenti (non ne hai memoria — ogni chiamata è nuova)
- Assunto come "plausibile" o "default"
- Copiato da altri clienti

Se manca uno di questi 4 dati, CHIEDILO con una domanda specifica PRIMA di chiamare qualsiasi tool:
- Manca giorno → "Per quale giorno desidera prenotare?"
- Manca ora → "A che ora precisamente?"
- Manca persone → "Per quante persone?"
- Manca nome → "A che nome posso registrare la prenotazione?"

## Esempi SBAGLIATI letterali (successi in test, mai ripetere)

Esempio 1 — nome inventato (test T01):
  Cliente: "Ciao, vorrei prenotare per martedì sera alle 9 per quattro persone." (nessun nome)
  → AI chiama controlla_disponibilita(martedì, 21, 4) ✅ ok
  → AI chiama crea_prenotazione(nome:"Luca", ...) ❌ SBAGLIATISSIMO — "Luca" inventato da te
  CORRETTO: dopo controlla libero, chiedi "A che nome posso registrare la prenotazione?", ricevi il nome, POI chiami crea.

Esempio 2 — giorno inventato (test T05):
  Cliente: "Vorrei prenotare per lunedì alle 21:30 per 2" (audio degradato, tu senti "una di sera")
  → AI chiama controlla_disponibilita(martedì, 21:30, 3) ❌ SBAGLIATISSIMO — "martedì" e "3" inventati
  CORRETTO: se non capisci un dato, chiedi "Mi scusi, per quale giorno e per quante persone?" — NON inventare valori plausibili.

## Regola d'oro
Se hai anche un solo dubbio su UNO dei 4 campi, CHIEDI. Meglio 30 secondi in più di conversazione che una prenotazione fantasma con dati sbagliati (che poi il cliente scoprirà solo arrivando al ristorante).

# 🔴 REGOLA #1 — TOOL FIRST, THEN SPEAK (CRITICA)
MAI annunciare esiti ("registrata", "prenotato", "confermato", "aggiornato", "cancellato") PRIMA che il tool corrispondente abbia restituito successo. Sequenza: (1) raccogli dati, (2) chiama il tool, (3) ASPETTA il risultato, (4) parla.

Esempi SBAGLIATI (successi in test — mai più):
  Cliente: "15 persone martedì alle 21, sono Luca"
  → AI: [chiama controlla_disponibilita] → esito gruppo_grande
  → AI: "Sto registrando la richiesta..." ❌ SBAGLIATO: crea_prenotazione non chiamato

  Cliente: "50 persone il 20 agosto alle 21, sono Sara"
  → AI: [chiama controlla_disponibilita] → esito evento
  → AI: "Perfetto, ho registrato la richiesta." ❌ SBAGLIATO: richiedi_evento non chiamato

Esempio GIUSTO per gruppo_grande:
  Cliente: "15 persone martedì alle 21, sono Luca"
  AI: [chiama controlla_disponibilita] → gruppo_grande
  AI: "È un gruppo di 15, procedo. [chiama crea_prenotazione]"
  → tool result: creata:true, stato:PENDING_OWNER
  AI: "Ho registrato la sua richiesta. Il ristorante la richiamerà al numero da cui chiama per confermare."

Esempio GIUSTO per evento:
  Cliente: "50 persone il 20 agosto alle 21, sono Sara"
  AI: [chiama controlla_disponibilita] → evento
  AI: "Perfetto. Vuole lasciarmi un'email di contatto o preferisce essere richiamata al numero da cui chiama?"
  Cliente: "va bene questo numero"
  AI: [chiama richiedi_evento con email:""]
  → tool result: registrata:true
  AI: "Ho registrato la richiesta. Il ristorante la contatterà per organizzare l'evento."

# 🔴 REGOLA #2 — CONFERMA IMMEDIATA per prenotazioni normali
Quando controlla_disponibilita → libero, dopo aver chiamato crea_prenotazione e ricevuto success, la prenotazione è CONFERMATA e definitiva. Dì semplicemente: "La prenotazione è confermata: [data] alle [ora] per [persone] persone. A presto!". NON dire mai "il ristorante la contatterà per conferma" per prenotazioni normali — sono già confermate. La frase "il ristorante la richiamerà per confermare" vale SOLO per esito gruppo_grande o evento.

# 🔴 REGOLA #3 — MAI INVENTARE NUMERO PERSONE
Se il cliente non ha detto quante persone, CHIEDI "per quante persone?" PRIMA di chiamare controlla_disponibilita. Mai passare 1 come default silenzioso. Esempio sbagliato: cliente dice "prenoto per giovedì alle 21 nome Giovanni" senza dire quante persone → AI chiama controlla_disponibilita con persone:1 ❌. Giusto: AI chiede "per quante persone?".

# 🔴 REGOLA #3-BIS — MAI INVENTARE DATA, ORA O NOME (CRITICA)
Se il cliente non ha detto data, ora o nome, NON inventarli MAI. NON usare valori di default. NON usare "chiamante", "cliente", "il chiamante", "utente", "richiedente" o simili come nome.
Se manca uno di questi dati, chiedilo esplicitamente:
- Manca data → "Per quale giorno?"
- Manca ora → "A che ora?"
- Manca nome → "A che nome posso registrare la prenotazione?"

# 🔴 REGOLA #3-TER — DISTINGUERE DOMANDE INFORMATIVE DA PRENOTAZIONI (CRITICA)
Il cliente può fare DOMANDE senza voler prenotare. Esempi di domande informative che NON richiedono controlla_disponibilita o crea_prenotazione:
- "Come funziona da voi per i gruppi?" → rispondi spiegando la policy (sopra 10 la prenotazione va confermata dal ristorante, sopra 45 è un evento). NON chiamare tool di prenotazione.
- "Quanto costa una cena da voi?" → info_locale
- "Fino a che ora si mangia?" → rispondi dagli orari settimanali del prompt
- "Avete disponibilità per un gruppo?" → CHIEDI prima "per quando e quante persone?", poi controlla_disponibilita. NON inventare.
- "Noi saremo in 15, si può fare?" → rispondi sulla policy gruppi + CHIEDI "per quale giorno e ora?". NON chiamare tool.

REGOLA FERREA: prima di chiamare controlla_disponibilita servono TUTTI e 3 i dati (data, ora, persone) detti ESPLICITAMENTE dal cliente. Prima di crea_prenotazione servono TUTTI e 4 (data, ora, persone, nome). MAI valori inventati o dedotti.

Esempio SBAGLIATO (successo in test T17):
  Cliente: "Come funziona da voi per i gruppi? Saremo in 15"
  → AI chiama controlla_disponibilita(martedì, 21, 15) ❌ (data e ora INVENTATE)
  → AI chiama crea_prenotazione(nome:"chiamante", ...) ❌ (nome INVENTATO)
  Risultato: prenotazione fantasma nel Calendar.

Esempio GIUSTO:
  Cliente: "Come funziona da voi per i gruppi? Saremo in 15"
  → AI: "Per gruppi sopra le 10 persone la prenotazione è soggetta a conferma del ristorante. Vuole procedere? Per quale giorno e ora?"
  Cliente: "Sì, martedì sera alle 21"
  → AI: "A che nome?"
  Cliente: "Luca"
  → AI: [chiama controlla_disponibilita] → gruppo_grande → [chiama crea_prenotazione]

# 🔴 REGOLA #4 — DOPO UNA CREA, USA MODIFICA (mai una seconda crea)
Se hai APPENA creato una prenotazione e il cliente corregge un dettaglio (persone, ora, nome), USA modifica_prenotazione (la prenotazione appena creata è già in _lastFound). MAI chiamare crea_prenotazione una seconda volta — creeresti una prenotazione doppia. Esempio sbagliato: crei per 1 persona, cliente dice "no siamo in 4" → tu chiami crea_prenotazione di nuovo ❌. Giusto: modifica_prenotazione con persone:4.

# 🔴 REGOLA #5 — MEMORIA DEL CONTESTO (CRITICA — FALLIMENTI RIPETUTI)
Mantieni MENTALMENTE uno "slot" con i dati raccolti finora: {data, ora, persone, nome, note}. Ogni volta che il cliente ti dice un nuovo dato, aggiorna solo QUEL campo. Gli altri campi restano invariati.

REGOLA FERREA: se cambia SOLO UN campo (tipicamente il giorno), NON richiedere gli altri. Chiama subito il tool con i valori che avevi + il nuovo.

Esempio letterale — TEST T05:
Cliente: "prenotare per lunedì alle 21:30 per 2"
→ Il tuo slot ora è: {data:"lunedì", ora:"21:30", persone:2, nome:vuoto}
→ Chiami controlla_disponibilita → esito giorno_chiuso
→ Tu: "Il lunedì siamo chiusi. Vuole un altro giorno?"
Cliente: "martedì" (o "facciamo martedì" o "ok martedì")
→ Aggiorna SOLO la data del tuo slot: {data:"martedì", ora:"21:30", persone:2, nome:vuoto}
→ IMMEDIATAMENTE chiami controlla_disponibilita("martedì", "21:30", 2) — NIENTE altre domande.
→ NON dire "a che ora?" (ce l'hai già: 21:30). NON dire "per quante persone?" (ce l'hai già: 2).

Se poi controlla ritorna libero e ti manca solo il nome, chiedi solo il nome ("A che nome?"). Non ricapitolare le altre cose.

VIOLAZIONE: se il cliente ti ha già dato ora e persone e tu li chiedi di nuovo, il cliente si arrabbia e dice "gliel'ho già detto" — è successo nei test. Non ripetere questo errore.

# 🔴 REGOLA #6 — SEI TU IL RISTORANTE
Sei il numero telefonico del ristorante. Se una info non c'è: dì "Questa informazione non ce l'ho al momento, mi dispiace. Posso aiutarla con altro?". MAI dire "contatti direttamente il ristorante" o "chieda direttamente al ristorante" — sei tu il ristorante, non c'è un altro numero.

# 🔴 REGOLA #7 — MAI PLACEHOLDER TESTUALI
MAI dire "[nome del cliente]", "[data]", "[X]" nelle tue frasi. Se non hai un dato, non nominarlo o chiedilo.

# 🔴 REGOLA #8 — MAI ASSUMERE ORARI
Se il cliente dice solo "sera", "cena", "pranzo" senza un'ora precisa, CHIEDI "a che ora precisamente?". Mai default silenziosi a 21 o altri.

# 🔴 REGOLA #9 — CHIUSURA CON NO
Se il cliente decide di non prenotare o annulla la richiesta, chiudi cortesemente: "Va bene, se cambia idea può richiamarmi in qualsiasi momento. Buona giornata.". MAI dire "il ristorante la ricontatterà" — è il cliente che eventualmente richiama.

# Filler e tempistiche
Quando chiami un tool, includi un filler ULTRA-BREVE (massimo 2-3 parole) nella STESSA response del tool call. MAI ripetere i parametri della prenotazione nel filler. MAI spiegare quello che stai facendo. MAI usare doppi filler tipo "Un attimo, sto registrando. Un attimo, procedo" — usane UNO solo.

Esempi CORRETTI (2-3 parole max):
- "Un momento." + chiama controlla_disponibilita
- "Attendi un attimo." + chiama crea_prenotazione
- "Verifico subito." + chiama trova_prenotazione

Esempi SBAGLIATI (verbosi, sembrano un robot):
- ❌ "Un attimo, controllo la disponibilità per martedì alle 21 per 4 persone." (ripete tutto)
- ❌ "Un momento, sto registrando la prenotazione a nome Marco Rossi per martedì." (ripete i dati)
- ❌ "Un attimo, sto registrando. Un momento, procedo." (doppio filler)
- ❌ "Perfetto. Un attimo, sto registrando la richiesta. Un attimo, procedo." (triplo)

Filler e tool call DEVONO essere in una sola response, altrimenti resti in silenzio aspettando l'utente.

# Flusso CREATE
1. Se il cliente ha detto solo il giorno: verifica la tabella settimanale. Se chiuso, dì subito e proponi alternative.
2. Raccogli: data, ora (se solo "sera" chiedi ora precisa), persone (SEMPRE chiedi se non detto), nome (sillaba se dubbio).
3. Chiama controlla_disponibilita.
4. In base all'esito:
   - libero → chiama crea_prenotazione (con filler nella stessa response). Dopo: "La prenotazione è confermata: [data] alle [ora] per [persone] persone. A presto!"
   - gruppo_grande (10-44 pax) → chiama crea_prenotazione. Dopo: "Ho registrato la sua richiesta di gruppo. Il ristorante la richiamerà al numero da cui chiama per confermare."
   - evento (45+ pax) → chiedi email opzionale, poi chiama richiedi_evento. Dopo: "Ho registrato la richiesta. Il ristorante la contatterà per organizzare l'evento."
   - giorno_chiuso → scusati, proponi alternativa (dalla tabella settimanale).
   - solo_cena / solo_pranzo → dì e proponi alternativa.
   - fuori_orario → proponi orari validi dalla tabella.
   - pieno → dì; se alternative_stesso_giorno elencale (max 3).
   - manca_data / manca_ora / manca_persone → chiedi il pezzo mancante.

# Flusso MODIFY / CANCEL
1. Chiedi il nome ("A che nome è la prenotazione?"). Anche se il cliente si presenta ("sono Marco"), confermalo.
2. Chiama trova_prenotazione (telefono automatico).
3. Se nome_diverso_dal_cercato è true: "Vedo una prenotazione a nome X collegata a questo numero, è la sua?".
4. Se trovata: rileggi i dettagli. Chiedi cosa cambiare.
5. Modifica: modifica_prenotazione con SOLO i campi cambiati ("" o 0 per gli altri).
6. Correzione nome: passa il nuovo nome in modifica_prenotazione.
7. Note: componi la nota FINALE completa tu. Il tool SOSTITUISCE (non concatena). Regola d'oro: PRIMA di comporre la nota nuova, RILEGGI la nota esistente restituita da trova_prenotazione e INCLUDI nella nota finale TUTTE le informazioni che devono restare + le NUOVE. Nessuna informazione preesistente deve sparire, a meno che il cliente non abbia esplicitamente chiesto di rimuoverla.

   Esempio base — aggiungere UNA nota:
     Nota esistente: "vegano"
     Cliente: "aggiungete anche compleanno"
     ✅ Passa a modifica_prenotazione: note = "vegano, compleanno"
     ❌ NON passare: note = "compleanno" (perderesti "vegano")

   Esempio T15 — cliente fa PIÙ MODIFICHE insieme (bug ripetuto nei test):
     Nota esistente: "Compleanno"
     Cliente: "Aggiungete che uno è vegano, vorremmo un tavolo esterno, e siamo in 6 invece di 4"
     ✅ Passa: modifica_prenotazione({ persone: 6, note: "Compleanno, vegano, tavolo esterno", data:"", ora:"", nome:"" })
     ❌ NON passare: note = "vegano, tavolo esterno" (perderesti "Compleanno")
     ❌ NON passare: note = "vegano" (perderesti "Compleanno" e "tavolo esterno")

   Esempio rimozione esplicita:
     Nota esistente: "vegano, compleanno"
     Cliente: "in realtà non è più il mio compleanno"
     ✅ Passa: note = "vegano" (rimuovi SOLO l'informazione che il cliente ha esplicitamente rimosso)
8. Cancella: conferma esplicita, poi cancella_prenotazione.

# Tono
Sei receptionist DEL ristorante. "il ristorante la richiamerà", "la contatteremo al suo numero", "riceverà una conferma". MAI "restiamo in attesa", "dovremmo ricevere aggiornamenti".

# Info sul ristorante (menu, dish, vegan, parking, ecc.)
Chiama info_locale con il topic. Rispondi SOLO con quello che il tool restituisce. Se non c'è: "Questa informazione non ce l'ho al momento, mi dispiace. Posso aiutarla con altro?". NON dire "contatti il ristorante". Non inventare mai (mai promemoria SMS, sconti, dress code, atmosfera che non è nel tool).

# Nomi al telefono
Mai inventare. Se dubbio: chiedi di sillabare, ripeti, conferma. Passa il nome esatto confermato. "Cliente" non è un nome valido.

# Numeri di persone
"aggiungi due", "uno in meno": fai il calcolo tu sul totale corrente della prenotazione trovata.

# Date e ore
Passa le parole del cliente ai tool ("sabato", "domani", "alle 21", "nove e mezza"). Il gateway le normalizza. Non convertire tu.

# Audio
- 5-20 parole per risposta, max 2 frasi.
- Una domanda alla volta.
- Cedi il turno dopo ogni risposta, tranne quando aspetti un tool result.

# Errori tool
Se un tool restituisce "manca_X", "creata:false, manca:X", "aggiornata:false", "cancellata:false", "registrata:false, manca:X": chiedi il pezzo specifico. Mai retry con valori inventati.
Se crea_prenotazione o richiedi_evento restituisce creata:false / registrata:false SENZA campo manca (=errore backend): dì "C'è stato un problema tecnico, la prego di richiamare tra qualche minuto".

Se il cliente cambia idea nel mezzo, segui la nuova istruzione.`;

const DAY_NAMES   = ['domenica','lunedì','martedì','mercoledì','giovedì','venerdì','sabato'];
const MONTH_NAMES = ['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'];

// ═══════════════════════════════════════════════════════════════════════════════
// CLIENT
// ═══════════════════════════════════════════════════════════════════════════════

export class OpenAIRealtimeClient {
  constructor(opts = {}) {
    this.apiKey           = opts.apiKey;
    this.restaurantConfig = opts.restaurantConfig || {};
    this.connId           = opts.connId || '????????';

    this.onAudioDelta = opts.onAudioDelta || (() => {});

    const raw = opts.callerPhone || opts.from || '';
    this.callerPhone = raw && !raw.startsWith('+') ? '+' + raw : raw;
    this.to = opts.to || '';

    this._ws               = null;
    this._sessionReady     = false;
    this._lastFound        = null;
    this._lastEventInfo    = null;
    this._restaurantInfo   = null;
    this._pendingCalls     = new Map();

    this._toolsEnabled = !!(
      this.restaurantConfig &&
      this.restaurantConfig.active !== false &&
      (this.restaurantConfig.apps_script_url || this.restaurantConfig.appsScriptUrl)
    );
  }

  async connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(REALTIME_URL, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      });
      this._ws = ws;

      ws.once('open', () => {
        const rn = this.restaurantConfig?.restaurant_name || this.restaurantConfig?.restaurantName || '(no config)';
        console.log(`🎙️  [${this.connId}] Realtime WS aperta (model: ${REALTIME_MODEL}) — ristorante="${rn}"`);
        console.log(`📞 [${this.connId}] callerPhone=${this.callerPhone || '(unknown)'} to=${this.to || '(unknown)'} toolsEnabled=${this._toolsEnabled}`);
        this._sendSessionUpdate();
        if (this._toolsEnabled) this._fetchRestaurantInfo();
        resolve();
      });

      ws.on('message', (data) => this._onMessage(data));
      ws.on('error', (err) => console.error(`❌ [${this.connId}] Realtime WS error: ${err?.message}`));
      ws.on('close', (code) => console.log(`🔴 [${this.connId}] Realtime WS chiusa (${code})`));

      setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) reject(new Error('WS open timeout'));
      }, 10000);
    });
  }

  _sendSessionUpdate() {
    const sessionConfig = {
      type: 'realtime',
      instructions: this._buildSystemPrompt(),
      tools: this._toolsEnabled ? FUNCTIONS : [],
      tool_choice: this._toolsEnabled ? 'auto' : 'none',
      audio: {
        input: {
          format: { type: 'audio/pcma' },
          transcription: { model: 'whisper-1' },
          turn_detection: {
            type: 'semantic_vad',
            eagerness: 'auto',
            create_response: true,
            interrupt_response: true,
          },
          noise_reduction: { type: 'far_field' },
        },
        output: {
          format: { type: 'audio/pcma' },
          voice: this.restaurantConfig?.voice || 'coral',
        },
      },
    };
    this._send({ type: 'session.update', session: sessionConfig });
  }

  // v7.3: tabella settimanale COMPLETAMENTE in italiano
  _buildWeeklySchedule(rc) {
    const closedDays = String(rc.closed_days ?? '')
      .split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
    const lunchClosedDays = String(rc.lunch_closed_days ?? '')
      .split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
    const dinnerClosedDays = String(rc.dinner_closed_days ?? '')
      .split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));

    const ls = rc.lunch_start  || rc.lunchStart  || '12:00';
    const le = rc.lunch_end    || rc.lunchEnd    || '14:30';
    const ds = rc.dinner_start || rc.dinnerStart || '19:00';
    const de = rc.dinner_end   || rc.dinnerEnd   || '22:30';

    const lines = [];
    for (let d = 0; d < 7; d++) {
      const nameCap = DAY_NAMES[d].charAt(0).toUpperCase() + DAY_NAMES[d].slice(1);
      if (closedDays.includes(d)) { lines.push(`- ${nameCap}: CHIUSO tutto il giorno`); continue; }
      const lunchClosed  = lunchClosedDays.includes(d);
      const dinnerClosed = dinnerClosedDays.includes(d);
      if (lunchClosed && dinnerClosed) lines.push(`- ${nameCap}: CHIUSO tutto il giorno`);
      else if (lunchClosed)  lines.push(`- ${nameCap}: CHIUSO a pranzo. Aperti SOLO a cena dalle ${ds} alle ${de}`);
      else if (dinnerClosed) lines.push(`- ${nameCap}: Aperti SOLO a pranzo dalle ${ls} alle ${le}. CHIUSO a cena`);
      else lines.push(`- ${nameCap}: Aperti a pranzo dalle ${ls} alle ${le} E a cena dalle ${ds} alle ${de}`);
    }
    return lines.join('\n');
  }

  _buildSystemPrompt() {
    const rc = this.restaurantConfig || {};

    if (!this._toolsEnabled) {
      const name = rc.restaurant_name || rc.restaurantName || '';
      const active = rc.active !== false;
      if (!name) {
        return `Sei un assistente vocale. Il sistema non ha una configurazione per questo numero.
Dì: "Buongiorno, mi dispiace ma questo servizio al momento non è attivo per questo numero."
Non prendere prenotazioni.`;
      }
      if (!active) {
        return `Sei l'assistente vocale di ${name}. Il servizio prenotazioni è momentaneamente sospeso.
Dì: "Buongiorno, sono l'assistente vocale automatico di ${name}. Mi dispiace ma il servizio prenotazioni è momentaneamente sospeso."
Non prendere prenotazioni.`;
      }
    }

    const now = DateManager.getNow();
    const todayHuman = `${DAY_NAMES[now.getDay()]} ${now.getDate()} ${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`;
    const todayIso   = DateManager.toISO(now);
    const weeklySchedule = this._buildWeeklySchedule(rc);

    return SYSTEM_PROMPT_TEMPLATE
      .replace(/\{\{RECEPTIONIST_NAME\}\}/g, rc.receptionist_name || rc.receptionistName || 'Giulia')
      .replace(/\{\{RESTAURANT_NAME\}\}/g,   rc.restaurant_name   || rc.restaurantName   || 'il ristorante')
      .replace(/\{\{TODAY_HUMAN\}\}/g,       todayHuman)
      .replace(/\{\{TODAY_ISO\}\}/g,         todayIso)
      .replace(/\{\{WEEKLY_SCHEDULE\}\}/g,   weeklySchedule)
      .replace(/\{\{CALLER_PHONE\}\}/g,      this.callerPhone || '(sconosciuto)');
  }

  _onMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw.toString()); }
    catch (e) { return console.error(`❌ [${this.connId}] JSON parse: ${e?.message}`); }

    switch (msg.type) {
      case 'session.created':
        console.log(`📋 [${this.connId}] session.created: ${msg.session?.id}`);
        break;
      case 'session.updated':
        if (!this._sessionReady) {
          this._sessionReady = true;
          console.log(`✅ [${this.connId}] session.updated → richiedo saluto iniziale`);
          this._send({ type: 'response.create' });
        }
        break;
      case 'conversation.item.input_audio_transcription.completed':
        if (msg.transcript) {
          const t = msg.transcript.trim();
          if (!this._isGarbage(t)) {
            // v7.4.0 GDPR: mask user transcripts in production
            if (process.env.LOG_TRANSCRIPTS === 'true') {
              console.log(`💬 [${this.connId}] [user]: ${t}`);
            } else {
              console.log(`💬 [${this.connId}] [user]: (${t.length} char, transcript masked)`);
            }
          }
        }
        break;
      case 'response.output_audio.delta':
        if (msg.delta) this.onAudioDelta(msg.delta);
        break;
      case 'response.output_audio_transcript.done':
        if (msg.transcript) {
          if (process.env.LOG_TRANSCRIPTS === 'true') {
            console.log(`💬 [${this.connId}] [AI]: ${msg.transcript}`);
          } else {
            console.log(`💬 [${this.connId}] [AI]: (${msg.transcript.length} char, transcript masked)`);
          }
        }
        break;
      case 'input_audio_buffer.speech_started':
        console.log(`🎙️  [${this.connId}] cliente: speech_started`);
        break;
      case 'input_audio_buffer.speech_stopped':
        console.log(`🎙️  [${this.connId}] cliente: speech_stopped`);
        break;
      case 'response.function_call_arguments.delta':
        this._accumulateCallArgs(msg);
        break;
      case 'response.function_call_arguments.done':
        this._handleFunctionCall(msg);
        break;
      case 'response.done':
        if (msg.response?.usage) {
          const u = msg.response.usage;
          console.log(`📊 [${this.connId}] tokens: total=${u.total_tokens} in=${u.input_tokens} out=${u.output_tokens}`);
        }
        break;
      case 'error':
        console.error(`❌ [${this.connId}] Realtime error:`, JSON.stringify(msg.error || msg));
        break;
    }
  }

  _accumulateCallArgs(msg) {
    const callId = msg.call_id;
    if (!callId) return;
    if (!this._pendingCalls.has(callId)) this._pendingCalls.set(callId, { name: msg.name || '', args_str: '' });
    this._pendingCalls.get(callId).args_str += (msg.delta || '');
  }

  async _handleFunctionCall(msg) {
    const callId = msg.call_id;
    const name   = msg.name || this._pendingCalls.get(callId)?.name || '';
    const argsStr = msg.arguments || this._pendingCalls.get(callId)?.args_str || '{}';
    this._pendingCalls.delete(callId);

    let args = {};
    try { args = JSON.parse(argsStr); }
    catch (e) { console.error(`❌ [${this.connId}] args parse ${name}: ${e?.message}`); }

    console.log(`🔧 [${this.connId}] tool ${name}(${JSON.stringify(args)})`);

    let result;
    try { result = await this._execTool(name, args); }
    catch (e) {
      console.error(`❌ [${this.connId}] tool ${name} error: ${e?.message}`);
      result = { errore: e?.message || 'errore interno' };
    }

    console.log(`✅ [${this.connId}] tool result: ${JSON.stringify(result).substring(0, 250)}`);

    this._send({
      type: 'conversation.item.create',
      item: { type: 'function_call_output', call_id: callId, output: JSON.stringify(result) },
    });
    this._send({ type: 'response.create' });
  }

  async _execTool(name, args) {
    switch (name) {
      case 'trova_prenotazione':      return await this._toolTrova(args);
      case 'controlla_disponibilita': return await this._toolControlla(args);
      case 'crea_prenotazione':       return await this._toolCrea(args);
      case 'modifica_prenotazione':   return await this._toolModifica(args);
      case 'cancella_prenotazione':   return await this._toolCancella(args);
      case 'info_locale':             return await this._toolInfoLocale(args);
      case 'richiedi_evento':         return await this._toolRichiediEvento(args);
      default: return { errore: 'tool sconosciuto: ' + name };
    }
  }

  async _toolTrova({ nome, data }) {
    const cleanName = nome && String(nome).trim();
    const cleanDate = data && String(data).trim();
    if (!cleanName) return { trovata: false, motivo: 'manca:"nome"' };

    const phone   = this.callerPhone || '';
    const dateISO = cleanDate ? this._normDate(cleanDate) : null;
    const ok = (r) => r && r.name && r.date && r.name !== 'null' && r.date !== 'null';

    if (cleanName && dateISO) {
      const r = await this._callAppsScript({ action: 'find_reservation', nome: cleanName, data: dateISO, sheet: 'Prenotazioni' });
      if (r?.found && ok(r.reservation)) return this._foundResult(r.reservation, cleanName);
    }
    if (cleanName) {
      const r = await this._callAppsScript({ action: 'find_reservation', nome: cleanName, sheet: 'Prenotazioni' });
      if (r?.found && ok(r.reservation)) return this._foundResult(r.reservation, cleanName);
    }
    if (phone) {
      const r = await this._callAppsScript({ action: 'find_reservation', telefono: phone, sheet: 'Prenotazioni' });
      if (r?.found && ok(r.reservation)) return this._foundResult(r.reservation, cleanName);
    }
    return { trovata: false };
  }

  _foundResult(res, searchedName) {
    this._lastFound = res;
    const tn = res.time?.length === 5 ? res.time + ':00' : (res.time || '');
    const existingNotes = res.notes || '';
    const result = {
      trovata: true,
      eventId: res.eventId,
      nome:    res.name,
      data:    DateManager.formatForDisplay(res.date),
      ora:     TimeManager.formatForDisplay(tn),
      persone: res.people,
      note:    existingNotes || 'nessuna',
      nome_diverso_dal_cercato: !!(searchedName && res.name && res.name.toLowerCase() !== String(searchedName).toLowerCase()),
    };
    // v7.3.7: hint esplicito quando ci sono note esistenti — evita la perdita
    // di informazioni preesistenti quando il cliente aggiunge nuove note.
    if (existingNotes && existingNotes !== 'nessuna' && existingNotes.trim() !== '') {
      result._istruzione_note = `IMPORTANTE: la nota esistente è "${existingNotes}". Se il cliente aggiunge nuove informazioni, DEVI includere "${existingNotes}" + le nuove nel campo "note" di modifica_prenotazione. Non passare solo le nuove.`;
    }
    return result;
  }

  async _toolControlla({ data, ora, persone }) {
    const rc = this.restaurantConfig;
    const dateISO = this._normDate(data);
    const timeN   = this._normTime(ora);
    const ppl     = parseInt(persone, 10) || 0;

    if (!dateISO) return { esito: 'manca_data' };
    if (!timeN)   return { esito: 'manca_ora' };
    if (!ppl)     return { esito: 'manca_persone' };

    // v7.3.5: salva "slot" per fallback memoria contesto e includilo nei
    // result "chiuso" così il modello viene esplicitamente istruito a riusare
    // ora+persone quando il cliente cambia solo il giorno.
    const slotHint = {
      _slot_memorizzato: { ora_hh_mm: timeN.substring(0,5), persone: ppl },
      _istruzione: `IMPORTANTE: se il cliente propone un altro giorno, riusa questi valori (ora=${timeN.substring(0,5)}, persone=${ppl}) senza richiederli.`,
    };

    if (ValidationPipeline.getDayClosedMessage(dateISO, rc)) {
      return { esito: 'giorno_chiuso', giorno: DateManager.getDayName(dateISO), ...slotHint };
    }
    if (!ValidationPipeline.isValidTime(timeN, rc)) {
      return {
        esito: 'fuori_orario',
        pranzo: `${rc?.lunch_start || '12:00'}-${rc?.lunch_end || '14:30'}`,
        cena:   `${rc?.dinner_start || '19:00'}-${rc?.dinner_end || '22:30'}`,
        ...slotHint,
      };
    }
    {
      const h = parseInt(timeN.split(':')[0], 10);
      if (h >= 10 && h <= 16 && ValidationPipeline.isLunchClosed(dateISO, rc))
        return { esito: 'solo_cena', giorno: DateManager.getDayName(dateISO), ...slotHint };
      if ((h >= 17 || h <= 3) && ValidationPipeline.isDinnerClosed(dateISO, rc))
        return { esito: 'solo_pranzo', giorno: DateManager.getDayName(dateISO), ...slotHint };
    }
    const eventTh = Number(rc?.event_threshold) || 45;
    const largeTh = Number(rc?.large_group_threshold) || 10;

    if (ppl >= eventTh) {
      this._lastEventInfo = { email: rc?.owner_email || '' };
      return { esito: 'evento' };
    }
    if (ppl > largeTh) return { esito: 'gruppo_grande' };

    const res = await this._callAppsScript({ action: 'check_availability', data: dateISO, ora: timeN, persone: ppl });
    if (res?.success || res?.reason === 'slot_available') return { esito: 'libero' };
    if (res?.reason === 'day_closed') return { esito: 'giorno_chiuso', giorno: DateManager.getDayName(dateISO), ...slotHint };
    if (res?.reason === 'slot_full') {
      const alts = await this._callAppsScript({ action: 'find_available_slots', data: dateISO, ora: timeN, persone: ppl });
      const sameDay = (alts?.availableSlots?.sameDay || [])
        .filter(s => ValidationPipeline.isValidTime(s.time, rc))
        .slice(0, 3).map(s => s.time.substring(0, 5));
      return { esito: 'pieno', alternative_stesso_giorno: sameDay, ...slotHint };
    }
    return { esito: 'libero' };
  }

  async _toolCrea({ nome, data, ora, persone, note }) {
    const nomeOk = nome && String(nome).trim() &&
                   !/^(cliente|sconosciuto|n\.?d\.?|nome non fornito|non fornito|non specificato|non specifica|anonimo|placeholder|chiamante|il chiamante|utente|richiedente)$/i.test(String(nome).trim());
    if (!nomeOk) return { creata: false, manca: 'nome' };

    const dateISO = this._normDate(data);
    const timeN   = this._normTime(ora);
    const ppl     = parseInt(persone, 10) || 0;
    if (!dateISO) return { creata: false, manca: 'data' };
    if (!timeN)   return { creata: false, manca: 'ora' };
    if (!ppl)     return { creata: false, manca: 'persone' };

    const tel = this.callerPhone || '';
    const r = await this._callAppsScript({
      source: 'telnyx', nome, persone: ppl, data: dateISO, ora: timeN,
      telefono: tel, notes: note || '', forceNew: true,
    });
    if (r?.success && r.eventId) {
      this._lastFound = { eventId: r.eventId, name: nome, date: dateISO, time: timeN, people: ppl, phone: tel, notes: note || '' };
      return {
        creata: true, stato: r.status || 'CONFIRMED',
        data: DateManager.formatForDisplay(dateISO),
        ora: TimeManager.formatForDisplay(timeN),
        persone: ppl,
      };
    }
    return { creata: false };
  }

  async _toolModifica({ nome, data, ora, persone, note }) {
    const base = this._lastFound;
    if (!base?.eventId) {
      return { aggiornata: false, motivo: 'prenotazione non identificata: usa prima trova_prenotazione' };
    }

    const hasNome = nome    != null && String(nome).trim()    !== '';
    const hasData = data    != null && String(data).trim()    !== '';
    const hasOra  = ora     != null && String(ora).trim()     !== '';
    const hasPpl  = persone != null && parseInt(persone, 10) > 0;
    const hasNote = note    != null && String(note).trim()    !== '';

    if (hasNome && /^(cliente|sconosciuto|n\.?d\.?|nome non fornito|non fornito)$/i.test(String(nome).trim())) {
      return { aggiornata: false, motivo: 'manca:"nome_valido"' };
    }

    const newNome   = hasNome ? String(nome).trim() : base.name;
    const newDate   = hasData ? this._normDate(data)  : base.date;
    const newTime   = hasOra  ? this._normTime(ora)   : (base.time?.length === 5 ? base.time + ':00' : base.time);
    const newPeople = hasPpl  ? parseInt(persone, 10) : base.people;
    const newNotes  = hasNote ? String(note).trim() : (base.notes || '');

    const r = await this._callAppsScript({
      action: 'update_reservation', eventId: base.eventId,
      nome: newNome, data: newDate, ora: newTime, persone: newPeople,
      telefono: base.phone || this.callerPhone || '', notes: newNotes,
    });
    if (r?.success !== false) {
      this._lastFound = { ...base, name: newNome, date: newDate, time: newTime, people: newPeople, notes: newNotes };
      return {
        aggiornata: true, nome: newNome,
        data: DateManager.formatForDisplay(newDate),
        ora: TimeManager.formatForDisplay(newTime),
        persone: newPeople,
        note: newNotes || 'nessuna',
      };
    }
    return { aggiornata: false };
  }

  async _toolCancella(_args) {
    const r = this._lastFound;
    if (!r?.name || !r?.date) return { cancellata: false, motivo: 'prenotazione non identificata: usa prima trova_prenotazione' };
    const tn = r.time?.length === 5 ? r.time + ':00' : (r.time || '');
    const res = await this._callAppsScript({
      action: 'cancel_reservation', nome: r.name, data: r.date, ora: tn,
      telefono: this.callerPhone || r.phone || '',
    });
    if (res?.success || res?.status === 'CANCELLED') return { cancellata: true };
    return { cancellata: false };
  }

  async _toolInfoLocale({ argomento }) {
    if (!this._restaurantInfo) await this._fetchRestaurantInfo();
    const info = this._restaurantInfo || {};
    const arg = String(argomento || '').toLowerCase().trim();

    const filtered = {};
    const wants = (keys) => keys.some(k => arg.includes(k));

    if (wants(['menu','piatti','primi','secondi','antipasti','dolci','specialità']))
      filtered.menu = info.menuDetails || info.menuText || null;
    if (wants(['vegan','vegetar']))          filtered.vegano        = info.vegan          || null;
    if (wants(['glutine','celiac','celia'])) filtered.senza_glutine = info.glutenFree     || null;
    if (wants(['parcheggio','parking']))     filtered.parcheggio    = info.parking        || null;
    if (wants(['accessib','disab','sedia','rotelle'])) filtered.accessibilita = info.accessibility || null;
    if (wants(['pag','carta','bancomat','contant']))   filtered.pagamenti     = info.paymentMethods || null;
    if (wants(['dehor','esterno','fuori','giardino','tavoli fuori'])) filtered.dehors = info.outdoorSeating || null;
    if (wants(['seggiolone','bambin']))      filtered.seggiolone    = info.highchair     || null;
    if (wants(['prezz','costo','quanto cost','coperto'])) filtered.prezzi = info.prices || null;
    if (wants(['cucina','tipo','specialit'])) filtered.cucina       = info.cuisine       || null;
    if (wants(['indirizz','dove','via']))    filtered.indirizzo    = info.address       || null;
    if (wants(['telefono','contatt','numero'])) filtered.telefono   = info.phone         || null;

    if (Object.keys(filtered).length === 0) {
      filtered.cucina     = info.cuisine || null;
      filtered.parcheggio = info.parking || null;
      filtered.vegano     = info.vegan   || null;
      filtered.pagamenti  = info.paymentMethods || null;
    }

    const out = {};
    for (const k of Object.keys(filtered)) if (filtered[k]) out[k] = filtered[k];

    if (Object.keys(out).length === 0) return { informazione_non_disponibile: true };
    return out;
  }

  async _toolRichiediEvento({ nome, data, ora, persone, note, email }) {
    const cleanName = nome && String(nome).trim();
    const isBadName = !cleanName ||
                      /^(cliente|sconosciuto|n\.?d\.?|nome non fornito|non fornito|anonimo|non specificato|non specifica|placeholder|chiamante|il chiamante|utente|richiedente)$/i.test(cleanName);
    if (isBadName) return { registrata: false, manca: 'nome' };

    const dateISO   = this._normDate(data);
    const timeN     = this._normTime(ora);
    const ppl       = parseInt(persone, 10) || 0;
    if (!dateISO)   return { registrata: false, manca: 'data' };
    if (!timeN)     return { registrata: false, manca: 'ora' };
    if (!ppl)       return { registrata: false, manca: 'persone' };

    const payload = {
      action: 'notify_big_event', source: 'telnyx',
      nome: cleanName, data: dateISO, ora: timeN, persone: ppl,
      telefono: this.callerPhone || '', notes: note || '',
    };
    if (email && String(email).trim()) payload.email = String(email).trim();

    const r = await this._callAppsScript(payload);
    if (r?.success) return { registrata: true, stato: r.status || 'EVENT_REQUEST' };
    return { registrata: false };
  }

  sendAudio(pcmuBase64) {
    if (this._ws?.readyState !== WebSocket.OPEN) return;
    this._send({ type: 'input_audio_buffer.append', audio: pcmuBase64 });
  }

  close() {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      try { this._ws.close(1000); } catch {}
    }
  }

  _send(event) {
    if (this._ws?.readyState !== WebSocket.OPEN) return;
    try { this._ws.send(JSON.stringify(event)); }
    catch (e) { console.error(`❌ [${this.connId}] WS send: ${e?.message}`); }
  }

  _normDate(s) {
    if (!s) return null;
    const t = String(s).trim();
    if (!t) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    return DateManager.parseFromText(t);
  }

  _normTime(s) {
    if (!s) return null;
    const t = String(s).trim();
    if (!t) return null;
    // "21:00", "21:00:00", "21.00", "21,00", "21.30"
    const m1 = t.match(/^(\d{1,2})[:.,](\d{2})(?::\d{2})?$/);
    if (m1) {
      const h = parseInt(m1[1], 10);
      if (h >= 0 && h <= 23) return `${String(h).padStart(2, '0')}:${m1[2]}:00`;
    }
    // Ora intera: "21", "9"
    const m2 = t.match(/^(\d{1,2})$/);
    if (m2) {
      const h = parseInt(m2[1], 10);
      if (h >= 0 && h <= 23) return `${String(h).padStart(2, '0')}:00:00`;
    }
    return TimeManager.parseFromText(t);
  }

  _isGarbage(t) {
    if (!t) return true;
    const s = t.trim().toLowerCase();
    const PATTERNS = ['amara.org','sottotitoli','iscriviti','grazie per aver guardato',
      'metti mi piace','copyright','all rights reserved','sottotitolat','comunità amara',
      'sous-titres','sous titres','sous-titrage'];
    if (PATTERNS.some(p => s.includes(p))) {
      console.log(`🚫 [${this.connId}] hallucination filtrata: "${t.slice(0,50)}"`);
      return true;
    }
    const words = s.replace(/[.,!?]/g, '').split(/\s+/).filter(w => w.length > 1);
    return words.length === 0;
  }

  async _fetchRestaurantInfo() {
    try {
      const r = await this._callAppsScript({ action: 'get_restaurant_info' });
      if (r?.success && r.info) {
        this._restaurantInfo = r.info;
        console.log(`📋 [${this.connId}] Info locale caricata`);
      }
    } catch (e) { console.log(`⚠️ [${this.connId}] info locale: ${e?.message}`); }
  }

  async _callAppsScript(payload) {
    const url = this.restaurantConfig?.apps_script_url || this.restaurantConfig?.appsScriptUrl || process.env.APPS_SCRIPT_URL;
    if (!url) return null;
    const rn = this.restaurantConfig?.restaurant_name || this.restaurantConfig?.restaurantName || '?';
    console.log(`🌐 [${this.connId}] → Apps Script (${rn}): ${JSON.stringify(payload).substring(0, 250)}`);
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), 25000);
    try {
      const resp = await fetch(url, {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      clearTimeout(to);
      const txt = await resp.text();
      try { return JSON.parse(txt); } catch { return null; }
    } catch (e) {
      clearTimeout(to);
      if (e.name === 'AbortError') { console.error(`❌ [${this.connId}] Apps Script timeout`); return { success: false, reason: 'timeout' }; }
      throw e;
    }
  }
}
