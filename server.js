require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const rLimit = require('express-rate-limit');
const https = require('https');
const http = require('http');
const fs = require('fs');
const nodemailer = require('nodemailer');
const Anthropic = require('@anthropic-ai/sdk');

// ==================== EMAIL SETUP ====================
const emailTransporter = (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) ? nodemailer.createTransport({
    service: 'gmail',
    pool: true,
    maxConnections: 3,
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
}) : null;

async function sendCancellationEmail(to, clientName, service, date, time, reason, salonName) {
    if (!emailTransporter || !to) return false;
    try {
        await emailTransporter.sendMail({
            from: `"${salonName}" <${process.env.GMAIL_USER}>`,
            to,
            subject: `Jūsų vizitas atšauktas — ${salonName}`,
            html: `
                <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:20px;">
                    <h2 style="color:#333;">Sveiki, ${clientName}!</h2>
                    <p>Deja, dėl nenumatytų aplinkybių turėjome atšaukti Jūsų vizitą:</p>
                    <div style="background:#f5f5f5;padding:15px;border-radius:8px;margin:15px 0;">
                        <p style="margin:5px 0;"><strong>Paslauga:</strong> ${service}</p>
                        <p style="margin:5px 0;"><strong>Data:</strong> ${date}</p>
                        <p style="margin:5px 0;"><strong>Laikas:</strong> ${time}</p>
                    </div>
                    ${reason ? `<p><strong>Priežastis:</strong> ${reason}</p>` : ''}
                    <p>Atsiprašome už nepatogumus. Prašome susisiekti su mumis nauju vizitu suderinti.</p>
                    <p style="color:#888;margin-top:20px;">Pagarbiai,<br><strong>${salonName}</strong></p>
                </div>
            `
        });
        return true;
    } catch (err) {
        console.error('Email send failed:', err.message);
        return false;
    }
}

// ==================== STRIPE SETUP ====================
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || '');
const SITE_URL = process.env.SITE_URL || 'http://localhost:3000';

const PRICES = {
    start:  { monthly: process.env.STRIPE_PRICE_START_MONTHLY,  annual: process.env.STRIPE_PRICE_START_ANNUAL  },
    growth: { monthly: process.env.STRIPE_PRICE_GROWTH_MONTHLY, annual: process.env.STRIPE_PRICE_GROWTH_ANNUAL },
    pro:    { monthly: process.env.STRIPE_PRICE_PRO_MONTHLY,     annual: process.env.STRIPE_PRICE_PRO_ANNUAL    },
};
const VALID_PRICE_IDS = new Set(Object.values(PRICES).flatMap(p => [p.monthly, p.annual]).filter(Boolean));

// Barbie SQLite models
const { initDatabase, Admin, Booking, db: dbBarbie } = require('./backend/barbie/database');
// Hair Beauty SQLite db
const dbHair = require('./backend/hair/database');
// Nails SQLite db
const dbNails = require('./backend/nails/database');
// Velora Lead & Admin
const { VeloraAdmin, VeloraLead, initVeloraDatabase } = require('./backend/velora/database');
// Portal (client accounts + change requests)
const { dbAll: portalAll, dbGet: portalGet, dbRun: portalRun } = require('./backend/portal/database');
// Google Auth
const { OAuth2Client } = require('google-auth-library');
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const app = express();
const PORT = process.env.PORT || 3000;

// 1. Body Parsers (MUST BE FIRST)
app.set('trust proxy', 1);

// ==================== STRIPE WEBHOOK ====================
// MUST be registered BEFORE express.json() so we get the raw body
// (Stripe signature verification requires the raw Buffer, not parsed JSON)
app.post('/webhook/stripe',
    express.raw({ type: 'application/json' }),
    async (req, res) => {
        const sig = req.headers['stripe-signature'];
        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

        if (!webhookSecret) {
            console.warn('STRIPE_WEBHOOK_SECRET not set — skipping signature check');
            return res.json({ received: true });
        }

        let event;
        try {
            event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
        } catch (err) {
            console.error('Stripe webhook signature error:', err.message);
            return res.status(400).send(`Webhook Error: ${err.message}`);
        }

        if (event.type === 'checkout.session.completed') {
            const session = event.data.object;
            console.log('✅ Payment completed:', session.customer_email, session.amount_total);

            // Handle one-off change purchase
            if (session.metadata?.type === 'one-off-change') {
                try {
                    const clientId = session.metadata.client_id;
                    await portalRun('UPDATE clients SET purchased_changes = purchased_changes + 1 WHERE id = ?', [clientId]);
                    console.log(`Portal: +1 purchased change for client ${clientId}`);
                } catch (err) {
                    console.error('One-off change error:', err.message);
                }
            } else {
                // Auto-create/upgrade portal client account (subscription purchase)
                try {
                    const email = session.customer_email;
                    const customerName = session.customer_details?.name || '';
                    const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 1 });
                    const priceId = lineItems.data[0]?.price?.id || '';
                    const plan = getPlanFromPriceId(priceId);
                    const nextReset = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString().split('T')[0];

                    const existing = await portalGet('SELECT id FROM clients WHERE google_email = ?', [email]);
                    if (existing) {
                        await portalRun('UPDATE clients SET plan = ?, stripe_customer_id = ?, stripe_subscription_id = ? WHERE id = ?',
                            [plan, session.customer || '', session.subscription || '', existing.id]);
                        console.log(`Portal: Updated client ${email} → ${plan}`);
                    } else {
                        await portalRun(
                            'INSERT INTO clients (google_email, google_name, plan, stripe_customer_id, stripe_subscription_id, month_reset_date) VALUES (?, ?, ?, ?, ?, ?)',
                            [email, customerName, plan, session.customer || '', session.subscription || '', nextReset]
                        );
                        console.log(`Portal: Created client ${email} → ${plan}`);
                    }
                } catch (portalErr) {
                    console.error('Portal auto-create error:', portalErr.message);
                }
            }

            const n8nUrl = process.env.N8N_WEBHOOK_URL;
            if (n8nUrl) {
                const payload = JSON.stringify({
                    event: 'checkout.session.completed',
                    customer_email: session.customer_email,
                    customer_name: session.customer_details?.name || '',
                    amount_total: session.amount_total,
                    currency: session.currency,
                    session_id: session.id,
                    subscription_id: session.subscription,
                    timestamp: new Date().toISOString(),
                });
                try {
                    const url = new URL(n8nUrl);
                    const lib = url.protocol === 'https:' ? https : http;
                    const options = {
                        hostname: url.hostname,
                        port: url.port || (url.protocol === 'https:' ? 443 : 80),
                        path: url.pathname + url.search,
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
                    };
                    const r2 = lib.request(options);
                    r2.on('error', (e) => console.error('n8n notification error:', e.message));
                    r2.write(payload);
                    r2.end();
                } catch (e) {
                    console.error('Failed to send n8n notification:', e.message);
                }
            }
        }
        res.json({ received: true });
    }
);

app.use(express.json({ limit: '4mb' }));
app.use(express.urlencoded({ extended: true }));

// 2. Middlewares
app.use(cors());
app.use(session({
    secret: process.env.SESSION_SECRET || 'mega-monorepo-secret-2024',
    resave: true,
    saveUninitialized: true,
    cookie: {
        maxAge: 24 * 60 * 60 * 1000,
        secure: false, // Ensure cookies work behind proxy
        sameSite: 'lax'
    }
}));

// ==================== STRIPE API ====================
// Returns public price IDs (not secret — safe to expose to browser)
app.get('/api/prices', (req, res) => {
    res.json(PRICES);
});

// Creates a Stripe Checkout session and returns the redirect URL
app.post('/create-checkout-session', async (req, res) => {
    const { priceId } = req.body;
    if (!priceId || !VALID_PRICE_IDS.has(priceId)) {
        return res.status(400).json({ error: 'Neteisingas plano ID.' });
    }
    try {
        const session = await stripe.checkout.sessions.create({
            mode: 'subscription',
            line_items: [{ price: priceId, quantity: 1 }],
            success_url: `${SITE_URL}/thank-you?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${SITE_URL}/#kainos`,
            locale: 'lt',
            billing_address_collection: 'auto',
        });
        res.json({ url: session.url });
    } catch (err) {
        console.error('Stripe checkout error:', err.message);
        res.status(500).json({ error: 'Nepavyko sukurti mokėjimo sesijos.' });
    }
});

// ==================== WEBSITE LEAD CAPTURE ====================
const LEADS_DIR = path.join(__dirname, 'data');
const LEADS_FILE = path.join(LEADS_DIR, 'website-leads.json');
if (!fs.existsSync(LEADS_DIR)) fs.mkdirSync(LEADS_DIR, { recursive: true });

const websiteLeadLimiter = rLimit({
    windowMs: 10 * 60 * 1000,
    max: 3,
    message: { error: 'Per daug bandymų. Pabandykite vėliau.' }
});

app.post('/api/website/lead', websiteLeadLimiter, (req, res) => {
    const { name, contact, salon_name, website_url_fake } = req.body;
    if (website_url_fake) return res.status(200).json({ success: true });
    if (!name || !contact) return res.status(400).json({ error: 'Vardas ir kontaktai yra privalomi.' });

    const lead = { name, contact, salon_name: salon_name || '', created_at: new Date().toISOString(), status: 'new' };
    let leads = [];
    try { if (fs.existsSync(LEADS_FILE)) leads = JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8')); } catch (e) { /* empty */ }
    leads.push(lead);
    fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
    console.log('New website lead:', name, contact);
    res.status(201).json({ success: true });
});

// 3. Static Files (MUST BE BEFORE ROOT CATCH-ALL)
app.use('/barbie', express.static(path.join(__dirname, 'public/barbie')));
app.use('/nails', express.static(path.join(__dirname, 'public/nails')));
app.use('/hair', express.static(path.join(__dirname, 'public/hair')));
app.use('/velora', express.static(path.join(__dirname, 'public/velora')));
app.use('/portal', express.static(path.join(__dirname, 'public/portal')));
// Root serves the Velora Studio BUSINESS website
app.use(express.static(path.join(__dirname, 'public/website')));


// ==================== BARBIE BARBER API ====================

app.get('/api/barbie/services', async (req, res) => {
    try {
        const defaultServices = [
            { name: 'Plaukų kirpimas', price: 25, description: 'Profesionalus vyrų plaukų kirpimas', duration: 30 },
            { name: 'Barzdos modeliavimas', price: 25, description: 'Barzdos formavimas ir modeliavimas', duration: 30 },
            { name: 'Barzda su karštų rankšluosčių', price: 25, description: 'Barzdos tvarkymas su karštais rankšluosčiais', duration: 35 },
            { name: 'Kirpimas + barzdos modeliavimas', price: 35, description: 'Plaukų kirpimas kartu su barzdos modeliavimu', duration: 50 },
            { name: 'Grožio kaukė + antakių korekcija', price: 15, description: 'Veido kaukė ir antakių korekcija', duration: 20 },
            { name: 'Dažymo konsultacija', price: 5, description: 'Konsultacija dėl plaukų dažymo', duration: 15 },
            { name: 'Kirpimas + barzda + grožio kaukė', price: 40, description: 'Pilnas kompleksas: kirpimas, barzda ir kaukė', duration: 60 },
            { name: 'Kompleksas (viskas)', price: 50, description: 'Kirpimas + barzda + karšti rankšluosčiai + kaukė', duration: 75 }
        ];
        res.json(defaultServices);
    } catch (err) { res.status(500).json({ error: 'Klaida' }); }
});

const barbieLimiter = rLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 3,
    message: { error: 'Per daug bandymų. Pabandykite dar kartą vėliau.' }
});

app.post('/api/barbie/bookings', barbieLimiter, async (req, res) => {
    try {
        const { name, phone, email, service, date, time, message, website_url_fake } = req.body;

        // Anti-Spam Honeypot
        if (website_url_fake) {
            console.log(`Spam blocked for Barbie Barber: ${email || phone}`);
            return res.status(200).json({ success: true });
        }

        if (!name || !phone || !service || !date || !time) {
            return res.status(400).json({ error: 'Visi privalomi laukai turi būti užpildyti.' });
        }

        // Check if slot is already booked
        const existing = await Booking.findOne({ date, time, status: { $ne: 'cancelled' } });
        if (existing) {
            return res.status(409).json({ error: 'Šis laikas jau užimtas. Prašome pasirinkti kitą.' });
        }

        await Booking.create({ name, phone, email, service, date, time, message });
        res.status(201).json({ success: true });
    } catch (err) {
        console.error('Barbie Book DB Save Error:', err.message);
        res.status(500).json({ error: 'Serverio klaida. Nepavyko išsaugoti registracijos.' });
    }
});

