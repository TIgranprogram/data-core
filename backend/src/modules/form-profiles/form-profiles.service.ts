import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { FormProfile, FormProfileDocument } from './form-profile.schema';
import {
  Organization,
  OrganizationDocument,
} from '../organization/organization.schema';
import {
  ALLOWED_FIELD_KEYS,
  DEFAULT_VISIBLE,
  FORM_PROFILE_ENTITIES,
  FORM_PROFILE_SIZES,
  LOCKED_REQUIRED,
  type FormProfileEntity,
  type FormProfileSize,
  isFormProfileEntity,
  isFormProfileSize,
} from './form-profile.constants';

@Injectable()
export class FormProfilesService {
  private readonly logger = new Logger(FormProfilesService.name);

  constructor(
    @InjectModel(FormProfile.name)
    private readonly model: Model<FormProfileDocument>,
    @InjectModel(Organization.name)
    private readonly orgModel: Model<OrganizationDocument>,
  ) {}

  async list(
    organizationId: string | null | undefined,
    entityFilter?: string,
  ): Promise<FormProfileDocument[]> {
    const orgOid = await this.resolveOrganizationId(organizationId);
    const entity = entityFilter
      ? this.parseEntity(entityFilter)
      : undefined;

    await this.ensureSeeded(orgOid, entity);

    const filter: Record<string, unknown> = { organizationId: orgOid };
    if (entity) filter.entity = entity;

    return this.model
      .find(filter)
      .sort({ entity: 1, size: 1 })
      .exec();
  }

  async getOne(
    organizationId: string | null | undefined,
    entityRaw: string,
    sizeRaw: string,
  ): Promise<FormProfileDocument> {
    const orgOid = await this.resolveOrganizationId(organizationId);
    const entity = this.parseEntity(entityRaw);
    const size = this.parseSize(sizeRaw);

    await this.ensureSeeded(orgOid, entity);

    const doc = await this.model
      .findOne({ organizationId: orgOid, entity, size })
      .exec();
    if (!doc) {
      // Should not happen after ensureSeeded; defensive upsert.
      return this.insertDefault(orgOid, entity, size);
    }
    return doc;
  }

  async upsert(
    organizationId: string | null | undefined,
    entityRaw: string,
    sizeRaw: string,
    visibleFieldKeys: string[],
  ): Promise<FormProfileDocument> {
    const orgOid = await this.resolveOrganizationId(organizationId);
    const entity = this.parseEntity(entityRaw);
    const size = this.parseSize(sizeRaw);
    const keys = this.validateVisibleKeys(entity, visibleFieldKeys);

    const doc = await this.model
      .findOneAndUpdate(
        { organizationId: orgOid, entity, size },
        { $set: { visibleFieldKeys: keys } },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      )
      .exec();

    return doc as FormProfileDocument;
  }

  /**
   * Idempotent seed: insert missing (org, entity, size) rows with audit defaults.
   * Never overwrites an existing profile.
   */
  async ensureSeeded(
    organizationId: Types.ObjectId,
    entityOnly?: FormProfileEntity,
  ): Promise<number> {
    const entities = entityOnly
      ? [entityOnly]
      : [...FORM_PROFILE_ENTITIES];
    let inserted = 0;

    for (const entity of entities) {
      for (const size of FORM_PROFILE_SIZES) {
        const existing = await this.model
          .findOne({ organizationId, entity, size })
          .select('_id')
          .lean()
          .exec();
        if (existing) continue;
        await this.insertDefault(organizationId, entity, size);
        inserted += 1;
      }
    }

    if (inserted > 0) {
      this.logger.log(
        `FormProfile seed: inserted ${inserted} for org ${String(organizationId)}`,
      );
    }
    return inserted;
  }

  validateVisibleKeys(
    entity: FormProfileEntity,
    visibleFieldKeys: string[],
  ): string[] {
    if (!Array.isArray(visibleFieldKeys)) {
      throw new BadRequestException('visibleFieldKeys must be an array');
    }

    const allowed = new Set(ALLOWED_FIELD_KEYS[entity]);
    const unknown = visibleFieldKeys.filter((k) => !allowed.has(k));
    if (unknown.length > 0) {
      throw new BadRequestException(
        `Unknown FieldKey(s) for ${entity}: ${unknown.join(', ')}`,
      );
    }

    const locked = LOCKED_REQUIRED[entity];
    const missing = locked.filter((k) => !visibleFieldKeys.includes(k));
    if (missing.length > 0) {
      throw new BadRequestException(
        `LockedRequired FieldKey(s) cannot be stripped: ${missing.join(', ')}`,
      );
    }

    // Stable order = allowlist order (dedupe while preserving first occurrence).
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const key of ALLOWED_FIELD_KEYS[entity]) {
      if (visibleFieldKeys.includes(key) && !seen.has(key)) {
        seen.add(key);
        ordered.push(key);
      }
    }
    return ordered;
  }

  parseEntity(raw: string): FormProfileEntity {
    if (!isFormProfileEntity(raw)) {
      throw new BadRequestException(
        `entity must be one of: ${FORM_PROFILE_ENTITIES.join(', ')}`,
      );
    }
    return raw;
  }

  parseSize(raw: string): FormProfileSize {
    if (!isFormProfileSize(raw)) {
      throw new BadRequestException(
        `size must be one of: ${FORM_PROFILE_SIZES.join(', ')}`,
      );
    }
    return raw;
  }

  /**
   * Form profiles are org-scoped. System admin JWT often has organizationId=null
   * — fall back to the first Organization so QuickCreate/settings work locally.
   */
  private async resolveOrganizationId(
    organizationId: string | null | undefined,
  ): Promise<Types.ObjectId> {
    if (organizationId && Types.ObjectId.isValid(organizationId)) {
      return new Types.ObjectId(organizationId);
    }
    const fallback = await this.orgModel
      .findOne()
      .sort({ name: 1 })
      .select('_id')
      .lean()
      .exec();
    if (fallback?._id) {
      this.logger.debug(
        `FormProfile: using default organization ${String(fallback._id)} (user had no org)`,
      );
      return fallback._id as Types.ObjectId;
    }
    throw new BadRequestException(
      'Нет организации: создайте фирму в Админ → Наши организации. Профили форм привязаны к организации.',
    );
  }

  private async insertDefault(
    organizationId: Types.ObjectId,
    entity: FormProfileEntity,
    size: FormProfileSize,
  ): Promise<FormProfileDocument> {
    const visibleFieldKeys = [...DEFAULT_VISIBLE[entity][size]];
    try {
      return await this.model.create({
        organizationId,
        entity,
        size,
        visibleFieldKeys,
      });
    } catch (err: unknown) {
      // Race: unique index — re-read.
      const code =
        err && typeof err === 'object' && 'code' in err
          ? (err as { code?: number }).code
          : undefined;
      if (code === 11000) {
        const existing = await this.model
          .findOne({ organizationId, entity, size })
          .exec();
        if (existing) return existing;
      }
      throw err;
    }
  }
}
