// Создание приложения-пользователя Mongo (идемпотентно).
//
// ЗАЧЕМ: MONGO_INITDB_ROOT_* из образа mongo создаёт ТОЛЬКО root — app-user
// `datacore` (readWrite на БД приложения) на пустом datadir никто не создаёт,
// и бэкенд упал бы по auth. Сервис mongo-appuser гоняет этот скрипт после
// инициализации rs0: если пользователя нет — создаёт, если есть — не трогает.
//
// ВАЖНО: значения передаются АРГУМЕНТАМИ ФУНКЦИИ, а не process.env — этот же
// скрипт должен работать и на mongo:4.4 (VM без AVX не запускает 5.0+), где
// шелл легаси и process не определён. Значения раскрывает sh в entrypoint.
var createAppUser = function (appUser, appPwd, dbName) {
  if (!appUser || !appPwd || !dbName) {
    print('ERROR: usage: createAppUser(user, password, dbname)');
    quit(1);
  }
  var appDb = db.getSiblingDB(dbName);
  if (appDb.getUser(appUser)) {
    print('app user "' + appUser + '": exists');
  } else {
    appDb.createUser({
      user: appUser,
      pwd: appPwd,
      roles: [{ role: 'readWrite', db: dbName }],
    });
    print('app user "' + appUser + '": created (db=' + dbName + ')');
  }
};
