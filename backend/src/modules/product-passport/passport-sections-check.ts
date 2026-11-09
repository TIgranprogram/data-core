import { BadRequestException } from '@nestjs/common';
import { sectionItems } from './passport-compose';
import { whenProblem } from '../../common/passport/traits';

/** Раздел шаблона как приходит в запросе / хранится в passporttemplates. */
export interface SectionLike { key?: string; title?: string; paragraphs: string[]; ids?: string[]; when?: Array<string | null> }

/**
 * Проверка разделов при сохранении (C054): длины ids / when совпадают с paragraphs, коды пунктов не повторяются,
 * в when — только известные признаки. Ошибка — 400 с русским текстом (раздел и номер пункта).
 */
export function checkSections(sections: SectionLike[]): void {
  for (const s of sections) {
    let items;
    try { items = sectionItems({ key: s.key, paragraphs: s.paragraphs, ids: s.ids, when: s.when }); } catch (e) { throw new BadRequestException((e as Error).message); }
    items.forEach((it, i) => {
      const problem = whenProblem(it.when);
      if (problem) throw new BadRequestException(`Раздел ${s.key ?? ''}, пункт ${i + 1}: ${problem}`);
    });
  }
}

/**
 * Разделы из редактора текстов → то, что пишется в версию: пустые пункты убираются вместе со своими ids / when.
 * Редактор может не присылать ids / when (старый экран): если число пунктов раздела не изменилось, они берутся
 * из сохранённой версии `stored` — правка текста не стирает коды и условия.
 */
export function cleanSections(input: SectionLike[], stored: SectionLike[] = []): SectionLike[] {
  checkSections(input.map((s) => ({ ...s, paragraphs: Array.isArray(s?.paragraphs) ? s.paragraphs : [] })));
  return input.map((s) => {
    const paras = Array.isArray(s?.paragraphs) ? s.paragraphs.map((p) => String(p ?? '').trim()) : [];
    let ids = Array.isArray(s.ids) ? s.ids : undefined;
    let when = Array.isArray(s.when) ? s.when : undefined;
    if (!ids && !when) {
      const old = stored.find((x) => x.key === s.key);
      if (old && old.paragraphs.length === paras.length) { ids = old.ids; when = old.when; }
    }
    const keep = paras.map((p) => p !== '');
    const pick = <T,>(a: T[] | undefined) => a?.filter((_, i) => keep[i]);
    const outWhen = pick(when);
    return {
      key: String(s.key || ''), title: String(s.title ?? ''), paragraphs: paras.filter((_, i) => keep[i]),
      ...(ids ? { ids: pick(ids) } : {}),
      ...(outWhen?.some((w) => String(w ?? '').trim()) ? { when: outWhen } : {}),
    } as SectionLike;
  });
}
