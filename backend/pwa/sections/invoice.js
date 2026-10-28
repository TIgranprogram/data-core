import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { isoDay, money, parseNum, qty } from '../core/format.js';
import { parsePasted } from '../core/paste-parse.js';
import { downloadTemplate, readTableFile } from '../core/xlsx-read.js';
import { matchLines, rememberPairs } from '../core/bulk-match.js';
import { normSearch } from '../core/facets.js';
import { attachCombo } from '../ui/combo.js';
import { photoField } from '../ui/photos.js';
import { COST_CENTER } from '../ui/badges.js';
import { toast, toastError } from '../ui/toast.js';
import { lookups, UNITS, unitList, partnerAction } from './lookups.js';
import { pastItems } from './requests.js';
import { orderedNote } from './item-orders.js';
import { errText } from '../ui/errors.js';

/**
 * «+ Счёт» (TASKS В.3): уже оплаченный / полученный счёт, которого не было в заявках — вносится одним окном.
 * Шапка счёта общая, позиции — из базы (как «Категория → Позиция») или вручную; на каждую позицию создаётся
 * обычная заявка с тем же № и датой счёта (POST /supply/requests), «получено» — сразу приход на склад
 * (POST /supply/requests/:id/receive). Повтор безопасен (clientUid на строку).
 */
/** Подсветить поле, которое надо заполнить первым (категория). */
const needCat = (el) => { el.classList.add('need'); setTimeout(() => el.classList.remove('need'), 1600); };
const STATE = [
  { value: 'ordered', label: 'Заказано — ждём', status: 'В работе' },
  { value: 'paid', label: 'Оплачено', status: 'Оплачено' },
  { value: 'received', label: 'Получено — на склад', status: 'Оплачено' },
];
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());

