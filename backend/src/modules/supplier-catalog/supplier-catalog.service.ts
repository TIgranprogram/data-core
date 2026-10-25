import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  OnModuleInit,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import * as fs from 'fs';
import * as path from 'path';
import { Connection, Model, Types, isValidObjectId } from 'mongoose';
import { SupplierItem } from './schemas/supplier-item.schema';
import type { SupplierItemDocument } from './schemas/supplier-item.schema';
import { Organization } from '../organization/organization.schema';
import type { OrganizationDocument } from '../organization/organization.schema';
import { ZaglushkaAdapter } from './adapters/zaglushka.adapter';
import type { BaseAdapter, FetchFn, ParsedItem } from './adapters/base.adapter';
import { createSafeFetch, hostAllowed, isPrivateIp } from './safe-fetch';
import { escapeRe } from '../../common/list-query';

/** SSRF (синхронная часть): схема, localhost и IP-литералы приватных диапазонов. DNS и редиректы — в safe-fetch. */
export function checkSsrf(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new BadRequestException('Некорректный URL каталога');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BadRequestException('URL должен быть http или https');
  }
  const hostname = parsed.hostname;
  if (/^localhost$/i.test(hostname) || isPrivateIp(hostname)) {
    throw new BadRequestException(`URL ведёт на запрещённый адрес: ${hostname}`);
  }
  return parsed;
}

const BULK_BATCH_SIZE = 500;
/** Деактивировать пропавшие, только если собрано не меньше этой доли прежних активных */
const MIN_KEEP_RATIO = 0.5;
const MAX_PHOTOS_PER_ITEM = 5;
const PHOTO_DOWNLOAD_PAUSE_MS = 200;

function sanitizeArticle(article: string): string {
  return article.replace(/[^a-zA-Z0-9-]/g, '_');
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.promises.access(p);
    return true;
  } catch {
    return false;
  }
}

function extFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const ext = path.extname(pathname).toLowerCase();
    return ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext) ? ext : '.jpg';
  } catch {
    return '.jpg';
  }
}

@Injectable()
export class SupplierCatalogService implements OnModuleInit {
  private readonly logger = new Logger(SupplierCatalogService.name);
  /** orgId → true, пока идёт синхронизация */
  private readonly running = new Set<string>();
  /** Ход идущей синхронизации (в памяти): для полосы «идёт загрузка» в приложении. */
  private readonly progress = new Map<string, { startedAt: Date; items: number; prevTotal: number; adapter: ZaglushkaAdapter }>();

  /** Подменяется в тестах */
  fetchFn: FetchFn = (input, init) => fetch(input, init);

  /** Корень загрузок. В тестах можно подменить. */
  uploadsDir = path.join(process.cwd(), 'uploads');

