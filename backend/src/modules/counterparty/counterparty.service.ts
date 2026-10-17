import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CreateCounterpartyDto } from './dto/create-counterparty.dto';
import { UpdateCounterpartyDto } from './dto/update-counterparty.dto';
import { QuickCreatePartyDto } from './dto/quick-create-party.dto';
import { Counterparty, CounterpartyDocument } from './counterparty.schema';
import { SiteService } from '../site/site.service';
import { SiteDocument } from '../site/site.schema';

/** Valid 10-digit INN stub with FNS checksum (unique enough for quick-create). */
export function generateQuickInnStub(): string {
  const w = [2, 4, 10, 3, 5, 9, 4, 6, 8];
  const base = String(Date.now()).slice(-9).padStart(9, '0');
  let s = 0;
  for (let i = 0; i < 9; i++) s += Number(base[i]) * w[i]!;
  const check = (s % 11) % 10;
  return `${base}${check}`;
}

/** Tenant context taken from the JWT, never from the request body. */
export interface CounterpartyActor {
  organizationId?: string | null;
  role?: string;
}

@Injectable()
export class CounterpartyService {
  private readonly logger = new Logger(CounterpartyService.name);

  constructor(
    @InjectModel(Counterparty.name) private readonly model: Model<CounterpartyDocument>,
    private readonly sites: SiteService,
  ) {}

  async create(
    dto: CreateCounterpartyDto,
    user?: CounterpartyActor,
  ): Promise<CounterpartyDocument> {
    return this.model.create({
      ...this.withoutTenantFields(dto),
      innIsStub: false,
      isSystem: false,
      deletedAt: null,
      ...this.tenantStamp(user),
    });
  }

  /**
   * TZ-ORDERS-303: имя+тел+адрес → Counterparty + Site.
   * TZ-PARTY-301: organizationId comes from the JWT and the generated INN is
   * flagged as a stub so the UI can say «ИНН временный».
   */
  async quickCreateParty(
    dto: QuickCreatePartyDto,
    user?: CounterpartyActor,
  ): Promise<{ counterparty: CounterpartyDocument; site: SiteDocument }> {
    const stamp = this.tenantStamp(user);
    let inn = generateQuickInnStub();
    for (let attempt = 0; attempt < 5; attempt++) {
      const clash = await this.model
        .findOne({ inn, organizationId: stamp.organizationId ?? null })
        .exec();
      if (!clash) break;
      inn = generateQuickInnStub();
    }
    const counterparty = await this.model.create({
      name: dto.name.trim(),
      phone: dto.phone?.trim() || undefined,
      roles: ['customer'],
      inn,
      innIsStub: true,
      isActive: true,
      deletedAt: null,
      ...stamp,
    });
    const site = await this.sites.create({
      counterpartyId: counterparty._id.toString(),
      name: (dto.siteName ?? 'Объект').trim() || 'Объект',
      address: dto.address.trim(),
    });
    return { counterparty, site };
  }

  async findAll(
    q: { page?: number; limit?: number; search?: string; role?: string } = {},
    user?: CounterpartyActor,
  ) {
    const page = Math.max(1, q.page ?? 1);
    const limit = Math.min(200, Math.max(1, q.limit ?? 50));
    const filter: Record<string, unknown> = { deletedAt: null };

    const tenantScope: Record<string, unknown>[] = [];
    if (user?.organizationId) {
      tenantScope.push(
        { organizationId: new Types.ObjectId(user.organizationId) },
        { organizationId: null, isSystem: true },
        { organizationId: { $exists: false } },
      );
    }

    if (q.search) {
      const escaped = q.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(escaped, 'i');
      const searchScope = {
        $or: [{ name: re }, { shortName: re }, { inn: re }, { phone: re }, { email: re }],
      };
      if (tenantScope.length > 0) {
        // Search AND (own org OR system OR legacy) — same filter for find + count.
        filter.$and = [{ $or: tenantScope }, searchScope];
      } else {
        filter.$or = searchScope.$or;
      }
    } else if (tenantScope.length > 0) {
      filter.$or = tenantScope;
    }

    if (q.role) filter.roles = q.role;

    const [items, total] = await Promise.all([
      this.model.find(filter).sort({ name: 1 }).skip((page - 1) * limit).limit(limit).exec(),
      this.model.countDocuments(filter).exec(),
    ]);
    return { items, total, page, limit };
  }

  /**
   * TZ-PARTY-301: a counterparty of another tenant is indistinguishable from a
   * missing one (404, never 403) — that is what closes the IDOR.
   */
  async findById(id: string, user?: CounterpartyActor): Promise<CounterpartyDocument> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException(`Counterparty ${id} not found`);
    const doc = await this.model.findOne({ _id: id, deletedAt: null }).exec();
    if (!doc || !this.isVisibleTo(doc, user)) {
      throw new NotFoundException(`Counterparty ${id} not found`);
    }
    return doc;
  }

  async findByInn(inn: string, user?: CounterpartyActor): Promise<CounterpartyDocument | null> {
    const filter: Record<string, unknown> = { inn, deletedAt: null };
    if (user?.organizationId) {
      filter.organizationId = new Types.ObjectId(user.organizationId);
    }
    return this.model.findOne(filter).exec();
  }

  async update(
    id: string,
    dto: UpdateCounterpartyDto,
    user?: CounterpartyActor,
  ): Promise<CounterpartyDocument> {
    const doc = await this.findById(id, user);
    const payload = this.withoutTenantFields(dto);
    const previousInn = doc.inn;
    Object.assign(doc, payload);
    // A hand-entered INN replaces the quick-create stub.
    if (payload.inn && payload.inn !== previousInn) doc.innIsStub = false;
    return doc.save();
  }

  async remove(id: string, user?: CounterpartyActor): Promise<void> {
    const doc = await this.findById(id, user);
    await this.model
      .updateOne({ _id: doc._id }, { $set: { deletedAt: new Date() } })
      .exec();
  }

  /** Mass-assign guard: tenant fields are decided by the JWT, not the client. */
  private withoutTenantFields<T extends object>(
    dto: T,
  ): Omit<T, 'organizationId' | 'isSystem'> {
    const payload = { ...dto } as Record<string, unknown>;
    delete payload.organizationId;
    delete payload.isSystem;
    return payload as Omit<T, 'organizationId' | 'isSystem'>;
  }

  /** organizationId is never taken from the request body (mass-assign guard). */
  private tenantStamp(user?: CounterpartyActor): { organizationId?: Types.ObjectId } {
    if (!user?.organizationId) return {};
    return { organizationId: new Types.ObjectId(user.organizationId) };
  }

  private isVisibleTo(doc: CounterpartyDocument, user?: CounterpartyActor): boolean {
    if (!user?.organizationId) return true;
    if (!doc.organizationId) return true; // legacy / system shared records
    return doc.organizationId.toString() === user.organizationId;
  }
}
