import { h } from '../../core/dom.js';
import { PREFIX } from '../../core/api.js';
import { badge as badgeOf } from './badges.js';
import { mark } from './mark.js';

/**
 * kit — единая библиотека эталонов. Разделы импортируют ТОЛЬКО отсюда (docs/roles/tz/DESIGN-KIT.md).
 * Фабрики выдают существующие классы (.btn, .tile, .tcard, .db-order, .chips/.chip, .stats/.stat, .board/.col, .badge, .state);
 * модификаторы — k-… в kit.css.
 */

const TONES = ['info', 'warn', 'danger', 'ok'];
const nodes = (x) => [].concat(x ?? []).filter((n) => n !== null && n !== false && n !== '');
const quiet = (node) => { for (const t of ['pointerdown', 'click', 'keydown']) node.addEventListener(t, (e) => e.stopPropagation()); return node; };

/** button({ label, kind: 'primary'|'secondary'|'ghost'|'danger', size: 'M'|'S', icon?, onClick, busy?, disabled?, title?, type?, cls? }) → .btn (cls — только для раскладки/состояния: mob-arr-accept и т.п.) */
export function button({ label, kind = 'secondary', size = 'M', icon, onClick, busy = false, disabled = false, title, type = 'button', cls: extra } = {}) {
  const cls = ['btn', kind === 'primary' ? 'btn-primary' : kind === 'ghost' ? 'btn-ghost' : kind === 'danger' ? 'btn-danger' : '', size === 'S' ? 'btn-sm' : '', busy ? 'is-busy' : '', extra || ''].filter(Boolean).join(' ');
  return mark(h('button', { type, class: cls, disabled: disabled || busy, title, onclick: onClick }, icon || null, label), 'button');
}

/** fileButton({ label, accept, onFile(file), size: 'M'|'S', title? }) → кнопка-подпись со скрытым file input; выбранный файл отдаётся в onFile, поле сбрасывается */
export function fileButton({ label, accept, onFile, size = 'S', title } = {}) {
  const input = h('input', { type: 'file', accept, hidden: true, onchange: (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) onFile?.(f); } });
  return mark(h('label', { class: 'btn' + (size === 'S' ? ' btn-sm' : ''), title: title || null }, label, input), 'button');
}

/** select({ options: [[value,label]|{value,label}], value, onChange(value), label (aria), disabled?, cls? }) → <select class="k-select"> — единственная фабрика выпадающего списка без поиска */
export function select({ options = [], value, onChange, label, disabled = false, cls } = {}) {
  const el = h('select', { class: 'k-select' + (cls ? ' ' + cls : ''), 'aria-label': label || null, disabled, onchange: (e) => onChange?.(e.target.value) },
    ...options.map((o) => { const [v, l] = Array.isArray(o) ? o : [o.value, o.label]; return h('option', { value: v, selected: String(v) === String(value) }, l); }));
  return mark(el, 'select');
}

/** badge(map, key) — как badges.js; badge('Текст', 'ok'|'warn'|'danger'|'info'|'dim') — одиночная метка → .badge */
export function badge(a, b) {
  if (a && typeof a === 'object') return mark(badgeOf(a, b), 'badge');
  return mark(h('span', { class: 'badge ' + (b || 'dim') }, a), 'badge');
}

export { empty } from './empty.js';

/** Слот variant карточки: 'long' — длинный текст (строка или узлы), 6 строк + «Развернуть»; 'table' — body = kit table() внутри карточки. */
function variantBody(variant, body) {
  const kids = nodes(body);
  if (!kids.length || (variant !== 'long' && variant !== 'table')) return null;
  if (variant === 'table') return quiet(h('div', { class: 'k-card-body k-card-table' }, ...kids));
  const text = h('div', { class: 'k-card-body k-card-long clamp' }, ...kids);
  const more = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'aria-expanded': 'false', onclick: () => {
    const open = text.classList.toggle('clamp') === false;
    more.setAttribute('aria-expanded', String(open)); more.textContent = open ? 'Свернуть' : 'Развернуть';
  } }, 'Развернуть');
  return quiet(h('div', { class: 'k-card-slot' }, text, more));
}

