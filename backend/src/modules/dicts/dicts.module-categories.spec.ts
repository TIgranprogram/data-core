import { DICT, DICTS, DICT_UI } from './dicts.defs';

describe('Категории модулей', () => {
  const dict = DICT.get('moduleCategories')!;

  it('регистрирует отдельный справочник со ссылками по id', () => {
    expect(DICTS.filter((d) => d.key === 'moduleCategories')).toEqual([dict]);
    expect(dict).toMatchObject({
      coll: 'categories',
      match: { type: 'module', deletedAt: null },
      sections: ['Модули', 'Продукция'],
      refBy: 'id',
    });
    expect(DICT_UI[dict.key].newTitle).toBe('Новая категория модуля');
  });

  it('создаёт активную категорию модуля и обходит занятые slug и префикс', async () => {
    const findOne = jest.fn(async (q: { slug?: string; skuPrefix?: string }) =>
      q.slug === 'karkas' || q.skuPrefix === 'KAR' ? { type: 'material' } : null,
    );
    const collection = jest.fn(() => ({ findOne }));
    const db = { collection } as never;
    await expect(dict.toDoc({ name: 'Каркас' }, true, db)).resolves.toMatchObject({
      name: 'Каркас', type: 'module', slug: 'karkas-2', skuPrefix: 'KAR2', isActive: true, deletedAt: null,
    });
    expect(collection).toHaveBeenCalledWith('categories');
    await expect(dict.toDoc({ name: 'Ограждение' }, false, db)).resolves.not.toHaveProperty('type');
  });
});
