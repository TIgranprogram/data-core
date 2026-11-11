import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { endpointFor, parseArgs, cacheKey, analyzeImage, review, latestAudit } from './vision-review.mjs';

const good = () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"findings":[]}' } }], usage: { total_tokens: 42 } }) });
const request = { bytes: Buffer.from('image'), mime: 'image/png', model: 'local', endpoint: 'http://localhost:1235/v1/chat/completions', apiKey: 'SECRET' };

test('разрешён только loopback HTTP без реквизитов и query', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) assert.equal(endpointFor(`http://${host}:1235/v1`), `http://${host}:1235/v1/chat/completions`);
  for (const url of ['https://localhost/v1', 'http://example.com/v1', 'http://localhost.evil/v1', 'http://user:secret@localhost/v1', 'http://localhost/v1?key=x']) assert.throws(() => endpointFor(url));
});

test('изображение действительно отправляется, токены и thinking ограничены', async () => {
  const result = await analyzeImage({ ...request, fetchImpl: async (url, init) => {
    assert.equal(url, request.endpoint);
    assert.equal(init.redirect, 'error');
    const body = JSON.parse(init.body);
    assert.equal(body.messages[0].content[1].type, 'image_url');
    assert.equal(body.messages[0].content[1].image_url.url, 'data:image/png;base64,aW1hZ2U=');
    assert.equal(body.max_tokens, 700);
    assert.equal(body.reasoning_effort, 'none');
    assert.equal(body.chat_template_kwargs.enable_thinking, false);
    assert.equal(body.tools, undefined);
    assert.equal(body.response_format.type, 'json_schema');
    assert.equal(body.response_format.json_schema.schema.properties.findings.maxItems, 3);
    return good();
  } });
  assert.deepEqual(result, { findings: [], usage: { total_tokens: 42 } });
});

test('redirect, HTTP, сеть, таймаут и плохой JSON не становятся успехом', async () => {
  for (const [fetchImpl, reason] of [
    [async () => ({ status: 302 }), 'redirect'],
    [async () => ({ ok: false, status: 500 }), 'http_error'],
    [async () => { throw new Error('SECRET'); }, 'connection_error'],
    [async () => new Promise(() => {}), 'timeout'],
    [async () => ({ ...good(), json: async () => ({ choices: [{ message: { content: 'не JSON' } }] }) }), 'invalid_json'],
  ]) await assert.rejects(analyzeImage({ ...request, timeoutMs: 10, fetchImpl }), { message: reason });
});

test('структура и длины JSON проверяются строго', async () => {
  const f = { kind: 'подписи', location: 'верх', evidence: 'обрезано', suggestion: 'расширить' };
  for (const content of [{ findings: [], accepted: true }, { findings: [ { ...f, kind: 'работает' } ] }, { findings: [{ ...f, evidence: 'a'.repeat(501) }] }, { findings: Array(6).fill(f) }, {}]) {
    await assert.rejects(analyzeImage({ ...request, fetchImpl: async () => ({ ...good(), json: async () => ({ choices: [{ message: { content: JSON.stringify(content) } }] }) }) }), { message: 'invalid_json' });
  }
});

test('ключ меняется с байтами, моделью, prompt и endpoint', () => {
  const key = cacheKey(Buffer.from('a'), 'm', 'http://localhost', '1');
  for (const params of [[Buffer.from('b'), 'm', 'http://localhost', '1'], [Buffer.from('a'), 'n', 'http://localhost', '1'], [Buffer.from('a'), 'm', 'http://localhost', '2'], [Buffer.from('a'), 'm', 'http://127.0.0.1', '1']]) assert.notEqual(cacheKey(...params), key);
});

