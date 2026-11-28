import { legacyTemplateToBlocks, type PassportTextBlock } from './passport-compose';
import { PASSPORT_TEXTS_V2, type PassportTextsCategory } from './passport-texts.v2';

// В сохранённых версиях шаблонов есть общие фразы для монтажа на площадке.
// Адаптируем только исходный типовой абзац. Свой текст категории или изделия сохраняется.
const variants: Partial<Record<PassportTextsCategory, Record<string, string>>> = {
  ALL: {
    'mounting/p2': 'До начала монтажа проверяют доступ к местам соединений и возможность безопасно выполнить работы.',
    'mounting/p6': 'Места соединений, расположение деталей и крепёж указаны на схеме монтажа изделия.',
    'mounting/p8': 'После сборки проверяют положение соединённых деталей и затяжку болтов по схеме монтажа изделия.',
    'service/p7': 'При периодическом осмотре проверяют состояние болтовых соединений, затяжку крепежа и состояние защитного покрытия.',
    'disposal/p4': 'Демонтированные части сортируют по видам материалов.',
  },
  BLG: { 'care/p4': 'Места соединений очищают от загрязнений, удерживающих влагу.' },
  DIO: { 'inspections/p5': 'При ежегодном основном осмотре оценивают общее техническое состояние оборудования, в том числе болтовых соединений, состояние материалов и последствия ремонта или замены частей.' },
};
const standardTexts = new Map<string, string>();
for (const category of Object.keys(variants) as PassportTextsCategory[]) {
  for (const block of legacyTemplateToBlocks(PASSPORT_TEXTS_V2[category])) {
    const replacement = variants[category]?.[`${block.sectionKey}/${block.key}`];
    if (replacement) standardTexts.set(block.text, replacement);
  }
}

export function boltedTextBlock(block: PassportTextBlock): PassportTextBlock {
  const text = standardTexts.get(block.text);
  return text ? { ...block, text } : block;
}
