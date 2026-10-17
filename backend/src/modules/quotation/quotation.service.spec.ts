import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { QuotationService } from './quotation.service';
import { QuotationStatus } from './quotation.schema';

const COUNTERPARTY = new Types.ObjectId().toString();
const ORG = new Types.ObjectId().toString();

/** Minimal mock Mongoose document (toObject-free). */
function quotationDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(),
    number: 'QTN-0001',
    organizationId: new Types.ObjectId(ORG),
    counterpartyId: new Types.ObjectId(COUNTERPARTY),
    date: new Date(),
    status: 'draft',
    total: 0,
    items: [] as Array<Record<string, unknown>>,
    familyRole: 'solo' as string,
    familyVersion: 1,
    orgMarkupPercent: undefined as number | undefined,
    masterId: undefined as Types.ObjectId | undefined,
    convertedOrderId: undefined as string | undefined,
    convertedContractId: undefined as string | undefined,
    isActive: true,
    currentVersion: 0,
    versions: [] as Array<{
      version: number;
      frozenAt: Date;
      frozenBy?: Types.ObjectId;
      payload: Record<string, unknown>;
    }>,
    save: jest.fn().mockImplementation(function (this: unknown) {
      return Promise.resolve(this);
    }),
    ...overrides,
  };
}

/** Minimal mock Mongoose query wrapper (matching project convention). */
function mockQuery<T>(value: T) {
  return {
    populate: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  };
}

function createService(overrides: Record<string, unknown> = {}) {
  const model = {
    findOne: jest.fn(),
    find: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    updateOne: jest.fn().mockReturnValue(mockQuery({ matchedCount: 1 })),
    db: { models: {} as Record<string, unknown> },
  };
  const counter = { next: jest.fn().mockResolvedValue('QTN-0001') };
  const contractService = {
    create: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
  };
  const orderService = {
    create: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
  };
  const sites = {
    ensureDefaultForCounterparty: jest
      .fn()
      .mockResolvedValue({ _id: new Types.ObjectId() }),
  };
  const dependencies = {
    model,
    counter,
    contractService,
    orderService,
    sites,
    ...overrides,
  };
  return {
    service: new QuotationService(
      dependencies.model as never,
      dependencies.counter as never,
      dependencies.contractService as never,
      dependencies.orderService as never,
      dependencies.sites as never,
    ),
    model: dependencies.model as {
      findOne: jest.Mock;
      find: jest.Mock;
      findById: jest.Mock;
      create: jest.Mock;
      updateOne: jest.Mock;
    },
    counter: dependencies.counter as { next: jest.Mock },
    contractService: dependencies.contractService as { create: jest.Mock },
    orderService: dependencies.orderService as { create: jest.Mock },
    sites: dependencies.sites as { ensureDefaultForCounterparty: jest.Mock },
  };
}

function validCreateDto(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORG,
    counterpartyId: COUNTERPARTY,
    items: [
      {
        productId: new Types.ObjectId().toString(),
        productName: 'Стенд напольный',
        productSku: 'SKU-100',
        quantity: 2,
        unit: 'шт',
        unitPrice: 5000,
      },
    ],
    ...overrides,
  };
}