// Barbie Settings API
app.get('/api/barbie/settings', (req, res) => {
    dbBarbie.run(`CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY DEFAULT 1, workingDays TEXT DEFAULT '[1,2,3,4,5,6]', startHour TEXT DEFAULT '09:00', endHour TEXT DEFAULT '18:30', breakStart TEXT DEFAULT '', breakEnd TEXT DEFAULT '', blockedDates TEXT DEFAULT '[]', breaks TEXT DEFAULT '[]')`, () => {
        dbBarbie.run("ALTER TABLE settings ADD COLUMN breaks TEXT DEFAULT '[]'", () => {});
        dbBarbie.run("INSERT OR IGNORE INTO settings (id) VALUES (1)", () => {
            dbBarbie.get("SELECT * FROM settings WHERE id = 1", [], (err, row) => {
                if (err) return res.status(500).json({ error: 'DB klaida' });
                if (row) {
                    if (row.workingDays) row.workingDays = JSON.parse(row.workingDays);
                    try { row.blockedDates = JSON.parse(row.blockedDates || '[]'); } catch(e) { row.blockedDates = []; }
                    try { row.breaks = JSON.parse(row.breaks || '[]'); } catch(e) { row.breaks = []; }
                    // Migrate old single break into breaks array
                    if (row.breaks.length === 0 && row.breakStart && row.breakEnd) {
                        row.breaks = [{ start: row.breakStart, end: row.breakEnd }];
                    }
                }
                res.json(row || { workingDays: [1,2,3,4,5,6], startHour: '09:00', endHour: '18:30', blockedDates: [], breaks: [] });
            });
        });
    });
});

app.put('/api/barbie/settings', (req, res) => {
    // Skip auth check for settings — admin is already on the admin page
    if (!req.session || !req.session.isBarbieAdmin) {
        console.error('Barbie settings PUT: not authenticated, session:', JSON.stringify(req.session));
        return res.status(401).json({ error: 'Reikia prisijungti' });
    }
    const { workingDays, startHour, endHour, blockedDates, breaks } = req.body;
    if (!dbBarbie) return res.status(500).json({ error: 'DB neprijungta' });
    dbBarbie.run(`CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY DEFAULT 1, workingDays TEXT DEFAULT '[1,2,3,4,5,6]', startHour TEXT DEFAULT '09:00', endHour TEXT DEFAULT '18:30', breakStart TEXT DEFAULT '', breakEnd TEXT DEFAULT '', blockedDates TEXT DEFAULT '[]', breaks TEXT DEFAULT '[]')`, () => {
        dbBarbie.run("ALTER TABLE settings ADD COLUMN breaks TEXT DEFAULT '[]'", () => {});
        dbBarbie.run("INSERT OR IGNORE INTO settings (id) VALUES (1)", () => {
            dbBarbie.run("UPDATE settings SET workingDays = ?, startHour = ?, endHour = ?, blockedDates = ?, breaks = ? WHERE id = 1",
                [JSON.stringify(workingDays), startHour, endHour, JSON.stringify(blockedDates || []), JSON.stringify(breaks || [])], function (err) {
                    if (err) return res.status(500).json({ error: 'DB klaida: ' + err.message });
                    res.json({ success: true });
                });
        });
    });
});

// Barbie Services API
app.get('/api/barbie/services', (req, res) => {
    dbBarbie.all("SELECT * FROM services ORDER BY sort_order ASC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: 'DB klaida' });
        res.json(rows);
    });
});

app.get('/api/barbie/bookings/times/:date', async (req, res) => {
    try {
        const date = req.params.date;
        const requestedServiceName = req.query.service;

        // Fetch settings
        const settings = await new Promise((resolve, reject) => {
            dbBarbie.get("SELECT * FROM settings WHERE id = 1", [], (err, row) => {
                if (err) return reject(err);
                resolve(row || { workingDays: '[1,2,3,4,5,6]', startHour: '09:00', endHour: '18:30', breakStart: '', breakEnd: '', blockedDates: '[]' });
            });
        });

        const workingDays = typeof settings.workingDays === 'string' ? JSON.parse(settings.workingDays) : settings.workingDays;
        let blockedDates = [];
        try { blockedDates = typeof settings.blockedDates === 'string' ? JSON.parse(settings.blockedDates) : settings.blockedDates; } catch(e) {}

        const dayOfWeek = new Date(date).getDay();
        if (!workingDays.includes(dayOfWeek)) return res.json([]);
        if (blockedDates.includes(date)) return res.json([]);

        // Fetch services for duration
        const services = await new Promise((resolve, reject) => {
            dbBarbie.all("SELECT * FROM services", [], (err, rows) => {
                if (err) return reject(err);
                resolve(rows || []);
            });
        });

        let requestedDuration = 30;
        if (requestedServiceName) {
            const s = services.find(sr => sr.name === requestedServiceName);
            if (s) requestedDuration = s.duration;
        }

        const timeToMins = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
        const minsToTime = (m) => {
            const hh = Math.floor(m / 60).toString().padStart(2, '0');
            const mm = (m % 60).toString().padStart(2, '0');
            return `${hh}:${mm}`;
        };

        // Allow preview overrides for pending settings
        const startOfDayMins = timeToMins(req.query.overrideStart || settings.startHour);
        const endOfDayMins = timeToMins(req.query.overrideEnd || settings.endHour);
        // Parse breaks array (multiple breaks support)
        let breaksArr = [];
        try { breaksArr = typeof settings.breaks === 'string' ? JSON.parse(settings.breaks || '[]') : (settings.breaks || []); } catch(e) {}
        // Backward compat: if no breaks array but old breakStart/breakEnd exist
        if (breaksArr.length === 0 && settings.breakStart && settings.breakEnd) {
            breaksArr = [{ start: settings.breakStart, end: settings.breakEnd }];
        }

        const bookings = await Booking.find({ date, status: { $ne: 'cancelled' } });
        const blockedIntervals = bookings.map(b => {
            const bSrv = services.find(s => s.name === b.service);
            const bDuration = bSrv ? bSrv.duration : 30;
            const bStartMins = timeToMins(b.time);
            return { start: bStartMins, end: bStartMins + bDuration };
        });

        // Add all breaks as blocked intervals
        breaksArr.forEach(br => {
            if (br.start && br.end) {
                const bStart = timeToMins(br.start);
                const bEnd = timeToMins(br.end);
                if (bEnd > bStart) blockedIntervals.push({ start: bStart, end: bEnd });
            }
        });

        const availableSlots = [];
        for (let curr = startOfDayMins; curr + requestedDuration <= endOfDayMins; curr += 30) {
            const reqStart = curr;
            const reqEnd = curr + requestedDuration;
            const overlaps = blockedIntervals.some(b => reqStart < b.end && reqEnd > b.start);
            if (!overlaps) availableSlots.push(minsToTime(curr));
        }

        res.json(availableSlots);
    } catch (err) {
        console.error('Critical Slot Error:', err);
        res.json(["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30", "13:00", "13:30", "14:00", "14:30", "15:00", "15:30", "16:00", "16:30", "17:00", "17:30", "18:00", "18:30"]);
    }
});

// --- Barbie Monthly Availability ---
app.get('/api/barbie/availability-month', (req, res) => {
    const year = parseInt(req.query.year);
    const month = parseInt(req.query.month);
    if (!year || !month) return res.status(400).json({ error: 'year and month required' });

    const monthStr = String(month).padStart(2, '0');
    const daysInMonth = new Date(year, month, 0).getDate();

    dbBarbie.get("SELECT * FROM settings WHERE id = 1", [], (err, settingsRow) => {
        if (err) return res.status(500).json({ error: 'DB error' });
        const settings = settingsRow || { workingDays: '[1,2,3,4,5,6]', startHour: '09:00', endHour: '18:30', breaks: '[]', blockedDates: '[]' };
        const workingDays = typeof settings.workingDays === 'string' ? JSON.parse(settings.workingDays) : settings.workingDays;
        let blockedDates = []; try { blockedDates = typeof settings.blockedDates === 'string' ? JSON.parse(settings.blockedDates) : settings.blockedDates; } catch(e) {}
        let breaksArr = []; try { breaksArr = typeof settings.breaks === 'string' ? JSON.parse(settings.breaks || '[]') : (settings.breaks || []); } catch(e) {}
        if (breaksArr.length === 0 && settings.breakStart && settings.breakEnd) breaksArr = [{ start: settings.breakStart, end: settings.breakEnd }];

        const timeToMins = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
        const startMins = timeToMins(settings.startHour);
        const endMins = timeToMins(settings.endHour);
        const dur = 30;

        // Compute total possible slots (minus breaks)
        const breakIntervals = breaksArr.filter(b => b.start && b.end).map(b => ({ start: timeToMins(b.start), end: timeToMins(b.end) })).filter(b => b.end > b.start);
        let totalSlots = 0;
        for (let c = startMins; c + dur <= endMins; c += 30) {
            if (!breakIntervals.some(b => c < b.end && c + dur > b.start)) totalSlots++;
        }

        const dateFrom = `${year}-${monthStr}-01`;
        const dateTo = `${year}-${monthStr}-${String(daysInMonth).padStart(2, '0')}`;
        dbBarbie.all("SELECT date, service, time FROM bookings WHERE date >= ? AND date <= ? AND status != 'cancelled'", [dateFrom, dateTo], (err, bookings) => {
            if (err) return res.status(500).json({ error: 'DB error' });
            dbBarbie.all("SELECT * FROM services", [], (err, services) => {
                if (err) return res.status(500).json({ error: 'DB error' });
                const result = {};
                for (let d = 1; d <= daysInMonth; d++) {
                    const dateStr = `${year}-${monthStr}-${String(d).padStart(2, '0')}`;
                    const dow = new Date(dateStr).getDay();
                    if (!workingDays.includes(dow) || blockedDates.includes(dateStr)) {
                        result[dateStr] = 'closed'; continue;
                    }
                    const dayBookings = (bookings || []).filter(b => b.date === dateStr);
                    const bookedIntervals = dayBookings.map(b => {
                        const srv = (services || []).find(s => s.name === b.service);
                        const bDur = srv ? srv.duration : 30;
                        const st = timeToMins(b.time);
                        return { start: st, end: st + bDur };
                    });
                    const allBlocked = [...breakIntervals, ...bookedIntervals];
                    let available = 0;
                    for (let c = startMins; c + dur <= endMins; c += 30) {
                        if (!allBlocked.some(b => c < b.end && c + dur > b.start)) available++;
                    }
                    if (available === 0) result[dateStr] = 'red';
                    else if (available > totalSlots / 2) result[dateStr] = 'green';
                    else result[dateStr] = 'yellow';
                }
                res.json(result);
            });
        });
    });
});

// --- Admin Auth ---
function requireBarbieAdmin(req, res, next) {
    if (req.session && req.session.isBarbieAdmin) return next();
    res.status(401).json({ error: 'Reikia prisijungti' });
}

app.post('/api/barbie/admin/login', async (req, res) => {
    const { username, password } = req.body;
    if (username === 'admin' && password === (process.env.BARBIE_ADMIN_PASS || 'changeme')) {
        req.session.isBarbieAdmin = true;
        req.session.barbieAdminId = 'system-admin';
        return res.json({ success: true });
    }
    try {
        const admin = await Admin.findOne({ username });
        if (admin && bcrypt.compareSync(password, admin.password)) {
            req.session.isBarbieAdmin = true;
            req.session.barbieAdminId = admin._id;
            return res.json({ success: true });
        }
        res.status(401).json({ error: 'Neteisingi duomenys' });
    } catch (err) {
        console.error('Admin DB Login Error:', err.message);
        res.status(401).json({ error: 'Neteisingi duomenys arba nepavyko prisijungti' });
    }
});

app.post('/api/barbie/admin/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/barbie/admin/check', requireBarbieAdmin, (req, res) => res.json({ isAdmin: true }));

app.get('/api/barbie/admin/bookings', requireBarbieAdmin, async (req, res) => {
    try {
        const bookings = await Booking.find({}, { sort: { date: -1, time: 1 } });
        res.json(bookings.map(b => ({ ...b, id: b.id })));
    } catch (err) {
        console.error('Admin Bookings Fetch Error:', err.message);
        res.status(500).json({ error: 'Klaida kraunant registracijas' });
    }
});

app.patch('/api/barbie/admin/bookings/:id', requireBarbieAdmin, async (req, res) => {
    try {
        await Booking.findByIdAndUpdate(req.params.id, { status: req.body.status });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Klaida' }); }
});

app.delete('/api/barbie/admin/bookings/:id', requireBarbieAdmin, async (req, res) => {
    try {
        await Booking.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Klaida' }); }
});

app.post('/api/barbie/admin/change-password', requireBarbieAdmin, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const admin = await Admin.findById(req.session.barbieAdminId);
        if (!admin || !bcrypt.compareSync(currentPassword, admin.password)) {
            return res.status(401).json({ error: 'Neteisingas dabartinis slaptažodis' });
        }
        const hashedPassword = bcrypt.hashSync(newPassword, 10);
        await Admin.updatePassword(admin._id, hashedPassword);
        res.json({ success: true, message: 'Slaptažodis pakeistas sėkmingai' });
    } catch (err) { res.status(500).json({ error: 'Klaida' }); }
});

