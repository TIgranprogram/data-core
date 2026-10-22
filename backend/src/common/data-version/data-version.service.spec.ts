import { EventEmitter } from 'events';
import { DataVersionService } from './data-version.service';

/** Поток изменений — подделка: события 'change' / 'error' шлёт тест. */
function setup() {
  const stream = Object.assign(new EventEmitter(), { close: jest.fn().mockResolvedValue(undefined) });
  const conn = { db: { watch: jest.fn(() => stream) } };
  const svc = new DataVersionService(conn as never);
  return { svc, stream, conn };
}

describe('DataVersionService — кэш списков по версиям коллекций', () => {
  const env = process.env.NODE_ENV;
  beforeEach(() => { jest.useFakeTimers(); process.env.NODE_ENV = 'production'; });
  afterEach(() => { jest.useRealTimers(); process.env.NODE_ENV = env; });

  it('до включения потока кэша нет — каждый раз расчёт', async () => {
    const { svc } = setup();
    const fn = jest.fn().mockResolvedValue(1);
    await svc.cached('s', ['a'], '', fn);
    await svc.cached('s', ['a'], '', fn);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(svc.key(['a'])).toBeNull();
  });

  it('поток открыт: один расчёт на версию; запись в коллекцию — расчёт заново; чужая коллекция не мешает', async () => {
    const { svc, stream } = setup();
    svc.onApplicationBootstrap();
    jest.advanceTimersByTime(3000);
    let n = 0;
    const fn = jest.fn(async () => ++n);
    expect(await svc.cached('s', ['materials'], 'q', fn)).toBe(1);
    expect(await svc.cached('s', ['materials'], 'q', fn)).toBe(1);
    expect(await svc.cached('s', ['materials'], 'other', fn)).toBe(2); // другие параметры — свой расчёт
    stream.emit('change', { ns: { coll: 'photos' } });
    expect(await svc.cached('s', ['materials'], 'q', fn)).toBe(1);
    stream.emit('change', { ns: { coll: 'materials' } });
    expect(await svc.cached('s', ['materials'], 'q', fn)).toBe(3);
  });

  it('ошибка потока — кэш выключен, через 30 с — новая попытка', async () => {
    const { svc, stream, conn } = setup();
    svc.onApplicationBootstrap();
    jest.advanceTimersByTime(3000);
    expect(svc.key(['a'])).not.toBeNull();
    stream.emit('error', new Error('нет прав'));
    expect(svc.key(['a'])).toBeNull();
    jest.advanceTimersByTime(30000);
    expect(conn.db.watch).toHaveBeenCalledTimes(2);
    jest.advanceTimersByTime(3000);
    expect(svc.key(['a'])).not.toBeNull();
  });

  it('упавший расчёт не кэшируется', async () => {
    const { svc } = setup();
    svc.onApplicationBootstrap();
    jest.advanceTimersByTime(3000);
    const fn = jest.fn().mockRejectedValueOnce(new Error('сбой')).mockResolvedValue(5);
    await expect(svc.cached('s', ['a'], '', fn)).rejects.toThrow('сбой');
    expect(await svc.cached('s', ['a'], '', fn)).toBe(5);
  });
});
