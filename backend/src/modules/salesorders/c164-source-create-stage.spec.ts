import { BadRequestException } from '@nestjs/common';
import { SalesOrdersService } from './salesorders.service';
import { SalesOrderDto } from './dto';

describe('C164 — исходный договор не обходит производственный переход через CREATE', () => {
  it.each(['production', 'ready', 'partly', 'shipped', 'closed'])('отклоняет stage=%s до обращений к данным', async (stage) => {
    const service = Object.create(SalesOrdersService.prototype) as SalesOrdersService;
    const fields = jest.fn();
    Object.assign(service, { toFields: fields });
    await expect(service.create({ initialLegal: { state: 'draft' }, stage } as SalesOrderDto)).rejects.toBeInstanceOf(BadRequestException);
    expect(fields).not.toHaveBeenCalled();
  });
});
