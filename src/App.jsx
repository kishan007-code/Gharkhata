import { useState, useMemo, useEffect, Component } from 'react'
import { supabase } from './supabase'
import { rowsFor, expenseRows, insuranceRows, maturityDate, schedule, bs as rawBs, bsParts, ad, fromBS, fmt as rawFmt, sum, BS_MONTHS, monthLen, firstWeekday, addMonths, validBS } from './engine'
import { exportPDF } from './pdf'
import { t, N, mn, setLang, getLang } from './i18n'

/* digits follow the chosen language everywhere */
const fmt = x => N(rawFmt(x))
const bs = d => N(rawBs(d))
const rs = x => t('NPR') + ' ' + fmt(x)

const today = new Date()
const TODAY = bsParts(today)
const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate())
const pad = n => String(n).padStart(2, '0')
const todayStr = `${TODAY.y}/${pad(TODAY.m + 1)}/${pad(TODAY.d)}`
const LABEL = { loan: 'Loan', expense: 'Expense', tax: 'Tax', insurance: 'Insurance' }
const inMonth = (e, v) => { const p = (e.p ??= bsParts(e.date)); return p.y === v.y && p.m === v.m }
const dlOf = e => e.deadline || e.date
const isPersonal = D => D.interval === 0 && D.rate === 0
const paidOf = (pl, id) => pl.filter(p => p.item_id === id).reduce((s, p) => s + p.amount, 0)
const WEEKEND = [0, 6] // Sunday + Saturday are red
function balOf(it, ev, plist) {
  const D = it.data
  if (isPersonal(D)) return Math.max(0, D.amount - paidOf(plist, it.id))
  const past = ev.filter(r => r.date <= today); return past.length ? past.at(-1).bal : D.amount
}

// Fixed-date national holidays: [BS month 0-based, day, English, Nepali]. Moving festivals are added by you in the Calendar tab.
const HOL = [[0, 1, 'Nepali New Year', 'नयाँ वर्ष'], [0, 11, 'Loktantra Day', 'लोकतन्त्र दिवस'], [1, 15, 'Republic Day', 'गणतन्त्र दिवस'],
  [5, 3, 'Constitution Day', 'संविधान दिवस'], [8, 15, 'Tamu Lhosar', 'तमु ल्होसार'], [9, 1, 'Maghe Sankranti', 'माघे संक्रान्ति'],
  [9, 16, 'Martyrs’ Day', 'शहीद दिवस'], [10, 7, 'Democracy Day', 'प्रजातन्त्र दिवस']]
const FEST = [['Ghatasthapana (Dashain begins)', 'घटस्थापना'], ['Fulpati', 'फूलपाती'], ['Maha Ashtami', 'महाअष्टमी'], ['Maha Navami', 'महानवमी'], ['Vijaya Dashami', 'विजया दशमी'],
  ['Kukur Tihar', 'कुकुर तिहार'], ['Laxmi Puja', 'लक्ष्मी पूजा'], ['Mha Puja / Govardhan Puja', 'म्ह पूजा / गोवर्धन पूजा'], ['Bhai Tika', 'भाइटीका'], ['Chhath', 'छठ'],
  ['Maha Shivaratri', 'महाशिवरात्रि'], ['Fagu Purnima (Holi)', 'फागु पूर्णिमा (होली)'], ['Ghode Jatra', 'घोडेजात्रा'], ['Buddha Jayanti', 'बुद्ध जयन्ती'], ['Teej', 'हरितालिका तीज'],
  ['Janai Purnima', 'जनै पूर्णिमा'], ['Gai Jatra', 'गाईजात्रा'], ['Krishna Janmashtami', 'कृष्ण जन्माष्टमी'], ['Indra Jatra', 'इन्द्रजात्रा'], ['Sonam Lhosar', 'सोनाम ल्होसार'],
  ['Gyalpo Lhosar', 'ग्याल्पो ल्होसार'], ['Eid', 'ईद'], ['Christmas', 'क्रिसमस']]

const LOAN_PRESETS = {
  'Sana-Kisan Sahakari': { preset: 'sanakisan', rate: 11.75, unit: 'yearly', grace: 5, interval: 3, term: 120, day: 0, about: 'Interest every month-end. First installment after 6 months, then every 3 months (39 installments).' },
  'Sahakari (cooperative)': { preset: 'sahakari', rate: 12, unit: 'yearly', grace: 0, interval: 1, term: 120, day: 18, about: 'Interest + installment every month around the 18th. Rate 12% is a placeholder: set your real rate.' },
  'Private (with interest)': { preset: 'private_i', rate: 2, unit: 'monthly', grace: 0, interval: 1, term: 12, day: 0, about: 'Person or lender who charges monthly interest on the balance.' },
  'Personal (no interest)': { preset: 'personal', rate: 0, unit: 'yearly', grace: 0, interval: 0, term: 12, day: 0, about: 'Relative or friend, no interest. No fixed schedule: record repayments whenever you pay.' },
}
const BY_ID = Object.fromEntries(Object.values(LOAN_PRESETS).map(p => [p.preset, p]))
const EXP_PRESETS = {
  'School / semester fee': { kind: 'expense', every: 6, deadline: false }, 'Food & daily living': { kind: 'expense', every: 1, deadline: false },
  'Monthly bill / rent': { kind: 'expense', every: 1, deadline: false }, 'House / land tax': { kind: 'tax', every: 12, deadline: true, dlMonth: 2 }, 'Other tax': { kind: 'tax', every: 12, deadline: false },
}
const INC_PRESETS = {
  'Monthly salary': { kind: 'income', every: 1 }, 'Business / shop income': { kind: 'income', every: 1 }, 'Rent received': { kind: 'income', every: 1 },
  'Foreign remittance': { kind: 'income', every: 3 }, 'Yearly bonus / crop sale': { kind: 'income', every: 12 },
}
const EVERY = [[1, 'Every month'], [2, 'Every 2 months'], [3, 'Every 3 months'], [6, 'Every 6 months'], [12, 'Every year']]

/* ---------- small form pieces ---------- */
const Field = ({ label, hint, children }) => <label className="field"><span>{t(label)}</span>{children}{hint && <em>{t(hint)}</em>}</label>
const Money = ({ value, onChange }) => <div className="money"><b>{t('NPR')}</b><input type="number" inputMode="numeric" min="0" value={value} onChange={e => onChange(+e.target.value)} /></div>
const Unit = ({ value, onChange, unit, step }) => <div className="money"><input type="number" step={step || 1} min="0" value={value} onChange={e => onChange(+e.target.value)} /><b>{t(unit)}</b></div>
function BSDate({ value, onChange }) {
  const [y, m, d] = value.split('/').map(Number), len = monthLen(y, m - 1)
  const set = (ny, nm, nd) => onChange(`${ny}/${pad(nm)}/${pad(Math.min(nd, monthLen(ny, nm - 1)))}`)
  return <div className="dates">
    <select value={y} onChange={e => set(+e.target.value, m, d)}>{Array.from({ length: 90 }, (_, i) => 2060 + i).map(v => <option key={v} value={v}>{N(v)}</option>)}</select>
    <select value={m} onChange={e => set(y, +e.target.value, d)}>{BS_MONTHS.map((_, i) => <option key={i} value={i + 1}>{mn(i)}</option>)}</select>
    <select value={d} onChange={e => set(y, m, +e.target.value)}>{Array.from({ length: len }, (_, i) => i + 1).map(v => <option key={v} value={v}>{N(v)}</option>)}</select>
  </div>
}
const ADPick = ({ onBS }) => <input type="date" onChange={e => { if (!e.target.value) return
  const p = bsParts(new Date(e.target.value + 'T00:00:00')); onBS(`${p.y}/${pad(p.m + 1)}/${pad(p.d)}`) }} />
