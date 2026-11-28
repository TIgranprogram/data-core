import { api, canUseRequestCart, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { normSearch } from '../core/facets.js';
import { parseNum } from '../core/format.js';
import { current, go } from '../core/router.js';
import { bulkLines, exportCart } from './request-cart-output.js';
import { saveCatalogPipeLength } from './request-cart-save-length.js';
import { catalogRows, pipeArt } from './request-cart-catalog.js';
import { canCountPipe, hasPipeOrder, orderLineKey, pipeDescription, pipeInputs, pipeOrder, restorePipeDraft } from './request-cart-pipe-input.js';
import { groupPipeVariants, pipeFamilyKey, pipeVariantView, uniquePurchaseRows } from './request-cart-pipe-variants.js';
import { purchaseSignals } from './request-cart-open-orders.js';
import { actions, badge, button, card, catalogShelves, catArt, empty, field, hint, searchBox, select, stack, table, textInput, tileGrid, toast, typeArt } from '../ui/kit/index.js';

const CAP = 200;
const PAGE = 30;
const MIN = 0.000001;
const shelves = [
  ['Металлопрокат', /труб|лист|металл|прокат|швеллер|балк|арматур|уголок/i],
  ['Крепёж и комплектующие', /креп|метиз|фурнит|комплект|подшип/i],
  ['Расходники и материалы', /расход|краск|хими|древ|пиломат|пласт|электр|резин|упаков/i],
];
const retained = new Map();
const storageKey = () => 'dc-requestcart:' + (session.user?.id || session.user?._id || 'local');

function readDraft(key) {
  if (retained.has(key)) return retained.get(key);
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    return Array.isArray(saved?.rows) ? saved : { rows: [], pending: null };
  }
  catch { return { rows: [], pending: null }; }
}

function storeDraft(key, draft) {
  retained.set(key, draft);
  try {
    if (draft.rows.length) localStorage.setItem(key, JSON.stringify(draft));
    else localStorage.removeItem(key);
  } catch { /* текущий сеанс продолжает хранить корзину */ }
}

