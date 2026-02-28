// ═══════════════════════════════════════════════════════════════════════════════
// PRENOW - TOOL FUNCTIONS v2.0.0
// 
// NOVITÀ v2.0.0 (portate da index v3.9.31):
//   - prepare_reservation: recap OBBLIGATORIO prima di create_reservation
//   - Validazione nome rafforzata (blocca placeholder + nomi troppo corti)
//   - Session state: pendingReservation tracciato lato server
//   - Protezione cognomi: errori comuni rilevati e bloccati
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
// SESSION STATE: traccia dati raccolti per ogni chiamata
// (viene passato come context.sessionState da openai-realtime.js)
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

function getAppsScriptUrl(restaurantConfig) {
  const url = restaurantConfig?.apps_script_url || process.env.APPS_SCRIPT_URL;
  if (!url) {
    console.error('❌ APPS_SCRIPT_URL non configurato!');
  }
  return url;
}

function getTodayISO(timezone = 'Europe/Rome') {
  const now = new Date();
  const options = { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' };
  const parts = new Intl.DateTimeFormat('en-CA', options).formatToParts(now);
  const year = parts.find(p => p.type === 'year').value;
  const month = parts.find(p => p.type === 'month').value;
  const day = parts.find(p => p.type === 'day').value;
  return `${year}-${month}-${day}`;
}

function isDateInPast(dateStr, timezone = 'Europe/Rome') {
  const today = getTodayISO(timezone);
  return dateStr < today;
}

// ─────────────────────────────────────────────────────────────────────────────
// VALIDAZIONE NOME (portata da NameManager v3.9.21 + RecapManager)
// ─────────────────────────────────────────────────────────────────────────────

const INVALID_NAME_WORDS = [
  // Placeholder espliciti
  'cliente', 'client', 'nome', 'name', 'unknown', 'sconosciuto',
  // Parole comuni che non sono nomi
  'prenotazione', 'reservation', 'tavolo', 'table', 'posto',
  'persona', 'persone', 'people', 'pax',
  // Parole che potrebbero essere cognomi ma sono comandi
  'sposta', 'sposto', 'cancella', 'cancello', 'modifica', 'modifico',
  'cambia', 'cambio', 'annulla', 'annullo', 'elimina',
  // Risposte generiche
  'si', 'no', 'ok', 'certo', 'grazie', 'prego', 'esatto', 'giusto', 'confermo',
  // Vuoto/null
  '', 'null', 'undefined', 'none', 'nessuno',
];

function isValidName(name) {
  if (!name) return false;
  const trimmed = name.trim();
  if (trimmed.length < 2) return false;
  
  const lower = trimmed.toLowerCase();
  if (INVALID_NAME_WORDS.includes(lower)) return false;
  
  // Deve contenere almeno una lettera
  if (!/[a-zA-ZàèéìòùÀÈÉÌÒÙ]/.test(trimmed)) return false;
  
  // Non deve essere solo numeri
  if (/^\d+$/.test(trimmed)) return false;
  
  return true;
}

function isValidPhone(phone) {
  if (!phone) return false;
  const cleaned = phone.replace(/[\s\-\+\(\)\.]/g, '');
  // Min 6 cifre, max 15, solo numeri
  return /^\d{6,15}$/.test(cleaned);
}

// ─────────────────────────────────────────────────────────────────────────────
// FORMATO DATE PER SPEECH (portato da v3.9.31)
// ─────────────────────────────────────────────────────────────────────────────

function formatDateForSpeech(dateStr) {
  if (!dateStr) return 'data non specificata';
  try {
    const date = new Date(dateStr + 'T12:00:00');
    const dayNames = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
    const monthNames = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
                        'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
    const dayName = dayNames[date.getDay()];
    const day = date.getDate();
    const month = monthNames[date.getMonth()];
    return `${dayName} ${day} ${month}`;
  } catch {
    return dateStr;
  }
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
    description: `Verifica se uno slot è disponibile. Chiamare prima di raccogliere nome/telefono.`,
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Data in formato YYYY-MM-DD' },
        time: { type: 'string', description: 'Orario in formato HH:MM' },
        people: { type: 'integer', description: 'Numero di persone' }
      },
      required: ['date', 'time', 'people']
    },
    handler: async (args, context) => {
      const { date, time, people } = args;
      const { restaurantConfig } = context;
      const timezone = restaurantConfig?.timezone || 'Europe/Rome';

      console.log(`🔍 check_availability: ${date} ${time} per ${people} persone`);

      // Validazione data nel passato
      if (isDateInPast(date, timezone)) {
        const today = getTodayISO(timezone);
        return {
          available: false,
          reason: 'date_in_past',
          message: `La data ${date} è nel passato. Oggi è ${today}. Chiedere una data futura.`
        };
      }

      // Validazione giorno di chiusura
      const dayOfWeek = new Date(date + 'T12:00:00').getDay();
      if (restaurantConfig.weekly_closing_days?.includes(dayOfWeek)) {
        const dayName = getDayName(dayOfWeek, true);
        return {
          available: false,
          reason: 'day_closed',
          message: `Il ristorante è chiuso il ${dayName}. Proporre un altro giorno.`
        };
      }

      // Validazione pranzo/cena chiusi
      const hour = parseInt(time.split(':')[0]);
      const isLunch = hour < 15;
      if (isLunch && restaurantConfig.lunch_closed_days?.includes(dayOfWeek)) {
        return { available: false, reason: 'lunch_closed', message: `Il pranzo non è disponibile quel giorno.` };
      }
      if (!isLunch && restaurantConfig.dinner_closed_days?.includes(dayOfWeek)) {
        return { available: false, reason: 'dinner_closed', message: `La cena non è disponibile quel giorno.` };
      }

      // Check su Apps Script
      try {
        const appsScriptUrl = getAppsScriptUrl(restaurantConfig);
        if (!appsScriptUrl) {
          return { available: true, message: 'Procedo con la raccolta dati.' };
        }

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
          return { available: true, message: 'Slot disponibile. Procedere a raccogliere nome e telefono.' };
        } else {
          return {
            available: false,
            reason: result.reason || 'slot_full',
            message: result.message || 'Orario al completo. Proporre orario alternativo.'
          };
        }
      } catch (error) {
        console.error('❌ Errore check_availability:', error);
        return { available: true, message: 'Procedo con la raccolta dati.' };
      }
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PREPARE RESERVATION (NUOVO - RECAP OBBLIGATORIO)
  // Portato da RecapManager v3.9.21
  // L'AI DEVE chiamare questo PRIMA di create_reservation.
  // Restituisce il testo del recap da leggere al cliente.
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'prepare_reservation',
    description: `OBBLIGATORIO prima di create_reservation. Valida tutti i dati raccolti e costruisce il recap da leggere al cliente per la conferma. Chiamare solo quando si hanno: nome reale, persone, data, orario E telefono.`,
    parameters: {
      type: 'object',
      properties: {
        name:   { type: 'string',  description: 'Nome del cliente (REALE, non placeholder)' },
        people: { type: 'integer', description: 'Numero di persone' },
        date:   { type: 'string',  description: 'Data in formato YYYY-MM-DD' },
        time:   { type: 'string',  description: 'Orario in formato HH:MM' },
        phone:  { type: 'string',  description: 'Numero di telefono del cliente' },
        notes:  { type: 'string',  description: 'Note aggiuntive (opzionale)' }
      },
      required: ['name', 'people', 'date', 'time', 'phone']
    },
    handler: async (args, context) => {
      const { name, people, date, time, phone, notes } = args;
      const { restaurantConfig, sessionState } = context;
      const timezone = restaurantConfig?.timezone || 'Europe/Rome';

      console.log(`📋 prepare_reservation: ${name}, ${people} pax, ${date} ${time}, tel: ${phone}`);

      // ── Validazioni bloccanti ──
      if (!isValidName(name)) {
        return {
          ready: false,
          missing: 'name',
          message: `Nome non valido: "${name}". Chiedere il nome reale del cliente (es. "Rossi", "Mario Bianchi").`
        };
      }

      if (!isValidPhone(phone)) {
        return {
          ready: false,
          missing: 'phone',
          message: `Telefono non valido: "${phone}". Chiedere il numero di telefono corretto (es. "3331234567").`
        };
      }

      if (!date || !time || !people) {
        const missing = [];
        if (!date) missing.push('data');
        if (!time) missing.push('orario');
        if (!people) missing.push('numero persone');
        return {
          ready: false,
          missing: missing.join(', '),
          message: `Mancano: ${missing.join(', ')}. Raccogliere prima questi dati.`
        };
      }

      if (isDateInPast(date, timezone)) {
        return {
          ready: false,
          missing: 'date',
          message: `La data ${date} è nel passato. Chiedere una data futura.`
        };
      }

      // ── Salva in sessionState per create_reservation ──
      if (sessionState) {
        sessionState.pendingReservation = { name, people, date, time, phone, notes: notes || '' };
        sessionState.pendingConfirmation = true;
        console.log(`💾 prepare_reservation: pendingReservation salvato in session`);
      }

      // ── Costruisce testo recap (da RecapManager.buildModifyRecapMessage) ──
      const dateDisplay = formatDateForSpeech(date);
      const timeDisplay = time.substring(0, 5);
      const firstName = name.split(' ')[0];
      const notesText = notes ? ` Note: ${notes}.` : '';

      const largeGroupThreshold = restaurantConfig?.large_group_threshold || 10;
      const isLargeGroup = people > largeGroupThreshold;

      let recapMessage;
      if (isLargeGroup) {
        recapMessage = `Perfetto ${firstName}! Riepilogo: ${people} persone, ${dateDisplay} alle ${timeDisplay}, a nome ${name}, telefono ${phone}.${notesText} Trattandosi di un gruppo numeroso, la prenotazione sarà in attesa di conferma dal ristorante. Confermato?`;
      } else {
        recapMessage = `Perfetto ${firstName}! Riepilogo: ${people} persone, ${dateDisplay} alle ${timeDisplay}, a nome ${name}, telefono ${phone}.${notesText} Confermato?`;
      }

      console.log(`✅ prepare_reservation OK - recap pronto`);

      return {
        ready: true,
        recap: recapMessage,
        data: { name, people, date, time, phone, notes: notes || '', isLargeGroup },
        instruction: `Leggere il recap al cliente: "${recapMessage}". Aspettare conferma esplicita (sì/confermo/giusto) prima di chiamare create_reservation.`
      };
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CREATE RESERVATION
  // Funziona solo dopo prepare_reservation (verifica pendingConfirmation)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'create_reservation',
    description: `Crea la prenotazione. Chiamare SOLO dopo prepare_reservation E dopo che il cliente ha confermato il recap.`,
    parameters: {
      type: 'object',
      properties: {
        name:   { type: 'string',  description: 'Nome del cliente' },
        people: { type: 'integer', description: 'Numero di persone' },
        date:   { type: 'string',  description: 'Data in formato YYYY-MM-DD' },
        time:   { type: 'string',  description: 'Orario in formato HH:MM' },
        phone:  { type: 'string',  description: 'Numero di telefono' },
        notes:  { type: 'string',  description: 'Note aggiuntive' }
      },
      required: ['name', 'people', 'date', 'time', 'phone']
    },
    handler: async (args, context) => {
      const { name, people, date, time, phone, notes } = args;
      const { callSid, restaurantConfig, sessionState } = context;
      const timezone = restaurantConfig?.timezone || 'Europe/Rome';

      console.log(`📝 create_reservation: ${name}, ${people} pax, ${date} ${time}, tel: ${phone}`);

      // ── Sicurezza: verifica che prepare_reservation sia stato chiamato ──
      if (sessionState && !sessionState.pendingConfirmation) {
        console.warn(`⚠️ create_reservation chiamato SENZA prepare_reservation!`);
        return {
          success: false,
          reason: 'missing_prepare',
          message: 'Prima chiamare prepare_reservation e leggere il recap al cliente.'
        };
      }

      // ── Validazioni finali (double-check) ──
      if (!isValidName(name)) {
        return { success: false, reason: 'invalid_name', message: 'Nome non valido. Tornare a raccoglierlo.' };
      }

      if (!isValidPhone(phone)) {
        return { success: false, reason: 'invalid_phone', message: 'Telefono non valido. Tornare a raccoglierlo.' };
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
          message: `Gruppo di ${people} persone: troppo grande per prenotazione diretta. Suggerire di contattare il ristorante via email a ${restaurantConfig?.owner_email || 'il ristorante'}.`
        };
      }
      if (people > largeGroupThreshold) {
        status = 'PENDING_OWNER';
      }

      // ── Invio ad Apps Script ──
      try {
        const appsScriptUrl = getAppsScriptUrl(restaurantConfig);
        if (!appsScriptUrl) {
          return { success: false, message: 'Errore di configurazione server.' };
        }

        const response = await fetch(appsScriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'create_reservation',
            nome: name, persone: people, data: date, ora: time, telefono: phone,
            notes: notes || '', status, forceNew: true,
            calendarId: restaurantConfig.calendar_id,
            source: 'realtime_api',
            callSid
          })
        });

        const result = await response.json();

        // ── Pulisci pending dopo successo ──
        if (sessionState) {
          sessionState.pendingReservation = null;
          sessionState.pendingConfirmation = false;
        }

        if (result.success) {
          const dateDisplay = formatDateForSpeech(date);
          const firstName = name.split(' ')[0];

          if (status === 'PENDING_OWNER') {
            return {
              success: true,
              status: 'PENDING_OWNER',
              message: `Richiesta registrata per ${people} persone a nome ${name} per ${dateDisplay} alle ${time.substring(0,5)}. Il ristoratore contatterà ${firstName} al ${phone} per confermare.`
            };
          }

          return {
            success: true,
            status: 'CONFIRMED',
            message: `Prenotazione confermata! ${people} persone, ${dateDisplay} alle ${time.substring(0,5)}, a nome ${name}. Ti aspettiamo!`
          };
        } else {
          return {
            success: false,
            reason: result.reason || 'unknown',
            message: result.message || 'Errore nella creazione. Riprovare o proporre orario alternativo.'
          };
        }
      } catch (error) {
        console.error('❌ Errore create_reservation:', error);
        return { success: false, message: 'Errore tecnico momentaneo. Riprovare.' };
      }
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // FIND RESERVATION
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'find_reservation',
    description: `Cerca prenotazioni esistenti per nome (e opzionalmente telefono).`,
    parameters: {
      type: 'object',
      properties: {
        name:  { type: 'string', description: 'Nome del cliente' },
        phone: { type: 'string', description: 'Telefono (opzionale)' }
      },
      required: ['name']
    },
    handler: async (args, context) => {
      const { name, phone } = args;
      const { restaurantConfig } = context;

      console.log(`🔍 find_reservation: ${name}`);

      if (!isValidName(name)) {
        return { found: false, message: `Nome "${name}" non valido. Chiedere il nome della prenotazione.` };
      }

      try {
        const appsScriptUrl = getAppsScriptUrl(restaurantConfig);
        if (!appsScriptUrl) return { found: false, message: 'Errore di configurazione.' };

        const response = await fetch(appsScriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'find_reservation',
            nome: name, telefono: phone || '',
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
            displayText: `${formatDateForSpeech(r.date || r.data)} alle ${(r.time || r.ora).substring(0, 5)} per ${r.people || r.persone} persone`
          }));

          return {
            found: true,
            count: reservations.length,
            reservations,
            message: `Trovata/e ${reservations.length} prenotazione/i a nome ${name}.`
          };
        }

        return { found: false, message: `Nessuna prenotazione trovata a nome "${name}".` };

      } catch (error) {
        console.error('❌ Errore find_reservation:', error);
        return { found: false, message: 'Errore nella ricerca.' };
      }
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // MODIFY RESERVATION
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'modify_reservation',
    description: `Modifica una prenotazione esistente (data, orario, persone).`,
    parameters: {
      type: 'object',
      properties: {
        eventId:    { type: 'string',  description: 'ID prenotazione da find_reservation' },
        newDate:    { type: 'string',  description: 'Nuova data YYYY-MM-DD (opzionale)' },
        newTime:    { type: 'string',  description: 'Nuovo orario HH:MM (opzionale)' },
        newPeople:  { type: 'integer', description: 'Nuovo numero persone (opzionale)' }
      },
      required: ['eventId']
    },
    handler: async (args, context) => {
      const { eventId, newDate, newTime, newPeople } = args;
      const { restaurantConfig } = context;

      console.log(`✏️ modify_reservation: ${eventId}`);

      try {
        const appsScriptUrl = getAppsScriptUrl(restaurantConfig);
        if (!appsScriptUrl) return { success: false, message: 'Errore di configurazione.' };

        const response = await fetch(appsScriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'modify_reservation',
            eventId,
            nuovaData: newDate,
            nuovaOra: newTime,
            nuovePersone: newPeople,
            calendarId: restaurantConfig.calendar_id
          })
        });

        const result = await response.json();

        if (result.success) {
          const parts = [];
          if (newDate) parts.push(`data: ${formatDateForSpeech(newDate)}`);
          if (newTime) parts.push(`orario: ${newTime.substring(0, 5)}`);
          if (newPeople) parts.push(`persone: ${newPeople}`);
          return { success: true, message: `Prenotazione aggiornata (${parts.join(', ')}).` };
        }

        return { success: false, message: result.message || 'Impossibile modificare la prenotazione.' };

      } catch (error) {
        console.error('❌ Errore modify_reservation:', error);
        return { success: false, message: 'Errore tecnico nella modifica.' };
      }
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CANCEL RESERVATION
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'cancel_reservation',
    description: `Cancella una prenotazione. IMPORTANTE: prima di chiamare questo tool, leggere al cliente la prenotazione e chiedere conferma esplicita ("Confermo di volerla cancellare?").`,
    parameters: {
      type: 'object',
      properties: {
        eventId: { type: 'string', description: 'ID prenotazione da find_reservation' }
      },
      required: ['eventId']
    },
    handler: async (args, context) => {
      const { eventId } = args;
      const { restaurantConfig } = context;

      console.log(`🗑️ cancel_reservation: ${eventId}`);

      try {
        const appsScriptUrl = getAppsScriptUrl(restaurantConfig);
        if (!appsScriptUrl) return { success: false, message: 'Errore di configurazione.' };

        const response = await fetch(appsScriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'cancel_reservation',
            eventId,
            calendarId: restaurantConfig.calendar_id
          })
        });

        const result = await response.json();

        if (result.success) {
          return { success: true, message: 'Prenotazione cancellata. Salutare il cliente.' };
        }

        return { success: false, message: result.message || 'Impossibile cancellare la prenotazione.' };

      } catch (error) {
        console.error('❌ Errore cancel_reservation:', error);
        return { success: false, message: 'Errore tecnico nella cancellazione.' };
      }
    }
  }
];

export default realtimeTools;
