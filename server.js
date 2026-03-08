const express  = require('express');
const Database = require('better-sqlite3');
const session  = require('express-session');
const SqliteStore = require('better-sqlite3-session-store')(session);
const bcrypt   = require('bcryptjs');
const crypto   = require('crypto');
const fs       = require('fs');
const path     = require('path');

const app      = express();
const PORT     = process.env.PORT || 3000;
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/+$/, ''); // e.g. '/ashley'
const DB_PATH  = path.join(__dirname, 'tax_data.db');
const OLD_JSON = path.join(__dirname, 'data.json');

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false }));

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

  CREATE TABLE IF NOT EXISTS mileage (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    date  TEXT,
    desc  TEXT,
    miles REAL NOT NULL,
    rate  REAL NOT NULL DEFAULT 0.70
  );

  CREATE TABLE IF NOT EXISTS users (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
  );
`);

// ── Session setup ───────────────────────────────────────────────────────
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

app.use(session({
  store: new SqliteStore({ client: db, expired: { clear: true, intervalMs: 900000 } }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000, // 1 week
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  },
}));

// ── Auth helpers ─────────────────────────────────────────────────────────
function hasUsers() {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0;
}

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  res.status(401).json({ error: 'Not authenticated' });
}

// ── Static files — login.html is public, index.html requires auth ───────
// Inject BASE_PATH into HTML files so the frontend knows the mount point
function serveHtmlWithBasePath(filePath, res) {
  let html = fs.readFileSync(filePath, 'utf8');
  html = html.replace('<head>', `<head>\n  <script>window.__BASE_PATH__ = '${BASE_PATH}';</script>`);
  res.type('html').send(html);
}

// Serve login.html and its assets without auth
app.get('/login.html', (req, res) => {
  serveHtmlWithBasePath(path.join(__dirname, 'login.html'), res);
});

// Protect index.html — redirect to login if not authenticated
app.get('/', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.redirect(BASE_PATH + '/login.html');
  }
  serveHtmlWithBasePath(path.join(__dirname, 'index.html'), res);
});

app.get('/index.html', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.redirect(BASE_PATH + '/login.html');
  }
  serveHtmlWithBasePath(path.join(__dirname, 'index.html'), res);
});

// Static files (CSS, JS, fonts) — served to everyone
app.use(express.static(__dirname));

// ── Auth API routes ─────────────────────────────────────────────────────

// Check if setup is needed
app.get('/api/auth/status', (req, res) => {
  res.json({
    needsSetup: !hasUsers(),
    loggedIn: !!(req.session && req.session.userId),
  });
});

// First-run setup — create initial user
app.post('/api/auth/setup', (req, res) => {
  if (hasUsers()) {
    return res.status(403).json({ error: 'Setup already completed' });
  }

  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run(username.trim(), hash);
    req.session.userId = db.prepare('SELECT id FROM users WHERE username = ?').get(username.trim()).id;
    res.json({ ok: true });
  } catch (err) {
    console.error('Setup error:', err);
    res.status(500).json({ error: err.message || 'Setup failed' });
  }
});

// Login
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const user = db.prepare('SELECT id, password FROM users WHERE username = ?').get(username.trim());
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  req.session.userId = user.id;
  res.json({ ok: true });
});

// Logout
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

// ── Migrate from data.json if it exists ─────────────────────────────────
function migrateFromJson() {
  if (!fs.existsSync(OLD_JSON)) return;

  const count = db.prepare('SELECT COUNT(*) AS n FROM income').get().n
              + db.prepare('SELECT COUNT(*) AS n FROM expenses').get().n;
  if (count > 0) return;

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
    fs.renameSync(OLD_JSON, OLD_JSON + '.migrated');
    console.log('Migrated data.json → SQLite');
  } catch (err) {
    console.error('Migration failed:', err.message);
  }
}

migrateFromJson();

// ── Prepared statements ─────────────────────────────────────────────────
const stmts = {
  allIncome:     db.prepare('SELECT id, date, desc, amount FROM income ORDER BY date, id'),
  allExpenses:   db.prepare('SELECT id, date, cat, desc, amount FROM expenses ORDER BY date, id'),
  allMileage:    db.prepare('SELECT id, date, desc, miles, rate FROM mileage ORDER BY date, id'),
  allSettings:   db.prepare('SELECT key, value FROM settings'),
  insertIncome:  db.prepare('INSERT INTO income (date, desc, amount) VALUES (?, ?, ?)'),
  insertExpense: db.prepare('INSERT INTO expenses (date, cat, desc, amount) VALUES (?, ?, ?, ?)'),
  insertMileage: db.prepare('INSERT INTO mileage (date, desc, miles, rate) VALUES (?, ?, ?, ?)'),
  deleteIncome:  db.prepare('DELETE FROM income WHERE id = ?'),
  deleteExpense: db.prepare('DELETE FROM expenses WHERE id = ?'),
  deleteMileage: db.prepare('DELETE FROM mileage WHERE id = ?'),
  upsertSetting: db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'),
};

// ── Protected API routes ────────────────────────────────────────────────
app.get('/api/data', requireAuth, (req, res) => {
  const income   = stmts.allIncome.all();
  const expenses = stmts.allExpenses.all();
  const mileage  = stmts.allMileage.all();
  const settings = Object.fromEntries(stmts.allSettings.all().map(r => [r.key, r.value]));

  res.json({
    income,
    expenses,
    mileage,
    federalRate: parseFloat(settings.federalRate ?? 12),
    seRate:      parseFloat(settings.seRate ?? 15.3),
    setAside:    parseFloat(settings.setAside ?? 0),
    mileageRate: parseFloat(settings.mileageRate ?? 0.70),
  });
});

app.post('/api/data', requireAuth, (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Invalid data' });
  }

  const sync = db.transaction(() => {
    db.exec('DELETE FROM income');
    for (const e of (body.income || [])) {
      stmts.insertIncome.run(e.date || null, e.desc || null, parseFloat(e.amount) || 0);
    }

    db.exec('DELETE FROM expenses');
    for (const e of (body.expenses || [])) {
      stmts.insertExpense.run(e.date || null, e.cat || null, e.desc || null, parseFloat(e.amount) || 0);
    }

    db.exec('DELETE FROM mileage');
    for (const e of (body.mileage || [])) {
      stmts.insertMileage.run(e.date || null, e.desc || null, parseFloat(e.miles) || 0, parseFloat(e.rate) || 0.70);
    }

    stmts.upsertSetting.run('federalRate', String(body.federalRate ?? 12));
    stmts.upsertSetting.run('seRate',      String(body.seRate ?? 15.3));
    stmts.upsertSetting.run('setAside',    String(body.setAside ?? 0));
    stmts.upsertSetting.run('mileageRate', String(body.mileageRate ?? 0.70));
  });

  try {
    sync();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save data' });
  }
});

// ── Backup & Restore ────────────────────────────────────────────────────
app.get('/api/backup', requireAuth, (req, res) => {
  const income   = stmts.allIncome.all();
  const expenses = stmts.allExpenses.all();
  const mileage  = stmts.allMileage.all();
  const settings = Object.fromEntries(stmts.allSettings.all().map(r => [r.key, r.value]));

  const backup = {
    version: 1,
    exportedAt: new Date().toISOString(),
    income,
    expenses,
    mileage,
    settings,
  };

  res.setHeader('Content-Disposition', `attachment; filename="etsy-tax-backup-${new Date().toISOString().split('T')[0]}.json"`);
  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(backup, null, 2));
});

app.post('/api/restore', requireAuth, (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || !body.version) {
    return res.status(400).json({ error: 'Invalid backup file format' });
  }

  const restore = db.transaction(() => {
    db.exec('DELETE FROM income');
    for (const e of (body.income || [])) {
      stmts.insertIncome.run(e.date || null, e.desc || null, parseFloat(e.amount) || 0);
    }

    db.exec('DELETE FROM expenses');
    for (const e of (body.expenses || [])) {
      stmts.insertExpense.run(e.date || null, e.cat || null, e.desc || null, parseFloat(e.amount) || 0);
    }

    db.exec('DELETE FROM mileage');
    for (const e of (body.mileage || [])) {
      stmts.insertMileage.run(e.date || null, e.desc || null, parseFloat(e.miles) || 0, parseFloat(e.rate) || 0.70);
    }

    if (body.settings) {
      for (const [key, value] of Object.entries(body.settings)) {
        stmts.upsertSetting.run(key, String(value));
      }
    }
  });

  try {
    restore();
    res.json({ ok: true });
  } catch (err) {
    console.error('Restore error:', err);
    res.status(500).json({ error: 'Failed to restore backup' });
  }
});

// ── Graceful shutdown ───────────────────────────────────────────────────
process.on('SIGINT',  () => { db.close(); process.exit(0); });
process.on('SIGTERM', () => { db.close(); process.exit(0); });

app.listen(PORT, () => {
  console.log(`Etsy Tax Tracker running at http://localhost:${PORT}`);
});
