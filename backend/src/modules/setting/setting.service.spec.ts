import { catalogAppearanceKey, SettingService } from './setting.service';

describe('catalogAppearanceKey', () => {
  it('namespaces organization overrides without accepting client scope', () => {
    expect(catalogAppearanceKey('org-a')).toBe('catalog.appearance.org-a');
    expect(catalogAppearanceKey(null)).toBe('catalog.appearance');
    expect(catalogAppearanceKey(undefined)).toBe('catalog.appearance');
  });
});

describe('SettingService catalog appearance', () => {
  function makeModel(findOne: jest.Mock) {
    return { findOne } as unknown as ConstructorParameters<typeof SettingService>[0];
  }

  it('prefers an organization override and otherwise reads the global fallback', async () => {
    const scoped = { exec: jest.fn().mockResolvedValue({ key: 'catalog.appearance.org-a' }) };
    const global = { exec: jest.fn().mockResolvedValue({ key: 'catalog.appearance' }) };
    const findOne = jest.fn().mockReturnValueOnce(scoped).mockReturnValueOnce(global);
    const service = new SettingService(makeModel(findOne));

    await expect(service.findCatalogAppearance('org-a')).resolves.toEqual({
      key: 'catalog.appearance.org-a',
    });
    expect(findOne).toHaveBeenCalledTimes(1);
  });

  it('returns null value (not 404) when no catalog appearance setting exists', async () => {
    const findOne = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    const service = new SettingService(makeModel(findOne));

    await expect(service.findCatalogAppearance('org-a')).resolves.toEqual({
      key: 'catalog.appearance',
      value: null,
    });
    expect(findOne).toHaveBeenCalledTimes(2);
  });
});
