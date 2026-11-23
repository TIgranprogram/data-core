import { buildForest, toNode } from '../../common/passport/phrase-tree';
import { Types, type ClientSession } from 'mongoose';
import { PassportImportDto } from './dto/passport-import.dto';
import { PassportImportService } from './passport-import.service';
import { ProductPassportService } from './product-passport.service';
import * as binding from './passport-bind';
import * as productSource from './passport-from-product';
import type { Doc } from './passport-consts';

const id = () => new Types.ObjectId();

describe('C241 — выбор и exact-ID применимость одной отправки Inventor', () => {
  function fixture() {
    const anchor = id(), concrete = id(), otherAnchor = id(), free = id(), productId = id();
    const installs = [
      { _id: anchor, name: 'Анкеры', code: 'ANCHORS' }, { _id: concrete, name: 'Бетон', code: 'CONCRETE_POSTS' },
      { _id: otherAnchor, name: 'Другие анкеры', code: 'ANCHORS' }, { _id: free, name: 'Свободно', code: 'FREESTANDING' },
    ];
    const state = { product: { _id: productId, passportDefaults: { installationTypeId: concrete, foundationDepth: 600 } } as Doc,
      links: [] as Doc[], passports: [] as Doc[], incomes: [] as Doc[], orders: [] as Doc[], installs, category: 'TRN', token: 'context' };
    const writes: Array<{ collection: string; filter?: Doc; update?: Doc; document?: Doc }> = [];
    const session = { withTransaction: jest.fn(async (work: () => Promise<void>) => work()), endSession: jest.fn() };
    const db = { collection: (collection: string) => ({
      updateOne: jest.fn(async (filter: Doc, update: Doc, options: { session: ClientSession }) => {
        expect(options.session).toBe(session); writes.push({ collection, filter, update }); return { matchedCount: 1 };
      }),
      updateMany: jest.fn(async (filter: Doc, update: Doc, options: { session: ClientSession }) => {
        expect(options.session).toBe(session); writes.push({ collection, filter, update }); return { matchedCount: 1 };
      }),
      insertOne: jest.fn(async (document: Doc, options: { session: ClientSession }) => {
        expect(options.session).toBe(session); writes.push({ collection, document }); return { insertedId: id() };
      }),
    }) };
    const prepare = jest.fn(async (_passport: Doc, patch: Doc, seen: ClientSession) => { expect(seen).toBe(session); return patch; });
    const service = Object.assign(Object.create(PassportImportService.prototype), {
      connection: { db, startSession: async () => session }, passports: { prepareImportedPassport: prepare },
      state: async () => state, file: jest.fn(async (photoId: unknown) => 'sha-' + String(photoId)),
    }) as PassportImportService;
    const dto: PassportImportDto = { contextToken: 'context', images: ['overview', 'dimensions', 'foundation'].map(kind => ({ kind, photoId: String(id()) })), confirmed: {} };
    const passport = (installationTypeId?: Types.ObjectId, status = 'issued') => ({
      _id: id(), productId, installationTypeId, status, passportNumber: 'C241-' + String(id()), revision: 1,
      weight: 10, foundationDepth: 600, manualText: ['purpose'], images: [{ kind: 'overview', photoId: id() }],
      textSnapshot: { purpose: 'Свой текст' }, printSnapshot: { revision: 1 },
    });
    return { service, state, writes, session, prepare, dto, passport, anchor, concrete, otherAnchor, free, productId };
  }
  it('явный выбор синхронизирует только существующий root/default в той же транзакции и не пишет Г для анкеров', async () => {
    const f = fixture();
    f.state.product.installationTypeId = f.concrete;
    f.state.links = [{ kind: 'foundation', photoId: id() }];
    f.dto.confirmed = { installationTypeId: String(f.anchor).toUpperCase(), foundationDepth: 800 };
    const result = await f.service.apply(String(f.productId), f.dto);
    expect(result).toMatchObject({ status: 'applied', confirmedFields: ['passportDefaults.installationTypeId'] });
    expect(result.updatedKinds).toEqual(['overview', 'dimensions', 'mounting', 'foundation']);
    expect(result.warnings.join(' ')).toContain('Глубина Г не применяется');
    const update = f.writes.find(write => write.collection === 'products')!.update!;
    expect(update.$set).toMatchObject({ installationTypeId: f.anchor, 'passportDefaults.installationTypeId': f.anchor });
    expect(update.$set).not.toHaveProperty('passportDefaults.foundationDepth');
    expect(f.session.withTransaction).toHaveBeenCalledTimes(1);
  });
  it('не создаёт legacy root, если его не было; при смене на бетон убирает только прежний импортный mounting', async () => {
    const f = fixture();
    f.state.product.passportDefaults = { installationTypeId: f.anchor };
    f.state.links = [{ kind: 'mounting', photoId: id() }];
    f.dto.confirmed = { installationTypeId: String(f.concrete), foundationDepth: 900 };
    const result = await f.service.apply(String(f.productId), f.dto);
    expect(result.updatedKinds).toEqual(['overview', 'dimensions', 'foundation', 'mounting']);
    const update = f.writes.find(write => write.collection === 'products')!.update!;
    expect(update.$set).not.toHaveProperty('installationTypeId');
    expect(update.$set).toMatchObject({ 'passportDefaults.installationTypeId': f.concrete, 'passportDefaults.foundationDepth': 900 });
  });
  it('другой ID того же kind, другой kind и неизвестные/отсутствующие ID пропускаются целиком', async () => {
    const f = fixture();
    const exact = f.passport(f.anchor), mismatch = f.passport(f.otherAnchor), oldDefault = f.passport(f.concrete), missing = f.passport(), unknown = f.passport(id());
    f.state.passports = [exact, mismatch, oldDefault, missing, unknown];
    const before = JSON.stringify(f.state.passports);
    f.dto.confirmed = { installationTypeId: String(f.anchor), weightKg: 20 };
    const result = await f.service.apply(String(f.productId), f.dto);
    expect(result.issued).toHaveLength(1);
    expect(result.issued[0]).toMatchObject({ id: String(exact._id), fromRevision: 1, toRevision: 2, number: exact.passportNumber });
    expect(result.skipped).toEqual([
      { id: String(mismatch._id), reason: 'installation_mismatch' }, { id: String(oldDefault._id), reason: 'installation_mismatch' },
      { id: String(missing._id), reason: 'installation_unknown' }, { id: String(unknown._id), reason: 'installation_unknown' },
    ]);
    expect(f.prepare).toHaveBeenCalledTimes(1);
    expect(f.writes.filter(write => write.collection === 'productpassports')).toHaveLength(1);
    expect(JSON.stringify(f.state.passports)).toBe(before);
  });
  it('старый клиент без выбора не переносит default на свой паспорт другого способа', async () => {
    const f = fixture();
    const mismatch = f.passport(f.anchor);
    f.state.passports = [mismatch];
    const result = await f.service.apply(String(f.productId), f.dto);
    expect(result.skipped).toContainEqual({ id: String(mismatch._id), reason: 'installation_mismatch' });
    expect(f.prepare).not.toHaveBeenCalled();
    expect(f.writes.find(write => write.collection === 'products')!.update!.$set).not.toHaveProperty('passportDefaults.installationTypeId');
  });
  it('неизвестный/удалённый/неприменимый способ отклоняется до работы с файлами и записей', async () => {
    for (const mode of ['unknown', 'deleted', 'category']) {
      const f = fixture();
      if (mode === 'deleted') Object.assign(f.state.installs[0], { deletedAt: new Date() });
      if (mode === 'category') Object.assign(f.state.installs[0], { categories: 'DIO' });
      f.dto.confirmed.installationTypeId = String(mode === 'unknown' ? id() : f.anchor);
      await expect(f.service.apply(String(f.productId), f.dto)).rejects.toThrow('Перечитайте контекст');
      expect(f.writes).toEqual([]);
      expect(f.service['file']).not.toHaveBeenCalled();
    }
  });
  it('новый выбор с прежними PNG является изменением; stale context запрещает любые записи', async () => {
    const f = fixture();
    f.dto.contextToken = 'stale';
    f.dto.confirmed.installationTypeId = String(f.anchor);
    await expect(f.service.apply(String(f.productId), f.dto)).rejects.toThrow('Перечитайте контекст');
    expect(f.writes).toEqual([]);
  });
});

