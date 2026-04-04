const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dataDir = process.env.DATA_DIR || __dirname;
const dbPath = path.resolve(dataDir, 'portal.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error connecting to Portal SQLite database:', err.message);
    } else {
        console.log('✅ Connected to Portal SQLite database.');

        db.run(`
            CREATE TABLE IF NOT EXISTS clients (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                google_email TEXT UNIQUE,
                google_name TEXT DEFAULT '',
                google_picture TEXT DEFAULT '',
                salon_slug TEXT DEFAULT '',
                salon_name TEXT DEFAULT '',
                plan TEXT DEFAULT 'free',
                stripe_customer_id TEXT DEFAULT '',
                stripe_subscription_id TEXT DEFAULT '',
                changes_used_this_month INTEGER DEFAULT 0,
                month_reset_date TEXT DEFAULT '',
                created_at TEXT DEFAULT (datetime('now')),
                last_login TEXT DEFAULT ''
            )
        `);

        // Migrations
        db.run(`UPDATE clients SET plan = 'free' WHERE plan = 'start' AND (stripe_customer_id = '' OR stripe_customer_id IS NULL)`);
        db.run(`UPDATE clients SET plan = 'solo' WHERE plan = 'start' AND stripe_customer_id != '' AND stripe_customer_id IS NOT NULL`);
        db.run(`UPDATE clients SET plan = 'team' WHERE plan = 'pro'`);
        db.run(`ALTER TABLE clients ADD COLUMN purchased_changes INTEGER DEFAULT 0`, () => {});

        // Attachment migrations
        db.run(`ALTER TABLE change_requests ADD COLUMN attachment_base64 TEXT DEFAULT ''`, () => {});
        db.run(`ALTER TABLE change_requests ADD COLUMN attachment_name TEXT DEFAULT ''`, () => {});

        // Set test account to pro + barbie
        db.run(`UPDATE clients SET salon_slug = 'barbie', plan = 'team' WHERE google_email = 'gaidys.993@gmail.com'`, () => {});

        db.run(`
            CREATE TABLE IF NOT EXISTS change_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                client_id INTEGER NOT NULL,
                category TEXT NOT NULL CHECK(category IN ('text', 'visual', 'service')),
                description TEXT NOT NULL,
                status TEXT DEFAULT 'new' CHECK(status IN ('new', 'in_progress', 'completed', 'rejected')),
                admin_notes TEXT DEFAULT '',
                created_at TEXT DEFAULT (datetime('now')),
                completed_at TEXT DEFAULT '',
                FOREIGN KEY (client_id) REFERENCES clients(id)
            )
        `);
    }
});

function dbAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
    });
}

function dbGet(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
    });
}

function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) { err ? reject(err) : resolve({ lastID: this.lastID, changes: this.changes }); });
    });
}

module.exports = { db, dbAll, dbGet, dbRun };
