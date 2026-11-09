import { BadRequestException } from '@nestjs/common';
import { sectionItems } from './passport-compose';

/**
 * «Перенести правку в справочник» (БЗ-6 Э5a4): текст пункта из паспорта → версия шаблона категории.
 * Наследование: пункт категории с тем же кодом (ids; нет ids — pN по позиции), что у «Для всех», ЗАМЕНЯЕТ его.
 * Пока коды в «Для всех» — p1…pN подряд, работает прежний приём: пункт pK занимает позицию K, недостающие до него
 * берутся из «Для всех». Если в «Для всех» есть пункт с особым кодом (вставленный в середину) — пункт добавляется
 * в конец раздела категории с тем же кодом и условием: позиция не важна, замена идёт по коду.
 * Раздел только категории — правится на месте.
 */
type Sec = { key: string; title: string; paragraphs: string[]; ids?: string[]; when?: Array<string | null> };

export function promoteToOwn(own: Sec[] | null | undefined, all: Sec[], sectionKey: string, itemKey: string, text: string): Sec[] {
  const t = String(text ?? '').trim();
  if (!t) throw new BadRequestException('Пустой текст');
  const base = (own ?? []).map((s) => ({ ...s, paragraphs: [...s.paragraphs], ...(s.ids ? { ids: [...s.ids] } : {}), ...(s.when ? { when: [...s.when] } : {}) }));
  const allSec = all.find((s) => s.key === sectionKey);
  const allItems = allSec ? sectionItems(allSec, false) : [];
  const ai = allItems.findIndex((x) => x.id === itemKey);
  let sec = base.find((s) => s.key === sectionKey);
  if (!sec) {
    if (!allSec) throw new BadRequestException('Раздел не найден ни в категории, ни в «Для всех»');
    sec = { key: allSec.key, title: allSec.title, paragraphs: [] };
    base.push(sec);
  }
  const items = sectionItems(sec, false);
  const oi = items.findIndex((x) => x.id === itemKey);
  if (oi >= 0) { sec.paragraphs[oi] = t; return base; } // свой пункт категории (или уже заменённый) — правка на месте
  if (ai < 0) throw new BadRequestException('Неизвестный пункт');
  const positional = !sec.ids && allItems.slice(0, ai + 1).every((x, j) => x.id === `p${j + 1}`);
  if (positional) {
    while (sec.paragraphs.length < ai) sec.paragraphs.push(allSec?.paragraphs[sec.paragraphs.length] ?? '');
    sec.paragraphs[ai] = t;
    return base;
  }
  const withWhen = !!sec.when || !!allItems[ai].when;
  sec.paragraphs.push(t);
  sec.ids = [...items.map((x) => x.id), itemKey];
  if (withWhen) sec.when = [...items.map((x) => x.when), allItems[ai].when];
  return base;
}
