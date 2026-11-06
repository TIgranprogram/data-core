import { api, apiBlob, PREFIX, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { date, money, qty } from '../core/format.js';
import { go, patch } from '../core/router.js';
import { modal } from '../ui/kit/dialog.js';
import { button, fileButton, select, enhanceSelect, section, stack, openPdfPreview, buildForm, segmented } from '../ui/kit/index.js';
import { toast, toastError } from '../ui/kit/toast.js';
import { openSide } from '../ui/kit/side-form.js';
import { STAGE } from './salesorders.js';
import { badge, SUPPLY_STATUS, supplyKey } from '../ui/kit/badges.js';
import { contractsBlock } from './contracts.js';

/**
 * «Контрагенты» (TASKS фаза 4): поставщики (из заявок), заказчики (из заказов), наши компании.
 * Карточка — всё связанное; «Изменить» — реквизиты; «Объединить с…» — убрать дубль написания.
 * Сервер — /api/partners (данные не переносятся: поставщики = organizations, заказчики = текст в заказах).
 */
const KIND = { supplier: 'Поставщик', customer: 'Заказчик', our: 'Наша компания' };
const enc = (id) => encodeURIComponent(id);

async function mergeDialog(r, ctx) {
  const type = r.kind === 'customer' ? 'customer' : 'supplier';
  const all = (await api('/partners', { query: { type } })).items.filter((x) => x.id !== r.id);
  const sel = enhanceSelect(select({ options: [['', '— выберите —'], ...all.map((x) => [x.id, x.name])], label: 'Оставить' }));
  const done = await modal({
    title: 'Объединить «' + r.name + '»',
    okText: 'Объединить',
    body: h('div', null,
      h('p', { class: 'hint' }, r.kind === 'customer'
        ? 'Это то же самое, что другой заказчик (другое написание)? Все его заказы и позиции перейдут к выбранному, это название исчезнет.'
        : 'Это тот же поставщик, что другой (дубль)? Все его заявки перейдут к выбранному, дубль уйдёт в корзину; почта, телефон и ИНН дополнят выбранного.'),
      h('label', { class: 'field' }, h('span', null, 'Оставить'), sel)),
    onOk: async () => {
      if (!sel.value) throw new Error('Выберите, с кем объединить');
      return api(`/partners/${enc(r.id)}/merge`, { method: 'POST', body: { intoId: sel.value } });
    },
  });
  if (done) { toast(`Объединено: перенесено записей — ${done.moved}`); ctx.close(); window.dispatchEvent(new CustomEvent('data-changed')); go('partners', { type: type === 'customer' ? 'customer' : undefined, open: done.id }); }
}

/**
 * Печать и подпись нашей компании (ПС.6): в PDF паспорта «с печатью» — на гарантийном талоне.
 * Файл (PNG с прозрачным фоном — лучше) — выбрать, перетащить или вставить Ctrl+V; повторная загрузка заменяет.
 * Сервер: PUT /organizations/:id/assets/seal|signature (печать меняет только администратор).
 */
/**
 * Загруженная печать/подпись/логотип: сначала плашка «загружена ✓», картинка — по «Показать» (замечание 2026-10-22:
 * «чтобы тяжёлое не грузилось каждый раз, когда не нужно»).
 */
function lazyPreview(cur, label, del) {
  const box = h('div', { class: 'stamp-pic' });
  const show = () => box.replaceChildren(h('div', { class: 'stamp-prev', title: 'Так выглядит на талоне; клетка — прозрачные места' },
    h('img', { src: PREFIX + cur.url, alt: label, onerror: (e) => e.target.replaceWith(h('span', { class: 'muted' }, 'файл не найден — загрузите заново')) }), h('span', null, 'Продавец: ________')), del);
  box.append(h('span', { class: 'badge ok' }, `${label}: загружена ✓`), button({ label: 'Показать', kind: 'ghost', size: 'S', onClick: show }), del);
  return box;
}

function stampBlock(r, ctx) {
  const slot = (role, label, tip) => {
    const cur = (r.assets || []).find((a) => a.role === role);
    // «Убрать белый фон»: для печати и подписи включено, для логотипа — нет (сервер делает светлое прозрачным)
    const clear = h('input', { type: 'checkbox', checked: role !== 'logo' });
    const upload = async (file) => {
      if (!file || !/^image\//.test(file.type)) { toastError(new Error('Нужна картинка: PNG или JPG')); return; }
      const fd = new FormData(); fd.append('file', file, file.name || `${role}.png`);
      try { await api(`/organizations/${r.id}/assets/${role}${clear.checked ? '?clearWhite=1' : ''}`, { method: 'PUT', body: fd }); toast(`${label}: загружено`); ctx.reload(); } catch (e) { toastError(e); }
    };
    const zone = h('div', { class: 'photo-drop', tabindex: '0', title: 'Перетащите файл, вставьте Ctrl+V или нажмите' },
      h('span', null, cur ? 'Заменить: перетащите, Ctrl+V или ' : 'Перетащите, вставьте Ctrl+V или '), fileButton({ label: 'выберите файл', accept: 'image/*', onFile: upload }));
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('over'));
    zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('over'); upload(e.dataTransfer?.files?.[0]); });
    zone.addEventListener('paste', (e) => { const f = [...(e.clipboardData?.items || [])].find((i) => i.kind === 'file')?.getAsFile(); if (f) { e.preventDefault(); upload(f); } });
    const del = cur ? button({ label: 'Убрать', kind: 'ghost', size: 'S', onClick: async () => { try { await api(`/organizations/${r.id}/assets/${role}`, { method: 'DELETE' }); toast(`${label}: убрано`); ctx.reload(); } catch (e) { toastError(e); } } }) : null;
    return h('div', { class: 'pp-kind' },
      h('div', { class: 'pp-kind-head' }, h('b', null, label), h('span', { class: 'muted' }, ' · ' + tip)),
      cur ? lazyPreview(cur, label, del) : h('div', { class: 'muted' }, 'Не загружено — в PDF «с печатью» этого не будет'),
      session.canEdit ? h('label', { class: 'check' }, clear, 'Убрать белый фон при загрузке') : null,
      session.canEdit ? zone : null);
  };
  return section({ tone: 'neutral', title: 'Печать, подпись и логотип (для паспортов)', count: (r.assets || []).length, body: [
    h('p', { class: 'muted small' }, 'Лучше PNG с прозрачным фоном (скан без белого фона). В PDF паспорта «с печатью» ставятся на гарантийный талон.'),
    slot('seal', 'Печать', 'круглая печать организации'), slot('signature', 'Подпись', 'подпись директора'), slot('logo', 'Логотип', 'логотип организации')] });
}

