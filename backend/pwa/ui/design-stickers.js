import { api, PREFIX } from '../core/api.js';
import { h } from '../core/dom.js';
import { date, isoDay, qty } from '../core/format.js';
import { ORDER_PRIORITY } from './badges.js';
import { confirmDlg } from './dialog.js';
import { photoDrop } from './photos.js';
import { toastError } from './toast.js';

/**
 * Стикеры и фото задач проектирования (карточки как в YouGile). Сервер: GET /design-stickers (все), стикеры доски — в GET /design-board,
 * значения — task.stickers[id], фото — task.photos. Системные стикеры (assignee/deadline/priority/order/product) берут значение из полей задачи.
 */
export const PHOTO_LIMIT = 20;
export const CARD_STICKERS = 4;
const hex = (c) => (/^#[0-9a-fA-F]{6}$/.test(String(c || '')) ? c : null);
const text = (v) => (v === null || v === undefined ? '' : String(v).trim());

// ---------- список стикеров (кэш; доска кладёт сюда свой) ----------
let cache = null;
export const setStickers = (list) => { cache = Array.isArray(list) ? list : cache; };
export const dropStickersCache = () => { cache = null; };
const items = (r) => (Array.isArray(r) ? r : r?.items || []);
const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);
/** Видимые стикеры (для карточки задачи). */
export async function visibleStickers() {
  if (!cache) { try { cache = items(await api('/design-stickers')).filter((s) => s.visible !== false).sort(byOrder); } catch { return []; } }
  return cache;
}
/** Все стикеры, включая скрытые (панель «Настройки доски»). */
export const allStickers = async () => items(await api('/design-stickers')).sort(byOrder);

// ---------- значение и чип ----------
const chip = (cls, ...kids) => h('span', { class: 'stk ' + cls }, ...kids);
const colored = (node, color) => { const c = hex(color); if (c) node.style.setProperty('--stc', c); return node; };

/** Значение стикера у задачи → { node, empty } (node — готовый чип; empty — значения нет). */
export function stickerNode(task, st) {
  const none = { node: null, empty: true };
  if (!st || !task) return none;
  if (st.kind === 'system') {
    switch (st.systemField) {
      case 'assignee': {
        const a = task.assignee; if (!a) return none;
        return { node: h('span', { class: 'avatar sm', title: text(a.name), 'aria-label': 'Исполнитель: ' + text(a.name) }, text(a.initials) || '?') };
      }
      case 'deadline': {
        if (!task.deadline) return none;
        const d = Math.round((new Date(String(task.deadline).slice(0, 10)) - new Date(isoDay())) / 864e5);
        const tone = task.status === 'done' ? 'dim' : d < 0 ? 'danger' : d <= 2 ? 'warn' : '';
        return { node: chip(tone, h('span', { class: 'stk-ico', 'aria-hidden': 'true' }, '🗓'), date(task.deadline)) };
      }
      case 'priority': {
        const p = ORDER_PRIORITY[task.priority]; if (!p || task.priority === 'normal') return none;
        return { node: chip(p.tone, p.label) };
      }
      case 'order': return text(task.orderNo) ? { node: chip('', 'ЗНП ' + text(task.orderNo)) } : none;
      case 'product': { const t = text(task.productName) || text(task.sku); return t ? { node: chip('', t) } : none; }
      default: return none;
    }
  }
  const v = task.stickers?.[st.id];
  if (v === null || v === undefined || v === '') return none;
  if (st.kind === 'number') return { node: chip('', st.label + ': ' + qty(v) + (st.unit ? ' ' + st.unit : '')) };
  if (st.kind === 'state') {
    const s = (st.states || []).find((x) => x.id === v);
    return { node: s ? colored(chip('has-color', h('i', { class: 'stk-dot' }), s.label), s.color) : chip('dim', '—') };
  }
  return none;
}

/** Ряд стикеров на карточке доски: первые `limit` по порядку, пустые пропускаются. */
export function stickerRow(task, list, limit = CARD_STICKERS) {
  const nodes = list.slice(0, limit).map((st) => stickerNode(task, st).node).filter(Boolean);
  return h('div', { class: 'db-stk' }, nodes);
}

