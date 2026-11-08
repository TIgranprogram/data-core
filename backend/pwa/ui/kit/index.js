import { h } from '../../core/dom.js';
import { PREFIX } from '../../core/api.js';
import { badge as badgeOf } from './badges.js';
import { mark, markEl } from './mark.js';
import { hint, tileGrid, landing, miniChart, navList, photoStrip } from './blocks.js';

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

/** textInput({ label, value, placeholder, hint, required, max, type, inputmode, disabled, onInput, onEnter, cls }) → { el, input, get/set value, focus() }
 *  Однострочное поле ввода эталона формы (C044-T2): подпись сверху, подсказка под полем, Enter → onEnter; без подписи — поле без неё (label уходит в aria-label). */
export function textInput({ label, value = '', placeholder, hint, required = false, max = 500, type = 'text', inputmode, disabled = false, onInput, onEnter, cls } = {}) {
  const input = h('input', { type, inputmode: inputmode || (type === 'number' ? 'decimal' : undefined), placeholder, autocomplete: 'off', maxlength: max, disabled: disabled || null, 'aria-label': label || placeholder || 'Поле ввода' });
  input.value = value ?? '';
  input.addEventListener('input', () => onInput?.(input.value));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter?.(input.value.trim()); } });
  const el = h(label ? 'label' : 'div', { class: 'field k-ti' + (cls ? ' ' + cls : '') },
    label ? h('span', null, label, required ? h('span', { class: 'req' }, ' *') : null) : null, input, hint ? h('div', { class: 'hint' }, hint) : null);
  return markEl({ el, input, focus: () => input.focus(), get value() { return input.value; }, set value(v) { input.value = v ?? ''; } }, 'textInput');
}

/** badge(map, key) — как badges.js; badge('Текст', 'ok'|'warn'|'danger'|'info'|'dim', { dot? }) — одиночная метка → .badge.
 *  dot — цвет кружка перед текстом (например hex цвета изделия); без dot кружок по тону. */
export function badge(a, b, opts = {}) {
  if (a && typeof a === 'object') return mark(badgeOf(a, b), 'badge');
  const el = h('span', { class: 'badge ' + (b || 'dim') }, a);
  if (opts.dot) { el.classList.add('k-dot'); el.style.setProperty('--dot', opts.dot); }
  return mark(el, 'badge');
}

export { empty } from './empty.js';

/** Слот variant карточки: 'long' — длинный текст (строка или узлы), 6 строк + «Развернуть»; 'table' — body = kit table() внутри карточки;
 *  'fields' — цена слева (price: { value, note } или узел) и пары «метка — значение» (body = readonlyGroup, 2 колонки; на 390 — 1). */
function variantBody(variant, body, price) {
  const kids = nodes(body);
  if (variant === 'fields') {
    const p = price && typeof price === 'object' && !(price instanceof Node) ? h('div', { class: 'k-price' }, h('b', { class: 'k-price-v num' }, String(price.value ?? '')), price.note ? h('span', { class: 'muted small' }, price.note) : null) : price || null;
    return p || kids.length ? quiet(h('div', { class: 'k-card-body k-card-fields' }, p, kids.length ? h('div', { class: 'k-fields-grid' }, ...kids) : null)) : null;
  }
  if (!kids.length || (variant !== 'long' && variant !== 'table')) return null;
  if (variant === 'table') return quiet(h('div', { class: 'k-card-body k-card-table' }, ...kids));
  const text = h('div', { class: 'k-card-body k-card-long clamp' }, ...kids);
  const more = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'aria-expanded': 'false', onclick: () => {
    const open = text.classList.toggle('clamp') === false;
    more.setAttribute('aria-expanded', String(open)); more.textContent = open ? 'Свернуть' : 'Развернуть';
  } }, 'Развернуть');
  return quiet(h('div', { class: 'k-card-slot' }, text, more));
}