// Barbie: Emergency Cancellation
app.post('/api/barbie/admin/emergency-cancel', requireBarbieAdmin, (req, res) => {
    const { date, fullDay, startTime, endTime, reason } = req.body;
    if (!date) return res.status(400).json({ error: 'Data privaloma' });

    const whereClause = fullDay
        ? `date = ? AND status != 'cancelled'`
        : `date = ? AND time >= ? AND time <= ? AND status != 'cancelled'`;
    const params = fullDay ? [date] : [date, startTime, endTime];

    dbBarbie.all(`SELECT * FROM bookings WHERE ${whereClause}`, params, (err, bookings) => {
        if (err) return res.status(500).json({ error: 'DB klaida' });
        if (!bookings || bookings.length === 0) {
            // Still block the date even with no bookings
            dbBarbie.get("SELECT blockedDates FROM settings WHERE id = 1", [], (err, row) => {
                if (row) {
                    let blocked = []; try { blocked = JSON.parse(row.blockedDates || '[]'); } catch(e) {}
                    if (!blocked.includes(date)) {
                        blocked.push(date);
                        dbBarbie.run("UPDATE settings SET blockedDates = ? WHERE id = 1", [JSON.stringify(blocked)]);
                    }
                }
            });
            return res.json({ cancelledCount: 0, clients: [] });
        }

        const ids = bookings.map(b => b.id);
        const placeholders = ids.map(() => '?').join(',');
        dbBarbie.run(`UPDATE bookings SET status = 'cancelled' WHERE id IN (${placeholders})`, ids, function(err) {
            if (err) return res.status(500).json({ error: 'Klaida atšaukiant' });

            // Block the date
            dbBarbie.get("SELECT blockedDates FROM settings WHERE id = 1", [], (err, row) => {
                if (row) {
                    let blocked = []; try { blocked = JSON.parse(row.blockedDates || '[]'); } catch(e) {}
                    if (!blocked.includes(date)) {
                        blocked.push(date);
                        dbBarbie.run("UPDATE settings SET blockedDates = ? WHERE id = 1", [JSON.stringify(blocked)]);
                    }
                }
            });

            const clients = bookings.map(b => ({ name: b.name, phone: b.phone, email: b.email || '', service: b.service, time: b.time, date: b.date }));
            res.json({ cancelledCount: bookings.length, clients });
        });
    });
});

// Barbie: Send custom cancellation email
app.post('/api/barbie/admin/send-cancel-email', requireBarbieAdmin, async (req, res) => {
    const { to, clientName, message } = req.body;
    if (!to || !message) return res.status(400).json({ error: 'El. paštas ir žinutė privalomi' });
    if (!emailTransporter) return res.status(500).json({ error: 'El. pašto siuntimas nesukonfigūruotas (trūksta GMAIL_USER / GMAIL_APP_PASSWORD)' });
    try {
        await emailTransporter.sendMail({
            from: `"Barbie Beauty" <${process.env.GMAIL_USER}>`,
            to,
            subject: `Dėl Jūsų vizito — Barbie Beauty`,
            text: message
        });
        res.json({ success: true });
    } catch (err) {
        console.error('Email send failed:', err.message);
        res.status(500).json({ error: 'Nepavyko išsiųsti: ' + err.message });
    }
});

// ==================== NAILS BY LUKRA API (/api/nails/*) ====================
function requireNailsAdmin(req, res, next) {
    if (req.session && req.session.isNailsAdmin) return next();
    res.status(401).json({ error: 'Reikia prisijungti' });
}

app.post('/api/nails/admin/login', (req, res) => {
    const { password } = req.body;
    if (password === (process.env.NAILS_ADMIN_PASS || 'changeme')) {
        req.session.isNailsAdmin = true;
        return res.json({ success: true });
    }
    res.status(401).json({ error: 'Neteisingas slaptažodis' });
});

app.post('/api/nails/admin/logout', (req, res) => {
    req.session.isNailsAdmin = false;
    res.json({ success: true });
});

app.get('/api/nails/settings', (req, res) => {
    dbNails.run("ALTER TABLE settings ADD COLUMN breaks TEXT DEFAULT '[]'", () => {
    dbNails.get("SELECT * FROM settings WHERE id = 1", [], (err, row) => {
        if (err) return res.status(500).json({ error: 'DB klaida' });
        if (row) {
            if (row.workingDays) row.workingDays = JSON.parse(row.workingDays);
            try { row.blockedDates = JSON.parse(row.blockedDates || '[]'); } catch(e) { row.blockedDates = []; }
            try { row.breaks = JSON.parse(row.breaks || '[]'); } catch(e) { row.breaks = []; }
            // Migrate old single break into breaks array
            if (row.breaks.length === 0 && row.breakStart && row.breakEnd) {
                row.breaks = [{ start: row.breakStart, end: row.breakEnd }];
            }
        }
        res.json(row || { workingDays: [1, 2, 3, 4, 5, 6], startHour: '09:00', endHour: '19:00', blockedDates: [], breaks: [] });
    });
    });
});

app.put('/api/nails/settings', requireNailsAdmin, (req, res) => {
    const { workingDays, startHour, endHour, blockedDates, breaks } = req.body;
    dbNails.run("ALTER TABLE settings ADD COLUMN breaks TEXT DEFAULT '[]'", () => {
        dbNails.run("UPDATE settings SET workingDays = ?, startHour = ?, endHour = ?, blockedDates = ?, breaks = ? WHERE id = 1",
            [JSON.stringify(workingDays), startHour, endHour, JSON.stringify(blockedDates || []), JSON.stringify(breaks || [])], function (err) {
                if (err) return res.status(500).json({ error: 'DB klaida: ' + err.message });
                res.json({ success: true });
            });
    });
});

app.get('/api/nails/services', (req, res) => {
    dbNails.all("SELECT * FROM services ORDER BY sort_order ASC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: 'DB klaida' });
        res.json(rows);
    });
});

app.post('/api/nails/services', requireNailsAdmin, (req, res) => {
    const { name, duration, price } = req.body;
    dbNails.run("INSERT INTO services (name, duration, price) VALUES (?, ?, ?)",
        [name, duration || 60, price || 0], function (err) {
            if (err) return res.status(500).json({ error: 'DB klaida' });
            res.json({ success: true, id: this.lastID });
        });
});

app.patch('/api/nails/services/:id', requireNailsAdmin, (req, res) => {
    const { name, duration, price } = req.body;
    dbNails.run("UPDATE services SET name = ?, duration = ?, price = ? WHERE id = ?",
        [name, duration, price, req.params.id], function (err) {
            if (err) return res.status(500).json({ error: 'DB klaida' });
            res.json({ success: true });
        });
});

app.delete('/api/nails/services/:id', requireNailsAdmin, (req, res) => {
    dbNails.run("DELETE FROM services WHERE id = ?", [req.params.id], function (err) {
        if (err) return res.status(500).json({ error: 'DB klaida' });
        res.json({ success: true });
    });
});

app.get('/api/nails/available-times', (req, res) => {
    const dateStr = req.query.date;
    const requestedServiceName = req.query.service;
    if (!dateStr) return res.status(400).json({ error: 'Data privaloma' });

    // 1. Fetch Settings & Services
    dbNails.get("SELECT * FROM settings WHERE id = 1", [], (err, settingsRow) => {
        if (err) return res.status(500).json({ error: 'DB error settings' });
        const settings = settingsRow || { workingDays: '[1,2,3,4,5,6]', startHour: '09:00', endHour: '19:00' };
        const workingDays = JSON.parse(settings.workingDays);
        let blockedDates = [];
        try { blockedDates = JSON.parse(settings.blockedDates || '[]'); } catch(e) {}

        dbNails.all("SELECT * FROM services", [], (err, servicesRows) => {
            if (err) return res.status(500).json({ error: 'DB error services' });

            let requestedDuration = 60; // default for nails
            if (requestedServiceName) {
                const s = servicesRows.find(sr => sr.name === requestedServiceName);
                if (s) requestedDuration = s.duration;
            }

            const dayOfWeek = new Date(dateStr).getDay();
            if (!workingDays.includes(dayOfWeek)) {
                return res.json({ bookedTimes: [], availableSlots: [] }); // closed
            }

            // Check if date is blocked (day off / vacation)
            if (blockedDates.includes(dateStr)) {
                return res.json({ bookedTimes: [], availableSlots: [] });
            }

            const timeToMins = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
            const minsToTime = (m) => {
                const hh = Math.floor(m / 60).toString().padStart(2, '0');
                const mm = (m % 60).toString().padStart(2, '0');
                return `${hh}:${mm}`;
            };

            // Allow preview overrides for pending settings
            const startOfDayMins = timeToMins(req.query.overrideStart || settings.startHour);
            const endOfDayMins = timeToMins(req.query.overrideEnd || settings.endHour);

            // Parse breaks array (multiple breaks support)
            let breaksArr = [];
            try { breaksArr = typeof settings.breaks === 'string' ? JSON.parse(settings.breaks || '[]') : (settings.breaks || []); } catch(e) {}
            if (breaksArr.length === 0 && settings.breakStart && settings.breakEnd) {
                breaksArr = [{ start: settings.breakStart, end: settings.breakEnd }];
            }

            dbNails.all(`SELECT service, time FROM reservations WHERE date = ? AND status != 'cancelled'`, [dateStr], (err, bookings) => {
                if (err) return res.status(500).json({ error: 'DB error bookings' });

                const blockedIntervals = bookings.map(b => {
                    const bSrv = servicesRows.find(s => s.name === b.service);
                    const bDuration = bSrv ? bSrv.duration : 60;
                    const bStartMins = timeToMins(b.time);
                    return { start: bStartMins, end: bStartMins + bDuration };
                });

                // Add all breaks as blocked intervals
                breaksArr.forEach(br => {
                    if (br.start && br.end) {
                        const bStart = timeToMins(br.start);
                        const bEnd = timeToMins(br.end);
                        if (bEnd > bStart) blockedIntervals.push({ start: bStart, end: bEnd });
                    }
                });

                const availableSlots = [];
                for (let curr = startOfDayMins; curr + requestedDuration <= endOfDayMins; curr += 30) {
                    const reqStart = curr;
                    const reqEnd = curr + requestedDuration;
                    const overlaps = blockedIntervals.some(b => reqStart < b.end && reqEnd > b.start);
                    if (!overlaps) availableSlots.push(minsToTime(curr));
                }

                res.json({ availableSlots });
            });
        });
    });
});

// --- Nails Monthly Availability ---
app.get('/api/nails/availability-month', (req, res) => {
    const year = parseInt(req.query.year);
    const month = parseInt(req.query.month);
    if (!year || !month) return res.status(400).json({ error: 'year and month required' });

    const monthStr = String(month).padStart(2, '0');
    const daysInMonth = new Date(year, month, 0).getDate();

    dbNails.get("SELECT * FROM settings WHERE id = 1", [], (err, settingsRow) => {
        if (err) return res.status(500).json({ error: 'DB error' });
        const settings = settingsRow || { workingDays: '[1,2,3,4,5,6]', startHour: '09:00', endHour: '19:00', breaks: '[]', blockedDates: '[]' };
        const workingDays = JSON.parse(settings.workingDays);
        let blockedDates = []; try { blockedDates = JSON.parse(settings.blockedDates || '[]'); } catch(e) {}
        let breaksArr = []; try { breaksArr = typeof settings.breaks === 'string' ? JSON.parse(settings.breaks || '[]') : (settings.breaks || []); } catch(e) {}
        if (breaksArr.length === 0 && settings.breakStart && settings.breakEnd) breaksArr = [{ start: settings.breakStart, end: settings.breakEnd }];

        const timeToMins = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
        const startMins = timeToMins(settings.startHour);
        const endMins = timeToMins(settings.endHour);
        const dur = 60;
        const breakIntervals = breaksArr.filter(b => b.start && b.end).map(b => ({ start: timeToMins(b.start), end: timeToMins(b.end) })).filter(b => b.end > b.start);
        let totalSlots = 0;
        for (let c = startMins; c + dur <= endMins; c += 30) {
            if (!breakIntervals.some(b => c < b.end && c + dur > b.start)) totalSlots++;
        }

        const dateFrom = `${year}-${monthStr}-01`;
        const dateTo = `${year}-${monthStr}-${String(daysInMonth).padStart(2, '0')}`;
        dbNails.all("SELECT date, service, time FROM reservations WHERE date >= ? AND date <= ? AND status != 'cancelled'", [dateFrom, dateTo], (err, bookings) => {
            if (err) return res.status(500).json({ error: 'DB error' });
            dbNails.all("SELECT * FROM services", [], (err, services) => {
                if (err) return res.status(500).json({ error: 'DB error' });
                const result = {};
                for (let d = 1; d <= daysInMonth; d++) {
                    const dateStr = `${year}-${monthStr}-${String(d).padStart(2, '0')}`;
                    const dow = new Date(dateStr).getDay();
                    if (!workingDays.includes(dow) || blockedDates.includes(dateStr)) {
                        result[dateStr] = 'closed'; continue;
                    }
                    const dayBookings = (bookings || []).filter(b => b.date === dateStr);
                    const bookedIntervals = dayBookings.map(b => {
                        const srv = (services || []).find(s => s.name === b.service);
                        const bDur = srv ? srv.duration : 60;
                        const st = timeToMins(b.time);
                        return { start: st, end: st + bDur };
                    });
                    const allBlocked = [...breakIntervals, ...bookedIntervals];
                    let available = 0;
                    for (let c = startMins; c + dur <= endMins; c += 30) {
                        if (!allBlocked.some(b => c < b.end && c + dur > b.start)) available++;
                    }
                    if (available === 0) result[dateStr] = 'red';
                    else if (available > totalSlots / 2) result[dateStr] = 'green';
                    else result[dateStr] = 'yellow';
                }
                res.json(result);
            });
        });
    });
});

