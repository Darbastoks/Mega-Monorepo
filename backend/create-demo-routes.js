/**
 * Demo Salon Route Factory
 * Creates a full Express Router with booking, settings, services, and admin endpoints
 * for a demo salon site. Works with raw SQLite databases.
 */
const { Router } = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');

/**
 * @param {Object} config
 * @param {Object} config.db - SQLite database instance
 * @param {string} config.slug - Route slug (e.g., 'demo-barber')
 * @param {string} config.passwordEnvVar - Env var name for admin password
 * @param {string} config.salonName - Display name for emails
 * @param {string} config.sessionKey - Session key for admin auth
 * @param {string} config.bookingsTable - Name of bookings table ('bookings' or 'reservations')
 * @param {Function} [config.emailTransporter] - Nodemailer transporter (optional)
 */
function createDemoRoutes(config) {
    const { db, slug, passwordEnvVar, salonName, sessionKey, bookingsTable = 'bookings', emailTransporter, defaultServices = [], defaultStaff = [] } = config;
    const router = Router();

    const limiter = rateLimit({
        windowMs: 10 * 60 * 1000,
        max: 5,
        message: { error: 'Per daug bandymų. Pabandykite dar kartą vėliau.' }
    });

    // Helper: require admin
    function requireAdmin(req, res, next) {
        if (req.session && req.session[sessionKey]) return next();
        res.status(401).json({ error: 'Reikia prisijungti' });
    }

    // Helper: promisified db calls
    const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
    });
    const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []));
    });
    const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
        db.run(sql, params, function(err) { err ? reject(err) : resolve({ lastID: this.lastID, changes: this.changes }); });
    });

    const timeToMins = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
    const minsToTime = (m) => `${Math.floor(m / 60).toString().padStart(2, '0')}:${(m % 60).toString().padStart(2, '0')}`;

    // ==================== SETTINGS ====================
    router.get('/settings', async (req, res) => {
        try {
            let row = await dbGet("SELECT * FROM settings WHERE id = 1");
            if (!row) {
                await dbRun("INSERT OR IGNORE INTO settings (id) VALUES (1)");
                row = await dbGet("SELECT * FROM settings WHERE id = 1");
            }
            if (row) {
                if (row.workingDays) row.workingDays = JSON.parse(row.workingDays);
                try { row.blockedDates = JSON.parse(row.blockedDates || '[]'); } catch(e) { row.blockedDates = []; }
                try { row.breaks = JSON.parse(row.breaks || '[]'); } catch(e) { row.breaks = []; }
                if (row.breaks.length === 0 && row.breakStart && row.breakEnd) {
                    row.breaks = [{ start: row.breakStart, end: row.breakEnd }];
                }
            }
            res.json(row || { workingDays: [1,2,3,4,5,6], startHour: '09:00', endHour: '18:30', blockedDates: [], breaks: [] });
        } catch(err) { res.status(500).json({ error: 'DB klaida' }); }
    });

    router.put('/settings', requireAdmin, async (req, res) => {
        try {
            const { workingDays, startHour, endHour, blockedDates, breaks } = req.body;
            await dbRun("UPDATE settings SET workingDays = ?, startHour = ?, endHour = ?, blockedDates = ?, breaks = ? WHERE id = 1",
                [JSON.stringify(workingDays), startHour, endHour, JSON.stringify(blockedDates || []), JSON.stringify(breaks || [])]);
            res.json({ success: true });
        } catch(err) { res.status(500).json({ error: 'DB klaida: ' + err.message }); }
    });

    // ==================== SERVICES ====================
    router.get('/services', async (req, res) => {
        try {
            const rows = await dbAll("SELECT * FROM services ORDER BY sort_order ASC");
            res.json(rows);
        } catch(err) { res.status(500).json({ error: 'DB klaida' }); }
    });

    router.post('/services', requireAdmin, async (req, res) => {
        try {
            const data = req.body;
            // Handle both array (bulk replace) and single object (add one)
            if (Array.isArray(data)) {
                await dbRun("DELETE FROM services");
                for (let i = 0; i < data.length; i++) {
                    const s = data[i];
                    await dbRun("INSERT INTO services (name, duration, price, sort_order) VALUES (?, ?, ?, ?)",
                        [s.name, s.duration || 30, s.price || 0, i + 1]);
                }
            } else {
                const maxOrder = await dbGet("SELECT MAX(sort_order) as m FROM services");
                await dbRun("INSERT INTO services (name, duration, price, sort_order) VALUES (?, ?, ?, ?)",
                    [data.name, data.duration || 30, data.price || 0, (maxOrder?.m || 0) + 1]);
            }
            res.json({ success: true });
        } catch(err) { res.status(500).json({ error: 'DB klaida' }); }
    });

    router.patch('/services/:id', requireAdmin, async (req, res) => {
        try {
            const { name, duration, price, sort_order } = req.body;
            const fields = [];
            const params = [];
            if (name !== undefined) { fields.push('name = ?'); params.push(name); }
            if (duration !== undefined) { fields.push('duration = ?'); params.push(duration); }
            if (price !== undefined) { fields.push('price = ?'); params.push(price); }
            if (sort_order !== undefined) { fields.push('sort_order = ?'); params.push(sort_order); }
            if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });
            params.push(req.params.id);
            await dbRun(`UPDATE services SET ${fields.join(', ')} WHERE id = ?`, params);
            res.json({ success: true });
        } catch(err) { res.status(500).json({ error: 'DB klaida' }); }
    });

    router.delete('/services/:id', requireAdmin, async (req, res) => {
        try {
            await dbRun("DELETE FROM services WHERE id = ?", [req.params.id]);
            res.json({ success: true });
        } catch(err) { res.status(500).json({ error: 'DB klaida' }); }
    });

    // ==================== STAFF ====================
    router.get('/staff', async (req, res) => {
        try {
            const rows = await dbAll("SELECT id, name, sort_order FROM staff ORDER BY sort_order ASC");
            res.json(rows);
        } catch(err) { res.status(500).json({ error: 'DB klaida' }); }
    });

    router.get('/staff/:id/settings', async (req, res) => {
        try {
            const row = await dbGet("SELECT * FROM staff WHERE id = ?", [req.params.id]);
            if (!row) return res.status(404).json({ error: 'Darbuotojas nerastas' });
            row.workingDays = JSON.parse(row.workingDays || '[1,2,3,4,5,6]');
            try { row.breaks = JSON.parse(row.breaks || '[]'); } catch(e) { row.breaks = []; }
            try { row.blockedDates = JSON.parse(row.blockedDates || '[]'); } catch(e) { row.blockedDates = []; }
            res.json(row);
        } catch(err) { res.status(500).json({ error: 'DB klaida' }); }
    });

    router.put('/staff/:id/settings', requireAdmin, async (req, res) => {
        try {
            const { name, workingDays, startHour, endHour, breaks, blockedDates } = req.body;
            const fields = [];
            const params = [];
            if (name !== undefined) { fields.push('name = ?'); params.push(name); }
            if (workingDays !== undefined) { fields.push('workingDays = ?'); params.push(JSON.stringify(workingDays)); }
            if (startHour !== undefined) { fields.push('startHour = ?'); params.push(startHour); }
            if (endHour !== undefined) { fields.push('endHour = ?'); params.push(endHour); }
            if (breaks !== undefined) { fields.push('breaks = ?'); params.push(JSON.stringify(breaks)); }
            if (blockedDates !== undefined) { fields.push('blockedDates = ?'); params.push(JSON.stringify(blockedDates)); }
            if (fields.length === 0) return res.status(400).json({ error: 'Nėra ką atnaujinti' });
            params.push(req.params.id);
            await dbRun(`UPDATE staff SET ${fields.join(', ')} WHERE id = ?`, params);
            res.json({ success: true });
        } catch(err) { res.status(500).json({ error: 'DB klaida: ' + err.message }); }
    });

    router.post('/staff', requireAdmin, async (req, res) => {
        try {
            const { name } = req.body;
            if (!name) return res.status(400).json({ error: 'Vardas privalomas' });
            const maxOrder = await dbGet("SELECT MAX(sort_order) as m FROM staff");
            const result = await dbRun(
                "INSERT INTO staff (name, sort_order) VALUES (?, ?)",
                [name, (maxOrder?.m || 0) + 1]
            );
            res.json({ success: true, id: result.lastID });
        } catch(err) { res.status(500).json({ error: 'DB klaida' }); }
    });

    router.delete('/staff/:id', requireAdmin, async (req, res) => {
        try {
            const count = await dbGet("SELECT COUNT(*) as cnt FROM staff");
            if (count.cnt <= 1) return res.status(400).json({ error: 'Turi likti bent vienas darbuotojas' });
            await dbRun("DELETE FROM staff WHERE id = ?", [req.params.id]);
            await dbRun(`UPDATE ${bookingsTable} SET staff_id = NULL WHERE staff_id = ?`, [req.params.id]);
            res.json({ success: true });
        } catch(err) { res.status(500).json({ error: 'DB klaida' }); }
    });

    router.patch('/staff/:id', requireAdmin, async (req, res) => {
        try {
            const { name, sort_order } = req.body;
            const fields = [];
            const params = [];
            if (name !== undefined) { fields.push('name = ?'); params.push(name); }
            if (sort_order !== undefined) { fields.push('sort_order = ?'); params.push(sort_order); }
            if (fields.length === 0) return res.status(400).json({ error: 'Nėra ką atnaujinti' });
            params.push(req.params.id);
            await dbRun(`UPDATE staff SET ${fields.join(', ')} WHERE id = ?`, params);
            res.json({ success: true });
        } catch(err) { res.status(500).json({ error: 'DB klaida' }); }
    });

    // Helper: get staff settings or fallback to global settings
    async function getStaffOrGlobalSettings(staffId) {
        if (staffId) {
            const staff = await dbGet("SELECT * FROM staff WHERE id = ?", [staffId]);
            if (staff) {
                return {
                    workingDays: JSON.parse(staff.workingDays || '[1,2,3,4,5,6]'),
                    startHour: staff.startHour || '09:00',
                    endHour: staff.endHour || '18:30',
                    breaks: JSON.parse(staff.breaks || '[]'),
                    blockedDates: JSON.parse(staff.blockedDates || '[]')
                };
            }
        }
        // Fallback to global settings (backward compat for real client sites)
        const settings = await dbGet("SELECT * FROM settings WHERE id = 1") ||
            { workingDays: '[1,2,3,4,5,6]', startHour: '09:00', endHour: '18:30', breaks: '[]', blockedDates: '[]' };
        const workingDays = typeof settings.workingDays === 'string' ? JSON.parse(settings.workingDays) : settings.workingDays;
        let blockedDates = [];
        try { blockedDates = typeof settings.blockedDates === 'string' ? JSON.parse(settings.blockedDates) : settings.blockedDates; } catch(e) {}
        let breaks = [];
        try { breaks = typeof settings.breaks === 'string' ? JSON.parse(settings.breaks || '[]') : (settings.breaks || []); } catch(e) {}
        if (breaks.length === 0 && settings.breakStart && settings.breakEnd) breaks = [{ start: settings.breakStart, end: settings.breakEnd }];
        return { workingDays, startHour: settings.startHour, endHour: settings.endHour, breaks, blockedDates };
    }

    // ==================== AVAILABLE TIMES ====================
    // Support both endpoint patterns: /bookings/times/:date (barbie/hair) and /available-times (nails)
    async function getAvailableTimes(req, res) {
        try {
            const date = req.params.date || req.query.date;
            const requestedServiceName = req.query.service;
            const staffId = req.query.staff_id;
            if (!date) return res.status(400).json({ error: 'date required' });

            const s = await getStaffOrGlobalSettings(staffId);

            const dayOfWeek = new Date(date).getDay();
            if (!s.workingDays.includes(dayOfWeek)) return res.json([]);
            if (s.blockedDates.includes(date)) return res.json([]);

            const services = await dbAll("SELECT * FROM services");
            let requestedDuration = 30;
            if (requestedServiceName) {
                const srv = services.find(sr => sr.name === requestedServiceName);
                if (srv) requestedDuration = srv.duration;
            }

            const startOfDayMins = timeToMins(s.startHour);
            const endOfDayMins = timeToMins(s.endHour);

            // Get bookings scoped to this staff member (or all if no staff_id)
            const bookings = staffId
                ? await dbAll(`SELECT * FROM ${bookingsTable} WHERE date = ? AND staff_id = ? AND status != 'cancelled'`, [date, staffId])
                : await dbAll(`SELECT * FROM ${bookingsTable} WHERE date = ? AND status != 'cancelled'`, [date]);

            const blockedIntervals = bookings.map(b => {
                const bSrv = services.find(sv => sv.name === b.service);
                const bDuration = bSrv ? bSrv.duration : 30;
                const bStartMins = timeToMins(b.time);
                return { start: bStartMins, end: bStartMins + bDuration };
            });

            s.breaks.forEach(br => {
                if (br.start && br.end) {
                    const bStart = timeToMins(br.start);
                    const bEnd = timeToMins(br.end);
                    if (bEnd > bStart) blockedIntervals.push({ start: bStart, end: bEnd });
                }
            });

            const availableSlots = [];
            for (let curr = startOfDayMins; curr + requestedDuration <= endOfDayMins; curr += 30) {
                const reqEnd = curr + requestedDuration;
                const overlaps = blockedIntervals.some(b => curr < b.end && reqEnd > b.start);
                if (!overlaps) availableSlots.push(minsToTime(curr));
            }

            res.json(availableSlots);
        } catch(err) {
            console.error(`${slug} time slot error:`, err);
            res.json(["09:00","09:30","10:00","10:30","11:00","11:30","12:00","12:30","13:00","13:30","14:00","14:30","15:00","15:30","16:00","16:30","17:00","17:30","18:00"]);
        }
    }

    router.get('/bookings/times/:date', getAvailableTimes);
    router.get('/available-times', getAvailableTimes);

    // ==================== MONTH AVAILABILITY ====================
    router.get('/availability-month', async (req, res) => {
        try {
            const year = parseInt(req.query.year);
            const month = parseInt(req.query.month);
            const staffId = req.query.staff_id;
            if (!year || !month) return res.status(400).json({ error: 'year and month required' });

            const monthStr = String(month).padStart(2, '0');
            const daysInMonth = new Date(year, month, 0).getDate();

            const st = await getStaffOrGlobalSettings(staffId);

            const startMins = timeToMins(st.startHour);
            const endMins = timeToMins(st.endHour);
            const dur = 30;

            const breakIntervals = st.breaks.filter(b => b.start && b.end).map(b => ({ start: timeToMins(b.start), end: timeToMins(b.end) })).filter(b => b.end > b.start);
            let totalSlots = 0;
            for (let c = startMins; c + dur <= endMins; c += 30) {
                if (!breakIntervals.some(b => c < b.end && c + dur > b.start)) totalSlots++;
            }

            const dateFrom = `${year}-${monthStr}-01`;
            const dateTo = `${year}-${monthStr}-${String(daysInMonth).padStart(2, '0')}`;
            const bookings = staffId
                ? await dbAll(`SELECT date, service, time FROM ${bookingsTable} WHERE date >= ? AND date <= ? AND staff_id = ? AND status != 'cancelled'`, [dateFrom, dateTo, staffId])
                : await dbAll(`SELECT date, service, time FROM ${bookingsTable} WHERE date >= ? AND date <= ? AND status != 'cancelled'`, [dateFrom, dateTo]);
            const services = await dbAll("SELECT * FROM services");

            const result = {};
            for (let d = 1; d <= daysInMonth; d++) {
                const dateStr = `${year}-${monthStr}-${String(d).padStart(2, '0')}`;
                const dow = new Date(dateStr).getDay();
                if (!st.workingDays.includes(dow) || st.blockedDates.includes(dateStr)) {
                    result[dateStr] = 'closed'; continue;
                }
                const dayBookings = bookings.filter(b => b.date === dateStr);
                const bookedIntervals = dayBookings.map(b => {
                    const srv = services.find(s => s.name === b.service);
                    const bDur = srv ? srv.duration : 30;
                    const stm = timeToMins(b.time);
                    return { start: stm, end: stm + bDur };
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
        } catch(err) { res.status(500).json({ error: 'DB error' }); }
    });

    // ==================== BOOKING / RESERVATION ====================
    // Support all endpoint patterns: POST /bookings (barbie), POST /book (hair), POST /reservations (nails)
    async function createBooking(req, res) {
        try {
            const { name, phone, email, service, date, time, message, notes, staff_id, website_url_fake } = req.body;
            if (website_url_fake) return res.status(200).json({ success: true }); // honeypot
            if (!name || !phone || !service || !date || !time) {
                return res.status(400).json({ error: 'Visi privalomi laukai turi būti užpildyti.' });
            }

            // Double-booking check scoped to staff member
            const existing = staff_id
                ? await dbGet(`SELECT id FROM ${bookingsTable} WHERE date = ? AND time = ? AND staff_id = ? AND status != 'cancelled'`, [date, time, staff_id])
                : await dbGet(`SELECT id FROM ${bookingsTable} WHERE date = ? AND time = ? AND status != 'cancelled'`, [date, time]);
            if (existing) return res.status(409).json({ error: 'Šis laikas jau užimtas. Prašome pasirinkti kitą.' });

            if (bookingsTable === 'reservations') {
                await dbRun(
                    "INSERT INTO reservations (name, phone, service, date, time, notes, staff_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')",
                    [name, phone, service, date, time, notes || message || '', staff_id || null]
                );
            } else {
                await dbRun(
                    "INSERT INTO bookings (name, phone, email, service, date, time, message, staff_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')",
                    [name, phone, email || null, service, date, time, message || notes || '', staff_id || null]
                );
            }
            res.status(201).json({ success: true });
        } catch(err) {
            console.error(`${slug} booking error:`, err.message);
            res.status(500).json({ error: 'Serverio klaida.' });
        }
    }

    router.post('/bookings', limiter, createBooking);
    router.post('/book', limiter, createBooking);
    router.post('/reservations', limiter, createBooking);

    // ==================== ADMIN AUTH ====================
    router.post('/admin/login', async (req, res) => {
        const { username, password } = req.body;
        const envPass = process.env[passwordEnvVar];

        // Simple env-var password check
        if (envPass && password === envPass) {
            req.session[sessionKey] = true;
            return res.json({ success: true });
        }

        // Also check admin:admin combo with username
        if (username === 'admin' && envPass && password === envPass) {
            req.session[sessionKey] = true;
            return res.json({ success: true });
        }

        // Check DB admins table
        try {
            const admin = await dbGet("SELECT * FROM admins WHERE username = ?", [username || 'admin']);
            if (admin && bcrypt.compareSync(password, admin.password)) {
                req.session[sessionKey] = true;
                return res.json({ success: true });
            }
        } catch(e) {}

        res.status(401).json({ error: 'Neteisingi duomenys' });
    });

    router.post('/admin/logout', (req, res) => {
        req.session[sessionKey] = false;
        res.json({ success: true });
    });

    router.get('/admin/check', requireAdmin, (req, res) => res.json({ isAdmin: true }));

    // ==================== ADMIN BOOKINGS ====================
    router.get('/admin/bookings', requireAdmin, async (req, res) => {
        try {
            const rows = await dbAll(`SELECT b.*, s.name as staff_name FROM ${bookingsTable} b LEFT JOIN staff s ON b.staff_id = s.id ORDER BY b.date DESC, b.time ASC`);
            res.json(rows);
        } catch(err) { res.status(500).json({ error: 'Klaida' }); }
    });

    // Aliases: all patterns for listing bookings
    router.get('/reservations', requireAdmin, async (req, res) => {
        try {
            const rows = await dbAll(`SELECT * FROM ${bookingsTable} ORDER BY date DESC, time ASC`);
            res.json(rows);
        } catch(err) { res.status(500).json({ error: 'Klaida' }); }
    });
    router.get('/bookings', requireAdmin, async (req, res) => {
        try {
            const rows = await dbAll(`SELECT * FROM ${bookingsTable} ORDER BY date DESC, time ASC`);
            res.json(rows);
        } catch(err) { res.status(500).json({ error: 'Klaida' }); }
    });

    // Update booking status — all patterns
    async function updateBookingStatus(req, res) {
        try {
            await dbRun(`UPDATE ${bookingsTable} SET status = ? WHERE id = ?`, [req.body.status, req.params.id]);
            res.json({ success: true });
        } catch(err) { res.status(500).json({ error: 'Klaida' }); }
    }
    router.patch('/admin/bookings/:id', requireAdmin, updateBookingStatus);
    router.patch('/bookings/:id/status', requireAdmin, updateBookingStatus);
    router.patch('/reservations/:id/status', requireAdmin, updateBookingStatus);

    // Delete booking — all patterns
    async function deleteBooking(req, res) {
        try {
            await dbRun(`DELETE FROM ${bookingsTable} WHERE id = ?`, [req.params.id]);
            res.json({ success: true });
        } catch(err) { res.status(500).json({ error: 'Klaida' }); }
    }
    router.delete('/admin/bookings/:id', requireAdmin, deleteBooking);
    router.delete('/bookings/:id', requireAdmin, deleteBooking);
    router.delete('/reservations/:id', requireAdmin, deleteBooking);

    // ==================== CHANGE PASSWORD ====================
    router.post('/admin/change-password', requireAdmin, async (req, res) => {
        try {
            const { currentPassword, newPassword } = req.body;
            if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Trūksta laukų' });
            const admin = await dbGet("SELECT * FROM admins WHERE id = 1");
            if (!admin || !bcrypt.compareSync(currentPassword, admin.password)) {
                return res.status(401).json({ error: 'Neteisingas dabartinis slaptažodis' });
            }
            const hashed = bcrypt.hashSync(newPassword, 10);
            await dbRun("UPDATE admins SET password = ? WHERE id = ?", [hashed, admin.id]);
            res.json({ success: true, message: 'Slaptažodis pakeistas sėkmingai' });
        } catch(err) { res.status(500).json({ error: 'Klaida' }); }
    });

    // ==================== EMERGENCY CANCEL ====================
    router.post('/admin/emergency-cancel', requireAdmin, async (req, res) => {
        try {
            const { date, fullDay, startTime, endTime, reason } = req.body;
            if (!date) return res.status(400).json({ error: 'Data privaloma' });

            const whereClause = fullDay
                ? `date = ? AND status != 'cancelled'`
                : `date = ? AND time >= ? AND time <= ? AND status != 'cancelled'`;
            const params = fullDay ? [date] : [date, startTime, endTime];

            const bookings = await dbAll(`SELECT * FROM ${bookingsTable} WHERE ${whereClause}`, params);

            // Block the date
            const settingsRow = await dbGet("SELECT blockedDates FROM settings WHERE id = 1");
            if (settingsRow) {
                let blocked = [];
                try { blocked = JSON.parse(settingsRow.blockedDates || '[]'); } catch(e) {}
                if (!blocked.includes(date)) {
                    blocked.push(date);
                    await dbRun("UPDATE settings SET blockedDates = ? WHERE id = 1", [JSON.stringify(blocked)]);
                }
            }

            if (!bookings || bookings.length === 0) {
                return res.json({ cancelledCount: 0, clients: [] });
            }

            const ids = bookings.map(b => b.id);
            const placeholders = ids.map(() => '?').join(',');
            await dbRun(`UPDATE ${bookingsTable} SET status = 'cancelled' WHERE id IN (${placeholders})`, ids);

            const clients = bookings.map(b => ({
                name: b.name, phone: b.phone, email: b.email || '',
                service: b.service, time: b.time, date: b.date
            }));
            res.json({ cancelledCount: bookings.length, clients });
        } catch(err) { res.status(500).json({ error: 'Klaida atšaukiant' }); }
    });

    // ==================== SEND CANCEL EMAIL ====================
    router.post('/admin/send-cancel-email', requireAdmin, async (req, res) => {
        const { to, clientName, message } = req.body;
        if (!to || !message) return res.status(400).json({ error: 'El. paštas ir žinutė privalomi' });
        if (!emailTransporter) return res.status(500).json({ error: 'El. paštas nesukonfigūruotas' });
        try {
            await emailTransporter.sendMail({
                from: `"${salonName}" <${process.env.GMAIL_USER}>`,
                to,
                subject: `Dėl Jūsų vizito — ${salonName}`,
                text: message
            });
            res.json({ success: true });
        } catch(err) { res.status(500).json({ error: 'Nepavyko išsiųsti: ' + err.message }); }
    });

    // ==================== RESET DEMO ====================
    async function resetDemo() {
        await dbRun(`DELETE FROM ${bookingsTable}`);
        await dbRun(
            "UPDATE settings SET workingDays = ?, startHour = ?, endHour = ?, blockedDates = ?, breaks = ? WHERE id = 1",
            [JSON.stringify([1,2,3,4,5,6]), '09:00', '18:30', '[]', '[]']
        );
        await dbRun("DELETE FROM services");
        for (let i = 0; i < defaultServices.length; i++) {
            const s = defaultServices[i];
            await dbRun("INSERT INTO services (name, duration, price, sort_order) VALUES (?, ?, ?, ?)",
                [s.name, s.duration, s.price, s.sort_order || i + 1]);
        }
        // Reset staff
        if (defaultStaff.length > 0) {
            await dbRun("DELETE FROM staff");
            for (let i = 0; i < defaultStaff.length; i++) {
                const st = defaultStaff[i];
                await dbRun(
                    "INSERT INTO staff (name, workingDays, startHour, endHour, breaks, blockedDates, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    [st.name, JSON.stringify(st.workingDays || [1,2,3,4,5,6]), st.startHour || '09:00', st.endHour || '18:30', JSON.stringify(st.breaks || []), JSON.stringify(st.blockedDates || []), i + 1]
                );
            }
        }
        console.log(`[DEMO RESET] ${slug} reset at ${new Date().toISOString()}`);
    }

    router.post('/reset-demo', async (req, res) => {
        try {
            await resetDemo();
            res.json({ success: true, message: 'Demo atstatytas' });
        } catch (err) {
            console.error(`[DEMO RESET] ${slug} error:`, err);
            res.status(500).json({ error: 'Reset klaida' });
        }
    });

    return { router, resetDemo };
}

module.exports = createDemoRoutes;
