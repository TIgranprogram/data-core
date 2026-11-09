import { session } from '../../core/api.js';
import { h } from '../../core/dom.js';
import { button as kitButton, readonlyGroups, stack, section } from '../../ui/kit/index.js';
import { jointsText } from '../passports/traits.js';
import { productFilesBlock } from '../product-files.js';
import { productAttachmentsBlock } from '../product-attachments.js';
import { productRoute } from '../work-composition.js';
import { openTechSheet } from '../tech-sheet.js';
import { grp, passportCatView, compositionBlock, passportsBlock, inOrders, variantsBlock } from './card-blocks.js';

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
      : h('span', { class: 'muted' }, 'Таблица ещё пуста — «Изменить» → блок «Описание и материалы» или кнопка ниже.')),
    kitButton({ label: 'Техническое описание (PDF)', kind: 'primary', size: 'S', title: 'Строки из состава изделия. Правки в окне — только для этого PDF.', onClick: () => openTechSheet(row) }),
  ];
  return section({ title: 'Техническое описание', tone: 'info', count: n || undefined, body });
}

export function productTabs(r) {
  const techN = (r.materialsSpec?.rows || []).length || undefined;
  return [
    { key: 'desc', label: 'Описание', blocks: (row) => readonlyGroups([
      grp('Описание'),
      ['Назначение', row.purpose], ['Монтаж', row.installation], ['Описание', row.description],
    ]) },
    { key: 'comp', label: 'Состав и работы', count: (r.composition || []).length || undefined,
      blocks: (row) => inline(compositionBlock(row), session.sees('work') ? productRoute(row) : null, variantsBlock(row)) },
    { key: 'tech', label: 'Техописание', count: techN,
      blocks: (row) => techSheetBlock(row) },
    { key: 'passport', label: 'Паспорт', count: r.passports?.total || undefined,
      blocks: (row, ctx) => inline(
        readonlyGroups([
          grp('Шаблон паспорта модели'),
          ['Категория паспорта', passportCatView(row, ctx)],
          ['Гарантия', row.passportDefaults?.warrantyMonths ? `${row.passportDefaults.warrantyMonths} мес.` : null],
          ['Срок службы', row.passportDefaults?.serviceLifeYears ? `${row.passportDefaults.serviceLifeYears} лет` : null],
          ['Как соединено', jointsText(row.passportDefaults?.joints) || null],
          ['Поставляется разобранным', row.passportDefaults?.isKit ? 'да' : null],
        ]),
        productFilesBlock(row, session.canEdit, 'passport'),
        session.seesDocs() ? passportsBlock(row) : null) },
    { key: 'files', label: 'Файлы', blocks: (row) => inline(session.sees('products') ? productAttachmentsBlock(row) : h('p', { class: 'muted' }, 'Вложения изделия (чертежи, документы) открыты разделу «Продукция» — попросите доступ у администратора.'), productFilesBlock(row, session.canEdit, 'drawings')) },
    { key: 'orders', label: 'Заказы', count: (r.orderLines || []).length || undefined, when: () => session.sees('salesorders'), blocks: (row) => inOrders(row) },
  ];
}
