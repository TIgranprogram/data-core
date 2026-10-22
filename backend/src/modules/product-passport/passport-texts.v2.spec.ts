import * as fs from 'fs';
import * as path from 'path';
import { PASSPORT_TEXTS_V2, type PassportTextsCategory } from './passport-texts.v2';
import { buildV2Text } from './passport-v2-text';
import { V2_REQUIRED_FIELDS } from './passport-rules';

/** Тексты паспортов v2 (БЗ-6 Э7): ссылки, переменные, сборка без пропусков, порядок разделов, §6.1. */
const ROWS_SRC = fs.readFileSync(path.join(__dirname, '../../../scripts/seed-passport-standards.js'), 'utf8');
const STD = new Map([...ROWS_SRC.matchAll(/\['([A-Z0-9_]+)', '([^']+)', '[^']*', '([^']+)'/g)].map((m) => [m[1], { name: m[2], status: m[3] }]));
const STD_DICT = Object.fromEntries([...STD].map(([c, v]) => [c, v.name]));

const CATS = Object.keys(PASSPORT_TEXTS_V2) as PassportTextsCategory[];
const OWN = CATS.filter((c) => c !== 'ALL');
const COMMON_VARS = ['name', 'warrantyMonths', 'serviceLifeYears'];
const ALLOWED_VARS = [...COMMON_VARS, 'ageFrom', 'ageTo', 'heightMin', 'weightMax', 'maxUsers'];
const FIG_KINDS = ['overview', 'dimensions', 'safety_zone', 'foundation', 'holes', 'assembly'];

const textsOf = (c: PassportTextsCategory) => PASSPORT_TEXTS_V2[c].sections.flatMap((s) => [s.title, ...s.paragraphs]);
const placeholders = (c: PassportTextsCategory) => textsOf(c).flatMap((t) => [...t.matchAll(/\{([^}]*)\}/g)].map((m) => m[1]));

const FULL = { name: 'Тренажёр «Жим ногами»', warrantyMonths: 24, serviceLifeYears: 10, ageFrom: 7, ageTo: 12, heightMin: 1400, weightMax: 120, maxUsers: 2 };
const build = (c: PassportTextsCategory) => buildV2Text({
  passport: { ...FULL, passportCategory: c === 'ALL' ? '' : c },
  all: { ...PASSPORT_TEXTS_V2.ALL, version: 1 },
  own: c === 'ALL' ? null : { ...PASSPORT_TEXTS_V2[c], version: 1 },
  standards: STD_DICT,
});

