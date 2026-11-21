# C178 — frontend

Статус: код/локальная фикстура PASS, настоящие issuedhistory/PDF и независимая приёмка — координатор/backend/access.
- ✅ Generatedv1 draft/issued доступны рабочей роли; annulled/legacy/readonly/filePDF остаются просмотром с явным пояснением.
- ✅ Issued: нет «Выпустить»/смены варианта, есть «Изменить название», «Редакция N» и объяснение новой редакции с прежним номером.
- ✅ Rename открывает прежний inline NamePATCH; «Сохранить в этом паспорте» — явная локальная запись. Фирма/связи/номера не открыты обходным путём.
- ✅ Локальное описание issuedshort доступно; draftshort сохраняет прежний partsflow. Изображения через прежние защищённые endpoints.
- ✅ «Паспорта заказа» и карточка ведут в экземпляр: «Изменить паспорт»; atlas/help обновлены без новых блоков.
- Файлы: book-editor/head/blocks, passports.js, order-passport-plan.js, book-issued-edit.test.mjs, atlas/help.
- Проверки: targeted19/19, imports370/0, guards364/364, design-lintnew0; browserfixture2темы4PNG/pageerrors0, rename→save→close/reopen, number618/revision3→4.
- Фикстура настоящих editor/inline/kit/CSS с fakeAPI: серверная история и PDF ею НЕ доказаны. tools/logs/c178-ui-harness.mjs, evidence/fixture-results.json; lighteditor/darkreopened просмотрены, final lighteditor пересмотрен с новой подписью сохранения.
- SOURCE FREEZE всего PWA после конечной подписи; не коммитил/не выкладывал. Карта обновлена.

Live-находка: карточка запрашивала общий audit для ProductPassport, которого нет в RECORD_HISTORY_TYPES (400). В screenCard задан noHistory: true; существующая вкладка «Версии» с revisionList/revisionsBlock сохранена. Сервер и права аудита не расширялись. Требуется readonly live-повтор после обновления стенда.