const nailsLimiter = rLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 3,
    message: { error: 'Per daug bandymų. Pabandykite dar kartą vėliau.' }
});

app.post('/api/nails/reservations', nailsLimiter, (req, res) => {
    const { name, phone, email, service, date, time, notes, website_url_fake } = req.body;

    // Anti-Spam Honeypot
    if (website_url_fake) {
        console.log(`Spam blocked for Nails by Lukra: ${phone}`);
        return res.status(200).json({ success: true, id: 0 }); // Mock ID to fail silently on client side smoothly
    }

    if (!name || !phone || !service || !date || !time) {
        return res.status(400).json({ error: 'Visi laukai privalomi' });
    }

    // Double check if slot is already taken in DB
    dbNails.get(`SELECT id FROM reservations WHERE date = ? AND time = ? AND status != 'cancelled'`, [date, time], (err, row) => {
        if (err) return res.status(500).json({ error: 'DB klaida' });
        if (row) return res.status(409).json({ error: 'Šis laikas jau užimtas' });

        dbNails.run(
            `INSERT INTO reservations (name, phone, email, service, date, time, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [name, phone, email || '', service, date, time, notes],
            function (err) {
                if (err) return res.status(500).json({ error: 'Klaida išsaugant' });
                res.status(201).json({ success: true, id: this.lastID });
            }
        );
    });
});

app.get('/api/nails/reservations', requireNailsAdmin, (req, res) => {
    dbNails.all(`SELECT * FROM reservations ORDER BY date DESC, time ASC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Klaida' });
        res.json(rows);
    });
});

app.patch('/api/nails/reservations/:id/status', requireNailsAdmin, (req, res) => {
    dbNails.run(`UPDATE reservations SET status = ? WHERE id = ?`, [req.body.status, req.params.id], function (err) {
        if (err) return res.status(500).json({ error: 'Klaida' });
        res.json({ success: true });
    });
});

// Nails: Emergency Cancellation
app.post('/api/nails/admin/emergency-cancel', requireNailsAdmin, (req, res) => {
    const { date, fullDay, startTime, endTime, reason } = req.body;
    if (!date) return res.status(400).json({ error: 'Data privaloma' });

    const whereClause = fullDay
        ? `date = ? AND status != 'cancelled'`
        : `date = ? AND time >= ? AND time <= ? AND status != 'cancelled'`;
    const params = fullDay ? [date] : [date, startTime, endTime];

    dbNails.all(`SELECT * FROM reservations WHERE ${whereClause}`, params, (err, bookings) => {
        if (err) return res.status(500).json({ error: 'DB klaida' });
        if (!bookings || bookings.length === 0) {
            dbNails.get("SELECT blockedDates FROM settings WHERE id = 1", [], (err, row) => {
                if (row) {
                    let blocked = []; try { blocked = JSON.parse(row.blockedDates || '[]'); } catch(e) {}
                    if (!blocked.includes(date)) {
                        blocked.push(date);
                        dbNails.run("UPDATE settings SET blockedDates = ? WHERE id = 1", [JSON.stringify(blocked)]);
                    }
                }
            });
            return res.json({ cancelledCount: 0, clients: [] });
        }

        const ids = bookings.map(b => b.id);
        const placeholders = ids.map(() => '?').join(',');
        dbNails.run(`UPDATE reservations SET status = 'cancelled' WHERE id IN (${placeholders})`, ids, function(err) {
            if (err) return res.status(500).json({ error: 'Klaida atšaukiant' });

            dbNails.get("SELECT blockedDates FROM settings WHERE id = 1", [], (err, row) => {
                if (row) {
                    let blocked = []; try { blocked = JSON.parse(row.blockedDates || '[]'); } catch(e) {}
                    if (!blocked.includes(date)) {
                        blocked.push(date);
                        dbNails.run("UPDATE settings SET blockedDates = ? WHERE id = 1", [JSON.stringify(blocked)]);
                    }
                }
            });

            const clients = bookings.map(b => ({ name: b.name, phone: b.phone, email: b.email || '', service: b.service, time: b.time, date: b.date }));
            res.json({ cancelledCount: bookings.length, clients });
        });
    });
});

// Nails: Send custom cancellation email
app.post('/api/nails/admin/send-cancel-email', requireNailsAdmin, async (req, res) => {
    const { to, clientName, message } = req.body;
    if (!to || !message) return res.status(400).json({ error: 'El. paštas ir žinutė privalomi' });
    if (!emailTransporter) return res.status(500).json({ error: 'El. pašto siuntimas nesukonfigūruotas (trūksta GMAIL_USER / GMAIL_APP_PASSWORD)' });
    try {
        await emailTransporter.sendMail({
            from: `"Nails by Lukra" <${process.env.GMAIL_USER}>`,
            to,
            subject: `Dėl Jūsų vizito — Nails by Lukra`,
            text: message
        });
        res.json({ success: true });
    } catch (err) {
        console.error('Email send failed:', err.message);
        res.status(500).json({ error: 'Nepavyko išsiųsti: ' + err.message });
    }
});

// ==================== HAIR BEAUTY API (/api/hair/*) ====================
const GRETA_ADMIN_PASS = process.env.HAIR_ADMIN_PASS || 'changeme';

function requireHairAdmin(req, res, next) {
    if (req.session && req.session.isHairAdmin) return next();
    res.status(401).json({ error: 'Reikia prisijungti' });
}

const hairLimiter = rLimit({
    windowMs: 10 * 60 * 1000,
    max: 3,
    message: { error: 'Per daug bandymų. Pabandykite dar kartą vėliau.' }
});

app.post('/api/hair/admin/login', (req, res) => {
    const { password } = req.body;
    if (password === GRETA_ADMIN_PASS) {
        req.session.isHairAdmin = true;
        return res.json({ success: true });
    }
    res.status(401).json({ error: 'Neteisingas slaptažodis' });
});

app.post('/api/hair/admin/logout', (req, res) => {
    req.session.isHairAdmin = false;
    res.json({ success: true });
});

// Explicit route for hair admin to ensure latest file is served
app.get('/hair/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/hair/admin.html'));
});

// --- Hair Settings API (SQLite) ---
app.get('/api/hair/settings', (req, res) => {
    dbHair.run("ALTER TABLE settings ADD COLUMN breaks TEXT DEFAULT '[]'", () => {
    dbHair.get("SELECT * FROM settings WHERE id = 1", [], (err, row) => {
        if (err) return res.status(500).json({ error: 'DB klaida' });
        if (row) {
            if (row.workingDays) row.workingDays = JSON.parse(row.workingDays);
            try { row.blockedDates = JSON.parse(row.blockedDates || '[]'); } catch(e) { row.blockedDates = []; }
            try { row.breaks = JSON.parse(row.breaks || '[]'); } catch(e) { row.breaks = []; }
            if (row.breaks.length === 0 && row.breakStart && row.breakEnd) {
                row.breaks = [{ start: row.breakStart, end: row.breakEnd }];
            }
        }
        res.json(row || { workingDays: [1, 2, 3, 4, 5, 6], startHour: '09:00', endHour: '19:00', blockedDates: [], breaks: [] });
    });
    });
});

app.put('/api/hair/settings', requireHairAdmin, (req, res) => {
    const { workingDays, startHour, endHour, blockedDates, breaks } = req.body;
    dbHair.run("ALTER TABLE settings ADD COLUMN breaks TEXT DEFAULT '[]'", () => {
    dbHair.run("INSERT OR IGNORE INTO settings (id) VALUES (1)", () => {
        dbHair.run("UPDATE settings SET workingDays = ?, startHour = ?, endHour = ?, blockedDates = ?, breaks = ? WHERE id = 1",
            [JSON.stringify(workingDays), startHour, endHour, JSON.stringify(blockedDates || []), JSON.stringify(breaks || [])], function (err) {
                if (err) return res.status(500).json({ error: 'DB klaida: ' + err.message });
                res.json({ success: true });
            });
    });
    });
});

// --- Hair Services API (SQLite) ---
app.get('/api/hair/services', (req, res) => {
    dbHair.all("SELECT * FROM services ORDER BY sort_order ASC, id ASC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: 'DB klaida' });
        // Map id -> _id for frontend compatibility
        res.json(rows.map(r => ({ ...r, _id: r.id })));
    });
});

app.post('/api/hair/services', requireHairAdmin, (req, res) => {
    const { name, duration, price, description } = req.body;
    dbHair.run("INSERT INTO services (name, duration, price, description) VALUES (?, ?, ?, ?)",
        [name, duration || 60, price || 0, description || ''], function (err) {
            if (err) return res.status(500).json({ error: 'DB klaida' });
            res.json({ success: true, service: { _id: this.lastID, name, duration, price, description } });
        });
});

app.patch('/api/hair/services/:id', requireHairAdmin, (req, res) => {
    const { name, duration, price, description } = req.body;
    dbHair.run("UPDATE services SET name = ?, duration = ?, price = ?, description = ? WHERE id = ?",
        [name, duration, price, description || '', req.params.id], function (err) {
            if (err) return res.status(500).json({ error: 'DB klaida' });
            res.json({ success: true });
        });
});

app.delete('/api/hair/services/:id', requireHairAdmin, (req, res) => {
    dbHair.run("DELETE FROM services WHERE id = ?", [req.params.id], function (err) {
        if (err) return res.status(500).json({ error: 'DB klaida' });
        res.json({ success: true });
    });
});

// --- Hair Available Times (SQLite) ---
app.get('/api/hair/bookings/times/:date', (req, res) => {
    const dateStr = req.params.date;
    const requestedServiceName = req.query.service;

    dbHair.get("SELECT * FROM settings WHERE id = 1", [], (err, settingsRow) => {
        if (err) return res.status(500).json({ error: 'DB error settings' });
        const settings = settingsRow || { workingDays: '[1,2,3,4,5,6]', startHour: '09:00', endHour: '19:00', breakStart: '', breakEnd: '', blockedDates: '[]' };
        const workingDays = typeof settings.workingDays === 'string' ? JSON.parse(settings.workingDays) : settings.workingDays;
        let blockedDates = [];
        try { blockedDates = typeof settings.blockedDates === 'string' ? JSON.parse(settings.blockedDates || '[]') : (settings.blockedDates || []); } catch(e) {}

        dbHair.all("SELECT * FROM services", [], (err, servicesRows) => {
            if (err) return res.status(500).json({ error: 'DB error services' });

            let requestedDuration = 60;
            if (requestedServiceName) {
                const s = (servicesRows || []).find(sr => sr.name === requestedServiceName);
                if (s) requestedDuration = s.duration;
            }

            const dayOfWeek = new Date(dateStr).getDay();
            if (!workingDays.includes(dayOfWeek)) {
                return res.json([]);
            }

            if (blockedDates.includes(dateStr)) {
                return res.json([]);
            }

            const timeToMins = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
            const minsToTime = (m) => {
                const hh = Math.floor(m / 60).toString().padStart(2, '0');
                const mm = (m % 60).toString().padStart(2, '0');
                return `${hh}:${mm}`;
            };

            // Allow preview overrides for pending settings
            const startOfDayMins = timeToMins(req.query.overrideStart || settings.startHour);
            const endOfDayMins = timeToMins(req.query.overrideEnd || settings.endHour);

            // Parse breaks array (multiple breaks support)
            let breaksArr = [];
            try { breaksArr = typeof settings.breaks === 'string' ? JSON.parse(settings.breaks || '[]') : (settings.breaks || []); } catch(e) {}
            if (breaksArr.length === 0 && settings.breakStart && settings.breakEnd) {
                breaksArr = [{ start: settings.breakStart, end: settings.breakEnd }];
            }

            dbHair.all(`SELECT service, time FROM bookings WHERE date = ? AND status != 'cancelled'`, [dateStr], (err, bookings) => {
                if (err) return res.status(500).json({ error: 'DB error bookings' });

                const blockedIntervals = (bookings || []).map(b => {
                    const bSrv = (servicesRows || []).find(s => s.name === b.service);
                    const bDuration = bSrv ? bSrv.duration : 60;
                    const bStartMins = timeToMins(b.time);
                    return { start: bStartMins, end: bStartMins + bDuration };
                });

                // Add all breaks as blocked intervals
                breaksArr.forEach(br => {
                    if (br.start && br.end) {
                        const bStart = timeToMins(br.start);
                        const bEnd = timeToMins(br.end);
                        if (bEnd > bStart) blockedIntervals.push({ start: bStart, end: bEnd });
                    }
                });

                const availableSlots = [];
                for (let curr = startOfDayMins; curr + requestedDuration <= endOfDayMins; curr += 30) {
                    const reqStart = curr;
                    const reqEnd = curr + requestedDuration;
                    const overlaps = blockedIntervals.some(b => reqStart < b.end && reqEnd > b.start);
                    if (!overlaps) availableSlots.push(minsToTime(curr));
                }

                res.json(availableSlots);
            });
        });
    });
});

