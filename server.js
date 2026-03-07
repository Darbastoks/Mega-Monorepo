require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const rLimit = require('express-rate-limit');

// Barbie MongoDB models
const { initDatabase, Admin, Service, Booking } = require('./backend/barbie/database');
// HairBeauty Mongoose model (shares Barbie DB connection)
const GretaBooking = require('./backend/hair/GretaBooking');
// Nails SQLite db
const dbNails = require('./backend/nails/database');
// Velora Lead & Admin
const { VeloraAdmin, VeloraLead, initVeloraDatabase } = require('./backend/velora/database');

const mongoose = require('mongoose');
mongoose.set('bufferCommands', false); // Disable buffering to prevent hanging
const app = express();
const PORT = process.env.PORT || 3000;

// 1. Body Parsers (MUST BE FIRST)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 2. Middlewares
app.use(cors());
app.use(session({
    secret: process.env.SESSION_SECRET || 'mega-monorepo-secret-2024',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// 3. Static Files (MUST BE BEFORE ROOT CATCH-ALL)
app.use('/barbie', express.static(path.join(__dirname, 'public/barbie')));
app.use('/nails', express.static(path.join(__dirname, 'public/nails')));
app.use('/hair', express.static(path.join(__dirname, 'public/hair')));
app.use(express.static(path.join(__dirname, 'public/velora')));


// ==================== BARBIE BARBER API ====================
app.get('/api/barbie/services', async (req, res) => {
    try {
        const services = await Service.find().sort({ sort_order: 1 });
        res.json(services);
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

        const newBooking = new Booking({ name, phone, email, service, date, time, message });
        await newBooking.save();
        res.status(201).json({ success: true });
    } catch (err) {
        console.error('Barbie Book Error:', err);
        res.status(500).json({ error: 'Serverio klaida' });
    }
});

app.get('/api/barbie/bookings/times/:date', async (req, res) => {
    try {
        const bookedTimes = await Booking.find({ date: req.params.date, status: { $ne: 'cancelled' } }, { time: 1, _id: 0 });
        res.json(bookedTimes.map(b => b.time));
    } catch (err) { res.status(500).json({ error: 'Klaida' }); }
});

// --- Admin Auth ---
function requireBarbieAdmin(req, res, next) {
    if (req.session && req.session.isBarbieAdmin) return next();
    res.status(401).json({ error: 'Reikia prisijungti' });
}

app.post('/api/barbie/admin/login', async (req, res) => {
    const { username, password } = req.body;
    if (username === 'admin' && password === 'barber2024') {
        req.session.isBarbieAdmin = true;
        return res.json({ success: true });
    }
    try {
        const admin = await Admin.findOne({ username });
        if (admin && bcrypt.compareSync(password, admin.password)) {
            req.session.isBarbieAdmin = true;
            return res.json({ success: true });
        }
        res.status(401).json({ error: 'Neteisingi duomenys' });
    } catch (err) { res.status(500).json({ error: 'Klaida' }); }
});

app.post('/api/barbie/admin/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/barbie/admin/check', requireBarbieAdmin, (req, res) => res.json({ isAdmin: true }));

app.get('/api/barbie/admin/bookings', requireBarbieAdmin, async (req, res) => {
    try {
        const bookings = await Booking.find().sort({ date: -1, time: 1 });
        res.json(bookings.map(b => ({ ...b.toObject(), id: b._id })));
    } catch (err) { res.status(500).json({ error: 'Klaida' }); }
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
        admin.password = bcrypt.hashSync(newPassword, 10);
        await admin.save();
        res.json({ success: true, message: 'Slaptažodis pakeistas sėkmingai' });
    } catch (err) { res.status(500).json({ error: 'Klaida' }); }
});


// ==================== NAILS BY LUKRA API (/api/nails/*) ====================
app.get('/api/nails/available-times', (req, res) => {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: 'Data privaloma' });
    dbNails.all(`SELECT time FROM reservations WHERE date = ? AND status != 'cancelled'`, [date], (err, rows) => {
        if (err) return res.status(500).json({ error: 'DB klaida' });
        res.json({ bookedTimes: rows.map(r => r.time) });
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

app.get('/api/nails/reservations', (req, res) => {
    dbNails.all(`SELECT * FROM reservations ORDER BY date DESC, time ASC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Klaida' });
        res.json(rows);
    });
});

app.patch('/api/nails/reservations/:id/status', (req, res) => {
    dbNails.run(`UPDATE reservations SET status = ? WHERE id = ?`, [req.body.status, req.params.id], function (err) {
        if (err) return res.status(500).json({ error: 'Klaida' });
        res.json({ success: true });
    });
});


// ==================== HAIR BEAUTY API (/api/hair/*) ====================
const hairLimiter = rLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 3,
    message: { error: 'Per daug bandymų. Pabandykite dar kartą vėliau.' }
});

app.post('/api/hair/book', hairLimiter, async (req, res) => {
    try {
        const { name, phone, service, date, time, message, website_url_fake } = req.body;

        // Anti-Spam Honeypot
        if (website_url_fake) {
            console.log(`Spam blocked for Hair Beauty: ${phone}`);
            return res.status(200).json({ success: true, bookingId: 'spam-blocked' });
        }

        if (!name || !phone || !service || !date || !time) {
            return res.status(400).json({ error: 'Name, phone, service, date, and time are required.' });
        }

        // Check if slot is already booked
        const existing = await GretaBooking.findOne({ date, time, status: { $ne: 'cancelled' } });
        if (existing) {
            return res.status(409).json({ error: 'Šis laikas jau užimtas. Prašome pasirinkti kitą.' });
        }

        const newB = new GretaBooking({ name, phone, service, date, time, message });
        const saved = await newB.save();
        res.status(201).json({ success: true, bookingId: saved._id });
    } catch (err) {
        console.error('Hair Book Error:', err);
        res.status(500).json({ error: 'Failed', details: err.message });
    }
});

app.get('/api/hair/bookings/times/:date', async (req, res) => {
    try {
        const booked = await GretaBooking.find({ date: req.params.date, status: { $ne: 'cancelled' } }, { time: 1, _id: 0 });
        res.json(booked.map(b => b.time));
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

const GRETA_ADMIN_PASS = 'greta123';

// Explicit route for hair admin to ensure latest file is served
app.get('/hair/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/hair/admin.html'));
});

// --- Admin Auth for Hair ---
function requireHairAdmin(req, res, next) {
    if (req.session && req.session.isHairAdmin) return next();
    res.status(401).json({ error: 'Reikia prisijungti' });
}

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

app.get('/api/hair/bookings', requireHairAdmin, async (req, res) => {
    try {
        const bookings = await GretaBooking.find().sort({ createdAt: -1 });
        res.json(bookings);
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.delete('/api/hair/bookings/:id', requireHairAdmin, async (req, res) => {
    try {
        await GretaBooking.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.put('/api/hair/bookings/:id/status', requireHairAdmin, async (req, res) => {
    if (!['pending', 'confirmed', 'completed', 'cancelled'].includes(req.body.status)) return res.status(400).json({ error: 'Bad status' });
    try {
        const b = await GretaBooking.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true });
        res.json({ success: true, booking: b });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
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
        if (username === 'admin' && password === 'velora2024') {
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
// Admin panel routes
app.get('/barbie/admin', (req, res) => res.sendFile(path.join(__dirname, 'public/barbie', 'admin.html')));
app.get('/nails/admin', (req, res) => res.sendFile(path.join(__dirname, 'public/nails', 'admin.html')));
app.get('/hair/admin', (req, res) => res.sendFile(path.join(__dirname, 'public/hair', 'admin.html')));
app.get('/velora/admin', (req, res) => res.sendFile(path.join(__dirname, 'public/velora', 'admin.html')));
// Fallback: everything else goes to Velora Studio
app.use((req, res) => res.sendFile(path.join(__dirname, 'public/velora', 'index.html')));


// Start Database Connections (Non-blocking)
console.log('Attempting to initialize databases...');
initDatabase().catch(err => console.error('MongoDB (Barbie) Error:', err.message));
initVeloraDatabase().catch(err => console.error('MongoDB (Velora) Error:', err.message));

app.listen(PORT, () => {
    console.log(`MEGA-MONOREPO Server running on port ${PORT}`);
    console.log(` - Velora: http://localhost:${PORT}/`);
    console.log(` - Barbie: http://localhost:${PORT}/barbie/`);
    console.log(` - Nails:  http://localhost:${PORT}/nails/`);
});
