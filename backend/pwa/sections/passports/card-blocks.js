import { api, PREFIX } from '../../core/api.js';
import { h } from '../../core/dom.js';
import { photoDrop } from '../../ui/photos.js';
import { imagesBody } from '../../core/passport-images.js';
import { toast, toastError } from '../../ui/toast.js';
import { confirmDlg } from '../../ui/dialog.js';
import { date } from '../../core/format.js';
import { canEdit, imgsOf, isRequired, kinds, V2_NUMS } from './common.js';

/** Блоки карточки паспорта: картинки, проверка, текст из снимка, комплектность. */
/** Картинки по видам в карточке: миниатюры (клик — открыть, × — убрать) и своя зона «перетащите / Ctrl+V» у каждого вида. */
export function imagesBlock(r, ctx) {
  const save = async (images) => {
    try { ctx.setRow(await api(`/passports/${r.id}`, { method: 'PATCH', body: { images: imagesBody(images) } }).then(() => api(`/passports/${r.id}`))); } catch (e) { toastError(e); }
  };
  return h('div', { class: 'pp-images' }, h('div', { class: 'section-title' }, 'Картинки паспорта'),
    ...kinds(r).map(([kind, label, where]) => {
      const list = imgsOf(r, kind);
      const std = (k) => (r.standardImages || []).filter((x) => x.kind === k && x.url);
      return h('div', { class: 'pp-kind', 'data-kind': kind },
        h('div', { class: 'pp-kind-head' }, h('b', null, label), isRequired(r, kind) ? h('span', { class: 'req' }, ' · обязательно') : null, h('span', { class: 'muted' }, ` · ${where}${list.length ? ' · ' + list.length : ''}`)),
        list.length ? h('div', { class: 'pf-strip' }, ...list.map((i) => h('div', { class: 'pf-item' },
          i.url ? h('a', { href: PREFIX + i.url, target: '_blank', rel: 'noopener', title: i.caption || 'Открыть', 'aria-label': `${label}: открыть картинку` }, h('img', { src: PREFIX + i.url, alt: i.caption || label })) : h('span', { class: 'muted' }, 'нет файла'),
          canEdit() ? h('button', { type: 'button', class: 'pf-del', title: 'Убрать картинку', 'aria-label': 'Убрать картинку', onclick: () => save((r.images || []).filter((x) => x !== i)) }, '×') : null))) : null,
        // Э9.5: своих нет — стандартная схема способа установки (в паспорт попадёт она; своя загруженная её заменит)
        !list.length && std(kind).length ? h('div', null, h('div', { class: 'hint' }, 'Стандартная схема способа установки — попадёт в паспорт; загрузите свою, чтобы заменить'),
          h('div', { class: 'pf-strip' }, ...std(kind).map((i) => h('a', { class: 'pf-item', href: PREFIX + i.url, target: '_blank', rel: 'noopener', 'aria-label': `${label}: стандартная схема` }, h('img', { src: PREFIX + i.url, alt: label }))))) : null,
        canEdit() ? photoDrop({ attach: async (photoId) => { r.images = [...(r.images || []), { kind, photoId, order: list.length }]; return r; }, done: () => save(r.images) }) : null);
    }));
}

