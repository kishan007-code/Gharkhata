import NepaliDate from 'nepali-date-converter'
const DAY = 864e5
export const BS_MONTHS = ['Baisakh','Jestha','Ashadh','Shrawan','Bhadra','Ashwin','Kartik','Mangsir','Poush','Magh','Falgun','Chaitra']
export const NP_MONTHS = ['बैशाख','जेठ','असार','श्रावण','भदौ','असोज','कात्तिक','मंसिर','पौष','माघ','फागुन','चैत']
export const np = s => String(s).replace(/\d/g, d => '०१२३४५६७८९'[d])
export const ad = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const fmt = n => Math.round(n || 0).toLocaleString('en-IN')
export const sum = (a, k) => a.reduce((s, x) => s + (x[k] || 0), 0)

// The date library is reliable up to BS 2089. Later years are ESTIMATED using 2089's month lengths.
const LAST = 2089
const BASE = new NepaliDate(2090, 0, 1).toJsDate()
let PAT = null
const pat = () => (PAT ??= Array.from({ length: 12 }, (_, m) => monthLen(LAST, m)))

export const addMonths = (y, m, k) => { const t = m + k; return { y: y + Math.floor(t / 12), m: ((t % 12) + 12) % 12 } }

function toJs(y, m, d) {
  if (y <= LAST) return new NepaliDate(y, m, d).toJsDate()
  let days = d - 1
  for (let yy = LAST + 1; yy < y; yy++) days += pat().reduce((a, b) => a + b, 0)
  for (let mm = 0; mm < m; mm++) days += pat()[mm]
  return new Date(BASE.getTime() + days * DAY)
}
export function monthLen(y, m) {
  if (y > LAST) return pat()[m]
  const n = addMonths(y, m, 1)
  return Math.round((toJs(n.y, n.m, 1) - toJs(y, m, 1)) / DAY)
}
export function bsParts(date) {
  if (date < BASE) {
    const [y, m, d] = new NepaliDate(date).format('YYYY/MM/DD').split('/').map(Number)
    return { y, m: m - 1, d }
  }
  let days = Math.round((date - BASE) / DAY), y = LAST + 1, m = 0
  const yl = pat().reduce((a, b) => a + b, 0)
  while (days >= yl) { days -= yl; y++ }
  while (days >= pat()[m]) { days -= pat()[m]; m++ }
  return { y, m, d: days + 1 }
}
export const bs = date => { const p = bsParts(date); return `${p.y}/${String(p.m + 1).padStart(2, '0')}/${String(p.d).padStart(2, '0')}` }
export const fromBS = (y, m, d) => toJs(y, m - 1, d)
export const firstWeekday = (y, m) => toJs(y, m, 1).getDay()
// day <= 0 or beyond month length => last day of that BS month
export const bsDate = (y, m, d) => { const len = monthLen(y, m); return toJs(y, m, d <= 0 || d > len ? len : d) }
export const validBS = (y, m, d) => {
  try { return y >= 2000 && y <= 2150 && m >= 1 && m <= 12 && d >= 1 && d <= monthLen(y, m - 1) } catch { return false }
}

// ---------- Loan schedule ----------
// extra = { rowIndex: amount }; mode 'reduce' = smaller installments, 'shorten' = same installment, ends sooner
export function schedule(L, extra = {}, mode = 'reduce') {
  if (L.interval === 0 && L.rate === 0) return [] // personal no-interest loan: no fixed schedule
  const [y, m, d] = L.start, begin = fromBS(y, m, d), term = L.term
  const off = bsDate(y, m - 1, L.day) <= begin ? 1 : 0
  const inst = []
  for (let i = 0; i < term; i++)
    if (i === term - 1 || (L.interval > 0 && i >= L.grace && (i - L.grace) % L.interval === 0)) inst.push(i)
  let bal = L.amount, prev = begin; const rows = []
  for (let i = 0; i < term && bal > 0.5; i++) {
    const p = addMonths(y, m - 1, i + off), date = bsDate(p.y, p.m, L.day)
    const days = Math.round((date - prev) / DAY)
    const interest = L.unit === 'monthly' ? bal * L.rate / 100 * (i === 0 ? days / 30 : 1) : bal * L.rate / 100 / 365 * days
    let principal = 0
    if (inst.includes(i)) {
      const rem = inst.filter(j => j >= i).length
      principal = i === term - 1 ? bal : mode === 'reduce' ? bal / rem : Math.min(L.amount / inst.length, bal)
    }
    const ex = Math.min(extra[i] || 0, bal - principal)
    bal -= principal + ex
    rows.push({ i, date, days, interest, principal, extra: ex, total: interest + principal + ex, bal })
    prev = date
  }
  return rows
}

// ---------- Recurring items: expense / tax / insurance / income ----------
export function expenseRows(X) {
  const [y, m, d] = X.start, every = Math.max(1, X.every || 1)
  const n = X.count > 0 ? X.count : Math.ceil(600 / every), rows = [] // 600 months = 50 years
  for (let i = 0; i < n; i++) {
    const p = addMonths(y, m - 1, i * every)
    const row = { i, date: bsDate(p.y, p.m, d), days: 0, interest: 0, principal: 0, extra: 0, total: X.amount, bal: 0 }
    if (X.deadline) { // pay any time before the last day of the deadline month (house tax: Asar)
      const dm = X.dlMonth ?? 2, fy = p.m > dm ? p.y + 1 : p.y
      row.deadline = bsDate(fy, dm, 0)
    }
    rows.push(row)
  }
  return rows
}

// ---------- Insurance: premiums + optional loan on the policy (interest only) ----------
export const maturityDate = X => { const [y, m, d] = X.start, p = addMonths(y, m - 1, X.years * 12); return bsDate(p.y, p.m, d) }
export function insuranceRows(X) {
  const [y, m, d] = X.start, every = Math.max(1, X.every || 12), rows = []
  const count = Math.round(X.years * 12 / every)
  for (let i = 0; i < count; i++) {
    const p = addMonths(y, m - 1, i * every)
rows.push({ i, date: bsDate(p.y, p.m, d), label: 'premium', days: 0, interest: 0, principal: 0, extra: 0, total: X.premium, bal: 0, autoPaid: i < (X.paidCount || 0) })
  }
  if (X.loan > 0 && X.rate > 0 && X.intFrom) {
    const [iy, im, id] = X.intFrom, end = maturityDate(X), yearly = X.loan * X.rate / 100
    for (let k = 1; k < 100; k++) {
      const p = addMonths(iy, im - 1, 12 * k), date = bsDate(p.y, p.m, id)
      if (date >= end) break // at maturity the loan and interest are deducted from the payout
      rows.push({ i: 1000 + k, date, label: 'loan interest', days: 0, interest: yearly, principal: 0, extra: 0, total: yearly, bal: 0 })
    }
  }
  return rows
}
export const rowsFor = it => {
  try { return it.kind === 'loan' ? schedule(it.data) : it.kind === 'insurance' ? insuranceRows(it.data) : expenseRows(it.data) }
  catch (e) { console.error('Bad item', it.name, e); return [] }
}