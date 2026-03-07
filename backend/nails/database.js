const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error connecting to SQLite database:', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        db.run(`
            CREATE TABLE IF NOT EXISTS reservations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                phone TEXT NOT NULL,
                service TEXT NOT NULL,
                date TEXT DEFAULT '',
                time TEXT DEFAULT '',
                notes TEXT DEFAULT '',
                status TEXT DEFAULT 'pending',
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        db.run(`
            CREATE TABLE IF NOT EXISTS settings (
                id INTEGER PRIMARY KEY DEFAULT 1,
                workingDays TEXT DEFAULT '[1,2,3,4,5,6]',
                startHour TEXT DEFAULT '09:00',
                endHour TEXT DEFAULT '19:00'
            )
        `, () => {
            // Seed default settings
            db.get("SELECT COUNT(*) as cnt FROM settings", [], (err, row) => {
                if (row && row.cnt === 0) {
                    db.run("INSERT INTO settings (id, workingDays, startHour, endHour) VALUES (1, '[1,2,3,4,5,6]', '09:00', '19:00')");
                }
            });
        });

        db.run(`
            CREATE TABLE IF NOT EXISTS services (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                duration INTEGER DEFAULT 60,
                price REAL DEFAULT 0,
                sort_order INTEGER DEFAULT 0
            )
        `, () => {
            // Seed default services
            db.get("SELECT COUNT(*) as cnt FROM services", [], (err, row) => {
                if (row && row.cnt === 0) {
                    const stmt = db.prepare("INSERT INTO services (name, duration, price, sort_order) VALUES (?, ?, ?, ?)");
                    stmt.run('Manikiūras', 60, 25, 1);
                    stmt.run('Pedikiūras', 90, 35, 2);
                    stmt.run('Priauginimas', 120, 45, 3);
                    stmt.run('Korekcija', 90, 30, 4);
                    stmt.finalize();
                }
            });
        });
    }
});

module.exports = db;
