import sharp from 'sharp';
import { safeUploadPath } from '../../common/uploads/safe-path';
import { renderTechSheetPdf } from './tech-sheet-pdf';
import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { DataVersionService } from '../../common/data-version/data-version.service';
import { InjectConnection } from '@nestjs/mongoose';
import { createHash } from 'crypto';
import type { ClientSession, Connection } from 'mongoose';
import { Types } from 'mongoose';
import { escapeRe, oid } from '../../common/list-query';
import { checkChoices, toNode } from '../../common/passport/phrase-tree';
import { skuKey, skuRegex, tokensFilter } from '../../common/text/search-norm';
import { isUsedByCrm } from '../../common/catalog/catalog-references';
import { CounterService } from '../counter/counter.service';
import { parseCatalog } from './catalog-rows';
import { legacyDefaultsReplacement, normalizePassportDefaults, presentPassportDefaults, type PassportDefaults } from './passport-defaults';
import { facetElementsPatch } from './facet-elements';
import { writableCascadeRows } from '../../common/order-archive/cascade';
import { withOrderWrite } from '../../common/order-archive/write';
import { productNameKey, shortProductName } from './order-product-name';
import { clean, LIVE, variants, type Doc } from './showcase-common';
const key0 = (v: unknown) => clean(v).toLowerCase().replace(/ё/g, 'е');
import { ShowcaseBulk } from './showcase-bulk';
import { cloneDoc, variantDoc, variantSku } from './showcase-clone';
import { findSimilar } from './showcase-similar';
import { showcasePhotos } from './showcase-photos';
import { ShowcaseComposition } from './showcase-composition';
import { ShowcaseFromPassports } from './showcase-from-passports';
import { parseMaterialsSpec, presentMaterialsSpec } from '../../common/catalog/materials-table';
import { ShowcaseMaterials } from './showcase-materials';
import { groupNoOf, nextSku, skuOfGroup, skuPrefixError } from './showcase-sku';
import { seriesInDict, seriesOptions, tallyValues, withDict } from '../../common/passport/form-values';
import { identifyProduct, loadIdentificationContext, passportCode, type IdentificationContext } from './showcase-identification';
import { bulkExpected, bulkFingerprint } from './showcase-bulk-cas';

/** Число ≥ 0 из поля формы («1 200,5»); пусто — null. */
const num = (v: unknown, what: string) => {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) throw new BadRequestException(`${what} — число`);
  return n;
};
/** Габариты Д×Ш×В + единица (CRM `dimensions`); все пустые — null. */
const parseDimensions = (v: unknown) => {
  const d = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, l] of [['length', 'Длина'], ['width', 'Ширина'], ['height', 'Высота']] as const) { const n = num(d[k], l); if (n) out[k] = n; }
  if (!Object.keys(out).length) return null;
  out.unit = clean(d.unit) || 'мм';
  return out;
};
const presentDimensions = (v: unknown) => {
  const d = (v && typeof v === 'object' ? v : null) as Record<string, unknown> | null;
  if (!d || !['length', 'width', 'height'].some((k) => Number(d[k]) > 0)) return null;
  const n = (k: string) => (Number(d[k]) > 0 ? Number(d[k]) : null);
  return { length: n('length'), width: n('width'), height: n('height'), unit: String(d.unit || 'мм') };
};
/** Признаки изделия из тела запроса: список id; каждый — живое значение справочника productFacetValues (иначе 400). */
async function facetIds(db: import('mongoose').mongo.Db, v: unknown): Promise<Types.ObjectId[]> {
  if (v === null || v === '') return [];
  if (!Array.isArray(v)) throw new BadRequestException('Признаки: ожидается список id значений');
  const ids = [...new Set(v.map(String))];
  if (!ids.every((x) => Types.ObjectId.isValid(x) && x.length === 24)) throw new BadRequestException('Признаки: некорректный id значения');
  const oids = ids.map((x) => new Types.ObjectId(x));
  if (oids.length && (await db.collection('dict_values').countDocuments({ dict: 'productFacetValues', deletedAt: null, _id: { $in: oids } })) !== oids.length) throw new BadRequestException('Признак не найден в справочнике — выберите значение из списка');
  return oids;
}
/** Точное совпадение названия без регистра и лишних пробелов. */
const sameName = (name: string) => new RegExp('^\\s*' + escapeRe(name).replace(/\s+/g, '\\s+') + '\\s*$', 'i');

/**
 * «Продукция» — витрина изделий компании и КП (TASKS БЗ-4) поверх общей коллекции CRM `products` (kind good, unit шт):
 * артикул = `sku`, раздел (Тип) → группа — категории `categories` type 'product' (родитель → ребёнок), цена — `listPrice`,
 * серия — `series` (поле только data-core, CRM его не читает). Загруженное из каталога — `status: draft`, пока нет цены.
 */
@Injectable()
export class ShowcaseService {
  constructor(@InjectConnection() private readonly connection: Connection, private readonly counter: CounterService, @Optional() private readonly versions?: DataVersionService) {}
  private get db() { return this.connection.db!; }
  // тяжёлые части вынесены в отдельные файлы (ПР-1); публичные методы сервиса прежние
  private readonly comp = new ShowcaseComposition(() => this.db, this.versions);
  private readonly bulkOps = new ShowcaseBulk({ db: () => this.db, present: (d) => this.present(d), applyRow: (raw, patch, defaults, incoming) => this.applyBulkRow(raw, patch, defaults, incoming) });
  private readonly fromPp = new ShowcaseFromPassports(this.connection, (dto) => this.create(dto));
  private readonly mi = new ShowcaseMaterials(() => this.db);


  /** Себестоимость состава изделия (материалы + вложенные изделия) — для себестоимости позиции/изделия (C041 Э3). */
  async compositionCost(productId: string): Promise<{ total: number; missing: number } | null> {
    const d = await this.db.collection('products').findOne({ _id: oid(productId, 'изделия'), deletedAt: null }, { projection: { composition: 1 } });
    if (!d) return null;
    const c = await this.comp.cost(((d.composition as Array<{ lineType?: string; refId?: unknown; quantity?: number }>) ?? [])
      .map((l) => ({ lineType: l.lineType, refId: String(l.refId), quantity: Number(l.quantity) || 0 })));
    return c ? { total: c.total, missing: c.missing } : null;
  }

