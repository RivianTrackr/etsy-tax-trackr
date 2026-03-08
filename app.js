// ── Data ─────────────────────────────────────────────────────────────────
const BASE = window.__BASE_PATH__ || window.location.pathname.replace(/\/(index\.html)?$/, '');
const DEFAULTS = { income: [], expenses: [], mileage: [], federalRate: 12, seRate: 15.3, setAside: 0, mileageRate: 0.70 };
let data = { ...DEFAULTS };
let selectedYear = new Date().getFullYear();

// Chart instances
let monthlyChart = null;
let categoryChart = null;
let profitChart = null;

// ── Persistence ───────────────────────────────────────────────────────────
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
      populateYearSelector();
      render();
      return;
    }
  } catch (e) { /* server unavailable, fall back to localStorage */ }

  const stored = localStorage.getItem('etsyTaxData')
              || localStorage.getItem('etsyTaxData2026')
              || localStorage.getItem('etsyTaxData2025');
  if (stored) {
    data = JSON.parse(stored);
    migrateData();
  }
  populateYearSelector();
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
  data.federalRate = data.federalRate ?? 12;
  data.seRate      = data.seRate      ?? 15.3;
  data.setAside    = data.setAside    ?? 0;
  data.mileageRate = data.mileageRate ?? 0.70;
}

async function save() {
  localStorage.setItem('etsyTaxData', JSON.stringify(data));
  try {
    const res = await fetch(BASE + '/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      // Reload to pick up server-assigned IDs
      const fresh = await fetch(BASE + '/api/data', { cache: 'no-store' });
      if (fresh.ok) {
        data = await fresh.json();
        migrateData();
      }
    } else {
      console.error('Save failed:', res.status, await res.text().catch(() => ''));
    }
  } catch (e) {
    console.warn('Save offline, using localStorage fallback:', e.message);
  }
}

// ── Year helpers ──────────────────────────────────────────────────────────
function getYearsFromData() {
  const years = new Set();
  const currentYear = new Date().getFullYear();
  years.add(currentYear);
  for (const e of data.income)   { if (e.date) years.add(parseInt(e.date.slice(0, 4))); }
  for (const e of data.expenses) { if (e.date) years.add(parseInt(e.date.slice(0, 4))); }
  for (const e of data.mileage)  { if (e.date) years.add(parseInt(e.date.slice(0, 4))); }
  return [...years].filter(y => y > 2000).sort((a, b) => b - a);
}

function populateYearSelector() {
  const sel = document.getElementById('yearSelect');
  const years = getYearsFromData();
  if (!years.includes(selectedYear)) selectedYear = years[0];
  sel.innerHTML = years.map(y => `<option value="${y}" ${y === selectedYear ? 'selected' : ''}>${y}</option>`).join('');
}

function changeYear(y) {
  selectedYear = parseInt(y);
  render();
}

function filterByYear(items) {
  return items
    .filter(e => e.date && parseInt(e.date.slice(0, 4)) === selectedYear)
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
}

