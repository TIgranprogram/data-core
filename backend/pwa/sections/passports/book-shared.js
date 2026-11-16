// C134: общие кусочки окна паспорта — выбор записи справочника для старых паспортов, блок «проверка ИИ», замок действий.
import { h } from '../../core/dom.js';
import { button, select } from '../../ui/kit/index.js';

// Промпт «проверь тексты паспорта» для внешнего ИИ (пользователь 2026-11-16): копируется, ответ — коротко по разделам.
const TASK = [
  'Проверь паспорт изделия: ошибки и опечатки, грамматика и падежи, противоречия между разделами, повторы, несоответствие изделию, устаревшие или неверные ГОСТ (ГОСТ 2.601, ГОСТ Р 52301 для оборудования детских и спортивных площадок), пропущенные важные требования безопасности.',
  'Формат ответа — коротко, без вступлений, по разделам в порядке паспорта. Каждая строка: «Раздел / пункт (номер) — что не так — как исправить (готовый текст)».',
  'Сначала все важные правки (безопасность, противоречия, неверные цифры и ГОСТ), затем остальные. Одна правка — одна строка, не длиннее 2 строк; готовый текст — только изменённая фраза. Одинаковые правки (термин, название) — одной строкой «везде: … → …».',
  'Не больше 25 правок в ответе. Если правок больше — после 25-й напиши «Есть ещё N правок — напишите «продолжи»».',
  'В конце одна строка: «Итог: N правок, из них важных: M». Если всё хорошо — «Правок нет».',
  'Журналы и гарантийный талон приведены только заголовками и пустыми графами — это нормально, ссылки на их таблицы ошибкой не считать.',
];

export function aiPrompt({ pages }) {
  const body = pages.map((t, i) => `=== Страница ${i + 1} ===\n${String(t).replace(/\n{3,}/g, '\n\n').trim()}`).join('\n\n');
  return [
    'ЗАДАНИЕ: сразу проверь паспорт ниже. Ничего не переспрашивай и не предлагай вариантов, выдай только список правок.',
    ...TASK, '',
    '--- НАЧАЛО ПАСПОРТА ---', body, '--- КОНЕЦ ПАСПОРТА ---', '',
    'НАПОМИНАНИЕ ЗАДАНИЯ: паспорт выше нужно проверить сейчас, без вопросов. Выдай только список правок.',
    ...TASK,
  ].join('\n');
}

/** Текст листа: только то, что печатается в PDF (без кнопок, загрузчиков, подсказок и пояснений интерфейса). */
export function pageText(el) {
  const c = el.cloneNode(true);
  c.querySelectorAll('button, input, select, textarea, [class*="photo"], [class*="drop"], .bk-ed, .bk-mark, .bk-noimg, .bk-pno, .bk-keys, .bk-ui, .muted, .hint').forEach((x) => x.remove());
  c.classList.add('bk-measure'); c.style.setProperty('--w', el.offsetWidth + 'px');
  document.body.append(c);
  const t = c.innerText.split('\n').filter((l) => l.trim() && !/^[×🖼]$/u.test(l.trim())).join('\n');
  c.remove();
  return t;
}

/** Одно действие над паспортом за раз; занято — ошибка, а не молчаливый пропуск (иначе «Сохранено» без записи). */
export async function exclusive(id, passportAction, fn) {
  let ran = false;
  const res = await passportAction(id, async () => { ran = true; return fn(); });
  if (!ran) throw new Error('Дождитесь завершения предыдущего действия и повторите');
  return res;
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
