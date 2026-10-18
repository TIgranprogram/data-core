import {
  BadRequestException,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuditAction } from '../../common/interceptors/audit.interceptor';
import { parseMongoCollectionName } from '../app-data/app-data.validation';

/**
 * Data Core — «справочник таблиц» (админ-only).
 *
 * GET /api/admin/collections          — список коллекций (имя, счётчик, ключевые поля)
 * GET /api/admin/collections/:name    — расшифровка одной: поля, типы, примеры, заполненность
 *
 * Зачем: админка показывает структуру БД «как есть» (реальные имена коллекций и
 * полей), чтобы интеграции и агенты видели контракт без доступа к Mongo.
 *
 * Читаем сырые коллекции через драйвер (без Mongoose-моделей и их soft-delete
 * плагина) — нужна реальная структура данных, включая служебные поля.
 */

/** Жёсткие лимиты, чтобы широкая/большая коллекция не раздула ответ. */
const LIST_SAMPLE = 15;
const DETAIL_SAMPLE_DEFAULT = 100;
const DETAIL_SAMPLE_MAX = 1000;
const MAX_FIELDS = 400;
const MAX_KEY_FIELDS = 10;
const MAX_EXAMPLE_LEN = 120;
const MAX_DEPTH = 8;

interface FieldStat {
  path: string;
  types: string[];
  example: unknown;
  present: number;
  /** 0..1 — доля семпла, где поле встречается. */
  completeness: number;
}

/** Категории справочника таблиц (порядок отображения в админке). */
interface CategoryDef {
  id: string;
  label: string;
  /** true — остатки удалённого домена: модульного кода нет, кандидат на удаление. */
  legacy?: boolean;
}

const CATEGORIES: CategoryDef[] = [
  { id: 'access', label: 'Доступ и безопасность' },
  { id: 'system', label: 'Служебные и системные' },
  { id: 'orgs', label: 'Организации, контрагенты и люди' },
  { id: 'classifiers', label: 'Классификаторы и справочники' },
  { id: 'catalog', label: 'Каталог: материалы и изделия' },
  { id: 'links', label: 'Связевые и вложенные (несамостоятельные)' },
  { id: 'apps', label: 'Данные приложений' },
  { id: 'legacy-docs', label: 'Остатки: документооборот (код удалён)', legacy: true },
  { id: 'legacy-sales', label: 'Остатки: продажи, сделки и закупки (код удалён)', legacy: true },
  { id: 'legacy-prod', label: 'Остатки: производство (код удалён)', legacy: true },
  { id: 'legacy-wh', label: 'Остатки: склад и инвентарь (код удалён)', legacy: true },
  { id: 'legacy-misc', label: 'Остатки: прочее (код удалён)', legacy: true },
  { id: 'unknown', label: 'Не классифицировано' },
];

/**
 * Тип таблицы — прямая подсказка для решения «оставить / удалить»:
 *   core   — действующая самостоятельная (за ней стоит модуль, код есть)
 *   link   — действующая связевая/вложенная: создаётся из нескольких таблиц,
 *            сама по себе не самостоятельна (вложена в core-домен)
 *   legacy — остаток удалённого домена: модуль удалён при чистке H,
 *            таблица — кандидат на удаление
 *   app    — данные приложения из /api/apps (P1): коллекции app_<app>_<collection>
 *            создаются клиентами на лету, в реестре не описываются
 */
type CollectionKind = 'core' | 'link' | 'legacy' | 'app';

interface CollectionMeta {
  category: string;
  kind: CollectionKind;
  /** Короткое описание по-русски: что это за таблица. */
  doc: string;
}

/**
 * Полный реестр всех коллекций БД: русское описание + категория + тип.
 *
 * `core`/`link` (42 шт.) соответствуют 36 схемам действующих модулей (см.
 * grep `collection:` в *.schema.ts); `legacy` (49 шт.) — коллекции, чьи модули
 * удалены при чистке H (см. docs/CHECKLIST.md), в коде не создаются и не пишутся.
 * Часть `legacy` всё ещё читается в проверках удаления (409) — см. пометку в doc.
 */
