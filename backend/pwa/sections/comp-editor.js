import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { parseNum, qty } from '../core/format.js';
import { button, confirmDlg, empty, errText, funnel, hint, section, stack, table, textInput, toast, toastError } from '../ui/kit/index.js';

/*
 * Состав модуля и заготовка детали (C142 волна C).
 * Воронка: что → какую → сколько → «В состав». Дерево на карточке — по кнопке, не при открытии списка.
 * Сырьё в деталь можно. Изделие в модуль нельзя — такого шага нет.
 */

const WORD = { module: 'Модуль', part: 'Деталь', purchased: 'Покупное', fastener: 'Метиз', raw: 'Сырьё', material: 'Материал' };

const asList = (resp) => (Array.isArray(resp) ? resp : (resp?.items || resp?.composition || []));
const refOf = (line) => {
  const r = line.refId;
  if (r && typeof r === 'object') return String(r.id || r._id || '');
  return String(r || '');
};
const lineKey = (line) => String(line.id || line._id || '');

export const compositionCatalog = () => bag();
export const describeCompositionLine = (line, catalog) => describe(line, catalog);

let bagP = null;
function bag() {
  if (!bagP) {
    bagP = loadBag().catch((e) => { bagP = null; throw e; });
  }
  return bagP;
}

const opt = (row) => ({ id: String(row.id || row._id), label: [row.name || 'Без имени', row.article].filter(Boolean).join(' · ') });

async function loadBag() {
  const take = (p) => p.then(asList).catch(() => []);
  const [mods, parts, purchased, fasteners, raw] = await Promise.all([
    take(api('/modules')),
    take(api('/materials', { query: { materialKind: 'part', limit: 500 } })),
    take(api('/materials', { query: { materialKind: 'purchased', limit: 500 } })),
    take(api('/materials', { query: { materialKind: 'fastener', limit: 500 } })),
    take(api('/materials', { query: { materialKind: 'raw', limit: 500 } })),
  ]);
  const modMap = new Map(mods.map((m) => [String(m.id || m._id), m]));
  const matMap = new Map([...parts, ...purchased, ...fasteners, ...raw].map((m) => [String(m.id || m._id), m]));
  return {
    lists: { module: mods.map(opt), part: parts.map(opt), purchased: [...purchased, ...fasteners].map(opt), raw: raw.map(opt) },
    modMap, matMap,
  };
}

function describe(line, b) {
  const id = refOf(line);
  if (line.lineType === 'module') {
    const m = b.modMap.get(id);
    return { word: 'Модуль', name: m?.name || 'Нет в справочнике', sub: m?.article || '' };
  }
  const m = b.matMap.get(id);
  return { word: WORD[m?.materialKind] || 'Материал', name: m?.name || 'Нет в справочнике', sub: m?.article || '' };
}

/** Дерево состава в карточке. Грузится по кнопке. */
export function compositionPeek({ id, base, title, hintText, label, emptyHint }) {
  const host = h('div');
  host.append(hint(hintText));
  const show = button({ label, size: 'S', onClick: () => fillComposition(host, { base, id, emptyHint }) });
  return section({ title, tone: 'main', open: true, side: show, body: host });
}

export async function fillComposition(host, { base, id, emptyHint }) {
  host.replaceChildren(hint('Загружаю состав…'));
  try {
    const b = await bag();
    const lines = asList(await api(`${base}/${id}/composition`));
    host.replaceChildren(drawLines(lines, b, { base, emptyHint }));
  } catch (e) {
    host.replaceChildren(hint(errText(e)));
  }
}

function drawLines(lines, b, { base, emptyHint }) {
  const kids = h('div');
  if (!lines.length) return empty({ title: 'Состав пуст', hint: emptyHint || 'Добавьте строки кнопкой «Изменить состав».' });
  const rows = lines.map((line) => {
    const d = describe(line, b);
    const open = line.lineType === 'module' && base === '/modules'
      ? button({ label: 'Внутри', size: 'S', title: 'Детали этого модуля', onClick: async () => {
        kids.replaceChildren(hint('Загружаю…'));
        try {
          const nested = asList(await api(`/modules/${refOf(line)}/composition`));
          const body = nested.length
            ? table({
              label: 'Внутри модуля',
              columns: [{ label: 'Что' }, { label: 'Название' }, { label: 'Сколько', num: true }],
              rows: nested.map((n) => {
                const x = describe(n, b);
                return { cells: [x.word, [x.name, x.sub].filter(Boolean).join(' · '), qty(n.quantity)] };
              }),
            })
            : hint('В этом модуле строк пока нет.');
          kids.replaceChildren(section({ title: `Внутри: ${d.name}`, tone: 'info', open: true, fixed: true, body }));
        } catch (e) { kids.replaceChildren(hint(errText(e))); }
      } })
      : '';
    return { cells: [d.word, [d.name, d.sub].filter(Boolean).join(' · '), qty(line.quantity), open] };
  });
  return stack(
    table({ label: 'Состав', columns: [{ label: 'Что' }, { label: 'Название' }, { label: 'Сколько', num: true }, { label: '' }], rows }),
    kids,
  );
}

