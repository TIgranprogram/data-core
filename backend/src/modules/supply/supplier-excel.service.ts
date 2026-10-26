import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { createHash } from 'crypto';
import * as ExcelJS from 'exceljs';
import { SupplierItem } from './supplier-item.schema';

/** Распознанная строка прайса из Excel. */
export interface ExcelRow {
  article: string;
  name: string;
  color: string;
  qty: number;
  /** Единица (шт, м, кг, упак); пусто — «шт» (2026-10-26: прайс с метражом) */
  unit: string;
  optGroup: string;
  price: number | null;
  photoUrl: string | null;
}

/** Результат импорта. */
export interface ImportResult {
  rows: ExcelRow[];
  hash: string;
  supplierId: string;
  created?: number;
  catalogUpdated?: number;
  duplicate?: boolean;
}

/** Разбор «640,00 р.» / «8 200 р.» → число. */
function parseRuPrice(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null;
  const s = String(val).replace(/\s/g, '').replace(',', '.').replace(/[^0-9.]/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

/** Нормализует заголовок столбца для поиска. */
function norm(s: unknown): string {
  return String(s ?? '').toLowerCase().trim();
}

const COL_MAP: Record<string, keyof ExcelRow | 'qty' | 'skip'> = {
  'артикул': 'article',
  'описание': 'name',
  'наименование': 'name',
  'цвет': 'color',
  'кол-во': 'qty',
  'кол-во штук': 'qty',
  'количество': 'qty',
  'ед. изм.': 'unit',
  'ед.изм.': 'unit',
  'ед': 'unit',
  'ед.': 'unit',
  'единица': 'unit',
  'оптовая группа': 'optGroup',
  'цена за 1 штуку': 'price',
  'цена': 'price',
  'фото': 'skip',
  '№': 'skip',
  'сумма': 'skip',
};

@Injectable()
export class SupplierExcelService {
  constructor(
    @InjectModel(SupplierItem.name) private readonly itemModel: Model<SupplierItem>,
    @InjectConnection() private readonly conn: Connection,
  ) {}

  /** Разобрать Excel-буфер в строки. */
  async parse(buffer: Buffer): Promise<{ rows: ExcelRow[]; hash: string }> {
    const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 16);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);

    const ws = wb.worksheets[0];
    if (!ws) throw new BadRequestException('Excel: лист не найден');

    // Найти строку-заголовок (ищем «Артикул»)
    let headerRow = 0;
    const colIndex: Record<string, number> = {};
    ws.eachRow((row, rowNum) => {
      if (headerRow) return;
      row.eachCell((cell, colNum) => {
        const n = norm(cell.value);
        if (COL_MAP[n]) {
          colIndex[COL_MAP[n] as string] = colNum;
          headerRow = rowNum;
        }
      });
    });

    if (!headerRow || !colIndex['article']) {
      throw new BadRequestException('Excel: не найдена колонка «Артикул»');
    }

    const rows: ExcelRow[] = [];
    ws.eachRow((row, rowNum) => {
      if (rowNum <= headerRow) return;
      const article = String(row.getCell(colIndex['article'] ?? 0).value ?? '').trim();
      if (!article || article.toLowerCase().startsWith('итого') || article.toLowerCase().startsWith('стоимость')) return;
      rows.push({
        article,
        name: String(row.getCell(colIndex['name'] ?? 0).value ?? '').trim(),
        color: String(row.getCell(colIndex['color'] ?? 0).value ?? '').trim(),
        qty: parseRuPrice(row.getCell(colIndex['qty'] ?? 0).value) || 1, // пусто или 0 — одна единица
        unit: (colIndex['unit'] ? String(row.getCell(colIndex['unit']).value ?? '').trim() : '') || 'шт',
        optGroup: String(row.getCell(colIndex['optGroup'] ?? 0).value ?? '').trim(),
        price: parseRuPrice(row.getCell(colIndex['price'] ?? 0).value),
        photoUrl: null,
      });
    });

    return { rows, hash };
  }

  /** Предпросмотр: разобрать без сохранения. */
  async preview(buffer: Buffer, supplierId: string): Promise<ImportResult> {
    const { rows, hash } = await this.parse(buffer);
    return { rows, hash, supplierId };
  }

  /** Импорт: создать заявки + upsert каталог. */
  async apply(
    buffer: Buffer,
    supplierId: string,
    userId?: string,
  ): Promise<ImportResult> {
    const { rows, hash } = await this.parse(buffer);
    if (!rows.length) throw new BadRequestException('Excel: нет строк для импорта');

    const supplierOid = new Types.ObjectId(supplierId);

    // Проверка дубля по хэшу файла
    const existingDup = await this.conn
      .collection('supplyrequests')
      .findOne({ clientUid: `excel:${hash}:0`, deletedAt: null });
    if (existingDup) return { rows, hash, supplierId, duplicate: true };

    const now = new Date();
    let created = 0;
    let catalogUpdated = 0;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      // (а) Заявка снабжения
      const req: Record<string, unknown> = {
        title: r.name || r.article,
        article: r.article,
        color: r.color || null,
        qty: r.qty,
        unit: r.unit || 'шт',
        supplierId: supplierOid,
        status: 'in_progress',
        requestDate: now,
        priceHint: r.price ?? undefined,
        optGroup: r.optGroup || null,
        clientUid: `excel:${hash}:${i}`,
        createdBy: userId ? new Types.ObjectId(userId) : undefined,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      await this.conn.collection('supplyrequests').insertOne(req);
      created++;

      // (б) Upsert каталога
      if (r.article) {
        const filter = { supplierId: supplierOid, article: r.article, color: r.color || '' };
        const setFields: Record<string, unknown> = {
          name: r.name || r.article,
          optGroup: r.optGroup || null,
          source: 'excel',
          updatedAt: now,
        };
        const pushFields: Record<string, unknown> = {};

        // Обновляем цену только если она есть и изменилась
        if (r.price !== null) {
          const existing = await this.itemModel.findOne(filter).lean();
          if (!existing || existing.priceHint !== r.price) {
            setFields['priceHint'] = r.price;
            pushFields['priceHistory'] = { price: r.price, date: now, source: 'excel' };
          }
        }

        const updateDoc = Object.keys(pushFields).length
          ? { $set: setFields, $setOnInsert: { createdAt: now, deletedAt: null, priceHistory: [] }, $push: pushFields }
          : { $set: setFields, $setOnInsert: { createdAt: now, deletedAt: null, priceHistory: [] } };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await this.itemModel.collection.updateOne(filter, updateDoc as any, { upsert: true });
        catalogUpdated++;
      }
    }

    return { rows, hash, supplierId, created, catalogUpdated };
  }

  /** Каталог поставщиков — страница из supplieritems с именами поставщиков. */
  async listItems(q: Record<string, string | undefined>) {
    const page = Math.max(1, parseInt(String(q.page ?? '1'), 10) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(String(q.limit ?? '100'), 10) || 100));
    const skip = (page - 1) * limit;
    const filter: Record<string, unknown> = { deletedAt: null };
    if (q.supplierId) {
      const ids = String(q.supplierId).split(',').map((s) => s.trim()).filter((s) => Types.ObjectId.isValid(s)).map((s) => new Types.ObjectId(s));
      if (ids.length) filter.supplierId = { $in: ids };
    }
    if (q.search) {
      const re = new RegExp(String(q.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: re }, { article: re }];
    }
    const coll = this.itemModel.collection;
    const [docs, total] = await Promise.all([
      coll.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit).toArray(),
      coll.countDocuments(filter),
    ]);
    const supIds = [...new Set(docs.map((d) => String(d.supplierId)).filter(Boolean))].filter((s) => Types.ObjectId.isValid(s)).map((s) => new Types.ObjectId(s));
    const orgs = supIds.length ? await this.conn.db!.collection('organizations').find({ _id: { $in: supIds } }, { projection: { name: 1, shortName: 1 } }).toArray() : [];
    const names = new Map(orgs.map((o) => [String(o._id), String(o.shortName || o.name)]));
    const items = docs.map((d) => ({
      id: String(d._id),
      supplierId: String(d.supplierId),
      supplierName: names.get(String(d.supplierId)) ?? '',
      article: String(d.article ?? ''),
      name: String(d.name ?? ''),
      color: d.color ? String(d.color) : '',
      priceHint: typeof d.priceHint === 'number' ? d.priceHint : null,
      optGroup: d.optGroup ? String(d.optGroup) : '',
      updatedAt: d.updatedAt instanceof Date ? d.updatedAt.toISOString() : null,
    }));
    return { items, total, page, limit };
  }
}
