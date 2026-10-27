/** Спецификация позиции ЗНП, разобранная из первого сообщения YouGile (v3 карточки). Поле не распознано — пустая строка. */
export interface ZnpSpec { qty: string; unit: string; size: string; mount: string; cover: string; ral: string; extra: string; raw: string }

const NUM = /^\d+([.,]\d+)?$/;
const UNIT = /^(шт|компл|м|м2|м²|п\.?\s?м|м\.п\.?)\.?$/i;
const DIM = /^[\d?.,]+\s*[xх×*]\s*[\d?.,]+(\s*[xх×*]\s*[\d?.,]+)?\s*(мм|м)?$/i;
const MOUNT = /анкер|бетон|закладн|болт|съ[её]мн|без крепл|сварк|на (грунт|землю|плит)/i;
const COVER = /^(нет|да|есть|не требуется)(?![а-яё\w]).{0,60}$/i;
const RAL = /^(RAL\s*\d{4}|\d{4}|согласовать)(?![а-яё\w]).{0,40}$/i;
const SKIP = /^\[фото\]$|^https?:\/\//i;

/**
 * Разбор строки ЗНП: «№ / арт / (пусто) / наименование / кол-во / ед. / габариты / крепление / покрытие / RAL / доп…».
 * Поля идут по порядку; не совпало с шаблоном — поле пустое, строка не теряется (идёт в следующее поле или в `extra`).
 * Распознано меньше 3 полей — null.
 */
export function parseZnpLine(text: string | null | undefined): ZnpSpec | null {
  const lines = String(text ?? '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !SKIP.test(l));
  if (lines.length < 4) return null;
  let i = 0;
  if (/^\d+[.)]?$/.test(lines[i])) i++; // № поз.
  if (/^[\w-]{2,12}$/.test(lines[i] ?? '') && /\d/.test(lines[i])) i++; // артикул
  i++; // наименование
  const take = (re: RegExp) => (i < lines.length && re.test(lines[i]) ? lines[i++] : '');
  const qty = take(NUM), unit = take(UNIT), size = take(DIM), mount = take(MOUNT), cover = take(COVER), ral = take(RAL);
  const found = [qty, unit, size, mount, cover, ral].filter(Boolean).length;
  if (found < 3) return null;
  return { qty: qty.replace(',', '.'), unit, size, mount, cover, ral, extra: lines.slice(i).join('\n'), raw: lines.join('\n') };
}
