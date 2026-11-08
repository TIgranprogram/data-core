import { api, PREFIX } from '../core/api.js';
import { h } from '../core/dom.js';
import { button, empty, carousel, toast, toastError, confirmDlg, section, stack, row, link, photoDrop, busyBlock, failBlock } from '../ui/kit/index.js';
import { KINDS, KINDS_V2 } from '../core/passport-kinds.js';

/**
 * Блок «Фото и файлы» в правой панели изделия. Группы — сворачиваемые секции kit.section (закрыты, в шапке — число файлов):
 * «Витрина» (обложка — вверху карточки), «Для паспорта» (слоты по виду рисунка), «Чертежи» (PDF, DWG, DXF, картинки).
 * Нужные слоты — по POST /passports/check для категории изделия (недостающие «Рисунок: …») + уже загруженные.
 * Загрузка — общий photoDrop (перетащить, Ctrl+V, выбрать файл), как у фото витрины.
 */
const LABEL = new Map([...KINDS, ...KINDS_V2].map(([k, name]) => [k, name]));
const ORDER = [...LABEL.keys()];

// слоты рисунков — из ответа check по изделию: imageSlots (или requiredImages)
async function needKinds(r) {
  const cat = r.passportCategory?.code || r.passportDefaults?.passportCategory || '';
  if (!cat) return null;
  try {
    const res = await api('/passports/check', { method: 'POST', body: { productId: r.id, mode: 'template' } });
    const slots = (res.imageSlots || []).map((s) => (typeof s === 'string' ? s : s.kind || s.key)).filter(Boolean);
    return [...new Set([...slots, ...(res.requiredImages || [])])];
  } catch { return []; }
}

/** Привязать загруженный файл к изделию: рисунок паспорта (kind) или чертёж; old — прежняя запись вида: сначала добавляем новый, при успехе убираем старый. */
export async function attachProductFile(productId, photoId, purpose, kind, old) {
  await api(`/products/${productId}/photos`, { method: 'POST', body: { photoId, purpose, ...(kind ? { kind } : {}) } });
  if (!old) return;
  // новый уже сохранён — прежний убираем после успеха; не вышло: новый не теряем, оба видны, лишний пользователь уберёт сам
  try { await api(`/products/${productId}/photos/${old}`, { method: 'DELETE' }); }
  catch (e) { toast('Новый файл сохранён, но прежний убрать не удалось — уберите его вручную: ' + (e?.message || 'ошибка'), { ms: 9000 }); }
}

/** Зона загрузки рисунка паспорта нужного вида — тот же photoDrop, что у фото витрины. */
export function passportKindDrop(productId, kind, done, old) {
  return photoDrop({ purpose: 'passport', idleText: 'Перетащите рисунок сюда или вставьте Ctrl+V',
    attach: async (photoId) => { await attachProductFile(productId, photoId, 'passport', kind, old); return true; },
    done: () => { toast('Рисунок сохранён'); done?.(); } });
}

const fileIcon = (name) => ({ pdf: '📄', dwg: '📐', dxf: '📐' })[String(name).split('.').pop().toLowerCase()] || '🖼';
const sizeText = (n) => (!n ? '' : n > 1048576 ? `${(n / 1048576).toFixed(1)} МБ` : `${Math.max(1, Math.round(n / 1024))} КБ`);

export function productFilesBlock(r, canEdit) {
  // ПМ-1: без заголовка-линии — сами секции (Витрина, Для паспорта, Чертежи) карточками в колонке
  const root = stack(busyBlock('файлы изделия', { retry: paint }));
  const slot = (kind, rec, required) => {
    const ph = rec?.photoId;
    const pics = ph && ph.storageUrl ? [{ url: ph.storageUrl, thumb: ph.variants?.thumb?.storageUrl || ph.storageUrl, medium: ph.variants?.medium?.storageUrl }] : [];
    const del = async () => {
      if (!(await confirmDlg('Убрать фото?', 'Файл останется в выпущенных паспортах.', { okText: 'Убрать' }))) return;
      try { await api(`/products/${r.id}/photos/${rec.id}`, { method: 'DELETE' }); await paint(); } catch (e) { toastError(e); }
    };
    return h('div', { class: 'field' },
      h('span', null, LABEL.get(kind) || kind, required && !pics.length ? ' *' : ''),
      pics.length ? carousel(pics).el : null,
      canEdit ? passportKindDrop(r.id, kind, paint, rec?.id) : (pics.length ? null : h('div', { class: 'muted' }, 'не загружено')),
      canEdit && pics.length ? h('div', { class: 'actions' }, button({ label: 'Убрать фото', size: 'S', kind: 'ghost', onClick: del })) : null);
  };
  const drawingRow = (rec) => {
    const f = rec.photoId || {};
    const name = f.originalFilename || f.name || 'Чертёж';
    const del = async () => {
      if (!(await confirmDlg('Убрать чертёж?', name, { okText: 'Убрать' }))) return;
      try { await api(`/products/${r.id}/photos/${rec.id}`, { method: 'DELETE' }); await paint(); } catch (e) { toastError(e); }
    };
    return row({ lead: h('span', { 'aria-hidden': 'true' }, fileIcon(name)), title: name, meta: sizeText(f.size || f.sizeBytes),
      action: [link({ label: 'Скачать', href: PREFIX + (f.storageUrl || ''), target: '_blank' }), canEdit ? button({ label: 'Убрать', size: 'S', kind: 'ghost', onClick: del }) : null] });
  };
  async function paint() {
    let items = [], need, drawings = [];
    try {
      [items, need, drawings] = await Promise.all([api(`/products/${r.id}/photos?purpose=passport`).then((x) => x.items || x), needKinds(r),
        api(`/products/${r.id}/photos?purpose=drawing`).then((x) => x.items || x).catch(() => [])]);
    } catch (e) {
      root.replaceChildren(failBlock(e, paint, { text: 'Фото и файлы изделия не загрузились' }));
      return;
    }
    const byKind = new Map((items || []).map((x) => [x.kind === 'safety_zone' ? 'safety' : x.kind, x]));
    const req = new Set(need || []);
    const kinds = ORDER.filter((k) => req.has(k) || byKind.has(k));
    const passport = need === null && !kinds.length
      ? empty({ title: 'Категория паспорта не выбрана', hint: 'Выберите её в блоке «Паспорт» — появятся нужные слоты.' })
      : kinds.length ? h('div', null, ...kinds.map((k) => slot(k, byKind.get(k), req.has(k)))) : empty({ title: 'Для этой категории рисунки не нужны' });
    const dr = drawings || [];
    // Чертежи — одно место: «Вложения → Чертежи» (пользователь 2026-11-08: два блока «Чертежи» — дубль). Здесь только уже загруженные раньше, без новой загрузки.
    const drawingsBody = h('div', null, h('div', null, ...dr.map(drawingRow)), h('p', { class: 'muted small' }, 'Новые чертежи загружайте во «Вложения → Чертежи».'));
    const open = new Set([...root.querySelectorAll('details.k-sec[open]')].map((d) => d.dataset.key));
    const mk = (key, title, count, body) => { const s = section({ title, count, body, open: open.has(key), tone: 'info' }); s.dataset.key = key; return s; };
    root.replaceChildren(
      mk('shop', 'Витрина', (r.photos || []).length, h('div', { class: 'muted' }, 'Фото на обложку и в списках — наверху карточки.')),
      mk('passport', 'Для паспорта', byKind.size, passport),
      ...(dr.length ? [mk('drawing', 'Чертежи (раньше загруженные)', dr.length, drawingsBody)] : []));
  }
  paint();
  return root;
}
