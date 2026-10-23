/**
 * Объединение раздела «Продукции» (categories type product) в другой — чистая логика без БД (тест: category-merge-plan.test.mjs).
 * Изделия раздела → в целевой раздел; дочерние группы → под целевой раздел (группа с тем же названием уже есть — изделия
 * переходят в неё, лишняя группа — в корзину); сам раздел — в корзину (deletedAt + mergedInto), не стирается.
 *   mergePlan({ cats, products, from, into }) → { ops: [{ coll, id, set, why }], error? }
 */
const norm = (s) => String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
const sid = (x) => (x == null ? null : String(x));

function mergePlan({ cats, products, from, into }) {
  const live = cats.filter((c) => !c.deletedAt && (c.type ?? 'product') === 'product');
  const roots = (name) => live.filter((c) => !c.parentId && norm(c.name) === norm(name));
  const [src, ...srcMore] = roots(from); const [dst, ...dstMore] = roots(into);
  if (!src) return { ops: [], error: `Раздел «${from}» не найден — объединять нечего` };
  if (!dst) return { ops: [], error: `Раздел «${into}» не найден` };
  if (srcMore.length || dstMore.length) return { ops: [], error: 'Разделов с таким названием несколько — объединить вручную' };
  const ops = [];
  const moveProducts = (fromId, toId, why) => {
    for (const p of products) if (!p.deletedAt && sid(p.categoryId) === sid(fromId)) ops.push({ coll: 'products', id: p._id, set: { categoryId: toId }, why });
  };
  moveProducts(src._id, dst._id, `изделие раздела «${src.name}» → «${dst.name}»`);
  for (const kid of live.filter((c) => sid(c.parentId) === sid(src._id))) {
    const twin = live.find((c) => sid(c.parentId) === sid(dst._id) && norm(c.name) === norm(kid.name));
    if (twin) {
      moveProducts(kid._id, twin._id, `изделие группы «${kid.name}» → такая же группа в «${dst.name}»`);
      ops.push({ coll: 'categories', id: kid._id, set: { deletedAt: 'NOW', mergedInto: twin._id }, why: `группа «${kid.name}» — дубль, в корзину` });
    } else {
      ops.push({ coll: 'categories', id: kid._id, set: { parentId: dst._id }, why: `группа «${kid.name}» → под «${dst.name}»` });
    }
  }
  ops.push({ coll: 'categories', id: src._id, set: { deletedAt: 'NOW', mergedInto: dst._id }, why: `раздел «${src.name}» — в корзину (объединён)` });
  return { ops, src, dst };
}

module.exports = { mergePlan };
