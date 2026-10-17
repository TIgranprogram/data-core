/**
 * TZ-87 B.1 — Dev-only fixtures seed.
 *
 * Scope (dev only — never runs in production):
 *   - 1 Organization: «KPPDF Demo Corp» (ИНН 7701234567, г. Москва)
 *   - 1 Counterparty: «Demo Client LLC» (ИНН 7709876543)
 *   - 6 DocTypes: invoice, proposal, contract, order, acceptance-act, waybill
 *
 * Idempotency:
 *   `findOne({ inn | slug })` first → skip if exists. The TZ-87 spec calls for
 *   skip-if-exists across all entities; this avoids mutating data on re-runs.
 *   Per-entity try/catch ensures one failure does not block the others.
 *
 * Lifecycle (TZ-87 §B.1):
 *   `OnModuleInit` — chosen because @InjectModel injections from
 *   OrganizationModule / CounterpartyModule / DocTypeModule are guaranteed
 *   ready by the time AppModule's onModuleInit fires (NestJS resolves dep-order
 *   acyclically at module-compile time, before either lifecycle hook runs).
 *   If a future module-introduction introduces circular deps, fall back to
 *   `OnApplicationBootstrap` per TZ-87 §B.1 fallback rule.
 *
 * Production guard:
 *   `NODE_ENV === 'production'` → early return before any DB call. Defensive —
 *   if a future env-mgmt regression accidentally registers this seed in prod,
 *   the guard makes it a no-op rather than seeding demo data.
 *
 * Naming convention:
 *   Uses `DEFAULT_*` plural-array convention matching sibling seeds
 *   (CategoriesSeed / WarehouseSeed / StatusesSeed / UnitsSeed). Each
 *   constant holds an array, even when only one entity is seeded today —
 *   makes future additions (e.g. 2nd counterparty) a single-line edit.
 */
import {
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Organization, OrganizationDocument } from '../../modules/organization/organization.schema';
import { Counterparty, CounterpartyDocument } from '../../modules/counterparty/counterparty.schema';
import { DocType, DocTypeDocument } from '../../modules/doc-type/doc-type.schema';

interface SeedOrganization {
  name: string;
  shortName: string;
  legalForm: string;
  legalType: 'ooo' | 'ip' | 'pao' | 'ao' | 'other';
  inn: string;
  kpp: string;
  ogrn: string;
  bankName?: string;
  bankBik?: string;
  bankAccount?: string;
  bankCorrAccount?: string;
  signerName?: string;
  signerPosition?: string;
  directorName?: string;
  website?: string;
  isActive: boolean;
  paymentTermDays: number;
  vatRate: number;
  type: string[];
  partyTypes: string[];
}

interface SeedCounterparty {
  name: string;
  shortName: string;
  legalForm: string;
  legalType: 'ooo' | 'ip' | 'pao' | 'ao' | 'other';
  inn: string;
  kpp: string;
  ogrn: string;
  directorName?: string;
  isActive: boolean;
  roles: string[];
  type: string[];
  partyTypes: string[];
  paymentTermDays: number;
  vatRate: number;
}

interface SeedDocType {
  name: string;
  slug: string;
  description?: string;
}

const DEFAULT_ORGANIZATIONS: readonly SeedOrganization[] = [
  {
    name: 'KPPDF Demo Corp',
    shortName: 'KPPDF Demo',
    legalForm: 'ООО',
    legalType: 'ooo',
    inn: '7707083893',
    kpp: '770101001',
    ogrn: '1027701234567',
    bankName: 'ПАО Сбербанк',
    bankBik: '044525225',
    bankAccount: '40702810038000123456',
    bankCorrAccount: '30101810400000000225',
    signerName: 'Иванов И.И.',
    signerPosition: 'Генеральный директор',
    directorName: 'Иванов Иван Иванович',
    website: 'https://demo.kppdf.local',
    isActive: true,
    paymentTermDays: 10,
    vatRate: 20,
    type: ['customer', 'manufacturer'],
    partyTypes: ['customer', 'supplier'],
  },
];

