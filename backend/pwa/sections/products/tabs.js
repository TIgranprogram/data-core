import { session } from '../../core/api.js';
import { h } from '../../core/dom.js';
import { stack, section } from '../../ui/kit/index.js';
import { productFilesBlock } from '../product-files.js';
import { productAttachmentsBlock } from '../product-attachments.js';
import { productRoute } from '../work-composition.js';
import { purchaseNeedsBlock } from './purchase-needs.js';
import { compositionBlock, passportPane, inOrders, variantsBlock, warnNote } from './card-blocks.js';
import { fillNext, gapsFor } from './fill-block.js';

/* Вкладки правой панели изделия (C055): Описание · Состав и работы · Техописание · Паспорт · Файлы · Заказы.
 * Техописание = состав для документов (materialsSpec); Паспорт = шаблон ГОСТ + выпущенные; Состав и работы = склад/себестоимость. */
const inline = (...kids) => stack(...kids.filter(Boolean));

function techSheetBlock(row) {
  const n = row.materialsSpec?.rows?.length || 0;
  const coat = row.materialsSpec?.coatingIds?.length || 0;
  const summary = n || coat ? `Строк: ${n}${coat ? ', покрытие' : ''}` : '';
  const body = [
    h('p', { class: 'muted' }, 'Части, материалы и размеры для печати техописания и паспорта. Складской «Состав и работы» — отдельно (себестоимость).'),
    h('p', null, summary
      ? h('span', null, summary, row.materialsText ? h('div', { class: 'hint' }, row.materialsText) : null)
      : h('span', { class: 'muted' }, 'Таблица ещё пуста — «⋯ → Техническое описание»: части и материалы выбираются из справочников.')),
  ];
  return section({ title: 'Техническое описание', tone: 'info', count: n || undefined, body });
}

/** Предупреждения и «Что дальше» изделия для шаблона «Карточка объекта»: пометка переноса каталога → заполнение (C114 H-UI, C118 W5). */
export const productWarns = (r, ctx) => [warnNote(r), fillNext(r, ctx)];

export function productTabs(r) {
  const techN = gapsFor(r, 'techsheet') ?? ((r.materialsSpec?.rows || []).length || undefined);
  const passN = gapsFor(r, 'passport');
  return [
    { key: 'comp', label: 'Состав и работы', count: (r.composition || []).length || undefined,
      blocks: (row) => inline(compositionBlock(row), session.sees('work') ? productRoute(row) : null, variantsBlock(row)) },
    { key: 'tech', label: 'Техописание', count: techN,
      blocks: (row) => inline(techSheetBlock(row), session.sees('products') ? purchaseNeedsBlock(row) : null) },
    { key: 'passport', label: 'Паспорт', count: passN,
      blocks: (row, ctx) => (session.seesDocs() ? passportPane(row, ctx) : h('p', { class: 'muted' }, 'Паспорта открыты разделу «Документация».')) },
    { key: 'files', label: 'Файлы', blocks: (row) => inline(session.sees('products') ? productAttachmentsBlock(row) : h('p', { class: 'muted' }, 'Вложения изделия (чертежи, документы) открыты разделу «Продукция» — попросите доступ у администратора.'), productFilesBlock(row, session.canEdit)) },
    { key: 'orders', label: 'Заказы', count: (r.orderLines || []).length || undefined, when: () => session.sees('salesorders'), blocks: (row) => inOrders(row) },
  ];
}
