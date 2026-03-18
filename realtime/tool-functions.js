// ═══════════════════════════════════════════════════════════════════════════════
// PRENOW - TOOL FUNCTIONS v3.0.0
//
// 🆕 v3.0.0 - ANTI-HALLUCINATION:
//   - prepare_reservation: usa sessionState.collectedData come fonte primaria
//   - I parametri GPT vengono usati solo come fallback (non come fonte principale)
//   - Log dettagliato: mostra dati server vs dati GPT per ogni tool call
//
// FIX v2.1.0:
//   - find_reservation: usa callerPhone automaticamente + salva in sessionState
//   - find_reservation: accetta anche 'date' per trovare prenotazione specifica
//   - modify_reservation: usa dati da sessionState.foundReservation
//   - cancel_reservation: usa dati da sessionState.foundReservation
//   - create_reservation: accetta email opzionale (salvata nelle note)
// ═══════════════════════════════════════════════════════════════════════════════

function getAppsScriptUrl(restaurantConfig) {
  const url = restaurantConfig?.apps_script_url || process.env.APPS_SCRIPT_URL;
  if (!url) console.error('❌ APPS_SCRIPT_URL non configurato!');
  return url;
}

function getTodayISO(timezone = 'Europe/Rome') {
  const now = new Date();
  const options = { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' };
  const parts = new Intl.DateTimeFormat('en-CA', options).formatToParts(now);
  return `${parts.find(p => p.type === 'year').value}-${parts.find(p => p.type === 'month').value}-${parts.find(p => p.type === 'day').value}`;
}

function isDateInPast(dateStr, timezone = 'Europe/Rome') {
  return dateStr < getTodayISO(timezone);
}

const INVALID_NAME_WORDS = [
  'cliente', 'client', 'nome', 'name', 'unknown', 'sconosciuto',
  'prenotazione', 'reservation', 'tavolo', 'table', 'posto',
  'persona', 'persone', 'people', 'pax',
  'sposta', 'sposto', 'cancella', 'cancello', 'modifica', 'modifico',
  'cambia', 'cambio', 'annulla', 'annullo', 'elimina',
  'si', 'no', 'ok', 'certo', 'grazie', 'prego', 'esatto', 'giusto', 'confermo',
  '', 'null', 'undefined', 'none', 'nessuno',
];

function isValidName(name) {
  if (!name) return false;
  const trimmed = name.trim();
  if (trimmed.length < 2) return false;
  if (INVALID_NAME_WORDS.includes(trimmed.toLowerCase())) return false;
  if (!/[a-zA-ZàèéìòùÀÈÉÌÒÙ]/.test(trimmed)) return false;
  if (/^\d+$/.test(trimmed)) return false;
  return true;
}

function isValidPhone(phone) {
  if (!phone) return false;
  const cleaned = phone.replace(/[\s\-\+\(\)\.]/g, '');
  return /^\d{6,15}$/.test(cleaned);
}

function formatDateForSpeech(dateStr) {
  if (!dateStr) return 'data non specificata';
  try {
    const date = new Date(dateStr + 'T12:00:00');
    const dayNames = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
    const monthNames = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
                        'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
    return `${dayNames[date.getDay()]} ${date.getDate()} ${monthNames[date.getMonth()]}`;
  } catch { return dateStr; }
}

// Formatta orario per il TTS — omette i minuti se sono 00
// "21:00" → "21" (TTS legge "ventuno"), "21:30" → "21:30" (TTS legge "ventuno e trenta")
function formatTimeForSpeech(timeStr) {
  if (!timeStr) return '';
  const t = timeStr.substring(0, 5);
  const [h, m] = t.split(':');
  return m === '00' ? h : t;
}

function getDayName(dayIndex, italian = true) {
  const names = italian
    ? ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato']
    : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return names[dayIndex];
}

// ─────────────────────────────────────────────────────────────────────────────
// TOOL DEFINITIONS
// ─────────────────────────────────────────────────────────────────────────────

export const realtimeTools = [

  // ═══════════════════════════════════════════════════════════════════════════
  // CHECK AVAILABILITY
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'check_availability',
    description: `Verifica se uno slot è disponibile. Chiamare dopo aver raccolto data, orario e persone.`,
    parameters: {
      type: 'object',
      properties: {
        date:   { type: 'string',  description: 'Data in formato YYYY-MM-DD' },
        time:   { type: 'string',  description: 'Orario in formato HH:MM' },
        people: { type: 'integer', description: 'Numero di persone' }
      },
      required: ['date', 'time', 'people']
    },
    handler: async (args, context) => {
      const cd = context?.sessionState?.collectedData || {};
      const date   = cd.date;
      const time   = cd.time;  // SOLO server-side — GPT inventa orari, non fidarsi
      const people = cd.people || args.people || 2;
      const { restaurantConfig } = context;
      const timezone = restaurantConfig?.timezone || 'Europe/Rome';

      // 🛡️ Blocca subito se la data non è stata acquisita
      if (!date) {
        return { available: false, reason: 'missing_date', message: 'Data non specificata. Chiedere al cliente per quale giorno vuole prenotare.' };
      }

      // Calcola dayOfWeek una sola volta
      const dayOfWeek = new Date(date + 'T12:00:00').getDay();

      // 🛡️ Controlla data nel passato
      if (isDateInPast(date, timezone)) {
        return { available: false, reason: 'date_in_past', message: `La data ${date} è nel passato. Oggi è ${getTodayISO(timezone)}.` };
      }

      // 🛡️ Controlla giorno chiuso PRIMA di chiedere orario
      if (restaurantConfig.weekly_closing_days?.includes(dayOfWeek)) {
        return { available: false, reason: 'day_closed', message: `Il ristorante è chiuso il ${getDayName(dayOfWeek)}. Comunicarlo subito al cliente e proporre altro giorno.` };
      }

      // 🛡️ Solo dopo aver verificato che il giorno è aperto, richiedi l'orario
      if (!time) {
        return { available: false, reason: 'missing_time', message: 'Orario non specificato. Chiedere al cliente: "A che ora preferisce?"' };
      }

      console.log(`🔍 check_availability: ${date} ${time} per ${people} persone`);

      const [h, m] = time.split(':').map(Number);
      const timeMinutes = h * 60 + m;
      const isLunch = h < 15;

      // 🛡️ Controlla che l'orario sia dentro la finestra di apertura
      if (isLunch) {
        const lunchStart = restaurantConfig.lunch_start || '12:00';
        const lunchEnd   = restaurantConfig.lunch_end   || '14:30';
        const [lhs, lhm] = lunchStart.split(':').map(Number);
        const [les, lem] = lunchEnd.split(':').map(Number);
        const lunchStartMin = lhs * 60 + lhm;
        const lunchEndMin   = les * 60 + lem;
        if (timeMinutes < lunchStartMin || timeMinutes >= lunchEndMin) {
          return {
            available: false,
            reason: 'outside_hours',
            message: `Il pranzo è disponibile dalle ${lunchStart} alle ${lunchEnd}. Chiedere un orario in quella fascia.`
          };
        }
      } else {
        const dinnerStart = restaurantConfig.dinner_start || '19:00';
        const dinnerEnd   = restaurantConfig.dinner_end   || '22:30';
        const [dhs, dhm] = dinnerStart.split(':').map(Number);
        const [des, dem] = dinnerEnd.split(':').map(Number);
        const dinnerStartMin = dhs * 60 + dhm;
        const dinnerEndMin   = des * 60 + dem;
        if (timeMinutes < dinnerStartMin || timeMinutes >= dinnerEndMin) {
          return {
            available: false,
            reason: 'outside_hours',
            message: `La cena è disponibile dalle ${dinnerStart} alle ${dinnerEnd}. Chiedere un orario in quella fascia.`
          };
        }
      }

      if (isLunch && restaurantConfig.lunch_closed_days?.includes(dayOfWeek)) {
        return { available: false, reason: 'lunch_closed', message: `Il pranzo non è disponibile quel giorno.` };
      }
      if (!isLunch && restaurantConfig.dinner_closed_days?.includes(dayOfWeek)) {
        return { available: false, reason: 'dinner_closed', message: `La cena non è disponibile quel giorno.` };
      }

      try {
        const appsScriptUrl = getAppsScriptUrl(restaurantConfig);
        if (!appsScriptUrl) return { available: true, message: 'Procedo.' };

        const response = await fetch(appsScriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'check_availability',
            data: date, ora: time, persone: people,
            calendarId: restaurantConfig.calendar_id
          })
        });

        const result = await response.json();
        if (result.success) {
          return { available: true, message: 'Slot disponibile. Chiedere email opzionale poi prepare_reservation.' };
        } else {
          return { available: false, reason: result.reason || 'slot_full', message: result.message || 'Orario al completo. Proporre alternativo.' };
        }
      } catch (error) {
        console.error('❌ Errore check_availability:', error);
        return { available: true, message: 'Procedo.' };
      }
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PREPARE RESERVATION
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'prepare_reservation',
    description: `OBBLIGATORIO prima di create_reservation. Il sistema recupera automaticamente i dati dalla conversazione (data, orario, persone, nome). Passa i parametri che conosci: il server usa i dati realmente detti dal cliente, ignorando eventuali errori GPT. Il telefono viene preso automaticamente dal caller ID.`,
    parameters: {
      type: 'object',
      properties: {
        name:   { type: 'string',  description: 'Nome del cliente (REALE)' },
        people: { type: 'integer', description: 'Numero di persone' },
        date:   { type: 'string',  description: 'Data YYYY-MM-DD' },
        time:   { type: 'string',  description: 'Orario HH:MM' },
        email:  { type: 'string',  description: 'Email del cliente (opzionale)' },
        notes:  { type: 'string',  description: 'Note aggiuntive (opzionale)' }
      },
      required: ['name', 'people', 'date', 'time']
    },
    handler: async (args, context) => {
      const { restaurantConfig, sessionState, callerPhone } = context;
      const timezone = restaurantConfig?.timezone || 'Europe/Rome';

      // 🆕 v3.0.0: collectedData è la FONTE DI VERITÀ (server-side, deterministico)
      // In contesto MODIFICA: usa foundReservation come fallback per time/people
      const cd = sessionState?.collectedData || {};
      const found = sessionState?.foundReservation;
      // Nome: SOLO server-side. Zero fallback GPT — GPT inventa nomi come "l'utente"
      const name   = cd.name || null;
      const time   = cd.time || found?.time;
      const date   = cd.date || args.date;
      const people = cd.people || found?.people || args.people;
      const email  = cd.email || args.email;
      const notes  = args.notes;

      console.log(`📋 prepare_reservation v3.0.0:`);
      console.log(`   [SERVER]  name="${cd.name}" date="${cd.date}" time="${cd.time}" people=${cd.people} email="${cd.email}"`);
      console.log(`   [GPT]     name="${args.name}" date="${args.date}" time="${args.time}" people=${args.people}`);
      console.log(`   [FINALE]  name="${name}" date="${date}" time="${time}" people=${people} tel="${callerPhone}"`);

      // Blocca se nome o orario non sono stati detti esplicitamente dal cliente
      if (!name || !isValidName(name)) {
        return { ready: false, missing: 'name', message: 'Nome non ancora acquisito. Chiedere il nome al cliente prima di procedere.' };
      }
      if (!time) {
        return { ready: false, missing: 'time', message: 'Orario non ancora acquisito. Chiedere al cliente: "A che ora preferisce?"' };
      }

      // Telefono viene dal caller ID automaticamente
      const phone = callerPhone || '';
      if (!phone || !isValidPhone(phone)) {
        console.warn(`⚠️ callerPhone non disponibile o non valido: ${phone}`);
        // Non blocchiamo - il telefono potrebbe essere in note o non disponibile
      }

      // Blocca se data non ancora acquisita
      if (!date) {
        return { ready: false, missing: 'date', message: 'Data non ancora acquisita dal cliente. Chiedere per quale giorno vuole prenotare prima di procedere.' };
      }
      if (!date || !time || !people) {
        const missing = [];
        if (!date) missing.push('data');
        if (!time) missing.push('orario');
        if (!people) missing.push('numero persone');
        return { ready: false, missing: missing.join(', '), message: `Mancano: ${missing.join(', ')}.` };
      }

      if (isDateInPast(date, timezone)) {
        return { ready: false, missing: 'date', message: `La data ${date} è nel passato.` };
      }

      // 🛡️ Valida che l'orario sia dentro la finestra di apertura
      const [h, m] = time.split(':').map(Number);
      const timeMinutes = h * 60 + m;
      const isLunchTime = h < 15;
      if (isLunchTime) {
        const [lhs, lhm] = (restaurantConfig.lunch_start || '12:00').split(':').map(Number);
        const [les, lem] = (restaurantConfig.lunch_end   || '14:30').split(':').map(Number);
        if (timeMinutes < lhs*60+lhm || timeMinutes >= les*60+lem) {
          return { ready: false, missing: 'time', message: `L'orario ${time} è fuori dalla fascia pranzo (${restaurantConfig.lunch_start||'12:00'}-${restaurantConfig.lunch_end||'14:30'}). Chiedere un orario corretto.` };
        }
      } else {
        const [dhs, dhm] = (restaurantConfig.dinner_start || '19:00').split(':').map(Number);
        const [des, dem] = (restaurantConfig.dinner_end   || '22:30').split(':').map(Number);
        if (timeMinutes < dhs*60+dhm || timeMinutes >= des*60+dem) {
          return { ready: false, missing: 'time', message: `L'orario ${time} è fuori dalla fascia cena (${restaurantConfig.dinner_start||'19:00'}-${restaurantConfig.dinner_end||'22:30'}). Chiedere un orario corretto.` };
        }
      }

      // Costruisce note: email + note aggiuntive
      const noteParts = [];
      if (email) noteParts.push(`Email: ${email}`);
      if (notes) noteParts.push(notes);
      const finalNotes = noteParts.join(' | ');

      if (sessionState) {
        sessionState.pendingReservation = { name, people, date, time, phone, email: email || '', notes: finalNotes };
        sessionState.pendingConfirmation = true;
      }

      const dateDisplay = formatDateForSpeech(date);
      const timeDisplay = formatTimeForSpeech(time);
      const firstName = name.split(' ')[0];
      const largeGroupThreshold = restaurantConfig?.large_group_threshold || 10;
      const isLargeGroup = people > largeGroupThreshold;

      // Costruisce testo recap
      let emailText = email ? `, email ${email}` : '';
      let recapMessage;
      if (isLargeGroup) {
        recapMessage = `Perfetto ${firstName}! Riepilogo: ${people} persone, ${dateDisplay} alle ${timeDisplay}, a nome ${name}${emailText}. Trattandosi di un gruppo numeroso, sarà in attesa di conferma dal ristorante. Confermato?`;
      } else {
        recapMessage = `Perfetto ${firstName}! Riepilogo: ${people} persone, ${dateDisplay} alle ${timeDisplay}, a nome ${name}${emailText}. Confermato?`;
      }

      return {
        ready: true,
        recap: recapMessage,
        ISTRUZIONE_OBBLIGATORIA: `Pronuncia ESATTAMENTE questa frase, parola per parola, senza modifiche: "${recapMessage}"`,
        data: { name, people, date, time, phone, email: email || '', notes: finalNotes, isLargeGroup },
        instruction: `Leggere il recap al cliente: "${recapMessage}". Aspettare conferma esplicita prima di create_reservation.`
      };
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CREATE RESERVATION
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'create_reservation',
    description: `Crea la prenotazione. Chiamare SOLO dopo prepare_reservation E conferma del cliente.`,
    parameters: {
      type: 'object',
      properties: {
        name:   { type: 'string',  description: 'Nome del cliente' },
        people: { type: 'integer', description: 'Numero di persone' },
        date:   { type: 'string',  description: 'Data YYYY-MM-DD' },
        time:   { type: 'string',  description: 'Orario HH:MM' },
        notes:  { type: 'string',  description: 'Note (include email se presente)' }
      },
      required: ['name', 'people', 'date', 'time']
    },
    handler: async (args, context) => {
      const { callSid, restaurantConfig, sessionState, callerPhone } = context;
      const timezone = restaurantConfig?.timezone || 'Europe/Rome';

      // 🆕 v3.0.0: usa collectedData + pendingReservation come fonte di verità
      // Per nome, data, orario: server e pending PRIMA di GPT
      const cd = sessionState?.collectedData || {};
      const pending = sessionState?.pendingReservation || {};

      const name   = cd.name   || pending.name;   // NO fallback GPT per nome
      const date   = cd.date   || pending.date   || args.date;
      const time   = cd.time   || pending.time   || args.time;
      const people = cd.people || pending.people || args.people;
      const phone  = callerPhone || pending.phone || '';
      const finalNotes = args.notes || pending.notes || '';

      console.log(`📝 create_reservation v3.0.0:`);
      console.log(`   [SERVER]  name="${cd.name}" date="${cd.date}" time="${cd.time}" people=${cd.people}`);
      console.log(`   [PENDING] name="${pending.name}" date="${pending.date}" time="${pending.time}" people=${pending.people}`);
      console.log(`   [GPT]     name="${args.name}" date="${args.date}" time="${args.time}" people=${args.people}`);
      console.log(`   [FINALE]  name="${name}" date="${date}" time="${time}" people=${people} tel="${phone}"`);

      // 🛡️ Guard: se foundReservation esiste, siamo in contesto MODIFICA → usa modify_reservation
      if (sessionState?.foundReservation) {
        return { success: false, reason: 'use_modify', message: 'Stai modificando una prenotazione esistente. Chiama modify_reservation, non create_reservation.' };
      }

      // 🛡️ Guard: se intent iniziale era modify/cancel, non permettere create
      if (sessionState?.initialIntent === 'modify' || sessionState?.initialIntent === 'cancel') {
        return { success: false, reason: 'wrong_intent', message: `Il cliente vuole ${sessionState.initialIntent} una prenotazione esistente, non crearne una nuova. Chiama find_reservation prima.` };
      }

      if (sessionState && !sessionState.pendingConfirmation) {
        return { success: false, reason: 'missing_prepare', message: 'Prima chiamare prepare_reservation.' };
      }

      if (!isValidName(name)) {
        return { success: false, reason: 'invalid_name', message: 'Nome non valido.' };
      }

      if (isDateInPast(date, timezone)) {
        return { success: false, reason: 'date_in_past', message: 'La data è nel passato.' };
      }

      const largeGroupThreshold = restaurantConfig?.large_group_threshold || 10;
      const eventThreshold = restaurantConfig?.event_threshold || 45;
      let status = 'CONFIRMED';

      if (people > eventThreshold) {
        return {
          success: false,
          reason: 'event_threshold',
          message: `Gruppo di ${people} persone: contattare il ristorante via email a ${restaurantConfig?.owner_email || 'il ristorante'}.`
        };
      }
      if (people > largeGroupThreshold) {
        status = 'PENDING_OWNER';
      }

      try {
        const appsScriptUrl = getAppsScriptUrl(restaurantConfig);
        if (!appsScriptUrl) return { success: false, message: 'Errore configurazione.' };

        const response = await fetch(appsScriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'create_reservation',
            nome: name, persone: people, data: date, ora: time, telefono: phone,
            notes: finalNotes, status, forceNew: true,
            calendarId: restaurantConfig.calendar_id,
            source: 'realtime_api', callSid
          })
        });

        const result = await response.json();

        if (sessionState) {
          sessionState.pendingReservation = null;
          sessionState.pendingConfirmation = false;
        }

        if (result.success) {
          const dateDisplay = formatDateForSpeech(date);
          const firstName = name.split(' ')[0];
          if (status === 'PENDING_OWNER') {
            return { success: true, status: 'PENDING_OWNER', message: `Richiesta registrata per ${people} persone a nome ${name} per ${dateDisplay} alle ${formatTimeForSpeech(time)}. Il ristoratore ti contatterà per confermare.` };
          }
          return { success: true, status: 'CONFIRMED', message: `Prenotazione confermata! ${people} persone, ${dateDisplay} alle ${formatTimeForSpeech(time)}, a nome ${name}. Ti aspettiamo!` };
        } else {
          return { success: false, reason: result.reason || 'unknown', message: result.message || 'Errore creazione. Riprovare.' };
        }
      } catch (error) {
        console.error('❌ Errore create_reservation:', error);
        return { success: false, message: 'Errore tecnico. Riprovare.' };
      }
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // FIND RESERVATION
  // FIX v2.1.0:
  //   - Accetta 'date' per cercare prenotazione specifica
  //   - Usa callerPhone automaticamente come fallback telefono
  //   - Salva risultato in sessionState.foundReservation
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'find_reservation',
    description: `Cerca una prenotazione per nome e data. Usare per modifiche e cancellazioni.`,
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Nome del cliente' },
        date: { type: 'string', description: 'Data della prenotazione YYYY-MM-DD (opzionale ma consigliato)' }
      },
      required: ['name']
    },
    handler: async (args, context) => {
      const { restaurantConfig, sessionState, callerPhone } = context;

      // 🆕 v3.0.0: per find_reservation, il telefono è la fonte primaria (sempre disponibile).
      // La data viene da GPT (che conosce la data originale) NON da cd.date
      // (cd.date durante una modifica contiene la data DESTINAZIONE, non l'originale).
      // Il nome: preferisce cd.name se valido, altrimenti GPT.
      const cd = sessionState?.collectedData || {};
      const name = (cd.name && isValidName(cd.name)) ? cd.name : args.name;
      // ⚠️ NON usare cd.date: durante modify contiene la data nuova, non quella originale
      const date = args.date || '';

      console.log(`🔍 find_reservation v3.0.0:`);
      console.log(`   [SERVER] name="${cd.name}" date="${cd.date}" (NON usata per find)`);
      console.log(`   [GPT]    name="${args.name}" date="${args.date}"`);
      console.log(`   [FINALE] name="${name}" date="${date}" tel="${callerPhone || 'n/a'}"`);

      if (!isValidName(name)) {
        return { found: false, message: `Nome non specificato. Chiedere il nome della prenotazione.` };
      }

      try {
        const appsScriptUrl = getAppsScriptUrl(restaurantConfig);
        if (!appsScriptUrl) return { found: false, message: 'Errore configurazione.' };

        // Passa nome + telefono + data a Apps Script
        const response = await fetch(appsScriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'find_reservation',
            nome: name,
            telefono: callerPhone || '',
            data: date,
            calendarId: restaurantConfig.calendar_id
          })
        });

        const result = await response.json();

        if (result.found && result.reservations?.length > 0) {
          const reservations = result.reservations.map(r => ({
            eventId: r.eventId,
            date: r.date || r.data,
            time: r.time || r.ora,
            people: r.people || r.persone,
            name: r.name || r.nome,
            phone: r.phone || r.telefono || callerPhone || '',
            displayText: `${formatDateForSpeech(r.date || r.data)} alle ${formatTimeForSpeech(r.time || r.ora || '')} per ${r.people || r.persone} persone`
          }));

          // ✅ FIX: salva in sessionState per modify/cancel
          if (sessionState) {
            sessionState.foundReservation = reservations[0];
            console.log(`💾 find_reservation: salvato in sessionState`, sessionState.foundReservation);
          }

          return {
            found: true,
            count: reservations.length,
            reservations,
            message: `Trovata/e ${reservations.length} prenotazione/i a nome ${name}.`,
            ISTRUZIONE: `Prenotazione trovata: ${reservations[0].displayText}. Per la modifica, usa data/orario/persone di questa prenotazione come punto di partenza — NON inventare orari diversi. Chiedi al cliente SOLO le modifiche specifiche che vuole.`
          };
        }

        return { found: false, message: `Nessuna prenotazione trovata a nome "${name}"${date ? ` per il ${formatDateForSpeech(date)}` : ''}.` };

      } catch (error) {
        console.error('❌ Errore find_reservation:', error);
        return { found: false, message: 'Errore nella ricerca.' };
      }
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // MODIFY RESERVATION
  // FIX v2.1.0: usa dati da sessionState.foundReservation
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'modify_reservation',
    description: `Modifica una prenotazione esistente. Chiamare dopo find_reservation.`,
    parameters: {
      type: 'object',
      properties: {
        newDate:   { type: 'string',  description: 'Nuova data YYYY-MM-DD (opzionale)' },
        newTime:   { type: 'string',  description: 'Nuovo orario HH:MM (opzionale)' },
        newPeople: { type: 'integer', description: 'Nuovo numero persone (opzionale)' }
      },
      required: []
    },
    handler: async (args, context) => {
      const { newDate, newTime, newPeople } = args;
      const { restaurantConfig, sessionState, callerPhone } = context;

      // ✅ FIX: recupera prenotazione da sessionState
      const found = sessionState?.foundReservation;
      if (!found) {
        return { success: false, message: 'Prima chiamare find_reservation per trovare la prenotazione.' };
      }

      const date = newDate || found.date;
      const time = newTime || found.time;
      const people = newPeople || found.people;
      const phone = found.phone || callerPhone || '';

      console.log(`✏️ modify_reservation: ${found.name}, ${date} ${time}, ${people} pax`);

      try {
        const appsScriptUrl = getAppsScriptUrl(restaurantConfig);
        if (!appsScriptUrl) return { success: false, message: 'Errore configurazione.' };

        // ✅ FIX: usa action 'create_reservation' (upsert) con eventId per aggiornare
        const response = await fetch(appsScriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'create_reservation',
            nome: found.name,
            persone: people,
            data: date,
            ora: time,
            telefono: phone,
            notes: found.notes || '',
            status: 'CONFIRMED',
            eventId: found.eventId,
            calendarId: restaurantConfig.calendar_id,
            source: 'realtime_api'
          })
        });

        const result = await response.json();

        if (result.success) {
          const parts = [];
          if (newDate) parts.push(`data: ${formatDateForSpeech(newDate)}`);
          if (newTime) parts.push(`orario: ${formatTimeForSpeech(newTime)}`);
          if (newPeople) parts.push(`persone: ${newPeople}`);
          
          // Pulisci stato
          if (sessionState) sessionState.foundReservation = null;
          
          return { success: true, message: `Prenotazione aggiornata (${parts.join(', ')}).` };
        }

        return { success: false, message: result.message || 'Impossibile modificare.' };

      } catch (error) {
        console.error('❌ Errore modify_reservation:', error);
        return { success: false, message: 'Errore tecnico nella modifica.' };
      }
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CANCEL RESERVATION
  // FIX v2.1.0: usa dati da sessionState.foundReservation
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'cancel_reservation',
    description: `Cancella una prenotazione. Chiamare SOLO dopo find_reservation e conferma esplicita del cliente.`,
    parameters: {
      type: 'object',
      properties: {},
      required: []
    },
    handler: async (args, context) => {
      const { restaurantConfig, sessionState, callerPhone } = context;

      const found = sessionState?.foundReservation;
      if (!found) {
        return { success: false, message: 'Prima chiamare find_reservation per trovare la prenotazione.' };
      }

      // cancelConfirmed viene impostato dal server (in _parseAndStore) quando rileva conferma esplicita
      if (!sessionState?.cancelConfirmed) {
        return {
          success: false,
          reason: 'awaiting_cancel_confirm',
          message: `Aspetta conferma esplicita del cliente prima di cancellare.`
        };
      }

      console.log(`🗑️ cancel_reservation: ${found.name}, ${found.date} ${found.time}`);

      try {
        const appsScriptUrl = getAppsScriptUrl(restaurantConfig);
        if (!appsScriptUrl) return { success: false, message: 'Errore configurazione.' };

        // ✅ FIX: manda nome + telefono + data + ora come si aspetta l'Apps Script
        const response = await fetch(appsScriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'cancel_reservation',
            nome: found.name,
            telefono: found.phone || callerPhone || '',
            data: found.date,
            ora: found.time,
            eventId: found.eventId || '',
            calendarId: restaurantConfig.calendar_id
          })
        });

        const result = await response.json();

        if (result.success) {
          if (sessionState) sessionState.foundReservation = null;
          return { success: true, message: 'Prenotazione cancellata. Salutare il cliente.' };
        }

        return { success: false, message: result.message || 'Impossibile cancellare.' };

      } catch (error) {
        console.error('❌ Errore cancel_reservation:', error);
        return { success: false, message: 'Errore tecnico.' };
      }
    }
  }
];

export default realtimeTools;
