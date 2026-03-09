// ── Settings Page Logic ──────────────────────────────────────────────────
const BASE = window.__BASE_PATH__ || window.location.pathname.replace(/\/(settings\.html)?$/, '');
const DEFAULTS = { income: [], expenses: [], mileage: [], recurringExpenses: [], federalRate: 12, seRate: 15.3, setAside: 0, mileageRate: 0.725, stateRate: 0, businessName: '', filingStatus: 'single', defaultCategory: 'Supplies', taxYear: '', csvImportExport: false, shops: [] };
let data = { ...DEFAULTS };

// 2026 IRS thresholds
const SS_WAGE_CAP = 184500;
const SS_RATE     = 0.124;
const MEDICARE_RATE = 0.029;
const ADDL_MEDICARE_THRESHOLD = 200000;
const ADDL_MEDICARE_RATE = 0.009;

// ── Persistence ─────────────────────────────────────────────────────────
async function loadData() {
  try {
    const res = await fetch(BASE + '/api/data', { cache: 'no-store' });
    if (res.status === 401) {
      window.location.href = BASE + '/login.html';
      return;
    }
    if (res.ok) {
      data = await res.json();
      migrateData();
      render();
      return;
    }
  } catch (e) { /* offline fallback */ }

  const stored = localStorage.getItem('etsyTaxData');
  if (stored) {
    data = JSON.parse(stored);
    migrateData();
  }
  render();
}

function migrateData() {
  if (data.taxRate !== undefined && data.federalRate === undefined) {
    data.federalRate = data.taxRate;
    data.seRate      = 15.3;
    delete data.taxRate;
  }
  data.income      = data.income      || [];
  data.expenses    = data.expenses    || [];
  data.mileage     = data.mileage     || [];
  data.recurringExpenses = data.recurringExpenses || [];
  data.federalRate = data.federalRate ?? 12;
  data.seRate      = data.seRate      ?? 15.3;
  data.setAside    = data.setAside    ?? 0;
  data.mileageRate = data.mileageRate ?? 0.725;
  data.stateRate = data.stateRate ?? 0;
  data.businessName = data.businessName ?? '';
  data.filingStatus = data.filingStatus ?? 'single';
  data.defaultCategory = data.defaultCategory ?? 'Supplies';
  data.taxYear = data.taxYear ?? '';
  data.csvImportExport = data.csvImportExport ?? false;
  data.shops = data.shops || [];
}

let dirty = false;
let debounceTimer = null;
function markDirty() {
  dirty = true;
  const btn = document.getElementById('saveBtn');
  if (btn) btn.classList.add('has-changes');
  // Auto-save after 1.5s of no changes
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => save(), 1500);
}

let saveTimeout = null;
function showSaveStatus(success, msg) {
  const btn = document.getElementById('saveBtn');
  if (!btn) return;
  btn.textContent = success ? 'Saved!' : (msg || 'Saved locally');
  btn.classList.remove('has-changes');
  btn.classList.add(success ? 'save-success' : 'save-warn');
  dirty = false;
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    btn.textContent = 'Save Changes';
    btn.classList.remove('save-success', 'save-warn');
  }, 2000);
}

// Warn if leaving with unsaved changes
window.addEventListener('beforeunload', (e) => {
  if (dirty) { e.preventDefault(); e.returnValue = ''; }
});

