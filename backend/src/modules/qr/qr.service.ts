import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import { Material } from '../material/material.schema';
import { Product } from '../../common/catalog/product.schema';
import { CODE_RE, makeCode, type QrType } from './qr-code';
import { QR_PRINT_MAX } from './dto';
import { renderQrSheet, type Sticker } from './qr-pdf';
import { QrCode } from './qr.schema';

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Коды QR: выдача (ensureCode — идемпотентно), чтение по коду, PDF наклеек. */
@Injectable()
export class QrService {
  constructor(
    @InjectModel(QrCode.name) private readonly codes: Model<QrCode>,
    @InjectModel(Material.name) private readonly materials: Model<Material>,
    @InjectModel(Product.name) private readonly products: Model<Product>,
  ) {}

  /** Код сущности: есть — вернуть тот же; нет — выдать. Гонка (11000) — перечитать; коллизия кода — новый код. */
  async ensureCode(type: QrType, id: string | Types.ObjectId): Promise<string> {
    const entityId = new Types.ObjectId(String(id));
    const find = () => this.codes.findOne({ entityType: type, entityId }).lean().exec() as Promise<Doc | null>;
    const have = await find();
    if (have) return have.code;
    for (let i = 0; i < 5; i++) {
      try {
        const created = await this.codes.create({ code: makeCode(type), entityType: type, entityId });
        return created.code;
      } catch (e) {
        if ((e as { code?: number }).code !== 11000) throw e;
        const again = await find();
        if (again) return again.code;
      }
    }
    throw new BadRequestException('Не удалось выдать QR-код, повторите');
  }

  /** GET /qr/:code — кто это; без цен. Удалённая позиция — `deleted: true`. */
  async resolve(code: string) {
    if (!CODE_RE.test(code)) throw new BadRequestException('Неверный QR-код');
    const row = (await this.codes.findOne({ code }).lean().exec()) as Doc | null;
    if (!row) throw new NotFoundException('QR-код не найден');
    const info = (await this.describe([{ type: row.entityType, id: String(row.entityId) }])).get(`${row.entityType}:${row.entityId}`);
    return {
      entityType: row.entityType as string, id: String(row.entityId),
      name: info?.name ?? null, article: info?.article ?? null, deleted: !info || info.deleted,
    };
  }

  /** PDF наклеек: коды выдаются тут же; порядок как в запросе. */
  async print(items: { type: QrType; id: string }[], skip = 0) {
    if (!items.length || items.length > QR_PRINT_MAX) throw new BadRequestException(`Наклеек за раз: от 1 до ${QR_PRINT_MAX}`);
    const info = await this.describe(items);
    const stickers: Sticker[] = [];
    for (const it of items) {
      const i = info.get(`${it.type}:${it.id}`);
      if (!i) throw new NotFoundException('Позиция не найдена');
      stickers.push({ code: await this.ensureCode(it.type, it.id), name: i.name, article: i.article });
    }
    return renderQrSheet(stickers, skip);
  }

  /** Название и артикул по (тип, id): S/M — materials, P — products (с удалёнными). */
  private async describe(items: { type: string; id: string }[]) {
    const out = new Map<string, { name: string; article: string | null; deleted: boolean }>();
    const pick = async (types: string[], model: Model<any>) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const want = items.filter((x) => types.includes(x.type));
      if (!want.length) return;
      const rows = (await model.find({ _id: { $in: want.map((x) => new Types.ObjectId(x.id)) } }).setOptions({ includeSoftDeleted: true }).lean().exec()) as Doc[];
      const by = new Map(rows.map((r) => [String(r._id), r]));
      for (const x of want) {
        const r = by.get(x.id);
        if (r) out.set(`${x.type}:${x.id}`, { name: String(r.name ?? r.fullName ?? r.sku ?? ''), article: (r.article ?? r.sku ?? null) as string | null, deleted: r.deletedAt != null });
      }
    };
    await Promise.all([pick(['S', 'M'], this.materials), pick(['P'], this.products)]);
    return out;
  }
}
