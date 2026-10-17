import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { Category, CategoryDocument } from './category.schema';

export interface CategoryNode {
  _id: string;
  name: string;
  slug: string;
  type: string;
  parentId?: string;
  fullPath?: string;
  skuPrefix: string;
  sortOrder: number;
  isActive: boolean;
  children: CategoryNode[];
}

@Injectable()
export class CategoryService {
  private readonly logger = new Logger(CategoryService.name);

  constructor(@InjectModel(Category.name) private readonly model: Model<CategoryDocument>) {}

  async create(dto: CreateCategoryDto, organizationId?: string | null): Promise<CategoryDocument> {
    const fullPath = await this.buildFullPath(dto.name, dto.parentId, organizationId);
    try {
      return await this.model.create({ ...dto, fullPath, ...this.organizationWrite(organizationId) });
    } catch (err) {
      this.rethrowDuplicate(err);
    }
  }

  async findAll(type?: string, organizationId?: string | null): Promise<CategoryDocument[]> {
    const filter: Record<string, unknown> = { deletedAt: null, ...this.organizationFilter(organizationId) };
    if (type) filter.type = type;
    return this.model.find(filter).sort({ type: 1, fullPath: 1 }).exec();
  }

  async findById(id: string, organizationId?: string | null): Promise<CategoryDocument> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException(`Category ${id} not found`);
    const doc = await this.model.findOne({ _id: new Types.ObjectId(id), deletedAt: null, ...this.organizationFilter(organizationId) }).exec();
    if (!doc) throw new NotFoundException(`Category ${id} not found`);
    return doc;
  }

  async update(id: string, dto: UpdateCategoryDto, organizationId?: string | null): Promise<CategoryDocument> {
    const doc = await this.findById(id, organizationId);
    const oldParentId = doc.parentId ? doc.parentId.toString() : null;
    const oldFullPath = doc.fullPath ?? doc.name;
    const newName = dto.name ?? doc.name;
    const newParentId = 'parentId' in dto ? (dto.parentId ? String(dto.parentId) : null) : oldParentId;
    const nameChanged = dto.name !== undefined && dto.name !== doc.name;
    const parentChanged = newParentId !== oldParentId;
    if (newParentId) {
      const isDescendant = await this.isDescendantOf(newParentId, id, organizationId);
      if (isDescendant) throw new BadRequestException('Cannot move category under its own descendant (would create a cycle)');
    }
    const newFullPath = await this.buildFullPath(newName, newParentId, organizationId, id);
    Object.assign(doc, { ...dto, fullPath: newFullPath });
    try {
      await doc.save();
    } catch (err) {
      this.rethrowDuplicate(err);
    }
    if (nameChanged || parentChanged || oldFullPath !== newFullPath) {
      await this.rebuildDescendantFullPaths(id, organizationId);
    }
    return doc;
  }

  /**
   * Rebuild every descendant fullPath from name segments (BFS by parentId).
   * Prefer this over string-prefix replace so slug-era paths like metals/sheet
   * become Сплавы/Лист after renaming Металлы → Сплавы.
   */
  private async rebuildDescendantFullPaths(rootId: string, organizationId?: string | null): Promise<void> {
    const queue: string[] = [rootId];
    const visited = new Set<string>([rootId]);
    const ops: Array<{ updateOne: { filter: { _id: Types.ObjectId }; update: { $set: { fullPath: string } } } }> = [];
    const pathById = new Map<string, string>();
    const root = await this.findById(rootId, organizationId);
    pathById.set(rootId, root.fullPath ?? root.name);

    while (queue.length > 0) {
      const parentId = queue.shift()!;
      const parentPath = pathById.get(parentId)!;
      const children = await this.model
        .find({ parentId: new Types.ObjectId(parentId), deletedAt: null, ...this.organizationFilter(organizationId) })
        .exec();
      for (const child of children) {
        const childId = child._id.toString();
        if (visited.has(childId)) continue;
        visited.add(childId);
        const nextPath = `${parentPath}/${child.name}`;
        pathById.set(childId, nextPath);
        if (child.fullPath !== nextPath) {
          ops.push({ updateOne: { filter: { _id: child._id as Types.ObjectId }, update: { $set: { fullPath: nextPath } } } });
        }
        queue.push(childId);
      }
    }
    if (ops.length > 0) await this.model.bulkWrite(ops);
  }

  /** One-shot: rewrite slug-era fullPath values to name segments for the whole org tree. */
  async migrateFullPathsToNames(organizationId?: string | null): Promise<number> {
    const flat = await this.findAll(undefined, organizationId);
    const byId = new Map(flat.map((c) => [c.id, c]));
    const resolve = (cat: CategoryDocument): string => {
      if (!cat.parentId) return cat.name;
      const parent = byId.get(cat.parentId.toString());
      return parent ? `${resolve(parent)}/${cat.name}` : cat.name;
    };
    const ops = flat
      .map((cat) => {
        const next = resolve(cat);
        return cat.fullPath === next
          ? null
          : { updateOne: { filter: { _id: cat._id }, update: { $set: { fullPath: next } } } };
      })
      .filter((op): op is NonNullable<typeof op> => op !== null);
    if (ops.length > 0) await this.model.bulkWrite(ops);
    return ops.length;
  }

  async remove(id: string, organizationId?: string | null): Promise<void> {
    const doc = await this.findById(id, organizationId);
    const child = await this.model.findOne({ parentId: doc._id, deletedAt: null, ...this.organizationFilter(organizationId) }).select('_id').exec();
    const refs = await Promise.all([
      this.model.db.collection('products').findOne({ categoryId: doc._id }),
      this.model.db.collection('materials').findOne({ categoryId: doc._id }),
    ]);
    if (child || refs.some(Boolean)) throw new ConflictException('Category has active children or catalog references and cannot be archived');
    await this.model.updateOne({ _id: doc._id, deletedAt: null, ...this.organizationFilter(organizationId) }, { $set: { deletedAt: new Date(), isActive: false } }).exec();
  }

  async reorder(categoryIds: string[], organizationId?: string | null): Promise<CategoryDocument[]> {
    const invalid = categoryIds.find((id) => !Types.ObjectId.isValid(id));
    if (invalid) throw new BadRequestException(`Invalid category id: ${invalid}`);
    const session = await this.model.db.startSession(); session.startTransaction();
    try {
      const ops = categoryIds.map((id, index) => ({ updateOne: { filter: { _id: new Types.ObjectId(id), deletedAt: null, ...this.organizationFilter(organizationId) }, update: { $set: { sortOrder: index } } } }));
      await this.model.bulkWrite(ops, { session }); await session.commitTransaction();
    } catch (e) { await session.abortTransaction(); throw e; } finally { session.endSession(); }
    return this.findAll(undefined, organizationId);
  }

  async reorderChildren(parentId: string | null, childIds: string[], organizationId?: string | null): Promise<CategoryDocument[]> {
    if (parentId && !Types.ObjectId.isValid(parentId)) throw new BadRequestException(`Invalid parent id: ${parentId}`);
    const invalidChild = childIds.find((id) => !Types.ObjectId.isValid(id));
    if (invalidChild) throw new BadRequestException(`Invalid child category id: ${invalidChild}`);
    const filter: Record<string, unknown> = parentId ? { parentId: new Types.ObjectId(parentId) } : { parentId: { $exists: false } };
    const existing = await this.model.find({ _id: { $in: childIds.map((id) => new Types.ObjectId(id)) }, ...filter, deletedAt: null, ...this.organizationFilter(organizationId) }).select('_id').exec();
    const validIds = new Set(existing.map((d: CategoryDocument) => d._id.toString()));
    const ops = childIds.filter((id) => validIds.has(id)).map((id, index) => ({ updateOne: { filter: { _id: new Types.ObjectId(id) }, update: { $set: { sortOrder: index } } } }));
    if (ops.length > 0) { const session = await this.model.db.startSession(); session.startTransaction(); try { await this.model.bulkWrite(ops, { session }); await session.commitTransaction(); } catch (e) { await session.abortTransaction(); throw e; } finally { session.endSession(); } }
    return this.findAll(undefined, organizationId);
  }

  async buildTree(type?: string, organizationId?: string | null): Promise<CategoryNode[]> {
    const flat = await this.findAll(type, organizationId);
    const map = new Map<string, CategoryNode>();
    flat.forEach((c) => { const obj = c.toObject() as { name: string; slug: string; type: string; parentId?: Types.ObjectId; fullPath?: string; skuPrefix: string; sortOrder: number; isActive: boolean; description?: string }; map.set(c.id, { _id: c.id, name: obj.name, slug: obj.slug, type: obj.type, parentId: obj.parentId?.toString(), fullPath: obj.fullPath, skuPrefix: obj.skuPrefix, sortOrder: obj.sortOrder, isActive: obj.isActive, children: [] }); });
    const roots: CategoryNode[] = [];
    for (const node of map.values()) { if (node.parentId && map.has(node.parentId)) map.get(node.parentId)!.children.push(node); else roots.push(node); }
    return roots;
  }

  private async buildFullPath(
    name: string,
    parentId: string | undefined | null,
    organizationId?: string | null,
    excludeId?: string,
  ): Promise<string> {
    if (!parentId) return name;
    if (excludeId && parentId === excludeId) {
      throw new BadRequestException('Category cannot be its own parent');
    }
    const parent = await this.findById(parentId, organizationId);
    if (excludeId && parent._id.toString() === excludeId) {
      throw new BadRequestException('Category cannot be its own parent');
    }
    return parent.fullPath ? `${parent.fullPath}/${name}` : `${parent.name}/${name}`;
  }

  private async isDescendantOf(candidateDescendantId: string, ancestorId: string, organizationId?: string | null): Promise<boolean> {
    let currentId = candidateDescendantId; const visited = new Set<string>();
    while (currentId) {
      if (currentId === ancestorId) return true;
      if (visited.has(currentId)) break;
      visited.add(currentId);
      const doc = await this.model.findOne({ _id: new Types.ObjectId(currentId), deletedAt: null, ...this.organizationFilter(organizationId) }).select('parentId').lean().exec();
      if (!doc?.parentId) break;
      currentId = doc.parentId.toString();
    }
    return false;
  }

  /**
   * TZ-NX-CATEGORY-DUPLICATE-SLUG-409 — a raw Mongo E11000 on the compound
   * `{type, slug}` unique index (common after `suggestSkuPrefix()`'s ~16-char
   * translit truncation collapses two different names to the same slug) or
   * on the standalone `skuPrefix` unique index used to surface as an
   * uncaught 500 ("Internal server error"), same class of bug
   * `ProductService`/`MaterialService` already guard against for their own
   * unique fields.
   */
  private rethrowDuplicate(err: unknown): never {
    if ((err as { code?: number })?.code === 11000) {
      const keyPattern = (err as { keyPattern?: Record<string, unknown> }).keyPattern ?? {};
      if ('skuPrefix' in keyPattern) {
        throw new ConflictException('Префикс SKU уже используется другой категорией');
      }
      throw new ConflictException('Категория с таким названием уже существует для этого типа');
    }
    throw err;
  }

  private organizationFilter(organizationId?: string | null): Record<string, unknown> {
    if (!organizationId) return {};
    if (!Types.ObjectId.isValid(organizationId)) throw new BadRequestException('Invalid organization scope');
    const id = new Types.ObjectId(organizationId);
    return { $or: [{ organizationId: id }, { organizationId: null }, { organizationId: { $exists: false } }] };
  }
  private organizationWrite(organizationId?: string | null): Record<string, unknown> {
    if (!organizationId) return {};
    if (!Types.ObjectId.isValid(organizationId)) throw new BadRequestException('Invalid organization scope');
    return { organizationId: new Types.ObjectId(organizationId) };
  }
}