/** Форма счёта для правой панели (card.js: section.form.build): { el, read, dirty, focus }. */
/** opts.paste — режим «из таблицы» (TASKS В.8): поле вставки строк сверху, по умолчанию «Заказано», № счёта необязателен. */
async function buildInvoiceForm(opts = {}) {
  const lk = await lookups();
  // позиции склада и прошлых заявок — по действию (выбрали категорию, вставили строки), не при открытии формы; один общий кэш склада
  const items = []; let itemsP = null;
  const loadItems = () => (itemsP ||= pastItems().catch(() => []).then((r) => { items.push(...r); }));
  const field = (label, el, cls = '') => h('label', { class: 'field ' + cls }, h('span', null, label), el);
  const no = h('input', { maxlength: 100, placeholder: 'например: 01097' });
  const date = h('input', { type: 'date', value: isoDay() });
  const sup = h('input', { maxlength: 200 });
  const company = h('select', null, h('option', { value: '' }, '—'), ...(lk.companies || []).map((c) => h('option', { value: c }, c)));
  const type = h('input', { maxlength: 60 });
  let state = opts.paste ? 'ordered' : 'received';
  let cc = 'workshop';
  const ccBox = h('div', { class: 'fseg' }, ...Object.entries(COST_CENTER).map(([k, l]) => h('button', { type: 'button', class: 'fseg-btn' + (k === cc ? ' on' : ''), onclick: (e) => { cc = k; ccBox.querySelectorAll('.fseg-btn').forEach((b) => b.classList.toggle('on', b === e.currentTarget)); } }, l)));
  // по умолчанию выкл. (пользователь 2026-10-28): приход оформляет кладовщик, а не тот, кто вносит счёт
  const toStock = h('input', { type: 'checkbox', checked: false });
  const stateBox = h('div', { class: 'fseg' }, ...STATE.map((s) => h('button', { type: 'button', class: 'fseg-btn' + (s.value === state ? ' on' : ''), onclick: (e) => { state = s.value; stateBox.querySelectorAll('.fseg-btn').forEach((b) => b.classList.toggle('on', b === e.currentTarget)); } }, s.label)));
  const lines = h('div', { class: 'inv-lines' });
  const totalEl = h('b', { class: 'num' });
  const rows = [];

  /**
   * Позиция счёта (TASKS В.3, замечание 2026-10-20): сначала «Категория», потом «Позиция» — только из этой категории.
   * Нет в списке — «+ Новая позиция»: форма в самой строке (наименование, артикул, ед., ссылка, фото) создаёт позицию
   * склада в выбранной категории и подставляет её в строку.
   */
  function addRow(focus = true, pre = null) {
    const cat = h('input', { maxlength: 100, placeholder: 'Выберите категорию' });
    const title = h('input', { placeholder: 'Сначала выберите категорию', maxlength: 500 });
    const q = h('input', { inputmode: 'decimal', value: '1', class: 'inv-q', 'aria-label': 'Количество' });
    const unit = h('input', { value: 'шт', maxlength: 30, class: 'inv-u', 'aria-label': 'Ед. изм.' });
    const sum = h('input', { inputmode: 'decimal', placeholder: 'сумма, ₽', class: 'inv-s', hidden: !session.canMoney, 'aria-label': 'Сумма' });
    const row = { title, q, unit, sum, cat, url: { value: '' }, photos: { ids: () => [] }, extra: {}, el: null };
    // форма новой позиции — в строке, нашим блоком
    const nCat = h('input', { maxlength: 100, placeholder: 'Выберите категорию' });
    const nName = h('input', { maxlength: 300, placeholder: 'Коротко, для списков: «Болт мебельный M8х40»' });
    const nFull = h('input', { maxlength: 500, placeholder: 'пусто — берётся короткое' });
    const nInv = h('input', { maxlength: 500, placeholder: 'Как в счёте поставщика' });
    const nArt = h('input', { maxlength: 100, placeholder: 'пусто — присвоится сам' });
    const nUnit = h('input', { value: 'шт', maxlength: 30 });
    const nUrl = h('input', { maxlength: 1000, placeholder: 'https://…' });
    const nPhotos = photoField([]);
    const nErr = h('div', { class: 'err', hidden: true });
    const nSave = h('button', { type: 'button', class: 'btn btn-primary btn-sm' }, 'Создать позицию');
    const nBox = h('div', { class: 'form-block inv-new', 'data-tone': 'info', hidden: true },
      h('div', { class: 'inv-new-head' }, h('b', null, 'Новая позиция в базе'), h('span', { class: 'muted small' }, ' — появится на складе в выбранной категории')),
      h('div', { class: 'form-grid' }, field('Категория *', h('div', { class: 'has-combo' }, nCat)), field('Короткое название *', nName, 'wide'), field('Длинное название', nFull, 'wide'), field('Название в счёте', nInv, 'wide'), field('Артикул', nArt), field('Ед. изм.', h('div', { class: 'has-combo' }, nUnit)), field('Ссылка на товар', nUrl, 'wide'),
        h('div', { class: 'field wide' }, h('span', null, 'Фото'), nPhotos.el)),
      nErr, h('div', { class: 'inv-new-foot' }, nSave, h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { nBox.hidden = true; } }, 'Отмена')));
    const addNew = h('button', { type: 'button', class: 'btn btn-sm', title: 'Нужной позиции нет в списке — создать её в базе', onclick: () => { nBox.hidden = !nBox.hidden; if (nBox.hidden) return; nCat.value = catSel || nCat.value; nName.value = nName.value || title.value.trim(); nInv.value = nInv.value || row.src?.name || title.value.trim(); (nCat.value ? nName : nCat).focus(); } }, 'Создать позицию');
    const syncAdd = () => { const t = title.value.trim(); addNew.textContent = t ? `Создать «${t.length > 30 ? t.slice(0, 30) + '…' : t}»` : 'Создать позицию'; addNew.hidden = !t || t === row.picked || items.some((x) => x.label.toLowerCase() === t.toLowerCase()); };
    title.addEventListener('input', () => setTimeout(syncAdd, 0)); title.addEventListener('change', () => setTimeout(syncAdd, 0)); syncAdd();
    const del = h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm', title: 'Убрать позицию', onclick: () => { rows.splice(rows.indexOf(row), 1); row.el.remove(); recalc(); } }, '×');
    const dupe = orderedNote(); // ЗП.3: позиция уже заказана — предупредить в строке
    row.el = h('div', { class: 'inv-row' },
      h('div', { class: 'inv-pick' }, field('Категория', h('div', { class: 'has-combo' }, cat)), field('Позиция', h('div', { class: 'has-combo' }, title))),
      h('div', { class: 'inv-main' }, field('Кол-во', q), field('Ед.', h('div', { class: 'has-combo' }, unit)), session.canMoney ? field('Сумма, ₽', sum) : h('span'), h('div', { class: 'inv-btns' }, addNew, del)),
      dupe.el, nBox);
    lines.append(row.el);
    let catSel = '';
    const setCat = (name) => {
      catSel = name;
      if (name) loadItems();
      title.placeholder = name ? `Позиция из «${name}» — начните печатать или выберите` : 'Сначала выберите категорию';
    };
    let titleCombo;
    attachCombo(cat, { options: () => (lk.categories || []).map((c) => ({ label: c.name })), onPick: (o) => { setCat(o.label); title.value = ''; row.extra = {}; titleCombo?.suppress(); title.focus(); } });
    cat.addEventListener('change', () => { const v = cat.value.trim(); const c = (lk.categories || []).find((x) => x.name.toLowerCase() === v.toLowerCase()); setCat(c ? c.name : ''); });
    titleCombo = attachCombo(title, {
      options: () => (catSel ? items.filter((x) => x.cat === catSel).map((x) => ({ label: x.label, sub: x.sub, x })) : []),
      empty: () => (catSel ? null : (needCat(cat), '← Сначала выберите категорию — тогда здесь будут её позиции')),
      onPick: (o) => { const v = o.x.values || {}; row.picked = o.label; if (v.unit) unit.value = v.unit; row.extra = { article: v.article }; if (!sup.value && v.supplierName) sup.value = v.supplierName; dupe.check(o.label); },
    });
    title.addEventListener('input', () => { if (title.value !== row.picked) row.extra = {}; });
    attachCombo(unit, { options: () => unitList(lk).map((u) => ({ label: u })) });
    attachCombo(nCat, { options: () => (lk.categories || []).map((c) => ({ label: c.name })) });
    attachCombo(nUnit, { options: () => [...new Set([...UNITS, ...(lk.units || [])])].map((u) => ({ label: u })) });
    nSave.addEventListener('click', async () => {
      const name = nName.value.trim();
      const newCat = nCat.value.trim();
      if (!newCat) { nErr.textContent = 'Выберите категорию'; nErr.hidden = false; nCat.focus(); return; }
      if (!name) { nErr.textContent = 'Впишите наименование'; nErr.hidden = false; nName.focus(); return; }
      nSave.disabled = true; nErr.hidden = true;
      try {
        let it = await api('/stock/items', { method: 'POST', body: { name, ...(nFull.value.trim() ? { fullName: nFull.value.trim() } : {}), ...(nInv.value.trim() ? { invoiceName: nInv.value.trim() } : {}), unit: nUnit.value.trim() || 'шт', categoryName: newCat, ...(nArt.value.trim() ? { article: nArt.value.trim() } : {}), ...(nUrl.value.trim() ? { notes: 'Ссылка: ' + nUrl.value.trim() } : {}) } });
        for (const photoId of nPhotos.ids()) it = await api(`/stock/items/${it.id}/photos`, { method: 'POST', body: { photoId } });
        // в списки и в строку
        cat.value = newCat; setCat(newCat);
        items.unshift({ label: it.name, cat: newCat, sub: 'новая', values: { title: it.name, unit: it.unit, categoryName: newCat, article: it.article } });
        title.value = it.name; row.picked = it.name; unit.value = it.unit || 'шт'; row.extra = { article: it.article };
        row.url = { value: nUrl.value.trim() };
        nBox.hidden = true;
        toast(`Позиция «${it.name}» добавлена в базу`);
        q.focus(); q.select();
      } catch (e) { nErr.textContent = errText(e); nErr.hidden = false; } finally { nSave.disabled = false; }
    });
    sum.addEventListener('input', recalc);
    sum.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addRow(); } });
    rows.push(row);
    if (pre) {
      if (pre.cat) { cat.value = pre.cat; setCat(pre.cat); }
      title.value = pre.title || ''; row.picked = pre.found ? pre.title : undefined;
      q.value = String(pre.qty ?? 1); if (pre.unit) unit.value = pre.unit;
      if (pre.sum) sum.value = String(pre.sum).replace('.', ',');
      row.extra = pre.article ? { article: pre.article } : {};
      row.srcArticle = pre.found ? '' : pre.article || ''; // артикул поставщика у новой позиции — не теряется при выборе категории
      row.src = pre.src || null; // строка поставщика (для «как называется у поставщика»)
      const badge = h('div', { class: 'inv-badge ' + (pre.found ? 'found' : 'new') });
      const useItem = (it, how) => {
        const cName = it.cat || it.values?.categoryName || '';
        if (cName) { cat.value = cName; setCat(cName); }
        title.value = it.label; row.picked = it.label; if (it.values?.unit) unit.value = it.values.unit;
        row.extra = { article: it.values?.article }; row.srcArticle = '';
        badge.className = 'inv-badge found'; badge.replaceChildren('✓ ' + how);
        dupe.check(it.label);
      };
      if (pre.found) { badge.append('✓ ' + (pre.how || 'нашлась в базе')); dupe.check(pre.title); }
      else {
        badge.append('новая позиция — выберите категорию; при приёме появится на складе', pre.article ? h('span', { class: 'muted' }, ' · арт. ' + pre.article) : null);
        if (pre.similar?.length) badge.append(h('div', { class: 'inv-similar' }, h('span', { class: 'muted' }, 'Похоже на: '),
          ...pre.similar.map((s) => h('button', { type: 'button', class: 'tag', title: 'Это та же позиция — взять её', onclick: () => useItem(s.item, 'выбрана похожая: ' + Math.round(s.score * 100) + '%') }, s.item.label.slice(0, 60), h('small', null, Math.round(s.score * 100) + '%')))));
      }
      row.el.prepend(badge);
      recalc();
    }
    if (focus) cat.focus();
  }
  function recalc() { totalEl.textContent = money(rows.reduce((s, r) => s + (parseNum(r.sum.value) || 0), 0)); }

  // ---------- Вставка из Excel / с сайта ----------
  const pasteArea = h('textarea', { rows: 6, class: 'paste-area', placeholder: 'Скопируйте строки из Excel или корзины сайта (артикул, наименование, количество, цена, сумма — лишние колонки не мешают) и вставьте сюда Ctrl+V' });
  const pasteInfo = h('div', { class: 'hint' });
  async function applyPaste() {
    const parsed = parsePasted(pasteArea.value);
    if (!parsed.length) { pasteInfo.textContent = 'Не нашёл строк с товарами. Скопируйте строки таблицы целиком (с количеством и суммой).'; return; }
    for (const rw of [...rows]) if (!rw.title.value.trim() && !rw.saved) { rows.splice(rows.indexOf(rw), 1); rw.el.remove(); }
    pasteInfo.textContent = 'Ищу в базе…';
    await loadItems();
    const res = await matchLines(parsed, items, { supplierName: sup.value.trim() });
    const HOW = { alias: 'нашлась: так называется у этого поставщика', article: 'нашлась по артикулу', name: 'нашлась по названию', similar: 'нашлась (очень похожа)' };
    let found = 0;
    for (const m of res) {
      const p = m.line; const it = m.item;
      if (it) found++;
      addRow(false, it
        ? { found: true, how: HOW[m.by] + (m.by === 'similar' ? ' ' + Math.round(m.score * 100) + '%' : ''), cat: it.cat || it.values?.categoryName || '', title: it.label, unit: it.values?.unit, article: it.values?.article || p.article, qty: p.qty, sum: p.sum, src: p }
        : { found: false, title: p.name, article: p.article, qty: p.qty, sum: p.sum, similar: m.similar, src: p });
    }
    pasteInfo.textContent = 'Разобрано строк: ' + parsed.length + '. Нашлись в базе: ' + found + ', новых: ' + (parsed.length - found) + '. Проверьте ниже, выберите поставщика и нажмите «Внести».';
    pasteArea.value = '';
  }
  const pasteBox = opts.paste ? h('div', { class: 'form-block paste-box', 'data-tone': 'info' },
    h('div', { class: 'section-title' }, 'Вставьте строки таблицы'), pasteArea,
    h('div', { class: 'inv-foot' }, h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: applyPaste }, 'Разобрать и найти в базе'), h('label', { class: 'btn btn-sm file-btn', title: 'Файл Excel (.xlsx) или CSV — первый лист' }, 'Загрузить файл…', h('input', { type: 'file', accept: '.xlsx,.csv,.txt', hidden: true, onchange: async (e) => { const fl = e.target.files[0]; e.target.value = ''; if (!fl) return; try { pasteArea.value = await readTableFile(fl); applyPaste(); } catch (err) { toastError(err); } } })),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', title: 'Пустая таблица с нужными колонками — заполнить в Excel и загрузить', onclick: () => downloadTemplate() }, 'Скачать шаблон'), h('span', { class: 'spacer' })), pasteInfo) : null;

  const body = h('div', { class: 'inv' },
    h('p', { class: 'hint' }, opts.paste
      ? 'Заявки сразу на много позиций — из таблицы поставщика или корзины сайта. Найденное в базе подставится, остальное станет новыми позициями.'
      : 'Счёт, которого не было в заявках (уже оплатили / уже привезли). На каждую позицию будет заявка с этим счётом — расходы и склад посчитаются как обычно.'),
    pasteBox,
    h('div', { class: 'form-grid inv-head' }, field(opts.paste ? '№ счёта (если уже есть)' : '№ счёта *', no), field('Дата счёта', date), field('Поставщик', h('div', { class: 'has-combo' }, sup)), field('Наша компания', company), field('Тип счёта', h('div', { class: 'has-combo' }, type)), h('div', { class: 'field wide' }, h('span', null, 'Что уже произошло'), stateBox), h('div', { class: 'field wide' }, h('span', null, 'Куда пошло (для «Денег»)'), ccBox), h('label', { class: 'check wide' }, toStock, ' При «Получено» — сразу поставить на склад (обычно приход оформляет кладовщик)')),
    h('div', { class: 'section-title' }, 'Позиции счёта'),
    lines,
    h('div', { class: 'inv-foot' }, h('button', { type: 'button', class: 'btn btn-sm', onclick: () => addRow() }, '+ Строка счёта'), h('span', { class: 'spacer' }), session.canMoney ? h('span', null, 'Итого: ', totalEl) : null));
  attachCombo(sup, { options: () => (lk.suppliers || []).map((s) => ({ label: s })), extra: (t) => partnerAction('supplier', t, lk.suppliers, (n) => { (lk.suppliers ||= []).push(n); sup.value = n; }) });
  attachCombo(type, { options: () => (lk.invoiceTypes || []).map((s) => ({ label: s })) });
  if (!opts.paste) addRow(false);
  recalc();

  const start = () => JSON.stringify([no.value, date.value, sup.value, company.value, type.value, state, rows.map((r) => [r.cat.value, r.title.value, r.q.value, r.unit.value, r.sum.value])]);
  const initialSnap = start();
  async function save() {
    const invoiceNo = no.value.trim();
    if (!invoiceNo && state !== 'ordered') throw new Error('впишите № счёта (для «Оплачено» / «Получено» он нужен)');
    const list = rows.filter((r) => r.title.value.trim());
    if (!list.length) throw new Error('добавьте хотя бы одну позицию');
    for (const r of list) if (!r.cat.value.trim()) throw new Error(`выберите категорию для «${r.title.value.trim()}»`);
    for (const r of list) if (!(parseNum(r.q.value) > 0)) throw new Error(`укажите количество для «${r.title.value.trim()}»`);
    const st = STATE.find((s) => s.value === state);
    for (const r of list) {
      r.uid ??= uid();
      const body2 = {
        title: r.title.value.trim(), qty: parseNum(r.q.value), unit: r.unit.value.trim() || 'шт', categoryName: r.cat.value.trim(),
        supplierName: sup.value.trim(), companyName: company.value, invoiceType: type.value.trim(), invoiceNo, invoiceDate: date.value || '',
        productUrl: r.url.value.trim(), photoIds: r.photos.ids(), statusLabel: st.status, priorityLabel: 'Обычный', requestDate: date.value || isoDay(),
        clientUid: r.uid, costCenter: cc, ...((r.extra.article || r.srcArticle) ? { article: r.extra.article || r.srcArticle } : {}),
      };
      if (session.canMoney && parseNum(r.sum.value) > 0) body2.priceHint = parseNum(r.sum.value);
      if (!r.saved) {
        r.saved = await api('/supply/requests', { method: 'POST', body: body2 }); // повтор после ошибки не задваивает
        // внесённую строку больше не править (при сбое на следующей — видно, что эта уже в базе)
        for (const el of [r.title, r.q, r.unit, r.sum, r.cat]) el.disabled = true;
        r.el.classList.add('inv-done'); r.el.querySelectorAll('button').forEach((b) => { b.disabled = true; });
      }
      if (state === 'received' && !r.received) { await api(`/supply/requests/${r.saved.id}/receive`, { method: 'POST', body: { qty: parseNum(r.q.value), clientUid: 'inv-' + r.uid, toStock: toStock.checked, costCenter: cc } }); r.received = true; }
    }
    rememberPairs(sup.value.trim(), list.filter((x) => x.src).map((x) => ({ extName: x.src.name, extArticle: x.src.article, title: x.title.value.trim(), unit: x.unit.value.trim(), categoryName: x.cat.value.trim(), article: x.extra.article || x.srcArticle || undefined })));
    toast(`${invoiceNo ? 'Счёт ' + invoiceNo : 'Заявки'} внесены: ${list.length} ${list.length === 1 ? 'позиция' : 'позиций'}${state === 'received' ? ', товар на складе' : ''}`);
    return { id: null, invoiceNo, count: list.length };
  }
  return { el: body, read: () => ({ values: { save } }), dirty: () => start() !== initialSnap, focus: () => (opts.paste ? pasteArea : no).focus() };
}

/** Раздел-«форма» для правой панели: открывается как новая запись (#requests?of=invoice&new=1), после «Внести» панель закрывается. */
/** «+ Из таблицы» — та же форма в режиме вставки (#requests?of=pasteorder&new=1). */
export const pasteOrder = {
  id: 'pasteorder',
  title: 'Заявки из таблицы',
  newTitle: 'Заявки из таблицы',
  card: { heading: () => 'Заявки из таблицы' },
  get: async () => ({}),
  form: { build: () => buildInvoiceForm({ paste: true }), toBody: (v) => v, create: (v) => v.save(), saveLabel: 'Внести', closeAfterCreate: true },
};

export const invoice = {
  id: 'invoice',
  title: 'Счёт',
  newTitle: 'Внести счёт',
  card: { heading: () => 'Счёт' },
  get: async () => ({}),
  form: {
    build: () => buildInvoiceForm(),
    toBody: (v) => v,
    create: (v) => v.save(),
    saveLabel: 'Внести',
    closeAfterCreate: true,
  },
};
