import { api, apiFile } from '../../core/api.js';
import { h } from '../../core/dom.js';
import { attachCombo } from '../../ui/combo.js';
import { toast } from '../../ui/toast.js';
import { confirmDlg, modal } from '../../ui/dialog.js';
import { icon } from '../../ui/icons.js';
import { LATER_CATS, V2_CATS, heading, numberOf } from './common.js';
import { productsAll } from './models.js';

/** Окна карточки паспорта: выпуск, аннулирование, номер, PDF / печать, категория, привязка к изделию. */
/** НМ: «Выпустить» — номер, талон и номер изделия из счётчика (сервер, одна транзакция); повторное нажатие — тот же номер. */
export async function issueAction(row, ctx) {
  if (!(await confirmDlg('Выпустить паспорт?', 'Паспорт получит номер и гарантийный талон, текст будет заморожен. После выпуска номер не меняется; правки — «Новой редакцией».', { okText: 'Выпустить' }))) return;
  const r = await api(`/passports/${row.id}/issue`, { method: 'POST' });
  toast(`Выпущен паспорт № ${r.passportNumber}`); ctx.changed(); ctx.setRow(await api(`/passports/${row.id}`));
}
/** НМ: аннулирование выпущенного — причина обязательна (окно: одно поле). */
export async function annulDialog(row, ctx) {
  const ta = h('textarea', { rows: 3, 'aria-label': 'Причина', placeholder: 'Например: дубль паспорта № …' });
  const res = await modal({ title: `Аннулировать паспорт № ${row.passportNumber}?`, okText: 'Аннулировать', danger: true,
    body: h('div', null, h('p', null, 'Номер останется занятым и повторно не выдаётся. Паспорт останется в списке со статусом «Аннулирован».'), h('label', { class: 'field wide' }, h('span', null, 'Причина *'), ta)),
    onOk: async () => { if (!ta.value.trim()) throw new Error('Укажите причину'); return api(`/passports/${row.id}/annul`, { method: 'POST', body: { reason: ta.value.trim() } }); } });
  if (res) { toast('Паспорт аннулирован'); ctx.changed(); ctx.setRow(await api(`/passports/${row.id}`)); }
}
/** НМ-8: номер выпущенного — только администратор, с проверкой занятости; следующий выпуск всё равно получит max + 1. */
export async function numberDialog(row, ctx) {
  const inp = h('input', { type: 'text', inputmode: 'numeric', value: row.passportNumber || '', 'aria-label': 'Номер паспорта' });
  const res = await modal({ title: 'Изменить номер паспорта', okText: 'Сохранить',
    body: h('div', null, h('p', { class: 'hint' }, 'Только для исправления ошибки. Номер проверяется на занятость (в т. ч. у аннулированных и удалённых). Следующий выпуск получит номер больше максимального.'), h('label', { class: 'field wide' }, h('span', null, 'Номер'), inp)),
    onOk: async () => { const v = inp.value.trim(); if (!/^\d+$/.test(v)) throw new Error('Номер — число'); return api(`/passports/${row.id}`, { method: 'PATCH', body: { passportNumber: v, confirmNumbers: true } }); } });
  if (res) { toast('Номер изменён'); ctx.changed(); ctx.setRow(await api(`/passports/${row.id}`)); }
}
/** ПИ.5: привязать старый паспорт к изделию — выбор из «Продукции» (окно: одно поле). */
export async function linkDialog(r, ctx) {
  const all = await productsAll();
  const input = h('input', { type: 'text', 'aria-label': 'Изделие', placeholder: 'Название или артикул', value: r.name || '' });
  const ids = new Map();
  const field = h('label', { class: 'field wide' }, h('span', null, 'Изделие из «Продукции»'), input);
  attachCombo(input, { options: () => all.map((p) => { const l = `${p.name}${p.sku ? ' · арт. ' + p.sku : ''}`; ids.set(l, p.id); return { label: l, value: p.id, sub: [p.type, p.group].filter(Boolean).join(' › ') }; }) });
  const res = await modal({
    title: 'Привязать к изделию', okText: 'Привязать',
    body: h('div', null, field,
      h('p', { class: 'hint' }, 'Паспорт будет брать данные из изделия; номера, дата и текст не меняются. Нужного нет — «Создать изделие из паспорта».')),
    onOk: async () => {
      const id = ids.get(input.value.trim());
      if (!id) throw new Error('Выберите изделие из списка');
      return api(`/passports/${r.id}`, { method: 'PATCH', body: { productId: id } });
    },
  });
  if (res) { toast('Паспорт привязан к изделию'); ctx.setRow(await api(`/passports/${r.id}`)); }
}
/** Скачать PDF: «Готовлю…» висит, пока сервер собирает файл (на сервере с одним ядром — секунды), потом «Скачан». */
export async function download(r, query, what) {
  const done = toast(`Готовлю ${what}… это может занять до минуты`, { ms: 180000 });
  try { const name = await apiFile(`/passports/${r.id}/pdf`, { query, fallback: `Паспорт_${numberOf(r) || 'черновик'}.pdf` }); done(); toast(`Скачан: ${name}`); }
  catch (e) { done(); throw e; }
}

