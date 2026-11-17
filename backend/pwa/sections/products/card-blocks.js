import { api, session } from '../../core/api.js';
import { h } from '../../core/dom.js';
import { date, money, qty } from '../../core/format.js';
import { go } from '../../core/router.js';
import { badge, button, busyBlock, empty, enhanceSelect, failBlock, hint, readonlyGroup, row as kitRow, section, select, stack, table, toast, toastError } from '../../ui/kit/index.js';
import { kindName, kindNorm } from '../../core/passport-kinds.js';
import { passportVariant } from '../passports/dialogs.js';
import { jointsText } from '../passports/traits.js';
import { suggestLink } from '../../ui/composition-suggest.js';
import { warnCard } from '../../ui/kit/screens/blocks.js';
import { clearNoteWarning, resetPdCategory } from './data.js';
import { productTypeLine } from '../passports/common.js';
import { openPassportFunnel } from '../passports/funnel/open.js';

/* Блоки правой панели изделия (вид): примечание-предупреждение, состав, документация, «В заказах», тип паспорта.
 * ПМ-1 (2026-11-06): каждый блок — свёрнутая секция kit.section с числом; пустой — одна строка внутри. */
const none = (text) => h('p', { class: 'muted small' }, text);

export const STATUS = { draft: 'без цены', active: 'в продаже', new: 'новое', archived: 'архив' };
export const dims = (d) => (d ? `${['length', 'width', 'height'].map((k) => (d[k] ? qty(d[k]) : '—')).join(' × ')} ${d.unit || 'мм'}` : null);
export { grp } from '../../ui/kit/index.js';

/** Тип паспорта в карточке (только чтение): своё у изделия, из группы/вида, не задан. Задаётся в группе или виде изделия (C103). */
export function passportCatView(r, ctx) {
  const reset = session.canEdit ? async () => {
    try { const fresh = await resetPdCategory(r); toast('Тип паспорта теперь берётся из группы'); ctx?.setRow?.(fresh); } catch (e) { toastError(e); }
  } : null;
  return productTypeLine(r, { onReset: reset });
}