  private async present(docs: Doc[], context?: IdentificationContext) {
    const metadata = context ?? await loadIdentificationContext(this.db);
    const { pictures, covers } = await showcasePhotos(this.db, docs);
    // ПИ: тип паспорта изделия (своя из passportDefaults, иначе — по «Категориям каталога») и сколько паспортов выпущено
    const ppCounts = docs.length ? await this.db.collection('productpassports').aggregate([{ $match: { deletedAt: null, productId: { $in: docs.map((d) => d._id) } } }, { $group: { _id: '$productId', n: { $sum: 1 } } }]).toArray() : [];
    const ppN = new Map(ppCounts.map((x) => [String(x._id), x.n as number]));

    return docs.map((d) => {
      const identification = identifyProduct(d, metadata);
      const { group: c, typeName: typ, kind: rk, passport: pp } = identification;
      const pics = pictures.get(String(d._id)) ?? [];
      const ppCoverPhoto = covers.get(String(d._id)) ?? null;
      const photo = pics[0] ?? ppCoverPhoto ?? null;
      const photoSource: 'own' | 'passport' | undefined = pics.length > 0 ? undefined : ppCoverPhoto ? 'passport' : undefined;
      return { id: String(d._id), sku: String(d.sku ?? ''), name: String(d.name ?? d.sku ?? ''), series: (d.series as string) ?? null, fullName: (d.fullName as string) ?? null, orderName: (d.orderName as string) ?? null, description: (d.description as string) ?? null, notes: (d.notes as string) ?? null,
        price: Number(d.listPrice) > 0 ? Number(d.listPrice) : null, status: String(d.status ?? 'new'), groupId: c ? String(c._id) : null, group: c?.parentId ? String(c.name) : null, // категория без родителя — сам раздел (группа не выбрана)
        hasPassportDefaults: !!d.passportDefaults && Object.keys(d.passportDefaults as object).length > 0,
        type: c ? (c.parentId ? typ : String(c.name)) : null, colors: (d.colors as string[]) ?? [], sizes: (d.sizes as string[]) ?? [], photos: pics, photo, ...(photoSource ? { photoSource } : {}), deletedAt: (d.deletedAt as Date) ?? null,
        // характеристики и тексты для паспорта (ФИ2) — поля общей схемы CRM, читаем как есть
        unit: String(d.unit ?? 'шт'), dimensions: presentDimensions(d.dimensions), weightKg: Number(d.weightKg) > 0 ? Number(d.weightKg) : null,
        ralCode: (d.ralCode as string) || null, purpose: (d.purpose as string) || null, installation: (d.installation as string) || null,
        kind: rk?.kind ? { id: rk.kind.id, name: rk.kind.name, source: rk.source, groupName: rk.groupName } : null,
        facetValueIds: ((d.facetValueIds as Types.ObjectId[]) ?? []).map(String), passportsCount: ppN.get(String(d._id)) ?? 0, designerId: d.designerId ? String(d.designerId) : null,
        identificationIssues: identification.issues, canPassport: !!pp.effective, missing: pp.effective ? [] : ['Нет типа паспорта — задайте его в группе или виде изделия'], ppCategory: pp.effective?.code ?? null, ppSource: pp.effective?.source ?? null, ppOwn: pp.own, ppInherited: pp.inherited };
    });
  }

  async list(q: Record<string, unknown>) {
    const page = Math.max(1, Number(q.page) || 1), limit = Math.min(500, Math.max(1, Number(q.limit) || 50));
    const filter: Record<string, unknown> = { deletedAt: String(q.deleted) === '1' ? { $ne: null } : null };
    // поиск «как на складе»: слова в любом порядке, ё = е, M10 = М10
    const sf = tokensFilter(q.search, ['name', 'fullName', 'orderName', 'sku', 'series']);
    if (sf) filter.$and = sf.$and;
    // NAV B2: состояние — draft (нет цены) / archived / active (в продаже: всё, кроме черновиков и архива)
    if (q.status === 'draft' || q.status === 'archived') filter.status = q.status;
    else if (q.status === 'active') filter.status = { $nin: ['draft', 'archived'] };
    // 2026-11-10 (пользователь: «если удалить нельзя — хотя бы в каталоге пусть не светится»): архив без явного status=archived
    // не показывается — ни в каталоге, ни в выборе изделия; status=all — всё; корзина (deleted=1) — как была
    else if (q.status !== 'all' && String(q.deleted) !== '1') filter.status = { $ne: 'archived' };
    if (q.series) filter.series = String(q.series).trim();
    if (q.groupId) {
      const g = oid(String(q.groupId), 'группы');
      // ПРД.5: группа + всё поддерево (раздел → группа → подгруппа…), а не только прямые дети
      const all = await this.db.collection('categories').find({ type: 'product', deletedAt: null }, { projection: { parentId: 1 } }).toArray();
      filter.categoryId = { $in: subtreeIds(g, all) };
    }
    const metadata = await loadIdentificationContext(this.db);
    if (String(q.needsIdentification) === '1') {
      // Eligibility считается без series: фасет показывает и другие серии при остальных фильтрах.
      const candidatesFilter = { ...filter }; delete candidatesFilter.series;
      const candidates = await this.db.collection('products').find(candidatesFilter, {
        projection: { _id: 1, categoryId: 1, 'passportDefaults.kindId': 1, 'passportDefaults.passportCategory': 1 },
      }).toArray();
      filter._id = { $in: candidates.filter(row => identifyProduct(row, metadata).issues.length > 0).map(row => row._id) };
    }
    const sortKey = String(q.sort || 'name').replace(/^-/, ''); const dir = String(q.sort || '').startsWith('-') ? -1 : 1;
    const sortField = ({ name: 'name', sku: 'sku', price: 'listPrice', series: 'series', deletedAt: 'deletedAt', category: 'categoryId' } as Record<string, string>)[sortKey] ?? 'name';
    // category — галерея по разделам (ФИ2): изделия одной группы подряд, внутри — по названию; withPhoto — сначала с обложкой (БЗ-15)
    const order: Record<string, 1 | -1> = sortField === 'categoryId' ? { categoryId: dir, name: 1, _id: 1 }
      : sortKey === 'withPhoto' ? { mainPhotoId: -1, name: 1, _id: 1 }
      : { [sortField]: dir, _id: 1 };
    const [docs, total] = await Promise.all([
      // Р7 (C112): тяжёлые поля (состав, части, работы, PDM) списку не нужны — present() их не отдаёт; без них список быстрее в разы
      this.db.collection('products').find(filter, { projection: { composition: 0, parts: 0, workTypes: 0, pdm: 0, productModuleIds: 0 } }).sort(order).skip((page - 1) * limit).limit(limit).toArray(),
      this.db.collection('products').countDocuments(filter),
    ]);
    // Б1: facets=1 — серии с числом изделий при остальных выбранных фильтрах (воронка «Тип · Группа → Серия»); поле дополнительное
    if (q.facets === '1') {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- series исключаем из фильтра фасета
      const { series: _s, ...rest } = filter;
      const series = await this.db.collection('products').aggregate([{ $match: { ...rest, series: { $nin: [null, ''] } } }, { $group: { _id: '$series', n: { $sum: 1 } } }, { $sort: { _id: 1 } }]).toArray();
      return { items: await this.present(docs as Doc[], metadata), total, page, limit, facets: { series: series.map((x) => ({ value: String(x._id), n: x.n as number })) } };
    }
    return { items: await this.present(docs as Doc[], metadata), total, page, limit };
  }

  /** «Похожее уже есть»: до 5 изделий с похожим названием (подсказка при создании и сопоставлении). */
  similar(name: string, excludeId?: string) { return findSimilar(this.db, name, excludeId ? oid(excludeId, 'изделия') : undefined); }

  /** Разделы и группы с числом изделий — плитки витрины. */
  async groups() {
    const cats = await this.db.collection('categories').find({ type: 'product', deletedAt: null }, { projection: { name: 1, parentId: 1, groupNo: 1 } }).sort({ name: 1 }).toArray();
    const counts = await this.db.collection('products').aggregate([{ $match: LIVE }, { $group: { _id: '$categoryId', n: { $sum: 1 } } }]).toArray();
    // ИЗ-21: categoryId бывает и ObjectId, и строкой — $group даёт две записи на одну группу, их складываем
    const n = new Map<string, number>();
    for (const c of counts) n.set(String(c._id), (n.get(String(c._id)) ?? 0) + (c.n as number));
    // ПРД.5: число = всё поддерево (то же, что покажет список по этой группе)
    const total = (id: Types.ObjectId) => subtreeIds(id, cats).reduce((sum, x) => sum + (n.get(String(x)) ?? 0), 0);
    return cats.map((c) => ({ id: String(c._id), name: String(c.name), parentId: c.parentId ? String(c.parentId) : null, groupNo: c.groupNo ? String(c.groupNo) : null, count: total(c._id as Types.ObjectId) }))
      .filter((c) => c.count > 0);
  }