const Card = ({ a, b, tone }) => <div className={'card stat ' + (tone || '')}><small>{t(a)}</small><b>{b}</b></div>
const MonthNav = ({ view, go }) => <div className="mnav"><button onClick={() => go(-1)}>‹</button><b>{mn(view.m)} {N(view.y)}</b><button onClick={() => go(1)}>›</button></div>
const LangSwitch = ({ lang, flip }) => <div className="lang"><button className={lang === 'en' ? 'on' : ''} onClick={() => lang !== 'en' && flip()}>EN</button><button className={lang === 'np' ? 'on' : ''} onClick={() => lang !== 'np' && flip()}>नेपाली</button></div>

/* ============ ROOT ============ */
class Boundary extends Component {
  state = { err: null }
  static getDerivedStateFromError(err) { return { err } }
  render() {
    return this.state.err
      ? <div className="app"><div className="form"><h3>Something broke</h3><pre style={{ whiteSpace: 'pre-wrap' }}>{String(this.state.err.stack || this.state.err)}</pre><button onClick={() => location.reload()}>Reload</button></div></div>
      : this.props.children
  }
}
export default function App() {
  const [session, setSession] = useState(null), [ready, setReady] = useState(false)
  const [lang, setL] = useState(() => { try { return localStorage.getItem('gk_lang') === 'np' ? 'np' : 'en' } catch { return 'en' } })
  setLang(lang) // one shared setting that every screen reads
  const flip = () => { const n = lang === 'en' ? 'np' : 'en'; setL(n); try { localStorage.setItem('gk_lang', n) } catch { /* ignore */ } }
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true) })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])
  if (!ready) return <p style={{ padding: 20 }}>{t('Loading...')}</p>
  return session ? <Boundary><Main lang={lang} flip={flip} /></Boundary> : <Login lang={lang} flip={flip} />
}
function Login({ lang, flip }) {
  const [mode, setMode] = useState('in'), [email, setEmail] = useState(''), [pw, setPw] = useState(''), [pw2, setPw2] = useState('')
  const submit = async () => {
    if (!email.trim() || pw.length < 6) return alert(t('Enter your email and a password of at least 6 characters.'))
    if (mode === 'up' && pw !== pw2) return alert(t('The two passwords do not match.'))
    const creds = { email: email.trim(), password: pw }
    const { error } = mode === 'in' ? await supabase.auth.signInWithPassword(creds) : await supabase.auth.signUp(creds)
    if (error) alert(error.message)
  }
  return <div className="app"><div style={{ textAlign: 'right' }}><LangSwitch lang={lang} flip={flip} /></div>
    <div className="form login" onKeyDown={e => e.key === 'Enter' && submit()}>
      <img src="/icon.svg" className="logo" alt="" /><h2>{t('GharKhata')}</h2><p className="muted">{t('Household loan & money planner')}</p>
      <div className="seg"><button className={mode === 'in' ? 'on' : ''} onClick={() => setMode('in')}>{t('Sign in')}</button>
        <button className={mode === 'up' ? 'on' : ''} onClick={() => setMode('up')}>{t('Create account')}</button></div>
      <Field label="Email"><input type="email" value={email} onChange={e => setEmail(e.target.value)} /></Field>
      <Field label="Password" hint="At least 6 characters"><input type="password" value={pw} onChange={e => setPw(e.target.value)} /></Field>
      {mode === 'up' && <Field label="Confirm password"><input type="password" value={pw2} onChange={e => setPw2(e.target.value)} /></Field>}
      <button className="on big" onClick={submit}>{mode === 'in' ? t('Sign in') : t('Create account')}</button>
    </div></div>
}

/* ============ MAIN ============ */
const TABS = [['Dashboard', '📊'], ['Calendar', '📅'], ['Monthly', '🗓️'], ['Loans', '🏦'], ['Expenses', '🧾'], ['Insurance', '🛡️'], ['Income', '💰'], ['Budget', '⚖️'], ['Simulator', '🧪']]
function Main({ lang, flip }) {
  const [items, setItems] = useState([]), [pays, setPays] = useState({})
  const [tab, setTab] = useState('Dashboard')
  const [view, setView] = useState({ y: TODAY.y, m: TODAY.m })
  const go = k => setView(v => addMonths(v.y, v.m, k))
  const reload = async () => {
    const a = await supabase.from('items').select('*').order('created_at')
    const b = await supabase.from('payments').select('*')
    if (a.error || b.error) return alert((a.error || b.error).message)
    setItems(a.data); setPays(Object.fromEntries(b.data.map(p => [p.item_id + ':' + p.seq, p])))
  }
  useEffect(() => { reload() }, [])
  const plist = Object.values(pays)
  const add = async (kind, name, data) => { const { error } = await supabase.from('items').insert({ kind, name, data }); error ? alert(error.message) : reload() }
  const del = async id => { if (!confirm(t('Delete this and all its payment records?'))) return; await supabase.from('items').delete().eq('id', id); reload() }
  const pay = async e => {
    const v = prompt(t('Actual amount paid (NPR)'), Math.round(e.total)); if (v === null || isNaN(+v)) return
    const { error } = await supabase.from('payments').insert({ item_id: e.item.id, seq: e.i, amount: +v, paid_on: new Date().toISOString().slice(0, 10) })
    error ? alert(error.message) : reload()
  }
  const undo = async e => { await supabase.from('payments').delete().eq('id', e.paid.id); reload() }
  const recordPersonal = async it => {
    const v = prompt(t('Amount repaid (NPR)')); if (v === null || isNaN(+v) || +v <= 0) return
    const seq = Math.max(0, ...plist.filter(p => p.item_id === it.id).map(p => p.seq)) + 1
    const { error } = await supabase.from('payments').insert({ item_id: it.id, seq, amount: +v, paid_on: new Date().toISOString().slice(0, 10) })
    error ? alert(error.message) : reload()
  }
  const delPay = async id => { await supabase.from('payments').delete().eq('id', id); reload() }

  const events = useMemo(() => items.filter(it => it.kind !== 'income' && it.kind !== 'holiday').flatMap(it => rowsFor(it).map(r =>
    ({ ...r, item: it, cat: it.kind, key: it.id + ':' + r.i, paid: pays[it.id + ':' + r.i] || (r.autoPaid ? { amount: r.total, auto: true } : undefined) }))).sort((a, b) => a.date - b.date), [items, pays])
  const incomes = useMemo(() => items.filter(i => i.kind === 'income'), [items])
  const holidays = useMemo(() => items.filter(i => i.kind === 'holiday'), [items])
  const P = { events, view, go, pay, undo }
  return <div className="app">
    <header className="top"><div className="brand"><img src="/icon.svg" className="logo-sm" alt="" /><div><h1>{t('GharKhata')}</h1><small>{t('Household loan & money planner')}</small></div></div>
      <div className="hbtns"><LangSwitch lang={lang} flip={flip} /><button className="out" onClick={() => supabase.auth.signOut()}><span>⎋</span> {t('Sign out')}</button></div></header>
    <nav>{TABS.map(([k, ic]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}><span>{ic}</span> {t(k)}</button>)}</nav>
    {tab === 'Dashboard' && <Dashboard items={items} plist={plist} {...P} />}
    {tab === 'Calendar' && <Calendar {...P} holidays={holidays} add={add} del={del} />}
    {tab === 'Monthly' && <Monthly {...P} />}
    {tab === 'Loans' && <Loans items={items} plist={plist} add={add} del={del} recordPersonal={recordPersonal} delPay={delPay} {...P} />}
    {tab === 'Expenses' && <Recurring mode="expense" items={items} add={add} del={del} />}
    {tab === 'Insurance' && <Insurance items={items} add={add} del={del} {...P} />}
    {tab === 'Income' && <Recurring mode="income" items={items} add={add} del={del} />}
    {tab === 'Budget' && <Budget events={events} incomes={incomes} view={view} go={go} />}
    {tab === 'Simulator' && <Simulator loans={items.filter(i => i.kind === 'loan')} events={events} incomes={incomes} />}
  </div>
}