/** card({ size: 'S'|'M'|'L', tone: 'neutral'|'info'|'warn'|'danger'|'ok', title, meta, badges, actions, onClick, photo, density, cls, variant: 'long'|'table', body })
 *  variant + body — слот под заголовком; onClick → класс k-hover (подъём -2px и --shadow-lg, только у кликабельных).
 *  S → .tile, M → .tcard (density 'compact' → .tcard.compact), L → .db-order. tone → .tone-X + .k-toned (полоса слева).
 *  photo — строка-адрес или { thumb, url } (с PREFIX); badges/actions — узлы или массивы; кнопки в actions не открывают карточку. */
export function card(opts = {}) { return mark(cardRaw(opts), 'card'); }
function cardRaw({ size = 'M', tone = 'neutral', title, meta, badges, actions, onClick, photo, density, cls, variant, body } = {}) {
  const toned = TONES.includes(tone) ? ' tone-' + tone + ' k-toned' : '';
  const hover = onClick ? ' k-hover' : '';
  const slot = variantBody(variant, body);
  const open = onClick ? { tabindex: '0', role: 'button', onclick: onClick, onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e); } } } : {};
  const bs = nodes(badges), as = nodes(actions);
  const pic = photo ? h('img', { class: 't-pic', src: typeof photo === 'string' ? photo : PREFIX + (photo.thumb || photo.url), alt: '', loading: 'lazy', decoding: 'async', draggable: 'false' }) : null;
  const extra = (variant === 'long' || variant === 'table' ? ' k-' + variant : '') + hover + (cls ? ' ' + cls : '');
  if (size === 'S') {
    return h('div', { class: 'tile k-s' + toned + extra, ...open }, h('b', { title }, title), meta ? h('span', { class: 'muted' }, meta) : null,
      bs.length ? h('div', { class: 'k-badges' }, ...bs) : null, slot, as.length ? quiet(h('div', { class: 'k-actions' }, ...as)) : null);
  }
  if (size === 'L') {
    return h('article', { class: 'db-order' + toned + extra, ...open },
      h('div', { class: 'db-oh' }, h('span', { class: 'db-oname' }, h('b', null, title), meta ? h('span', { class: 'db-cust' }, ' · ' + meta) : null)),
      bs.length || as.length ? h('div', { class: 'db-ocnt' }, ...bs, ...as) : null, slot);
  }
  const compact = density === 'compact';
  const text = [h('div', { class: 't-title', title }, title), meta || bs.length ? h('div', { class: 't-meta' }, meta, ...bs) : null];
  return h('article', { class: 'tcard' + (compact ? ' compact' : '') + toned + extra, ...open },
    pic, compact ? h('div', { class: 't-main' }, ...text) : text, slot,
    as.length ? quiet(h('div', { class: 'k-actions' }, ...as)) : null);
}

/** actions(...узлы) → .k-actions — тот же ряд кнопок, что в card({ actions }); для низа карточки доски (card → { foot }) */
export const actions = (...children) => mark(h('div', { class: 'k-actions' }, ...nodes(children)), 'actions');

/** row({ title, meta, tone, lead, side, qty, diff, warn, action, below, active, inCart, onClick, tag, cls, data })
 *  Строка списка/корзины: имя + мета, справа side (узлы) и action (кнопка). Если есть qty/diff — раскладка «корзина»:
 *  вторая строка с количеством и подсказкой; warn и below — на всю ширину. lead — слот слева (галочка). tag:'label' — вся строка кликабельна. */
export function row({ title, meta, tone = 'neutral', lead, side, qty, diff, warn, action, below, active, inCart, onClick, tag = 'div', cls, data } = {}) {
  const cart = qty != null || diff != null;
  const cn = ['k-row', cart ? 'k-cart' : '', TONES.includes(tone) ? 'tone-' + tone + ' k-toned' : '', active ? 'active' : '', inCart ? 'in-cart' : '', cls || ''].filter(Boolean).join(' ');
  const name = h('div', { class: 'k-row-name' }, h('div', { class: 'clip', title: typeof title === 'string' ? title : null }, title), meta ? h('small', null, meta) : null);
  const kids = [lead || null, name, ...nodes(side), action ? h('div', { class: 'k-row-act' }, ...nodes(action)) : null];
  if (cart) kids.push(h('div', { class: 'k-row-qty' }, ...nodes(qty)), diff || null);
  kids.push(...nodes(warn), ...nodes(below));
  return mark(h(tag, { class: cn, ...(data ? { 'data-id': data } : {}), ...(onClick ? { onclick: onClick } : {}) }, ...kids), 'row');
}

