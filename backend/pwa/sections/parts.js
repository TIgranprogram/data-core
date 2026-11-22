import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { patch } from '../core/router.js';
import { sku as kitSku, stack } from '../ui/kit/index.js';
import { screenCard } from '../ui/kit/screens/card.js';
import { partWorkBlock } from './part-work.js';
import { buildCompForm, compositionPeek } from './comp-editor.js';
import { catalogPhotoBlock, catalogPhotoColumn, catalogWhereUsed } from './catalog-entry-blocks.js';

/*
 * «Детали» (C142): materials с materialKind=part.
 * Список — поиск, категория, карточка. Сервер сортирует по имени.
 * На карточке — заготовка (только сырьё) и виды работ.
 */

const canWrite = () => (['admin', 'manager'].includes(session.role) || session.user?.isOwner === true) && session.sees('parts');
const asList = (resp) => (Array.isArray(resp) ? resp : (resp?.items || []));
const categoryIdOf = (r) => String(r?.categoryId?.id || r?.categoryId?._id || r?.categoryId || '');
const categoryOptions = async (row) => {
  const options = asList(await api('/categories', { query: { type: 'material' } }))
    .map((c) => ({ value: String(c.id || c._id), label: c.name || c.fullPath || 'Категория' }));
  const id = categoryIdOf(row);
  if (id && !options.some((o) => o.value === id)) options.push({ value: id, label: catName(row) || 'Ранее выбранная категория' });
  return options;
};
const catName = (m) => {
  const c = m?.categoryId;
  if (c && typeof c === 'object') return c.name || c.fullPath || '';
  return m?.categoryName || '';
};

let blankId = null;

/** Правая панель заготовки: в деталь входит только сырьё. */
export const partBlank = {
  id: 'partblank',
  title: 'Заготовка детали',
  newTitle: 'Заготовка детали',
  noun: 'заготовка',
  entityType: 'Material',
  canEdit: canWrite,
  card: { heading: () => 'Заготовка' },
  form: {
    saveLabel: 'Готово',
    closeAfterCreate: true,
    build: () => {
      if (!blankId) throw new Error('Откройте деталь и нажмите «Изменить заготовку»');
      return buildCompForm({
        ownerId: blankId, base: '/materials', kindIds: [{ id: 'raw', label: 'Сырьё', lineType: 'material' }],
        intro: 'Заготовка — сырьё на одну деталь. Деталь, модуль и покупное сюда не входят.',
      });
    },
    toBody: (v) => v,
    create: async () => ({}),
  },
};

const openBlank = (row) => { blankId = row.id; patch({ of: 'partblank', new: '1', open: undefined }); };

export const parts = {
  id: 'parts',
  kind: 'Деталь',
  title: 'Детали',
  newTitle: 'Новая деталь',
  noun: 'деталь',
  entityType: 'Material',
  canEdit: canWrite,
  get: (id) => api(`/materials/${id}`),

  list: {
    path: '/materials',
    sortDefault: 'name',
    viewKey: 'parts',
    export: false,
    createLabel: 'Деталь',
    searchPlaceholder: 'Название или обозначение…',
    emptyText: 'Деталей пока нет.',
    emptyHint: 'Нажмите «+ Деталь»: название и обозначение. Это не «части» паспорта.',
    sidebar: true,
    limit: 50,
    query: () => ({ materialKind: 'part' }),
    filters: [
      { key: 'categoryId', label: 'Категория', allLabel: 'Все категории', type: 'select', options: async () => asList(await api('/categories', { query: { type: 'material' } }).catch(() => [])).map((c) => ({ value: String(c.id || c._id), label: c.name || c.fullPath || 'Категория' })) },
    ],
    columns: [
      catalogPhotoColumn,
      { key: 'article', label: 'Обозначение', cls: 'nowrap', render: (r) => kitSku(r.article) },
      { key: 'name', label: 'Название', cls: 'name-2', render: (r) => h('span', { title: r.name }, r.name || '') },
      { key: 'category', label: 'Категория', cls: 'md-hide', render: (r) => catName(r) },
      { key: 'unit', label: 'Ед.', cls: 'nowrap md-hide', render: (r) => r.unit || '' },
      { key: 'grade', label: 'Марка', cls: 'md-hide', render: (r) => r.materialGrade || '' },
    ],
    card: {
      title: (r) => r.name || 'Без имени',
      sub: (r) => [r.article, catName(r), r.unit].filter(Boolean).join(' · '),
      side: () => [],
    },
  },

  card: {
    ...screenCard({
      title: (r) => [kitSku(r.article), r.article ? ' ' : null, r.name],
      sub: (r) => 'Деталь',
      facts: (r) => [
        ['Обозначение', r.article],
        ['Категория', catName(r)],
        ['Единица', r.unit],
        ['Марка', r.materialGrade],
        ['Сортамент', r.assortment],
        ['Вес', r.weightKg ? `${r.weightKg} кг` : null],
      ],
      body: (r) => stack(
        catalogPhotoBlock(r),
        compositionPeek({
          id: r.id, base: '/materials', title: 'Заготовка', label: 'Показать заготовку',
          hintText: 'Сырьё, из которого делаем деталь. Правка — в меню «Изменить заготовку».',
          emptyHint: 'Заготовки нет. Добавьте сырьё кнопкой «Изменить заготовку».',
        }),
        catalogWhereUsed('/materials', r.id),
        partWorkBlock(r),
      ),
      menu: () => [
        canWrite() && { label: 'Изменить', title: 'Название и обозначение', run: (_row, ctx) => ctx.edit() },
        canWrite() && { label: 'Изменить заготовку', title: 'Какое сырьё и сколько на 1 деталь', run: (row) => openBlank(row) },
      ],
    }),
  },

  form: {
    fields: async (row) => [
      { key: 'name', label: 'Название', required: true, max: 256, wide: true },
      { key: 'article', label: 'Обозначение', required: true, max: 64 },
      { key: 'unit', label: 'Единица', required: true, max: 32 },
      { key: 'categoryId', label: 'Категория', type: 'select', choose: true, options: await categoryOptions(row) },
    ],
    initial: () => ({ unit: 'шт' }),
    toInitial: (r) => ({ name: r.name || '', article: r.article || '', unit: r.unit || 'шт', categoryId: categoryIdOf(r) }),
    toBody: (v, row) => {
      const name = String(v.name || '').trim();
      const article = String(v.article || '').trim();
      const unit = String(v.unit || '').trim();
      if (!name) throw new Error('Впишите название');
      if (!article) throw new Error('Впишите обозначение');
      if (!unit) throw new Error('Впишите единицу');
      const category = row && (v.categoryId || '') === categoryIdOf(row) ? {} : { categoryId: v.categoryId || null };
      return { name, article, unit, materialKind: 'part', ...category };
    },
    create: (body) => api('/materials', { method: 'POST', body }),
    update: (id, body) => api(`/materials/${id}`, { method: 'PATCH', body }),
  },
};
