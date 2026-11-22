/**
 * C142: раздел «Модули» (сборки). Список — эталон как продукция: поиск, категория, таблица.
 * GET /modules отдаёт массив: поиск и страницы режет list.normalize. Создание: название, обозначение, категория type=module.
 * Состав — панель of=modulecomp (воронка comp-editor).
 */
import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { patch } from '../core/router.js';
import { sku as kitSku, stack } from '../ui/kit/index.js';
import { screenCard } from '../ui/kit/screens/card.js';
import { buildCompForm, compositionPeek } from './comp-editor.js';
import { catalogPhotoBlock, catalogPhotoColumn, catalogWhereUsed } from './catalog-entry-blocks.js';

const canWrite = () => (['admin', 'manager'].includes(session.role) || session.user?.isOwner === true) && session.sees('modules');

const idOf = (v) => {
  if (!v) return '';
  if (typeof v === 'object') return String(v.id || v._id || '');
  return String(v);
};

const catOf = (r) => {
  const raw = r.categoryId;
  if (raw && typeof raw === 'object') return { id: idOf(raw), name: raw.name || raw.fullPath || '' };
  return { id: idOf(raw), name: r.categoryName || '' };
};

const asList = (resp) => (Array.isArray(resp) ? resp : (resp?.items || []));

/** Категории модулей (Category.type = module). Сервер отдаёт массив. */
async function catOptions() {
  return asList(await api('/categories', { query: { type: 'module' } }).catch(() => []))
    .map((c) => ({ value: idOf(c), label: c.name || c.fullPath || 'Категория' }))
    .filter((c) => c.value);
}

/** Поиск, категория и страницы на клиенте: у /modules нет {items,total}. */
function normalize(resp, q) {
  let items = asList(resp).map((r) => ({ ...r, id: idOf(r) }));
  const search = String(q.search || '').trim().toLowerCase();
  if (search) items = items.filter((r) => `${r.name || ''} ${r.article || ''} ${r.sku || ''} ${catOf(r).name}`.toLowerCase().includes(search));
  if (q.categoryId) items = items.filter((r) => catOf(r).id === String(q.categoryId));
  const key = String(q.sort || 'name').replace(/^-/, '');
  const desc = String(q.sort || '').startsWith('-');
  if (key === 'name' || key === 'article') {
    items.sort((a, b) => {
      const av = key === 'article' ? (a.article || '') : (a.name || '');
      const bv = key === 'article' ? (b.article || '') : (b.name || '');
      const c = String(av).localeCompare(String(bv), 'ru', { sensitivity: 'base' });
      return desc ? -c : c;
    });
  }
  const page = Math.max(1, Number(q.page) || 1);
  const limit = Math.max(1, Number(q.limit) || 50);
  const total = items.length;
  return { items: items.slice((page - 1) * limit, page * limit), total, page, limit };
}

let compId = null;

/** Правая панель состава модуля. Строки пишутся сразу, «Готово» закрывает панель. */
export const moduleComp = {
  id: 'modulecomp',
  title: 'Состав модуля',
  newTitle: 'Состав модуля',
  noun: 'состав',
  entityType: 'ProductModule',
  canEdit: canWrite,
  card: { heading: () => 'Состав' },
  form: {
    saveLabel: 'Готово',
    closeAfterCreate: true,
    build: () => {
      if (!compId) throw new Error('Откройте модуль и нажмите «Изменить состав»');
      return buildCompForm({
        ownerId: compId,
        base: '/modules',
        kindIds: [
          { id: 'part', label: 'Деталь', lineType: 'material' },
          { id: 'module', label: 'Модуль', lineType: 'module' },
          { id: 'purchased', label: 'Покупное', lineType: 'material' },
          { id: 'raw', label: 'Сырьё', lineType: 'material' },
        ],
        intro: 'В модуль входят детали, вложенные модули, покупное и сырьё. Изделие сюда не входит.',
      });
    },
    toBody: (v) => v,
    create: async () => ({}),
  },
};

const openComp = (row) => { compId = row.id; patch({ of: 'modulecomp', new: '1', open: undefined }); };

