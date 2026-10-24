import 'reflect-metadata';
import { ForbiddenException, Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateClientErrorDto } from './dto/create-client-error.dto';
import {
  ClientErrorsService,
  CLIENT_ERROR_LIMIT_PER_MIN,
  clientErrorSig,
  normalizeForSig,
  stripQuery,
  maskSecrets,
  sanitizeClientError,
} from './client-errors.service';
import { ClientErrorsController } from './client-errors.controller';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';

/** ОШ2.1 — приём ошибок приложения: DTO, лимит на пользователя, sig, top. Без Mongo (фейковая модель). */

/** Тот же ValidationPipe, что в main.ts: whitelist + forbidNonWhitelisted + transform. */
async function check(body: Record<string, unknown>) {
  const dto = plainToInstance(CreateClientErrorDto, body);
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  return { dto, errors };
}

function makeService() {
  const create = jest.fn(async (d: unknown) => d);
  const aggregate = jest.fn(() => ({ exec: async () => [{ sig: 'a', count: 3 }] }));
  const service = new ClientErrorsService({ create, aggregate } as never);
  return { service, create, aggregate };
}

const userId = new Types.ObjectId().toHexString();

beforeAll(() => jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined));

describe('CreateClientErrorDto', () => {
  it('минимальное тело — message + kind', async () => {
    const { errors } = await check({ message: 'x', kind: 'action' });
    expect(errors).toHaveLength(0);
  });

  it('длинные строки обрезаются, а не отклоняются', async () => {
    const { dto, errors } = await check({
      message: 'м'.repeat(900),
      stack: 's'.repeat(5000),
      section: '#'.repeat(100),
      action: 'a'.repeat(200),
      name: 'n'.repeat(150),
      version: 'v'.repeat(50),
      ua: 'u'.repeat(400),
      kind: 'background',
    });
    expect(errors).toHaveLength(0);
    expect(dto.message).toHaveLength(500);
    expect(dto.stack).toHaveLength(4000);
    expect(dto.section).toHaveLength(60);
    expect(dto.action).toHaveLength(120);
    expect(dto.name).toHaveLength(100);
    expect(dto.version).toHaveLength(40);
    expect(dto.ua).toHaveLength(300);
  });

  it('url — без query и hash, до 200', async () => {
    const { dto } = await check({ message: 'x', kind: 'action', url: '/api/passports?search=секрет#x' });
    expect(dto.url).toBe('/api/passports');
    const long = await check({ message: 'x', kind: 'action', url: '/' + 'p'.repeat(300) });
    expect(long.dto.url).toHaveLength(200);
  });

  it('лишнее поле (данные формы) → ошибка', async () => {
    const { errors } = await check({ message: 'x', kind: 'action', form: { password: '1' } });
    expect(errors.map((e) => e.property)).toContain('form');
  });

  it('нет message / чужой kind / status не число → ошибка', async () => {
    expect((await check({ kind: 'action' })).errors.map((e) => e.property)).toContain('message');
    expect((await check({ message: 'x', kind: 'other' })).errors.map((e) => e.property)).toContain('kind');
    expect((await check({ message: 'x', kind: 'action', status: '500' })).errors.map((e) => e.property)).toContain('status');
  });
});

