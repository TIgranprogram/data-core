import { inflateRawSync } from 'zlib';

/**
 * Чтение выгрузки Google-таблицы в .xlsx без зависимостей (TASKS ПС.3): значения листов и картинки, вставленные
 * в ячейки (в xlsx они лежат как рисунки, привязанные к ячейке: xl/drawings → xl/media). Sheets API values
 * эти картинки не отдаёт (проверено 2026-10-21: Данные!E — пусто), поэтому источник — выгрузка.
 */

export function unzip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('не zip/xlsx');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20), nameLen = buf.readUInt16LE(p + 28);
    const extra = buf.readUInt16LE(p + 30), comment = buf.readUInt16LE(p + 32), local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    out.set(name, method === 8 ? inflateRawSync(data) : Buffer.from(data));
    p += 46 + nameLen + extra + comment;
  }
  return out;
}

const ENT: Record<string, string> = { quot: '"', amp: '&', lt: '<', gt: '>', apos: "'" };
export const xmlText = (s: string) => s.replace(/&(quot|amp|lt|gt|apos|#\d+|#x[\da-f]+);/gi, (_, e: string) =>
  e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e.toLowerCase()]);

const colIndex = (letters: string) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

export interface SheetData {
  name: string;
  /** rows[rowNumber 1-based][colIndex 0-based] = значение (строка; числа — как в файле) */
  rows: Map<number, Map<number, string>>;
  /** картинки, привязанные к ячейке: row — 1-based, col — 0-based */
  images: Array<{ row: number; col: number; media: string }>;
}

export function readXlsx(buf: Buffer): { sheets: Map<string, SheetData>; media: Map<string, Buffer> } {
  const files = unzip(buf);
  const text = (n: string) => files.get(n)?.toString('utf8') ?? '';
  const shared = [...text('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => xmlText([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
  const rels = (n: string) => new Map([...text(n).matchAll(/<Relationship [^>]*Id="(\w+)"[^>]*Target="([^"]+)"/g)].map((m) => [m[1], m[2]]));
  const wbRels = rels('xl/_rels/workbook.xml.rels');
  const sheets = new Map<string, SheetData>();
  for (const m of text('xl/workbook.xml').matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="(\w+)"/g)) {
    const name = xmlText(m[1]);
    const target = (wbRels.get(m[2]) || '').replace(/^\/?xl\//, '');
    const path = `xl/${target}`;
    const rows = new Map<number, Map<number, string>>();
    for (const r of text(path).matchAll(/<row [^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = new Map<number, string>();
      for (const c of r[2].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = /r="([A-Z]+)\d+"/.exec(c[1]);
        const t = /t="(\w+)"/.exec(c[1])?.[1];
        const inner = c[2] || '';
        let v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? '';
        if (t === 's' && v) v = shared[Number(v)] ?? '';
        else if (t === 'inlineStr') v = xmlText([...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(''));
        else v = xmlText(v);
        if (ref && v !== '') cells.set(colIndex(ref[1]), v);
      }
      if (cells.size) rows.set(Number(r[1]), cells);
    }
    const images: SheetData['images'] = [];
    const sRels = rels(path.replace(/worksheets\//, 'worksheets/_rels/') + '.rels');
    for (const d of sRels.values()) {
      if (!/drawings\/drawing\d+\.xml$/.test(d)) continue;
      const dPath = `xl/${d.replace(/^\.\.\//, '')}`;
      const dRels = rels(dPath.replace(/drawings\//, 'drawings/_rels/') + '.rels');
      for (const a of text(dPath).matchAll(/<xdr:from><xdr:col>(\d+)<\/xdr:col>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>[\s\S]*?r:embed="(\w+)"/g)) {
        const media = `xl/${(dRels.get(a[3]) || '').replace(/^\.\.\//, '')}`;
        images.push({ row: Number(a[2]) + 1, col: Number(a[1]), media });
      }
    }
    sheets.set(name, { name, rows, images });
  }
  const media = new Map([...files].filter(([n]) => n.startsWith('xl/media/')));
  return { sheets, media };
}

/** Серийная дата Excel/Sheets (45884) → UTC-полночь. */
export const serialDate = (n: number) => new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000);
