import { api, apiBlob, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { button, fileButton, section, openPdfPreview, buildForm, photoStrip, hint } from '../ui/kit/index.js';
import { toast, toastError } from '../ui/kit/toast.js';

const enc = (id) => encodeURIComponent(id);
const MM = [
  ['coverTop', 'Обложка: сверху, мм'], ['coverRight', 'Обложка: справа, мм'], ['coverBottom', 'Обложка: снизу, мм'], ['coverLeft', 'Обложка: слева, мм'],
  ['pageTop', 'Страницы: сверху, мм'], ['pageRight', 'Страницы: справа, мм'], ['pageBottom', 'Страницы: снизу, мм'], ['pageLeft', 'Страницы: слева, мм'],
];

/**
 * Вид паспорта (C076) в карточке нашей фирмы, блок рядом с «Бланк КП».
 * Картинок нет — печать как сейчас. Выданные сами не перепечатываются.
 */
export function passportLookBlock(r, ctx) {
  const root = h('div');
  const paint = async () => {
    const wasOpen = root.querySelector('details.k-sec')?.open || false;
    let look = { color: null, cover: null, page: null, margins: { cover: {}, page: {} } };
    try { look = await api(`/passports/look/${enc(r.id)}`); } catch (e) { toastError(e); }
    const mm = (slot, side) => {
      const v = look.margins?.[slot]?.[side];
      return v === null || v === undefined || v === '' ? '' : String(v);
    };
    const initial = { color: look.color || '' };
    for (const [key] of MM) {
      const slot = key.startsWith('cover') ? 'cover' : 'page';
      initial[key] = mm(slot, key.replace(/^cover|^page/, '').toLowerCase());
    }
    const form = session.canEdit ? buildForm([
      { key: 'color', label: 'Цвет линий', hint: 'Например #1A2B3C. Пусто — чёрные. В PDF цвет виден, только когда загружен фон.' },
      ...MM.map(([key, label], i) => ({ key, label, type: 'number', min: 0, hint: i === 0 ? 'Отступ текста от края бланка, 0–40. Пусто — как без бланка.' : undefined })),
    ], initial) : null;
    const upload = (key) => async (file) => {
      if (!file || !/^image\/(png|jpeg)$/.test(file.type)) { toastError(new Error('Нужен PNG или JPG до 5 МБ, лист А5')); return; }
      const fd = new FormData();
      fd.append('file', file, file.name || `passport-${key}.jpg`);
      try {
        const saved = await api(`/passports/look/${enc(r.id)}/${key}`, { method: 'POST', body: fd });
        toast(saved?.warning ? `Фон загружен. ${saved.warning}` : 'Фон паспорта загружен');
        ctx.reload();
      } catch (e) { toastError(e); }
    };
    const slot = (key, title) => {
      const cur = look[key];
      const onFile = upload(key);
      const zone = h('div', null,
        hint(title),
        cur?.url ? photoStrip([{ url: cur.url }]) : h('p', { class: 'muted small' }, 'Не загружено — эта страница печатается как сейчас'),
        session.canEdit ? fileButton({ label: cur ? 'Заменить картинку' : 'Загрузить картинку', accept: 'image/png,image/jpeg', onFile }) : null,
        cur && session.canEdit ? button({ label: 'Убрать', kind: 'ghost', size: 'S', onClick: async () => {
          try { await api(`/passports/look/${enc(r.id)}/${key}`, { method: 'DELETE' }); toast('Фон убран — эта страница снова печатается как раньше'); ctx.reload(); } catch (e) { toastError(e); }
        } }) : null);
      if (session.canEdit) {
        zone.addEventListener('dragover', (e) => e.preventDefault());
        zone.addEventListener('drop', (e) => { e.preventDefault(); onFile(e.dataTransfer?.files?.[0]); });
        zone.addEventListener('paste', (e) => { const f = [...(e.clipboardData?.items || [])].find((i) => i.kind === 'file')?.getAsFile(); if (f) { e.preventDefault(); onFile(f); } });
      }
      return zone;
    };
    const save = async () => {
      const res = form?.read();
      if (!res || res.errors) return;
      const color = String(res.values.color || '').trim();
      if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) { toastError(new Error('Цвет — в виде #RRGGBB')); return; }
      const body = { color: color || null };
      for (const [key] of MM) {
        const v = res.values[key];
        if (v !== null && Number(v) > 40) { toastError(new Error('Отступ — от 0 до 40 мм')); return; }
        body[key] = v;
      }
      try { await api(`/passports/look/${enc(r.id)}`, { method: 'PATCH', body }); toast('Вид паспорта сохранён'); ctx.reload(); } catch (e) { toastError(e); }
    };
    const n = (look.cover ? 1 : 0) + (look.page ? 1 : 0);
    root.replaceChildren(section({ tone: 'neutral', title: 'Вид паспорта', count: n, open: wasOpen, body: [
      hint('PNG или JPG до 5 МБ, лист А5. Нет картинки — паспорт печатается как сейчас. Уже выданные сами не перепечатываются.'),
      slot('cover', 'Обложка'),
      slot('page', 'Остальные страницы'),
      form?.el,
      session.canEdit ? button({ label: 'Сохранить', size: 'S', onClick: save }) : null,
      button({ label: 'Предпросмотр первой страницы', size: 'S', title: 'Образец обложки этой фирмы', onClick: () => {
        openPdfPreview({ title: `Вид паспорта · ${r.name || ''}`.trim(), load: () => apiBlob(`/passports/look/${enc(r.id)}/preview`, { fallback: 'Вид-паспорта.pdf' }) });
      } }),
    ] }));
  };
  paint();
  return root;
}
