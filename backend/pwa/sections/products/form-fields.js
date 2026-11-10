import { session } from '../../core/api.js';
import { h } from '../../core/dom.js';
import { money, qty } from '../../core/format.js';
import { go } from '../../core/router.js';
import { skuKey } from '../../core/facets.js';
import { button, tagPick, toast, toastError, confirmDlg, similarBox } from '../../ui/kit/index.js';
import { dictNames } from '../../ui/dict-options.js';
import { loadMaterialDicts, materialsSpec, specSummary } from '../../ui/materials-spec.js';
import { funnelBox } from '../../ui/funnel.js';
import { canEdit as canEditPassportTexts, dictOpts, dictRows } from '../passports/common.js';
import { jointsPick } from '../passports/traits.js';
import { withElementTexts } from '../passports/elements-block.js';
import { formValues, phrases, staffOptions, passportCategoryOptions, skuSearch, materialsFromComposition, createProduct, patchProduct, savePd, takePending, pendingProduct, assignSku } from './data.js';

/* Форма изделия в правой панели: поля (ИЗ-4: Изделие → Цена → Паспорт → Характеристики → Описание и материалы → Ещё), тело запроса, создание/правка. */

// «Цена и себестоимость» в форме: себестоимость — только показ расчёта по составу (поле CRM costPrice не пишем)
const costInfo = (r) => {
  const c = r?.cost;
  const text = !r ? 'Посчитается по составу — состав добавляется в карточке после «Создать»'
    : c?.total ? `≈ ${money(c.total)} по составу${c.missing ? ` · без цены: ${c.missing}` : ''}`
      : r.composition?.length ? 'У материалов состава нет цен закупки — сумма не считается' : 'Состав не заполнен — «Изменить состав» в карточке';
  return { el: h('p', { class: 'muted' }, text), value: '' };
};
/** МИ.2: «Взять из состава» — предложение таблицы по материалам «Состава изделия»; запишется по «Сохранить». */
export const fromComposition = (r) => ({ label: 'Взять из состава', busy: 'Собираю…', title: 'Строки по материалам «Состава изделия»: труба 89×3 → Труба стальная ∅89×3',
  run: async (w) => {
    const res = await materialsFromComposition(r);
    const rows = res.materialsSpec?.rows || [];
    if (!rows.length) { toast(res.unmatched?.length ? `Материалы состава не нашлись в справочнике: ${res.unmatched.join(', ')} — заполните строки вручную` : 'В составе нет материалов склада — «Изменить состав» в карточке', { ms: 8000 }); return; }
    if (!w.isEmpty() && !(await confirmDlg('Заменить таблицу материалов?', 'Строки заменятся предложением по «Составу изделия». В изделие запишется по «Сохранить».', { okText: 'Заменить' }))) return;
    const hint = res.hinted?.length ? ' Подсказка по названию, проверьте: ' + res.hinted.join(', ') + '.' : '';
    w.set({ rows, coatingIds: [...new Set([...(JSON.parse(w.value || 'null')?.coatingIds || []), ...(res.materialsSpec.coatingIds || [])])] });
    toast((res.unmatched?.length ? `Строк: ${rows.length}. Не нашлись в справочнике: ${res.unmatched.join(', ')} — добавьте вручную` : `Строк из состава: ${rows.length} — проверьте и сохраните`) + hint, { ms: res.unmatched?.length || hint ? 9000 : undefined });
  } });
/** materialsSpec — при создании, а при правке — только если таблицу меняли (не трогаем изделие с удалённой записью справочника). */
const specBody = (v, r) => {
  const next = v.materialsSpec ?? null;
  return !r || JSON.stringify(next) !== JSON.stringify(r.materialsSpec ?? null) ? { materialsSpec: next } : {};
};

