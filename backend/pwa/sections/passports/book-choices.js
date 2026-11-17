/**
 * C134: слева в окне паспорта — тип и варианты текстов (воронка).
 * Быстрая смена, если при сборке выбрано не то; страницы паспорта обновляются после сохранения.
 */
import { api } from '../../core/api.js';
import { h } from '../../core/dom.js';
import { toastError } from '../../ui/kit/toast.js';
import { confirmDlg } from '../../ui/kit/dialog.js';
import { select } from '../../ui/kit/index.js';
import { passportCategoryOptions, V2_CATS } from './common.js';

/** host — контейнер под списком страниц; ctx — { S, can, pid, lock, patchPassport, onChanged }. */
export function mountBookChoices(host, ctx) {
  let funnel = null;
  let funnelBox = null;
  let catOpts = null;
  let saving = false;
  let timer = 0;

  const reload = async () => {
    try { ctx.S.r = await api('/passports/' + ctx.pid()); } catch (e) { toastError(e); return false; }
    ctx.S.changed = true;
    ctx.onChanged?.();
    return true;
  };

  const saveChoices = async () => {
    if (!funnel || saving || !ctx.can) return;
    const choices = JSON.parse(funnel.value || '{}');
    const cur = ctx.S.r.textChoices || {};
    const inst = funnel.installTypeId?.() || '';
    const same = JSON.stringify(choices) === JSON.stringify(cur) && (!inst || String(ctx.S.r.installationTypeId || '') === String(inst));
    if (same) return;
    saving = true;
    try {
      const body = { textChoices: choices };
      if (inst) body.installationTypeId = inst;
      await ctx.lock(() => ctx.patchPassport(body));
      await reload();
    } catch (e) { toastError(e); paint(); }
    finally { saving = false; }
  };

  async function paint() {
    if (!ctx.can) { host.replaceChildren(); return; }
    const r = ctx.S.r;
    if (!funnelBox) ({ funnelBox } = await import('../../ui/funnel.js'));
    if (!catOpts) {
      try { catOpts = await passportCategoryOptions(); }
      catch { catOpts = V2_CATS.filter((c) => c.value).map((c) => ({ value: c.value, label: c.label })); }
    }
    const catSel = select({
      label: 'Тип паспорта',
      value: r.passportCategory || '',
      options: [['', 'Не выбран'], ...catOpts.map((c) => [c.value, c.label])],
      onChange: async (v) => {
        if ((v || '') === (r.passportCategory || '')) return;
        if (!(await confirmDlg('Сменить тип паспорта?', 'Тексты пересоберутся по новому типу. Варианты шагов нужно будет выбрать заново.', { okText: 'Сменить тип' }))) {
          paint();
          return;
        }
        saving = true;
        try {
          await ctx.lock(() => ctx.patchPassport({ passportCategory: v || null, textChoices: {} }));
          if (!(await reload())) return;
          funnel = null;
          paint();
        } catch (e) { toastError(e); paint(); }
        finally { saving = false; }
      },
    });

    funnel = funnelBox({
      value: JSON.stringify(r.textChoices || {}),
      category: r.passportCategory || '',
      productId: r.productId || '',
      facetFirst: true,
    });
    funnel.el.addEventListener('change', () => {
      clearTimeout(timer);
      timer = setTimeout(saveChoices, 450);
    });

    host.replaceChildren(
      h('h3', { class: 'bk-toc-h' }, 'Выбор для текстов'),
      h('p', { class: 'hint bk-toc-hint' }, 'Тип и варианты — от них собирается паспорт. Если выбрано не то — поменяйте здесь.'),
      catSel,
      funnel.el,
    );
  }

  paint();
  return { refresh: paint };
}
