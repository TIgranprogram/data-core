import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { MaterialService } from '../material/material.service';
import { CreateMaterialDto } from '../material/dto/create-material.dto';
import { UpdateMaterialDto } from '../material/dto/update-material.dto';
import { ProductService } from '../product/product.service';
import { CreateProductDto } from '../product/dto/create-product.dto';
import { UpdateProductDto } from '../product/dto/update-product.dto';
import { CounterpartyService } from '../counterparty/counterparty.service';
import { CreateCounterpartyDto } from '../counterparty/dto/create-counterparty.dto';
import { SiteService } from '../site/site.service';
import { CreateSiteDto } from '../site/dto/create-site.dto';
import { OrderService } from '../order/order.service';
import { CreateOrderDto } from '../order/dto/create-order.dto';
import {
  CreateProposalDto,
  ProposeBatchDto,
  ProposalIdsBatchDto,
} from './dto/create-proposal.dto';
import {
  MutationJournal,
  MutationJournalDocument,
} from './mutation-journal.schema';

const DEFAULT_RING = 50;
const PROPOSAL_TTL_MS = 60 * 60 * 1000;

function leanMaterial(doc: { toObject?: () => Record<string, unknown> } | Record<string, unknown> | null): Record<string, unknown> | null {
  if (!doc) return null;
  if (typeof (doc as { toObject?: () => Record<string, unknown> }).toObject === 'function') {
    return (doc as { toObject: () => Record<string, unknown> }).toObject();
  }
  return { ...(doc as Record<string, unknown>) };
}

@Injectable()
export class MutationJournalService {
  private readonly logger = new Logger(MutationJournalService.name);
  private readonly ringSize: number;

  constructor(
    @InjectModel(MutationJournal.name)
    private readonly model: Model<MutationJournalDocument>,
    private readonly materials: MaterialService,
    private readonly products: ProductService,
    private readonly counterparties: CounterpartyService,
    private readonly sites: SiteService,
    private readonly orders: OrderService,
  ) {
    const raw = Number(process.env.MUTATION_JOURNAL_RING_SIZE ?? DEFAULT_RING);
    this.ringSize = Number.isFinite(raw) && raw >= 1 ? Math.min(200, Math.floor(raw)) : DEFAULT_RING;
  }

  async propose(dto: CreateProposalDto, user: AuthenticatedUser) {
    if (!user?.id || !Types.ObjectId.isValid(user.id)) {
      throw new ForbiddenException('Authenticated user required');
    }

    const toolName = dto.toolName ?? 'kppdf_propose_material';
    const orgId =
      user.organizationId && Types.ObjectId.isValid(user.organizationId)
        ? new Types.ObjectId(user.organizationId)
        : undefined;

    // single propose → no idempotency marker
    return this.proposeOne(dto, user, orgId, toolName);
  }

