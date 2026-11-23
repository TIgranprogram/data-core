# C244 — фото сопоставленного изделия
PASS авторской проверки | ✅ common/product-photos.ts — общий batch resolver; showcase-photos.ts — совместимый adapter без common→showcase импорта.
✅ loadLinePhotos: пригодное ownфото позиции→явный каталог→live passportoverview→legacyoverview→null; порядок own/overview/legacy сохранён, mainPhotoId не добавлен.
✅ Проверены валидные24hexID/liveoriginal/variants/safeUploadPath; битые/удалённые/unsafe/чужиеproduct-kind-purpose не подставляются, следующий пригодный кандидат доступен.
✅ 1и100строк одного изделия требуют одинаковые5batchreadqueries в реальном resolver unit; нет template/PDF/detailN+1/новогоcache и runtimeзаписи photoIds/копий.
Файлы frozen: common/{photos.ts,product-photos.ts,photos.spec.ts,product-photos.spec.ts}, showcase/showcase-photos.ts, test/e2e/c244-order-product-photo.e2e-spec.ts; SHA в qa/author-freeze.json, BASEf6b35fc5.
Проверки: relatedunit33suites/191testsPASS10.405s; owned27237/datacore-test-c244-photo HTTP4/4PASS12.268s; tsc0/ESLint0(включаяe2e--no-ignore)/diffcheck0. Авторские Jest завершены,currentOpnamespace+alltx=[]; labels/loopback проверены.
HTTP: showcase/salesorder/production/lookup согласованы; incomeoriginal/catalog/importpriority; deleted/wrongkind/сменаproduct; closedliveGET и frozenarchiveGET/download сохраняют bundle/chunks/байты/SHA. linesLookup explicit-only контракт оставлен прежним. Querybound измерен unit, не выдаётся за HTTPcommandcounter.
Первый новыйHTTPfixture исправлен по фактическому контракту: attachphoto возвращает200, архиву нужны shipments[]; изменялись только эти тестовые входы/ожидания. Итоговый реальный маршрут сохраняет свои коды.
Cache: callers detail/lookup/shipments/reservations здесь читают динамически. Productionlist отдельно cached и намеренно coverPhoto:null(C017), фото туда не добавлялось; dependencies этого cache не менялись.
➖ Независимые QA/архитектор/заполненная визуальная приёмка/общийfull — координатор. Физическую доступность реальных файлов подтверждает отдельный access/browser; resolver проверяет live metadata/safeURL.
Не коммитил/не выкладывал, прод/секреты не трогал; карта обновлена, коммит:f6b35fc5.
