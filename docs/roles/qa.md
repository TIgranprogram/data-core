# Уроки роли qa

> Закрытые темы — одна строка: дата · что было · как решено · источник. Перед работой — Grep по теме здесь.

- 2026-10-24 · e2e без доступа к паролям Mongo · временный контейнер `docker run -d --name qa-e2e-mongo -p 127.0.0.1:27099:27017 mongo:4.4 --replSet rs0` + `rs.initiate`, `MONGO_URI=mongodb://127.0.0.1:27099/datacore-test?replicaSet=rs0&directConnection=true` и тестовые JWT_SECRET/JWT_REFRESH_SECRET/ADMIN_PASSWORD в команде; после — `docker rm -f` · skill datacore-verify §2
- 2026-10-24 · кэш списков С9 (DataVersion) выключен при NODE_ENV=test — e2e не ловит «старые данные сразу после записи»; такие вещи проверять на стенде :3002 · data-version.service.ts
- 2026-10-24 · e2e «лишний ключ → 400» падал (200) · харнесс test/setup/test-db.ts ставит ValidationPipe без forbidNonWhitelisted (в main.ts он есть): лишние поля в e2e просто отбрасываются; 400 на лишний ключ проверять юнитом с pipe как в main.ts · auth.e2e ШП-1
- 2026-10-24 · ключ kppd_ для пользователя без desktop:admin · в e2e `app.get(DesktopPairingKeyService).issue({id, username, …}, {label})` — ключ на нужного владельца · app-sections.e2e-spec.ts
- 2026-10-30 · списание через correct / move: reason (брак) и issuedTo (текст «кому») взаимоисключающие — 400 «Списание оформляется без заказа и сотрудника» · тест — списание только с reason, issuedTo = null · источник: stock-target.ts:79
- 2026-10-30 · e2e на параллельной БД: `MONGO_DB_TEST=datacore-test-qa npx jest --config ./test/jest-e2e.json --runInBand --forceExit` — root-URI подставляет харнесс из .env сам, отдельно передавать пароль не нужно · источник: карта qa.md
- 2026-10-30 · задача «тест рядом с /me/counters» — такого e2e не было (grep `me/counters` и `counters` по test/ — пусто): сначала grep по пути контроллера, потом решать, куда класть; новый спек — отдельный файл
- 2026-11-04 · VIEW-AS режет запись только в `api()`; `apiFile` с method POST, `confirmPassword` и `apiQuiet` идут в `raw()` · не чинить в чужих экранах, если ТЗ держит ворота в `api()` · `docs/crew/C019-admin-view-as-role/QA.md`
- 2026-11-04 · MONEY-SHOW: `DESIGNER.md` в папке аудита — вид до правки, это не «дизайнер принято»; кнопка остатков смотрит `session.role === 'admin'`, не `isAdmin` · `docs/crew/C021-money-audit/QA.md`
- 2026-11-10 · node --test `fill/model.js` тянет `traits.js` → kit → `document` на загрузке · заглушка DOM до import, интервалы сбросить после import · `fill/model.test.mjs`
- C096 (2026-11-12): сравнение снимков проверять через реальную Mongo: Mongoose minimize убирает choices:{}, fake harness этого не видит. Регрессия — одинаковые PATCH не меняют textSnapshot.at (backend/test/e2e/passports.e2e-spec.ts:284). Полный Jest e2e может упасть OOM после десятков suites: фиксировать завершённые пути, запускать только оставшиеся последовательно и объединять результаты; не заявлять неизвестное суммарное число tests.