/* ============ shared table ============ */
function EventList({ events, pay, undo, showBal }) {
  if (!events.length) return <p className="muted">{t('Nothing due.')}</p>
  return <div className="scroll"><table className="rt"><thead><tr>
    <th className="l">{t('Date (BS)')}</th><th className="l">{t('Type')}</th><th className="l">{t('Name')}</th><th>{t('Interest')}</th><th>{t('Principal')}</th><th>{t('Total')}</th>
    {showBal && <th>{t('Balance')}</th>}<th className="l">{t('Status')}</th></tr></thead>
    <tbody>{events.map(e => <tr key={e.key} className={e.paid ? 'paidrow' : ''}>
      <td className="l" data-label={t('Date (BS)')}><div>{bs(e.date)}<small className="ad">{ad(e.date)}</small></div></td>
      <td className="l" data-label={t('Type')}><span className={'tag c-' + e.cat}>{t(LABEL[e.cat])}</span></td>
      <td className="l" data-label={t('Name')}><div>{t(e.item.name)}{e.label && <small className="ad">{t(e.label)}</small>}{e.deadline && <small className="ad warn">{t('Pay before {d}', { d: bs(e.deadline) })}</small>}</div></td>
      <td data-label={t('Interest')}>{e.interest ? fmt(e.interest) : '-'}</td>
      <td data-label={t('Principal')}>{e.principal + e.extra ? fmt(e.principal + e.extra) : '-'}</td>
      <td data-label={t('Total')}><b>{fmt(e.total)}</b></td>
      {showBal && <td data-label={t('Balance')}>{fmt(e.bal)}</td>}
      <td className="l" data-label={t('Status')}>{e.paid
        ? (e.paid.auto ? <span className="tag c-paid">{t('Paid ✓')}</span> : <button className="ok" onClick={() => undo(e)}>{t('Paid {a} ✓ undo', { a: fmt(e.paid.amount) })}</button>)
        : <button onClick={() => pay(e)}>{t('Mark paid')}</button>}</td></tr>)}
    </tbody></table></div>
}

/* ============ DASHBOARD ============ */
const Box = ({ title, icon, count, children }) => <div className="card sum"><h4>{icon} {t(title)} <span>{N(count)}</span></h4>{count ? children : <p className="muted">{t('Nothing added yet.')}</p>}</div>
const Row = ({ a, b, c }) => <div className="srow"><div><b>{a}</b><small>{c}</small></div><span>{b}</span></div>
function Summary({ items, events, plist }) {
  const nxt = id => events.find(e => e.item.id === id && !e.paid && (e.date >= t0 || (e.deadline && e.deadline >= t0)))
  const nextTxt = e => e ? t('Next') + ': ' + bs(e.date) + (e.label ? ' (' + t(e.label) + ')' : '') : t('Finished')
  const loans = items.filter(i => i.kind === 'loan'), exps = items.filter(i => i.kind === 'expense' || i.kind === 'tax')
  const ins = items.filter(i => i.kind === 'insurance'), inc = items.filter(i => i.kind === 'income')
  return <div className="sumgrid">
    <Box title="Loans" icon="🏦" count={loans.length}>{loans.map(it => { const ev = events.filter(e => e.item.id === it.id), n = nxt(it.id)
      return <Row key={it.id} a={t(it.name)} b={rs(balOf(it, ev, plist))} c={isPersonal(it.data) ? t('No fixed schedule') : n ? t('Next: {d} · {a}', { d: bs(n.date), a: rs(n.total) }) : t('Finished')} /> })}</Box>
    <Box title="Expenses & taxes" icon="🧾" count={exps.length}>{exps.map(it => <Row key={it.id} a={t(it.name)} b={rs(it.data.amount)} c={nextTxt(nxt(it.id))} />)}</Box>
    <Box title="Insurance" icon="🛡️" count={ins.length}>{ins.map(it => { const D = it.data, back = D.sum + (D.bonus || 0) - D.loan
      return <Row key={it.id} a={it.name} b={rs(D.premium)} c={nextTxt(nxt(it.id)) + ' · ' + t('Money back') + ': ' + bs(maturityDate(D)) + ' ≈ ' + rs(back)} /> })}</Box>
    <Box title="Income" icon="💰" count={inc.length}>{inc.map(it => { const n = expenseRows(it.data).find(r => r.date >= t0)
      return <Row key={it.id} a={t(it.name)} b={rs(it.data.amount)} c={n ? t('Next') + ': ' + bs(n.date) : ''} /> })}</Box>
  </div>
}
function Dashboard({ items, plist, events, pay, undo }) {
  const loans = items.filter(i => i.kind === 'loan')
  let out = 0, daily = 0, end = null
  loans.forEach(it => { const D = it.data, ev = events.filter(e => e.item.id === it.id), bal = balOf(it, ev, plist)
    if (!isPersonal(D)) { const last = ev.at(-1)?.date; if (last && (!end || last > end)) end = last }
    out += bal; daily += D.unit === 'monthly' ? bal * D.rate / 100 / 30 : bal * D.rate / 100 / 365 })
  const pend = events.filter(e => !e.paid && e.deadline && e.date < t0 && e.deadline >= t0)
  const month = [...events.filter(e => inMonth(e, TODAY)), ...pend.filter(e => !inMonth(e, TODAY))]
  const need = sum(month, 'total'), paid = month.reduce((s, e) => s + (e.paid?.amount || 0), 0), left = sum(month.filter(e => !e.paid), 'total')
  const lim = new Date(t0); lim.setFullYear(lim.getFullYear() + 1)
  const next12 = sum(events.filter(e => e.date >= t0 && e.date <= lim), 'total')
  const overdue = events.filter(e => !e.paid && dlOf(e) < t0 && t0 - dlOf(e) < 45 * 864e5)
  const upcoming = events.filter(e => !e.paid && e.total > 0 && (e.date >= t0 || (e.deadline && e.deadline >= t0))).slice(0, 8)
  return <>
    <div className="hero">
      <div><small>{t('Needed in {m}', { m: mn(TODAY.m) })}</small><h2>{rs(need)}</h2></div>
      <div><small>{t('Already paid')}</small><h2 className="g">{rs(paid)}</h2></div>
      <div><small>{t('Still to arrange')}</small><h2 className={left > 0 ? 'r' : 'g'}>{rs(left)}</h2></div>
      <div className="bar wide"><i style={{ width: (need ? Math.min(100, paid / need * 100) : 0) + '%' }} /></div>
    </div>
    <div className="grid">
      <Card a="Active loans" b={N(loans.length)} /><Card a="Total outstanding" b={rs(out)} /><Card a="Interest piling up per day" b={rs(daily)} />
      <Card a="Needed next 12 months" b={rs(next12)} />
      <Card a="Overdue (last 45 days)" b={overdue.length ? `${N(overdue.length)} · ${rs(sum(overdue, 'total'))}` : t('None ✓')} tone={overdue.length ? 'bad' : ''} />
      <Card a="Debt-free date (BS)" b={end ? bs(end) : '-'} />
    </div>
    {overdue.length > 0 && <><h3>{t('Overdue')}</h3><EventList events={overdue} pay={pay} undo={undo} /></>}
    <Summary items={items} events={events} plist={plist} />
    <h3>{t('Upcoming')}</h3><EventList events={upcoming} pay={pay} undo={undo} />
  </>
}

