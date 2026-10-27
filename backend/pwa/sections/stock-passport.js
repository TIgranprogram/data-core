import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { attachCombo } from '../ui/combo.js';
import { loadMaterialDicts, normSize, splitSizes } from '../ui/materials-spec.js';

/*
 * МЦ-3/МЦ-6: блок «Для паспорта» позиции склада — связь с материалом паспорта (materials.passportSpec).
 *   passportSpecField(row) → поле формы (type 'widget') | null;  savePassportSpec(id, json) → PATCH /materials/:id/passport-spec
 *   passportSpecView(r) → блок для карточки (читает GET /materials/:id).
 */
const norm = (t) => String(t || '').trim();
const origs = new Map();
const load = (id) => api(`/materials/${id}`).then((m) => m.passportSpec || null).catch(() => null);

/** Поле формы: материал (из справочника) · размеры · покрытие · два текста. value — JSON {materialId, sizes, isCoating, passportText, techText}. */
export async function passportSpecField(row) {
  if (!row?.id) return null;
  const [spec, dicts] = await Promise.all([load(row.id), loadMaterialDicts()]);
  const mats = dicts.mats;
  const byId = new Map(mats.map((m) => [String(m.id), m]));
  const st = { materialId: spec?.materialId ? String(spec.materialId) : '', sizes: spec?.sizes || [], isCoating: !!spec?.isCoating, passportText: spec?.passportText || '', techText: spec?.techText || '' };
  origs.set(row.id, JSON.stringify(st));
  const emit = (el) => el.dispatchEvent(new Event('input', { bubbles: true }));
  const el = h('div', { class: 'pspec' });
  const matIn = h('input', { placeholder: 'Не связан — выберите материал паспорта', 'aria-label': 'Материал паспорта' });
  matIn.value = byId.get(st.materialId)?.name || '';
  attachCombo(matIn, {
    options: () => mats.filter((m) => m.kind !== 'coating' || st.isCoating).map((m) => ({ value: String(m.id), label: m.name })),
    free: false,
    onPick: (o) => { st.materialId = o.value; matIn.value = o.label; emit(el); },
    empty: () => 'Нет такого материала — новый добавляют в «Справочники → Паспорта → Материалы и покрытия»',
  });
  matIn.addEventListener('input', () => { if (!matIn.value.trim() && st.materialId) { st.materialId = ''; emit(el); } });
  const sizes = h('input', { placeholder: '∅89×3; ∅33,5×2,8', value: st.sizes.join('; '), 'aria-label': 'Размеры' });
  sizes.addEventListener('input', () => { st.sizes = splitSizes(sizes.value); emit(el); });
  sizes.addEventListener('change', () => { sizes.value = st.sizes.map(normSize).join('; '); });
  const coat = h('input', { type: 'checkbox', checked: st.isCoating });
  coat.addEventListener('change', () => { st.isCoating = coat.checked; emit(el); });
  const area = (key, label, hint) => {
    const t = h('textarea', { rows: 3, 'aria-label': label }); t.value = st[key];
    t.addEventListener('input', () => { st[key] = t.value; emit(el); });
    return h('label', { class: 'field' }, h('span', null, label), t, h('small', { class: 'muted' }, hint));
  };
  el.append(
    h('label', { class: 'field' }, h('span', null, 'Материал паспорта'), matIn, h('small', { class: 'muted' }, 'Пусто — позиция не связана, «Взять из состава» только подскажет по названию')),
    h('label', { class: 'field' }, h('span', null, 'Размеры'), sizes, h('small', { class: 'muted' }, 'Через «;». Нужен выбранный материал')),
    h('label', { class: 'check' }, coat, ' Это покрытие (краска, цинк)'),
    area('passportText', 'Текст «для паспорта»', 'Пусто — как у материала в справочнике'),
    area('techText', 'Текст «для тех. описания»', 'Пусто — как у материала в справочнике'));
  return { key: 'passportSpec', type: 'widget', label: '', wide: true, widget: () => ({ el, get value() { return JSON.stringify(st); }, set value(_) { /* только ввод */ } }) };
}

/** Записать, если менялось: ключи заменяются, пустое снимает; без материала размеры не шлём (сервер вернёт 400). */
export async function savePassportSpec(id, json) {
  if (!json) return;
  const v = JSON.parse(json);
  if (json === origs.get(id)) return;
  const body = { materialId: v.materialId || null, passportText: norm(v.passportText) || null, techText: norm(v.techText) || null };
  if (v.materialId) { body.sizes = v.sizes || []; body.isCoating = !!v.isCoating; }
  await api(`/materials/${id}/passport-spec`, { method: 'PATCH', body });
}

/** Блок «Для паспорта» в карточке (только чтение; правка — «Изменить»). */
export function passportSpecView(r) {
  const box = h('div', null, h('div', { class: 'section-title' }, 'Для паспорта'), h('p', { class: 'muted' }, 'Загрузка…'));
  Promise.all([load(r.id), api('/dicts/passportMaterials').then((x) => x.items || []).catch(() => [])]).then(([spec, mats]) => {
    const name = spec?.materialId ? (mats.find((m) => String(m.id) === String(spec.materialId))?.name || 'материал удалён из справочника') : '';
    const rows = spec && (name || spec.passportText || spec.techText) ? [
      name && h('p', null, 'Материал: ', h('b', null, name), spec.sizes?.length ? ` · ${spec.sizes.join('; ')}` : '', spec.isCoating ? ' · покрытие' : ''),
      spec.passportText && h('p', null, 'Для паспорта: ', spec.passportText),
      spec.techText && h('p', null, 'Для тех. описания: ', spec.techText)].filter(Boolean)
      : [h('p', { class: 'muted' }, 'Не связано с материалом паспорта — «Изменить» → «Для паспорта». Пока связи нет, состав изделия подсказывает по названию.')];
    box.replaceChildren(box.firstChild, ...rows);
  });
  return box;
}
