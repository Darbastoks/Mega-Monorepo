const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dataDir = process.env.DATA_DIR || __dirname;
const dbPath = path.resolve(dataDir, 'demo-hair.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error connecting to Hair SQLite database:', err.message);
    } else {
        console.log('Connected to Hair SQLite database.');

        db.run(`
            CREATE TABLE IF NOT EXISTS bookings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                phone TEXT NOT NULL,
                service TEXT NOT NULL,
                date TEXT NOT NULL,
                time TEXT NOT NULL,
                message TEXT DEFAULT '',
                status TEXT DEFAULT 'pending',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        db.run(`
            CREATE TABLE IF NOT EXISTS settings (
                id INTEGER PRIMARY KEY DEFAULT 1,
                workingDays TEXT DEFAULT '[1,2,3,4,5,6]',
                startHour TEXT DEFAULT '09:00',
                endHour TEXT DEFAULT '19:00',
                breakStart TEXT DEFAULT '',
                breakEnd TEXT DEFAULT '',
                blockedDates TEXT DEFAULT '[]',
                breaks TEXT DEFAULT '[]'
            )
        `, () => {
            db.get("SELECT COUNT(*) as cnt FROM settings", [], (err, row) => {
                if (row && row.cnt === 0) {
                    db.run("INSERT INTO settings (id, workingDays, startHour, endHour, blockedDates, breaks) VALUES (1, '[1,2,3,4,5,6]', '09:00', '19:00', '[]', '[]')");
                }
            });
            // Migrate: add breaks column if missing
            db.run("ALTER TABLE settings ADD COLUMN breaks TEXT DEFAULT '[]'", () => {});
        });

        // Migrate: add email and staff_id columns to bookings if missing
        db.run("ALTER TABLE bookings ADD COLUMN email TEXT DEFAULT ''", () => {});
        db.run("ALTER TABLE bookings ADD COLUMN staff_id INTEGER DEFAULT NULL", () => {});

        db.run(`
            CREATE TABLE IF NOT EXISTS staff (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                workingDays TEXT DEFAULT '[1,2,3,4,5,6]',
                startHour TEXT DEFAULT '09:00',
                endHour TEXT DEFAULT '18:30',
                breaks TEXT DEFAULT '[]',
                blockedDates TEXT DEFAULT '[]',
                sort_order INTEGER DEFAULT 0
            )
        `, () => {
            db.get("SELECT COUNT(*) as cnt FROM staff", [], (err, row) => {
                if (row && row.cnt === 0) {
                    const stmt = db.prepare("INSERT INTO staff (name, workingDays, startHour, endHour, breaks, blockedDates, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)");
                    stmt.run('Stilistė A', '[1,2,3,4,5,6]', '09:00', '19:00', '[]', '[]', 1);
                    stmt.run('Stilistė B', '[1,2,3,4,5]', '10:00', '18:00', '[]', '[]', 2);
                    stmt.finalize();
                    console.log('Demo-Hair SQLite: Default staff created');
                }
            });
        });

        db.run(`
            CREATE TABLE IF NOT EXISTS services (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                duration INTEGER DEFAULT 60,
                price REAL DEFAULT 0,
                description TEXT DEFAULT '',
                sort_order INTEGER DEFAULT 0
            )
        `, () => {
            db.get("SELECT COUNT(*) as cnt FROM services", [], (err, row) => {
                if (row && row.cnt === 0) {
                    const stmt = db.prepare("INSERT INTO services (name, duration, price, sort_order) VALUES (?, ?, ?, ?)");
                    stmt.run('Plaukų SPA', 60, 0, 1);
                    stmt.run('Tiesinimas', 60, 0, 2);
                    stmt.run('Kirpimas karštomis žirklėmis', 60, 0, 3);
                    stmt.run('Konsultacija', 30, 0, 4);
                    stmt.finalize();
                    console.log('Hair SQLite: Default services seeded');
                }
            });
        });
    }
});

module.exports = db;
