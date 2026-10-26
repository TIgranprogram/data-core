import { Types, type Connection, type Model } from 'mongoose';
import type { DataVersionService } from '../../common/data-version/data-version.service';
import { parseList } from '../../common/list-query';
import { tokensFilter } from '../../common/text/search-norm';
import type { ProductPassportDocument } from './product-passport.schema';
import { missingFieldsV2 } from './passport-rules';
import { missingChoices, resolveChoices, type PhraseTreeNode } from '../../common/passport/phrase-tree';
import { MODEL_FIELDS, SORT, escapeRe, type Doc } from './passport-consts';

/** Что спискам и подсказкам нужно от сервиса паспортов. */
export interface QueriesHost {
  model: Model<ProductPassportDocument>;
  connection: Connection;
  versions?: DataVersionService;
  categoryRules: () => Promise<Map<string, { requiredImages?: string; requiredFields?: string; serviceLifeYears?: string; warrantyMonths?: string; standards?: string }>>;
  installs: () => Promise<Map<string, Record<string, unknown>>>;
  withSchemes: (d: Doc, inst: Map<string, Record<string, unknown>>) => unknown;
  oid: (v: unknown) => Types.ObjectId;
  forest: (category?: string) => Promise<PhraseTreeNode[]>;
}

/** Обязательные разделы воронки без выбора (текст, набранный вручную, раздел закрывает) — одно правило для карточки и списка. */
export function choiceMissingIn(forest: PhraseTreeNode[], d: Doc): Array<{ label: string; key: string }> {
  const manual = (d.manualText as string[] | undefined) ?? [];
  return missingChoices(resolveChoices(forest, d.textChoices as Record<string, string> | undefined), (r) => (r.section === 'purpose' && manual.includes('purpose')) || (r.section === 'installation' && manual.includes('installationMethod')));
}

/** Список, фильтры, модели и готовые тексты паспортов (чтение); вызывается из ProductPassportService. */
export class PassportQueries {
  constructor(private readonly h: QueriesHost) {}

  /**
   * Список: поиск, фильтры (год, месяц, категория, поставщик, заказчик, без картинок, неполные), {items,total,page,limit}.
   * Текст паспорта (`textSnapshot`, ~30 КБ на паспорт) в список не берётся — он нужен карточке и PDF; `full` — с ним (пакет PDF).
   */
  async list(q: Record<string, unknown> = {}, { full = false } = {}): Promise<{ items: Doc[]; total: number; page: number; limit: number; incomplete: number }> {
    const p = parseList(q, { sortable: SORT, defaultSort: '-passportNo', defaultLimit: 25 });
    const make = async () => {
      const filter = this.filterOf(q, p.deleted);
      // поиск «как на складе»: «качели двойные» = «двойные качели», ё = е
      const sf = tokensFilter(q.search, ['passportNumber', 'warrantyCode', 'productCode', 'name', 'article', 'customerName', 'objectName', 'orderNo', 'category', 'supplier']);
      if (sf) filter.$and = sf.$and;
      const docs = await this.h.model.find(filter, full ? undefined : { textSnapshot: 0 }).setOptions({ includeSoftDeleted: true }).sort({ ...p.sort, _id: -1 }).lean().exec();
      // «неполные» считаются правилами, а не запросом — паспортов сотни
      const [cats, inst] = await Promise.all([this.h.categoryRules(), this.h.installs()]);
      // воронка: дерево — один раз на категорию черновиков, не на строку; выпущенные не считаем
      const rowsDocs = docs as unknown as Doc[];
      const forests = new Map<string, PhraseTreeNode[]>();
      for (const c of new Set(rowsDocs.filter((x) => x.status === 'draft' && x.passportCategory).map((x) => String(x.passportCategory)))) forests.set(c, await this.h.forest(c));
      return rowsDocs.map((x) => {
        const forest = x.status === 'draft' && x.passportCategory ? forests.get(String(x.passportCategory)) : undefined;
        const choices = forest ? choiceMissingIn(forest, x).map((m) => m.label) : [];
        return { ...x, missing: [...missingFieldsV2(this.h.withSchemes(x, inst) as never, cats.get(String(x.passportCategory ?? ''))), ...choices] };
      });
    };
    // скорость С9: расчёт по всем паспортам — один раз, пока паспорта и справочники не менялись; строки общие — копируем
    const rest = Object.fromEntries(Object.entries(q).filter(([k]) => k !== 'page' && k !== 'limit'));
    const all: Array<Doc & { missing: string[] }> = this.h.versions && !full
      ? await this.h.versions.cached('passports.list', ['productpassports', 'dict_values'], JSON.stringify(rest), make) : await make();
    const rows = q.incomplete === '1' || q.incomplete === 'true' ? all.filter((d) => d.missing.length) : all;
    const items = rows.slice(p.skip, p.skip + p.limit).map((d) => ({ ...d }));
    await this.attachThumbs(items);
    return { items, total: rows.length, page: p.page, limit: p.limit, incomplete: all.filter((d) => d.missing.length).length };
  }

