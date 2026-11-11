import { api, PREFIX } from '../../core/api.js';
import { h } from '../../core/dom.js';
import { photoDrop } from '../../ui/kit/photos.js';
import { imagesBody } from '../../core/passport-images.js';
import { toast, toastError } from '../../ui/kit/toast.js';
import { confirmDlg } from '../../ui/kit/dialog.js';
import { actions, button, fileButton, hint, iconButton, section, table } from '../../ui/kit/index.js';
import { date } from '../../core/format.js';
import { canEdit, humanBlanks, imgsOf, isRequired, kinds, V2_NUMS } from './common.js';
import { numbersOf } from './traits.js';

/** Блоки карточки паспорта: картинки, проверка, текст из снимка, комплектность. */
/** Картинки по видам в карточке: миниатюры (клик — открыть, × — убрать) и своя зона «перетащите / Ctrl+V» у каждого вида. */
export function imagesBlock(r, ctx) {
  const save = async (images) => {
    try { ctx.setRow(await api(`/passports/${r.id}`, { method: 'PATCH', body: { images: imagesBody(images) } }).then(() => api(`/passports/${r.id}`))); } catch (e) { toastError(e); }
  };
  const total = (r.images || []).length;
  return section({ title: 'Картинки паспорта', tone: 'info', count: total, cls: 'pp-images', body: kinds(r).map(([kind, label, where]) => {
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
    }) });
}

/** Паспорт v2 (БЗ-6 Э5a2): «Проверка» — чего не хватает; у рисунка — «Загрузить» (переход к его зоне загрузки ниже). */
// подписи «не хватает» с сервера (passport-rules IMAGE_KIND_LABELS) → вид картинки
export const IMG_BY_LABEL = { 'Фото изделия': 'overview', 'Чертёж с размерами': 'dimensions', 'Зона безопасности': 'safety', 'Схема монтажа': 'mounting', 'Схема фундамента': 'foundation', 'Разметка ям под опоры': 'holes', 'Сборка по шагам': 'assembly', 'Фото с подписями частей': 'overview_callouts', 'Где табличка с номером': 'nameplate' };
export function checkBlock(r) {
  const miss = r.missing || [];
  const warn = r.standardWarnings || [];
  if (!miss.length && !warn.length) return section({ title: 'Проверка', tone: 'neutral', count: 0, body: h('p', { class: 'muted small' }, 'Всё заполнено — паспорт можно выдавать.') });
  const goTo = (kind) => {
    const zone = document.querySelector(`.pp-kind[data-kind="${kind}"]`);
    if (!zone) return;
    zone.closest('details.k-sec')?.setAttribute('open', '');
    zone.scrollIntoView({ behavior: 'smooth', block: 'center' });
    zone.classList.add('fill-here'); setTimeout(() => zone.classList.remove('fill-here'), 2500);
  };
  return section({ title: miss.length ? (r.strict ? 'Не готов к выпуску — не хватает' : 'Проверка — не хватает') : 'Проверка', tone: 'neutral', count: miss.length || warn.length, open: miss.length > 0, body: [
    r.strict && miss.length ? h('p', { class: 'hint' }, 'PDF и печать станут доступны, когда заполните отмеченное. «Заполняется после печати» (покупатель, адрес, монтаж) выпуск не задерживает.') : null,
    h('ul', { class: 'timeline pp-check' }, ...miss.map((m) => {
      const img = m.startsWith('Рисунок: ') || m === 'Фото изделия' ? IMG_BY_LABEL[m.replace(/^Рисунок: /, '')] : null;
      // не картинка — «Заполнить»: открыть правку паспорта (та же кнопка «Изменить» карточки)
      const fill = () => [...document.querySelectorAll('.drawer button')].find((b) => b.textContent.trim() === 'Изменить')?.click();
      return h('li', null, m, !canEdit() ? null : img ? button({ label: 'Загрузить', size: 'S', onClick: () => goTo(img) }) : button({ label: 'Заполнить', size: 'S', onClick: fill }));
    })),
    warn.length ? section({ title: 'Нормативы — проверить', tone: 'neutral', count: warn.length, body: [h('p', { class: 'hint' }, 'Статус и дату проверки — в «Справочники → Паспорта → Нормативы». Паспорт выдавать можно.'),
      h('ul', { class: 'timeline' }, ...warn.map((w) => h('li', { class: 'muted' }, w)))] }) : null] });
}

/** Таблица ТО одного периода: что проверить · где · мера. */
export function periodBlock(m) {
  const row = (x) => h('li', null, x.what, h('span', { class: 'muted' }, [x.where, x.measure].filter(Boolean).map((v) => ' · ' + v).join('')));
  return h('div', null, h('b', null, m.period), h('ul', null, ...m.rows.map(row)));
}

