/**
 * ВЛ-1: какие файлы можно приложить к изделию. Чистые функции без обращения к диску и базе:
 * белый список расширений (решение пользователя 2026-11-05) и проверка содержимого по первым байтам.
 */

/** Сколько байт начала файла читаем для проверки сигнатуры. */
export const HEAD_BYTES = 1024;
/** Размер файла по умолчанию — 0,5 ГБ; меняется переменной `ATTACHMENT_MAX_BYTES`. */
export const DEFAULT_MAX_BYTES = 512 * 1024 * 1024;

export function attachmentMaxBytes(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.ATTACHMENT_MAX_BYTES);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_MAX_BYTES;
}

const b = (...bytes: number[]) => Buffer.from(bytes);
const ascii = (t: string) => Buffer.from(t, 'latin1');

/** Заголовки исполняемых файлов и страниц: запрещены в любом расширении. */
const FORBIDDEN_HEADS: Buffer[] = [ascii('MZ'), b(0x7f, 0x45, 0x4c, 0x46), ascii('#!'), b(0xca, 0xfe, 0xba, 0xbe), ascii('<?php')];
const FORBIDDEN_TEXT = /^\s*<(script|html|!doctype html|\?php)/i;

const startsWith = (head: Buffer, sig: Buffer, at = 0) => head.length >= at + sig.length && head.subarray(at, at + sig.length).equals(sig);
const anyStart = (head: Buffer, ...sigs: Buffer[]) => sigs.some((s) => startsWith(head, s));

/** Текст: без нулевых байт (или с отметкой UTF-16). */
function isText(head: Buffer): boolean {
  if (head.length >= 2 && ((head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff))) return true;
  return !head.includes(0);
}

type Check = (head: Buffer, size: number) => boolean;

const OLE = b(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1);
const ZIP = [b(0x50, 0x4b, 0x03, 0x04), b(0x50, 0x4b, 0x05, 0x06)];
const magic = (...sigs: Buffer[]): Check => (h) => anyStart(h, ...sigs);
const text: Check = (h) => isText(h);
/** Формат без надёжной сигнатуры: допускаем всё, кроме исполняемых заголовков (они отсеиваются для всех). */
const open: Check = () => true;

const stl: Check = (h, size) => {
  if (startsWith(h, ascii('solid'))) return true;
  if (h.length < 84) return false;
  return size === 84 + 50 * h.readUInt32LE(80);
};

const CHECKS: Record<string, Check> = {
  pdf: (h) => h.subarray(0, HEAD_BYTES).includes(ascii('%PDF')),
  doc: magic(OLE), xls: magic(OLE), ppt: magic(OLE),
  docx: magic(...ZIP), xlsx: magic(...ZIP), pptx: magic(...ZIP), odt: magic(...ZIP), ods: magic(...ZIP),
  txt: text, csv: text, obj: text, svg: text,
  dwg: magic(ascii('AC10')),
  dxf: (h) => /^\s*0\s*\r?\n\s*SECTION/.test(h.toString('latin1')) || startsWith(h, ascii('AutoCAD Binary DXF')),
  cdr: (h) => (startsWith(h, ascii('RIFF')) && startsWith(h, ascii('CDR'), 8)) || anyStart(h, ...ZIP), // с версии X5 — ZIP
  ai: (h) => h.subarray(0, HEAD_BYTES).includes(ascii('%PDF')) || startsWith(h, ascii('%!PS')),
  png: magic(b(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)),
  jpg: magic(b(0xff, 0xd8, 0xff)), jpeg: magic(b(0xff, 0xd8, 0xff)),
  tif: magic(b(0x49, 0x49, 0x2a, 0x00), b(0x4d, 0x4d, 0x00, 0x2a)), tiff: magic(b(0x49, 0x49, 0x2a, 0x00), b(0x4d, 0x4d, 0x00, 0x2a)),
  bmp: magic(ascii('BM')),
  webp: (h) => startsWith(h, ascii('RIFF')) && startsWith(h, ascii('WEBP'), 8),
  step: (h) => /^\s*ISO-10303-21/.test(h.toString('latin1')), stp: (h) => /^\s*ISO-10303-21/.test(h.toString('latin1')),
  iges: (h) => isText(h) && h.length > 72 && h[72] === 0x53, igs: (h) => isText(h) && h.length > 72 && h[72] === 0x53, // 73-й символ первой строки — «S»
  stl,
  ipt: magic(OLE), iam: magic(OLE),
  sldprt: open, // старые — OLE, новые — нет: только запрет исполняемых заголовков (уточнить на образцах)
  sldasm: open,
  '3dm': magic(ascii('3D Geometry File Format')),
  f3d: magic(...ZIP),
  skp: magic(b(0xff, 0xfe, 0xff, 0x0e)),
  '3ds': magic(b(0x4d, 0x4d)),
  fbx: (h) => startsWith(h, ascii('Kaydara FBX Binary')) || (isText(h) && /FBX/.test(h.toString('latin1', 0, 256))),
  zip: magic(...ZIP),
  rar: magic(ascii('Rar!\x1a\x07')),
  '7z': magic(b(0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c)),
};

/** Разрешённые расширения (без точки, нижний регистр). */
export const ATTACHMENT_EXTS: readonly string[] = Object.keys(CHECKS);

/** Расширение по имени от клиента: последнее, нижний регистр, без точки. `a.pdf.exe` → `exe`. */
export function extOf(name: unknown): string {
  const m = /\.([A-Za-z0-9]{1,8})\s*$/.exec(String(name ?? ''));
  return m ? m[1].toLowerCase() : '';
}

export const isAllowedExt = (ext: string): boolean => Object.prototype.hasOwnProperty.call(CHECKS, ext);

/** Не исполняемый ли заголовок (EXE, ELF, скрипт, страница). */
export function looksExecutable(head: Buffer): boolean {
  if (FORBIDDEN_HEADS.some((s) => startsWith(head, s))) return true;
  return FORBIDDEN_TEXT.test(head.subarray(0, 64).toString('latin1'));
}

/** Содержимое соответствует расширению. `size` — размер всего файла (нужен для бинарного STL). */
export function signatureOk(ext: string, head: Buffer, size: number): boolean {
  if (!isAllowedExt(ext)) return false;
  if (looksExecutable(head)) return false;
  return CHECKS[ext](head, size);
}

/** Текст ошибки для пользователя. */
export const MSG_EXT = 'Этот формат файла нельзя прикладывать. Разрешены документы, чертежи, картинки, 3D-модели и архивы.';
export const MSG_SIGNATURE = 'Содержимое файла не соответствует его формату. Файл не принят.';
