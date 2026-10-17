import { Injectable } from '@nestjs/common';
import { ProductSchema } from '../product/product.schema';

/**
 * One addressable data source in the Document Constructor picker.
 * `key` must match the suffix in BuildDocumentDto (`organizationId` →
 * source `'organization'`, etc). Russian `label` is rendered in the tool pane.
 *
 * Why hardcoded (not DB-stored)? Microsoft-Word-toolbox pattern:
 * - Backend owns the truth about which entities have which fields.
 * - Frontend dropdowns build from this registry — adding a new entity
 *   to the registry automatically surfaces it in the picker, without
 *   redeploying frontend.
 * - Future extensibility (TZ-87): migrate to a Mongo-admin-managed
 *   registry IF the 8 sources grow to 15+; for MVP 8 entries hardcoded
 *   are cleaner than CRUD overhead.
 */
export interface DataSourceDescriptor {
  key: string;
  label: string;
  /** Frontend grouping for collapsible tool-pane tab. */
  group: 'contacts' | 'catalog' | 'work';
  fields: FieldDescriptor[];
}

/**
 * One field on a data source, addressable by `dataBinding.field: 'name'`.
 * `type` chooses the renderer for that field in the canvas preview:
 * - text     → plain string
 * - number   → Intl-compatible numeric (no currency)
 * - currency → Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' })
 * - date     → toLocaleDateString('ru-RU')
 * - bool     → 'Да' | 'Нет'
 */
export type FieldType = 'text' | 'number' | 'currency' | 'date' | 'bool';

export interface FieldDescriptor {
  key: string;
  label: string;
  type: FieldType;
}

export interface SchemaPathSource {
  paths: Record<string, { instance: string; schema?: SchemaPathSource }>;
}

const PRODUCT_FIELD_LABELS: Record<string, string> = {
  name: 'Наименование',
  sku: 'Артикул (SKU)',
  kind: 'Вид (товар/услуга/работа)',
  unit: 'Единица измерения',
  subcategory: 'Подкатегория',
  status: 'Статус',
  listPrice: 'Прайсовая цена',
  basePrice: 'Базовая цена',
  costPrice: 'Себестоимость',
  defaultMarkupPercent: 'Наценка по умолчанию, %',
  stockQty: 'Остаток на складе',
  description: 'Описание',
  notes: 'Примечания',
  photoIds: 'Фото (ID/URL)',
  dimensions: 'Габариты',
  'dimensions.length': 'Длина',
  'dimensions.width': 'Ширина',
  'dimensions.height': 'Высота',
  'dimensions.unit': 'Единица габаритов',
  weightKg: 'Масса, кг',
  ralCode: 'Код RAL',
  hasPassport: 'Есть паспорт',
  hasDrawing: 'Есть чертёж',
  purpose: 'Назначение',
  installation: 'Монтаж',
  isActive: 'Активен',
};

const PRODUCT_FIELD_DENY = new Set([
  '_id',
  '__v',
  'categoryId',
  'copiedFromProductId',
  'composition',
  'createdAt',
  'deletedAt',
  'dimensions',
  'isSystem',
  'organizationId',
  'productModuleIds',
  'updatedAt',
]);

const PRODUCT_CURRENCY_FIELDS = new Set([
  'basePrice',
  'costPrice',
  'listPrice',
]);

function humanizeKey(key: string): string {
  return key
    .split('.')
    .map((part) => part.replace(/([a-z])([A-Z])/g, '$1 $2'))
    .join(' / ')
    .replace(/^./, (char) => char.toUpperCase());
}

