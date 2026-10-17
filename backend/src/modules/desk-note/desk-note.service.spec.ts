import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { DeskNoteService } from './desk-note.service';

function mockQuery<T>(value: T) {
  return {
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  };
}

function createService() {
  const model = {
    create: jest.fn(),
    find: jest.fn(),
    findById: jest.fn(),
    deleteOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ deletedCount: 1 }) }),
  };
  const service = new DeskNoteService(model as never);
  return { service, model };
}

describe('DeskNoteService (TZ-DESK-408 / TZ-DESK-415)', () => {
  const ORDER = new Types.ObjectId().toString();
  const LINE = 'p1';
  const USER = new Types.ObjectId().toString();
  const STRANGER = new Types.ObjectId().toString();
  const authorActor = { id: USER, role: 'user' };
  const strangerActor = { id: STRANGER, role: 'user' };

  it('create stores note with order anchor + author', async () => {
    const { service, model } = createService();
    const doc = { _id: new Types.ObjectId(), kind: 'note' };
    model.create.mockResolvedValue(doc);
    const res = await service.create(
      { text: '  Позвонить клиенту  ', anchorOrderId: ORDER },
      USER,
    );
    expect(model.create).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Позвонить клиенту',
        kind: 'note',
        anchorOrderId: new Types.ObjectId(ORDER),
        authorId: new Types.ObjectId(USER),
        isDone: false,
      }),
    );
    expect(res).toBe(doc);
  });

  it('create stores line/module anchors when given', async () => {
    const { service, model } = createService();
    model.create.mockResolvedValue({});
    await service.create(
      { text: 'Проверить модуль', anchorOrderId: ORDER, anchorLineId: LINE },
      USER,
    );
    expect(model.create).toHaveBeenCalledWith(
      expect.objectContaining({ anchorLineId: LINE }),
    );
  });

  it('create rejects invalid order/module/user ids', async () => {
    const { service } = createService();
    await expect(
      service.create({ text: 'x', anchorOrderId: 'nope' }, USER),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.create(
        { text: 'x', anchorOrderId: ORDER, anchorModuleId: 'nope' },
        USER,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.create({ text: 'x', anchorOrderId: ORDER }, 'nope'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('findAll filters by orderId', async () => {
    const { service, model } = createService();
    const docs = [{ _id: new Types.ObjectId() }];
    model.find.mockReturnValue(mockQuery(docs));
    const res = await service.findAll({ orderId: ORDER });
    expect(model.find).toHaveBeenCalledWith(
      expect.objectContaining({
        anchorOrderId: new Types.ObjectId(ORDER),
      }),
    );
    expect(res).toBe(docs);
  });

  it('findAll missing/invalid orderId throws BadRequest and does not query', async () => {
    const { service, model } = createService();
    await expect(service.findAll({})).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.findAll({ orderId: 'bad' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.findAll({ orderId: 'bad', lineId: LINE }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(model.find).not.toHaveBeenCalled();
  });

  it('findAll applies lineId on top of valid orderId', async () => {
    const { service, model } = createService();
    model.find.mockReturnValue(mockQuery([]));
    await service.findAll({ orderId: ORDER, lineId: LINE });
    expect(model.find).toHaveBeenCalledWith(
      expect.objectContaining({
        anchorOrderId: new Types.ObjectId(ORDER),
        anchorLineId: LINE,
      }),
    );
  });

  it('update trims text and flips isDone for author', async () => {
    const { service, model } = createService();
    const id = new Types.ObjectId().toString();
    const doc = {
      _id: id,
      authorId: new Types.ObjectId(USER),
      text: 'old',
      kind: 'note' as const,
      isDone: false,
      save: jest.fn().mockImplementation(function (this: {
        text: string;
        isDone: boolean;
      }) {
        return Promise.resolve(this);
      }),
    };
    model.findById.mockReturnValue(mockQuery(doc));
    const res = await service.update(id, { text: '  new  ', isDone: true }, authorActor);
    expect(res.text).toBe('new');
    expect(res.isDone).toBe(true);
  });

  it('remove deletes hard and 404s on missing', async () => {
    const { service, model } = createService();
    const id = new Types.ObjectId().toString();
    const doc = { _id: new Types.ObjectId(id), authorId: new Types.ObjectId(USER) };
    model.findById.mockReturnValue(mockQuery(doc));
    await service.remove(id, authorActor);
    expect(model.deleteOne).toHaveBeenCalled();

    model.findById.mockReturnValueOnce(mockQuery(null));
    await expect(service.remove(id, authorActor)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('update/remove reject invalid ids', async () => {
    const { service } = createService();
    await expect(service.update('bad', {}, authorActor)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.remove('bad', authorActor)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('update/remove forbid other user; allow author and privileged roles', async () => {
    const { service, model } = createService();
    const id = new Types.ObjectId().toString();
    const doc = {
      _id: new Types.ObjectId(id),
      authorId: new Types.ObjectId(USER),
      text: 'old',
      kind: 'note' as const,
      isDone: false,
      save: jest.fn().mockImplementation(function (this: { text: string }) {
        return Promise.resolve(this);
      }),
    };
    model.findById.mockReturnValue(mockQuery(doc));

    await expect(
      service.update(id, { text: 'stolen' }, strangerActor),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.remove(id, strangerActor)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(model.deleteOne).not.toHaveBeenCalled();

    await service.update(id, { text: 'mine' }, authorActor);
    expect(doc.save).toHaveBeenCalled();

    await service.update(id, { text: 'mgr' }, { id: STRANGER, role: 'manager' });
    await service.update(id, { text: 'dir' }, { id: STRANGER, role: 'director' });
    await service.remove(id, { id: STRANGER, role: 'admin' });
    expect(model.deleteOne).toHaveBeenCalled();
  });
});