describe('C241 — существующий снимок не наследует чужую установку при чтении', () => {
  afterEach(() => jest.restoreAllMocks());
  function fixture(ownId?: Types.ObjectId, ownCode = 'CONCRETE_POSTS', passportCategory: string | undefined = 'TRN') {
    const productId = id(), productInstall = id(), ownImage = id();
    const own: Doc = { _id: id(), productId, status: 'draft', passportCategory, installationTypeId: ownId,
      foundationDepth: 600, installationMethod: 'Своя установка', textSnapshot: { purpose: 'Своё назначение', sections: [] },
      images: [{ kind: 'foundation', photoId: ownImage }], manualText: ['purpose'], revision: 1 };
    const product = { _id: productId, passportDefaults: { installationTypeId: productInstall }, weightKg: 50 };
    const patch = jest.spyOn(productSource, 'productPatch').mockResolvedValue({ weight: 50, installationTypeId: productInstall });
    const rows = jest.fn(async () => [{ kind: 'mounting', photoId: id() }]);
    const doc = { toObject: () => own, set: jest.fn() };
    const save = jest.fn();
    const evaluate = jest.fn();
    jest.spyOn(binding, 'bindPresentation').mockResolvedValue({});
    const service = Object.assign(Object.create(ProductPassportService.prototype), {
      connection: { collection: (name: string) => name === 'products'
        ? { findOne: async () => product }
        : { find: () => ({ toArray: async () => [{ _id: ownImage, storageUrl: '/uploads/old.png' }] }) } },
      model: { findById: () => ({ exec: async () => doc }) },
      installs: async () => new Map(ownId ? [[String(ownId), { code: ownCode }]] : []),
      forest: async () => [], productCtx: async () => undefined, productImageRows: rows, revisionList: async () => [], evaluatePresentation: evaluate, saveCurrent: save,
    }) as ProductPassportService;
    return { service, own, product, patch, rows, save, evaluate };
  }
  it.each(['CONCRETE_POSTS', 'ANCHORS'])('чужой материализованный ID (%s) сохраняет snapshot/картинки и не вызывает rebuild на двух чтениях', async code => {
    const f = fixture(id(), code);
    const before = JSON.stringify(f.own);
    for (let repeat = 0; repeat < 2; repeat++) {
      expect(await f.service['syncDraft'](String(f.own._id), { strict: true, build: false })).toBe(false);
      expect(await f.service.effectiveImages(f.own)).toEqual(f.own.images);
      const response = await f.service['getPresentation']({ ...f.own, presentationVersion: 1 });
      expect(response).toHaveProperty('textSnapshot', f.own.textSnapshot);
      expect(response).toHaveProperty('installationTypeId', f.own.installationTypeId);
      expect(response).not.toHaveProperty('readiness.missing');
    }
    expect(f.patch).not.toHaveBeenCalled(); expect(f.rows).not.toHaveBeenCalled(); expect(f.save).not.toHaveBeenCalled(); expect(f.evaluate).not.toHaveBeenCalled();
    expect(JSON.stringify(f.own)).toBe(before);
  });
  it.each([false, true])('отсутствующий/неизвестный ID existing=%s не получает default, запись или новую схему', async unknown => {
    const f = fixture(unknown ? id() : undefined, 'FUTURE');
    const before = JSON.stringify(f.own);
    for (let repeat = 0; repeat < 2; repeat++) {
      expect(await f.service['syncDraft'](String(f.own._id), { strict: true, build: false })).toBe(false);
      expect(await f.service.effectiveImages(f.own)).toEqual(f.own.images);
      const response = await f.service['getPresentation']({ ...f.own, presentationVersion: 1 });
      expect(response).toMatchObject({ readiness: { ready: false, missing: [{ key: 'installationTypeId' }] } });
      expect(response).toHaveProperty('installationTypeId', f.own.installationTypeId);
      expect(response).toHaveProperty('textSnapshot', f.own.textSnapshot);
    }
    expect(f.patch).not.toHaveBeenCalled(); expect(f.rows).not.toHaveBeenCalled(); expect(f.save).not.toHaveBeenCalled(); expect(f.evaluate).not.toHaveBeenCalled();
    expect(JSON.stringify(f.own)).toBe(before);
  });
  it('legacy без категории, где старые правила не требуют installationTypeId, не получает нового запрета наследования', async () => {
    const f = fixture(undefined, 'CONCRETE_POSTS', undefined);
    // default параметра фикстуры — TRN; здесь явно снимаем категорию legacy-документа.
    delete f.own.passportCategory;
    expect(await f.service['fromProductDiff'](f.own, undefined, { existing: true, installationMismatch: false })).toHaveProperty('weight', 50);
    expect(f.patch).toHaveBeenCalledTimes(1);
    await f.service.effectiveImages(f.own);
    expect(f.rows).toHaveBeenCalledTimes(1);
  });
  it.each([['TRN', false], ['BLG', false], ['TRN', true], ['BLG', true]] as const)('both absent %s v1=%s сохраняет обычный diff', async (category, presentation) => {
    const f = fixture(undefined, 'CONCRETE_POSTS', category);
    if (presentation) f.own.presentationVersion = 1;
    delete (f.product.passportDefaults as { installationTypeId?: Types.ObjectId }).installationTypeId;
    f.patch.mockResolvedValue({ weight: 50 });
    const flag = { existing: true, installationMismatch: false, installationUnknown: false };
    expect(await f.service['fromProductDiff'](f.own, undefined, flag)).toHaveProperty('weight', 50);
    expect(flag).toEqual({ existing: true, installationMismatch: false, installationUnknown: false });
  });
  it.each(['patch', 'leaf'] as const)('both raw absent, но вычисленный %s даёт установку — сохранённый снимок защищён', async source => {
    const f = fixture();
    delete (f.product.passportDefaults as { installationTypeId?: Types.ObjectId }).installationTypeId;
    const selected = id(), root = id(), leaf = id();
    f.patch.mockResolvedValue(source === 'patch' ? { weight: 50, installationTypeId: selected } : { weight: 50 });
    if (source === 'leaf') {
      const forest = buildForest([
        toNode({ _id: root, section: 'installation', name: 'Монтаж', allCategories: true }),
        toNode({ _id: leaf, parentId: root, section: 'installation', text: 'Новая схема монтажа', installTypeId: selected, allCategories: true }),
      ]);
      Object.assign(f.service, { forest: async () => forest });
      f.own.textChoices = { [String(root)]: String(leaf) };
    }
    const flag = { existing: true, installationMismatch: false, installationUnknown: false };
    expect(await f.service['fromProductDiff'](f.own, undefined, flag)).toEqual({});
    expect(flag.installationUnknown).toBe(true);
    expect(f.save).not.toHaveBeenCalled();
  });
  it('пустой root при непустом default не считается both absent', async () => {
    const f = fixture();
    Object.assign(f.product, { installationTypeId: '' });
    const flag = { existing: true, installationMismatch: false, installationUnknown: false };
    expect(await f.service['fromProductDiff'](f.own, undefined, flag)).toEqual({});
    expect(flag.installationUnknown).toBe(true); expect(f.patch).not.toHaveBeenCalled();
  });
  it('новое создание без собственного способа сохраняет прежнее наследование из изделия', async () => {
    const f = fixture();
    expect(await f.service['fromProductDiff'](f.own)).toHaveProperty('weight', 50);
    expect(f.patch).toHaveBeenCalledTimes(1);
    await f.service.effectiveImages(f.own, undefined, false);
    expect(f.rows).toHaveBeenCalledTimes(1);
  });
  it('выпуск существующего v1 без подтверждённой установки отклоняется до построения новой проекции', async () => {
    const f = fixture();
    await expect(f.service['preparePresentation']({ ...f.own, presentationVersion: 1 }, {} as ClientSession)).rejects.toThrow('собственный способ установки');
    expect(f.evaluate).not.toHaveBeenCalled();
    expect(f.save).not.toHaveBeenCalled();
  });
  it('C241 P2 lineMissing не оценивает существующую missing-установку по новому default', async () => {
    const f = fixture();
    const readiness = jest.fn(async () => []);
    Object.assign(f.service, { readiness });
    const missing = await f.service['orderHost']().lineMissing!(String(f.own._id));
    expect(missing).toEqual(expect.arrayContaining([expect.stringContaining('установки')]));
    expect(readiness).not.toHaveBeenCalled();
    expect(f.patch).not.toHaveBeenCalled();
  });
});
