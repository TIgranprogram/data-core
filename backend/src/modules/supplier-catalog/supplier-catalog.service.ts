import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import * as fs from 'fs';
import * as path from 'path';
import { Connection, Model, Types } from 'mongoose';
import { SupplierItem } from './schemas/supplier-item.schema';
import type { SupplierItemDocument } from './schemas/supplier-item.schema';
import { Organization } from '../organization/organization.schema';
import type { OrganizationDocument } from '../organization/organization.schema';
import { ZaglushkaAdapter } from './adapters/zaglushka.adapter';
import type { FetchFn, ParsedItem } from './adapters/base.adapter';

/** SSRF: запрещённые диапазоны и имена хостов */
const BLOCKED_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^::1$/,
  /^0\.0\.0\.0$/,
];

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
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(hostname)) {
      throw new BadRequestException(`URL ведёт на запрещённый адрес: ${hostname}`);
    }
  }
  return parsed;
}

const BULK_BATCH_SIZE = 500;
const MAX_PHOTOS_PER_ITEM = 5;
const PHOTO_DOWNLOAD_PAUSE_MS = 200;

function sanitizeArticle(article: string): string {
  return article.replace(/[^a-zA-Z0-9-]/g, '_');
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
export class SupplierCatalogService {
  private readonly logger = new Logger(SupplierCatalogService.name);
  /** orgId → true, пока идёт синхронизация */
  private readonly running = new Set<string>();

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

  async startSync(orgId: string): Promise<{ status: 'running' }> {
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
  }> {
    const org = await this.orgModel.findById(orgId).lean().exec();
    if (!org) throw new NotFoundException('Организация не найдена');
    const total = await this.itemModel.countDocuments({ supplierId: new Types.ObjectId(orgId), active: true });
    const o = org as Record<string, unknown>;
    return {
      status: this.running.has(orgId) ? 'running' : (o['catalogSyncStatus'] as string) ?? 'idle',
      lastSyncAt: o['lastCatalogSyncAt'] as Date | null | undefined,
      error: o['catalogSyncError'] as string | null | undefined,
      total,
    };
  }

  async getSuppliers(): Promise<{ items: { id: string; name: string }[] }> {
    const ids = await this.itemModel.distinct('supplierId', { active: true }).exec();
    if (!ids.length) return { items: [] };
    const orgs = await this.orgModel
      .find({ _id: { $in: ids } }, { name: 1 })
      .lean()
      .exec();
    const items = orgs.map((o) => {
      const org = o as Record<string, unknown>;
      return { id: String(org['_id']), name: (org['name'] as string) || '' };
    });
    return { items };
  }

  async listItems(opts: {
    supplierId: string;
    q?: string;
    page?: number;
    limit?: number;
  }): Promise<{ items: SupplierItemDocument[]; total: number; page: number; limit: number }> {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(200, Math.max(1, opts.limit ?? 50));
    const filter: Record<string, unknown> = {
      supplierId: new Types.ObjectId(opts.supplierId),
      active: true,
    };
    if (opts.q) {
      const re = new RegExp(opts.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
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

    // Папка для фото поставщика
    const supplierUploadsDir = path.join(this.uploadsDir, 'suppliers', orgId);
    fs.mkdirSync(supplierUploadsDir, { recursive: true });

    try {
      const ops: Parameters<typeof this.itemModel.bulkWrite>[0] = [];

      for await (const item of adapter.fetchItems(catalogUrl, this.fetchFn)) {
        if (item.sourceUrl) {
          try { checkSsrf(item.sourceUrl); } catch { /* пропускаем */ }
        }

        const localPhotoPaths = await this.downloadPhotos(
          item,
          supplierUploadsDir,
          orgId,
          adapter,
        );

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

      // Помечаем пропавшие active:false
      await this.itemModel.updateMany(
        { supplierId, syncedAt: { $lt: runStart }, active: true },
        { $set: { active: false } },
      );

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
    }
  }

  private async downloadPhotos(
    item: ParsedItem,
    supplierUploadsDir: string,
    orgId: string,
    adapter: ZaglushkaAdapter,
  ): Promise<string[]> {
    const externalUrls = (item.photoUrls ?? [])
      .filter((u) => u.startsWith('https://'))
      .slice(0, MAX_PHOTOS_PER_ITEM);

    const localPaths: string[] = [];
    const safeArticle = sanitizeArticle(item.vendorArticle);

    for (let i = 0; i < externalUrls.length; i++) {
      const url = externalUrls[i];
      try {
        const buf = await adapter.fetchRaw(url, this.fetchFn);
        if (!buf) continue;
        const ext = extFromUrl(url);
        const filename = `${safeArticle}_${i + 1}${ext}`;
        const fullPath = path.join(supplierUploadsDir, filename);
        fs.writeFileSync(fullPath, buf);
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
    if (host.includes('zaglushka.ru')) return new ZaglushkaAdapter();
    throw new BadRequestException(`Адаптер для ${host} не поддерживается`);
  }
}
