import { api, session } from '../../core/api.js';
import { h } from '../../core/dom.js';
import { date, money, qty } from '../../core/format.js';
import { go } from '../../core/router.js';
import { actions, badge, busyBlock, button as kitButton, empty, failBlock, hint, readonlyGroup, row as kitRow, section, stack, table, toast, toastError } from '../../ui/kit/index.js';
import { kindName, kindNorm } from '../../core/passport-kinds.js';
import { passportVariant } from '../passports/dialogs.js';
import { jointsText } from '../passports/traits.js';
import { suggestLink } from '../../ui/composition-suggest.js';
import { clearNoteWarning, resetPdCategory } from './data.js';
import { openPassportFunnel } from '../passports/funnel/open.js';

/* Блоки правой панели изделия (вид): примечание-предупреждение, состав, документация, «В заказах», категория паспорта.
 * ПМ-1 (2026-11-06): каждый блок — свёрнутая секция kit.section с числом; пустой — одна строка внутри. */
const none = (text) => h('p', { class: 'muted small' }, text);

export const STATUS = { draft: 'без цены', active: 'в продаже', new: 'новое', archived: 'архив' };
export const dims = (d) => (d ? `${['length', 'width', 'height'].map((k) => (d[k] ? qty(d[k]) : '—')).join(' × ')} ${d.unit || 'мм'}` : null);
export { grp } from '../../ui/kit/index.js';

/** Категория паспорта в карточке: что задано в изделии, что унаследовано от группы/раздела, куда идти, если не задано. */
export function passportCatView(r, ctx) {
  const pc = r.passportCategory;
  const lbl = (c) => (c ? `${c.name || c.code}` : '');
  const where = r.group ? `группы «${r.group}»` : r.type ? `раздела «${r.type}»` : '';
  if (pc?.own) {
    const inh = pc.inherited;
    const reset = kitButton({ label: 'Сбросить', kind: 'ghost', size: 'S', onClick: async () => {
      try { const fresh = await resetPdCategory(r); toast('Категория сброшена'); ctx?.setRow?.(fresh); } catch (e) { toastError(e); }
    } });
    return h('span', null, `${lbl(pc.own)} — задана в самом изделии`, inh && inh.code !== pc.own.code ? ` (${r.group ? `у группы «${r.group}»` : 'по группе'}: ${lbl(inh)})` : '', ' ', reset);
  }
  const cur = pc?.inherited || (pc && pc.code ? pc : null);
  if (cur) return `${cur.name || cur.code}${cur.via ? ` (${cur.via})` : ''}`;
  if (!where) return null;
  return h('span', { class: 'muted' }, `У ${where} не задана категория паспорта. Выберите её в «Продукция → Категории» (строка ${r.group ? 'группы' : 'раздела'}, поле «Категория паспорта»)`);
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
  if (otherSku) {
    acts.push(kitButton({ label: `Открыть ${otherSku}`, size: 'S', title: 'Сравнить с похожим изделием из пометки',
      onClick: () => go('products', { search: otherSku }) }));
  }
  if (session.canEdit) {
    acts.push(kitButton({ label: 'Это разные — убрать пометку', size: 'S', title: 'Вы проверили: изделия разные или уже разобрались. Пометка исчезнет; объединение/удаление — отдельно в списке изделий',
      onClick: async (e) => { const box = e.currentTarget.closest('.fill-note'); try { await clearNoteWarning(r, rest); box?.remove(); toast('Пометка снята'); } catch (er) { toastError(er, 'снять пометку'); } } }));
  }
  return h('div', { class: 'fill-note fill-warn' },
    h('div', { class: 'u-pre' }, warnLines.join('\n')),
    h('p', { class: 'hint u-tight' }, 'Это напоминание после загрузки каталога, не кнопка «объединить». Сравните карточки сами; лишнее удалите в списке «Продукция». Здесь только снять пометку.'),
    acts.length ? h('div', { class: 'actions' }, ...acts) : null);
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
  const groups = [['material', 'Материалы'], ['product', 'Изделия'], ['module', 'Модули (CRM)']].map(([t, title]) => [title, items.filter((l) => (l.lineType || 'material') === t || (t === 'module' && l.raw))]).filter(([, l]) => l.length);
  return section({ title: 'Состав', tone: 'gold', count: items.length, body: [
    items.length ? h('div', null, ...groups.map(([title, list]) => h('div', null, groups.length > 1 ? h('b', null, title) : null, h('div', null, ...list.map(line)))))
      : none('Не заполнен — «Изменить состав» в действиях карточки.'),
    cost ? h('p', null, h('b', null, `Себестоимость ≈ ${money(cost.total)}`),
      h('span', { class: 'muted' }, cost.missing ? ` · без цены: ${cost.missing} — в сумму не вошли` : ' · материалы — по последним закупкам, изделия — по их составу')) : null] });
}

