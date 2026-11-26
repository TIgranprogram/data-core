import { ExecutionContext, Logger } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import type { AuthenticatedUser } from '../decorators/current-user.decorator';
import type { Idempotency } from './idempotency-storage.schema';
import { IdempotencyStorageService } from './idempotency-storage.service';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { OwnerIdempotency } from './owner-idempotency.decorator';

const actor: AuthenticatedUser = { id: 'actor-one', role: 'manager', username: 'manager' };
const defaultUrl = '/api/test?filter=one';

class TestHandlers {
  @OwnerIdempotency()
  owned() {}

  ordinary() {}
}

describe('IdempotencyInterceptor', () => {
  const records = new Map<string, Idempotency>();
  const storage = {
    findByKey: jest.fn(async (key: string) => records.get(key)),
    insertOrFetch: jest.fn(async (record: Idempotency) => records.set(record.idempotencyKey, record)),
  };
  const interceptor = new IdempotencyInterceptor(storage as unknown as IdempotencyStorageService);

  beforeEach(() => {
    records.clear();
    jest.clearAllMocks();
  });

  async function send(options: {
    user?: AuthenticatedUser | null;
    url?: string;
    key?: string;
    token?: string;
    method?: string;
    body?: unknown;
    response?: unknown;
    status?: number;
    multipart?: boolean;
    ownerIdempotency?: boolean;
  } = {}) {
    const url = options.url ?? defaultUrl;
    const request = {
      method: options.method ?? 'POST',
      path: url.split('?')[0],
      originalUrl: url,
      body: options.body ?? { value: 'тест' },
      user: options.user === undefined ? actor : options.user,
      get: (name: string) => ({
        'Idempotency-Key': options.key ?? 'retry',
        'X-Access-Token': options.token,
      }[name]),
      is: () => Boolean(options.multipart),
    };
    const res = { statusCode: options.status ?? 201, status(code: number) { this.statusCode = code; } };
    const context = {
      getHandler: () => options.ownerIdempotency ? TestHandlers.prototype.owned : TestHandlers.prototype.ordinary,
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => res }),
    } as unknown as ExecutionContext;
    const handle = jest.fn(() => of(options.response ?? { id: 'new-row' }));
    const body = await lastValueFrom(await interceptor.intercept(context, { handle }));
    return { body, status: res.statusCode, handled: handle.mock.calls.length > 0 };
  }

  it.each([
    { user: null }, { key: '' }, { method: 'GET' }, { multipart: true },
    { url: '/api/auth/login' }, { url: '/api/health' }, { url: '/db/api/desktop/pairing-keys' },
    { url: '/api/photos/intake/example' }, { url: '/api/supply/invoices/intake/confirm' },
    { body: { value: 'я'.repeat(140000) } },
  ])('пропускает запрос без кеша (%j)', async (options) => {
    expect((await send(options)).handled).toBe(true);
    expect(storage.findByKey).not.toHaveBeenCalled();
    expect(storage.insertOrFetch).not.toHaveBeenCalled();
  });

  it('повторяет успешный ответ того же пользователя, включая статус', async () => {
    await send();
    const retry = await send({ status: 200, response: { id: 'duplicate' } });
    expect(retry).toEqual({ body: { id: 'new-row' }, status: 201, handled: false });
  });

  it('аннотированный метод всегда выполняется и не обращается к кешу', async () => {
    await send();
    jest.clearAllMocks();
    const result = await send({ ownerIdempotency: true, body: { value: 'другой' }, response: { id: 'owner-row' } });
    expect(result).toMatchObject({ handled: true, body: { id: 'owner-row' } });
    expect(storage.findByKey).not.toHaveBeenCalled();
    expect(storage.insertOrFetch).not.toHaveBeenCalled();
    expect((await send()).handled).toBe(false);
  });

  it.each([
    { url: '/api/test?filter=two' }, { body: { value: 'другое' } },
    { user: { ...actor, permissions: ['stock:read'] } },
    { user: { ...actor, isOwner: true } },
  ])('отклоняет повтор после изменения запроса или прав (%j)', async (options) => {
    await send();
    await expect(send(options)).rejects.toMatchObject({
      response: { code: 'IDEMPOTENCY_KEY_REUSED' },
    });
  });

  it('изолирует пользователей и ключи одного пользователя', async () => {
    const machine: AuthenticatedUser = { ...actor, keyScope: { access: 'write' } };
    await send();
    expect((await send({ user: { ...actor, id: 'actor-two' } })).handled).toBe(true);
    expect((await send({ user: machine, token: 'kppd_synthetic_one' })).handled).toBe(true);
    expect((await send({ user: machine, token: 'kppd_synthetic_two' })).handled).toBe(true);
    expect((await send({ user: machine, token: 'kppd_synthetic_one' })).handled).toBe(false);
    expect(records.size).toBe(4);
    expect([...records.keys()].every((key) => /^v2:[0-9a-f]{64}$/.test(key))).toBe(true);
  });

  it('сохраняет результат сериализации и прячет секретные поля', async () => {
    const response = {
      toJSON() {
        return { id: 'row', profile: { apiKey: 'fixture', refreshToken: 'fixture', passwordHash: 'fixture', ok: true } };
      },
    };
    expect((await send({ response })).body).toBe(response);
    expect((await send()).body).toEqual({
      id: 'row', profile: { apiKey: '[REDACTED]', refreshToken: '[REDACTED]', passwordHash: '[REDACTED]', ok: true },
    });
  });

  it('пропускает неуспешные, зацикленные и слишком большие ответы', async () => {
    const circular = { items: [] as unknown[] };
    circular.items.push(circular);
    await send({ status: 400 });
    expect((await send({ response: circular })).body).toBe(circular);
    await send({ response: { value: 'я'.repeat(140000) } });
    expect(storage.insertOrFetch).not.toHaveBeenCalled();
  });

  it('возвращает ответ при временном отказе кеша записи', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    storage.insertOrFetch.mockRejectedValueOnce(new Error('synthetic'));
    try {
      expect((await send()).body).toEqual({ id: 'new-row' });
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });
});
