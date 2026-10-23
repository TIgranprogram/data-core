import { PdfImage, PdfOrg, PdfPassport } from './passport-pdf';
import { ComposedSection } from './passport-compose';
import { InstallParts, MaintenanceTable } from './passport-compose-parts';

export interface PdfImageV2 extends PdfImage { refCode?: string }
export interface PdfPassportV2 extends PdfPassport {
  passportCategory?: string;
  ageFrom?: number | null; ageTo?: number | null; heightMin?: number | null; heightMax?: number | null;
  weightMax?: number | null; maxUsers?: number | null; fallHeight?: number | null; serviceLifeYears?: number | null;
  certificate?: { number?: string; until?: string; hasEac?: boolean } | null;
}
/** Снимок текста (V2Text) — терпимо к неполным старым снимкам. */
export interface PdfV2Text {
  sections: ComposedSection[];
  description?: string; purpose?: string; rules?: string[];
  maintenance?: MaintenanceTable[]; install?: Partial<InstallParts>;
}
export interface PdfV2Style { color?: string; categoryName?: string; icons?: string[] }
export interface PdfV2Input {
  passport: PdfPassportV2;
  org: PdfOrg | null;
  text: PdfV2Text;
  images: Partial<Record<string, PdfImageV2[]>>;
  style?: PdfV2Style;
  logo?: Buffer; seal?: Buffer; signature?: Buffer;
  /** Миниатюры дефектов для таблиц ТО: photoId → картинка (Э6d). */
  defectImages?: Record<string, Buffer>;
  withStamp: boolean;
  mode: 'pages' | 'print';
  /** НМ: надпись поперёк каждой страницы — «ЧЕРНОВИК» (без номера) / «АННУЛИРОВАН». */
  watermark?: string;
  /** Чёрно-белый: без цвета категории и заливки шапки обложки — для печати на ч/б принтере (решение пользователя 2026-10-22). */
  mono?: boolean;
}

export const NEUTRAL_COLOR = '#546E7A';
export const MONO_COLOR = '#000';

