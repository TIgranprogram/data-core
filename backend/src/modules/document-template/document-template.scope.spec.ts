import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { DocumentTemplateService } from './document-template.service';
import { DocumentRenderService } from '../document-render/document-render.service';

const ORG_A = new Types.ObjectId().toString();
const ORG_B = new Types.ObjectId();

function lookup<T>(value: T) {
  return {
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  };
}

function createService(overrides: Record<string, unknown> = {}) {
  const model = {};
  const blockModel = {};
  const quotationModel = {};
  const contractModel = { findById: jest.fn().mockReturnValue(lookup(null)) };
  const orderModel = { findById: jest.fn().mockReturnValue(lookup(null)) };
  const orgModel = {};
  const counterpartyModel = { findById: jest.fn().mockReturnValue(lookup(null)) };
  const productModel = { findById: jest.fn().mockReturnValue(lookup(null)) };
  const materialModel = { findById: jest.fn().mockReturnValue(lookup(null)) };
  const workTypeModel = { findById: jest.fn().mockReturnValue(lookup(null)) };
  const textBlockModel = {};
  const counter = {};
  const tableTemplateService = {};
  const categoryService = {};

  const dependencies = {
    model,
    blockModel,
    quotationModel,
    contractModel,
    orderModel,
    orgModel,
    counterpartyModel,
    productModel,
    materialModel,
    workTypeModel,
    textBlockModel,
    counter,
    tableTemplateService,
    categoryService,
    ...overrides,
  };

  return new DocumentTemplateService(
    dependencies.model as never,
    dependencies.blockModel as never,
    dependencies.quotationModel as never,
    dependencies.contractModel as never,
    dependencies.orderModel as never,
    dependencies.orgModel as never,
    dependencies.counterpartyModel as never,
    dependencies.productModel as never,
    dependencies.materialModel as never,
    dependencies.workTypeModel as never,
    dependencies.textBlockModel as never,
    dependencies.counter as never,
    dependencies.tableTemplateService as never,
    dependencies.categoryService as never,
    {} as never,
    new DocumentRenderService(),
  );
}

describe('DocumentTemplateService build source organization scope', () => {
  it('rejects a product from another organization before rendering', async () => {
    const productModel = {
      findById: jest.fn().mockReturnValue(lookup({ organizationId: ORG_B })),
    };
    const service = createService({ productModel });

    await expect(
      service.assertBuildSourcesInOrganization(
        { productId: new Types.ObjectId().toString() },
        ORG_A,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects an explicitly provided invalid source id before lookup', async () => {
    const productModel = { findById: jest.fn() };
    const service = createService({ productModel });

    await expect(
      service.assertBuildSourcesInOrganization({ productId: 'not-an-object-id' }, ORG_A),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(productModel.findById).not.toHaveBeenCalled();
  });

  it('rejects a missing product source instead of silently continuing', async () => {
    const productModel = {
      findById: jest.fn().mockReturnValue(lookup(null)),
    };
    const service = createService({ productModel });

    await expect(
      service.assertBuildSourcesInOrganization(
        { productId: new Types.ObjectId().toString() },
        ORG_A,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a missing order source instead of silently continuing', async () => {
    const orderModel = {
      findById: jest.fn().mockReturnValue(lookup(null)),
    };
    const service = createService({ orderModel });

    await expect(
      service.assertBuildSourcesInOrganization(
        { orderId: new Types.ObjectId().toString() },
        ORG_A,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a contract relationship with a foreign counterparty', async () => {
    const contractId = new Types.ObjectId().toString();
    const contractModel = {
      findById: jest.fn().mockReturnValue(
        lookup({ customerId: new Types.ObjectId(), organizationId: ORG_A }),
      ),
    };
    const counterpartyModel = {
      findById: jest.fn().mockReturnValue(lookup({ organizationId: ORG_B })),
    };
    const service = createService({ contractModel, counterpartyModel });

    await expect(
      service.assertBuildSourcesInOrganization({ contractId }, ORG_A),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects an order without a valid organization-owned relationship', async () => {
    const orderModel = {
      findById: jest.fn().mockReturnValue(
        lookup({ counterpartyId: new Types.ObjectId() }),
      ),
    };
    const counterpartyModel = {
      findById: jest.fn().mockReturnValue(lookup({ organizationId: ORG_B })),
    };
    const service = createService({ orderModel, counterpartyModel });

    await expect(
      service.assertBuildSourcesInOrganization(
        { orderId: new Types.ObjectId().toString() },
        ORG_A,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects an order whose item references a foreign product', async () => {
    const orderModel = {
      findById: jest.fn().mockReturnValue(
        lookup({
          counterpartyId: new Types.ObjectId(),
          items: [{ productId: new Types.ObjectId() }],
        }),
      ),
    };
    const counterpartyModel = {
      findById: jest.fn().mockReturnValue(lookup({ organizationId: ORG_A })),
    };
    const productModel = {
      findById: jest.fn().mockReturnValue(lookup({ organizationId: ORG_B })),
    };
    const service = createService({ orderModel, counterpartyModel, productModel });

    await expect(
      service.assertBuildSourcesInOrganization(
        { orderId: new Types.ObjectId().toString() },
        ORG_A,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('allows same-organization sources and shared work types', async () => {
    const productModel = {
      findById: jest.fn().mockReturnValue(lookup({ organizationId: ORG_A })),
    };
    const materialModel = {
      findById: jest.fn().mockReturnValue(lookup({ organizationId: ORG_A })),
    };
    const workTypeModel = {
      findById: jest.fn().mockReturnValue(lookup({ name: 'Сборка' })),
    };
    const service = createService({ productModel, materialModel, workTypeModel });

    await expect(
      service.assertBuildSourcesInOrganization(
        {
          productId: new Types.ObjectId().toString(),
          materialId: new Types.ObjectId().toString(),
          workTypeId: new Types.ObjectId().toString(),
        },
        ORG_A,
      ),
    ).resolves.toBeUndefined();
  });
});