const DEFAULT_COUNTERPARTIES: readonly SeedCounterparty[] = [
  {
    name: 'Demo Client LLC',
    shortName: 'Demo Client',
    legalForm: 'ООО',
    legalType: 'ooo',
    inn: '7709876545',
    kpp: '770901001',
    ogrn: '1027709876543',
    directorName: 'Петров Пётр Петрович',
    isActive: true,
    roles: ['customer'],
    type: ['customer'],
    partyTypes: ['customer'],
    paymentTermDays: 10,
    vatRate: 20,
  },
];

const DEFAULT_DOC_TYPES: readonly SeedDocType[] = [
  { name: 'Счёт',                    slug: 'invoice',        description: 'Счёт на оплату' },
  { name: 'Коммерческое предложение', slug: 'proposal',       description: 'КП для клиента' },
  { name: 'Договор',                  slug: 'contract',       description: 'Договор поставки/оказания услуг' },
  { name: 'Заказ',                    slug: 'order',          description: 'Заказ на производство' },
  { name: 'Акт выполненных работ',    slug: 'acceptance-act', description: 'Акт приёмки' },
  { name: 'Накладная',                slug: 'waybill',        description: 'Товарная накладная' },
] as const;

@Injectable()
export class DevFixturesSeed implements OnModuleInit {
  private readonly logger = new Logger(DevFixturesSeed.name);

  constructor(
    @InjectModel(Organization.name) private readonly orgModel: Model<OrganizationDocument>,
    @InjectModel(Counterparty.name) private readonly cpModel: Model<CounterpartyDocument>,
    @InjectModel(DocType.name) private readonly docTypeModel: Model<DocTypeDocument>,
  ) {}

  async onModuleInit(): Promise<void> {
    // Production guard — never seed demo data in prod even if registered.
    if (process.env.NODE_ENV === 'production') {
      this.logger.debug('DevFixturesSeed: skipped (NODE_ENV=production)');
      return;
    }
    // Opt-out: DEV_FIXTURES_SEED=0|false skips even in non-production.
    if (['0', 'false', 'no'].includes(String(process.env.DEV_FIXTURES_SEED ?? '').toLowerCase())) {
      this.logger.debug('DevFixturesSeed: skipped (DEV_FIXTURES_SEED)');
      return;
    }

    await this.seedOrganizations();
    await this.seedCounterparties();
    await this.seedDocTypes();
  }

  // ─── Organizations ────────────────────────────────────────────
  private async seedOrganizations(): Promise<void> {
    for (const org of DEFAULT_ORGANIZATIONS) {
      try {
        const existing = await this.orgModel
          .findOne({ inn: org.inn })
          .exec();
        if (existing) {
          this.logger.debug(`Organization already present (ИНН ${org.inn})`);
          continue;
        }
        await this.orgModel.create(org);
        this.logger.log(`Organization seeded: ${org.name} (ИНН ${org.inn})`);
      } catch (err) {
        this.logger.warn(`Could not seed Organization ИНН ${org.inn}: ${(err as Error).message}`);
      }
    }
  }

  // ─── Counterparties ───────────────────────────────────────────
  private async seedCounterparties(): Promise<void> {
    for (const cp of DEFAULT_COUNTERPARTIES) {
      try {
        const existing = await this.cpModel
          .findOne({ inn: cp.inn })
          .exec();
        if (existing) {
          this.logger.debug(`Counterparty already present (ИНН ${cp.inn})`);
          continue;
        }
        await this.cpModel.create(cp);
        this.logger.log(`Counterparty seeded: ${cp.name} (ИНН ${cp.inn})`);
      } catch (err) {
        this.logger.warn(`Could not seed Counterparty ИНН ${cp.inn}: ${(err as Error).message}`);
      }
    }
  }

  // ─── DocTypes ─────────────────────────────────────────────────
  private async seedDocTypes(): Promise<void> {
    for (const dt of DEFAULT_DOC_TYPES) {
      try {
        const existing = await this.docTypeModel
          .findOne({ slug: dt.slug })
          .exec();
        if (existing) continue;
        await this.docTypeModel.create({
          name: dt.name,
          slug: dt.slug,
          description: dt.description,
          isActive: true,
        });
        this.logger.log(`DocType seeded: ${dt.slug}`);
      } catch (err) {
        this.logger.warn(`Could not seed DocType ${dt.slug}: ${(err as Error).message}`);
      }
    }
  }
}