// ── Helpers ───────────────────────────────────────────────────────────────
function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function fmt(n) {
  return '$' + parseFloat(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d) {
  if (!d) return '—';
  const p = d.split('-');
  return `${p[1]}/${p[2]}/${p[0].slice(2)}`;
}

function calcTotals() {
  const yearIncome   = filterByYear(data.income);
  const yearExpenses = filterByYear(data.expenses);
  const yearMileage  = filterByYear(data.mileage);

  const income         = yearIncome.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
  const expenses       = yearExpenses.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
  const mileageDeduct  = yearMileage.reduce((s, e) => s + ((parseFloat(e.miles) || 0) * (parseFloat(e.rate) || 0)), 0);
  const totalDeductions = expenses + mileageDeduct;
  const profit         = income - totalDeductions;
  const totalRate      = (parseFloat(data.federalRate) || 0) + (parseFloat(data.seRate) || 0);
  const seTax          = profit > 0 ? profit * ((parseFloat(data.seRate) || 0) / 100) : 0;
  const federalTax     = profit > 0 ? profit * ((parseFloat(data.federalRate) || 0) / 100) : 0;
  const tax            = profit > 0 ? profit * (totalRate / 100) : 0;
  return { income, expenses: totalDeductions, profit, tax, seTax, federalTax, totalRate, mileageDeduct };
}

// ── Quarters (dynamic year) ──────────────────────────────────────────────
function getQuarters(year) {
  return [
    { label: 'Q1', period: 'Jan – Mar', due: `Apr 15, ${year}`,     dueDate: new Date(`${year}-04-15`) },
    { label: 'Q2', period: 'Apr – May', due: `Jun 15, ${year}`,     dueDate: new Date(`${year}-06-15`) },
    { label: 'Q3', period: 'Jun – Aug', due: `Sep 15, ${year}`,     dueDate: new Date(`${year}-09-15`) },
    { label: 'Q4', period: 'Sep – Dec', due: `Jan 15, ${year + 1}`, dueDate: new Date(`${year + 1}-01-15`) },
  ];
}

// ── Render ────────────────────────────────────────────────────────────────
function render() {
  const { income, expenses, profit, tax, seTax, federalTax, totalRate, mileageDeduct } = calcTotals();

  document.getElementById('totalIncome').textContent   = fmt(income);
  document.getElementById('totalExpenses').textContent = fmt(expenses);
  document.getElementById('netProfit').textContent     = fmt(profit);
  document.getElementById('taxOwed').textContent       = fmt(tax);
  document.getElementById('taxRateLabel').textContent  = `at ${totalRate.toFixed(1)}% total`;

  // Rate inputs
  document.getElementById('federalRate').value         = data.federalRate;
  document.getElementById('seRate').value              = data.seRate;
  document.getElementById('federalRateDisplay').textContent = `${parseFloat(data.federalRate).toFixed(1)}%`;
  document.getElementById('seRateDisplay').textContent      = `${parseFloat(data.seRate).toFixed(1)}%`;
  document.getElementById('totalRateDisplay').textContent   = `${totalRate.toFixed(1)}%`;
  document.getElementById('seTaxBreakdown').textContent     = fmt(seTax);
  document.getElementById('federalTaxBreakdown').textContent = fmt(federalTax);

  // Slider gradient helpers
  updateSliderBg('federalRate', data.federalRate, 0, 37);
  updateSliderBg('seRate',      data.seRate,      0, 20);

  // Mileage info
  document.getElementById('mileageRateBadge').textContent = `IRS rate: $${parseFloat(data.mileageRate).toFixed(2)}/mi`;
  document.getElementById('mileageTotal').textContent = `Total mileage deduction: ${fmt(mileageDeduct)}`;

  renderList('incomeList',  filterByYear(data.income),   'income');
  renderList('expenseList', filterByYear(data.expenses), 'expense');
  renderMileageList();
  renderQuarters(tax);
  renderSetAside(tax);
  renderCharts();
}

function updateSliderBg(id, val, min, max) {
  const pct = ((parseFloat(val) - min) / (max - min)) * 100;
  document.getElementById(id).style.background =
    `linear-gradient(to right, var(--terracotta) 0%, var(--terracotta) ${pct}%, var(--border) ${pct}%, var(--border) 100%)`;
}

function renderList(id, items, type) {
  const el = document.getElementById(id);
  if (!items.length) {
    el.innerHTML = `<div class="empty-state">${type === 'income' ? 'No payouts logged yet' : 'No deductions logged yet'}</div>`;
    return;
  }
  // items are already sorted oldest→newest by filterByYear; reverse for display
  el.innerHTML = [...items].reverse().map(e => {
    const entryId = e.id != null ? e.id : -1;
    return `<div class="entry-item">
      <span class="entry-date">${esc(fmtDate(e.date))}</span>
      <span class="entry-desc">${esc(e.desc || '—')}</span>
      ${e.cat ? `<span class="entry-tag">${esc(e.cat)}</span>` : ''}
      <span class="entry-amount ${type}">${fmt(e.amount)}</span>
      <button class="entry-del" onclick="deleteEntry('${type}',${entryId})">&#215;</button>
    </div>`;
  }).join('');
}

function renderMileageList() {
  const el = document.getElementById('mileageList');
  if (!el) { console.error('mileageList element not found'); return; }
  const items = filterByYear(data.mileage);
  if (!items.length) {
    el.innerHTML = '<div class="empty-state">No trips logged yet</div>';
    if (data.mileage.length > 0) {
      console.warn('Mileage entries exist but none match selected year', selectedYear, '- entries:', data.mileage.map(e => e.date));
    }
    return;
  }
  el.innerHTML = [...items].reverse().map(e => {
    const entryId = e.id != null ? e.id : -1;
    const deduction = (parseFloat(e.miles) || 0) * (parseFloat(e.rate) || 0);
    return `<div class="entry-item">
      <span class="entry-date">${esc(fmtDate(e.date))}</span>
      <span class="entry-desc">${esc(e.desc || '—')}</span>
      <span class="entry-tag">${(parseFloat(e.miles) || 0).toFixed(1)} mi</span>
      <span class="entry-amount expense">${fmt(deduction)}</span>
      <button class="entry-del" onclick="deleteEntry('mileage',${entryId})">&#215;</button>
    </div>`;
  }).join('');
}

function renderQuarters(totalTax) {
  const quarters = getQuarters(selectedYear);
  const now   = new Date();
  const perQ  = totalTax / 4;
  const nextQ = quarters.find(q => q.dueDate >= now);

  document.getElementById('quarterlyTitle').textContent = `${selectedYear} Quarterly Tax Deadlines`;

  document.getElementById('quarterlyGrid').innerHTML = quarters.map(q => {
    const isPast    = q.dueDate < now;
    const isCurrent = q === nextQ;
    return `<div class="quarter-card ${isCurrent ? 'current' : isPast ? 'past' : ''}">
      ${isCurrent ? '<div class="current-badge">Next Due</div>' : ''}
      <div class="q-label">${q.label}</div>
      <div class="q-due">${q.due}</div>
      <div class="q-amount">${fmt(perQ)}</div>
      <div class="q-period">${q.period}</div>
    </div>`;
  }).join('');
}

function renderSetAside(tax) {
  const set   = parseFloat(data.setAside || 0);
  const input = document.getElementById('setAsideInput');
  if (document.activeElement !== input) {
    input.value = set > 0 ? set : '';
  }
  const pct  = tax > 0 ? Math.min((set / tax) * 100, 100) : 0;
  const fill = document.getElementById('progressFill');
  fill.style.width = pct + '%';
  fill.className   = 'progress-fill' + (pct >= 100 ? ' complete' : pct >= 60 ? '' : ' warn');
  document.getElementById('progressLeft').textContent  = `${fmt(set)} set aside (${Math.round(pct)}%)`;
  document.getElementById('progressRight').textContent = `${fmt(tax)} needed`;
}

// ── Charts ───────────────────────────────────────────────────────────────
const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function getMonthlyData() {
  const incomeByMonth  = new Array(12).fill(0);
  const expenseByMonth = new Array(12).fill(0);
  const mileageByMonth = new Array(12).fill(0);

  for (const e of filterByYear(data.income)) {
    if (e.date) {
      const m = parseInt(e.date.slice(5, 7)) - 1;
      incomeByMonth[m] += parseFloat(e.amount) || 0;
    }
  }
  for (const e of filterByYear(data.expenses)) {
    if (e.date) {
      const m = parseInt(e.date.slice(5, 7)) - 1;
      expenseByMonth[m] += parseFloat(e.amount) || 0;
    }
  }
  for (const e of filterByYear(data.mileage)) {
    if (e.date) {
      const m = parseInt(e.date.slice(5, 7)) - 1;
      mileageByMonth[m] += (parseFloat(e.miles) || 0) * (parseFloat(e.rate) || 0);
    }
  }

  return { incomeByMonth, expenseByMonth, mileageByMonth };
}

function getCategoryData() {
  const cats = {};
  for (const e of filterByYear(data.expenses)) {
    const cat = e.cat || 'Other';
    cats[cat] = (cats[cat] || 0) + (parseFloat(e.amount) || 0);
  }
  // Add mileage as a category
  const mileageTotal = filterByYear(data.mileage).reduce((s, e) => s + ((parseFloat(e.miles) || 0) * (parseFloat(e.rate) || 0)), 0);
  if (mileageTotal > 0) cats['Mileage'] = mileageTotal;
  return cats;
}

const CHART_COLORS = [
  '#c4623a', '#7a9e7e', '#b8882e', '#5c4a3a', '#e8856a',
  '#4a8a50', '#d4a240', '#9a8878', '#6b8f9e', '#c49a6c'
];

function renderCharts() {
  if (typeof Chart === 'undefined') return;

  const { incomeByMonth, expenseByMonth, mileageByMonth } = getMonthlyData();
  const totalExpByMonth = expenseByMonth.map((v, i) => v + mileageByMonth[i]);
  const profitByMonth   = incomeByMonth.map((v, i) => v - totalExpByMonth[i]);
  const catData = getCategoryData();

  const fontFamily = "'DM Sans', sans-serif";
  const gridColor  = '#e0d5c8';
  const textColor  = '#5c4a3a';

  // Monthly Income vs Expenses bar chart
  if (monthlyChart) monthlyChart.destroy();
  monthlyChart = new Chart(document.getElementById('monthlyChart'), {
    type: 'bar',
    data: {
      labels: MONTH_LABELS,
      datasets: [
        { label: 'Income',     data: incomeByMonth,   backgroundColor: '#7a9e7e', borderRadius: 4 },
        { label: 'Deductions', data: totalExpByMonth,  backgroundColor: '#c4623a', borderRadius: 4 },
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        title: { display: true, text: 'Monthly Income vs Deductions', font: { family: fontFamily, size: 14, weight: '600' }, color: textColor },
        legend: { labels: { font: { family: fontFamily, size: 11 }, color: textColor } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { family: fontFamily, size: 11 }, color: textColor } },
        y: { grid: { color: gridColor }, ticks: { font: { family: fontFamily, size: 11 }, color: textColor, callback: v => '$' + v.toLocaleString() } },
      }
    }
  });

  // Expense category doughnut
  const catLabels = Object.keys(catData);
  const catValues = Object.values(catData);

  if (categoryChart) categoryChart.destroy();
  categoryChart = new Chart(document.getElementById('categoryChart'), {
    type: 'doughnut',
    data: {
      labels: catLabels,
      datasets: [{
        data: catValues,
        backgroundColor: CHART_COLORS.slice(0, catLabels.length),
        borderWidth: 2,
        borderColor: '#fffdf9',
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        title: { display: true, text: 'Deductions by Category', font: { family: fontFamily, size: 14, weight: '600' }, color: textColor },
        legend: { position: 'right', labels: { font: { family: fontFamily, size: 11 }, color: textColor, padding: 12 } },
      }
    }
  });

  // Monthly profit trend line
  if (profitChart) profitChart.destroy();
  profitChart = new Chart(document.getElementById('profitChart'), {
    type: 'line',
    data: {
      labels: MONTH_LABELS,
      datasets: [{
        label: 'Net Profit',
        data: profitByMonth,
        borderColor: '#b8882e',
        backgroundColor: 'rgba(184, 136, 46, 0.1)',
        fill: true,
        tension: 0.3,
        pointRadius: 4,
        pointBackgroundColor: '#b8882e',
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        title: { display: true, text: 'Monthly Profit Trend', font: { family: fontFamily, size: 14, weight: '600' }, color: textColor },
        legend: { labels: { font: { family: fontFamily, size: 11 }, color: textColor } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { family: fontFamily, size: 11 }, color: textColor } },
        y: { grid: { color: gridColor }, ticks: { font: { family: fontFamily, size: 11 }, color: textColor, callback: v => '$' + v.toLocaleString() } },
      }
    }
  });
}

// ── Actions ───────────────────────────────────────────────────────────────
async function addIncome() {
  const date   = document.getElementById('incomeDate').value;
  if (!date) { alert('Please select a date.'); return; }
  const desc   = document.getElementById('incomeDesc').value.trim() || 'Etsy Payout';
  const amount = parseFloat(document.getElementById('incomeAmt').value);
  if (!amount || amount <= 0) { alert('Please enter a valid amount.'); return; }
  data.income.push({ date, desc, amount });
  document.getElementById('incomeDesc').value = '';
  document.getElementById('incomeAmt').value  = '';
  await save(); populateYearSelector(); render();
}

async function addExpense() {
  const date   = document.getElementById('expenseDate').value;
  if (!date) { alert('Please select a date.'); return; }
  const cat    = document.getElementById('expenseCat').value;
  const desc   = document.getElementById('expenseDesc').value.trim() || cat;
  const amount = parseFloat(document.getElementById('expenseAmt').value);
  if (!amount || amount <= 0) { alert('Please enter a valid amount.'); return; }
  data.expenses.push({ date, cat, desc, amount });
  document.getElementById('expenseDesc').value = '';
  document.getElementById('expenseAmt').value  = '';
  await save(); populateYearSelector(); render();
}

async function addMileage() {
  try {
    const date  = document.getElementById('mileageDate').value;
    if (!date) { alert('Please select a date.'); return; }
    const desc  = document.getElementById('mileageDesc').value.trim() || 'Business trip';
    const miles = parseFloat(document.getElementById('mileageMiles').value);
    if (!miles || miles <= 0) { alert('Please enter valid miles.'); return; }
    const rate = parseFloat(data.mileageRate) || 0.70;
    data.mileage.push({ date, desc, miles, rate });
    document.getElementById('mileageDesc').value  = '';
    document.getElementById('mileageMiles').value = '';
    document.getElementById('mileageDate').value  = new Date().toISOString().split('T')[0];
    await save();
    populateYearSelector();
    render();
    console.log('Mileage added successfully:', { date, desc, miles, rate }, 'Total entries:', data.mileage.length);
  } catch (err) {
    console.error('addMileage error:', err);
    alert('Error logging trip: ' + err.message);
  }
}

async function deleteEntry(type, id) {
  if (!confirm('Remove this entry?')) return;
  const arr = type === 'income' ? data.income : type === 'expense' ? data.expenses : data.mileage;
  const idx = arr.findIndex(e => e.id === id);
  if (idx >= 0) arr.splice(idx, 1);
  await save(); render();
}

function updateFederalRate(val) { data.federalRate = parseFloat(val) || 0; render(); save(); }
function updateSeRate(val)      { data.seRate      = parseFloat(val) || 0; render(); save(); }
function updateSetAside(val)    { data.setAside    = parseFloat(val) || 0; render(); save(); }

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
    const backup = JSON.parse(text);

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
const today = new Date().toISOString().split('T')[0];
document.getElementById('incomeDate').value  = today;
document.getElementById('expenseDate').value = today;
document.getElementById('mileageDate').value = today;

loadData();
