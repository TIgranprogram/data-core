import { hasCyrillic, localizeFieldPrefix, russianFallback, translateMessage } from './error-messages-ru';
import { humanizeValidationMessage } from './http-exception.filter';

describe('Ошибки API по-русски (замечание пользователя 2026-10-19)', () => {
  it('известные английские сообщения переводятся', () => {
    expect(translateMessage('Only the system owner can create administrator accounts')).toBe('Создавать администраторов может только владелец системы.');
    expect(translateMessage('Wrong old password')).toBe('Старый пароль указан неверно.');
    expect(translateMessage('ThrottlerException: Too Many Requests')).toMatch(/Подождите минуту/);
    expect(translateMessage('Unsupported mimetype: image/heic')).toMatch(/image\/heic/);
    expect(translateMessage('E11000 duplicate key error collection: x')).toMatch(/уже есть/);
  });

  it('проверки полей: «поле: текст», русское имя поля — в самом конце', () => {
    expect(translateMessage('property foo should not exist')).toBe('foo: лишнее поле — сервер его не принимает.');
    expect(localizeFieldPrefix(humanizeValidationMessage('username should not be empty'))).toBe('Логин: заполните поле.');
    expect(localizeFieldPrefix('items.0.qty: Должно быть числом')).toBe('Количество: Должно быть числом');
  });

  it('уже русское не трогается; неизвестное английское — понятный текст по коду ответа', () => {
    expect(translateMessage('Заявка не найдена')).toBeNull();
    expect(translateMessage('Some brand new english error')).toBeNull();
    for (const s of [400, 401, 403, 404, 409, 413, 429, 500, 418]) expect(hasCyrillic(russianFallback(s))).toBe(true);
  });
});

/** ОШ.4: страж — каждый английский текст ошибки в коде сервера переводится словарём или шаблоном (иначе человек видит лишь общий текст). */
describe('английские тексты исключений — все с переводом', () => {
  it('нет английских throw без перевода в src/', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs') as typeof import('fs'); const path = require('path') as typeof import('path');
    const root = path.join(__dirname, '..', '..');
    const files: string[] = [];
    const walk = (d: string) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) files.push(p); } };
    walk(root);
    const miss: string[] = [];
    for (const f of files) for (const m of fs.readFileSync(f, 'utf8').matchAll(/Exception\(\s*'([^']*)'/g)) {
      const s = m[1];
      if (/[а-яё]/i.test(s) || !/^[A-Za-z]/.test(s)) continue;
      if (!translateMessage(s)) miss.push(`${path.relative(root, f)}: ${s}`);
    }
    expect(miss).toEqual([]);
  });
});