/**
 * Пункт текста в предпросмотре (Э5a3): «Изменить» — правка только для этого паспорта (в снимок), прямо в карточке;
 * правленый пункт помечен «изменён для этого паспорта». Перенос в справочник — «Справочники → Паспорта → Разделы и тексты».
 */
export function snapItem(r, ctx, s, i, no = i.number) {
  const view = h('p', { class: 'pp-snap-item' }, no ? h('b', null, no + ' ') : '— ', humanBlanks(i.text),
    i.edited ? h('span', { class: 'muted', title: 'Было: ' + (i.original || '') }, ' · изменён для этого паспорта') : null,
    canEdit() ? iconButton({ icon: '✎', label: `Править пункт ${i.number || ''}`.trim(), size: 'S', cls: 'pp-snap-edit', onClick: () => view.replaceWith(editor()) }) : null,
    canEdit() && i.edited ? button({ label: 'Сделать общим для категории', kind: 'ghost', size: 'S', title: 'Этот текст пункта получат новые паспорта той же категории', onClick: async () => {
      if (!(await confirmDlg('Перенести в справочник?', `Пункт «${s.number} ${s.title}» с этим текстом станет общим для новых паспортов категории. Выданные паспорта не изменятся.`, { okText: 'Перенести' }))) return;
      try { const v = await api(`/passports/${r.id}/snapshot-item/promote`, { method: 'POST', body: { sectionKey: s.key, itemKey: i.key } }); toast(`Перенесено: шаблон категории, версия ${v.version}`); } catch (e) { toastError(e); }
    } }) : null);
  const editor = () => {
    const ta = h('textarea', { rows: 4, value: i.text, 'aria-label': 'Текст пункта' });
    const save = button({ label: 'Сохранить', kind: 'primary', size: 'S', onClick: async () => {
      save.disabled = true; save.textContent = 'Сохранение…';
      try { await api(`/passports/${r.id}/snapshot-item`, { method: 'PATCH', body: { sectionKey: s.key, itemKey: i.key, text: ta.value } }); ctx.setRow(await api(`/passports/${r.id}`)); toast('Пункт изменён для этого паспорта'); } catch (e) { toastError(e); save.disabled = false; save.textContent = 'Сохранить'; }
    } });
    const box = h('div', { class: 'field wide' }, ta, h('div', { class: 'hint' }, 'Правка только для этого паспорта'),
      h('div', { class: 'rt-acts' }, save, button({ label: 'Отмена', kind: 'ghost', size: 'S', onClick: () => box.replaceWith(view) })));
    setTimeout(() => ta.focus(), 0);
    return box;
  };
  return view;
}

/** Шаги монтажа по способу установки (внутри раздела «Монтаж» или отдельным разделом). */
const installList = (t) => (t.install?.text ? h('ol', null, ...String(t.install.text).split(/\r?\n/).filter(Boolean).map((x) => h('li', null, x))) : null);

