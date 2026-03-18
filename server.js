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

app.use(express.json());
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

        const startOfDayMins = timeToMins(settings.startHour);
        const endOfDayMins = timeToMins(settings.endHour);
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

            const startOfDayMins = timeToMins(settings.startHour);
            const endOfDayMins = timeToMins(settings.endHour);

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
    const { name, phone, service, date, time, notes, website_url_fake } = req.body;

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
            `INSERT INTO reservations (name, phone, service, date, time, notes) VALUES (?, ?, ?, ?, ?, ?)`,
            [name, phone, service, date, time, notes],
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

            const startOfDayMins = timeToMins(settings.startHour);
            const endOfDayMins = timeToMins(settings.endHour);

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
    const { name, phone, service, date, time, message, website_url_fake } = req.body;

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
            `INSERT INTO bookings (name, phone, service, date, time, message) VALUES (?, ?, ?, ?, ?, ?)`,
            [name, phone, service, date, time, message || ''],
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
