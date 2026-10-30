import { Types } from 'mongoose';
import { NotificationsService } from './notifications.service';

describe('NotificationsService: чат не в колокольчике', () => {
  const user = { id: String(new Types.ObjectId()) } as never;
  it('unread и list исключают type:message', async () => {
    const pipes: Array<Array<Record<string, unknown>>> = [];
    const finds: Array<Record<string, unknown>> = [];
    const chain = { sort: () => chain, skip: () => chain, limit: () => chain, lean: () => chain, exec: async () => [] };
    const model = {
      aggregate: (p: Array<Record<string, unknown>>) => { pipes.push(p); return { exec: async () => [] }; },
      find: (w: Record<string, unknown>) => { finds.push(w); return chain; },
      countDocuments: () => ({ exec: async () => 0 }),
    };
    const svc = new NotificationsService(model as never, {} as never);
    expect(await svc.unread(user)).toEqual({ important: 0, system: 0 });
    expect(pipes[0][0]).toMatchObject({ $match: { type: { $ne: 'message' } } });
    await svc.list({}, user);
    expect(finds[0]).toMatchObject({ type: { $ne: 'message' } });
  });
});
