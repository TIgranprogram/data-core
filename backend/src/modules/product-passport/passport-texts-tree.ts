import { compose, legacyStartNumber, legacyTemplateToBlocks, type LegacyTemplateLike } from './passport-compose';

/**
 * Дерево «раздел → пункты» для редактора «Справочники → Паспорта → Разделы и тексты» (БЗ-6 Э2d) — чистая функция.
 * Порядок и номера — ровно как у сборщика (compose): вместо текста в сборщик уходит метка «#индекс», по ней
 * пункт находится обратно. Так дерево не может разойтись с паспортом.
 *
 * Пометки пункта:
 *  - 'all'      — общий пункт «Для всех» (в коде, только чтение);
 *  - 'own'      — пункт категории, своего ключа в «Для всех» нет (новый);
 *  - 'override' — пункт категории ЗАМЕНЯЕТ общий с тем же ключом (раздел + номер по порядку), allText — что заменил.
 * ownSection / ownIndex — где пункт лежит в версии категории (sections[ownSection].paragraphs[ownIndex]) — для правки.
 * Пустые разделы категории (без пунктов) в паспорт не попадают и в дереве не показываются: это «распорки»,
 * которые держат индекс следующих разделов категории (по индексу новый раздел встаёт после раздела «Для всех»).
 */
export type TextOrigin = 'all' | 'own' | 'override';

export interface TextsTreeItem {
  key: string;
  number: string | null;
  bullet: boolean;
  /** Текст как хранится (с переменными). */
  text: string;
  origin: TextOrigin;
  ownIndex: number | null;
  /** Индекс пункта в разделе «Для всех» (для 'all' и 'override'). */
  allIndex: number | null;
  allText?: string;
}

export interface TextsTreeSection {
  key: string;
  number: string;
  title: string;
  /** Индекс раздела в «Для всех» (null — раздел только категории). */
  allSection: number | null;
  /** Индекс раздела в версии категории (null — у категории такого раздела нет). */
  ownSection: number | null;
  /** Сколько пунктов в разделе «Для всех» и в разделе категории (пункт категории № k заменяет общий № k). */
  allCount: number;
  ownCount: number;
  items: TextsTreeItem[];
}

const LEAD_NUM = /^\s*\d+(?:\.\d+)*\.?\s+/;
const OWN = '__OWN__';

interface Meta { origin: 'all' | 'own'; section: number; index: number; key: string; text: string }

export function textsTree(all: LegacyTemplateLike, own?: LegacyTemplateLike | null): TextsTreeSection[] {
  const allBlocks = legacyTemplateToBlocks(all);
  const ownBlocks = own ? legacyTemplateToBlocks(own).map((b) => ({ ...b, category: OWN })) : [];
  // мета в том же порядке, в каком legacyTemplateToBlocks обходит разделы и пункты
  const meta: Meta[] = [];
  all.sections.forEach((s, si) => s.paragraphs.forEach((p, pi) => meta.push({ origin: 'all', section: si, index: pi, key: s.key, text: p })));
  (own?.sections || []).forEach((s, si) => s.paragraphs.forEach((p, pi) => meta.push({ origin: 'own', section: si, index: pi, key: s.key, text: p })));
  const blocks = [...allBlocks, ...ownBlocks].map((b, i) => ({ ...b, text: `#${i}`, sectionTitle: '' }));
  const r = compose(blocks, {}, OWN, { startNumber: legacyStartNumber(all) });

  const allIdx = (key: string) => all.sections.findIndex((s) => s.key === key);
  const ownIdx = (key: string) => (own?.sections || []).findIndex((s) => s.key === key && s.paragraphs.length > 0);
  return r.sections.map((s) => {
    const a = allIdx(s.key), o = ownIdx(s.key);
    const aSec = a >= 0 ? all.sections[a] : null, oSec = o >= 0 ? own!.sections[o] : null;
    const title = (oSec?.title || aSec?.title || '').replace(LEAD_NUM, '');
    return {
      key: s.key, number: s.number, title,
      allSection: a >= 0 ? a : null, ownSection: o >= 0 ? o : null,
      allCount: aSec?.paragraphs.length ?? 0, ownCount: oSec?.paragraphs.length ?? 0,
      items: s.items.map((it) => {
        const m = meta[Number(it.text.slice(1))];
        if (m.origin === 'all') return { key: it.key, number: it.number, bullet: it.bullet, text: m.text, origin: 'all' as const, ownIndex: null, allIndex: m.index };
        const replaced = aSec && m.index < aSec.paragraphs.length ? aSec.paragraphs[m.index] : undefined;
        return {
          key: it.key, number: it.number, bullet: it.bullet, text: m.text,
          origin: replaced !== undefined ? 'override' as const : 'own' as const,
          ownIndex: m.index, allIndex: replaced !== undefined ? m.index : null,
          ...(replaced !== undefined ? { allText: replaced } : {}),
        };
      }),
    };
  });
}
