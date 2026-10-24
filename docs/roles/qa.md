# Уроки роли qa

> Закрытые темы — одна строка: дата · что было · как решено · источник. Перед работой — Grep по теме здесь.

- 2026-10-24 · e2e без доступа к паролям Mongo · временный контейнер `docker run -d --name qa-e2e-mongo -p 127.0.0.1:27099:27017 mongo:4.4 --replSet rs0` + `rs.initiate`, `MONGO_URI=mongodb://127.0.0.1:27099/datacore-test?replicaSet=rs0&directConnection=true` и тестовые JWT_SECRET/JWT_REFRESH_SECRET/ADMIN_PASSWORD в команде; после — `docker rm -f` · skill datacore-verify §2
- 2026-10-24 · кэш списков С9 (DataVersion) выключен при NODE_ENV=test — e2e не ловит «старые данные сразу после записи»; такие вещи проверять на стенде :3002 · data-version.service.ts
