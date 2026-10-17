import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { TemplateBlockService } from './template-block.service';
import { TemplateBlock } from './template-block.schema';
import { StudioDocument } from '../studio-document/studio-document.schema';
import { SessionRunner } from '../../common/db/session-runner';

/**
 * TZ-DOC-STUDIO-401 — studio-document block parent filter + CRUD helpers.
 */
describe('TemplateBlockService studio-document (TZ-DOC-STUDIO-401)', () => {
  let service: TemplateBlockService;
  let blockModel: {
    find: jest.Mock;
    findById: jest.Mock;
    create: jest.Mock;
    bulkWrite: jest.Mock;
    countDocuments: jest.Mock;
    updateMany: jest.Mock;
    updateOne: jest.Mock;
    db: { collection: jest.Mock };
  };
  let sessionRunner: { run: jest.Mock };
  let capturedFindFilter: Record<string, unknown> | undefined;
  let studioDocumentModel: { findById: jest.Mock };

  const studioDocId = '507f1f77bcf86cd799439011';
  const sourceTemplateId = '507f1f77bcf86cd799439012';
  const studioObjectId = new Types.ObjectId(studioDocId);

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
      create: jest.fn((doc) => Promise.resolve(doc)),
      bulkWrite: jest.fn(() => Promise.resolve({})),
      countDocuments: jest.fn(() => ({ exec: jest.fn(() => Promise.resolve(0)) })),
      updateMany: jest.fn(() => ({ exec: jest.fn(() => Promise.resolve({ modifiedCount: 0 })) })),
      updateOne: jest.fn(() => ({ exec: jest.fn(() => Promise.resolve({})) })),
      db: { collection: jest.fn(() => flagsCollection) },
    };
    sessionRunner = {
      run: jest.fn(async (fn: (session: unknown) => Promise<void>) => fn({})),
    };
    studioDocumentModel = {
      findById: jest.fn(() => ({
        select: jest.fn(() => ({
          lean: jest.fn(() => ({
            exec: jest.fn(() => Promise.resolve({ manualPageCount: 3 })),
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

    service = module.get(TemplateBlockService);
    await service.onModuleInit();
  });

  it('findAllByStudioDocument filters by parentType=studio-document and parentId', async () => {
    await service.findAllByStudioDocument(studioDocId);
    expect(capturedFindFilter).toEqual({
      isActive: true,
      parentType: 'studio-document',
      parentId: studioObjectId,
    });
  });

  it('findAllByStudioDocument returns [] for invalid id', async () => {
    const result = await service.findAllByStudioDocument('not-an-id');
    expect(result).toEqual([]);
    expect(blockModel.find).not.toHaveBeenCalled();
  });

  it('createForStudioDocument sets parent refs and uses sourceTemplateId as legacy templateId', async () => {
    await service.createForStudioDocument(
      studioDocId,
      { type: 'text', order: 0, content: 'Hello' },
      sourceTemplateId,
    );
    expect(blockModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        templateId: new Types.ObjectId(sourceTemplateId),
        parentType: 'studio-document',
        parentId: studioObjectId,
        type: 'text',
        order: 0,
      }),
    );
  });

  it('createForStudioDocument falls back to studioDocId as templateId when no sourceTemplateId', async () => {
    await service.createForStudioDocument(studioDocId, { type: 'text', order: 0 });
    expect(blockModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        templateId: studioObjectId,
        parentType: 'studio-document',
        parentId: studioObjectId,
      }),
    );
  });

  it('createForStudioDocument rejects invalid studioDocId', async () => {
    await expect(
      service.createForStudioDocument('bad', { type: 'text', order: 0 }),
    ).rejects.toThrow(BadRequestException);
  });

  it('updateLayoutsForStudioDocument rejects blocks outside studio doc', async () => {
    blockModel.find.mockReturnValueOnce({
      exec: jest.fn().mockResolvedValue([]),
    });
    await expect(
      service.updateLayoutsForStudioDocument(studioDocId, {
        updates: [
          {
            blockId: new Types.ObjectId().toString(),
            layout: { page: 1, x: 0, y: 0, width: 0.5, zIndex: 1, rotation: 0 },
          },
        ],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('updateLayoutsForStudioDocument allows page 2 when manualPageCount > 1', async () => {
    const blockId = new Types.ObjectId().toString();
    blockModel.find.mockReturnValueOnce({
      exec: jest.fn().mockResolvedValue([{ _id: blockId }]),
    });
    await service.updateLayoutsForStudioDocument(studioDocId, {
      updates: [
        {
          blockId,
          layout: { page: 2, x: 0, y: 0, width: 0.5, zIndex: 1, rotation: 0 },
        },
      ],
    });
    expect(blockModel.bulkWrite).toHaveBeenCalled();
  });

  it('updateLayoutsForStudioDocument rejects page beyond manualPageCount', async () => {
    await expect(
      service.updateLayoutsForStudioDocument(studioDocId, {
        updates: [
          {
            blockId: new Types.ObjectId().toString(),
            layout: { page: 9, x: 0, y: 0, width: 0.5, zIndex: 1, rotation: 0 },
          },
        ],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('reorderForStudioDocument throws NotFoundException for invalid studioDocId', async () => {
    await expect(
      service.reorderForStudioDocument('bad', [new Types.ObjectId().toString()]),
    ).rejects.toThrow(NotFoundException);
  });
});
