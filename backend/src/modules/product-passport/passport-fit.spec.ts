import { buildV2Text } from './passport-v2-text';
import { PASSPORT_TEXTS_V2 } from './passport-texts.v2';

/**
 * C094: тексты паспорта подходят к изделию — четыре эталона на настоящих текстах (scripts/passport-texts.v2.json).
 * Справочники — как после c094-traits.js: виды несут guards / bin / bars / landing / moving.
 */
const all = PASSPORT_TEXTS_V2.ALL;
const el = (id: string, name: string, traits = '', kind = 'product') => ({ _id: id, code: id, name, kind, traits });
const dicts = {
  elements: [
    el('stand', 'Информационный стенд'),
    el('bench', 'Скамья'),
    el('fence', 'Ограждение (перила)', 'guards'),
    el('slide', 'Горка', 'moving, landing'),
    el('anchor', 'Анкер', '', 'fastener'),
  ],
  materials: [
    { _id: 'wood', code: 'WOOD', name: 'Древесина хвойных пород', kind: 'material', traits: 'wood' },
    { _id: 'steel', code: 'STEEL', name: 'Сталь', kind: 'material', traits: 'metal' },
    { _id: 'paint', code: 'POWDER', name: 'Порошковая окраска', kind: 'coating', traits: '' },
  ],
  defects: [],
  install: [{ _id: 'concrete', code: 'CONCRETE', name: 'Бетонирование опор', traits: 'concrete' }, { _id: 'bolts', code: 'BOLTS', name: 'Крепление на болтах', traits: 'bolts' }],
};
const text = (passport: Record<string, unknown>) => {
  const cat = String(passport.passportCategory);
  const t = buildV2Text({ passport, all, own: PASSPORT_TEXTS_V2[cat as 'BLG'], dicts });
  return { t, s: JSON.stringify(t.sections).toLowerCase() };
};
const base = { joints: ['bolts', 'welds'] };

const ZONE = 'зону безопасности';
const ANCHORS = 'выступающие концы анкеров';
const GUARDS = 'снимать ограждения';
const RUST = 'очищают от ржавчины';
const KEEP_METAL = 'металлические поверхности без покрытия';
const SCRAP = 'принимающим металлолом';
const BIN = 'ёмкости для мусора';
const ROT = 'гниение древесины';

describe('C094: эталон «указатель» (дерево, бетонирование)', () => {
  const { s, t } = text({ ...base, passportCategory: 'BLG', elements: ['stand'], materialIds: ['wood', 'paint'], installationTypeId: 'concrete' });
  it('чужих пунктов нет', () => {
    for (const bad of [ZONE, ANCHORS, GUARDS, RUST, KEEP_METAL, SCRAP, BIN]) expect(s).not.toContain(bad);
  });
  it('нужные остались', () => {
    for (const ok of ['бетонные работы', 'вертикальность стоек', ROT, 'сжигать полимерные']) expect(s).toContain(ok);
    expect(t.excluded.map((e) => `${e.section}/${e.key}`)).toEqual(expect.arrayContaining(['mounting/p3', 'mounting/p9', 'repair/p3', 'repair/p4', 'storage/p6', 'disposal/p5', 'care/p3']));
  });
});

describe('C094: эталон «скамья» (металл, на болтах)', () => {
  const { s } = text({ ...base, passportCategory: 'BLG', elements: ['bench'], materialIds: ['steel', 'paint'], installationTypeId: 'bolts' });
  it('металлические пункты есть, чужие — нет', () => {
    for (const ok of [RUST, KEEP_METAL, SCRAP, ROT]) expect(s).toContain(ok);
    for (const bad of [ZONE, GUARDS, BIN, 'деревянные элементы']) expect(s).not.toContain(bad);
  });
});

describe('C094: эталон «ограждение» (дерево, перила)', () => {
  const { s } = text({ ...base, passportCategory: 'BLG', elements: ['fence'], materialIds: ['wood'], installationTypeId: 'bolts' });
  it('пункт про ограждения и поручни есть, про ржавчину и металлолом — нет', () => {
    expect(s).toContain(GUARDS);
    for (const bad of [ZONE, RUST, KEEP_METAL, SCRAP, BIN]) expect(s).not.toContain(bad);
  });
});

describe('C094: эталон «игровой комплекс» (DIO, вид не указан — пункты остаются)', () => {
  const { s, t } = text({ ...base, passportCategory: 'DIO', elements: [], materialIds: [], installationTypeId: 'bolts' });
  it('зона безопасности, приземление и подвижные части на месте', () => {
    for (const ok of [ZONE, 'зона приземления', 'функциональный осмотр', 'износ подвижных частей', GUARDS, RUST]) expect(s).toContain(ok);
    expect(t.traits).toEqual(expect.arrayContaining(['users', 'moving', 'landing', 'metal', 'wood']));
  });
  it('известный вид — только его признаки: горка без ограждений', () => {
    const r = text({ ...base, passportCategory: 'DIO', elements: ['slide'], materialIds: ['steel'], installationTypeId: 'bolts' });
    expect(r.s).toContain('зона приземления');
    expect(r.s).not.toContain(GUARDS);
    expect(r.s).not.toContain('сжигать полимерные'); // материал известен: сталь
  });
});

describe('C094: только крепёж в видах — вид всё ещё не указан', () => {
  it('анкер без вида изделия не прячет пункты', () => {
    const { s } = text({ ...base, passportCategory: 'BLG', elements: ['anchor'], materialIds: ['steel'], installationTypeId: 'bolts' });
    expect(s).toContain(GUARDS);
  });
});
