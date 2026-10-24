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
    const d = (await this.db.collection('products').findOne({ _id: oid(id, 'изделия') }, { projection: { composition: 1 } })) as Doc | null;
    if (!d) throw new NotFoundException('Изделие не найдено');
    const refs = ((d.composition as Record<string, unknown>[] | undefined) ?? []).filter((l) => l.lineType === 'material' && l.refId).map((l) => l.refId as Types.ObjectId);
    const [stock, recs, sortament] = await Promise.all([
      refs.length ? this.db.collection('materials').find({ _id: { $in: refs } }, { projection: { name: 1, assortment: 1, materialGrade: 1, dimensions: 1 } }).toArray() : [],
      this.db.collection('dict_values').find({ dict: 'passportMaterials', deletedAt: null }).toArray(),
      this.db.collection('dict_values').find({ dict: 'passportSortament', deletedAt: null }, { projection: { name: 1, material: 1 } }).toArray(),
    ]);
    const byId = new Map(stock.map((x) => [String(x._id), x]));
    const lines = refs.map((r) => byId.get(String(r))).filter(Boolean).map((x) => {
      const text = [x!.name, x!.assortment, x!.materialGrade].map(clean).filter(Boolean).join(' ');
      // размер не в названии — из габаритов позиции (диаметр × толщина / толщина)
      const dim = (t: string) => ((x!.dimensions as { type?: string; value?: number }[] | undefined) ?? []).find((z) => z.type === t)?.value;
      const extra = /\d/.test(text) ? '' : dim('diameter') ? ` ∅${dim('diameter')}${dim('thickness') ? '×' + dim('thickness') : ''}` : dim('thickness') ? ` ${dim('thickness')} мм` : '';
      return { name: clean(x!.name), text: text + extra };
    });
    const r = specFromComposition(lines, recs.map((x) => ({ ...(x as MatRec), id: String(x._id) })), sortament as { material?: unknown; name?: unknown }[]);
    const materialsSpec: MaterialsSpec = { rows: r.rows, coatingIds: r.coatingIds };
    return { materialsSpec, materialsText: await this.text(materialsSpec), unmatched: r.unmatched };
  }
}
