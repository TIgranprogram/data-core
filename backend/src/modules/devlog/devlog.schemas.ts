import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/** «История проекта» (DEVLOG): коллекции только data-core, без мягкого удаления. Заполняет импорт (`scripts/devlog-import.js`). */

@Schema({ collection: 'devlog_releases', timestamps: true, softDelete: false })
export class DevlogRelease {
  /** `v1.N` (по числу коммитов, менявших приложение). */
  @Prop({ required: true, unique: true }) version!: string;
  @Prop({ required: true, index: true }) date!: Date;
  @Prop({ type: [String], default: [] }) commits!: string[];
  @Prop() summary?: string;
  @Prop() deployedAt?: Date;
}
export const DevlogReleaseSchema = SchemaFactory.createForClass(DevlogRelease);

@Schema({ collection: 'devlog_commits', timestamps: true, softDelete: false })
export class DevlogCommit {
  @Prop({ required: true, unique: true }) hash!: string;
  @Prop({ required: true, index: true }) date!: Date;
  /** День автора `ГГГГ-ММ-ДД` (по его часовому поясу). */
  @Prop({ required: true }) day!: string;
  @Prop() prefix?: string;
  @Prop({ index: true }) area?: string;
  @Prop({ required: true }) subject!: string;
  @Prop({ enum: ['home', 'work'] }) place?: string;
  /** Начало сессии (ISO) — связь с devlog_sessions.key. */
  @Prop() sessionKey?: string;
  @Prop() releaseVersion?: string;
}
export const DevlogCommitSchema = SchemaFactory.createForClass(DevlogCommit);

@Schema({ collection: 'devlog_sessions', timestamps: true, softDelete: false })
export class DevlogSession {
  /** ISO начала сессии. */
  @Prop({ required: true, unique: true }) key!: string;
  @Prop({ required: true, index: true }) start!: Date;
  /** День начала `ГГГГ-ММ-ДД` (по часовому поясу автора первого коммита). */
  @Prop() day?: string;
  @Prop({ required: true }) end!: Date;
  /** Оценка по коммитам. */
  @Prop({ required: true }) hours!: number;
  /** Ручная правка — главнее оценки; импорт не трогает. */
  @Prop() manualHours?: number;
  @Prop({ required: true }) commits!: number;
  @Prop({ enum: ['home', 'work'] }) place?: string;
}
export const DevlogSessionSchema = SchemaFactory.createForClass(DevlogSession);

export const ITEM_TYPES = ['feature', 'fix', 'task', 'error'] as const;
export const ITEM_STATUSES = ['new', 'in_progress', 'fixed', 'not_bug', 'open', 'done'] as const;

@Schema({ _id: false })
class ItemRefs {
  @Prop() commit?: string;
  @Prop() fixCommit?: string;
  @Prop() fixVersion?: string;
  @Prop() file?: string;
}

@Schema({ collection: 'devlog_items', timestamps: true, softDelete: false })
export class DevlogItem {
  /** `task:<код>` | `err:<sig>` | `commit:<hash>`. */
  @Prop({ required: true, unique: true }) key!: string;
  @Prop({ required: true, enum: ITEM_TYPES, index: true }) type!: string;
  @Prop({ required: true }) title!: string;
  @Prop({ index: true }) area?: string;
  @Prop({ enum: ITEM_STATUSES, index: true }) status?: string;
  @Prop({ type: ItemRefs, default: undefined }) refs?: ItemRefs;
  @Prop() closedAt?: Date;
  @Prop() hours?: number;
  @Prop() note?: string;
  /** Правил человек — импорт не затирает. */
  @Prop({ default: false }) manual!: boolean;
  /** Только ошибки: сколько раз, первая/последняя, версия, «вернулась» после fixed. */
  @Prop() count?: number;
  @Prop() firstAt?: Date;
  @Prop({ index: true }) lastAt?: Date;
  @Prop() version?: string;
  @Prop() returned?: boolean;
}
export const DevlogItemSchema = SchemaFactory.createForClass(DevlogItem);

/** Снимок файлов процесса для набора «новый проект» (роли, процессы, шаблоны). */
@Schema({ collection: 'devlog_kit', timestamps: true, softDelete: false })
export class DevlogKit {
  @Prop({ required: true, unique: true }) path!: string;
  @Prop({ required: true }) text!: string;
  @Prop({ required: true }) sha256!: string;
  @Prop() version?: string;
}
export const DevlogKitSchema = SchemaFactory.createForClass(DevlogKit);

export const DOC_KINDS = ['checklist', 'tz', 'audit', 'history'] as const;

@Schema({ collection: 'devlog_docs', timestamps: true, softDelete: false })
export class DevlogDoc {
  @Prop({ required: true, unique: true }) path!: string;
  @Prop({ required: true }) title!: string;
  @Prop({ required: true, enum: DOC_KINDS, index: true }) kind!: string;
  @Prop({ required: true }) text!: string;
  /** sha256 исходного текста (до маскировки секретов) — для сверки перед `git rm`. */
  @Prop({ required: true }) sha256!: string;
  @Prop({ required: true }) importedAt!: Date;
  @Prop() closedAt?: Date;
}
export const DevlogDocSchema = SchemaFactory.createForClass(DevlogDoc);