  constructor(
    @InjectModel(SupplierItem.name)
    private readonly itemModel: Model<SupplierItemDocument>,
    @InjectModel(Organization.name)
    private readonly orgModel: Model<OrganizationDocument>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  /** Синхронизация, оборванная перезапуском, не должна висеть в статусе «running». */
  async onModuleInit(): Promise<void> {
    try {
      await this.orgModel.updateMany(
        { catalogSyncStatus: 'running' },
        { $set: { catalogSyncStatus: 'error', catalogSyncError: 'прервано перезапуском сервера' } },
      );
    } catch (e) {
      this.logger.warn(`reset running status failed: ${(e as Error).message}`);
    }
  }

  async startSync(orgId: string): Promise<{ status: 'running' }> {
    if (!isValidObjectId(orgId)) throw new BadRequestException('Некорректный id организации');
    if (this.running.has(orgId)) {
      throw new ConflictException('Синхронизация уже запущена');
    }
    const org = await this.orgModel.findById(orgId).lean().exec();
    if (!org) throw new NotFoundException('Организация не найдена');
    const catalogUrl = (org as Record<string, unknown>)['catalogUrl'] as string | undefined;
    if (!catalogUrl) throw new BadRequestException('У организации не задан catalogUrl');
    checkSsrf(catalogUrl);

    this.running.add(orgId);
    this.runSyncBackground(orgId, catalogUrl).catch((e) =>
      this.logger.error(`sync error orgId=${orgId}: ${(e as Error).message}`),
    );
    return { status: 'running' };
  }

  async getSyncStatus(orgId: string): Promise<{
    status: string;
    lastSyncAt?: Date | null;
    error?: string | null;
    total: number;
    progress?: { startedAt: Date; items: number; pages: number; queued: number; prevTotal: number; etaSec: number | null } | null;
  }> {
    if (!isValidObjectId(orgId)) throw new BadRequestException('Некорректный id организации');
    const org = await this.orgModel.findById(orgId).lean().exec();
    if (!org) throw new NotFoundException('Организация не найдена');
    const total = await this.itemModel.countDocuments({ supplierId: new Types.ObjectId(orgId), active: true });
    const o = org as Record<string, unknown>;
    return {
      status: this.running.has(orgId) ? 'running' : (o['catalogSyncStatus'] as string) ?? 'idle',
      lastSyncAt: o['lastCatalogSyncAt'] as Date | null | undefined,
      error: o['catalogSyncError'] as string | null | undefined,
      total,
      progress: this.progressOf(orgId),
    };
  }

  /**
   * Ход синхронизации: товаров, страниц пройдено / в очереди и примерный остаток (сек).
   * Остаток — по прошлому числу позиций (повторная загрузка) или по доле пройденных страниц (первая).
   */
  private progressOf(orgId: string) {
    const p = this.progress.get(orgId);
    if (!p || !this.running.has(orgId)) return null;
    const pages = p.adapter.visited;
    const queued = p.adapter.queued;
    const elapsed = (Date.now() - p.startedAt.getTime()) / 1000;
    let share = 0;
    if (p.prevTotal > 0 && p.items > 0) share = Math.min(0.99, p.items / p.prevTotal);
    else if (pages > 20) share = Math.min(0.99, pages / (pages + queued));
    const etaSec = share > 0.02 ? Math.round((elapsed / share) * (1 - share)) : null;
    return { startedAt: p.startedAt, items: p.items, pages, queued, prevTotal: p.prevTotal, etaSec };
  }

  /** Поставщики с позициями ИЛИ с заданной ссылкой каталога (новый поставщик виден до первой синхронизации). */
  async getSuppliers(): Promise<{ items: { id: string; name: string; itemCount: number }[] }> {
    const counts = (await this.itemModel.aggregate([
      { $match: { active: true } },
      { $group: { _id: '$supplierId', n: { $sum: 1 } } },
    ])) as { _id: Types.ObjectId; n: number }[];
    const countBy = new Map(counts.map((c) => [String(c._id), c.n]));
    const orgs = await this.orgModel
      .find(
        {
          deletedAt: null,
          $or: [{ _id: { $in: counts.map((c) => c._id) } }, { catalogUrl: { $type: 'string', $ne: '' } }],
        },
        { name: 1 },
      )
      .lean()
      .exec();
    const items = orgs.map((o) => {
      const org = o as Record<string, unknown>;
      const id = String(org['_id']);
      return { id, name: (org['name'] as string) || '', itemCount: countBy.get(id) ?? 0 };
    });
    return { items };
  }

  async listItems(opts: {
    supplierId?: string;
    q?: string;
    inStock?: string;
    page?: number;
    limit?: number;
  }): Promise<{ items: SupplierItemDocument[]; total: number; page: number; limit: number }> {
    // поставщик не выбран — позиции всех поставщиков (вход в «Каталог»); мусорный id — 400
    if (opts.supplierId && !isValidObjectId(opts.supplierId)) {
      throw new BadRequestException('Некорректный id поставщика');
    }
    if ((opts.page !== undefined && !Number.isInteger(opts.page)) || (opts.limit !== undefined && !Number.isInteger(opts.limit))) {
      throw new BadRequestException('page и limit должны быть целыми числами');
    }
    const page = Math.min(100_000, Math.max(1, opts.page ?? 1));
    const limit = Math.min(200, Math.max(1, opts.limit ?? 50));
    const filter: Record<string, unknown> = { active: true };
    if (opts.supplierId) filter['supplierId'] = new Types.ObjectId(opts.supplierId);
    if (opts.inStock === '1') filter['inStock'] = true;
    else if (opts.inStock === '0') filter['inStock'] = { $ne: true };
    if (opts.q) {
      const re = new RegExp(escapeRe(opts.q), 'i');
      filter['$or'] = [{ name: re }, { vendorArticle: re }];
    }
    const [items, total] = await Promise.all([
      this.itemModel.find(filter).skip((page - 1) * limit).limit(limit).lean().exec(),
      this.itemModel.countDocuments(filter),
    ]);
    return { items: items as SupplierItemDocument[], total, page, limit };
  }

  private async runSyncBackground(orgId: string, catalogUrl: string): Promise<void> {
    await this.orgModel.updateOne(
      { _id: orgId },
      { $set: { catalogSyncStatus: 'running', catalogSyncError: null } },
    );
    const runStart = new Date();
    const supplierId = new Types.ObjectId(orgId);
    const adapter = this.resolveAdapter(catalogUrl);
    const safeFetch = createSafeFetch(this.fetchFn, adapter.hosts ?? []);

    // Папка для фото поставщика
    const supplierUploadsDir = path.join(this.uploadsDir, 'suppliers', orgId);
    fs.mkdirSync(supplierUploadsDir, { recursive: true });

    try {
      const prevActive = await this.itemModel.countDocuments({ supplierId, active: true });
      let collected = 0;
      const prog = { startedAt: runStart, items: 0, prevTotal: prevActive, adapter };
      this.progress.set(orgId, prog);
      const ops: Parameters<typeof this.itemModel.bulkWrite>[0] = [];

      for await (const item of adapter.fetchItems(catalogUrl, safeFetch)) {
        if (item.sourceUrl) {
          try { checkSsrf(item.sourceUrl); } catch { /* пропускаем */ }
        }

        const localPhotoPaths = await this.downloadPhotos(
          item,
          supplierUploadsDir,
          orgId,
          adapter,
          safeFetch,
        );
        collected++;
        prog.items = collected;

        const doc = this.parsedToDoc(item, supplierId, localPhotoPaths, runStart);
        ops.push({
          updateOne: {
            filter: { supplierId, vendorArticle: item.vendorArticle, organizationId: { $exists: false } },
            update: { $set: doc },
            upsert: true,
          },
        });

        if (ops.length >= BULK_BATCH_SIZE) {
          await this.itemModel.bulkWrite(ops.splice(0, BULK_BATCH_SIZE), { ordered: false });
        }
      }

      if (ops.length > 0) {
        await this.itemModel.bulkWrite(ops, { ordered: false });
      }

      // Пропавшие → active:false, только если обход полный и собрано не меньше половины прежнего
      if (adapter.complete && collected >= prevActive * MIN_KEEP_RATIO) {
        await this.itemModel.updateMany(
          { supplierId, syncedAt: { $lt: runStart }, active: true },
          { $set: { active: false } },
        );
      } else {
        this.logger.warn(
          `sync orgId=${orgId}: обход неполный (complete=${adapter.complete}, собрано ${collected} из ${prevActive}) — деактивация пропущена`,
        );
      }

      await this.orgModel.updateOne(
        { _id: orgId },
        { $set: { catalogSyncStatus: 'ok', lastCatalogSyncAt: new Date(), catalogSyncError: null } },
      );
      this.logger.log(`sync ok orgId=${orgId}`);
    } catch (err) {
      const msg = (err as Error).message ?? 'unknown';
      await this.orgModel.updateOne(
        { _id: orgId },
        { $set: { catalogSyncStatus: 'error', catalogSyncError: msg } },
      );
      this.logger.error(`sync failed orgId=${orgId}: ${msg}`);
    } finally {
      this.running.delete(orgId);
      this.progress.delete(orgId);
    }
  }

  private async downloadPhotos(
    item: ParsedItem,
    supplierUploadsDir: string,
    orgId: string,
    adapter: BaseAdapter & { fetchRaw(url: string, fetchFn: FetchFn): Promise<Buffer | null> },
    fetchFn: FetchFn,
  ): Promise<string[]> {
    const externalUrls = (item.photoUrls ?? [])
      .filter((u) => u.startsWith('https://'))
      .slice(0, MAX_PHOTOS_PER_ITEM);

    const localPaths: string[] = [];
    const safeArticle = sanitizeArticle(item.vendorArticle);

    for (let i = 0; i < externalUrls.length; i++) {
      const url = externalUrls[i];
      try {
        const ext = extFromUrl(url);
        const filename = `${safeArticle}_${i + 1}${ext}`;
        const fullPath = path.join(supplierUploadsDir, filename);
        if (!(await fileExists(fullPath))) {
          const buf = await adapter.fetchRaw(url, fetchFn);
          if (!buf) continue;
          await fs.promises.writeFile(fullPath, buf);
        }
        localPaths.push(`/uploads/suppliers/${orgId}/${filename}`);
      } catch (err) {
        this.logger.warn(`photo download failed ${url}: ${(err as Error).message}`);
      }
      if (i < externalUrls.length - 1) {
        await new Promise((r) => setTimeout(r, PHOTO_DOWNLOAD_PAUSE_MS));
      }
    }
    return localPaths;
  }

  private parsedToDoc(
    item: ParsedItem,
    supplierId: Types.ObjectId,
    localPhotoPaths: string[],
    syncedAt: Date,
  ): Partial<SupplierItem> {
    return {
      supplierId,
      vendorArticle: item.vendorArticle,
      name: item.name,
      description: item.description,
      priceRetail: item.priceRetail,
      prices: item.prices,
      photoUrls: localPhotoPaths.length > 0 ? localPhotoPaths : undefined,
      sourceUrl: item.sourceUrl,
      specs: item.specs ? new Map(Object.entries(item.specs)) : undefined,
      inStock: item.inStock,
      stockQty: item.stockQty,
      unit: item.unit,
      category: item.category,
      syncedAt,
      active: true,
    };
  }

  private resolveAdapter(catalogUrl: string): ZaglushkaAdapter {
    const host = new URL(catalogUrl).hostname;
    if (hostAllowed(host, ['zaglushka.ru'])) return new ZaglushkaAdapter();
    throw new BadRequestException(`Адаптер для ${host} не поддерживается`);
  }
}