  /**
   * Подсказки формы изделия (ФИ): разделы и группы с числом изделий, названия «Категорий каталога» из типов паспортов
   * (раздел изделия связан с типом паспорта по названию), серии, цвета (+ справочник «Цвета») и размеры, что уже встречались.
   */
  /** Значения для формы изделия — кэш по версиям данных (С9; проверка архитектора 2026-10-23: читалось при каждом открытии формы). */
  async formValues() {
    const run = () => this.buildFormValues();
    return this.versions ? this.versions.cached('showcase.formValues', ['products', 'categories', 'color_references', 'dict_values', 'units'], '', run) : run();
  }

  private async buildFormValues() {
    const [groups, products, colorDict, ppCats, units, seriesDict] = await Promise.all([
      this.groups(),
      this.db.collection('products').find(LIVE, { projection: { series: 1, colors: 1, sizes: 1, ralCode: 1, unit: 1 } }).toArray(),
      this.db.collection('color_references').find({ deletedAt: null }, { projection: { name: 1, description: 1 } }).toArray(),
      this.db.collection('dict_values').find({ dict: 'passportCategories', deletedAt: null }, { projection: { code: 1, catalogNames: 1 } }).toArray(),
      this.db.collection('units').find({ isActive: { $ne: false }, deletedAt: null }, { projection: { symbol: 1, key: 1, label: 1 } }).toArray(),
      this.db.collection('dict_values').find({ dict: 'productSeries', deletedAt: null }, { projection: { name: 1 } }).toArray(),
    ]);
    const roots = groups.filter((g) => !g.parentId);
    const rootName = new Map(roots.map((g) => [g.id, g.name]));
    const catalog = ppCats.flatMap((c) => String(c.catalogNames ?? '').split(/[,;\n]/).map(clean).filter(Boolean).map((value) => ({ value, sub: `тип паспорта ${clean(c.code)}` })));
    return {
      sections: withDict(roots.map((g) => ({ value: g.name, n: g.count })), catalog),
      groups: groups.filter((g) => g.parentId).map((g) => ({ value: g.name, n: g.count, section: rootName.get(String(g.parentId)) ?? '' })),
      // ИЗ-18: серии — только справочник «Серии изделий», с числом изделий
      series: seriesOptions(seriesDict.map((x) => x.name), products.map((p) => p.series)),
      colors: withDict(tallyValues(products.flatMap((p) => (Array.isArray(p.colors) ? p.colors : []))), colorDict.filter((c) => !/^не выбран/i.test(clean(c.name))).map((c) => ({ value: clean(c.name), sub: 'справочник «Цвета»' }))),
      sizes: tallyValues(products.flatMap((p) => (Array.isArray(p.sizes) ? p.sizes : []))),
      // ФИ2: RAL — встречавшиеся + названия справочника «Цвета» с RAL; единицы — встречавшиеся + справочник «Единицы»
      ral: withDict(tallyValues(products.map((p) => p.ralCode)), colorDict.filter((c) => /ral/i.test(clean(c.name))).map((c) => ({ value: clean(c.name), sub: 'справочник «Цвета»' }))),
      units: withDict(tallyValues(products.map((p) => p.unit)), units.map((u) => ({ value: clean(u.symbol || u.key), sub: clean(u.label) || undefined }))),
    };
  }

  /** Карточка изделия. SK-8d: see.* = false (раздел закрыт для роли) — «в заказах» (salesorders) и паспорта (passports) пустые. */
  /** Техническое описание: строки приходят из окна, фото — главное фото изделия. */
  async techSheet(id: string, b: { title?: string; rows?: { name?: string; text?: string }[] }) {
    const p = await this.get(id);
    const rows = (b?.rows ?? []).slice(0, 100).map((r) => ({ name: String(r?.name ?? '').slice(0, 200), text: String(r?.text ?? '').slice(0, 2000) })).filter((r) => r.name || r.text);
    if (!rows.length) throw new BadRequestException('Добавьте хотя бы одну строку');
    const path = p.photo?.url ? safeUploadPath(p.photo.url) : null;
    const photo = path ? await sharp(path).flatten({ background: '#ffffff' }).resize(800, 800, { fit: 'inside' }).jpeg({ quality: 85 }).toBuffer().catch(() => null) : null;
    const title = String(b?.title || p.name).slice(0, 300);
    return { buf: await renderTechSheetPdf({ title, rows, photo }), filename: `ТО ${title.replace(/[^p{L}p{N} ._-]+/gu, ' ').trim()}.pdf` };
  }

  async get(id: string, see: { salesorders?: boolean; passports?: boolean } = {}) {
    const d = await this.db.collection('products').findOne({ _id: oid(id, 'изделия') });
    if (!d) throw new NotFoundException('Изделие не найдено');
    const item = (await this.present([d as Doc]))[0];
    const composition = await this.comp.composition(d as Doc);
    const materialsSpec = presentMaterialsSpec(d.materialsSpec);
    return { ...item, materialsSpec, materialsText: await this.mi.text(materialsSpec), orderLines: see.salesorders === false ? [] : await this.orderLines(d as Doc), composition, cost: await this.comp.cost(composition),
      passports: see.passports === false ? { total: 0, items: [] } : await this.passports(d as Doc),
      // итог (своя вручную главнее группы) + отдельно own (из passportDefaults) и inherited (от группы/раздела/справочника); ничего нет — null
      passportCategory: item.ppOwn || item.ppInherited ? { ...(item.ppOwn ? { code: item.ppOwn.code, name: item.ppOwn.name, via: 'изделие (задана вручную)', source: 'own' } : item.ppInherited!), own: item.ppOwn, inherited: item.ppInherited } : null,
      designer: await this.designer(d.designerId as Types.ObjectId | undefined),
      baseProductId: d.baseProductId ? String(d.baseProductId) : null, variants: await this.variants(d as Doc),
      passportDefaults: presentPassportDefaults(d.passportDefaults as PassportDefaults) };
  }

  /** ПП: «Кто проектировал» — { id, name } (ФИО из «Сотрудников») или null. */
  private async designer(id?: Types.ObjectId | null) {
    if (!id) return null;
    const p = await this.db.collection('persons').findOne({ _id: id }, { projection: { lastName: 1, firstName: 1, patronymic: 1, position: 1 } });
    if (!p) return null;
    return { id: String(id), name: [p.lastName, p.firstName, p.patronymic].map((x) => clean(x)).filter(Boolean).join(' '), position: clean(p.position) || null };
  }

  /** Значения паспорта по умолчанию (БЗ-6 Э4b): заменяются целиком; пустое тело — очистить. */
  async setPassportDefaults(id: string, b: Record<string, unknown>) {
    const _id = oid(id, 'изделия');
    if (!(await this.db.collection('products').findOne({ _id, deletedAt: null }, { projection: { _id: 1 } }))) throw new NotFoundException('Изделие не найдено');
    const v = await this.preparePassportDefaults(b);
    const result = await this.db.collection('products').updateOne({ _id, deletedAt: null }, [
      { $set: { passportDefaults: legacyDefaultsReplacement(v), updatedAt: new Date() } },
    ]);
    if (!result.matchedCount) throw new NotFoundException('Изделие не найдено');
    return this.get(id);
  }

  private async preparePassportDefaults(b: Record<string, unknown>) {
    const v = normalizePassportDefaults(b ?? {});
    if (v.kindId && !(await this.db.collection('dict_values').findOne({ _id: new Types.ObjectId(v.kindId), dict: 'passportKinds', deletedAt: null }, { projection: { _id: 1 } }))) throw new BadRequestException('Вид изделия не найден — выберите из списка');
    if (v.textChoices) {
      const err = checkChoices((await this.db.collection('dict_values').find({ dict: 'passportPhrases', deletedAt: null }).toArray()).map((r) => toNode(r)), v.textChoices);
      if (err) throw new BadRequestException(err);
    }
    return v;
  }

