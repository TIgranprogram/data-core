import { api } from '../../core/api.js';
import { h } from '../../core/dom.js';
import { isoDay } from '../../core/format.js';
import { rowsTable } from '../../ui/rows-table.js';
import { tagPick } from '../../ui/tag-pick.js';
import { formImages, imagesBody } from '../../core/passport-images.js';
import { toast, toastError } from '../../ui/toast.js';
import { personNames } from '../../ui/dict-options.js';
import { CAT_NAMES } from '../../core/passport-kinds.js';
import { AFTER_PRINT, BOM_COLS, LATER_CATS, V2_CATS, V2_NUMS, bomRows, buildDescription, canEdit, categories, dictOpts, facets, imgsOf, isIssued, kindOf, kinds, keyLines, num, ourCompanies, parseBom, reqKinds, st, dictRows } from './common.js';
import { models, orders, phrases } from './models.js';
import { productBlock } from './product-block.js';
import { wireForm } from './wire-form.js';
import { materialsFields, specBody } from './materials.js';
import { loadMaterialDicts } from '../../ui/materials-spec.js';
import { funnelBox } from '../../ui/funnel.js';

/** Форма паспорта: поля, сборка тела запроса, создание и сохранение. */
/** ПИ.4: значения по умолчанию паспорта — изделию (заменяются целиком; пустые не пишутся сервером). */
export async function saveDefaults({ productId, defaults }) {
  try { await api(`/showcase/${productId}/passport-defaults`, { method: 'PUT', body: defaults }); toast('Запомнено для следующих паспортов изделия'); }
  catch (e) { toastError(e); }
}
/** Паспорт v2 (БЗ-6 Э5a1): поля формы ↔ тело запроса. */
export function v2Initial(r) {
  return {
    passportCategory: r.passportCategory || '', elements: (r.elements || []).map(String), materialIds: (r.materialIds || []).map(String),
    installationTypeId: r.installationTypeId ? String(r.installationTypeId) : '', isKit: r.isKit ? 'yes' : 'no', schemeSource: r.schemeSource === 'own' ? 'own' : 'standard',
    ...Object.fromEntries(V2_NUMS.map(([k]) => [k, num(r[k])])), textChoices: JSON.stringify(r.textChoices || {}),
    certNumber: r.certificate?.number || '', certUntil: r.certificate?.until ? String(r.certificate.until).slice(0, 10) : '', certEac: r.certificate?.hasEac ? 'yes' : 'no',
  };
}
export function v2Body(v) {
  const b = {
    elements: Array.isArray(v.elements) ? v.elements : [], materialIds: Array.isArray(v.materialIds) ? v.materialIds : [],
    isKit: v.isKit === 'yes', textChoices: v.textChoices && typeof v.textChoices === 'object' ? v.textChoices : {},
    schemeSource: v.schemeSource === 'own' ? 'own' : 'standard',
    ...Object.fromEntries(V2_NUMS.filter(([k]) => v[k] !== null && v[k] !== undefined && v[k] !== '').map(([k]) => [k, v[k]])),
  };
  if (v.passportCategory) b.passportCategory = v.passportCategory;
  if (v.installationTypeId) b.installationTypeId = v.installationTypeId;
  // сертификат (Э9): без номера — пусто (ЕАС без номера не ставим)
  b.certificate = v.certNumber ? { number: String(v.certNumber).trim(), ...(v.certUntil ? { until: v.certUntil } : {}), hasEac: v.certEac === 'yes' } : {};
  return b;
}
export const passportForm = {
  fields: async (r) => {
    const [cats, ours, f] = await Promise.all([categories(), ourCompanies(), facets()]);
    const [els, mats, inst, catRows, stdRows, md] = await Promise.all([dictOpts('passportElements'), dictOpts('passportMaterials'), dictOpts('passportInstall'), dictRows('passportCategories'), dictRows('passportStandards'), loadMaterialDicts()]);
    // МИ.4: выпущенный (без «Новой редакции») — как был: метки и свободный текст; невыпущенный — таблица и собранный текст
    const legacy = !!r && isIssued(r) && st.revisionFor !== r.id;
    const ctx = { cat: () => '', ms: null, api: null };
    const materialsText = { key: 'materials', label: legacy ? 'Материалы («изготовленное из …»)' : 'Материалы — текст «изготовлено из…»', type: 'textarea', wide: true, max: 2000, phrases: { load: phrases('materials'), by: 'passportCategory', label: (c) => CAT_NAMES[c] || c, title: 'Варианты' },
      hint: legacy ? undefined : 'Собирается из таблицы выше; можно поправить вручную — таблица правку не перетрёт' };
    const catBy = new Map(catRows.map((c) => [String(c.code), c]));
    const stdName = new Map(stdRows.map((s) => [String(s.code), s.name]));
    // ФП: виджеты, которые меняет выбор категории, и «готовность к выпуску»
    const w = { el: null, mat: null, funnel: null, std: h('p', { class: 'muted' }, 'Выберите категорию — здесь появятся её нормативы'), need: h('div', { class: 'muted' }, 'Проверяю…') };
    const startCat = r ? r.passportCategory || '' : st.newCat;
    const req = reqKinds(catBy.get(startCat), r?.isKit);
    const mainKinds = new Set(['overview', ...req]);
    // воронка: категория → шаги «выбрал 1 из 2–3» (ui/funnel.js); выбор пишется в textChoices
    const funnelFields = [
      { section: 'Паспорт: категория и тексты', tone: 'main', fixed: true },
      // детские (ДИО, ДСО) отложены пользователем (QUESTIONS 2026-10-22) — не предлагаем, но уже выбранную не скрываем
      { key: 'passportCategory', label: 'Категория паспорта', type: 'segment', options: V2_CATS.filter((c) => (c.value && !LATER_CATS.includes(c.value)) || (r && r.passportCategory === c.value) || (!r && st.newCat === c.value)), wide: true,
        hint: 'От неё зависят шаги ниже, нормативы, обязательные рисунки и поля',
        mount: (api) => wireForm(api, { r, w, catBy, stdName, inst, cats }) },
      { key: 'textChoices', label: 'Тексты паспорта — ваш выбор', type: 'widget', wide: true, summary: () => '',
        widget: (v) => (w.funnel = funnelBox({ value: v, category: startCat, canEditText: canEdit() })) },
      { key: '_std', label: 'Нормативы категории', type: 'widget', wide: true, widget: () => ({ el: w.std, value: '' }), summary: () => '' },
    ];
    const v2Fields = [
      { section: 'Состав и материалы', tone: 'main', collapsed: true },
      { key: 'elements', label: 'Функциональные элементы', type: 'widget', wide: true, widget: (v) => (w.el = tagPick({ options: els, value: v, label: 'Функциональные элементы' })) },
      ...(legacy ? [{ key: 'materialIds', label: 'Материалы', type: 'widget', wide: true, widget: (v) => (w.mat = tagPick({ options: mats, value: v, label: 'Материалы' })) }]
        : [...materialsFields({ r, md, ctx }), materialsText]),
      { key: 'installationTypeId', label: 'Способ установки', type: 'select', options: [{ value: '', label: '—' }, ...inst.map((o) => ({ value: o.value, label: o.label }))] },
      { key: 'isKit', label: 'Поставляется разобранным', type: 'segment', options: [{ value: 'no', label: 'Нет' }, { value: 'yes', label: 'Да — нужна схема сборки' }] },
      { key: 'schemeSource', label: 'Схемы узлов (фундамент, скважины, монтаж)', type: 'segment', options: [{ value: 'standard', label: 'Стандартные, если нет своих' }, { value: 'own', label: 'Только свои' }],
        hint: 'Стандартные схемы — в «Справочники → Паспорта → Способы установки»' },
      // «заполнено 4 из 6» — по полям категории (справочник «Категории паспортов → Поля категории»)
      { section: 'Ограничения и техданные', tone: 'info', collapsed: true, sumOf: (get) => {
        const c = catBy.get(get('passportCategory')); const allowed = keyLines(c?.allowedFields); const need = keyLines(c?.requiredFields);
        const own = V2_NUMS.map(([k]) => k).filter((k) => !c || !allowed.length || allowed.includes(k) || need.includes(k));
        const filled = own.filter((k) => String(get(k) ?? '').trim() !== '').length;
        return own.length ? `заполнено ${filled} из ${own.length}` : '';
      } },
      ...V2_NUMS.map(([key, label, hint]) => ({ key, label, type: 'number', min: 0, span: 1, hint: hint || undefined })),
      { section: 'Сертификат / декларация', tone: 'info', collapsed: !r?.certificate?.number },
      { key: 'certNumber', label: 'Номер сертификата или декларации', max: 100, hint: 'Пусто — раздел «Идентификационные сведения» и знак ЕАС не печатаются' },
      { key: 'certUntil', label: 'Действует до', type: 'date' },
      { key: 'certEac', label: 'Знак ЕАС', type: 'segment', options: [{ value: 'no', label: 'Не ставить' }, { value: 'yes', label: 'Ставить' }] },
    ];
    // ПИ.4: правили «умолчательные» поля паспорта с изделием — запомнить их у изделия для следующих паспортов
    const remember = { key: '_remember', label: 'Запомнить для следующих паспортов этого изделия', type: 'segment', wide: true,
      options: [{ value: 'no', label: 'Нет' }, { value: 'yes', label: 'Да — категория, состав, ограничения, срок, гарантия' }],
      hint: 'Появляется, если вы поправили подставленное. Запишется в изделие — следующий паспорт подставит это сам' };
    return [
      // ФП: что ещё нужно для выпуска — ссылки к полям; обновляется при каждом изменении формы
      { key: '_need', label: 'Готовность к выпуску', type: 'widget', wide: true, widget: () => ({ el: w.need, value: '' }), summary: () => '' },
      // ПИ: сначала изделие — из него заполняется паспорт
      { section: 'Изделие', tone: 'main', fixed: true },
      { key: '_product', label: r ? 'Изделие' : 'Изделие из «Продукции»', type: 'widget', wide: true, widget: () => ({ el: h('div', { class: 'pp-prod' }), value: '' }), summary: () => '',
        mount: (api) => productBlock(api, { r, catBy }) },
      { key: '_searchName', type: 'hidden' },
      ...funnelFields,
      // изделие — главный источник: здесь сводка в одну строку (ниже в блоке «Изделие»), поля — свёрнуты «Править здесь»
      { section: 'Данные изделия — править в изделии', tone: 'main', collapsed: true },
      { key: '_copyFrom', type: 'hidden' }, { key: '_imgsFrom', type: 'hidden' }, { key: 'productId', type: 'hidden' }, { key: 'salesOrderId', type: 'hidden' },
      { key: 'name', label: 'Наименование', required: true, wide: true, max: 500,
        hint: r ? undefined : 'Заполнено из изделия. Запасной путь — начните печатать и возьмите данные из прошлого паспорта с таким наименованием',
        suggest: r ? undefined : models, suggestKeep: true, suggestTitle: 'Взять из прошлого паспорта (запасной путь): подставится всё, кроме заказчика и даты; поправленное вами не затрётся', suggestFocus: 'customerName' },
      { key: 'category', label: 'Раздел каталога (как в «Продукции»)', type: 'combo', options: cats, max: 200, hint: 'Только для списков и поиска; на разделы паспорта не влияет' },
      { key: 'article', label: 'Артикул', max: 50 },
      { key: 'height', label: 'Высота, мм', type: 'number', min: 0, span: 1 },
      { key: 'length', label: 'Длина, мм', type: 'number', min: 0, span: 1 },
      { key: 'width', label: 'Ширина, мм', type: 'number', min: 0, span: 1 },
      { key: 'weight', label: 'Вес, кг', type: 'number', min: 0, span: 1 },
      ...v2Fields, remember,
      // ПП: выпуск — дата (номер талона), поставщик, гарантия; кому и куда — в «после печати» (можно от руки)
      { section: 'Выпуск', tone: 'who' },
      ...(r ? [] : [{ key: 'date', label: 'Дата выпуска', type: 'date', required: true, hint: 'По дате и номеру строится гарантийный талон' }]),
      { key: 'supplierOrgId', label: 'Поставщик (наша компания)', type: 'select', options: ours.map((o) => ({ value: o.id, label: o.name })), hint: 'Реквизиты, печать и подпись в PDF — из карточки компании' },
      { key: 'warrantyMonths', label: 'Гарантия, мес.', type: 'number', min: 0, span: 1 },
      // свой текст — запасной путь: обычно хватает выбора выше; паспорт будет помечен «изменено вручную»
      { section: 'Свой текст вместо выбранного', tone: 'info', collapsed: !(r && r.manualText?.length) },
      { key: '_manualText', label: 'Свой текст для этого паспорта', type: 'segment', options: [{ value: 'no', label: 'Нет — из выбранного выше' }, { value: 'yes', label: 'Да — изменено вручную' }], wide: true,
        hint: 'Включается сам, когда начинаете печатать ниже. Новую формулировку лучше добавить в «Справочники → Тексты паспорта»' },
      { key: 'installationMethod', label: 'Монтаж — свой текст', type: 'textarea', wide: true, rows: 3, max: 1000 },
      { key: 'purpose', label: 'Назначение — свой текст', type: 'textarea', wide: true, rows: 3, max: 1000 },
      { section: 'Описание (раздел 1)', tone: 'info', collapsed: !!r },
      ...(legacy ? [materialsText] : []),
      { key: 'description', label: 'Описание целиком (раздел 1.1 паспорта)', type: 'textarea', wide: true, rows: 5, max: 4000, compose: { from: ['name', 'materials', 'installationMethod', 'purpose'], build: buildDescription },
        hint: 'Собирается само из наименования, материалов, установки и назначения; можно поправить вручную' },
      // ФП: обязательные для категории (*) и «Общий вид» — сразу; остальные — в свёрнутом «Ещё картинки»; вставка Ctrl+V — в вид под курсором
      { section: 'Картинки', tone: 'info', collapsed: !!r },
      ...kinds({ requiredImages: req }).filter(([k]) => mainKinds.has(k)).map(([kind, label, where]) => ({ key: 'img_' + kind, label: `${label}${req.includes(kind) ? ' *' : ''}`, type: 'photos', hint: `${where}${req.includes(kind) ? ' · обязательно для категории' : ''}` })),
      { section: 'Ещё картинки', tone: 'info', collapsed: true },
      ...kinds({ requiredImages: req }).filter(([k]) => !mainKinds.has(k)).map(([kind, label, where]) => ({ key: 'img_' + kind, label, type: 'photos', hint: where })),
      { section: 'Комплектность', tone: 'who', collapsed: true },
      { key: 'bom', label: 'Комплектность изделия (таблица 5)', type: 'widget', wide: true,
        widget: (v) => rowsTable({ columns: BOM_COLS, rows: v, file: 'Шаблон комплектности', example: ['И-1', 'Изделие в сборе', 1, 'шт.', ''] }),
        hint: 'Пусто — «И-1 · Изделие в сборе · 1 шт.». Можно вставить строки из Excel (Ctrl+V в ячейку) или загрузить заполненный шаблон' },
      // ПП: заполняется после печати — пусто → в PDF линия для ручки, заполнено → значение; выпуск не блокирует
      { section: 'Заполняется после печати — можно от руки', tone: 'info', collapsed: !(r && (r.saleDate || r.customerName || r.orderNo || r.objectName || r.installedBy || r.installedAt || r.note)) },
      { key: '_afterHint', type: 'widget', wide: true, label: '', widget: () => ({ el: h('p', { class: 'hint' }, 'Если заполнить — подставится в паспорт. Пусто — в PDF будет линия, впишут ручкой при продаже и монтаже. Выпуск не задерживает.'), value: '' }), summary: () => '' },
      { key: 'saleDate', label: 'Дата продажи', type: 'date', span: 1 },
      { key: 'customerName', label: 'Покупатель (заказчик)', type: 'combo', options: f.customers.map((c) => c.value), max: 300 },
      { key: 'orderNo', label: '№ заказа', max: 50, span: 1, suggest: orders, suggestTitle: 'Заказы — выбор подставит покупателя', hint: 'Начните печатать номер или заказчика' },
      { key: 'objectName', label: 'Адрес установки', wide: true, max: 500 },
      { key: 'installedBy', label: 'Монтаж выполнил', type: 'combo', max: 300, load: personNames, hint: 'Сотрудник из списка или свой вариант (подрядчик)' },
      { key: 'installedAt', label: 'Дата монтажа', type: 'date', span: 1 },
      { key: 'note', label: 'Заметки', type: 'textarea', wide: true, rows: 3, max: 4000, hint: 'Попадут в паспорт на лист «Для заметок»; пусто — листа не будет' },
    ];
  },
  // поставщик по умолчанию — наша компания, у которой больше всего паспортов (у модели свой — подставится при выборе)
  // черновик «Выпустить паспорт» (issuePassport) — поверх, пустые значения не затирают умолчания
  initial: async () => {
    const d = st.draft; st.draft = null;
    st.newCat = d?.passportCategory || '';
    return { _manualText: 'no', date: isoDay(), warrantyMonths: '12', supplierOrgId: (await facets()).suppliers[0]?.value || '',
      ...Object.fromEntries(Object.entries(d || {}).filter(([, v]) => v !== '' && v !== null && v !== undefined)) };
  },
  toInitial: (r) => ({ ...r, saleDate: r.saleDate ? String(r.saleDate).slice(0, 10) : '', installedAt: r.installedAt ? String(r.installedAt).slice(0, 10) : '', height: num(r.height), length: num(r.length), width: num(r.width), weight: num(r.weight), warrantyMonths: num(r.warrantyMonths ?? 12), bom: bomRows(r.bom),
    ...v2Initial(r), _manualText: r.manualText?.length ? 'yes' : 'no', _mspec: r.materialsSpec || '',
    ...Object.fromEntries(kinds().map(([kind]) => ['img_' + kind, imgsOf(r, kind).filter((i) => i.url).map((i) => ({ id: String(i.photoId), url: i.url, thumb: i.url }))])) }),
  // ФП: картинки — каждая в своём виде (formImages); у модели они уже разложены в форме (_imgsFrom) — отправляем как есть
  toBody: (v, r) => {
    const s = (x) => (x === null || x === undefined ? '' : String(x));
    const body = {
      name: s(v.name), category: s(v.category), article: s(v.article), materials: s(v.materials),
      // «Монтаж» и «Назначение» собирает сервер из выбора воронки (textChoices); свои слова уходят только при «Свой текст»
      ...(v._manualText === 'yes' ? { installationMethod: s(v.installationMethod), purpose: s(v.purpose) } : {}),
      customerName: s(v.customerName), orderNo: s(v.orderNo), objectName: s(v.objectName), note: s(v.note),
      saleDate: v.saleDate || null, installedBy: s(v.installedBy), installedAt: v.installedAt || null, // ПП: после печати
      ...(v.supplierOrgId ? { supplierOrgId: v.supplierOrgId } : {}),
      ...Object.fromEntries(['height', 'length', 'width', 'weight', 'warrantyMonths'].filter((k) => v[k] !== null && v[k] !== undefined).map((k) => [k, v[k]])),
    };
    const forDesc = { ...body, installationMethod: s(v.installationMethod), purpose: s(v.purpose) }; // описание собирается и из полей, которые сервер берёт из выбора
    body.description = s(v.description) || buildDescription(forDesc);
    // ТЭ-2: какие тексты не из справочника — видно в списке «изменено вручную»
    body.manualText = [...(v._manualText === 'yes' ? ['purpose', 'installationMethod'].filter((k) => s(body[k])) : []), ...(s(v.description) && s(v.description) !== buildDescription(forDesc) ? ['description'] : [])];
    const bom = parseBom(v.bom);
    if (bom.length || r) body.bom = bom;
    const shown = new Set(kinds().map(([k]) => k));
    // виды, которых нет в форме, сохраняются как были (safety_zone показан в «Зоне безопасности» — не «чужой»)
    const kept = imagesBody((r?.images || []).filter((i) => !shown.has(kindOf(i))));
    const images = [...formImages(v, kinds().map(([k]) => k)), ...kept];
    Object.assign(body, v2Body(v), specBody(v, r));
    const fromModel = !r && v._copyFrom && v._imgsFrom === v._copyFrom; // картинки модели уже в форме — список окончательный
    if (images.length || r || fromModel) body.images = images;
    if (fromModel) body._imagesFinal = true;
    if (!r && v.date) body.date = v.date;
    if (!r && v._copyFrom) body._copyFrom = v._copyFrom;
    if (!r && v.productId) body.productId = v.productId;
    if (!r && v.salesOrderId) body.salesOrderId = v.salesOrderId;
    if (r && isIssued(r)) body._issued = true;
    // ПИ.4: «Запомнить» — значения по умолчанию изделию (после сохранения паспорта)
    const pid = v.productId || r?.productId;
    if (v._remember === 'yes' && pid) {
      const b2 = v2Body(v);
      body._remember = { productId: String(pid), defaults: { ...(b2.passportCategory ? { passportCategory: b2.passportCategory } : {}), elements: b2.elements, materialIds: b2.materialIds,
        ...(b2.installationTypeId ? { installationTypeId: b2.installationTypeId } : {}), isKit: b2.isKit, textChoices: b2.textChoices, ...Object.fromEntries(V2_NUMS.map(([k]) => [k, b2[k]]).filter(([, x]) => x !== undefined)),
        ...(v.warrantyMonths !== null && v.warrantyMonths !== undefined ? { warrantyMonths: v.warrantyMonths } : {}) } };
    }
    return body;
  },
  create: async (body) => {
    const { _copyFrom, _imagesFinal, _remember, ...rest } = body;
    if (_remember) await saveDefaults(_remember);
    // ПП: карточке после сохранения — полный паспорт («не хватает», строгий выпуск), а не голый ответ создания
    const full = async (doc) => (doc?.id || doc?._id ? api(`/passports/${doc.id || doc._id}`) : doc);
    if (!_copyFrom) return full(await api('/passports', { method: 'POST', body: rest }));
    // модель выбрана: сервер берёт её поля; картинки модели уже разложены по видам в форме (_imagesFinal) — их и шлём;
    // не успели загрузиться — свои добавляются к картинкам модели (каждая в своём виде, без дублей)
    if (!_imagesFinal && rest.images?.length) {
      const m = await api(`/passports/${_copyFrom}`);
      const ks = [...new Set([...(m.images || []).map(kindOf), ...rest.images.map((i) => i.kind)])];
      const vals = {};
      for (const i of [...imagesBody(m.images || []).map((x) => ({ ...x, kind: kindOf(x) })), ...rest.images]) (vals['img_' + i.kind] ||= []).push(i.photoId);
      rest.images = formImages(vals, ks);
    }
    return full(await api(`/passports/${_copyFrom}/copy`, { method: 'POST', body: rest }));
  },
  update: async (id, body) => {
    const { _remember, _issued, ...rest } = body; if (_remember) await saveDefaults(_remember);
    const rev = st.revisionFor === id; st.revisionFor = null;
    // НМ-1: выпущенный без «Новой редакции» — отправляем только «после печати» (остальное заблокировано в форме)
    const send = _issued && !rev ? Object.fromEntries(Object.entries(rest).filter(([k]) => AFTER_PRINT.includes(k))) : rest;
    await api(`/passports/${id}`, { method: 'PATCH', body: send, query: rev ? { newRevision: 1 } : undefined });
    if (rev) toast('Новая редакция сохранена — номер тот же, прежняя редакция в истории');
    return api(`/passports/${id}`);
  },
};
