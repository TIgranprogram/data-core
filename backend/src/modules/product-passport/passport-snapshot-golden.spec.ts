import { createHash } from 'crypto';
import { buildV2Text } from './passport-v2-text';
import { PASSPORT_TEXTS_V2 } from './passport-texts.v2';

/**
 * C054 B1: устойчивые коды пунктов не меняют снимки. Сравниваем сборку с кодами и без них;
 * сравниваются только прежние поля снимка (новые — traits, excluded… — в хэш не входят).
 */
const OLD_KEYS = ['templateVersion', 'ownVersion', 'category', 'description', 'purpose', 'rules', 'maintenance', 'install', 'sections', 'missing', 'standards', 'choices'] as const;
const CATS = ['TRN', 'WRK', 'DSP', 'BLG', 'DIO'] as const;
/** Эталон обновлён 17.11.2026 после четырёх исправлений общего шаблона. */
const GOLDEN: Record<string, string> = {
  TRN: '9369cface5533f98fdad27a8d1a1be98104c59b387da6b326e39380857bff5e6',
  WRK: 'b5658e39abfbcb3a015c565cb15ed0de2280cfde140768739a7392860548349b',
  DSP: '5084d199be76c0632a0bdeb57e96a76f82d4a744fc9581401b90d150e72f7fff',
  BLG: '1a73295694c45037e87b5d37b7644dda9917cd6965f2aa58c459a2072b019e78',
  DIO: '68d82d4632461108eb062f2e7566d87a8c25b72119a5390987be0da6ad002c1c',
};

// B4 добавил условия (when) в тексты — они меняют снимок нарочно; эталон проверяет только коды пунктов, поэтому when снимается всегда
const build = (cat: string, strip = false) => {
  const noIds = (t: { sections: object[] } & Record<string, unknown>) => ({ ...t, sections: t.sections.map((x) => { const { ids, when, ...s } = x as Record<string, unknown>; void when; return strip ? s : { ...s, ...(ids ? { ids } : {}) }; }) }) as never;
  const t = buildV2Text({
    passport: { name: 'Изделие', passportCategory: cat, warrantyMonths: 12, serviceLifeYears: 10 },
    all: noIds({ ...PASSPORT_TEXTS_V2.ALL, version: 1 }),
    own: noIds({ ...PASSPORT_TEXTS_V2[cat as keyof typeof PASSPORT_TEXTS_V2], version: 2 }),
  }) as unknown as Record<string, unknown>;
  // C130: у пунктов появился источник (src) — новое поле, в хэш не входит, как и остальные новые
  const noSrc = (secs: Array<{ items: Array<Record<string, unknown>> }>) => secs.map((s) => ({ ...s, items: s.items.map((i) => { const { src, ...rest } = i; void src; return rest; }) }));
  const old = Object.fromEntries(OLD_KEYS.map((k) => [k, k === 'sections' ? noSrc(t[k] as never) : t[k]]));
  return createHash('sha256').update(JSON.stringify(old)).digest('hex');
};

describe('снимки категорий не меняются от устойчивых кодов (C054 B1)', () => {
  it.each(CATS)('%s: снимок соответствует эталону', (cat) => {
    const h = build(cat);
    expect(h).toBe(GOLDEN[cat]);
    expect(build(cat, true)).toBe(h); // без ids/when в шаблоне — тот же результат
  });
});
