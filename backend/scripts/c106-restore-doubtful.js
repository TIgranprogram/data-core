#!/usr/bin/env node
/**
 * C106-откат (2026-11-13): вернуть снятые C106 назначение / элементы у 9 СОМНИТЕЛЬНЫХ изделий — по журналу их значение сохранял
 * человек (до запуска C062: 3210, 5202, 5302, 5402; после: 3103, 3209, 3211, 13_1; 3208 — для единообразия), т. е. происхождение
 * «угадано скриптом» не подтверждено. Сверка — docs/crew/C106-clear-c062/AUDIT.md.
 * Возвращается ровно значение плана C062 и только в пустое поле (если с тех пор поставили своё — не трогаем). Идемпотентен.
 *
 *   MONGO_URI=… MONGO_DB=… node backend/scripts/c106-restore-doubtful.js [--apply]
 *   На проде: bash remote-access/run-script.sh c106-restore-doubtful [--apply]  (--apply сам делает бэкап)
 */
const path = require('path');
/** Строки плана C062 для этих изделий (встроены: на сервер скрипт уходит один). */
const PLAN = [{"id":"6addd770c93bb8ea2a6e3975","sku":"3211","tc":["6add909915d601111692a40f","6adb5ab2edd024ba63d7f1a2"]},{"id":"6ae12758e36900370537a629","sku":"5202","el":["6ada090c7536f8509feb4226"],"tc":["6add909915d601111692a40f","6adb5ab2edd024ba63d7f1a7"]},{"id":"6ae1275ae36900370537a633","sku":"5402","tc":["6add909915d601111692a40f","6adb5ab2edd024ba63d7f1a7"]},{"id":"6ae12759e36900370537a62e","sku":"5302","el":["6ada090c7536f8509feb4227"],"tc":["6add909915d601111692a40f","6adb5ab2edd024ba63d7f1a7"]},{"id":"6addd770c93bb8ea2a6e396c","sku":"3208","el":["6ada090c7536f8509feb4225"],"tc":["6add909915d601111692a40f","6adb5ab2edd024ba63d7f1a7"]},{"id":"6addd770c93bb8ea2a6e396f","sku":"3209","el":["6ada090c7536f8509feb4225"],"tc":["6add909915d601111692a40f","6adb5ab2edd024ba63d7f1a7"]},{"id":"6addd770c93bb8ea2a6e3972","sku":"3210","tc":["6add909915d601111692a40f","6adb5ab2edd024ba63d7f1a6"]},{"id":"6adaff322a8dad6034b14585","sku":"13_1","tc":["6add909915d601111692a40f","6adb5ab2edd024ba63d7f1a2"]},{"id":"6adaff442a8dad6034b14609","sku":"3103","el":["6ada091046ad81616709da43"],"tc":["6add909915d601111692a40f","6adb5ab2edd024ba63d7f1a1"]}];
const SKUS = ['3210', '5202', '5302', '5402', '3103', '3209', '3211', '13_1', '3208'];

function buildPlan(products) {
  const byId = new Map(products.map((p) => [String(p._id), p]));
  const out = [];
  for (const sku of SKUS) {
    const r = PLAN.find((x) => x.sku === sku);
    const p = r ? byId.get(r.id) : null;
    if (!r || !p) { out.push({ sku, skip: !r ? 'нет в плане C062' : 'изделие не найдено' }); continue; }
    const pd = p.passportDefaults || {};
    const set = {};
    if (r.el && !(pd.elements || []).length) set['passportDefaults.elements'] = r.el;
    if (r.tc && !(pd.textChoices && pd.textChoices[r.tc[0]])) set['passportDefaults.textChoices.' + r.tc[0]] = r.tc[1];
    out.push({ sku, id: String(p._id), name: String(p.name || ''), set });
  }
  return out;
}
module.exports = { buildPlan, SKUS };

if (!module.parent && !process.env.JEST_WORKER_ID) (async () => {
  const apply = process.argv.includes('--apply');
  const { MongoClient, ObjectId } = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname || process.cwd(), '..')] })).mongo;
  const client = await new MongoClient(process.env.MONGO_URI).connect();
  try {
    const db = client.db(process.env.MONGO_DB || undefined);
    const products = await db.collection('products').find({ _id: { $in: PLAN.map((r) => new ObjectId(r.id)) } }, { projection: { sku: 1, name: 1, passportDefaults: 1, deletedAt: 1, status: 1 } }).toArray();
    const plan = buildPlan(products);
    console.log('База ' + db.databaseName + ' — ' + (apply ? 'ЗАПИСЬ' : 'ПЛАН, ничего не меняется'));
    for (const r of plan) {
      if (r.skip) { console.log('  ' + r.sku + ' — пропуск: ' + r.skip); continue; }
      const what = Object.keys(r.set).map((k) => (k.includes('elements') ? 'элементы' : 'назначение')).join(' + ') || 'нечего возвращать (поле уже заполнено)';
      console.log('  ' + r.sku + ' | ' + r.name.slice(0, 50) + ' | ' + what);
    }
    if (!apply) { console.log('ПЛАН. Запись — только с --apply.'); return; }
    let n = 0;
    for (const r of plan) {
      if (r.skip || !Object.keys(r.set).length) continue;
      const $set = { updatedAt: new Date() };
      for (const [k, v] of Object.entries(r.set)) $set[k] = k.includes('elements') ? v.map((x) => new ObjectId(x)) : v;
      n += (await db.collection('products').updateOne({ _id: new ObjectId(r.id) }, { $set })).modifiedCount;
    }
    console.log('возвращено изделий: ' + n);
  } finally { await client.close(); }
})().catch((e) => { console.error(e.message); process.exit(2); });