  /** Массовая строка: вся проверка до единственной записи; CAS не затирает параллельную правку. */
  private async applyBulkRow(raw: Doc, patch: Record<string, unknown>, defaults?: Record<string, unknown>, incomingDefaults?: Record<string, unknown>) {
    const normalized = defaults ? await this.preparePassportDefaults(defaults) : undefined;
    if (normalized || 'type' in patch || 'group' in patch) {
      const metadata = await loadIdentificationContext(this.db);
      // Разрешаем будущую группу чтением: fields() умеет её создать, но при отказе не должно остаться даже новой категории.
      let categoryId: unknown = raw.categoryId;
      if ('type' in patch || 'group' in patch) {
        const same = (a: unknown, b: unknown) => clean(a).toLowerCase() === clean(b).toLowerCase();
        const type = [...metadata.groups.values()].find(g => !g.parentId && same(g.name, patch.type));
        const group = type && [...metadata.groups.values()].find(g => String(g.parentId ?? '') === String(type._id) && same(g.name, patch.group));
        categoryId = clean(patch.group) ? group?._id : type?._id;
      }
      const identity = identifyProduct({ ...raw, categoryId, passportDefaults: normalized ?? raw.passportDefaults }, metadata);
      const explicitCategory = incomingDefaults && Object.prototype.hasOwnProperty.call(incomingDefaults, 'passportCategory') ? passportCode(incomingDefaults.passportCategory) : '';
      // Выбор только вида не даёт разрешения молча переклассифицировать прежний унаследованный тип.
      const ownCategory = explicitCategory || passportCode(identifyProduct(raw, metadata).passport.effective?.code);
      const kindCategory = passportCode(identity.kind.kind?.passportCategory);
      if (ownCategory && kindCategory && ownCategory !== kindCategory) {
        throw new BadRequestException('Вид изделия не соответствует выбранному типу паспорта — уточните оба поля');
      }
    }
    return this.connection.transaction(async session => {
    const set = await this.fields(patch, raw.series, session);
    const keys = [...Object.keys(set), ...(normalized ? ['passportDefaults'] : [])];
    const before = Object.fromEntries(keys.map(key => [key, raw[key] ?? null]));
    const commit = normalized ? [{ $set: {
      ...Object.fromEntries(Object.entries(set).map(([key, value]) => [key, { $literal: value }])),
      passportDefaults: legacyDefaultsReplacement(normalized), updatedAt: { $literal: new Date() },
    } }] : { $set: { ...set, updatedAt: new Date() } };
    const expected = bulkExpected(raw, [...keys, 'categoryId', 'passportDefaults']);
    const result = await this.db.collection('products').updateOne({ _id: raw._id, deletedAt: null, ...expected }, commit, { session });
    if (!result.matchedCount) throw new ConflictException('Изделие изменено другим пользователем — обновите список и повторите');
    const afterDefaults = normalized ? { ...normalized,
      ...Object.fromEntries(Object.entries((raw.passportDefaults ?? {}) as Record<string, unknown>).filter(([key]) => ['simpleDescription', 'manualDescription', 'manualPurpose', 'manualInstall'].includes(key))),
    } : undefined;
    const after = { ...raw, ...set, ...(afterDefaults ? { passportDefaults: Object.keys(afterDefaults).length ? afterDefaults : undefined } : {}) };
    return { set: before, expected: bulkFingerprint(after, keys) };
    });
  }



  /** Паспорта изделия (БЗ-5): по ссылке productId или с тем же названием; последние 30 и общее число. */
  private async passports(d: Doc) {
    const name = clean(d.name);
    const filter = { deletedAt: null, $or: [{ productId: d._id }, ...(name ? [{ name: sameName(name) }] : [])] };
    const coll = this.db.collection('productpassports');
    const [docs, total] = await Promise.all([
      coll.find(filter, { projection: { passportNumber: 1, date: 1, customerName: 1, objectName: 1, orderNo: 1, productCode: 1, supplier: 1, supplierOrgId: 1, printFile: 1 } }).sort({ date: -1, _id: -1 }).limit(30).toArray(),
      coll.countDocuments(filter),
    ]);
    const orgIds = [...new Set(docs.map((x) => (x.supplierOrgId ? String(x.supplierOrgId) : '')).filter((x) => Types.ObjectId.isValid(x)))].map((x) => new Types.ObjectId(x));
    const orgs = orgIds.length ? await this.db.collection('organizations').find({ _id: { $in: orgIds } }, { projection: { name: 1, shortName: 1 } }).toArray() : [];
    const firm = new Map(orgs.map((o) => [String(o._id), String(o.shortName || o.name || '')]));
    return { total, items: docs.map((x) => {
      const name = (x.supplierOrgId && firm.get(String(x.supplierOrgId))) || (x.supplier ? String(x.supplier) : null);
      const hasFile = !!(x.printFile as { path?: string } | undefined)?.path;
      return { id: String(x._id), passportNumber: x.passportNumber ?? null, productCode: x.productCode ?? null, date: x.date ?? null, customer: x.customerName || x.objectName || null, orderNo: x.orderNo ?? null, supplier: name || null, printSource: hasFile ? 'file' as const : 'app' as const };
    }) };
  }

  /** Где изделие в заказах: позиции со ссылкой productId или с тем же названием (без регистра), до 30 штук (БЗ-5). */
  private async orderLines(d: Doc) {
    const name = clean(d.name);
    const or: Record<string, unknown>[] = [{ productId: d._id }];
    if (name) or.push({ title: sameName(name) });
    const lines = await this.db.collection('incomes').find({ ...LIVE, cancelledAt: null, orderId: { $ne: null }, $or: or }).sort({ shipDate: -1 }).limit(30).toArray();
    return lines.map((l) => ({ id: String(l._id), orderId: String(l.orderId), orderNo: l.orderNo ?? null, customer: l.customer ?? null, qty: l.qty ?? null, color: l.color ?? null, size: l.size ?? null, shipDate: l.shipDate ?? null, linked: !!l.productId }));
  }

  /** Категория type product по названию (с родителем) — найти или завести (slug и skuPrefix уникальны в общей схеме). */
  private async category(name: string | null, parentId: Types.ObjectId | null, session?: ClientSession) {
    const n = clean(name);
    if (!n) return parentId;
    const found = await this.db.collection('categories').findOne({ type: 'product', deletedAt: null, parentId: parentId ?? null, name: new RegExp(`^\\s*${escapeRe(n)}\\s*$`, 'i') }, session ? { session } : {});
    if (found) return found._id as Types.ObjectId;
    const h = createHash('md5').update(`${parentId ?? ''}/${n.toLowerCase()}`).digest('hex').slice(0, 8);
    const { insertedId } = await this.db.collection('categories').insertOne({ name: n, slug: `product-${h}`, type: 'product', parentId: parentId ?? null, skuPrefix: `PR${h.toUpperCase()}`, sortOrder: 0, isActive: true, deletedAt: null, createdAt: new Date(), updatedAt: new Date() }, session ? { session } : {});
    return insertedId;
  }

