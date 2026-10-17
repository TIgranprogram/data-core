jest.mock('node:fs', () => ({
  ...jest.requireActual<typeof import('node:fs')>('node:fs'),
  existsSync: jest.fn(),
}));

import { Types } from 'mongoose';
import { existsSync } from 'node:fs';
import { ServiceUnavailableException } from '@nestjs/common';
import puppeteer from 'puppeteer-core';
import { QuotationOutputService } from './quotation-output.service';

const mockedExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;
const quotationId = new Types.ObjectId();
const organizationId = new Types.ObjectId();
const templateId = new Types.ObjectId();

function quotationFixture() {
  return {
    _id: quotationId, organizationId, templateId, counterpartyId: new Types.ObjectId(),
    deletedAt: null, number: 'QTN-2026-001', vatPercent: 20, discountType: 'percent',
    discountPercent: 10, discountAmount: 0, prepaymentPercent: 30, productionDays: 4,
    deliveryDays: 2, items: [{ productName: 'Стенд', productSku: 'ST-1', quantity: 2, unit: 'шт', unitPrice: 5000 }],
    templateSnapshot: { templateId: templateId.toString(), html: '<html><body>КП</body></html>' },
  } as never;
}

describe('QuotationOutputService (TZ-SALES-345)', () => {
  const originalExecutable = process.env.PUPPETEER_EXECUTABLE_PATH;
  afterEach(() => {
    jest.restoreAllMocks();
    mockedExistsSync.mockImplementation(jest.requireActual<typeof import('node:fs')>('node:fs').existsSync);
    if (originalExecutable === undefined) delete process.env.PUPPETEER_EXECUTABLE_PATH;
    else process.env.PUPPETEER_EXECUTABLE_PATH = originalExecutable;
  });

  it('waits for document fonts before page.pdf', async () => {
    process.env.PUPPETEER_EXECUTABLE_PATH = 'chrome-for-test';
    const order: string[] = [];
    const page = {
      setContent: jest.fn().mockResolvedValue(undefined),
      evaluate: jest.fn().mockImplementation(async () => {
        order.push('evaluate');
        return undefined;
      }),
      pdf: jest.fn().mockImplementation(async () => {
        order.push('pdf');
        return new Uint8Array([37, 80, 68, 70]);
      }),
      close: jest.fn().mockResolvedValue(undefined),
    };
    const browser = { newPage: jest.fn().mockResolvedValue(page), close: jest.fn() };
    jest.spyOn(puppeteer, 'launch').mockResolvedValue(browser as never);
    const model = { findById: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(quotationFixture()) })) };
    const service = new QuotationOutputService(
      model as never,
      { findById: jest.fn().mockResolvedValue({ _id: templateId, organizationId }), build: jest.fn().mockResolvedValue('<html>live</html>'), assertBuildSourcesInOrganization: jest.fn() } as never,
      { archiveRendered: jest.fn() } as never,
    );
    await service.renderPdf(quotationId.toString(), { organizationId: organizationId.toString() });
    expect(order.indexOf('evaluate')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('pdf')).toBeGreaterThan(order.indexOf('evaluate'));
  });

  it('returns 503 when no Chromium binary is available', async () => {
    delete process.env.PUPPETEER_EXECUTABLE_PATH; mockedExistsSync.mockReturnValue(false);
    const model = { findById: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(quotationFixture()) })) };
    const service = new QuotationOutputService(model as never, { findById: jest.fn().mockResolvedValue({ _id: templateId, organizationId }), build: jest.fn().mockResolvedValue('<html>КП</html>'), assertBuildSourcesInOrganization: jest.fn() } as never, { archiveRendered: jest.fn() } as never);
    await expect(service.renderPdf(quotationId.toString(), { organizationId: organizationId.toString() })).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
