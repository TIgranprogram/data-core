// БЗ-14: подсчёт по таблицам базы — ТОЛЬКО ЧТЕНИЕ (ничего не пишет).
// Для каждой коллекции: записей, из них в корзине (deletedAt), последняя запись
// (max updatedAt / createdAt / время из _id), вывод TSV.
// Запуск на VM (пароль берётся из окружения контейнера, в вывод не попадает):
//   ssh datacore-vm 'docker exec -i datacore-mongo sh -c '"'"'mongo --quiet -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin datacore'"'"'' < backend/scripts/data-audit-counts.js
var names = db.getCollectionNames().filter(function (n) { return n.indexOf('system.') !== 0; }).sort();
print(['name', 'count', 'deleted', 'lastWrite'].join('\t'));
names.forEach(function (n) {
  var c = db.getCollection(n);
  var count = c.estimatedDocumentCount();
  var deleted = 0;
  try { deleted = c.countDocuments({ deletedAt: { $ne: null } }); } catch (e) { deleted = -1; }
  var last = null;
  ['updatedAt', 'createdAt'].forEach(function (f) {
    if (last) return;
    var q = {}; q[f] = { $type: 'date' };
    var s = {}; s[f] = -1;
    var d = c.find(q, { _id: 0 }).sort(s).limit(1).toArray()[0];
    if (d && d[f]) last = d[f];
  });
  if (!last) {
    var d2 = c.find({}, { _id: 1 }).sort({ _id: -1 }).limit(1).toArray()[0];
    if (d2 && d2._id && typeof d2._id.getTimestamp === 'function') last = d2._id.getTimestamp();
  }
  print([n, count, deleted, last ? last.toISOString().slice(0, 10) : ''].join('\t'));
});
