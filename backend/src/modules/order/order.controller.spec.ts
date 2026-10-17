import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OrderController } from './order.controller';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

const USER: AuthenticatedUser = {
  id: 'user-1',
  username: 'manager',
  role: 'manager',
  organizationId: 'org-1',
};

function buildController() {
  const service = {
    patchLineBoardLane: jest.fn(),
    patchModuleLane: jest.fn(),
  };
  const kitReserve = { getAvailability: jest.fn(), confirmReserve: jest.fn() };
  return { controller: new OrderController(service as never, kitReserve as never), service, kitReserve };
}

describe('OrderController PATCH /orders/:id/lines/:lineId/lane', () => {
  it('delegates happy-path shop lane to the service and returns the updated order', async () => {
    const { controller, service } = buildController();
    const updated = { _id: 'order-id', status: 'in_production' };
    service.patchLineBoardLane.mockResolvedValue(updated);

    const result = await controller.patchLineBoardLane(
      'order-id',
      'line-a',
      { lane: 'shop' } as never,
      USER,
    );

    expect(service.patchLineBoardLane).toHaveBeenCalledWith('order-id', 'line-a', 'shop', 'org-1');
    expect(result).toBe(updated);
  });

  it('propagates service BadRequest for lane=shipped (HTTP 400)', async () => {
    const { controller, service } = buildController();
    service.patchLineBoardLane.mockRejectedValue(
      new BadRequestException('lane=shipped через PATCH запрещён — только POST /orders/:id/ship.'),
    );

    await expect(
      controller.patchLineBoardLane('order-id', 'line-a', { lane: 'shipped' } as never, USER),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.patchLineBoardLane).toHaveBeenCalledWith('order-id', 'line-a', 'shipped', 'org-1');
  });

  it('propagates service NotFound for unknown lineId (HTTP 404)', async () => {
    const { controller, service } = buildController();
    service.patchLineBoardLane.mockRejectedValue(new NotFoundException('Order line nope not found'));

    await expect(
      controller.patchLineBoardLane('order-id', 'nope', { lane: 'shop' } as never, USER),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(service.patchLineBoardLane).toHaveBeenCalledWith('order-id', 'nope', 'shop', 'org-1');
  });
});

describe('OrderController PATCH /orders/:id/lines/:lineId/modules/:moduleId/lane', () => {
  it('delegates happy-path module shop lane to the service', async () => {
    const { controller, service } = buildController();
    const updated = { _id: 'order-id', status: 'in_production' };
    service.patchModuleLane.mockResolvedValue(updated);

    const result = await controller.patchModuleLane(
      'order-id',
      'line-a',
      'module-m',
      { lane: 'shop' } as never,
      USER,
    );

    expect(service.patchModuleLane).toHaveBeenCalledWith(
      'order-id',
      'line-a',
      'module-m',
      'shop',
      'org-1',
    );
    expect(result).toBe(updated);
  });

  it('propagates service BadRequest for lane=shipped (HTTP 400)', async () => {
    const { controller, service } = buildController();
    service.patchModuleLane.mockRejectedValue(
      new BadRequestException('lane=shipped через PATCH запрещён'),
    );

    await expect(
      controller.patchModuleLane(
        'order-id',
        'line-a',
        'module-m',
        { lane: 'shipped' } as never,
        USER,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.patchModuleLane).toHaveBeenCalledWith(
      'order-id',
      'line-a',
      'module-m',
      'shipped',
      'org-1',
    );
  });
});
