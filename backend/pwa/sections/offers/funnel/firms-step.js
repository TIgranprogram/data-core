import { h } from '../../../core/dom.js';
import { go } from '../../../core/router.js';
import { button, hint, section, stack, tagPick, textInput } from '../../../ui/kit/index.js';
import { loadFirms, readPrefs } from './api.js';

/**
 * Шаг 4 «От каких фирм»: метки с галочками (только фирмы с бланком), у каждой выбранной — наценка, % (по умолчанию 0).
 * Фирмы без бланка названы строкой с кнопкой «Загрузить бланк». Прошлый выбор и наценки помнит браузер.
 *   firmsStep({ onChange }) → { el, picked() → [{ id, name, pct }], bad() → текст ошибки|'' }
 */
export function firmsStep({ onChange }) {
  const box = stack(hint('Загружаю фирмы…'));
  let firms = []; let tp = null; const pct = new Map();
  const inputs = stack();

  function ids() { try { return (JSON.parse(tp?.value || '[]') || []).map(String); } catch { return []; } }
  const picked = () => ids().map((id) => firms.find((c) => c.id === id)).filter(Boolean).map((c) => ({ id: c.id, name: c.name, pct: Number(pct.get(c.id)) || 0 }));
  const bad = () => picked().map((f) => (f.pct < -50 || f.pct > 200 ? `Наценка для «${f.name}» — от −50 до 200 %` : '')).find(Boolean) || '';

  function paintInputs() {
    inputs.replaceChildren(...picked().map((f) => textInput({
      label: `Наценка для ${f.name}, %`, value: String(pct.get(f.id) ?? 0), type: 'number', inputmode: 'decimal',
      onInput: (v) => { pct.set(f.id, Number(v) || 0); onChange(); },
    }).el));
  }

  loadFirms().then((all) => {
    firms = all.filter((c) => c.hasBlank);
    const noBlank = all.filter((c) => !c.hasBlank).map((c) => c.name);
    const prefs = readPrefs();
    for (const p of prefs.companies || []) pct.set(String(p.id), Number(p.markup) || 0);
    if (!firms.length) {
      box.replaceChildren(hint(`Нет фирм с бланком КП${noBlank.length ? `: ${noBlank.join(', ')}` : ''}. Загрузите бланк в «Контрагенты → Наши компании».`, 'danger'),
        button({ label: 'Загрузить бланк', size: 'S', onClick: () => go('partners') }));
      onChange(); return;
    }
    const start = (prefs.companies || []).map((p) => String(p.id)).filter((id) => firms.some((c) => c.id === id));
    tp = tagPick({ label: 'Фирмы', options: firms.map((c) => ({ value: c.id, label: c.name })), value: start.length ? start : [firms[0].id] });
    tp.el.addEventListener('change', () => { paintInputs(); onChange(); });
    box.replaceChildren(tp.el, inputs,
      ...(noBlank.length ? [hint(`Нет бланка КП: ${noBlank.join(', ')}.`), button({ label: 'Загрузить бланк', size: 'S', onClick: () => go('partners') })] : []));
    paintInputs(); onChange();
  });
  const el = section({ title: 'От каких фирм', open: true, tone: 'main', body: [box] });
  return { el, picked, bad };
}
