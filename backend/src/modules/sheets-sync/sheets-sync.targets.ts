import { Types, type Connection } from 'mongoose';
import { gramsToKg } from '../stock/weight';
import { parseSheetDate } from '../../common/date-parse';
import { CategoryResolver } from '../stock/category-resolver';
import type { StockService } from '../stock/stock.service';
import { incomeDerived } from '../incomes/income.schema';
import { ourCompanies } from '../incomes/incomes.service';
import { normTitle, orderKey } from '../salesorders/order-key';
import { ORDER_CACHE_FIELDS, findOrCreateOrder } from '../salesorders/order-link';
import { OrgResolver, normText } from '../supply/org-resolver';
import { priorityFromLabel, statusFromLabel } from '../supply/supply-labels';
import type { SheetTarget } from './sheets-sync.mapping';

type Doc = Record<string, unknown>;

/** Как строка листа ложится в общую коллекцию CRM. */
export interface TargetAdapter {
  collection: string;
  /** Поля CRM, которыми управляет лист (их и очищаем, если ячейку стёрли). */
  managedFields: string[];
  /** Удалять запись, если строку убрали из таблицы. Номенклатуру не удаляем: на неё ссылаются CRM и движения. */
  allowDelete: boolean;
  /** Строка листа → поля CRM (undefined — поле пустое). */
  toFields(row: Doc): Promise<Doc>;
  /** Запись без привязки к таблице, которую нужно «подхватить» (та же позиция, заведённая в приложении/CRM). */
  adopt?(row: Doc, fields: Doc): Promise<Doc | null>;
  /** Значения, обязательные при создании. */
  onCreate?(fields: Doc): Promise<Doc>;
  /** После записи (остаток позиции на складе). */
  afterWrite?(id: Types.ObjectId, row: Doc): Promise<void>;
  /** Строка не менялась, но запись можно досвязать (позиция склада появилась позже заявки). */
  relink?(cur: Doc, row: Doc): Promise<Doc | null>;
}

const str = (v: unknown) => { const s = String(v ?? '').trim(); return s || undefined; };
const num = (v: unknown) => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[\s\u00a0₽]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
};
const date = (v: unknown) => {
  const s = str(v);
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
};
const isUrl = (v: unknown) => /^https?:\/\//i.test(String(v ?? '').trim());
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Поля листа «Снабжение», у которых есть место в схеме CRM; остальные уходят в sheetExtra. */
const SUPPLY_KNOWN = new Set(['invoiceDate', 'num', 'date', 'category', 'name', 'unit', 'qty', 'requestedBy', 'article', 'color', 'supplier', 'customer', 'note', 'status', 'priority', 'ourCompany', 'delivery', 'invoiceNo', 'priceWithVat', 'link']);

export class SheetTargets {
  private readonly orgs: OrgResolver;
  private readonly cats: CategoryResolver;
  private materialsByName: Map<string, Types.ObjectId> | null = null;
  private ours: Array<{ id: Types.ObjectId; name: string; full: string }> | null = null;
  /** Шапки заказов, найденные/созданные за прогон: importKey → шапка. */
  private orders = new Map<string, Doc>();

  constructor(private readonly connection: Connection, private readonly stock: StockService) {
    this.orgs = new OrgResolver(connection);
    this.cats = new CategoryResolver(connection);
  }

  private async materialId(name: unknown): Promise<Types.ObjectId | undefined> {
    if (!this.materialsByName) {
      const all = await this.connection.db!.collection('materials').find({ deletedAt: null }, { projection: { name: 1 } }).toArray();
      this.materialsByName = new Map(all.map((m) => [normText(m.name), m._id as Types.ObjectId]));
    }
    return this.materialsByName.get(normText(name));
  }

  private rememberMaterial(name: unknown, id: Types.ObjectId) {
    this.materialsByName?.set(normText(name), id);
  }

  get(target: SheetTarget): TargetAdapter {
    if (target === 'supply') return this.supply();
    if (target === 'stock') return this.stockItems();
    if (target === 'movements') return this.movements();
    if (target === 'incomes') return this.incomes();
    throw new Error(`нет адаптера для ${target}`);
  }