/** Паспорт v2 (БЗ-6 Э5a2): «Проверка» — чего не хватает; у рисунка — «Загрузить» (переход к его зоне загрузки ниже). */
// подписи «не хватает» с сервера (passport-rules IMAGE_KIND_LABELS) → вид картинки
export const IMG_BY_LABEL = { 'Фото изделия': 'overview', 'Чертёж с размерами': 'dimensions', 'Зона безопасности': 'safety', 'Схема монтажа': 'mounting', 'Схема фундамента': 'foundation', 'Разметка ям под опоры': 'holes', 'Сборка по шагам': 'assembly', 'Фото с подписями частей': 'overview_callouts', 'Где табличка с номером': 'nameplate' };
export function checkBlock(r) {
  const miss = r.missing || [];
  const warn = r.standardWarnings || [];
  if (!miss.length && !warn.length) return h('div', null, h('div', { class: 'section-title' }, 'Проверка'), h('p', { class: 'muted' }, 'Всё заполнено — паспорт можно выдавать.'));
  const goTo = (kind) => {
    const zone = document.querySelector(`.pp-kind[data-kind="${kind}"]`);
    if (!zone) return;
    zone.scrollIntoView({ behavior: 'smooth', block: 'center' });
    zone.classList.add('fill-here'); setTimeout(() => zone.classList.remove('fill-here'), 2500);
  };
  return h('div', null, h('div', { class: 'section-title' }, miss.length ? (r.strict ? `Не готов к выпуску — не хватает: ${miss.length}` : `Проверка — не хватает: ${miss.length}`) : 'Проверка'),
    r.strict && miss.length ? h('p', { class: 'hint' }, 'PDF и печать станут доступны, когда заполните отмеченное. «Заполняется после печати» (покупатель, адрес, монтаж) выпуск не задерживает.') : null,
    h('ul', { class: 'timeline pp-check' }, ...miss.map((m) => {
      const img = m.startsWith('Рисунок: ') || m === 'Фото изделия' ? IMG_BY_LABEL[m.replace(/^Рисунок: /, '')] : null;
      // не картинка — «Заполнить»: открыть правку паспорта (та же кнопка «Изменить» карточки)
      const fill = () => [...document.querySelectorAll('.drawer button')].find((b) => b.textContent.trim() === 'Изменить')?.click();
      return h('li', null, m, !canEdit() ? null : img ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => goTo(img) }, 'Загрузить') : h('button', { type: 'button', class: 'btn btn-sm', onclick: fill }, 'Заполнить'));
    })),
    warn.length ? h('div', null, h('div', { class: 'section-title' }, 'Нормативы — проверить'), h('p', { class: 'hint' }, 'Статус и дату проверки — в «Справочники → Паспорта → Нормативы». Паспорт выдавать можно.'),
      h('ul', { class: 'timeline' }, ...warn.map((w) => h('li', { class: 'muted' }, w)))) : null);
}

/** Последний номер раздела снимка (ТО и монтаж в PDF идут следующими). */
export const lastNo = (t) => Math.max(2, ...(t.sections || []).map((s) => parseInt(s.number, 10) || 0));

/** Таблица ТО одного периода: что проверить · где · мера. */
export function periodBlock(m) {
  const row = (x) => h('li', null, x.what, h('span', { class: 'muted' }, [x.where, x.measure].filter(Boolean).map((v) => ' · ' + v).join('')));
  return h('div', null, h('b', null, m.period), h('ul', null, ...m.rows.map(row)));
}

/**
 * Пункт текста в предпросмотре (Э5a3): «Изменить» — правка только для этого паспорта (в снимок), прямо в карточке;
 * правленый пункт помечен «изменён для этого паспорта». Перенос в справочник — «Справочники → Паспорта → Разделы и тексты».
 */
export function snapItem(r, ctx, s, i) {
  const view = h('p', { class: 'pp-snap-item' }, i.number ? h('b', null, i.number + ' ') : '— ', i.text,
    i.edited ? h('span', { class: 'muted', title: 'Было: ' + (i.original || '') }, ' · изменён для этого паспорта') : null,
    canEdit() ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm btn-icon pp-snap-edit', title: `Править пункт ${i.number || ''}`.trim(), 'aria-label': `Править пункт ${i.number || ''}`.trim(), onclick: () => view.replaceWith(editor()) }, '✎') : null,
    canEdit() && i.edited ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', title: 'Этот текст пункта получат новые паспорта той же категории', onclick: async () => {
      if (!(await confirmDlg('Перенести в справочник?', `Пункт «${s.number} ${s.title}» с этим текстом станет общим для новых паспортов категории. Выданные паспорта не изменятся.`, { okText: 'Перенести' }))) return;
      try { const v = await api(`/passports/${r.id}/snapshot-item/promote`, { method: 'POST', body: { sectionKey: s.key, itemKey: i.key } }); toast(`Перенесено: шаблон категории, версия ${v.version}`); } catch (e) { toastError(e); }
    } }, 'Сделать общим для категории') : null);
  const editor = () => {
    const ta = h('textarea', { rows: 4, value: i.text, 'aria-label': 'Текст пункта' });
    const save = h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: async () => {
      save.disabled = true; save.textContent = 'Сохранение…';
      try { await api(`/passports/${r.id}/snapshot-item`, { method: 'PATCH', body: { sectionKey: s.key, itemKey: i.key, text: ta.value } }); ctx.setRow(await api(`/passports/${r.id}`)); toast('Пункт изменён для этого паспорта'); } catch (e) { toastError(e); save.disabled = false; save.textContent = 'Сохранить'; }
    } }, 'Сохранить');
    const box = h('div', { class: 'field wide' }, ta, h('div', { class: 'hint' }, 'Правка только для этого паспорта'),
      h('div', { class: 'rt-acts' }, save, h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => box.replaceWith(view) }, 'Отмена')));
    setTimeout(() => ta.focus(), 0);
    return box;
  };
  return view;
}

