// ═══════════════════════════════════════════════════════════════════════════════
// PRENOW - TOOL FUNCTIONS v1.1.0
// ═══════════════════════════════════════════════════════════════════════════════

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

function isValidName(name) {
  if (!name) return false;
  const invalidNames = ['cliente', 'client', 'nome', 'name', 'unknown', 'sconosciuto', ''];
  return !invalidNames.includes(name.toLowerCase().trim());
}

function isValidPhone(phone) {
  if (!phone) return false;
  const cleaned = phone.replace(/[\s\-\+\(\)]/g, '');
  return /^\d{6,15}$/.test(cleaned);
}

export const realtimeTools = [
  {
    name: 'check_availability',
    description: `Verifica se un determinato slot (data + orario) è disponibile per un certo numero di persone.`,
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
      
      console.log(`🔍 Check availability: ${date} ${time} per ${people} persone`);
      
      if (isDateInPast(date, timezone)) {
        const today = getTodayISO(timezone);
        return { available: false, reason: 'date_in_past', message: `La data ${date} è nel passato. Oggi è ${today}.` };
      }
      
      const dayOfWeek = new Date(date + 'T12:00:00').getDay();
      
      if (restaurantConfig.weekly_closing_days?.includes(dayOfWeek)) {
        const dayName = getDayName(dayOfWeek, true);
        return { available: false, reason: 'day_closed', message: `Il ristorante è chiuso il ${dayName}.` };
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
        if (!appsScriptUrl) {
          return { available: true, message: 'Procedo con la prenotazione.' };
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
          return { available: true, message: 'Lo slot è disponibile.' };
        } else {
          return { available: false, reason: result.reason || 'slot_full', message: result.message || 'Orario al completo.' };
        }
      } catch (error) {
        console.error('❌ Errore check_availability:', error);
        return { available: true, message: 'Procedo con la prenotazione.' };
      }
    }
  },
  
  {
    name: 'create_reservation',
    description: `Crea una nuova prenotazione. Richiede: nome, persone, data, orario, telefono.`,
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Nome del cliente' },
        people: { type: 'integer', description: 'Numero di persone' },
        date: { type: 'string', description: 'Data in formato YYYY-MM-DD' },
        time: { type: 'string', description: 'Orario in formato HH:MM' },
        phone: { type: 'string', description: 'Numero di telefono' },
        notes: { type: 'string', description: 'Note aggiuntive' }
      },
      required: ['name', 'people', 'date', 'time', 'phone']
    },
    handler: async (args, context) => {
      const { name, people, date, time, phone, notes } = args;
      const { callSid, restaurantConfig } = context;
      const timezone = restaurantConfig?.timezone || 'Europe/Rome';
      
      console.log(`📝 Creazione: ${name}, ${people} pax, ${date} ${time}, tel: ${phone}`);
      
      if (!isValidName(name)) {
        return { success: false, reason: 'invalid_name', message: 'Mi può dire il suo nome per favore?' };
      }
      
      if (!isValidPhone(phone)) {
        return { success: false, reason: 'invalid_phone', message: 'Mi può dettare il suo numero di telefono?' };
      }
      
      if (isDateInPast(date, timezone)) {
        return { success: false, reason: 'date_in_past', message: 'La data è nel passato.' };
      }
      
      const largeGroupThreshold = restaurantConfig?.large_group_threshold || 10;
      let status = people > largeGroupThreshold ? 'PENDING_OWNER' : 'CONFIRMED';
      
      try {
        const appsScriptUrl = getAppsScriptUrl(restaurantConfig);
        if (!appsScriptUrl) {
          return { success: false, message: 'Errore di configurazione.' };
        }
        
        const response = await fetch(appsScriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'create_reservation',
            nome: name, persone: people, data: date, ora: time, telefono: phone,
            notes: notes || '', status, forceNew: true,
            calendarId: restaurantConfig.calendar_id, source: 'realtime_api', callSid
          })
        });
        
        const result = await response.json();
        
        if (result.success) {
          if (status === 'PENDING_OWNER') {
            return { success: true, status: 'PENDING_OWNER', message: `Richiesta registrata per ${people} persone a nome ${name}. Il ristoratore confermerà.` };
          }
          return { success: true, status: 'CONFIRMED', message: `Prenotazione confermata per ${people} persone a nome ${name}, ${formatDateForSpeech(date)} alle ${time.substring(0,5)}. Ti aspettiamo!` };
        } else {
          return { success: false, reason: result.reason || 'unknown', message: result.message || 'Errore nella prenotazione.' };
        }
      } catch (error) {
        console.error('❌ Errore create_reservation:', error);
        return { success: false, message: 'Errore tecnico. Riprova.' };
      }
    }
  },
  
  {
    name: 'find_reservation',
    description: `Cerca una prenotazione esistente per nome.`,
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Nome del cliente' },
        phone: { type: 'string', description: 'Telefono (opzionale)' }
      },
      required: ['name']
    },
    handler: async (args, context) => {
      const { name, phone } = args;
      const { restaurantConfig } = context;
      
      console.log(`🔍 Ricerca prenotazione: ${name}`);
      
      try {
        const appsScriptUrl = getAppsScriptUrl(restaurantConfig);
        if (!appsScriptUrl) return { found: false, message: 'Errore di configurazione.' };
        
        const response = await fetch(appsScriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'find_reservation', nome: name, telefono: phone || '',
            calendarId: restaurantConfig.calendar_id
          })
        });
        
        const result = await response.json();
        
        if (result.found && result.reservations?.length > 0) {
          const reservations = result.reservations.map(r => ({
            eventId: r.eventId, date: r.date || r.data, time: r.time || r.ora,
            people: r.people || r.persone, name: r.name || r.nome,
            displayText: `${formatDateForSpeech(r.date || r.data)} alle ${(r.time || r.ora).substring(0,5)} per ${r.people || r.persone} persone`
          }));
          return { found: true, count: reservations.length, reservations, message: `Ho trovato ${reservations.length} prenotazione/i.` };
        }
        return { found: false, message: `Non ho trovato prenotazioni a nome ${name}.` };
      } catch (error) {
        console.error('❌ Errore find_reservation:', error);
        return { found: false, message: 'Errore nella ricerca.' };
      }
    }
  },
  
  {
    name: 'modify_reservation',
    description: `Modifica una prenotazione esistente.`,
    parameters: {
      type: 'object',
      properties: {
        eventId: { type: 'string', description: 'ID della prenotazione' },
        newDate: { type: 'string', description: 'Nuova data YYYY-MM-DD' },
        newTime: { type: 'string', description: 'Nuovo orario HH:MM' },
        newPeople: { type: 'integer', description: 'Nuovo numero persone' }
      },
      required: ['eventId']
    },
    handler: async (args, context) => {
      const { eventId, newDate, newTime, newPeople } = args;
      const { restaurantConfig } = context;
      
      console.log(`✏️ Modifica prenotazione: ${eventId}`);
      
      try {
        const appsScriptUrl = getAppsScriptUrl(restaurantConfig);
        if (!appsScriptUrl) return { success: false, message: 'Errore di configurazione.' };
        
        const response = await fetch(appsScriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'modify_reservation', eventId,
            nuovaData: newDate, nuovaOra: newTime, nuovePersone: newPeople,
            calendarId: restaurantConfig.calendar_id
          })
        });
        
        const result = await response.json();
        
        if (result.success) {
          return { success: true, message: 'Prenotazione modificata.' };
        }
        return { success: false, message: result.message || 'Non ho potuto modificare.' };
      } catch (error) {
        console.error('❌ Errore modify_reservation:', error);
        return { success: false, message: 'Errore nella modifica.' };
      }
    }
  },
  
  {
    name: 'cancel_reservation',
    description: `Cancella una prenotazione esistente.`,
    parameters: {
      type: 'object',
      properties: {
        eventId: { type: 'string', description: 'ID della prenotazione' }
      },
      required: ['eventId']
    },
    handler: async (args, context) => {
      const { eventId } = args;
      const { restaurantConfig } = context;
      
      console.log(`🗑️ Cancellazione: ${eventId}`);
      
      try {
        const appsScriptUrl = getAppsScriptUrl(restaurantConfig);
        if (!appsScriptUrl) return { success: false, message: 'Errore di configurazione.' };
        
        const response = await fetch(appsScriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'cancel_reservation', eventId,
            calendarId: restaurantConfig.calendar_id
          })
        });
        
        const result = await response.json();
        
        if (result.success) {
          return { success: true, message: 'Prenotazione cancellata.' };
        }
        return { success: false, message: result.message || 'Non ho potuto cancellare.' };
      } catch (error) {
        console.error('❌ Errore cancel_reservation:', error);
        return { success: false, message: 'Errore nella cancellazione.' };
      }
    }
  }
];

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