/** card({ size: 'S'|'M'|'L', tone: 'neutral'|'info'|'warn'|'danger'|'ok', title, meta, badges, actions, onClick, photo, density, cls, variant: 'long'|'table'|'fields', body, price })
 *  S: art (узел 40×40 слева, catArt; artCover:true — рисунок сверху во всю ширину 16:10 на --photo-bg), onToggle(open) у expand, low (часть меты красным), graph (miniChart под меткой), compact:true — плитка в 2 раза меньше/ниже (.k-compact, C043: типы в раскрытой категории), expand: { title, action, body } — плитка раскрывает панель; внутри tileGrid панель стоит под всем рядом плиток на всю ширину, открыта одна (аккордеон), по умолчанию закрыты.
 *  M variant 'fields': price + body (readonlyGroup). L: head: { title, badges, menu } + tabs: { items: [{ key, label, count?, tone?, title? }], panes: { key: () => узел }, value, fill? } — шапка и вкладки с панелью (в DOM только активная).
 *  variant + body — слот под заголовком; onClick → класс k-hover (подъём -2px и --shadow-lg, только у кликабельных).
 *  S → .tile, M → .tcard (density 'compact' → .tcard.compact), L → .db-order. tone → .tone-X + .k-toned (полоса слева).
 *  photo — строка-адрес или { thumb, url } (с PREFIX); badges/actions — узлы или массивы; кнопки в actions не открывают карточку. */