/** Паспорт v2: текст из снимка (как будет в паспорте) и «Обновить текст по справочникам» (новый снимок). */
export function previewBlock(r, ctx) {
  const t = r.textSnapshot;
  const refresh = canEdit() ? h('button', { type: 'button', class: 'btn btn-sm', title: 'Собрать текст заново по справочникам и шаблону категории (выданный текст заменится)', onclick: async (e) => {
    const edited = (t?.sections || []).reduce((n, x) => n + x.items.filter((it) => it.edited).length, 0);
    if (edited && !(await confirmDlg('Пересобрать текст?', `Ручных правок в этом паспорте: ${edited}. После пересборки по справочникам они пропадут.`, { okText: 'Пересобрать' }))) return;
    e.target.disabled = true; e.target.textContent = 'Собираю…';
    try { await api(`/passports/${r.id}/snapshot`, { method: 'POST' }); ctx.setRow(await api(`/passports/${r.id}`)); toast('Текст паспорта собран заново'); } catch (err) { toastError(err); e.target.disabled = false; e.target.textContent = 'Обновить текст по справочникам'; }
  } }, 'Обновить текст по справочникам') : null;
  if (!t) return h('div', null, h('div', { class: 'section-title' }, 'Текст паспорта'), h('p', { class: 'muted' }, 'Текст ещё не собран.'), refresh);
  const part = (title, body) => (body ? h('details', { class: 'month-group' }, h('summary', null, title), body) : null);
  return h('div', null, h('div', { class: 'section-title' }, 'Текст паспорта'),
    h('p', { class: 'muted' }, `Текст собран ${t.at ? date(t.at) : ''}${t.missing?.length ? ' · в тексте не заполнено: ' + t.missing.map((k) => V2_NUMS.find((n) => n[0] === k)?.[1] || k).join(', ') : ''}`),
    // порядок и номера — как в PDF: 1 описание, 2 правила, разделы шаблона, затем ТО и монтаж — следующими номерами
    part('1 Описание и назначение', t.description || t.purpose ? h('div', null, t.description ? h('p', null, t.description) : null, t.purpose ? h('p', null, t.purpose) : null) : null),
    part(`2 Правила пользования (${(t.rules || []).length})`, t.rules?.length ? h('ol', null, ...t.rules.map((x) => h('li', null, x))) : null),
    ...(t.sections || []).map((s) => part(`${s.number} ${s.title}`, h('div', null, ...s.items.map((i) => snapItem(r, ctx, s, i))))),
    part(`${lastNo(t) + 1} Обслуживание по периодам (из справочников)`, t.maintenance?.length ? h('div', null, ...t.maintenance.map(periodBlock)) : null),
    part(`${lastNo(t) + 2} Монтаж по способу установки`, t.install?.text ? h('ol', null, ...String(t.install.text).split(/\r?\n/).filter(Boolean).map((x) => h('li', null, x))) : null),
    refresh);
}

export function bomBlock(r) {
  if (!r.bom?.length) return h('div', null, h('div', { class: 'section-title' }, 'Комплектность (приложение)'), h('p', { class: 'muted' }, 'Не заполнена — в PDF будет «И-1 · Изделие в сборе · 1 шт.»'));
  const rows = r.bom;
  return h('div', null, h('div', { class: 'section-title' }, 'Комплектность (приложение)'),
    h('table', { class: 'so-lines static' }, h('thead', null, h('tr', null, ...['Поз.', 'Обозначение', 'Наименование', 'Кол-во', 'Ед.', 'Примечание'].map((x) => h('th', null, x)))),
      h('tbody', null, ...rows.map((b) => h('tr', null, h('td', null, b.pos ?? ''), h('td', null, b.code ?? ''), h('td', null, b.name ?? ''), h('td', { class: 'num' }, b.qty ?? ''), h('td', null, b.unit ?? ''), h('td', { class: 'muted' }, b.note ?? ''))))));
}
