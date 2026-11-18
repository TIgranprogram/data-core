// C134: картинки паспорта в окне: показ, «×», загрузка. Все изменения идут одной очередью и каждый раз от свежего списка с сервера
// (иначе вторая из двух загруженных подряд картинок затирает первую).
import { api, PREFIX } from '../../core/api.js';
import { h } from '../../core/dom.js';
import { toastError } from '../../ui/kit/toast.js';
import { confirmDlg } from '../../ui/kit/dialog.js';
import { button, iconButton } from '../../ui/kit/index.js';
import { photoDrop } from '../../ui/kit/photos.js';
import { imagesBody } from '../../core/passport-images.js';
import { imgsOf, isRequired, kindOf } from './common.js';

/** ctx: { S, can, exclusive(fn), rerender() }. */
export function imageStrip(ctx, kind, label, full) {
  const { S, can } = ctx;
  const r = S.r;
  const list = imgsOf(r, kind);
  const inherited = list.some((i) => i.fromProduct);
  const std = (r.standardImages || []).filter((x) => kindOf(x) === kind && x.url);
  const mutate = (change) => {
    const run = () => ctx.exclusive(async () => {
      const cur = await api('/passports/' + S.r.id);
      if (imgsOf(cur, kind).some((i) => i.fromProduct)) throw new Error('Рисунок из изделия. Обновите его через Inventor.');
      await api('/passports/' + S.r.id, { method: 'PATCH', body: { images: imagesBody(change(cur.images || [])) } });
      S.r = await api('/passports/' + S.r.id);
      S.changed = true;
    });
    ctx.imgQ = (ctx.imgQ || Promise.resolve()).catch(() => {}).then(run);
    return ctx.imgQ;
  };
  const wrap = h('div', { class: 'bk-imgs' + (full ? ' bk-imgs-full' : ''), 'data-focus': 'img_' + kind, 'data-img-kind': kind });
  list.forEach((i) => wrap.append(h('figure', { class: 'bk-fig' },
    i.url ? h('img', { src: PREFIX + i.url, alt: i.caption || label }) : h('span', { class: 'muted' }, 'нет файла'),
    can && !i.fromProduct ? iconButton({ icon: '×', label: 'Убрать картинку', size: 'S', onClick: async () => {
      if (!(await confirmDlg('Убрать картинку?', label + ': картинка исчезнет из паспорта.', { okText: 'Убрать' }))) return;
      try { await mutate((all) => all.filter((x) => String(x.photoId) !== String(i.photoId))); ctx.rerender(); } catch (e) { toastError(e); }
    } }) : null)));
  if (!list.length && std.length) wrap.append(h('p', { class: 'bk-mark' }, 'Стандартная схема попадёт в паспорт; своя картинка её заменит.'), ...std.map((i) => h('figure', { class: 'bk-fig' }, h('img', { src: PREFIX + i.url, alt: label }))));
  if (!list.length && !std.length) wrap.append(h('p', { class: 'bk-noimg' }, (isRequired(r, kind) ? 'Нет картинки — обязательна. ' : 'Нет картинки. ') + label));
  if (inherited) wrap.append(h('p', { class: 'hint' }, 'Рисунок из изделия. Обновляется через Inventor.'));
  if (can && !inherited) {
    const upload = (append = false) => photoDrop({
      purpose: 'passport',
      attach: async (photoId) => {
        await mutate((all) => [...all.filter((i) => append ? !(kindOf(i) === kind && String(i.photoId) === String(photoId)) : kindOf(i) !== kind), { kind, photoId }]);
        return S.r;
      },
      done: () => ctx.rerender(),
      idleText: append ? 'Добавить ещё один рисунок этого вида: перетащите / Ctrl+V'
        : list.length ? 'Заменить рисунок этого вида: перетащите / Ctrl+V' : 'Перетащите или вставьте Ctrl+V',
      pickText: append ? 'Добавить файл' : list.length ? 'Заменить рисунок' : 'Выбрать файл',
    });
    wrap.append(upload());
    if (list.length) {
      const extra = h('div', { hidden: true });
      wrap.append(button({ label: 'Добавить ещё', kind: 'ghost', size: 'S', onClick: () => {
        if (!extra.firstChild) extra.append(upload(true));
        extra.hidden = false;
      } }), extra);
    }
  }
  return wrap;
}