const COLLECTIONS: Record<string, CollectionMeta> = {
  // ================= Доступ и безопасность =================
  users: { category: 'access', kind: 'core', doc: 'Пользователи: логин, хеш пароля, роль, isActive. Хеш пароля не покидает API.' },
  roles: { category: 'access', kind: 'core', doc: 'Роли доступа (admin / manager / user) и назначенные им права.' },
  permissions: { category: 'access', kind: 'core', doc: 'Справочник прав, которые раздаются ролям и пользователям.' },
  featureflags: { category: 'access', kind: 'core', doc: 'Переключатели функций платформы (feature flags).' },
  rate_limit_entries: { category: 'access', kind: 'core', doc: 'Счётчики rate-limiting по IP / пользователю (защита API от перебора).' },
  desktop_pairing_keys: { category: 'access', kind: 'core', doc: 'Машинные API-ключи kppd_… На сервере только хеш; есть TTL и отзыв.' },
  browserdevicegrants: { category: 'access', kind: 'core', doc: 'Гранты браузерных устройств: какой браузер допущен к каким данным.' },
  deviceinvites: { category: 'access', kind: 'core', doc: 'Приглашения устройств для парной авторизации (pairing owner-инвайты).' },

  // ================= Служебные и системные =================
  settings: { category: 'system', kind: 'core', doc: 'Служебные настройки системы (ключ → значение).' },
  counters: { category: 'system', kind: 'core', doc: 'Транзакционные счётчики порядковых номеров документов (rs0).' },
  auditlogs: { category: 'system', kind: 'core', doc: 'Журнал аудита: кто и что изменил (action, entityType, снапшот до/после).' },
  idempotency_records: { category: 'system', kind: 'core', doc: 'Записи идемпотентности: повторный запрос возвращает тот же ответ.' },
  entitystatuses: { category: 'system', kind: 'core', doc: 'Текущий статус каждой сущности (заказ, продукт, контрагент…).' },
  statusworkflows: { category: 'system', kind: 'core', doc: 'Граф переходов статусов: из какого статуса в какой можно перейти.' },

  // ================= Организации, контрагенты и люди =================
  organizations: { category: 'orgs', kind: 'core', doc: 'Организации (компании): юр.-данные и реквизиты.' },
  persons: { category: 'orgs', kind: 'core', doc: 'Люди / контакты: ФИО, телефоны, email.' },
  counterparties: { category: 'orgs', kind: 'core', doc: 'Контрагенты — клиенты и поставщики.' },
  sites: { category: 'orgs', kind: 'core', doc: 'Площадки и адреса организаций.' },

  // ================= Классификаторы и справочники =================
  categories: { category: 'classifiers', kind: 'core', doc: 'Иерархия категорий (дерево) для классификации материалов и продукции.' },
  units: { category: 'classifiers', kind: 'core', doc: 'Единицы измерения (шт, кг, м…).' },
  currencies: { category: 'classifiers', kind: 'core', doc: 'Валюты и их курсы.' },
  color_references: { category: 'classifiers', kind: 'core', doc: 'Справочник цветов (цветовая палитра материалов).' },
  dictionary_labels: { category: 'classifiers', kind: 'core', doc: 'Метки и подписи справочников (локализация значений).' },
  worktypes: { category: 'classifiers', kind: 'core', doc: 'Виды работ — канонический справочник каталога (нужен продуктам/модулям).' },
  attributedefinitions: { category: 'classifiers', kind: 'core', doc: 'Определения атрибутов: структура дополнительных полей сущностей.' },

  // ================= Каталог: материалы и изделия =================
  materials: { category: 'catalog', kind: 'core', doc: 'Материалы: номенклатура, свойства, единицы измерения.' },
  products: { category: 'catalog', kind: 'core', doc: 'Продукция: карточки изделий каталога.' },
  productmodules: { category: 'catalog', kind: 'core', doc: 'Модули / комплектующие продукции (состав изделия).' },
  productpassports: { category: 'catalog', kind: 'core', doc: 'Паспорта изделий (технические характеристики в паспорте).' },
  photos: { category: 'catalog', kind: 'core', doc: 'Фотохранилище: сами изображения (файл / ссылка).' },

  // ================= Связевые и вложенные (несамостоятельные) =================
  organizationcontacts: { category: 'links', kind: 'link', doc: 'Связь «организация ↔ контакт»: кто входит в организацию и в какой роли.' },
  orgroles: { category: 'links', kind: 'link', doc: 'Связь «организация ↔ роль»: какие роли выданы внутри организации.' },
  counterpartyroles: { category: 'links', kind: 'link', doc: 'Связь «контрагент ↔ роль»: какую роль играет контрагент.' },
  productphotos: { category: 'links', kind: 'link', doc: 'Связь «продукт ↔ фото»: какие изображения относятся к изделию.' },
  productmodulephotos: { category: 'links', kind: 'link', doc: 'Связь «модуль ↔ фото»: изображения комплектующего.' },
  entityattributevalues: { category: 'links', kind: 'link', doc: 'Значения атрибутов, привязанные к конкретной сущности (EAV).' },

  // ================= Остатки: документооборот (код удалён) =================
  document_templates: { category: 'legacy-docs', kind: 'legacy', doc: 'Шаблоны документов. Остаток удалённого DocStudio — модульного кода нет, кандидат на удаление.' },
  document_template_categories: { category: 'legacy-docs', kind: 'legacy', doc: 'Категории шаблонов документов. Остаток удалённого DocStudio, кандидат на удаление.' },
  doc_types: { category: 'legacy-docs', kind: 'legacy', doc: 'Типы документов (есть остаточные данные). Остаток удалённого домена, кандидат на удаление.' },
  document_table_types: { category: 'legacy-docs', kind: 'legacy', doc: 'Типы таблиц внутри документов. Остаток удалённого DocStudio, кандидат на удаление.' },
  table_templates: { category: 'legacy-docs', kind: 'legacy', doc: 'Шаблоны таблиц документов. Остаток удалённого DocStudio, кандидат на удаление.' },
  template_blocks: { category: 'legacy-docs', kind: 'legacy', doc: 'Блоки шаблонов. Остаток удалённого DocStudio, кандидат на удаление.' },
  text_blocks: { category: 'legacy-docs', kind: 'legacy', doc: 'Библиотека текстовых блоков. Остаток удалённого DocStudio, кандидат на удаление.' },
  text_block_categories: { category: 'legacy-docs', kind: 'legacy', doc: 'Категории текстовых блоков. Остаток удалённого DocStudio, кандидат на удаление.' },
  studio_documents: { category: 'legacy-docs', kind: 'legacy', doc: 'Документы DocStudio. Остаток удалённого домена, кандидат на удаление.' },
  generated_documents: { category: 'legacy-docs', kind: 'legacy', doc: 'Сгенерированные (выгруженные) документы. Остаток удалённого домена, кандидат на удаление.' },
  form_profiles: { category: 'legacy-docs', kind: 'legacy', doc: 'Профили форм. Остаток удалённого домена, кандидат на удаление.' },

  // ================= Остатки: продажи, сделки и закупки (код удалён) =================
  quotations: { category: 'legacy-sales', kind: 'legacy', doc: 'Коммерческие предложения (КП). Остаток удалённого CRM; читается только в проверке удаления продукции.' },
  contracts: { category: 'legacy-sales', kind: 'legacy', doc: 'Договоры. Остаток удалённого CRM, кандидат на удаление.' },
  orders: { category: 'legacy-sales', kind: 'legacy', doc: 'Заказы. Остаток удалённого CRM; читается только в проверке удаления продукции.' },
  shipments: { category: 'legacy-sales', kind: 'legacy', doc: 'Отгрузки. Остаток удалённого CRM, кандидат на удаление.' },
  invoices: { category: 'legacy-sales', kind: 'legacy', doc: 'Счета. Остаток удалённого CRM, кандидат на удаление.' },
  tenders: { category: 'legacy-sales', kind: 'legacy', doc: 'Тендеры и заявки. Остаток удалённого CRM, кандидат на удаление.' },
  desknotes: { category: 'legacy-sales', kind: 'legacy', doc: 'Служебные записки. Остаток удалённого CRM, кандидат на удаление.' },
  rpps: { category: 'legacy-sales', kind: 'legacy', doc: 'Реестры РПП. Остаток удалённого CRM, кандидат на удаление.' },
  purchaseorders: { category: 'legacy-sales', kind: 'legacy', doc: 'Закупочные заказы (PO). Остаток удалённого домена; читается в проверке удаления материалов.' },
  purchaserequests: { category: 'legacy-sales', kind: 'legacy', doc: 'Запросы на закупку (PR). Остаток удалённого домена, кандидат на удаление.' },
  supplyrequests: { category: 'legacy-sales', kind: 'legacy', doc: 'Запросы снабжения. Остаток удалённого домена, кандидат на удаление.' },
  supplytasks: { category: 'legacy-sales', kind: 'legacy', doc: 'Задачи снабжения. Остаток удалённого домена, кандидат на удаление.' },
  cart_items: { category: 'legacy-sales', kind: 'legacy', doc: 'Позиции корзины (e-commerce). Остаток удалённого CRM, кандидат на удаление.' },
  cart_sessions: { category: 'legacy-sales', kind: 'legacy', doc: 'Сессии корзины. Остаток удалённого CRM, кандидат на удаление.' },
  financial_reports: { category: 'legacy-sales', kind: 'legacy', doc: 'Финансовые отчёты. Остаток удалённого домена, кандидат на удаление.' },
  reconciliation_acts: { category: 'legacy-sales', kind: 'legacy', doc: 'Акты сверки расчётов. Остаток удалённого домена, кандидат на удаление.' },

  // ================= Остатки: производство (код удалено) =================
  productionorders: { category: 'legacy-prod', kind: 'legacy', doc: 'Производственные заказы. Остаток удалённого производства, кандидат на удаление.' },
  ordertasks: { category: 'legacy-prod', kind: 'legacy', doc: 'Задачи по заказу. Остаток удалённого производства, кандидат на удаление.' },
  workorders: { category: 'legacy-prod', kind: 'legacy', doc: 'Наряд-заказы на работу. Остаток удалённого производства, кандидат на удаление.' },
  workorderoperations: { category: 'legacy-prod', kind: 'legacy', doc: 'Операции наряда-заказа. Остаток удалённого производства, кандидат на удаление.' },
  workcenters: { category: 'legacy-prod', kind: 'legacy', doc: 'Рабочие центры (станки, участки). Остаток удалённого производства, кандидат на удаление.' },
  workers: { category: 'legacy-prod', kind: 'legacy', doc: 'Работники / исполнители. Остаток удалённого производства; читается в проверке удаления видов работ.' },
  routingsteps: { category: 'legacy-prod', kind: 'legacy', doc: 'Шаги маршрутной карты (маршрутизация). Остаток удалённого производства, кандидат на удаление.' },
  techprocesses: { category: 'legacy-prod', kind: 'legacy', doc: 'Технологические процессы. Остаток удалённого производства, кандидат на удаление.' },
  costcalculations: { category: 'legacy-prod', kind: 'legacy', doc: 'Калькуляция себестоимости. Остаток удалённого производства; читается в проверке удаления материалов/продукции.' },
  actualcosts: { category: 'legacy-prod', kind: 'legacy', doc: 'Фактические затраты. Остаток удалённого производства, кандидат на удаление.' },
  orderclosings: { category: 'legacy-prod', kind: 'legacy', doc: 'Закрытия заказов / периодов. Остаток удалённого производства, кандидат на удаление.' },

  // ================= Остатки: склад и инвентарь (код удалён) =================
  warehouses: { category: 'legacy-wh', kind: 'legacy', doc: 'Склады (есть остаточные данные). Остаток удалённого склада, кандидат на удаление.' },
  storageitems: { category: 'legacy-wh', kind: 'legacy', doc: 'Позиции хранения на складе. Остаток удалённого склада, кандидат на удаление.' },
  stockmovements: { category: 'legacy-wh', kind: 'legacy', doc: 'Движения запасов (приход / расход). Остаток удалённого склада, кандидат на удаление.' },
  reservations: { category: 'legacy-wh', kind: 'legacy', doc: 'Резервы запасов. Остаток удалённого склада, кандидат на удаление.' },
  boms: { category: 'legacy-wh', kind: 'legacy', doc: 'Ведомость материалов (BOM). Остаток удалённого домена; читается в проверке удаления модулей/продукции.' },

  // ================= Остатки: прочее (код удалён) =================
  import_jobs: { category: 'legacy-misc', kind: 'legacy', doc: 'Задачи импорта данных. Остаток удалённого домена, кандидат на удаление.' },
  import_mapping_profiles: { category: 'legacy-misc', kind: 'legacy', doc: 'Профили маппинга полей при импорте. Остаток удалённого домена, кандидат на удаление.' },
  import_tasks: { category: 'legacy-misc', kind: 'legacy', doc: 'Детали задач импорта. Остаток удалённого домена, кандидат на удаление.' },
  import_todos: { category: 'legacy-misc', kind: 'legacy', doc: 'Незавершённые шаги импорта. Остаток удалённого домена, кандидат на удаление.' },
  interactions: { category: 'legacy-misc', kind: 'legacy', doc: 'Взаимодействия с клиентами (CRM). Остаток удалённого CRM, кандидат на удаление.' },
  comments: { category: 'legacy-misc', kind: 'legacy', doc: 'Комментарии к сущностям. Остаток удалённого домена, кандидат на удаление.' },
  certificates: { category: 'legacy-misc', kind: 'legacy', doc: 'Сертификаты и документы соответствия. Остаток удалённого домена, кандидат на удаление.' },
  compliancerules: { category: 'legacy-misc', kind: 'legacy', doc: 'Правила комплаенса / соответствия. Остаток удалённого домена, кандидат на удаление.' },
  inventorfiles: { category: 'legacy-misc', kind: 'legacy', doc: 'Файлы инвентаризации. Остаток удалённого домена, кандидат на удаление.' },
  catalogattachments: { category: 'legacy-misc', kind: 'legacy', doc: 'Вложения каталога. Остаток удалённого домена, кандидат на удаление.' },
  mutation_journal: { category: 'legacy-misc', kind: 'legacy', doc: 'Журнал мутаций (служебный). Остаток удалённого домена, кандидат на удаление.' },
  migration_flags: { category: 'legacy-misc', kind: 'legacy', doc: 'Флаги выполненных миграций. Служебное, код миграций удалён — кандидат на удаление.' },
};

