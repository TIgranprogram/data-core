// C036 Ш7 (ЕН-2): заявка без позиции склада — выбрать позицию или создать её из самой заявки.
import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { button } from '../ui/kit/index.js';
import { toast, toastError } from '../ui/kit/toast.js';
import { withReason } from './admin-override.js';

/**
 * Поля формы для старой заявки без `materialId`: подсказка + «Создать позицию склада» и выбор из склада.
 * past — список подсказок заявки (pastItems), onLinked — сбросить его кэш.
 */
export function linkStockFields(r, { past, onLinked }) {
  return [
    r.title ? linkWidget(r, onLinked) : null,
    { key: '_pick', type: 'pick', load: async () => (await past()).filter((x) => x.stock), target: 'title', hint: 'Выберите позицию склада и сохраните — заявка свяжется с ней.' },
  ];
}

function linkWidget(r, onLinked) {
  return { key: '_stk_link', type: 'widget', label: 'Позиция склада', span: 3, widget: () => {
    const el = h('div', { class: 'rq-stock-ref' });
    const linkedView = (m) => el.replaceChildren(
      h('div', null, `Связана с позицией «${m.name || r.title}»`),
      h('a', { class: 'btn btn-ghost btn-sm', href: '#stock?open=' + m.id }, 'Открыть карточку позиции'));
    const short = String(r.title).length > 40 ? String(r.title).slice(0, 39).trimEnd() + '…' : String(r.title); // кнопка не переносится: длинное название режем
    const create = button({ label: `Создать позицию склада «${short}»`, title: `Создать позицию склада «${r.title}»`, size: 'S', onClick: async () => {
      create.disabled = true;
      try {
        // такое же наименование уже есть — сервер вернёт существующую позицию, дубль не появится
        const m = await api('/stock/items', { method: 'POST', body: { name: String(r.title).slice(0, 300), unit: r.unit || 'шт', ...(r.categoryName ? { categoryName: r.categoryName } : {}), ...(r.article ? { article: r.article } : {}) } });
        await withReason((reason) => api(`/supply/requests/${r.id}`, { method: 'PATCH', body: { materialId: m.id, ...(reason ? { reason } : {}) } }), 'Связать заявку по счёту с позицией склада');
        onLinked?.();
        linkedView(m);
        toast('Заявка связана с позицией склада');
      } catch (e) { create.disabled = false; toastError(e); }
    } });
    el.append(h('div', { class: 'hint' }, 'Заявка не связана со складом: приход не попадёт в остатки позиции. Выберите позицию ниже или создайте новую.'), create);
    return { el, get value() { return ''; }, set value(_) { /* только показ */ } };
  } };
}
