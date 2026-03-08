// ── Settings Page Logic ──────────────────────────────────────────────────
const BASE = window.__BASE_PATH__ || window.location.pathname.replace(/\/(settings\.html)?$/, '');
const DEFAULTS = { income: [], expenses: [], mileage: [], recurringExpenses: [], federalRate: 12, seRate: 15.3, setAside: 0, mileageRate: 0.725, stateRate: 0, businessName: '', filingStatus: 'single', defaultCategory: 'Supplies' };
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
function showSaveStatus(success) {
  const btn = document.getElementById('saveBtn');
  if (!btn) return;
  btn.textContent = success ? 'Saved!' : 'Saved locally';
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
    if (res.ok) {
      data = await res.json();
      migrateData();
      showSaveStatus(true);
    } else {
      showSaveStatus(false);
    }
  } catch (e) {
    console.warn('Save offline:', e.message);
    showSaveStatus(false);
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