  private async fields(dto: Record<string, unknown>, curSeries?: unknown, session?: ClientSession) {
    const set: Record<string, unknown> = {};
    if (dto.name !== undefined) { const v = clean(dto.name); if (!v) throw new BadRequestException('Наименование не может быть пустым'); set.name = v; }
    if (dto.series !== undefined) {
      set.series = clean(dto.series) || null;
      // ИЗ-18: серия — из справочника «Серии изделий» (пустая — можно)
      if (set.series && key0(set.series) !== key0(curSeries) && !seriesInDict(set.series, (await this.db.collection('dict_values').find({ dict: 'productSeries', deletedAt: null }, { projection: { name: 1 } }).toArray()).map((x) => x.name))) throw new BadRequestException('Выберите серию из справочника');
    }
    // «Длинное название» больше не пишем (решение 2026-10-31): fullName остаётся в DTO для старых клиентов и молча игнорируется; «как в заказе» — необязательное, пусто — стереть
    if (dto.orderName !== undefined) set.orderName = clean(dto.orderName) || null;
    if (dto.description !== undefined) set.description = String(dto.description ?? '').trim() || null;
    if (dto.notes !== undefined) set.notes = String(dto.notes ?? '').trim() || null;
    if (dto.price !== undefined) { const p = dto.price === null || dto.price === '' ? 0 : Number(String(dto.price).replace(/\s/g, '').replace(',', '.')); if (!Number.isFinite(p) || p < 0) throw new BadRequestException('Цена — число'); set.listPrice = p; if (p > 0) set.status = 'active'; }
    for (const k of ['colors', 'sizes'] as const) if (dto[k] !== undefined) set[k] = variants(dto[k]);
    // ФИ2: характеристики, тексты для паспорта, статус (поля схемы CRM — только существующие)
    if (dto.dimensions !== undefined) set.dimensions = parseDimensions(dto.dimensions);
    if (dto.weightKg !== undefined) set.weightKg = num(dto.weightKg, 'Вес') ?? 0;
    if (dto.ralCode !== undefined) set.ralCode = clean(dto.ralCode) || null;
    if (dto.unit !== undefined) set.unit = clean(dto.unit) || 'шт';
    for (const k of ['purpose', 'installation'] as const) if (dto[k] !== undefined) set[k] = String(dto[k] ?? '').trim() || null;
    if (dto.status !== undefined && dto.status !== null && dto.status !== '') {
      const st = String(dto.status);
      if (!['draft', 'active', 'archived'].includes(st)) throw new BadRequestException('Статус: черновик, в продаже или архив');
      // черновик = «нет цены»: с ценой изделие в продаже, если не отправлено в архив
      if (!(st === 'draft' && Number(set.listPrice) > 0)) set.status = st;
    }
    // ПП: «Кто проектировал» — сотрудник (справочник «Сотрудники», persons); новое поле data-core, CRM его не читает; в паспорт не входит
    if (dto.designerId !== undefined) {
      if (!dto.designerId) set.designerId = null;
      else {
        const pid = oid(String(dto.designerId), 'сотрудника');
        if (!(await this.db.collection('persons').findOne({ _id: pid, deletedAt: null }, { projection: { _id: 1 } }))) throw new BadRequestException('Сотрудник не найден — выберите из справочника «Сотрудники»');
        set.designerId = pid;
      }
    }
    // МИ.2: материалы изделия таблицей — новое поле data-core (CRM не читает); ссылки только на справочники; пусто — null
    if (dto.materialsSpec !== undefined) { const sp = parseMaterialsSpec(dto.materialsSpec); await this.mi.check(sp); set.materialsSpec = sp; }
    // C028: признаки продукции — только значения справочника «Значения признаков»
    if (dto.facetValueIds !== undefined) set.facetValueIds = await facetIds(this.db, dto.facetValueIds);
    if (Array.isArray(dto.photoIds)) set.photoIds = (dto.photoIds as string[]).filter((x) => Types.ObjectId.isValid(x)).map((x) => new Types.ObjectId(x));
    // Создание категории — единственный side effect fields; только после проверки остальных полей.
    if (dto.group !== undefined || dto.type !== undefined) set.categoryId = await this.category(dto.group as string, await this.category(dto.type as string, null, session), session);
    return set;
  }

  /** requireType — ручное создание из формы (ФИ2): раздел обязателен; загрузка каталога / из заказов / из паспортов — без него. */
  async create(dto: Record<string, unknown>, opts: { requireType?: boolean } = {}) {
    const { id, skuWarning } = await this.createRecord(dto, opts);
    const created = await this.get(String(id));
    return skuWarning ? { ...created, skuWarning } : created;
  }

  /** Создание вместе с привязкой позиций заявки выполняется в её транзакции. */
  async createRecord(dto: Record<string, unknown>, opts: { requireType?: boolean } = {}, session?: ClientSession) {
    let sku = clean(dto.sku);
    let skuWarning: string | undefined;
    if (!sku) {
      // без артикула: группа с номером (categories.groupNo) → автоартикул; иначе обязателен ручной
      const gid = dto.group ? await this.category(dto.group as string, await this.category(dto.type as string, null, session), session) : null;
      const auto = await nextSku(this.db, this.counter, gid, session);
      if (!auto) throw new BadRequestException('Укажите артикул или задайте группе номер: Справочники → Группы изделий');
      sku = auto.sku; skuWarning = auto.warning;
    }
    // дубль — и с другим регистром, похожими буквами (KC-01 = КС-01), лишними пробелами; в т. ч. в корзине и у изделий CRM
    const dup = await this.db.collection('products').findOne({ sku: skuRegex(sku) }, { session, projection: { sku: 1, name: 1, deletedAt: 1 } });
    if (dup) throw new ConflictException(`Изделие с артикулом ${dup.sku} уже есть: «${dup.name ?? ''}»${dup.deletedAt ? ' (в корзине — восстановите его)' : ''}`);
    if (opts.requireType && !clean(dto.type)) throw new BadRequestException('Укажите раздел изделия');
    const set = await this.fields({ ...dto, name: dto.name ?? sku }, undefined, session);
    const now = new Date();
    const { insertedId } = await this.db.collection('products').insertOne({ sku, kind: 'good', unit: 'шт', status: 'draft', listPrice: 0, basePrice: 0, costPrice: 0, defaultMarkupPercent: 30, stockQty: 0,
      photoIds: [], mainPhotoId: null, productModuleIds: [], composition: [], isActive: true, deletedAt: null, hasPassport: false, hasDrawing: false, ...set, ...(set.photoIds ? { mainPhotoId: (set.photoIds as Types.ObjectId[])[0] ?? null } : {}), source: 'showcase', createdAt: now, updatedAt: now }, { session });
    // C028: изделие, созданное по ходу воронки, сразу с признаками — их элементы в умолчания паспорта (как при правке)
    if (Array.isArray(set.facetValueIds) && (set.facetValueIds as unknown[]).length) {
      const fromFacets = await facetElementsPatch(this.db, insertedId, set.facetValueIds as Types.ObjectId[], session);
      if (fromFacets) await this.db.collection('products').updateOne({ _id: insertedId }, { $set: { 'passportDefaults.elements': fromFacets } }, { session });
    }
    return { id: insertedId, skuWarning };
  }

  /**
   * Присвоить изделию артикул его группы (смена группы артикул не меняет). Без confirm — только отчёт: новый артикул не выдаётся,
   * показано, что изменится и сколько паспортов выпущено под старым.
   */
  async assignSku(id: string, confirm: boolean) {
    const _id = oid(id, 'изделия');
    const d = await this.db.collection('products').findOne({ _id, deletedAt: null }, { projection: { sku: 1, categoryId: 1 } });
    if (!d) throw new NotFoundException('Изделие не найдено');
    const g = await groupNoOf(this.db, (d.categoryId as Types.ObjectId | null) ?? null);
    if (!g) throw new BadRequestException('У группы изделия нет номера — задайте его в справочнике групп');
    if (skuOfGroup(g.groupNo).test(clean(d.sku))) return { id, sku: String(d.sku), changed: false, passports: 0 };
    const passports = await this.db.collection('productpassports').countDocuments({ deletedAt: null, productId: _id });
    if (!confirm) return { id, sku: String(d.sku), changed: false, passports, confirmRequired: true, warning: passports ? `Артикул изменится у изделия, выпущено паспортов: ${passports}` : 'Артикул изменится' };
    const auto = (await nextSku(this.db, this.counter, d.categoryId as Types.ObjectId))!;
    await this.db.collection('products').updateOne({ _id }, { $set: { sku: auto.sku, updatedAt: new Date() } });
    return { id, sku: auto.sku, oldSku: String(d.sku), changed: true, passports, ...(auto.warning ? { skuWarning: auto.warning } : {}) };
  }

