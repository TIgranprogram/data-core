import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { optimisticLockPlugin } from '../../common/mongoose';

export type OrganizationDocument = HydratedDocument<Organization>;

/** TZ-ORG-ASSETS-301: что именно за файл, а не просто «фото организации». */
export type OrganizationAssetRole = 'logo' | 'seal' | 'signature';

export const ORGANIZATION_ASSET_ROLES: OrganizationAssetRole[] = ['logo', 'seal', 'signature'];

/**
 * TZ-ORG-ASSETS-301 — типизированный слот файла организации.
 *
 * `photoIds[]` не годился: документу нужен именно логотип, именно печать и
 * именно подпись, а безымянный массив не отвечает на вопрос «что печатать».
 * `storageUrl` дублируется из Photo осознанно: печать (ASSETS-302) читает
 * организацию и не должна ходить за join-ом; файл иммутабелен.
 */
@Schema({ _id: false })
export class OrganizationAsset {
  @Prop({ required: true, enum: ORGANIZATION_ASSET_ROLES })
  role!: OrganizationAssetRole;

  @Prop({ type: Types.ObjectId, ref: 'Photo', required: true })
  photoId!: Types.ObjectId;

  @Prop({ required: true })
  storageUrl!: string;

  @Prop()
  originalFilename?: string;

  @Prop()
  mimeType?: string;

  @Prop()
  sizeBytes?: number;

  @Prop({ required: true, default: () => new Date() })
  uploadedAt!: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  uploadedBy?: Types.ObjectId;
}

const OrganizationAssetSchema = SchemaFactory.createForClass(OrganizationAsset);

@Schema({ collection: 'organizations', timestamps: true })
export class Organization {
  @Prop({ required: true, index: true })
  name!: string;

  @Prop()
  shortName?: string;

  @Prop()
  legalForm?: string;

  @Prop({ required: true, unique: true, index: true })
  inn!: string;

  @Prop()
  kpp?: string;

  @Prop()
  ogrn?: string;

  @Prop()
  ogrnip?: string;

  // Banking
  @Prop()
  bankName?: string;

  @Prop()
  bankBik?: string;

  @Prop()
  bankAccount?: string;

  @Prop()
  bankCorrAccount?: string;

  // Signer
  @Prop()
  signerName?: string;

  @Prop()
  signerPosition?: string;

  // Terms
  @Prop({ default: 10 })
  paymentTermDays!: number;

  @Prop({ default: 20 })
  vatRate!: number;

  @Prop({ default: true })
  isActive!: boolean;

  // Classification
  @Prop({ type: [String], default: [] })
  type!: string[]; // ['customer', 'supplier', 'contractor', 'manufacturer', 'partner']

  @Prop()
  legalType?: 'ooo' | 'ip' | 'pao' | 'ao' | 'other';

  @Prop()
  website?: string;

  /** Общая почта организации; для поставщика — адрес заявок. */
  @Prop({ trim: true })
  email?: string;

  @Prop()
  directorName?: string;

  @Prop()
  registrationDate?: Date;

  @Prop({ type: [String], default: [] })
  partyTypes!: string[];

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Photo' }], default: [] })
  photoIds!: Types.ObjectId[];

  /**
   * TZ-ORG-ASSETS-301: логотип / печать / подпись — не больше одного активного
   * файла на роль (замена, а не история).
   */
  @Prop({ type: [OrganizationAssetSchema], default: [] })
  assets!: OrganizationAsset[];

  /** TZ-ORG-ASSETS-301: юридический адрес — обязателен в шапке документов. */
  @Prop()
  legalAddress?: string;

  // Primary contact person
  @Prop({ type: Types.ObjectId, ref: 'Person' })
  contactPersonId?: Types.ObjectId;

  // Passport data (for ИП)
  @Prop()
  passportSeries?: string;

  @Prop()
  passportNumber?: string;

  @Prop()
  passportIssuedBy?: string;

  @Prop()
  passportIssuedAt?: Date;

  @Prop()
  passportDivisionCode?: string;

  /**
   * TZ-PARTY-301: «наша фирма» — organization used as the issuer side of
   * documents. One per instance under the current single-org policy.
   */
  @Prop({ default: false, index: true })
  isOurCompany!: boolean;

  /**
   * TZ-PARTY-301: soft-delete marker. `remove()` wrote it before this TZ
   * without a schema field, so strict mode silently dropped it.
   */
  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;
}

export const OrganizationSchema = SchemaFactory.createForClass(Organization);
OrganizationSchema.plugin(optimisticLockPlugin);
