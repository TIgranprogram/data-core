/* eslint-disable @typescript-eslint/no-var-requires */
const { judge, writeWithRetry, summary } = require('../../../scripts/lib/write-retry.js');

/** Р1 (C112): помощник записи для скриптов правки данных — повтор при 503/READ_ONLY, честный итог. */
const readOnly = JSON.stringify({ statusCode: 503, code: 'READ_ONLY', message: 'Сервер переключается', retryAfter: 30 });
const done = JSON.stringify({ id: 'x' });

describe('write-retry', () => {
  it('judge: 503/READ_ONLY — повтор по retryAfter, 4xx — ошибка, обычный ответ — записано', () => {
    expect(judge(readOnly)).toEqual({ kind: 'retry', wait: 30 });
    expect(judge('{"statusCode":503}')).toEqual({ kind: 'retry', wait: 30 });
    expect(judge('{"code":"READ_ONLY","retryAfter":7}')).toEqual({ kind: 'retry', wait: 7 });
    expect(judge('{"code":"READ_ONLY","retryAfter":9999}')).toEqual({ kind: 'retry', wait: 120 });
    expect(judge('{"statusCode":404,"message":"Изделие не найдено"}').kind).toBe('fail');
    expect(judge('curl: (7) Failed to connect').kind).toBe('retry');
    expect(judge('вход не удался').kind).toBe('fail');
    expect(judge(done).kind).toBe('ok');
  });

  it('с первого раза — written, без ожидания', async () => {
    const sleep = jest.fn();
    const r = await writeWithRetry(async () => done, { sleep });
    expect(r).toMatchObject({ state: 'written', retries: 0 });
    expect(sleep).not.toHaveBeenCalled();
    expect(summary(r)).toBe('');
  });

  it('503 дважды, затем успех — retried, ждёт retryAfter', async () => {
    const answers = [readOnly, readOnly, done];
    const sleep = jest.fn();
    const r = await writeWithRetry(async () => answers.shift(), { sleep });
    expect(r).toMatchObject({ state: 'retried', retries: 2, out: done });
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(30);
    expect(summary(r)).toBe('[запись: повторено 2, записано]');
  });

  it('503 всегда — до 5 повторов (6 попыток), затем failed с последним ответом', async () => {
    const send = jest.fn(async () => readOnly);
    const r = await writeWithRetry(send, { sleep: async () => undefined });
    expect(send).toHaveBeenCalledTimes(6);
    expect(r).toMatchObject({ state: 'failed', retries: 5, out: readOnly });
    expect(summary(r)).toBe('[запись: не записано после 5 повторов]');
  });

  it('ошибка 4xx не повторяется', async () => {
    const send = jest.fn(async () => '{"statusCode":400,"message":"Нельзя"}');
    const r = await writeWithRetry(send, { sleep: async () => undefined });
    expect(send).toHaveBeenCalledTimes(1);
    expect(r.state).toBe('failed');
  });
});
