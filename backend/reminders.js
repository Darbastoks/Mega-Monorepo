const cron = require('node-cron');

// Lazy-load to avoid circular deps — set in start()
let portalAll, portalGet;
let salonDbs = {};
let resendClient = null;
let twilioClient = null;
let twilioFrom = '';

function initResend() {
    if (!process.env.RESEND_API_KEY) {
        console.warn('[reminders] RESEND_API_KEY not set — email reminders disabled');
        return;
    }
    const { Resend } = require('resend');
    resendClient = new Resend(process.env.RESEND_API_KEY);
}

function initTwilio() {
    if (!process.env.TWILIO_SID || !process.env.TWILIO_AUTH_TOKEN) {
        console.warn('[reminders] Twilio credentials not set — SMS reminders disabled');
        return;
    }
    twilioClient = require('twilio')(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);
    twilioFrom = process.env.TWILIO_FROM || '';
}

// Helper: query salon SQLite db (callback-based → promise)
function dbAll(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []));
    });
}

function dbRun(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) { err ? reject(err) : resolve(this); });
    });
}

// Get Lithuanian time now
function nowLT() {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Vilnius' }));
}

// Find bookings in a time window for a given salon
async function getUpcomingBookings(salonSlug, hoursAhead, reminderField) {
    const salon = salonDbs[salonSlug];
    if (!salon) return [];

    const now = nowLT();
    const target = new Date(now.getTime() + hoursAhead * 60 * 60 * 1000);

    // Window: target ± 30 minutes
    const windowStart = new Date(target.getTime() - 30 * 60 * 1000);
    const windowEnd = new Date(target.getTime() + 30 * 60 * 1000);

    const dateStr = target.toISOString().split('T')[0]; // YYYY-MM-DD

    const table = salon.tableName;
    try {
        const bookings = await dbAll(salon.db,
            `SELECT * FROM ${table} WHERE date = ? AND ${reminderField} = 0 AND status != 'cancelled'`,
            [dateStr]
        );

        // Filter by time window
        return bookings.filter(b => {
            if (!b.time) return false;
            const [h, m] = b.time.split(':').map(Number);
            const bookingTime = new Date(target);
            bookingTime.setHours(h, m, 0, 0);
            return bookingTime >= windowStart && bookingTime <= windowEnd;
        });
    } catch (err) {
        console.error(`[reminders] Error querying ${salonSlug}:`, err.message);
        return [];
    }
}

// Send email reminder
async function sendEmailReminder(booking, salonName, hoursAhead) {
    if (!resendClient || !booking.email) return false;

    const isNextDay = hoursAhead === 24;
    const subject = isNextDay
        ? `Priminimas: Jūsų vizitas rytoj ${booking.time}`
        : `Priminimas: Jūsų vizitas po 2 val. (${booking.time})`;

    const timeText = isNextDay ? 'rytoj' : 'šiandien';

    const html = `
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0a0e17;font-family:'Helvetica Neue',Arial,sans-serif;">
<div style="max-width:520px;margin:40px auto;background:#111827;border-radius:16px;border:1px solid rgba(255,255,255,0.06);padding:40px;color:#f8fafc;">
  <div style="text-align:center;margin-bottom:24px;">
    <div style="width:48px;height:48px;border-radius:50%;background:linear-gradient(135deg,#22d3ee,#06b6d4);display:inline-flex;align-items:center;justify-content:center;font-size:1.2rem;color:#fff;">⏰</div>
  </div>
  <h1 style="text-align:center;font-size:1.3rem;margin:0 0 8px;color:#f8fafc;">Vizito priminimas</h1>
  <p style="text-align:center;color:rgba(248,250,252,0.55);font-size:0.9rem;margin:0 0 24px;">Primename apie Jūsų artėjantį vizitą</p>
  <div style="background:rgba(34,211,238,0.06);border:1px solid rgba(34,211,238,0.15);border-radius:12px;padding:20px;margin-bottom:24px;">
    <table style="width:100%;color:#f8fafc;font-size:0.95rem;" cellpadding="6">
      <tr><td style="color:rgba(248,250,252,0.5);width:100px;">Salonas</td><td style="font-weight:600;">${escapeHtml(salonName)}</td></tr>
      <tr><td style="color:rgba(248,250,252,0.5);">Paslauga</td><td>${escapeHtml(booking.service)}</td></tr>
      <tr><td style="color:rgba(248,250,252,0.5);">Data</td><td>${escapeHtml(booking.date)} (${timeText})</td></tr>
      <tr><td style="color:rgba(248,250,252,0.5);">Laikas</td><td style="font-weight:600;color:#22d3ee;">${escapeHtml(booking.time)}</td></tr>
    </table>
  </div>
  <p style="text-align:center;color:rgba(248,250,252,0.4);font-size:0.8rem;margin:24px 0 0;">Jei norite atšaukti ar pakeisti vizitą, susisiekite su salonu tiesiogiai.</p>
</div>
</body></html>`;

    try {
        await resendClient.emails.send({
            from: 'Velora Studio <info@velorastudio.lt>',
            to: booking.email,
            subject,
            html,
        });
        console.log(`[reminders] Email sent to ${booking.email} for ${salonName} at ${booking.date} ${booking.time}`);
        return true;
    } catch (err) {
        console.error(`[reminders] Email failed for ${booking.email}:`, err.message);
        return false;
    }
}

