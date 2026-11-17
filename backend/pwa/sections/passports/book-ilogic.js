/**
 * C141: справа внизу книжки — эталон правила Inventor iLogic «Картинки для паспорта».
 * Текст лежит статикой: /app/ilogic/passport-images.iLogicVb (канон в репо).
 * Пути API правила: photos/upload, products/:id/photos, PATCH showcase — не менять без синхронизации с .iLogicVb.
 */
import { PREFIX } from '../../core/api.js';
import { h } from '../../core/dom.js';
import { button } from '../../ui/kit/index.js';
import { sidePanel } from './book-shared.js';

const FILE = 'ilogic/passport-images.iLogicVb';

/** URL файла на этом же сайте (локально /app/…, за nginx /db/app/…). */
export function ilogicRuleUrl() {
  return `${PREFIX}/app/${FILE}`;
}

/** Блок «Inventor» для правой колонки книжки. */
export function ilogicBlock() {
  const status = h('p', { class: 'hint bk-toc-hint', 'aria-live': 'polite' });
  const body = h('div', { class: 'bk-ilogic-body' });

  const btn = button({
    label: 'Правило iLogic',
    size: 'S',
    kind: 'ghost',
    title: 'Вставьте в Inventor: iLogic → внешнее правило. Нужен ключ kppd_ в переменной DATACORE_API_KEY',
    onClick: async () => {
      status.textContent = 'Читаю правило…';
      body.querySelector('textarea.bk-ilogic-ta')?.remove();
      try {
        const res = await fetch(ilogicRuleUrl(), { cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const text = await res.text();
        if (!text.includes('UploadPassportImages') || !text.includes('kppdf-crm.ru/db/api/')) {
          throw new Error('Файл правила повреждён или неполный');
        }
        try {
          await navigator.clipboard.writeText(text);
          status.textContent = 'Скопировано. В Inventor: внешнее правило ← вставить. Ключ — DATACORE_API_KEY.';
        } catch {
          const ta = h('pre', { class: 'bk-ilogic-ta', tabindex: '0', 'aria-label': 'Текст правила iLogic' }, text);
          body.append(ta);
          const range = document.createRange();
          range.selectNodeContents(ta);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          status.textContent = 'Буфер недоступен — Ctrl+C по выделенному тексту ниже.';
        }
      } catch (e) {
        status.textContent = 'Не удалось получить правило. Нажмите «Скачать .iLogicVb» или обновите страницу.';
        console.warn('ilogic copy', e);
      }
    },
  });

  const open = h('a', {
    class: 'bk-ilogic-link',
    href: ilogicRuleUrl(),
    target: '_blank',
    rel: 'noopener',
    download: 'passport-images.iLogicVb',
  }, 'Скачать .iLogicVb');

  body.append(
    h('p', { class: 'hint bk-toc-hint' }, 'Правило рисует общий вид, габариты и схему в карточку изделия. Скопируйте в iLogic на любом ПК.'),
    h('div', { class: 'bk-ed-row' }, btn, open),
    status,
  );
  return sidePanel('Inventor', body);
}