/* ============ CALENDAR ============ */
function HolidayForm({ view, add }) {
  const blank = { en: '', np: '', date: `${view.y}/${pad(view.m + 1)}/01` }
  const [f, setF] = useState(blank)
  const submit = () => {
    if (!f.en.trim()) return alert(t('Enter the holiday name.'))
    const [y, m, d] = f.date.split('/').map(Number)
    add('holiday', f.en.trim(), { date: [y, m, d], np: f.np.trim() || f.en.trim() }); setF(blank)
  }
  return <details className="adv"><summary>＋ {t('Add a holiday (festival dates change every year)')}</summary>
    <div className="row2">
      <Field label="Quick pick"><select value="" onChange={e => { const x = FEST.find(z => z[0] === e.target.value); if (x) setF({ ...f, en: x[0], np: x[1] }) }}>
        <option value="">{t('Choose a festival...')}</option>{FEST.map(x => <option key={x[0]} value={x[0]}>{getLang() === 'np' ? x[1] : x[0]}</option>)}</select></Field>
      <Field label="Name (English)"><input value={f.en} onChange={e => setF({ ...f, en: e.target.value })} /></Field>
      <Field label="Name (नेपाली)"><input value={f.np} onChange={e => setF({ ...f, np: e.target.value })} /></Field>
      <Field label="Date"><BSDate value={f.date} onChange={v => setF({ ...f, date: v })} /></Field>
    </div><button className="on" onClick={submit}>＋ {t('Add holiday')}</button></details>
}
function Calendar({ events, view, go, pay, undo, holidays, add, del }) {
  const nep = getLang() === 'np'
  const len = monthLen(view.y, view.m), lead = firstWeekday(view.y, view.m)
  const me = events.filter(e => inMonth(e, view)), byDay = {}
  me.forEach(e => (byDay[bsParts(e.date).d] ??= []).push(e))
  const named = {}
  HOL.forEach(h => { if (h[0] === view.m) named[h[1]] = { en: h[2], np: h[3] } })
  holidays.forEach(h => { const [y, m, d] = h.data.date; if (y === view.y && m - 1 === view.m) named[d] = { en: h.name, np: h.data.np || h.name, id: h.id } })
  const cells = [...Array(lead).fill(null), ...Array.from({ length: len }, (_, i) => i + 1)]
  const isToday = d => view.y === TODAY.y && view.m === TODAY.m && d === TODAY.d
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const a1 = fromBS(view.y, view.m + 1, 1), a2 = fromBS(view.y, view.m + 1, len)
  const adl = d => { const a = fromBS(view.y, view.m + 1, d); return d === 1 || a.getDate() === 1 ? a.toLocaleString('en', { month: 'short' }) + ' ' + a.getDate() : a.getDate() }
  const hl = Object.entries(named).map(([d, h]) => ({ d: +d, ...h })).sort((a, b) => a.d - b.d)
  return <>
    <div className="mnav"><button onClick={() => go(-1)}>‹</button>
      <div style={{ textAlign: 'center' }}><b>{mn(view.m)} {N(view.y)}</b><small className="ad">{a1.toLocaleString('en', { month: 'short' })} – {a2.toLocaleString('en', { month: 'short', year: 'numeric' })}</small></div>
      <button onClick={() => go(1)}>›</button></div>
    <div className="legend">{[['c-loan', 'Loan'], ['c-expense', 'Expense'], ['c-tax', 'Tax'], ['c-insurance', 'Insurance'], ['c-paid', 'Paid']].map(([c, n]) => <span key={c} className={'tag ' + c}>{t(n)}</span>)}
      <span className="tag" style={{ background: '#dc2626' }}>{t('Holiday')}</span></div>
    <div className="cal">
      {DOW.map((d, i) => <div key={d} className={'dow' + (WEEKEND.includes(i) ? ' hol' : '')}>{t(d)}</div>)}
      {cells.map((d, i) => { const h = d && named[d], hol = d && (WEEKEND.includes(i % 7) || !!h)
        return <div key={i} className={'day' + (d && isToday(d) ? ' today' : '') + (d ? '' : ' empty') + (hol ? ' hol' : '')}>
          {d && <><div className="dn"><span>{N(d)}</span><em>{adl(d)}</em></div>
            {h && <div className="hn">{nep ? h.np : h.en}</div>}
            <div>{(byDay[d] || []).map(e => <i key={e.key} className={'dot ' + (e.paid ? 'c-paid' : 'c-' + e.cat)} title={`${e.item.name}: ${fmt(e.total)}`} />)}</div>
            {byDay[d] && <small>{fmt(sum(byDay[d], 'total'))}</small>}</>}
        </div> })}
    </div>
    <EventList events={me} pay={pay} undo={undo} />
    <div className="form"><h3 style={{ margin: 0 }}>{t('Holidays this month')}</h3>
      {hl.length ? hl.map(h => <div key={h.d} className="payline"><span><b>{N(h.d)} {mn(view.m)}</b> · {nep ? h.np : h.en} <small className="ad" style={{ display: 'inline' }}>({nep ? h.en : h.np})</small></span>
        {h.id && <button className="mini" onClick={() => del(h.id)}>🗑</button>}</div>) : <p className="muted">{t('No named holidays this month. Saturdays and Sundays are marked red.')}</p>}
      <HolidayForm key={view.y + '-' + view.m} view={view} add={add} /></div>
  </>
}

/* ============ MONTHLY ============ */
function Monthly({ events, view, go, pay, undo }) {
  const [scope, setScope] = useState('all')
  const me = events.filter(e => inMonth(e, view)), by = c => sum(me.filter(e => e.cat === c), 'total')
  const yr = Array.from({ length: 12 }, (_, m) => { const l = events.filter(e => inMonth(e, { y: view.y, m }))
    const x = c => sum(l.filter(e => e.cat === c), 'total'); return { m, loan: x('loan'), exp: x('expense'), tax: x('tax') + x('insurance'), all: sum(l, 'total') } })
  return <>
    <MonthNav view={view} go={go} />
    <div className="grid">
      <Card a="Loans" b={fmt(by('loan'))} /><Card a="Expenses" b={fmt(by('expense'))} /><Card a="Tax" b={fmt(by('tax'))} /><Card a="Insurance" b={fmt(by('insurance'))} />
      <Card a="TOTAL needed" b={rs(sum(me, 'total'))} /><Card a="Paid so far" b={fmt(me.reduce((s, e) => s + (e.paid?.amount || 0), 0))} />
      <Card a="Still to arrange" b={rs(sum(me.filter(e => !e.paid), 'total'))} />
    </div>
    <EventList events={me} pay={pay} undo={undo} />
    <h3>{t('BS {y}: month by month', { y: N(view.y) })}</h3>
    <div className="scroll"><table><thead><tr><th className="l">{t('Month')}</th><th>{t('Loans')}</th><th>{t('Expenses')}</th><th>{t('Tax / Ins.')}</th><th>{t('Total')}</th></tr></thead>
      <tbody>{yr.map(r => <tr key={r.m}><td className="l">{mn(r.m)}</td><td>{fmt(r.loan)}</td><td>{fmt(r.exp)}</td><td>{fmt(r.tax)}</td><td><b>{fmt(r.all)}</b></td></tr>)}</tbody></table></div>
    <div className="form" style={{ marginTop: 12 }}>
      <h3>{t('Download PDF for BS {y}', { y: N(view.y) })}</h3>
      <select value={scope} onChange={e => setScope(e.target.value)}><option value="all">{t('Everything (loans + expenses + tax)')}</option><option value="loan">{t('Loans only')}</option></select>
      <button className="on" onClick={() => exportPDF(events, view.y, scope)}>{t('Download PDF')}</button>
    </div>
  </>
}

