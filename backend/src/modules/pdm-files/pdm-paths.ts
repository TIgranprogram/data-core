import { BadRequestException } from '@nestjs/common';
import { resolve, sep } from 'path';
import { drawingSignatureOk, DRAWING_UPLOAD_MAX_BYTES } from '../photos/image-upload.options';
import type { PdmDocKind } from './pdm-file.schema';

/** Обозначение и имя файла — строгий набор символов (защита от `../`, слэшей и служебных имён). */
const SAFE_NAME_RE = /^[A-Za-zА-Яа-яЁё0-9._-]+$/;
export const PDM_MAX_BYTES = DRAWING_UPLOAD_MAX_BYTES;

/** Допустимое расширение вида документа: чертежи — PDF, развёртка — DXF. */
export const PDM_EXT: Record<PdmDocKind, '.pdf' | '.dxf'> = { pdf: '.pdf', assembly: '.pdf', install: '.pdf', dxf: '.dxf' };

/** Строка для пути или 400: только буквы, цифры, `.`, `_`, `-`; не начинается с точки, без `..`. */
export function safeSegment(value: unknown, what: string): string {
  const s = String(value ?? '');
  if (!s || s.length > 128 || !SAFE_NAME_RE.test(s) || s.startsWith('.') || s.includes('..')) throw new BadRequestException(`Недопустимое ${what}: «${s.slice(0, 40)}». Разрешены буквы, цифры, точка, дефис и подчёркивание.`);
  return s;
}

/** Относительный путь `pdm/<обозначение>/v<версия>/<имя>` (после проверки частей). */
export function pdmRel(designation: unknown, version: number, name: unknown): string {
  if (!Number.isInteger(version) || version < 0) throw new BadRequestException('Версия файла должна быть целым числом');
  return `pdm/${safeSegment(designation, 'обозначение')}/v${version}/${safeSegment(name, 'имя файла')}`;
}

/** Абсолютный путь внутри папки загрузок; выход за её пределы — 400. */
export function pdmAbs(root: string, rel: string): string {
  const base = resolve(root), abs = resolve(base, rel);
  if (!abs.startsWith(base + sep)) throw new BadRequestException('Недопустимый путь файла');
  return abs;
}

/** Ссылка для скачивания: `/uploads/pdm/...` (кириллица кодируется). */
export const pdmUrl = (rel: string): string => `/uploads/${rel.split('/').map(encodeURIComponent).join('/')}`;

/** Проверка содержимого: расширение вида, размер, сигнатура PDF/DXF. Текст ошибки — для пользователя. */
export function assertPdmContent(docKind: PdmDocKind, name: string, buf: Buffer): void {
  const ext = PDM_EXT[docKind];
  if (!name.toLowerCase().endsWith(ext)) throw new BadRequestException(`Для вида «${docKind}» нужен файл ${ext}`);
  if (!buf.length) throw new BadRequestException('Файл пустой');
  if (buf.length > PDM_MAX_BYTES) throw new BadRequestException('Файл больше 50 МБ');
  if (!drawingSignatureOk(ext, buf.subarray(0, 512))) throw new BadRequestException(`Содержимое не похоже на ${ext.slice(1).toUpperCase()}`);
}
