import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { tabs } from '../ui/kit/index.js';
import { busyBlock, failBlock } from '../ui/kit/busy.js';
import { current, patch } from '../core/router.js';
import { confirmDlg } from '../ui/kit/dialog.js';
import { toast, toastError } from '../ui/kit/toast.js';
import { badge, section, tagPick } from '../ui/kit/index.js';
import { PASSPORT_TRAITS, buildWhen, idsOf, whenText, whenToPick } from './passports/traits.js';

/**
 * «Справочники → Паспорта → Общие разделы (шаблон)» (БЗ-6 Э2d, docs/PASSPORTS-V2.md §3.3 п. 2); тексты ВАРИАНТОВ для воронки — в passport-tree.js. 
 * Экран: чипы категорий, дерево «раздел → пункты» собранного вида (как в паспорте): пункты «Для всех» — серые «общий»
 * (правятся на чипе «Для всех»), пункты категории — обычные, «заменяет общий» — пункт категории на месте общего.
 * Ввод — только в правой панели (DESIGN §5): ptext — пункт / новый пункт / новый раздел; ptextview — общий пункт и предпросмотр.
 * Адрес: #dicts?d=ptexts&cat=TRN; панель — of=ptext|ptextview&open=<кат>.<вид>.<…>.
 * Сохранение — новая версия категории (PUT /passports/texts, директор/админ); «Для всех» (ALL) — общая часть v2, правится как своя версия (на сервере — category ALL_V2; шаблон «Для всех» PDF v1 не меняется).
 * Ключ пункта = раздел + номер по порядку: пункт № k раздела категории заменяет общий пункт № k того же раздела.
 */
export const TEXTS_KEY = 'ptexts';
/** Переменные в тексте пункта — метками с понятным названием (в паспорте подставится значение). */
const VAR_NAMES = { name: 'наименование', article: 'артикул', code: 'номер изделия', serialNo: 'номер изделия', ageFrom: 'возраст от', ageTo: 'возраст до', heightMin: 'рост от', heightMax: 'рост до', weightMax: 'вес до', maxUsers: 'пользователей', fallHeight: 'высота падения', siteL: 'длина площадки', siteW: 'ширина площадки', serviceLifeYears: 'срок службы', warrantyMonths: 'гарантия, мес.', tempMin: 'темп. от', tempMax: 'темп. до', manufacturer: 'изготовитель' };
function withVars(text) {
  return String(text).split(/(\{[^}]+\})/).filter(Boolean).map((part) => {
    const m = /^\{(std|fig|tab):([^}]+)\}$/.exec(part) || /^\{([A-Za-z]+)\}$/.exec(part);
    if (!m) return part;
    const label = m[2] ? (m[1] === 'std' ? 'норматив ' + m[2].replace(/_/g, ' ') : m[1] === 'fig' ? 'рисунок' : 'таблица') : VAR_NAMES[m[1]] || m[1];
    return h('span', { class: 'pt-var', title: `${part} — подставится в паспорте` }, label);
  });
}
export const CATS = [
  { code: 'ALL', name: 'Для всех' }, { code: 'TRN', name: 'Тренажёры' }, { code: 'WRK', name: 'Воркаут' }, { code: 'BLG', name: 'Благоустройство' },
  { code: 'DIO', name: 'Детское игровое (позже)' }, { code: 'DSP', name: 'Детское спортивное (позже)' },
];
/** Переменные (§3.3 п. 8) — подсказка; клик вставляет в текст. */
export const VARS = ['{name}', '{article}', '{code}', '{serialNo}', '{ageFrom}', '{ageTo}', '{heightMin}', '{heightMax}', '{weightMax}', '{maxUsers}', '{fallHeight}',
  '{siteL}', '{siteW}', '{serviceLifeYears}', '{warrantyMonths}', '{tempMin}', '{tempMax}', '{manufacturer}', '{std:', '{fig:overview}', '{tab:defects-daily}'];
