import { h } from '../core/dom.js';
import { session } from '../core/api.js';
import { parseNum } from '../core/format.js';
import { photoField } from './photos.js';
import { attachCombo } from './combo.js';
import { attachSuggest } from './suggest.js';
import { attachPhrases } from './phrases.js';
import { enhanceSelect } from './select.js';

/**
 * Форма из описания полей (CANON §2 «Карточка»). Поле:
 *   { key, label, type: text|number|money|date|select|combo|textarea|photos, required, wide, options, hint, min, placeholder }
 *   photos — значение [{ id, url, thumb }], в values — список id.
 *   options — массив строк или { value, label } (для select/combo); у combo можно вводить своё значение;
 *     у combo ещё { sub, group } и функция options(get) — список по значениям других полей; multi — несколько через запятую.
 *   { section: 'Название', tone: main|info|money|who, collapsed?, fixed?, sumOf?(get) → «заполнено 4 из 6» } — начинает цветной блок полей (сетка 4 колонки).
 *     Блок сворачивается кликом по заголовку (fixed — нельзя), состояние помнится; свёрнутый показывает, что в нём заполнено.
 *   type: 'pick' — «Категория → Позиция из базы» (TASKS В.1): { key: '_pick', type: 'pick', load: async () => [{ label, cat, sub, values }], target: 'title' };
 *     выбор заполняет поля из values, поле target становится «из базы» (только чтение, «изменить» — вернуть ручной ввод). В read() не попадает.
 *   type: 'hidden' — скрытое значение (его ставит suggest другого поля).
 *   type: 'segment' — кнопки-переключатель для 2–4 вариантов (options: { value, label, tone? }).
 *   span: 1|3 — ширина поля в блоке (из 4 колонок; по умолчанию 2, wide — вся строка).
 *   phrases — { load: async () => [{ text, n, categories }], by: 'category', title } — «▾ Варианты» готовых текстов под полем (ui/phrases.js), сначала для значения поля by.
 *   warn — async (value) => текст | null: предупреждение под полем при вводе (`.field .warn`), сохранить не мешает.
 *   load — у combo: async () => варианты (строки или { value, label }); грузятся при первом фокусе, кэшируются; если есть и options — дополняют их (без повторов).
 *   note — вместо поля: { note: 'текст' } — общая серая строка-подсказка на всю ширину.
 *   strict — у combo: только из списка (прежнее значение можно оставить); функция strict(get) — проверка включена, пока она true.
 *   suggestKeep — выбор подсказки не затирает то, что человек уже поправил руками (паспорт: смена модели).
 *   mount(api) — после сборки: поле следит за другими. api: get(k), set(k, v, { auto, src }), on(k, fn), input(k), field(k), open(k), manual(k), keys(), root.
 *     set с auto: true — значение «по умолчанию» (серое, `.is-default`), src — откуда («из изделия») серым у подписи; ручная правка снимает обе метки.
 *   suggestFocus — ключ поля, куда перейти после выбора подсказки.
 *   compose — { from: [ключи], build(values) } — значение собирается из других полей на лету, пока его не поправили вручную.
 *   suggest — async () => [{ label, sub, cat, search, values }]: подсказки под полем, выбор заполняет несколько полей (ui/suggest.js).
 * Возвращает { el, read() → { values } | { errors }, dirty(), focus() }.
 */
