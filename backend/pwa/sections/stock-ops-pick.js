// Шаги выбора позиции для панели операций склада (C032, паттерн П-1 «Воронка с памятью», docs/PATTERNS.md):
// kit.funnel: «Недавно» → «Категория» (вкладки с числом позиций; категория одна — шага нет) → «Позиция» (строки с фото и остатком).
// Поиск внизу ищет по всему складу — шаги его не сужают. Запросы прежние: /stock/categories при открытии, склад — по первому действию.
import { api } from '../core/api.js';
import { zoneQuery } from '../core/zone.js';
import { h } from '../core/dom.js';
import { qty } from '../core/format.js';
import { byType, index as indexFacets, typeValues } from '../core/facets.js';
import { stockList } from '../core/stock-list.js';
import { attachCombo, badge, empty, funnel, hint, posPic, row, stack, STOCK_STATUS } from '../ui/kit/index.js';
import { toast, toastError } from '../ui/kit/toast.js';
import { lookups } from './lookups.js';

const RKEY = (op) => 'dc-ops-recent-' + op;
const readRecent = (op) => { try { return JSON.parse(localStorage.getItem(RKEY(op)) || '[]') || []; } catch { return []; } };

/** П-1 п. 5: что этот пользователь брал в этой операции — «Недавно» (последние 6, в этом браузере). */
export function rememberPick(op, it) {
  if (!it?.id) return;
  try { localStorage.setItem(RKEY(op), JSON.stringify([{ id: it.id, name: it.name, unit: it.unit, quantity: it.quantity }, ...readRecent(op).filter((x) => x.id !== it.id)].slice(0, 6))); } catch { /* приватный режим */ }
}

/** Шаги выбора: «Недавно → Категория → Позиция». Поле поиска (input) создаёт панель и передаёт сюда. add(it) — в пачку; onCat() — категория выбрана. */
export function stockPick({ op, input: pickIn, add, onCat }) {
  let all = null; let loading = false; let cats = []; let cat = ''; let type = ''; // type: '' не выбран, '*' — «Все типы'
  const fun = funnel({ steps: [], onChange: (k, v) => { if (k === 'category') { cat = v || ''; type = ''; } else type = v || ''; onCat?.(); paintCats(); if (!all) { listBox.replaceChildren(hint('Загружаю склад…')); ensureAll(); } else paintList(); } });
  const listBox = h('div');
  const combo = attachCombo(pickIn, {
    options: () => (all || []).map((i) => ({ value: i.id, label: i.name, sub: `${qty(i.quantity)} ${i.unit || ''}`.trim() })),
    empty: () => (loading ? 'Загружаю склад…' : ''),
    onPick: (o) => { pickIn.value = ''; const it = (all || []).find((x) => x.id === o.value); if (it) add(it); },
    extra: (text) => (op === 'in' && all && text.length > 2 && !all.some((x) => x.name.toLowerCase() === text.toLowerCase()) ? [{ label: `Создать «${text}»`, run: () => createNew(text) }] : []),
  });
  pickIn.addEventListener('focus', async () => { await ensureAll(); if (document.activeElement === pickIn) combo.refresh(); });

  async function ensureAll() {
    if (all || loading) return all;
    loading = true;
    try { all = await stockList(); } catch (e) { toastError(e); } finally { loading = false; }
    paintRecent(); paintCats(); paintList();
    return all;
  }
  async function createNew(name) {
    try {
      const r = await api('/stock/items', { method: 'POST', body: { name, unit: 'шт' } });
      lookups.reset?.();
      pickIn.value = '';
      add(r);
      toast(`Позиция «${r.name}» создана — укажите количество`);
    } catch (e) { toastError(e); }
  }

  // «Недавно» (П-1 п. 5–6): последние позиции этой операции — добавление в один клик
  function paintRecent() {
    const rec = readRecent(op);
    fun.setRecent(rec.map((x) => ({ title: x.name, meta: `на складе ${qty(x.quantity)} ${x.unit || ''}`.trim(),
      onClick: async () => { await ensureAll(); const it = (all || []).find((i) => i.id === x.id); if (it) add(it); else toast('Этой позиции уже нет на складе'); } })));
  }

  const inCat = () => { if (!all) return []; if (!all[0]?._f) indexFacets(all); return all.filter((i) => !cat || i.categoryId === cat); };

  // Шаг «Категория» (П-1 п. 1–3): вкладки с числом позиций; одна категория — шаг не показывается
  function paintCats() {
    const nOf = (id) => (all ? all.filter((i) => !id || i.categoryId === id).length : cats.find((c) => c.id === id)?.total);
    const tv = typeValues(inCat()); // шаг «Тип»: только типы выбранной категории; меньше двух — шаг пропущен
    fun.update({ steps: [
      { key: 'category', label: 'Категория', ask: 'выберите категорию', skip: cats.length < 2, value: cat, values: cats.map((c) => ({ id: c.id, label: c.name, count: nOf(c.id) })) },
      { key: 'type', label: 'Тип', ask: 'выберите тип', skip: tv.length < 3, value: type, values: tv },
    ] });
    onCat?.(); // категории пришли — «Дальше: …» узнает, что шаг «Категория» появился
  }

  // Шаг «Позиция» (П-1 п. 2, 7): строки выбранной категории — фото, остаток, «нет» / «к закупке»; до 30 строк
  function paintList() {
    if (!cat && cats.length > 1) { listBox.replaceChildren(); return; } // сначала категория
    if (typeValues(inCat()).length > 2 && !type) { listBox.replaceChildren(hint('Выберите тип — или «Все типы». Найти позицию можно и поиском ниже.')); return; }
    const items = byType(inCat(), type);
    if (!items.length) { listBox.replaceChildren(empty({ title: 'В категории позиций нет', hint: 'Найдите поиском ниже — он ищет по всему складу.' })); return; }
    listBox.replaceChildren(
      ...items.slice(0, 30).map((it) => row({ lead: posPic((it.photos || [])[0], 'sm'), title: it.name,
        meta: `на складе ${qty(it.quantity)} ${it.unit || ''}`.trim(),
        side: it.status && it.status !== 'ok' ? [badge(STOCK_STATUS, it.status)] : null,
        onClick: () => add(it) })),
      items.length > 30 ? hint(`Показаны первые 30 из ${items.length} — найдите поиском ниже`) : null);
  }

  // категории — при открытии панели (как было); одна — сразу список позиций (П-1 п. 3)
  api('/stock/categories', { query: zoneQuery() }).then((r) => {
    cats = (r.items || []).filter((c) => c.id !== 'none');
    paintCats();
    if (cats.length < 2) { listBox.replaceChildren(hint('Загружаю склад…')); ensureAll(); }
  }).catch(() => { fun.update({ steps: [] }); });
  paintRecent();

  const el = stack(fun.el, listBox);
  return { el, focus: () => pickIn.focus(), refreshRecent: paintRecent, setNext: (t) => fun.setNext(t), hasCats: () => cats.length > 1, catChosen: () => !!cat };
}