const numberOf = value => {
  if (typeof value !== 'number' && !/^(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(String(value ?? '').replace(/\s/g, ''))) return null;
  const n = parseNum(value);
  return Number.isFinite(n) && n >= MIN ? n : null;
};
const newUid = () => globalThis.crypto?.randomUUID?.() || Array.from(
  globalThis.crypto.getRandomValues(new Uint8Array(16)),
  byte => byte.toString(16).padStart(2, '0'),
).join('');
const quantityWithUnit = (input, unit) => input ? actions(input, h('span', { 'aria-hidden': 'true' }, unit)) : '—';
const rowButton = (label, row, onClick) => {
  const name = label + ': ' + row.name;
  const el = button({ label, title: name, size: 'S', onClick });
  el.setAttribute('aria-label', name);
  return el;
};

function makeForm(items, key, draft, catalogError, demo = false) {
  let catalog = catalogRows(items);
  restorePipeDraft(draft, catalog, numberOf);
  let inCart = Boolean(draft.pending || draft.rows.length);
  let category = demo ? 'Трубы' : '', type = demo ? 'Прямоугольные трубы' : null, query = '', page = 0, bindSave;
  let sort = 'name', filters = {};
  const entered = new Map();
  const chosenVariant = new Map();
  let openFamily = null;
  const el = h('div');
  const actionBar = h('div');
  const feedback = h('div', { role: 'status' });
  const body = h('div');
  el.append(stack(demo ? hint('Демонстрационный пример · бронь и заказ условные') : null, actionBar, feedback, body));
  const valid = () => !!draft.rows.length && draft.rows.every(row => {
    const qty = numberOf(row.qty);
    return qty != null && (draft.pending || !hasPipeOrder(row) || pipeOrder(row, qty)?.[row.pipe.unitMode] === qty);
  });
  const saveState = () => {
    if (demo) { bindSave?.(false, 'Просмотр примера'); return; }
    if (inCart) bindSave?.(valid(), draft.pending ? 'Повторить отправку' : 'Создать заявки');
    else bindSave?.(true, 'Корзина (' + draft.rows.length + ')', toggle);
  };
  const persist = () => storeDraft(key, draft);
  const toggle = () => { feedback.replaceChildren(); inCart = !inCart; paint(); };
  const position = row => stack(h('strong', null, row.name),
    row.pipe ? pipeDescription(row) : row.article ? hint('Арт. ' + row.article) : null);
  const compare = (a, b) => String(a).localeCompare(String(b), 'ru', { numeric: true });
  const groupRows = () => catalog.filter(row => row.category === category);
  const typeRows = () => groupRows().filter(row => !type || row.type === type);
  const matchesQuery = row => normSearch(query).split(/\s+/).every(part =>
    normSearch([row.name, row.article, row.category, row.type, row.size, row.grade,
      ...(row.pipe?.sourceMaterials || []).map(source => source.name + ' ' + (source.article || ''))].filter(Boolean).join(' ')).includes(part));
  const filterRows = () => {
    return typeRows().filter(row =>
      matchesQuery(row) &&
      Object.entries(filters).every(([key, value]) => !value || (key === 'availability'
        ? (Number(row.quantity) > 0) === (value === 'in') : String(row[key]) === value)))
      .sort((a, b) => {
        if (sort === 'size') return compare(a.size == null ? '\uffff' : a.size, b.size == null ? '\uffff' : b.size) || compare(a.name, b.name);
        if (sort === 'thickness') return (a.thickness ?? Infinity) - (b.thickness ?? Infinity) || compare(a.name, b.name);
        if (sort === 'stock') return (Number(b.quantity) || 0) - (Number(a.quantity) || 0) || compare(a.name, b.name);
        return sort === '-name' ? compare(b.name, a.name) : compare(a.name, b.name);
      });
  };
  const clear = () => { query = ''; page = 0; sort = 'name'; filters = {}; };
  const choose = (nextCategory, nextType) => {
    category = nextCategory; type = nextType; page = 0; sort = 'name'; filters = {}; feedback.replaceChildren(); paint();
  };
  function tiles(rows, key, onPick) {
    const counts = new Map();
    for (const row of uniquePurchaseRows(rows)) counts.set(row[key], (counts.get(row[key]) || 0) + 1);
    const makeTile = ([label, count]) => {
      const art = h('span', { 'aria-hidden': 'true' });
      if (key === 'category' || category === 'Листы') {
        art.innerHTML = catArt(key === 'category' ? label : category);
      } else if (category === 'Трубы' && pipeArt.has(label)) {
        art.append(h('img', { src: new URL('../ui/catalog-art/' + pipeArt.get(label) + '.webp', import.meta.url).href, alt: '' }));
      } else {
        art.innerHTML = typeArt(label, category);
      }
      return card({ size: 'S', artCover: true, art, title: label, meta: 'Позиций: ' + count, onClick: () => onPick(label) });
    };
    const sorted = [...counts].sort(([a], [b]) => compare(a, b));
    if (key !== 'category') return tileGrid({ compact: true }, ...sorted.map(makeTile));
    const groups = new Map();
    for (const entry of sorted) {
      const shelf = shelves.find(([, pattern]) => pattern.test(entry[0]))?.[0] || 'Другие категории';
      if (!groups.has(shelf)) groups.set(shelf, []);
      groups.get(shelf).push(entry);
    }
    return catalogShelves([...shelves.map(([title]) => title), 'Другие категории']
      .filter(title => groups.has(title)).map(title => [title, groups.get(title).map(makeTile)]));
  }

  const catalogTable = h('div');
  catalogTable.addEventListener('click', event => {
    if (event.target.closest('button, input, select, textarea, label, a, .field')) return;
    event.target.closest('tr')?.querySelector('.k-pipe-disclosure')?.click();
  });
  function paintCatalog(focusTarget) {
    const filtered = filterRows();
    let nextFocus;
    const isPipe = category === 'Трубы';
    const groups = isPipe ? groupPipeVariants(filtered, sort) : filtered.map(row => [row]);
    const showOtherUnit = isPipe && filtered.some(row => !row.pipe.unitMode);
    const columns = isPipe ? ['Сортамент и материал', '', 'Штуки', 'Метры', ...(showOtherUnit ? ['Количество'] : []), 'Действие']
      : ['Наименование', 'Ед.', 'Количество', 'Действие'];
    const pages = Math.max(1, Math.ceil(groups.length / PAGE));
    page = Math.min(page, pages - 1);
    catalogTable.replaceChildren(catalogError ? empty({ title: 'Каталог не загрузился', hint: 'Закройте панель и откройте её ещё раз.' }) : filtered.length ? table({
      label: 'Товары каталога', cls: isPipe ? 'k-pipe-table' : undefined,
      columns: columns.map(label => ({ label })),
      rows: groups.slice(page * PAGE, (page + 1) * PAGE).flatMap(variants => {
        const family = isPipe && pipeFamilyKey(variants[0]);
        const row = variants.find(item => item.materialId === chosenVariant.get(family)) || variants[0];
        const signals = purchaseSignals(variants).map(text => text.startsWith('Оплачено,') ? badge(text, 'ok') : hint(text));
        const selected = h('div');
        const showSelected = () => {
          const count = draft.rows.filter(line => line.materialId === row.materialId).reduce((sum, line) => sum + (numberOf(line.qty) || 0), 0);
          selected.replaceChildren(...(count > 0 ? [hint(`В корзине: ${count.toLocaleString('ru-RU', { maximumFractionDigits: 15 })} ${row.unit || ''}`)] : []));
        };
        const editLength = () => { openFamily = family; paintCatalog({ family, edit: true }); };
        const add = () => {
          if (demo) return;
          const qty = pair ? pair.quantity() : numberOf(input.value);
          if (qty == null && pair?.length && !pair.lengthM()) { toast('Укажите длину для пересчёта между штуками и метрами', { error: true }); editLength(); return; }
          if (qty == null) { toast('Укажите положительное количество', { error: true }); (pair?.pieces || input).focus(); return; }
          const orderRow = pair?.lengthM() && pair.length ? { ...row, orderLengthM: pair.lengthM() } : row;
          const same = draft.rows.find(item => orderLineKey(item) === orderLineKey(orderRow));
          if (!same && draft.rows.length >= CAP) { toast('В корзине может быть не больше 200 позиций', { error: true }); return; }
          if (same) {
            const previous = numberOf(same.qty);
            if (previous == null) { toast('Поправьте количество этой позиции в корзине', { error: true }); return; }
            const sum = previous + qty;
            if (!Number.isFinite(sum)) { toast('Количество слишком большое', { error: true }); return; }
            same.qty = Number(sum.toPrecision(15));
          } else draft.rows.push({ ...orderRow, qty });
          persist();
          paintBar();
          showSelected();
          feedback.replaceChildren(hint(`Добавлено: ${row.name} · позиций в корзине: ${draft.rows.length}`));
        };
        const pair = canCountPipe(row) ? pipeInputs(row, { typed: entered.get(row.materialId),
          onChange: (_qty, _length, typed) => entered.set(row.materialId, typed), onEnter: add }) : null;
        const input = pair ? null : textInput({ label: undefined, placeholder: '1', inputmode: 'decimal', short: true,
          value: entered.get(row.materialId) ?? '1', onInput: v => entered.set(row.materialId, v), onEnter: add });
        input?.input.setAttribute('aria-label', 'Количество: ' + row.name);
        showSelected();
        if (row.pipe) {
          const expanded = openFamily === family;
          const saveLength = pair?.length && !demo && session.canEdit ? button({ label: 'Сохранить длину в позиции', size: 'S', onClick: async () => {
            const metres = pair.lengthM();
            if (!metres) { toast('Укажите длину хлыста', { error: true }); pair.length.focus(); return; }
            try {
              await saveCatalogPipeLength(row.materialId, metres);
              const source = items.find(item => String(item.materialId || item.id) === row.materialId);
              source.dims = { ...source.dims, length: Number((metres * 1000).toPrecision(15)) };
              catalog = catalogRows(items);
              const updated = catalog.find(item => item.pipe?.sourceMaterials.some(source => source.materialId === row.materialId));
              if (updated) chosenVariant.set(pipeFamilyKey(updated), updated.materialId);
              feedback.replaceChildren(hint('Длина сохранена в позиции: ' + metres.toLocaleString('ru-RU') + ' м'));
              paintCatalog({ family: updated && pipeFamilyKey(updated), length: false });
            } catch (error) {
              feedback.replaceChildren(hint(error.message || 'Не удалось сохранить длину', 'warn'));
              if (pair.length.input.isConnected) pair.length.focus();
            }
          } }) : null;
          const { trigger, detail, length } = pipeVariantView(variants, row, { expanded, colspan: columns.length,
            editor: pair?.length ? actions(pair.length.el, saveLength) : null,
            toggle: () => {
              openFamily = expanded ? null : family;
              paintCatalog({ family, length: false });
            },
            pick: id => { chosenVariant.set(family, id); paintCatalog({ family, length: true }); } });
          if (focusTarget?.family === family) nextFocus = focusTarget.edit ? pair?.length?.input : focusTarget.length ? length : trigger;
          const line = { cells: [stack(actions(trigger, h('span', null, row.pipe.material)),
            pair?.length && !expanded ? button({ label: pair.lengthM() ? 'Длина для заказа: ' + pair.lengthM().toLocaleString('ru-RU') + ' м' : 'Указать длину', kind: 'ghost', size: 'S', cls: 'k-pipe-length-link', onClick: editLength }) : null, ...signals, selected), '',
            quantityWithUnit(pair?.pieces.el ?? (row.pipe.unitMode === 'pieces' ? input.el : null), 'шт'),
            quantityWithUnit(pair?.metres.el ?? (row.pipe.unitMode === 'metres' ? input.el : null), 'м'),
            ...(showOtherUnit ? [row.pipe.unitMode ? '—' : stack(input.el, hint('Единица: ' + (row.unit || '—')))] : []),
            demo ? button({ label: 'В корзину', disabled: true }) : rowButton('В корзину', row, add)] };
          return detail ? [line, detail] : [line];
        }
        return { cells: [stack(position(row), ...signals, selected), row.unit || '—', input.el, rowButton('В корзину', row, add)] };
      }),
    }) : empty({ title: 'Ничего не найдено', hint: 'Измените запрос или выберите другую категорию.' }),
    pages > 1 ? actions(
      button({ label: 'Назад', disabled: page === 0, onClick: () => { page--; paintCatalog(); } }),
      hint('Страница ' + (page + 1) + ' из ' + pages),
      button({ label: 'Дальше', disabled: page >= pages - 1, onClick: () => { page++; paintCatalog(); } }),
    ) : null);
    nextFocus?.focus({ preventScroll: true });
  }

  function paintBar() {
    actionBar.replaceChildren(actions(
      inCart && !draft.pending ? button({ label: 'К каталогу', onClick: toggle }) : null,
      inCart ? button({ label: 'Скачать Excel', disabled: !valid(), onClick: () => exportCart(draft.rows, numberOf) }) : null,
    ));
    actionBar.hidden = !inCart;
    saveState();
  }

  function paint() {
    paintBar();
    if (!inCart) {
      const back = category ? actions(button({ label: 'Все категории', onClick: () => choose('', null) }),
        type !== null ? button({ label: 'Подкатегории: ' + category, onClick: () => choose(category, null) }) : null) : null;
      if (catalogError || !catalog.length) {
        body.replaceChildren(empty({ title: catalogError ? 'Каталог не загрузился' : 'В каталоге пока нет позиций' }));
        return;
      }
      const navigation = h('div');
      const centeredSearch = searchBox({ centered: true, label: 'Поиск по каталогу', placeholder: 'Название или артикул', value: query,
        onSearch: value => { query = value; page = 0; if (!category || type === null) paintTiles(); else paintCatalog(); } }).el;
      const paintTiles = () => {
        const found = (category ? groupRows() : catalog).filter(matchesQuery);
        navigation.replaceChildren(found.length ? (category ? tiles(found, 'type', value => choose(category, value))
          : tiles(found, 'category', value => choose(value, null))) : empty({ title: 'Ничего не найдено' }));
      };
      if (!category || type === null) {
        body.replaceChildren(stack(centeredSearch, back, h('h2', null, category || 'Категории номенклатуры'), navigation,
          category ? actions(button({ label: 'Все позиции категории', onClick: () => choose(category, '') })) : null));
        paintTiles();
        return;
      }
      const rows = typeRows();
      const facet = (key, label) => {
        const values = [...new Set(rows.map(row => row[key]).filter(v => v != null && v !== '').map(String))].sort(compare);
        return values.length > 1 ? field(label, select({ label, value: filters[key] || '', options: [['', 'Все'], ...values.map(v => [v, v])],
          onChange: value => { filters[key] = value; page = 0; paintCatalog(); } })) : null;
      };
      const sorting = [['name', 'Название А–Я'], ['-name', 'Название Я–А'],
        ...(rows.some(row => row.size) ? [['size', 'По сечению']] : []),
        ...(rows.some(row => row.thickness != null) ? [['thickness', 'По толщине']] : []),
        ...(rows.some(row => row.quantity != null) ? [['stock', 'По остатку']] : [])];
      body.replaceChildren(stack(
        centeredSearch, back, h('h2', null, [category, type].filter(Boolean).join(' → ')),
        actions(
          facet('unit', 'Единица'), facet('grade', 'Марка'), facet('size', 'Сечение'), facet('thickness', 'Толщина, мм'),
          rows.some(row => row.quantity != null) ? field('Наличие', select({ label: 'Наличие', value: filters.availability || '',
            options: [['', 'Все'], ['in', 'Есть на складе'], ['out', 'Нет на складе']],
            onChange: value => { filters.availability = value; page = 0; paintCatalog(); } })) : null,
          field('Сортировка', select({ label: 'Сортировка', value: sort, options: sorting,
            onChange: value => { sort = value; page = 0; paintCatalog(); } })),
          button({ label: 'Сбросить фильтры', kind: 'ghost', onClick: () => { clear(); paint(); } }),
        ),
        catalogTable,
      ));
      paintCatalog();
      return;
    }
    body.replaceChildren(stack(
      draft.pending ? hint('Часть заявок могла сохраниться. Повтор отправляет ту же корзину с прежним ключом.') : null,
      draft.rows.length ? table({
        label: 'Корзина',
        columns: [{ label: 'Наименование' }, { label: 'Ед.' }, { label: 'Количество' }, { label: 'Действие' }],
        rows: draft.rows.map(row => {
          const pair = canCountPipe(row) && (!draft.pending || hasPipeOrder(row)) ? pipeInputs(row, { quantity: row.qty, disabled: !!draft.pending,
            onChange: (value, length) => { row.qty = value; if (row.orderLengthM || !row.pipe.lengthM) row.orderLengthM = length; persist(); paintBar(); } }) : null;
          const input = pair ? null : textInput({ value: row.qty, short: true, inputmode: 'decimal', disabled: !!draft.pending,
            onInput: value => { row.qty = value; persist(); paintBar(); } });
          input?.input.setAttribute('aria-label', 'Количество: ' + row.name);
          const amount = pair ? actions(pair.length?.el, field('Штуки', pair.pieces.el), field('Метры', pair.metres.el)) : input.el;
          const needsConfirmation = hasPipeOrder(row) && pair && !draft.pending && pair.quantity() !== numberOf(row.qty);
          const confirm = needsConfirmation ? button({ label: 'Округлить до целых труб', size: 'S', onClick: () => {
            const qty = pair.quantity();
            if (qty != null) { row.qty = qty; persist(); paint(); }
          } }) : null;
          return { cells: [position(row), row.unit || '—', amount, draft.pending ? null :
            actions(confirm, rowButton('Убрать', row, () => { draft.rows = draft.rows.filter(item => item !== row); persist(); paint(); }))] };
        }),
      }) : empty({ title: 'Корзина пуста', hint: 'Выберите позиции в каталоге.' }),
      hint('После создания заявки появятся в колонке «Заказать».'),
    ));
  }
  paint();

  return {
    el, dirty: () => false,
    bindSave: fn => { bindSave = fn; saveState(); },
    onError: paint,
    read: () => {
      if (demo || !inCart || !valid()) return { errors: true };
      if (!draft.pending) {
        const items = bulkLines(draft.rows, numberOf);
        if (items.some(item => item.note?.length > 2000 || !Number.isFinite(item.qty))) {
          toast('Разделите заказ: слишком много длин или слишком большое количество для одной позиции', { error: true });
          return { errors: true };
        }
        draft.pending = {
          clientUid: newUid(),
          items,
        };
        persist();
      }
      return { values: { request: draft.pending, key } };
    },
  };
}

export const requestCart = {
  id: 'requestcart', title: 'Заявки из каталога', newTitle: 'Заявки из каталога', noun: 'заявки', canEdit: canUseRequestCart,
  card: { heading: () => 'Заявки из каталога', view: () => [], noHistory: true },
  form: {
    saveLabel: 'Создать заявки',
    build: async () => {
      if (location.origin === 'http://localhost:3102' && current().params.demo === 'pipe-reserve') {
        const sample = { id: 'demo-pipe', name: 'Труба 80×40×2', assortment: '80×40×2', metal: 'pipe', unit: 'м',
          dims: { width: 80, height: 40, thickness: 2, length: 6000 }, quantity: 90, washed: false,
          reservedQty: 12, openPurchases: [{ status: 'ordered', qty: 24, unit: 'м' }] };
        return makeForm([sample], '', { rows: [], pending: null }, null, true);
      }
      const key = storageKey();
      const draft = readDraft(key);
      if (draft.pending) return makeForm([], key, draft);
      try { return makeForm((await api('/stock/lookup', { query: { catalog: '1' } })).items || [], key, draft); }
      catch (error) {
        if (!draft.rows.length) throw error;
        return makeForm([], key, draft, error);
      }
    },
    toBody: values => values,
    async create({ request, key }) {
      const result = await api('/supply/requests/bulk', { method: 'POST', body: request });
      if (result?.total !== request.items.length || result?.items?.length !== request.items.length) {
        throw new Error('Не получено подтверждение всех заявок');
      }
      storeDraft(key, { rows: [], pending: null });
      return result;
    },
    afterSave() {
      go('requests', { status: 'requested', view: 'board' }, { replace: true });
      return true;
    },
  },
};
