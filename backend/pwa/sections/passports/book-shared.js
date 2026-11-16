// C134: «В справочник» в окне паспорта — выбор записи справочника для старых паспортов без ссылки на источник (как field-edit.js).
import { h } from '../../core/dom.js';
import { button, select } from '../../ui/kit/index.js';

// Промпт «проверь тексты паспорта» для внешнего ИИ (пользователь 2026-11-16): копируется, ответ — коротко по разделам.
export function aiPrompt({ pages }) {
  const body = pages.map((t, i) => `=== Страница ${i + 1} ===\n${String(t).replace(/\n{3,}/g, '\n\n').trim()}`).join('\n\n');
  return [
    'Ты — технический редактор паспортов изделий (ГОСТ 2.601, ГОСТ Р 52301 для оборудования детских и спортивных площадок, благоустройство).',
    'Проверь тексты паспорта ниже: ошибки и опечатки, грамматика и падежи, противоречия между разделами, повторы, несоответствие изделию, устаревшие или неверные ГОСТ, пропущенные важные требования безопасности.',
    'Ответ — коротко и по структуре, без вступлений. Только то, что нужно менять. Формат каждой строки:',
    '«Раздел / пункт (номер) — что не так — как исправить (готовый текст)».',
    'Сгруппируй по разделам в порядке паспорта. В конце одна строка: «Итог: N правок, из них важных: M». Если всё хорошо — «Правок нет».',
    '',
    body,
  ].join('\n');
}

/** Текст листа без кнопок и полей загрузки картинок. */
export function pageText(el) {
  const c = el.cloneNode(true);
  c.querySelectorAll('button, input, select, textarea, [class*="photo"], [class*="drop"], .bk-ed').forEach((x) => x.remove());
  c.classList.add('bk-measure'); c.style.setProperty('--w', el.offsetWidth + 'px');
  document.body.append(c);
  const t = c.innerText.split('\n').filter((l) => l.trim() && !/^[×🖼]$/u.test(l.trim())).join('\n');
  c.remove();
  return t;
}

export function aiCheckBlock(collect) {
  const status = h('p', { class: 'hint', 'aria-live': 'polite' });
  const btn = button({ label: 'Скопировать промпт для проверки ИИ', size: 'S', title: 'Все тексты паспорта + задание для ИИ. Вставьте в чат ИИ', onClick: async () => {
    const text = aiPrompt(collect());
    try { await navigator.clipboard.writeText(text); status.textContent = 'Скопировано. Вставьте в чат ИИ — ответ придёт по разделам.'; }
    catch { status.textContent = 'Браузер не дал скопировать. Попробуйте ещё раз.'; }
  } });
  return h('div', { class: 'bk-ai' }, h('h3', { class: 'bk-side-h' }, 'Проверка текстов ИИ'), h('p', { class: 'hint' }, 'Соберёт все тексты паспорта в одно задание для ИИ.'), btn, status);
}

/** Возвращает { key } — можно сохранять; { stop: 'текст' } — показать текст и ждать действия. */
export async function pickSourceKey(shared, box, state) {
  if (!shared.needsSource) return { key: undefined };
  if (!state.sel) {
    const items = await shared.sources();
    if (!items.length) return { stop: 'Для этой строки нет источника в справочнике. Сохраните только в этом паспорте.' };
    if (items.length === 1) return { key: items[0].sourceKey };
    state.sel = select({ label: 'Куда сохранить', value: '', options: [['', 'Выберите запись справочника…'], ...items.map((x) => [x.sourceKey, x.label])] });
    box.insertBefore(h('div', { class: 'bk-ed-row' }, state.sel), box.lastChild);
    return { stop: 'Выберите запись справочника и нажмите «В справочник» ещё раз.' };
  }
  const v = state.sel.querySelector?.('select')?.value ?? state.sel.value;
  return v ? { key: v } : { stop: 'Выберите запись справочника.' };
}