async function save() {
  localStorage.setItem('etsyTaxData', JSON.stringify(data));
  try {
    const res = await fetch(BASE + '/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (res.status === 401) {
      window.location.href = BASE + '/login.html';
      return;
    }
    if (res.ok) {
      data = await res.json();
      migrateData();
      showSaveStatus(true);
    } else {
      const errText = await res.text().catch(() => '');
      console.error('Save failed:', res.status, errText);
      showSaveStatus(false, `Save failed (${res.status})`);
    }
  } catch (e) {
    console.error('Save error:', e);
    showSaveStatus(false, 'Server unreachable');
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────
function fmt(n) {
  return '$' + parseFloat(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function calcTotals() {
  const income         = data.income.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
  const expenses       = data.expenses.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
  const mileageDeduct  = data.mileage.reduce((s, e) => s + ((parseFloat(e.miles) || 0) * (parseFloat(e.rate) || 0)), 0);
  const profit         = income - expenses - mileageDeduct;

  const seTaxableIncome = profit > 0 ? profit * 0.9235 : 0;

  const ssTax = seTaxableIncome > 0
    ? Math.min(seTaxableIncome, SS_WAGE_CAP) * SS_RATE
    : 0;
  const medicareTax = seTaxableIncome > 0
    ? seTaxableIncome * MEDICARE_RATE
    : 0;
  const addlMedicareTax = seTaxableIncome > ADDL_MEDICARE_THRESHOLD
    ? (seTaxableIncome - ADDL_MEDICARE_THRESHOLD) * ADDL_MEDICARE_RATE
    : 0;

  const seTax = ssTax + medicareTax + addlMedicareTax;
  const seDeduction    = seTax / 2;
  const qbiDeduction   = profit > 0 ? Math.max(profit - seDeduction, 0) * 0.20 : 0;
  const federalTaxable = profit > 0 ? Math.max(profit - seDeduction - qbiDeduction, 0) : 0;
  const federalTax     = federalTaxable * ((parseFloat(data.federalRate) || 0) / 100);
  const stateTax       = federalTaxable * ((parseFloat(data.stateRate) || 0) / 100);
  const totalRate      = (parseFloat(data.federalRate) || 0) + (parseFloat(data.seRate) || 0) + (parseFloat(data.stateRate) || 0);

  return { seTax, federalTax, stateTax, totalRate, ssTax, medicareTax, addlMedicareTax, qbiDeduction, seDeduction, federalTaxable };
}

// ── Render ───────────────────────────────────────────────────────────────
function render() {
  const { seTax, federalTax, stateTax, totalRate, ssTax, medicareTax, addlMedicareTax, qbiDeduction, seDeduction, federalTaxable } = calcTotals();

  // General settings
  const nameInput = document.getElementById('businessName');
  if (document.activeElement !== nameInput) nameInput.value = data.businessName || '';
  document.getElementById('filingStatus').value    = data.filingStatus || 'single';
  document.getElementById('defaultCategory').value = data.defaultCategory || 'Supplies';
  const taxYearInput = document.getElementById('taxYear');
  if (document.activeElement !== taxYearInput) taxYearInput.value = data.taxYear || '';

  // Shops
  renderShops();

  // Tax rates
  document.getElementById('federalRate').value = data.federalRate;
  document.getElementById('seRate').value      = data.seRate;
  document.getElementById('mileageRate').value = data.mileageRate;
  document.getElementById('stateRate').value   = data.stateRate || 0;

  document.getElementById('federalRateDisplay').textContent = `${parseFloat(data.federalRate).toFixed(1)}%`;
  document.getElementById('seRateDisplay').textContent      = `${parseFloat(data.seRate).toFixed(1)}%`;
  document.getElementById('mileageRateDisplay').textContent = `$${parseFloat(data.mileageRate).toFixed(3)}/mi`;
  document.getElementById('stateRateDisplay').textContent   = `${parseFloat(data.stateRate || 0).toFixed(1)}%`;
  document.getElementById('totalRateDisplay').textContent   = `${totalRate.toFixed(1)}%`;

  document.getElementById('seTaxBreakdown').textContent      = fmt(seTax);
  document.getElementById('federalTaxBreakdown').textContent = fmt(federalTax);
  document.getElementById('stateTaxBreakdown').textContent   = fmt(stateTax);
  document.getElementById('ssTaxDetail').textContent         = fmt(ssTax);
  document.getElementById('medicareTaxDetail').textContent   = fmt(medicareTax + addlMedicareTax);
  document.getElementById('qbiDeductionDisplay').textContent = fmt(qbiDeduction);
  document.getElementById('seDeductionDisplay').textContent  = fmt(seDeduction);
  document.getElementById('federalTaxableDisplay').textContent = fmt(federalTaxable);

  updateSliderBg('federalRate', data.federalRate, 0, 37);
  updateSliderBg('seRate',      data.seRate,      0, 20);
  updateSliderBg('stateRate',   data.stateRate || 0, 0, 15);
}

function updateSliderBg(id, val, min, max) {
  const pct = ((parseFloat(val) - min) / (max - min)) * 100;
  document.getElementById(id).style.background =
    `linear-gradient(to right, var(--terracotta) 0%, var(--terracotta) ${pct}%, var(--border) ${pct}%, var(--border) 100%)`;
}

// ── Actions ──────────────────────────────────────────────────────────────
function updateFederalRate(val)   { data.federalRate = parseFloat(val) || 0; render(); markDirty(); }
function updateSeRate(val)        { data.seRate      = parseFloat(val) || 0; render(); markDirty(); }
function updateMileageRate(val)   { data.mileageRate = parseFloat(val) || 0.725; render(); markDirty(); }
function updateStateRate(val)     { data.stateRate   = parseFloat(val) || 0; render(); markDirty(); }
function updateBusinessName(val)  { data.businessName = val.trim(); markDirty(); }
function updateFilingStatus(val)  { data.filingStatus = val; markDirty(); }
function updateDefaultCategory(val) { data.defaultCategory = val; markDirty(); }
function updateTaxYear(val) {
  const y = val ? parseInt(val) : '';
  data.taxYear = y && y >= 2020 && y <= 2099 ? y : '';
  markDirty();
}

// ── Shops ─────────────────────────────────────────────────────────────────
function renderShops() {
  const container = document.getElementById('shopsList');
  if (!container) return;

  // Seed with businessName as default shop if no shops exist yet
  if ((!data.shops || data.shops.length === 0) && data.businessName) {
    data.shops = [data.businessName];
  }

  if (!data.shops || data.shops.length === 0) {
    container.innerHTML = '<div class="empty-state">No shops added yet.</div>';
    return;
  }
  container.innerHTML = data.shops.map((shop, i) => `
    <div class="entry-item">
      <span class="entry-desc">${escapeHtml(shop)}</span>
      ${i === 0 ? '<span class="badge income">default</span>' : ''}
      <button class="entry-del" onclick="removeShop(${i})" title="Remove shop">&times;</button>
    </div>
  `).join('');
}

function addShop() {
  const input = document.getElementById('newShopName');
  const name = (input.value || '').trim();
  if (!name) return;
  if (data.shops.some(s => s.toLowerCase() === name.toLowerCase())) {
    alert('Shop already exists.');
    return;
  }
  data.shops.push(name);
  input.value = '';
  renderShops();
  markDirty();
}

function removeShop(index) {
  if (!confirm(`Remove "${data.shops[index]}"?`)) return;
  data.shops.splice(index, 1);
  renderShops();
  markDirty();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── CSV Export ────────────────────────────────────────────────────────────
function exportCSV() {
  function toCsv(headers, rows) {
    const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    return [headers.map(escape).join(','), ...rows.map(r => r.map(escape).join(','))].join('\n');
  }

  const incomeCsv = toCsv(['Date', 'Description', 'Amount'],
    data.income.map(e => [e.date, e.desc, e.amount]));

  const expenseCsv = toCsv(['Date', 'Category', 'Description', 'Amount'],
    data.expenses.map(e => [e.date, e.cat, e.desc, e.amount]));

  const mileageCsv = toCsv(['Date', 'Description', 'Miles', 'Rate'],
    data.mileage.map(e => [e.date, e.desc, e.miles, e.rate]));

  // Download as a zip-like bundle: 3 separate downloads
  downloadFile('income.csv', incomeCsv);
  setTimeout(() => downloadFile('expenses.csv', expenseCsv), 200);
  setTimeout(() => downloadFile('mileage.csv', mileageCsv), 400);
}

function downloadFile(filename, content) {
  const blob = new Blob([content], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── CSV Import ────────────────────────────────────────────────────────────
async function importCSV(input) {
  const file = input.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const rows = parseCSV(text);
    if (rows.length < 2) { alert('CSV file is empty or has no data rows.'); input.value = ''; return; }

    const headers = rows[0].map(h => h.toLowerCase().trim());
    const dataRows = rows.slice(1).filter(r => r.some(c => c.trim()));

    // Detect format: Etsy payments CSV or our own export
    const imported = detectAndImport(headers, dataRows);

    if (imported.income > 0 || imported.expenses > 0 || imported.mileage > 0) {
      alert(`Imported: ${imported.income} income, ${imported.expenses} expense, ${imported.mileage} mileage entries.`);
      render();
      markDirty();
    } else {
      alert('No recognizable data found. Expected columns: Date, Description, Amount (income) or Date, Category, Description, Amount (expenses).');
    }
  } catch (e) {
    alert('Failed to parse CSV: ' + e.message);
  }

  input.value = '';
}

function parseCSV(text) {
  const rows = [];
  let current = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { field += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { current.push(field); field = ''; }
      else if (ch === '\n' || (ch === '\r' && text[i + 1] === '\n')) {
        current.push(field); field = '';
        if (current.length > 1 || current[0].trim()) rows.push(current);
        current = [];
        if (ch === '\r') i++;
      } else { field += ch; }
    }
  }
  if (field || current.length) { current.push(field); rows.push(current); }
  return rows;
}

function detectAndImport(headers, rows) {
  const result = { income: 0, expenses: 0, mileage: 0 };

  // Check for Etsy-style: "date", "type", "title", "amount"
  const dateIdx = headers.findIndex(h => h === 'date');
  const amountIdx = headers.findIndex(h => h === 'amount' || h === 'net');
  const typeIdx = headers.findIndex(h => h === 'type' || h === 'category' || h === 'cat');
  const descIdx = headers.findIndex(h => h === 'description' || h === 'desc' || h === 'title');
  const milesIdx = headers.findIndex(h => h === 'miles');

  if (dateIdx === -1 || amountIdx === -1) return result;

  for (const row of rows) {
    const date = (row[dateIdx] || '').trim();
    const amount = parseFloat((row[amountIdx] || '0').replace(/[$,]/g, ''));
    const desc = (row[descIdx] ?? '').trim();
    const type = (row[typeIdx] ?? '').trim().toLowerCase();

    if (!date || isNaN(amount)) continue;

    // Normalize date to YYYY-MM-DD if possible
    const normalDate = normalizeDate(date);

    if (milesIdx !== -1) {
      const miles = parseFloat(row[milesIdx] || 0);
      if (miles > 0) {
        data.mileage.push({ date: normalDate, desc, miles, rate: data.mileageRate || 0.725 });
        result.mileage++;
        continue;
      }
    }

    if (type === 'expense' || type === 'fee' || type === 'shipping' || amount < 0) {
      const cat = type && type !== 'expense' ? type.charAt(0).toUpperCase() + type.slice(1) : (data.defaultCategory || 'Other');
      data.expenses.push({ date: normalDate, cat, desc, amount: Math.abs(amount) });
      result.expenses++;
    } else {
      data.income.push({ date: normalDate, desc, amount: Math.abs(amount) });
      result.income++;
    }
  }

  return result;
}

function normalizeDate(dateStr) {
  // Try ISO format first
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) return dateStr.slice(0, 10);
  // Try MM/DD/YYYY
  const parts = dateStr.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (parts) return `${parts[3]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
  return dateStr;
}

// ── Backup & Restore ─────────────────────────────────────────────────────
function downloadBackup() {
  window.location.href = BASE + '/api/backup';
}

async function restoreBackup(input) {
  const file = input.files[0];
  if (!file) return;

  if (!confirm('This will replace ALL your current data with the backup. Are you sure?')) {
    input.value = '';
    return;
  }

  try {
    const text = await file.text();
    const res = await fetch(BASE + '/api/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: text,
    });

    if (res.ok) {
      alert('Backup restored successfully! Reloading...');
      window.location.reload();
    } else {
      const err = await res.json();
      alert('Restore failed: ' + (err.error || 'Unknown error'));
    }
  } catch (e) {
    alert('Invalid backup file.');
  }

  input.value = '';
}

// ── Auth ──────────────────────────────────────────────────────────────────
async function logout() {
  await fetch(BASE + '/api/auth/logout', { method: 'POST' });
  window.location.href = BASE + '/login.html';
}

// ── Init ──────────────────────────────────────────────────────────────────
loadData();
