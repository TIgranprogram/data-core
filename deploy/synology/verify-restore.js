// Дрилл восстановления (задача C): сверка source vs restored.
// Запуск (легаси-шелл mongo:4.4 или mongosh 5+):
//   docker exec -i datacore-mongo sh -c 'BIN=$(command -v mongosh || command -v mongo); $BIN --quiet -u root -p ... --authenticationDatabase admin' < verify-restore.js
// ВАЖНО: countDocuments() вызывается с ЯВНЫМ {} — легаси-шелл 4.4 падает на
// countDocuments() без аргументов ("the match filter must be an expression").
var src = db.getSiblingDB('datacore');
var dst = db.getSiblingDB('datacore_restore_test');

var cols = src.getCollectionNames().sort();
var totalSrc = 0;
var totalDst = 0;
var mismatch = [];

cols.forEach(function (c) {
  var a = src.getCollection(c).countDocuments({});
  var b = dst.getCollection(c) ? dst.getCollection(c).countDocuments({}) : -1;
  totalSrc += a;
  totalDst += Math.max(b, 0);
  if (a !== b) mismatch.push(c + ': ' + a + ' vs ' + b);
});

print('collections=' + cols.length + ' srcDocs=' + totalSrc + ' restoredDocs=' + totalDst);
print(mismatch.length ? 'MISMATCH: ' + mismatch.join(', ') : 'ALL COUNTS MATCH');

var u = dst.getCollection('users').findOne({ username: 'admin' });
print(u ? 'admin doc readable: role=' + u.role + ' isOwner=' + u.isOwner : 'admin doc MISSING');
