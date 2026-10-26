// Устанавливает переменные окружения до импорта AppModule.
// ConfigModule.forRoot() вызывается в момент импорта — нужно до него.
//
// Для e2e нужен root (datacore-user прав на datacore-test не имеет):
//   MONGO_URI=mongodb://root:<MONGO_ROOT_PASSWORD>@localhost:<MONGO_PORT>/x
//             ?replicaSet=rs0&directConnection=true&authSource=admin
// Значения берутся из .env (не попадают в чат и в код).
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Загружаем оба .env; ошибки игнорируем (CI передаёт переменные иначе).
// backend/.env — JWT и app-настройки; корневой .env — MONGO_ROOT_PASSWORD, MONGO_PORT.
const env: Record<string, string> = {};
function loadEnv(filePath: string) {
  try {
    const envFile = readFileSync(filePath, 'utf-8');
    for (const line of envFile.split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m) env[m[1]] = m[2].trim();
    }
  } catch { /* нет файла */ }
}
loadEnv(resolve(__dirname, '../../.env'));      // backend/.env
loadEnv(resolve(__dirname, '../../../.env'));   // корневой .env — MONGO_ROOT_PASSWORD, MONGO_PORT

// Выставляем переменные, только если не заданы снаружи.
for (const [k, v] of Object.entries(env)) {
  if (!process.env[k]) process.env[k] = v;
}

// Строим URI для тестов с root-доступом, если MONGO_URI не задан явно
// или указывает на непривилегированного пользователя.
if (!process.env['MONGO_URI'] || process.env['MONGO_URI'].includes('@')) {
  const port = env['MONGO_PORT'] ?? process.env['MONGO_PORT'] ?? '27017';
  const rootPw = env['MONGO_ROOT_PASSWORD'] ?? process.env['MONGO_ROOT_PASSWORD'];
  if (rootPw) {
    process.env['MONGO_URI'] =
      `mongodb://root:${rootPw}@localhost:${port}/x` +
      `?replicaSet=rs0&directConnection=true&authSource=admin`;
  }
}

process.env['JWT_SECRET'] = process.env['JWT_SECRET'] ?? 'test-secret-min-16-chars-long';
process.env['JWT_REFRESH_SECRET'] = process.env['JWT_REFRESH_SECRET'] ?? 'test-refresh-secret-min-16-chars';
process.env['ADMIN_PASSWORD'] = process.env['ADMIN_PASSWORD'] ?? 'TestAdmin12345!';
