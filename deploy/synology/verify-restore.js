// Дрилл восстановления (задача C): сверка source vs restored.
// Запуск: docker exec -i datacore-mongo mongosh --quiet -u root -p ... --authenticationDatabase admin < verify-restore.js
var src = db.getSiblingDB('datacore');
var dst = db.getSiblingDB('datacore_restore_test');

var cols = src.getCollectionNames().sort();
var totalSrc = 0;
var totalDst = 0;
var mismatch = [];

cols.forEach(function (c) {
  var a = src.getCollection(c).countDocuments();
  var b = dst.getCollection(c) ? dst.getCollection(c).countDocuments() : -1;
  totalSrc += a;
  totalDst += Math.max(b, 0);
  if (a !== b) mismatch.push(c + ': ' + a + ' vs ' + b);
});

print('collections=' + cols.length + ' srcDocs=' + totalSrc + ' restoredDocs=' + totalDst);
print(mismatch.length ? 'MISMATCH: ' + mismatch.join(', ') : 'ALL COUNTS MATCH');

var u = dst.getCollection('users').findOne({ username: 'admin' });
print(u ? 'admin doc readable: role=' + u.role + ' isOwner=' + u.isOwner : 'admin doc MISSING');