/** Паспорт v2: текст из снимка (как будет в паспорте) и «Обновить текст по справочникам» (новый снимок). */
export function previewBlock(r, ctx) {
  const t = r.textSnapshot;
  const refresh = canEdit() ? button({ label: 'Обновить текст по справочникам', size: 'S', title: 'Собрать текст заново по справочникам и шаблону категории (выданный текст заменится)', onClick: async (e) => {
    const edited = (t?.sections || []).reduce((n, x) => n + x.items.filter((it) => it.edited).length, 0);
    if (edited && !(await confirmDlg('Пересобрать текст?', `Ручных правок в этом паспорте: ${edited}. После пересборки по справочникам они пропадут.`, { okText: 'Пересобрать' }))) return;
    e.target.disabled = true; e.target.textContent = 'Собираю…';
    try { await api(`/passports/${r.id}/snapshot`, { method: 'POST' }); ctx.setRow(await api(`/passports/${r.id}`)); toast('Текст паспорта собран заново'); } catch (err) { toastError(err); e.target.disabled = false; e.target.textContent = 'Обновить текст по справочникам'; }
  } }) : null;
  if (!t) return section({ title: 'Текст паспорта', tone: 'neutral', count: 0, body: [h('p', { class: 'muted small' }, 'Текст ещё не собран.'), refresh] });
  const part = (title, body) => (body ? section({ title, tone: 'neutral', body }) : null);
  const plan = numbersOf(t);
  return section({ title: 'Текст паспорта', tone: 'neutral', body: [
    h('p', { class: 'muted' }, `Текст собран ${t.at ? date(t.at) : ''}${t.missing?.length ? ' · в тексте не заполнено: ' + t.missing.map((k) => V2_NUMS.find((n) => n[0] === k)?.[1] || k).join(', ') : ''}`),
    // порядок и номера — как в PDF (numbersOf = planNumbers сервера): новые сборки — подряд 1…N, один «Монтаж»
    part(`${plan.descrNo || '—'} Описание и назначение`, t.description || t.purpose ? h('div', null, t.description ? h('p', null, humanBlanks(t.description)) : null, t.purpose ? h('p', null, humanBlanks(t.purpose)) : null) : null),
    part(`${plan.rulesNo || plan.descrNo || '—'} Правила пользования (${(t.rules || []).length})`, t.rules?.length ? h('ol', null, ...t.rules.map((x) => h('li', null, humanBlanks(x)))) : null),
    ...(t.sections || []).map((s, si) => part(`${plan.sectionNo[si]} ${s.title}`, plan.sectionNo[si] ? h('div', null, ...s.items.map((i) => snapItem(r, ctx, s, i, plan.itemNo(si, i.number))),
      plan.mergeInstall && si === plan.mountIdx ? installList(t) : null) : null)),
    part(`${plan.toNo} Обслуживание по периодам (из справочников)`, t.maintenance?.length ? h('div', null, ...t.maintenance.map(periodBlock)) : null),
    plan.mergeInstall ? null : part(`${plan.installNo} Монтаж по способу установки`, installList(t)),
    refresh] });
}

/** Файл печати номера: свой PDF или сборка сайта. Печать ходит в GET /passports/:id/pdf. */
const fileOn = (r) => r.printSource === 'file' || !!r.printFile?.hasFile;
const fileTitle = (r) => r.printFile?.name || r.printFile?.originalName || 'PDF';

export function printFileBlock(r, ctx) {
  const has = fileOn(r);
  let busy = false;
  const upload = async (file) => {
    if (busy || !file) return;
    if (file.type && file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name || '')) { toast('Нужен файл PDF', { error: true }); return; }
    busy = true;
    const done = toast('Прикрепляю PDF…', { ms: 120000, notice: false });
    try {
      const fd = new FormData(); fd.append('file', file, file.name || 'passport.pdf');
      await api(`/passports/${r.id}/print-file`, { method: 'POST', body: fd });
      done();
      ctx.setRow(await api(`/passports/${r.id}`));
      toast('Файл прикреплён. Печать отдаст его.');
    } catch (e) { done(); toastError(e, 'прикрепить файл'); } finally { busy = false; }
  };
  const remove = async () => {
    if (!(await confirmDlg('Убрать файл?', 'Печать снова соберёт паспорт на сайте. Номер не изменится.', { okText: 'Убрать' }))) return;
    try {
      await api(`/passports/${r.id}/print-file`, { method: 'DELETE' });
      ctx.setRow(await api(`/passports/${r.id}`));
      toast('Файл убран. Печать снова собирает паспорт на сайте.');
    } catch (e) { toastError(e, 'убрать файл'); }
  };
  return section({ title: 'Файл для печати', tone: 'info', body: [
    has ? hint(`Прикреплён файл «${fileTitle(r)}». Печать отдаёт его.`) : hint('Файла нет. Печать собирает паспорт на сайте.'),
    canEdit() ? actions(
      has ? button({ label: 'Убрать файл', kind: 'ghost', size: 'S', onClick: remove }) : null,
      fileButton({ label: has ? 'Заменить PDF' : 'Прикрепить PDF', accept: 'application/pdf,.pdf', title: 'Свой PDF этого номера. Печать отдаст файл.', onFile: upload }),
    ) : null,
  ] });
}

export function bomBlock(r) {
  if (!r.bom?.length) return section({ title: 'Комплектность (приложение)', tone: 'neutral', count: 0, body: h('p', { class: 'muted small' }, 'Не заполнена — в PDF будет «И-1 · Изделие в сборе · 1 шт.»') });
  const rows = r.bom;
  return section({ title: 'Комплектность (приложение)', tone: 'neutral', count: rows.length, body:
    table({ columns: [{ label: 'Поз.' }, { label: 'Обозначение' }, { label: 'Наименование' }, { label: 'Кол-во', num: true }, { label: 'Ед.' }, { label: 'Примечание' }],
      rows: rows.map((b) => ({ cells: [b.pos ?? '', b.code ?? '', b.name ?? '', b.qty ?? '', b.unit ?? '', { v: b.note ?? '', cls: 'muted' }] })) }) });
}
