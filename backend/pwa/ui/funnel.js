import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { failBlock } from './busy.js';

/**
 * Воронка текстов паспорта (DESIGN §4 «Шаг-воронка»): по категории — шаги «раздел → 2–3 варианта → (подвариант) → текст».
 * Данные: GET /passports/funnel?category=… → { sections: [{ id, name, section, required, children: [узел { id, name, text?, isDefault?, children? }] }] }.
 * Выбор — textChoices: { [id раздела]: id листа }. Единственный вариант и «по умолчанию» подставляются сами (в значение не пишутся,
 * сервер делает то же); шаг с выбором сворачивается в строку «Монтаж: … · Изменить», под ней текст в 2 строки.
 *   funnelBox({ value, category, canEditText }) → { el, value (JSON), setCategory(code), refresh(), stepEl(rootId), isDone(rootId) }
 * Событие change всплывает от el при каждом выборе.
 */
const cache = new Map();
export function loadFunnel(category, force) {
  const hit = cache.get(category);
  if (!force && hit && Date.now() - hit.at < 60000) return hit.p;
  const p = api('/passports/funnel', { query: { category } }).catch((e) => { cache.delete(category); throw e; });
  cache.set(category, { at: Date.now(), p });
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
const hint = (n) => (isLeaf(n) ? plain(n.text).slice(0, 70) : n.children.map((c) => c.name).slice(0, 3).join(' · '));

export function funnelBox({ value, category = '', canEditText = false } = {}) {
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
  const optRow = (s, depth, nodes, chosen) => h('div', { class: 'pf-opts pp-opts', role: 'radiogroup', 'aria-label': depth ? 'Уточнение' : s.name },
    ...nodes.map((n) => h('button', { type: 'button', role: 'radio', class: 'pf-opt', 'aria-checked': String(chosen?.id === n.id), onclick: () => pick(s, depth, n) },
      h('b', null, n.name), hint(n) ? h('small', null, hint(n)) : null)));

  function textBlock(s, leaf) {
    const full = plain(leaf.text);
    if (!full) return h('p', { class: 'hint' }, 'У этого варианта текст пока пустой — впишите его в «Справочники → Тексты паспорта».');
    const p = h('p', { class: 'pp-ftext clamp', id: `ft-${s.id}` }, full);
    const more = h('button', { type: 'button', class: 'link-btn', 'aria-expanded': 'false', 'aria-controls': p.id, onclick: () => {
      const on = p.classList.toggle('clamp'); more.setAttribute('aria-expanded', String(!on)); more.textContent = on ? 'Развернуть' : 'Свернуть';
    } }, 'Развернуть');
    return h('div', { class: 'pp-ftext-box' }, p, h('div', { class: 'pp-ftext-act' }, full.length > 110 ? more : null,
      canEditText ? h('a', { class: 'link-btn', href: `#dicts?d=passportPhrases&of=ptnode&open=${leaf.id}`, target: '_blank', rel: 'noopener', title: 'Откроется в новой вкладке — паспорт здесь останется как есть' }, 'Править текст') : null));
  }

  function step(s) {
    const { path, auto, gone } = effective(s);
    const complete = path.length > 0 && isLeaf(path[path.length - 1]);
    const wrap = h('section', { class: 'pp-step', 'data-root': String(s.id) });
    if (complete && !editing.has(s.id)) {
      const leaf = path[path.length - 1];
      const many = s.children.length > 1 || path.length > 1;
      wrap.append(h('div', { class: 'pp-step-sum' }, h('span', null, h('b', null, s.name + ': '), path.map((n) => n.name).join(' › ')),
        auto ? h('span', { class: 'muted' }, ' · подставлено') : null,
        many ? h('button', { type: 'button', class: 'link-btn', onclick: () => { editing.add(s.id); paint(); } }, 'Изменить') : null), textBlock(s, leaf));
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

  function paint() {
    if (!cat) { el.replaceChildren(h('p', { class: 'muted' }, 'Выберите категорию — здесь появятся шаги: монтаж, назначение и другие тексты.')); return; }
    if (failed) { el.replaceChildren(failBlock(failed, () => refresh(true), { text: 'Не загрузились варианты текстов' })); return; }
    if (!data) { el.replaceChildren(h('div', { class: 'state is-loading', role: 'status' }, 'Загружаю варианты…')); return; }
    const secs = (data.sections || []).filter((s) => s.children && s.children.length);
    if (!secs.length) { el.replaceChildren(h('p', { class: 'muted' }, 'Для этой категории вариантов текстов пока нет — они появятся, когда будет заполнен «Справочники → Тексты паспорта».')); return; }
    el.replaceChildren(...secs.map(step));
  }
  async function refresh(force) {
    const my = ++seq; failed = null; data = null; paint();
    if (!cat) return;
    try { const d = await loadFunnel(cat, force); if (my === seq) data = d; } catch (e) { if (my === seq) failed = e; }
    if (my === seq) paint();
  }
  // вернулись из справочника (правили текст в соседней вкладке) — подтянуть свежее
  let seen = false;
  const onFocus = () => {
    if (!el.isConnected) { if (seen) window.removeEventListener('focus', onFocus); return; }
    seen = true;
    if (!cat || !data) return;
    const my = seq;
    loadFunnel(cat, true).then((d) => { if (my === seq && el.isConnected) { data = d; paint(); } }).catch(() => {});
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
      cat = code || '';
      choices = {}; for (const k of Object.keys(partial)) delete partial[k]; editing.clear();
      fire(); refresh();
    },
    stepEl: (rootId) => el.querySelector(`[data-root="${rootId}"]`),
  };
}