  /** Миниатюра общего вида (галерея, строка списка): `thumb` — маленькая, `photoUrl` — оригинал. */
  async attachThumbs(items: Doc[]) {
    const first = (d: Doc) => ((d.images as Array<{ kind: string; photoId: Types.ObjectId; order?: number }>) || []).filter((i) => i.kind === 'overview').sort((a, b) => (a.order ?? 0) - (b.order ?? 0))[0]?.photoId;
    const ids = items.map(first).filter(Boolean) as Types.ObjectId[];
    if (!ids.length) return;
    const photos = this.h.connection.collection('photos');
    const [orig, thumbs] = await Promise.all([
      photos.find({ _id: { $in: ids } }, { projection: { storageUrl: 1 } }).toArray(),
      photos.find({ parentPhotoId: { $in: ids }, variant: 'thumb' }, { projection: { storageUrl: 1, parentPhotoId: 1 } }).toArray(),
    ]);
    const url = new Map(orig.map((x) => [String(x._id), x.storageUrl as string]));
    const th = new Map(thumbs.map((x) => [String(x.parentPhotoId), x.storageUrl as string]));
    for (const d of items) { const id = first(d); if (!id) continue; d.photoUrl = url.get(String(id)) ?? null; d.thumb = th.get(String(id)) ?? d.photoUrl; }
  }

  /**
   * Готовые тексты для «Описания» (ПС.5): материалы, установка, назначение — все разные варианты из паспортов,
   * с числом паспортов и категориями (в форме сначала — для выбранной категории). Новый текст, сохранённый в паспорте,
   * сам попадает в варианты.
   */
  async phrases(): Promise<Record<string, Array<{ text: string; n: number; categories: string[]; passportCategories: string[] }>>> {
    const out: Record<string, Array<{ text: string; n: number; categories: string[]; passportCategories: string[] }>> = {};
    for (const f of ['materials', 'installationMethod', 'purpose'] as const) {
      const rows = await this.h.model.aggregate([
        { $match: { deletedAt: null, [f]: { $nin: [null, ''] } } },
        { $group: { _id: `$${f}`, n: { $sum: 1 }, categories: { $addToSet: '$category' }, passportCategories: { $addToSet: '$passportCategory' } } }, // ПК: и коды категорий паспорта
        { $sort: { n: -1, _id: 1 } },
      ]).exec();
      out[f] = rows.map((r) => ({ text: String(r._id), n: r.n, categories: (r.categories as unknown[]).filter(Boolean).map(String), passportCategories: ((r.passportCategories as unknown[]) ?? []).filter(Boolean).map(String) }));
    }
    return out;
  }

  /**
   * Модели (артикул + наименование) — для «Новый паспорт → выберите модель» (ПС.5): поля и картинки берутся
   * из последнего паспорта модели; `n` — сколько паспортов выдано.
   */
  async models(): Promise<Doc[]> {
    // скорость С9: один расчёт, пока не менялись паспорта и фото; результат общий — не менять
    return this.h.versions ? this.h.versions.cached('passports.models', ['productpassports', 'photos'], '', () => this.buildModels()) : this.buildModels();
  }

  private async buildModels(): Promise<Doc[]> {
    const groups = await this.h.model.aggregate([
      { $match: { deletedAt: null, name: { $nin: [null, ''] } } },
      { $project: { textSnapshot: 0 } }, // текст паспорта модели не нужен — без него группировка в разы легче
      { $sort: { passportNo: -1 } },
      { $group: { _id: { a: { $ifNull: ['$article', ''] }, n: '$name' }, n: { $sum: 1 }, doc: { $first: '$$ROOT' } } },
      { $sort: { 'doc.category': 1, 'doc.name': 1 } },
    ]).exec();
    const items: Doc[] = groups.map((g) => {
      const d = g.doc as Doc;
      return { id: String(d._id), passportNumber: d.passportNumber, n: g.n, name: d.name, article: d.article ?? '', category: d.category ?? '', productId: d.productId ? String(d.productId) : null,
        ...Object.fromEntries(MODEL_FIELDS.filter((f) => !['productId', 'name', 'category', 'article'].includes(f)).map((f) => [f, d[f] ?? null])),
        images: d.images ?? [] };
    });
    await this.attachThumbs(items);
    return items;
  }