  private async proposeOne(
    dto: CreateProposalDto,
    user: AuthenticatedUser,
    orgId: Types.ObjectId | undefined,
    toolName: string,
    idempotencyKey?: string,
  ) {

    if (dto.kind === 'material.create') {
      if (!dto.create?.name?.trim()) {
        throw new BadRequestException('create.name is required for material.create');
      }
      const payload = {
        ...dto.create,
        unit: dto.create.unit?.trim() || 'шт',
      };
      const doc = await this.model.create({
        status: 'proposed',
        kind: dto.kind,
        toolName,
        actorUserId: new Types.ObjectId(user.id),
        organizationId: orgId,
        entityType: 'Material',
        payload,
        before: null,
        after: null,
        expiresAt: new Date(Date.now() + PROPOSAL_TTL_MS),
        ...(idempotencyKey ? { idempotencyKey } : {}),
      });
      return this.toProposalView(doc);
    }

    if (dto.kind === 'material.update') {
      if (!dto.update?.id || !dto.update?.patch || typeof dto.update.patch !== 'object') {
        throw new BadRequestException('update.id and update.patch required for material.update');
      }
      const existing = await this.materials.findById(dto.update.id);
      const before = leanMaterial(existing);
      const doc = await this.model.create({
        status: 'proposed',
        kind: dto.kind,
        toolName,
        actorUserId: new Types.ObjectId(user.id),
        organizationId: orgId,
        entityType: 'Material',
        entityId: new Types.ObjectId(dto.update.id),
        payload: { id: dto.update.id, patch: dto.update.patch },
        before,
        after: null,
        expiresAt: new Date(Date.now() + PROPOSAL_TTL_MS),
        ...(idempotencyKey ? { idempotencyKey } : {}),
      });
      return this.toProposalView(doc);
    }

    // ── TZD-27: product passport proposes ────────────────────────────────────
    if (dto.kind === 'product.create') {
      const p = dto.productCreate;
      if (!p?.name?.trim()) {
        throw new BadRequestException('productCreate.name is required for product.create');
      }
      if (!p.kind) {
        throw new BadRequestException('productCreate.kind is required for product.create (good|service|work)');
      }
      const payload = {
        name: p.name.trim(),
        kind: p.kind,
        unit: p.unit?.trim() || 'шт',
        ...(p.sku ? { sku: p.sku } : {}),
        ...(p.notes ? { notes: p.notes } : {}),
        ...(p.categoryId ? { categoryId: p.categoryId } : {}),
        ...(p.status ? { status: p.status } : {}),
      };
      const doc = await this.model.create({
        status: 'proposed',
        kind: dto.kind,
        toolName,
        actorUserId: new Types.ObjectId(user.id),
        organizationId: orgId,
        entityType: 'Product',
        payload,
        before: null,
        after: null,
        expiresAt: new Date(Date.now() + PROPOSAL_TTL_MS),
        ...(idempotencyKey ? { idempotencyKey } : {}),
      });
      return this.toProposalView(doc);
    }

    if (dto.kind === 'product.update') {
      if (!dto.productUpdate?.id || !dto.productUpdate?.patch || typeof dto.productUpdate.patch !== 'object') {
        throw new BadRequestException(
          'productUpdate.id and productUpdate.patch required for product.update',
        );
      }
      const existing = await this.products.findById(dto.productUpdate.id);
      const before = leanMaterial(existing);
      const doc = await this.model.create({
        status: 'proposed',
        kind: dto.kind,
        toolName,
        actorUserId: new Types.ObjectId(user.id),
        organizationId: orgId,
        entityType: 'Product',
        entityId: new Types.ObjectId(dto.productUpdate.id),
        payload: { id: dto.productUpdate.id, patch: dto.productUpdate.patch },
        before,
        after: null,
        expiresAt: new Date(Date.now() + PROPOSAL_TTL_MS),
        ...(idempotencyKey ? { idempotencyKey } : {}),
      });
      return this.toProposalView(doc);
    }

    // ── TZD-ORDER-IMPORT-01: order import HITL chain ──────────────────────────
    if (dto.kind === 'counterparty.create') {
      const c = dto.counterpartyCreate;
      if (!c?.name?.trim()) {
        throw new BadRequestException('counterpartyCreate.name is required for counterparty.create');
      }
      if (!c.inn?.trim()) {
        throw new BadRequestException('counterpartyCreate.inn is required for counterparty.create');
      }
      if (!c.roles?.length) {
        throw new BadRequestException('counterpartyCreate.roles is required for counterparty.create');
      }
      const payload = {
        name: c.name.trim(),
        inn: c.inn.trim(),
        roles: c.roles,
        ...(c.shortName ? { shortName: c.shortName } : {}),
        ...(c.legalForm ? { legalForm: c.legalForm } : {}),
        ...(c.legalType ? { legalType: c.legalType } : {}),
        ...(c.type ? { type: c.type } : {}),
        ...(c.partyTypes ? { partyTypes: c.partyTypes } : {}),
        ...(c.phone ? { phone: c.phone } : {}),
        ...(c.paymentTermDays !== undefined ? { paymentTermDays: c.paymentTermDays } : {}),
        ...(c.vatRate !== undefined ? { vatRate: c.vatRate } : {}),
      };
      const doc = await this.model.create({
        status: 'proposed',
        kind: dto.kind,
        toolName,
        actorUserId: new Types.ObjectId(user.id),
        organizationId: orgId,
        entityType: 'Counterparty',
        payload,
        before: null,
        after: null,
        expiresAt: new Date(Date.now() + PROPOSAL_TTL_MS),
        ...(idempotencyKey ? { idempotencyKey } : {}),
      });
      return this.toProposalView(doc);
    }

    if (dto.kind === 'site.create') {
      const s = dto.siteCreate;
      if (!s?.counterpartyId || !Types.ObjectId.isValid(s.counterpartyId)) {
        throw new BadRequestException('siteCreate.counterpartyId (valid ObjectId) is required for site.create');
      }
      if (!s.name?.trim() || !s.address?.trim()) {
        throw new BadRequestException('siteCreate.name and siteCreate.address are required for site.create');
      }
      const payload = {
        counterpartyId: s.counterpartyId,
        name: s.name.trim(),
        address: s.address.trim(),
      };
      const doc = await this.model.create({
        status: 'proposed',
        kind: dto.kind,
        toolName,
        actorUserId: new Types.ObjectId(user.id),
        organizationId: orgId,
        entityType: 'Site',
        payload,
        before: null,
        after: null,
        expiresAt: new Date(Date.now() + PROPOSAL_TTL_MS),
        ...(idempotencyKey ? { idempotencyKey } : {}),
      });
      return this.toProposalView(doc);
    }

    if (dto.kind === 'order.create') {
      const o = dto.orderCreate;
      if (!o?.counterpartyId || !Types.ObjectId.isValid(o.counterpartyId)) {
        throw new BadRequestException('orderCreate.counterpartyId (valid ObjectId) is required for order.create');
      }
      if (!o.siteId || !Types.ObjectId.isValid(o.siteId)) {
        throw new BadRequestException('orderCreate.siteId (valid ObjectId) is required for order.create');
      }
      if (!o.items?.length) {
        throw new BadRequestException('orderCreate.items (min 1) is required for order.create');
      }
      for (const item of o.items) {
        if (!Types.ObjectId.isValid(item.productId)) {
          throw new BadRequestException(`orderCreate.items[].productId is not a valid ObjectId: ${item.productId}`);
        }
        if (!(item.quantity > 0)) {
          throw new BadRequestException(`orderCreate.items[].quantity must be > 0 for productId ${item.productId}`);
        }
      }
      const payload = {
        counterpartyId: o.counterpartyId,
        siteId: o.siteId,
        items: o.items,
        ...(o.number ? { number: o.number } : {}),
        ...(o.notes ? { notes: o.notes } : {}),
        ...(o.importTaskId ? { importTaskId: o.importTaskId } : {}),
      };
      const doc = await this.model.create({
        status: 'proposed',
        kind: dto.kind,
        toolName,
        actorUserId: new Types.ObjectId(user.id),
        organizationId: orgId,
        entityType: 'Order',
        payload,
        before: null,
        after: null,
        expiresAt: new Date(Date.now() + PROPOSAL_TTL_MS),
        ...(idempotencyKey ? { idempotencyKey } : {}),
      });
      return this.toProposalView(doc);
    }

    throw new BadRequestException(`Unsupported kind: ${dto.kind}`);
  }

