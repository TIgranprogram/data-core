// Разовая инициализация пользователей Mongo (задача B: включение --auth).
//
// ЗАЧЕМ: на локальном контуре каталог данных уже существует, поэтому штатный
// MONGO_INITDB_ROOT_USERNAME из образа mongo НЕ срабатывает (initdb-скрипты
// идут только на пустом datadir). Пользователей создаём руками ДО включения --auth,
// пока подключение ещё не требует пароля.
//
// Запуск (пароли приходят АРГУМЕНТАМИ — этот скрипт должен работать и на
// mongo:4.4, где легаси-шелл не знает process.env):
//   docker exec -i datacore-mongo sh -c \
//     'mongo --quiet' < backend/scripts/mongo-bootstrap-auth.js <(echo '...')
//   либо проще — задать их через sh и передать в JS:
//     docker exec -i datacore-mongo sh -c 'mongo --quiet' <<EOF
//     var ROOT_PWD='...'; var APP_PWD='...'; ...
//     EOF
//   (см. комментарий к вызову в docs/HISTORY.md; на mongo:5+ шелл mongosh)
//
// ВАЖНО: после включения --auth этот же скрипт уже НЕ выполнится без пароля —
// он предназначен только для первичного бутстрапа.
//
// Пароли приходят из переменных sh и вставляются в JS через конкатенацию строк.
var bootstrapAuth = function (rootPwd, appPwd, appUser, dbName) {
  var admin = db.getSiblingDB('admin');
  var dc = db.getSiblingDB(dbName);

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

  if (!dc.getUser(appUser)) {
    dc.createUser({
      user: appUser,
      pwd: appPwd,
      roles: [{ role: 'readWrite', db: dbName }],
    });
    print(appUser + ': created');
  } else {
    print(appUser + ': exists');
  }

  print('admin users: OK');
};

if (typeof ROOT_PWD === 'undefined' || typeof APP_PWD === 'undefined') {
  print('ERROR: задай ROOT_PWD и APP_PWD перед вызовом bootstrapAuth(rootPwd, appPwd)');
  quit(1);
}
bootstrapAuth(
  ROOT_PWD,
  APP_PWD,
  typeof APP_USER === 'undefined' ? 'datacore' : APP_USER,
  typeof DB_NAME === 'undefined' ? 'datacore' : DB_NAME,
);