export function buildFieldsFromSchema(
  schema: SchemaPathSource,
  prefix = '',
): FieldDescriptor[] {
  return Object.entries(schema.paths).flatMap(([pathKey, path]) => {
    const key = prefix ? `${prefix}.${pathKey}` : pathKey;
    if (path.schema) return buildFieldsFromSchema(path.schema, key);
    if (PRODUCT_FIELD_DENY.has(key)) return [];
    if (key === 'photoIds') {
      return [{ key, label: PRODUCT_FIELD_LABELS[key], type: 'text' }];
    }
    if (!['String', 'Number', 'Boolean', 'Date'].includes(path.instance))
      return [];

    const type: FieldType =
      path.instance === 'Number'
        ? PRODUCT_CURRENCY_FIELDS.has(key)
          ? 'currency'
          : 'number'
        : path.instance === 'Boolean'
          ? 'bool'
          : path.instance === 'Date'
            ? 'date'
            : 'text';
    return [
      { key, label: PRODUCT_FIELD_LABELS[key] ?? humanizeKey(key), type },
    ];
  });
}

@Injectable()
export class RegistryService {
  /**
   * Returns the full catalogue of data sources available to the
   * Document Constructor. The response shape (`{ sources: [...] }`)
   * is intentionally minimal and stable; new fields can be added
   * to descriptors without breaking consumers.
   */
  getDataSources(): { sources: DataSourceDescriptor[] } {
    return { sources: DATA_SOURCES };
  }
}

/**
 * Single source of truth for the entity types supported by
 * DocumentBuilder.build() (TZ-86 Фаза A.4 + TZ-ORG-ASSETS-302). Adding/changing
 * a field here ripples to the entire Document Builder UI.
 */