/** Русские подписи переменных для кнопок «вставить в текст» (пользователь 2026-11-10: «непонятные кружочки» — коды на экране не видны). */
export const VAR_LABELS = {
  '{name}': 'Название изделия', '{article}': 'Артикул', '{code}': 'Код изделия', '{serialNo}': 'Заводской номер',
  '{ageFrom}': 'Возраст от', '{ageTo}': 'Возраст до', '{heightMin}': 'Рост от', '{heightMax}': 'Рост до',
  '{weightMax}': 'Вес пользователя до', '{maxUsers}': 'Пользователей одновременно', '{fallHeight}': 'Высота падения',
  '{siteL}': 'Площадка: длина', '{siteW}': 'Площадка: ширина', '{serviceLifeYears}': 'Срок службы', '{warrantyMonths}': 'Гарантия',
  '{tempMin}': 'Температура от', '{tempMax}': 'Температура до', '{manufacturer}': 'Изготовитель',
  '{std:': 'Ссылка на стандарт (ГОСТ)', '{fig:overview}': 'Рисунок «Общий вид»', '{tab:defects-daily}': 'Таблица ежедневного осмотра',
};
const LEAD = /^\s*\d+(?:\.\d+)*\.?\s+/;

const catOf = (c) => (CATS.some((x) => x.code === c) ? c : 'TRN');
const catName = (c) => CATS.find((x) => x.code === c)?.name || c;
export const textsCat = () => catOf(current().params.cat);
export function canEditTexts() {
  if (!session.canEdit) return false;
  return session.user?.isOwner === true || ['admin', 'director'].includes(session.role);
}

// ─── данные: кэш ответа GET /passports/texts по категории (экран и панель читают одно) ────────────
const cache = new Map();
export async function loadTexts(cat, force) {
  if (!force && cache.has(cat)) return cache.get(cat);
  const t = await api('/passports/texts', { query: { category: cat } });
  cache.set(cat, t);
  return t;
}
/** Разделы версии категории для правки: коды пунктов (ids) и условия (when) идут вместе с текстом — иначе правка потеряет их. */
const ownCopy = (t) => (t.own?.sections || []).map((s) => ({ key: s.key, title: s.title || '', paragraphs: [...(s.paragraphs || [])], ids: idsOf(s), when: (s.paragraphs || []).map((_, i) => s.when?.[i] || null) }));
/** Код нового пункта: у замены общего — код общего пункта, иначе новый (номер не сдвигает чужие пункты). */
const newCode = (sec, want) => (want && !sec.ids.includes(want) ? want : 'n' + Date.now().toString(36) + sec.ids.length);
const whenAt = (sec, i) => (sec?.when?.[i] ? String(sec.when[i]) : '');
async function saveOwn(cat, sections) {
  const body = sections.map((s) => ({ ...s, when: (s.when || []).some(Boolean) ? s.when : undefined }));
  const t = await api('/passports/texts', { method: 'PUT', body: { category: cat, sections: body } });
  cache.set(cat, t);
  return t;
}
const refresh = () => window.dispatchEvent(new CustomEvent('data-changed'));
/**
 * Раздел категории с ключом key (создать, если нет). Раздел «Для всех» с индексом i: раздел категории должен стоять
 * не раньше индекса i (порядок раздела = меньший из индексов), поэтому перед ним — пустые «распорки» (в паспорт не попадают).
 */
function ensureOwnSection(t, own, key) {
  const i = own.findIndex((s) => s.key === key);
  if (i >= 0) return i;
  const ai = t.all.sections.findIndex((s) => s.key === key);
  while (ai >= 0 && own.length < ai) own.push({ key: `_pad${own.length}`, title: '', paragraphs: [], ids: [], when: [] });
  own.push({ key, title: ai >= 0 ? t.all.sections[ai].title.replace(LEAD, '') : '', paragraphs: [], ids: [], when: [] });
  return own.length - 1;
}
/** Куда встанет новый раздел категории: после раздела «Для всех» с тем же индексом. */
function newSectionPlace(t) {
  const n = (t.own?.sections || []).length;
  const a = t.all.sections[Math.min(n, t.all.sections.length - 1)];
  return a ? `после раздела «${a.title.replace(LEAD, '')}» (общего)` : 'в конце';
}

