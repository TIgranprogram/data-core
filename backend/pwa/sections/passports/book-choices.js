/**
 * C141 / C134: слева в окне паспорта — выбор для текстов (воронка).
 * Тип паспорта и путь изделия — только показ (владелец 17.11: паспорт не меняет группу изделия).
 * Варианты текстов (назначение, монтаж…) — сверху вниз через funnelBox.
 */
import { api } from '../../core/api.js';
import { h } from '../../core/dom.js';
import { toastError } from '../../ui/kit/toast.js';
import { V2_CATS } from './common.js';

const catLabel = (code) => V2_CATS.find((c) => c.value === code)?.label || code || 'не задан';

/** host — контейнер под списком страниц; ctx — { S, can, pid, lock, patchPassport, onChanged }. */
export function mountBookChoices(host, ctx) {
  let funnel = null;
  let funnelBox = null;
  let saving = false;
  let pending = null;
  let timer = 0;
  let productPath = '';

  const saveChoices = async () => {
    if (!funnel || saving || !ctx.can) return;
    saving = true;
    try {
      while (pending) {
        const { choices, inst } = pending;
        pending = null;
        const same = JSON.stringify(choices) === JSON.stringify(ctx.S.r.textChoices || {}) && (!inst || String(ctx.S.r.installationTypeId || '') === String(inst));
        if (same) continue;
        const body = { textChoices: choices };
        if (inst) body.installationTypeId = inst;
        await ctx.lock(() => ctx.patchPassport(body));
        ctx.S.r = await api('/passports/' + ctx.pid());
        ctx.S.changed = true;
      }
      ctx.onChanged?.();
    } catch (e) { toastError(e); }
    finally {
      saving = false;
      if (pending) timer = setTimeout(saveChoices, 0);
    }
  };

  async function loadProductPath() {
    const id = ctx.S.r.productId;
    if (!id) { productPath = ''; return; }
    try {
      const p = await api(`/showcase/${id}`);
      productPath = [p.type, p.group, p.subgroup, p.series].filter(Boolean).join(' › ') || (p.name || '');
    } catch { productPath = ''; }
  }

  async function paint() {
    if (saving || pending) return;
    if (!ctx.can) { host.replaceChildren(); host.hidden = true; return; }
    host.hidden = false;
    const r = ctx.S.r;
    if (!funnelBox) ({ funnelBox } = await import('../../ui/funnel.js'));
    await loadProductPath();

    funnel = funnelBox({
      value: JSON.stringify(r.textChoices || {}),
      category: r.passportCategory || '',
      productId: r.productId || '',
      facetFirst: true,
    });
    funnel.el.addEventListener('change', () => {
      pending = { choices: JSON.parse(funnel.value || '{}'), inst: funnel.installTypeId?.() || '' };
      clearTimeout(timer);
      timer = setTimeout(saveChoices, 450);
    });

    const typeName = catLabel(r.passportCategory);
    host.replaceChildren(
      h('header', { class: 'bk-panel-h' }, h('h3', { class: 'bk-toc-h' }, 'Выбор для текстов')),
      h('p', { class: 'hint bk-toc-hint' }, 'Сверху вниз: от общего к частному. Меняет тексты на листе.'),
      h('div', { class: 'bk-path' },
        h('div', { class: 'bk-path-row' }, h('span', { class: 'bk-path-k' }, 'Тип паспорта'), h('b', null, typeName)),
        productPath ? h('div', { class: 'bk-path-row' }, h('span', { class: 'bk-path-k' }, 'Изделие в каталоге'), h('span', { class: 'bk-path-v' }, productPath)) : null,
      ),
      h('div', { class: 'bk-funnel-wrap' }, funnel.el),
    );
  }

  paint();
  return { refresh: paint };
}
