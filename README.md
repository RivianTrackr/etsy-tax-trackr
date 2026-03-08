# Etsy Tax Trackr

A self-hosted tax tracking app for Etsy sellers. Track income, deductions, mileage, and estimated quarterly taxes with real-time calculations, visual dashboards, and secure authentication.

## Features

### Income Tracking
- Log weekly Etsy payouts with date and description
- View totals filtered by tax year

### Expense Deductions
- Categorize business expenses (supplies, shipping, software, advertising, etc.)
- Automatic deduction totals per category

### Mileage Tracker
- Log business trips with date, destination, and miles driven
- Automatic IRS mileage rate deduction calculation (default $0.725/mile for 2026)
- Configurable rate per entry

### Tax Calculations
- Adjustable Federal Income Tax rate (0-37%) and Self-Employment Tax rate (0-20%)
- Real-time breakdown: Federal Tax vs. SE Tax
- Taxable income = Total Payouts - Deductions - Mileage Deductions

### Quarterly Tax Deadlines
- Automatic quarterly payment estimates (annual tax / 4)
- Dynamic deadline display: Q1 (Apr 15), Q2 (Jun 15), Q3 (Sep 15), Q4 (Jan 15 next year)
- Highlights upcoming deadlines

### Tax Savings Tracker
- Track how much you've set aside for taxes
- Progress bar showing saved vs. owed

### Dashboard
- Monthly Income vs. Deductions bar chart
- Deductions by Category doughnut chart
- Monthly Profit Trend line chart

### Data Management
- Download full JSON backup with timestamp
- Restore from backup file
- Year selector to view data by tax year
- Offline fallback via localStorage

### Authentication
- Secure login with bcrypt-hashed passwords
- First-run setup creates initial account
- Session-based auth with 7-day expiry

---

## Setup

### Prerequisites

- **Node.js** v18+ (v20 recommended)
- **npm**
- **Apache** with `mod_proxy` and `mod_proxy_http` enabled (for reverse proxy)

### 1. Clone and Install

```bash
cd /var/www/html/your-domain/public
git clone <repo-url> ashley
cd ashley
npm install
```

### 2. Set Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Port the Node.js server listens on |
| `BASE_PATH` | `""` | URL prefix if served under a subdirectory (e.g., `/ashley`) |
| `SESSION_SECRET` | random | Secret for signing session cookies (set this in production!) |

Example:

```bash
export PORT=3000
export BASE_PATH="/ashley"
export SESSION_SECRET="your-random-secret-here"
```

To generate a strong secret:

```bash
openssl rand -hex 32
```

### 3. Start the Server

```bash
node server.js
```

Or with environment variables inline:

```bash
PORT=3000 BASE_PATH="/ashley" SESSION_SECRET="$(openssl rand -hex 32)" node server.js
```

### 4. Apache Reverse Proxy Configuration

Enable required modules:

```bash
sudo a2enmod proxy proxy_http
sudo systemctl restart apache2
```

Add to your Apache virtual host config (e.g., `/etc/apache2/sites-available/your-domain.conf`):

```apache
<VirtualHost *:443>
    ServerName your-domain.com

    # ... your existing SSL config ...

    # Reverse proxy for Etsy Tax Trackr
    ProxyPreserveHost On
    ProxyPass /ashley http://127.0.0.1:3000/ashley
    ProxyPassReverse /ashley http://127.0.0.1:3000/ashley
</VirtualHost>
```

Then reload Apache:

```bash
sudo systemctl reload apache2
```

The app will be accessible at `https://your-domain.com/ashley`.

### 5. Keep the Server Running (systemd)

Create a service file:

```bash
sudo nano /etc/systemd/system/etsy-tax-trackr.service
```

Paste:

```ini
[Unit]
Description=Etsy Tax Trackr
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/html/your-domain/public/ashley
Environment=PORT=3000
Environment=BASE_PATH=/ashley
Environment=SESSION_SECRET=your-secret-here
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable etsy-tax-trackr
sudo systemctl start etsy-tax-trackr
```

---

## Terminal Commands

### Server Management

```bash
# Start the server
node server.js

# Start with environment variables
PORT=3000 BASE_PATH="/ashley" node server.js

# Stop the server (if running in foreground)
Ctrl+C

# Kill server running on port 3000
fuser -k 3000/tcp

# Restart via systemd (if configured)
sudo systemctl restart etsy-tax-trackr

# View server logs
sudo journalctl -u etsy-tax-trackr -f
```

### Dependencies

```bash
# Install all dependencies
npm install

# Update dependencies
npm update
```

### Database

The SQLite database (`tax_data.db`) is created automatically on first run.

```bash
# View database contents (requires sqlite3 CLI)
sqlite3 tax_data.db

# Inside sqlite3:
.tables                          -- list all tables
SELECT * FROM income;            -- view income entries
SELECT * FROM expenses;          -- view expenses
SELECT * FROM mileage;           -- view mileage logs
SELECT * FROM settings;          -- view settings
SELECT * FROM users;             -- view user accounts
.quit                            -- exit
```

### Backup & Restore

Backups can be done through the web UI, or manually:

```bash
# Manual database backup
cp tax_data.db tax_data.db.bak

# Restore from manual backup
cp tax_data.db.bak tax_data.db
```

### Apache

```bash
# Enable proxy modules
sudo a2enmod proxy proxy_http

# Test Apache config
sudo apachectl configtest

# Reload Apache
sudo systemctl reload apache2

# Check Apache status
sudo systemctl status apache2
```

---

## Project Structure

```
├── server.js        # Express backend, API routes, auth, SQLite
├── app.js           # Frontend logic, data sync, rendering
├── index.html       # Main application page
├── login.html       # Login / first-run setup page
├── style.css        # Styling (Playfair Display + DM Sans)
├── package.json     # Node.js dependencies
└── tax_data.db      # SQLite database (auto-created)
```

## API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/auth/status` | No | Check if setup is needed / login status |
| POST | `/api/auth/setup` | No | Create initial user account (first-run only) |
| POST | `/api/auth/login` | No | Log in |
| POST | `/api/auth/logout` | Yes | Log out |
| GET | `/api/data` | Yes | Fetch all data |
| POST | `/api/data` | Yes | Save all data (returns saved data with IDs) |
| GET | `/api/backup` | Yes | Download JSON backup |
| POST | `/api/restore` | Yes | Restore from JSON backup |