const opt = (x) => ({ value: x.value, label: x.value, sub: x.n ? `${qty(x.n)} изд.` : '' });
const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
// «Тип → Группа»: у выбранного типа есть группы — показываем только их, нет — все (с типом в подписи); одно название — один раз
const groupsOf = (fv) => (get) => {
  const sec = get('type').trim(); const seen = new Set();
  const mine = sec ? fv.groups.filter((g) => same(g.section, sec)).map((g) => ({ ...opt(g), group: `Раздел «${sec}»` })) : [];
  mine.forEach((g) => seen.add(g.value.toLowerCase()));
  const rest = fv.groups.filter((g) => !seen.has(g.value.toLowerCase()) && (seen.add(g.value.toLowerCase()), true))
    .map((g) => ({ ...opt(g), sub: [opt(g).sub, g.section].filter(Boolean).join(' · '), group: mine.length ? 'Все' : undefined }));
  return mine.length ? mine : rest;
};
// дубль артикула — по тому же правилу, что на сервере (регистр, KC-01 = КС-01), и в корзине тоже
/** Кнопка под полем «Артикул» (пользователь 2026-11-10): «Присвоить артикул группы» — сразу, с проверкой выпущенных паспортов; был только в меню «⋯». */
const skuButton = (r) => (fa) => {
  if (!r?.id || !session.canEdit) return;
  fa.field('sku')?.append(button({ label: 'Присвоить артикул группы', kind: 'ghost', size: 'S', title: 'Новый артикул по номеру группы (например 34 → 3411)', onClick: async () => {
    try {
      const chk = await assignSku(r.id);
      if (!chk.confirmRequired) { fa.set('sku', chk.sku); toast(chk.changed ? `Артикул: ${chk.sku}` : `Артикул ${chk.sku} уже по номеру группы`); return; }
      if (!(await confirmDlg('Присвоить новый артикул?', `Сейчас: ${chk.sku || 'нет'}. ${chk.warning || ''}`, { okText: 'Присвоить' }))) return;
      const res = await assignSku(r.id, true);
      fa.set('sku', res.sku); r.sku = res.sku; toast(`Новый артикул: ${res.sku}`);
    } catch (e) { toastError(e, 'присвоить артикул'); }
  } }));
};
const skuTaken = (r) => async (v) => {
  const { live, trash } = await skuSearch(v);
  const hit = (x) => skuKey(x.sku) === skuKey(v) && x.id !== r?.id;
  const a = live.find(hit); const b = trash.find(hit);
  if (a) return `Такой артикул уже есть: «${a.name}» (арт. ${a.sku}) — сохранить с ним не получится`;
  if (b) return `Такой артикул у изделия в корзине: «${b.name}» — восстановите его вместо нового`;
  return null;
};

/**
 * Форма изделия для mountList (`products.form`). ФИО → id сотрудника («Кто проектировал») держит замыкание этой фабрики:
 * fields() заполняет, toBody() читает — модульной переменной нет.
 */