/** Индекс для поиска без учёта регистра/подчёркиваний (устойчивость к вводу из URL). */
const COLLECTIONS_BY_NORM: Record<string, CollectionMeta> = Object.fromEntries(
  Object.entries(COLLECTIONS).map(([k, v]) => [normalizeName(k), v]),
);

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[_\-\s]/g, '');
}

/** P1: коллекция данных приложения (`app_<app>_<collection>`) — описание строится из имени. */
function appMeta(name: string): CollectionMeta | undefined {
  const parsed = parseMongoCollectionName(name);
  if (!parsed) return undefined;
  return {
    category: 'apps',
    kind: 'app',
    doc: `Данные приложения «${parsed.app}», коллекция «${parsed.collection}» — /api/apps/${parsed.app}/${parsed.collection}.`,
  };
}

function metaFor(name: string): CollectionMeta | undefined {
  return COLLECTIONS[name] ?? appMeta(name) ?? COLLECTIONS_BY_NORM[normalizeName(name)];
}

function describe(name: string): string | undefined {
  return metaFor(name)?.doc;
}

function classify(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return 'array';
  if (value instanceof Date) return 'date';
  if (value instanceof Types.ObjectId) return 'objectId';
  if (Buffer.isBuffer(value)) return 'binary';
  const ctor = (value as { constructor?: { name?: string } } | null)?.constructor;
  if (typeof value === 'object' && value !== null && ctor?.name === 'ObjectId') {
    return 'objectId';
  }
  return typeof value; // string | number | boolean | object
}

