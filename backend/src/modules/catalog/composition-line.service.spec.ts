import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { CompositionLineService } from './composition-line.service';
import { CompositionLineDocumentShape } from './composition-line.schema';

describe('CompositionLineService', () => {
  const svc = new CompositionLineService();

  describe('upsertDeduplicated', () => {
    function line(overrides: Partial<CompositionLineDocumentShape> = {}): CompositionLineDocumentShape {
      const id = new Types.ObjectId();
      const refId = overrides.refId ?? new Types.ObjectId();
      return {
        _id: overrides._id ?? id,
        lineType: overrides.lineType ?? 'material',
        refId,
        quantity: overrides.quantity ?? 1,
        sortOrder: overrides.sortOrder ?? 0,
        unitPriceOverride: overrides.unitPriceOverride,
      };
    }

    it('appends when no duplicate exists', () => {
      const refA = new Types.ObjectId();
      const existing = line({ refId: refA, lineType: 'module', quantity: 1 });
      const incoming = line({ refId: new Types.ObjectId(), lineType: 'module', quantity: 1 });
      const result = svc.upsertDeduplicated([existing], incoming);
      expect(result).toHaveLength(2);
      expect(result[1].quantity).toBe(1);
    });

    it('increments quantity on duplicate (lineType, refId) — 2+3=5', () => {
      const refId = new Types.ObjectId();
      const existing = line({ refId, lineType: 'module', quantity: 2 });
      const incoming = line({ _id: new Types.ObjectId(), refId, lineType: 'module', quantity: 3 });
      const result = svc.upsertDeduplicated([existing], incoming);
      expect(result).toHaveLength(1);
      expect(result[0].quantity).toBe(5);
      expect(result[0]._id.toString()).toBe(existing._id.toString());
    });

    it('distinguishes different lineTypes with same refId', () => {
      const refId = new Types.ObjectId();
      const existing = line({ refId, lineType: 'module', quantity: 2 });
      const incoming = line({ refId, lineType: 'material', quantity: 3 });
      const result = svc.upsertDeduplicated([existing], incoming);
      expect(result).toHaveLength(2);
    });

    it('matches refId by hex string equality (not ObjectId instance)', () => {
      const hex = new Types.ObjectId().toHexString();
      const existing = line({ refId: new Types.ObjectId(hex), lineType: 'material', quantity: 10 });
      const incoming = line({ refId: new Types.ObjectId(hex), lineType: 'material', quantity: 1 });
      const result = svc.upsertDeduplicated([existing], incoming);
      expect(result).toHaveLength(1);
      expect(result[0].quantity).toBe(11);
    });

    it('preserves unitPriceOverride on product line upsert', () => {
      const refId = new Types.ObjectId();
      const existing = line({ refId, lineType: 'product', quantity: 1, unitPriceOverride: 100 });
      const incoming = line({ refId: new Types.ObjectId(), lineType: 'product', quantity: 1, unitPriceOverride: 200 });
      const result = svc.upsertDeduplicated([existing], incoming);
      expect(result).toHaveLength(2);
      expect(result[1].unitPriceOverride).toBe(200);
    });
  });

  describe('assertLineType', () => {
    it('accepts module', () => { expect(() => svc.assertLineType('module')).not.toThrow(); });
    it('accepts material', () => { expect(() => svc.assertLineType('material')).not.toThrow(); });
    it('accepts product (TZ-CATALOG-305)', () => { expect(() => svc.assertLineType('product')).not.toThrow(); });
    it('rejects unknown', () => { expect(() => svc.assertLineType('service')).toThrow(BadRequestException); });
  });

  describe('toStoredLine', () => {
    it('creates a product line with unitPriceOverride', () => {
      const refId = new Types.ObjectId().toHexString();
      const dto = { lineType: 'product' as const, refId, quantity: 2, unitPriceOverride: 150 };
      const line = svc.toStoredLine(dto);
      expect(line.lineType).toBe('product');
      expect(line.refId.toHexString()).toBe(refId);
      expect(line.quantity).toBe(2);
      expect(line.unitPriceOverride).toBe(150);
    });

    it('creates a product line without override (optional)', () => {
      const refId = new Types.ObjectId().toHexString();
      const dto = { lineType: 'product' as const, refId, quantity: 1 };
      const line = svc.toStoredLine(dto);
      expect(line.lineType).toBe('product');
      expect(line.unitPriceOverride).toBeUndefined();
    });
  });

  describe('validateReference (TZ-CATALOG-305)', () => {
    function mockModels(productExists: boolean) {
      const productModel = {
        findById: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnThis(),
          lean: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue(productExists ? { _id: new Types.ObjectId() } : null),
        }),
      };
      return { productModel, models: { materialModel: {} as any, moduleModel: {} as any, productModel: productModel as any } };
    }

    it('validates existing product refId', async () => {
      const { models } = mockModels(true);
      const line = { _id: new Types.ObjectId(), lineType: 'product' as const, refId: new Types.ObjectId(), quantity: 1, sortOrder: 0 };
      await expect(svc.validateReference('product', line, models)).resolves.toBeUndefined();
    });

    it('rejects missing product refId', async () => {
      const { models } = mockModels(false);
      const line = { _id: new Types.ObjectId(), lineType: 'product' as const, refId: new Types.ObjectId(), quantity: 1, sortOrder: 0 };
      await expect(svc.validateReference('product', line, models)).rejects.toThrow(NotFoundException);
    });

    it('rejects product line on module parentKind', async () => {
      const { models } = mockModels(true);
      const line = { _id: new Types.ObjectId(), lineType: 'product' as const, refId: new Types.ObjectId(), quantity: 1, sortOrder: 0 };
      await expect(svc.validateReference('module', line, models)).rejects.toThrow(/Product lines may only be added to products/i);
    });

    it('rejects unitPriceOverride on non-product line', async () => {
      const { models } = mockModels(true);
      const line = { _id: new Types.ObjectId(), lineType: 'material' as const, refId: new Types.ObjectId(), quantity: 1, sortOrder: 0, unitPriceOverride: 100 };
      await expect(svc.validateReference('product', line, models)).rejects.toThrow(/unitPriceOverride is only allowed on product lines/i);
    });
  });

  describe('validateReference — material parent (TZ-NX-DETAIL-MATERIAL-BOM)', () => {
    function mockMaterialModel(material: { materialKind?: string } | null) {
      return {
        findById: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnThis(),
          lean: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue(material),
        }),
      } as any;
    }

    it('accepts a raw material into a Деталь composition', async () => {
      const materialModel = mockMaterialModel({ materialKind: 'raw' });
      const line = { _id: new Types.ObjectId(), lineType: 'material' as const, refId: new Types.ObjectId(), quantity: 1, sortOrder: 0 };
      await expect(svc.validateReference('material', line, { materialModel })).resolves.toBeUndefined();
    });

    it('rejects a non-raw material into a Деталь composition', async () => {
      const materialModel = mockMaterialModel({ materialKind: 'part' });
      const line = { _id: new Types.ObjectId(), lineType: 'material' as const, refId: new Types.ObjectId(), quantity: 1, sortOrder: 0 };
      await expect(svc.validateReference('material', line, { materialModel })).rejects.toThrow(
        /только сырьё/i,
      );
    });

    it('rejects a missing material refId', async () => {
      const materialModel = mockMaterialModel(null);
      const line = { _id: new Types.ObjectId(), lineType: 'material' as const, refId: new Types.ObjectId(), quantity: 1, sortOrder: 0 };
      await expect(svc.validateReference('material', line, { materialModel })).rejects.toThrow(NotFoundException);
    });

    it('rejects a module or product line on a material parent', async () => {
      const materialModel = mockMaterialModel({ materialKind: 'raw' });
      const moduleLine = { _id: new Types.ObjectId(), lineType: 'module' as const, refId: new Types.ObjectId(), quantity: 1, sortOrder: 0 };
      await expect(svc.validateReference('material', moduleLine, { materialModel })).rejects.toThrow(
        /только материалы/i,
      );
    });
  });
});
