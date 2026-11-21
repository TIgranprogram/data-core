import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Types, type ClientSession } from 'mongoose';
import { PassportImportDto } from './dto/passport-import.dto';
import { importNumbers, importInstallationKind } from './passport-import.service';
import { ProductPassportService } from './product-passport.service';
import type { Doc } from './passport-consts';

describe('C172 контракт подтверждённых полей', () => {
  it('третий лист: анкеры→mounting, бетон/неизвестно→foundation; собственный способ экземпляра важнее изделия', () => {
    const anchor = new Types.ObjectId(), concrete = new Types.ObjectId();
    const installs = [{ _id: anchor, code: 'ANCHOR' }, { _id: concrete, code: 'CONCRETE_POSTS' }];
    expect(importInstallationKind({ passportDefaults: { installationTypeId: anchor } }, installs)).toBe('mounting');
    expect(importInstallationKind({ installationTypeId: concrete, passportDefaults: { installationTypeId: anchor } }, installs)).toBe('foundation');
    expect(importInstallationKind({ passportCategory: 'DIO' }, installs)).toBe('foundation');
    expect(importInstallationKind({}, installs)).toBe('foundation');
  });
  const input = () => ({ contextToken: 'context', images: ['overview', 'dimensions', 'foundation'].map(kind => ({ kind, photoId: String(new Types.ObjectId()) })), confirmed: {} });
  const errors = (body: unknown) => validate(plainToInstance(PassportImportDto, body), { whitelist: true, forbidNonWhitelisted: true });
  it('отказ от чисел ничего не очищает; нулевая глубина — одобренное число', () => {
    expect(importNumbers({})).toEqual({ product: {}, passport: {} });
    expect(importNumbers({ foundationDepth: 0 })).toEqual({ product: { 'passportDefaults.foundationDepth': 0 }, passport: { foundationDepth: 0 } });
  });
  it('мм и кг переходят в существующие поля без смены единиц и без остальных defaults', () => {
    expect(importNumbers({ dimensions: { length: 110, width: 220, height: 330, unit: 'мм' }, weightKg: 7 })).toEqual({ product: { dimensions: { length: 110, width: 220, height: 330, unit: 'мм' }, weightKg: 7 }, passport: { length: 110, width: 220, height: 330, weight: 7 } });
  });
  it('принимает три разных вида и пустое подтверждение', async () => { expect(await errors(input())).toHaveLength(0); });
  it.each([{ weightKg: null }, { foundationDepth: null }, { dimensions: null }, { weightKg: -1 }, { unapproved: 1 }, { dimensions: { length: 1, width: 2, height: 3, unit: 'м' } }])('отклоняет очистку/чужие поля/другую единицу %j', async confirmed => {
    expect((await errors({ ...input(), confirmed })).length).toBeGreaterThan(0);
  });
  it('отклоняет дубли вида и чужой kind', async () => {
    const body = input(); body.images[2].kind = 'overview'; expect((await errors(body)).length).toBeGreaterThan(0);
    body.images[2].kind = 'mounting'; expect((await errors(body)).length).toBeGreaterThan(0);
  });
});

describe('C172 подготовка legacy в общей session', () => {
  it('новая числовая редакция получает sizeLayout2, прежний снимок и нецелевые поля не меняются', async () => {
    const current: Doc = { _id: new Types.ObjectId(), passportNumber: '616', passportCategory: 'TRN', length: 10, name: 'Своё имя', textSnapshot: { sections: [], sizeLayout: 1 }, images: [] };
    const session = {} as ClientSession;
    const document = { ...current };
    const rebuildSafe = jest.fn(async (_doc: unknown, after: Doc, seen: ClientSession) => {
      expect(seen).toBe(session); expect(after.length).toBe(20); document.textSnapshot = after.textSnapshot;
      document.name = 'чужая производная'; return true;
    });
    const svc = Object.assign(Object.create(ProductPassportService.prototype), { model: { hydrate: () => ({ set: (patch: Doc) => Object.assign(document, patch), toObject: () => document }) }, rebuildSafe }) as ProductPassportService;
    const result = await svc.prepareImportedPassport(current, { length: 20 }, session);
    expect(result).toEqual({ length: 20, textSnapshot: { sections: [], sizeLayout: 2 } });
    expect(current.textSnapshot).toEqual({ sections: [], sizeLayout: 1 });
    expect(current.name).toBe('Своё имя'); expect(rebuildSafe).toHaveBeenCalledTimes(1);
  });
});