test('лимит изображений не учитывает текст; кэш, refresh и ошибки в реальных файлах', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vision-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const input = path.join(root, 'input');
  await fs.mkdir(input);
  await fs.writeFile(path.join(input, 'a.txt'), 'text');
  await fs.writeFile(path.join(input, 'b.png'), 'image');
  await fs.writeFile(path.join(input, 'c.jpg'), Buffer.alloc(8 * 1024 * 1024 + 1));
  await fs.writeFile(path.join(input, 'd.webp'), 'image');
  let calls = 0;
  const options = { input, limit: 2, model: 'local', baseUrl: 'http://localhost:1235/v1', apiKey: 'SECRET', logRoot: path.join(root, 'logs'), fetchImpl: async () => { calls++; return good(); } };
  const first = await review(options);
  assert.deepEqual(first.summary.counts, { analyzed: 1, cached: 0, failed: 0, skipped: 3 });
  assert.deepEqual(first.summary.results.map(r => r.reason), ['unsupported_extension', undefined, 'too_large', 'limit']);
  assert.equal((await review(options)).summary.counts.cached, 1);
  assert.equal(calls, 1);
  await review({ ...options, refresh: true });
  assert.equal(calls, 2);
  await fs.writeFile(path.join(input, 'b.png'), 'changed');
  const failOptions = { ...options, fetchImpl: async () => { calls++; throw new Error('SECRET'); } };
  const failed = await review(failOptions);
  assert.equal(failed.summary.counts.failed, 1);
  await review(failOptions);
  assert.equal(calls, 4);
  assert.equal(JSON.stringify(failed).includes('SECRET'), false);
  assert.equal((await fs.readFile(path.join(first.runDir, 'REPORT.md'), 'utf8')).includes('не подтверждены'), true);
});

test('CLI без input безопасен, аргументы ограничены', () => {
  for (const args of [['--limit', '11'], ['--limit', '0'], ['--timeout-seconds', '181'], ['--input'], ['--unknown'], ['--latest-audit', '--last'], ['--latest-audit', '--input', 'x']]) assert.throws(() => parseArgs(args));
  const run = spawnSync(process.execPath, [new URL('./vision-review.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')], { encoding: 'utf8' });
  assert.equal(run.status, 2);
  assert.match(run.stdout, /Использование/);
});

test('JSON fence допускается только целиком; усечённый ответ не успешен', async () => {
  const response = (content, finish_reason = 'stop') => async () => ({ ...good(), json: async () => ({ choices: [{ finish_reason, message: { content } }] }) });
  assert.deepEqual((await analyzeImage({ ...request, fetchImpl: response('```json\n{"findings":[]}\n```') })).findings, []);
  await assert.rejects(analyzeImage({ ...request, fetchImpl: response('текст\n```json\n{"findings":[]}\n```') }), { message: 'invalid_json' });
  await assert.rejects(analyzeImage({ ...request, fetchImpl: response('{"findings":[]}', 'length') }), { message: 'truncated' });
});

test('последний аудит выбирается по времени, без cache и рекурсивных снимков', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vision-audit-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const name of ['old', 'new', 'cache', 'nested']) await fs.mkdir(path.join(root, name));
  for (const name of ['old', 'new', 'cache']) await fs.writeFile(path.join(root, name, 'screen.PNG'), 'image');
  await fs.mkdir(path.join(root, 'nested', 'sub'));
  await fs.writeFile(path.join(root, 'nested', 'sub', 'screen.png'), 'image');
  await fs.utimes(path.join(root, 'old'), 100, 100);
  await fs.utimes(path.join(root, 'new'), 200, 200);
  assert.equal(await latestAudit(root), path.join(root, 'new'));
});

test('усечённый валидный JSON не кэшируется', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vision-truncated-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const input = path.join(root, 'a.png');
  await fs.writeFile(input, 'image');
  let calls = 0;
  const options = { input, model: 'local', baseUrl: 'http://localhost:1235/v1', logRoot: path.join(root, 'logs'), fetchImpl: async () => { calls++; return { ...good(), json: async () => ({ choices: [{ finish_reason: 'length', message: { content: '{"findings":[]}' } }] }) }; } };
  for (let i = 0; i < 2; i++) assert.equal((await review(options)).summary.results[0].reason, 'truncated');
  assert.equal(calls, 2);
  assert.deepEqual(await fs.readdir(path.join(root, 'logs', 'cache')), []);
});