  private filterOf(q: Record<string, unknown>, deleted = false): Doc {
    const f: Doc = { deletedAt: deleted ? { $ne: null } : null };
    // НМ: статус — черновик / выпущен (в т. ч. старые без статуса) / аннулирован
    if (q.status === 'draft' || q.status === 'annulled') f.status = q.status;
    else if (q.status === 'issued') f.$or = [{ status: 'issued' }, { status: { $exists: false }, passportNumber: { $nin: [null, ''] } }];
    const year = Number(q.year), month = Number(q.month);
    if (year) {
      const from = new Date(Date.UTC(year, month ? month - 1 : 0, 1));
      const to = new Date(Date.UTC(month ? year : year + 1, month ? month : 0, 1));
      f.date = { $gte: from, $lt: to };
    }
    if (q.category) f.category = String(q.category);
    if (q.supplierOrgId) f.supplierOrgId = this.h.oid(q.supplierOrgId);
    if (q.customer) f.customerName = new RegExp(`^${escapeRe(String(q.customer))}$`, 'i');
    if (q.productId) f.productId = this.h.oid(q.productId);
    // NAV B1: «Архив паспортов» — старые (перенос: source не 'app', в т. ч. без поля); только чтение
    if (q.legacy === '1' || q.legacy === 'true') f.source = { $ne: 'app' };
    if (q.noImages === '1' || q.noImages === 'true') f['images.0'] = { $exists: false };
    return f;
  }

  /**
   * Значения для фильтров: годы, месяцы (при выбранном годе), категории, поставщики, заказчики.
   * Б2 (воронка): каждый признак считается при уже выбранных ОСТАЛЬНЫХ (q — те же параметры, что у списка); без q — как раньше.
   */
  async facets(q: Record<string, unknown> = {}) {
    const without = (...keys: string[]) => { const r = { ...q }; for (const k of keys) delete r[k]; return this.filterOf(r); };
    const yearSel = Number(q.year);
    const [years, months, categories, customers, suppliers] = await Promise.all([
      this.h.model.aggregate([{ $match: { ...without('year', 'month'), date: { $type: 'date' } } }, { $group: { _id: { $year: '$date' }, n: { $sum: 1 } } }, { $sort: { _id: -1 } }]).exec(),
      yearSel ? this.h.model.aggregate([{ $match: without('month') }, { $match: { date: { $type: 'date' } } }, { $group: { _id: { $month: '$date' }, n: { $sum: 1 } } }, { $sort: { _id: 1 } }]).exec() : Promise.resolve([]),
      this.h.model.aggregate([{ $match: { ...without('category'), category: { $nin: [null, ''] } } }, { $group: { _id: '$category', n: { $sum: 1 } } }, { $sort: { n: -1 } }]).exec(),
      this.h.model.aggregate([{ $match: { ...without('customer'), customerName: { $nin: [null, ''] } } }, { $group: { _id: '$customerName', n: { $sum: 1 } } }, { $sort: { _id: 1 } }]).exec(),
      this.h.model.aggregate([{ $match: without('supplierOrgId') }, { $group: { _id: '$supplierOrgId', name: { $first: '$supplier' }, n: { $sum: 1 } } }, { $sort: { n: -1 } }]).exec(),
    ]);
    const orgs = await this.h.connection.collection('organizations').find({ _id: { $in: suppliers.map((s) => s._id).filter(Boolean) } }, { projection: { name: 1, shortName: 1 } }).toArray();
    const orgName = new Map(orgs.map((o) => [String(o._id), String(o.shortName || o.name)]));
    return {
      years: years.map((y) => ({ value: y._id, n: y.n })),
      months: months.map((m) => ({ value: m._id, n: m.n })),
      categories: categories.map((c) => ({ value: c._id, n: c.n })),
      customers: customers.map((c) => ({ value: c._id, n: c.n })),
      suppliers: suppliers.filter((s) => s._id).map((s) => ({ value: String(s._id), label: orgName.get(String(s._id)) || s.name || '—', n: s.n })),
    };
  }
}
