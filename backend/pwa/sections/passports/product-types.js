import { api } from '../../core/api.js';
import { h } from '../../core/dom.js';
import { modal } from '../../ui/dialog.js';
import { toast } from '../../ui/toast.js';

/**
 * ПЧ-3: «Подставить по типу» — части и материалы по умолчанию из справочника «Типы изделий».
 * Тип подбирается по словам в названии, человек видит его и может сменить. Размеры типовые, их сверяют с чертежом.
 */

/** Тип по названию: совпало больше всего букв — самое точное слово. */
export function typeByName(types, name) {
  const text = String(name || '').toLowerCase().replace(/ё/g, 'е');
  let best = null, score = 0;
  for (const t of types) {
    for (const w of String(t.words || '').toLowerCase().replace(/ё/g, 'е').split('|').map((x) => x.trim()).filter(Boolean)) {
      if (text.includes(w) && w.length > score) { best = t; score = w.length; }
    }
  }
  return best;
}

/** Строки типа «часть; КОД материала; размер» → таблица материалов: одна строка на материал и размер. */
export function specFromType(type, dicts) {
  const matBy = new Map(dicts.mats.map((m) => [String(m.code || '').toUpperCase(), m]));
  const partBy = new Map(dicts.parts.map((p) => [String(p.name).toLowerCase(), p]));
  const rows = new Map();
  for (const line of String(type.composition || '').split('\n')) {
    const [part, code, size] = line.split(';').map((x) => (x || '').trim());
    if (!part) continue;
    const mat = code ? matBy.get(code.toUpperCase()) : null;
    const key = `${mat?.id ?? ''}|${size || ''}|${mat ? '' : part}`;
    const row = rows.get(key) || { materialId: mat ? String(mat.id) : '', sizes: size ? [size] : [], partIds: [] };
    const p = partBy.get(part.toLowerCase());
    if (p && !row.partIds.includes(String(p.id))) row.partIds.push(String(p.id));
    rows.set(key, row);
  }
  const coatingIds = String(type.coatings || '').split(',').map((c) => matBy.get(c.trim().toUpperCase())).filter(Boolean).map((m) => String(m.id));
  return { rows: [...rows.values()], coatingIds };
}

/** Окно выбора типа и подстановка в таблицу материалов. */
export async function fillFromType(w, { name, dicts }) {
  const types = await api('/dicts/passportTypes').then((r) => r.items || []).catch(() => []);
  if (!types.length) { toast('Типы изделий ещё не заполнены — справочник «Типы изделий»'); return; }
  const sel = h('select', { 'aria-label': 'Тип изделия' }, h('option', { value: '' }, 'Выберите тип'), ...types.map((t) => h('option', { value: String(t.id) }, t.name)));
  sel.value = String(typeByName(types, name)?.id ?? '');
  const id = await modal({
    title: 'Подставить по типу изделия', okText: 'Подставить',
    body: h('div', null, h('p', { class: 'hint' }, w.isEmpty() ? 'Части и материалы заполнятся по типу. Размеры типовые — сверьте с чертежом.' : 'Строки таблицы заменятся. Размеры типовые — сверьте с чертежом.'), h('label', { class: 'field' }, h('span', null, 'Тип изделия'), sel)),
    onOk: () => { if (!sel.value) throw new Error('Выберите тип изделия'); return sel.value; },
  });
  if (id) w.set(specFromType(types.find((t) => String(t.id) === id), dicts));
}
