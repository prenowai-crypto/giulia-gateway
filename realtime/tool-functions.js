// ═══════════════════════════════════════════════════════════════════════════════
// PRENOW - TOOL FUNCTIONS v1.0.0
// Espone la business logic esistente come tool functions per OpenAI Realtime
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Definizione delle tool functions per OpenAI Realtime
 * Ogni tool ha: name, description, parameters (JSON Schema), handler (funzione)
 */
export const realtimeTools = [
  
  // ═══════════════════════════════════════════════════════════════════════════
  // TOOL 1: CHECK AVAILABILITY
  // ═══════════════════════════════════════════════════════════════════════════
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
      
      console.log(`🔍 Check availability: ${date} ${time} per ${people} persone`);
      
      // 1. Verifica giorno chiusura
      const dayOfWeek = new Date(date).getDay();
      
      // Chiusura totale
      if (restaurantConfig.weekly_closing_days?.includes(dayOfWeek)) {
        const dayName = getDayName(dayOfWeek, true);
        return {
          available: false,
          reason: 'closed_day',
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
      const dinnerStart = restaurantConfig.dinner_start || '19:00';
      const dinnerEnd = restaurantConfig.dinner_end || '22:30';
      
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
        const response = await fetch(restaurantConfig.apps_script_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'check_availability',
            date,
            time,
            people,
            calendarId: restaurantConfig.calendar_id
          })
        });
        
        const result = await response.json();
        
        if (result.available) {
          return {
            available: true,
            message: 'Lo slot è disponibile.'
          };
        } else {
          return {
            available: false,
            reason: 'slot_full',
            message: 'Mi dispiace, questo orario è al completo.',
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
  
  // ═══════════════════════════════════════════════════════════════════════════
  // TOOL 2: CREATE RESERVATION
  // ═══════════════════════════════════════════════════════════════════════════
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
      
      console.log(`📝 Creazione prenotazione: ${name}, ${people} pax, ${date} ${time}`);
      
      // Determina stato iniziale
      let status = 'CONFIRMED';
      if (people > 10) {
        status = 'PENDING_OWNER';
      }
      
      try {
        const response = await fetch(restaurantConfig.apps_script_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'create_reservation',
            name,
            people,
            date,
            time,
            phone,
            notes: notes || '',
            status,
            calendarId: restaurantConfig.calendar_id,
            source: 'realtime_api',
            callSid
          })
        });
        
        const result = await response.json();
        
        if (result.success) {
          if (status === 'PENDING_OWNER') {
            return {
              success: true,
              status: 'PENDING_OWNER',
              message: `Ho registrato la richiesta per ${people} persone a nome ${name}. Essendo un gruppo numeroso, il ristoratore confermerà la prenotazione e ti ricontatterà al numero ${phone}.`
            };
          }
          
          return {
            success: true,
            status: 'CONFIRMED',
            eventId: result.eventId,
            message: `Perfetto! Prenotazione confermata per ${people} persone a nome ${name}, ${formatDateForSpeech(date)} alle ${time.substring(0, 5)}. Ti aspettiamo!`
          };
        } else if (result.reason === 'slot_full') {
          return {
            success: false,
            reason: 'slot_full',
            message: 'Mi dispiace, nel frattempo lo slot si è riempito. Posso proporre un altro orario?',
            alternatives: result.alternatives || []
          };
        } else {
          return {
            success: false,
            reason: result.reason || 'unknown',
            message: 'Si è verificato un problema. Puoi riprovare?'
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
  
  // ═══════════════════════════════════════════════════════════════════════════
  // TOOL 3: FIND RESERVATION
  // ═══════════════════════════════════════════════════════════════════════════
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
        const response = await fetch(restaurantConfig.apps_script_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'find_reservation',
            name,
            phone: phone || '',
            calendarId: restaurantConfig.calendar_id
          })
        });
        
        const result = await response.json();
        
        if (result.found && result.reservations?.length > 0) {
          const reservations = result.reservations.map(r => ({
            eventId: r.eventId,
            date: r.date,
            time: r.time,
            people: r.people,
            name: r.name,
            displayText: `${formatDateForSpeech(r.date)} alle ${r.time.substring(0, 5)} per ${r.people} persone`
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
  
  // ═══════════════════════════════════════════════════════════════════════════
  // TOOL 4: MODIFY RESERVATION
  // ═══════════════════════════════════════════════════════════════════════════
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
      
      console.log(`✏️ Modifica prenotazione: ${eventId}`);
      
      try {
        const response = await fetch(restaurantConfig.apps_script_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'modify_reservation',
            eventId,
            newDate,
            newTime,
            newPeople,
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
            message: 'Non ho potuto modificare la prenotazione.'
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
  
  // ═══════════════════════════════════════════════════════════════════════════
  // TOOL 5: CANCEL RESERVATION
  // ═══════════════════════════════════════════════════════════════════════════
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
        const response = await fetch(restaurantConfig.apps_script_url, {
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
            message: 'Non ho potuto cancellare la prenotazione.'
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
  const date = new Date(dateStr);
  const day = date.getDate();
  const month = date.toLocaleDateString('it-IT', { month: 'long' });
  return `${day} ${month}`;
}

export default realtimeTools;
