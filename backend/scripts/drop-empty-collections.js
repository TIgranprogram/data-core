// ЕБ.5 (2026-10-26): удаление ПУСТЫХ таблиц старой CRM — группа А из docs/UNIFIED-DB-MAP.md.
// Удаляет таблицу только если в ней 0 записей (иначе пропуск с числом). Без APPLY — только план.
// Запуск на VM (пароль из окружения контейнера, в вывод не попадает):
//   docker exec -i datacore-mongo sh -c 'mongo --quiet -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin datacore --eval "var APPLY=false"' ... (см. ниже)
//   план:      ... --eval 'var APPLY=false' /tmp/drop-empty-collections.js
//   выполнить: ... --eval 'var APPLY=true'  /tmp/drop-empty-collections.js
var LIST = ['actualcosts', 'cart_items', 'cart_sessions', 'catalogattachments', 'certificates', 'comments', 'compliancerules', 'desknotes',
  'document_table_types', 'financial_reports', 'form_profiles', 'generated_documents', 'import_jobs', 'import_mapping_profiles', 'import_tasks',
  'import_todos', 'interactions', 'inventorfiles', 'invoices', 'orderclosings', 'ordertasks', 'productionorders', 'purchaserequests',
  'reconciliation_acts', 'routingsteps', 'rpps', 'shipments', 'studio_documents', 'supplytasks', 'techprocesses', 'template_blocks', 'tenders',
  'text_blocks', 'workcenters', 'workorderoperations', 'workorders'];
var apply = typeof APPLY !== 'undefined' && APPLY === true;
var have = db.getCollectionNames();
var dropped = 0, skipped = 0, absent = 0;
LIST.forEach(function (n) {
  if (have.indexOf(n) < 0) { absent++; print('нет\t' + n); return; }
  var c = db.getCollection(n).countDocuments({});
  if (c !== 0) { skipped++; print('ПРОПУСК (есть записи: ' + c + ')\t' + n); return; }
  if (apply) { db.getCollection(n).drop(); dropped++; print('удалена\t' + n); } else print('удалить (0 записей)\t' + n);
});
print('Итого: ' + LIST.length + ' в списке; ' + (apply ? 'удалено ' + dropped : 'к удалению ' + (LIST.length - skipped - absent)) + ', пропущено ' + skipped + ', нет в базе ' + absent + (apply ? '' : ' — ПЛАН, ничего не удалено'));
