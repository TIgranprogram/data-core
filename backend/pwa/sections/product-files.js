import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { button, empty, carousel, uploadPhoto, toast, toastError, confirmDlg } from '../ui/kit/index.js';
import { KINDS, KINDS_V2 } from '../core/passport-kinds.js';

/**
 * Блок «Фото и файлы» в правой панели изделия (PRODUCT-FILES, шаг d).
 * Группы: «Витрина» (обложка — вверху карточки), «Для паспорта» (слоты по виду рисунка), «Чертежи» (скоро).
 * Нужные слоты — по POST /passports/check для категории изделия (недостающие «Рисунок: …») + уже загруженные.
 */
const LABEL = new Map([...KINDS, ...KINDS_V2].map(([k, name]) => [k, name]));
const ORDER = [...LABEL.keys()];
const sec = (title, ...body) => h('section', { class: 'form-block', 'data-tone': 'main' }, h('div', { class: 'form-sec-t' }, title), ...body);

async function needKinds(r) {
  const cat = r.passportCategory?.code || r.passportDefaults?.passportCategory || '';
  if (!cat) return null;
  try {
    const res = await api('/passports/check', { method: 'POST', body: { name: r.name, passportCategory: cat, isKit: !!r.passportDefaults?.isKit, images: [] } });
    return (res.missing || []).map((m) => String(m.key || '')).filter((k) => k.startsWith('img_')).map((k) => k.slice(4));
  } catch { return []; }
}

export function productFilesBlock(r, canEdit) {
  const root = h('div', null, sec('Для паспорта', h('div', { class: 'muted' }, 'Загружаю…')));
  const attach = async (kind, file, old) => {
    const { id } = await uploadPhoto(file);
    await api(`/products/${r.id}/photos`, { method: 'POST', body: { photoId: id, purpose: 'passport', kind } });
    if (old) await api(`/products/${r.id}/photos/${old}`, { method: 'DELETE' });
  };
  const slot = (kind, rec, required) => {
    const input = h('input', { type: 'file', accept: 'image/*', hidden: true });
    input.addEventListener('change', async () => {
      const f = input.files[0]; if (!f) return;
      try { await attach(kind, f, rec?.id); toast('Фото сохранено'); await paint(); } catch (e) { toastError(e); }
    });
    const ph = rec?.photoId;
    const pics = ph && ph.storageUrl ? [{ url: ph.storageUrl, thumb: ph.variants?.thumb?.storageUrl || ph.storageUrl, medium: ph.variants?.medium?.storageUrl }] : [];
    const del = async () => {
      if (!(await confirmDlg('Убрать фото?', 'Файл останется в выпущенных паспортах.', { okText: 'Убрать' }))) return;
      try { await api(`/products/${r.id}/photos/${rec.id}`, { method: 'DELETE' }); await paint(); } catch (e) { toastError(e); }
    };
    return h('div', null,
      h('div', { class: 'form-sec-t' }, LABEL.get(kind) || kind, required && !pics.length ? ' *' : ''),
      pics.length ? carousel(pics).el : null,
      canEdit ? h('div', { class: 'actions' }, input,
        button({ label: pics.length ? 'Заменить' : '+ Загрузить', size: 'S', onClick: () => input.click() }),
        pics.length ? button({ label: 'Удалить', size: 'S', onClick: del }) : null) : (pics.length ? null : h('div', { class: 'muted' }, 'не загружено')));
  };
  async function paint() {
    let items = [], need;
    try { [items, need] = await Promise.all([api(`/products/${r.id}/photos?purpose=passport`).then((x) => x.items || x), needKinds(r)]); } catch (e) { toastError(e); }
    const byKind = new Map((items || []).map((x) => [x.kind === 'safety_zone' ? 'safety' : x.kind, x]));
    const req = new Set(need || []);
    const kinds = ORDER.filter((k) => req.has(k) || byKind.has(k));
    const passport = need === null && !kinds.length
      ? empty({ title: 'Категория паспорта не выбрана', hint: 'Выберите её в блоке «Паспорт» — появятся нужные слоты.' })
      : kinds.length ? h('div', null, ...kinds.map((k) => slot(k, byKind.get(k), req.has(k)))) : empty({ title: 'Для этой категории рисунки не нужны' });
    root.replaceChildren(
      sec('Витрина', h('div', { class: 'muted' }, `Фото на обложку и в списках: ${(r.photos || []).length} шт. — наверху карточки.`)),
      sec('Для паспорта', passport),
      sec('Чертежи', empty({ title: 'Скоро: DWG и PDF' })));
  }
  paint();
  return root;
}
