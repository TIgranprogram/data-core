import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { Types } from 'mongoose';
import { normalizePassportDefaults } from './passport-defaults';
import { candidateGroups, modelKey, passportScore, type PassportModel } from './passport-models';
import { clean, type Db, type Doc } from './showcase-common';

/** Изделия из паспортов без дублей (БЗ-8); вызывается из ShowcaseService. */
export class ShowcaseFromPassports {
  constructor(private readonly dbOf: () => Db, private readonly create: (dto: Record<string, unknown>) => Promise<{ id: string }>) {}
  private get db() { return this.dbOf(); }

  /** Модели паспортов без изделия («наименование + артикул», лучший паспорт по полноте) и группы-кандидаты на объединение. */
  async passportGroups() {
    const pp = this.db.collection('productpassports');
    const docs = await pp.find({ deletedAt: null, productId: null }, { projection: { textSnapshot: 0, bom: 0 } }).toArray();
    const by = new Map<string, PassportModel>();
    let noName = 0;
    for (const d of docs) {
      const name = clean(d.name), article = clean(d.article);
      if (!name) { noName++; continue; }
      const k = modelKey(name, article), score = passportScore(d);
      const m = by.get(k);
      if (!m) by.set(k, { key: k, name, article, n: 1, score, bestId: String(d._id) });
      else { m.n++; if (score > m.score) { m.score = score; m.bestId = String(d._id); } }
    }
    const models = [...by.values()];
    const groups = candidateGroups(models);
    const inGroup = new Set(groups.flat().map((m) => m.key));
    const singles = models.filter((m) => !inGroup.has(m.key)).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    return { groups, singles: singles.length, singlesPreview: singles.slice(0, 30).map((m) => ({ name: m.name, article: m.article, n: m.n })), noName,
      linked: await pp.countDocuments({ deletedAt: null, productId: { $ne: null } }) };
  }

  /**
   * Объединить в изделия «Продукции»: группа → одно изделие с данными лучшего паспорта (main) и ссылка productId у всех
   * паспортов группы. Выданные паспорта (номера, текст, PDF) не меняются. rest — изделие на каждую оставшуюся одиночную модель.
   */
  async fromPassports(dto: { groups?: { keys?: string[]; main?: string; name?: string }[]; rest?: boolean }) {
    let created = 0, linked = 0;
    const link = async (keys: string[], productId: Types.ObjectId) => {
      const or = keys.map((k) => { const [name, article] = k.split('\u0000'); return { name, ...(article ? { article } : { article: { $in: [null, ''] } }) }; });
      linked += (await this.db.collection('productpassports').updateMany({ deletedAt: null, productId: null, $or: or }, { $set: { productId } })).modifiedCount;
    };
    const fromBest = async (key: string, name?: string) => {
      const state = await this.passportGroups();
      const m = [...state.groups.flat(), ...(await this.singleModels())].find((x) => x.key === key);
      if (!m) throw new NotFoundException('Модель не найдена — обновите список (её могли уже объединить)');
      const best = await this.db.collection('productpassports').findOne({ _id: new Types.ObjectId(m.bestId) });
      return this.productFromPassport(best as Doc, clean(name) || m.name, m.article);
    };
    for (const g of dto.groups ?? []) {
      const keys = (g.keys ?? []).filter(Boolean);
      if (!keys.length || !g.main || !keys.includes(g.main)) throw new BadRequestException('Выберите паспорта группы и главный вариант');
      const id = await fromBest(g.main, g.name);
      created++;
      await link(keys, id);
    }
    if (dto.rest) {
      for (const m of await this.singleModels()) {
        const best = await this.db.collection('productpassports').findOne({ _id: new Types.ObjectId(m.bestId) });
        await link([m.key], await this.productFromPassport(best as Doc, m.name, m.article));
        created++;
      }
    }
    return { created, linked };
  }

  private async singleModels() {
    const s = await this.passportGroups();
    const inGroup = new Set(s.groups.flat().map((m) => m.key));
    const docs = await this.db.collection('productpassports').find({ deletedAt: null, productId: null, name: { $nin: [null, ''] } }, { projection: { textSnapshot: 0, bom: 0 } }).toArray();
    const by = new Map<string, PassportModel>();
    for (const d of docs) {
      const name = clean(d.name), article = clean(d.article), k = modelKey(name, article), score = passportScore(d);
      if (inGroup.has(k)) continue;
      const m = by.get(k);
      if (!m) by.set(k, { key: k, name, article, n: 1, score, bestId: String(d._id) });
      else { m.n++; if (score > m.score) { m.score = score; m.bestId = String(d._id); } }
    }
    return [...by.values()];
  }

  /** Изделие из паспорта: артикул — из паспорта (занят другим изделием — с суффиксом -2, -3…), без артикула — ПС-<код>; значения паспорта по умолчанию. */
  private async productFromPassport(p: Doc, name: string, article: string): Promise<Types.ObjectId> {
    const base = article || 'ПС-' + createHash('md5').update(name.toLowerCase()).digest('hex').slice(0, 6).toUpperCase();
    let created: { id: string } | null = null;
    const overview = ((p.images as Array<{ kind?: string; photoId?: unknown; order?: number }>) ?? []).filter((i) => (i.kind || 'overview') === 'overview').sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((i) => String(i.photoId));
    const dto = { name, group: p.category ?? '', description: p.description ?? '',
      dimensions: { length: p.length, width: p.width, height: p.height, unit: 'мм' }, weightKg: p.weight ?? null,
      purpose: p.purpose ?? '', installation: p.installationMethod ?? '', ...(overview.length ? { photoIds: overview } : {}) };
    // без артикула в паспорте: группа с номером (categories.groupNo) → автоартикул; нет номера — ПС-<код>
    if (!article) { try { created = await this.create(dto); } catch (e) { if (!(e instanceof BadRequestException)) throw e; } }
    for (let i = 1; i <= 20 && !created; i++) {
      const sku = i === 1 ? base : `${base}-${i}`;
      try { created = await this.create({ ...dto, sku }); }
      catch (e) { if (!(e instanceof ConflictException)) throw e; }
    }
    if (!created) throw new ConflictException(`Не удалось подобрать свободный артикул для «${name}»`);
    const id = new Types.ObjectId(created.id);
    const pick = Object.fromEntries(['passportCategory', 'elements', 'materialIds', 'installationTypeId', 'isKit', 'ageFrom', 'ageTo', 'heightMin', 'heightMax', 'weightMax', 'maxUsers', 'fallHeight', 'siteLength', 'siteWidth', 'warrantyMonths']
      .filter((k) => p[k] !== undefined && p[k] !== null && p[k] !== '').map((k) => [k, p[k]]));
    try {
      const defaults = normalizePassportDefaults(pick);
      if (Object.keys(defaults).length) await this.db.collection('products').updateOne({ _id: id }, { $set: { passportDefaults: defaults, source: 'passports' } });
    } catch { /* неверные значения в старом паспорте — изделие без значений по умолчанию */ }
    return id;
  }
}
