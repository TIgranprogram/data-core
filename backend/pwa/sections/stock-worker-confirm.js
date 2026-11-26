import { h } from '../core/dom.js';
import { qty } from '../core/format.js';
import { button, toolbar, failBlock } from '../ui/kit/index.js';
import { gridField } from './stock-grid-input.js';
import { workerMaterialId, workerUnit } from './stock-worker-model.js';

/** C270: черновик и expected принадлежат началу правки, а не последнему GET. */
export function workerConfirmation(save, refresh, counterpart = null) {
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
        binding.input.value = String(binding.item.quantity ?? 0); paint(); binding.input.focus();
      };
      const commit = async (transfer = null) => {
        if (record.saving || destroyed) return;
        record.saving = true; record.error = null; paint();
        try {
          await save(record.snapshot, record.value, transfer);
          if (destroyed) return;
          const current = fields.get(id);
          drafts.delete(id); if (pending === record) pending = null;
          if (transfer) { paint(); refresh(); return; }
          if (current) {
            current.item.quantity = Number(record.value.replace(',', '.'));
            current.item.free = current.item.quantity - Number(current.item.reservedQty || 0);
            current.input.disabled = false; current.input.value = String(current.item.quantity); current.input.dataset.saved = '1';
            current.afterSave();
            if (document.activeElement === document.body || current.box.contains(document.activeElement) || document.activeElement === current.input) current.input.focus({ preventScroll: true });
          }
        } catch (error) { if (!destroyed) record.error = error; }
        finally { record.saving = false; if (!destroyed) paint(); }
      };
      const other = counterpart?.(record.snapshot);
      const next = Number(String(record.value).replace(',', '.'));
      const delta = Number.isFinite(next) ? next - Number(record.snapshot.quantity ?? 0) : 0;
      const move = other && delta > 0 && Number(other.quantity) > 0 ? Math.min(delta, Number(other.quantity)) : 0;
      const transfer = move > 0 ? { materialId: workerMaterialId(other), qty: move, expected: Number(other.quantity) } : null;
      const panel = h('div', { class: 'pg-worker-confirm', 'data-worker-count-confirm': id, role: 'group', 'aria-label': 'Подтвердить количество' },
        h('strong', null, `${qty(record.snapshot.quantity)} → ${record.value} ${workerUnit(record.snapshot)}`),
        toolbar(button({ label: record.saving ? 'Сохраняю…' : 'Сохранить', kind: 'primary', disabled: record.saving, onClick: () => commit() }),
          transfer ? button({ label: `Списать ${qty(move)} ${workerUnit(record.snapshot)} с «Не мытая»`, title: `В «Не мытая» останется ${qty(transfer.expected - move)} ${workerUnit(record.snapshot)}`, kind: 'ghost', disabled: record.saving, onClick: () => commit(transfer) }) : null,
          button({ label: 'Отмена', disabled: record.saving, onClick: cancel })), record.error ? failBlock(record.error, () => commit()) : null,
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
        } else draft.value = input.value.trim();
        if (pending === draft) paint();
        return draft;
      };
      const input = gridField('pg-in', `Фактически, ${item.name}, ${workerUnit(item)}`, String(item.quantity ?? 0), () => {}, false, {
        input: remember,
        review(node) {
          if (pending?.saving) return;
          const draft = drafts.get(id);
          if (!draft && node.value.trim() === String(item.quantity ?? 0)) return false;
          const record = draft || remember(node);
          if (record.value === String(record.snapshot.quantity ?? 0)) { drafts.delete(id); if (pending === record) pending = null; paint(); return false; }
          if (pending !== record) { pending = record; paint(); } return true;
        },
        cancel(node) { if (pending?.saving) return; drafts.delete(id); if (pending?.id === id) pending = null; node.value = String(item.quantity ?? 0); paint(); },
      });
      input.dataset.workerKey = id + ':count';
      if (drafts.has(id)) input.value = drafts.get(id).value;
      fields.set(id, { item, input, box, afterSave }); paint();
      return { input, box };
    },
    begin() { fields.clear(); },
    destroy() { destroyed = true; drafts.clear(); fields.clear(); pending = null; },
  };
}
