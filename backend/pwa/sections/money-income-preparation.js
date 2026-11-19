import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { patch } from '../core/router.js';
import { date, money } from '../core/format.js';
import { section, table, readonlyGroup, button, actions, confirmDlg, failBlock } from '../ui/kit/index.js';
import { identityPreparationBody } from './money-operations-state.js';

/** Подготовка только выбранной истории дохода; чтение и подтверждение разделены. */
export function incomePreparation(row, ctx) {
  const preparation = row.classificationPreparation;
  if (!session.canMoney || preparation?.kind !== 'income-payment-identities' || !preparation.sourceId) return null;
  const url = '/incomes/' + encodeURIComponent(preparation.sourceId) + '/payments/';
  const review = h('div'), feedback = h('div');
  let plan, submitted, busy = false, committed = false, applyButton;
  const loadButton = button({ label: 'Подготовить историю оплат', onClick: () => readPlan() });
  const setBusy = value => { busy = value; loadButton.disabled = value || committed; loadButton.classList.toggle('is-busy', value); if (applyButton) { applyButton.disabled = value || committed; applyButton.classList.toggle('is-busy', value); } };
  function renderPlan(conflict = false) {
    applyButton = plan.canApply === true && plan.changesCount > 0 ? button({ label: 'Подтвердить подготовку', onClick: () => applyPlan() }) : null;
    review.replaceChildren(
      conflict ? h('p', { class: 'hint' }, 'История изменилась. План перечитан; проверьте его и подтвердите заново. Подготовка автоматически не повторяется.') : null,
      h('p', { class: 'hint' }, 'Суммы и даты не изменятся; после подготовки можно уточнять статьи. Подготовка касается только этой истории оплат.'),
      readonlyGroup({ rows: [['Оплат в истории', plan.totals?.count ?? (plan.items || []).length], ['Общая сумма', plan.totals?.amount == null ? 'Нужна сверка' : money(plan.totals.amount)], ['Требуется подготовить', plan.changesCount]] }),
      plan.synthetic ? h('p', { class: 'hint' }, 'Полная оплата ранее была сохранена датой в документе. Она останется тем же фактом с прежними суммой и датой.') : null,
      table({ label: 'План подготовки истории оплат', columns: [{ label: 'Дата оплаты' }, { label: 'Сумма,₽', num: true }, { label: 'Способ' }], rows: (plan.items || []).map(item => ({ cells: [item.date ? date(item.date) : 'Дата требует сверки', item.amount == null ? 'Сумма требует сверки' : money(item.amount), item.method || 'Не указан'] })), empty: { title: 'В истории нет оплат для подготовки' } }),
      ...(plan.blockers || []).map(message => h('p', { class: 'hint' }, message)),
      actions(applyButton, !applyButton ? button({ label: 'Обновить операцию', kind: 'ghost', onClick: () => ctx.reload() }) : null),
    );
    loadButton.textContent = 'Обновить план';
  }
  async function readPlan(conflict = false) {
    if (busy || committed) return;
    setBusy(true); feedback.replaceChildren();
    try { plan = await api(url + 'identity-plan'); submitted = undefined; renderPlan(conflict); }
    catch (error) { feedback.replaceChildren(failBlock(error, () => readPlan(), { text: 'Не удалось прочитать историю оплат' })); }
    finally { setBusy(false); }
  }
  async function applyPlan() {
    if (busy || committed || !plan) return;
    if (!submitted) {
      setBusy(true);
      let confirmed;
      try { confirmed = await confirmDlg('Подготовить историю оплат?', 'Суммы, даты и число оплат не изменятся. После подготовки можно уточнять статьи.', { okText: 'Подготовить' }); } finally { setBusy(false); }
      if (!confirmed) return;
      const clientUid = globalThis.crypto?.randomUUID?.() || `income-history-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      try { submitted = Object.freeze(identityPreparationBody(plan, clientUid)); }
      catch (error) { feedback.replaceChildren(failBlock(error, () => readPlan(), { text: 'План нужно проверить заново' })); return; }
    }
    setBusy(true); feedback.replaceChildren();
    let conflict = false;
    try {
      let result;
      const write = async () => { result = await api(url + 'materialize', { noWait: true, method: 'POST', body: submitted }); };
      if (ctx.run) { if (!(await ctx.run(write))) return; } else await write();
      committed = true;
      const currentId = row.operationId || row.id;
      const nextId = result.identityMapping?.[currentId];
      ctx.changed?.();
      if (nextId && nextId !== currentId) patch({ of: 'moneyclassification', open: nextId, new: undefined });
      else if (nextId) await ctx.reload();
      else { review.replaceChildren(h('p', { class: 'hint' }, 'История подготовлена. Обновите список операций, чтобы открыть подготовленную оплату.'), button({ label: 'К операциям', onClick: () => patch({ view: 'operations', of: undefined, open: undefined }) })); }
    } catch (error) {
      if (committed) { feedback.replaceChildren(failBlock(error, () => ctx.reload(), { text: 'История подготовлена, но обновить показ не удалось. Повторить только чтение' })); return; }
      conflict = error.status === 409;
      if (!conflict) { if (applyButton) applyButton.textContent = 'Повторить подготовку'; feedback.replaceChildren(failBlock(error, () => applyPlan(), { text: 'Результат подготовки не подтверждён. Повтор сохранит то же подтверждение.' })); }
    } finally { setBusy(false); }
    if (conflict) await readPlan(true);
  }
  return section({ title: 'История оплат', open: true, body: [loadButton, review, feedback] });
}
