/* Тестовый вход для ДОМАШНЕГО стенда (проверка экранов ИИ и дизайнером). На проде не запускать.
 *
 *   docker exec -w /app -e STAND=1 -e STAND_PASSWORD=… datacore-backend node scripts/stand-test-user.js
 *   Логин: stand-test (роль admin). Есть — пароль обновляется. Пароль — из STAND_PASSWORD (≥ 12 знаков).
 *   Защита: отказ, если STAND=1 не задан (задаётся в вызове docker exec).
 */
const path = require('path');

(async () => {
  if (process.env.STAND !== '1') throw new Error('Только для домашнего стенда: задайте STAND=1');
  const uri = process.env.MONGO_URI; const pass = process.env.STAND_PASSWORD || '';
  if (!uri) throw new Error('MONGO_URI не задан');
  if (pass.length < 12) throw new Error('STAND_PASSWORD короче 12 знаков');
  const req = (m) => require(require.resolve(m, { paths: [process.cwd(), path.join(__dirname, '..')] }));
  const { MongoClient } = req('mongoose').mongo; const bcrypt = req('bcryptjs');
  const client = await MongoClient.connect(uri);
  try {
    const users = client.db(process.env.MONGO_DB || undefined).collection('users');
    const now = new Date(); const passwordHash = await bcrypt.hash(pass, 10);
    const r = await users.updateOne({ username: 'stand-test' }, {
      $set: { passwordHash, isActive: true, role: 'admin', deletedAt: null, updatedAt: now },
      $setOnInsert: { username: 'stand-test', email: 'stand-test@stand.test', displayName: 'Проверка (стенд)', fullName: 'Проверка (стенд)', permissions: [], createdAt: now },
    }, { upsert: true });
    console.log(r.upsertedCount ? 'Создан вход stand-test' : 'Пароль stand-test обновлён');
  } finally { await client.close(); }
})().catch((e) => { console.error(e.message || e); process.exit(1); });
