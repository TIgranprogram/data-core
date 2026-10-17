import { Types } from 'mongoose';
import {
  DocumentTemplateService,
  normalizeSubstitutionHtml,
} from './document-template.service';
import { DocumentRenderService } from '../document-render/document-render.service';

function lookup<T>(value: T) {
  return {
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  };
}

function templateDoc(id: Types.ObjectId, orgId: Types.ObjectId) {
  return {
    _id: id,
    name: 'Test',
    organizationId: orgId,
    orientation: 'portrait',
    backgroundOpacity: 0.3,
  };
}

function createService(
  templateId: Types.ObjectId,
  orgId: Types.ObjectId,
  blocks: Record<string, unknown>[],
  overrides: Record<string, unknown> = {},
) {
  const model = {
    findById: jest.fn().mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(templateDoc(templateId, orgId)),
    }),
  };
  const blockModel = {
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(blocks),
    }),
  };
  const orgModel = {
    findById: jest.fn().mockReturnValue(
      lookup({ _id: orgId, name: 'Our Org', assets: [] }),
    ),
    findOne: jest.fn().mockReturnValue(lookup(null)),
  };
  const counterpartyModel = {
    findById: jest.fn().mockReturnValue(
      lookup({
        _id: new Types.ObjectId(),
        name: 'Client Co',
        shortName: 'Client',
      }),
    ),
  };

  const dependencies = {
    model,
    blockModel,
    quotationModel: {},
    contractModel: { findById: jest.fn().mockReturnValue(lookup(null)) },
    orderModel: { findById: jest.fn().mockReturnValue(lookup(null)) },
    orgModel,
    counterpartyModel,
    productModel: { findById: jest.fn().mockReturnValue(lookup(null)) },
    materialModel: { findById: jest.fn().mockReturnValue(lookup(null)) },
    workTypeModel: { findById: jest.fn().mockReturnValue(lookup(null)) },
    textBlockModel: {},
    counter: {},
    tableTemplateService: {},
    categoryService: {},
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

describe('normalizeSubstitutionHtml (TZ-KP-BIND-513)', () => {
  it('collapses TipTap spans inside a token', () => {
    expect(
      normalizeSubstitutionHtml(
        '<span>{{organization</span><span>.name}}</span>',
      ),
    ).toBe('<span>{{organization.name}}</span>');
  });

  it('leaves plain HTML outside tokens untouched', () => {
    const html = '<p>Hello</p>{{client_name}}';
    expect(normalizeSubstitutionHtml(html)).toBe(html);
  });
});

describe('DocumentTemplateService build draft aliases (TZ-KP-BIND-513)', () => {
  it('substitutes kp_number and client_name from build dto', async () => {
    const templateId = new Types.ObjectId();
    const orgId = new Types.ObjectId();
    const cpId = new Types.ObjectId().toString();
    const service = createService(templateId, orgId, [
      {
        _id: new Types.ObjectId(),
        type: 'text',
        order: 0,
        content: 'KP {{kp_number}} for {{client_name}}',
        isActive: true,
      },
    ]);
    const html = await service.build(templateId.toString(), {
      organizationId: orgId.toString(),
      counterpartyId: cpId,
      proposalNumber: 'QTN-2026-029',
    });
    expect(html).toContain('QTN-2026-029');
    expect(html).toContain('Client Co');
    expect(html).not.toContain('{{kp_number}}');
    expect(html).not.toContain('{{client_name}}');
  });

  it('substitutes split organization token in column content', async () => {
    const templateId = new Types.ObjectId();
    const orgId = new Types.ObjectId();
    const orgModel = {
      findById: jest.fn().mockReturnValue(
        lookup({ _id: orgId, name: 'Split Org', assets: [] }),
      ),
      findOne: jest.fn().mockReturnValue(lookup(null)),
    };
    const service = createService(
      templateId,
      orgId,
      [
        {
          _id: new Types.ObjectId(),
          type: 'text',
          order: 0,
          columns: [
            {
              id: 'c1',
              content: '<span>{{organization</span><span>.name}}</span>',
              width: 1,
              fontSize: 14,
            },
          ],
          isActive: true,
        },
      ],
      { orgModel },
    );
    const html = await service.build(templateId.toString(), {
      organizationId: orgId.toString(),
    });
    expect(html).toContain('Split Org');
    expect(html).not.toContain('{{organization');
  });
});
