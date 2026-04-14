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

function nowLT() {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Vilnius' }));
}

// Default Lithuanian templates
const DEFAULT_EMAIL_SUBJECT_24H = 'Priminimas: Jūsų vizitas rytoj {laikas}';
const DEFAULT_EMAIL_SUBJECT_2H = 'Priminimas: Jūsų vizitas po 2 val. ({laikas})';
const DEFAULT_EMAIL_BODY = 'Sveiki, {klientas}!\n\nPrimename apie Jūsų vizitą salone {salonas}.\n\nPaslauga: {paslauga}\nData: {data}\nLaikas: {laikas}\n\nJei norite atšaukti ar pakeisti vizitą, susisiekite su salonu tiesiogiai.';
const DEFAULT_SMS_BODY = 'Priminimas: vizitas "{paslauga}" salone {salonas} — {data} {laikas}. Jei norite atšaukti, susisiekite.';

function applyPlaceholders(template, vars) {
    if (!template) return '';
    return template
        .replace(/\{salonas\}/g, vars.salonas || '')
        .replace(/\{paslauga\}/g, vars.paslauga || '')
        .replace(/\{data\}/g, vars.data || '')
        .replace(/\{laikas\}/g, vars.laikas || '')
        .replace(/\{klientas\}/g, vars.klientas || '');
}

async function getSalonClient(salonSlug) {
    if (!portalGet) return null;
    return await portalGet(
        'SELECT salon_slug, salon_name, email_reminders_active, sms_reminders_active, reminder_email_subject, reminder_email_body, reminder_sms_body, reminder_hours_before FROM clients WHERE salon_slug = ?',
        [salonSlug]
    );
}

