import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import {
  TemplateBlock,
  TemplateBlockDocument,
} from '../template-block/template-block.schema';

const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FILE_GRACE_MS = 24 * 60 * 60 * 1000;

/** Exact shape of persisted block-photo URLs (must match TemplateBlockService). */
const BLOCK_IMAGE_URL_RE =
  /^\/uploads\/template-blocks\/[a-f0-9]{24}\/[a-f0-9-]{36}\.(png|jpg|webp)$/;

/**
 * TZ-DOC-STUDIO-1801 — scheduled sweep of unreferenced template-block uploads.
 * Uses setInterval (no @nestjs/schedule dependency).
 */
@Injectable()
export class UploadsOrphanSweepService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UploadsOrphanSweepService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @InjectModel(TemplateBlock.name)
    private readonly blockModel: Model<TemplateBlockDocument>,
  ) {}

  onModuleInit(): void {
    if (process.env.UPLOADS_ORPHAN_SWEEP_DISABLED === '1') {
      this.logger.log('Upload orphan sweep disabled (UPLOADS_ORPHAN_SWEEP_DISABLED=1)');
      return;
    }
    const intervalMs = Number(process.env.UPLOADS_ORPHAN_SWEEP_INTERVAL_MS ?? SWEEP_INTERVAL_MS);
    this.timer = setInterval(() => {
      void this.sweep().catch((err) => {
        this.logger.error(`Upload orphan sweep failed: ${(err as Error).message}`);
      });
    }, intervalMs);
    this.timer.unref?.();
    this.logger.log(`Upload orphan sweep scheduled every ${intervalMs}ms`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Public for tests and manual invocation. */
  async sweep(): Promise<{ scanned: number; deleted: number }> {
    const root = join(process.cwd(), 'uploads', 'template-blocks');
    let scanned = 0;
    let deleted = 0;

    const referenced = await this.collectReferencedUrls();
    const now = Date.now();

    let blockDirs: string[];
    try {
      blockDirs = await fs.readdir(root);
    } catch {
      return { scanned, deleted };
    }

    for (const blockDir of blockDirs) {
      const dirPath = join(root, blockDir);
      let stat;
      try {
        stat = await fs.stat(dirPath);
      } catch {
        continue;
      }
      if (!stat.isDirectory()) continue;

      let files: string[];
      try {
        files = await fs.readdir(dirPath);
      } catch {
        continue;
      }

      for (const file of files) {
        scanned++;
        const publicUrl = `/uploads/template-blocks/${blockDir}/${file}`;
        if (!BLOCK_IMAGE_URL_RE.test(publicUrl)) continue;
        if (referenced.has(publicUrl)) continue;

        const filePath = join(dirPath, file);
        let fileStat;
        try {
          fileStat = await fs.stat(filePath);
        } catch {
          continue;
        }
        if (now - fileStat.mtimeMs < FILE_GRACE_MS) continue;

        await fs.unlink(filePath).catch(() => undefined);
        deleted++;
      }
    }

    if (deleted > 0) {
      this.logger.log(`Upload orphan sweep: deleted ${deleted}/${scanned} file(s)`);
    }
    return { scanned, deleted };
  }

  private async collectReferencedUrls(): Promise<Set<string>> {
    const rows = await this.blockModel
      .find({ 'settings.imageUrl': { $type: 'string' } })
      .select('settings.imageUrl')
      .lean()
      .exec();

    const referenced = new Set<string>();
    for (const row of rows) {
      const imageUrl = (row.settings as Record<string, unknown> | undefined)?.['imageUrl'];
      if (typeof imageUrl === 'string' && BLOCK_IMAGE_URL_RE.test(imageUrl)) {
        referenced.add(imageUrl);
      }
    }
    return referenced;
  }
}