/* ============ LOANS ============ */
function Loans({ items, plist, events, add, del, pay, undo, recordPersonal, delPay }) {
  const blank = { name: '', amount: 1000000, start: todayStr, ...LOAN_PRESETS['Sana-Kisan Sahakari'] }
  const [f, setF] = useState(blank), set = (k, v) => setF({ ...f, [k]: v })
  const sk = f.preset === 'sanakisan'
  const submit = () => {
    const start = f.start.split('/').map(Number)
    if (!sk && !f.name.trim()) return alert(t('Please enter the lender name.'))
    if (!validBS(...start)) return alert(t('Invalid BS date.'))
    if (!f.amount || f.amount < 1) return alert(t('Enter the loan amount.'))
    const name = sk ? 'Sana-Kisan Sahakari' : f.name.trim()
    const { name: _n, start: _s, about: _a, ...rest } = f
    add('loan', name, { ...rest, start }); setF(blank)
  }
  const groupOf = D => D.preset === 'sanakisan' ? 0 : isPersonal(D) ? 3 : D.preset === 'private_i' ? 2 : 1
  const GROUPS = ['Sana-Kisan Sahakari', 'Cooperative loans', 'Private lenders (with interest)', 'Personal loans (no interest)']
  const loans = items.filter(i => i.kind === 'loan')
  return <>
    <div className="form"><h3>{t('Add a loan')}</h3>
      <Field label="Type of loan" hint={f.about}>
        <select value={f.preset} onChange={e => setF({ ...f, ...BY_ID[e.target.value] })}>{Object.entries(LOAN_PRESETS).map(([k, v]) => <option key={k} value={v.preset}>{t(k)}</option>)}</select></Field>
      {!sk && <Field label={f.preset === 'personal' ? 'Who lent you the money?' : 'Lender name'} hint="Required"><input value={f.name} onChange={e => set('name', e.target.value)} /></Field>}
      <div className="row2">
        <Field label="Loan amount"><Money value={f.amount} onChange={v => set('amount', v)} /></Field>
        <Field label="Loan start date (BS)"><BSDate value={f.start} onChange={v => set('start', v)} /></Field>
      </div>
      {f.preset !== 'personal' && <details className="adv"><summary>{t('Repayment rules (already filled for this type)')}</summary>
        <div className="row2">
          <Field label="Interest rate"><Unit value={f.rate} step=".25" unit={f.unit === 'monthly' ? '% / month' : '% / year'} onChange={v => set('rate', v)} /></Field>
          <Field label="Interest counted"><select value={f.unit} onChange={e => set('unit', e.target.value)}><option value="yearly">{t('Daily, on yearly rate')}</option><option value="monthly">{t('Monthly, flat on balance')}</option></select></Field>
          <Field label="Loan duration"><Unit value={f.term} unit="months" onChange={v => set('term', v)} /></Field>
          <Field label="Pay principal every" hint="0 = all at the end"><Unit value={f.interval} unit="months" onChange={v => set('interval', v)} /></Field>
          <Field label="First principal after" hint="Months of interest-only"><Unit value={f.grace + 1} unit="sessions" onChange={v => set('grace', Math.max(0, v - 1))} /></Field>
          <Field label="Session day (BS)" hint="0 = last day of month"><Unit value={f.day} unit="day" onChange={v => set('day', v)} /></Field>
        </div></details>}
      <button className="on" onClick={submit}>{t('＋ Add loan')}</button>
    </div>
    {GROUPS.map((title, g) => { const list = loans.filter(it => groupOf(it.data) === g); if (!list.length) return null
      return <section key={g}><h3 className="sec">{t(title)} <span>{N(list.length)}</span></h3>
        {list.map(it => <LoanCard key={it.id} it={it} ev={events.filter(e => e.item.id === it.id)} plist={plist} pay={pay} undo={undo} del={del} recordPersonal={recordPersonal} delPay={delPay} />)}</section> })}
    {!loans.length && <p className="muted">{t('No loans yet. Add your first one above.')}</p>}
  </>
}
function LoanCard({ it, ev, plist, pay, undo, del, recordPersonal, delPay }) {
  const D = it.data, P = isPersonal(D), mine = plist.filter(p => p.item_id === it.id)
  const bal = balOf(it, ev, plist), next = P ? null : ev.find(r => !r.paid && r.date >= t0)
  const pct = Math.max(0, Math.min(100, (D.amount - bal) / D.amount * 100))
  return <details className="loan">
    <summary>
      <div className="lhead"><div><b>{t(it.name)}</b><small>{rs(D.amount)} · {P ? t('no interest') : t('{r}% per {u}', { r: N(D.rate), u: D.unit === 'monthly' ? t('month') : t('year') })}</small></div>
        <div className="r"><b>{rs(bal)}</b><small>{t('outstanding')}</small></div></div>
      <div className="bar"><i style={{ width: pct + '%' }} /></div>
      <div className="lfoot"><span>{t('{p}% repaid', { p: N(Math.round(pct)) })}</span>{next && <span>{t('Next: {d} · {a}', { d: bs(next.date), a: rs(next.total) })}</span>}
        <button className="mini" onClick={e => { e.preventDefault(); e.stopPropagation(); del(it.id) }}>{t('🗑 Delete')}</button></div>
    </summary>
    <div className="lbody">
      {P ? <>
        <p className="muted">{t('Repaid so far:')} <b>{rs(paidOf(plist, it.id))}</b></p>
        <button className="on" onClick={() => recordPersonal(it)}>{t('＋ Record a repayment')}</button>
        {mine.map(p => <div key={p.id} className="payline"><span>{p.paid_on} · {rs(p.amount)}</span><button onClick={() => delPay(p.id)}>✕</button></div>)}
      </> : <>
        <p className="muted">{t('Total interest over the whole loan:')} <b>{rs(sum(ev, 'interest'))}</b> · {N(ev.length)} {t('sessions in total')}</p>
        <EventList events={ev} pay={pay} undo={undo} showBal /></>}
      <button className="danger" onClick={() => del(it.id)}>{t('Delete this loan')}</button>
    </div>
  </details>
}

/* ============ EXPENSES & INCOME ============ */
function Recurring({ mode, items, add, del }) {
  const inc = mode === 'income', PR = inc ? INC_PRESETS : EXP_PRESETS, first = Object.keys(PR)[0]
  const blank = { name: first, amount: inc ? 30000 : 20000, start: todayStr, count: 0, ...PR[first] }
  const [f, setF] = useState(blank), set = (k, v) => setF({ ...f, [k]: v })
  const list = items.filter(i => inc ? i.kind === 'income' : (i.kind === 'expense' || i.kind === 'tax'))
  const lim = new Date(t0); lim.setFullYear(lim.getFullYear() + 1)
  const yearTotal = sum(list.flatMap(it => expenseRows(it.data)).filter(r => r.date >= t0 && r.date <= lim), 'total')
  const submit = () => {
    const start = f.start.split('/').map(Number)
    if (!f.name.trim()) return alert(t('Please enter a name.'))
    if (!f.amount || f.amount <= 0) return alert(t('Enter the amount.'))
    if (!validBS(...start)) return alert(t('Invalid BS date.'))
    add(f.kind, f.name.trim(), { amount: f.amount, start, every: f.every, count: f.count, deadline: !inc && f.kind === 'tax' && !!f.deadline, dlMonth: f.dlMonth ?? 2 }); setF(blank)
  }
  return <>
    <div className="grid"><Card a={inc ? 'Average income per month' : 'Average expenses per month'} b={rs(yearTotal / 12)} /><Card a="Next 12 months total" b={rs(yearTotal)} /></div>
    <div className="form"><h3>{t(inc ? 'Add income' : 'Add recurring expense / tax')}</h3>
      <Field label="Quick pick"><select onChange={e => setF({ ...f, name: e.target.value, ...PR[e.target.value] })}>{Object.keys(PR).map(p => <option key={p} value={p}>{t(p)}</option>)}</select></Field>
      <div className="row2">
        <Field label="Name"><input value={t(f.name)} onChange={e => set('name', e.target.value)} /></Field>
        {!inc && <Field label="Category"><select value={f.kind} onChange={e => set('kind', e.target.value)}><option value="expense">{t('Expense')}</option><option value="tax">{t('Tax')}</option></select></Field>}
        <Field label="Amount each time"><Money value={f.amount} onChange={v => set('amount', v)} /></Field>
        <Field label={f.deadline ? 'Date you plan to pay (BS)' : inc ? 'First date received (BS)' : 'First due date (BS)'}><BSDate value={f.start} onChange={v => set('start', v)} /></Field>
        <Field label="How often"><select value={f.every} onChange={e => set('every', +e.target.value)}>{EVERY.map(([v, n]) => <option key={v} value={v}>{t(n)}</option>)}</select></Field>
        <Field label="How many times" hint="0 = keeps repeating (50 years). 1 = one time only"><Unit value={f.count} unit="times" onChange={v => set('count', v)} /></Field>
      </div>
      {!inc && f.kind === 'tax' && <div className="form" style={{ margin: 0, background: '#f8faff' }}>
        <label className="chk"><input type="checkbox" checked={!!f.deadline} onChange={e => set('deadline', e.target.checked)} /> {t('Pay any time before a yearly deadline (like house tax)')}</label>
        {f.deadline && <Field label="Last day to pay" hint="Stays 'pending' on the Dashboard until paid, even after your planned date. Turns overdue only after this deadline.">
          <select value={f.dlMonth ?? 2} onChange={e => set('dlMonth', +e.target.value)}>{BS_MONTHS.map((_, i) => <option key={i} value={i}>{t('End of {m}', { m: mn(i) })}</option>)}</select></Field>}
      </div>}
      <button className="on" onClick={submit}>{t('＋ Add')}</button></div>
    {list.map(it => { const rows = expenseRows(it.data).filter(r => r.date >= t0).slice(0, 6)
      return <details key={it.id} className="loan"><summary><div className="lhead"><div>
        <b>{t(it.name)}</b><small>{it.kind === 'income' ? <span className="tag c-paid">{t('Income')}</span> : <span className={'tag c-' + it.kind}>{t(LABEL[it.kind])}</span>} {t('every {n} month(s)', { n: N(it.data.every) })}{it.data.deadline ? t(' · deadline yearly') : ''}</small></div>
        <div className="r"><b>{rs(it.data.amount)}</b><small>{t('each time')}</small>
          <button className="mini" onClick={e => { e.preventDefault(); e.stopPropagation(); del(it.id) }}>{t('🗑 Delete')}</button></div></div></summary>
        <div className="lbody"><p className="muted">{t('Next dates:')}</p>
          {rows.map(r => <div key={r.i} className="payline"><span>{bs(r.date)} <small className="ad" style={{ display: 'inline' }}>({ad(r.date)})</small>{r.deadline && <> · {t('Pay before {d}', { d: bs(r.deadline) })}</>}</span><b>{rs(r.total)}</b></div>)}
          <button className="danger" onClick={() => del(it.id)}>{t('Delete')}</button></div></details> })}
  </>
}