function trimExample(value: unknown): unknown {
  if (typeof value === 'string' && value.length > MAX_EXAMPLE_LEN) {
    return value.slice(0, MAX_EXAMPLE_LEN) + '...';
  }
  return value;
}

/** Чувствительные поля: тип и заполненность показываем, значение — нет. */
const SENSITIVE_RE = /(password|secret|token|apikey|api_key|hash|credential|private)/i;

function isSensitive(path: string): boolean {
  // tokenPrefix / refreshTokenVersion — витринные значения, не секреты
  if (/(prefix|version|count)$/i.test(path)) return false;
  return SENSITIVE_RE.test(path);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !(value instanceof Date) &&
    !(value instanceof Types.ObjectId) &&
    !Buffer.isBuffer(value) &&
    !Array.isArray(value)
  );
}

/** Обходит один документ и возвращает map: путь -> { типы, пример }. */
function inspectDoc(
  doc: Record<string, unknown>,
): Map<string, { types: Set<string>; example: unknown }> {
  const local = new Map<string, { types: Set<string>; example: unknown }>();

  const visit = (value: unknown, path: string, depth: number): void => {
    if (depth > MAX_DEPTH) return;
    const type = classify(value);
    let entry = local.get(path);
    if (!entry) {
      entry = { types: new Set<string>(), example: undefined };
      local.set(path, entry);
    }
    entry.types.add(type);
    if (
      entry.example === undefined &&
      value !== null &&
      value !== undefined &&
      type !== 'object' &&
      type !== 'array'
    ) {
      entry.example = trimExample(value);
    }
    // Массивы: показываем первые элементы, иначе в справочнике будет «—»
    if (type === 'array' && entry.example === undefined && Array.isArray(value)) {
      if (value.length === 0) entry.example = '[]';
      else {
        try { entry.example = trimExample(JSON.stringify(value.slice(0, 5))); }
        catch { entry.example = '[…]'; }
      }
    }

    if (type === 'object' && isPlainObject(value)) {
      for (const [k, v] of Object.entries(value)) {
        visit(v, path ? path + '.' + k : k, depth + 1);
      }
    } else if (Array.isArray(value)) {
      // Превью под-структур по первым элементам массива: path[].sub
      for (const el of value.slice(0, 5)) {
        if (isPlainObject(el)) visit(el, path + '[]', depth + 1);
      }
    }
  };

  for (const [k, v] of Object.entries(doc)) visit(v, k, 0);
  return local;
}

