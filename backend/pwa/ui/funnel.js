import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { failBlock } from './kit/busy.js';
import { toast } from './kit/toast.js';
import { link } from './kit/index.js';

/**
 * Воронка текстов паспорта (DESIGN §4 «Шаг-воронка»): по типу паспорта — шаги «раздел → 2–3 варианта → (подвариант) → текст».
 * Данные: GET /passports/funnel?category=… → { sections: [{ id, name, section, required, children: [узел { id, name, text?, isDefault?, children? }] }] }.
 * Выбор — textChoices: { [id раздела]: id листа }. Единственный вариант и «по умолчанию» подставляются сами (в значение не пишутся,
 * сервер делает то же); шаг с выбором сворачивается в строку «Монтаж: … · Изменить», под ней текст в 2 строки.
 *   funnelBox({ value, category, canEditText, onPaint(sections), only, productId, facetFirst, load }) → { el, value (JSON), setCategory(code), refresh(), stepEl(rootId), roots(),
 *     install(), installLeaf(), installTypeId(), choose(rootId, leafId) }
 * productId — изделие: сервер не пришлёт тексты, привязанные к чужим признакам и группам («грузовой блок» у тренажёра без грузов).
 * only — один корень (id, section или название) или список: в el только они. onPaint — после каждой отрисовки (можно разнести корни по разделам).
 * facetFirst — плитки с byFacet (подходит признаку изделия) идут первыми. load(category, productId, force) — свой источник дерева { sections }, иначе GET /passports/funnel.
 * Без facetFirst и load вызов как раньше (окно «Новый паспорт» в passports/form.js). Событие change всплывает от el при каждом выборе.
 */
const cache = new Map();
export function loadFunnel(category, force, productId = '') {
  const key = category + '|' + productId;
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < 60000) return hit.p;
  const p = api('/passports/funnel', { query: { category, ...(productId ? { productId } : {}) } }).catch((e) => { cache.delete(key); throw e; });
  cache.set(key, { at: Date.now(), p });
  return p;
}
export const resetFunnel = () => cache.clear();

const isLeaf = (n) => !(n.children && n.children.length);
const plain = (t) => String(t || '').replace(/\{[^}]+\}/g, '…').replace(/\s+/g, ' ').trim();
/** Путь от раздела до листа id; null, если такого нет. */
function pathTo(nodes, id, acc = []) {
  for (const n of nodes || []) {
    if (String(n.id) === String(id)) return [...acc, n];
    const sub = pathTo(n.children, id, [...acc, n]);
    if (sub) return sub;
  }
  return null;
}
/** Что подставится само: единственный вариант на уровне, иначе вариант «по умолчанию». */
function autoFrom(level, path) {
  let nodes = level; const out = [...path];
  while (nodes && nodes.length) {
    const pick = nodes.length === 1 ? nodes[0] : nodes.find((n) => n.isDefault);
    if (!pick) break;
    out.push(pick); nodes = pick.children;
  }
  return out;
}
/** Общее начало текстов соседних вариантов (по словам): в подсказке плитки его не показываем — иначе у всех одно и то же. */
function commonLead(nodes) {
  const texts = nodes.filter(isLeaf).map((n) => plain(n.text)).filter(Boolean);
  if (texts.length < 2) return '';
  const words = texts.map((t) => t.split(' '));
  let i = 0;
  while (words.every((w) => i < w.length - 1 && w[i] === words[0][i])) i++;
  return i >= 3 ? words[0].slice(0, i).join(' ') : '';
}
const hint = (n, lead = '') => {
  if (!isLeaf(n)) return n.children.map((c) => c.name).slice(0, 3).join(' · ');
  const t = plain(n.text);
  return (lead && t.startsWith(lead) ? '…' + t.slice(lead.length) : t).slice(0, 70);
};

const facetRank = (n) => (n?.byFacet || (n?.children || []).some((c) => facetRank(c) === 0) ? 0 : 1);