async function getUpcomingBookings(salonSlug, hoursAhead, reminderField) {
    const salon = salonDbs[salonSlug];
    if (!salon) return [];

    const now = nowLT();
    const target = new Date(now.getTime() + hoursAhead * 60 * 60 * 1000);

    const windowStart = new Date(target.getTime() - 30 * 60 * 1000);
    const windowEnd = new Date(target.getTime() + 30 * 60 * 1000);

    const dateStr = target.toISOString().split('T')[0];
    const table = salon.tableName;

    try {
        const bookings = await dbAll(salon.db,
            `SELECT * FROM ${table} WHERE date = ? AND ${reminderField} = 0 AND status != 'cancelled'`,
            [dateStr]
        );
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

function buildEmailHtml(bodyText, salonName, vars) {
    const rendered = escapeHtml(applyPlaceholders(bodyText, vars)).replace(/\n/g, '<br>');
    return `
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0a0e17;font-family:'Helvetica Neue',Arial,sans-serif;">
<div style="max-width:520px;margin:40px auto;background:#111827;border-radius:16px;border:1px solid rgba(255,255,255,0.06);padding:40px;color:#f8fafc;">
  <div style="text-align:center;margin-bottom:24px;">
    <div style="width:48px;height:48px;border-radius:50%;background:linear-gradient(135deg,#22d3ee,#06b6d4);display:inline-flex;align-items:center;justify-content:center;font-size:1.2rem;color:#fff;">⏰</div>
  </div>
  <h1 style="text-align:center;font-size:1.3rem;margin:0 0 8px;color:#f8fafc;">${escapeHtml(salonName)}</h1>
  <div style="background:rgba(34,211,238,0.06);border:1px solid rgba(34,211,238,0.15);border-radius:12px;padding:20px;margin:24px 0;color:#f8fafc;font-size:0.95rem;line-height:1.6;">
    ${rendered}
  </div>
</div>
</body></html>`;
}

async function sendEmailReminder(booking, client, hoursAhead) {
    if (!resendClient || !booking.email) return false;

    const salonName = client.salon_name || client.salon_slug;
    const vars = {
        salonas: salonName,
        paslauga: booking.service,
        data: booking.date,
        laikas: booking.time,
        klientas: booking.name,
    };

    const defaultSubject = hoursAhead === 24 ? DEFAULT_EMAIL_SUBJECT_24H : DEFAULT_EMAIL_SUBJECT_2H;
    const subjectTpl = client.reminder_email_subject && client.reminder_email_subject.trim() ? client.reminder_email_subject : defaultSubject;
    const bodyTpl = client.reminder_email_body && client.reminder_email_body.trim() ? client.reminder_email_body : DEFAULT_EMAIL_BODY;

    const subject = applyPlaceholders(subjectTpl, vars);
    const html = buildEmailHtml(bodyTpl, salonName, vars);

    try {
        await resendClient.emails.send({
            from: `${salonName} <info@velorastudio.lt>`,
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

async function sendSmsReminder(booking, client, hoursAhead) {
    if (!twilioClient || !twilioFrom || !booking.phone) return false;

    const salonName = client.salon_name || client.salon_slug;
    const phone = booking.phone.trim();
    const formattedPhone = phone.startsWith('+') ? phone : '+370' + phone.replace(/^8/, '');

    const vars = {
        salonas: salonName,
        paslauga: booking.service,
        data: booking.date,
        laikas: booking.time,
        klientas: booking.name,
    };

    const bodyTpl = client.reminder_sms_body && client.reminder_sms_body.trim() ? client.reminder_sms_body : DEFAULT_SMS_BODY;
    const body = applyPlaceholders(bodyTpl, vars);

    try {
        await twilioClient.messages.create({ body, from: twilioFrom, to: formattedPhone });
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

// hoursBefore: 24, 2, or 0 (both)
function shouldRunForSalon(client, hoursAhead) {
    const pref = Number(client.reminder_hours_before);
    if (!pref || pref === 0) return true; // both
    return pref === hoursAhead;
}

async function checkAndSendReminders(hoursAhead) {
    const reminderField = hoursAhead === 24 ? 'reminder_24h_sent' : 'reminder_2h_sent';

    try {
        const clients = await portalAll(
            'SELECT salon_slug, salon_name, email_reminders_active, sms_reminders_active, reminder_email_subject, reminder_email_body, reminder_sms_body, reminder_hours_before FROM clients WHERE (email_reminders_active = 1 OR sms_reminders_active = 1) AND salon_slug != ""'
        );

        for (const client of clients) {
            if (!shouldRunForSalon(client, hoursAhead)) continue;

            const bookings = await getUpcomingBookings(client.salon_slug, hoursAhead, reminderField);

            for (const booking of bookings) {
                let sent = false;

                if (client.email_reminders_active && booking.email) {
                    if (await sendEmailReminder(booking, client, hoursAhead)) sent = true;
                }
                if (client.sms_reminders_active && booking.phone) {
                    if (await sendSmsReminder(booking, client, hoursAhead)) sent = true;
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

async function triggerReminders(hoursAhead) {
    console.log(`[reminders] Manual trigger: ${hoursAhead}h reminders`);
    await checkAndSendReminders(hoursAhead);
}

// Send a one-off test reminder to an admin's email/phone using that salon's templates.
async function sendTestReminder(salonSlug, { email, phone }) {
    const client = await getSalonClient(salonSlug);
    if (!client) throw new Error('Salon not found');

    const fakeBooking = {
        name: 'Testas Testauskas',
        service: 'Pavyzdinė paslauga',
        date: new Date().toISOString().split('T')[0],
        time: '14:00',
        email: email || '',
        phone: phone || '',
    };

    const results = { email: false, sms: false };
    if (email) results.email = await sendEmailReminder(fakeBooking, client, 24);
    if (phone) results.sms = await sendSmsReminder(fakeBooking, client, 24);
    return results;
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

    cron.schedule('5 * * * *', () => {
        console.log('[reminders] Running 24h check...');
        checkAndSendReminders(24);
    }, { timezone: 'Europe/Vilnius' });

    cron.schedule('5,35 * * * *', () => {
        console.log('[reminders] Running 2h check...');
        checkAndSendReminders(2);
    }, { timezone: 'Europe/Vilnius' });

    console.log('[reminders] Cron jobs started (24h at :05, 2h at :05/:35)');
}

module.exports = { start, triggerReminders, sendTestReminder };
