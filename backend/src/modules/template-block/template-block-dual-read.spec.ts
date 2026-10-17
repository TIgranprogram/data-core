import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { TemplateBlockService } from './template-block.service';
import { TemplateBlock } from './template-block.schema';
import { StudioDocument } from '../studio-document/studio-document.schema';
import { SessionRunner } from '../../common/db/session-runner';

/**
 * TZ-DOC-STUDIO-201a — dual-read contract for template_blocks parent refs.
 *
 * Legacy rows match via `templateId`; migrated rows match via
 * `parentType='template'` + `parentId`. Both paths must resolve the same
 * template-scoped queries (findAll / updateLayouts / reorder).
 *
 * TZ-DOC-STUDIO-2001 — studio clones carry the same `templateId` but must not
 * leak into legacy builder queries.
 */
describe('TemplateBlockService dual-read (TZ-DOC-STUDIO-201a)', () => {
  let service: TemplateBlockService;
  let blockModel: {
    find: jest.Mock;
    findById: jest.Mock;
    create: jest.Mock;
    countDocuments: jest.Mock;
    updateMany: jest.Mock;
    bulkWrite: jest.Mock;
    updateOne: jest.Mock;
    db: { collection: jest.Mock };
  };
  let sessionRunner: { run: jest.Mock };
  let capturedFindFilter: Record<string, unknown> | undefined;

  const templateId = '507f1f77bcf86cd799439011';
  const templateObjectId = new Types.ObjectId(templateId);
  const builderParentFilter = {
    $or: [
      { templateId: templateObjectId, parentType: { $ne: 'studio-document' } },
      { parentType: 'template', parentId: templateObjectId },
    ],
  };

  beforeEach(async () => {
    capturedFindFilter = undefined;
    const flagsCollection = {
      findOne: jest.fn().mockResolvedValue({ key: 'template_blocks_parent_ref_v1' }),
      insertOne: jest.fn(),
    };
    const defaultFindResult = {
      sort: jest.fn(() => ({
        exec: jest.fn(() => Promise.resolve([])),
      })),
      select: jest.fn(() => ({
        lean: jest.fn(() => ({
          exec: jest.fn(() => Promise.resolve([])),
        })),
      })),
      exec: jest.fn(() => Promise.resolve([])),
    };
    blockModel = {
      find: jest.fn((filter: Record<string, unknown>) => {
        capturedFindFilter = filter;
        return defaultFindResult;
      }),
      findById: jest.fn(),
      create: jest.fn(),
      countDocuments: jest.fn(() => ({ exec: jest.fn(() => Promise.resolve(0)) })),
      updateMany: jest.fn(() => ({ exec: jest.fn(() => Promise.resolve({ modifiedCount: 0 })) })),
      bulkWrite: jest.fn(() => Promise.resolve({})),
      updateOne: jest.fn(() => ({ exec: jest.fn(() => Promise.resolve({})) })),
      db: { collection: jest.fn(() => flagsCollection) },
    };
    sessionRunner = {
      run: jest.fn(async (fn: (session: unknown) => Promise<void>) => fn({})),
    };
    const studioDocumentModel = {
      findById: jest.fn(() => ({
        select: jest.fn(() => ({
          lean: jest.fn(() => ({
            exec: jest.fn(() => Promise.resolve({ manualPageCount: 1 })),
          })),
        })),
      })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TemplateBlockService,
        { provide: getModelToken(TemplateBlock.name), useValue: blockModel },
        { provide: getModelToken(StudioDocument.name), useValue: studioDocumentModel },
        { provide: SessionRunner, useValue: sessionRunner },
      ],
    }).compile();
    service = module.get<TemplateBlockService>(TemplateBlockService);
  });

  it('findAll uses $or on templateId and parent ref', async () => {
    await service.findAll(templateId);

    expect(capturedFindFilter).toEqual({
      isActive: true,
      ...builderParentFilter,
    });
  });

  it('findAll excludes studio blocks that share the same templateId (TZ-DOC-STUDIO-2001)', async () => {
    await service.findAll(templateId);

    const orBranches = (capturedFindFilter?.$or ?? []) as Record<string, unknown>[];
    const templateIdBranch = orBranches.find((branch) => 'templateId' in branch);
    expect(templateIdBranch).toEqual({
      templateId: templateObjectId,
      parentType: { $ne: 'studio-document' },
    });
    expect(orBranches).not.toContainEqual({ templateId: templateObjectId });
  });

  it('create for legacy builder writes templateId and canonical parent ref', async () => {
    blockModel.create.mockImplementation((doc: Record<string, unknown>) =>
      Promise.resolve({ ...doc, _id: new Types.ObjectId() }),
    );

    await service.create({
      templateId,
      type: 'text',
      order: 0,
      content: '<p>hello</p>',
    });

    expect(blockModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        templateId: templateObjectId,
        parentType: 'template',
        parentId: templateObjectId,
      }),
    );
  });

  it('reorder queries blocks via dual-read parent filter', async () => {
    const blockA = new Types.ObjectId();
    blockModel.find.mockImplementation((filter: Record<string, unknown>) => {
      capturedFindFilter = filter;
      return {
        sort: jest.fn(() => ({
          exec: jest.fn(() => Promise.resolve([])),
        })),
        select: jest.fn(() => ({
          lean: jest.fn(() => ({
            exec: jest.fn(() => Promise.resolve([{ _id: blockA }])),
          })),
        })),
        exec: jest.fn(() => Promise.resolve([])),
      };
    });

    await service.reorder(templateId, [String(blockA)]);

    expect(capturedFindFilter).toEqual({
      ...builderParentFilter,
      isActive: true,
    });
    expect(blockModel.bulkWrite).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          updateOne: expect.objectContaining({
            filter: expect.objectContaining({
              _id: blockA,
              ...builderParentFilter,
              isActive: true,
            }),
          }),
        }),
      ],
      expect.objectContaining({ ordered: true }),
    );
  });

  it('onModuleInit skips backfill when migration flag exists', async () => {
    await service.onModuleInit();

    expect(blockModel.countDocuments).not.toHaveBeenCalled();
    expect(blockModel.updateMany).not.toHaveBeenCalled();
  });
});
