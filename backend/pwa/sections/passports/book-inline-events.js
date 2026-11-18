/** Ввод и кнопки открытого редактора не запускают повторное открытие родительского поля. */
export function bindBookInlineEvents(view, open) {
  view.addEventListener('click', (event) => {
    if (event.target?.closest?.('.bk-ed, a, button, input, textarea, select, [contenteditable]')) return;
    open();
  });
  view.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target === view) { event.preventDefault(); open(); }
  });
}

/** «Только в этом паспорте»: ручное имя не возвращается к имени изделия при обновлении черновика. */
export function passportNamePatch(row, name) {
  return { name, manualText: [...new Set([...(row.manualText || []), 'name'])] };
}
