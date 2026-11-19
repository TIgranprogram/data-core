/**
 * C141: слева в книжке — «Сначала заполнить / проверить».
 * У новой книжки причины берутся из ответа той же проекции. Старые черновики используют очередь изделия.
 */
import { h } from '../../core/dom.js';
import { toast } from '../../ui/kit/toast.js';
import { button, hint } from '../../ui/kit/index.js';
import { openMaterialsInBook, openDimsInBook, openCompositionInBook } from './book-side-edit.js';
import { isBookSetting } from './book-template-edit.js';

const PAGE_HINTS = [
  [/обложк|наименован|паспорт\s*№/i, ['name', 'description', 'img_overview']],
  [/описан|назначен/i, ['description', 'purpose', 'blg.material', 'materials']],
  [/уход|обслужив|то\b|провер/i, ['maintenance']],
  [/монтаж|установ/i, ['install', 'installation', 'installationTypeId', 'foundationDepth', 'img_mounting', 'img_foundation']],
  [/габарит|характерист|размер|вес/i, ['dimensions', 'weightKg', 'heightMin', 'heightMax', 'weightMax', 'maxUsers', 'seatsCount', 'siteLength', 'siteWidth', 'fallHeight', 'ageFrom', 'ageTo', 'img_dimensions']],
  [/комплект|состав/i, ['composition', 'elements', 'modules']],
  [/гарант/i, ['warrantyMonths', 'serviceLifeYears']],
];

function focusLabel(it) {
  if (['parts', 'materials'].includes(String(it.key || ''))) return 'Описание конструкции и материалов';
  const raw = String(it.label || it.key || '');
  const broken = raw.match(/не читается:\s*(.+?)(?:\.|$)/i)
    || raw.match(/^(.+?):\s*файл на сервере/i);
  if (broken) return broken[1].trim() + ' — файл битый, замените';
  if (String(it.key || '').startsWith('img_')) return raw.replace(/^Рисунок:\s*/i, '') || 'Рисунок';
  return raw;
}

function pageForKey(pagesEl, key) {
  const pages = [...(pagesEl?.children || [])];
  const byKey = pages.find((p) => [...p.querySelectorAll('[data-focus]')].some((node) => node.dataset.focus === key));
  if (byKey) return byKey;
  for (const [re, keys] of PAGE_HINTS) {
    if (!keys.includes(key)) continue;
    const hit = pages.find((p) => re.test(p.textContent || ''));
    if (hit) return hit;
  }
  return null;
}

function flash(el) {
  if (!el) return;
  // мгновенно к месту — иначе рамка гаснет, пока ещё листается
  el.scrollIntoView({ behavior: 'instant', block: 'center' });
  el.classList.remove('bk-page-flash');
  void el.offsetWidth;
  el.classList.add('bk-page-flash');
  clearTimeout(flash._t);
  flash._t = setTimeout(() => el.classList.remove('bk-page-flash'), 3600);
}

/**
 * ctx: { S, can, pagesEl, sideSlot, sideHome, onChanged }.
 * sideSlot — правая колонка книжки; sideHome() возвращает подсказку ИИ.
 */
export function mountBookFocus(host, ctx) {
  let timer = 0;

  const afterSide = ({ saved } = {}) => {
    ctx.sideHome?.();
    if (saved) { ctx.S.changed = true; ctx.onChanged?.(); }
  };

  const paint = () => {
    const r = ctx.S.r;
    const tpl = ctx.S.template;
    const pid = r.productId;
    const head = (details) => [
      h('header', { class: 'bk-panel-h' },
        h('h3', { class: 'bk-toc-h' }, 'Сначала')),
      details ? h('p', { class: 'hint bk-toc-hint' }, details) : null,
    ];

    if (!ctx.can) {
      host.hidden = true;
      host.replaceChildren();
      return;
    }
    host.hidden = false;
    const q = r.readiness;
    if (!q) {
      host.replaceChildren(...head('Готовность этой редакции не указана.'));
      return;
    }
    const items = q.missing || [];
    const list = h('ul', { class: 'bk-focus-list', 'aria-label': 'Что заполнить или проверить' });
    for (const it of items) {
      const label = focusLabel(it);
      const key = String(it.key || '');
      const descriptionChoice = tpl?.variant === 'short' && key.startsWith('choice:')
        && tpl.simpleDescriptionSuggestions?.some(({ rootId }) => key === `choice:${rootId}`);
      const goNow = () => {
        if (!ctx.sideSlot && !String(key).startsWith('img_')) {
          toast('Правая колонка книжки недоступна — откройте паспорт заново.', { ms: 5000 });
          return;
        }
        if (key.startsWith('choice:')) { ctx.openChoices?.(key.slice(7)); return; }
        const options = { onDone: afterSide };
        if (key === 'materials' || key === 'parts' || it.target === 'techsheet') {
          openMaterialsInBook(ctx.sideSlot, pid, { ...options, focusParts: key === 'parts' });
          return;
        }
        if (key === 'dimensions' || key === 'weightKg' || key === 'length' || key === 'width' || key === 'height' || key === 'weight') {
          openDimsInBook(ctx.sideSlot, pid, options);
          return;
        }
        if (key === 'composition') {
          openCompositionInBook(ctx.sideSlot, pid, options);
          return;
        }
        const page = pageForKey(ctx.pagesEl, key);
        const slot = page && ([...page.querySelectorAll('[data-focus]')].find((el) => el.dataset.focus === key) || page);
        if (slot) { flash(slot); return; }
        // нет якоря на листе — без тоста: рамка некуда; пользователь видит клик в списке
      };
      const row = h('div', { class: 'bk-focus-i is-req' },
        button({
          label,
          title: it.hint || 'Правка в книжке',
          kind: 'ghost',
          size: 'S',
          cls: 'bk-focus-btn',
          onClick: (e) => {
            if (descriptionChoice) { ctx.openSetting('simpleDescription', e.currentTarget); return; }
            if (r.productId && (key === 'category' || key === 'simpleDescription' || isBookSetting(key))) {
              ctx.openSetting(key, e.currentTarget);
              return;
            }
            ctx.openSide(goNow);
          },
        }),
        h('span', { class: 'bk-focus-tag' }, 'обязательно'));
      list.append(h('li', null, row, it.hint ? hint(it.hint) : null));
    }
    host.replaceChildren(
      ...head(items.length
        ? 'Что мешает выпуску'
        : q.ready ? (tpl ? 'Шаблон готов к выпуску.' : 'Обязательные сведения заполнены.') : 'Уточните данные перед выпуском.'),
      items.length ? list : null,
      q.recommendations?.length ? h('section', null,
        h('h3', { class: 'bk-toc-h' }, 'Рекомендации'),
        h('ul', { class: 'bk-focus-list' }, ...q.recommendations.map((it) =>
          h('li', null, it.label, it.hint ? hint(it.hint) : null)))) : null,
    );
  };

  paint();
  return {
    refresh: () => { clearTimeout(timer); timer = setTimeout(paint, 200); },
  };
}
