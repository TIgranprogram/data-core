/**
 * C141: слева в книжке — «Сначала заполнить / проверить».
 * Данные: GET /showcase/:id/fill-queue. Клик не уводит из книжки: рисунок → лист; материалы/части/габариты → правая колонка.
 */
import { api } from '../../core/api.js';
import { h } from '../../core/dom.js';
import { toast } from '../../ui/kit/toast.js';
import { button } from '../../ui/kit/index.js';
import { openMaterialsInBook, openDimsInBook, openInstallationInBook, openCompositionInBook } from './book-side-edit.js';

const PAGE_HINTS = [
  [/обложк|наименован|паспорт\s*№/i, ['name', 'description', 'img_overview']],
  [/описан|назначен/i, ['description', 'purpose', 'blg.material', 'materials']],
  [/уход|обслужив|то\b|провер/i, ['maintenance']],
  [/монтаж|установ/i, ['install', 'installation', 'installationTypeId', 'img_mounting', 'img_foundation']],
  [/габарит|характерист|размер|вес/i, ['dimensions', 'weightKg', 'heightMin', 'heightMax', 'weightMax', 'maxUsers', 'seatsCount', 'siteLength', 'siteWidth', 'fallHeight', 'ageFrom', 'ageTo', 'img_dimensions']],
  [/комплект|состав/i, ['composition', 'elements', 'modules']],
  [/гарант/i, ['warrantyMonths', 'serviceLifeYears']],
];

function focusLabel(it) {
  const raw = String(it.label || it.key || '');
  const broken = raw.match(/не читается:\s*(.+?)(?:\.|$)/i)
    || raw.match(/^(.+?):\s*файл на сервере/i);
  if (broken) return broken[1].trim() + ' — файл битый, замените';
  if (String(it.key || '').startsWith('img_')) return raw.replace(/^Рисунок:\s*/i, '') || 'Рисунок';
  return raw;
}

function pageForKey(pagesEl, key) {
  const pages = [...(pagesEl?.children || [])];
  if (String(key || '').startsWith('img_')) {
    const hit = pages.find((p) => p.querySelector(`[data-focus="${key}"]`));
    if (hit) return hit;
  }
  for (const [re, keys] of PAGE_HINTS) {
    if (!keys.includes(key)) continue;
    const hit = pages.find((p) => re.test(p.textContent || ''));
    if (hit) return hit;
  }
  return pages.find((p) => p.querySelector(`[data-focus="${key}"]`)) || null;
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
    if (saved) { ctx.S.changed = true; paint(); ctx.onChanged?.(); }
  };

  const paint = async () => {
    const r = ctx.S.r;
    const pid = r.productId;
    const head = (done, total, hint) => [
      h('header', { class: 'bk-panel-h' },
        h('h3', { class: 'bk-toc-h' }, 'Сначала'),
        total != null ? h('span', { class: 'bk-focus-meter', title: 'Заполнено из очереди' }, `${done}/${total}`) : null),
      total > 0 ? h('div', { class: 'bk-focus-bar', 'aria-hidden': 'true', style: { '--bk-focus-pct': `${Math.round((100 * (done || 0)) / total)}%` } },
        h('i', null)) : null,
      hint ? h('p', { class: 'hint bk-toc-hint' }, hint) : null,
    ];

    if (!pid) {
      host.replaceChildren(...head(null, null, 'Паспорт без изделия — очередь заполнения недоступна.'));
      return;
    }
    host.replaceChildren(...head(null, null), h('p', { class: 'muted bk-toc-hint' }, 'Загружаю…'));
    let q;
    try {
      q = await api(`/showcase/${pid}/fill-queue`);
    } catch {
      host.replaceChildren(...head(null, null, 'Не удалось получить, что ещё заполнить.'));
      return;
    }
    const items = (q.items || []).slice(0, 8);
    const done = q.done ?? 0;
    const total = q.total ?? 0;
    if (!items.length) {
      host.replaceChildren(...head(done, total, total
        ? `Заполнено ${done} из ${total} — можно проверить тексты на листе и ИИ справа.`
        : 'Пробелов по очереди нет — просмотрите страницы слева направо.'));
      return;
    }
    const list = h('ul', { class: 'bk-focus-list', 'aria-label': 'Что заполнить или проверить' });
    for (const it of items) {
      const need = it.required ? 'обязательно' : (it.urgent ? 'срочно' : 'желательно');
      const tone = it.required ? ' is-req' : (it.urgent ? ' is-urgent' : '');
      const label = focusLabel(it);
      const key = String(it.key || '');
      const brokenImg = /не читается|файл на сервере/i.test(String(it.label || '')) || key.startsWith('img_');
      const go = () => {
        const ask = ctx.sideSlot?._bkLeave;
        if (typeof ask === 'function') {
          void ask().then((ok) => {
            if (!ok) return;
            ctx.sideSlot._bkLeave = null;
            ctx.sideSlot.closest?.('.bk-side')?.classList.remove('is-wide');
            goNow();
          });
          return;
        }
        goNow();
      };
      const goNow = () => {
        if (key === 'materials' || key === 'parts' || it.target === 'techsheet') {
          if (!ctx.sideSlot) { toast('Откройте техописание из карточки изделия.', { ms: 5000 }); return; }
          openMaterialsInBook(ctx.sideSlot, pid, { focusParts: key === 'parts', onDone: afterSide });
          return;
        }
        if (key === 'dimensions' || key === 'weightKg') {
          if (!ctx.sideSlot) { toast('Габариты правятся в карточке изделия.', { ms: 5000 }); return; }
          openDimsInBook(ctx.sideSlot, pid, { onDone: afterSide });
          return;
        }
        if (key === 'composition') {
          if (!ctx.sideSlot) return;
          openCompositionInBook(ctx.sideSlot, pid, { onDone: afterSide });
          return;
        }
        if (key === 'installation') {
          if (!ctx.sideSlot) return;
          openInstallationInBook(ctx.sideSlot, pid, { onDone: afterSide });
          return;
        }
        const page = pageForKey(ctx.pagesEl, key);
        const slot = page?.querySelector(`[data-focus="${key}"]`) || page;
        if (slot) { flash(slot); return; }
        // нет якоря на листе — без тоста: рамка некуда; пользователь видит клик в списке
      };
      const li = h('li', { class: 'bk-focus-i' + tone },
        button({
          label,
          title: 'Правка в книжке, без перехода в другие экраны',
          kind: 'ghost',
          size: 'S',
          cls: 'bk-focus-btn',
          onClick: go,
        }),
        h('span', { class: 'bk-focus-tag' }, need));
      list.append(li);
    }
    host.replaceChildren(
      ...head(done, total, 'Сверху — что мешает выпуску. Клик — правка в книжке.'),
      list,
    );
  };

  paint();
  return {
    refresh: () => { clearTimeout(timer); timer = setTimeout(paint, 200); },
  };
}
