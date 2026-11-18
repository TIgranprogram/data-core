/** Подстановка текста выбранного монтажа с сохранением собственной правки менеджера. */
export function installationTextPicker(form, rows, initialId) {
  const textOf = (id) => String(rows.find((r) => String(r.id || r._id) === String(id))?.montage || '').trim();
  let previous = textOf(initialId);
  const fill = (text) => form.set('installation', text, { auto: true, src: 'из способа установки' });
  if (!String(form.get('installation') || '').trim() && previous) fill(previous);
  return (id) => {
    const current = String(form.get('installation') || '');
    const next = textOf(id);
    if (!current.trim() || current.trim() === previous) fill(next);
    previous = next;
  };
}