// --- Hair Monthly Availability ---
app.get('/api/hair/availability-month', (req, res) => {
    const year = parseInt(req.query.year);
    const month = parseInt(req.query.month);
    if (!year || !month) return res.status(400).json({ error: 'year and month required' });

    const monthStr = String(month).padStart(2, '0');
    const daysInMonth = new Date(year, month, 0).getDate();

    dbHair.get("SELECT * FROM settings WHERE id = 1", [], (err, settingsRow) => {
        if (err) return res.status(500).json({ error: 'DB error' });
        const settings = settingsRow || { workingDays: '[1,2,3,4,5,6]', startHour: '09:00', endHour: '19:00', breaks: '[]', blockedDates: '[]' };
        const workingDays = typeof settings.workingDays === 'string' ? JSON.parse(settings.workingDays) : settings.workingDays;
        let blockedDates = []; try { blockedDates = typeof settings.blockedDates === 'string' ? JSON.parse(settings.blockedDates || '[]') : (settings.blockedDates || []); } catch(e) {}
        let breaksArr = []; try { breaksArr = typeof settings.breaks === 'string' ? JSON.parse(settings.breaks || '[]') : (settings.breaks || []); } catch(e) {}
        if (breaksArr.length === 0 && settings.breakStart && settings.breakEnd) breaksArr = [{ start: settings.breakStart, end: settings.breakEnd }];

        const timeToMins = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
        const startMins = timeToMins(settings.startHour);
        const endMins = timeToMins(settings.endHour);
        const dur = 60;
        const breakIntervals = breaksArr.filter(b => b.start && b.end).map(b => ({ start: timeToMins(b.start), end: timeToMins(b.end) })).filter(b => b.end > b.start);
        let totalSlots = 0;
        for (let c = startMins; c + dur <= endMins; c += 30) {
            if (!breakIntervals.some(b => c < b.end && c + dur > b.start)) totalSlots++;
        }

        const dateFrom = `${year}-${monthStr}-01`;
        const dateTo = `${year}-${monthStr}-${String(daysInMonth).padStart(2, '0')}`;
        dbHair.all("SELECT date, service, time FROM bookings WHERE date >= ? AND date <= ? AND status != 'cancelled'", [dateFrom, dateTo], (err, bookings) => {
            if (err) return res.status(500).json({ error: 'DB error' });
            dbHair.all("SELECT * FROM services", [], (err, services) => {
                if (err) return res.status(500).json({ error: 'DB error' });
                const result = {};
                for (let d = 1; d <= daysInMonth; d++) {
                    const dateStr = `${year}-${monthStr}-${String(d).padStart(2, '0')}`;
                    const dow = new Date(dateStr).getDay();
                    if (!workingDays.includes(dow) || blockedDates.includes(dateStr)) {
                        result[dateStr] = 'closed'; continue;
                    }
                    const dayBookings = (bookings || []).filter(b => b.date === dateStr);
                    const bookedIntervals = dayBookings.map(b => {
                        const srv = (services || []).find(s => s.name === b.service);
                        const bDur = srv ? srv.duration : 60;
                        const st = timeToMins(b.time);
                        return { start: st, end: st + bDur };
                    });
                    const allBlocked = [...breakIntervals, ...bookedIntervals];
                    let available = 0;
                    for (let c = startMins; c + dur <= endMins; c += 30) {
                        if (!allBlocked.some(b => c < b.end && c + dur > b.start)) available++;
                    }
                    if (available === 0) result[dateStr] = 'red';
                    else if (available > totalSlots / 2) result[dateStr] = 'green';
                    else result[dateStr] = 'yellow';
                }
                res.json(result);
            });
        });
    });
});

// --- Hair Booking (SQLite) ---
app.post('/api/hair/book', hairLimiter, (req, res) => {
    const { name, phone, email, service, date, time, message, website_url_fake } = req.body;

    if (website_url_fake) {
        console.log(`Spam blocked for Hair Beauty: ${phone}`);
        return res.status(200).json({ success: true, bookingId: 'spam-blocked' });
    }

    if (!name || !phone || !service || !date || !time) {
        return res.status(400).json({ error: 'Name, phone, service, date, and time are required.' });
    }

    dbHair.get(`SELECT id FROM bookings WHERE date = ? AND time = ? AND status != 'cancelled'`, [date, time], (err, row) => {
        if (err) return res.status(500).json({ error: 'DB klaida' });
        if (row) return res.status(409).json({ error: 'Šis laikas jau užimtas. Prašome pasirinkti kitą.' });

        dbHair.run(
            `INSERT INTO bookings (name, phone, email, service, date, time, message) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [name, phone, email || '', service, date, time, message || ''],
            function (err) {
                if (err) return res.status(500).json({ error: 'Klaida išsaugant' });
                res.status(201).json({ success: true, bookingId: this.lastID });
            }
        );
    });
});

app.get('/api/hair/bookings', requireHairAdmin, (req, res) => {
    dbHair.all(`SELECT * FROM bookings ORDER BY created_at DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: 'DB klaida' });
        // Map id -> _id for frontend compatibility
        res.json((rows || []).map(r => ({ ...r, _id: String(r.id) })));
    });
});

app.delete('/api/hair/bookings/:id', requireHairAdmin, (req, res) => {
    dbHair.run("DELETE FROM bookings WHERE id = ?", [req.params.id], function (err) {
        if (err) return res.status(500).json({ error: 'DB klaida' });
        res.json({ success: true });
    });
});

app.put('/api/hair/bookings/:id/status', requireHairAdmin, (req, res) => {
    if (!['pending', 'confirmed', 'completed', 'cancelled'].includes(req.body.status)) return res.status(400).json({ error: 'Bad status' });
    dbHair.run("UPDATE bookings SET status = ? WHERE id = ?", [req.body.status, req.params.id], function (err) {
        if (err) return res.status(500).json({ error: 'DB klaida' });
        res.json({ success: true });
    });
});

// Hair: Emergency Cancellation
app.post('/api/hair/admin/emergency-cancel', requireHairAdmin, (req, res) => {
    const { date, fullDay, startTime, endTime, reason } = req.body;
    if (!date) return res.status(400).json({ error: 'Data privaloma' });

    const whereClause = fullDay
        ? `date = ? AND status != 'cancelled'`
        : `date = ? AND time >= ? AND time <= ? AND status != 'cancelled'`;
    const params = fullDay ? [date] : [date, startTime, endTime];

    dbHair.all(`SELECT * FROM bookings WHERE ${whereClause}`, params, (err, bookings) => {
        if (err) return res.status(500).json({ error: 'DB klaida' });
        if (!bookings || bookings.length === 0) {
            dbHair.get("SELECT blockedDates FROM settings WHERE id = 1", [], (err, row) => {
                if (row) {
                    let blocked = []; try { blocked = JSON.parse(row.blockedDates || '[]'); } catch(e) {}
                    if (!blocked.includes(date)) {
                        blocked.push(date);
                        dbHair.run("UPDATE settings SET blockedDates = ? WHERE id = 1", [JSON.stringify(blocked)]);
                    }
                }
            });
            return res.json({ cancelledCount: 0, clients: [] });
        }

        const ids = bookings.map(b => b.id);
        const placeholders = ids.map(() => '?').join(',');
        dbHair.run(`UPDATE bookings SET status = 'cancelled' WHERE id IN (${placeholders})`, ids, function(err) {
            if (err) return res.status(500).json({ error: 'Klaida atšaukiant' });

            dbHair.get("SELECT blockedDates FROM settings WHERE id = 1", [], (err, row) => {
                if (row) {
                    let blocked = []; try { blocked = JSON.parse(row.blockedDates || '[]'); } catch(e) {}
                    if (!blocked.includes(date)) {
                        blocked.push(date);
                        dbHair.run("UPDATE settings SET blockedDates = ? WHERE id = 1", [JSON.stringify(blocked)]);
                    }
                }
            });

            const clients = bookings.map(b => ({ name: b.name, phone: b.phone, email: b.email || '', service: b.service, time: b.time, date: b.date }));
            res.json({ cancelledCount: bookings.length, clients });
        });
    });
});

// Hair: Send custom cancellation email
app.post('/api/hair/admin/send-cancel-email', requireHairAdmin, async (req, res) => {
    const { to, clientName, message } = req.body;
    if (!to || !message) return res.status(400).json({ error: 'El. paštas ir žinutė privalomi' });
    if (!emailTransporter) return res.status(500).json({ error: 'El. pašto siuntimas nesukonfigūruotas (trūksta GMAIL_USER / GMAIL_APP_PASSWORD)' });
    try {
        await emailTransporter.sendMail({
            from: `"Hair Beauty" <${process.env.GMAIL_USER}>`,
            to,
            subject: `Dėl Jūsų vizito — Hair Beauty`,
            text: message
        });
        res.json({ success: true });
    } catch (err) {
        console.error('Email send failed:', err.message);
        res.status(500).json({ error: 'Nepavyko išsiųsti: ' + err.message });
    }
});

// ==================== VELORA STUDIO API (/api/velora/*) ====================
const veloraLimiter = rLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 3, // limit each IP to 3 requests per windowMs
    message: { error: 'Per daug bandymų. Pabandykite dar kartą vėliau.' }
});

app.post('/api/velora/leads', veloraLimiter, async (req, res) => {
    try {
        const { name, email, date, time, message, website_url_fake } = req.body;

        // Honeypot check
        if (website_url_fake) {
            console.log(`Spam blocked for Velora: ${email}`);
            return res.status(200).json({ success: true }); // Silently reject spam bots
        }
        if (!name || !email || !date || !time) {
            return res.status(400).json({ error: 'Vardas, El. paštas, Data ir Laikas yra privalomi.' });
        }

        // Check if slot is already booked
        const existing = await VeloraLead.findOne({ date, time, status: { $ne: 'cancelled' } });
        if (existing) {
            console.log(`Velora: Slot ${date} ${time} is TAKEN by ${existing.name}`);
            return res.status(409).json({ error: 'Šis laikas jau užimtas. Prašome pasirinkti kitą.' });
        }

        const newLead = new VeloraLead({ name, email, date, time, message });
        await newLead.save();
        res.status(201).json({ success: true });
    } catch (err) {
        console.error('Velora Lead Error:', err);
        res.status(500).json({ error: 'Klaida', details: err.message });
    }
});

app.get('/api/velora/bookings/times/:date', async (req, res) => {
    try {
        const booked = await VeloraLead.find({ date: req.params.date, status: { $ne: 'cancelled' } }, { time: 1, _id: 0 });
        res.json(booked.map(b => b.time));
    } catch (err) { res.status(500).json({ error: 'Klaida' }); }
});

// Admin Auth Middleware for Velora
function requireVeloraAdmin(req, res, next) {
    if (req.session && req.session.isVeloraAdmin) return next();
    res.status(401).json({ error: 'Reikia prisijungti' });
}

app.post('/api/velora/admin/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        // Fallback for admin login
        if (username === 'admin' && password === (process.env.VELORA_ADMIN_PASS || 'changeme')) {
            req.session.isVeloraAdmin = true;
            return res.json({ success: true });
        }

        const admin = await VeloraAdmin.findOne({ username });
        if (!admin || !bcrypt.compareSync(password, admin.password)) {
            return res.status(401).json({ error: 'Neteisingi duomenys' });
        }
        req.session.isVeloraAdmin = true;
        req.session.veloraAdminId = admin._id;
        res.json({ success: true });
    } catch (err) {
        console.error('Velora login error:', err);
        res.status(500).json({ error: 'Klaida' });
    }
});

app.post('/api/velora/admin/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/velora/admin/leads', requireVeloraAdmin, async (req, res) => {
    try {
        const leads = await VeloraLead.find().sort({ created_at: -1 });
        res.json(leads);
    } catch (err) { res.status(500).json({ error: 'Klaida' }); }
});

