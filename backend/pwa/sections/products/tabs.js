import { session } from '../../core/api.js';
import { h } from '../../core/dom.js';
import { readonlyGroups, stack } from '../../ui/kit/index.js';
import { productFilesBlock } from '../product-files.js';
import { productAttachmentsBlock } from '../product-attachments.js';
import { productRoute } from '../work-composition.js';
import { grp, passportCatView, compositionBlock, passportsBlock, inOrders, variantsBlock } from './card-blocks.js';

/* Вкладки правой панели изделия (C052, эталон card.tabs): над ними — цена, изделие, характеристики (view) и кнопки в шапке.
 * Описание · Состав и работы · Паспорт · Файлы · Заказы. Содержимое вкладки строится при открытии. */
const inline = (...kids) => stack(...kids.filter(Boolean));

export function productTabs(r) {
  return [
    { key: 'desc', label: 'Описание', blocks: (row) => readonlyGroups([
      grp('Описание и материалы'),
      ['Материалы', row.materialsText || (row.materialsSpec ? null : h('span', { class: 'muted' }, 'таблица не заполнена — «Изменить» → «Описание и материалы»'))],
      ['Назначение', row.purpose], ['Монтаж', row.installation], ['Описание', row.description],
    ]) },
    { key: 'comp', label: 'Состав и работы', count: (r.composition || []).length || undefined,
      blocks: (row) => inline(compositionBlock(row), session.sees('work') ? productRoute(row) : null, variantsBlock(row)) },
    { key: 'passport', label: 'Паспорт', count: r.passports?.total || undefined,
      blocks: (row, ctx) => inline(
        readonlyGroups([
          grp('Паспорт'),
          ['Категория паспорта', passportCatView(row, ctx)],
          ['Гарантия', row.passportDefaults?.warrantyMonths ? `${row.passportDefaults.warrantyMonths} мес.` : null],
          ['Срок службы', row.passportDefaults?.serviceLifeYears ? `${row.passportDefaults.serviceLifeYears} лет` : null],
          ['Поставляется разобранным', row.passportDefaults?.isKit ? 'да' : null],
        ]),
        productFilesBlock(row, session.canEdit, 'passport'),
        session.seesDocs() ? passportsBlock(row) : null) },
    { key: 'files', label: 'Файлы', blocks: (row) => inline(session.sees('products') ? productAttachmentsBlock(row) : h('p', { class: 'muted' }, 'Вложения изделия (чертежи, документы) открыты разделу «Продукция» — попросите доступ у администратора.'), productFilesBlock(row, session.canEdit, 'drawings')) },
    { key: 'orders', label: 'Заказы', count: (r.orderLines || []).length || undefined, when: () => session.sees('salesorders'), blocks: (row) => inOrders(row) },
  ];
}
