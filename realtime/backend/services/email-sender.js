// ═══════════════════════════════════════════════════════════════════════════════
// services/email-sender.js
// ═══════════════════════════════════════════════════════════════════════════════
// Wrapper Resend per invio email transazionali.
//
// v7.7.33 (2026-09-16): fix email evento (blocker per feature evento in produzione)
//   PRIMA: requestBigEvent() inseriva job in sync_jobs con 'email_owner_notify'
//   ma nessun worker processava la coda → email mai inviata → ristoratore non
//   sapeva della richiesta evento → cliente arrivava e non era atteso.
//   ORA: Approccio A (fire-and-forget inline): dopo commit reservation,
//   requestBigEvent chiama sendOwnerEventEmail() SENZA aspettare risposta.
//   Se l'invio fallisce, log console + email_status='FAILED' in DB, ma NON
//   blocca la risposta al cliente in chiamata.
//
// Servizio: Resend (https://resend.com) - 3000 email/mese gratis, setup 5 min
//
// Env variables richieste:
//   RESEND_API_KEY=re_xxxxxxxx        (obbligatoria, altrimenti no email)
//   RESEND_FROM=onboarding@resend.dev (opzionale, default = onboarding@resend.dev
//                                     per test senza verifica dominio)
//   RESEND_REPLY_TO=noreply@...       (opzionale, default = no reply-to header)
//
// Comportamento senza RESEND_API_KEY: log warning + skip (non crash)
// ═══════════════════════════════════════════════════════════════════════════════

const RESEND_API_URL = 'https://api.resend.com/emails';
const RESEND_API_KEY = process.env.RESEND_API_KEY || null;
const RESEND_FROM    = process.env.RESEND_FROM || 'Prenow <onboarding@resend.dev>';
const RESEND_REPLY_TO = process.env.RESEND_REPLY_TO || null;

// ─── Utility: format date + time in italiano naturale ─────────────────────────

function formatDateItalian(dateInput, timezone = 'Europe/Rome') {
  let d;
  if (dateInput instanceof Date) {
    const iso = dateInput.toISOString().substring(0, 10);
    d = new Date(`${iso}T12:00:00Z`);
  } else if (typeof dateInput === 'string' && dateInput.match(/^\d{4}-\d{2}-\d{2}/)) {
    d = new Date(`${dateInput.substring(0, 10)}T12:00:00Z`);
  } else {
    d = new Date(dateInput);
  }
  if (isNaN(d.getTime())) return String(dateInput);
  return new Intl.DateTimeFormat('it-IT', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: timezone,
  }).format(d);
}