/* ============ INSURANCE ============ */
function Insurance({ items, events, add, del, pay, undo }) {
  const blank = { name: '', sum: 50000, start: todayStr, years: 15, premium: 4164, every: 12, bonus: 0, loan: 0, rate: 10, intFrom: todayStr, paid: null }
  const [f, setF] = useState(blank), set = (k, v) => setF({ ...f, [k]: v })
  const list = items.filter(i => i.kind === 'insurance')
  let auto = 0
  try { const s = f.start.split('/').map(Number); if (validBS(...s)) auto = insuranceRows({ start: s, years: f.years, every: f.every, premium: f.premium, loan: 0 }).filter(r => r.label === 'premium' && r.date <= today).length } catch { /* ignore */ }
  const submit = () => {
    const start = f.start.split('/').map(Number), intFrom = f.intFrom.split('/').map(Number)
    if (!f.name.trim()) return alert(t('Enter a policy name, for example: Raju - Life Insurance'))
    if (!f.premium || f.years < 1 || !validBS(...start) || !validBS(...intFrom)) return alert(t('Check the premium, length and dates.'))
    const { name, start: _s, intFrom: _i, paid, ...rest } = f
    add('insurance', name.trim(), { ...rest, start, intFrom, paidCount: paid ?? auto }); setF(blank)
  }
  return <>
    <div className="form"><h3>{t('Add an insurance policy')}</h3>
      <div className="row2">
        <Field label="Policy name / holder"><input placeholder="Raju - Life Insurance" value={f.name} onChange={e => set('name', e.target.value)} /></Field>
        <Field label="Sum assured (money back)"><Money value={f.sum} onChange={v => set('sum', v)} /></Field>
        <Field label="Policy start date (BS)" hint="Know only the English date? Use the second box."><BSDate value={f.start} onChange={v => set('start', v)} /><ADPick onBS={v => set('start', v)} /></Field>
        <Field label="Policy length"><Unit value={f.years} unit="years" onChange={v => set('years', v)} /></Field>
        <Field label="Premium each time"><Money value={f.premium} onChange={v => set('premium', v)} /></Field>
        <Field label="Premium paid"><select value={f.every} onChange={e => set('every', +e.target.value)}>{EVERY.map(([v, n]) => <option key={v} value={v}>{t(n)}</option>)}</select></Field>
        <Field label="Premiums already paid" hint={t('Dates say about {n} have passed. Lower it if the latest one is still unpaid.', { n: N(auto) })}><Unit value={f.paid ?? auto} unit="times" onChange={v => set('paid', v)} /></Field>
        <Field label="Extra bonus still to come at the end" hint="0 if you already claimed all bonuses"><Money value={f.bonus} onChange={v => set('bonus', v)} /></Field>
      </div>
      <h3 style={{ margin: '6px 0 0' }}>{t('Loan taken on this policy (optional)')}</h3>
      <div className="row2">
        <Field label="Loan amount (0 = none)"><Money value={f.loan} onChange={v => set('loan', v)} /></Field>
        <Field label="Loan interest rate" hint="Check your paper. Your example works out to about 10% a year."><Unit value={f.rate} step=".25" unit="% / year" onChange={v => set('rate', v)} /></Field>
        <Field label="Interest paid up to (BS)" hint="Last date you paid interest. Next one is due a year later."><BSDate value={f.intFrom} onChange={v => set('intFrom', v)} /><ADPick onBS={v => set('intFrom', v)} /></Field>
      </div>
      <button className="on" onClick={submit}>{t('＋ Add policy')}</button></div>
    {list.map(it => { const D = it.data, ev = events.filter(e => e.item.id === it.id), end = maturityDate(D)
      const prem = ev.filter(e => e.label === 'premium'), done = prem.filter(e => e.paid).length
      const days = Math.max(0, Math.round((today - fromBS(...D.intFrom)) / 864e5))
      const accrued = D.loan * D.rate / 100 / 365 * days, yearly = D.loan * D.rate / 100, back = D.sum + (D.bonus || 0) - D.loan
      return <details key={it.id} className="loan"><summary>
        <div className="lhead"><div><b>{it.name}</b><small>{t('Premium {a} every {b} months · payment {c} of {d}', { a: rs(D.premium), b: N(D.every), c: N(done), d: N(prem.length) })}</small></div>
          <div className="r"><b>{rs(D.sum)}</b><small>{t('sum assured')}</small>
            <button className="mini" onClick={e => { e.preventDefault(); e.stopPropagation(); del(it.id) }}>{t('🗑 Delete')}</button></div></div>
        <div className="bar"><i style={{ width: Math.min(100, done / Math.max(1, prem.length) * 100) + '%' }} /></div>
        <div className="lfoot"><span>{t('Money back on {d}', { d: bs(end) + ' (' + ad(end) + ')' })}</span></div></summary>
        <div className="lbody">
          <div className="grid">
            <Card a="Money back date (BS)" b={bs(end)} /><Card a="You get about (sum + bonus − loan)" b={rs(back)} tone={back < 0 ? 'bad' : 'good'} />
            {D.loan > 0 && <><Card a="Loan on policy" b={rs(D.loan)} /><Card a="Interest piled up today" b={rs(accrued)} /><Card a="Interest per year" b={rs(yearly)} /></>}</div>
          {D.loan > 0 && <p className="muted">{t('Interest is counted daily from {d}. Unpaid interest at the end is also deducted from your money back.', { d: bs(fromBS(...D.intFrom)) })}</p>}
          <EventList events={ev} pay={pay} undo={undo} />
          <button className="danger" onClick={() => del(it.id)}>{t('Delete this policy')}</button></div></details> })}
    {!list.length && <p className="muted">{t('No policies yet.')}</p>}
  </>
}