export function productForm() {
  let designerIds = new Map();
  return {
    // ФИ: раздел, группа, серия, цвета, размеры — списки из того, что уже есть (одно написание); своё вписать можно
    fields: async (r) => {
      const [fv, md, staff, pdCats] = await Promise.all([formValues(), loadMaterialDicts(), staffOptions(), passportCategoryOptions()]);
      // ПП: «Кто проектировал» — из «Сотрудников», выбор с поиском; пусто — можно
      const people = staff.filter((p) => !p.fired); // в выборе — работающие; уже указанный уволенный остаётся (сопоставление — по всем)
      designerIds = new Map(staff.map((p) => [p.label, p.value]));
      // «Паспорт»: категория и выбор текстов воронки — паспорт возьмёт их из изделия сам
      const pd0 = r?.passportDefaults || {}; let pdFunnel = null;
      const [els, elRows, inst, catRows] = await Promise.all([dictOpts('passportElements'), dictRows('passportElements'), dictOpts('passportInstall'), dictRows('passportCategories')]);
      let pdElPick = null;
      let matCat = pd0.passportCategory || r?.passportCategory?.code || '';
      const pc = r?.passportCategory;
      const sim = similarBox({ onPick: (it) => go('products', { open: it.id }) });
      const catHint = pc?.own ? 'Задана в самом изделии. Паспорт берёт категорию отсюда' : pc?.inherited || pc?.code ? 'Сейчас — по группе или разделу. Укажите свою, если нужна другая. Паспорт берёт категорию отсюда' : 'Обычно определяется по разделу и группе; укажите, если нужна другая. Паспорт берёт категорию отсюда';
      return [
        { section: 'Изделие', tone: 'main', fixed: true },
        { key: 'photos', label: 'Фото изделия', type: 'photos', main: true, hint: 'Первое фото — главное: оно на обложке в списках. Чтобы выбрать другое, нажмите ☆ на нужном фото.' },
        { key: 'name', label: 'Короткое название', required: true, max: 256, span: 3, hint: 'Для списков, фильтров, поиска и паспорта' },
        { key: '_similar', type: 'widget', wide: true, summary: () => '', widget: () => ({ el: sim.el, value: '' }),
          mount: (api) => { const run = () => sim.check(api.get('name'), r?.id); api.on('name', run); run(); } },
        { key: 'type', label: 'Тип оборудования', type: 'combo', required: true, max: 100, options: fv.sections.map(opt), hint: 'Из списка или своё; серым — сколько изделий и категория паспорта' },
        { key: 'group', label: 'Группа изделий', type: 'combo', max: 100, options: groupsOf(fv), hint: 'Только группы выбранного типа; тип не выбран — все' },
        { key: 'series', label: 'Название серии', type: 'combo', max: 100, options: fv.series.map(opt), strict: true, strictText: 'Выберите серию из справочника', extra: () => [{ label: 'Открыть справочник серий', run: () => go('dicts', { d: 'productSeries' }) }], hint: 'Нет нужной — добавьте в справочнике. Справочник серий не привязан к группам' },
        { key: 'sku', label: 'Артикул', max: 64, span: 1, warn: skuTaken(r), hint: 'Оставьте пустым — присвоится по номеру группы (временный «ПС-…» заменится)', mount: skuButton(r) },
        { key: 'status', label: 'Статус', type: 'segment', options: [{ value: 'draft', label: 'Черновик' }, { value: 'active', label: 'В продаже', tone: 'ok' }, { value: 'archived', label: 'Архив' }],
          hint: 'С ценой черновик сам становится «в продаже»' },
        { section: 'Цена', tone: 'money' },
        { key: 'price', money: true, label: 'Цена, ₽', type: 'money', min: 0, hint: 'Без цены изделие — черновик' },
        ...(session.canMoney ? [{ key: '_cost', type: 'widget', label: 'Себестоимость материалов', wide: true, widget: () => costInfo(r), summary: () => '' }] : []),
        { section: 'Паспорт', tone: 'info', collapsed: !Object.keys(pd0).length },
        { key: 'pdCategory', label: 'Категория паспорта', type: 'select', options: pdCats, hint: catHint,
          mount: (api) => {
            // гарантия и срок службы пустые — берём из категории паспорта (справочник), помечаем «из категории»; ручной ввод главнее
            const fill = () => {
              const code = api.get('pdCategory') || r?.passportCategory?.code || '';
              const row = catRows.find((c) => String(c.code) === String(code)); if (!row) return;
              for (const [k, v] of [['pdWarranty', row.warrantyMonths], ['pdLife', row.serviceLifeYears]]) {
                if (v == null || v === '' || api.manual(k)) continue;
                const cur = api.get(k); if (cur !== '' && !api.input(k)?.classList?.contains('is-default')) continue;
                if (String(cur) !== String(v)) api.set(k, v, { auto: true, src: 'из категории' });
              }
            };
            api.on('pdCategory', () => {
              matCat = api.get('pdCategory') || r?.passportCategory?.code || '';
              pdFunnel?.setCategory(api.get('pdCategory'));
              fill();
            }); fill();
          } },
        { key: 'pdChoices', label: 'Тексты паспорта — выбор (монтаж, назначение…)', type: 'widget', wide: true, summary: () => '',
          widget: (v) => (pdFunnel = funnelBox({ value: v, category: pd0.passportCategory || r?.passportCategory?.code || '', canEditText: canEditPassportTexts(), productId: r?.id || '' })),
          // выбранная «Установка» задаёт способ установки сама (сервер так и делает) — отдельный список не нужен
          mount: (api) => {
            const sync = () => {
              const id = pdFunnel?.installTypeId() || '';
              const f = api.field('pdInstall'); if (f) f.hidden = !!id;
              if (id && api.get('pdInstall') !== id) api.set('pdInstall', id);
            };
            api.on('pdChoices', sync); sync();
          } },
        { key: 'pdWarranty', label: 'Гарантия, мес.', type: 'number', min: 0, span: 1 },
        { key: 'pdLife', label: 'Срок службы, лет', type: 'number', min: 0, span: 1 },
        { key: 'pdInstall', label: 'Способ установки', type: 'select', options: [{ value: '', label: '—' }, ...inst.map((o) => ({ value: o.value, label: o.label }))], hint: 'Определяет схему монтажа в паспорте',
          mount: (api) => {
            const sel = api.input('pdInstall');
            const sync = () => {
              if (!sel) return;
              const code = api.get('pdCategory') || r?.passportCategory?.code || '';
              const cur = sel.value;
              const own = (o) => !code || !(o.cats || []).length || o.cats.includes(code);
              const list = inst.filter((o) => own(o) || o.value === cur);
              sel.replaceChildren(h('option', { value: '' }, '—'), ...list.map((o) => h('option', { value: o.value }, own(o) ? o.label : `${o.label} — не для этой категории`)));
              sel.value = cur;
            };
            api.on('pdCategory', sync); sync();
          } },
        { key: 'pdJoints', label: 'Как соединено (для паспорта)', type: 'widget', wide: true, summary: () => '', widget: (v) => jointsPick(v), hint: 'Болты, сварка или цельное (без крепежа) — можно несколько. Паспорт подставит это сам и выберет подходящие пункты текста' },
        { key: 'pdKit', label: 'Поставляется разобранным', type: 'segment', options: [{ value: 'no', label: 'Нет' }, { value: 'yes', label: 'Да — нужна схема сборки' }] },
        { section: 'Функциональные элементы', tone: 'info' },
        { key: 'pdElements', label: 'Что это за изделие', type: 'widget', wide: true, summary: () => '',
          widget: (v) => (pdElPick = withElementTexts(tagPick({ options: els, value: v, label: 'Что это за изделие', productOnly: true }), elRows, v)),
          hint: 'Только виды своей категории паспорта (для тренажёра — тренажёры, без якорей и беседок). Ниже — фраза для описания и правила пользования из справочника.',
          mount: (api) => {
            const sync = () => {
              const code = api.get('pdCategory') || r?.passportCategory?.code || '';
              pdElPick?.setScope(code);
            };
            api.on('pdCategory', sync); sync();
          } },
        { section: 'Характеристики', tone: 'info' },
        { key: 'dimL', label: 'Длина', type: 'number', min: 0, span: 1 },
        { key: 'dimW', label: 'Ширина', type: 'number', min: 0, span: 1 },
        { key: 'dimH', label: 'Высота', type: 'number', min: 0, span: 1 },
        { key: 'dimUnit', label: 'Ед. изм. габаритов', type: 'combo', max: 10, span: 1, options: ['мм', 'см', 'м'] },
        { key: 'weightKg', label: 'Вес, кг', type: 'number', min: 0, span: 1 },
        { key: 'unit', label: 'Ед. изм.', type: 'combo', max: 20, span: 1, options: (fv.units || []).map(opt) },
        { key: 'ralCode', label: 'RAL', type: 'combo', max: 100, options: (fv.ral || []).map(opt), load: dictNames('colors'), hint: 'Основной цвет покрытия: RAL 6005' },
        { section: 'Описание и материалы', tone: 'info', collapsed: !(r?.purpose || r?.installation || r?.materialsSpec || r?.description) },
        // МИ.2: материалы таблицей — текст «Изготовлено из…» собирается сам (сервер), паспорт берёт его из изделия
        { key: 'materialsSpec', label: 'Материалы изделия', type: 'widget', wide: true, summary: specSummary,
          widget: (v) => materialsSpec({ value: v, dicts: md, text: r?.materialsText || '', scope: () => matCat || r?.passportCategory?.code || '', actions: r ? [fromComposition(r)] : [] }),
          hint: r ? 'Материал — из справочника; размеры и части — выбрать или вписать (Enter). «Взять из состава» — строки по материалам состава изделия' : 'Материал — из справочника; размеры и части — выбрать или вписать (Enter). «Взять из состава» — после «Создать», когда заполнен состав' },
        { key: 'purpose', label: 'Назначение', type: 'textarea', wide: true, rows: 2, max: 1000, phrases: { load: phrases('purpose'), by: 'group', title: 'Варианты' } },
        { key: 'installation', label: 'Монтаж', type: 'textarea', wide: true, rows: 2, max: 1000, phrases: { load: phrases('installationMethod'), by: 'group', title: 'Варианты' } },
        { key: 'description', label: 'Описание', type: 'textarea', wide: true, hint: r ? '' : 'Состав — в карточке сразу после «Создать»' },
        { section: 'Ещё', tone: 'info', collapsed: !(r?.orderName || r?.colors?.length || r?.sizes?.length || r?.designer || r?.notes) },
        { key: 'orderName', label: 'Название в договоре', max: 500, span: 3, hint: 'Как изделие называется в договорах заказчика — по нему система предлагает сопоставление. Пусто — берётся короткое' },
        { key: 'colors', label: 'Цвета (варианты)', type: 'combo', multi: true, max: 500, options: fv.colors.map(opt), load: dictNames('colors'), hint: 'Выберите несколько или впишите через запятую' },
        { key: 'sizes', label: 'Размеры (варианты)', type: 'combo', multi: true, max: 500, options: fv.sizes.map(opt), hint: 'Выберите несколько или впишите через запятую: 3×2 м, 4×2 м' },
        { key: 'designerName', label: 'Кто проектировал', type: 'combo', options: people, strict: true, strictText: 'Выберите сотрудника из списка или оставьте пустым', hint: 'К кому идти, если в паспорте не хватает данных. В паспорт не входит' },
        { key: 'notes', label: 'Примечание', type: 'textarea', wide: true, rows: 2, max: 2000 },
      ];
    },
    initial: () => ({ status: 'draft', unit: 'шт', dimUnit: 'мм', ...(pendingProduct()?.initial || {}) }),
    toInitial: (r) => ({ ...r, pdCategory: r.passportDefaults?.passportCategory || r.passportCategory?.code || '', pdChoices: JSON.stringify(r.passportDefaults?.textChoices || {}), pdWarranty: r.passportDefaults?.warrantyMonths ?? '', pdLife: r.passportDefaults?.serviceLifeYears ?? '', pdInstall: r.passportDefaults?.installationTypeId ? String(r.passportDefaults.installationTypeId) : '', pdKit: r.passportDefaults?.isKit ? 'yes' : 'no', pdElements: (r.passportDefaults?.elements || []).map(String), pdJoints: (r.passportDefaults?.joints || []).map(String), designerName: r.designer?.name || '', colors: (r.colors || []).join(', '), sizes: (r.sizes || []).join(', '),
      status: ['draft', 'active', 'archived'].includes(r.status) ? r.status : r.price ? 'active' : 'draft',
      dimL: r.dimensions?.length ?? '', dimW: r.dimensions?.width ?? '', dimH: r.dimensions?.height ?? '', dimUnit: r.dimensions?.unit || 'мм', weightKg: r.weightKg ?? '' }),
    toBody: (v, r) => ({ ...specBody(v, r), photoIds: v.photos || [], sku: v.sku, name: v.name, orderName: v.orderName || '', type: v.type || '', group: v.group || '', series: v.series || '', price: v.price ?? null, colors: v.colors || '', sizes: v.sizes || '', description: v.description || '', notes: v.notes || '',
      designerId: v.designerName ? designerIds.get(String(v.designerName).trim()) || null : '',
      status: v.status || 'draft', unit: v.unit || 'шт', ralCode: v.ralCode || '', weightKg: v.weightKg ?? null, purpose: v.purpose || '', installation: v.installation || '',
      dimensions: { length: v.dimL ?? null, width: v.dimW ?? null, height: v.dimH ?? null, unit: v.dimUnit || 'мм' },
      _pd: { over: { warrantyMonths: v.pdWarranty ?? null, serviceLifeYears: v.pdLife ?? null, installationTypeId: v.pdInstall || '', elements: Array.isArray(v.pdElements) ? v.pdElements : [], joints: Array.isArray(v.pdJoints) ? v.pdJoints : [], isKit: v.pdKit === 'yes' }, category: v.pdCategory || '', choices: v.pdChoices && typeof v.pdChoices === 'object' ? v.pdChoices : {}, derived: r?.passportCategory?.code || '', prev: r?.passportDefaults || {} } }),
    create: async (b0) => {
      const { _pd, ...b } = b0;
      const res = await createProduct(b);
      if (_pd.category || Object.keys(_pd.choices).length || Object.values(_pd.over).some((x) => x && !(Array.isArray(x) && !x.length))) await savePd(res.id, { ..._pd, prev: {} });
      const p = takePending();
      if (p) setTimeout(() => p.then(res), 50); // вернуться в паспорт, из которого создавали
      return res;
    },
    update: async (id, b0) => {
      const { _pd, ...b } = b0;
      const res = await patchProduct(id, b);
      await savePd(id, _pd);
      return res;
    },
  };
}

