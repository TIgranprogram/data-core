import { parseOverrides, overrideFor } from '../../common/passport/text-overrides';
import { buildV2Text } from './passport-v2-text';
import { DEFAULT_PASSPORT_TEMPLATE } from './passport-template.default';

/** C060: свои тексты изделия — подмена варианта, «убрать из паспорта»; справочник и шаблон не меняются. */
const hex = (n: number) => String(n).padStart(24, '0');
const mk = (o: Record<string, unknown>) => ({ id: hex(1), name: '', parentId: null, section: 'x', text: '', categories: '', allCategories: true, order: 0, required: false, isDefault: false, installTypeId: null, slot: 1, ...o });
const purposeRoot = mk({ id: hex(1), name: 'Назначение', section: 'purpose', children: [mk({ id: hex(2), name: 'Занятия', text: 'Для занятий спортом.', children: [] })] });
const mountRoot = mk({ id: hex(3), name: 'Монтаж', section: 'mounting', slot: 2, children: [mk({ id: hex(4), name: 'Анкер', text: 'Крепить анкерами.', children: [] })] });
const installRoot = mk({ id: hex(6), name: 'Установка', section: 'installation', children: [mk({ id: hex(7), name: 'Анкерная', text: 'Установка анкерная.', children: [] })] });
const forest = [purposeRoot, mountRoot, installRoot] as never;
const base = { all: { ...DEFAULT_PASSPORT_TEMPLATE, version: 0 }, funnel: { forest } };
const build = (textOverrides?: unknown) => buildV2Text({ ...base, passport: { name: 'Турник', passportCategory: 'TRN', textOverrides } as never });
const mounting = (t: ReturnType<typeof build>) => JSON.stringify(t.sections.find((s) => s.key === 'mounting')?.items ?? []);

describe('textOverrides (C060)', () => {
  it('разбор: чужие ключи и пустое отбрасываются, «убрать» главнее текста', () => {
    expect(parseOverrides({ [hex(3)]: { text: '  Свой  ' }, bad: { text: 'x' }, [hex(4)]: { text: '' }, [hex(5)]: { off: true, text: 'y' } })).toEqual({ [hex(3)]: { text: 'Свой' }, [hex(5)]: { off: true } });
    expect(parseOverrides({})).toBeUndefined();
    expect(parseOverrides(null)).toBeUndefined();
  });
  it('назначение и установку убрать нельзя, заменить — можно', () => {
    expect(overrideFor({ [hex(1)]: { off: true } }, hex(1), 'purpose')).toEqual({});
    expect(overrideFor({ [hex(1)]: { text: 'Своё' } }, hex(1), 'purpose')).toEqual({ text: 'Своё' });
    expect(overrideFor({ [hex(3)]: { off: true } }, hex(3), 'mounting')).toEqual({ off: true });
  });
  it('без правок — текст варианта, в таблице own=false', () => {
    const t = build();
    expect(mounting(t)).toContain('Крепить анкерами.');
    expect(t.funnel.find((f) => f.id === hex(3))).toMatchObject({ text: 'Крепить анкерами.', own: false, off: false, canOff: true });
  });
  it('свой текст вместо варианта: в паспорте он, в таблице — с пометкой и исходным текстом', () => {
    const t = build({ [hex(3)]: { text: 'Крепить на анкеры М12.' } });
    expect(mounting(t)).toContain('Крепить на анкеры М12.');
    expect(mounting(t)).not.toContain('Крепить анкерами.');
    expect(t.funnel.find((f) => f.id === hex(3))).toMatchObject({ own: true, original: 'Крепить анкерами.' });
  });
  it('«убрать из паспорта»: раздел не печатается, в таблице остаётся с off=true', () => {
    const t = build({ [hex(3)]: { off: true } });
    expect(mounting(t)).not.toContain('Крепить анкерами.');
    expect(t.funnel.find((f) => f.id === hex(3))).toMatchObject({ off: true, text: 'Крепить анкерами.' });
  });
  it('своё назначение и установка идут в поля паспорта', () => {
    const t = build({ [hex(1)]: { text: 'Для тренировок.' }, [hex(6)]: { text: 'Установка своя.' } });
    expect(t.purpose).toBe('Для тренировок.');
    expect(t.install.text).toBe('Установка своя.');
  });
});
