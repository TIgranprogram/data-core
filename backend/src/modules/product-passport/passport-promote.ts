import { BadRequestException } from '@nestjs/common';

/**
 * «Перенести правку в справочник» (БЗ-6 Э5a4): текст пункта из паспорта → версия шаблона категории.
 * Наследование (passport-texts.v2.ts): раздел категории с ключом как у «Для всех» заменяет его ПЕРВЫЕ N пунктов,
 * поэтому, чтобы заменить пункт pK, у раздела категории должно быть ≥ K пунктов — недостающие берутся из «Для всех»
 * (т. е. остаются как были). Раздел только категории — правится на месте.
 */
type Sec = { key: string; title: string; paragraphs: string[] };

export function promoteToOwn(own: Sec[] | null | undefined, all: Sec[], sectionKey: string, itemKey: string, text: string): Sec[] {
  const m = /^p(\d+)$/.exec(itemKey);
  if (!m) throw new BadRequestException('Неизвестный пункт');
  const idx = Number(m[1]) - 1;
  const t = String(text ?? '').trim();
  if (!t) throw new BadRequestException('Пустой текст');
  const base = (own ?? []).map((s) => ({ ...s, paragraphs: [...s.paragraphs] }));
  const allSec = all.find((s) => s.key === sectionKey);
  let sec = base.find((s) => s.key === sectionKey);
  if (!sec) {
    if (!allSec) throw new BadRequestException('Раздел не найден ни в категории, ни в «Для всех»');
    sec = { key: allSec.key, title: allSec.title, paragraphs: [] };
    base.push(sec);
  }
  while (sec.paragraphs.length < idx) sec.paragraphs.push(allSec?.paragraphs[sec.paragraphs.length] ?? '');
  sec.paragraphs[idx] = t;
  return base;
}
