import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, QueryOptions, Types } from 'mongoose';
import { Material, MaterialDocument } from '../material/material.schema';
import { computeNeeds, flattenNeeds, NeedsMaterial, NeedsResult, NeedsTreeNode } from '../../common/catalog/purchase-needs';
import { ProductService } from './product.service';

const WITH_DELETED = { includeSoftDeleted: true } as QueryOptions;
const FIELDS = 'name article unit materialKind stockQty isProfile scrapFactor isDefaultFormat profileId dimensions';

type Lean = { _id: Types.ObjectId; name?: string; article?: string; unit?: string; materialKind?: string | null; stockQty?: number; isProfile?: boolean; scrapFactor?: number; isDefaultFormat?: boolean; profileId?: Types.ObjectId; dimensions?: Array<{ type: string; value: number }> };
const toMaterial = (r: Lean): NeedsMaterial => ({
  id: String(r._id), name: r.name ?? String(r._id), article: r.article, unit: r.unit, materialKind: r.materialKind, stockQty: r.stockQty,
  isProfile: r.isProfile, scrapFactor: r.scrapFactor, isDefaultFormat: r.isDefaultFormat, profileId: r.profileId ? String(r.profileId) : undefined, dimensions: r.dimensions,
});

/** «Что купить» на N изделий: обход состава (CatalogGraphService) → сырьё по сортаментам, метизы, покупные. */
@Injectable()
export class PurchaseNeedsService {
  constructor(private readonly products: ProductService, @InjectModel(Material.name) private readonly materialModel: Model<MaterialDocument>) {}

  async forProduct(id: string, rawQty: string | undefined, organizationId?: string | null): Promise<NeedsResult> {
    const qty = rawQty === undefined || rawQty === '' ? 1 : Number(rawQty);
    if (!Number.isFinite(qty) || qty <= 0 || qty > 1e6) throw new BadRequestException('Количество изделий должно быть числом больше нуля');
    const tree = (await this.products.getTree(id, 8, organizationId)) as unknown as NeedsTreeNode;
    const { totals, parts } = flattenNeeds(tree, qty);
    if (totals.size === 0) return { items: [], missingBlank: [] };
    const ids = [...totals.keys()].filter((x) => Types.ObjectId.isValid(x)).map((x) => new Types.ObjectId(x));
    const found = (await this.materialModel.find({ _id: { $in: ids } }).setOptions(WITH_DELETED).select(FIELDS).lean().exec()) as unknown as Lean[];
    const materials = new Map(found.map((r) => [String(r._id), toMaterial(r)]));
    const profileIds = found.filter((r) => r.isProfile).map((r) => r._id);
    const formats = profileIds.length
      ? ((await this.materialModel.find({ profileId: { $in: profileIds } }).select(FIELDS).lean().exec()) as unknown as Lean[]).map(toMaterial)
      : [];
    return computeNeeds(totals, parts, materials, formats);
  }
}