/** tabs({ items: [{ key, label, count? }], value, onChange(key), label (aria) }) → { el, set(key) } — .chips/.chip */
export function tabs({ items, value, onChange, label }) {
  const el = mark(h('div', { class: 'chips', role: 'tablist', 'aria-label': label || null }), 'tabs');
  const set = (key) => el.querySelectorAll('.chip').forEach((c) => { const on = c.dataset.key === String(key); c.classList.toggle('active', on); c.setAttribute('aria-selected', String(on)); });
  el.append(...items.map((it) => h('button', { type: 'button', role: 'tab', class: 'chip', dataset: { key: String(it.key) }, onclick: () => { set(it.key); onChange?.(it.key); } },
    it.label, it.count != null ? h('b', null, String(it.count)) : null)));
  set(value ?? items[0]?.key);
  return { el, set };
}

/** iconButton({ icon, label (aria), onClick, size: 'S'|'M', menu?, title?, cls? }) → .btn.btn-ghost.k-icon; menu → aria-haspopup */
export function iconButton({ icon, label, onClick, size = 'M', menu = false, title, cls } = {}) {
  const c = ['btn', 'btn-ghost', 'k-icon', size === 'S' ? 'btn-sm' : '', cls || ''].filter(Boolean).join(' ');
  return mark(h('button', { type: 'button', class: c, 'aria-label': label, title: title || label, 'aria-haspopup': menu ? 'menu' : null, 'aria-expanded': menu ? 'false' : null, onclick: onClick }, icon), 'iconButton');
}