/* ============ BUDGET ============ */
function Budget({ events, incomes, view, go }) {
  const incRows = useMemo(() => incomes.flatMap(it => expenseRows(it.data)), [incomes])
  const md = v => { const l = events.filter(e => inMonth(e, v)), c = k => sum(l.filter(e => e.cat === k), 'total')
    const inc = sum(incRows.filter(r => inMonth(r, v)), 'total'), loan = c('loan'), exp = c('expense'), tax = c('tax') + c('insurance')
    return { v, inc, loan, exp, tax, out: loan + exp + tax, left: inc - loan - exp - tax } }
  const cur = md(view), nx = Array.from({ length: 12 }, (_, k) => md(addMonths(view.y, view.m, k)))
  const [amt, setAmt] = useState(500000), [rate, setRate] = useState(12), [yrs, setYrs] = useState(5)
  const [goal, setGoal] = useState(100000), [gm, setGm] = useState(12)
  const [saved, setSaved] = useState(() => { try { return +localStorage.getItem('gk_sav') || 0 } catch { return 0 } })
  const keep = v => { setSaved(v); try { localStorage.setItem('gk_sav', v) } catch { /* ignore */ } }
  const pct = cur.inc ? Math.round(cur.left / cur.inc * 100) : 0
  const verdict = !cur.inc ? { c: 'mid', t: t('First add your income in the Income tab, then come back here.') }
    : cur.left < 0 ? { c: 'bad', t: t('You are SHORT by {a} this month. Arrange it from savings or borrowing.', { a: rs(-cur.left) }) }
    : pct < 10 ? { c: 'mid', t: t('Tight. Only {p}% of your income is left ({a}).', { p: N(pct), a: rs(cur.left) }) }
    : { c: 'good', t: t('Healthy. You keep {p}% of your income ({a}).', { p: N(pct), a: rs(cur.left) }) }
  const base = Math.max(cur.inc, cur.out, 1), w = x => Math.max(0, x) / base * 100 + '%'
  const r = rate / 1200, n = Math.max(1, yrs * 12)
  const emi = r ? amt * r / (1 - Math.pow(1 + r, -n)) : amt / n
  let b = saved; const run = nx.map(x => (b += x.left - emi))
  const lowest = Math.min(...run), firstNeg = run.findIndex(v => v < 0), shortNew = nx.filter(x => x.left - emi < 0).length
  let cum = saved; const safeEmi = Math.max(0, Math.min(...nx.map((x, k) => { cum += x.left; return cum / (k + 1) })))
  const safeAmt = r ? safeEmi * (1 - Math.pow(1 + r, -n)) / r : safeEmi * n
  const avgInc = sum(nx, 'inc') / 12, avgLeft = sum(nx, 'left') / 12, share = avgInc ? (sum(nx, 'loan') / 12 + emi) / avgInc : 0
  const sp = N(Math.round(share * 100))
  const nv = !avgInc ? { c: 'mid', t: t('Add your income first.') }
    : firstNeg >= 0 ? { c: 'bad', t: t('Not safe. Counting your savings, you would run out of money in {m}.', { m: mn(nx[firstNeg].v.m) }) }
    : shortNew ? { c: 'mid', t: t('Affordable. {n} month(s) are short, but your savings and the good months cover them. Lowest balance: {a}.', { n: N(shortNew), a: rs(lowest) }) }
    : share > 0.4 ? { c: 'mid', t: t('Possible, but loans would take {p}% of your income. Over 40% is risky.', { p: sp }) }
    : { c: 'good', t: t('Yes, you can afford it. Every month stays positive and loans take {p}% of income.', { p: sp }) }
  const need = goal / Math.max(1, gm), maxBar = Math.max(1, ...nx.map(x => Math.max(x.inc, x.out)))
  return <>
    <MonthNav view={view} go={go} />
    <div className={'verdict ' + verdict.c}>{verdict.t}</div>
    <div className="grid">
      <Card a="💰 You earn" b={rs(cur.inc)} /><Card a="📤 You must pay" b={rs(cur.out)} />
      <Card a={cur.left < 0 ? '⚠️ Short by' : '🏦 You keep'} b={rs(Math.abs(cur.left))} tone={cur.left < 0 ? 'bad' : 'good'} /></div>
    <div className="stack"><i className="c-loan" style={{ width: w(cur.loan) }} /><i className="c-expense" style={{ width: w(cur.exp) }} /><i className="c-tax" style={{ width: w(cur.tax) }} /><i className="c-paid" style={{ width: w(cur.left) }} /></div>
    <div className="legend"><span className="tag c-loan">{t('Loans {a}', { a: fmt(cur.loan) })}</span><span className="tag c-expense">{t('Expenses {a}', { a: fmt(cur.exp) })}</span>
      <span className="tag c-tax">{t('Tax {a}', { a: fmt(cur.tax) })}</span><span className="tag c-paid">{t('Left {a}', { a: fmt(Math.max(0, cur.left)) })}</span></div>
    <h3>{t('Next 12 months: earn vs pay')}</h3>
    <div className="chart">{nx.map(x => <div key={x.v.y + '-' + x.v.m} className="col">
      <div className="bars"><i className="b-in" style={{ height: x.inc / maxBar * 100 + '%' }} /><i className={'b-out ' + (x.left < 0 ? 'neg' : '')} style={{ height: x.out / maxBar * 100 + '%' }} /></div>
      <small className={x.left < 0 ? 'r' : ''}>{mn(x.v.m).slice(0, 3)}</small></div>)}</div>
    <div className="legend"><span className="tag c-paid">{t('Income')}</span><span className="tag c-loan">{t('Payments')}</span><span className="tag" style={{ background: '#dc2626' }}>{t('Short month')}</span></div>
    <div className="grid"><Card a="Average you keep per month" b={rs(avgLeft)} tone={avgLeft < 0 ? 'bad' : 'good'} /><Card a="Could save in 12 months" b={rs(Math.max(0, sum(nx, 'left')))} /></div>
    <div className="form"><h3>{t('💡 Can we afford a new loan?')}</h3>
      <Field label="Savings you already have" hint="Cash you could use if a month is short. Saved on this device."><Money value={saved} onChange={keep} /></Field>
      <Field label={t('Loan amount: {a}', { a: rs(amt) })}><input type="range" min="50000" max="5000000" step="50000" value={amt} onChange={e => setAmt(+e.target.value)} /></Field>
      <Field label={t('Interest: {r}% per year', { r: N(rate) })}><input type="range" min="0" max="24" step=".25" value={rate} onChange={e => setRate(+e.target.value)} /></Field>
      <Field label={t('Repay over: {y} years', { y: N(yrs) })}><input type="range" min="1" max="15" value={yrs} onChange={e => setYrs(+e.target.value)} /></Field>
      <div className={'verdict ' + nv.c}>{nv.t}</div>
      <div className="grid"><Card a="New payment every month" b={rs(emi)} /><Card a="Total interest of new loan" b={rs(emi * n - amt)} /><Card a="Lowest savings balance (12 mo)" b={rs(lowest)} tone={lowest < 0 ? 'bad' : 'good'} /></div>
      {avgInc > 0 && <p className="muted">{t('Safe limit: about {a} a month, which is a loan of roughly {b} at these terms.', { a: rs(safeEmi), b: rs(safeAmt) })}</p>}
    </div>
    <div className="form"><h3>{t('🎯 Saving goal')}</h3>
      <Field label="I want to save"><Money value={goal} onChange={setGoal} /></Field>
      <Field label={t('In {n} months', { n: N(gm) })}><input type="range" min="1" max="36" value={gm} onChange={e => setGm(+e.target.value)} /></Field>
      <div className={'verdict ' + (avgLeft >= need ? 'good' : 'bad')}>{t('You need to set aside {a} a month.', { a: rs(need) })} {avgLeft >= need ? t('You can do it.') : t('You keep about {a}, so it is {b} too much each month.', { a: rs(Math.max(0, avgLeft)), b: rs(need - Math.max(0, avgLeft)) })}</div>
    </div>
  </>
}

