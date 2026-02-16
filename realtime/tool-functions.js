// ═══════════════════════════════════════════════════════════════════════════════
// PRENOW - TOOL FUNCTIONS v1.1.0
// Espone la business logic esistente come tool functions per OpenAI Realtime
// FIX v1.0.1: Aggiunto fallback a process.env.APPS_SCRIPT_URL
// FIX v1.0.2: Parametri italiani per Apps Script (nome, persone, data, ora, telefono)
// FIX v1.1.0: Validazione date server-side, blocco placeholder, blocco date passate
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Helper per ottenere l'URL di Apps Script
 */
function getAppsScriptUrl(restaurantConfig) {
  const url = restaurantConfig?.apps_script_url || process.env.APPS_SCRIPT_URL;
  if (!url) {
    console.error('❌ APPS_SCRIPT_URL non configurato!');
  }
  return url;
}

/**
 * FIX v1.1.0: Calcola la data corrente nel timezone del ristorante
 */
function getTodayISO(timezone = 'Europe/Rome') {
  const now = new Date();
  const options = { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' };
  const parts = new Intl.DateTimeFormat('en-CA', options).formatToParts(now);
  const year = parts.find(p => p.type === 'year').value;
  const month = parts.find(p => p.type === 'month').value;
  const day = parts.find(p => p.type === 'day').value;
  return `${year}-${month}-${day}`;
}

/**
 * FIX v1.1.0: Valida che la data non sia nel passato
 */
function isDateInPast(dateStr, timezone = 'Europe/Rome') {
  const today = getTodayISO(timezone);
  return dateStr < today;
}

/**
 * FIX v1.1.0: Valida il nome (non deve essere placeholder)
 */
function isValidName(name) {
  if (!name) return false;
  const invalidNames = ['cliente', 'client', 'nome', 'name', 'unknown', 'sconosciuto', ''];
  return !invalidNames.includes(name.toLowerCase().trim());
}

/**
 * FIX v1.1.0: Valida il telefono (deve contenere solo numeri/spazi/trattini)
 */
function isValidPhone(phone) {
  if (!phone) return false;
  // Rimuovi spazi e trattini, verifica che rimangano solo numeri
  const cleaned = phone.replace(/[\s\-\+\(\)]/g, '');
  // Deve avere almeno 6 cifre e contenere solo numeri
  return /^\d{6,15}$/.test(cleaned);
}

/**
 * Definizione delle tool functions per OpenAI Realtime
 * Ogni tool ha: name, description, parameters (JSON Schema), handler (funzione)
 */
export const realtimeTools = [
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // TOOL 1: CHECK AVAILABILITY
  // ═══════════════════════════════════════════════════════════════════════════════
  {
    name: 'check_availability',
    description: `Verifica se un determinato slot (data + orario) è disponibile per un certo numero di persone.
Usa questo tool PRIMA di confermare una prenotazione per verificare:
- Il giorno non è un giorno di chiusura
- L'orario è valido (pranzo o cena)
- C'è capacità sufficiente nello slot`,
    parameters: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description: 'Data in formato YYYY-MM-DD (es: 2026-02-20)'
        },
        time: {
          type: 'string',
          description: 'Orario in formato HH:MM (es: 20:30)'
        },
        people: {
          type: 'integer',
          description: 'Numero di persone'
        }
      },
      required: ['date', 'time', 'people']
    },
    handler: async (args, context) => {
      const { date, time, people } = args;
      const { restaurantConfig } = context;
      const timezone = restaurantConfig?.timezone || 'Europe/Rome';
      
      console.log(`🔍 Check availability: ${date} ${time} per ${people} persone`);
      
      // ═══════════════════════════════════════════════════════════════════════════
      // FIX v1.1.0: Validazione data lato server
      // ═══════════════════════════════════════════════════════════════════════════
      
      // 0. Verifica data non nel passato
      if (isDateInPast(date, timezone)) {
        const today = getTodayISO(timezone);
        console.log(`❌ Data nel passato: ${date} < ${today}`);
        return {
          available: false,
          reason: 'date_in_past',
          message: `La data ${date} è nel passato. Oggi è ${today}. Vuoi prenotare per un altro giorno?`
        };
      }
      
      // 1. Verifica giorno chiusura
      const dayOfWeek = new Date(date + 'T12:00:00').getDay();
      
      // Chiusura totale
      if (restaurantConfig.weekly_closing_days?.includes(dayOfWeek)) {
        const dayName = getDayName(dayOfWeek, true);
        return {
          available: false,
          reason: 'day_closed',
          message: `Il ristorante è chiuso il ${dayName}.`
        };
      }
      
      // 2. Determina se pranzo o cena
      const hour = parseInt(time.split(':')[0]);
      const isLunch = hour < 15;
      
      // Chiusura pranzo
      if (isLunch && restaurantConfig.lunch_closed_days?.includes(dayOfWeek)) {
        const dayName = getDayName(dayOfWeek, true);
        return {
          available: false,
          reason: 'lunch_closed',
          message: `Il pranzo non è disponibile il ${dayName}. Posso proporre la cena?`
        };
      }
      
      // Chiusura cena
      if (!isLunch && restaurantConfig.dinner_closed_days?.includes(dayOfWeek)) {
        const dayName = getDayName(dayOfWeek, true);
        return {
          available: false,
          reason: 'dinner_closed',
          message: `La cena non è disponibile il ${dayName}. Posso proporre il pranzo?`
        };
      }
      
      // 3. Verifica orario valido
      const lunchStart = restaurantConfig.lunch_start || '12:00';
      const lunchEnd = restaurantConfig.lunch_end || '14:30';
      const dinnerStart = restaurantConfig.dinner_start || '21:00';
      const dinnerEnd = restaurantConfig.dinner_end || '23:00';
      
      const isValidLunchTime = isLunch && time >= lunchStart && time <= lunchEnd;
      const isValidDinnerTime = !isLunch && time >= dinnerStart && time <= dinnerEnd;
      
      if (!isValidLunchTime && !isValidDinnerTime) {
        return {
          available: false,
          reason: 'invalid_time',
          message: isLunch 
            ? `L'orario pranzo è dalle ${lunchStart} alle ${lunchEnd}.`
            : `L'orario cena è dalle ${dinnerStart} alle ${dinnerEnd}.`
        };
      }
      
      // 4. Chiama Apps Script per verifica capacità
      try {
        const appsScriptUrl = getAppsScriptUrl(restaurantConfig);
        if (!appsScriptUrl) {
          return { available: true, message: 'Procedo con la prenotazione.' };
        }
        
        console.log(`📡 Calling Apps Script: ${appsScriptUrl}`);
        const response = await fetch(appsScriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'check_availability',
            data: date,        // FIX v1.0.2: parametro italiano
            ora: time,         // FIX v1.0.2: parametro italiano
            persone: people,   // FIX v1.0.2: parametro italiano
            calendarId: restaurantConfig.calendar_id
          })
        });
        
        const result = await response.json();
        console.log('📋 Apps Script response:', result);
        
        // FIX v1.0.2: Apps Script usa "success" non "available"
        if (result.success) {
          return {
            available: true,
            message: 'Lo slot è disponibile.'
          };
        } else {
          return {
            available: false,
            reason: result.reason || 'slot_full',
            message: result.message || 'Mi dispiace, questo orario è al completo.',
            alternatives: result.alternatives || []
          };
        }
      } catch (error) {
        console.error('❌ Errore check_availability:', error);
        return {
          available: true, // Fallback: permetti la prenotazione
          message: 'Non ho potuto verificare la disponibilità, procedo con la prenotazione.'
        };
      }
    }
  },
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // TOOL 2: CREATE RESERVATION
  // ═══════════════════════════════════════════════════════════════════════════════
  {
    name: 'create_reservation',
    description: `Crea una nuova prenotazione nel calendario del ristorante.
Usa questo tool SOLO dopo aver:
1. Verificato disponibilità con check_availability
2. Raccolto tutti i dati: nome, persone, data, orario, telefono
Per gruppi >10 persone, la prenotazione va in stato PENDING_OWNER.`,
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Nome del cliente'
        },
        people: {
          type: 'integer',
          description: 'Numero di persone'
        },
        date: {
          type: 'string',
          description: 'Data in formato YYYY-MM-DD'
        },
        time: {
          type: 'string',
          description: 'Orario in formato HH:MM'
        },
        phone: {
          type: 'string',
          description: 'Numero di telefono del cliente'
        },
        notes: {
          type: 'string',
          description: 'Note aggiuntive (allergie, occasioni speciali, ecc.)'
        }
      },
      required: ['name', 'people', 'date', 'time', 'phone']
    },
    handler: async (args, context) => {
      const { name, people, date, time, phone, notes } = args;
      const { callSid, restaurantConfig } = context;
      const timezone = restaurantConfig?.timezone || 'Europe/Rome';
      
      console.log(`📝 Creazione prenotazione: ${name}, ${people} pax, ${date} ${time}, tel: ${phone}`);
      
      // ═══════════════════════════════════════════════════════════════════════════
      // FIX v1.1.0: Validazione rigorosa dati
      // ═══════════════════════════════════════════════════════════════════════════
      
      // Valida nome (non placeholder)
      if (!isValidName(name)) {
        console.error('❌ Nome non valido o placeholder:', name);
        return {
          success: false,
          reason: 'invalid_name',
          message: 'Mi può dire il suo nome per favore?'
        };
      }
      
      // Valida telefono (solo numeri)
      if (!isValidPhone(phone)) {
        console.error('❌ Telefono non valido:', phone);
        return {
          success: false,
          reason: 'invalid_phone',
          message: 'Mi può dettare il suo numero di telefono per favore?'
        };
      }
      
      // Valida data non nel passato
      if (isDateInPast(date, timezone)) {
        const today = getTodayISO(timezone);
        console.error(`❌ Data nel passato: ${date} < ${today}`);
        return {
          success: false,
          reason: 'date_in_past',
          message: `La data ${date} è nel passato. Per quale giorno vuole prenotare?`
        };
      }
      
      // Valida dati obbligatori base
      if (!people || !date || !time) {
        console.error('❌ Dati mancanti:', { name, people, date, time, phone });
        return {
          success: false,
          reason: 'missing_data',
          message: 'Mi mancano alcuni dati. Per quante persone, che giorno e a che ora?'
        };
      }
      
      // ═══════════════════════════════════════════════════════════════════════════
      
      // Determina stato iniziale
      const largeGroupThreshold = restaurantConfig?.large_group_threshold || 10;
      let status = 'CONFIRMED';
      if (people > largeGroupThreshold) {
        status = 'PENDING_OWNER';
      }
      
      try {
        const appsScriptUrl = getAppsScriptUrl(restaurantConfig);
        if (!appsScriptUrl) {
          return { success: false, message: 'Errore di configurazione. Riprova più tardi.' };
        }
        
        console.log(`📡 Calling Apps Script: ${appsScriptUrl}`);
        const response = await fetch(appsScriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'create_reservation',
            nome: name,           // FIX v1.0.2: parametro italiano
            persone: people,      // FIX v1.0.2: parametro italiano
            data: date,           // FIX v1.0.2: parametro italiano
            ora: time,            // FIX v1.0.2: parametro italiano
            telefono: phone,      // FIX v1.0.2: parametro italiano
            notes: notes || '',
            status,
            forceNew: true,       // Sempre nuova prenotazione via Realtime API
            calendarId: restaurantConfig.calendar_id,
            source: 'realtime_api',
            callSid
          })
        });
        
        const result = await response.json();
        console.log('📋 Apps Script response:', result);
        
        if (result.success) {
          if (status === 'PENDING_OWNER') {
            return {
              success: true,
              status: 'PENDING_OWNER',
              eventId: result.eventId,
              changeType: result.changeType,
              forceNew: result.forceNew,
              emailStatus: result.emailStatus,
              message: `Ho registrato la richiesta per ${people} persone a nome ${name}. Essendo un gruppo numeroso, il ristoratore confermerà la prenotazione e ti ricontatterà al numero ${phone}.`
            };
          }
          
          return {
            success: true,
            status: 'CONFIRMED',
            eventId: result.eventId,
            changeType: result.changeType,
            forceNew: result.forceNew,
            emailStatus: result.emailStatus,
            message: `Perfetto! Prenotazione confermata per ${people} persone a nome ${name}, ${formatDateForSpeech(date)} alle ${time.substring(0, 5)}. Ti aspettiamo!`
          };
        } else if (result.reason === 'slot_full') {
          return {
            success: false,
            reason: 'slot_full',
            message: 'Mi dispiace, nel frattempo lo slot si è riempito. Posso proporre un altro orario?',
            alternatives: result.alternatives || []
          };
        } else if (result.reason === 'day_closed') {
          return {
            success: false,
            reason: 'day_closed',
            message: result.message || 'Il ristorante è chiuso in quel giorno.'
          };
        } else {
          console.error('❌ Apps Script error:', result);
          return {
            success: false,
            reason: result.reason || 'unknown',
            message: result.message || 'Si è verificato un problema. Puoi riprovare?'
          };
        }
      } catch (error) {
        console.error('❌ Errore create_reservation:', error);
        return {
          success: false,
          reason: 'error',
          message: 'Errore tecnico. Riprova tra poco.'
        };
      }
    }
  },
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // TOOL 3: FIND RESERVATION
  // ═══════════════════════════════════════════════════════════════════════════════
  {
    name: 'find_reservation',
    description: `Cerca una prenotazione esistente per nome o telefono.
Usa questo tool quando il cliente vuole modificare o cancellare una prenotazione.`,
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Nome del cliente'
        },
        phone: {
          type: 'string',
          description: 'Numero di telefono (opzionale, per ricerca più precisa)'
        }
      },
      required: ['name']
    },
    handler: async (args, context) => {
      const { name, phone } = args;
      const { restaurantConfig } = context;
      
      console.log(`🔍 Ricerca prenotazione: ${name}`);
      
      try {
        const appsScriptUrl = getAppsScriptUrl(restaurantConfig);
        if (!appsScriptUrl) {
          return { found: false, message: 'Errore di configurazione.' };
        }
        
        console.log(`📡 Calling Apps Script: ${appsScriptUrl}`);
        const response = await fetch(appsScriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'find_reservation',
            nome: name,           // FIX v1.0.2: parametro italiano
            telefono: phone || '', // FIX v1.0.2: parametro italiano
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
            message: reservations.length === 1
              ? `Ho trovato la prenotazione: ${reservations[0].displayText}.`
              : `Ho trovato ${reservations.length} prenotazioni a questo nome.`
          };
        } else {
          return {
            found: false,
            message: `Non ho trovato prenotazioni a nome ${name}.`
          };
        }
      } catch (error) {
        console.error('❌ Errore find_reservation:', error);
        return {
          found: false,
          message: 'Errore nella ricerca. Puoi ripetere il nome?'
        };
      }
    }
  },
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // TOOL 4: MODIFY RESERVATION
  // ═══════════════════════════════════════════════════════════════════════════════
  {
    name: 'modify_reservation',
    description: `Modifica una prenotazione esistente.
Usa find_reservation prima per ottenere l'eventId.
Verifica disponibilità del nuovo slot con check_availability prima di modificare.`,
    parameters: {
      type: 'object',
      properties: {
        eventId: {
          type: 'string',
          description: 'ID della prenotazione da modificare'
        },
        newDate: {
          type: 'string',
          description: 'Nuova data (YYYY-MM-DD) - opzionale'
        },
        newTime: {
          type: 'string',
          description: 'Nuovo orario (HH:MM) - opzionale'
        },
        newPeople: {
          type: 'integer',
          description: 'Nuovo numero persone - opzionale'
        }
      },
      required: ['eventId']
    },
    handler: async (args, context) => {
      const { eventId, newDate, newTime, newPeople } = args;
      const { restaurantConfig } = context;
      const timezone = restaurantConfig?.timezone || 'Europe/Rome';
      
      console.log(`✏️ Modifica prenotazione: ${eventId}`);
      
      // FIX v1.1.0: Valida nuova data se fornita
      if (newDate && isDateInPast(newDate, timezone)) {
        return {
          success: false,
          reason: 'date_in_past',
          message: `La data ${newDate} è nel passato. Per quale giorno vuole spostare?`
        };
      }
      
      try {
        const appsScriptUrl = getAppsScriptUrl(restaurantConfig);
        if (!appsScriptUrl) {
          return { success: false, message: 'Errore di configurazione.' };
        }
        
        console.log(`📡 Calling Apps Script: ${appsScriptUrl}`);
        const response = await fetch(appsScriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'modify_reservation',
            eventId,
            nuovaData: newDate,      // FIX v1.0.2: parametro italiano
            nuovaOra: newTime,       // FIX v1.0.2: parametro italiano
            nuovePersone: newPeople, // FIX v1.0.2: parametro italiano
            calendarId: restaurantConfig.calendar_id
          })
        });
        
        const result = await response.json();
        
        if (result.success) {
          const changes = [];
          if (newDate) changes.push(`data: ${formatDateForSpeech(newDate)}`);
          if (newTime) changes.push(`orario: ${newTime.substring(0, 5)}`);
          if (newPeople) changes.push(`persone: ${newPeople}`);
          
          return {
            success: true,
            message: `Prenotazione modificata. Nuovi dettagli: ${changes.join(', ')}.`
          };
        } else if (result.reason === 'slot_full') {
          return {
            success: false,
            reason: 'slot_full',
            message: 'Il nuovo orario non è disponibile. Posso proporre alternative?',
            alternatives: result.alternatives || []
          };
        } else {
          return {
            success: false,
            message: result.message || 'Non ho potuto modificare la prenotazione.'
          };
        }
      } catch (error) {
        console.error('❌ Errore modify_reservation:', error);
        return {
          success: false,
          message: 'Errore nella modifica. Riprova.'
        };
      }
    }
  },
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // TOOL 5: CANCEL RESERVATION
  // ═══════════════════════════════════════════════════════════════════════════════
  {
    name: 'cancel_reservation',
    description: `Cancella una prenotazione esistente.
Usa find_reservation prima per ottenere l'eventId.
Chiedi SEMPRE conferma al cliente prima di cancellare.`,
    parameters: {
      type: 'object',
      properties: {
        eventId: {
          type: 'string',
          description: 'ID della prenotazione da cancellare'
        }
      },
      required: ['eventId']
    },
    handler: async (args, context) => {
      const { eventId } = args;
      const { restaurantConfig } = context;
      
      console.log(`🗑️ Cancellazione prenotazione: ${eventId}`);
      
      try {
        const appsScriptUrl = getAppsScriptUrl(restaurantConfig);
        if (!appsScriptUrl) {
          return { success: false, message: 'Errore di configurazione.' };
        }
        
        console.log(`📡 Calling Apps Script: ${appsScriptUrl}`);
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
          return {
            success: true,
            message: 'Prenotazione cancellata. Speriamo di rivederti presto!'
          };
        } else {
          return {
            success: false,
            message: result.message || 'Non ho potuto cancellare la prenotazione.'
          };
        }
      } catch (error) {
        console.error('❌ Errore cancel_reservation:', error);
        return {
          success: false,
          message: 'Errore nella cancellazione. Riprova.'
        };
      }
    }
  }
];

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

function getDayName(dayIndex, italian = true) {
  const names = italian
    ? ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato']
    : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return names[dayIndex];
}

function formatDateForSpeech(dateStr) {
  if (!dateStr) return 'data non specificata';
  const date = new Date(dateStr + 'T12:00:00');
  const day = date.getDate();
  const month = date.toLocaleDateString('it-IT', { month: 'long' });
  return `${day} ${month}`;
}

export default realtimeTools;
