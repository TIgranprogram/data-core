/**
 * Варианты текстов в книжке. В short показываются только ветки, которые ещё требуют выбора.
 */
import { api } from '../../core/api.js';
import { h } from '../../core/dom.js';
import { toastError } from '../../ui/kit/toast.js';
import { buildForm, button } from '../../ui/kit/index.js';
import { V2_CATS } from './common.js';

const catLabel = (code) => V2_CATS.find((c) => c.value === code)?.label || code || 'не задан';

/** host — контейнер под списком страниц; ctx — { S, can, pid, lock, patchPassport, onChanged }. */
export function mountBookChoices(host, ctx) {
  let funnel = null;
  let alternative = null;
  let funnelBox = null;
  let saving = false;
  let pending = null;
  let timer = 0;
  let paintSeq = 0;

  const saveChoices = async () => {
    if (!pending || saving || !ctx.can) return;
    saving = true;
    const controls = [funnel?.el, alternative?.el].filter(Boolean);
    controls.forEach((el) => { el.inert = true; });
    let changed = false;
    try {
      while (pending) {
        const { choices, inst, template, baseline, ownBaseline, explicit } = pending;
        pending = null;
        if (template) {
          if (ctx.S.template?.variant !== template.variant) continue;
          const changes = explicit || Object.fromEntries(Object.entries(choices).filter(([id, value]) => baseline[id] !== value));
          if (!Object.keys(changes).length) continue;
          await ctx.lock(() => ctx.patchTemplate({ textChoices: changes }, ownBaseline));
          Object.assign(ownBaseline.textChoices, changes);
          changed = true;
          continue;
        }
        const same = JSON.stringify(choices) === JSON.stringify(ctx.S.r.textChoices || {}) && (!inst || String(ctx.S.r.installationTypeId || '') === String(inst));
        if (same) continue;
        const body = { textChoices: choices };
        if (inst) body.installationTypeId = inst;
        await ctx.lock(() => ctx.patchPassport(body));
        await ctx.refreshRow();
        ctx.S.changed = true;
        changed = true;
      }
    } catch (e) { toastError(e); changed = true; }
    finally {
      controls.forEach((el) => { el.inert = false; });
      saving = false;
      if (pending) timer = setTimeout(saveChoices, 0);
      else if (changed) { ctx.onChanged?.(); void paint(); }
    }
  };

  async function paint() {
    const my = ++paintSeq;
    if (saving || pending) return;
    if (!ctx.can) { host.replaceChildren(); host.hidden = true; return; }
    host.hidden = false;
    const r = ctx.S.r;
    const template = ctx.S.template;
    const unresolved = r.variant === 'short'
      ? (r.readiness?.missing || []).map((it) => String(it.key)).filter((key) => key.startsWith('choice:')).map((key) => key.slice(7))
      : undefined;
    const candidates = template?.simpleDescriptionSuggestions || [];
    const roots = new Set(candidates.map((item) => item.rootId));
    const simpleChoice = !template?.simpleDescriptionSource && unresolved?.some((id) => roots.has(id));
    const only = simpleChoice ? unresolved.filter((id) => !roots.has(id)) : unresolved;
    const path = h('div', { class: 'bk-path' },
      h('div', { class: 'bk-path-row' }, h('span', { class: 'bk-path-k' }, 'Тип паспорта'), h('b', null, catLabel(r.passportCategory))),
      template ? button({ label: 'Изменить тип', kind: 'ghost', size: 'S', onClick: ctx.openCategory }) : null);
    if (!r.passportCategory || (only?.length === 0 && !simpleChoice)) {
      funnel = null;
      alternative = null;
      host.replaceChildren(path);
      return;
    }
    if (!funnelBox && only?.length !== 0) ({ funnelBox } = await import('../../ui/funnel.js'));
    if (my !== paintSeq || host.isConnected === false) return;
    const baseline = r.textChoices || {};
    const ownBaseline = { ...template?.defaults, textChoices: { ...template?.defaults?.textChoices } };
    const schedule = (work) => {
      pending = { template: ctx.S.template, baseline, ownBaseline, ...work };
      clearTimeout(timer);
      timer = setTimeout(saveChoices, 450);
    };
    const choose = alternative = simpleChoice ? buildForm([{
      key: 'simpleChoice', label: 'Вариант краткого описания', type: 'select',
      options: candidates.map((item) => ({
        value: item.id,
        label: item.name === item.text ? item.text : `${item.name} · ${item.text}`,
      })),
    }]) : null;
    choose?.el.addEventListener('change', () => {
      if (choose !== alternative) return;
      const option = candidates.find((item) => item.id === choose.get('simpleChoice'));
      if (!option) return;
      const previous = [...roots].filter((id) => id !== option.rootId && ownBaseline.textChoices[id] != null);
      schedule({ explicit: { ...Object.fromEntries(previous.map((id) => [id, null])), [option.rootId]: option.id } });
    });

    const view = funnel = only?.length === 0 ? null : funnelBox({
      value: JSON.stringify(baseline),
      category: r.passportCategory || '',
      productId: r.productId || '',
      facetFirst: true,
      only,
      canEditText: !!template,
      ...(r.presentationVersion === 1 ? { load: (category, productId) => api('/passports/funnel', {
        query: { category, productId, presentationVersion: 1, variant: r.variant },
      }) } : {}),
    });
    view?.el.addEventListener('change', () => {
      if (view !== funnel || view.el.isConnected === false) return;
      const choices = JSON.parse(view.value || '{}');
      if (JSON.stringify(choices) === JSON.stringify(baseline)) return;
      if (template && !Object.entries(choices).some(([id, value]) => baseline[id] !== value)) return;
      schedule({ choices, inst: view.installTypeId?.() || '' });
    });

    host.replaceChildren(
      h('header', { class: 'bk-panel-h' }, h('h3', { class: 'bk-toc-h' }, 'Выбор для текстов')),
      h('p', { class: 'hint bk-toc-hint' }, 'Сверху вниз: от общего к частному. Меняет тексты на листе.'),
      path,
      choose?.el,
      view ? h('div', { class: 'bk-funnel-wrap' }, view.el) : null,
    );
  }

  paint();
  return {
    refresh: paint, busy: () => !!pending || saving,
    focus(root) {
      if (alternative && root && !funnel?.stepEl(root)) { alternative.focus(); return; }
      const target = root && funnel?.stepEl(root)?.querySelector('button');
      if (target) target.focus();
      else funnel?.focus();
    },
  };
}