/** Метка условия пункта в дереве: «если: Болтовые соединения» (нет условия — метки нет). */
function whenTag(t, it) {
  const node = t.tree.find((x) => x.items.includes(it));
  const w = it.origin === 'all' ? whenAt(t.all.sections[node?.allSection], it.allIndex) : whenAt(t.own?.sections?.[node?.ownSection], it.ownIndex);
  return w ? badge('если: ' + whenText(w), 'info') : null;
}

// ─── экран (в «Справочниках» вместо таблицы) ──────────────────────────────────────────────────────
export function mountTexts() {
  const chips = h('div');
  const info = h('p', { class: 'hint pt-info' });
  const edit = canEditTexts();
  const addSec = h('button', { type: 'button', class: 'btn btn-primary', hidden: !edit, onclick: () => patch({ of: 'ptext', open: `${textsCat()}.s`, new: undefined }) }, '+ Раздел');
  const prev = h('button', { type: 'button', class: 'btn', title: 'Собранный текст категории — как в паспорте (переменные — метками «не заполнено»)', onclick: () => patch({ of: 'ptextview', open: `${textsCat()}.p`, new: undefined }) }, 'Предпросмотр');
  // образец паспорта (БЗ-7 шаг 2): разделы и пункты по порядку, как в PDF; клик по пункту — правка справа
  const tree = h('div', { class: 'pt-tree pt-sheet' }, busyBlock('тексты'));
  const DICTS = [['passportElements', 'Элементы'], ['passportMaterials', 'Материалы'], ['passportDefects', 'Дефекты'], ['passportInstall', 'Способы установки'], ['passportStandards', 'Нормативы']];
  const srcBar = h('p', { class: 'hint pt-src' }, 'Нажмите на пункт — правка откроется справа. Описание, материалы, монтаж и дефекты собираются из справочников: ',
    ...DICTS.flatMap(([k, t], i) => [i ? ' · ' : '', h('a', { href: '#dicts?d=' + k }, t)]));
  const el = h('div', { class: 'pt' }, chips, h('div', { class: 'pt-bar' }, info, h('div', { class: 'dict-tools' }, prev, addSec)),
    edit ? null : h('p', { class: 'hint' }, 'Смотреть могут все; править тексты — директор и администратор.'), srcBar, tree);

  const open = (of, id) => patch({ of, open: id, new: undefined });
  function renderChips(cat) {
    chips.replaceChildren(tabs({ items: CATS.map((c) => ({ key: c.code, label: c.name })), value: cat, label: 'Категория паспорта', onChange: (code) => patch({ cat: code, of: undefined, open: undefined }) }).el);
  }
  function renderTree(cat, t) {
    const sel = current().params.open || '';
    info.textContent = (cat === 'ALL' ? 'Общая часть: эти разделы получают паспорта всех категорий. ' : `Серые пункты — общие (правятся в «Для всех»), остальные — только для «${catName(cat)}». `)
      + (t.source === 'db' ? `Сохранено версий: ${t.version}.` : 'Тексты из программы — после первого сохранения появится своя версия.');
    if (!t.tree.length) { tree.replaceChildren(h('div', { class: 'state' }, 'Разделов нет.')); return; }
    tree.replaceChildren(...t.tree.map((s) => {
      const mine = s.ownSection != null;
      const addHint = s.ownCount < s.allCount ? `Новый пункт встанет вместо общего ${s.number}.${s.ownCount + 1}` : 'Новый пункт — в конец раздела';
      return h('section', { class: 'pt-sec' },
        h('div', { class: 'pt-sec-head' },
          h('h3', null, `${s.number} ${s.title}`),
          h('span', { class: 'pt-sec-tag' }, cat === 'ALL' ? 'общий раздел' : s.allSection == null ? 'раздел категории' : mine ? 'общий + категории' : 'общий'),
          edit && mine ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', title: addHint, onclick: () => open('ptext', `${cat}.n.${s.key}`) }, '+ Пункт') : null),
        h('ol', { class: 'pt-items' }, ...s.items.map((it) => {
          const id = it.origin === 'all' ? `${cat}.a.${s.key}.${it.allIndex}` : `${cat}.i.${s.ownSection}.${it.ownIndex}`;
          const of = it.origin === 'all' ? 'ptextview' : 'ptext';
          return h('li', null, h('button', { type: 'button', class: 'pt-item' + (it.origin === 'all' ? ' all' : '') + (sel === id ? ' active' : ''), onclick: () => open(of, id) },
            h('span', { class: 'pt-num num' }, it.number || '—'),
            h('span', { class: 'pt-text' }, ...withVars(it.bullet ? it.text : it.text.replace(LEAD, ''))),
            it.origin === 'all' ? h('span', { class: 'pt-tag' }, 'общий') : it.origin === 'override' ? h('span', { class: 'pt-tag own' }, 'заменяет общий') : null,
            whenTag(t, it)));
        })));
    }));
  }
  let shown = '';
  async function reload() {
    const cat = textsCat();
    renderChips(cat);
    if (shown !== cat) tree.replaceChildren(busyBlock('тексты', { retry: () => reload() }));
    shown = cat;
    try { renderTree(cat, await loadTexts(cat, true)); }
    catch (e) { tree.replaceChildren(failBlock(e, () => reload())); }
  }
  // смена категории — загрузить; открыли/закрыли пункт — только перерисовать выделение из кэша
  function update() {
    const cat = textsCat();
    if (cat !== shown || !cache.has(cat)) reload(); else renderTree(cat, cache.get(cat));
  }
  return { el, reload, update };
}

// ─── правая панель ────────────────────────────────────────────────────────────────────────────────
/** id: КАТ.i.<раздел>.<пункт> — пункт категории; КАТ.n.<ключ раздела>[.copy] — новый пункт; КАТ.s — новый раздел. */
async function editRow(id) {
  const [cat, kind, a, b] = String(id).split('.');
  const t = await loadTexts(catOf(cat));
  const own = t.own?.sections || [];
  const base = { id, cat: catOf(cat), kind, t };
  if (kind === 'i') {
    const s = own[Number(a)], text = s?.paragraphs?.[Number(b)];
    if (text === undefined) throw new Error('Пункт не найден — список обновился. Закройте панель и выберите пункт заново.');
    const node = t.tree.find((x) => x.ownSection === Number(a));
    const item = node?.items.find((x) => x.ownIndex === Number(b) && x.origin !== 'all');
    return { ...base, si: Number(a), pi: Number(b), text, title: s.title, number: item?.number || '', allText: item?.allText, secTitle: node?.title || s.title, when: whenAt(s, Number(b)) };
  }
  if (kind === 'n') {
    const node = t.tree.find((x) => x.key === a);
    const ai = t.all.sections.findIndex((x) => x.key === a);
    const next = node ? node.ownCount : 0;
    const allText = ai >= 0 ? t.all.sections[ai].paragraphs[next] : undefined;
    const allSec = ai >= 0 ? t.all.sections[ai] : null;
    return { ...base, key: a, text: b === 'copy' && allText ? allText : '', allText, secTitle: node?.title || '', number: node ? `${node.number}.${next + 1}` : '', code: allSec ? idsOf(allSec)[next] || '' : '', when: b === 'copy' && allSec ? whenAt(allSec, next) : '' };
  }
  if (kind === 's') return { ...base, text: '', title: '', place: newSectionPlace(t) };
  throw new Error('Неизвестный пункт');
}

/**
 * «Когда пункт попадает в паспорт»: признаки изделия русскими подписями — «есть все из», «любой из», «нет». Пусто — пункт общий.
 * Сложное условие (несколько «или») правится только в справочнике через сервер: показываем словами и оставляем как было.
 */
function whenField(raw) {
  const simple = whenToPick(raw);
  const opts = Object.entries(PASSPORT_TRAITS).map(([value, label]) => ({ value, label }));
  const picks = simple ? { all: tagPick({ options: opts, value: simple.all, label: 'Нужно, чтобы было' }), any: tagPick({ options: opts, value: simple.any, label: 'Нужно хотя бы одно из' }), not: tagPick({ options: opts, value: simple.not, label: 'Нужно, чтобы не было' }) } : null;
  const list = (k) => JSON.parse(picks[k].value);
  const value = () => (picks ? buildWhen({ all: list('all'), any: list('any'), not: list('not') }) : raw);
  const grp = (text, k) => h('div', { class: 'field wide' }, h('span', null, text), picks[k].el);
  const el = section({ title: 'Когда пункт попадает в паспорт' + (raw ? ': ' + whenText(raw) : ' — всегда'), tone: 'info', open: !!raw, body: [
    h('p', { class: 'hint' }, 'Без отметок пункт общий и попадёт в любой паспорт. Признаки берутся из вида изделия, материала, способа установки и выбора «Конструкция».'),
    ...(picks ? [grp('Есть все из', 'all'), grp('Есть хотя бы одно из', 'any'), grp('Нет ни одного из', 'not')] : [h('p', { class: 'muted' }, 'Сложное условие: ' + whenText(raw) + '. Менять его здесь нельзя.')])] });
  const problem = () => {
    if (!picks) return '';
    const all = list('all'), any = list('any'), not = list('not');
    if (any.length === 1) return 'В «хотя бы одно из» отметьте минимум два признака — или перенесите признак в «Есть все из»';
    return [...all, ...any].some((c) => not.includes(c)) ? 'Один признак не может быть и «есть», и «нет»' : '';
  };
  return { el, value, problem };
}

/** Своя форма панели: заголовок раздела (для нового раздела), текст пункта, переменные, «Убрать пункт». */
function textForm(r) {
  const title = h('input', { type: 'text', maxlength: 200, value: r.title || '', placeholder: 'Например: Ограничения и правила пользования' });
  const ta = h('textarea', { rows: 9, maxlength: 4000, class: 'pt-ta' });
  ta.value = r.text || '';
  const err = h('div', { class: 'err', hidden: true });
  const insert = (v) => {
    const s = ta.selectionStart ?? ta.value.length, e = ta.selectionEnd ?? s;
    ta.value = ta.value.slice(0, s) + v + ta.value.slice(e);
    ta.focus(); ta.selectionStart = ta.selectionEnd = s + v.length;
  };
  const vars = h('div', { class: 'pt-vars' }, ...VARS.map((v) => h('button', { type: 'button', class: 'tag', title: v === '{std:' ? 'Норматив по коду из справочника «Нормативы»: {std:КОД}' : 'Вставить в текст', onclick: () => insert(v) }, v === '{std:' ? '{std:КОД}' : v)));
  const cond = whenField(r.when || '');
  let removed = false;
  const del = r.kind === 'i' ? h('button', { type: 'button', class: 'btn btn-danger btn-sm', onclick: () => removeItem(r, () => { removed = true; }) }, 'Убрать пункт') : null;
  const where = r.kind === 'i' ? (r.allText !== undefined ? `Пункт ${r.number} — заменяет общий.` : `Пункт ${r.number} — только в категории.`)
    : r.kind === 'n' ? (r.allText !== undefined ? `Встанет как ${r.number} вместо общего пункта.` : `Встанет как ${r.number} в конец раздела «${r.secTitle}».`)
      : `Раздел встанет ${r.place}.`;
  const el = h('div', { class: 'form-grid pt-form' },
    h('p', { class: 'hint wide' }, `«${catName(r.cat)}» · ${where} Сохранение — новая версия текстов категории; выданные паспорта не меняются.`),
    r.kind === 's' ? h('label', { class: 'field wide' }, h('span', null, 'Название раздела', h('span', { class: 'req' }, ' *')), title) : null,
    h('label', { class: 'field wide' }, h('span', null, r.kind === 's' ? 'Первый пункт' : 'Текст пункта', h('span', { class: 'req' }, ' *')), ta, err),
    h('details', { class: 'month-group wide' }, h('summary', null, `Переменные (${VARS.length}) — клик вставляет в текст`), vars,
      h('div', { class: 'hint' }, 'Пустая переменная в паспорте видна как «[{имя} не заполнено]». Пункт с «— » в начале — маркированный, без номера.')),
    cond.el,
    r.allText !== undefined ? h('details', { class: 'month-group wide' }, h('summary', null, 'Общий текст, который заменяется'), h('p', { class: 'muted' }, r.allText)) : null,
    del ? h('div', { class: 'wide' }, del) : null);
  const start = JSON.stringify([title.value, ta.value, cond.value()]);
  return {
    el,
    focus: () => (r.kind === 's' ? title : ta).focus(),
    dirty: () => !removed && JSON.stringify([title.value, ta.value, cond.value()]) !== start,
    read: () => {
      err.hidden = true;
      const text = ta.value.trim();
      const bad = cond.problem();
      if (bad) { toast(bad, { error: true }); return { errors: { when: 1 } }; }
      if (r.kind === 's' && !title.value.trim()) { title.focus(); toast('Впишите название раздела', { error: true }); return { errors: { title: 1 } }; }
      if (!text) { err.textContent = 'Впишите текст пункта'; err.hidden = false; ta.focus(); return { errors: { text: 1 } }; }
      return { values: { text, title: title.value.trim(), when: cond.value() } };
    },
  };
}

async function saveRow(id, v) {
  const r = await editRow(id);
  const own = ownCopy(r.t);
  let next;
  const when = v.when || null;
  if (r.kind === 'i') { own[r.si].paragraphs[r.pi] = v.text; own[r.si].when[r.pi] = when; next = `${r.cat}.i.${r.si}.${r.pi}`; }
  else if (r.kind === 'n') { const si = ensureOwnSection(r.t, own, r.key); own[si].ids.push(newCode(own[si], r.code)); own[si].when.push(when); own[si].paragraphs.push(v.text); next = `${r.cat}.i.${si}.${own[si].paragraphs.length - 1}`; }
  else { own.push({ key: 'c' + Date.now().toString(36), title: v.title, paragraphs: [v.text], ids: ['p1'], when: [when] }); next = `${r.cat}.i.${own.length - 1}.0`; }
  await saveOwn(r.cat, own);
  // адрес — на сохранённый пункт (после того как панель вернётся в просмотр)
  if (next !== id) setTimeout(() => patch({ of: 'ptext', open: next }), 0);
  return editRow(next);
}

async function removeItem(r, done) {
  if (!(await confirmDlg('Убрать пункт?', `Пункт ${r.number} уйдёт из текстов категории «${catName(r.cat)}» (новая версия). ${r.allText !== undefined ? 'На его месте снова будет общий пункт.' : ''}`, { okText: 'Убрать', danger: true }))) return;
  const before = ownCopy(r.t);
  const own = ownCopy(r.t);
  for (const k of ['paragraphs', 'ids', 'when']) own[r.si][k].splice(r.pi, 1); // пустой раздел остаётся «распоркой» — порядок следующих разделов не сдвигается
  try {
    await saveOwn(r.cat, own);
    done();
    patch({ of: undefined, open: undefined });
    refresh();
    toast('Пункт убран', { undo: async () => { try { await saveOwn(r.cat, before); refresh(); toast('Пункт возвращён'); } catch (e) { toastError(e); } } });
  } catch (e) { toastError(e); }
}

export const ptext = {
  id: 'ptext',
  title: 'Разделы и тексты',
  canEdit: canEditTexts,
  get: (id) => editRow(id),
  card: {
    heading: (r) => (r.kind === 'i' ? `Пункт ${r.number}` : r.kind === 'n' ? 'Новый пункт' : 'Новый раздел'),
    subheading: (r) => `${catName(r.cat)}${r.secTitle ? ' · ' + r.secTitle : ''}`,
    startEdit: () => true,
    noHistory: true,
    view: (r) => [['Текст', r.text ? h('span', { class: 'pt-plain' }, r.text) : h('span', { class: 'muted' }, 'Ещё не сохранён — «Изменить»')], ['Когда попадает в паспорт', r.kind === 's' ? null : r.when ? whenText(r.when) : 'всегда (общий пункт)'], ['Общий текст (заменяется)', r.allText]],
  },
  form: {
    build: (r) => textForm(r),
    toInitial: (r) => r,
    toBody: (v) => v,
    update: (id, b) => saveRow(id, b),
  },
};

// ─── только чтение: общий пункт и предпросмотр ───────────────────────────────────────────────────
async function viewRow(id) {
  const [c, kind, key, idx] = String(id).split('.');
  const cat = catOf(c);
  if (kind === 'p') {
    const p = await api('/passports/texts/preview', { method: 'POST', body: { category: cat } });
    return { id, cat, kind, p };
  }
  const t = await loadTexts(cat);
  const node = t.tree.find((x) => x.key === key);
  const item = node?.items.find((x) => x.origin === 'all' && x.allIndex === Number(idx));
  const ai = t.all.sections.findIndex((x) => x.key === key);
  const text = item?.text ?? t.all.sections[ai]?.paragraphs?.[Number(idx)];
  if (text === undefined) throw new Error('Пункт не найден');
  // заменить можно только следующий по порядку общий пункт (ключ пункта = номер по порядку в разделе)
  const canReplace = (node?.ownCount ?? 0) === Number(idx);
  return { id, cat, kind, key, idx, text, number: item?.number || '', secTitle: node?.title || '', canReplace, when: whenAt(t.all.sections[ai], Number(idx)) };
}

/** Общий пункт № idx раздела key — открыть в «Для всех» (там он свой и правится в панели). */
async function openInAll(key, idx) {
  try {
    const t = await loadTexts('ALL');
    const node = t.tree.find((x) => x.key === key);
    const it = node?.items.find((x) => (x.origin === 'all' ? x.allIndex : x.ownIndex) === idx) ?? node?.items[idx];
    if (!it) { patch({ cat: 'ALL', of: undefined, open: undefined }); return; }
    const id = it.origin === 'all' ? `ALL.a.${key}.${it.allIndex}` : `ALL.i.${node.ownSection}.${it.ownIndex}`;
    patch({ cat: 'ALL', of: it.origin === 'all' ? 'ptextview' : 'ptext', open: id, new: undefined });
  } catch (e) { toastError(e); }
}

function previewBox(p) {
  const part = (title, body) => h('details', { class: 'month-group' }, h('summary', null, title), body);
  return h('div', null,
    h('p', { class: 'muted' }, `Пустой паспорт категории: переменные показаны метками «не заполнено».${p.ownVersion ? ' Версия категории ' + p.ownVersion + '.' : ''}`),
    p.missing?.length ? h('p', { class: 'hint' }, 'Переменные в тексте: ' + p.missing.join(', ')) : null,
    ...(p.sections || []).map((s) => part(`${s.number} ${s.title}`, h('div', null, ...s.items.map((i) => h('p', null, i.number ? h('b', null, i.number + ' ') : '', i.text))))));
}

export const ptextview = {
  id: 'ptextview',
  title: 'Разделы и тексты',
  canEdit: canEditTexts,
  get: (id) => viewRow(id),
  card: {
    heading: (r) => (r.kind === 'p' ? 'Предпросмотр текста' : `Пункт ${r.number} · общий`),
    subheading: (r) => `${catName(r.cat)}${r.secTitle ? ' · ' + r.secTitle : ''}`,
    noHistory: true,
    view: (r) => (r.kind === 'p' ? [] : [['Текст', h('span', { class: 'pt-plain' }, r.text)], ['Когда попадает в паспорт', r.when ? whenText(r.when) : 'всегда'], ['Где', 'Общая часть «Для всех» — правится на чипе «Для всех»']]),
    actions: (r) => (r.kind !== 'a' ? [] : [
      r.canReplace && { label: 'Заменить для категории', run: () => patch({ of: 'ptext', open: `${r.cat}.n.${r.key}.copy` }) },
      // общий пункт — править прямо отсюда: переход на «Для всех» с этим же пунктом (БЗ-7 шаг 2)
      canEditTexts() && { label: 'Изменить для всех категорий', run: () => openInAll(r.key, Number(r.idx)) },
    ].filter(Boolean)),
    extra: (r) => (r.kind === 'p' ? previewBox(r.p) : r.canReplace || !canEditTexts() ? null : h('p', { class: 'hint' }, 'Заменить можно только следующий по порядку общий пункт раздела — сначала замените предыдущие.')),
  },
};
