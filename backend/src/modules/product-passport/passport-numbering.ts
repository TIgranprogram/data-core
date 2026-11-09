/**
 * Номера разделов PDF v2 (C054 B3) — чистая функция, без PDF.
 *
 * layout 1 (снимки без поля `layout`, выданные паспорта): как печаталось раньше — разделы текста со своими номерами из снимка
 * (обычно с 3), свободные 1…start-1 под описание и правила, остальные блоки — после последнего номера. Не трогаем:
 * выданный паспорт при перепечати не должен менять номера.
 *
 * layout 2 (новые сборки): один проход по порядку вывода — описание, правила, разделы текста, ТО, монтаж, комплектность,
 * журналы; номера подряд 1…N без пропусков и повторов. Монтаж один: если в тексте есть раздел `mounting`, шаги способа
 * установки и требования к основанию печатаются внутри него (а не вторым разделом «Монтаж» после ТО).
 */
export interface NumberingSection { key: string; number: string; items: Array<{ number: string | null }> }
export interface NumberingInput {
  sections: NumberingSection[];
  /** Есть описание, назначение или таблица основных данных. */
  hasDescr: boolean;
  hasRules: boolean;
  hasMaintenance: boolean;
  /** Есть шаги монтажа или требования к основанию. */
  hasInstall: boolean;
  layout?: number;
}
export interface NumberingPlan {
  /** Описание и правила печатаются перед разделами текста. */
  before: boolean;
  /** Правила внутри описания (layout 1: один свободный номер). */
  mergeRules: boolean;
  descrNo: string;
  rulesNo: string;
  /** Номер раздела текста по индексу в `sections` ('' — раздел без пунктов не печатается). */
  sectionNo: string[];
  toNo: string;
  /** Отдельный раздел «Монтаж» ('' — монтаж внутри раздела текста или его нет). */
  installNo: string;
  /** Шаги монтажа и основание печатаются внутри раздела текста `mounting`. */
  mergeInstall: boolean;
  bomNo: string;
  journalNo: string;
  /** Номер пункта в разделе: layout 2 переписывает префикс; layout 1 — как в снимке. */
  itemNo(sectionIndex: number, itemNumber: string | null): string | null;
}

export function planNumbers(input: NumberingInput): NumberingPlan {
  const { sections, hasDescr, hasRules, hasMaintenance, hasInstall } = input;
  const printed = sections.map((s) => !!s.items?.length);

  if (input.layout === 2) {
    let next = 1;
    const descrNo = hasDescr ? String(next++) : '';
    const rulesNo = hasRules ? String(next++) : '';
    const sectionNo = sections.map((_, i) => (printed[i] ? String(next++) : ''));
    const toNo = hasMaintenance ? String(next++) : '';
    const mountIdx = sections.findIndex((s, i) => printed[i] && s.key === 'mounting');
    const mergeInstall = hasInstall && mountIdx >= 0;
    const installNo = hasInstall && !mergeInstall ? String(next++) : '';
    const bomNo = String(next++);
    const journalNo = String(next++);
    return {
      before: true, mergeRules: false, descrNo, rulesNo, sectionNo, toNo, installNo, mergeInstall, bomNo, journalNo,
      itemNo: (i, n) => (n && n.startsWith(`${sections[i].number}.`) ? `${sectionNo[i]}${n.slice(sections[i].number.length)}` : n),
    };
  }

  const start = parseInt(sections[0]?.number ?? '', 10) || 1;
  const lastNo = sections.reduce((m, s) => Math.max(m, parseInt(s.number, 10) || 0), 0);
  const before = start > 1;
  const mergeRules = before && start === 2; // один свободный номер — правила внутри описания
  let next = before ? 1 : lastNo + 1;
  const descrNo = hasDescr || (mergeRules && hasRules) ? String(next++) : '';
  const rulesNo = hasRules && !mergeRules ? String(next++) : '';
  if (before) next = lastNo + 1;
  const toNo = hasMaintenance ? String(next++) : '';
  const installNo = hasInstall ? String(next++) : '';
  const bomNo = String(next++);
  const journalNo = String(next++);
  return { before, mergeRules, descrNo, rulesNo, sectionNo: sections.map((s, i) => (printed[i] ? s.number : '')), toNo, installNo, mergeInstall: false, bomNo, journalNo, itemNo: (_i, n) => n };
}
