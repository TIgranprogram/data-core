import type { GapItem } from './passport-gaps';

/**
 * Веса пунктов очереди «что заполнить первым» (C114 J, H-REPORT п.3): вес = сколько дверей открывает поле.
 * 5 — без него остальное не определено; 4 — тексты паспорта и техописание; 3 — закрывает выпуск; 2 — улучшает документ; 1 — для порядка.
 */
export const GAP_WEIGHT: Record<GapItem['kind'], number> = { category: 5, kind: 4, purpose: 4, field: 3, install: 3, elements: 3, image: 2, facet: 2 };

/** Что открывает пункт — для подписи менеджеру. */
export const GAP_OPENS: Record<GapItem['kind'], string> = {
  category: 'без типа паспорта остальное не определено', kind: 'откроет паспорт и техописание', purpose: 'откроет паспорт и техописание',
  field: 'нужно для выпуска паспорта', install: 'нужно для выпуска паспорта', elements: 'нужно для выпуска паспорта',
  image: 'нужно для печати паспорта', facet: 'уточнит тексты паспорта',
};

export type FillTarget = 'passport' | 'techsheet' | 'both';

/** Пункты изделия вне паспортных пробелов: ключ → подпись, вес, куда ведёт. Ключи полей паспорта в `covers` — тогда пункт не дублируем. */
export const PRODUCT_ITEMS: Array<{ key: string; label: string; weight: number; target: FillTarget; opens: string; covers: string[] }> = [
  { key: 'dimensions', label: 'Габариты', weight: 3, target: 'both', opens: 'откроет паспорт, техописание и склад', covers: ['height', 'length', 'width'] },
  { key: 'weightKg', label: 'Вес', weight: 3, target: 'both', opens: 'откроет паспорт, техописание и склад', covers: ['weight'] },
  { key: 'composition', label: 'Состав изделия', weight: 3, target: 'both', opens: 'откроет техописание, паспорт и закупку', covers: [] },
  { key: 'installation', label: 'Монтаж', weight: 2, target: 'both', opens: 'нужно для техописания и паспорта', covers: ['installationTypeId'] },
];