describe('QuotationService — SALES-301 (КП thin UI)', () => {
  describe('create (snapshot semantics)', () => {
    it('stores the productName/productSku SNAPSHOT verbatim from the DTO', async () => {
      const { service, model } = createService();
      model.create.mockResolvedValue(quotationDoc({}));

      const dto = validCreateDto({
        items: [
          {
            productId: new Types.ObjectId().toString(),
            productName: 'Старое название бренда',
            productSku: 'SKU-OLD',
            quantity: 3,
            unit: 'шт',
            unitPrice: 100,
          },
        ],
      });
      await service.create(dto as never);

      const created = model.create.mock.calls[0][0];
      expect(created.items[0]).toMatchObject({
        productName: 'Старое название бренда',
        productSku: 'SKU-OLD',
        quantity: 3,
        unit: 'шт',
        unitPrice: 100,
        total: 300,
      });
      // Ref stored as raw ObjectId — display MUST use the inline snapshot.
      expect(created.items[0].productId).toBeInstanceOf(Types.ObjectId);
    });

    it('stores photoUrl snapshot for A4 line-items photo column', async () => {
      const { service, model } = createService();
      model.create.mockResolvedValue(quotationDoc({}));

      const dto = validCreateDto({
        items: [
          {
            productId: new Types.ObjectId().toString(),
            productName: 'Стенд',
            productSku: 'ST-1',
            photoUrl: '/uploads/stand-thumb.webp',
            quantity: 1,
            unit: 'шт',
            unitPrice: 100,
          },
        ],
      });
      await service.create(dto as never);

      expect(model.create.mock.calls[0][0].items[0]).toMatchObject({
        photoUrl: '/uploads/stand-thumb.webp',
        productName: 'Стенд',
      });
    });

    it('NO-MUTATION-ON-CATALOG-CHANGE: create does NOT look up the product (no $lookup / no populate at write time)', async () => {
      const { service, model } = createService();
      model.create.mockResolvedValue(quotationDoc({}));

      await service.create(validCreateDto() as never);
      expect(model.findOne).not.toHaveBeenCalled();
      expect(model.findById).not.toHaveBeenCalled();
    });

    it('generates the number via counter when omitted', async () => {
      const { service, model, counter } = createService();
      model.create.mockResolvedValue(quotationDoc({}));

      await service.create(validCreateDto({ number: undefined }) as never);
      expect(counter.next).toHaveBeenCalledWith('Quotation', 'QTN');
      expect(model.create.mock.calls[0][0]).toMatchObject({
        number: 'QTN-0001',
      });
    });

    it('applies a PERCENT discount to the computed total', async () => {
      const { service, model } = createService();
      model.create.mockResolvedValue(quotationDoc({}));

      await service.create(
        validCreateDto({
          discountType: 'percent',
          discountPercent: 10,
        }) as never,
      );
      expect(model.create.mock.calls[0][0]).toMatchObject({ total: 9000 });
    });

    it('applies an AMOUNT discount to the computed total', async () => {
      const { service, model } = createService();
      model.create.mockResolvedValue(quotationDoc({}));

      await service.create(
        validCreateDto({
          discountType: 'amount',
          discountAmount: 2500,
        }) as never,
      );
      expect(model.create.mock.calls[0][0]).toMatchObject({ total: 7500 });
    });

    it('creates a module line with refId and snapshot fields', async () => {
      const { service, model } = createService();
      model.create.mockResolvedValue(quotationDoc({}));
      const moduleId = new Types.ObjectId().toString();

      await service.create(
        validCreateDto({
          items: [
            {
              lineKind: 'module',
              refId: moduleId,
              productName: 'Каркас',
              productSku: 'MD-01',
              quantity: 2,
              unit: 'шт',
              unitPrice: 1500,
            },
          ],
        }) as never,
      );

      expect(model.create.mock.calls[0][0].items[0]).toMatchObject({
        lineKind: 'module',
        productName: 'Каркас',
        productSku: 'MD-01',
        total: 3000,
      });
      expect(model.create.mock.calls[0][0].items[0].refId).toBeInstanceOf(Types.ObjectId);
      expect(model.create.mock.calls[0][0].items[0].productId).toBeUndefined();
    });

    it('rejects a module line without refId', async () => {
      const { service, model } = createService();
      await expect(
        service.create(
          validCreateDto({
            items: [
              {
                lineKind: 'module',
                productName: 'Каркас',
                quantity: 1,
                unitPrice: 10,
              },
            ],
          }) as never,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(model.create).not.toHaveBeenCalled();
    });

    it('creates a custom line without a product and applies its line discount', async () => {
      const { service, model } = createService();
      model.create.mockResolvedValue(quotationDoc({}));

      await service.create(
        validCreateDto({
          items: [
            {
              lineKind: 'custom',
              productName: 'Монтаж',
              description: 'Шеф-монтаж на площадке',
              quantity: 2,
              unit: 'усл.',
              unitPrice: 1000,
              discountPercent: 10,
            },
          ],
        }) as never,
      );

      expect(model.create.mock.calls[0][0]).toMatchObject({ total: 1800 });
      expect(model.create.mock.calls[0][0].items[0]).toMatchObject({
        lineKind: 'custom',
        productName: 'Монтаж',
        description: 'Шеф-монтаж на площадке',
        total: 1800,
        isOptional: false,
      });
      expect(model.create.mock.calls[0][0].items[0].productId).toBeUndefined();
    });

    it('excludes optional lines from the document total but keeps their amount', async () => {
      const { service, model } = createService();
      model.create.mockResolvedValue(quotationDoc({}));

      await service.create(
        validCreateDto({
          items: [
            {
              productId: new Types.ObjectId().toString(),
              quantity: 1,
              unitPrice: 500,
            },
            {
              lineKind: 'custom',
              productName: 'Доставка',
              quantity: 1,
              unitPrice: 300,
              isOptional: true,
            },
          ],
        }) as never,
      );

      const created = model.create.mock.calls[0][0];
      expect(created.total).toBe(500);
      expect(created.items[1].total).toBe(300);
      expect(created.items[1].isOptional).toBe(true);
    });

    it('persists non-default rowPresentation and drops pure defaults', async () => {
      const { service, model } = createService();
      model.create.mockResolvedValue(quotationDoc({}));

      await service.create(
        validCreateDto({
          items: [
            {
              productId: new Types.ObjectId().toString(),
              quantity: 1,
              unitPrice: 100,
              rowPresentation: {
                density: 'large',
                emphasis: 'accent',
                separatorBefore: true,
                pageBreakBefore: true,
                showDescription: false,
                photoFit: 'contain',
              },
            },
            {
              lineKind: 'custom',
              productName: 'Обычная',
              quantity: 1,
              unitPrice: 50,
              rowPresentation: {
                density: 'auto',
                emphasis: 'normal',
                separatorBefore: false,
                pageBreakBefore: false,
                showDescription: true,
                photoFit: 'inherit',
              },
            },
          ],
        }) as never,
      );

      const created = model.create.mock.calls[0][0];
      expect(created.items[0].rowPresentation).toEqual({
        density: 'large',
        emphasis: 'accent',
        separatorBefore: true,
        pageBreakBefore: true,
        showDescription: false,
        photoFit: 'contain',
      });
      expect(created.items[1].rowPresentation).toBeUndefined();
    });

    it('persists snapshot catalog resolution metadata without commercial fields', async () => {
      const { service, model } = createService();
      model.create.mockResolvedValue(quotationDoc({}));
      const productId = new Types.ObjectId().toString();

      await service.create(
        validCreateDto({
          items: [
            {
              productId,
              productName: 'Изменено в КП',
              description: 'Только снимок',
              productSku: 'SKU-EDIT',
              quantity: 4,
              unit: 'шт',
              unitPrice: 999,
              discountPercent: 12,
              catalogDirtyFields: ['productName', 'description', 'productSku'],
              catalogDecision: 'pending',
              catalogSourceVersion: 7,
            },
          ],
        }) as never,
      );

      expect(model.create.mock.calls[0][0].items[0]).toMatchObject({
        catalogDirtyFields: ['productName', 'description', 'productSku'],
        catalogDecision: 'pending',
        catalogSourceVersion: 7,
        quantity: 4,
        unitPrice: 999,
        discountPercent: 12,
      });
    });

    it('rejects a catalog line without a product', async () => {
      const { service, model } = createService();
      await expect(
        service.create(
          validCreateDto({
            items: [{ productName: 'Без изделия', quantity: 1, unitPrice: 10 }],
          }) as never,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(model.create).not.toHaveBeenCalled();
    });

    it('persists bounded commercial fields and applies markup before discount', async () => {
      const { service, model } = createService();
      model.create.mockResolvedValue(quotationDoc({}));

      await service.create(
        validCreateDto({
          orgMarkupPercent: 10,
          vatPercent: 20,
          prepaymentPercent: 30,
          productionDays: 7,
          deliveryDays: 3,
          discountType: 'percent',
          discountPercent: 10,
        }) as never,
      );
      expect(model.create.mock.calls[0][0]).toMatchObject({
        orgMarkupPercent: 10,
        vatPercent: 20,
        prepaymentPercent: 30,
        productionDays: 7,
        deliveryDays: 3,
        total: 9900,
      });
    });
  });

  describe('findAll / findById', () => {
    it('returns [] for an INVALID counterpartyId filter (no DB hit)', async () => {
      const { service, model } = createService();

      await expect(service.findAll('not-an-object-id')).resolves.toEqual([]);
      expect(model.find).not.toHaveBeenCalled();
    });

    it('builds the filter and returns populated docs', async () => {
      const { service, model } = createService();
      const docs = [quotationDoc({}), quotationDoc({})];
      // Call order in the service: find → populate → populate → populate → sort → exec.
      model.find.mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(docs),
      });

      const result = await service.findAll(COUNTERPARTY, 'sent');
      expect(model.find).toHaveBeenCalledWith({
        deletedAt: null,
        counterpartyId: new Types.ObjectId(COUNTERPARTY),
        status: 'sent',
      });
      expect(result).toBe(docs);
    });

    it('findById throws 404 on an invalid id before any query', async () => {
      const { service, model } = createService();

      await expect(service.findById('nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(model.findById).not.toHaveBeenCalled();
    });

    it('findById throws 404 when the doc is missing', async () => {
      const { service, model } = createService();
      model.findById.mockReturnValue(mockQuery(null));

      await expect(
        service.findById(new Types.ObjectId().toString()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('findById rejects a soft-deleted quotation', async () => {
      const { service, model } = createService();
      model.findById.mockReturnValue(
        mockQuery(quotationDoc({ deletedAt: new Date() })),
      );

      await expect(
        service.findById(new Types.ObjectId().toString()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('findById returns the STORED inline snapshot even if the live product ref changed', async () => {
      // Immutability contract (plan §S1): display layer must NOT $lookup the
      // live Product — the inline productName/productSku snapshot is truth.
      const { service, model } = createService();
      const doc = quotationDoc({
        items: [
          {
            productId: new Types.ObjectId(),
            productName: 'Старое название бренда', // snapshot at creation time
            productSku: 'SKU-OLD',
            quantity: 1,
            unitPrice: 100,
            total: 100,
          },
        ],
      });
      model.findById.mockReturnValue(mockQuery(doc));

      const result = await service.findById(doc._id.toString());
      expect(result.items[0].productName).toBe('Старое название бренда');
      expect(result.items[0].productSku).toBe('SKU-OLD');
    });
  });

  describe('update / duplicate', () => {
    it('update recomputes the total from items + discount', async () => {
      const { service, model } = createService();
      const doc = quotationDoc({
        status: 'draft',
        discountType: 'percent',
        discountPercent: 20,
      });
      model.findById.mockReturnValue(mockQuery(doc));

      await service.update(doc._id.toString(), {
        items: [
          {
            productId: new Types.ObjectId().toString(),
            productName: 'Стенд',
            quantity: 5,
            unit: 'шт',
            unitPrice: 2000,
          },
        ],
      } as never);
      expect(doc.total).toBe(8000); // 5 × 2000 − 20%
      expect(doc.save).toHaveBeenCalled();
    });

    it('duplicate creates a draft copy with a fresh number', async () => {
      const { service, model, counter } = createService();
      const src = quotationDoc({
        number: 'QTN-0001',
        status: 'accepted',
        items: [
          {
            productId: new Types.ObjectId(),
            quantity: 1,
            unitPrice: 10,
            total: 10,
          },
        ],
      });
      model.findById.mockReturnValue(mockQuery(src));
      counter.next.mockResolvedValueOnce('QTN-0002');
      model.create.mockResolvedValue(quotationDoc({}));

      await service.duplicate(src._id.toString());
      expect(model.create.mock.calls[0][0]).toMatchObject({
        number: 'QTN-0002',
        status: 'draft',
        notes: 'Дубликат QTN-0001',
      });
    });

    it('rejects content edits while accepted, but allows unlocking to draft', async () => {
      const { service, model } = createService();
      const doc = quotationDoc({ status: 'accepted' });
      model.findById.mockReturnValue(mockQuery(doc));

      await expect(
        service.update(doc._id.toString(), {
          notes: 'Попытка изменить',
        } as never),
      ).rejects.toThrow('Оплаченная КП заблокирована');

      await service.update(doc._id.toString(), { status: 'draft' } as never);
      expect(doc.status).toBe('draft');
      expect(doc.save).toHaveBeenCalled();
    });
  });
});

describe('QuotationService - SALES-302 immutable versions', () => {
  it('freezes an immutable snapshot with version and actor metadata', async () => {
    const { service, model } = createService();
    const doc = quotationDoc({
      currentVersion: 0,
      items: [
        {
          productId: new Types.ObjectId(),
          productName: 'Stand',
          quantity: 2,
          unitPrice: 10,
          total: 20,
        },
      ],
      total: 20,
    });
    model.findById.mockReturnValue(mockQuery(doc));
    await service.freeze(doc._id.toString(), new Types.ObjectId().toString());

    expect(doc.currentVersion).toBe(1);
    expect(doc.versions).toHaveLength(1);
    expect(doc.versions[0].version).toBe(1);
    expect(doc.versions[0].frozenBy).toBeInstanceOf(Types.ObjectId);
    expect(doc.versions[0].payload).toMatchObject({
      total: 20,
      familyRole: 'solo',
      familyVersion: 1,
      isActive: true,
    });
    expect(
      (doc.versions[0].payload.items as Array<Record<string, unknown>>)[0]
        .productName,
    ).toBe('Stand');
    expect(model.updateOne).toHaveBeenCalledWith(
      { _id: doc._id, currentVersion: 0 },
      expect.objectContaining({
        $set: { currentVersion: 1 },
        $push: expect.any(Object),
      }),
    );
  });

  it('does not mutate an old snapshot when the editable quotation changes', async () => {
    const { service, model } = createService();
    const snapshot = {
      version: 1,
      frozenAt: new Date(),
      payload: { title: 'Old', items: [{ productName: 'Old name' }] },
    };
    const doc = quotationDoc({ currentVersion: 1, versions: [snapshot] });
    model.findById.mockReturnValue(mockQuery(doc));
    await service.update(doc._id.toString(), {
      items: [
        {
          productId: new Types.ObjectId().toString(),
          productName: 'New name',
          quantity: 1,
          unitPrice: 1,
        },
      ],
    } as never);

    expect(
      (doc.versions[0].payload.items as Array<Record<string, unknown>>)[0]
        .productName,
    ).toBe('Old name');
  });

  it('retries an optimistic conflict and fails without appending a local snapshot', async () => {
    const { service, model } = createService();
    const doc = quotationDoc({ currentVersion: 1, versions: [] });
    model.findById.mockReturnValue(mockQuery(doc));
    model.updateOne.mockReturnValue(mockQuery({ matchedCount: 0 }));

    await expect(service.freeze(doc._id.toString())).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(model.updateOne).toHaveBeenCalledTimes(5);
    expect(doc.versions).toHaveLength(0);
  });

  it('lists versions and returns one snapshot by number', async () => {
    const { service, model } = createService();
    const snapshot = {
      version: 1,
      frozenAt: new Date(),
      payload: { title: 'Old' },
    };
    const doc = quotationDoc({ versions: [snapshot], currentVersion: 1 });
    model.findById.mockReturnValue(mockQuery(doc));

    await expect(service.listVersions(doc._id.toString())).resolves.toEqual([
      { version: 1, frozenAt: snapshot.frozenAt, frozenBy: undefined },
    ]);
    await expect(service.getVersion(doc._id.toString(), 1)).resolves.toBe(
      snapshot,
    );
  });
});

describe('QuotationService — ORDERS-301 (quote → order conversion)', () => {
  describe('convertToOrder', () => {
    it('REJECTS a quotation that is NOT accepted (draft/sent/rejected/cancelled)', async () => {
      const { service, model } = createService();
      for (const status of [
        'draft',
        'sent',
        'rejected',
        'cancelled',
      ] as QuotationStatus[]) {
        model.findById.mockReturnValue(mockQuery(quotationDoc({ status })));
        await expect(
          service.convertToOrder(new Types.ObjectId().toString()),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
      expect(model.findById).toHaveBeenCalledTimes(4);
    });

    it('REJECTS an already-converted quotation', async () => {
      const { service, model } = createService();
      model.findById.mockReturnValue(
        mockQuery(quotationDoc({ status: 'converted' })),
      );

      await expect(
        service.convertToOrder(new Types.ObjectId().toString()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('STRIPS COMMERCE: order items carry NO unitPrice/total — only FK + inline snapshot', async () => {
      const { service, model, orderService } = createService();
      model.findById.mockReturnValue(
        mockQuery(
          quotationDoc({
            status: 'accepted',
            items: [
              {
                productId: new Types.ObjectId(),
                productName: 'Стенд напольный',
                productSku: 'SKU-100',
                quantity: 2,
                unit: 'шт',
                unitPrice: 5000,
                total: 10000,
              },
            ],
          }),
        ),
      );
      orderService.create.mockResolvedValue({ _id: new Types.ObjectId() });

      await service.convertToOrder(new Types.ObjectId().toString());

      const orderPayload = orderService.create.mock.calls[0][0];
      expect(orderPayload.counterpartyId).toBe(COUNTERPARTY);
      expect(orderPayload.siteId).toBeDefined();
      expect(orderPayload.status).toBe('draft');
      const item = orderPayload.items[0];
      // COPY: FK is preserved (immutable identifier).
      expect(item.productId).toBeDefined();
      // SNAPSHOT: name/sku survive (inline productSnapshot pattern).
      expect(item.productName).toBe('Стенд напольный');
      expect(item.productSku).toBe('SKU-100');
      // DROP: commerce fields are NOT copied.
      expect(item.unitPrice).toBeUndefined();
    });

    it('marks the quotation converted and records the order id', async () => {
      const { service, model, orderService } = createService();
      const orderId = new Types.ObjectId();
      orderService.create.mockResolvedValue({ _id: orderId });
      const doc = quotationDoc({
        status: 'accepted',
        items: [
          {
            productId: new Types.ObjectId(),
            quantity: 1,
            unitPrice: 10,
            total: 10,
          },
        ],
      });
      model.findById.mockReturnValue(mockQuery(doc));

      await service.convertToOrder(doc._id.toString());
      expect(doc.status).toBe('converted');
      expect(doc.convertedOrderId).toBe(orderId.toString());
      expect(doc.save).toHaveBeenCalled();
    });

    it('REJECTS convert of a family variant (400)', async () => {
      const { service, model, orderService } = createService();
      model.findById.mockReturnValue(
        mockQuery(
          quotationDoc({
            status: 'accepted',
            familyRole: 'variant',
            masterId: new Types.ObjectId(),
          }),
        ),
      );

      await expect(
        service.convertToOrder(new Types.ObjectId().toString()),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(orderService.create).not.toHaveBeenCalled();
    });
  });
});

describe('QuotationService — SALES-303 (KP family)', () => {
  const ORG_B = new Types.ObjectId().toString();
  const ORG_C = new Types.ObjectId().toString();

  describe('attachOrganizations', () => {
    it('promotes solo → master and creates 2 variants (1 master + 2 variant)', async () => {
      const { service, model, counter } = createService();
      const master = quotationDoc({
        familyRole: 'solo',
        familyVersion: 1,
        total: 1000,
        items: [
          {
            productId: new Types.ObjectId(),
            productName: 'Стенд',
            quantity: 2,
            unitPrice: 500,
            total: 1000,
          },
        ],
      });
      const created: unknown[] = [];

      model.findById.mockImplementation((id: Types.ObjectId | string) => {
        const sid = id.toString();
        if (sid === master._id.toString()) return mockQuery(master);
        return mockQuery(null);
      });
      model.findOne.mockReturnValue(mockQuery(null));
      counter.next
        .mockResolvedValueOnce('QTN-0002')
        .mockResolvedValueOnce('QTN-0003');
      model.create.mockImplementation(
        async (payload: Record<string, unknown>) => {
          const doc = quotationDoc({
            ...payload,
            _id: new Types.ObjectId(),
            save: jest.fn().mockResolvedValue(undefined),
          });
          created.push(doc);
          return doc;
        },
      );
      // getFamily after attach: findById master + find variants
      model.find.mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(created),
      });

      const result = await service.attachOrganizations(master._id.toString(), {
        items: [
          { organizationId: ORG_B, orgMarkupPercent: 5 },
          { organizationId: ORG_C, orgMarkupPercent: 10 },
        ],
      });

      expect(master.familyRole).toBe('master');
      expect(master.save).toHaveBeenCalled();
      expect(model.create).toHaveBeenCalledTimes(2);
      expect(created).toHaveLength(2);
      expect((created[0] as { familyRole: string }).familyRole).toBe('variant');
      expect((created[1] as { familyRole: string }).familyRole).toBe('variant');
      expect(result.master.familyRole).toBe('master');
      expect(result.variants).toHaveLength(2);
    });

    it('is idempotent: second attach of same org does not create another variant', async () => {
      const { service, model } = createService();
      const master = quotationDoc({ familyRole: 'master', familyVersion: 1 });
      const existingVariant = quotationDoc({
        familyRole: 'variant',
        masterId: master._id,
        organizationId: new Types.ObjectId(ORG_B),
        orgMarkupPercent: 5,
      });

      model.findById.mockReturnValue(mockQuery(master));
      model.findOne.mockReturnValue(mockQuery(existingVariant));
      model.find.mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([existingVariant]),
      });

      await service.attachOrganizations(master._id.toString(), {
        items: [{ organizationId: ORG_B, orgMarkupPercent: 12 }],
      });

      expect(model.create).not.toHaveBeenCalled();
      expect(existingVariant.orgMarkupPercent).toBe(12);
      expect(existingVariant.save).toHaveBeenCalled();
    });
  });

  describe('syncFromMaster', () => {
    it('copies master qty/lines to variants and bumps familyVersion', async () => {
      const { service, model } = createService();
      const master = quotationDoc({
        familyRole: 'master',
        familyVersion: 1,
        total: 2000,
        items: [
          {
            productId: new Types.ObjectId(),
            productName: 'Стенд',
            quantity: 4,
            unitPrice: 500,
            total: 2000,
          },
        ],
      });
      const variant = quotationDoc({
        familyRole: 'variant',
        masterId: master._id,
        organizationId: new Types.ObjectId(ORG_B),
        familyVersion: 1,
        total: 1000,
        items: [
          {
            productId: new Types.ObjectId(),
            productName: 'Стенд',
            quantity: 2,
            unitPrice: 500,
            total: 1000,
          },
        ],
      });

      model.findById.mockReturnValue(mockQuery(master));
      // First find = variants for sync; second find (via getFamily) = same
      model.find.mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([variant]),
      });

      const result = await service.syncFromMaster(master._id.toString());

      expect(master.familyVersion).toBe(2);
      expect(master.save).toHaveBeenCalled();
      expect(variant.items[0].quantity).toBe(4);
      expect(variant.total).toBe(2000);
      expect(variant.familyVersion).toBe(2);
      expect(variant.save).toHaveBeenCalled();
      expect(result.familyVersion).toBe(2);
    });
  });

  describe('getFamily', () => {
    it('returns master + variants summary', async () => {
      const { service, model } = createService();
      const master = quotationDoc({
        familyRole: 'master',
        familyVersion: 3,
        total: 500,
      });
      const variant = quotationDoc({
        familyRole: 'variant',
        masterId: master._id,
        organizationId: new Types.ObjectId(ORG_B),
        familyVersion: 3,
        orgMarkupPercent: 8,
        total: 500,
      });
      model.findById.mockReturnValue(mockQuery(master));
      model.find.mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([variant]),
      });

      const family = await service.getFamily(master._id.toString());
      expect(family.master.id).toBe(master._id.toString());
      expect(family.variants).toHaveLength(1);
      expect(family.variants[0].orgMarkupPercent).toBe(8);
      expect(family.familyVersion).toBe(3);
    });
  });
});
