# Уроки роли qa

> Закрытые темы — одна строка: дата · что было · как решено · источник. Перед работой — Grep по теме здесь.

- 2026-10-24 · e2e без доступа к паролям Mongo · временный контейнер `docker run -d --name qa-e2e-mongo -p 127.0.0.1:27099:27017 mongo:4.4 --replSet rs0` + `rs.initiate`, `MONGO_URI=mongodb://127.0.0.1:27099/datacore-test?replicaSet=rs0&directConnection=true` и тестовые JWT_SECRET/JWT_REFRESH_SECRET/ADMIN_PASSWORD в команде; после — `docker rm -f` · skill datacore-verify §2
- 2026-10-24 · кэш списков С9 (DataVersion) выключен при NODE_ENV=test — e2e не ловит «старые данные сразу после записи»; такие вещи проверять на стенде :3002 · data-version.service.ts
- 2026-10-24 · e2e «лишний ключ → 400» падал (200) · харнесс test/setup/test-db.ts ставит ValidationPipe без forbidNonWhitelisted (в main.ts он есть): лишние поля в e2e просто отбрасываются; 400 на лишний ключ проверять юнитом с pipe как в main.ts · auth.e2e ШП-1
- 2026-10-24 · ключ kppd_ для пользователя без desktop:admin · в e2e `app.get(DesktopPairingKeyService).issue({id, username, …}, {label})` — ключ на нужного владельца · app-sections.e2e-spec.ts