  /**
   * Клон изделия (ПВ): копия со всеми полями, фото, составом, материалами и значениями паспорта (с выбором текстов), наименование
   * «… (копия)». Артикул — следующий автоартикул группы; у группы нет номера — «<артикул>-копия» (потом поправить в карточке).
   */
  async clone(id: string) {
    const _id = oid(id, 'изделия');
    const src = await this.db.collection('products').findOne({ _id, deletedAt: null });
    if (!src) throw new NotFoundException('Изделие не найдено');
    const auto = await nextSku(this.db, this.counter, (src.categoryId as Types.ObjectId | null) ?? null);
    let sku = auto?.sku ?? '';
    for (let i = 1; !sku; i++) {
      const cand = `${clean(src.sku)}-копия${i > 1 ? '-' + i : ''}`;
      if (!(await this.db.collection('products').findOne({ sku: skuRegex(cand) }, { projection: { _id: 1 } }))) sku = cand;
    }
    const { insertedId } = await this.db.collection('products').insertOne(cloneDoc(src as Doc, sku));
    const created = await this.get(String(insertedId));
    return auto?.warning ? { ...created, skuWarning: auto.warning } : created;
  }

  /**
   * Вариант изделия (ВР): клон с `baseProductId` = основное изделие семейства (у варианта — его основное), артикул `<основной>.<n>`,
   * имя основного (отличие — размеры, цвет — правятся в варианте). Паспорта, заказы и склад не переходят.
   */
  async makeVariant(id: string) {
    const _id = oid(id, 'изделия');
    const src = await this.db.collection('products').findOne({ _id, deletedAt: null });
    if (!src) throw new NotFoundException('Изделие не найдено');
    const base = src.baseProductId ? await this.db.collection('products').findOne({ _id: src.baseProductId as Types.ObjectId }) : src;
    if (!base) throw new NotFoundException('Основное изделие не найдено');
    const baseSku = clean(base.sku);
    if (!baseSku) throw new BadRequestException('У основного изделия нет артикула — задайте его в карточке');
    const taken = await this.db.collection('products').find({ sku: new RegExp(`^${escapeRe(baseSku)}\\.[0-9]+$`, 'i') }, { projection: { sku: 1 } }).toArray();
    const sku = variantSku(baseSku, taken.map((t) => String(t.sku)));
    const { insertedId } = await this.db.collection('products').insertOne(variantDoc(src as Doc, base as Doc, sku));
    return this.get(String(insertedId));
  }

  /** Варианты изделия для выбора в позиции заказа (ВР): лёгкий ответ без карточки. */
  async variantsOf(id: string) {
    const d = await this.db.collection('products').findOne({ _id: oid(id, 'изделия') }, { projection: { baseProductId: 1 } });
    if (!d) throw new NotFoundException('Изделие не найдено');
    return { items: await this.variants(d as Doc) };
  }

  /** Семейство вариантов изделия (ВР): основное + варианты, без самого изделия; пусто — вариантов нет. */
  private async variants(d: Doc) {
    const baseId = (d.baseProductId as Types.ObjectId | undefined) ?? (d._id as Types.ObjectId);
    const docs = await this.db.collection('products').find({ deletedAt: null, _id: { $ne: d._id }, $or: [{ _id: baseId }, { baseProductId: baseId }] },
      { projection: { sku: 1, name: 1, dimensions: 1, colors: 1, baseProductId: 1 } }).sort({ sku: 1 }).limit(100).toArray();
    return docs.map((x) => ({ id: String(x._id), sku: String(x.sku ?? ''), name: String(x.name ?? ''), isBase: !x.baseProductId, dimensions: presentDimensions(x.dimensions), colors: (x.colors as string[]) ?? [] }));
  }

  async update(id: string, dto: Record<string, unknown>) {
    const _id = oid(id, 'изделия');
    const set = await this.fields(dto, dto.series !== undefined ? (await this.db.collection('products').findOne({ _id }, { projection: { series: 1 } }))?.series : undefined); // серия, которая у изделия уже есть, не перепроверяется
    if (dto.foundationDepth !== undefined) {
      const depth = dto.foundationDepth;
      if (typeof depth !== 'number' || !Number.isFinite(depth) || depth < 0) {
        throw new BadRequestException('Укажите глубину Г в миллиметрах, не меньше нуля');
      }
      set['passportDefaults.foundationDepth'] = depth;
    }
    // 2026-11-10: пустой артикул в правке — как в создании (подсказка формы обещает «присвоен автоматически»):
    // у изделия артикул уже есть — не трогаем; нет — следующий по номеру группы; у группы нет номера — понятная ошибка
    if (dto.sku !== undefined && !clean(dto.sku)) {
      const cur = await this.db.collection('products').findOne({ _id }, { projection: { sku: 1, categoryId: 1 } });
      const gid = ((set.categoryId ?? cur?.categoryId) as Types.ObjectId | null) ?? null;
      const g = await groupNoOf(this.db, gid);
      // артикул уже правильный для группы — не трогаем; временный «ПС-…» или чужой группы — новый по номеру группы
      // (пользователь 2026-11-10: очистил поле у «ПС-DBBA03», ждал нормальный артикул — остался «ПС-…»)
      const fits = !!cur && !!clean(cur.sku) && !/^ПС-/i.test(clean(cur.sku)) && (!g || !skuPrefixError(g.groupNo, clean(cur.sku)));
      if (fits) delete dto.sku;
      else {
        const auto = await nextSku(this.db, this.counter, gid);
        if (!auto) throw new BadRequestException('Укажите артикул или задайте группе номер: Справочники → Группы изделий');
        dto.sku = auto.sku;
      }
    }
    if (dto.sku !== undefined) {
      const sku = clean(dto.sku); if (!sku) throw new BadRequestException('Артикул не может быть пустым');
      // замок префикса: у группы есть номер — меняется только хвост из двух цифр (тот же артикул, что уже у изделия, не трогаем: форма шлёт его целиком)
      const cur = await this.db.collection('products').findOne({ _id }, { projection: { sku: 1, categoryId: 1 } });
      if (cur && skuKey(cur.sku) !== skuKey(sku)) {
        const g = await groupNoOf(this.db, ((set.categoryId ?? cur.categoryId) as Types.ObjectId | null) ?? null);
        const bad = g && skuPrefixError(g.groupNo, sku);
        if (bad) throw new BadRequestException(bad);
      }
      const dup = await this.db.collection('products').findOne({ _id: { $ne: _id }, sku: skuRegex(sku), deletedAt: null }, { projection: { sku: 1, name: 1 } });
      if (dup) throw new ConflictException(`Артикул ${dup.sku} уже у другого изделия: «${dup.name ?? ''}»`);
      set.sku = sku;
    }
    if (set.photoIds) set.mainPhotoId = (set.photoIds as Types.ObjectId[])[0] ?? null;
    // C028: элементы выбранных признаков дописываются в умолчания паспорта (ручные не стираются)
    const fromFacets = Array.isArray(set.facetValueIds) ? await facetElementsPatch(this.db, _id, set.facetValueIds as Types.ObjectId[]) : null;
    const nextDefaults = {
      ...('passportDefaults.foundationDepth' in set ? { foundationDepth: set['passportDefaults.foundationDepth'] } : {}),
      ...(fromFacets ? { elements: fromFacets } : {}),
    };
    delete set['passportDefaults.foundationDepth'];
    set.updatedAt = new Date();
    const patch = Object.keys(nextDefaults).length ? [{ $set: {
      ...Object.fromEntries(Object.entries(set).map(([k, v]) => [k, { $literal: v }])),
      passportDefaults: { $mergeObjects: [{ $ifNull: ['$passportDefaults', {}] }, { $literal: nextDefaults }] },
    } }] : { $set: set };
    const r = await this.db.collection('products').updateOne({ _id, deletedAt: null }, patch);
    if (!r.matchedCount) throw new NotFoundException('Изделие не найдено');
    return this.get(id);
  }


