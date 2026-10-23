/**
 * Картинки паспорта в форме (ФП): каждая — только в своём виде. Тесты — node --test backend/pwa/core/passport-images.test.mjs
 * Раньше одна вставка Ctrl+V попадала во все виды формы, а картинки модели добавлялись поверх выбранных — получались дубли.
 */

/** Список картинок → тело запроса (вид, id, порядок внутри вида). Без вида — «Общий вид» (overview). */
export const imagesBody = (list) => {
  const n = {};
  return (list || []).map((i) => {
    const kind = i.kind || 'overview';
    n[kind] = (n[kind] ?? -1) + 1;
    return { kind, photoId: String(i.photoId), order: n[kind], ...(i.caption ? { caption: i.caption } : {}) };
  });
};

/** Значения полей формы img_<вид> (списки id) → картинки паспорта; один и тот же снимок в одном виде — один раз. */
export function formImages(values, kinds) {
  const out = [];
  for (const kind of kinds) {
    const seen = new Set();
    for (const id of values['img_' + kind] || []) { const s = String(id); if (!s || seen.has(s)) continue; seen.add(s); out.push({ kind, photoId: s }); }
  }
  return imagesBody(out);
}

/** Картинки модели (паспорт-образец, с url) → значения полей формы по видам; safety_zone → safety, без вида → overview. */
export function modelImagesToForm(images, kinds) {
  const by = Object.fromEntries(kinds.map((k) => [k, []]));
  const sorted = [...(images || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  for (const i of sorted) {
    if (!i.url) continue;
    let k = i.kind || 'overview';
    if (k === 'safety_zone') k = 'safety';
    if (!by[k] || by[k].some((p) => p.id === String(i.photoId))) continue;
    by[k].push({ id: String(i.photoId), url: i.url, thumb: i.thumb || i.url });
  }
  return by;
}