/**
 * Бланк КП (К11): фон А4 по умолчанию у этой нашей фирмы.
 * В КП без выбора бланка подставляется отсюда (стр. 1 и стр. 2+).
 */
/** Зона текста и стандартные тексты бланка (KP-2): проценты высоты страницы; PATCH /offers/backgrounds/:id. */
function zoneForm(cur, withTerms, ctx) {
  const pc = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? '' : String(Math.round(Number(v) * 1000) / 10));
  const f = buildForm([
    { key: 'textTop', label: 'Верх текста, %', type: 'number', min: 0, hint: 'Шапка бланка выше этой линии (0–60). Пусто — не менять' },
    { key: 'textBottom', label: 'Низ текста, %', type: 'number', min: 0, hint: 'Подвал бланка ниже этой линии (40–95). Пусто — не менять' },
    withTerms ? { key: 'defaultTerms', label: 'Стандартные тексты', type: 'textarea', wide: true, max: 3000, hint: 'Подставляются в «Условия» нового КП этой фирмы. В самом КП их можно править — шаблон не изменится.' } : null,
  ].filter(Boolean), { textTop: pc(cur.textTop), textBottom: pc(cur.textBottom), defaultTerms: cur.defaultTerms || '' });
  const save = async () => {
    const res = f.read();
    if (res.errors) return;
    const { textTop, textBottom, defaultTerms } = res.values;
    if (textTop !== null && textTop > 60) { toastError(new Error('Верх текста — от 0 до 60 %')); return; }
    if (textBottom !== null && (textBottom < 40 || textBottom > 95)) { toastError(new Error('Низ текста — от 40 до 95 %')); return; }
    const body = {};
    if (textTop !== null) body.textTop = textTop / 100;
    if (textBottom !== null) body.textBottom = textBottom / 100;
    if (withTerms) body.defaultTerms = defaultTerms || '';
    try { await api(`/offers/backgrounds/${cur.id}`, { method: 'PATCH', body }); toast('Бланк: настройки сохранены'); ctx.reload(); } catch (e) { toastError(e); }
  };
  return { read: () => f.read().values?.defaultTerms || '', el: h('div', null, f.el, button({ label: 'Сохранить', size: 'S', onClick: save })) };
}

