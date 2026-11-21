# C172 — QA release-кандидата
Статус: backend PASS; полный FULL2:92 suites/757 tests PASS,0FAIL,1suite/12T26SKIP,610.442с,exit0. Итог raw/JSON: release-qa-full2/e2e.log и e2e-results.json.
Кандидат: clean worktree c172-passport-release, исходный HEAD0e8d326a; C171 исключён. Изменения QA — только3 e2e-файла, этот отчёт и TEST-LOG; production-код исправлял координатор/backend.
Manifest FULL2:1303 backend src/test/config/package/lock файла; before=after SHA256 eb486c14c666d29abf201c75605c5a0d3f92f5a081c9b660d81fec2fb99f7693. PWA/admin исключены из серверного fingerprint ввиду отдельного C174.
После прогона согласованно удалён только неиспользуемый type-import ClientSession в C170test;3touched-tests ESLint exit0. Полный post-manifest 1f7916a11431954b275e1359bd02caa7b54abbd4528b17cbb793edd4a68e6d30; runtime before=after 802f02b62aa52a97366d21b9460dd7a0c358988e842d598b94b7c68b4f979dbe.
Типы/сборка после runtime-fix: tsc exit0 9.864с, build exit0 11.974с; команды/UTC/пути в release-qa-fix/results.json. Повторять unit не поручалось: его выполняют штатные ворота выпуска.
Регрессии: targeted4 suites/75tests PASS43.603с; новая legacy issue readiness→HTTP detach/attach→issue PASS, затем все22C172 включены в успешный FULL2. Атомарность/история/PDF/closed/RBAC/create-race сохранены.
Первый настоящий full:752PASS/4FAIL+12SKIP606.666с. Причины:1старая фикстура без изделия (исправлена),3concurrent-create regression (backend-fix). Исходные release-qa/ и release-qa-initial-env-fail/ сохранены; не маскируются итоговым PASS.
SKIP: только12сценариев T26 каталога, отдельный опциональный disposable-контур не включён; точные имена/причина в release-qa-full2/SKIP-LIST.json. Других SKIP нет.
Изоляция: owned Mongo4.4rs0 c172-qa-mongo:27172, строго datacore-test-c172-release; штатный setup/cleanup, временный cwd/uploads. Exact test namespace whitelist расширен только release-именем; пароли/живые БД не читались.
PWA/admin/guards/unit и desktop приёмка — отдельные штатные ворота/отчёты координатора. Этот backend-PASS не объявляет принятым весь ПС-1.0: полный архив ПС-08, Inventor-исполнение и физическая печать остаются указанными ограничениями.
Ресурсы: собственный Mongo остановлен после cleanup; production/stand API, бизнес-данные и выкладку QA не меняла. Коммит:0e8d326a+release-fix; source anchors: passport-import.e2e-spec.ts:25,:324; passports.e2e-spec.ts:221.
