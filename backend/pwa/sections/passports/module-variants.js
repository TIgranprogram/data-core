/** C095: варианты модуля — тело запроса и проверка (виджет — ui/kit/module-variants.js). */
/** Тело запроса: только заполненные варианты; у выпущенного без изменений — как было. */
export function moduleVariantsBody(raw) {
  let v = raw;
  if (typeof v === 'string') { try { v = JSON.parse(v || '[]'); } catch { v = []; } }
  return (Array.isArray(v) ? v : []).filter((m) => m.name && Number.isInteger(m.qty) && m.qty > 0)
    .map((m) => ({ name: m.name, ...(m.size ? { size: m.size } : {}), qty: m.qty, ...(m.photoId ? { photoId: m.photoId } : {}) }));
}

/** Текст ошибки, если есть начатый, но неполный вариант (нет названия или количество не целое > 0); иначе ''. */
export function moduleVariantsBad(raw) {
  let v = raw;
  if (typeof v === 'string') { try { v = JSON.parse(v || '[]'); } catch { v = []; } }
  const bad = (Array.isArray(v) ? v : []).findIndex((m) => !(m.name && Number.isInteger(m.qty) && m.qty > 0));
  return bad < 0 ? '' : `Вариант модуля ${bad + 1}: укажите название и количество — целое число больше нуля`;
}