function kpBgBlock(r, ctx) {
  const root = h('div');
  let termsOf = null;
  const paint = async () => {
    const wasOpen = root.querySelector('details.k-sec')?.open || false;
    let items = [];
    try {
      const resp = await api('/offers/backgrounds');
      items = (Array.isArray(resp) ? resp : resp?.items || []).filter((b) => !b.builtin && String(b.companyId || '') === String(r.id));
    } catch (e) { toastError(e); }
    const slot = (page, title, tip) => {
      const cur = items.find((b) => Number(b.page) === page && b.isDefault) || items.find((b) => Number(b.page) === page);
      const upload = async (file) => {
        if (!file || !/^image\/(png|jpeg)$/.test(file.type)) { toastError(new Error('Нужен PNG или JPG до 5 МБ, пропорции А4')); return; }
        const fd = new FormData();
        fd.append('file', file, file.name || `kp-p${page}.jpg`);
        fd.append('name', `${r.name || 'КП'} · стр. ${page}`);
        fd.append('page', String(page));
        fd.append('companyId', r.id);
        fd.append('isDefault', 'true');
        try {
          const saved = await api('/offers/backgrounds', { method: 'POST', body: fd });
          toast(saved?.warning ? `Бланк загружен. ${saved.warning}` : 'Бланк КП загружен — будет в PDF по умолчанию');
          ctx.reload();
        } catch (e) { toastError(e); }
      };
      const zone = h('div', { class: 'photo-drop', tabindex: '0', title: 'PNG/JPG до 5 МБ, размер страницы А4' },
        h('span', null, cur ? 'Заменить бланк: перетащите, Ctrl+V или ' : 'Перетащите бланк А4, вставьте Ctrl+V или '),
        fileButton({ label: 'выберите файл', accept: 'image/png,image/jpeg', onFile: upload }));
      zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
      zone.addEventListener('dragleave', () => zone.classList.remove('over'));
      zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('over'); upload(e.dataTransfer?.files?.[0]); });
      zone.addEventListener('paste', (e) => { const f = [...(e.clipboardData?.items || [])].find((i) => i.kind === 'file')?.getAsFile(); if (f) { e.preventDefault(); upload(f); } });
      const del = cur && session.canEdit
        ? button({ label: 'Убрать', kind: 'ghost', size: 'S', onClick: async () => {
          try { await api(`/offers/backgrounds/${cur.id}`, { method: 'DELETE' }); toast('Бланк убран'); ctx.reload(); } catch (e) { toastError(e); }
        } }, 'Убрать')
        : null;
      const prev = cur?.url
        ? h('div', { class: 'stamp-pic' },
          h('div', { class: 'stamp-prev', title: 'Фон PDF КП (А4)' }, h('img', { src: PREFIX + cur.url, alt: title, onerror: (e) => e.target.replaceWith(h('span', { class: 'muted' }, 'файл не найден')) })),
          del)
        : h('div', { class: 'muted' }, 'Не загружено — в КП подставится общий или встроенный бланк');
      const zf = cur && session.canEdit ? zoneForm(cur, page === 1, ctx) : null;
      if (zf && page === 1) termsOf = zf.read;
      return h('div', { class: 'pp-kind' },
        h('div', { class: 'pp-kind-head' }, h('b', null, title), h('span', { class: 'muted' }, ' · ' + tip)),
        prev, session.canEdit ? zone : null, zf?.el);
    };
    // «Только для КП» — фирма есть в КП, но не в «Деньгах»
    let onlyKp = null;
    try {
      const cs = await api('/offers/companies');
      const me = (Array.isArray(cs) ? cs : cs?.items || []).find((c) => String(c.id) === String(r.id));
      const seg = segmented({ label: 'Где видна фирма', value: me?.offersOnly ? 'kp' : 'all', items: [{ key: 'all', label: 'В «Деньгах» и в КП' }, { key: 'kp', label: 'Только для КП' }],
        onChange: async (k) => {
          if (!session.canEdit) { seg.set(me?.offersOnly ? 'kp' : 'all'); return; }
          try { await api(`/offers/companies/${r.id}`, { method: 'PATCH', body: { offersOnly: k === 'kp' } }); if (me) me.offersOnly = k === 'kp'; toast(k === 'kp' ? 'Фирма только для КП: в «Деньгах» её не будет' : 'Фирма снова в «Деньгах»'); }
          catch (e) { seg.set(me?.offersOnly ? 'kp' : 'all'); toastError(e); }
        } });
      onlyKp = h('div', { class: 'pp-kind' }, h('div', { class: 'pp-kind-head' }, h('b', null, 'Где видна фирма')), seg.el);
    } catch { /* старый сервер — галочки нет */ }
    const check = button({ label: 'Проверить бланк', size: 'S', title: 'Показать пробное КП на бланке этой фирмы', onClick: () => {
      const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
      const body = { companyId: r.id, customer: 'Пробный заказчик', objectName: 'Пробный объект', date: day(0), validUntil: day(10), delivery: 'included',
        items: [{ productName: 'Пробное изделие', quantity: 1, unit: 'шт', unitPrice: 100000 }], ...(termsOf?.() ? { terms: termsOf() } : {}) };
      openPdfPreview({ title: `Проверка бланка · ${r.name || ''}`.trim(), load: () => apiBlob('/offers/preview', { method: 'POST', body, fallback: 'КП-проба.pdf' }) });
    } });
    root.replaceChildren(section({ tone: 'neutral', title: 'Бланк КП (фон А4)', count: items.length, open: wasOpen, body: [
      onlyKp,
      h('p', { class: 'muted small' }, 'PNG или JPG до 5 МБ, пропорции листа А4. Этот фон подставляется в PDF КП этой фирмы по умолчанию (можно сменить в карточке КП).'),
      slot(1, 'Страница 1', 'первая страница КП'),
      slot(2, 'Страницы 2+', 'вторая и следующие'),
      items.length ? check : null,
    ] }));
  };
  paint();
  return root;
}