describe('sig', () => {
  it('числа и id не разбивают группу', () => {
    const a = clientErrorSig({ name: 'TypeError', message: 'нет строки 12 у 650f1c2ab3c4d5e6f7a8b9c0', section: '#stock', url: '/api/stock/650f1c2ab3c4d5e6f7a8b9c0' });
    const b = clientErrorSig({ name: 'TypeError', message: 'нет строки 7 у 650f1c2ab3c4d5e6f7a8b9c1', section: '#stock', url: '/api/stock/650f1c2ab3c4d5e6f7a8b9c1' });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it('другой раздел — другая группа', () => {
    const base = { name: 'Error', message: 'x' };
    expect(clientErrorSig({ ...base, section: '#a' })).not.toBe(clientErrorSig({ ...base, section: '#b' }));
  });

  it('normalizeForSig: uuid и числа → #', () => {
    expect(normalizeForSig('id 123e4567-e89b-12d3-a456-426614174000 n 42')).toBe('id # n #');
  });
});

describe('очистка на сервере: без параметров адресов и токенов', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI2NTBmMWMyYSJ9.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk';

  it('stripQuery: query и hash-параметры в каждом адресе; номер строки стека остаётся', () => {
    expect(stripQuery('#stock?search=Иванов')).toBe('#stock');
    expect(stripQuery('GET /api/materials?search=секрет&page=2 упал')).toBe('GET /api/materials упал');
    expect(stripQuery('at load (https://h/db/app/core/api.js?v=12:10:5)')).toBe('at load (https://h/db/app/core/api.js:10:5)');
    expect(stripQuery('Что случилось? Ничего')).toBe('Что случилось? Ничего');
  });

  it('maskSecrets: Bearer, kppd_, JWT, длинный hex/base64 → ***; обычный текст и пути целы', () => {
    expect(maskSecrets(`Authorization: Bearer ${jwt}`)).toBe('Authorization: Bearer ***');
    expect(maskSecrets('ключ kppd_AbC123_xyz-9 не подошёл')).toBe('ключ *** не подошёл');
    expect(maskSecrets(`token=${jwt}`)).toBe('token=***');
    expect(maskSecrets('h ' + 'a1'.repeat(20))).toBe('h ***');
    expect(maskSecrets('b64 QWxhZGRpbjpvcGVuIHNlc2FtZQ0K0123456789==')).toBe('b64 ***');
    expect(maskSecrets('at render (https://kppdf-crm.ru/db/app/sections/stock.js:10:5)')).toBe('at render (https://kppdf-crm.ru/db/app/sections/stock.js:10:5)');
    expect(maskSecrets('id 650f1c2ab3c4d5e6f7a8b9c0')).toBe('id 650f1c2ab3c4d5e6f7a8b9c0');
  });

  it('sanitizeClientError чистит message, section, stack, url; record пишет и логирует чистое', async () => {
    const dirty = {
      message: `fetch /api/x?search=Петров failed, Bearer ${jwt}`,
      section: '#stock?search=Петров',
      stack: 'Error\n at a (https://h/app.js?token=kppd_secret123:1:2)',
      url: '/api/x',
      kind: 'action',
    } as CreateClientErrorDto;
    const clean = sanitizeClientError(dirty);
    expect(clean.message).toBe('fetch /api/x failed, Bearer ***');
    expect(clean.section).toBe('#stock');
    expect(clean.stack).toBe('Error\n at a (https://h/app.js:1:2)');

    const warn = jest.spyOn(Logger.prototype, 'warn');
    warn.mockClear();
    const { service, create } = makeService();
    await service.record(dirty, { id: userId });
    const saved = JSON.stringify(create.mock.calls[0][0]);
    const logged = String(warn.mock.calls[0][0]);
    for (const text of [saved, logged]) {
      expect(text).not.toContain('Петров');
      expect(text).not.toContain('kppd_');
      expect(text).not.toContain(jwt);
    }
  });
});

describe('ClientErrorsService', () => {
  it('record: пишет sig, userId, role; данные — только из DTO', async () => {
    const { service, create } = makeService();
    const ok = await service.record({ message: 'boom', kind: 'unhandled', section: '#app' } as CreateClientErrorDto, { id: userId, role: 'manager' });
    expect(ok).toBe(true);
    const doc = create.mock.calls[0][0] as Record<string, unknown>;
    expect(doc.sig).toMatch(/^[0-9a-f]{16}$/);
    expect(String(doc.userId)).toBe(userId);
    expect(doc.role).toBe('manager');
  });

  it(`лимит: 30 за минуту → записано ${CLIENT_ERROR_LIMIT_PER_MIN}`, async () => {
    const { service, create } = makeService();
    const results: boolean[] = [];
    for (let i = 0; i < 30; i++) {
      results.push(await service.record({ message: 'x', kind: 'action' } as CreateClientErrorDto, { id: userId }));
    }
    expect(create).toHaveBeenCalledTimes(CLIENT_ERROR_LIMIT_PER_MIN);
    expect(results.filter(Boolean)).toHaveLength(CLIENT_ERROR_LIMIT_PER_MIN);
  });

  it('лимит у каждого свой и обнуляется через минуту', () => {
    const { service } = makeService();
    const t0 = 1_000_000;
    for (let i = 0; i < CLIENT_ERROR_LIMIT_PER_MIN; i++) expect(service.allow('u1', t0)).toBe(true);
    expect(service.allow('u1', t0 + 1000)).toBe(false);
    expect(service.allow('u2', t0 + 1000)).toBe(true);
    expect(service.allow('u1', t0 + 60_000)).toBe(true);
  });

  it('top: окно по hours (по умолч. 24, макс. 720), группировка по sig, убывание count', async () => {
    const { service, aggregate } = makeService();
    const before = Date.now();
    const res = await service.top();
    expect(res).toEqual({ items: [{ sig: 'a', count: 3 }] });
    const pipeline = (aggregate.mock.calls[0] as unknown as [Array<Record<string, any>>])[0];
    const since: Date = pipeline[0].$match.createdAt.$gte;
    expect(before - since.getTime()).toBeGreaterThanOrEqual(24 * 3600_000 - 5);
    expect(before - since.getTime()).toBeLessThan(24 * 3600_000 + 5000);
    expect(pipeline.find((s) => s.$group)!.$group._id).toBe('$sig');
    expect(pipeline.filter((s) => s.$sort).pop()!.$sort).toEqual({ count: -1, lastAt: -1 });

    await service.top('100000');
    const p2 = (aggregate.mock.calls[1] as unknown as [Array<Record<string, any>>])[0];
    expect(Date.now() - p2[0].$match.createdAt.$gte.getTime()).toBeLessThan(720 * 3600_000 + 5000);
  });
});

describe('ClientErrorsController', () => {
  it('ключ kppd_ (keyScope) → 403, запись не делается', async () => {
    const { service, create } = makeService();
    const ctl = new ClientErrorsController(service);
    await expect(
      ctl.create({ id: userId, username: 'k', role: 'admin', keyScope: { access: 'full' } }, { message: 'x', kind: 'action' } as CreateClientErrorDto),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(create).not.toHaveBeenCalled();
  });

  it('top — только admin; приём — любая роль', () => {
    expect(Reflect.getMetadata(ROLES_KEY, ClientErrorsController.prototype.top)).toEqual(['admin']);
    expect(Reflect.getMetadata(ROLES_KEY, ClientErrorsController.prototype.create)).toContain('user');
  });
});
