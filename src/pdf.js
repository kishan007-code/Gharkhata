import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { bs, bsParts, fmt, sum, BS_MONTHS } from './engine'
const LABEL = { loan: 'Loan', expense: 'Expense', tax: 'Tax', insurance: 'Insurance' }

// scope: 'all' or 'loan'. Page 1+: month-wise installments. Last table: per-item yearly summary.
export function exportPDF(events, year, scope) {
  const ev = events.filter(e => bsParts(e.date).y === year && (scope === 'all' || e.cat === 'loan'))
  const doc = new jsPDF()
  doc.setFontSize(15)
  doc.text(`GharKhata - ${scope === 'all' ? 'All obligations' : 'Loan breakdown'} - BS ${year}`, 14, 16)
  const L = e => e.cat === 'loan'
  const body = []
  for (let m = 0; m < 12; m++) {
    const list = ev.filter(e => bsParts(e.date).m === m)
    if (!list.length) continue
    body.push([{ content: `${BS_MONTHS[m]} ${year}`, colSpan: 7, styles: { fillColor: [225, 232, 245], fontStyle: 'bold' } }])
    list.forEach(e => body.push([bs(e.date), LABEL[e.cat], e.item.name,
      L(e) ? fmt(e.interest) : '-', L(e) ? fmt(e.principal + e.extra) : '-', fmt(e.total), e.paid ? 'Paid' : 'Due']))
    body.push([{ content: 'Month total', colSpan: 5, styles: { halign: 'right', fontStyle: 'bold' } },
      { content: fmt(sum(list, 'total')), styles: { fontStyle: 'bold' } }, ''])
  }
  autoTable(doc, { startY: 22, styles: { fontSize: 8 }, headStyles: { fillColor: [31, 111, 235] },
    head: [['Date (BS)', 'Type', 'Name', 'Interest', 'Principal', 'Total', 'Status']], body })

  const per = {}
  ev.forEach(e => { const r = per[e.item.id] ??= { n: e.item.name, c: LABEL[e.cat], i: 0, p: 0, t: 0 }
    r.i += e.interest; r.p += e.principal + e.extra; r.t += e.total })
  const rows = Object.values(per).map(r => [r.n, r.c, fmt(r.i), fmt(r.p), fmt(r.t)])
  rows.push(['YEAR TOTAL', '', fmt(sum(ev, 'interest')), fmt(ev.reduce((s, e) => s + e.principal + e.extra, 0)), fmt(sum(ev, 'total'))])
  autoTable(doc, { startY: doc.lastAutoTable.finalY + 10, styles: { fontSize: 9 }, headStyles: { fillColor: [31, 111, 235] },
    head: [['Item', 'Type', 'Interest', 'Principal', 'Total']], body: rows })
  doc.save(`gharkhata-${year}-${scope}.pdf`)
}