function related(r, ctx) {
  const items = r.related || [];
  if (r.kind === 'our') return stack(stampBlock(r, ctx), kpBgBlock(r, ctx), relatedRest(r, items));
  if (r.kind === 'supplier') return stack(contractsBlock(r), relatedRest(r, items));
  return stack(relatedRest(r, items));
}

function relatedRest(r, items) {
  if (r.kind === 'customer') {
    // Заказчик целиком: в работе / закрытые, у каждого заказа — этап, позиции, сумма и оплата; клик — сам заказ
    if (!items.length) return section({ tone: 'money', title: 'Заказы', count: 0, body: h('p', { class: 'muted small' }, 'Заказов нет') });
    const open = items.filter((o) => !['shipped', 'closed', 'cancelled'].includes(o.stage));
    const done = items.filter((o) => ['shipped', 'closed', 'cancelled'].includes(o.stage));
    const row = (o) => h('li', null,
      h('a', { href: '#salesorders?open=' + o.id }, `№ ${o.orderNo || '—'}`),
      badge(STAGE, o.stage),
      h('span', { class: 'muted clip' }, [o.title, o.lineCount ? `${qty(o.lineCount)} поз.` : '', o.shipDate ? 'отгрузка ' + date(o.shipDate) : ''].filter(Boolean).join(' · ')),
      session.canMoney && o.amount ? h('span', { class: 'num' }, money(o.amount) + (o.paidAmount >= o.amount ? ' · оплачен' : o.paidAmount ? ` · оплачено ${money(o.paidAmount)}` : ' · не оплачен')) : null);
    const group = (title, list, open = false) => (list.length ? [section({ title, count: list.length, open, body: h('ul', { class: 'timeline' }, ...list.map(row)) })] : []);
    const unpaid = session.canMoney ? items.reduce((s, o) => s + Math.max(0, (o.amount || 0) - (o.paidAmount || 0)), 0) : 0;
    // закрытые прошлых лет — свёрнуты (TASKS ЗК.3)
    const year = String(new Date().getFullYear());
    const yearOf = (o) => String(o.shipDate || '').slice(0, 4);
    const doneNow = done.filter((o) => !yearOf(o) || yearOf(o) >= year), donePast = done.filter((o) => yearOf(o) && yearOf(o) < year);
    // склад по его заказам (TASKS Б.3 / ЗК.3): брони и что выдано, кому
    const res = r.reservations || [], iss = r.issues || [];
    return stack(
      unpaid > 0 ? h('p', { class: 'hint' }, 'Ещё не оплачено по заказам: ', h('b', { class: 'num' }, money(unpaid))) : null,
      ...group('В работе', open, true), ...group('Отгружены и закрыты', doneNow), ...group('Заказы прошлых лет', donePast),
      res.length ? section({ tone: 'gold', title: 'Брони на складе', count: res.length, body:
        h('ul', { class: 'timeline' }, ...res.map((g) => h('li', null, h('a', { href: '#ops?mode=reserve' }, g.name), h('span', { class: 'muted' },
          [g.orderNo && `заказ №${g.orderNo}`, `${g.lines} поз.`, g.left ? 'в брони ' + qty(g.left) : 'всё выдано', g.issued ? 'выдано ' + qty(g.issued) : ''].filter(Boolean).join(' · '))))) }) : null,
      iss.length ? section({ tone: 'gold', title: 'Выдано со склада по его заказам', count: iss.length, body:
        h('ul', { class: 'timeline' }, ...iss.map((m) => h('li', null, h('span', { class: 'when' }, date(m.date)), h('a', { href: '#movements?open=' + m.id }, m.name), h('span', { class: 'num' }, `${qty(m.qty)} ${m.unit}`),
          h('span', { class: 'muted' }, [m.orderNo && `заказ №${m.orderNo}`, m.to ? 'кому: ' + m.to : ''].filter(Boolean).join(' · '))))) }) : null);
  }
  return section({ tone: 'who', title: r.kind === 'our' ? 'Заявки на эту компанию' : 'Заявки этому поставщику', count: items.length, open: true,
    body: items.length ? requestsByMonth(items) : h('p', { class: 'muted small' }, 'Заявок нет') });
}

