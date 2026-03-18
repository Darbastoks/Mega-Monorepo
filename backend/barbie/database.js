const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.resolve(__dirname, 'barbie.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error connecting to Barbie SQLite database:', err.message);
    } else {
        console.log('✅ Connected to Barbie SQLite database.');

        db.run(`
            CREATE TABLE IF NOT EXISTS admins (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password TEXT NOT NULL
            )
        `, () => {
            db.get("SELECT COUNT(*) as cnt FROM admins", [], (err, row) => {
                if (row && row.cnt === 0) {
                    const hashedPassword = bcrypt.hashSync('barber2024', 10);
                    db.run("INSERT INTO admins (username, password) VALUES (?, ?)", ['admin', hashedPassword]);
                    console.log('✅ Barbie SQLite: Default admin created');
                }
            });
        });

        db.run(`
            CREATE TABLE IF NOT EXISTS settings (
                id INTEGER PRIMARY KEY DEFAULT 1,
                workingDays TEXT DEFAULT '[1,2,3,4,5,6]',
                startHour TEXT DEFAULT '09:00',
                endHour TEXT DEFAULT '18:30',
                breakStart TEXT DEFAULT '',
                breakEnd TEXT DEFAULT '',
                blockedDates TEXT DEFAULT '[]',
                breaks TEXT DEFAULT '[]'
            )
        `, () => {
            db.get("SELECT COUNT(*) as cnt FROM settings", [], (err, row) => {
                if (row && row.cnt === 0) {
                    db.run("INSERT INTO settings (id, workingDays, startHour, endHour, blockedDates, breaks) VALUES (1, '[1,2,3,4,5,6]', '09:00', '18:30', '[]', '[]')");
                }
            });
            // Migrate: add breaks column if missing
            db.run("ALTER TABLE settings ADD COLUMN breaks TEXT DEFAULT '[]'", () => {});
        });

        db.run(`
            CREATE TABLE IF NOT EXISTS services (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                duration INTEGER DEFAULT 30,
                price REAL DEFAULT 0,
                sort_order INTEGER DEFAULT 0
            )
        `, () => {
            db.get("SELECT COUNT(*) as cnt FROM services", [], (err, row) => {
                if (row && row.cnt === 0) {
                    const stmt = db.prepare("INSERT INTO services (name, duration, price, sort_order) VALUES (?, ?, ?, ?)");
                    stmt.run('Kirpimas', 30, 15, 1);
                    stmt.run('Barzdos formavimas', 30, 12, 2);
                    stmt.run('Kirpimas + Barzda', 60, 25, 3);
                    stmt.finalize();
                }
            });
        });

        db.run(`
            CREATE TABLE IF NOT EXISTS bookings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                phone TEXT NOT NULL,
                email TEXT,
                service TEXT NOT NULL,
                date TEXT NOT NULL,
                time TEXT NOT NULL,
                message TEXT,
                status TEXT DEFAULT 'pending',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
    }
});

// Since we are changing from Mongoose to SQLite, we wrap the DB calls in Promises for easier integration in server.js
const BookingModel = {
    find: (query = {}, options = {}) => {
        return new Promise((resolve, reject) => {
            let sql = "SELECT * FROM bookings";
            let params = [];

            if (query.date) {
                if (query.status && query.status['$ne']) {
                    sql += " WHERE date = ? AND status != ?";
                    params.push(query.date, query.status['$ne']);
                } else {
                    sql += " WHERE date = ?";
                    params.push(query.date);
                }
            } else if (query.status) {
                // simple equal check
            }

            if (options.sort) {
                if (options.sort.date) {
                    sql += " ORDER BY date " + (options.sort.date < 0 ? 'DESC' : 'ASC') + ", time ASC";
                } else if (options.sort.created_at) {
                    sql += " ORDER BY created_at " + (options.sort.created_at < 0 ? 'DESC' : 'ASC');
                }
            }

            db.all(sql, params, (err, rows) => {
                if (err) return reject(err);
                resolve(rows);
            });
        });
    },
    findOne: (query) => {
        return new Promise((resolve, reject) => {
            let sql = "SELECT * FROM bookings WHERE date = ? AND time = ? AND status != ?";
            db.get(sql, [query.date, query.time, query.status['$ne']], (err, row) => {
                if (err) return reject(err);
                resolve(row);
            });
        });
    },
    create: (data) => {
        return new Promise((resolve, reject) => {
            const sql = "INSERT INTO bookings (name, phone, email, service, date, time, message, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)";
            const params = [data.name, data.phone, data.email || null, data.service, data.date, data.time, data.message || null, 'pending'];
            db.run(sql, params, function (err) {
                if (err) return reject(err);
                resolve({ id: this.lastID, ...data, status: 'pending' });
            });
        });
    },
    findByIdAndUpdate: (id, update) => {
        return new Promise((resolve, reject) => {
            const sql = "UPDATE bookings SET status = ? WHERE id = ?";
            db.run(sql, [update.status, id], function (err) {
                if (err) return reject(err);
                resolve({ id, ...update });
            });
        });
    },
    findByIdAndDelete: (id) => {
        return new Promise((resolve, reject) => {
            const sql = "DELETE FROM bookings WHERE id = ?";
            db.run(sql, [id], function (err) {
                if (err) return reject(err);
                resolve({ success: true });
            });
        });
    }
};

const AdminModel = {
    findOne: (query) => {
        return new Promise((resolve, reject) => {
            const sql = "SELECT * FROM admins WHERE username = ?";
            db.get(sql, [query.username], (err, row) => {
                if (err) return reject(err);
                if (row) row._id = row.id; // Compatibility mapping
                resolve(row);
            });
        });
    },
    findById: (id) => {
        return new Promise((resolve, reject) => {
            if (id === 'system-admin') return resolve(null); // Local fallback handle in server.js
            const sql = "SELECT * FROM admins WHERE id = ?";
            db.get(sql, [id], (err, row) => {
                if (err) return reject(err);
                if (row) row._id = row.id;
                resolve(row);
            });
        });
    },
    updatePassword: (id, hashedPassword) => {
        return new Promise((resolve, reject) => {
            const sql = "UPDATE admins SET password = ? WHERE id = ?";
            db.run(sql, [hashedPassword, id], function (err) {
                if (err) return reject(err);
                resolve({ success: true });
            });
        });
    }
}

// Mock initDatabase to prevent server.js from crashing since it expects a connection promise
async function initDatabase() {
    return Promise.resolve();
}

module.exports = {
    initDatabase,
    Admin: AdminModel,
    Booking: BookingModel,
    db
};
