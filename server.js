require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcryptjs');

// Barbie MongoDB models
const { initDatabase, Admin, Service, Booking } = require('./backend/barbie/database');
// Nails SQLite db
const dbNails = require('./backend/nails/database');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: process.env.SESSION_SECRET || 'mega-monorepo-secret-2024',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// ==================== STATIC FRONTEND ROUTING ====================
// Serve VeloraStudio as the main root '/'
app.use(express.static(path.join(__dirname, 'public/velora')));
// Serve Barbie Barber at '/barbie'
app.use('/barbie', express.static(path.join(__dirname, 'public/barbie')));
// Serve Nails By Lukra at '/nails'
app.use('/nails', express.static(path.join(__dirname, 'public/nails')));


// ==================== BARBIE BARBER API (/api/barbie/*) ====================
app.get('/api/barbie/services', async (req, res) => {
    try {
        const services = await Service.find().sort({ sort_order: 1 });
        res.json(services);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Nepavyko gauti paslaugų' });
    }
});

app.post('/api/barbie/bookings', async (req, res) => {
    try {
        const { name, phone, email, service, date, time, message } = req.body;
        if (!name || !phone || !service || !date || !time) {
            return res.status(400).json({ error: 'Prašome užpildyti privalomus laukus' });
        }
        const existing = await Booking.countDocuments({ date, time, status: { $ne: 'cancelled' } });
        if (existing > 0) return res.status(409).json({ error: 'Šis laikas užimtas.' });

        const newBooking = new Booking({ name, phone, email, service, date, time, message });
        await newBooking.save();
        res.status(201).json({ success: true, bookingId: newBooking._id });
    } catch (err) {
        res.status(500).json({ error: 'Serverio klaida' });
    }
});

app.get('/api/barbie/bookings/times/:date', async (req, res) => {
    try {
        const bookedTimes = await Booking.find({ date: req.params.date, status: { $ne: 'cancelled' } }, { time: 1, _id: 0 });
        res.json(bookedTimes.map(b => b.time));
    } catch (err) {
        res.status(500).json({ error: 'Klaida gaunant laikus' });
    }
});

// Admin Auth Middleware for Barbie
function requireBarbieAdmin(req, res, next) {
    if (req.session && req.session.isBarbieAdmin) return next();
    res.status(401).json({ error: 'Reikia prisijungti' });
}

app.post('/api/barbie/admin/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const admin = await Admin.findOne({ username });
        if (!admin || !bcrypt.compareSync(password, admin.password)) {
            return res.status(401).json({ error: 'Neteisingi duomenys' });
        }
        req.session.isBarbieAdmin = true;
        req.session.barbieAdminId = admin._id;
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Klaida' });
    }
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
    } catch (err) {
        res.status(500).json({ error: 'Klaida' });
    }
});

app.patch('/api/barbie/admin/bookings/:id', requireBarbieAdmin, async (req, res) => {
    try {
        await Booking.findByIdAndUpdate(req.params.id, { status: req.body.status });
        res.json({ success: true });
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

app.post('/api/nails/reservations', (req, res) => {
    const { name, phone, service, date, time, notes } = req.body;
    dbNails.get(`SELECT count(*) as count FROM reservations WHERE date = ? AND time = ? AND status != 'cancelled'`, [date, time], (err, row) => {
        if (row && row.count > 0) return res.status(409).json({ error: 'Laikas užimtas' });
        dbNails.run(
            `INSERT INTO reservations (name, phone, service, date, time, notes, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
            [name, phone, service, date, time, notes || ''],
            function (err) {
                if (err) return res.status(500).json({ error: 'Klaida saugant' });
                res.status(201).json({ success: true, bookingId: this.lastID });
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


// Fallback React/SPA routes inside Barbie and Nails
app.get('/barbie/admin', (req, res) => res.sendFile(path.join(__dirname, 'public/barbie', 'admin.html')));
app.get('/nails/admin', (req, res) => res.sendFile(path.join(__dirname, 'public/nails', 'admin.html')));
app.use((req, res) => res.sendFile(path.join(__dirname, 'public/velora', 'index.html')));


// Start Database Connections & Server
async function start() {
    try {
        await initDatabase(); // Initializing MongoDB for Barbie
        app.listen(PORT, () => {
            console.log(`MEGA-MONOREPO Server running on port ${PORT}`);
            console.log(` - Velora: http://localhost:${PORT}/`);
            console.log(` - Barbie: http://localhost:${PORT}/barbie/`);
            console.log(` - Nails:  http://localhost:${PORT}/nails/`);
        });
    } catch (err) {
        console.error('Failed to start server:', err);
    }
}
start();