app.patch('/api/velora/admin/leads/:id', requireVeloraAdmin, async (req, res) => {
    try {
        await VeloraLead.findByIdAndUpdate(req.params.id, { status: req.body.status });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Klaida' }); }
});

app.delete('/api/velora/admin/leads/:id', requireVeloraAdmin, async (req, res) => {
    try {
        await VeloraLead.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Klaida' }); }
});


// Explicit index routes for sub-sites (prevents SPA fallback from catching them)
app.get('/barbie', (req, res) => res.sendFile(path.join(__dirname, 'public/barbie', 'index.html')));
app.get('/nails', (req, res) => res.sendFile(path.join(__dirname, 'public/nails', 'index.html')));
app.get('/hair', (req, res) => res.sendFile(path.join(__dirname, 'public/hair', 'index.html')));
app.get(['/velora', '/velora/'], (req, res) => res.sendFile(path.join(__dirname, 'public/velora', 'index.html')));
// Admin panel routes
app.get('/barbie/admin', (req, res) => res.sendFile(path.join(__dirname, 'public/barbie', 'admin.html')));
app.get('/nails/admin', (req, res) => res.sendFile(path.join(__dirname, 'public/nails', 'admin.html')));
app.get('/hair/admin', (req, res) => res.sendFile(path.join(__dirname, 'public/hair', 'admin.html')));
app.get('/velora/admin', (req, res) => res.sendFile(path.join(__dirname, 'public/velora', 'admin.html')));
// Business website pages
app.get('/thank-you', (req, res) => res.sendFile(path.join(__dirname, 'public/website', 'thank-you.html')));
app.get('/privatumo-politika', (req, res) => res.sendFile(path.join(__dirname, 'public/website', 'privatumo-politika.html')));
app.get('/paslaugos-salygos', (req, res) => res.sendFile(path.join(__dirname, 'public/website', 'paslaugos-salygos.html')));
// Service showcase pages
app.use('/paslaugos', express.static(path.join(__dirname, 'public/website/paslaugos')));
// SEO files
app.get('/robots.txt', (req, res) => res.sendFile(path.join(__dirname, 'public/website', 'robots.txt')));
app.get('/sitemap.xml', (req, res) => res.sendFile(path.join(__dirname, 'public/website', 'sitemap.xml')));
// ==================== PORTAL API ====================
const PLAN_LIMITS = { free: 0, start: 0, growth: 3, pro: Infinity };
const ONE_OFF_CHANGE_PRICE = 1500; // €15.00 in cents

// Price ID → plan name mapping
function getPlanFromPriceId(priceId) {
    for (const [plan, prices] of Object.entries(PRICES)) {
        if (prices.monthly === priceId || prices.annual === priceId) return plan;
    }
    return 'start';
}

// Portal auth middleware
function requirePortalAuth(req, res, next) {
    if (!req.session.portalClientId) return res.status(401).json({ error: 'Neprisijungta' });
    next();
}

// Monthly reset check
async function checkMonthlyReset(client) {
    if (!client.month_reset_date) return client;
    const now = new Date();
    const reset = new Date(client.month_reset_date);
    if (now >= reset) {
        const nextReset = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString().split('T')[0];
        await portalRun('UPDATE clients SET changes_used_this_month = 0, month_reset_date = ? WHERE id = ?', [nextReset, client.id]);
        client.changes_used_this_month = 0;
        client.month_reset_date = nextReset;
    }
    return client;
}

// Config (sends Google Client ID to frontend)
app.get('/api/portal/config', (req, res) => {
    res.json({ googleClientId: process.env.GOOGLE_CLIENT_ID || '' });
});

// Google Sign-In
app.post('/api/portal/auth/google', async (req, res) => {
    const { credential } = req.body;
    if (!credential) return res.status(400).json({ error: 'Trūksta Google credential' });
    try {
        const ticket = await googleClient.verifyIdToken({
            idToken: credential,
            audience: process.env.GOOGLE_CLIENT_ID
        });
        const payload = ticket.getPayload();
        const email = payload.email;
        const name = payload.name || '';
        const picture = payload.picture || '';

        let client = await portalGet('SELECT * FROM clients WHERE google_email = ?', [email]);
        if (!client) {
            // Test account override (remove after testing)
            const isTest = email === 'gaidys.993@gmail.com';
            await portalRun(
                'INSERT INTO clients (google_email, google_name, google_picture, month_reset_date, plan, salon_slug) VALUES (?, ?, ?, ?, ?, ?)',
                [email, name, picture, new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString().split('T')[0], isTest ? 'pro' : 'free', isTest ? 'barbie' : '']
            );
            client = await portalGet('SELECT * FROM clients WHERE google_email = ?', [email]);
        } else {
            // Also fix existing test account
            if (email === 'gaidys.993@gmail.com' && client.plan !== 'pro') {
                await portalRun('UPDATE clients SET plan = ?, salon_slug = ? WHERE id = ?', ['pro', 'barbie', client.id]);
                client.plan = 'pro';
                client.salon_slug = 'barbie';
            }
            await portalRun('UPDATE clients SET google_name = ?, google_picture = ?, last_login = datetime("now") WHERE id = ?', [name, picture, client.id]);
        }

        client = await checkMonthlyReset(client);
        req.session.portalClientId = client.id;
        res.json({ success: true, profile: client });
    } catch (err) {
        console.error('Google auth error:', err.message);
        res.status(401).json({ error: 'Google prisijungimas nepavyko. Bandykite dar kartą.' });
    }
});

// Check session
app.get('/api/portal/auth/check', async (req, res) => {
    if (!req.session.portalClientId) return res.json({ loggedIn: false });
    try {
        let client = await portalGet('SELECT * FROM clients WHERE id = ?', [req.session.portalClientId]);
        if (!client) { req.session.portalClientId = null; return res.json({ loggedIn: false }); }
        client = await checkMonthlyReset(client);
        res.json({ loggedIn: true, profile: client });
    } catch {
        res.json({ loggedIn: false });
    }
});

// Logout
app.post('/api/portal/auth/logout', (req, res) => {
    req.session.portalClientId = null;
    res.json({ success: true });
});

// Get profile
app.get('/api/portal/profile', requirePortalAuth, async (req, res) => {
    try {
        let client = await portalGet('SELECT * FROM clients WHERE id = ?', [req.session.portalClientId]);
        client = await checkMonthlyReset(client);
        res.json(client);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get change requests (exclude large base64 blobs from list)
app.get('/api/portal/changes', requirePortalAuth, async (req, res) => {
    try {
        const changes = await portalAll(
            'SELECT id, client_id, category, description, status, admin_notes, created_at, completed_at, attachment_name FROM change_requests WHERE client_id = ? ORDER BY created_at DESC',
            [req.session.portalClientId]
        );
        res.json(changes);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Serve attachment image (client)
app.get('/api/portal/changes/:id/attachment', requirePortalAuth, async (req, res) => {
    try {
        const change = await portalGet(
            'SELECT attachment_base64, attachment_name FROM change_requests WHERE id = ? AND client_id = ?',
            [req.params.id, req.session.portalClientId]
        );
        if (!change || !change.attachment_base64) return res.status(404).json({ error: 'Nėra priedo' });
        const ext = change.attachment_name.toLowerCase().match(/\.[^.]+$/)?.[0] || '.jpg';
        const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };
        res.set('Content-Type', mimeMap[ext] || 'image/jpeg');
        res.send(Buffer.from(change.attachment_base64, 'base64'));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Submit change request
app.post('/api/portal/changes', requirePortalAuth, async (req, res) => {
    const { category, description, attachment_base64, attachment_name } = req.body;
    if (!category || !description) return res.status(400).json({ error: 'Kategorija ir aprašymas privalomi' });
    if (!['text', 'visual', 'service'].includes(category)) return res.status(400).json({ error: 'Neteisinga kategorija' });

    // Validate attachment if provided
    if (attachment_base64) {
        const maxSize = 2 * 1024 * 1024; // 2MB raw
        const rawSize = Math.ceil(attachment_base64.length * 3 / 4);
        if (rawSize > maxSize) return res.status(400).json({ error: 'Nuotrauka per didelė. Maksimalus dydis: 2MB.' });
        const validExts = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
        const ext = (attachment_name || '').toLowerCase().match(/\.[^.]+$/)?.[0];
        if (!ext || !validExts.includes(ext)) return res.status(400).json({ error: 'Netinkamas failo formatas. Leidžiami: JPG, PNG, WEBP, GIF.' });
    }

    try {
        let client = await portalGet('SELECT * FROM clients WHERE id = ?', [req.session.portalClientId]);
        client = await checkMonthlyReset(client);

        const limit = PLAN_LIMITS[client.plan] ?? 0;
        const purchased = client.purchased_changes || 0;

        if (client.plan === 'free') {
            return res.status(403).json({ error: 'Įsigykite planą, kad galėtumėte teikti užklausas.' });
        }

        if (client.plan === 'pro') {
            // Always allow
        } else if (limit > 0 && client.changes_used_this_month < limit) {
            // Use monthly allocation (GROWTH)
        } else if (purchased > 0) {
            // Use purchased change
            await portalRun('UPDATE clients SET purchased_changes = purchased_changes - 1 WHERE id = ?', [client.id]);
        } else {
            return res.status(403).json({ error: 'Pakeitimų limitas pasiektas. Pirkite pakeitimą arba atnaujinkite planą.' });
        }

        const result = await portalRun(
            'INSERT INTO change_requests (client_id, category, description, attachment_base64, attachment_name) VALUES (?, ?, ?, ?, ?)',
            [client.id, category, description, attachment_base64 || '', attachment_name || '']
        );

        // Only increment monthly counter if using monthly allocation (not purchased)
        if (client.plan !== 'pro' && limit > 0 && client.changes_used_this_month < limit) {
            await portalRun('UPDATE clients SET changes_used_this_month = changes_used_this_month + 1 WHERE id = ?', [client.id]);
        }

        // Trigger automated change application (fire-and-forget)
        if (result.lastID) {
            autoApplyChange(result.lastID, client.id).catch(err => {
                console.error('Auto-apply failed for change', result.lastID, err.message);
                portalRun('UPDATE change_requests SET status = ?, admin_notes = ? WHERE id = ?',
                    ['in_progress', `Automatinis pritaikymas nepavyko: ${err.message}`, result.lastID]).catch(() => {});
            });
        }

        const updated = await portalGet('SELECT changes_used_this_month, purchased_changes FROM clients WHERE id = ?', [client.id]);
        res.json({ success: true, changes_used: updated.changes_used_this_month, purchased_changes: updated.purchased_changes });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Buy a single change (one-off Stripe checkout)
app.post('/api/portal/buy-change', requirePortalAuth, async (req, res) => {
    try {
        const client = await portalGet('SELECT * FROM clients WHERE id = ?', [req.session.portalClientId]);
        if (!client || client.plan === 'free') {
            return res.status(403).json({ error: 'Pirmiausia įsigykite planą.' });
        }

        const session = await stripe.checkout.sessions.create({
            mode: 'payment',
            line_items: [{
                price_data: {
                    currency: 'eur',
                    product_data: { name: 'Pakeitimo užklausa — Velora Studio' },
                    unit_amount: ONE_OFF_CHANGE_PRICE,
                },
                quantity: 1,
            }],
            customer_email: client.google_email,
            metadata: { type: 'one-off-change', client_id: String(client.id) },
            success_url: `${process.env.SITE_URL || 'https://velora-mega-server.onrender.com'}/portal?purchased=1`,
            cancel_url: `${process.env.SITE_URL || 'https://velora-mega-server.onrender.com'}/portal`,
        });

        res.json({ url: session.url });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==================== PORTAL ADMIN (Velora admin manages change requests) ====================
app.get('/api/portal/admin/clients', requireVeloraAdmin, async (req, res) => {
    try {
        const clients = await portalAll('SELECT * FROM clients ORDER BY created_at DESC');
        res.json(clients);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/portal/admin/changes', requireVeloraAdmin, async (req, res) => {
    try {
        const changes = await portalAll(`
            SELECT cr.id, cr.client_id, cr.category, cr.description, cr.status, cr.admin_notes,
                   cr.created_at, cr.completed_at, cr.attachment_name, cr.pending_settings,
                   CASE WHEN (cr.pending_html != '' AND cr.pending_html IS NOT NULL) OR (cr.pending_settings != '' AND cr.pending_settings IS NOT NULL) THEN 1 ELSE 0 END as has_pending,
                   c.google_email, c.google_name, c.salon_name, c.plan
            FROM change_requests cr
            JOIN clients c ON cr.client_id = c.id
            ORDER BY cr.created_at DESC
        `);
        res.json(changes);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Admin: serve attachment
app.get('/api/portal/admin/changes/:id/attachment', requireVeloraAdmin, async (req, res) => {
    try {
        const change = await portalGet('SELECT attachment_base64, attachment_name FROM change_requests WHERE id = ?', [req.params.id]);
        if (!change || !change.attachment_base64) return res.status(404).json({ error: 'Nėra priedo' });
        const ext = change.attachment_name.toLowerCase().match(/\.[^.]+$/)?.[0] || '.jpg';
        const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };
        res.set('Content-Type', mimeMap[ext] || 'image/jpeg');
        res.send(Buffer.from(change.attachment_base64, 'base64'));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.patch('/api/portal/admin/changes/:id', requireVeloraAdmin, async (req, res) => {
    const { status, admin_notes } = req.body;
    if (!status) return res.status(400).json({ error: 'Status privalomas' });

    try {
        const completedAt = status === 'completed' ? new Date().toISOString() : '';
        await portalRun('UPDATE change_requests SET status = ?, admin_notes = ?, completed_at = ? WHERE id = ?',
            [status, admin_notes || '', completedAt, req.params.id]);

        // Send email notification when completed
        if (status === 'completed' && emailTransporter) {
            const change = await portalGet(`
                SELECT cr.*, c.google_email, c.google_name, c.salon_name
                FROM change_requests cr JOIN clients c ON cr.client_id = c.id
                WHERE cr.id = ?
            `, [req.params.id]);
            if (change && change.google_email) {
                const catLabels = { text: 'Teksto pakeitimai', visual: 'Vizualiniai pakeitimai', service: 'Paslaugos / kainos' };
                try {
                    await emailTransporter.sendMail({
                        from: `"Velora Studio" <${process.env.GMAIL_USER}>`,
                        to: change.google_email,
                        subject: 'Jūsų pakeitimas atliktas — Velora Studio',
                        text: `Sveiki, ${change.google_name || ''}!\n\nJūsų užklausa „${catLabels[change.category] || change.category}" buvo sėkmingai įgyvendinta.\n\nPeržiūrėkite savo svetainę ir įsitikinkite, kad viskas atrodo puikiai.\n\nPagarbiai,\nVelora Studio`
                    });
                } catch (emailErr) {
                    console.error('Portal notification email failed:', emailErr.message);
                }
            }
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Admin: update client plan manually
app.patch('/api/portal/admin/clients/:id', requireVeloraAdmin, async (req, res) => {
    const { plan, salon_name, salon_slug } = req.body;
    try {
        const sets = [];
        const params = [];
        if (plan) { sets.push('plan = ?'); params.push(plan); }
        if (salon_name) { sets.push('salon_name = ?'); params.push(salon_name); }
        if (salon_slug) { sets.push('salon_slug = ?'); params.push(salon_slug); }
        if (!sets.length) return res.status(400).json({ error: 'Nėra ką keisti' });
        params.push(req.params.id);
        await portalRun(`UPDATE clients SET ${sets.join(', ')} WHERE id = ?`, params);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==================== AUTOMATED CHANGE APPLICATION ====================

// Claude API client (conditional)
const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_REPO = process.env.GITHUB_REPO || 'Darbastoks/Mega-Monorepo';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

const CSS_PATHS = {
    barbie: 'public/barbie/css/styles.css',
    hair: 'public/hair/styles.css',
    nails: 'public/nails/css/style.css'
};

const SALON_DBS = { barbie: dbBarbie, hair: dbHair, nails: dbNails };

function getSalonSettings(slug) {
    return new Promise((resolve, reject) => {
        const salonDb = SALON_DBS[slug];
        if (!salonDb) return resolve(null);
        salonDb.get("SELECT * FROM settings WHERE id = 1", [], (err, row) => {
            if (err) return reject(err);
            if (!row) return resolve({ workingDays: [1,2,3,4,5,6], startHour: '09:00', endHour: '18:30', breaks: [], blockedDates: [] });
            try { row.workingDays = JSON.parse(row.workingDays || '[1,2,3,4,5,6]'); } catch(e) { row.workingDays = [1,2,3,4,5,6]; }
            try { row.breaks = JSON.parse(row.breaks || '[]'); } catch(e) { row.breaks = []; }
            try { row.blockedDates = JSON.parse(row.blockedDates || '[]'); } catch(e) { row.blockedDates = []; }
            resolve(row);
        });
    });
}

function updateSalonSettings(slug, settings) {
    return new Promise((resolve, reject) => {
        const salonDb = SALON_DBS[slug];
        if (!salonDb) return reject(new Error('Nežinomas salonas: ' + slug));
        // Build dynamic UPDATE from the settings object
        const allowed = ['workingDays', 'startHour', 'endHour', 'breaks', 'blockedDates'];
        const sets = [];
        const params = [];
        for (const key of allowed) {
            if (settings[key] !== undefined) {
                sets.push(`${key} = ?`);
                params.push(typeof settings[key] === 'string' ? settings[key] : JSON.stringify(settings[key]));
            }
        }
        if (sets.length === 0) return resolve();
        params.push(1); // WHERE id = 1
        salonDb.run(`UPDATE settings SET ${sets.join(', ')} WHERE id = ?`, params, function(err) {
            if (err) return reject(err);
            resolve();
        });
    });
}

// Startup automation config logging
console.log('--- Automation config ---');
console.log('  Anthropic API:', anthropic ? '✅ ready' : '❌ missing ANTHROPIC_API_KEY');
console.log('  GitHub:', GITHUB_TOKEN ? '✅ ready' : '❌ missing GITHUB_TOKEN');
console.log('  GitHub Repo:', GITHUB_REPO);
console.log('  Telegram Bot:', TELEGRAM_BOT_TOKEN ? '✅ ready' : '❌ missing TELEGRAM_BOT_TOKEN');
console.log('  Telegram Chat:', TELEGRAM_CHAT_ID ? '✅ ready' : '❌ missing TELEGRAM_CHAT_ID');
console.log('------------------------');

// --- GitHub API helpers ---
async function ghFetch(url, options = {}) {
    const res = await fetch(`https://api.github.com${url}`, {
        ...options,
        headers: { 'Authorization': `Bearer ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github+json', ...options.headers }
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
    return res.json();
}

async function fetchFileFromGitHub(filePath) {
    const data = await ghFetch(`/repos/${GITHUB_REPO}/contents/${filePath}`);
    return { content: Buffer.from(data.content, 'base64').toString('utf8'), sha: data.sha };
}

async function commitFilesToGitHub(files, message) {
    // Get latest commit SHA on main
    const ref = await ghFetch(`/repos/${GITHUB_REPO}/git/ref/heads/main`);
    const latestCommitSha = ref.object.sha;

    // Get the tree of the latest commit
    const commit = await ghFetch(`/repos/${GITHUB_REPO}/git/commits/${latestCommitSha}`);
    const baseTreeSha = commit.tree.sha;

    // Create blobs for each file
    const tree = [];
    for (const f of files) {
        const blob = await ghFetch(`/repos/${GITHUB_REPO}/git/blobs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: f.content, encoding: 'utf-8' })
        });
        tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
    }

    // Create new tree
    const newTree = await ghFetch(`/repos/${GITHUB_REPO}/git/trees`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base_tree: baseTreeSha, tree })
    });

    // Create commit
    const newCommit = await ghFetch(`/repos/${GITHUB_REPO}/git/commits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, tree: newTree.sha, parents: [latestCommitSha] })
    });

    // Update ref
    await ghFetch(`/repos/${GITHUB_REPO}/git/refs/heads/main`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sha: newCommit.sha })
    });

    return newCommit.sha;
}

// --- Telegram helpers ---
async function sendTelegram(text, inlineKeyboard) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
        console.log('Telegram skipped: missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID');
        return;
    }
    try {
        const body = {
            chat_id: TELEGRAM_CHAT_ID,
            text,
            parse_mode: 'HTML'
        };
        if (inlineKeyboard) body.reply_markup = JSON.stringify({ inline_keyboard: inlineKeyboard });
        const resp = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await resp.json();
        if (!data.ok) console.error('Telegram API error:', data.description);
        else console.log('Telegram message sent successfully');
    } catch (err) {
        console.error('Telegram send failed:', err.message);
    }
}

// --- Approve / Reject reusable functions ---
async function approveChange(changeId) {
    const change = await portalGet('SELECT * FROM change_requests WHERE id = ?', [changeId]);
    if (!change || !change.pending_html) {
        return { ok: false, error: 'Nėra laukiančio pakeitimo' };
    }

    const client = await portalGet('SELECT * FROM clients WHERE id = ?', [change.client_id]);
    const slug = client?.salon_slug;
    const htmlPath = `public/${slug}/index.html`;
    const cssPath = CSS_PATHS[slug];

    const files = [{ path: htmlPath, content: change.pending_html }];
    if (change.pending_css) files.push({ path: cssPath, content: change.pending_css });

    const catLabels = { text: 'Tekstas', visual: 'Dizainas', service: 'Paslaugos' };
    await commitFilesToGitHub(files, `Auto: ${catLabels[change.category] || change.category} — ${change.description.substring(0, 50)}`);

    // Apply settings changes if any
    if (change.pending_settings) {
        try {
            const settingsToApply = JSON.parse(change.pending_settings);
            await updateSalonSettings(slug, settingsToApply);
            console.log(`Settings updated for ${slug}:`, settingsToApply);
        } catch (e) { console.error('Failed to apply settings:', e.message); }
    }

    await portalRun('UPDATE change_requests SET status = ?, admin_notes = ?, completed_at = ?, pending_html = \'\', pending_css = \'\', pending_settings = \'\' WHERE id = ?',
        ['completed', 'Pakeitimas pritaikytas automatiškai per AI', new Date().toISOString(), changeId]);

    // Send completion email to client
    if (emailTransporter && client.google_email) {
        try {
            await emailTransporter.sendMail({
                from: `"Velora Studio" <${process.env.GMAIL_USER}>`,
                to: client.google_email,
                subject: 'Jūsų pakeitimas atliktas — Velora Studio',
                text: `Sveiki, ${client.google_name || ''}!\n\nJūsų užklausa buvo sėkmingai įgyvendinta.\n\nPeržiūrėkite savo svetainę ir įsitikinkite, kad viskas atrodo puikiai.\n\nPagarbiai,\nVelora Studio`
            });
        } catch (e) { console.error('Email failed:', e.message); }
    }

    console.log(`Change #${changeId} approved and committed to GitHub`);
    return { ok: true };
}

async function reeditChange(changeId, correction) {
    if (!anthropic) return { ok: false, error: 'Anthropic API nenustatytas' };

    const change = await portalGet('SELECT * FROM change_requests WHERE id = ?', [changeId]);
    if (!change || !change.pending_html) return { ok: false, error: 'Nėra laukiančio pakeitimo koregavimui' };

    const client = await portalGet('SELECT * FROM clients WHERE id = ?', [change.client_id]);
    const slug = client?.salon_slug;
    const pendingSettings = change.pending_settings ? `\n\nDABARTINIAI LAUKIANTYS NUSTATYMŲ PAKEITIMAI:\n${change.pending_settings}` : '';

    // Call Claude with the correction
    const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 16000,
        messages: [{ role: 'user', content: `Tu esi web programuotojas. Ankstesnis pakeitimas buvo netinkamas. Administratorius prašo korekcijos.

ADMINISTRATORIAUS KOREKCIJA: ${correction}

ORIGINALUS KLIENTO PRAŠYMAS: ${change.description}

DABARTINIS HTML (kurį reikia pataisyti):
\`\`\`html
${change.pending_html}
\`\`\`

DABARTINIS CSS:
\`\`\`css
${change.pending_css}
\`\`\`${pendingSettings}

Padaryk TIK tai, ko administratorius prašo korekcijoje. Nekeisk nieko kito. Nepridėk komentarų į kodą.
Išsaugok visas esamas klases, ID, JavaScript hooks ir struktūrą.

Grąžink pakeistus failus tokiu formatu:
<html_file>
(visas pakeistas HTML čia)
</html_file>

<css_file>
(visas pakeistas CSS čia)
</css_file>

Jei reikia keisti nustatymus (darbo valandas, dienas, pertraukas), papildomai grąžink:
<settings_changes>
{"startHour":"10:00","endHour":"18:00"}
</settings_changes>
Galimi laukai: startHour, endHour, workingDays, breaks.
Jei nereikia keisti nustatymų — NEGRĄŽINK settings_changes bloko.` }]
    });

    const result = parseClaudeResponse(response.content[0].text);

    if (!result.html || !result.html.includes('<!DOCTYPE') || !result.html.includes('</html>')) {
        return { ok: false, error: 'AI grąžino netinkamą HTML — bandykite dar kartą' };
    }

    // Update pending changes in DB (HTML/CSS + settings)
    await portalRun('UPDATE change_requests SET pending_html = ?, pending_css = ?, pending_settings = ?, admin_notes = ? WHERE id = ?',
        [result.html, result.css || change.pending_css, result.settings ? JSON.stringify(result.settings) : (change.pending_settings || ''), `Koreguota: ${correction}`, changeId]);

    // Notify via Telegram
    const salonName = client?.salon_name || client?.salon_slug || '?';
    const settingsNote = result.settings ? `\n⚙️ Nustatymai: ${JSON.stringify(result.settings)}` : '';
    await sendTelegram(`✏️ Pakeitimas #${changeId} (${salonName}) — atnaujintas po korekcijos.\nKorekcija: ${correction}${settingsNote}\n\nPeržiūrėkite iš naujo admin panelėje.`);

    console.log(`Change #${changeId} re-edited with correction: ${correction}`);
    return { ok: true };
}

async function dismissChange(changeId) {
    await portalRun('UPDATE change_requests SET status = ?, admin_notes = ?, pending_html = \'\', pending_css = \'\' WHERE id = ?',
        ['rejected', 'Atmesta admin panelėje', changeId]);
    console.log(`Change #${changeId} dismissed`);
    return { ok: true };
}

// --- Preview endpoint (admin reviews AI-generated change) ---
app.get('/api/portal/admin/changes/:id/preview', requireVeloraAdmin, async (req, res) => {
    try {
        const change = await portalGet('SELECT pending_html, pending_settings FROM change_requests WHERE id = ?', [req.params.id]);
        if (!change || !change.pending_html) {
            return res.status(404).send('<h1>Nėra laukiančio pakeitimo peržiūrai</h1><p>Šis pakeitimas jau buvo patvirtintas arba atmestas.</p>');
        }

        let html = change.pending_html;

        // Inject settings overrides so booking dropdown reflects pending changes
        if (change.pending_settings) {
            try {
                const ps = JSON.parse(change.pending_settings);
                if (ps.startHour || ps.endHour) {
                    const params = [];
                    if (ps.startHour) params.push(`overrideStart=${ps.startHour}`);
                    if (ps.endHour) params.push(`overrideEnd=${ps.endHour}`);
                    const overrideQS = params.join('&');
                    const overrideScript = `<script>
(function(){
    var _fetch = window.fetch;
    window.fetch = function(url, opts) {
        if (typeof url === 'string' && url.includes('/bookings/times/')) {
            url += (url.includes('?') ? '&' : '?') + '${overrideQS}';
        }
        return _fetch.call(this, url, opts);
    };
})();
</script>`;
                    html = html.replace('</head>', overrideScript + '\n</head>');
                }
            } catch(e) { console.error('Preview settings inject error:', e.message); }
        }

        res.setHeader('Content-Type', 'text/html');
        res.send(html);
    } catch (err) {
        console.error('Preview error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- Admin approve/reject API endpoints ---
app.post('/api/portal/admin/changes/:id/approve', requireVeloraAdmin, async (req, res) => {
    try {
        const result = await approveChange(parseInt(req.params.id, 10));
        if (!result.ok) return res.status(400).json({ error: result.error });
        res.json({ ok: true, message: 'Pakeitimas patvirtintas ir įkeltas į GitHub' });
    } catch (err) {
        console.error('Admin approve error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/portal/admin/changes/:id/reedit', requireVeloraAdmin, async (req, res) => {
    try {
        const correction = req.body?.correction;
        if (!correction || !correction.trim()) return res.status(400).json({ error: 'Nurodykite korekciją' });
        const result = await reeditChange(parseInt(req.params.id, 10), correction.trim());
        if (!result.ok) return res.status(400).json({ error: result.error });
        res.json({ ok: true, message: 'Pakeitimas atnaujintas — peržiūrėkite iš naujo' });
    } catch (err) {
        console.error('Admin re-edit error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/portal/admin/changes/:id/dismiss', requireVeloraAdmin, async (req, res) => {
    try {
        const result = await dismissChange(parseInt(req.params.id, 10));
        if (!result.ok) return res.status(400).json({ error: result.error });
        res.json({ ok: true, message: 'Pakeitimas atmestas' });
    } catch (err) {
        console.error('Admin dismiss error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Telegram webhook — receives button callback
app.post('/webhook/telegram', express.json(), async (req, res) => {
    res.json({ ok: true }); // respond immediately

    const callback = req.body?.callback_query;
    if (!callback) return;

    const data = callback.data; // e.g., "approve:42" or "reject:42"
    const [action, changeIdStr] = data.split(':');
    const changeId = parseInt(changeIdStr, 10);
    if (!changeId) return;

    try {
        if (action === 'approve') {
            const result = await approveChange(changeId);
            if (!result.ok) {
                await answerCallback(callback.id, result.error);
                return;
            }
            await answerCallback(callback.id, '✅ Patvirtinta! Render diegia...');
            await editTelegramMessage(callback.message, `✅ PATVIRTINTA — #${changeId}`);
        }
    } catch (err) {
        console.error('Telegram callback error:', err.message);
        await answerCallback(callback.id, 'Klaida: ' + err.message);
    }
});

async function answerCallback(callbackId, text) {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: callbackId, text })
    });
}

async function editTelegramMessage(message, newText) {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: message.chat.id, message_id: message.message_id, text: newText, parse_mode: 'HTML' })
    });
}

// --- Claude prompt & parser ---
function buildChangePrompt(change, currentHtml, currentCss, settings) {
    const catLabels = { text: 'teksto pakeitimas', visual: 'dizaino pakeitimas', service: 'paslaugų pakeitimas' };
    const dayNames = { 1:'Pirm', 2:'Antr', 3:'Treč', 4:'Ketv', 5:'Penkt', 6:'Šešt', 7:'Sekm' };
    const workingDaysStr = settings?.workingDays ? settings.workingDays.map(d => dayNames[d] || d).join(', ') : 'nežinoma';

    return `Tu esi web programuotojas. Klientas prašo pakeisti savo svetainę.

UŽKLAUSA: ${catLabels[change.category] || change.category}
APRAŠYMAS: ${change.description}

Padaryk TIK tai, ko klientas prašo. Nekeisk nieko kito. Nepridėk komentarų į kodą.
Išsaugok visas esamas klases, ID, JavaScript hooks ir struktūrą.

DABARTINIS HTML:
\`\`\`html
${currentHtml}
\`\`\`

DABARTINIS CSS:
\`\`\`css
${currentCss}
\`\`\`

DABARTINIAI SVETAINĖS NUSTATYMAI (duomenų bazė — valdo rezervacijos laikų dropdown):
- Darbo pradžia: ${settings?.startHour || '09:00'}
- Darbo pabaiga: ${settings?.endHour || '18:30'}
- Darbo dienos: ${workingDaysStr}
- Pertraukos: ${JSON.stringify(settings?.breaks || [])}

Grąžink pakeistus failus tokiu formatu:
<html_file>
(visas pakeistas HTML čia)
</html_file>

<css_file>
(visas pakeistas CSS čia — jei nereikėjo keisti CSS, vis tiek grąžink originalą)
</css_file>

Jei klientas prašo keisti darbo valandas, darbo dienas, pertraukas ar kitus nustatymus,
papildomai grąžink TIK tuos laukus, kuriuos reikia keisti:
<settings_changes>
{"startHour":"10:00","endHour":"18:00"}
</settings_changes>
Galimi laukai: startHour, endHour, workingDays (masyvas skaičių 1-7), breaks (masyvas objektų [{start,end}]).
Jei nereikia keisti nustatymų — NEGRĄŽINK settings_changes bloko.`;
}

function parseClaudeResponse(text) {
    const htmlMatch = text.match(/<html_file>\s*([\s\S]*?)\s*<\/html_file>/);
    const cssMatch = text.match(/<css_file>\s*([\s\S]*?)\s*<\/css_file>/);
    const settingsMatch = text.match(/<settings_changes>\s*([\s\S]*?)\s*<\/settings_changes>/);
    let settings = null;
    if (settingsMatch) {
        try { settings = JSON.parse(settingsMatch[1].trim()); } catch(e) { console.error('Failed to parse settings_changes:', e.message); }
    }
    return {
        html: htmlMatch ? htmlMatch[1].trim() : null,
        css: cssMatch ? cssMatch[1].trim() : null,
        settings
    };
}

// --- Main automation pipeline ---
async function autoApplyChange(changeId, clientId) {
    // Guard: check required env vars
    if (!anthropic || !GITHUB_TOKEN || !GITHUB_REPO) {
        console.log('Auto-apply skipped: missing ANTHROPIC_API_KEY or GITHUB_TOKEN');
        return;
    }

    const client = await portalGet('SELECT * FROM clients WHERE id = ?', [clientId]);
    if (!client || !client.salon_slug) {
        await portalRun('UPDATE change_requests SET status = ?, admin_notes = ? WHERE id = ?',
            ['in_progress', 'Salonas nepriskirtas klientui — priskirkite salon_slug admin panelėje', changeId]);
        await sendTelegram(`⚠️ Pakeitimas #${changeId} — salonas nepriskirtas klientui ${client?.google_name || client?.google_email || clientId}`);
        return;
    }

    const change = await portalGet('SELECT * FROM change_requests WHERE id = ?', [changeId]);
    const slug = client.salon_slug;
    const htmlPath = `public/${slug}/index.html`;
    const cssPath = CSS_PATHS[slug];

    if (!cssPath) {
        await portalRun('UPDATE change_requests SET status = ?, admin_notes = ? WHERE id = ?',
            ['in_progress', `Nežinomas salonas: ${slug}`, changeId]);
        return;
    }

    // Fetch current files from GitHub + salon settings from database
    const [htmlFile, cssFile, salonSettings] = await Promise.all([
        fetchFileFromGitHub(htmlPath),
        fetchFileFromGitHub(cssPath),
        getSalonSettings(slug)
    ]);

    // Build Claude messages
    const contentBlocks = [];

    // Include image if present
    if (change.attachment_base64 && change.attachment_name) {
        const ext = change.attachment_name.toLowerCase().match(/\.[^.]+$/)?.[0] || '.jpg';
        const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };
        contentBlocks.push({
            type: 'image',
            source: { type: 'base64', media_type: mimeMap[ext] || 'image/jpeg', data: change.attachment_base64 }
        });
    }

    contentBlocks.push({
        type: 'text',
        text: buildChangePrompt(change, htmlFile.content, cssFile.content, salonSettings)
    });

    // Call Claude
    const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 16000,
        messages: [{ role: 'user', content: contentBlocks }]
    });

    const result = parseClaudeResponse(response.content[0].text);

    // Validate
    if (!result.html || !result.html.includes('<!DOCTYPE') || !result.html.includes('</html>')) {
        await portalRun('UPDATE change_requests SET status = ?, admin_notes = ? WHERE id = ?',
            ['in_progress', 'AI grąžino netinkamą HTML — reikia rankinės peržiūros', changeId]);
        await sendTelegram(`⚠️ Pakeitimas #${changeId} — AI grąžino netinkamą rezultatą. Reikia rankinės peržiūros.`);
        return;
    }

    // Store pending changes (HTML/CSS + settings if any)
    await portalRun('UPDATE change_requests SET pending_html = ?, pending_css = ?, pending_settings = ?, status = ? WHERE id = ?',
        [result.html, result.css || cssFile.content, result.settings ? JSON.stringify(result.settings) : '', 'in_progress', changeId]);

    // Send Telegram notification with preview link + approve button
    const catLabels = { text: 'Tekstas', visual: 'Dizainas', service: 'Paslaugos' };
    const salonName = client.salon_name || slug;
    const siteUrl = process.env.SITE_URL || 'https://velora-mega-server.onrender.com';
    const previewUrl = `${siteUrl}/velora/admin.html#review-${changeId}`;
    const settingsNote = result.settings ? `\n⚙️ <b>Nustatymų pakeitimai:</b> ${JSON.stringify(result.settings)}` : '';
    const msg = `📋 <b>Naujas pakeitimas — ${salonName}</b>\n\n` +
        `<b>Kategorija:</b> ${catLabels[change.category] || change.category}\n` +
        `<b>Klientas:</b> ${client.google_name || client.google_email}\n` +
        `<b>Aprašymas:</b> ${change.description}${settingsNote}\n\n` +
        `🔗 <a href="${previewUrl}">Peržiūrėti admin panelėje</a>\n\n` +
        `AI paruošė pakeitimą. Peržiūrėk prieš tvirtinant!`;

    await sendTelegram(msg, [
        [
            { text: '👁 Peržiūra', url: previewUrl },
            { text: '✅ Patvirtinti', callback_data: `approve:${changeId}` }
        ]
    ]);

    console.log(`Auto-apply: change #${changeId} pending review (Telegram sent)`);
}

// 404 fallback
app.use((req, res) => {
    if (req.accepts('html')) {
        return res.status(404).sendFile(path.join(__dirname, 'public/website', '404.html'));
    }
    res.status(404).json({ error: 'Not found' });
});


// Start Database Connections & Then Start Server
async function startServer() {
    console.log('Attempting to initialize databases...');
    try {
        // Wait for both databases to initialize/attempt connection
        await Promise.all([
            initDatabase(),
            initVeloraDatabase()
        ]);

        app.listen(PORT, () => {
            console.log(`✅ MEGA-MONOREPO Server running on port ${PORT}`);
            console.log(` - Velora: http://localhost:${PORT}/`);
            console.log(` - Barbie: http://localhost:${PORT}/barbie/`);
            console.log(` - Nails:  http://localhost:${PORT}/nails/`);
        });
    } catch (err) {
        console.error('CRITICAL: Failed to start server due to database error:', err);
        process.exit(1);
    }
}

startServer();
