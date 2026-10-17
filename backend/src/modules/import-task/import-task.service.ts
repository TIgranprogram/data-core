import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import {
  CreateImportTaskDto,
  PatchImportTaskProposalsDto,
  PatchImportTaskReportDto,
  PatchImportTaskRowsDto,
  PatchImportTaskStatusDto,
} from './dto/create-import-task.dto';
import {
  AiReport,
  IMPORT_TASK_TERMINAL,
  ImportTask,
  ImportTaskDocument,
  ImportTaskStatus,
} from './import-task.schema';

const MAX_ROWS = 2000; // TZD-18: bulk опт — было 500

@Injectable()
export class ImportTaskService {
  constructor(
    @InjectModel(ImportTask.name)
    private readonly model: Model<ImportTaskDocument>,
  ) {}

  /**
   * Create ImportTask in ready_for_ai. Never touches Material or mutation journal.
   */
  async create(dto: CreateImportTaskDto, user: AuthenticatedUser) {
    if (!user?.id || !Types.ObjectId.isValid(user.id)) {
      throw new ForbiddenException('Authenticated user required');
    }
    if (!dto.rows?.length || dto.rows.length > MAX_ROWS) {
      throw new BadRequestException(
        `rows.length must be 1..${MAX_ROWS} — split the file (cap TZD-18)`,
      );
    }

    const orgId =
      user.organizationId && Types.ObjectId.isValid(user.organizationId)
        ? new Types.ObjectId(user.organizationId)
        : undefined;

    const unnamed = dto.rows.filter((r) => !r.name?.trim()).length;
    const summary =
      dto.summary?.trim() ||
      `${dto.source.fileName} · ${dto.rows.length} строк` +
        (unnamed > 0 ? ` · без имени: ${unnamed}` : '');

    const doc = await this.model.create({
      createdByUserId: new Types.ObjectId(user.id),
      organizationId: orgId,
      source: dto.source,
      status: 'ready_for_ai' as ImportTaskStatus,
      rows: dto.rows,
      summary,
      aiReport: null,
      proposalIds: [],
    });

    return this.toFullView(doc);
  }

