import { NotFoundException } from '@nestjs/common';
import { type Types } from 'mongoose';
import { oid } from '../../common/list-query';
import { expandComposition, type GraphDb } from '../../common/catalog/composition-expand';
import { specFromComposition, type MaterialsSpec, type MatRec } from '../../common/catalog/materials-text';
import { MaterialsSpecRefs, parseMaterialsSpec } from '../../common/catalog/materials-table';
import { clean, type Doc } from './showcase-common';

/** Материалы изделия таблицей (Фаза МИ): разбор, проверка и текст — `common/catalog/materials-table.ts`; здесь — «Взять из состава». */
export class ShowcaseMaterials extends MaterialsSpecRefs {
  /** «Взять из состава» (МИ.2): цепочка изделие → модуль → деталь → сырьё. Вложенное изделие не раскрываем. Ничего не записывает. */
  async fromComposition(id: string) {
    const d = (await this.db.collection('products').findOne({ _id: oid(id, 'изделия') }, { projection: { composition: 1, parts: 1, productModuleIds: 1 } })) as Doc | null;
    if (!d) throw new NotFoundException('Изделие не найдено');
    const graph = await expandComposition(this.db as unknown as GraphDb, { composition: d.composition, productModuleIds: d.productModuleIds });
    const comp = ((d.composition as Record<string, unknown>[] | undefined) ?? []).filter((l) => l.lineType === 'material' && l.refId);
    // части изделия (products.parts[].lineId → строка состава) и имя детали, внутри которой лежит сырьё
    const partNames = new Map<string, string[]>();
    const pushName = (id: string, name: string) => {
      const list = partNames.get(id) ?? [];
      if (!list.includes(name)) list.push(name);
      partNames.set(id, list);
    };
    for (const ref of graph.stock) for (const name of ref.partNames) pushName(ref.id, name);
    for (const pt of (d.parts as { lineId?: Types.ObjectId; name?: string }[] | undefined) ?? []) {
      const line = pt.lineId && comp.find((l) => String(l._id) === String(pt.lineId));
      if (!line || !clean(pt.name)) continue;
      pushName(String(line.refId), clean(pt.name));
    }
    const [recs, sortament, partRecs] = await Promise.all([
      this.db.collection('dict_values').find({ dict: 'passportMaterials', deletedAt: null }).toArray(),
      this.db.collection('dict_values').find({ dict: 'passportSortament', deletedAt: null }, { projection: { name: 1, material: 1 } }).toArray(),
      this.db.collection('dict_values').find({ dict: 'passportParts', deletedAt: null }, { projection: { name: 1 } }).toArray(),
    ]);
    const byId = graph.materials;
    const lines = graph.stock.map((r) => byId.get(r.id)).filter(Boolean).map((x) => {
      const text = [x!.name, x!.assortment, x!.materialGrade].map(clean).filter(Boolean).join(' ');
      // размер не в названии — из габаритов позиции (диаметр × толщина / толщина)
      const dim = (t: string) => ((x!.dimensions as { type?: string; value?: number }[] | undefined) ?? []).find((z) => z.type === t)?.value;
      const extra = /\d/.test(text) ? '' : dim('diameter') ? ` ∅${dim('diameter')}${dim('thickness') ? '×' + dim('thickness') : ''}` : dim('thickness') ? ` ${dim('thickness')} мм` : '';
      const ps = x!.passportSpec as { materialId?: Types.ObjectId; sizes?: string[]; isCoating?: boolean; passportText?: string; techText?: string } | undefined;
      const link = ps?.materialId ? { materialId: String(ps.materialId), sizes: ps.sizes ?? [], isCoating: !!ps.isCoating, passportText: ps.passportText, techText: ps.techText } : null;
      return { name: clean(x!.name), text: text + extra, link, partNames: partNames.get(String(x!._id)), sourceRefs: graph.stock.find((r) => r.id === String(x!._id))?.sourceRefs };
    });
    const r = specFromComposition(lines, recs.map((x) => ({ ...(x as MatRec), id: String(x._id) })), sortament as { material?: unknown; name?: unknown }[], partRecs.map((x) => ({ name: x.name, id: String(x._id) })));
    const materialsSpec: MaterialsSpec = { rows: r.rows, coatingIds: r.coatingIds, ...(r.coatingTexts ? { coatingTexts: r.coatingTexts } : {}) };
    // Не отдаём успешное предложение, которое затем нельзя сохранить из-за границ размеров, частей или источников.
    parseMaterialsSpec(materialsSpec);
    return { materialsSpec, materialsText: await this.text(materialsSpec), unmatched: r.unmatched, hinted: r.hinted, unmatchedSources: r.unmatchedSources, hintedSources: r.hintedSources };
  }
}
