import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { UpdateOrderDto } from './update-order.dto';
import { CreateOrderDto } from './create-order.dto';

/**
 * Proves ValidationPipe (same transform path as PATCH /orders/:id) accepts
 * board statuses and still rejects create-only / ship-only values on update.
 */
describe('UpdateOrderDto ValidationPipe (TZ-OPS-315 regression)', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
    exceptionFactory: (errors) =>
      new BadRequestException({
        message: errors.flatMap((e) => Object.values(e.constraints ?? {})),
      }),
  });

  async function transformUpdate(body: unknown): Promise<UpdateOrderDto> {
    return pipe.transform(body, {
      type: 'body',
      metatype: UpdateOrderDto,
    }) as Promise<UpdateOrderDto>;
  }

  async function transformCreate(body: unknown): Promise<CreateOrderDto> {
    return pipe.transform(body, {
      type: 'body',
      metatype: CreateOrderDto,
    }) as Promise<CreateOrderDto>;
  }

  it('ACCEPTS PATCH status in_production and ready', async () => {
    for (const status of ['in_production', 'ready'] as const) {
      const dto = await transformUpdate({ status });
      expect(dto.status).toBe(status);
    }
  });

  it('ACCEPTS PATCH status draft and confirmed', async () => {
    for (const status of ['draft', 'confirmed'] as const) {
      const dto = await transformUpdate({ status });
      expect(dto.status).toBe(status);
    }
  });

  it('ACCEPTS payment fields without requiring a quotation', async () => {
    const dto = await transformUpdate({
      isPaid: true,
      paidAt: '2026-09-01T10:00:00.000Z',
    });
    expect(dto.isPaid).toBe(true);
    expect(dto.paidAt).toBe('2026-09-01T10:00:00.000Z');
  });

  it('REJECTS PATCH status shipped (ship endpoint only)', async () => {
    await expect(transformUpdate({ status: 'shipped' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('REJECTS PATCH status delivered and cancelled', async () => {
    for (const status of ['delivered', 'cancelled']) {
      await expect(transformUpdate({ status })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }
  });

  it('CreateOrderDto still REJECTS in_production/ready/shipped (create-only IsIn intact)', async () => {
    for (const status of ['in_production', 'ready', 'shipped', 'delivered', 'cancelled']) {
      await expect(
        transformCreate({
          counterpartyId: '507f1f77bcf86cd799439011',
          siteId: '507f1f77bcf86cd799439012',
          items: [{ productId: '507f1f77bcf86cd799439013', quantity: 1 }],
          status,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });
});
