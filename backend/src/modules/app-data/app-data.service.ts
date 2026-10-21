import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { Types } from 'mongoose';
import {
  APP_COLLECTION_PREFIX,
  MAX_BULK,
  assertDocumentSize,
  mongoCollectionName,
  parseFilter,
  parseMongoCollectionName,
  parseObjectId,
  parsePagination,
  parseSort,
  sanitizeDocument,
} from './app-data.validation';

type RawDoc = Record<string, unknown> & { _id: Types.ObjectId };
export type AppDoc = Record<string, unknown> & { id: string; _id: string };

export interface ListQuery {
  page?: string;
  limit?: string;
  sort?: string;
  filter?: string;
}

/** Документы, помеченные удалёнными, скрыты во всех чтениях и изменениях. */
const NOT_DELETED = { deletedAt: null };

/**
 * P1 — универсальное хранилище JSON-документов приложений.
 * Сырые коллекции `app_<app>_<collection>` через Connection (без Mongoose-схем):
 * глобальные плагины (soft-delete, audit) сюда не действуют, поэтому служебные
 * поля `createdAt/updatedAt/createdBy/updatedBy/deletedAt` ставит этот сервис.
 */
@Injectable()
export class AppDataService {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  private coll(app: string, collection: string) {
    const db = this.connection?.db;
    if (!db) throw new BadRequestException('MongoDB is not connected');
    return db.collection<RawDoc>(mongoCollectionName(app, collection));
  }

  /** `_id` → строка + `id` рядом (контракт: в ответах всегда оба). */
  static toClient(doc: RawDoc): AppDoc {
    const id = String(doc._id);
    return { id, ...doc, _id: id };
  }

  /** GET /apps — приложения и их коллекции; `apps` (scope ключа) сужает список. */
  async listApps(allowed: string[] | null) {
    const db = this.connection?.db;
    if (!db) throw new BadRequestException('MongoDB is not connected');
    const raw = await db
      .listCollections({ name: { $regex: `^${APP_COLLECTION_PREFIX}` } }, { nameOnly: true })
      .toArray();

    const byApp = new Map<string, { name: string; count: number; deleted: number }[]>();
    for (const { name } of raw) {
      const parsed = parseMongoCollectionName(name);
      if (!parsed) continue;
      if (allowed !== null && !allowed.includes(parsed.app)) continue;
      const c = db.collection(name);
      const [count, deleted] = await Promise.all([
        c.countDocuments(NOT_DELETED),
        c.countDocuments({ deletedAt: { $ne: null } }),
      ]);
      const list = byApp.get(parsed.app) ?? [];
      list.push({ name: parsed.collection, count, deleted });
      byApp.set(parsed.app, list);
    }

    const items = [...byApp.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([app, collections]) => ({
        app,
        collections: collections.sort((a, b) => a.name.localeCompare(b.name)),
      }));
    return { items, total: items.length };
  }

  async list(app: string, collection: string, q: ListQuery) {
    const c = this.coll(app, collection);
    const { page, limit } = parsePagination(q.page, q.limit);
    const sort = parseSort(q.sort);
    const userFilter = parseFilter(q.filter);
    const filter = Object.keys(userFilter).length ? { $and: [userFilter, NOT_DELETED] } : NOT_DELETED;

    const [docs, total] = await Promise.all([
      c.find(filter).sort(sort).skip((page - 1) * limit).limit(limit).toArray(),
      c.countDocuments(filter),
    ]);
    return { items: docs.map((d) => AppDataService.toClient(d)), total, page, limit };
  }

  async findOne(app: string, collection: string, id: string): Promise<AppDoc> {
    const c = this.coll(app, collection);
    const doc = await c.findOne({ _id: parseObjectId(id), ...NOT_DELETED });
    if (!doc) throw new NotFoundException('Документ не найден');
    return AppDataService.toClient(doc);
  }

  /** Объект → один документ (201 с документом); массив → bulk `{ items, total }`. */
  async create(app: string, collection: string, body: unknown, userId?: string) {
    const c = this.coll(app, collection);
    const now = new Date();
    const stamp = (d: Record<string, unknown>): RawDoc => ({
      ...d,
      _id: new Types.ObjectId(),
      createdAt: now,
      updatedAt: now,
      createdBy: userId ?? null,
      updatedBy: userId ?? null,
      deletedAt: null,
    });

    if (Array.isArray(body)) {
      if (body.length === 0) throw new BadRequestException('Пустой массив: нечего создавать');
      if (body.length > MAX_BULK) throw new BadRequestException(`За один запрос не больше ${MAX_BULK} документов`);
      const docs = body.map((b, i) => stamp(sanitizeDocument(b, `Документ [${i}]`)));
      await c.insertMany(docs, { ordered: true });
      return { items: docs.map((d) => AppDataService.toClient(d)), total: docs.length };
    }

    const doc = stamp(sanitizeDocument(body));
    await c.insertOne(doc);
    return AppDataService.toClient(doc);
  }

  /** PATCH — поверхностное слияние верхнего уровня (`$set` по ключам тела). */
  async patch(app: string, collection: string, id: string, body: unknown, userId?: string): Promise<AppDoc> {
    const c = this.coll(app, collection);
    const _id = parseObjectId(id);
    const changes = sanitizeDocument(body);
    const current = await c.findOne({ _id, ...NOT_DELETED });
    if (!current) throw new NotFoundException('Документ не найден');
    assertDocumentSize({ ...current, ...changes });

    const updated = await c.findOneAndUpdate(
      { _id, ...NOT_DELETED },
      { $set: { ...changes, updatedAt: new Date(), updatedBy: userId ?? null } },
      { returnDocument: 'after' },
    );
    if (!updated) throw new NotFoundException('Документ не найден');
    return AppDataService.toClient(updated);
  }

  /** PUT — полная замена пользовательских полей; createdAt/createdBy сохраняются. */
  async replace(app: string, collection: string, id: string, body: unknown, userId?: string): Promise<AppDoc> {
    const c = this.coll(app, collection);
    const _id = parseObjectId(id);
    const fields = sanitizeDocument(body);
    const current = await c.findOne({ _id, ...NOT_DELETED });
    if (!current) throw new NotFoundException('Документ не найден');

    const next: RawDoc = {
      ...fields,
      _id,
      createdAt: current.createdAt ?? null,
      createdBy: current.createdBy ?? null,
      updatedAt: new Date(),
      updatedBy: userId ?? null,
      deletedAt: null,
    };
    const res = await c.replaceOne({ _id, ...NOT_DELETED }, next);
    if (res.matchedCount === 0) throw new NotFoundException('Документ не найден');
    return AppDataService.toClient(next);
  }

  /** Soft-delete (`deletedAt`); `hard` — физическое удаление (в т.ч. уже помеченного). */
  async remove(app: string, collection: string, id: string, hard: boolean, userId?: string) {
    const c = this.coll(app, collection);
    const _id = parseObjectId(id);
    if (hard) {
      const res = await c.deleteOne({ _id });
      if (res.deletedCount === 0) throw new NotFoundException('Документ не найден');
    } else {
      const res = await c.updateOne(
        { _id, ...NOT_DELETED },
        { $set: { deletedAt: new Date(), updatedAt: new Date(), updatedBy: userId ?? null } },
      );
      if (res.matchedCount === 0) throw new NotFoundException('Документ не найден');
    }
    return { id: String(_id), _id: String(_id), deleted: true, hard };
  }
}
