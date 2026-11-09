import { createHash } from 'crypto';
import { buildV2Text } from './passport-v2-text';
import { PASSPORT_TEXTS_V2 } from './passport-texts.v2';

/**
 * C054 B1: устойчивые коды пунктов не меняют ни байта в снимках. Хэши сняты с кода ДО правки (ids = p1…pN);
 * сравниваются только прежние поля снимка (новые — traits, excluded… — в хэш не входят).
 */
const OLD_KEYS = ['templateVersion', 'ownVersion', 'category', 'description', 'purpose', 'rules', 'maintenance', 'install', 'sections', 'missing', 'standards', 'choices'] as const;
const CATS = ['TRN', 'WRK', 'DSP', 'BLG', 'DIO'] as const;
const GOLDEN: Record<string, string> = {
  TRN: '7b39f2c72571cc01530312ea62ebf8346b96361eb47fa8ab0bba75b34a63845c',
  WRK: '84f114c3e7ad02444a734bbd6b1b99d2eea27080f9235e19a877ef2a75ac74e1',
  DSP: '8a03725140be3b835ce5af1d8f5aa389e49654ed4b0c2d69189ccf078b9c2ff9',
  BLG: 'ead7bf2bb392bcee51dd89a3a1970cb0b08b95f54b7a229f3eb9eb75b697dda5',
  DIO: '85e1cf53d5c10aa48f887aab3136b3f007b803e78dfbc879e678f147c62aca4f',
};

const build = (cat: string, strip = false) => {
  const noIds = (t: { sections: object[] } & Record<string, unknown>) => (strip ? { ...t, sections: t.sections.map((x) => { const { ids, when, ...s } = x as Record<string, unknown>; void ids; void when; return s; }) } : t) as never;
  const t = buildV2Text({
    passport: { name: 'Изделие', passportCategory: cat, warrantyMonths: 12, serviceLifeYears: 10 },
    all: noIds({ ...PASSPORT_TEXTS_V2.ALL, version: 1 }),
    own: noIds({ ...PASSPORT_TEXTS_V2[cat as keyof typeof PASSPORT_TEXTS_V2], version: 2 }),
  }) as unknown as Record<string, unknown>;
  const old = Object.fromEntries(OLD_KEYS.map((k) => [k, t[k]]));
  return createHash('sha256').update(JSON.stringify(old)).digest('hex');
};

describe('снимки категорий не меняются от устойчивых кодов (C054 B1)', () => {
  it.each(CATS)('%s: снимок побайтно как до правки', (cat) => {
    const h = build(cat);
    expect(h).toBe(GOLDEN[cat]);
    expect(build(cat, true)).toBe(h); // без ids/when в шаблоне — тот же результат
  });
});