  /** В корзину: изделие из заказов CRM / КП не удаляется (ссылки) — проверяем составы и заказы CRM. */
  async remove(id: string) {
    const _id = oid(id, 'изделия');
    const used = await this.db.collection('products').findOne({ deletedAt: null, 'composition.productId': _id }, { projection: { name: 1 } });
    if (used) throw new ConflictException(`Изделие входит в состав «${used.name}» — удалить нельзя`);
    if (await isUsedByCrm(this.connection, 'product', _id)) throw new ConflictException('На изделие ссылаются заказы / документы CRM — удалить нельзя');
    // CANON: нельзя удалить то, на что ссылаются — позиции заказов, паспорта, задания
    // Аннулированный паспорт номер держит, но изделие не блокирует (иначе дубль с выпущенным паспортом не убрать)
    for (const [coll, what] of [['incomes', 'позициях заказов'], ['productpassports', 'паспортах'], ['designtasks', 'заданиях проектирования'], ['worktasks', 'заданиях «В работе»']] as const) {
      const q: Record<string, unknown> = { productId: _id, deletedAt: null };
      if (coll === 'productpassports') q.status = { $ne: 'annulled' };
      const n = await this.db.collection(coll).countDocuments(q);
      if (n) throw new ConflictException(`Изделие используется в ${what} (${n}) — удалить нельзя`);
    }
    const r = await this.db.collection('products').updateOne({ _id, deletedAt: null }, { $set: { deletedAt: new Date() } });
    if (!r.matchedCount) throw new NotFoundException('Изделие не найдено');
    return { id, deleted: true };
  }

  async restore(id: string) {
    await this.db.collection('products').updateOne({ _id: oid(id, 'изделия') }, { $set: { deletedAt: null } });
    return this.get(id);
  }

  /**
   * Загрузка каталога (Excel / вставка): по артикулу — новое изделие или обновление названия, раздела/группы, серии
   * (цену — только если в файле есть, а у изделия нет). apply=false — только отчёт (что будет). Ничего не удаляет.
   */
  async import(text: string, apply: boolean) {
    const { rows, errors } = parseCatalog(text);
    // сверка по тому же правилу, что и проверка дубля (регистр, похожие буквы): иначе «ab-1» при «AB-1» в базе шёл как новый и загрузка падала на 409
    const existing = rows.length ? await this.db.collection('products').find({ sku: { $in: rows.map((r) => skuRegex(r.sku)) } }, { projection: { sku: 1, name: 1, series: 1, listPrice: 1, orderName: 1, deletedAt: 1 } }).toArray() : [];
    const by = new Map(existing.map((e) => [skuKey(e.sku), e]));
    const byName = new Map<string, Doc>();
    for (const p of await this.db.collection('products').find({ deletedAt: null }, { projection: { sku: 1, name: 1, series: 1, listPrice: 1, orderName: 1 } }).toArray()) {
      const k = productNameKey(String(p.name ?? ''));
      if (k && !byName.has(k)) byName.set(k, p as Doc);
    }
    const plan = rows.map((r) => {
      let e = by.get(skuKey(r.sku));
      let nameLink: string | undefined;
      if (!e) {
        const hit = byName.get(productNameKey(r.name));
        if (hit && skuKey(hit.sku) !== skuKey(r.sku)) { e = hit; nameLink = String(hit._id); }
      }
      const action = !e ? 'new' : e.deletedAt ? 'deleted' : (clean(e.name) !== r.name || (e.series ?? null) !== r.series || (r.orderName && clean(e.orderName) !== r.orderName) || (r.price && !(Number(e.listPrice) > 0))) ? 'update' : 'same';
      return { ...r, action, ...(nameLink ? { nameLink } : {}) };
    });
    const count = (a: string) => plan.filter((p) => p.action === a).length;
    const preview = await Promise.all(plan.slice(0, 30).map(async (p) => ({ ...p, similar: p.action === 'new' ? await this.similar(p.name) : [] })));
    const report = { total: rows.length, new: count('new'), update: count('update'), same: count('same'), deleted: count('deleted'), errors, preview };
    if (!apply) return { ...report, applied: false };
    for (const p of plan) {
      if (p.action === 'new') await this.create({ sku: p.sku, name: p.name, series: p.series, type: p.type, group: p.group, ...(p.price ? { price: p.price } : {}), ...(p.orderName ? { orderName: p.orderName } : {}) });
      else if (p.action === 'update') {
        const e = by.get(skuKey(p.sku)) ?? (p.nameLink ? await this.db.collection('products').findOne({ _id: oid(p.nameLink, 'изделия') }) : null);
        if (!e) continue;
        await this.update(String(e._id), { name: p.name, series: p.series, type: p.type, group: p.group, ...(p.price && !(Number(e.listPrice) > 0) ? { price: p.price } : {}), ...(p.orderName ? { orderName: p.orderName } : {}) });
      }
    }
    return { ...report, applied: true };
  }

