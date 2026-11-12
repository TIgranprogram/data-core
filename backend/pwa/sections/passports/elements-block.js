import { api } from '../../core/api.js';
import { h } from '../../core/dom.js';
import { actions, button, hint, link, row } from '../../ui/kit/index.js';
import { buildForm } from '../../ui/kit/form.js';
import { toast, toastError } from '../../ui/kit/toast.js';

const DICT = 'Функциональные элементы'; // так справочник назван в меню «Справочники → Документы (паспорта)»
/** Ссылка в справочник в новой вкладке: паспорт остаётся открытым (жалоба владельца 2026-11-12: «не пойму, где искать»). */
const dictLink = (label, id) => link({ label, href: '#dicts?d=passportElements' + (id ? '&of=dict&open=' + encodeURIComponent(id) : ''), target: '_blank', title: `Справочники → Документы (паспорта) → ${DICT}` });

/** Тексты справочника «Функциональные элементы» по выбранным id: фраза для описания и правила пользования. */
const asIds = (raw) => {
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  try { const v = JSON.parse(raw || '[]'); return Array.isArray(v) ? v.map(String).filter(Boolean) : []; } catch { return []; }
};
const lines = (v) => String(v || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
const idOf = (d) => String(d?.id || d?._id || '');

/**
 * elementsTexts(rows, { canEdit?, onSaved? }) → { el, setIds, setRows }
 * canEdit() — можно ли править общие тексты (директор, администратор): у элемента кнопка «Изменить тексты»,
 * поля открываются на месте, в той же правой панели. onSaved(запись) — после сохранения (паспорт пересобирает текст).
 */
export function elementsTexts(rows, { canEdit, onSaved } = {}) {
  let list = rows || [];
  let last = [];
  const el = h('div');
  const editing = new Map(); // id элемента → узел открытой правки: перерисовка (её зовёт каждая перезагрузка паспорта) берёт тот же узел, набранное не пропадает

  /** Правка текстов элемента на месте. Тексты общие для всех изделий с этим элементом — об этом сказано в подсказке. */
  function editor(d) {
    const id = idOf(d);
    const form = buildForm([
      { note: `Тексты общие: изменятся у всех изделий с элементом «${d.name}». Уже выданные паспорта не меняются.` },
      { key: 'inDescription', label: 'В описании', type: 'textarea', wide: true, max: 1000, hint: 'Фраза для раздела «Описание», например «стойка с указателями направлений»' },
      { key: 'usageRules', label: 'Правила пользования', type: 'textarea', wide: true, max: 4000, hint: 'По строке на правило' },
      { key: 'inspect', label: 'Что проверять при обслуживании', type: 'textarea', wide: true, max: 4000, hint: 'По строке на пункт' },
    ], { inDescription: d.inDescription || '', usageRules: d.usageRules || '', inspect: d.inspect || '' });
    const save = button({ label: 'Сохранить тексты', kind: 'primary', size: 'S', onClick: async () => {
      const r = form.read();
      if (r.errors) return;
      save.disabled = true;
      try {
        const v = r.values;
        const saved = await api(`/dicts/passportElements/${id}`, { method: 'PATCH', body: { inDescription: v.inDescription || '', usageRules: v.usageRules || '', inspect: v.inspect || '' } });
        list = list.map((x) => (idOf(x) === id ? { ...x, ...saved } : x));
        editing.delete(id);
        toast(`Тексты элемента «${d.name}» сохранены`);
        paint();
        onSaved?.(saved);
      } catch (e) { toastError(e, 'сохранить тексты'); save.disabled = false; }
    } });
    const cancel = button({ label: 'Отмена', kind: 'ghost', size: 'S', onClick: () => { editing.delete(id); paint(); } });
    setTimeout(() => form.focus?.(), 0);
    return h('div', null, form.el, actions(save, cancel));
  }

  function view(d, id) {
    const desc = String(d?.inDescription || '').trim();
    const rules = lines(d?.usageRules);
    const can = !!d && !!canEdit?.();
    const edit = can ? button({ label: 'Изменить тексты', size: 'S', title: 'Править фразу для описания и правила прямо здесь', onClick: () => { editing.set(id, editor(d)); paint(); } }) : null;
    return h('div', null,
      h('p', null, desc || (can ? 'В описании текста нет — нажмите «Изменить тексты».' : `В описании текста нет — его дописывает директор в справочнике «${DICT}».`)),
      rules.length
        ? h('div', null, hint('Правила пользования'), ...rules.map((t) => h('p', null, t)))
        : hint('Правил пользования нет'),
      actions(edit, d ? dictLink('Открыть в справочнике ↗', id) : dictLink(`Открыть справочник «${DICT}» ↗`)));
  }

  const paint = () => {
    const byId = new Map(list.map((d) => [idOf(d), d]));
    if (!last.length) {
      el.replaceChildren(hint('Элементы не выбраны. Отметьте «Что это за изделие» — здесь будут фраза для описания и правила пользования.'),
        dictLink(`Открыть справочник «${DICT}» ↗`));
      return;
    }
    el.replaceChildren(...last.flatMap((id) => {
      const d = byId.get(id);
      // строка — название элемента; тексты и правка идут под ней отдельным блоком (в самой строке им тесно)
      return [row({ title: d?.name || 'Элемент не найден в справочнике', wrap: true }), d && editing.has(id) ? editing.get(id) : view(d, id)];
    }));
  };
  const setIds = (raw) => { last = asIds(raw); paint(); };
  return { el, setIds, setRows: (next) => { list = next || []; paint(); } };
}

/** Метки выбора и тексты под ними. value и setScope остаются у меток. */
export function withElementTexts(pick, rows, ids, opts) {
  const view = elementsTexts(rows, opts);
  view.setIds(ids ?? pick.value);
  pick.el.addEventListener('change', () => view.setIds(pick.value));
  return {
    el: h('div', null, pick.el, view.el),
    get value() { return pick.value; },
    set value(v) { pick.value = v; view.setIds(v); },
    focus: () => pick.focus?.(),
    setScope: (code) => pick.setScope?.(code),
  };
}
