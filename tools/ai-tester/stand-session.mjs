export const SESSION_STAND = 'http://localhost:3102';

/** Сессия на один процесс. Stdin читается один раз даже при ошибке или параллельном входе. */
export function sessionFromStdin(stdin) {
  let session;
  return (base) => {
    if (base !== SESSION_STAND) throw new Error('Вход через stdin разрешён только на http://localhost:3102.');
    return session ??= readSession(stdin);
  };
}

async function readSession(stdin) {
  try {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of stdin) {
      const buffer = Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > 65536) throw new Error();
      chunks.push(buffer);
    }
    const { access, refresh, user } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const token = (value) => typeof value === 'string' && /^[!-~]+$/.test(value);
    if (token(access) && token(refresh) && user && typeof user === 'object' && !Array.isArray(user)) {
      return { access, refresh, user };
    }
  } catch { /* В ошибке не должно быть содержимого stdin. */ }
  throw new Error('Не удалось прочитать сессию стенда из stdin.');
}