const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
/**
 * Заявки контрагента по месяцам (замечание 2026-10-22: «заявок много — компактно»): строка месяца — число и сумма,
 * клик раскрывает; открыт последний месяц, остальные свёрнуты (как месяцы в списках).
 */
function requestsByMonth(items) {
  const groups = new Map();
  for (const x of items) {
    const d = x.requestDate ? new Date(x.requestDate) : null;
    const k = d && !Number.isNaN(d.getTime()) ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : 'none';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(x);
  }
  const keys = [...groups.keys()].sort().reverse().sort((a, b) => (a === 'none') - (b === 'none')); // «Без даты» — в конце
  const label = (k) => { if (k === 'none') return 'Без даты'; const [y, m] = k.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };
  const row = (x) => h('li', null,
    h('span', { class: 'when' }, date(x.requestDate)),
    h('a', { href: '#requests?open=' + x.id }, `№${x.num ?? ''} ${x.title}`),
    h('span', { class: 'muted' }, `${qty(x.qty)} ${x.unit || ''}`),
    badge(SUPPLY_STATUS, supplyKey(x)),
    session.canMoney && x.priceHint ? h('span', { class: 'num' }, money(x.priceHint)) : null);
  return h('div', { class: 'month-groups' }, ...keys.map((k, i) => {
    const list = groups.get(k);
    const sum = list.reduce((s, x) => s + (Number(x.priceHint) || 0), 0);
    return h('details', { class: 'month-group', open: i === 0 },
      h('summary', null, h('b', null, label(k)), h('span', { class: 'p-n' }, qty(list.length)),
        session.canMoney && sum ? h('span', { class: 'p-tot num' }, money(sum)) : null),
      h('ul', { class: 'timeline' }, ...list.map(row)));
  }));
}