describe('PASSPORT_TEXTS_V2', () => {
  it('список нормативов прочитан из seed-passport-standards.js', () => expect(STD.size).toBeGreaterThanOrEqual(15));

  it.each(CATS)('%s: есть разделы, у каждого заголовок и пункты', (c) => {
    expect(PASSPORT_TEXTS_V2[c].sections.length).toBeGreaterThanOrEqual(1);
    for (const s of PASSPORT_TEXTS_V2[c].sections) {
      expect(s.key).toMatch(/^[a-z]+$/);
      expect(s.title.trim()).not.toBe('');
      expect(s.paragraphs.length).toBeGreaterThan(0);
    }
  });

  it.each(CATS)('%s: {std:КОД} — только из справочника и только действующие/проверяемые', (c) => {
    const codes = placeholders(c).filter((p) => p.startsWith('std:')).map((p) => p.slice(4));
    for (const code of codes) {
      expect(STD.has(code)).toBe(true);
      expect(['не применять', 'не обязателен']).not.toContain(STD.get(code)!.status);
    }
  });

  it.each(CATS)('%s: переменные — из разрешённого списка и обязательные для категории', (c) => {
    const req = new Set([...COMMON_VARS, ...(V2_REQUIRED_FIELDS[c] ?? []).map(([k]) => k)]);
    for (const p of placeholders(c)) {
      const [kind, arg] = p.includes(':') ? p.split(':') : ['var', p];
      if (kind === 'var') { expect(ALLOWED_VARS).toContain(arg); expect([...req]).toContain(arg); }
      else if (kind === 'fig') expect(FIG_KINDS).toContain(arg);
      else if (kind === 'tab') expect(PASSPORT_TEXTS_V2.ALL.tables.map((t) => t.key)).toContain(arg);
      else expect(kind).toBe('std');
    }
  });

  it.each(CATS)('%s: собирается без «не найден / не заполнено» при заполненном паспорте', (c) => {
    const t = build(c);
    expect(t.missing).toEqual([]);
    const all = JSON.stringify(t.sections);
    expect(all).not.toMatch(/не найден\]|не заполнено\]/);
    expect(all).not.toMatch(/\{(std:|name|warrantyMonths|serviceLifeYears|ageFrom|ageTo|heightMin|weightMax|maxUsers)/);
    expect(t.sections[0].number).toBe('3');
  });

  it('порядок разделов по категориям', () => {
    const order = (c: PassportTextsCategory) => build(c).sections.map((s) => s.key);
    const tail = ['repair', 'storage', 'transport', 'warranty', 'claims', 'disposal', 'logs', 'acceptance'];
    expect(order('ALL')).toEqual(['general', 'mounting', 'service', ...tail]);
    expect(order('TRN')).toEqual(['general', 'use', 'mounting', 'service', 'moving', ...tail]);
    expect(order('WRK')).toEqual(['general', 'use', 'mounting', 'service', 'checks', ...tail]);
    expect(order('DSP')).toEqual(['general', 'use', 'mounting', 'service', ...tail]);
    expect(order('MAF')).toEqual(['general', 'mounting', 'service', 'care', ...tail]);
    expect(order('DIO')).toEqual(['general', 'use', 'mounting', 'service', 'inspections', ...tail]);
  });

  it.each(OWN)('%s: переопределяет только первый пункт «Общие указания» и «ТО», остальное наследует', (c) => {
    const all = Object.fromEntries(PASSPORT_TEXTS_V2.ALL.sections.map((s) => [s.key, s]));
    for (const s of PASSPORT_TEXTS_V2[c].sections) if (all[s.key]) expect(s.paragraphs).toHaveLength(1);
    const t = build(c);
    const svc = t.sections.find((s) => s.key === 'service')!;
    expect(svc.items).toHaveLength(all.service.paragraphs.length);
    expect(svc.items[1].text).toBe(all.service.paragraphs[1]);
  });

  it('TRN: в ТО ссылка только на свой стандарт; DIO/DSP — на свои', () => {
    const svc = (c: PassportTextsCategory) => build(c).sections.find((s) => s.key === 'service')!.items[0].text;
    expect(svc('TRN')).toContain(STD_DICT.GOST_R_57538);
    expect(svc('TRN')).not.toMatch(/52301|55679/);
    expect(svc('DIO')).toContain(STD_DICT.GOST_R_52301);
    expect(svc('DSP')).toContain(STD_DICT.GOST_R_55679);
    expect(svc('MAF')).not.toMatch(/ГОСТ/);
  });

  it.each(CATS)('%s: качество текста (§6.1)', (c) => {
    for (const t of textsOf(c)) {
      expect(t).not.toMatch(/и\s?т\.\s?[дп]\.|и др\./); // без «и т. д.», «и т. п.», «и др.»
      expect(t).not.toMatch(/(ГОСТ|СНиП|СП|ТР ЕАЭС)\s*Р?\s*\d/); // номера нормативов — только {std:…}
      expect(t).not.toMatch(/ {2}| [,.;:]|\.\.|;\.|\.;/); // двойные пробелы, пробел перед знаком, «.;»
      expect(t).toBe(t.trim());
      if (t.includes('{name}')) expect(t).toMatch(/: \{name\}\./); // {name} — после двоеточия: род/число названия не влияют
      expect(t).not.toMatch(/\{(warrantyMonths|serviceLifeYears)\} (месяц|год|лет)/); // склонение числа — через «мес.» / «, лет:»
      expect(t).not.toMatch(/Предназначени|отчищ|поглащ|обратится|в течении/); // ошибки аналога §1.4
    }
  });
});