export function buildForm(fields, initial = {}) {
  fields = fields.filter((f) => f && (!f.money || session.canMoney)); // суммы — только деньги-ролям
  const inputs = new Map();
  const root = fields.some((f) => f.section) ? h('div', { class: 'form-blocks' }) : null;
  let grid = h('div', { class: 'form-grid' });
  if (root && !fields[0]?.section) root.append(grid);
  const blocks = [];
  let blk = null;
  for (const f of fields) {
    if (f.section) {
      grid = h('div', { class: 'form-grid' });
      const block = h('section', { class: 'form-block', 'data-tone': f.tone || 'main' });
      const sum = h('span', { class: 'form-sec-sum' });
      const store = 'form-sec:' + f.section;
      let closed = !!f.collapsed;
      if (!f.fixed) { try { const x = localStorage.getItem(store); if (x !== null) closed = x === '1'; } catch { /* нет хранилища */ } }
      const title = h('span', { class: 'form-sec-t' }, f.section);
      const head = f.fixed
        ? h('div', { class: 'form-sec' }, title)
        : h('button', { type: 'button', class: 'form-sec', onclick: () => setOpen(b, b.block.classList.contains('closed'), true) },
          title, sum, h('span', { class: 'form-sec-chev', 'aria-hidden': 'true' }, '›'));
      block.append(head, grid);
      const b = { block, head, sum, store, keys: [], sumOf: f.sumOf };
      blocks.push(b); blk = b;
      setOpen(b, !closed, false);
      root.append(block);
      continue;
    }
    if (f.note) { grid.append(h('div', { class: 'hint wide' }, f.note)); continue; } // общая строка-подсказка под рядом полей
    const id = 'f-' + f.key + '-' + Math.random().toString(36).slice(2, 7);
    const v = initial[f.key];
    let input;
    const opts = (typeof f.options === 'function' ? [] : f.options || []).map((o) => (typeof o === 'object' ? o : { value: o, label: o }));
    if (f.type === 'hidden') {
      // скрытое значение (ПС.5: паспорт-образец модели) — заполняют подсказки других полей (suggest)
      input = h('input', { type: 'hidden', name: f.key });
      input.value = v ?? '';
      grid.append(input);
      inputs.set(f.key, { f, input, err: h('div', { hidden: true }), label: h('div'), blk });
      continue;
    }
    if (f.type === 'photos') {
      // Фото: значение — список id; файлы грузятся сразу, привязка — при сохранении
      const pf = photoField(Array.isArray(v) ? v : []);
      // value = JSON id; присвоить можно список [{ id, url, thumb }] (или его JSON) — картинки модели в паспорте (ФП)
      input = { el: pf.el, get value() { return JSON.stringify(pf.ids()); }, set value(x) { let l = x; try { if (typeof x === 'string') l = JSON.parse(x || '[]'); } catch { l = []; } pf.set((Array.isArray(l) ? l : []).filter((p) => p && typeof p === 'object' && p.id)); }, focus: pf.focus };
      const err = h('div', { class: 'err', hidden: true });
      const label = h('div', { class: 'field wide' }, h('span', null, f.label), pf.el, f.hint ? h('div', { class: 'hint' }, f.hint) : null, err);
      grid.append(label);
      inputs.set(f.key, { f, input, err, label, blk });
      blk?.keys.push(f.key);
      continue;
    }
    if (f.type === 'pick') {
      let items = null; let catSel = '';
      const load = async () => { items ??= await f.load().catch(() => []); return items; };
      const cat = h('input', { placeholder: 'Выберите категорию', 'aria-label': 'Категория' });
const setCat = (name) => { catSel = name; item.placeholder = name ? `Позиция из «${name}» — начните печатать или выберите` : 'Сначала выберите категорию'; };
      const item = h('input', { placeholder: 'Сначала выберите категорию', 'aria-label': 'Позиция из базы' });
      const clear = h('button', { type: 'button', class: 'btn btn-ghost btn-sm pick-clear', hidden: true, title: 'Не из базы — ввести вручную' }, '× вручную');
      const row = h('div', { class: 'pick-row' }, h('label', { class: 'field' }, h('span', null, 'Категория'), cat), h('label', { class: 'field pick-item' }, h('span', null, 'Позиция из базы'), item), clear);
      const wrap = h('div', { class: 'field wide pick' }, row, h('div', { class: 'hint' }, f.hint || 'Уже заказывали или есть на складе — выберите, поля заполнятся сами. Нет в списке — заполните «Наименование» вручную.'));
      grid.append(wrap);
      const lock = (on) => {
        const tg = inputs.get(f.target || 'title');
        if (tg) { tg.input.readOnly = on; tg.label.classList.toggle('from-base', on); }
        clear.hidden = !on;
      };
      load().then(() => {
        const cats = [...new Set(items.map((x) => x.cat).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
        let itemCombo;
        attachCombo(cat, { options: () => cats.map((c) => ({ label: c, value: c })), onPick: (o) => { setCat(o.value); item.value = ''; itemCombo?.suppress(); item.focus(); } });
        cat.addEventListener('change', () => { const v = cat.value.trim(); setCat(cats.find((c) => c.toLowerCase() === v.toLowerCase()) || ''); });
        itemCombo = attachCombo(item, {
          options: () => (catSel ? items.filter((x) => x.cat === catSel).map((x) => ({ label: x.label, sub: x.sub, x })) : []),
          empty: () => (catSel ? null : (cat.classList.add('need'), setTimeout(() => cat.classList.remove('need'), 1600), '← Сначала выберите категорию — тогда здесь будут её позиции')),
          onPick: (o) => {
            for (const [k, val] of Object.entries(o.x.values || {})) { const xx = inputs.get(k); if (xx && val != null && val !== '') { xx.input.value = String(val); if (xx.input.type === 'hidden') xx.input.dispatchEvent(new Event('change', { bubbles: true })); } }
            lock(true); summarize();
          },
        });
      });
      clear.addEventListener('click', () => { lock(false); item.value = ''; const tg = inputs.get(f.target || 'title'); tg?.input.focus?.(); });
      continue;
    }
    if (f.type === 'widget') {
      // свой элемент (НО: «штуками / по весу»): f.widget(v) → { el, value — строка JSON }
      input = f.widget(v);
    } else if (f.type === 'segment') {
      let cur = String(v ?? opts[0]?.value ?? '');
      const btns = opts.map((o) => h('button', { type: 'button', role: 'radio', class: 'fseg-btn', 'data-v': String(o.value), 'data-tone': o.tone || '', onclick: () => set(o.value) }, o.label));
      const box = h('div', { class: 'fseg', role: 'radiogroup', id }, btns);
      const set = (x) => {
        cur = String(x ?? '');
        for (const b of btns) { const on = b.dataset.v === cur; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); }
        box.dispatchEvent(new Event('change', { bubbles: true }));
      };
      set(cur);
      input = { el: box, get value() { return cur; }, set value(x) { set(x); }, focus: () => (btns.find((b) => b.dataset.v === cur) || btns[0])?.focus() };
    } else if (f.type === 'select') {
      const list = [...opts];
      if (v != null && v !== '' && !list.some((o) => String(o.value) === String(v))) list.push({ value: v, label: String(v) });
      input = h('select', { id, name: f.key, value: v ?? '' },
        f.required ? null : h('option', { value: '' }, '—'),
        list.map((o) => h('option', { value: String(o.value) }, o.label)));
      enhanceSelect(input); // длинные варианты (заказ, компания) — без обрезки (ВС.6); короткие остаются обычными
    } else if (f.type === 'textarea') {
      input = h('textarea', { id, name: f.key, rows: f.rows || 3, maxlength: f.max || 2000 });
      input.value = v ?? '';
    } else {
      input = h('input', {
        id, name: f.key, placeholder: f.placeholder || (f.type === 'combo' ? 'Выберите или впишите' : undefined), autocomplete: 'off',
        type: f.type === 'date' ? 'date' : 'text',
        inputmode: f.type === 'number' || f.type === 'money' ? 'decimal' : undefined,
        maxlength: f.max || 500,
      });
      input.value = v ?? '';
    }
    const err = h('div', { class: 'err', hidden: true });
    // f.warn(value) → текст или null: предупреждение под полем при вводе (не мешает сохранить) — «такой артикул уже есть» (ФИ)
    const warn = f.warn ? h('div', { class: 'warn', hidden: true, role: 'status' }) : null;
    const label = h(input.el ? 'div' : 'label', { class: 'field' + (f.wide ? ' wide' : '') + (f.span ? ' span-' + f.span : '') + (f.type === 'segment' ? ' is-seg' : ''), for: input.el ? undefined : id },
      h('span', null, f.label, f.required ? h('span', { class: 'req' }, ' *') : null), input.el || input, f.hint ? h('div', { class: 'hint' }, f.hint) : null, warn, err);
    grid.append(label);
    inputs.set(f.key, { f, input, err, label, blk });
    blk?.keys.push(f.key);
    if (f.type === 'combo') {
      // f.extra — явные действия под списком; f.strict — только из списка (или через действие), прежнее значение можно оставить (ЗЧ.2)
      const set = (k, val) => { const x = inputs.get(k); if (x) { x.input.value = val; x.input.dispatchEvent(new Event('input', { bubbles: true })); } };
      // f.options(get) — список зависит от других полей (группа — от раздела); sub — серая строка, group — заголовок; f.multi — через запятую
      const get = (k) => inputs.get(k)?.input.value ?? '';
      // f.load — async () => массив строк/{value,label}: варианты грузятся при первом фокусе поля, результат в кэше; ошибка — список пуст
      let loaded = []; let loading = null; let cb = null; let done = false;
      const lazy = () => {
        if (!f.load || loading) return;
        loading = Promise.resolve().then(f.load).then((r) => { loaded = Array.isArray(r) ? r : []; }).catch(() => { loaded = []; }).then(() => { done = true; cb?.refresh(); });
      };
      if (f.load) input.addEventListener('focus', lazy);
      // load вместе с options: загруженное дополняет заданное, повторы по значению убираются
      const norm = (a) => a.map((o) => (typeof o === 'object' ? o : { value: o, label: o }));
      const list = () => {
        if (!f.load) return norm(typeof f.options === 'function' ? f.options(get) || [] : opts);
        const base = f.options ? norm(typeof f.options === 'function' ? f.options(get) || [] : opts) : [];
        const seen = new Set(base.map((o) => String(o.value).trim().toLowerCase()));
        return [...base, ...norm(loaded).filter((o) => !seen.has(String(o.value).trim().toLowerCase()))];
      };
      cb = attachCombo(input, { multi: !!f.multi, options: () => list().map((o) => ({ label: String(o.label), value: o.value, sub: o.sub, group: o.group })), extra: f.extra ? (t, shown) => f.extra(t, shown, { set, add: (l) => opts.push({ value: l, label: l }) }) : undefined,
        empty: f.load ? () => (loading && !done ? 'Загружаю…' : undefined) : undefined }); // признак загрузки, а не «список пуст»
      if (f.strict) {
        const was = String(v ?? '');
        input.addEventListener('blur', () => setTimeout(() => {
          if (typeof f.strict === 'function' && !f.strict(get)) { err.hidden = true; return; } // ТЭ: «свой текст» включён — проверка выключена
          const val = input.value.trim();
          if (!val || val === was || list().some((o) => String(o.label ?? o) === val)) { err.hidden = true; return; }
          input.value = was; err.textContent = f.strictText || 'Выберите из списка'; err.hidden = false;
        }, 200));
      }
    }
    if (warn) {
      let timer; let seq = 0;
      const check = () => { clearTimeout(timer); timer = setTimeout(async () => {
        const my = ++seq; const val = String(input.value ?? '').trim();
        let text = null; try { text = val ? await f.warn(val) : null; } catch { text = null; }
        if (my !== seq) return;
        warn.textContent = text || ''; warn.hidden = !text;
      }, 400); };
      input.addEventListener('input', check);
    }
    if (f.phrases) {
      const ph = attachPhrases(input, { load: f.phrases.load, title: f.phrases.title, label: f.phrases.label, context: () => (f.phrases.by ? inputs.get(f.phrases.by)?.input.value || '' : '') });
      // поле-источник бывает составным (выбор из списка: { el, value }) — тогда слушаем его обёртку, change всплывает
      if (f.phrases.by) setTimeout(() => {
        const src = inputs.get(f.phrases.by);
        const t = typeof src?.input?.addEventListener === 'function' ? src.input : src?.input?.el || src?.label;
        t?.addEventListener?.('change', ph.refresh);
      });
    }
    if (f.suggest) {
      attachSuggest(input, { load: f.suggest, title: f.suggestTitle, onPick: (vals) => {
        for (const [k, v] of Object.entries(vals)) { const x = inputs.get(k); if (f.suggestKeep && manual.has(k) && String(x?.input.value ?? '').trim()) continue; if (x && v != null && v !== '') { x.input.value = String(v); (x.input.el || x.input).dispatchEvent?.(new Event('change', { bubbles: true })); if (f.suggestKeep && x.input.classList && /^(INPUT|TEXTAREA)$/.test(x.input.tagName) && x.input.type !== 'hidden') x.input.classList.add('is-default'); if (x.input.tagName === 'SELECT') x.input.dispatchEvent(new Event('change', { bubbles: true })); } }
        summarize();
        if (f.suggestFocus) setTimeout(() => inputs.get(f.suggestFocus)?.input.focus?.(), 0); // ПС.5: выбрали модель — дальше «Заказчик»
      } });
    }
  }
  // compose: { from: [ключи], build(values) → текст } — поле собирается из других на лету (ПС: «Описание целиком»);
  // поправили вручную — больше не перезаписываем, под полем «↻ Собрать заново из полей выше»
  for (const [, x] of inputs) {
    const c = x.f.compose;
    if (!c) continue;
    const vals = () => Object.fromEntries(c.from.map((k) => [k, inputs.get(k)?.input.value ?? '']));
    let auto = c.build(vals());
    const manual = () => x.input.value.trim() !== '' && x.input.value !== auto;
    const again = h('button', { type: 'button', class: 'link-btn ph-btn', onclick: () => { auto = c.build(vals()); x.input.value = auto; x.input.dispatchEvent(new Event('input', { bubbles: true })); again.hidden = true; } }, '↻ Собрать заново из полей выше');
    x.input.insertAdjacentElement('afterend', again);
    again.hidden = !manual();
    if (!x.input.value.trim()) x.input.value = auto;
    const update = () => { const next = c.build(vals()); if (!manual()) { x.input.value = next; auto = next; } again.hidden = !manual(); };
    for (const k of c.from) { const i = inputs.get(k)?.input; const src = typeof i?.addEventListener === 'function' ? i : i?.el; src?.addEventListener?.('input', update); src?.addEventListener?.('change', update); }
    x.input.addEventListener('input', () => { again.hidden = !manual(); });
  }

  /** Свёрнутый блок показывает в заголовке то, что в нём уже заполнено. */
  function summarize() {
    for (const b of blocks) {
      const parts = [];
      // sumOf(get) — своя сводка блока («заполнено 4 из 6»); пусто — обычная
      if (b.sumOf) { const t = b.sumOf((k) => inputs.get(k)?.input.value ?? ''); if (t) { b.sum.textContent = t; continue; } }
      for (const k of b.keys) {
        const { f, input } = inputs.get(k);
        const raw = String(input.value ?? '').trim();
        if (f.type === 'photos') { const n = JSON.parse(raw || '[]').length; if (n) parts.push(`фото: ${n}`); continue; }
        // свой элемент: f.summary(raw) или «Подпись: N» для списка (метки, строки таблицы); JSON в сводку не выводим
        if (f.type === 'widget') {
          if (f.summary) { const t = f.summary(raw); if (t) parts.push(t); continue; }
          let v = null; try { v = JSON.parse(raw || 'null'); } catch { /* не JSON */ }
          if (Array.isArray(v) && v.length) parts.push(`${f.label}: ${v.length}`);
          continue;
        }
        if (!raw) continue;
        if (f.type === 'select') parts.push(input.selectedOptions?.[0]?.textContent || raw);
        else if (f.type === 'segment') parts.push(input.el.querySelector('.on')?.textContent || raw);
        else if (f.type === 'date') parts.push(raw.split('-').reverse().join('.'));
        else parts.push(raw);
      }
      b.sum.textContent = parts.length ? parts.join(' · ') : 'не заполнено';
    }
  }
  if (root) { root.addEventListener('input', summarize); root.addEventListener('change', summarize); summarize(); }

  // ручные правки (событие от человека, не от программы) — для suggestKeep и mount().manual
  const manual = new Set();
  for (const [k, x] of inputs) {
    const el = x.input.el || x.input;
    const mark = (e) => { if (e.isTrusted) { manual.add(k); (x.input.classList || x.input.el?.classList)?.remove('is-default'); delete x.label?.querySelector?.(':scope > span')?.dataset.src; } };
    el.addEventListener?.('input', mark); el.addEventListener?.('click', (e) => { if (x.f.type === 'segment' || x.f.type === 'widget') mark(e); });
  }
  // f.mount(api) — поле следит за другими (паспорт: категория → списки, умолчания, «не хватает для выпуска»)
  const fapi = {
    get: (k) => inputs.get(k)?.input.value ?? '',
    set: (k, v, { auto = false, src = '' } = {}) => {
      const x = inputs.get(k); if (!x) return;
      x.input.value = v ?? '';
      const el = x.input.el || x.input;
      el.dispatchEvent?.(new Event('input', { bubbles: true })); el.dispatchEvent?.(new Event('change', { bubbles: true }));
      (x.input.classList || el.classList)?.toggle('is-default', !!auto);
      const sp = x.label?.querySelector?.(':scope > span');
      if (sp) { if (auto && src) sp.dataset.src = src; else delete sp.dataset.src; }
    },
    on: (k, fn) => { const x = inputs.get(k); const el = x && (x.input.el || x.input); el?.addEventListener?.('input', fn); el?.addEventListener?.('change', fn); },
    input: (k) => inputs.get(k)?.input,
    field: (k) => inputs.get(k)?.label,
    open: (k) => { const b = inputs.get(k)?.blk; if (b) setOpen(b, true, false); },
    manual: (k) => manual.has(k),
    keys: () => [...inputs.keys()],
    root: root || grid,
  };
  for (const [, x] of inputs) if (x.f.mount) setTimeout(() => x.f.mount(fapi));

  const snapshot = () => JSON.stringify([...inputs.values()].map(({ input }) => input.value));
  const start = snapshot();

  function read() {
    const values = {}, errors = {};
    for (const [key, { f, input, err, label }] of inputs) {
      const raw = input.value.trim();
      err.hidden = true; label.classList.remove('has-error');
      if (f.type === 'photos' || f.type === 'widget') { values[key] = raw ? JSON.parse(raw) : null; continue; }
      let val = raw === '' ? null : raw;
      if (val !== null && (f.type === 'number' || f.type === 'money')) {
        val = parseNum(raw);
        if (Number.isNaN(val)) errors[key] = 'Введите число';
        else if (f.min !== undefined && val < f.min) errors[key] = `Не меньше ${f.min}`;
      }
      if (f.required && (val === null || val === '')) errors[key] = 'Заполните поле';
      if (errors[key]) { err.textContent = errors[key]; err.hidden = false; label.classList.add('has-error'); }
      values[key] = val;
    }
    if (Object.keys(errors).length) {
      for (const k of Object.keys(errors)) { const b = inputs.get(k).blk; if (b) setOpen(b, true, false); }
      const first = inputs.get(Object.keys(errors)[0]);
      first.input.focus?.();
      return { errors };
    }
    return { values };
  }

  /** ОШ: поля из ответа сервера ([{ key, label? }]) — подсветить и раскрыть блок, фокус на первое. */
  function markErrors(list) {
    let first = null;
    for (const f of list || []) {
      const x = inputs.get(f.key); if (!x) continue;
      x.err.textContent = f.message || 'Заполните поле'; x.err.hidden = false; x.label.classList.add('has-error');
      if (x.blk) setOpen(x.blk, true, false);
      first ??= x;
    }
    first?.input.focus?.();
    return !!first;
  }

  return {
    el: root || grid,
    read,
    markErrors,
    dirty: () => snapshot() !== start,
    // фокус — на первое видимое поле ввода (ОШ.1: первым бывает виджет / фото / скрытое — у них нет focus(), форма падала)
    focus: () => {
      const box = root || grid;
      const el = [...box.querySelectorAll('input:not([type=hidden]):not([disabled]), textarea:not([disabled]), select:not([disabled])')].find((x) => x.offsetParent !== null && !x.closest('[hidden]'));
      el?.focus?.();
    },
  };
}

function setOpen(b, open, remember) {
  b.block.classList.toggle('closed', !open);
  if (b.head.tagName === 'BUTTON') b.head.setAttribute('aria-expanded', String(open));
  if (remember) { try { localStorage.setItem(b.store, open ? '0' : '1'); } catch { /* нет хранилища */ } }
}
