import { h } from '../../../core/dom.js';
import { buildForm, button, empty, enhanceSelect, link, row, section, select, sideNote, stack, toastError } from '../../../ui/kit/index.js';
import { V2_NUMS, dictRows } from '../common.js';
import { elementsTexts } from '../elements-block.js';
import { loadGaps, patchProduct, putDefaults, setFacets } from './api.js';

/**
 * Шаг 5 «Чего не хватает» (A3): только то, что у изделия пусто, блоками section. Ответ сразу пишется в изделие:
 * признак — facetValueIds (A4), поля/установка/элементы/категория — passportDefaults, рисунок — в карточке изделия.
 * Умолчания (срок службы, рост, вес, установка) стоят в поле серым и записываются кнопкой «Дальше» — или своей правкой.
 *   gapsBlock({ prod, onLoad(missing[]) }) → { el, reload(), commit() → оставшееся обязательное }
 */
/** Числа категории — в умолчания паспорта изделия (passportDefaults); остальное «поле» — в изделии. */
const CAT_NUMS = new Set([...V2_NUMS.map(([k]) => k), 'warrantyMonths']);
const toCard = (prod, text) => stack(sideNote(text), link({ label: 'Открыть карточку изделия →', href: '#products?open=' + prod.id, target: '_blank', title: 'Откроется в новой вкладке — паспорт здесь останется' }));
const num = (v) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) && String(v).trim() !== '' ? n : null; };

export function gapsBlock({ prod, onLoad }) {
  const box = h('div', null);
  let missing = [];
  const pending = new Map(); // key → значение по умолчанию, ещё не записанное

  /** Записать ответ и перечитать «чего не хватает». */
  async function save(job) {
    try { await job(); await reload(); } catch (e) { toastError(e, 'сохранить в изделие'); }
  }
  const optsOf = (m) => (m.options || []).map((o) => [o.id, o.label]);

  function control(m) {
    if (m.kind === 'image') return toCard(prod, 'Рисунок добавляется в карточке изделия — блок «Фото и рисунки».');
    if (m.kind === 'elements') {
      const view = elementsTexts([]);
      dictRows('passportElements').then((rows) => view.setRows(rows)).catch(() => {});
      const f = buildForm([{ key: 'els', label: 'Не больше трёх вариантов', type: 'combo', multi: true, options: optsOf(m).map(([value, label]) => ({ value, label })), hint: 'Начните печатать — список подскажет' }], {});
      f.el.addEventListener('change', () => {
        const names = String(f.read().values?.els || '').split(',').map((x) => x.trim()).filter(Boolean);
        const list = [...new Set(names.map((n) => (m.options || []).find((o) => o.label === n)?.id).filter(Boolean))].slice(0, 3);
        view.setIds(list);
        if (list.length) save(() => putDefaults(prod, { elements: list }));
      });
      return stack(sideNote('Укажите, что это за изделие (не больше трёх вариантов). Ниже — фраза для описания и правила пользования из справочника.'), f.el, view.el);
    }
    if (m.kind === 'field' && m.key === 'height') { // «Габариты»: три размера изделия, мм — в изделие
      const d = prod.dimensions && (prod.dimensions.unit || 'мм') === 'мм' ? prod.dimensions : {};
      const f = buildForm([['length', 'Длина, мм'], ['width', 'Ширина, мм'], ['height', 'Высота, мм']].map(([key, label]) => ({ key, label, type: 'number' })),
        { length: d.length ?? '', width: d.width ?? '', height: d.height ?? '' });
      f.el.addEventListener('change', () => {
        const v = f.read().values || {}; const dims = { length: num(v.length), width: num(v.width), height: num(v.height) };
        if (dims.length && dims.width && dims.height) save(() => patchProduct(prod.id, { dimensions: { ...dims, unit: 'мм' } }).then(() => { prod.dimensions = { ...dims, unit: 'мм' }; }));
      });
      return f.el;
    }
    if (m.kind === 'field' && m.key === 'weight') { // вес изделия — в изделие
      const f = buildForm([{ key: 'weightKg', label: 'Вес изделия, кг', type: 'number' }], {});
      f.el.addEventListener('change', () => { const v = num(f.read().values?.weightKg); if (v) save(() => patchProduct(prod.id, { weightKg: v }).then(() => { prod.weightKg = v; })); });
      return f.el;
    }
    if (m.kind === 'field' && !CAT_NUMS.has(m.key)) return toCard(prod, `«${m.label}» заполняется в карточке изделия.`);
    if (m.kind === 'field') {
      const f = buildForm([{ key: m.key, label: 'Значение', type: 'number', hint: m.default != null ? 'По умолчанию — можно не менять' : undefined }], m.default != null ? { [m.key]: m.default } : {});
      if (m.default != null) pending.set(m.key, { patch: { [m.key]: m.default } });
      f.el.addEventListener('change', () => { const v = num(f.read().values?.[m.key]); if (v !== null) { pending.delete(m.key); save(() => putDefaults(prod, { [m.key]: v })); } });
      return f.el;
    }
    // category · facet · install — выбор из списка
    const write = (v) => (m.kind === 'facet' ? setFacets(prod.id, [...(prod.facetValueIds || []), v]).then(() => { prod.facetValueIds = [...(prod.facetValueIds || []), v]; })
      : putDefaults(prod, m.kind === 'category' ? { passportCategory: v } : { installationTypeId: v }));
    const dflt = m.kind === 'install' && m.default ? String(m.default.id ?? m.default) : ''; // A3: default установки — { id, label }
    if (dflt) pending.set(m.key, { patch: { installationTypeId: dflt } });
    const sel = select({ label: m.label, options: [['', m.kind === 'category' ? 'Выберите категорию…' : 'Выберите…'], ...optsOf(m)], value: dflt, onChange: (v) => { pending.delete(m.key); if (v) save(() => write(v)); } });
    if ((m.options || []).length > 12) enhanceSelect(sel);
    return h('div', null, sel,
      m.suggest ? row({ tone: 'info', title: `Похоже: ${m.suggest.label} — верно?`, meta: m.suggest.word ? `по слову «${m.suggest.word}» в названии` : null,
        action: button({ label: 'Да, верно', size: 'S', onClick: () => save(() => write(m.suggest.id)) }) }) : null);
  }

  const rank = (m) => (m.kind === 'facet' ? 0 : m.kind === 'elements' ? 1 : 2); // признаки → «Что это за изделие» → остальное
  function paint() {
    if (!missing.length) { box.replaceChildren(empty({ title: 'Всё заполнено', hint: 'Для паспорта хватает данных изделия.' })); return; }
    box.replaceChildren(sideNote('Заполните только пустое — ответы сохраняются в изделие и больше не спрашиваются.'),
      ...[...missing].sort((a, b) => rank(a) - rank(b)).map((m) => section({ title: (m.kind === 'elements' ? 'Функциональные элементы' : m.label) + (m.required ? '' : ' — по желанию'), tone: m.required ? 'main' : 'neutral', open: !!m.required, body: control(m) })));
  }

  async function reload() {
    pending.clear();
    const g = await loadGaps(prod.id);
    missing = g.missing || [];
    prod.category = g.category;
    paint();
    onLoad?.(missing, g.category);
    return missing;
  }

  /** «Дальше»: записать нетронутые умолчания одним запросом, перечитать, вернуть обязательное, что осталось. */
  async function commit() {
    if (pending.size) { const change = Object.assign({}, ...[...pending.values()].map((p) => p.patch)); await putDefaults(prod, change); }
    return (await reload()).filter((m) => m.required);
  }
  return { el: box, reload, commit };
}
