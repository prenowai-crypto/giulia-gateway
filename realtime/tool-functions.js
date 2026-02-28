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
      const { date, time, people } = args;
      const { restaurantConfig } = context;
      const timezone = restaurantConfig?.timezone || 'Europe/Rome';

      console.log(`🔍 check_availability: ${date} ${time} per ${people} persone`);

      if (isDateInPast(date, timezone)) {
        return { available: false, reason: 'date_in_past', message: `La data ${date} è nel passato. Oggi è ${getTodayISO(timezone)}.` };
      }

      const dayOfWeek = new Date(date + 'T12:00:00').getDay();
      if (restaurantConfig.weekly_closing_days?.includes(dayOfWeek)) {
        return { available: false, reason: 'day_closed', message: `Il ristorante è chiuso il ${getDayName(dayOfWeek)}. Proporre altro giorno.` };
      }

      const hour = parseInt(time.split(':')[0]);
      const isLunch = hour < 15;
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
      // I parametri GPT sono usati solo come fallback per campi non ancora parsati
      const cd = sessionState?.collectedData || {};
      const name   = cd.name   || args.name;
      const date   = cd.date   || args.date;
      const time   = cd.time   || args.time;
      const people = cd.people || args.people;
      const email  = cd.email  || args.email;
      const notes  = args.notes;

      console.log(`📋 prepare_reservation v3.0.0:`);
      console.log(`   [SERVER]  name="${cd.name}" date="${cd.date}" time="${cd.time}" people=${cd.people} email="${cd.email}"`);
      console.log(`   [GPT]     name="${args.name}" date="${args.date}" time="${args.time}" people=${args.people}`);
      console.log(`   [FINALE]  name="${name}" date="${date}" time="${time}" people=${people} tel="${callerPhone}"`);

      if (!isValidName(name)) {
        return { ready: false, missing: 'name', message: `Nome non valido: "${name}". Chiedere il nome reale al cliente.` };
      }

      // Telefono viene dal caller ID automaticamente
      const phone = callerPhone || '';
      if (!phone || !isValidPhone(phone)) {
        console.warn(`⚠️ callerPhone non disponibile o non valido: ${phone}`);
        // Non blocchiamo - il telefono potrebbe essere in note o non disponibile
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
      const timeDisplay = time.substring(0, 5);
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
      // priorità: collectedData (parsing server) > pendingReservation (prepare) > args GPT
      const cd = sessionState?.collectedData || {};
      const pending = sessionState?.pendingReservation || {};

      const name   = cd.name   || pending.name   || args.name;
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
            return { success: true, status: 'PENDING_OWNER', message: `Richiesta registrata per ${people} persone a nome ${name} per ${dateDisplay} alle ${time.substring(0,5)}. Il ristoratore ti contatterà per confermare.` };
          }
          return { success: true, status: 'CONFIRMED', message: `Prenotazione confermata! ${people} persone, ${dateDisplay} alle ${time.substring(0,5)}, a nome ${name}. Ti aspettiamo!` };
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
      const { name, date } = args;
      const { restaurantConfig, sessionState, callerPhone } = context;

      console.log(`🔍 find_reservation: nome="${name}" data="${date || 'qualsiasi'}" tel="${callerPhone || 'n/a'}"`);

      if (!isValidName(name)) {
        return { found: false, message: `Nome "${name}" non valido. Chiedere il nome della prenotazione.` };
      }

      try {
        const appsScriptUrl = getAppsScriptUrl(restaurantConfig);
        if (!appsScriptUrl) return { found: false, message: 'Errore configurazione.' };

        // ✅ FIX: passa nome + telefono chiamante + data
        const response = await fetch(appsScriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'find_reservation',
            nome: name,
            telefono: callerPhone || '',
            data: date || '',
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
            displayText: `${formatDateForSpeech(r.date || r.data)} alle ${(r.time || r.ora || '').substring(0, 5)} per ${r.people || r.persone} persone`
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
            message: `Trovata/e ${reservations.length} prenotazione/i a nome ${name}.`
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
          if (newTime) parts.push(`orario: ${newTime.substring(0, 5)}`);
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

      // ✅ FIX: recupera prenotazione da sessionState
      const found = sessionState?.foundReservation;
      if (!found) {
        return { success: false, message: 'Prima chiamare find_reservation per trovare la prenotazione.' };
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