// Send SMS reminder
async function sendSmsReminder(booking, salonName, hoursAhead) {
    if (!twilioClient || !twilioFrom || !booking.phone) return false;

    const phone = booking.phone.trim();
    // Ensure Lithuanian format
    const formattedPhone = phone.startsWith('+') ? phone : '+370' + phone.replace(/^8/, '');

    const isNextDay = hoursAhead === 24;
    const timeText = isNextDay ? 'rytoj' : 'šiandien';
    const body = `Priminimas: Jūsų vizitas "${booking.service}" salone ${salonName} — ${timeText} ${booking.time}. Jei norite atšaukti, susisiekite su salonu.`;

    try {
        await twilioClient.messages.create({
            body,
            from: twilioFrom,
            to: formattedPhone,
        });
        console.log(`[reminders] SMS sent to ${formattedPhone} for ${salonName} at ${booking.date} ${booking.time}`);
        return true;
    } catch (err) {
        console.error(`[reminders] SMS failed for ${formattedPhone}:`, err.message);
        return false;
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Main reminder check
async function checkAndSendReminders(hoursAhead) {
    const reminderField = hoursAhead === 24 ? 'reminder_24h_sent' : 'reminder_2h_sent';

    try {
        // Get all salons with active reminders
        const clients = await portalAll(
            'SELECT salon_slug, salon_name, email_reminders_active, sms_reminders_active FROM clients WHERE (email_reminders_active = 1 OR sms_reminders_active = 1) AND salon_slug != ""'
        );

        for (const client of clients) {
            const bookings = await getUpcomingBookings(client.salon_slug, hoursAhead, reminderField);

            for (const booking of bookings) {
                let sent = false;

                if (client.email_reminders_active && booking.email) {
                    const emailSent = await sendEmailReminder(booking, client.salon_name || client.salon_slug, hoursAhead);
                    if (emailSent) sent = true;
                }

                if (client.sms_reminders_active && booking.phone) {
                    const smsSent = await sendSmsReminder(booking, client.salon_name || client.salon_slug, hoursAhead);
                    if (smsSent) sent = true;
                }

                if (sent) {
                    const table = salonDbs[client.salon_slug]?.tableName || 'bookings';
                    await dbRun(salonDbs[client.salon_slug].db,
                        `UPDATE ${table} SET ${reminderField} = 1 WHERE id = ?`,
                        [booking.id]
                    );
                }
            }
        }
    } catch (err) {
        console.error(`[reminders] Check failed (${hoursAhead}h):`, err.message);
    }
}

// Manual trigger for testing
async function triggerReminders(hoursAhead) {
    console.log(`[reminders] Manual trigger: ${hoursAhead}h reminders`);
    await checkAndSendReminders(hoursAhead);
}

function start(deps) {
    const { portalAll: pAll, portalGet: pGet, dbBarbie, dbHair, dbNails } = deps;
    portalAll = pAll;
    portalGet = pGet;

    salonDbs = {
        barbie: { db: dbBarbie, tableName: 'bookings' },
        hair:   { db: dbHair,   tableName: 'bookings' },
        nails:  { db: dbNails,  tableName: 'reservations' },
    };

    initResend();
    initTwilio();

    // Every hour at :05 — 24h-ahead reminders
    cron.schedule('5 * * * *', () => {
        console.log('[reminders] Running 24h check...');
        checkAndSendReminders(24);
    }, { timezone: 'Europe/Vilnius' });

    // Every 30 min at :05 and :35 — 2h-ahead reminders
    cron.schedule('5,35 * * * *', () => {
        console.log('[reminders] Running 2h check...');
        checkAndSendReminders(2);
    }, { timezone: 'Europe/Vilnius' });

    console.log('[reminders] Cron jobs started (24h at :05, 2h at :05/:35)');
}

module.exports = { start, triggerReminders };
