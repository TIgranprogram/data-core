import { api } from '../../core/api.js';
import { h } from '../../core/dom.js';
import { actions, button, confirmDlg, hint, mobile, modal, stack } from '../../ui/kit/index.js';
import { toast } from '../../ui/kit/toast.js';
import { patchProduct } from './data.js';

/* Подсказки техописания из похожих изделий (C114, D-REPORT шаг 5). Похожие и частые фразы считает сервер:
 * GET /showcase/:id/techsheet-analogs → { analogs[{id,sku,name,rows,materialsSpec}], purpose[{value,n}], installation[...] }. */
const cache = new Map(); // id изделия → Promise ответа (на время открытой панели)
export const loadAnalogs = (id) => {
  if (!cache.has(id)) cache.set(id, api(`/showcase/${id}/techsheet-analogs`).catch(() => ({ analogs: [], purpose: [], installation: [] })));
  return cache.get(id);
};
// длинная фраза на кнопке не переносится и даёт прокрутку панели — обрезаем, полный текст в подсказке
const short = (s) => (s.length > 60 ? s.slice(0, 57).trimEnd() + '…' : s);
const rowsWord = (n) => (n % 10 === 1 && n % 100 !== 11 ? 'строка' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'строки' : 'строк');

/** Действие таблицы материалов «Взять из похожего»: выбор изделия той же группы → его таблица в редактор (в изделие — по «Сохранить»). */
export const fromAnalog = (r) => ({ label: 'Из изделий этой группы', busy: 'Ищу…', title: 'Таблица материалов изделия той же группы — потом поправить под это изделие',
  run: async (w) => {
    const { analogs = [] } = await loadAnalogs(r.id);
    if (!analogs.length) { toast('В группе нет изделий с заполненной таблицей материалов — заполните вручную или «Взять из состава»', { ms: 7000 }); return; }
    let pick = analogs[0].id;
    const list = mobile.choice({ selected: pick, items: analogs.map((a) => ({ value: a.id, label: [a.sku, a.name].filter(Boolean).join(' · '), hint: `${a.rows} ${rowsWord(a.rows)} в таблице` })),
      onPick: (it) => { pick = it.value; list.closest('form')?.requestSubmit(); } });
    const ok = await modal({ title: 'Взять таблицу материалов', okText: 'Взять выбранное', body: stack(hint('Изделия той же группы. Нажмите на нужное — таблица скопируется, проверьте размеры и сохраните.'), list) });
    if (!ok) return;
    const a = analogs.find((x) => x.id === pick);
    if (!a) return;
    if (!w.isEmpty() && !(await confirmDlg('Заменить таблицу материалов?', `Строки заменятся таблицей «${a.name}». В изделие запишется по «Сохранить».`, { okText: 'Заменить' }))) return;
    w.set(a.materialsSpec);
    toast(`Взято из «${a.name}»: ${a.rows} ${rowsWord(a.rows)} — проверьте и сохраните`);
  } });

/** Пустые «Назначение» и «Монтаж»: частые фразы группы кнопками — клик пишет в изделие сразу (как правка в карточке). */
export function phraseHints(r, onSaved) {
  const box = h('div');
  if (!r.id) return box;
  const need = [['purpose', 'Назначение'], ['installation', 'Монтаж']].filter(([k]) => !String(r[k] ?? '').trim());
  if (!need.length) return box;
  loadAnalogs(r.id).then((d) => {
    const lines = need.map(([k, label]) => {
      const opts = d[k] || [];
      if (!opts.length) return null;
      return stack(hint(`${label}: пусто. Часто в группе — нажмите, чтобы записать:`), actions(
        ...opts.map((o) => button({ label: short(o.value), kind: 'ghost', size: 'S', title: `Записать в изделие: ${o.value} (так у ${o.n} изд.)`,
          onClick: async () => { await patchProduct(r.id, { [k]: o.value }); r[k] = o.value; toast(`${label}: ${o.value} — записано в изделие`); onSaved?.(); } }))));
    }).filter(Boolean);
    if (lines.length) box.replaceChildren(...lines);
  });
  return box;
}
