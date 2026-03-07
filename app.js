// ── Data ─────────────────────────────────────────────────────────────────
const DEFAULTS = '{"income":[],"expenses":[],"federalRate":12,"seRate":15.3,"setAside":0}';
let data = JSON.parse(localStorage.getItem('etsyTaxData2025') || DEFAULTS);

// Migrate old single-rate data saved before this update
if (data.taxRate !== undefined && data.federalRate === undefined) {
  data.federalRate = data.taxRate;
  data.seRate      = 15.3;
  delete data.taxRate;
}

const quarters = [
  { label: 'Q1', period: 'Jan – Mar', due: 'Apr 15, 2026', dueDate: new Date('2026-04-15') },
  { label: 'Q2', period: 'Apr – May', due: 'Jun 15, 2026', dueDate: new Date('2026-06-15') },
  { label: 'Q3', period: 'Jun – Aug', due: 'Sep 15, 2026', dueDate: new Date('2026-09-15') },
  { label: 'Q4', period: 'Sep – Dec', due: 'Jan 15, 2027', dueDate: new Date('2027-01-15') },
];

// ── Persistence ───────────────────────────────────────────────────────────
function save() {
  localStorage.setItem('etsyTaxData2025', JSON.stringify(data));
}

// ── Helpers ───────────────────────────────────────────────────────────────
function fmt(n) {
  return '$' + parseFloat(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d) {
  if (!d) return '—';
  const p = d.split('-');
  return `${p[1]}/${p[2]}/${p[0].slice(2)}`;
}

function calcTotals() {
  const income      = data.income.reduce((s, e) => s + parseFloat(e.amount), 0);
  const expenses    = data.expenses.reduce((s, e) => s + parseFloat(e.amount), 0);
  const profit      = income - expenses;
  const totalRate   = (parseFloat(data.federalRate) || 0) + (parseFloat(data.seRate) || 0);
  const seTax       = profit > 0 ? profit * ((parseFloat(data.seRate) || 0) / 100) : 0;
  const federalTax  = profit > 0 ? profit * ((parseFloat(data.federalRate) || 0) / 100) : 0;
  const tax         = profit > 0 ? profit * (totalRate / 100) : 0;
  return { income, expenses, profit, tax, seTax, federalTax, totalRate };
}

// ── Render ────────────────────────────────────────────────────────────────
function render() {
  const { income, expenses, profit, tax, seTax, federalTax, totalRate } = calcTotals();

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

  renderList('incomeList',  data.income,   'income');
  renderList('expenseList', data.expenses, 'expense');
  renderQuarters(tax);
  renderSetAside(tax);
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
  el.innerHTML = [...items].reverse().map((e, ri) => {
    const realIdx = items.length - 1 - ri;
    return `<div class="entry-item">
      <span class="entry-date">${fmtDate(e.date)}</span>
      <span class="entry-desc">${e.desc || '—'}</span>
      ${e.cat ? `<span class="entry-tag">${e.cat}</span>` : ''}
      <span class="entry-amount ${type}">${fmt(e.amount)}</span>
      <button class="entry-del" onclick="deleteEntry('${type}',${realIdx})">×</button>
    </div>`;
  }).join('');
}

function renderQuarters(totalTax) {
  const now   = new Date();
  const perQ  = totalTax / 4;
  const nextQ = quarters.find(q => q.dueDate >= now);
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
  const set  = parseFloat(data.setAside || 0);
  document.getElementById('setAsideInput').value = set > 0 ? set : '';
  const pct  = tax > 0 ? Math.min((set / tax) * 100, 100) : 0;
  const fill = document.getElementById('progressFill');
  fill.style.width = pct + '%';
  fill.className   = 'progress-fill' + (pct >= 100 ? ' over' : pct >= 60 ? '' : ' warn');
  document.getElementById('progressLeft').textContent  = `${fmt(set)} set aside (${Math.round(pct)}%)`;
  document.getElementById('progressRight').textContent = `${fmt(tax)} needed`;
}

// ── Actions ───────────────────────────────────────────────────────────────
function addIncome() {
  const date   = document.getElementById('incomeDate').value;
  const desc   = document.getElementById('incomeDesc').value.trim() || 'Etsy Payout';
  const amount = parseFloat(document.getElementById('incomeAmt').value);
  if (!amount || amount <= 0) { alert('Please enter a valid amount.'); return; }
  data.income.push({ date, desc, amount });
  save(); render();
  document.getElementById('incomeDesc').value = '';
  document.getElementById('incomeAmt').value  = '';
}

function addExpense() {
  const date   = document.getElementById('expenseDate').value;
  const cat    = document.getElementById('expenseCat').value;
  const desc   = document.getElementById('expenseDesc').value.trim() || cat;
  const amount = parseFloat(document.getElementById('expenseAmt').value);
  if (!amount || amount <= 0) { alert('Please enter a valid amount.'); return; }
  data.expenses.push({ date, cat, desc, amount });
  save(); render();
  document.getElementById('expenseDesc').value = '';
  document.getElementById('expenseAmt').value  = '';
}

function deleteEntry(type, idx) {
  if (!confirm('Remove this entry?')) return;
  if (type === 'income') data.income.splice(idx, 1);
  else data.expenses.splice(idx, 1);
  save(); render();
}

function updateFederalRate(val) { data.federalRate = parseFloat(val) || 0; save(); render(); }
function updateSeRate(val)      { data.seRate      = parseFloat(val) || 0; save(); render(); }
function updateSetAside(val)    { data.setAside    = parseFloat(val) || 0; save(); render(); }

// ── Init ──────────────────────────────────────────────────────────────────
const today = new Date().toISOString().split('T')[0];
document.getElementById('incomeDate').value  = today;
document.getElementById('expenseDate').value = today;

render();