// Значки форматов (замечание пользователя 2026-10-22: «показать визуально, книжная или альбомная»)
export const FORMATS = [
  { mode: 'pages', title: 'Файл A5', sub: 'книжный, постранично — отправить по почте', icon: 'sheetA5' },
  { mode: 'print', title: 'Буклет A4', sub: 'альбомный лист, сложить пополам — распечатать', icon: 'sheetBooklet' },
  { mode: 'stand', title: 'Лист для стенда A3', sub: 'правила пользования, книжный, без печати', icon: 'sheetA3' },
];

/**
 * Скачать / распечатать паспорт (замечание пользователя 2026-10-22): сначала — печать и подпись (галочки), потом вид
 * (значками: A5, буклет A4, стенд A3), ч/б — у паспорта нового образца. Окно не закрывается, пока PDF готовится.
 */
export async function printDialog(r) {
  const hasCat = !!r.passportCategory; // текст по справочникам сервер соберёт сам, если его ещё нет
  const o = r.supplierOrg;
  const chk = (label, on, note) => { const cb = h('input', { type: 'checkbox', checked: on }); return { cb, el: h('label', null, cb, label, note ? h('span', { class: 'muted small' }, ` (${note})`) : null) }; };
  const seal = chk('Печать', !!o?.hasSeal, !o ? 'поставщик не выбран' : o.hasSeal ? '' : 'не загружена');
  const sign = chk('Подпись', !!o?.hasSignature, !o ? '' : o.hasSignature ? '' : 'не загружена');
  const mono = chk('Чёрно-белый', false);
  let mode = 'print';
  const opts = FORMATS.map((f) => {
    const b = h('button', { type: 'button', class: 'pf-opt', role: 'radio', 'data-mode': f.mode, onclick: () => pick(f.mode) }, icon(f.icon, 'pf-ico'), h('b', null, f.title), h('small', null, f.sub));
    return b;
  });
  const pick = (m) => { mode = m; opts.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === m))); stampBox.hidden = m === 'stand'; };
  const stampBox = h('div', { class: 'pf-checks' }, seal.el, sign.el);
  const body = h('div', { class: 'pf' },
    h('div', { class: 'section-title' }, 'Печать и подпись'), stampBox,
    h('div', { class: 'section-title' }, 'Вид'), h('div', { class: 'pf-opts', role: 'radiogroup', 'aria-label': 'Вид PDF' }, opts),
    h('div', { class: 'pf-checks' }, mono.el),
    hasCat ? null : h('p', { class: 'form-error' }, 'У паспорта не выбрана категория — PDF собирается по ней. «Выбрать категорию» в действиях карточки.'));
  pick(mode);
  await modal({
    title: `${heading(r)} — PDF`, okText: 'Скачать PDF', wide: true, body,
    onOk: async (form) => {
      if (!hasCat) throw new Error('Сначала выберите категорию паспорта');
      const ok = form.querySelector('[type=submit]');
      ok.textContent = 'Готовлю PDF…'; ok.classList.add('is-busy');
      try {
        if (mode === 'stand') { await download(r, { mode: 'stand' }, 'лист для стенда'); return true; }
        const s = seal.cb.checked, g = sign.cb.checked;
        const q = { ...(s || g ? { stamp: 1, ...(s ? {} : { seal: 0 }), ...(g ? {} : { sign: 0 }) } : {}), ...(mode === 'print' ? { mode: 'print' } : {}), ...(mono.cb.checked ? { bw: 1 } : {}) };
        await download(r, q, mode === 'print' ? 'буклет A4' : 'PDF');
        return true;
      } finally { ok.textContent = 'Скачать PDF'; ok.classList.remove('is-busy'); }
    },
  });
}

/** Паспорт без категории → выбрать категорию (подсказка — по старой категории); сервер соберёт текст по справочникам. */
export const OLD_TO_V2 = { 'уличный тренажёр': 'TRN', 'воркаут': 'WRK', 'спортивное оборудование': 'WRK', 'благоустройство': 'MAF', 'маф': 'MAF' };
export async function convertDialog(r, ctx) {
  const cats = V2_CATS.filter((c) => c.value && !LATER_CATS.includes(c.value));
  const sel = h('select', { 'aria-label': 'Категория паспорта' }, h('option', { value: '' }, '— выберите —'), cats.map((c) => h('option', { value: c.value }, c.label)));
  sel.value = OLD_TO_V2[String(r.category || '').trim().toLowerCase()] || '';
  const res = await modal({
    title: 'Категория паспорта', okText: 'Сохранить',
    body: h('div', null,
      h('p', null, 'Текст паспорта соберётся по справочникам «Паспорта» для этой категории — PDF будет полным, с цветом категории. Номера, даты, заказчик, картинки не меняются.'),
      h('label', { class: 'field wide' }, h('span', null, 'Категория', r.category ? h('span', { class: 'muted' }, ` (была: ${r.category})`) : null), sel),
      h('p', { class: 'hint' }, 'Потом проверьте блок «Проверка» в карточке — чего не хватает для полного текста.')),
    onOk: async () => {
      if (!sel.value) throw new Error('Выберите категорию');
      return api(`/passports/${r.id}`, { method: 'PATCH', body: { passportCategory: sel.value } });
    },
  });
  if (res) { toast('Категория выбрана, текст паспорта собран'); ctx.setRow(await api(`/passports/${r.id}`)); }
}
