const { ObjectId } = require('mongoose').mongo;

/** CLI работает с тем же барьером договора, что и API (common/order-archive/write.ts). */
async function claimOrderWrites(db, session, orderIds) {
  const ids = [...new Set(orderIds.filter(id => id != null).map(String))].sort();
  for (const id of ids) {
    const _id = new ObjectId(id);
    const result = await db.collection('salesorders').updateOne(
      { _id, activeArchiveVersion: null }, { $inc: { passportGuard: 1 } }, { session },
    );
    if (!result.matchedCount) {
      if (await db.collection('salesorders').findOne({ _id }, { session, projection: { _id: 1 } })) {
        throw Object.assign(new Error(`Договор ${id} пропущен: он в архиве.`), { code: 'ORDER_ARCHIVED' });
      }
      throw new Error(`Договор ${id} не найден. Импорт не может менять его.`);
    }
  }
}

async function claimPassportWrites(db, session, passports) {
  const lineIds = [...new Set(passports.filter(p => p.incomeId).map(p => String(p.incomeId)))];
  const lines = await db.collection('incomes').find({ _id: { $in: lineIds.map(id => new ObjectId(id)) } }, { session, projection: { orderId: 1 } }).toArray();
  if (lines.length !== lineIds.length) throw new Error('Связь паспорта с позицией не подтверждена. Запись остановлена.');
  await claimOrderWrites(db, session, [...passports.map(p => p.salesOrderId), ...lines.map(line => line.orderId)]);
}

async function withArchiveWrite(client, write) {
  const session = client.startSession();
  try { return await session.withTransaction(() => write(session)); }
  finally { await session.endSession(); }
}

module.exports = { claimOrderWrites, claimPassportWrites, withArchiveWrite };