/** segmented({ items: [{ key, label, tone? }], value, onChange(key), label (aria), cls? }) → { el, set(key), buttons } — .k-seg, aria-pressed; set() не зовёт onChange */
export function segmented({ items, value, onChange, label, cls } = {}) {
  const set = (key) => buttons.forEach((b) => { const on = b.dataset.key === String(key); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  const buttons = items.map((it) => h('button', { type: 'button', class: 'k-seg-btn', dataset: { key: String(it.key) }, 'data-tone': it.tone || null, 'aria-pressed': 'false', onclick: () => { set(it.key); onChange?.(it.key); } }, it.label));
  const el = mark(h('div', { class: 'k-seg' + (cls ? ' ' + cls : ''), role: 'group', 'aria-label': label || null }, ...buttons), 'segmented');
  set(value ?? items[0]?.key);
  return { el, set, buttons };
}

/** link({ label, href, onClick, title, target }) → <a> (переход, есть href) или <button> (действие), вид — ссылка-текст .link-btn */
export function link({ label, href, onClick, title, target, cls } = {}) {
  const c = 'link-btn' + (cls ? ' ' + cls : '');
  if (href) return mark(h('a', { class: c, href, title, target, rel: target ? 'noopener' : null, onclick: onClick }, label), 'link');
  return mark(h('button', { type: 'button', class: c, title, onclick: onClick }, label), 'link');
}

/** sku(text) → .k-sku: артикул изделия (моноширинные цифры, жирный, цвет текста); пусто → null. Без подписи «арт.» */
/** Заголовок группы в просмотре карточки (`card.view`): строка `grp('Цена')`; группа без заполненных строк не выводится (ui/card.js). */
export const grp = (t) => [h('span', { class: 'fields-grp' }, t), h('span', { class: 'fields-grp-end' })];

export const sku = (text) => (text == null || String(text).trim() === '' ? null : mark(h('span', { class: 'k-sku' }, String(text).trim()), 'sku'));

/** section({ title, count?, open?, body, cls? }) → <details class="form-block k-sec">: сворачиваемая секция правой панели (по умолчанию закрыта).
 *  В шапке — заголовок, число (count) и стрелка; открывается Enter/Пробел/щелчком. body — узлы или массив. Свёрнутое состояние не хранится. */
export function section({ title, count, open = false, body, cls } = {}) {
  const sum = h('summary', { class: 'form-sec k-sec-head' }, h('span', { class: 'form-sec-t' }, title),
    count != null ? h('span', { class: 'badge dim k-sec-n' }, String(count)) : null, h('span', { class: 'form-sec-chev', 'aria-hidden': 'true' }, '›'));
  return mark(h('details', { class: 'form-block k-sec' + (cls ? ' ' + cls : ''), 'data-tone': 'main', open: open || null }, sum, h('div', { class: 'k-sec-body' }, ...nodes(body))), 'section');
}

/** stat({ value, label }) → .stat; stats([...]) → .stats */
export const stat = ({ value, label }) => mark(h('div', { class: 'stat' }, h('b', { class: 'num' }, String(value ?? '—')), h('span', null, label)), 'stat');
export const stats = (items) => mark(h('div', { class: 'stats' }, ...items.map(stat)), 'stats');

/** toolbar(...узлы) → .toolbar */
export const toolbar = (...children) => mark(h('div', { class: 'toolbar' }, ...nodes(children)), 'toolbar');

/** Доска с данными с сервера (колонки, DnD, порции) — ui/kit/board.js */
export { mountBoard as board } from './board.js';
export { table } from './table.js';
export { links } from './links.js';
export { panel } from './panel.js';
export { entityPanel } from './entity-panel.js';

/** boardStatic({ columns: [{ key, label, tone, hint?, cards: [узлы], empty? }], density }) → .board без сервера (витрина, малые списки) */
export function boardStatic({ columns, density = 'normal' }) {
  return mark(h('div', { class: 'board' + (density === 'pics' ? ' board-pics' : '') },
    ...columns.map((c) => h('section', { class: 'col tone-' + (c.tone || 'dim'), 'aria-label': c.label },
      h('div', { class: 'col-head' }, h('span', { class: 'dot' }), h('span', null, c.label), h('span', { class: 'n' }, String(c.cards.length))),
      c.hint ? h('div', { class: 'col-hint' }, c.hint) : null,
      h('div', { class: 'col-body' }, ...(c.cards.length ? c.cards : [h('div', { class: 'col-more muted' }, c.empty || 'Пусто')]))))), 'board');
}

/** layout.split({ side, main, sideLabel }) → доска с боковым списком: слева колонка фиксированной ширины, справа main; на телефоне список сворачивается за кнопку сверху */
export const layout = {
  split({ side, main, sideLabel = 'Список' }) {
    const toggle = h('button', { type: 'button', class: 'btn btn-sm k-split-toggle', 'aria-expanded': 'false', onclick: () => { toggle.setAttribute('aria-expanded', String(el.classList.toggle('side-open'))); } }, sideLabel);
    const el = mark(h('div', { class: 'k-split' }, toggle, h('aside', { class: 'k-split-side', 'aria-label': sideLabel }, side), h('div', { class: 'k-split-main' }, main)), 'layout.split');
    return el;
  },
};

/** Семейство mobile — мобильные рабочие экраны (ui/kit/mobile.js) */
export { mobile, catArt } from './mobile.js';

// ---- Реэкспорт существующих эталонов ----
export { modal, confirmDlg } from './dialog.js';
export { toast, toastError } from './toast.js';
export { failBlock, busyBlock } from './busy.js';
export { errText } from './errors.js';
export { mountList } from './list.js';
export { autoMore } from './auto-more.js';
export { qtyInput } from './qty-input.js';
export { targetPicker, targetNote, targetShort, orderLines, lineCode } from './target-picker.js';
export { openCard } from './card.js';
export { pick, enhanceSelect, isLong, attachCombo, tagPick, attachSuggest } from './pick.js';
export { filter, chipsFilter, stepFunnel, facetFilter, parseFt, ftQuery, ftParams } from './filter.js';
export { SUPPLY_STATUS, INVOICE_STATUS, STOCK_STATUS, DESIGN_STATUS, ORDER_PRIORITY, PRIORITY, supplyKey } from './badges.js';
export { openPopMenu } from './pop-menu.js';
export { draggable, afterDrag } from './drag.js';
export { carousel } from './gallery.js';
export { uploadPhoto, photoDrop } from './photos.js';
export { sideForm, sideNote, openSide } from './side-form.js';

/** Хвост хлебных крошек раздела: crumbTail('Паспорта › Выпущенные паспорта') */
export { setCrumbTail as crumbTail } from './crumbs.js';
export { buildForm } from './form.js';

/** Подсказка «похожее уже есть» под названием изделия — ui/kit/similar.js */
export { similarBox } from "./similar.js";

export { searchBox } from './searchbox.js';
export { readonlyGroup, readonlyGroups } from './readonly.js';
export { photoField } from './photos.js';
