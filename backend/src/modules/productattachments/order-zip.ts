import { safeDownloadName } from './attachment-paths';

const GB = 1024 ** 3;
/** Потолок размера одного архива (`ATTACHMENT_ZIP_MAX_BYTES`, по умолчанию 5 ГБ) и число одновременных сборок. */
export function zipMaxBytes(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.ATTACHMENT_ZIP_MAX_BYTES);
  return Number.isFinite(n) && n > 0 ? n : 5 * GB;
}
export const ZIP_MAX_PARALLEL = 2;

/** Ограничитель одновременных сборок: `take()` — занять место (null, если заняты все), вызов результата — освободить (один раз). */
export class ZipSlots {
  private n = 0;
  constructor(private readonly max = ZIP_MAX_PARALLEL) {}
  take(): (() => void) | null {
    if (this.n >= this.max) return null;
    this.n++;
    let done = false;
    return () => { if (!done) { done = true; this.n--; } };
  }
  get busy() { return this.n; }
}

/** Часть пути внутри архива: без разделителей и служебных символов. */
export const zipPart = (s: string, fallback: string) => safeDownloadName(s, fallback).replace(/\s+/g, ' ');

/** Дубли имён в одной папке получают суффикс « (2)», « (3)» перед расширением. Регистр не различается. */
export function uniqueName(name: string, used: Set<string>): string {
  const dot = name.lastIndexOf('.');
  const [base, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  let out = name;
  for (let i = 2; used.has(out.toLowerCase()); i++) out = `${base} (${i})${ext}`;
  used.add(out.toLowerCase());
  return out;
}

export interface ZipItem { productKey: string; productLabel: string; typeName: string; originalName: string; abs: string }

/** Путь внутри архива: `<№ заказа>/<код изделия — название>/<вид>/<файл>`. */
export function zipEntryNames(orderNo: string, items: ZipItem[]): string[] {
  const used = new Map<string, Set<string>>();
  const root = zipPart(orderNo, 'заказ');
  return items.map((it) => {
    const dir = `${root}/${zipPart(it.productLabel, 'изделие')}/${zipPart(it.typeName, 'вид')}`;
    let set = used.get(dir.toLowerCase());
    if (!set) { set = new Set(); used.set(dir.toLowerCase(), set); }
    return `${dir}/${uniqueName(safeDownloadName(it.originalName), set)}`;
  });
}

/** Текст `_ПРОПУЩЕНО.txt` — какие файлы не нашлись на диске. */
export function skippedText(names: string[]): string {
  return ['Эти файлы не вошли в архив: на сервере их нет. Сообщите администратору.', '', ...names].join('\r\n');
}
