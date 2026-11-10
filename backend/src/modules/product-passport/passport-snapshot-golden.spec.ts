import { createHash } from 'crypto';
import { buildV2Text } from './passport-v2-text';
import { PASSPORT_TEXTS_V2 } from './passport-texts.v2';

/**
 * C054 B1: устойчивые коды пунктов не меняют ни байта в снимках. Хэши сняты с кода ДО правки (ids = p1…pN);
 * сравниваются только прежние поля снимка (новые — traits, excluded… — в хэш не входят).
 */
const OLD_KEYS = ['templateVersion', 'ownVersion', 'category', 'description', 'purpose', 'rules', 'maintenance', 'install', 'sections', 'missing', 'standards', 'choices'] as const;
const CATS = ['TRN', 'WRK', 'DSP', 'BLG', 'DIO'] as const;
/** C064: в description без материалов — метка «[{materials} не заполнено]»; эталон обновлён 2026-11-10. */
const GOLDEN: Record<string, string> = {
  TRN: '30db7e58a3bfaf03482d27a3aa9a15f8ce8a8ddc07c6682313595170c928d759',
  WRK: 'c6c6b94d24f945e485166c6a2a7e42e1c2b3818ab407c436a70f609dcb05beee',
  DSP: '20e13e9805bb7b001e550a137acca249badd9ccde9accc54135f6156ac5375ca',
  BLG: 'd7b12bcdeb5a776803738370cfe512eff21647b519b6d93fec05879bbcbe6155',
  DIO: 'a0990541f1c31655111537341ec77c82f303cbf61b2c15a9ece4f3b42b640654',
};

// B4 добавил условия (when) в тексты — они меняют снимок нарочно; эталон проверяет только коды пунктов, поэтому when снимается всегда
const build = (cat: string, strip = false) => {
  const noIds = (t: { sections: object[] } & Record<string, unknown>) => ({ ...t, sections: t.sections.map((x) => { const { ids, when, ...s } = x as Record<string, unknown>; void when; return strip ? s : { ...s, ...(ids ? { ids } : {}) }; }) }) as never;
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
