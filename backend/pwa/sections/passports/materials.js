import { api } from '../../core/api.js';
import { h } from '../../core/dom.js';
import { toast } from '../../ui/toast.js';
import { confirmDlg } from '../../ui/dialog.js';
import { materialsSpec, specSummary } from '../../ui/materials-spec.js';

/*
 * МИ.4: материалы в форме паспорта (невыпущенного) — таблица вместо меток «Материалы» и свободного текста.
 * Метки materialIds — из таблицы (материалы строк + покрытия); текст «Материалы» — собранный (серым «собрано автоматически»),
 * ручная правка таблицей не перетирается, «↻ Собрать заново»; «Подставить из изделия» — таблица изделия (поток ПИ).
 * Паспорт хранит свою таблицу (`materialsSpec` — снимок изделия с правкой) и при открытии черновика показывает её;
 * своей нет — таблица пуста, «Подставить из изделия». Уходит на сервер, только если таблицу меняли (как у изделия).
 */
/**
 * materialsSpec паспорта: у нового — если таблица заполнена (пустую не шлём: копия прошлого паспорта сохранит его таблицу,
 * как его текст и метки), у сохранённого — только если таблицу меняли (null — снять).
 */
export function specBody(v, r) {
  if (v._mspec === undefined) return {}; // старый вид формы (метки без таблицы)
  const next = v._mspec ?? null;
  if (!r) return next ? { materialsSpec: next } : {};
  return JSON.stringify(next) !== JSON.stringify(r.materialsSpec ?? null) ? { materialsSpec: next } : {};
}

export function materialsFields({ r, md, ctx }) {
  return [
    { key: 'materialIds', type: 'widget', label: '', widget: (v) => hiddenList(v), summary: () => '' },
    { key: '_mspec', label: 'Материалы изделия', type: 'widget', wide: true, summary: specSummary,
      widget: (v) => (ctx.ms = materialsSpec({ value: v, dicts: md, preview: false, scope: () => ctx.cat(), actions: [{ label: 'Подставить из изделия', busy: 'Загружаю…', title: 'Таблица материалов из карточки изделия', run: (w) => fromProduct(w, ctx) }] })),
      hint: 'Материал — из справочника; размеры и части — выбрать или вписать (Enter). Метки материалов паспорта заполняются из таблицы',
      mount: (api) => wireMaterials(api, { r, md, ctx }) },
  ];
}

/** Невидимое поле со списком id (метки материалов): значение — JSON-список, как у tagPick. */
function hiddenList(v) {
  const parse = (x) => { if (Array.isArray(x)) return x.map(String); try { return (JSON.parse(x || '[]') || []).map(String); } catch { return []; } };
  let cur = parse(v);
  const el = h('span', { hidden: true });
  return { el, get value() { return JSON.stringify(cur); }, set value(x) { cur = parse(x); }, focus: () => {} };
}

async function fromProduct(w, ctx) {
  const pid = ctx.api?.get('productId');
  if (!pid) { toast('Сначала выберите изделие в блоке «Изделие»'); return; }
  const p = await api(`/showcase/${pid}`);
  if (!p.materialsSpec?.rows?.length && !p.materialsSpec?.coatingIds?.length) { toast('У изделия таблица материалов не заполнена — заполните её в «Продукции» (блок «Для паспорта»)', { ms: 7000 }); return; }
  if (!w.isEmpty() && !(await confirmDlg('Заменить таблицу материалов?', 'Строки заменятся таблицей из карточки изделия.', { okText: 'Заменить' }))) return;
  w.set(p.materialsSpec);
}

function wireMaterials(api, { r, md, ctx }) {
  const ms = ctx.ms; ctx.api = api;
  ctx.cat = () => api.get('passportCategory');
  const ta = api.input('materials');
  if (!ms || !ta) return;
  let auto = '';
  // текст «наш» (его можно заменять собранным): пусто, подставлен программой или совпал с собранным; правка человека — не наш
  let ours = !String(ta.value || '').trim();
  const again = h('button', { type: 'button', class: 'link-btn', onclick: () => { if (!auto) return; ours = true; api.set('materials', auto); paint(); } }, '↻ Собрать заново из таблицы');
  const note = h('div', { class: 'ms-auto', hidden: true });
  (api.field('materials') || ta.parentElement)?.append(note);
  const hid = api.field('materialIds'); if (hid) hid.hidden = true; // служебное поле: метки — из таблицы
  const paint = () => {
    const v = String(ta.value || '').trim();
    if (auto && v === auto) ours = true;
    note.hidden = !auto;
    note.replaceChildren(...(ours ? ['собрано автоматически из таблицы'] : ['изменено вручную — таблица текст не меняет · ', again]));
    ta.classList.toggle('is-default', !!auto && ours && v === auto);
  };
  ta.addEventListener('input', (e) => { if (e.isTrusted) ours = false; paint(); });
  ms.onText = (t) => {
    auto = t;
    if (t && ours && String(ta.value || '').trim() !== t) api.set('materials', t);
    paint();
  };
  // метки материалов — из таблицы; пока таблицу не трогали и она пуста — прежние метки паспорта остаются
  let touched = false;
  const legacy = (r?.materialIds || []).map(String);
  const names = new Map((md.mats || []).map((m) => [String(m.id), m.name]));
  const old = h('p', { class: 'hint' });
  ms.el.append(old);
  const sync = () => {
    const sp = ms.spec();
    const ids = sp ? [...new Set([...sp.rows.map((x) => x.materialId).filter(Boolean), ...sp.coatingIds])] : [];
    if (sp) touched = true;
    if (touched) api.set('materialIds', JSON.stringify(ids));
    old.hidden = touched || !legacy.length;
    old.textContent = `Метки материалов паспорта: ${legacy.map((id) => names.get(id) || 'удалённая запись').join(', ')} — заполните таблицу, метки заменятся`;
  };
  ms.el.addEventListener('input', sync);
  sync();
}