export function funnelBox({ value, category = '', canEditText = false, onPaint, only, productId = '', facetFirst = false, load = null } = {}) {
  const parse = (v) => { if (v && typeof v === 'object') return { ...v }; try { const o = JSON.parse(v || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch { return {}; } };
  let choices = parse(value);
  let cat = category; let data = null; let failed = null; let seq = 0;
  const partial = {}; // rootId → выбранные узлы пути, пока лист не выбран
  const editing = new Set();
  const el = h('div', { class: 'pp-funnel' });
  const fire = () => el.dispatchEvent(new Event('change', { bubbles: true }));

  const effective = (s) => {
    const own = choices[s.id] ? pathTo(s.children, choices[s.id]) : null;
    if (own) return { path: own, auto: false, gone: false };
    const base = partial[s.id] || [];
    const lvl = base.length ? base[base.length - 1].children : s.children;
    const path = autoFrom(lvl, base);
    return { path, auto: path.length > base.length, gone: !!choices[s.id] };
  };

  function pick(s, depth, node) {
    const base = effective(s).path.slice(0, depth);
    const path = [...base, node];
    delete choices[s.id];
    partial[s.id] = path;
    const full = autoFrom(node.children, path);
    if (isLeaf(full[full.length - 1])) { choices[s.id] = full[full.length - 1].id; delete partial[s.id]; editing.delete(s.id); }
    paint(); fire();
  }
  const optRow = (s, depth, nodes, chosen) => {
    const list = facetFirst ? [...(nodes || [])].sort((a, b) => facetRank(a) - facetRank(b)) : (nodes || []);
    const lead = commonLead(list);
    // C114 I-2: одинаковое (обрезанное) описание у нескольких вариантов не показываем — различает название
    const hints = list.map((n) => hint(n, lead));
    const shown = (n) => { const t = hint(n, lead); return t && hints.filter((x) => x === t).length === 1 ? t : ''; };
    return h('div', { class: 'pf-opts pp-opts', role: 'radiogroup', 'aria-label': depth ? 'Уточнение' : s.name },
      ...list.map((n) => h('button', { type: 'button', role: 'radio', class: 'pf-opt', 'aria-checked': String(chosen?.id === n.id), onclick: () => pick(s, depth, n) },
        h('b', null, n.name), shown(n) ? h('small', null, shown(n)) : null)));
  };

  function textBlock(s, leaf) {
    const full = plain(leaf.text);
    if (!full) return h('p', { class: 'hint' }, 'У этого варианта текст пока пустой — впишите его в «Справочники → Тексты паспорта».');
    const p = h('p', { class: 'pp-ftext clamp', id: `ft-${s.id}` }, full);
    const more = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'aria-expanded': 'false', 'aria-controls': p.id, onclick: () => {
      const on = p.classList.toggle('clamp'); more.setAttribute('aria-expanded', String(!on)); more.textContent = on ? 'Развернуть' : 'Свернуть';
    } }, 'Развернуть');
    return h('div', { class: 'pp-ftext-box' }, p, h('div', { class: 'pp-ftext-act' }, full.length > 110 ? more : null,
      // действия с текстом — одним видом: маленькие кнопки в ряд («Развернуть», «Править текст ↗»)
      canEditText ? h('a', { class: 'btn btn-ghost btn-sm', href: `#dicts?d=passportPhrases&of=ptnode&open=${leaf.id}`, target: '_blank', rel: 'noopener', title: 'Откроется в новой вкладке — паспорт здесь останется как есть' }, 'Править текст ↗') : null));
  }

  function step(s) {
    const { path, auto, gone } = effective(s);
    const complete = path.length > 0 && isLeaf(path[path.length - 1]);
    const wrap = h('section', { class: 'pp-step', 'data-root': String(s.id) });
    if (complete && !editing.has(s.id)) {
      const leaf = path[path.length - 1];
      const many = s.children.length > 1 || path.length > 1;
      // один вид правки значения во всей форме паспорта: «Подпись: значение ✎» (как заполненные поля, fill/paint.js filledLink)
      const val = `${s.name}: ${path.map((n) => n.name).join(' › ')}`;
      wrap.append(h('div', { class: 'pp-step-sum k-fill-done' }, // выбранный шаг — как заполненное поле анкеты (зелёный фон)
        many ? link({ label: `${val} ✎`, title: 'Изменить', onClick: () => { editing.add(s.id); paint(); } }) : h('span', null, val),
        auto ? h('span', { class: 'muted' }, 'подставлено') : null), textBlock(s, leaf));
      return wrap;
    }
    const head = h('h3', { class: 'pp-step-h' }, s.name, s.required ? h('span', { class: 'req' }, ' *') : null,
      complete ? null : h('span', { class: 'badge warn' }, 'не выбрано'));
    wrap.append(head, gone ? h('p', { class: 'hint' }, 'Прежний вариант убран из справочника — выберите заново.') : null);
    // уровни: выбранные родители + варианты следующего уровня
    let nodes = s.children; let depth = 0;
    const chain = partial[s.id] || (complete ? path : []);
    while (nodes && nodes.length) {
      const chosen = chain[depth];
      wrap.append(optRow(s, depth, nodes, chosen));
      if (!chosen || isLeaf(chosen)) break;
      nodes = chosen.children; depth++;
    }
    if (complete) wrap.append(textBlock(s, path[path.length - 1]));
    return wrap;
  }

  const wanted = (s) => {
    if (only == null) return true;
    const set = new Set([].concat(only).map((x) => String(x)));
    return set.has(String(s.id)) || set.has(String(s.section || '')) || set.has(String(s.name || ''));
  };
  function paint() {
    if (!cat) { el.replaceChildren(h('p', { class: 'muted' }, 'Тип паспорта не задан — здесь появятся шаги: монтаж, назначение и другие тексты.')); onPaint?.([]); return; }
    if (failed) { el.replaceChildren(failBlock(failed, () => refresh(true), { text: 'Не загрузились варианты текстов' })); onPaint?.([]); return; }
    if (!data) { el.replaceChildren(h('div', { class: 'state is-loading', role: 'status' }, 'Загружаю варианты…')); onPaint?.([]); return; }
    const secs = (data.sections || []).filter((s) => s.children && s.children.length && wanted(s));
    if (!secs.length) { el.replaceChildren(h('p', { class: 'muted' }, 'Для этого типа паспорта вариантов текстов пока нет — они появятся, когда будет заполнен «Справочники → Тексты паспорта».')); onPaint?.([]); return; }
    el.replaceChildren(...secs.map(step));
    onPaint?.(secs);
  }
  const pull = (force) => (load ? Promise.resolve(load(cat, productId, force)) : loadFunnel(cat, force, productId));
  async function refresh(force) {
    const my = ++seq; failed = null; data = null; paint();
    if (!cat) return;
    try { const d = await pull(force); if (my === seq) data = d; } catch (e) { if (my === seq) failed = e; }
    if (my === seq) { paint(); fire(); }
  }
  // вернулись из справочника (правили текст в соседней вкладке) — подтянуть свежее
  let seen = false;
  const onFocus = () => {
    if (!el.isConnected) { if (seen) window.removeEventListener('focus', onFocus); return; }
    seen = true;
    if (!cat || !data) return;
    const my = seq;
    pull(true).then((d) => { if (my === seq && el.isConnected) { data = d; paint(); } }).catch(() => {});
  };
  window.addEventListener('focus', onFocus);
  refresh();
  return {
    el,
    get value() { return JSON.stringify(choices); },
    set value(v) { choices = parse(v); for (const k of Object.keys(partial)) delete partial[k]; paint(); },
    focus: () => el.querySelector('button')?.focus(),
    refresh,
    setCategory(code) {
      if ((code || '') === cat) return;
      const had = !!cat && Object.keys(choices).length > 0;
      cat = code || '';
      choices = {}; for (const k of Object.keys(partial)) delete partial[k]; editing.clear();
      fire(); refresh();
      if (had && cat) toast('Тип паспорта сменился — выберите шаги текста заново');
    },
    /** Способ установки, который задаёт выбранный вариант раздела «Установка» ('' — не задаёт или не выбран). */
    installTypeId() { const leaf = this.installLeaf(); return leaf?.installTypeId ? String(leaf.installTypeId) : ''; },
    /** Раздел «Установка»: { section, leaves — все конечные варианты, chosen — выбран ли вариант руками }; нет раздела — section null. */
    install() {
      const s = (data?.sections || []).find((x) => x.section === 'installation') || null;
      const leaves = []; const walk = (ns) => { for (const n of ns || []) { if (isLeaf(n)) leaves.push(n); else walk(n.children); } };
      if (s) walk(s.children);
      return { section: s, leaves, chosen: !!(s && choices[s.id]) };
    },
    /** Выбранный (или подставленный) конечный вариант раздела «Установка»; null — не выбран. */
    installLeaf() {
      const { section: s } = this.install();
      if (!s) return null;
      const e = effective(s); const leaf = e.path[e.path.length - 1];
      return leaf && isLeaf(leaf) ? leaf : null;
    },
    /** Выбрать вариант раздела программно (как нажатие на плитку). */
    choose(rootId, leafId) { choices[rootId] = leafId; delete partial[rootId]; editing.delete(rootId); paint(); fire(); },
    stepEl: (rootId) => el.querySelector(`[data-root="${rootId}"]`),
    roots: () => (data?.sections || []).filter((s) => s.children?.length),
  };
}
