import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { IncomeAttachmentsService } from './income-attachments.service';
import { IncomeAttachmentsController } from './productattachments.controller';

const oid = 'a'.repeat(24);
const pid = 'b'.repeat(24);

const mk = (income: unknown, files: Record<string, unknown> = {}) => {
  const model = { findOne: () => ({ lean: () => ({ exec: async () => income }) }) };
  return new IncomeAttachmentsService(model as never, files as never);
};

describe('файлы позиции заказа (C121)', () => {
  it('позиции нет или id кривой — 404; позиция без изделия — 400', async () => {
    await expect(mk(null).productOf(oid)).rejects.toThrow('Позиция не найдена');
    await expect(mk({ _id: oid }).productOf('../x')).rejects.toThrow('Позиция не найдена');
    await expect(mk({ _id: oid }).productOf(oid)).rejects.toThrow('нет изделия');
    await expect(mk({ _id: oid, productId: pid }).productOf(oid)).resolves.toBe(pid);
  });
  it('список и загрузка идут по изделию позиции, с её incomeId', async () => {
    const calls: unknown[][] = [];
    const files = { list: async (...a: unknown[]) => { calls.push(['list', ...a]); return { items: [] }; }, save: async (...a: unknown[]) => { calls.push(['save', ...a]); return {}; } };
    const s = mk({ _id: oid, productId: pid }, files);
    await s.list(oid);
    await s.save({ path: 'x', originalname: 'a.pdf', size: 1 }, oid, 'c'.repeat(24), { id: 'u' } as never);
    expect(calls[0]).toEqual(['list', pid, false, oid]);
    expect(calls[1].slice(0, 2)).toEqual(['save', expect.objectContaining({ originalname: 'a.pdf' })]);
    expect(calls[1].slice(2, 3)).toEqual([pid]);
    expect(calls[1][5]).toBe(oid);
  });
  it('права: смотрят четыре роли, грузят admin и manager, удаляет admin; журнал есть', () => {
    const r = new Reflector();
    const p = IncomeAttachmentsController.prototype;
    expect(r.get(ROLES_KEY, p.list)).toEqual(expect.arrayContaining(['admin', 'director', 'manager', 'user']));
    expect(r.get(ROLES_KEY, p.upload)).toEqual(['admin', 'manager']);
    expect(r.get(ROLES_KEY, p.remove)).toEqual(['admin']);
    for (const m of ['upload', 'remove'] as const) expect(r.get('auditAction', p[m])).toBeDefined();
  });
});
