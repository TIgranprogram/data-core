import { h } from '../core/dom.js';
import { qty } from '../core/format.js';
import { button, toolbar, failBlock } from '../ui/kit/index.js';
import { gridField } from './stock-grid-input.js';
import { workerInputQuantity, workerLength, workerMaterialId, workerPipeMetres, workerPipePieces, workerPipeTransfer, workerQuantityText, workerUnit } from './stock-worker-model.js';

/** C270: черновик и expected принадлежат началу правки, а не последнему GET. */
export function workerConfirmation(save, refresh, counterpart = null, kind) {
  const drafts = new Map(), fields = new Map();
  let pending = null, destroyed = false;
  const paint = () => {
    for (const [id, binding] of fields) {
      binding.input.disabled = pending?.id === id && pending.saving;
      binding.box.replaceChildren();
      if (pending?.id !== id) continue;
      const record = pending;
      const cancel = () => {
        if (record.saving) return;
        drafts.delete(id); pending = null;
        binding.input.value = workerQuantityText(binding.item, kind); paint(); binding.input.focus();
      };
      let next, inputError;
      try { next = workerInputQuantity(record.snapshot, record.value, kind); } catch (error) { inputError = error; }
      const commit = async (transfer = null) => {
        if (record.saving || destroyed || inputError) return;
        record.saving = true; record.error = null; record.transfer = transfer; paint();
        try {
          await save(record.snapshot, record.value, transfer);
          if (destroyed) return;
          const current = fields.get(id);
          drafts.delete(id); if (pending === record) pending = null;
          if (transfer) { paint(); refresh(); return; }
          if (current) {
            current.item.quantity = next;
            current.item.free = current.item.quantity - Number(current.item.reservedQty || 0);
            current.input.disabled = false; current.input.value = workerQuantityText(current.item, kind); current.input.dataset.saved = '1';
            current.afterSave();
            if (document.activeElement === document.body || current.box.contains(document.activeElement) || document.activeElement === current.input) current.input.focus({ preventScroll: true });
          }
        } catch (error) { if (!destroyed) record.error = error; }
        finally { record.saving = false; if (!destroyed) paint(); }
      };
      const other = kind === 'pipe' && !inputError ? counterpart?.(record.snapshot) : null;
      const transfer = workerPipeTransfer(record.snapshot, next, other);
      const unit = workerUnit(record.snapshot);
      const previous = workerPipePieces(record.snapshot), beforeMetres = workerPipeMetres(record.snapshot);
      const afterMetres = workerPipeMetres({ ...record.snapshot, quantity: next });
      const before = previous == null ? `${qty(record.snapshot.quantity)} ${unit}`
        : `${qty(previous)} шт${beforeMetres == null ? '' : ` (${qty(beforeMetres)} м)`}`;
      const after = `${qty(Number(record.value))} шт${afterMetres == null ? '' : ` × ${qty(workerLength(record.snapshot) / 1000)} м = ${qty(afterMetres)} м`}`;
      const panel = h('div', { class: 'pg-worker-confirm', 'data-worker-count-confirm': id, role: 'group', 'aria-label': 'Подтвердить количество' },
        inputError ? h('p', { class: 'hint', role: 'status' }, inputError.message)
          : h('strong', null, kind === 'pipe' ? `${before} → ${after}` : `${qty(record.snapshot.quantity)} → ${record.value} ${unit}`),
        toolbar(button({ label: record.saving ? 'Сохраняю…' : 'Сохранить', kind: 'primary', disabled: record.saving || Boolean(inputError), onClick: () => commit() }),
          transfer ? button({ label: `Списать ${qty(transfer.pieces)} шт с «Не мытая»`, title: `В «Не мытая» останется ${qty(transfer.expected - transfer.qty)} ${workerUnit(other)}`, kind: 'ghost', disabled: record.saving, onClick: () => commit(transfer) }) : null,
          button({ label: 'Отмена', disabled: record.saving, onClick: cancel })), record.error ? failBlock(record.error, () => commit(record.transfer)) : null,
        record.error?.status === 409 ? button({ label: 'Обновить остаток', onClick: () => { if (!record.saving) { drafts.delete(id); pending = null; paint(); refresh(); } } }) : null);
      panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); cancel(); } });
      binding.box.append(panel);
    }
  };
  return {
    quantityField(item, afterSave) {
      const id = workerMaterialId(item), box = h('div');
      const remember = input => {
        let draft = drafts.get(id);
        if (!draft) {
          draft = { id, snapshot: { ...item }, value: input.value.trim(), saving: false };
          drafts.set(id, draft);
        } else { draft.value = input.value.trim(); draft.error = null; }
        if (pending === draft) paint();
        return draft;
      };
      const input = gridField('pg-in', `Фактически, ${item.name}, ${kind === 'pipe' ? 'шт' : workerUnit(item)}`, workerQuantityText(item, kind), () => {}, false, {
        input: remember,
        review(node) {
          if (pending?.saving) return;
          const draft = drafts.get(id);
          if (!draft && node.value.trim() === workerQuantityText(item, kind)) return false;
          const record = draft || remember(node);
          if (record.value === workerQuantityText(record.snapshot, kind)) { drafts.delete(id); if (pending === record) pending = null; paint(); return false; }
          if (pending !== record) { pending = record; paint(); } return true;
        },
        cancel(node) { if (pending?.saving) return; drafts.delete(id); if (pending?.id === id) pending = null; node.value = workerQuantityText(item, kind); paint(); },
      });
      if (kind === 'pipe') { input.inputMode = 'numeric'; input.placeholder = 'шт'; }
      input.dataset.workerKey = id + ':count';
      if (drafts.has(id)) input.value = drafts.get(id).value;
      fields.set(id, { item, input, box, afterSave }); paint();
      return { input, box };
    },
    begin() { fields.clear(); },
    destroy() { destroyed = true; drafts.clear(); fields.clear(); pending = null; },
  };
}