export const modules = {
  id: 'modules',
  kind: 'Модуль',
  title: 'Модули',
  newTitle: 'Новый модуль',
  noun: 'модуль',
  entityType: 'ProductModule',
  canEdit: canWrite,
  get: (id) => api(`/modules/${id}`),

  list: {
    path: '/modules',
    normalize,
    sortDefault: 'name',
    viewKey: 'modules',
    export: false,
    createLabel: 'Модуль',
    searchPlaceholder: 'Название или обозначение…',
    emptyText: 'Модулей пока нет.',
    emptyHint: 'Нажмите «+ Модуль»: название, обозначение и категория. Это сборка из деталей.',
    sidebar: true,
    limit: 50,
    filters: [
      { key: 'categoryId', label: 'Категория', allLabel: 'Все категории', options: catOptions },
    ],
    columns: [
      catalogPhotoColumn,
      { key: 'article', label: 'Обозначение', sort: 'article', cls: 'nowrap', render: (r) => kitSku(r.article) },
      { key: 'name', label: 'Название', sort: 'name', cls: 'name-2', render: (r) => h('span', { title: r.name }, r.name || '') },
      { key: 'category', label: 'Категория', cls: 'md-hide', render: (r) => catOf(r).name },
    ],
    card: {
      title: (r) => r.name || 'Без имени',
      sub: (r) => [r.article, catOf(r).name].filter(Boolean).join(' · '),
      side: () => [],
    },
  },

  card: {
    ...screenCard({
      title: (r) => [kitSku(r.article), r.article ? ' ' : null, r.name],
      sub: () => 'Модуль (сборка)',
      facts: (r) => [
        ['Обозначение', r.article],
        ['Категория', catOf(r).name],
        ['Вес', r.weight != null && r.weight !== '' ? `${r.weight} кг` : null],
      ],
      body: (r) => stack(
        catalogPhotoBlock(r),
        compositionPeek({
          id: r.id, base: '/modules', title: 'Состав', label: 'Показать состав',
          hintText: 'Детали, вложенные модули, покупное и сырьё. Правка — в меню «Изменить состав».',
        }),
        catalogWhereUsed('/modules', r.id),
      ),
      menu: () => [
        canWrite() && { label: 'Изменить', title: 'Название, обозначение и категория', run: (_row, ctx) => ctx.edit() },
        canWrite() && { label: 'Изменить состав', title: 'Что входит в сборку и сколько на 1 шт', run: (row) => openComp(row) },
      ],
    }),
  },

  form: {
    fields: async () => {
      const cats = await catOptions();
      return [
        cats.length ? null : { note: h('span', null, 'Добавьте категорию модуля: ', h('a', { href: '#dicts?d=moduleCategories' }, 'Справочники → Категории модулей')) },
        { key: 'name', label: 'Название', required: true, max: 200, wide: true },
        { key: 'article', label: 'Обозначение', required: true, max: 64 },
        { key: 'categoryId', label: 'Категория', type: 'select', required: true, choose: true, options: cats },
        { key: 'weight', label: 'Вес, кг', type: 'number', min: 0 },
      ];
    },
    toInitial: (r) => ({ name: r.name || '', article: r.article || '', categoryId: catOf(r).id, weight: r.weight ?? '' }),
    toBody: (v) => {
      const name = String(v.name || '').trim();
      const article = String(v.article || '').trim();
      const categoryId = String(v.categoryId || '').trim();
      if (!name) throw new Error('Впишите название');
      if (!article) throw new Error('Впишите обозначение');
      if (!categoryId) throw new Error('Выберите категорию модуля');
      const body = { name, article, categoryId };
      const raw = String(v.weight ?? '').trim();
      if (raw) {
        const weight = Number(raw.replace(',', '.'));
        if (!(weight >= 0)) throw new Error('Вес — число не меньше нуля');
        body.weight = weight;
      }
      return body;
    },
    create: (body) => api('/modules', { method: 'POST', body }),
    update: (id, body) => api(`/modules/${id}`, { method: 'PATCH', body }),
  },
};