/**
 * Правая панель правки состава. Строки пишутся сразу. «Готово» только закрывает панель.
 * @returns форма для section.form.build
 */
export async function buildCompForm({ ownerId, base, kindIds, intro }) {
  const b = await bag();
  const linesHost = h('div');
  const qtyHost = h('div');
  let kind = kindIds.length === 1 ? kindIds[0].id : '';
  let pick = '';
  let posting = false;

  const choices = (id) => (b.lists[id] || []).filter((v) => v.id !== String(ownerId));
  const steps = () => ([
    { key: 'what', label: 'Что добавить', ask: 'Дальше: выберите тип', value: kind, values: kindIds.map((k) => ({ id: k.id, label: k.label })) },
    { key: 'which', label: 'Какую', ask: 'Дальше: найдите запись', value: pick, values: kind ? choices(kind).map((v) => ({ id: v.id, label: v.label })) : [] },
  ]);

  const reload = async () => {
    const lines = asList(await api(`${base}/${ownerId}/composition`));
    if (!lines.length) {
      linesHost.replaceChildren(empty({ title: 'Состав пуст', hint: 'Добавьте первую строку ниже.' }));
      return;
    }
    const draft = lines.map((line) => ({ line, input: textInput({ label: 'Сколько', value: String(line.quantity ?? 1), inputmode: 'decimal', short: true }) }));
    const saveQty = button({
      label: 'Записать количества', size: 'S', onClick: async () => {
        const jobs = draft.filter((d) => {
          const n = parseNum(d.input.input.value);
          return lineKey(d.line) && n > 0 && n !== Number(d.line.quantity);
        });
        if (!jobs.length) { toast('Количества не менялись'); return; }
        saveQty.disabled = true;
        try {
          for (const d of jobs) {
            await api(`${base}/${ownerId}/composition/${lineKey(d.line)}`, { method: 'PATCH', body: { quantity: parseNum(d.input.input.value) } });
          }
          toast('Количество записано');
          await reload();
        } catch (e) { toastError(e); }
        finally { saveQty.disabled = false; }
      },
    });
    linesHost.replaceChildren(stack(
      table({
        label: 'Состав',
        columns: [{ label: 'Что' }, { label: 'Название' }, { label: 'Сколько', num: true }, { label: '' }],
        rows: draft.map((d) => {
          const info = describe(d.line, b);
          const drop = button({
            label: 'Убрать', size: 'S', kind: 'ghost', title: `Убрать: ${info.name}`, onClick: async () => {
              if (!(await confirmDlg('Убрать из состава?', info.name, { okText: 'Убрать' }))) return;
              const key = lineKey(d.line);
              if (!key) { toast('Эту строку нельзя убрать. Обновите карточку.'); return; }
              try {
                await api(`${base}/${ownerId}/composition/${key}`, { method: 'DELETE' });
                toast('Убрано');
                await reload();
              } catch (e) { toastError(e); }
            },
          });
          return { cells: [info.word, [info.name, info.sub].filter(Boolean).join(' · '), d.input.el, drop] };
        }),
      }),
      saveQty,
    ));
  };

  const f = funnel({
    steps: steps(),
    onChange: (key, value) => {
      if (key === 'what') { kind = value; pick = ''; }
      if (key === 'which') pick = value;
      f.update({ steps: steps() });
      paintQty();
    },
  });

  function paintQty() {
    if (!pick) { qtyHost.replaceChildren(); return; }
    const q = textInput({ label: 'Сколько на 1 шт', value: '1', inputmode: 'decimal' });
    const add = button({
      label: 'В состав', kind: 'primary', size: 'S', onClick: async () => {
        const quantity = parseNum(q.input.value);
        if (!(quantity > 0)) { toast('Укажите количество больше нуля'); return; }
        const spec = kindIds.find((k) => k.id === kind);
        if (!spec) return;
        posting = true; add.disabled = true;
        try {
          await api(`${base}/${ownerId}/composition`, { method: 'POST', body: { lineType: spec.lineType, refId: pick, quantity, unit: 'шт' } });
          toast('Добавлено в состав');
          pick = '';
          f.update({ steps: steps() });
          paintQty();
          await reload();
        } catch (e) { toastError(e); }
        finally { posting = false; add.disabled = false; }
      },
    });
    qtyHost.replaceChildren(stack(q.el, add));
  }

  await reload();
  const el = stack(hint(intro), linesHost, section({ title: 'Добавить', tone: 'main', open: true, fixed: true, body: stack(f.el, qtyHost) }));
  return {
    el,
    focus() {},
    dirty: () => false,
    busy: () => posting,
    read: () => ({ values: { done: true } }),
  };
}