// ---------- правая панель задачи: «Фото» и «Стикеры» ----------
const block = (title, ...kids) => h('details', { class: 'db-blk', open: true }, h('summary', null, title), h('div', { class: 'db-blk-body' }, ...kids));

export function photosBlock(row, ctx, canEdit) {
  const pics = () => row.photos || (row.photos = []);
  const strip = h('div', { class: 'pf-strip' });
  const paint = () => {
    strip.replaceChildren(...pics().map((p) => h('div', { class: 'pf-item' },
      h('img', { src: PREFIX + (p.thumb || p.url), alt: '', loading: 'lazy', decoding: 'async', title: 'Открыть фото', onclick: () => window.open(PREFIX + p.url, '_blank') }),
      canEdit ? h('button', { type: 'button', class: 'pf-del', title: 'Убрать фото', 'aria-label': 'Убрать фото', onclick: async () => {
        if (!(await confirmDlg('Убрать фото?', 'Фото пропадёт из задачи.', { okText: 'Убрать' }))) return;
        try { await api(`/design-tasks/${row.id}/photos/${p.id}`, { method: 'DELETE' }); row.photos = pics().filter((x) => x.id !== p.id); paint(); ctx.changed(); } catch (e) { toastError(e, 'убрать фото'); }
      } }, '×') : null)));
    strip.hidden = !pics().length;
    hint.textContent = pics().length >= PHOTO_LIMIT ? `Загружено ${PHOTO_LIMIT} из ${PHOTO_LIMIT} — это предел. Уберите ненужные, чтобы добавить новые.` : '';
    drop.hidden = pics().length >= PHOTO_LIMIT;
  };
  const hint = h('div', { class: 'db-hint' });
  const drop = canEdit ? photoDrop({
    attach: async (photoId, p) => { await api(`/design-tasks/${row.id}/photos`, { method: 'POST', body: { photoId } }); pics().push({ id: photoId, ...p }); return pics(); },
    done: () => { paint(); ctx.changed(); },
  }) : h('span');
  paint();
  return block('Фото', strip, !pics().length && !canEdit ? h('div', { class: 'db-hint' }, 'Фото нет.') : null, hint, canEdit ? drop : null);
}

export function stickersBlock(row, list, ctx, canEdit) {
  if (!list.length) return null;
  const save = async (values) => {
    try { await api(`/design-tasks/${row.id}/stickers`, { method: 'PATCH', body: { values } }); row.stickers = { ...(row.stickers || {}), ...values }; ctx.changed(); return true; }
    catch (e) { toastError(e, 'сохранить стикер'); return false; }
  };
  const rows = list.map((st) => {
    const label = h('div', { class: 'stk-label' }, st.label);
    if (st.kind === 'system' || !canEdit) {
      const n = stickerNode(row, st).node;
      return h('div', { class: 'stk-row' }, label, h('div', { class: 'stk-val' }, n || h('span', { class: 'muted' }, st.kind === 'system' && st.systemField === 'assignee' ? 'не назначен' : '—')));
    }
    if (st.kind === 'number') {
      const inp = h('input', { type: 'number', inputmode: 'decimal', step: 'any', 'aria-label': st.label, value: row.stickers?.[st.id] ?? '' });
      inp.addEventListener('change', async () => {
        const raw = inp.value.trim(); const v = raw === '' ? null : Number(raw);
        if (v !== null && !Number.isFinite(v)) { toastError(new Error('Введите число.')); return; }
        await save({ [st.id]: v });
      });
      return h('div', { class: 'stk-row' }, label, h('div', { class: 'stk-val' }, inp, st.unit ? h('span', { class: 'muted' }, ' ' + st.unit) : null));
    }
    const box = h('div', { class: 'stk-states', role: 'group', 'aria-label': st.label });
    const paint = () => box.replaceChildren(...(st.states || []).map((s) => {
      const on = row.stickers?.[st.id] === s.id;
      return colored(h('button', { type: 'button', class: 'stk has-color stk-pick' + (on ? ' on' : ''), 'aria-pressed': String(on), onclick: async () => {
        if (await save({ [st.id]: on ? null : s.id })) paint();
      } }, h('i', { class: 'stk-dot' }), s.label), s.color);
    }));
    paint();
    return h('div', { class: 'stk-row' }, label, box);
  });
  return block('Стикеры', rows);
}