  async list(
    user: AuthenticatedUser,
    opts: { status?: string; page?: number; limit?: number } = {},
  ) {
    this.requireUser(user);
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(100, Math.max(1, opts.limit ?? 20));
    const filter = this.orgFilter(user);
    if (opts.status) {
      (filter as Record<string, unknown>).status = opts.status;
    }

    const [rawItems, total] = await Promise.all([
      this.model
        .aggregate([
          { $match: filter },
          { $sort: { createdAt: -1 } },
          { $skip: (page - 1) * limit },
          { $limit: limit },
          {
            $project: {
              source: 1,
              status: 1,
              summary: 1,
              createdAt: 1,
              updatedAt: 1,
              rowCount: { $size: { $ifNull: ['$rows', []] } },
            },
          },
        ])
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    return {
      items: rawItems.map((d) => this.toListItem(d)),
      total,
      page,
      limit,
    };
  }

  async getById(id: string, user: AuthenticatedUser) {
    const doc = await this.findScoped(id, user);
    return this.toFullView(doc);
  }

  async patchStatus(
    id: string,
    dto: PatchImportTaskStatusDto,
    user: AuthenticatedUser,
  ) {
    const doc = await this.findScoped(id, user);
    const from = doc.status as ImportTaskStatus;
    const to = dto.status as ImportTaskStatus;
    this.assertTransition(from, to);

    doc.status = to;
    if (to === 'failed') {
      doc.errorMessage =
        dto.errorMessage?.trim() || doc.errorMessage || 'failed';
    } else if (to === 'ready_for_ai') {
      doc.errorMessage = undefined;
    } else if (dto.errorMessage !== undefined) {
      doc.errorMessage = dto.errorMessage?.trim() || undefined;
    }
    await doc.save();
    return this.toFullView(doc);
  }

  /**
   * TZD-23 — persist the AI matching plan + move to analyzing/awaiting_user.
   * Only aiReport/summary/status are touched; rows and source stay intact
   * (the DTO whitelist rejects any attempt to patch rows).
   */
  async patchReport(
    id: string,
    dto: PatchImportTaskReportDto,
    user: AuthenticatedUser,
  ) {
    const doc = await this.findScoped(id, user);
    const to = dto.status as ImportTaskStatus;
    this.assertTransition(doc.status as ImportTaskStatus, to);

    const report: AiReport = {
      version: dto.aiReport?.version ?? 1,
      matchedAt: dto.aiReport?.matchedAt ?? new Date().toISOString(),
      counts: dto.aiReport?.counts ?? { new: 0, skip: 0, update: 0, doubt: 0 },
      rows: dto.aiReport?.rows ?? [],
    };
    doc.aiReport = report;
    if (dto.summary !== undefined) {
      doc.summary = dto.summary.trim() || doc.summary;
    }
    doc.status = to;
    await doc.save();
    return this.toFullView(doc);
  }

  /**
   * TZD-23 — link created proposal ids + move to applying/done/failed.
   * Called by apply_plan after HITL ok. No Material writes here.
   */
  async patchProposals(
    id: string,
    dto: PatchImportTaskProposalsDto,
    user: AuthenticatedUser,
  ) {
    const doc = await this.findScoped(id, user);
    if (dto.proposalIds.some((p) => !Types.ObjectId.isValid(p))) {
      throw new BadRequestException('proposalIds must be valid ObjectIds');
    }
    doc.proposalIds = dto.proposalIds.map((p) => new Types.ObjectId(p));
    if (dto.rowProposals?.length && doc.aiReport?.rows?.length) {
      const byRowIndex = new Map(dto.rowProposals.map((r) => [r.rowIndex, r.proposalId]));
      doc.aiReport.rows = doc.aiReport.rows.map((row) => {
        const proposalId = byRowIndex.get(row.rowIndex);
        return proposalId ? { ...row, proposalId } : row;
      });
      doc.markModified('aiReport');
    }
    if (dto.status) {
      const to = dto.status as ImportTaskStatus;
      this.assertTransition(doc.status as ImportTaskStatus, to);
      doc.status = to;
    }
    await doc.save();
    return this.toFullView(doc);
  }

  /**
   * TZD-26 — safe AI reshape: replace rows + columnMap/reshapeNote.
   * Allowed only pre-apply (draft | ready_for_ai | analyzing | awaiting_user).
   * Resets aiReport so the agent MUST re-audit / re-match (TZD-23 set_report)
   * before any apply_plan. Zero journal writes.
   */
  async patchRows(
    id: string,
    dto: PatchImportTaskRowsDto,
    user: AuthenticatedUser,
  ) {
    const doc = await this.findScoped(id, user);
    const status = doc.status as ImportTaskStatus;
    if (status !== 'draft' && status !== 'ready_for_ai' && status !== 'analyzing' && status !== 'awaiting_user') {
      throw new BadRequestException(
        `Cannot reshape task in status «${status}» — only draft/ready_for_ai/analyzing/awaiting_user`,
      );
    }
    doc.rows = dto.rows;
    doc.columnMap = dto.columnMap ?? null;
    doc.reshapeNote = dto.reshapeNote?.trim() || undefined;
    // Stale plan — force re-match after reshape.
    doc.aiReport = null;
    await doc.save();
    return this.toFullView(doc);
  }

  /** Soft cancel → status cancelled (preferred over hard delete). */
  async cancel(id: string, user: AuthenticatedUser) {
    return this.patchStatus(id, { status: 'cancelled' }, user);
  }

  private requireUser(user: AuthenticatedUser) {
    if (!user?.id || !Types.ObjectId.isValid(user.id)) {
      throw new ForbiddenException('Authenticated user required');
    }
  }

  private orgFilter(user: AuthenticatedUser): Record<string, unknown> {
    if (user.organizationId && Types.ObjectId.isValid(user.organizationId)) {
      return { organizationId: new Types.ObjectId(user.organizationId) };
    }
    return { createdByUserId: new Types.ObjectId(user.id) };
  }

  private async findScoped(id: string, user: AuthenticatedUser) {
    this.requireUser(user);
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid import task id');
    }
    const doc = await this.model.findById(id).exec();
    if (!doc) throw new NotFoundException('Import task not found');

    const filter = this.orgFilter(user);
    if (filter.organizationId) {
      if (
        !doc.organizationId ||
        doc.organizationId.toString() !==
          (filter.organizationId as Types.ObjectId).toString()
      ) {
        throw new NotFoundException('Import task not found');
      }
    } else if (doc.createdByUserId.toString() !== user.id) {
      throw new NotFoundException('Import task not found');
    }
    return doc;
  }

  /**
   * Whitelist (TZD-22):
   * - ready_for_ai ↔ cancelled
   * - any non-terminal → failed | analyzing | awaiting_user | applying | done | …
   * - no matching auto-logic
   */
  private assertTransition(from: ImportTaskStatus, to: ImportTaskStatus) {
    if (from === to) return;
    if (from === 'cancelled' && to === 'ready_for_ai') return;
    if (IMPORT_TASK_TERMINAL.has(from)) {
      throw new BadRequestException(
        `Cannot transition from terminal status «${from}» to «${to}»`,
      );
    }
  }

  private toListItem(d: Record<string, any>) {
    return {
      id: String(d._id),
      source: {
        fileName: d.source?.fileName,
        fileType: d.source?.fileType,
      },
      status: d.status,
      summary: d.summary ?? null,
      rowCount: typeof d.rowCount === 'number' ? d.rowCount : 0,
      createdAt: d.createdAt ?? null,
      updatedAt: d.updatedAt ?? null,
    };
  }

  private toFullView(doc: ImportTaskDocument | Record<string, any>) {
    const d: any =
      typeof (doc as any).toObject === 'function'
        ? (doc as any).toObject()
        : doc;
    return {
      id: String(d._id),
      createdByUserId: d.createdByUserId ? String(d.createdByUserId) : null,
      organizationId: d.organizationId ? String(d.organizationId) : null,
      source: d.source,
      status: d.status,
      summary: d.summary ?? null,
      rows: d.rows ?? [],
      rowCount: Array.isArray(d.rows) ? d.rows.length : 0,
      aiReport: d.aiReport ?? null,
      columnMap: d.columnMap ?? null,
      reshapeNote: d.reshapeNote ?? null,
      proposalIds: (d.proposalIds ?? []).map((x: Types.ObjectId | string) =>
        String(x),
      ),
      errorMessage: d.errorMessage ?? null,
      createdAt: d.createdAt ?? null,
      updatedAt: d.updatedAt ?? null,
    };
  }
}
