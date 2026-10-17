import { buildFieldsFromSchema, RegistryService } from './registry.service';

describe('RegistryService.getDataSources', () => {
  const service = new RegistryService();

  it('labels organization as «Наша фирма» and counterparty as «Клиент»', () => {
    const { sources } = service.getDataSources();
    const organization = sources.find((s) => s.key === 'organization');
    const counterparty = sources.find((s) => s.key === 'counterparty');

    expect(organization?.label).toBe('Наша фирма');
    expect(counterparty?.label).toBe('Клиент');
  });

  it('exposes site/contact fields on counterparty', () => {
    const { sources } = service.getDataSources();
    const counterparty = sources.find((s) => s.key === 'counterparty');
    const fieldKeys = counterparty?.fields.map((f) => f.key) ?? [];

    expect(fieldKeys).toEqual(
      expect.arrayContaining([
        'siteAddress',
        'siteName',
        'contactName',
        'contactPosition',
      ]),
    );
  });

  it('exposes an order source with number/date/status/total fields', () => {
    const { sources } = service.getDataSources();
    const order = sources.find((s) => s.key === 'order');
    const fieldKeys = order?.fields.map((f) => f.key) ?? [];

    expect(order?.label).toBe('Заказ');
    expect(fieldKeys).toEqual(
      expect.arrayContaining(['number', 'date', 'status', 'total']),
    );
    expect(order?.fields.find((f) => f.key === 'total')?.type).toBe('currency');
  });
});

describe('buildFieldsFromSchema', () => {
  it('surfaces a new scalar schema path without editing a descriptor array', () => {
    const fields = buildFieldsFromSchema({
      paths: {
        name: { instance: 'String' },
        futureCode: { instance: 'String' },
        enabled: { instance: 'Boolean' },
        amount: { instance: 'Number' },
        internalId: { instance: 'ObjectId' },
        photoIds: { instance: 'Array' },
        composition: { instance: 'Array' },
      },
    });

    expect(fields).toEqual([
      { key: 'name', label: 'Наименование', type: 'text' },
      { key: 'futureCode', label: 'Future Code', type: 'text' },
      { key: 'enabled', label: 'Enabled', type: 'bool' },
      { key: 'amount', label: 'Amount', type: 'number' },
      { key: 'photoIds', label: 'Фото (ID/URL)', type: 'text' },
    ]);
  });

  it('maps configured product money fields to currency', () => {
    expect(
      buildFieldsFromSchema({
        paths: {
          listPrice: { instance: 'Number' },
          basePrice: { instance: 'Number' },
          costPrice: { instance: 'Number' },
        },
      }),
    ).toEqual([
      { key: 'listPrice', label: 'Прайсовая цена', type: 'currency' },
      { key: 'basePrice', label: 'Базовая цена', type: 'currency' },
      { key: 'costPrice', label: 'Себестоимость', type: 'currency' },
    ]);
  });
});