/** Вкладка «Паспорт»: одна карточка и таблица выпущенных (C056). Рисунки — в правке шаблона. */
export function passportPane(row, ctx) {
  const host = stack(busyBlock('паспорт изделия', { retry: paint }));
  const cat = () => row.passportCategory?.code || row.passportDefaults?.passportCategory || '';
  async function openTemplate() {
    try {
      const { openCard } = await import('../../ui/kit/card.js');
      const { doctpl } = await import('../docs.js');
      openCard(doctpl, { id: row.id }, { close: async () => {
        try { ctx?.setRow?.(await api(`/showcase/${row.id}`)); } catch { /* карточка останется как была */ }
      } });
    } catch (e) { toastError(e, 'открыть шаблон'); }
  }
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
      ? hint('Сначала выберите категорию паспорта', 'warn')
      : uniq.length
        ? hint(`Рисунки: ${have} из ${uniq.length}` + (names ? ` · не хватает: ${names}` : ''))
        : hint('Рисунки не требуются');
    const n = (check?.missing || []).length;
    const ready = !cat() ? null : n ? hint(`Готовность шаблона: не хватает ${n}`, 'warn') : badge('Готовность шаблона: всё готово', 'ok');
    const card = section({
      title: 'Паспорт', fixed: true, tone: 'info',
      body: [
        readonlyGroup({ title: 'Паспорт', rows: [
          ['Категория паспорта', passportCatView(row, ctx) || 'Сначала выберите категорию паспорта'],
          ['Гарантия', row.passportDefaults?.warrantyMonths ? `${row.passportDefaults.warrantyMonths} мес.` : null],
          ['Срок службы', row.passportDefaults?.serviceLifeYears ? `${row.passportDefaults.serviceLifeYears} лет` : null],
          ['Как соединено', jointsText(row.passportDefaults?.joints) || null],
          ['Поставляется разобранным', row.passportDefaults?.isKit ? 'да' : null],
        ] }),
        draw, ready,
        actions(
          session.canEdit && session.seesDocs() ? kitButton({ label: 'Выпустить паспорт', kind: 'primary', size: 'S', title: 'Новый паспорт с номером по этой модели', onClick: () => openPassportFunnel({ productId: row.id }) }) : null,
          kitButton({ label: 'Править шаблон', size: 'S', title: 'Категория, тексты и рисунки по разделам паспорта', onClick: openTemplate }),
        ),
      ],
    });
    const p = row.passports;
    const items = p?.items || [];
    const issued = items.length
      ? table({
        label: 'Выпущенные паспорта', clickable: true,
        columns: [{ key: 'n', label: '№', nowrap: true }, { key: 'd', label: 'Дата', nowrap: true }, { key: 'c', label: 'Заказчик' }, { key: 'o', label: 'Заказ', nowrap: true }],
        rows: items.map((x) => ({
          onClick: () => go('passports', { open: x.id }),
          cells: [x.passportNumber || '—', date(x.date) || '—', x.customer || x.customerName || '—', x.orderNo || '—'],
        })),
      })
      : empty({ title: 'По этой модели паспортов ещё нет' });
    const more = p?.total > items.length ? hint(`показаны последние ${items.length}`) : null;
    host.replaceChildren(card, issued, more);
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
