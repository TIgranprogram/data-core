import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { UpdateDictionaryLabelDto } from './dto/update-dictionary-label.dto';
import {
  DICTIONARY_LABEL_SCOPES,
  DictionaryLabel,
  DictionaryLabelDocument,
  DictionaryLabelScope,
} from './dictionary-label.schema';

interface SeedLabel {
  scope: DictionaryLabelScope;
  key: string;
  label: string;
  sortOrder: number;
}

const SEED_LABELS: readonly SeedLabel[] = [
  { scope: 'productKind', key: 'good', label: 'Изделие', sortOrder: 0 },
  { scope: 'productKind', key: 'service', label: 'Услуга', sortOrder: 1 },
  { scope: 'productKind', key: 'work', label: 'Работа', sortOrder: 2 },
  { scope: 'materialKind', key: 'raw', label: 'сырьё', sortOrder: 0 },
  { scope: 'materialKind', key: 'part', label: 'деталь', sortOrder: 1 },
  { scope: 'materialKind', key: 'fastener', label: 'метиз', sortOrder: 2 },
  { scope: 'materialKind', key: 'purchased', label: 'покупное', sortOrder: 3 },
  { scope: 'materialKind', key: 'other', label: 'другое', sortOrder: 4 },
] as const;

@Injectable()
export class DictionaryLabelService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DictionaryLabelService.name);

  constructor(
    @InjectModel(DictionaryLabel.name)
    private readonly model: Model<DictionaryLabelDocument>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    for (const seed of SEED_LABELS) {
      const existing = await this.model
        .findOne({ organizationId: null, scope: seed.scope, key: seed.key })
        .exec();
      if (existing) continue;

      try {
        await this.model.create({
          ...seed,
          organizationId: null,
          isActive: true,
          isSystem: true,
        });
      } catch (err) {
        // A parallel boot may win the insert; keep startup idempotent.
        if ((err as { code?: number })?.code !== 11000) throw err;
      }
    }
    this.logger.log(`Dictionary labels seeded: ${SEED_LABELS.length} defaults checked`);
  }

  async list(
    scope?: DictionaryLabelScope,
    organizationId?: string | null,
  ): Promise<DictionaryLabelDocument[]> {
    const filter = this.visibleFilter(scope, organizationId);
    return this.model.find(filter).sort({ scope: 1, sortOrder: 1, key: 1 }).exec();
  }

  async active(
    scope?: DictionaryLabelScope,
    organizationId?: string | null,
  ): Promise<DictionaryLabelDocument[]> {
    const filter = this.visibleFilter(scope, organizationId);
    filter.isActive = true;
    return this.model.find(filter).sort({ scope: 1, sortOrder: 1, key: 1 }).exec();
  }

  async update(
    id: string,
    dto: UpdateDictionaryLabelDto,
    organizationId?: string | null,
  ): Promise<DictionaryLabelDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`Dictionary label ${id} not found`);
    }
    const doc = await this.model.findById(id).exec();
    if (!doc) throw new NotFoundException(`Dictionary label ${id} not found`);
    if (
      doc.organizationId &&
      (!organizationId || String(doc.organizationId) !== organizationId)
    ) {
      throw new ForbiddenException('Подпись принадлежит другой организации');
    }

    if (dto.label !== undefined) doc.label = dto.label.trim();
    if (dto.sortOrder !== undefined) doc.sortOrder = dto.sortOrder;
    if (dto.isActive !== undefined) doc.isActive = dto.isActive;
    if (!doc.label) throw new BadRequestException('Подпись обязательна');

    try {
      return await doc.save();
    } catch (err) {
      if ((err as { code?: number })?.code === 11000) {
        throw new ConflictException('Такая подпись уже существует в этой области');
      }
      throw err;
    }
  }

  private visibleFilter(
    scope: DictionaryLabelScope | undefined,
    organizationId?: string | null,
  ): Record<string, unknown> {
    if (scope && !DICTIONARY_LABEL_SCOPES.includes(scope)) {
      throw new BadRequestException(`Недопустимая область подписей: ${scope}`);
    }
    const filter: Record<string, unknown> = {};
    if (scope) filter.scope = scope;
    if (organizationId) {
      if (!Types.ObjectId.isValid(organizationId)) {
        throw new BadRequestException('Invalid organization scope');
      }
      filter.$or = [
        { organizationId: new Types.ObjectId(organizationId) },
        { organizationId: null },
      ];
    } else {
      filter.organizationId = null;
    }
    return filter;
  }
}