export function card(opts = {}) { return mark(cardRaw(opts), 'card'); }
function cardRaw(o = {}) {
  if (o.size === 'S' && o.expand) return expandTile(o);
  if (o.size === 'L' && (o.head || o.tabs)) return headTabsCard(o);
  return cardBase(o);
}
/** Плитка S с раскрывающейся панелью: tileGrid переносит панель под весь ряд плиток (аккордеон — открыта одна). */
let expandSeq = 0;
function expandTile({ expand, onClick, onToggle, ...rest }) {
  const panelEl = h('div', { class: 'k-expand', id: 'k-expand-' + (++expandSeq), hidden: true, inert: true },
    expand.title || expand.action ? h('div', { class: 'k-expand-head' }, h('b', null, expand.title), expand.action || null) : null,
    h('div', { class: 'k-expand-body' }, ...nodes(expand.body)));
  let tile;
  const toggle = () => {
    const open = panelEl.hidden;
    panelEl.hidden = !open; panelEl.inert = !open;
    tile.classList.toggle('k-open', open); tile.setAttribute('aria-expanded', String(open));
    if (open) { onClick?.(); tile.dispatchEvent(new CustomEvent('k-expand-open', { bubbles: true })); }
    onToggle?.(open);
  };
  tile = cardBase({ ...rest, onClick: toggle });
  tile.setAttribute('aria-expanded', 'false'); tile.setAttribute('aria-controls', panelEl.id);
  return h('div', { class: 'k-tile-wrap' }, tile, panelEl);
}
/** Карточка L с шапкой (название, бейджи, меню справа) и вкладками: панель вкладки создаётся при открытии. */
function headTabsCard({ head = {}, tabs: tb, tone = 'neutral', cls }) {
  const toned = TONES.includes(tone) ? ' tone-' + tone + ' k-toned' : '';
  const pane = h('div', { class: 'k-pane' });
  const show = (key) => pane.replaceChildren(...nodes(tb?.panes?.[key]?.()));
  const t = tb?.items?.length ? tabs({ items: tb.items, value: tb.value, label: head.title, onChange: show, fill: tb.fill }) : null;
  if (t) show(tb.value ?? tb.items[0].key);
  return h('article', { class: 'db-order k-headtabs' + toned + (cls ? ' ' + cls : '') },
    h('div', { class: 'db-oh k-head' }, h('span', { class: 'db-oname' }, h('b', null, head.title)), head.badges ? h('div', { class: 'k-badges' }, ...nodes(head.badges)) : null, head.menu || null),
    t ? t.el : null, t ? pane : null);
}
function cardBase({ size = 'M', tone = 'neutral', title, meta, badges, actions, onClick, photo, density, cls, variant, body, price, art, artCover, compact: compactTile, low, graph } = {}) {
  const toned = TONES.includes(tone) ? ' tone-' + tone + ' k-toned' : '';
  const hover = onClick ? ' k-hover' : '';
  const slot = variantBody(variant, body, price);
  const open = onClick ? { tabindex: '0', role: 'button', onclick: onClick, onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e); } } } : {};
  const bs = nodes(badges), as = nodes(actions);
  const pic = photo ? h('img', { class: 't-pic', src: typeof photo === 'string' ? photo : PREFIX + (photo.thumb || photo.url), alt: '', loading: 'lazy', decoding: 'async', draggable: 'false' }) : null;
  const extra = (variant === 'long' || variant === 'table' || variant === 'fields' ? ' k-' + variant : '') + hover + (cls ? ' ' + cls : '');
  if (size === 'S') {
    const sub = meta || low ? h('span', { class: 'muted' }, meta, low ? h('span', { class: 'k-low' }, (meta ? ' · ' : '') + low) : null) : null;
    const inner = [h('b', { title }, title), sub, graph || null, bs.length ? h('div', { class: 'k-badges' }, ...bs) : null, slot, as.length ? quiet(h('div', { class: 'k-actions' }, ...as)) : null];
    const small = compactTile ? ' k-compact' : '';
    if (art) return h('div', { class: 'tile k-s k-art' + (artCover ? ' k-cover' : '') + small + toned + extra, ...open }, h('span', { class: 'k-tile-art', 'aria-hidden': 'true' }, art), h('div', { class: 'k-tile-txt' }, ...inner));
    return h('div', { class: 'tile k-s' + small + toned + extra, ...open }, ...inner);
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

/** clamp(text, { lines: 2 | 3 }) — длинный текст (позиция договора) в N строк с «…», полный текст в title; ширину контейнера не раздвигает. */
export const clamp = (text, { lines = 3, cls } = {}) => mark(h('span', { class: 'k-clamp k-clamp-' + (lines === 2 ? 2 : 3) + (cls ? ' ' + cls : ''), title: text == null ? null : String(text) }, text), 'clamp');

/** row({ title, meta, tone, lead, side, qty, diff, warn, action, below, active, inCart, onClick, tag, cls, data })
 *  Строка списка/корзины: имя + мета, справа side (узлы) и action (кнопка). Если есть qty/diff — раскладка «корзина»:
 *  wrap: true — название до 2 строк (длинные названия изделий в узкой панели), иначе — одна строка с «…».
 *  вторая строка с количеством и подсказкой; warn и below — на всю ширину. lead — слот слева (галочка). tag:'label' — вся строка кликабельна. */
export function row({ title, meta, tone = 'neutral', lead, side, qty, diff, warn, action, below, active, inCart, onClick, tag = 'div', cls, data, wrap } = {}) {
  const cart = qty != null || diff != null;
  const cn = ['k-row', wrap ? 'k-row-wrap' : '', cart ? 'k-cart' : '', TONES.includes(tone) ? 'tone-' + tone + ' k-toned' : '', active ? 'active' : '', inCart ? 'in-cart' : '', cls || ''].filter(Boolean).join(' ');
  const name = h('div', { class: 'k-row-name' }, h('div', { class: 'clip', title: typeof title === 'string' ? title : null }, title), meta ? h('small', null, meta) : null);
  const kids = [lead || null, name, ...nodes(side), action ? h('div', { class: 'k-row-act' }, ...nodes(action)) : null];
  if (cart) kids.push(h('div', { class: 'k-row-qty' }, ...nodes(qty)), diff || null);
  kids.push(...nodes(warn), ...nodes(below));
  return mark(h(tag, { class: cn, ...(data ? { 'data-id': data } : {}), ...(onClick ? { onclick: onClick } : {}) }, ...kids), 'row');
}

/** tabs({ items: [{ key, label, count?, sub?, marks?, today?, tone?, title? }], value, onChange(key), label (aria), layout?: 'days', fill? }) → { el, set(key) } — .chips/.chip
 *  tone — состояние вкладки цветом (ok — сделано, warn — идёт сейчас, info); fill — вкладки делят всю ширину поровну.
 *  layout 'days' — неделя: 7 равных клеток (label — число/день, sub — подпись, marks — до 3 точек по тонам info/warn/danger/ok, today — рамка). */
export function tabs({ items, value, onChange, label, layout: lay, fill }) {
  const days = lay === 'days';
  const el = mark(h('div', { class: days ? 'k-days' : 'chips' + (fill ? ' k-tabs-fill' : ''), role: 'tablist', 'aria-label': label || null }), 'tabs');
  const set = (key) => el.querySelectorAll(days ? '.k-day' : '.chip').forEach((c) => { const on = c.dataset.key === String(key); c.classList.toggle('active', on); c.setAttribute('aria-selected', String(on)); });
  if (days) el.append(...items.map((it) => h('button', { type: 'button', role: 'tab', class: 'k-day' + (it.today ? ' today' : ''), dataset: { key: String(it.key) }, onclick: () => { set(it.key); onChange?.(it.key); } },
    h('b', null, it.label), it.sub ? h('span', { class: 'k-day-sub' }, it.sub) : null,
    h('span', { class: 'k-day-marks', 'aria-hidden': 'true' }, ...(it.marks || []).slice(0, 3).map((m) => h('i', { class: 'tone-' + m }))))));
  else el.append(...items.map((it) => h('button', { type: 'button', role: 'tab', class: 'chip', dataset: { key: String(it.key) }, 'data-tone': it.tone || null, title: it.title || null, 'aria-label': it.title ? `${it.label}: ${it.title}` : null, onclick: () => { set(it.key); onChange?.(it.key); } },
    it.tone === 'ok' ? '✓ ' : '', it.label, it.count != null ? h('b', null, String(it.count)) : null)));
  // value: null — явно «ничего не выбрано» (шаг воронки ещё не пройден): ничего не подсвечиваем; не передан — первый, как раньше
  set(value === undefined ? items[0]?.key : value);
  return { el, set };
}

/** iconButton({ icon, label (aria), onClick, size: 'S'|'M', menu?, title?, cls? }) → .btn.btn-ghost.k-icon; menu → aria-haspopup */
export function iconButton({ icon, label, onClick, size = 'M', menu = false, title, cls } = {}) {
  const c = ['btn', 'btn-ghost', 'k-icon', size === 'S' ? 'btn-sm' : '', cls || ''].filter(Boolean).join(' ');
  return mark(h('button', { type: 'button', class: c, 'aria-label': label, title: title || label, 'aria-haspopup': menu ? 'menu' : null, 'aria-expanded': menu ? 'false' : null, onclick: onClick }, icon), 'iconButton');
}

/** segmented({ items: [{ key, label, tone? }], value, onChange(key), label (aria), cls?, scroll? }) → { el, set(key), buttons } — .k-seg, aria-pressed; set() не зовёт onChange.
 *  scroll — длинные названия: пункты не сжимаются, ряд прокручивается по горизонтали (склады). */
export function segmented({ items, value, onChange, label, cls, scroll } = {}) {
  const set = (key) => buttons.forEach((b) => { const on = b.dataset.key === String(key); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  const buttons = items.map((it) => h('button', { type: 'button', class: 'k-seg-btn', dataset: { key: String(it.key) }, 'data-tone': it.tone || null, 'aria-pressed': 'false', onclick: () => { set(it.key); onChange?.(it.key); } }, it.label));
  const el = mark(h('div', { class: 'k-seg' + (scroll ? ' k-seg-scroll' : '') + (cls ? ' ' + cls : ''), role: 'group', 'aria-label': label || null }, ...buttons), 'segmented');
  set(value ?? items[0]?.key);
  if (scroll) requestAnimationFrame(() => { const on = el.querySelector('.on'); if (on && el.scrollWidth > el.clientWidth) el.scrollLeft = Math.max(0, on.offsetLeft - 16); }); // выбранный пункт виден сразу
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

/** section({ title, count?, open?, body, cls?, tone?, fixed? (всегда раскрыта, без стрелки), urgent? (полоса danger), more?: { limit, label, onMore } (первые limit строк + «Все (ещё N) →») }) → <details class="form-block k-sec">: сворачиваемая секция правой панели (по умолчанию закрыта).
 *  tone — цвет категории (полоса слева и заголовок): main · info · money · who · gold · neutral (ПМ-1, 2026-11-06).
 *  В шапке — заголовок, число (count) и стрелка; открывается Enter/Пробел/щелчком. body — узлы или массив. Свёрнутое состояние не хранится. */
export function section({ title, count, open = false, body, cls, tone = 'main', fixed = false, urgent = false, more } = {}) {
  const kids = nodes(body);
  let moreEl = null;
  if (more && kids.length > (more.limit ?? 5)) {
    const hidden = kids.slice(more.limit ?? 5);
    hidden.forEach((n) => { n.hidden = true; });
    const btn = link({ label: (more.label || 'Все') + ' (ещё ' + hidden.length + ') →', onClick: () => { hidden.forEach((n) => { n.hidden = false; }); moreEl.remove(); more.onMore?.(); } });
    moreEl = h('div', { class: 'k-sec-more' }, btn);
  }
  if (fixed) {
    return mark(h('section', { class: 'form-block k-sec k-sec-fixed' + (urgent ? ' urgent' : '') + (cls ? ' ' + cls : ''), 'data-tone': tone },
      h('div', { class: 'k-sec-fhead' }, h('h2', null, title), count != null ? h('span', { class: 'k-sec-n num' }, String(count)) : null),
      h('div', { class: 'k-sec-body' }, ...kids, moreEl)), 'section');
  }
  const sum = h('summary', { class: 'form-sec k-sec-head' }, h('span', { class: 'form-sec-t' }, title),
    count != null ? h('span', { class: 'badge dim k-sec-n' }, String(count)) : null, h('span', { class: 'form-sec-chev', 'aria-hidden': 'true' }, '›'));
  return mark(h('details', { class: 'form-block k-sec' + (cls ? ' ' + cls : ''), 'data-tone': tone, open: open || null }, sum, h('div', { class: 'k-sec-body' }, ...kids, moreEl)), 'section');
}

/** stack(...блоки) → .k-stack: блоки правой панели колонкой с одним зазором (ПМ-1). */
export const stack = (...children) => mark(h('div', { class: 'k-stack' }, ...nodes(children)), 'stack');

/** stat({ value, label, onClick?, tone?, active? }) → .stat; stats([...]) → .stats. onClick — кликабельная пилюля (button.k-pill): число красное при tone danger, приглушённое при 0; active — рамка. */
export const stat = ({ value, label, onClick, tone, active = false }) => {
  const kids = [h('b', { class: 'num' }, String(value ?? '—')), h('span', null, label)];
  if (!onClick) return mark(h('div', { class: 'stat' }, ...kids), 'stat');
  const zero = Number(value) === 0;
  return mark(h('button', { type: 'button', class: 'stat k-pill' + (zero ? ' zero' : '') + (tone ? ' tone-' + tone : '') + (active ? ' active' : ''), 'aria-pressed': String(!!active), onclick: onClick }, ...kids), 'stat');
};
export const stats = (items) => mark(h('div', { class: 'stats' }, ...items.map(stat)), 'stats');

/** toolbar(...узлы) → .toolbar */
export const toolbar = (...children) => mark(h('div', { class: 'toolbar' }, ...nodes(children)), 'toolbar');

/** Доска с данными с сервера (колонки, DnD, порции) — ui/kit/board.js */
export { mountBoard as board } from './board.js';
export { table } from './table.js';
export { hint, tileGrid, landing, miniChart, navList, photoStrip };
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
  /** layout.cols(...блоки) → 2 колонки от 1100 px, ниже одна */
  cols: (...blocks) => mark(h('div', { class: 'k-cols' }, ...nodes(blocks)), 'layout.cols'),
};

/** Семейство mobile — мобильные рабочие экраны (ui/kit/mobile.js) */
export { mobile, catArt, typeArt, typeIconList } from './mobile.js';

// ---- Реэкспорт существующих эталонов ----
export { modal, confirmDlg } from './dialog.js';
export { openPdfPreview } from './pdf-preview.js';
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

/** Путеводитель (help и обучающие схемы): cat/unit/chain/flow/note/toggle — ui/kit/guide.js */
export { guide } from './guide.js';
export { stageBar, headStats } from './stage-bar.js';
export { funnel } from './funnel.js';
export { planner } from './planner.js';

/** Фото позиции/изделия в таблицах и строках (клик — крупно; нет фото — «нет фото») — ui/pos-pic.js */
export { posPic, posPicOf } from './pos-pic.js';
