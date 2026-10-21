import { api, PREFIX } from '../core/api.js';
import { h } from '../core/dom.js';
import { money, parseNum, qty } from '../core/format.js';
import { readTableFile } from '../core/xlsx-read.js';
import { attachCombo } from '../ui/combo.js';
import { lookups } from './lookups.js';
import { incomeLookups } from './orders.js';

/*
 * Коммерческое предложение (TASKS БЗ-4) и загрузка каталога — свои формы в правой панели (как «+ Счёт»).
 * КП: изделия из «Продукции» («В КП»), количество и цена по строкам, наша компания, заказчик → «Сформировать» —
 * номер КП с сервера (/showcase/kp) и страница для печати / «Сохранить как PDF» в новой вкладке.
 */
const KEY = 'dc-kp';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
const save = (a) => { try { localStorage.setItem(KEY, JSON.stringify(a)); } catch { /* приватный режим */ } };
export const kpCount = () => load().length;
export function kpAdd(r) { const a = load(); const x = a.find((y) => y.id === r.id); if (x) x.qty += 1; else a.push({ id: r.id, sku: r.sku, name: r.name, price: r.price ?? 0, qty: 1 }); save(a); }

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const rub = (n) => esc(money(n));

/** Страница КП для печати (в новой вкладке): данные экранируются, картинки — полными адресами. */
function printKp(d) {
  const base = location.origin + PREFIX;
  const c = d.company || {};
  const req = [c.inn && `ИНН ${c.inn}`, c.kpp && `КПП ${c.kpp}`, c.address, c.phone, c.email, c.website].filter(Boolean).map(esc).join(' · ');
  const bank = [c.bankName, c.bankBik && `БИК ${c.bankBik}`, c.bankAccount && `р/с ${c.bankAccount}`, c.bankCorrAccount && `к/с ${c.bankCorrAccount}`].filter(Boolean).map(esc).join(' · ');
  const rows = d.items.map((l, i) => `<tr><td>${i + 1}</td><td class="ph">${l.photo ? `<img src="${esc(base + (l.photo.thumb || l.photo.url))}" alt="">` : ''}</td><td><b>${esc(l.name)}</b><div class="m">арт. ${esc(l.sku)}${l.series ? ' · серия ' + esc(l.series) : ''}</div></td><td class="r">${esc(qty(l.qty))}</td><td class="r">${l.price ? rub(l.price) : '—'}</td><td class="r">${l.sum ? rub(l.sum) : '—'}</td></tr>`).join('');
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${esc(d.number)} — коммерческое предложение</title><style>
body{font-family:Arial,sans-serif;color:#17201c;margin:32px;font-size:13px}h1{font-size:22px;margin:0 0 4px}.m{color:#5d6964;font-size:12px}
.head{display:flex;justify-content:space-between;gap:24px;border-bottom:2px solid #0f7d55;padding-bottom:12px;margin-bottom:16px}
table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border-bottom:1px solid #d5ddd9;padding:8px;text-align:left;vertical-align:middle}th{background:#f1f5f3;font-size:12px}
.r{text-align:right;white-space:nowrap}.ph img{width:72px;height:72px;object-fit:cover;border-radius:6px}.tot td{font-weight:700;font-size:15px;border-bottom:0}
.note{margin-top:16px;white-space:pre-wrap}@media print{body{margin:12mm}.noprint{display:none}}</style></head><body>
<p class="noprint m">Печать: Ctrl+P → «Сохранить как PDF».</p>
<div class="head"><div><b style="font-size:16px">${esc(c.name || '')}</b><div class="m">${req}</div><div class="m">${bank}</div></div>
<div style="text-align:right"><h1>Коммерческое предложение</h1><div>№ ${esc(d.number)} от ${esc(new Date(d.date).toLocaleDateString('ru-RU'))}</div>${d.customer ? `<div>Для: <b>${esc(d.customer)}</b></div>` : ''}</div></div>
<table><thead><tr><th>№</th><th>Фото</th><th>Наименование</th><th class="r">Кол-во</th><th class="r">Цена</th><th class="r">Сумма</th></tr></thead><tbody>${rows}
<tr class="tot"><td colspan="5" class="r">Итого</td><td class="r">${rub(d.total)}</td></tr></tbody></table>
${d.note ? `<div class="note">${esc(d.note)}</div>` : ''}</body></html>`;
  const w = window.open(URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' })), '_blank');
  if (!w) throw new Error('Браузер не дал открыть вкладку — разрешите всплывающие окна для сайта');
}

async function buildKpForm() {
  const [lk, il] = await Promise.all([lookups().catch(() => ({})), incomeLookups().catch(() => ({ companies: [], customers: [] }))]);
  let lines = load();
  const field = (label, el, cls = '') => h('label', { class: 'field ' + cls }, h('span', null, label), el);
  const company = h('select', null, ...(il.companies || []).map((c) => h('option', { value: c.id }, c.name)));
  const customer = h('input', { maxlength: 300, placeholder: 'Кому: заказчик' });
  const custBox = h('div', { class: 'has-combo' }, customer); // поле сначала в обёртку — список крепится к родителю
  attachCombo(customer, { options: () => (il.customers || lk.customers || []).map((x) => ({ label: x })) });
  const note = h('textarea', { rows: 3, placeholder: 'Срок изготовления, условия оплаты и доставки…' });
  const list = h('div', { class: 'kp-lines' });
  const total = h('div', { class: 'kp-total num' });
  const render = () => {
    save(lines);
    total.textContent = `Итого: ${money(lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.price) || 0), 0))}`;
    if (!lines.length) { list.replaceChildren(h('p', { class: 'muted' }, 'КП пусто — в «Продукции» нажмите «В КП» у нужных изделий.')); return; }
    list.replaceChildren(...lines.map((l, i) => {
      const q = h('input', { inputmode: 'decimal', value: String(l.qty), 'aria-label': 'Количество' });
      const p = h('input', { inputmode: 'decimal', value: l.price ? String(l.price) : '', placeholder: 'цена', 'aria-label': 'Цена' });
      q.addEventListener('input', () => { l.qty = parseNum(q.value) || 0; save(lines); total.textContent = `Итого: ${money(lines.reduce((s, x) => s + (Number(x.qty) || 0) * (Number(x.price) || 0), 0))}`; });
      p.addEventListener('input', () => { l.price = parseNum(p.value) || 0; save(lines); total.textContent = `Итого: ${money(lines.reduce((s, x) => s + (Number(x.qty) || 0) * (Number(x.price) || 0), 0))}`; });
      return h('div', { class: 'kp-line' }, h('div', { class: 'kp-name' }, h('b', null, l.name), h('small', { class: 'muted' }, `арт. ${l.sku}`)),
        field('Кол-во', q), field('Цена, ₽', p),
        h('button', { class: 'btn btn-ghost btn-icon btn-sm', type: 'button', title: 'Убрать', onclick: () => { lines.splice(i, 1); render(); } }, '×'));
    }));
  };
  render();
  const el = h('div', { class: 'kp-form' }, list, total, h('div', { class: 'form-grid' }, field('Наша компания', company), field('Заказчик', custBox), field('Условия, примечание', note, 'wide')));
  return {
    el, focus: () => customer.focus(), dirty: () => false,
    read: () => ({ values: { save: async () => {
      if (!lines.length) throw new Error('Добавьте изделия в КП');
      const d = await api('/showcase/kp', { method: 'POST', body: { items: lines.map((l) => ({ id: l.id, qty: Number(l.qty) || 1, price: Number(l.price) || 0 })), companyId: company.value || undefined, customer: customer.value.trim() || undefined, note: note.value.trim() || undefined } });
      printKp(d);
      return { id: null, number: d.number };
    } } }),
  };
}

async function buildImportForm() {
  let text = '';
  const area = h('textarea', { rows: 8, placeholder: 'Вставьте строки из Excel вместе с заголовками (Тип, Группа, Артикул, Наименование, Серия, Цена) — или выберите файл' });
  const file = h('input', { type: 'file', accept: '.xlsx,.csv,.txt' });
  const report = h('div', { class: 'imp-report' });
  const check = async () => {
    text = area.value;
    if (!text.trim()) { report.replaceChildren(); return; }
    try {
      const r = await api('/showcase/import', { method: 'POST', body: { text, apply: false } });
      report.replaceChildren(...[h('p', null, h('b', null, `Строк: ${r.total}`), ` · новых ${r.new} · обновится ${r.update} · без изменений ${r.same}${r.deleted ? ` · в корзине ${r.deleted}` : ''}`),
        r.errors.length ? h('ul', { class: 'muted' }, ...r.errors.slice(0, 10).map((e) => h('li', null, e))) : null,
        h('ul', { class: 'timeline' }, ...r.preview.slice(0, 10).map((p) => h('li', null, h('span', { class: 'muted' }, ({ new: 'новое', update: 'обновится', same: 'как есть', deleted: 'в корзине' })[p.action]), ` ${p.sku} · ${p.name}`, h('span', { class: 'muted' }, [p.type, p.group, p.series].filter(Boolean).join(' · ')))))].filter(Boolean));
    } catch (e) { report.replaceChildren(h('p', { class: 'err' }, e.message)); }
  };
  area.addEventListener('input', () => { clearTimeout(area._t); area._t = setTimeout(check, 400); });
  file.addEventListener('change', async () => { if (file.files[0]) { try { area.value = await readTableFile(file.files[0]); check(); } catch (e) { report.replaceChildren(h('p', { class: 'err' }, e.message)); } } });
  const el = h('div', null, h('p', { class: 'hint' }, 'Каталог изделий: по артикулу — новые добавятся, у существующих обновятся название, раздел, группа, серия (цена — только если её ещё нет). Ничего не удаляется. Изделия без цены — черновики.'),
    h('label', { class: 'field wide' }, h('span', null, 'Файл Excel (.xlsx) или CSV'), file), h('label', { class: 'field wide' }, h('span', null, 'Или вставьте строки'), area), report);
  return {
    el, focus: () => area.focus(), dirty: () => !!area.value.trim(),
    read: () => ({ values: { save: async () => {
      if (!text.trim()) throw new Error('Вставьте строки каталога или выберите файл');
      const r = await api('/showcase/import', { method: 'POST', body: { text, apply: true } });
      return { id: null, ...r };
    } } }),
  };
}

export const kp = {
  id: 'kp', title: 'Коммерческое предложение', newTitle: 'Коммерческое предложение', card: { heading: () => 'КП' }, get: async () => ({}),
  form: { build: buildKpForm, toBody: (v) => v, create: (v) => v.save(), saveLabel: 'Сформировать и открыть для печати', closeAfterCreate: true },
};
export const catalogImport = {
  id: 'catalogimport', title: 'Загрузка каталога', newTitle: 'Загрузить каталог изделий', card: { heading: () => 'Каталог' }, get: async () => ({}),
  form: { build: buildImportForm, toBody: (v) => v, create: (v) => v.save(), saveLabel: 'Загрузить', closeAfterCreate: true },
};
