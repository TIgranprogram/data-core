import assert from 'node:assert/strict';
import test from 'node:test';
import { createErrorContext, diagnosticClick, diagnosticHttpMessage, diagnosticPath, diagnosticRoute, reportableHttpError, scrubDiagnostic, withoutActionTrace } from './error-context.js';

test('HTTP400/403/404/409/422 сохраняются, auth/журнал/локальный просмотр исключены', () => {
  for (const status of [400, 403, 404, 409, 422, 429, 500]) assert.equal(reportableHttpError({ status }, '/partners/undefined'), true);
  for (const path of ['/auth/login', '/api/auth/refresh', '/client-errors', '/api/client-errors/top']) {
    assert.equal(reportableHttpError({ status: 400 }, path), false);
  }
  assert.equal(reportableHttpError({ status: 403, viewAs: true }, '/incomes/1'), false);
  assert.equal(reportableHttpError({ status: 200 }, '/incomes/1'), false);
});

test('маршрут сохраняет тип и технический id, но никогда поисковые запросы/название заказчика/токены', () => {
  const route = diagnosticRoute('#partners?of=salesorder&open=undefined&tab=pos&search=PRIVATE&token=PRIVATE');
  assert.equal(route, 'partners of=salesorder tab=pos open=undefined');
  assert.equal(diagnosticRoute('#partners?open=c%3APRIVATE'), 'partners open=customer-name-hidden');
  assert.equal(diagnosticRoute('#partners?open=PRIVATE'), 'partners open=invalid-id(length=7)');
  assert.equal(diagnosticRoute('#kppd_secret?of=kppd_private&tab=kppd_hidden'), 'home');
  assert.equal(diagnosticRoute('#eyJtest.payload.signature'), 'home');
});

test('след ограничен, отмечает исходный и ошибочный маршрут, очищается', () => {
  const trace = createErrorContext(2);
  trace.add('начало', '#partners');
  trace.add('Выбрать изделие', '#partners?of=orders&open=111111111111111111111111');
  trace.add('Отмена', '#partners?of=orders&open=111111111111111111111111');
  const text = trace.text('#partners?open=undefined&search=PRIVATE');
  assert.equal(text.includes('начало'), false);
  assert.match(text, /Выбрать изделие.*of=orders/);
  assert.match(text, /сбой · partners open=undefined/);
  assert.equal(text.includes('PRIVATE'), false);
  trace.clear();
  assert.equal(trace.text('#home'), 'сбой · home');
});

test('поля и варианты ввода вообще не читаются, подпись записи не копируется', () => {
  const input = { closest: () => true, get value() { throw Error('читать форму запрещено'); } };
  assert.equal(diagnosticClick(input), '');
  const anchor = { tagName: 'A', getAttribute: (key) => key === 'href' ? '#partners?open=c%3APRIVATE&search=PRIVATE' : null,
    get textContent() { throw Error('читать имя ссылки запрещено'); } };
  assert.equal(diagnosticClick({ closest: (selector) => selector.startsWith('input') ? null : anchor }), 'ссылка → partners open=customer-name-hidden');
});

test('из служебных сообщений и стека удаляются ключи и query', () => {
  const result = scrubDiagnostic('Bearer hidden-value kppd_private-key eyJtest.payload.signature\n/app?search=PRIVATE');
  for (const secret of ['hidden-value', 'private-key', 'eyJtest', 'PRIVATE']) assert.equal(result.includes(secret), false);
});

test('отражённый сервером текст формы не становится диагностикой, обычный JS Error не теряется', () => {
  assert.equal(diagnosticHttpMessage({ status: 400, message: 'Товар PRIVATE уже существует\n    at PRIVATE' }), 'Запрос отклонён: HTTP 400');
  assert.equal(diagnosticHttpMessage(new Error('Ошибка кода')), 'Ошибка кода');
  assert.equal(diagnosticHttpMessage({ status: 400, message: 'Некорректный id контрагента' }), 'Некорректный id контрагента');
  assert.equal(diagnosticPath('/partners/c%3APRIVATE?search=PRIVATE'), '/partners/customer-name-hidden');
  assert.equal(diagnosticPath('/partners/undefined'), '/partners/undefined');
});

test('резервная копия очереди не сохраняет траекторию действий', () => {
  const original = { message: 'сбой', stack: 'TypeError: сбой\nКонтекст действий:\nОтмена · partners open=undefined' };
  assert.equal(withoutActionTrace(original).stack, 'TypeError: сбой');
  assert.match(original.stack, /Контекст действий/);
  assert.equal(withoutActionTrace({ message: 'сбой', stack: '\nКонтекст действий:\nсекрет' }).stack, undefined);
});