/** БЗ-9: поля массового изменения изделий — общие для всех выбранных. */
export async function productBulkFields() {
  const [fv, staffAll, cats] = await Promise.all([formValues(), staffOptions(), passportCategoryOptions()]);
  const staff = staffAll.filter((p) => !p.fired);
  const ids = new Map(staff.map((p) => [p.label, p.value]));
  const n = (v) => (v === '' ? null : v);
  return [
    { key: 'type', label: 'Тип оборудования', type: 'combo', options: fv.sections.map((x) => x.value), hint: 'Группа у каждого изделия останется своя' },
    { key: 'group', label: 'Группа изделий', type: 'combo', options: fv.groups.map((g) => ({ value: g.value, label: g.value, sub: g.section })), hint: 'Тип у каждого изделия останется свой' },
    { key: 'series', label: 'Название серии', type: 'combo', options: fv.series.map((x) => x.value), strict: true, strictText: 'Выберите серию из справочника', extra: () => [{ label: 'Открыть справочник серий', run: () => go('dicts', { d: 'productSeries' }) }], hint: 'Нет нужной — добавьте в справочнике' },
    { key: 'status', label: 'Статус', type: 'select', options: [{ value: 'draft', label: 'Черновик' }, { value: 'active', label: 'В продаже' }, { value: 'archived', label: 'Архив' }] },
    { key: 'price', money: true, label: 'Цена, ₽ — одна для всех', type: 'number', map: n },
    { key: 'designerId', label: 'Кто проектировал', type: 'combo', options: staff.map((p) => ({ value: p.value, label: p.label, sub: p.sub })), map: (v) => (v ? ids.get(v) || '' : ''), hint: 'Пусто — снять' },
    { key: 'unit', label: 'Ед. изм.', type: 'combo', options: (fv.units || []).map((x) => x.value) },
    { key: 'ralCode', label: 'RAL', type: 'combo', options: (fv.ral || []).map((x) => x.value) },
    { key: 'colors', label: 'Цвета (варианты)', type: 'list', modes: true, map: (v) => v },
    { key: 'sizes', label: 'Размеры (варианты)', type: 'list', modes: true, map: (v) => v },
    { key: 'pd.passportCategory', label: 'Паспорт по умолчанию: категория', type: 'select', options: cats },
    { key: 'pd.serviceLifeYears', label: 'Паспорт по умолчанию: срок службы, лет', type: 'number', map: n },
    { key: 'pd.warrantyMonths', label: 'Паспорт по умолчанию: гарантия, мес.', type: 'number', map: n },
  ];
}
