// Разовая инициализация пользователей Mongo (задача B: включение --auth).
//
// Зачем: на локальном контуре каталог данных уже существует, поэтому штатный
// MONGO_INITDB_ROOT_USERNAME из образа mongo НЕ срабатывает (initdb-скрипты
// идут только на пустом datadir). Пользователей создаём руками ДО включения --auth,
// пока подключение ещё не требует пароля.
//
// Запуск (пароли передаются как переменные окружения, в репозиторий не попадают):
//   docker exec -i \
//     -e MONGO_ROOT_PASSWORD -e MONGO_APP_PASSWORD \
//     datacore-mongo mongosh --quiet < backend/scripts/mongo-bootstrap-auth.js
//
// ВАЖНО: после включения --auth этот же скрипт уже НЕ выполнится без пароля —
// он предназначен только для первичного бутстрапа.
var admin = db.getSiblingDB('admin');
var dc = db.getSiblingDB('datacore');

var rootPwd = process.env.MONGO_ROOT_PASSWORD;
var appPwd = process.env.MONGO_APP_PASSWORD;
if (!rootPwd || !appPwd) {
  print('ERROR: MONGO_ROOT_PASSWORD / MONGO_APP_PASSWORD are required');
  quit(1);
}

if (!admin.getUser('root')) {
  admin.createUser({
    user: 'root',
    pwd: rootPwd,
    roles: [{ role: 'root', db: 'admin' }],
  });
  print('root: created');
} else {
  print('root: exists');
}

if (!dc.getUser('datacore')) {
  dc.createUser({
    user: 'datacore',
    pwd: appPwd,
    roles: [{ role: 'readWrite', db: 'datacore' }],
  });
  print('datacore: created');
} else {
  print('datacore: exists');
}

print('admin users: ' + JSON.stringify(admin.getUsers().map(function (u) { return u.user; })));
print('datacore users: ' + JSON.stringify(dc.getUsers().map(function (u) { return u.user; })));