  /**
   * TZD-18 — batch propose. SoT не пишется. Best-effort all-or-nothing:
   * при ошибке любого item созданные proposals откатываются (cancel) и
   * возвращаются errors. С idempotencyKey повторный вызов вернёт те же id.
   */
  async proposeBatch(dto: ProposeBatchDto, user: AuthenticatedUser) {
    if (!user?.id || !Types.ObjectId.isValid(user.id)) {
      throw new ForbiddenException('Authenticated user required');
    }
    const orgId =
      user.organizationId && Types.ObjectId.isValid(user.organizationId)
        ? new Types.ObjectId(user.organizationId)
        : undefined;
    const toolName = 'kppdf_propose_material_batch';

    if (dto.idempotencyKey) {
      const existing = await this.model
        .find({
          idempotencyKey: dto.idempotencyKey,
          actorUserId: new Types.ObjectId(user.id),
          status: 'proposed',
          ...(orgId ? { organizationId: orgId } : {}),
        })
        .lean()
        .exec();
      if (existing.length > 0) {
        return {
          proposalIds: existing.map((e) => String(e._id)),
          errors: [],
          note: 'idempotency hit — returned existing proposals',
        };
      }
    }

    const proposalIds: string[] = [];
    const errors: Array<{ index: number; error: string }> = [];
    for (let i = 0; i < dto.items.length; i++) {
      const item = dto.items[i];
      try {
        const view = await this.proposeOne(
          item,
          user,
          orgId,
          item.toolName ?? toolName,
          dto.idempotencyKey,
        );
        proposalIds.push(view.proposalId);
      } catch (err) {
        errors.push({
          index: i,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (errors.length > 0) {
      // all-or-nothing best-effort: откатываем созданное
      for (const id of proposalIds) {
        try {
          await this.cancel(id, user);
        } catch {
          // cancel идемпотентен — пропускаем
        }
      }
      return {
        proposalIds: [],
        errors,
        note: `Rolled back ${proposalIds.length} created proposal(s) — fix items and retry`,
      };
    }

    return { proposalIds, errors };
  }

  /** TZD-18 — batch confirm. По-одному; ошибки собираются, остальные применяются. */
  async confirmBatch(dto: ProposalIdsBatchDto, user: AuthenticatedUser) {
    const failed: Array<{ id: string; error: string }> = [];
    let applied = 0;
    for (const id of dto.ids) {
      try {
        await this.confirm(id, user);
        applied += 1;
      } catch (err) {
        failed.push({ id, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return { applied, failed };
  }

  /** TZD-18 — batch cancel. SoT не меняется. */
  async cancelBatch(dto: ProposalIdsBatchDto, user: AuthenticatedUser) {
    let cancelled = 0;
    for (const id of dto.ids) {
      try {
        await this.cancel(id, user);
        cancelled += 1;
      } catch {
        // уже не-proposed — пропускаем (идемпотентно)
      }
    }
    return { cancelled };
  }

  async confirm(proposalId: string, user: AuthenticatedUser) {
    const doc = await this.loadOwned(proposalId, user, 'proposal');
    if (doc.status !== 'proposed') {
      throw new BadRequestException(`Proposal ${proposalId} is ${doc.status}, not proposed`);
    }
    if (doc.expiresAt && doc.expiresAt.getTime() < Date.now()) {
      doc.status = 'expired';
      await doc.save();
      throw new BadRequestException(`Proposal ${proposalId} expired`);
    }

    if (doc.kind === 'material.create') {
      const payload = (doc.payload ?? {}) as unknown as CreateMaterialDto;
      const created = await this.materials.create(payload);
      doc.entityId = created._id as Types.ObjectId;
      doc.after = leanMaterial(created);
      doc.before = null;
    } else if (doc.kind === 'material.update') {
      const payload = doc.payload as unknown as { id: string; patch: UpdateMaterialDto };
      if (!doc.before) {
        const existing = await this.materials.findById(payload.id);
        doc.before = leanMaterial(existing);
      }
      const updated = await this.materials.update(payload.id, payload.patch);
      doc.entityId = updated._id as Types.ObjectId;
      doc.after = leanMaterial(updated);
    } else if (doc.kind === 'product.create') {
      const payload = (doc.payload ?? {}) as unknown as CreateProductDto;
      const org = this.orgIdString(doc);
      const created = await this.products.create(payload, org);
      doc.entityId = created._id as Types.ObjectId;
      doc.after = leanMaterial(created);
      doc.before = null;
    } else if (doc.kind === 'product.update') {
      const payload = doc.payload as unknown as { id: string; patch: UpdateProductDto };
      if (!doc.before) {
        const existing = await this.products.findById(payload.id);
        doc.before = leanMaterial(existing);
      }
      const org = this.orgIdString(doc);
      const updated = await this.products.update(payload.id, payload.patch, org);
      doc.entityId = updated._id as Types.ObjectId;
      doc.after = leanMaterial(updated);
    } else if (doc.kind === 'counterparty.create') {
      const payload = (doc.payload ?? {}) as unknown as CreateCounterpartyDto;
      const created = await this.counterparties.create(payload, {
        organizationId: this.orgIdString(doc),
      });
      doc.entityId = created._id as Types.ObjectId;
      doc.after = leanMaterial(created);
      doc.before = null;
    } else if (doc.kind === 'site.create') {
      const payload = (doc.payload ?? {}) as unknown as CreateSiteDto;
      const created = await this.sites.create(payload);
      doc.entityId = created._id as Types.ObjectId;
      doc.after = leanMaterial(created);
      doc.before = null;
    } else if (doc.kind === 'order.create') {
      const payload = (doc.payload ?? {}) as unknown as CreateOrderDto;
      const created = await this.orders.create({
        ...payload,
        source: 'desktop-import',
        managerId: String(doc.actorUserId),
      });
      doc.entityId = created._id as Types.ObjectId;
      doc.after = leanMaterial(created);
      doc.before = null;
    } else {
      throw new BadRequestException(`Unsupported kind: ${doc.kind}`);
    }

    doc.status = 'applied';
    doc.appliedAt = new Date();
    await doc.save();
    await this.enforceRing(doc.organizationId);
    return this.toMutationView(doc);
  }

  async undo(mutationId: string, user: AuthenticatedUser) {
    const doc = await this.loadOwned(mutationId, user);
    if (doc.status !== 'applied') {
      throw new BadRequestException(`Mutation ${mutationId} is ${doc.status}, not applied`);
    }

    if (doc.kind === 'material.create') {
      if (!doc.entityId) throw new BadRequestException('Missing entityId for create undo');
      await this.materials.remove(String(doc.entityId));
    } else if (doc.kind === 'material.update') {
      if (!doc.entityId || !doc.before) {
        throw new BadRequestException('Missing before snapshot for update undo');
      }
      const restore = this.pickRestorable(doc.before);
      await this.materials.update(String(doc.entityId), restore as UpdateMaterialDto);
    } else if (doc.kind === 'product.create') {
      if (!doc.entityId) throw new BadRequestException('Missing entityId for create undo');
      await this.products.remove(String(doc.entityId), this.orgIdString(doc));
    } else if (doc.kind === 'product.update') {
      if (!doc.entityId || !doc.before) {
        throw new BadRequestException('Missing before snapshot for update undo');
      }
      const restore = this.pickRestorable(doc.before);
      await this.products.update(String(doc.entityId), restore as UpdateProductDto, this.orgIdString(doc));
    } else if (doc.kind === 'counterparty.create') {
      if (!doc.entityId) throw new BadRequestException('Missing entityId for create undo');
      await this.counterparties.remove(String(doc.entityId), { organizationId: this.orgIdString(doc) });
    } else if (doc.kind === 'site.create') {
      if (!doc.entityId) throw new BadRequestException('Missing entityId for create undo');
      await this.sites.remove(String(doc.entityId));
    } else if (doc.kind === 'order.create') {
      if (!doc.entityId) throw new BadRequestException('Missing entityId for create undo');
      await this.orders.remove(String(doc.entityId));
    } else {
      throw new BadRequestException(`Unsupported kind: ${doc.kind}`);
    }

    doc.status = 'undone';
    doc.undoneAt = new Date();
    await doc.save();
    return this.toMutationView(doc);
  }

  async undoLast(user: AuthenticatedUser) {
    const filter = this.orgActorFilter(user);
    const last = await this.model
      .findOne({ ...filter, status: 'applied' })
      .sort({ appliedAt: -1, createdAt: -1 })
      .exec();
    if (!last) throw new NotFoundException('No applied mutation to undo');
    return this.undo(String(last._id), user);
  }

  async listRecent(user: AuthenticatedUser, limit = 20) {
    const filter = this.orgActorFilter(user);
    const take = Math.min(100, Math.max(1, limit));
    const items = await this.model
      .find({ ...filter, status: { $in: ['applied', 'undone'] } })
      .sort({ appliedAt: -1, createdAt: -1 })
      .limit(take)
      .lean()
      .exec();
    return {
      ringSize: this.ringSize,
      items: items.map((d) => this.toMutationView(d as MutationJournalDocument)),
    };
  }

  async getById(id: string, user: AuthenticatedUser) {
    const doc = await this.loadOwned(id, user);
    return doc.status === 'proposed' ? this.toProposalView(doc) : this.toMutationView(doc);
  }

  async cancel(proposalId: string, user: AuthenticatedUser) {
    const doc = await this.loadOwned(proposalId, user, 'proposal');
    if (doc.status !== 'proposed') {
      throw new BadRequestException(`Only proposed can be cancelled (was ${doc.status})`);
    }
    doc.status = 'cancelled';
    await doc.save();
    return this.toProposalView(doc);
  }

  private orgIdString(doc: MutationJournalDocument | Record<string, unknown>): string | null {
    const org = (doc as { organizationId?: Types.ObjectId | string }).organizationId;
    return org ? String(org) : null;
  }

  private async enforceRing(organizationId?: Types.ObjectId) {
    const filter: Record<string, unknown> = {
      status: { $in: ['applied', 'undone'] },
    };
    if (organizationId) filter.organizationId = organizationId;
    const count = await this.model.countDocuments(filter).exec();
    if (count <= this.ringSize) return;
    const overflow = count - this.ringSize;
    const oldest = await this.model
      .find(filter)
      .sort({ appliedAt: 1, createdAt: 1 })
      .limit(overflow)
      .select({ _id: 1 })
      .lean()
      .exec();
    const ids = oldest.map((o) => o._id);
    if (ids.length) {
      await this.model.deleteMany({ _id: { $in: ids } }).exec();
      this.logger.debug(`Evicted ${ids.length} journal entries (ring=${this.ringSize})`);
    }
  }

  private pickRestorable(before: Record<string, unknown>): Record<string, unknown> {
    const skip = new Set([
      '_id',
      '__v',
      'createdAt',
      'updatedAt',
      'deletedAt',
      'id',
    ]);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(before)) {
      if (skip.has(k)) continue;
      out[k] = v;
    }
    return out;
  }

  private orgActorFilter(user: AuthenticatedUser): Record<string, unknown> {
    const filter: Record<string, unknown> = {};
    if (user.role === 'admin') {
      if (user.organizationId && Types.ObjectId.isValid(user.organizationId)) {
        filter.organizationId = new Types.ObjectId(user.organizationId);
      }
      return filter;
    }
    if (!user.id || !Types.ObjectId.isValid(user.id)) {
      throw new ForbiddenException('Authenticated user required');
    }
    filter.actorUserId = new Types.ObjectId(user.id);
    if (user.organizationId && Types.ObjectId.isValid(user.organizationId)) {
      filter.organizationId = new Types.ObjectId(user.organizationId);
    }
    return filter;
  }

  private async loadOwned(
    id: string,
    user: AuthenticatedUser,
    resource: 'mutation' | 'proposal' = 'mutation',
  ): Promise<MutationJournalDocument> {
    const label = resource === 'proposal' ? 'Proposal' : 'Mutation';
    const hint =
      resource === 'proposal'
        ? ' Use the exact proposalId returned by kppdf_propose_* (not result.id or mutationId).'
        : '';
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`${label} ${id} not found.${hint}`);
    }
    const doc = await this.model.findById(id).exec();
    if (!doc) throw new NotFoundException(`${label} ${id} not found.${hint}`);

    if (user.role !== 'admin') {
      if (String(doc.actorUserId) !== user.id) {
        throw new ForbiddenException('Not your mutation');
      }
    } else if (
      user.organizationId &&
      doc.organizationId &&
      String(doc.organizationId) !== user.organizationId
    ) {
      throw new ForbiddenException('Wrong organization');
    }
    return doc;
  }

  private toProposalView(doc: MutationJournalDocument | Record<string, unknown>) {
    const d = doc as MutationJournalDocument;
    return {
      proposalId: String(d._id),
      status: d.status,
      kind: d.kind,
      toolName: d.toolName,
      entityType: d.entityType,
      entityId: d.entityId ? String(d.entityId) : null,
      payload: d.payload ?? null,
      before: d.before ?? null,
      after: d.after ?? null,
      expiresAt: d.expiresAt ?? null,
      createdAt: (d as { createdAt?: Date }).createdAt ?? null,
    };
  }

  private toMutationView(doc: MutationJournalDocument | Record<string, unknown>) {
    const d = doc as MutationJournalDocument;
    return {
      mutationId: String(d._id),
      status: d.status,
      kind: d.kind,
      toolName: d.toolName,
      entityType: d.entityType,
      entityId: d.entityId ? String(d.entityId) : null,
      before: d.before ?? null,
      after: d.after ?? null,
      appliedAt: d.appliedAt ?? null,
      undoneAt: d.undoneAt ?? null,
      createdAt: (d as { createdAt?: Date }).createdAt ?? null,
    };
  }
}
