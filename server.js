const express  = require('express');
const Database = require('better-sqlite3');
const fs       = require('fs');
const path     = require('path');

const app      = express();
const PORT     = process.env.PORT || 3000;
const DB_PATH  = path.join(__dirname, 'tax_data.db');
const OLD_JSON = path.join(__dirname, 'data.json');

app.use(express.json());
app.use(express.static(__dirname));

// ── Database setup ──────────────────────────────────────────────────────
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS income (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    date   TEXT,
    desc   TEXT,
    amount REAL NOT NULL
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    date   TEXT,
    cat    TEXT,
    desc   TEXT,
    amount REAL NOT NULL
  );
`);

// ── Migrate from data.json if it exists ─────────────────────────────────
function migrateFromJson() {
  if (!fs.existsSync(OLD_JSON)) return;

  const count = db.prepare('SELECT COUNT(*) AS n FROM income').get().n
              + db.prepare('SELECT COUNT(*) AS n FROM expenses').get().n;
  if (count > 0) return; // already have data, skip

  try {
    const raw  = JSON.parse(fs.readFileSync(OLD_JSON, 'utf8'));
    const insertIncome  = db.prepare('INSERT INTO income (date, desc, amount) VALUES (?, ?, ?)');
    const insertExpense = db.prepare('INSERT INTO expenses (date, cat, desc, amount) VALUES (?, ?, ?, ?)');
    const upsertSetting = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');

    const migrate = db.transaction(() => {
      for (const e of (raw.income || [])) {
        insertIncome.run(e.date || null, e.desc || null, parseFloat(e.amount) || 0);
      }
      for (const e of (raw.expenses || [])) {
        insertExpense.run(e.date || null, e.cat || null, e.desc || null, parseFloat(e.amount) || 0);
      }
      upsertSetting.run('federalRate', String(raw.federalRate ?? 12));
      upsertSetting.run('seRate',      String(raw.seRate ?? 15.3));
      upsertSetting.run('setAside',    String(raw.setAside ?? 0));
    });

    migrate();
    // Rename old file so it's not re-read but still recoverable
    fs.renameSync(OLD_JSON, OLD_JSON + '.migrated');
    console.log('Migrated data.json → SQLite');
  } catch (err) {
    console.error('Migration failed:', err.message);
  }
}

migrateFromJson();

// ── Prepared statements ─────────────────────────────────────────────────
const stmts = {
  allIncome:     db.prepare('SELECT id, date, desc, amount FROM income ORDER BY id'),
  allExpenses:   db.prepare('SELECT id, date, cat, desc, amount FROM expenses ORDER BY id'),
  allSettings:   db.prepare('SELECT key, value FROM settings'),
  insertIncome:  db.prepare('INSERT INTO income (date, desc, amount) VALUES (?, ?, ?)'),
  insertExpense: db.prepare('INSERT INTO expenses (date, cat, desc, amount) VALUES (?, ?, ?, ?)'),
  deleteIncome:  db.prepare('DELETE FROM income WHERE id = ?'),
  deleteExpense: db.prepare('DELETE FROM expenses WHERE id = ?'),
  upsertSetting: db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'),
};

// ── GET /api/data — return all data ─────────────────────────────────────
app.get('/api/data', (req, res) => {
  const income   = stmts.allIncome.all();
  const expenses = stmts.allExpenses.all();
  const settings = Object.fromEntries(stmts.allSettings.all().map(r => [r.key, r.value]));

  res.json({
    income,
    expenses,
    federalRate: parseFloat(settings.federalRate ?? 12),
    seRate:      parseFloat(settings.seRate ?? 15.3),
    setAside:    parseFloat(settings.setAside ?? 0),
  });
});

// ── POST /api/data — full save (keeps frontend compatibility) ───────────
app.post('/api/data', (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Invalid data' });
  }

  const sync = db.transaction(() => {
    // Rebuild income
    db.exec('DELETE FROM income');
    for (const e of (body.income || [])) {
      stmts.insertIncome.run(e.date || null, e.desc || null, parseFloat(e.amount) || 0);
    }

    // Rebuild expenses
    db.exec('DELETE FROM expenses');
    for (const e of (body.expenses || [])) {
      stmts.insertExpense.run(e.date || null, e.cat || null, e.desc || null, parseFloat(e.amount) || 0);
    }

    // Settings
    stmts.upsertSetting.run('federalRate', String(body.federalRate ?? 12));
    stmts.upsertSetting.run('seRate',      String(body.seRate ?? 15.3));
    stmts.upsertSetting.run('setAside',    String(body.setAside ?? 0));
  });

  try {
    sync();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save data' });
  }
});

// ── Graceful shutdown ───────────────────────────────────────────────────
process.on('SIGINT',  () => { db.close(); process.exit(0); });
process.on('SIGTERM', () => { db.close(); process.exit(0); });

app.listen(PORT, () => {
  console.log(`Etsy Tax Tracker running at http://localhost:${PORT}`);
});
