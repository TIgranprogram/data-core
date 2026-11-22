import { join } from 'path';
import PDFDocument from 'pdfkit';
import { guardDoc } from '../../common/print/safe-doc';
import { fontDir } from './passport-pdf';
import type { RegistryLine } from './passport-registry.service';

interface RegistryPrintInput {
  orderNo: string;
  productionNo: string;
  customer: string;
  rows: RegistryLine[];
  ready: number;
  current: { recipient: string; handedOn: string } | null;
}

const labels = { missing: 'Не выпущен', draft: 'Черновик', check: 'Нужно уточнить', issued: 'Выпущен', attached: 'Вложенный PDF' };
const cols = [
  { title: '№', width: 28 }, { title: 'Позиция', width: 229 }, { title: 'Кол-во', width: 50 },
  { title: 'Номер / файл', width: 123 }, { title: 'Состояние', width: 93 },
];
const margin = 36;

export function renderRegistryPdf(input: RegistryPrintInput): Promise<Buffer> {
  const title = 'Реестр паспортов';
  const pdf = guardDoc(new PDFDocument({ size: 'A4', margin, info: { Title: title } }), title);
  pdf.registerFont('gost', join(fontDir(), 'gost-a.ttf'));
  const buffers: Buffer[] = [];
  pdf.on('data', (chunk: Buffer) => buffers.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    pdf.on('end', () => resolve(Buffer.concat(buffers)));
    pdf.on('error', reject);
  });
  const tableWidth = cols.reduce((width, col) => width + col.width, 0);
  let y = margin;
  pdf.font('gost').fontSize(19).text(title, margin, y, { width: tableWidth });
  pdf.fontSize(11).text([input.productionNo && 'Заказ № ' + input.productionNo, input.orderNo && 'Договор № ' + input.orderNo]
    .filter(Boolean).join(' · ') || 'Без номера');
  if (input.customer) pdf.text('Заказчик: ' + input.customer);
  pdf.text('Готово ' + input.ready + ' из ' + input.rows.length);
  pdf.text(input.current ? 'Передано ' + input.current.handedOn + ' · ' + input.current.recipient : 'Передача комплекта не зафиксирована');
  pdf.text('Сформировано ' + new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow' }).format(new Date()));
  y = pdf.y + 12;

  function draw(values: string[], header = false) {
    pdf.fontSize(10);
    const pad = 6;
    const height = Math.max(...values.map((value, i) => pdf.heightOfString(value, { width: cols[i].width - 2 * pad }))) + 2 * pad;
    if (!header && y + height > pdf.page.height - margin - 5) {
      pdf.addPage();
      y = margin;
      draw(cols.map(col => col.title), true);
    }
    let x = margin;
    values.forEach((value, i) => {
      const width = cols[i].width;
      if (header) pdf.rect(x, y, width, height).fill('#eeeeee');
      pdf.lineWidth(0.4).strokeColor('#777777').rect(x, y, width, height).stroke();
      pdf.fillColor('#111111').text(value, x + pad, y + pad, { width: width - 2 * pad, height: height - 2 * pad + 1 });
      x += width;
    });
    y += height;
  }

  draw(cols.map((col) => col.title), true);
  input.rows.forEach((row, index) => {
    const doc = row.document;
    draw([String(row.lineNo ?? index + 1), row.title, row.qty == null ? '—' : String(row.qty),
      [doc?.number && '№ ' + doc.number, doc?.revision && 'ред. ' + doc.revision, doc?.fileName].filter(Boolean).join(' · ') || '—',
      labels[row.state]]);
  });
  if (!input.rows.length) pdf.text('Позиций для паспорта нет.', margin, y + 12);
  pdf.end();
  return done;
}
