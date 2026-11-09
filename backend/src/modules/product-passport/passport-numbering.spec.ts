import { planNumbers, type NumberingInput } from './passport-numbering';
import { buildV2Text } from './passport-v2-text';
import { PASSPORT_TEXTS_V2 } from './passport-texts.v2';

/** Номера разделов PDF (C054 B3): layout 2 — подряд 1…N и один «Монтаж»; без layout — как печаталось раньше. */
const CATS = ['TRN', 'WRK', 'DSP', 'BLG', 'DIO'] as const;
const sectionsOf = (cat: string) => buildV2Text({
  passport: { name: 'Изделие', passportCategory: cat, warrantyMonths: 12, serviceLifeYears: 10 },
  all: { ...PASSPORT_TEXTS_V2.ALL, version: 1 }, own: { ...PASSPORT_TEXTS_V2[cat as keyof typeof PASSPORT_TEXTS_V2], version: 1 },
}).sections;

/** Прежний расчёт (до C054), как он был в layoutV2 — эталон для выданных паспортов. */
function oldPlan(sections: Array<{ number: string }>, hasDescr: boolean, hasRules: boolean, hasMaintenance: boolean, hasInstall: boolean) {
  const start = parseInt(sections[0]?.number ?? '', 10) || 1;
  const lastNo = sections.reduce((m, s) => Math.max(m, parseInt(s.number, 10) || 0), 0);
  const before = start > 1;
  const mergeRules = before && start === 2;
  let next = before ? 1 : lastNo + 1;
  const descrNo = hasDescr || (mergeRules && hasRules) ? String(next++) : '';
  const rulesNo = hasRules && !mergeRules ? String(next++) : '';
  if (before) next = lastNo + 1;
  const toNo = hasMaintenance ? String(next++) : '';
  const installNo = hasInstall ? String(next++) : '';
  return { descrNo, rulesNo, toNo, installNo, bomNo: String(next++), journalNo: String(next++) };
}

const flags = [false, true];
describe('planNumbers: матрица 5 категорий × правила × ТО × монтаж × описание', () => {
  for (const cat of CATS) {
    const sections = sectionsOf(cat);
    for (const hasRules of flags) for (const hasMaintenance of flags) for (const hasInstall of flags) for (const hasDescr of flags) {
      const name = `${cat}: описание=${hasDescr} правила=${hasRules} ТО=${hasMaintenance} монтаж=${hasInstall}`;
      const input: NumberingInput = { sections, hasDescr, hasRules, hasMaintenance, hasInstall };

      it(`layout 2 — ряд 1…N без пропусков и повторов; один «Монтаж»; ${name}`, () => {
        const p = planNumbers({ ...input, layout: 2 });
        const nos = [p.descrNo, p.rulesNo, ...p.sectionNo, p.toNo, p.installNo, p.bomNo, p.journalNo].filter(Boolean).map(Number);
        expect(nos).toEqual(Array.from({ length: nos.length }, (_, i) => i + 1));
        const mountingHeadings = (p.sectionNo[sections.findIndex((s) => s.key === 'mounting')] ? 1 : 0) + (p.installNo ? 1 : 0);
        if (hasInstall) expect(mountingHeadings).toBe(1);
        // у пунктов номер раздела — новый
        sections.forEach((s, i) => s.items.forEach((it) => { if (it.number) expect(p.itemNo(i, it.number)!.startsWith(`${p.sectionNo[i]}.`)).toBe(true); }));
      });

      it(`без layout — ровно как до правки; ${name}`, () => {
        const p = planNumbers(input);
        expect({ descrNo: p.descrNo, rulesNo: p.rulesNo, toNo: p.toNo, installNo: p.installNo, bomNo: p.bomNo, journalNo: p.journalNo }).toEqual(oldPlan(sections, hasDescr, hasRules, hasMaintenance, hasInstall));
        expect(p.sectionNo).toEqual(sections.map((s) => s.number));
        expect(p.mergeInstall).toBe(false);
        sections.forEach((s, i) => s.items.forEach((it) => expect(p.itemNo(i, it.number)).toBe(it.number)));
      });
    }
  }

  it('нет раздела «Монтаж» в тексте — шаги идут отдельным разделом, он один', () => {
    const sections = sectionsOf('TRN').filter((s) => s.key !== 'mounting');
    const p = planNumbers({ sections, hasDescr: true, hasRules: true, hasMaintenance: true, hasInstall: true, layout: 2 });
    expect(p.mergeInstall).toBe(false);
    expect(p.installNo).not.toBe('');
  });

  it('есть раздел «Монтаж» — шаги внутри него, отдельного номера нет', () => {
    const sections = sectionsOf('TRN');
    const p = planNumbers({ sections, hasDescr: true, hasRules: true, hasMaintenance: true, hasInstall: true, layout: 2 });
    expect(p.mergeInstall).toBe(true);
    expect(p.installNo).toBe('');
  });

  it('пример: описание 1, правила 2, текст 3…, ТО, комплектность, журналы — последовательно', () => {
    const sections = [{ key: 'general', number: '3', items: [{ number: '3.1' }, { number: null }, { number: '3.2' }] }, { key: 'empty', number: '4', items: [] }, { key: 'warranty', number: '5', items: [{ number: '5.1' }] }];
    const p = planNumbers({ sections, hasDescr: true, hasRules: true, hasMaintenance: true, hasInstall: false, layout: 2 });
    expect(p).toMatchObject({ descrNo: '1', rulesNo: '2', sectionNo: ['3', '', '4'], toNo: '5', installNo: '', bomNo: '6', journalNo: '7' });
    expect(p.itemNo(2, '5.1')).toBe('4.1');
    expect(p.itemNo(0, null)).toBeNull();
  });
});