  private supply(): TargetAdapter {
    return {
      collection: 'supplyrequests',
      allowDelete: true,
      managedFields: ['title', 'qty', 'unit', 'num', 'requestDate', 'categoryId', 'materialId', 'supplierId', 'companyId', 'orderLabel', 'requestedBy', 'article', 'color', 'productUrl', 'priceHint', 'invoiceNo', 'invoiceDate', 'deliveryNote', 'notes', 'status', 'paid', 'priority', 'sheetExtra'],
      toFields: async (r) => {
        const st = statusFromLabel(r.status);
        const extra: Doc = {};
        for (const [k, v] of Object.entries(r)) if (!SUPPLY_KNOWN.has(k)) extra[k] = v;
        if (r.link !== undefined && !isUrl(r.link)) extra.link = r.link;
        return {
          title: str(r.name), qty: num(r.qty) ?? 1, unit: str(r.unit), num: num(r.num), requestDate: date(r.date),
          categoryId: await this.cats.resolve(r.category), materialId: await this.materialId(r.name),
          supplierId: await this.orgs.resolve(r.supplier, 'supplier'), companyId: await this.orgs.resolve(r.ourCompany, 'own'),
          orderLabel: str(r.customer), requestedBy: str(r.requestedBy), article: str(r.article), color: str(r.color),
          productUrl: isUrl(r.link) ? str(r.link) : undefined, priceHint: num(r.priceWithVat),
          invoiceNo: str(r.invoiceNo), invoiceDate: parseSheetDate(r.invoiceDate), deliveryNote: str(r.delivery), notes: str(r.note),
          status: st?.status ?? 'requested', paid: !!st?.paid, priority: priorityFromLabel(r.priority) ?? 'normal',
          sheetExtra: Object.keys(extra).length ? extra : undefined,
        };
      },
      // АР.2: артикул из «Снабжения» → в позицию склада (если у неё пусто / автоартикул)
      afterWrite: async (_id, r) => {
        const mid = await this.materialId(r.name);
        if (mid && str(r.article)) await this.stock.adoptArticle(mid, str(r.article), `Google-таблица «Снабжение»${num(r.num) ? ', заявка №' + num(r.num) : ''}`).catch(() => undefined);
      },
      relink: async (cur, r) => {
        if (cur.materialId) return null;
        const id = await this.materialId(r.name);
        return id ? { materialId: id } : null;
      },
    };
  }

  private stockItems(): TargetAdapter {
    return {
      collection: 'materials',
      allowDelete: false,
      managedFields: ['name', 'unit', 'categoryId', 'weightKg', 'weightUnit'],
      toFields: async (r) => ({
        // «Вес 1 шт.» в листе «Склад» — в граммах (8; 16,5; 49), хотя заголовок «кг» (НО.0) → в поле кг делим на 1000
        name: str(r.name), unit: str(r.unit) ?? 'шт', categoryId: await this.cats.resolve(r.category), weightKg: gramsToKg(num(r.weightKg)), weightUnit: num(r.weightKg) === undefined ? undefined : 'kg',
      }),
      adopt: async (_r, f) => {
        const clean = String(f.name ?? '').trim().replace(/\s+/g, ' ');
        const re = new RegExp(`^\\s*${escapeRe(clean).replace(/ /g, '\\s+')}\\s*$`, 'i');
        return this.connection.db!.collection('materials').findOne({ name: re, deletedAt: null, sheetSource: { $exists: false } });
      },
      onCreate: async (f) => ({
        article: await this.stock.autoArticle(),
        sku: await this.stock.skuFor(f.categoryId as Types.ObjectId | undefined),
        dimensions: [], colors: [], photoIds: [], composition: [], pricePerUnit: 0, stockQty: 0, isSystem: false,
      }),
      afterWrite: async (id, r) => {
        this.rememberMaterial(r.name, id);
        if (str(r.article)) await this.stock.adoptArticle(id, str(r.article), 'Google-таблица, лист «Склад»').catch(() => undefined); // необязательная колонка «Артикул» (АР.2)
        const wh = await this.stock.defaultWarehouse();
        const set: Doc = { quantity: num(r.currentQty) ?? 0, reservedQty: num(r.reservedQty) ?? 0, minQuantity: num(r.minQty) ?? 0, updatedAt: new Date() };
        const w = gramsToKg(num(r.weightKg));
        if (w !== undefined) set.weightKg = w;
        await this.connection.db!.collection('storageitems').updateOne(
          { warehouseId: wh._id, materialId: id, zoneName: null },
          { $set: set, $setOnInsert: { warehouseId: wh._id, materialId: id, isActive: true, photos: [], deletedAt: null, createdAt: new Date() } },
          { upsert: true },
        );
      },
    };
  }

