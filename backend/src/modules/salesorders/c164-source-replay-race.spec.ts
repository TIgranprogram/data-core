import { ConflictException } from '@nestjs/common';
import { SalesOrdersService } from './salesorders.service';
import { SalesOrderDto } from './dto';
import * as legal from '../../common/legal/legal-utils';

const companyId = '6ad52bed863df73f344ea517';
const existingId = '6aff643019587e11be4af1a9';
const chain = (value: unknown) => {
  const query = { setOptions: jest.fn(), lean: jest.fn(), exec: jest.fn().mockResolvedValue(value) };
  query.setOptions.mockReturnValue(query); query.lean.mockReturnValue(query);
  return query;
};

describe('C164 — одинаковый источник появился между проверкой UID и clash', () => {
  afterEach(() => jest.restoreAllMocks());
  it.each(['same', 'changed', 'deleted', 'legacy'])('обрабатывает %s без создания второй шапки', async (kind) => {
    jest.spyOn(legal, 'assertIntakeIndexes').mockResolvedValue(undefined);
    jest.spyOn(legal, 'assertSalesBusinessIndex').mockResolvedValue(undefined);
    jest.spyOn(legal, 'validateLegalParties').mockResolvedValue(undefined);
    jest.spyOn(legal, 'validateLegalFiles').mockResolvedValue(undefined);
    const dto: SalesOrderDto = { orderNo: 'QA-race', companyId, productionAssignment: 'unassigned', intakeUid: 'same-source', initialLegal: {
      state: 'draft', currency: 'RUB', signature: { state: 'unknown' }, paymentVerification: 'unknown', documents: [], issues: [], paymentPlan: [], origin: { kind: 'manual' },
    } };
    const row = { _id: existingId, intakeKey: kind === 'legacy' ? undefined : legal.legalHash(['contract-derived', companyId, undefined, dto.orderNo]), intakeHash: kind === 'changed' ? 'different' : legal.intakeContentHash(dto), deletedAt: kind === 'deleted' ? new Date() : null };
    const model = { findOne: jest.fn().mockReturnValueOnce(chain(null)).mockReturnValueOnce(chain(row)), create: jest.fn() };
    const get = jest.fn().mockResolvedValue({ id: existingId });
    const service = Object.create(SalesOrdersService.prototype) as SalesOrdersService;
    Object.assign(service, { model, get, toFields: jest.fn().mockResolvedValue({ f: { companyId, orderNo: dto.orderNo }, companyShort: 'ССЮ' }), clash: jest.fn().mockResolvedValue({ _id: existingId }) });
    if (kind === 'same') await expect(service.create(dto)).resolves.toEqual({ id: existingId });
    else await expect(service.create(dto)).rejects.toBeInstanceOf(ConflictException);
    expect(model.create).not.toHaveBeenCalled();
    expect(get).toHaveBeenCalledTimes(kind === 'same' ? 1 : 0);
  });
});
