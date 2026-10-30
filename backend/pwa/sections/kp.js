import { api, PREFIX } from '../core/api.js';
import { h } from '../core/dom.js';
import { busyBtn } from '../ui/busy.js';
import { money, parseNum, plural, qty } from '../core/format.js';
import { readTableFile } from '../core/xlsx-read.js';
import { downloadXlsx } from '../core/xlsx-write.js';
import { attachCombo } from '../ui/combo.js';
import { toast, toastError } from '../ui/toast.js';
import { lookups } from './lookups.js';
import { incomeLookups } from './orders.js';
import { errText } from '../ui/errors.js';
import { go } from '../core/router.js';
import { createOffer } from './offers.js';

/*
 * Коммерческое предложение (TASKS БЗ-4) и загрузка каталога — свои формы в правой панели (как «+ Счёт»).
 * КП: изделия из «Продукции» («В КП»), количество и цена по строкам, наша компания, заказчик → «Создать КП» —
 * КП сохраняется на сервере (sections/offers.js) и открывается в правой панели. Печать HTML — только для старого сервера без /offers.
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
<div class="head"><div><b style="font-size:16px">${esc(c.fullName || c.name || '')}</b><div class="m">${req}</div><div class="m">${bank}</div></div>
<div style="text-align:right"><h1>Коммерческое предложение</h1><div>№ ${esc(d.number)} от ${esc(new Date(d.date).toLocaleDateString('ru-RU'))}</div>${d.customer ? `<div>Для: <b>${esc(d.customer)}</b></div>` : ''}</div></div>
<table><thead><tr><th>№</th><th>Фото</th><th>Название</th><th class="r">Кол-во</th><th class="r">Цена</th><th class="r">Сумма</th></tr></thead><tbody>${rows}
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
  const searchInput = h('input', { placeholder: 'Добавить изделие: название или артикул…', class: 'kp-search-input' });
  const searchDrop = h('div', { class: 'kp-search-drop' });
  const searchBox = h('div', { class: 'kp-search-box' }, searchInput, searchDrop);
  let searchTimer;
  const clearSearch = () => { searchDrop.replaceChildren(); searchInput.value = ''; };
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = searchInput.value.trim();
    if (q.length < 2) { searchDrop.replaceChildren(); return; }
    searchTimer = setTimeout(async () => {
      const data = await api(`/showcase?search=${encodeURIComponent(q)}&limit=10`).catch(() => null);
      const items = data?.items || [];
      if (!items.length) { searchDrop.replaceChildren(h('div', { class: 'kp-search-empty' }, 'Не найдено')); return; }
      searchDrop.replaceChildren(...items.map((r) => {
        const btn = h('button', { type: 'button', class: 'kp-search-item' },
          r.sku ? h('span', { class: 'muted small' }, r.sku + ' · ') : null, r.name,
          r.price ? h('span', { class: 'muted small' }, ' — ' + money(r.price) + ' ₽') : null);
        btn.onclick = () => { kpAdd(r); lines = load(); render(); clearSearch(); };
        return btn;
      }));
    }, 300);
  });
  searchInput.addEventListener('blur', () => setTimeout(() => searchDrop.replaceChildren(), 200));
  const render = () => {
    save(lines);
    total.textContent = `Итого: ${money(lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.price) || 0), 0))}`;
    if (!lines.length) { list.replaceChildren(h('p', { class: 'muted' }, 'КП пусто — найдите изделие выше или нажмите «В КП» в разделе «Продукция».')); return; }
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
  const el = h('div', { class: 'kp-form' }, searchBox, list, total, h('div', { class: 'form-grid' }, field('Наша компания', company), field('Заказчик', custBox), field('Условия, примечание', note, 'wide')));
  return {
    el, focus: () => customer.focus(), dirty: () => false,
    read: () => ({ values: { save: async () => {
      if (!lines.length) throw new Error('Добавьте изделия в КП');
      if (!customer.value.trim()) { customer.focus(); throw new Error('Впишите заказчика'); }
      const day = (add) => { const t = new Date(); t.setDate(t.getDate() + add); return t.toISOString().slice(0, 10); };
      const offer = await createOffer({ companyId: company.value || undefined, customer: customer.value.trim(), date: day(0), validUntil: day(14), terms: note.value.trim() || undefined,
        items: lines.map((l) => ({ productId: l.id, productSku: l.sku, productName: l.name, quantity: Number(l.qty) || 1, unit: 'шт', ...(Number(l.price) > 0 ? { unitPrice: Number(l.price) } : {}) })) });
      if (offer) { save([]); go('offers', { open: offer.id }); return { id: offer.id, stay: true }; }
      // старый сервер без /offers — прежняя печать
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
    } catch (e) { report.replaceChildren(h('p', { class: 'err' }, errText(e))); }
  };
  area.addEventListener('input', () => { clearTimeout(area._t); area._t = setTimeout(check, 400); });
  file.addEventListener('change', async () => { if (file.files[0]) { try { area.value = await readTableFile(file.files[0]); check(); } catch (e) { report.replaceChildren(h('p', { class: 'err' }, errText(e))); } } });
  const el = h('div', null, h('p', { class: 'hint' }, 'Каталог изделий: по артикулу — новые добавятся, у существующих обновятся название, раздел, группа, серия (цена — только если её ещё нет). Ничего не удаляется. Изделия без цены — черновики.'),
    h('button', { class: 'btn', type: 'button', title: 'Пустая таблица с нужными колонками и примером', onclick: () => downloadXlsx('Шаблон каталога изделий.xlsx', [['Тип', 'Группа', 'Артикул', 'Наименование', 'Серия', 'Цена'], ['Детское игровое оборудование', 'Качели', 'КЧ-001', 'Качели двойные', 'Классик', 12500]], 'Каталог') }, '⇩ Шаблон Excel'),
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

// Изделия из заказов (БЗ-5): весь список «что можно создать» с галочками и названием, которое можно поправить;
// создаются только отмеченные. Позиции заказов не меняются, кроме ссылки на изделие; неотмеченные остаются без изделия.
async function buildFromOrdersForm() {
  const r = await api('/showcase/from-orders', { method: 'POST', body: { apply: false } });
  const rows = (r.items || r.preview).map((p) => ({ p,
    cb: h('input', { type: 'checkbox', checked: true, 'aria-label': 'Создать «' + p.name + '»' }),
    name: h('input', { value: p.name, maxlength: 256, class: 'fo-name', 'aria-label': 'Название изделия' }) }));
  const count = h('b');
  const upd = () => { count.textContent = `Отмечено: ${rows.filter((x) => x.cb.checked).length} из ${rows.length}`; };
  rows.forEach((x) => x.cb.addEventListener('change', upd)); upd();
  const all = (on) => { rows.forEach((x) => { x.cb.checked = on; }); upd(); };
  const el = h('div', null,
    h('p', { class: 'hint' }, 'Позиции заказов, которых ещё нет в «Продукции». Отметьте, что сделать изделиями-черновиками (без цены), и при желании поправьте название; полное описание из заказа попадёт в описание изделия. Неотмеченные позиции остаются как есть — их можно добавить позже тем же способом. Текст и суммы в заказах не меняются.'),
    h('p', null, `Новых: ${r.new} · уже есть в «Продукции»: ${r.exists} (позиции привяжутся к ним сами) · позиций заказов проверено: ${r.lines}`),
    rows.length ? h('div', { class: 'bulk-foot' }, count,
      h('button', { type: 'button', class: 'btn btn-sm', onclick: () => all(true) }, 'Выбрать все'),
      h('button', { type: 'button', class: 'btn btn-sm', onclick: () => all(false) }, 'Снять все')) : null,
    rows.length ? h('ul', { class: 'dict-cand-list fo-list' }, ...rows.map(({ p, cb, name }) => h('li', null, cb, name,
      h('span', { class: 'muted small' }, `позиций ${p.lines}${p.orders.length ? ' · заказы ' + p.orders.join(', ') : ''}`)))) : h('p', { class: 'muted' }, 'Новых изделий нет'));
  return {
    el, dirty: () => false,
    read: () => ({ values: { save: async () => {
      const picks = rows.filter((x) => x.cb.checked).map((x) => ({ key: x.p.key, name: x.name.value.trim() || x.p.name }));
      if (!picks.length) throw new Error('Отметьте изделия, которые создать');
      return { id: null, ...(await api('/showcase/from-orders', { method: 'POST', body: { apply: true, picks } })) };
    } } }),
  };
}

// Изделия из паспортов (БЗ-8): группы похожих моделей — выбрать главный вариант (лучший по заполнению уже выбран) и
// «Объединить» или «Это разные изделия»; «Создать для остальных» — изделие на каждую одиночную модель. Паспорта не меняются, кроме ссылки.
async function buildFromPassportsForm() {
  const r = await api('/showcase/from-passports');
  const art = (m) => [m.article ? `арт. ${m.article}` : 'без артикула', `${m.n} ${plural(m.n, 'паспорт', 'паспорта', 'паспортов')}`, `заполнено ${m.score}`].join(' · ');
  const run = async (btn, body, done) => {
    const free = busyBtn(btn, 'Создаю…');
    try { const res = await api('/showcase/from-passports', { method: 'POST', body }); toast(`Изделий создано: ${res.created}, паспортов связано: ${res.linked}`); done(); }
    catch (e) { toastError(e, 'создать изделия'); free(); }
  };
  const groupEl = (g, i) => {
    const rows = g.map((m, k) => ({ m,
      main: h('input', { type: 'radio', name: 'fp-main-' + i, checked: k === 0, 'aria-label': 'Главный вариант' }),
      on: h('input', { type: 'checkbox', checked: true, 'aria-label': 'В эту группу' }) }));
    const name = h('input', { value: g[0].name, maxlength: 256, class: 'fo-name', 'aria-label': 'Название изделия' });
    rows.forEach((x) => x.main.addEventListener('change', () => { if (x.main.checked) { name.value = x.m.name; x.on.checked = true; } }));
    const box = h('div', { class: 'fp-group' });
    const merge = h('button', { type: 'button', class: 'btn btn-primary btn-sm' }, 'Объединить');
    const apart = h('button', { type: 'button', class: 'btn btn-sm', title: 'Каждый вариант станет отдельным изделием' }, 'Это разные изделия');
    merge.addEventListener('click', () => {
      const keys = rows.filter((x) => x.on.checked).map((x) => x.m.key);
      const main = rows.find((x) => x.main.checked)?.m.key;
      if (!main || !keys.includes(main)) { toastError(new Error('Главный вариант должен быть отмечен')); return; }
      run(merge, { groups: [{ keys, main, name: name.value.trim() }] }, () => box.remove());
    });
    apart.addEventListener('click', () => run(apart, { groups: g.map((m) => ({ keys: [m.key], main: m.key })) }, () => box.remove()));
    box.append(h('div', { class: 'section-title' }, `Похожие: ${g.length}`),
      h('ul', { class: 'dict-cand-list fo-list' }, ...rows.map((x) => h('li', null, x.on, x.main, h('b', null, x.m.name), h('span', { class: 'muted small' }, art(x.m))))),
      h('label', { class: 'field wide' }, h('span', null, 'Название изделия'), name),
      h('div', { class: 'bulk-foot' }, merge, apart));
    return box;
  };
  const el = h('div', null,
    h('p', { class: 'hint' }, 'Паспорта без изделия в «Продукции». Похожие модели собраны в группы: галочка — паспорта группы, кружок — главный вариант (самый полно заполненный уже выбран), его данные станут данными изделия. Выданные паспорта — номера, текст, PDF — не меняются, только получают ссылку на изделие.'),
    h('p', null, `Групп похожих: ${r.groups.length} · одиночных моделей: ${r.singles} · уже связано паспортов: ${r.linked}${r.noName ? ` · без названия: ${r.noName} (пропущены)` : ''}`),
    ...r.groups.map(groupEl),
    r.singles ? h('details', { class: 'month-group' }, h('summary', null, `Одиночные модели: ${r.singles} — «Создать изделия для остальных»`),
      h('ul', { class: 'timeline' }, ...r.singlesPreview.map((m) => h('li', null, m.name, h('span', { class: 'muted' }, ` · ${art({ ...m, score: '—' })}`)))),
      r.singles > r.singlesPreview.length ? h('p', { class: 'muted' }, `…и ещё ${r.singles - r.singlesPreview.length}`) : null) : null);
  return {
    el, dirty: () => false,
    read: () => ({ values: { save: async () => {
      if (!r.singles) throw new Error('Одиночных моделей нет');
      return { id: null, ...(await api('/showcase/from-passports', { method: 'POST', body: { rest: true } })) };
    } } }),
  };
}

export const fromPassports = {
  id: 'frompassports', title: 'Изделия из паспортов', newTitle: 'Изделия из паспортов', card: { heading: () => 'Из паспортов' }, get: async () => ({}),
  form: { build: buildFromPassportsForm, toBody: (v) => v, create: (v) => v.save(), saveLabel: 'Создать изделия для остальных', closeAfterCreate: true },
};

export const kp = {
  id: 'kp', title: 'Коммерческое предложение', newTitle: 'Коммерческое предложение', card: { heading: () => 'КП' }, get: async () => ({}),
  form: { build: buildKpForm, toBody: (v) => v, create: (v) => v.save(), saveLabel: 'Создать КП', closeAfterCreate: true },
};
export const fromOrders = {
  id: 'fromorders', title: 'Изделия из заказов', newTitle: 'Изделия из заказов', card: { heading: () => 'Из заказов' }, get: async () => ({}),
  form: { build: buildFromOrdersForm, toBody: (v) => v, create: (v) => v.save(), saveLabel: 'Создать изделия', closeAfterCreate: true },
};
export const catalogImport = {
  id: 'catalogimport', title: 'Загрузка каталога', newTitle: 'Загрузить каталог изделий', card: { heading: () => 'Каталог' }, get: async () => ({}),
  form: { build: buildImportForm, toBody: (v) => v, create: (v) => v.save(), saveLabel: 'Загрузить', closeAfterCreate: true },
};