/** Семплирует документы и сводит статистику полей. */
function collectFields(docs: unknown[]): {
  fields: FieldStat[];
  sampled: number;
  truncated: boolean;
} {
  const map = new Map<string, FieldStat>();
  let sampled = 0;

  for (const doc of docs) {
    if (!isPlainObject(doc)) continue;
    sampled += 1;
    for (const [path, info] of inspectDoc(doc)) {
      let stat = map.get(path);
      if (!stat) {
        stat = { path, types: [], example: undefined, present: 0, completeness: 0 };
        map.set(path, stat);
      }
      for (const t of info.types) if (!stat.types.includes(t)) stat.types.push(t);
      if (stat.example === undefined) stat.example = info.example;
      stat.present += 1;
    }
  }

  const fields = [...map.values()].map((f) => ({
    ...f,
    example: isSensitive(f.path) ? '***' : f.example,
    completeness: sampled > 0 ? f.present / sampled : 0,
  }));
  // Важные поля (высокая заполненность) — впереди, внутри — по алфавиту.
  fields.sort((a, b) => b.completeness - a.completeness || a.path.localeCompare(b.path));

  const truncated = fields.length > MAX_FIELDS;
  return { fields: fields.slice(0, MAX_FIELDS), sampled, truncated };
}

/** Верхнеуровневые поля + типы — дешёвое превью для свёрнутой строки. */
function topLevelPreview(docs: unknown[]): { name: string; types: string[] }[] {
  const map = new Map<string, Set<string>>();
  for (const doc of docs) {
    if (!isPlainObject(doc)) continue;
    for (const [k, v] of Object.entries(doc)) {
      let set = map.get(k);
      if (!set) {
        set = new Set<string>();
        map.set(k, set);
      }
      set.add(classify(v));
    }
  }
  return [...map.entries()]
    .map(([name, types]) => ({ name, types: [...types] }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, MAX_KEY_FIELDS);
}

@Controller('admin/collections')
export class CollectionsAdminController {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  private db() {
    const db = this.connection?.db;
    if (!db) throw new BadRequestException('MongoDB is not connected');
    return db;
  }

  /** GET /api/admin/collections — быстрый список всех коллекций. */
  @Get()
  @Permissions('user:admin')
  @Roles('admin')
  async list() {
    const db = this.db();
    const raw = await db.listCollections({}, { nameOnly: true }).toArray();
    const names = raw
      .map((c) => c.name)
      .filter((n) => n && !n.startsWith('system.'))
      .sort((a, b) => a.localeCompare(b));

    const items: {
      name: string;
      count: number;
      fieldCount: number;
      keyFields: { name: string; types: string[] }[];
      description?: string;
      category: string;
      kind: CollectionKind;
    }[] = [];

    for (const name of names) {
      const coll = db.collection(name);
      const count = await coll.estimatedDocumentCount().catch(() => 0);
      const sample = await coll.find({}).limit(LIST_SAMPLE).toArray();
      const preview = topLevelPreview(sample);
      const meta = metaFor(name);
      items.push({
        name,
        count,
        fieldCount: preview.length,
        keyFields: preview,
        description: meta?.doc,
        // Неизвестная коллекция (новая/внешняя) уходит в «Не классифицировано» —
        // её видно сразу и её надо описать в COLLECTIONS.
        category: meta?.category ?? 'unknown',
        kind: meta?.kind ?? 'core',
      });
    }

    return { total: items.length, categories: CATEGORIES, items };
  }

  /** GET /api/admin/collections/:name — расшифровка одной коллекции. */
  @Get(':name')
  @Permissions('user:admin')
  @Roles('admin')
  async detail(@Param('name') name: string, @Query('sample') sampleParam?: string) {
    if (!name || !/^[A-Za-z0-9_\-]+$/.test(name)) {
      throw new BadRequestException('Invalid collection name');
    }
    const db = this.db();
    const known = (await db.listCollections({ name }, { nameOnly: true }).toArray()).length > 0;
    if (!known) throw new BadRequestException('Collection not found: ' + name);

    let sampleSize = DETAIL_SAMPLE_DEFAULT;
    if (sampleParam !== undefined) {
      const n = Number(sampleParam);
      if (!Number.isFinite(n) || n < 1) {
        throw new BadRequestException('sample must be a positive number');
      }
      sampleSize = Math.min(Math.floor(n), DETAIL_SAMPLE_MAX);
    }

    const coll = db.collection(name);
    const count = await coll.estimatedDocumentCount().catch(() => 0);
    const docs = await coll.find({}).limit(sampleSize).toArray();
    const { fields, sampled, truncated } = collectFields(docs);

    return {
      name,
      count,
      sampled,
      truncated,
      description: describe(name),
      category: metaFor(name)?.category ?? 'unknown',
      kind: metaFor(name)?.kind ?? 'core',
      fields,
    };
  }

  /**
   * DELETE /api/admin/collections/:name — удаляет коллекцию-остаток (drop).
   *
   * Операция необратимая, поэтому контур защиты намеренно узкий:
   *   1. Только ТОЧНОЕ имя из реестра COLLECTIONS (без нормализации регистра и
   *      подчёркиваний) — нельзя удалить то, о чём реестр ничего не знает, и
   *      нельзя попасть в чужое имя с такой же «нормализацией».
   *   2. Только kind === 'legacy' или 'app' (данные приложения, P1; точное имя
   *      app_<app>_<collection>) — действующие (core) и связевые (link) таблицы
   *      недоступны для удаления (409).
   *   3. Дроп пишется в журнал аудита (@AuditAction → AuditLog). Имя идёт в
   *      details.after (снапшот ответа), а НЕ в entityId: AuditService.log
   *      приводит entityId к Types.ObjectId, а имя коллекции — не хекс-строка
   *      24 символов, поэтому запись молча упала бы в catch().
   */
  @Delete(':name')
  @Permissions('user:admin')
  @Roles('admin')
  @AuditAction({ action: 'drop-collection', entityType: 'Collection' })
  async remove(@Param('name') name: string) {
    if (!name || !/^[A-Za-z0-9_\-]+$/.test(name)) {
      throw new BadRequestException('Invalid collection name');
    }

    // Точное совпадение с реестром — без COLLECTIONS_BY_NORM (см. шифр выше).
    const meta = COLLECTIONS[name] ?? appMeta(name);
    if (!meta) {
      throw new BadRequestException(
        'Коллекция не описана в реестре — из админки удалять её нельзя: ' + name,
      );
    }
    if (meta.kind !== 'legacy' && meta.kind !== 'app') {
      throw new ConflictException(
        'Удалять можно только остатки (legacy) и данные приложений (app). Эта таблица — ' +
          meta.kind +
          ': ' +
          name,
      );
    }

    const db = this.db();
    const known =
      (await db.listCollections({ name }, { nameOnly: true }).toArray()).length > 0;
    if (!known) throw new NotFoundException('Collection not found: ' + name);

    const coll = db.collection(name);
    const removedDocuments = await coll.estimatedDocumentCount().catch(() => 0);
    await coll.drop();

    return { name, dropped: true, removedDocuments, kind: meta.kind, category: meta.category };
  }
}