  /**
   * Изделия из заказов (БЗ-5): позиции заказов, которых ещё нет в «Продукции» (по короткому имени без регистра), → черновики.
   * apply=false — только отчёт. При apply: создаём изделие (status draft, без цены, полное описание из заказа) и ставим
   * позициям productId (только где его не было). Текст и суммы позиций не трогаем — договор.
   */
  async fromOrders(apply: boolean, picks?: { key?: string; name?: string; group?: string }[]) {
    const lines = await this.db.collection('incomes').aggregate([
      { $match: { ...LIVE, orderId: { $ne: null }, productId: null, archiveProtected: { $ne: true } } },
      { $set: { orderObjectId: { $convert: { input: '$orderId', to: 'objectId', onError: null, onNull: null } } } },
      { $lookup: { from: 'salesorders', localField: 'orderObjectId', foreignField: '_id', as: 'order' } },
      { $unwind: '$order' },
      { $match: { 'order.activeArchiveVersion': null, 'order.deletedAt': null } },
      { $project: { title: 1, orderNo: 1 } },
    ]).toArray();
    const have = new Map<string, Types.ObjectId>();
    for (const p of await this.db.collection('products').find({ deletedAt: null }, { projection: { name: 1 } }).toArray()) { const k = productNameKey(String(p.name ?? '')); if (!have.has(k)) have.set(k, p._id as Types.ObjectId); }
    const groups = new Map<string, { name: string; description: string; ids: Types.ObjectId[]; orders: Set<string> }>();
    for (const l of lines) {
      const name = shortProductName(String(l.title ?? ''));
      if (!name) continue;
      const key = productNameKey(name);
      const g = groups.get(key) ?? { name, description: String(l.title ?? '').trim(), ids: [], orders: new Set<string>() };
      g.ids.push(l._id as Types.ObjectId); if (l.orderNo) g.orders.add(String(l.orderNo)); groups.set(key, g);
    }
    const plan = [...groups.entries()].map(([key, g]) => ({ key, ...g, action: have.has(key) ? 'exists' : 'new' }));
    const fresh = plan.filter((p) => p.action === 'new');
    const row = (p: (typeof plan)[number]) => ({ key: p.key, name: p.name, lines: p.ids.length, orders: [...p.orders].slice(0, 5) });
    const report = { lines: lines.length, new: fresh.length, exists: plan.length - fresh.length, preview: fresh.slice(0, 30).map(row), items: fresh.map(row) };
    if (!apply) return { ...report, applied: false };
    // выбор (галочки в панели): создаём только отмеченные, с поправленным названием; без picks — все, как раньше
    let chosen: Map<string, string> | null = null;
    const groupOf = new Map<string, string>();
    if (picks !== undefined) {
      if (!Array.isArray(picks) || picks.length > 2000) throw new BadRequestException('Некорректный выбор изделий');
      chosen = new Map(picks.filter((x) => x?.key).map((x) => [String(x.key), clean(x.name).slice(0, 256)]));
      for (const x of picks) if (x?.key && x.group) groupOf.set(String(x.key), clean(x.group));
      if (!chosen.size) throw new BadRequestException('Отметьте изделия, которые создать');
    }
    let created = 0, archiveSkipped = 0;
    for (const p of plan) {
      if (p.action === 'new' && chosen && !chosen.has(p.key)) continue;
      const name = chosen?.get(p.key) || p.name;
      const description = p.description.length > name.length ? p.description : '';
      const group = groupOf.get(p.key);
      try {
        const result = await withOrderWrite(this.connection, [], async session => {
          const targets = await writableCascadeRows(this.db, session, 'incomes', { _id: { $in: p.ids }, ...LIVE, productId: null });
          if (!targets.ids.length) return { skipped: targets.skipped, made: false };
          let productId = have.get(p.key) ?? have.get(productNameKey(name));
          const made = !productId;
          if (!productId) {
            if (group) {
              try { productId = (await this.createRecord({ name, group, description }, {}, session)).id; }
              catch (error) { if (!(error instanceof BadRequestException)) throw error; }
            }
            if (!productId) {
              const sku = 'ЗК-' + createHash('md5').update(p.key).digest('hex').slice(0, 6).toUpperCase();
              productId = (await this.createRecord({ sku, name, description }, {}, session)).id;
            }
          }
          await this.db.collection('incomes').updateMany(
            { _id: { $in: targets.ids } },
            { $set: { productId }, $inc: { passportEpoch: 1, version: 1 } },
            { session },
          );
          return { skipped: targets.skipped, made, productId };
        });
        archiveSkipped += result.skipped;
        if (result.made) {
          created++;
          if (result.productId) have.set(productNameKey(name), result.productId);
        }
      } catch (error) {
        if (!(error instanceof ConflictException || error instanceof BadRequestException)) throw error;
      }
    }
    return { ...report, applied: true, created, ...(archiveSkipped ? { archiveSkipped } : {}) };
  }

  /** Заменить строки состава (СИ) — подробности в showcase-composition.ts. */
  async setComposition(id: string, lines: Array<{ id?: string; _id?: string; lineType?: string; materialId?: string; productId?: string; moduleId?: string; refId?: string; quantity?: number | string; notes?: string }>, types?: string[]) {
    await this.comp.set(id, lines, types);
    return this.get(id);
  }

  compositionSimilar(id: string) { return this.comp.similar(id); }

  /** «Взять из состава» (МИ.2): предложение таблицы материалов по «Составу изделия» — showcase-materials.ts. */
  materialsFromComposition(id: string) { return this.mi.fromComposition(id); }

  /** Предпросмотр текста «Изготовлено из…» по таблице (МИ.3), без записи. */
  async materialsText(spec: unknown) { return { materialsText: await this.mi.text(presentMaterialsSpec(parseMaterialsSpec(spec))) }; }

  /** Массовое изменение выбранных изделий (БЗ-9) — подробности в showcase-bulk.ts. */
  bulk(dto: { ids?: unknown; set?: Record<string, unknown>; arrays?: Record<string, string> }) { return this.bulkOps.run(dto); }

  bulkRestore(dto: { items?: Array<{ id?: string; set?: Record<string, unknown> }> }) { return this.bulkOps.restore(dto); }

  // БЗ-8: изделия из паспортов без дублей — showcase-from-passports.ts
  passportGroups() { return this.fromPp.passportGroups(); }

  fromPassports(dto: { groups?: { keys?: string[]; main?: string; name?: string }[]; rest?: boolean }) { return this.fromPp.fromPassports(dto); }

  /** Данные коммерческого предложения: номер КП, реквизиты нашей компании, заказчик, строки с фото и суммами. */
  async kp(dto: { items?: { id: string; qty?: number; price?: number }[]; companyId?: string; customer?: string; note?: string }) {
    const items = (dto.items ?? []).filter((x) => x?.id);
    if (!items.length) throw new BadRequestException('Выберите изделия для КП');
    const docs = (await this.db.collection('products').find({ _id: { $in: items.map((x) => oid(x.id, 'изделия')) } }).toArray()) as Doc[];
    const pres = new Map((await this.present(docs)).map((p) => [p.id, p]));
    const lines = items.map((x) => {
      const p = pres.get(x.id); if (!p) throw new NotFoundException('Изделие не найдено — обновите витрину');
      const qty = Number(x.qty) > 0 ? Number(x.qty) : 1, price = Number(x.price) >= 0 && x.price !== undefined ? Number(x.price) : p.price ?? 0;
      return { id: p.id, sku: p.sku, name: p.name, series: p.series, group: p.group, qty, price, sum: Math.round(qty * price * 100) / 100, photo: p.photo };
    });
    const co = dto.companyId ? await this.db.collection('organizations').findOne({ _id: oid(dto.companyId, 'компании'), isOurCompany: true })
      : await this.db.collection('organizations').findOne({ isOurCompany: true, deletedAt: null });
    const number = await this.counter.next('CommercialOffer', 'КП');
    return {
      number, date: new Date(), customer: clean(dto.customer) || null, note: String(dto.note ?? '').trim() || null,
      company: co ? { name: co.name, shortName: co.shortName ?? null, fullName: co.fullName ?? null, inn: String(co.inn ?? '').startsWith('БЕЗ-ИНН') ? null : co.inn, kpp: co.kpp ?? null, address: co.legalAddress ?? null,
        phone: co.phone ?? null, email: co.email ?? null, website: co.website ?? null, bankName: co.bankName ?? null, bankBik: co.bankBik ?? null, bankAccount: co.bankAccount ?? null, bankCorrAccount: co.bankCorrAccount ?? null } : null,
      items: lines, total: Math.round(lines.reduce((s, l) => s + l.sum, 0) * 100) / 100, noPrice: lines.filter((l) => !l.price).length,
    };
  }
}

/** ПРД.5: id категории и всех её потомков на любой глубине (защита от петель — посещённые). */
export function subtreeIds(root: Types.ObjectId, cats: Array<{ _id: unknown; parentId?: unknown }>): Types.ObjectId[] {
  const kids = new Map<string, Types.ObjectId[]>();
  for (const c of cats) if (c.parentId) { const k = String(c.parentId); kids.set(k, [...(kids.get(k) ?? []), c._id as Types.ObjectId]); }
  const out: Types.ObjectId[] = []; const seen = new Set<string>(); const stack = [root];
  while (stack.length) { const x = stack.pop()!; if (seen.has(String(x))) continue; seen.add(String(x)); out.push(x); stack.push(...(kids.get(String(x)) ?? [])); }
  return out;
}