function formatTimeShort(timeInput) {
  if (!timeInput) return '';
  if (timeInput instanceof Date) {
    const h = String(timeInput.getUTCHours()).padStart(2, '0');
    const m = String(timeInput.getUTCMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }
  return String(timeInput).substring(0, 5);
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ─── Template email: richiesta evento al proprietario ─────────────────────────

function renderOwnerEventEmail(eventData) {
  const {
    restaurantName = 'Il tuo ristorante',
    customerName,
    customerPhone,
    customerEmail,
    date,
    time,
    people,
    notes,
    timezone = 'Europe/Rome',
  } = eventData;

  const dateFormatted = formatDateItalian(date, timezone);
  const timeFormatted = formatTimeShort(time);
  const phoneLink = customerPhone ? `tel:${customerPhone.replace(/\s/g, '')}` : null;

  // Plain text fallback (per client email che non renderano HTML)
  const textBody = [
    `Nuova richiesta evento per ${restaurantName}`,
    '',
    `Cliente: ${customerName}`,
    customerPhone ? `Telefono: ${customerPhone}` : null,
    customerEmail ? `Email: ${customerEmail}` : null,
    `Data: ${dateFormatted}`,
    `Ora: ${timeFormatted}`,
    `Persone: ${people}`,
    notes ? `Note: ${notes}` : null,
    '',
    'Contatta il cliente per confermare la disponibilità e i dettagli.',
    '',
    '— Prenow AI Receptionist',
  ].filter(Boolean).join('\n');

  // HTML template — professionale, semplice, mobile-friendly
  const htmlBody = `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Nuova richiesta evento</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#18181b;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f4f5;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:#18181b;padding:24px 32px;">
              <div style="color:#a1a1aa;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">Nuova richiesta ricevuta</div>
              <div style="color:#ffffff;font-size:22px;font-weight:600;line-height:1.3;">Richiesta evento &mdash; ${escapeHtml(restaurantName)}</div>
            </td>
          </tr>

          <!-- Alert box -->
          <tr>
            <td style="padding:24px 32px 8px;">
              <div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:12px 16px;border-radius:6px;font-size:14px;color:#78350f;">
                <strong>Azione richiesta:</strong> contatta il cliente per confermare la disponibilit&agrave; e i dettagli.
              </div>
            </td>
          </tr>

          <!-- Dettagli -->
          <tr>
            <td style="padding:16px 32px 24px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">

                <tr>
                  <td style="padding:12px 0;border-bottom:1px solid #e4e4e7;">
                    <div style="color:#71717a;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">Cliente</div>
                    <div style="color:#18181b;font-size:18px;font-weight:600;">${escapeHtml(customerName)}</div>
                  </td>
                </tr>

                ${customerPhone ? `
                <tr>
                  <td style="padding:12px 0;border-bottom:1px solid #e4e4e7;">
                    <div style="color:#71717a;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">Telefono</div>
                    <div style="color:#18181b;font-size:16px;">
                      <a href="${escapeHtml(phoneLink)}" style="color:#2563eb;text-decoration:none;font-weight:500;">${escapeHtml(customerPhone)}</a>
                    </div>
                  </td>
                </tr>
                ` : ''}

                ${customerEmail ? `
                <tr>
                  <td style="padding:12px 0;border-bottom:1px solid #e4e4e7;">
                    <div style="color:#71717a;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">Email</div>
                    <div style="color:#18181b;font-size:16px;">
                      <a href="mailto:${escapeHtml(customerEmail)}" style="color:#2563eb;text-decoration:none;">${escapeHtml(customerEmail)}</a>
                    </div>
                  </td>
                </tr>
                ` : ''}

                <tr>
                  <td style="padding:12px 0;border-bottom:1px solid #e4e4e7;">
                    <div style="color:#71717a;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">Data e ora</div>
                    <div style="color:#18181b;font-size:16px;text-transform:capitalize;">${escapeHtml(dateFormatted)}, ore ${escapeHtml(timeFormatted)}</div>
                  </td>
                </tr>

                <tr>
                  <td style="padding:12px 0;border-bottom:1px solid #e4e4e7;">
                    <div style="color:#71717a;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">Numero persone</div>
                    <div style="color:#18181b;font-size:22px;font-weight:600;">${escapeHtml(String(people))}</div>
                  </td>
                </tr>

                ${notes ? `
                <tr>
                  <td style="padding:12px 0;">
                    <div style="color:#71717a;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">Note del cliente</div>
                    <div style="color:#18181b;font-size:15px;line-height:1.5;background:#fafafa;padding:10px 12px;border-radius:6px;">${escapeHtml(notes)}</div>
                  </td>
                </tr>
                ` : ''}

              </table>
            </td>
          </tr>

          ${phoneLink ? `
          <!-- CTA button -->
          <tr>
            <td style="padding:0 32px 32px;">
              <a href="${escapeHtml(phoneLink)}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:15px;font-weight:500;">
                Chiama il cliente
              </a>
            </td>
          </tr>
          ` : ''}

          <!-- Footer -->
          <tr>
            <td style="background:#fafafa;padding:16px 32px;border-top:1px solid #e4e4e7;">
              <div style="color:#71717a;font-size:12px;line-height:1.5;">
                Questa email &egrave; stata generata automaticamente dalla richiesta di un cliente ricevuta tramite Prenow AI Receptionist. La richiesta &egrave; in stato <strong>PENDING</strong> e non blocca posti in sala fino alla tua conferma.
              </div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return {
    subject: `Nuova richiesta evento — ${people} persone il ${dateFormatted}`,
    text: textBody,
    html: htmlBody,
  };
}

// ─── Invio: sendOwnerEventEmail (fire-and-forget) ─────────────────────────────

/**
 * Invia email al proprietario del ristorante per notificare una richiesta evento.
 *
 * Fire-and-forget: non blocca la risposta al cliente in chiamata. Se l'invio
 * fallisce, log warning e ritorna false. Se ha successo ritorna true.
 *
 * @param {string} to - email destinatario (proprietario)
 * @param {object} eventData - dati evento
 * @returns {Promise<boolean>} - true se inviata, false se skipped o fallita
 */
export async function sendOwnerEventEmail(to, eventData) {
  if (!RESEND_API_KEY) {
    console.warn('[email-sender] RESEND_API_KEY not set — skipping email send. Job stays in sync_jobs queue.');
    return false;
  }

  if (!to || typeof to !== 'string' || !to.includes('@')) {
    console.warn('[email-sender] Invalid or missing owner email:', to);
    return false;
  }

  const { subject, text, html } = renderOwnerEventEmail(eventData);

  const payload = {
    from: RESEND_FROM,
    to: [to],
    subject,
    text,
    html,
  };
  if (RESEND_REPLY_TO) payload.reply_to = RESEND_REPLY_TO;

  try {
    const response = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '<no-body>');
      console.error(`[email-sender] Resend API error ${response.status}: ${errorBody}`);
      return false;
    }

    const result = await response.json();
    console.log(`[email-sender] ✓ Email inviata a ${to} — Resend id: ${result.id || '?'}`);
    return true;
  } catch (err) {
    console.error(`[email-sender] Fetch error inviando email a ${to}:`, err?.message || err);
    return false;
  }
}