const DATA_SOURCES: DataSourceDescriptor[] = [
  {
    key: 'organization',
    label: 'Наша фирма',
    group: 'contacts',
    fields: [
      { key: 'name', label: 'Наименование', type: 'text' },
      { key: 'shortName', label: 'Краткое наименование', type: 'text' },
      { key: 'inn', label: 'ИНН', type: 'text' },
      { key: 'kpp', label: 'КПП', type: 'text' },
      { key: 'ogrn', label: 'ОГРН', type: 'text' },
      { key: 'ogrnip', label: 'ОГРНИП', type: 'text' },
      {
        key: 'legalForm',
        label: 'Организационно-правовая форма',
        type: 'text',
      },
      { key: 'legalAddress', label: 'Юридический адрес', type: 'text' },
      { key: 'legalType', label: 'Тип (ООО/ИП/ПАО/АО)', type: 'text' },
      { key: 'bankName', label: 'Наименование банка', type: 'text' },
      { key: 'bankBik', label: 'БИК', type: 'text' },
      { key: 'bankAccount', label: 'Расчётный счёт', type: 'text' },
      { key: 'bankCorrAccount', label: 'Корр. счёт', type: 'text' },
      { key: 'signerName', label: 'Подписант (ФИО)', type: 'text' },
      { key: 'signerPosition', label: 'Должность подписанта', type: 'text' },
      { key: 'directorName', label: 'Директор', type: 'text' },
      { key: 'website', label: 'Сайт', type: 'text' },
      { key: 'logoUrl', label: 'Логотип (слот документа)', type: 'text' },
      { key: 'sealUrl', label: 'Печать (слот документа)', type: 'text' },
      { key: 'signatureUrl', label: 'Подпись (слот документа)', type: 'text' },
      { key: 'vatRate', label: 'Ставка НДС, %', type: 'number' },
      { key: 'paymentTermDays', label: 'Срок оплаты, дн.', type: 'number' },
    ],
  },
  {
    key: 'counterparty',
    label: 'Клиент',
    group: 'contacts',
    fields: [
      { key: 'name', label: 'Наименование', type: 'text' },
      { key: 'shortName', label: 'Краткое наименование', type: 'text' },
      { key: 'inn', label: 'ИНН', type: 'text' },
      { key: 'kpp', label: 'КПП', type: 'text' },
      { key: 'ogrn', label: 'ОГРН', type: 'text' },
      {
        key: 'legalForm',
        label: 'Организационно-правовая форма',
        type: 'text',
      },
      { key: 'bankName', label: 'Наименование банка', type: 'text' },
      { key: 'bankBik', label: 'БИК', type: 'text' },
      { key: 'bankAccount', label: 'Расчётный счёт', type: 'text' },
      { key: 'bankCorrAccount', label: 'Корр. счёт', type: 'text' },
      { key: 'directorName', label: 'Директор', type: 'text' },
      { key: 'siteAddress', label: 'Адрес объекта', type: 'text' },
      { key: 'siteName', label: 'Объект', type: 'text' },
      { key: 'contactName', label: 'Контакт (ФИО)', type: 'text' },
      { key: 'contactPosition', label: 'Должность контакта', type: 'text' },
    ],
  },
  {
    key: 'quotation',
    label: 'КП',
    group: 'contacts',
    fields: [
      { key: 'number', label: 'Номер КП', type: 'text' },
      { key: 'title', label: 'Название', type: 'text' },
      { key: 'date', label: 'Дата', type: 'date' },
      { key: 'validUntil', label: 'Действительно до', type: 'date' },
      { key: 'total', label: 'Итого', type: 'currency' },
      { key: 'notes', label: 'Примечания', type: 'text' },
    ],
  },
  {
    key: 'order',
    label: 'Заказ',
    group: 'contacts',
    fields: [
      { key: 'number', label: 'Номер заказа', type: 'text' },
      { key: 'date', label: 'Дата заказа', type: 'date' },
      { key: 'plannedDate', label: 'Плановая дата', type: 'date' },
      { key: 'status', label: 'Статус', type: 'text' },
      { key: 'total', label: 'Сумма заказа', type: 'currency' },
      { key: 'priority', label: 'Приоритет', type: 'text' },
      { key: 'deliveryAddress', label: 'Адрес доставки', type: 'text' },
      { key: 'notes', label: 'Примечания', type: 'text' },
    ],
  },
  {
    key: 'invoice',
    label: 'Счёт',
    group: 'contacts',
    fields: [
      { key: 'number', label: 'Номер счёта', type: 'text' },
      { key: 'invoiceDate', label: 'Дата счёта', type: 'date' },
      { key: 'dueDate', label: 'Срок оплаты', type: 'date' },
      { key: 'totalAmount', label: 'Сумма', type: 'currency' },
      { key: 'paidAmount', label: 'Оплачено', type: 'currency' },
      { key: 'notes', label: 'Примечания', type: 'text' },
    ],
  },
  {
    key: 'product',
    label: 'Продукция',
    group: 'catalog',
    fields: buildFieldsFromSchema(ProductSchema),
  },
  {
    key: 'material',
    label: 'Материал',
    group: 'catalog',
    fields: [
      { key: 'name', label: 'Наименование', type: 'text' },
      { key: 'article', label: 'Артикул', type: 'text' },
      { key: 'sku', label: 'SKU', type: 'text' },
      { key: 'unit', label: 'Единица измерения', type: 'text' },
      { key: 'description', label: 'Описание', type: 'text' },
      { key: 'pricePerUnit', label: 'Цена за единицу', type: 'currency' },
      { key: 'stockQty', label: 'Остаток на складе', type: 'number' },
    ],
  },
  {
    key: 'work-type',
    label: 'Вид работ',
    group: 'work',
    fields: [
      { key: 'name', label: 'Наименование', type: 'text' },
      { key: 'section', label: 'Раздел', type: 'text' },
      { key: 'department', label: 'Подразделение', type: 'text' },
      { key: 'description', label: 'Описание', type: 'text' },
      { key: 'hourlyRate', label: 'Часовая ставка, ₽', type: 'currency' },
      {
        key: 'defaultDurationHours',
        label: 'Нормативная длительность, ч',
        type: 'number',
      },
      { key: 'isActive', label: 'Активен', type: 'bool' },
    ],
  },
];