/* ============ SIMULATOR ============ */
function Simulator({ loans, events, incomes }) {
  const [tb, setTb] = useState('extra')
  return <>
    <div className="seg"><button className={tb === 'extra' ? 'on' : ''} onClick={() => setTb('extra')}>{t('💸 Pay extra on a loan')}</button>
      <button className={tb === 'future' ? 'on' : ''} onClick={() => setTb('future')}>{t('📈 Future income')}</button></div>
    {tb === 'extra' ? <ExtraPay loans={loans} /> : <FutureIncome events={events} incomes={incomes} />}
  </>
}
function ExtraPay({ loans }) {
  const sl = loans.filter(l => !isPersonal(l.data))
  const [id, setId] = useState(null), [at, setAt] = useState(1), [amt, setAmt] = useState(50000), [mode, setMode] = useState('reduce')
  if (!sl.length) return <p className="muted">{t('Add a cooperative or interest-bearing loan first.')}</p>
  const it = sl.find(l => l.id === id)
  const reset = () => { setId(null); setAt(1); setAmt(50000); setMode('reduce') }
  let a = [], b = []
  if (it) { try { a = schedule(it.data, {}, mode); b = schedule(it.data, { [at - 1]: amt }, mode) } catch { a = b = [] } }
  const saved = it && a.length ? sum(a, 'interest') - sum(b, 'interest') : 0
  return <div className="form">
    <div className="lhead"><h3 style={{ margin: 0 }}>{t('What if I pay extra?')}</h3><button onClick={reset}>{t('↺ Clear')}</button></div>
    <Field label="Pick a loan (tap it again to unselect)"><div className="chips">{sl.map(l =>
      <button key={l.id} className={'chip' + (id === l.id ? ' on' : '')} onClick={() => { setId(id === l.id ? null : l.id); setAt(1) }}>
        <b>{t(l.name)}</b><small>{rs(l.data.amount)} · {N(l.data.rate)}%</small></button>)}</div></Field>
    {!it && <p className="muted">{t('Select a loan above to see what an extra payment would save.')}</p>}
    {it && a.length > 0 && <>
      <div className="row2">
        <Field label="Extra amount"><Money value={amt} onChange={setAmt} /></Field>
        <Field label="Pay it on"><select value={at} onChange={e => setAt(+e.target.value)}>{a.slice(0, 60).map(r => <option key={r.i} value={r.i + 1}>{t('Session {n}', { n: N(r.i + 1) })} · {bs(r.date)}</option>)}</select></Field>
        <Field label="Cooperative policy"><select value={mode} onChange={e => setMode(e.target.value)}><option value="reduce">{t('Installments get smaller, same duration')}</option><option value="shorten">{t('Same installment, loan ends sooner')}</option></select></Field>
      </div>
      <input type="range" min="0" max={Math.min(500000, it.data.amount)} step="5000" value={amt} onChange={e => setAmt(+e.target.value)} />
      <div className={'verdict ' + (saved > 0 ? 'good' : 'mid')}>{t('Paying {a} extra saves you {b} in interest.', { a: rs(amt), b: rs(saved) })}</div>
      <div className="grid">
        <Card a="Interest without extra" b={rs(sum(a, 'interest'))} /><Card a="Interest with extra" b={rs(sum(b, 'interest'))} />
        <Card a="Sessions" b={N(a.length) + ' → ' + N(b.length)} /><Card a="Loan ends (BS)" b={bs(a.at(-1).date) + ' → ' + bs(b.at(-1).date)} /></div>
      <details className="adv"><summary>{t('Show the full schedule with the extra payment ({n} sessions)', { n: N(b.length) })}</summary>
        <div className="scroll tall"><table><thead><tr><th className="l">#</th><th className="l">{t('Date (BS)')}</th><th>{t('Interest')}</th><th>{t('Principal')}</th><th>{t('Extra')}</th><th>{t('Total')}</th><th>{t('Balance')}</th></tr></thead>
          <tbody>{b.map(r => <tr key={r.i} className={r.extra ? 'paidrow' : ''}><td className="l">{N(r.i + 1)}</td><td className="l">{bs(r.date)}</td><td>{fmt(r.interest)}</td><td>{fmt(r.principal)}</td>
            <td>{r.extra ? fmt(r.extra) : '-'}</td><td><b>{fmt(r.total)}</b></td><td>{fmt(r.bal)}</td></tr>)}</tbody></table></div></details>
    </>}
  </div>
}
function FutureIncome({ events, incomes }) {
  const [chg, setChg] = useState(15000), [after, setAfter] = useState(18), [saved, setSaved] = useState(0)
  const incRows = useMemo(() => incomes.flatMap(it => expenseRows(it.data)), [incomes])
  const months = Array.from({ length: 48 }, (_, k) => { const v = addMonths(TODAY.y, TODAY.m, k)
    const inc = sum(incRows.filter(r => inMonth(r, v)), 'total'), out = sum(events.filter(e => inMonth(e, v)), 'total'), c = k >= after ? chg : 0
    return { k, inc, out, c, now: inc - out, then: inc - out + c } })
  const years = [0, 1, 2, 3].map(y => { const l = months.slice(y * 12, y * 12 + 12)
    return { y, inc: sum(l, 'inc'), out: sum(l, 'out'), now: sum(l, 'now'), then: sum(l, 'then') } })
  const gain = sum(months, 'c'), principalLeft = sum(events.filter(e => e.date >= t0), 'principal')
  let bn = saved, bt = saved, shortNow = 0, shortThen = 0
  months.forEach(m => { bn += m.now; bt += m.then; if (bn < 0) shortNow++; if (bt < 0) shortThen++ })
  return <div className="form"><h3>{t('📈 What if my income changes later?')}</h3>
    <p className="muted">{t('Example: you get a job in 18 months that adds NPR 15,000 a month. Use a minus sign for a pay cut or a new big expense.')}</p>
    <div className="row2">
      <Field label="Change in monthly income (+ or −)"><Money value={chg} onChange={setChg} /></Field>
      <Field label={t('Starts after {n} months', { n: N(after) })}><input type="range" min="0" max="47" value={after} onChange={e => setAfter(+e.target.value)} /></Field>
      <Field label="Savings you have now"><Money value={saved} onChange={setSaved} /></Field>
    </div>
    <div className={'verdict ' + (gain >= 0 ? 'good' : 'bad')}>{t(gain >= 0 ? 'Over 4 years this adds {a}.' : 'Over 4 years this costs {a}.', { a: rs(Math.abs(gain)) })}
      {principalLeft > 0 && gain > 0 && t(' That could cover about {p}% of the loan principal you still owe ({a}), if you used it to repay early.', { p: N(Math.min(100, Math.round(gain / principalLeft * 100))), a: rs(principalLeft) })}</div>
    <div className="grid">
      <Card a="Savings after 4 years, today's income" b={rs(bn)} tone={bn < 0 ? 'bad' : ''} /><Card a="Savings after 4 years, with the change" b={rs(bt)} tone={bt < 0 ? 'bad' : 'good'} />
      <Card a="Months with no money (today → with change)" b={N(shortNow) + ' → ' + N(shortThen)} /></div>
    <div className="scroll"><table><thead><tr><th className="l">{t('Year')}</th><th>{t('You earn')}</th><th>{t('You pay')}</th><th>{t('Keep (today)')}</th><th>{t('Keep (with change)')}</th></tr></thead>
      <tbody>{years.map(y => <tr key={y.y}><td className="l">{t('Year {n}', { n: N(y.y + 1) })}</td><td>{fmt(y.inc)}</td><td>{fmt(y.out)}</td><td>{fmt(y.now)}</td><td><b>{fmt(y.then)}</b></td></tr>)}</tbody></table></div>
    <p className="muted">{t('Uses your saved income, expenses, taxes and loan schedules. Add all your income in the Income tab first for accurate numbers.')}</p>
  </div>
}