// Пометка скрипта переноса каталога («⚠ Проверить …»): напоминание, не мастер объединения.
// Кнопки: открыть похожий артикул (если указан) · «Это разные» — только снять ⚠ из примечания.
export function warnNote(r) {
  if (!r.notes || !r.notes.startsWith('⚠')) return null;
  const rest = r.notes.split('\n').filter((l) => !l.trim().startsWith('⚠')).join('\n').trim();
  const warnLines = r.notes.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('⚠'));
  const skuHit = warnLines.join(' ').match(/\b(\d[\w.-]{1,20})\s*[«"]/);
  const otherSku = skuHit?.[1] || '';
  const acts = [];
  let box = null;
  if (otherSku) acts.push({ label: `Открыть ${otherSku}`, run: () => go('products', { search: otherSku }) });
  if (session.canEdit) {
    acts.push({ label: 'Это разные — убрать пометку', run: async () => { try { await clearNoteWarning(r, rest); box?.remove(); toast('Пометка снята'); } catch (er) { toastError(er, 'снять пометку'); } } });
  }
  box = warnCard({ tone: 'warn', title: warnLines.join(' · '),
    sub: 'Напоминание после загрузки каталога, не кнопка «объединить». Сравните карточки сами; лишнее удалите в списке «Продукция».', actions: acts });
  return box;
}

// «Состав» (БЗ-5): материалы склада, из которых сделано изделие; правка — в правой панели.
// Себестоимость материалов (тем, кто видит деньги): цена — последняя закупка, иначе справочник материалов
export function compositionBlock(r) {
  const items = r.composition || [];
  const cost = session.canMoney ? r.cost : null;
  // СИ: строки трёх видов; цена — по виду и ссылке (материал — закупка/справочник, изделие — по его составу)
  const price = new Map((cost?.lines || []).map((x) => [`${x.lineType || 'material'}:${x.refId || x.materialId}`, x]));
  const priceText = (l) => {
    const p = price.get(`${l.lineType || 'material'}:${l.refId || l.materialId}`);
    if (!cost || l.raw) return '';
    if (!p || p.price == null) return ' · цены нет';
    const src = p.source === 'reference' ? ' (справочник)' : p.source === 'composition' ? ` (по составу${p.partial ? ', не всё с ценой' : ''})` : p.date ? ` (закупка ${date(p.date)})` : '';
    return ` · ${money(p.price)}/${l.unit} = ${money(p.sum)}${src}`;
  };
  const line = (l) => kitRow({ title: l.name, meta: `${qty(l.quantity)} ${l.unit}${l.article ? ' · ' + l.article : ''}${priceText(l)}`,
    below: l.lineType === 'product' && l.children?.length ? h('details', { class: 'comp-nested' }, h('summary', null, `его состав: ${l.children.length}`),
      h('ul', null, ...l.children.map((c) => h('li', null, `${c.name} · ${qty(c.quantity)} ${c.unit}`)))) : null });
  // 2026-11-10 (пользователь: «закинул всё в состав пачкой»): разделы по виду строки — модули, детали, метизы, покупные, сырьё
  const KINDS = [
    ['Модули', (l) => l.lineType === 'module' || l.raw], ['Изделия', (l) => l.lineType === 'product'],
    ['Детали', (l) => l.kind === 'part'], ['Метизы', (l) => l.kind === 'fastener'], ['Покупные изделия', (l) => l.kind === 'purchased'],
    ['Сырьё (лист, труба)', (l) => l.kind === 'raw'],
  ];
  const left = new Set(items);
  const groups = KINDS.map(([title, ok]) => { const list = items.filter((l) => left.has(l) && ok(l)); list.forEach((l) => left.delete(l)); return [title, list]; });
  groups.push(['Материалы', [...left]]);
  const shown = groups.filter(([, l]) => l.length);
  return section({ title: 'Состав', tone: 'gold', count: items.length, body: [
    items.length ? (shown.length === 1 ? h('div', null, ...items.map(line))
      : stack(...shown.map(([title, list], i) => section({ title, count: list.length, tone: 'neutral', open: i === 0 || list.length <= 10, body: list.map(line) }))))
      : none('Не заполнен — «⋯ → Изменить состав».'),
    cost ? h('p', null, h('b', null, `Себестоимость ≈ ${money(cost.total)}`),
      h('span', { class: 'muted' }, cost.missing ? ` · без цены: ${cost.missing} — в сумму не вошли` : ' · материалы — по последним закупкам, изделия — по их составу')) : null] });
}

/** Ячейка «Заказ» в истории паспортов изделия (C063): номер + переход в заказ. */
function orderCell(x) {
  const no = String(x.orderNo || x.productionNo || '').trim();
  const oid = x.salesOrderId ? String(x.salesOrderId) : '';
  if (!no && !oid) return '—';
  const label = no ? `№ ${no}` : 'Заказ';
  if (!oid) return label;
  return h('a', { href: `#salesorders?open=${oid}`, onClick: (e) => e.stopPropagation() }, label);
}

/** «⋯ → Править шаблон / Изменить паспорт»: C141 — только эталонная книжка (не старая анкета doctpl). */
export async function openPassportTemplate(row, ctx) {
  try {
    const { openBookForProduct } = await import('../passports/open-book.js');
    await openBookForProduct(row.id, {
      onClose: async () => {
        try { ctx?.setRow?.(await api(`/showcase/${row.id}`)); } catch { /* карточка как была */ }
      },
    });
  } catch (e) { toastError(e, 'открыть паспорт'); }
}

/** Вкладка «Паспорт»: сведения и таблица выпущенных — только чтение; выпуск, загрузка, правка шаблона — в «⋯» шапки (C119). */
export function passportPane(row, ctx) {
  const host = stack(busyBlock('паспорт изделия', { retry: paint }));
  const cat = () => row.passportCategory?.code || row.passportDefaults?.passportCategory || '';
  async function paint() {
    let check = null;
    if (cat()) {
      try {
        check = await api('/passports/check', { method: 'POST', body: { productId: row.id, mode: 'template', variant: passportVariant.value } });
      } catch (e) {
        host.replaceChildren(failBlock(e, paint, { text: 'Паспорт изделия не проверился' }));
        return;
      }
    }
    const slots = [...(check?.imageSlots || []), ...(check?.requiredImages || [])].map(kindNorm).filter(Boolean);
    const uniq = [...new Set(slots)];
    const lack = (check?.missing || []).filter((m) => String(m?.key || '').startsWith('img_')).map((m) => kindNorm(m.key.slice(4)));
    const lackIn = lack.filter((k) => uniq.includes(k));
    const have = Math.max(0, uniq.length - lackIn.length);
    const names = [...new Set(lackIn)].map(kindName).join(', ');
    const draw = !cat()
      ? hint('Тип паспорта не задан: его задают в группе изделия или в виде изделия', 'warn')
      : uniq.length
        ? hint(`Рисунки: ${have} из ${uniq.length}` + (names ? ` · не хватает: ${names}` : ''))
        : hint('Рисунки не требуются');
    const n = (check?.missing || []).length;
    const ready = !cat() ? null : n ? hint(`Готовность шаблона: не хватает ${n}`, 'warn') : badge('Готовность шаблона: всё готово', 'ok');
    const card = section({
      title: 'Паспорт', fixed: true, tone: 'info',
      body: [
        readonlyGroup({ title: 'Паспорт', rows: [
          ['Тип паспорта', passportCatView(row, ctx)],
          ['Гарантия', row.passportDefaults?.warrantyMonths ? `${row.passportDefaults.warrantyMonths} мес.` : null],
          ['Срок службы', row.passportDefaults?.serviceLifeYears ? `${row.passportDefaults.serviceLifeYears} лет` : null],
          ['Как соединено', jointsText(row.passportDefaults?.joints) || null],
          ['Поставляется разобранным', row.passportDefaults?.isKit ? 'да' : null],
        ] }),
        draw, ready,
      ],
    });
    let items = row.passports?.items || [];
    let total = row.passports?.total || items.length;
    try {
      const d = await api('/passports', { query: { productId: row.id, status: 'issued', limit: 50 } });
      if (Array.isArray(d?.items)) {
        const prev = new Map((row.passports?.items || []).map((x) => [String(x.id), x]));
        items = d.items.map((x) => {
          const s = prev.get(String(x.id)) || {};
          return { ...s, ...x, printSource: x.printSource || s.printSource, printFile: x.printFile || s.printFile, supplierOrg: x.supplierOrg || s.supplierOrg, supplier: x.supplier || s.supplier, productCode: x.productCode || s.productCode };
        });
        total = d.total ?? items.length;
      }
    } catch { /* список карточки изделия */ }
    items = items.filter((x) => x.status !== 'annulled' && x.status !== 'draft' && !String(x.passportNumber || '').startsWith('draft-'));
    const firmName = (x) => x.supplierOrg?.name || x.supplier || '';
    const fromFile = (x) => x.printSource === 'file' || !!x.printFile?.hasFile;
    const firms = [...new Set(items.map(firmName).filter(Boolean))];
    let firmFilter = '';
    const showIssued = () => {
      const shown = firmFilter ? items.filter((x) => firmName(x) === firmFilter) : items;
      const firmSel = firms.length > 1 ? select({ label: 'Фирма', value: firmFilter, options: [['', 'Все фирмы'], ...firms.map((n) => [n, n])], onChange: (v) => { firmFilter = v; showIssued(); } }) : null;
      const filter = firmSel ? h('label', { class: 'field' }, h('span', null, 'Фирма'), firmSel) : null;
      const issued = shown.length
        ? table({
          label: 'Выпущенные паспорта', clickable: true, cls: 'k-table-stack',
          columns: [
            { label: '№', nowrap: true }, { label: 'Заводской №', nowrap: true }, { label: 'Заказ', wrap: true },
            { label: 'Фирма', wrap: true }, { label: 'Источник' },
            { label: 'Дата', nowrap: true }, { label: 'Заказчик', hide: true },
          ],
          rows: shown.map((x) => ({
            // C141: клик по выпущенному — сразу книжка (карточка архива не основной путь правки)
            onClick: async () => {
              const { openBookEditor } = await import('../passports/book-editor.js');
              openBookEditor(x, { onClose: () => paint().catch(() => {}) });
            },
            cells: [
              (x.passportNumber && !String(x.passportNumber).startsWith('draft-') ? x.passportNumber : '—'),
              x.productCode || '—',
              orderCell(x),
              firmName(x) || '—',
              fromFile(x) ? badge('Файл', 'info') : badge('С сайта', 'ok'),
              date(x.date) || '—',
              x.customer || x.customerName || '—',
            ],
          })),
        })
        : stack(
          empty({
            title: firmFilter ? 'Нет паспортов этой фирмы' : 'По этой модели паспортов ещё нет',
            hint: firmFilter ? undefined : '«Готовность шаблона» — данные. Файл появится после выпуска (без заказа и без договора).',
          }),
          (!firmFilter && session.canEdit && session.seesDocs())
            ? button({
              label: 'Выпустить паспорт', kind: 'primary', size: 'S',
              title: 'Без заказа и без договора — номер и PDF сразу',
              onClick: () => openPassportFunnel({ productId: row.id }),
            })
            : null,
        );
      const more = total > items.length ? hint(`показаны последние ${items.length}`) : null;
      host.replaceChildren(card, filter, issued, more);
      if (firmSel) enhanceSelect(firmSel);
    };
    showIssued();
  }
  paint();
  return host;
}

// «Где в заказах» (БЗ-5): позиции заказов с этим изделием (по ссылке или по совпадению названия) — только просмотр
export function inOrders(r) {
  const items = r.orderLines || [];
  if (!items.length) return section({ title: 'В заказах', tone: 'money', count: 0, body: none('Изделие ещё не встречается в заказах') });
  return section({ title: 'В заказах', tone: 'money', count: items.length, body:
    h('ul', { class: 'timeline' }, ...items.map((l) => h('li', null,
      h('a', { href: '#salesorders?open=' + l.orderId }, `№ ${l.orderNo || '—'}`),
      h('span', { class: 'muted clip' }, [l.customer, l.qty != null ? `${qty(l.qty)} шт.` : '', l.color, l.size, l.shipDate ? 'отгрузка ' + date(l.shipDate) : ''].filter(Boolean).join(' · ')),
      l.linked ? suggestLink(l.id) : null))) });
}

/** Варианты изделия (ВР): основное и другие варианты семейства — размеры, цвет; переход по ссылке. */
export function variantsBlock(r) {
  const items = r.variants || [];
  if (!items.length) return null;
  return section({ title: 'Другие варианты', tone: 'info', count: items.length, body:
    h('ul', { class: 'timeline' }, ...items.map((v) => h('li', null,
      h('a', { href: '#products?open=' + v.id }, `арт. ${v.sku || '—'}`),
      h('span', { class: 'muted clip' }, [v.isBase ? 'основное' : '', v.name, dims(v.dimensions), (v.colors || []).join(', ')].filter(Boolean).join(' · '))))) });
}
