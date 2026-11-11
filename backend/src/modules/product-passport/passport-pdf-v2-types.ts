import { PdfImage, PdfOrg, PdfPassport } from './passport-pdf';
import { ComposedSection } from './passport-compose';
import { InstallParts, MaintenanceTable } from './passport-compose-parts';

export interface PdfImageV2 extends PdfImage { refCode?: string }
export interface PdfPassportV2 extends PdfPassport {
  status?: string;
  seatWidth?: number; seatHeight?: number; supports?: number; shipVolume?: number;
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
  /** Раскладка PDF: 2 — нумерация в один проход, один «Монтаж» (passport-numbering.ts); нет поля — как печаталось раньше. */
  layout?: number;
}
export interface PdfV2Style { color?: string; categoryName?: string; icons?: string[] }
/** Поля набора в пунктах: слева, справа, сверху, снизу. */
export interface PdfBox { l: number; r: number; t: number; b: number }
/**
 * Бланк фирмы (C076). Нет обоих JPEG — печать как раньше, цвет не применяется.
 * Картинка вкладывается в PDF один раз и рисуется на своих страницах.
 */
export interface PdfLook {
  cover?: Buffer | null;
  page?: Buffer | null;
  color?: string | null;
  coverBox?: PdfBox | null;
  pageBox?: PdfBox | null;
}
export interface PdfV2Input {
  passport: PdfPassportV2;
  org: PdfOrg | null;
  text: PdfV2Text;
  images: Partial<Record<string, PdfImageV2[]>>;
  /** Только черновик: подписанные места обязательных рисунков, которых ещё нет или файл не читается. */
  missingImages?: Array<{ kind: string; label: string }>;
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
  /** Бланк и цвет фирмы. Нет — прежний чёрно-белый вид. */
  look?: PdfLook;
}

export const NEUTRAL_COLOR = '#546E7A';
export const MONO_COLOR = '#000';

