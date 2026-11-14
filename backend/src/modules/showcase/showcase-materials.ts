import { NotFoundException } from '@nestjs/common';
import { type Types } from 'mongoose';
import { oid } from '../../common/list-query';
import { specFromComposition, type MaterialsSpec, type MatRec } from '../../common/catalog/materials-text';
import { MaterialsSpecRefs } from '../../common/catalog/materials-table';
import { clean, type Doc } from './showcase-common';

/** Материалы изделия таблицей (Фаза МИ): разбор, проверка и текст — `common/catalog/materials-table.ts`; здесь — «Взять из состава». */
export class ShowcaseMaterials extends MaterialsSpecRefs {
  /** «Взять из состава» (МИ.2): предложение таблицы по материалам «Состава изделия»; ничего не записывает. */
  async fromComposition(id: string) {
    const d = (await this.db.collection('products').findOne({ _id: oid(id, 'изделия') }, { projection: { composition: 1, parts: 1 } })) as Doc | null;
    if (!d) throw new NotFoundException('Изделие не найдено');
    const comp = ((d.composition as Record<string, unknown>[] | undefined) ?? []).filter((l) => l.lineType === 'material' && l.refId);
    const refs = comp.map((l) => l.refId as Types.ObjectId);
    // части изделия (products.parts[].lineId → строка состава): название части — к материалу этой строки
    const partNames = new Map<string, string[]>();
    for (const pt of (d.parts as { lineId?: Types.ObjectId; name?: string }[] | undefined) ?? []) {
      const line = pt.lineId && comp.find((l) => String(l._id) === String(pt.lineId));
      if (!line || !clean(pt.name)) continue;
      const k = String(line.refId); partNames.set(k, [...(partNames.get(k) ?? []), clean(pt.name)]);
    }
    const [stock, recs, sortament, partRecs] = await Promise.all([
      refs.length ? this.db.collection('materials').find({ _id: { $in: refs } }, { projection: { name: 1, assortment: 1, materialGrade: 1, dimensions: 1, 'passportSpec.materialId': 1, 'passportSpec.sizes': 1, 'passportSpec.isCoating': 1, 'passportSpec.passportText': 1, 'passportSpec.techText': 1 } }).toArray() : [],
      this.db.collection('dict_values').find({ dict: 'passportMaterials', deletedAt: null }).toArray(),
      this.db.collection('dict_values').find({ dict: 'passportSortament', deletedAt: null }, { projection: { name: 1, material: 1 } }).toArray(),
      this.db.collection('dict_values').find({ dict: 'passportParts', deletedAt: null }, { projection: { name: 1 } }).toArray(),
    ]);
    const byId = new Map(stock.map((x) => [String(x._id), x]));
    const lines = refs.map((r) => byId.get(String(r))).filter(Boolean).map((x) => {
      const text = [x!.name, x!.assortment, x!.materialGrade].map(clean).filter(Boolean).join(' ');
      // размер не в названии — из габаритов позиции (диаметр × толщина / толщина)
      const dim = (t: string) => ((x!.dimensions as { type?: string; value?: number }[] | undefined) ?? []).find((z) => z.type === t)?.value;
      const extra = /\d/.test(text) ? '' : dim('diameter') ? ` ∅${dim('diameter')}${dim('thickness') ? '×' + dim('thickness') : ''}` : dim('thickness') ? ` ${dim('thickness')} мм` : '';
      const ps = x!.passportSpec as { materialId?: Types.ObjectId; sizes?: string[]; isCoating?: boolean; passportText?: string; techText?: string } | undefined;
      const link = ps?.materialId ? { materialId: String(ps.materialId), sizes: ps.sizes ?? [], isCoating: !!ps.isCoating, passportText: ps.passportText, techText: ps.techText } : null;
      return { name: clean(x!.name), text: text + extra, link, partNames: partNames.get(String(x!._id)) };
    });
    const r = specFromComposition(lines, recs.map((x) => ({ ...(x as MatRec), id: String(x._id) })), sortament as { material?: unknown; name?: unknown }[], partRecs.map((x) => ({ name: x.name, id: String(x._id) })));
    const materialsSpec: MaterialsSpec = { rows: r.rows, coatingIds: r.coatingIds, ...(r.coatingTexts ? { coatingTexts: r.coatingTexts } : {}) };
    return { materialsSpec, materialsText: await this.text(materialsSpec), unmatched: r.unmatched, hinted: r.hinted };
  }
}