  private async ourCompany(v: unknown) {
    if (!this.ours) this.ours = await ourCompanies(this.connection);
    const company = normText(v);
    return company ? this.ours.find((c) => normText(c.name) === company || normText(c.full) === company) : undefined;
  }

  /**
   * Шапка заказа для строки листа «Заказы» (TASKS З.2): по ключу «компания|номер» найти или создать в salesorders.
   * Без номера заказа — без шапки.
   */
  private async orderFor(r: Doc): Promise<Doc | undefined> {
    const orderNo = str(r.orderNo);
    if (!orderNo) return undefined;
    const hit = await this.ourCompany(r.ourCompany);
    const key = orderKey(hit?.name ?? '', orderNo);
    let h = this.orders.get(key);
    if (!h) {
      h = await findOrCreateOrder(this.connection, {
        company: hit?.name ?? '', orderNo, companyId: hit?.id, customer: str(r.customer), paymentForm: str(r.paymentForm),
        shipDate: parseSheetDate(r.shipDate), source: 'google-sheets',
      });
      this.orders.set(key, h);
    }
    return h;
  }

  /** Лист «Заказы» → incomes. Наша компания — только существующая (СИЮ/ССЮ), новые не создаются. */
  private incomes(): TargetAdapter {
    return {
      collection: 'incomes',
      allowDelete: true,
      managedFields: ['orderId', 'orderNo', 'shipDate', 'paidDate', 'customer', 'companyId', 'paymentForm', 'title', 'qty', 'unit', 'kind', 'color', 'unitPrice', 'amountManual', 'notes', 'amount', 'reportDate'],
      toFields: async (r) => {
        const order = await this.orderFor(r);
        const fields: Doc = {
          orderId: order?._id, orderNo: str(r.orderNo), shipDate: parseSheetDate(r.shipDate), paidDate: parseSheetDate(r.paidDate), customer: str(r.customer),
          companyId: (await this.ourCompany(r.ourCompany))?.id,
          paymentForm: str(r.paymentForm), title: str(r.name), qty: num(r.qty), unit: str(r.unit), kind: str(r.kind), color: str(r.color),
          unitPrice: num(r.unitPrice), amountManual: num(r.amountManual), notes: str(r.note),
        };
        // шапку правили в приложении — её поля истина, строка листа их не перебивает
        if (order?.editedInApp) for (const k of ORDER_CACHE_FIELDS) fields[k] = order[k] ?? undefined;
        const d = incomeDerived(fields as Parameters<typeof incomeDerived>[0]);
        return { ...fields, amount: d.amount, reportDate: d.reportDate };
      },
      // позиция, заведённая импортом Excel/в приложении в том же заказе с тем же наименованием, — та же строка (без дубля)
      adopt: async (_r, f) => {
        if (!f.orderId) return null;
        const same = await this.connection.db!.collection('incomes').find({ orderId: f.orderId, deletedAt: null, sheetSource: { $exists: false } }).toArray();
        return same.find((d) => normTitle(d.title) === normTitle(f.title)) ?? null;
      },
      // строка не менялась, но шапки у неё ещё нет (строки, загруженные до З.2)
      relink: async (cur, r) => {
        if (cur.orderId) return null;
        const order = await this.orderFor(r);
        return order ? { orderId: order._id } : null;
      },
    };
  }

  private movements(): TargetAdapter {
    return {
      collection: 'stockmovements',
      allowDelete: true,
      managedFields: ['type', 'date', 'materialId', 'qty', 'notes', 'documentRef'],
      toFields: async (r) => {
        const op = String(r.operation ?? '').toLowerCase();
        const type = /приход|поступ/.test(op) ? 'in' : /спис|выдач|расход/.test(op) ? 'out' : 'adjust';
        const wh = await this.stock.defaultWarehouse();
        return {
          type, date: date(r.date) ?? new Date(), materialId: await this.materialId(r.itemName), warehouseId: wh._id,
          qty: Math.abs(num(r.qty) ?? 0), documentRef: `Google:${str(r.operation) ?? 'движение'}`,
          notes: [str(r.operation), str(r.customer), str(r.byName), str(r.note)].filter(Boolean).join(' · ') || undefined,
          cost: 0,
        };
      },
    };
  }
}
