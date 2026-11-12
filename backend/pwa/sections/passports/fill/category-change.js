/** Явная смена категории: ручной текст и выборы очищаются только после согласия. Остальные данные изделия сохраняются. */
export async function changeCategory(prod, value, { approve, put, reset, read }) {
  const previous = prod.passportDefaults || {};
  if (value === (previous.passportCategory || '') && value) return false;
  const hasTexts = Object.keys(previous.textChoices || {}).length || Object.keys(previous.textOverrides || {}).length;
  if (hasTexts && !(await approve())) return false;
  const draft = { ...prod, passportDefaults: { ...previous, textChoices: {}, textOverrides: {} } };
  let fresh;
  if (!value) fresh = await reset(draft);
  else { await put(draft, { passportCategory: value, textChoices: {}, textOverrides: {} }); fresh = await read(prod.id); }
  Object.assign(prod, fresh);
  return true;
}
