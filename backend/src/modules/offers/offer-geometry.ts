import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { PAGE_H, PAGE_W } from './offer-layout';

interface Rect { key: string; x: number; y: number; w: number; h: number; row?: number }
const tenth = (value: number) => Math.round(value * 10) / 10;

/** Прямоугольники выдаются тем же проходом PDFKit. Индекс листа и строки начинается с нуля. */
export class OfferGeometry {
  readonly pages: Rect[][] = [[]];

  add(page: number, key: string, x: number, y: number, w: number, h: number, row?: number) {
    (this.pages[page] ??= []).push({ key, x: tenth(x), y: tenth(y), w: tenth(w), h: tenth(h), ...(row === undefined ? {} : { row }) });
  }

  /** Соседние абзацы одного блока образуют одну область на каждом листе. */
  span(page: number, key: string, x: number, y: number, w: number, h: number) {
    const rect = this.pages[page]?.find((r) => r.key === key);
    if (!rect) { this.add(page, key, x, y, w, h); return; }
    const right = Math.max(rect.x + rect.w, x + w);
    rect.x = tenth(Math.min(rect.x, x));
    rect.w = tenth(right - rect.x);
    rect.h = tenth(Math.max(rect.h, y + h - rect.y));
  }

  header(pageMapBytes: number, requested?: string) {
    const meta = { width: PAGE_W, height: PAGE_H };
    const encode = (obj: object) => gzipSync(JSON.stringify(obj)).toString('base64');
    const revision = () => createHash('sha256').update(JSON.stringify(this.pages)).digest('hex').slice(0, 32);
    if (requested !== undefined) {
      const n = Number(requested);
      if (!/^[1-9]\d*$/.test(requested) || !this.pages[n - 1]) throw new BadRequestException('Такого листа КП нет');
      return encode({ ...meta, revision: revision(), page: n, pages: [this.pages[n - 1]] });
    }
    const full = encode({ ...meta, pages: this.pages });
    return full.length + pageMapBytes <= 2900 ? full : encode({ ...meta, revision: revision(), pages: [], paged: true });
  }
}
