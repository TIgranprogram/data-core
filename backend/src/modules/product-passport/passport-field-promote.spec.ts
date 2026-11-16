import { BadRequestException, ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { fieldDestination, promoteField, replaceLine } from './passport-field-promote';

/** Мини-база: коллекции — массивы документов; поддерживается только то, что зовёт promoteField. */
function fakeDb(data: Record<string, Array<Record<string, unknown>>>) {
  const match = (d: Record<string, unknown>, q: Record<string, unknown>): boolean => Object.entries(q).every(([k, v]) => {
    if (k === '$or') return (v as Record<string, unknown>[]).some((part) => match(d, part));
    const val = k.split('.').reduce<unknown>((o, key) => (o as Record<string, unknown> | undefined)?.[key], d);
    if (v && typeof v === 'object' && '$exists' in v) return (val !== undefined) === (v as { $exists: boolean }).$exists;
    if (v && typeof v === 'object' && '$in' in (v as object)) {
      const set = ((v as { $in: unknown[] }).$in).map(String);
      return Array.isArray(val) ? val.some((x) => set.includes(String(x))) : set.includes(String(val));
    }
    if (v === null) return val === null || val === undefined;
    return String(val) === String(v);
  });
  const coll = (name: string) => ({
    findOne: async (q: Record<string, unknown>) => (data[name] ?? []).find((d) => match(d, q)) ?? null,
    find: (q: Record<string, unknown>) => ({ toArray: async () => (data[name] ?? []).filter((d) => match(d, q)) }),
    countDocuments: async (q: Record<string, unknown>) => (data[name] ?? []).filter((d) => match(d, q)).length,
    updateOne: async (q: Record<string, unknown>, u: { $set: Record<string, unknown>; $addToSet?: Record<string, unknown> }) => {
      const d = (data[name] ?? []).find((x) => match(x, q));
      if (!d) return { matchedCount: 0 };
      const put = (key: string, value: unknown, add = false) => {
        const parts = key.split('.'); let obj = d;
        for (const k of parts.slice(0, -1)) { obj[k] ??= {}; obj = obj[k] as Record<string, unknown>; }
        const k = parts[parts.length - 1]; obj[k] = add ? [...new Set([...(obj[k] as unknown[] ?? []), value])] : value;
      };
      Object.entries(u.$set).forEach(([k, v]) => put(k, v));
      Object.entries(u.$addToSet ?? {}).forEach(([k, v]) => put(k, v, true));
      return { matchedCount: 1 };
    },
  });
  return { collection: coll } as unknown as import("mongoose").mongo.Db;
}
const id = () => new Types.ObjectId();

describe('C132 replaceLine', () => {
  it('меняет нужную строку текста и массива, пробелы не важны', () => {
    expect(replaceLine('а\nб  в\nг', 'б в', 'Б')).toBe('а\nБ\nг');
    expect(replaceLine(['а', 'б'], 'б', 'Б')).toEqual(['а', 'Б']);
    expect(replaceLine('а', 'х', 'Б')).toBeNull();
  });
});

describe('C132 promoteField: сохранить в справочнике', () => {
  it('элемент: заменяет строку правил, считает изделия', async () => {
    const e = id();
    const db = fakeDb({ dict_values: [{ _id: e, dict: 'passportElements', name: 'Горка', usageRules: 'Не лазить\nНе прыгать' }], products: [{ deletedAt: null, passportDefaults: { elements: [e] } }, { deletedAt: null, passportDefaults: { elements: [e] } }, { deletedAt: null, passportDefaults: { elements: [id()] } }] });
    const r = await promoteField(db, { kind: 'element', id: String(e), field: 'usageRules' }, 'Не лазить без взрослых', 'Не лазить', '');
    expect(r).toEqual(expect.objectContaining({ ok: true, affected: 2, shared: true }));
    const rec = await db.collection('dict_values').findOne({ _id: e });
    expect(rec!.usageRules).toBe('Не лазить без взрослых\nНе прыгать');
  });
  it('справочник уже менялся — 409, запись не тронута', async () => {
    const e = id();
    const db = fakeDb({ dict_values: [{ _id: e, dict: 'passportElements', usageRules: 'Другое' }] });
    await expect(promoteField(db, { kind: 'element', id: String(e), field: 'usageRules' }, 'Новое', 'Не лазить', '')).rejects.toThrow(ConflictException);
    await expect(promoteField(db, { kind: 'element', id: String(id()), field: 'usageRules' }, 'Новое', 'x', '')).rejects.toThrow(ConflictException);
  });
  it('дефект: меняет название; изменённое название в справочнике — 409', async () => {
    const d = id();
    const db = fakeDb({ dict_values: [{ _id: d, dict: 'passportDefects', name: 'Трещина', applies: 'E1' }, { _id: id(), dict: 'passportElements', code: 'E1' }], products: [] });
    await expect(promoteField(db, { kind: 'defect', id: String(d), field: 'name' }, 'Трещина сварки', 'Люфт', '')).rejects.toThrow(ConflictException);
    const r = await promoteField(db, { kind: 'defect', id: String(d), field: 'name' }, 'Трещина сварки', 'Трещина', '');
    expect(r.target).toContain('дефект');
    expect((await db.collection('dict_values').findOne({ _id: d }))!.name).toBe('Трещина сварки');
  });
  it('способ установки: монтаж целиком', async () => {
    const i = id();
    const db = fakeDb({ dict_values: [{ _id: i, dict: 'passportInstall', name: 'Бетон', montage: 'Залить' }], products: [{ deletedAt: null, passportDefaults: { installationTypeId: i } }] });
    const r = await promoteField(db, { kind: 'install', id: String(i), field: 'montage' }, 'Залить бетон', 'Залить', '');
    expect(r.affected).toBe(1);
    expect((await db.collection('dict_values').findOne({ _id: i }))!.montage).toBe('Залить бетон');
  });
  it('изделие: свой текст и пометка «вписан вручную»; чужие значения по умолчанию остаются', async () => {
    const p = id();
    const db = fakeDb({ products: [{ _id: p, deletedAt: null, name: 'Горка', passportDefaults: { passportCategory: 'DIO' } }] });
    const r = await promoteField(db, { kind: 'product', id: String(p), field: 'installation' }, 'Бетонирование стоек', '', '');
    expect(r.kind).toBe('product');
    const prod = (await db.collection('products').findOne({ _id: p }))!;
    expect(prod.installation).toBe('Бетонирование стоек');
    expect(prod.passportDefaults).toEqual({ passportCategory: 'DIO', manualText: ['installationMethod'] });
  });
  it('раздел воронки: свой текст изделия в textOverrides; нет изделия — 400', async () => {
    const p = id(); const root = id();
    const db = fakeDb({ products: [{ _id: p, deletedAt: null, passportDefaults: null }] });
    const r = await promoteField(db, { kind: 'funnel', id: String(root), field: 'text' }, 'Для детей', '', String(p));
    expect(r.affected).toBe(1);
    expect(((await db.collection('products').findOne({ _id: p }))!.passportDefaults as { textOverrides: Record<string, unknown> }).textOverrides[String(root)]).toEqual({ text: 'Для детей' });
    await expect(promoteField(db, { kind: 'funnel', id: String(root), field: 'text' }, 'x', '', '')).rejects.toThrow(BadRequestException);
  });
});


describe('C132 регрессии аудита', () => {
  it('монтаж: устаревший снимок не затирает новую редакцию', async () => {
    const i = id(); const db = fakeDb({ dict_values: [{ _id: i, dict: 'passportInstall', montage: 'Новое' }] });
    await expect(promoteField(db, { kind: 'install', id: String(i), field: 'montage' }, 'Мой', 'Старое', '')).rejects.toThrow(ConflictException);
  });
  it('дефект: изделие с элементом и материалом учитывается один раз', async () => {
    const d=id(), e=id(), m=id();
    const db=fakeDb({ dict_values: [{_id:d,dict:'passportDefects',name:'Дефект',applies:['E','M']},{_id:e,dict:'passportElements',code:'E'},{_id:m,dict:'passportMaterials',code:'M'}], products:[{passportDefaults:{elements:[e],materialIds:[m]}}] });
    expect((await fieldDestination(db,{kind:'defect',id:String(d),field:'name'},'')).affected).toBe(1);
  });
  it('token защищает от изменения после подтверждения; target ничего не пишет', async () => {
    const i=id(), rec={_id:i,dict:'passportInstall',montage:'Старое'};
    const db=fakeDb({dict_values:[rec]}); const ref={kind:'install' as const,id:String(i),field:'montage'};
    const target=await fieldDestination(db,ref,''); expect(rec.montage).toBe('Старое');
    rec.montage='Чужое';
    await expect(promoteField(db,ref,'Мой','Старое','',target.token)).rejects.toThrow(ConflictException);
    expect(rec.montage).toBe('Чужое');
  });
  it('CAS обнаруживает гонку между чтением и записью', async () => {
    const i=id(), db=fakeDb({dict_values:[{_id:i,dict:'passportInstall',montage:'Старое'}]});
    const collection=db.collection.bind(db);
    db.collection=((name:string)=>({...collection(name),updateOne:async()=>({matchedCount:0})})) as unknown as typeof db.collection;
    await expect(promoteField(db,{kind:'install',id:String(i),field:'montage'},'Мой','Старое','')).rejects.toThrow(ConflictException);
  });
  it('повторное сохранение из прежнего снимка с новым target сохраняет новую редакцию строки', async () => {
    const i=id(), db=fakeDb({dict_values:[{_id:i,dict:'passportElements',usageRules:'А\nБ'}]});
    const ref={kind:'element' as const,id:String(i),field:'usageRules'};
    await promoteField(db,ref,'А1','А','',(await fieldDestination(db,ref,'')).token);
    await promoteField(db,ref,'А2','А','',(await fieldDestination(db,ref,'')).token);
    expect((await db.collection('dict_values').findOne({_id:i}))!.usageRules).toBe('А2\nБ');
  });
  it('неоднозначная строка не заменяется',()=>expect(replaceLine('А\nА','А','Б')).toBeNull());
});

it('C132 target и свежий token не разрешают устаревшему монтажу затереть справочник', async () => {
  const i=id(), db=fakeDb({dict_values:[{_id:i,dict:'passportInstall',montage:'Чужое'}]});
  const ref={kind:'install' as const,id:String(i),field:'montage'};
  await expect(fieldDestination(db,ref,'','Старое')).rejects.toThrow(ConflictException);
  const target=await fieldDestination(db,ref,'');
  await expect(promoteField(db,ref,'Моё','Старое','',target.token)).rejects.toThrow(ConflictException);
});
it('C132 монтаж повторно сохраняется из старого снимка через новый target', async () => {
  const i=id(), db=fakeDb({dict_values:[{_id:i,dict:'passportInstall',montage:'А'}]});
  const ref={kind:'install' as const,id:String(i),field:'montage'};
  await promoteField(db,ref,'Б','А','',(await fieldDestination(db,ref,'','А')).token);
  await promoteField(db,ref,'В','А','',(await fieldDestination(db,ref,'','А')).token);
  expect((await db.collection('dict_values').findOne({_id:i}))!.montage).toBe('В');
});