export const partners = {
  id: 'partners',
  title: 'Контрагенты',
  entityType: 'Partner',
  historyLabels: { 'partner.updated': 'Изменён', 'partner.merged': 'Объединён' },
  get: (id) => api(`/partners/${enc(id)}`),

  list: {
    path: '/partners',
    export: 'admin',
    sortDefault: '',
    createLabel: 'Новый контрагент',
    searchPlaceholder: 'Поиск: название, ИНН, почта, телефон…',
    emptyText: 'Контрагентов пока нет.', emptyHint: 'Они появятся из заявок и заказов. Добавить вручную: «+ Контрагент» — наименование и роль (заказчик / поставщик).',
    filters: [
      { key: 'type', label: 'Кто', type: 'chips', noAll: true, defaultValue: 'supplier',
        options: () => [{ value: 'supplier', label: 'Поставщики' }, { value: 'customer', label: 'Заказчики' }, { value: 'our', label: 'Наши компании' }],
        count: (resp, v) => resp.counts?.[v] },
    ],
    hintKey: 'type',
    hints: {
      '': 'Поставщики — из заявок. Клик — все заявки поставщику; «Изменить» — ИНН, почта, телефон; дубль написания — «Объединить с…» в карточке.',
      supplier: 'Поставщики — из заявок. Клик — все заявки поставщику; «Изменить» — ИНН, почта, телефон; дубль написания — «Объединить с…» в карточке.',
      customer: 'Заказчики — из заказов. Одно и то же написано по-разному? Откройте и «Объединить с…» — заказы соберутся под одним названием.',
      our: 'Наши компании: на них оформляются заявки и заказы, по ним делится платёжный календарь.',
    },
    columns: [
      { key: 'name', label: 'Название', cls: 'clip', render: (r) => h('b', { title: r.name }, r.name) },
      { key: 'inn', label: 'ИНН', cls: 'md-hide', render: (r) => r.inn || h('span', { class: 'muted' }, '—') },
      { key: 'n', label: 'Записей', cls: 'num right', render: (r) => (r.kind === 'customer' ? `${qty(r.orders)} заказ.` + (r.activeOrders ? ` · в работе ${r.activeOrders}` : '') : `${qty(r.requests)} заяв.`) },
      { key: 'sum', label: 'Сумма', money: true, cls: 'num right md-hide', render: (r) => (r.sum ? money(r.sum) : '') },
      { key: 'lastDate', label: 'Последняя', cls: 'md-hide', render: (r) => (r.lastDate ? date(r.lastDate) : '') },
      { key: 'contacts', label: 'Контакты', cls: 'clip md-hide muted', render: (r) => [r.phone, r.email].filter(Boolean).join(' · ') },
    ],
    card: {
      title: (r) => r.name,
      sub: (r) => [KIND[r.kind], r.inn ? 'ИНН ' + r.inn : '', r.kind === 'customer' ? `${r.orders} заказ.` : `${r.requests} заяв.`].filter(Boolean).join(' · '),
      side: () => [],
    },
  },

  card: {
    heading: (r) => r.name,
    subheading: (r) => [KIND[r.kind], r.inn ? 'ИНН ' + r.inn : ''].filter(Boolean).join(' · '),
    stats: (r) => [
      r.kind === 'customer' ? ['Заказов', qty(r.orders)] : ['Заявок', qty(r.requests)],
      ...(r.kind === 'customer' ? [['В работе', qty(r.activeOrders)]] : []),
      ...(session.canMoney ? [['Сумма', r.sum ? money(r.sum) : '—']] : []),
      ['Последняя', r.lastDate ? date(r.lastDate) : '—'],
    ],
    // «Изменить» — заметно сверху карточки (СП.1), не только внизу
    editTop: true,
    view: (r) => [['Полное наименование', r.fullName], ['ИНН', r.inn], ['КПП', r.kpp], ['Адрес', r.legalAddress], ['Телефон', r.phone], ['Почта', r.email], ['Сайт', r.website],
      ['Банк', [r.bankName, r.bankBik && 'БИК ' + r.bankBik].filter(Boolean).join(' · ')], ['Расчётный счёт', r.bankAccount], ['Корр. счёт', r.bankCorrAccount],
      ['Контакт', [r.contactName, r.contactPhone].filter(Boolean).join(' · ')], ['Примечание', r.notes]],
    actions: (r) => [
      r.kind !== 'our' && { label: 'Объединить с…', more: true, run: (row, ctx) => mergeDialog(row, ctx) },
      r.kind === 'supplier' && { label: 'Новая заявка этому поставщику', run: () => patch({ of: 'requests', new: '1', open: undefined }) },
      r.kind === 'supplier' && session.canEdit && { label: 'Загрузить прайс из Excel', run: () => openSide('pricelist', 'order:' + r.id) },
    ],
    extra: related,
  },

  form: {
    // СП.1: все реквизиты блоками; новый — сначала «кто это» (по вкладке списка)
    fields: async (r) => [
      { section: 'Контрагент', tone: 'main', fixed: true },
      ...(r ? [] : [{ key: 'kind', label: 'Тип контрагента', type: 'segment', required: true, wide: true,
        options: [{ value: 'supplier', label: 'Поставщик' }, { value: 'customer', label: 'Заказчик' }, { value: 'our', label: 'Наша компания' }] }]),
      { key: 'name', label: r?.kind === 'customer' ? 'Название (во всех заказах)' : 'Название', required: true, wide: true, max: 300,
        hint: r?.kind === 'customer' ? 'Поменяется во всех заказах и позициях этого заказчика' : undefined },
      ...(r?.kind === 'customer' ? [] : [{ key: 'fullName', label: 'Полное наименование (в документах)', wide: true, max: 500, hint: 'Как в уставе: Общество с ограниченной ответственностью «…». Пусто — в документах будет «Название»' }]),
      { key: 'inn', label: 'ИНН', max: 12, hint: '10 цифр — организация, 12 — ИП. Желательно заполнить: нужен для счетов и паспортов' },
      { key: 'kpp', label: 'КПП', max: 9 },
      { key: 'legalAddress', label: 'Адрес', wide: true, max: 500 },
      { section: 'Связь', tone: 'who' },
      { key: 'phone', label: 'Телефон', max: 50 },
      { key: 'email', label: 'Почта', max: 200 },
      { key: 'website', label: 'Сайт', max: 300 },
      { key: 'contactName', label: 'Контактное лицо', max: 200 },
      { key: 'contactPhone', label: 'Телефон контакта', max: 50 },
      { section: 'Банк и примечание', tone: 'money', collapsed: true },
      { key: 'bankName', label: 'Банк', wide: true, max: 300 },
      { key: 'bankBik', label: 'БИК', max: 9 },
      { key: 'bankAccount', label: 'Расчётный счёт', max: 20 },
      { key: 'bankCorrAccount', label: 'Корр. счёт', max: 20 },
      { key: 'notes', label: 'Примечание', type: 'textarea', wide: true },
      ...(r?.kind === 'our' || !r ? [{ section: 'Для паспортов (наша компания)', tone: 'info', collapsed: !!r && !!(r.directorName || r.trademark) },
        { key: 'directorName', label: 'Директор (Фамилия И. О. — в подписи талона)', max: 200 },
        { key: 'trademark', label: 'Торговая марка (на титуле паспорта)', max: 100 }] : []),
    ],
    initial: () => ({ kind: new URLSearchParams(location.hash.split('?')[1] || '').get('type') || 'supplier' }),
    toInitial: (r) => ({ ...r, inn: r.inn || '' }),
    toBody: (v) => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x === null ? '' : String(x)])),
    create: (body) => api('/partners', { method: 'POST', body }),
    update: (id, body) => api(`/partners/${enc(id)}`, { method: 'PATCH', body }),
  },

  // в корзину — только незанятого; занятый сервер не даст (409 с причиной), дубль — «Объединить с…»
  remove: { password: true,
    text: (r) => `Удалить контрагента «${r.name}»?`,
    blocked: (r) => (r.kind === 'customer' && r.orders ? `У заказчика ${r.orders} заказ(ов) — удалить нельзя. Если это дубль написания — «Объединить с…».`
      : r.kind !== 'customer' && r.requests ? `На контрагента ${r.requests} заявок — удалить нельзя. Если это дубль — «Объединить с…».` : null),
    run: (r) => api(`/partners/${enc(r.id)}`, { method: 'DELETE' }).then((x) => { r.orgId = x.orgId; return x; }),
    restore: (r) => api(`/partners/${enc(r.orgId || r.id)}/restore`, { method: 'POST' }),
  },

  newTitle: 'Новый контрагент',
  searchRow: (r) => ({ title: r.name, sub: [KIND[r.kind], r.inn ? 'ИНН ' + r.inn : ''].filter(Boolean).join(' · '), side: '' }),
  open: (id) => go('partners', { open: id }),
};
