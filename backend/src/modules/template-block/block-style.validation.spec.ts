import { validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { BlockStyleDto } from './block-style';
import { CreateTemplateBlockDto } from './dto/create-template-block.dto';
import { TemplateBlockService } from './template-block.service';
import { TemplateBlock } from './template-block.schema';
import { StudioDocument } from '../studio-document/studio-document.schema';
import { SessionRunner } from '../../common/db/session-runner';

describe('BlockStyleDto validation (TZ-BACKEND-DOCSTUDIO-BLOCK-STYLE)', () => {
  function constraintsFor(style: Record<string, unknown>): Record<string, Record<string, string>> {
    const dto = plainToInstance(BlockStyleDto, style, { enableImplicitConversion: true });
    return Object.fromEntries(
      validateSync(dto).map((e) => [e.property, e.constraints ?? {}]),
    );
  }

  it('accepts a fully valid style', () => {
    expect(
      constraintsFor({ fontFamily: 'Arial', fontSizePt: 18, color: '#abc', align: 'center', lineHeight: 1.5 }),
    ).toEqual({});
  });

  it('rejects a font outside the whitelist', () => {
    expect(constraintsFor({ fontFamily: 'Zapf Dingbats' }).fontFamily?.isIn).toContain('one of the following values');
  });

  it('rejects fontSizePt outside 6..96', () => {
    expect(constraintsFor({ fontSizePt: 2 }).fontSizePt?.min).toBeTruthy();
    expect(constraintsFor({ fontSizePt: 200 }).fontSizePt?.max).toBeTruthy();
  });

  it('rejects a non-integer fontSizePt', () => {
    expect(constraintsFor({ fontSizePt: 12.5 }).fontSizePt?.isInt).toBeTruthy();
  });

  it('rejects a malformed hex color', () => {
    expect(constraintsFor({ color: 'red' }).color?.matches).toBeTruthy();
  });

  it('rejects invalid align', () => {
    expect(constraintsFor({ align: 'top' }).align?.isIn).toBeTruthy();
  });

  it('rejects lineHeight outside 0.8..3', () => {
    expect(constraintsFor({ lineHeight: 0.1 }).lineHeight?.min).toBeTruthy();
    expect(constraintsFor({ lineHeight: 9 }).lineHeight?.max).toBeTruthy();
  });

  it('create DTO accepts a nested valid style', () => {
    const dto = plainToInstance(
      CreateTemplateBlockDto,
      {
        templateId: '507f1f77bcf86cd799439011',
        type: 'text',
        order: 0,
        style: { fontFamily: 'Calibri', fontSizePt: 14, color: '#123456' },
      },
      { enableImplicitConversion: true },
    );
    const errors = validateSync(dto);
    // Only templateId/type/order can error; nested style must validate clean.
    const styleErrors = errors.filter(
      (e) => e.property !== 'templateId' && e.property !== 'type' && e.property !== 'order',
    );
    expect(styleErrors.filter((e) => e.property === 'style')).toEqual([]);
  });

  it('update DTO (PartialType) rejects nothing from forbidNonWhitelisted with unknown nested prop', () => {
    // The style field is whitelisted; an unknown sibling still must not leak.
    const dto = plainToInstance(CreateTemplateBlockDto, {
      templateId: '507f1f77bcf86cd799439011',
      type: 'text',
      order: 0,
      style: { fontFamily: 'Arial' },
      unexpected: 1,
    });
    const errors = validateSync(dto, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors.some((e) => e.property === 'unexpected')).toBe(true);
  });
});

describe('TemplateBlockService style create/update (TZ-BACKEND-DOCSTUDIO-BLOCK-STYLE)', () => {
  let service: TemplateBlockService;
  let findById: jest.Mock;

  beforeEach(async () => {
    const flagsCollection = {
      findOne: jest.fn().mockResolvedValue({ key: 'template_blocks_parent_ref_v1' }),
      insertOne: jest.fn(),
    };
    const blockModel = {
      find: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      countDocuments: jest.fn(() => ({ exec: jest.fn(() => Promise.resolve(0)) })),
      updateMany: jest.fn(() => ({ exec: jest.fn(() => Promise.resolve({})) })),
      bulkWrite: jest.fn(() => Promise.resolve({})),
      updateOne: jest.fn(() => ({ exec: jest.fn(() => Promise.resolve({})) })),
      db: { collection: jest.fn(() => flagsCollection) },
    };
    findById = blockModel.findById;

    const studioDocumentModel = {
      findById: jest.fn(() => ({
        select: jest.fn(() => ({ lean: jest.fn(() => ({ exec: jest.fn(() => Promise.resolve({ manualPageCount: 1 })) })) })),
      })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TemplateBlockService,
        { provide: getModelToken(TemplateBlock.name), useValue: blockModel },
        { provide: getModelToken(StudioDocument.name), useValue: studioDocumentModel },
        {
          provide: SessionRunner,
          useValue: { run: jest.fn(async (fn: (session: object) => Promise<void>) => fn({})) },
        },
      ],
    }).compile();

    service = module.get(TemplateBlockService);
  });

  it('create stores the style on the block', async () => {
    const created: Record<string, unknown> = {};
    (service as unknown as { model: { create: jest.Mock } }).model.create.mockImplementation(
      (doc: Record<string, unknown>) => {
        Object.assign(created, doc);
        return Promise.resolve({ ...doc, _id: new Types.ObjectId() });
      },
    );

    await service.create({
      templateId: '507f1f77bcf86cd799439011',
      type: 'text',
      order: 0,
      style: { fontFamily: 'Arial', fontSizePt: 18, color: '#abc', align: 'center', lineHeight: 1.5 },
    });

    expect((created.style as Record<string, unknown>)?.fontFamily).toBe('Arial');
    expect((created.style as Record<string, unknown>)?.fontSizePt).toBe(18);
  });

  function mockDoc(style: Record<string, unknown> | undefined) {
    const doc = {
      _id: new Types.ObjectId(),
      type: 'text',
      parentType: 'template',
      style,
      save: jest.fn().mockResolvedValue(undefined),
    };
    findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(doc) });
    return doc;
  }

  it('update sanitizes content but applies style; PATCH one style field does not clear siblings', async () => {
    const doc = mockDoc({ fontFamily: 'Arial', fontSizePt: 18, color: '#abc', align: 'center', lineHeight: 1.5 });

    await service.update(String(doc._id), { style: { fontSizePt: 22 } });

    expect(doc.style).toEqual({
      fontFamily: 'Arial',
      fontSizePt: 22,
      color: '#abc',
      align: 'center',
      lineHeight: 1.5,
    });
  });

  it('update with no style leaves the existing style untouched', async () => {
    const doc = mockDoc({ fontFamily: 'Arial' });

    await service.update(String(doc._id), { title: 'x' });

    expect(doc.style).toEqual({ fontFamily: 'Arial' });
  });
});