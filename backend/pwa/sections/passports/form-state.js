/** Явный номер готового файла: предложенный номер тоже является выбором сотрудника. */
export function readyFileNumber(state) {
  const value = String(state.number ?? '').trim();
  if (!/^\d+$/.test(value)) throw new Error('Укажите номер из файла');
  return value;
}

export const readyFileDirty = (state, saved) => !!state.file && !saved;

/** Смена изделия сразу разрывает связь; введённые вручную значения остаются в форме. */
export function clearProductSelection(form) {
  form.set('productId', '');
  // Только прежние подстановки. Ручные значения и данные экземпляра остаются для явной проверки.
  for (const key of form.keys?.() || []) {
    const input = form.input?.(key); const el = input?.el || input;
    if (!form.manual?.(key) && (el?.classList?.contains('is-default') || ['_copyFrom', '_imgsFrom'].includes(key))) form.set(key, '', { auto: true });
  }
}
