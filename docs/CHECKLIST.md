# CHECKLIST — рабочий чек-лист выполнения

> Порядок выполнения. Обновляй по мере прохождения: `[x]` = сделано.
> Контекст — [ROADMAP.md](ROADMAP.md), [VISION.md](../VISION.md).

## 🔥 Приоритет

- [x] **A1. Страница «Таблицы» в админке** — справочник всех коллекций MongoDB:
  - [x] A1.1 Backend: `GET /api/admin/collections` (админ-only) — список коллекций, счётчик записей, поля с типами/примерами/заполненностью
  - [x] A1.2 Admin UI: вкладка «Таблицы» — таблица, строка раскрывается и показывает поля
  - [x] A1.3 Поиск по названию коллекции, описания ключевых таблиц
  - [x] A1.4 Проверка end-to-end в браузере (91 коллекция, раскрытие users: 16 полей, маскировка `passwordHash=***`)

## 📋 Остальное из ROADMAP (P0/P1)

- [x] **B. Mongo auth (P0.4)** — `--auth` + root/app-user в compose; бэкенд с `authSource`; 27017 не наружу
  - done: `--auth`+`--keyFile`, users root/datacore, no-auth read → rejected, LAN:27018 → False, backup.sh авторизован
- [x] **C. Restore-дрилл (P0.3)** — mongodump → восстановить в тестовую БД → данные читаются
  - done: `datacore_restore_test` 91 коллекция/107 доков → ALL COUNTS MATCH, scratch удалена
- [ ] **D. Cron бэкапов на VM (P0.3)** — после деплоя: `0 3 * * *` + ретеншен 14 дней
- [x] **E. OpenAPI экспорт (P1.6)** — скрипт экспорта `openapi.json` в репозиторий
  - done: `pnpm openapi:export` (общая swagger-конфиг с UI) → `docs/openapi.json`, 373 paths
- [x] **F. Деплой-скрипты под data-core (P1.8)** — `deploy.py`/`deploy.ps1`/`deploy.sh` без kppdf-балласта
  - done: `deploy.py` переписан (без NX-фронта/desktop-installer, `/opt/data-core`, `/var/lib/datacore`, порт 3001, контейнеры `datacore-*`, `.env` с MONGO_* креденшелами, проверка Mongo-auth после деплоя); `deploy.ps1` — снят kppdf-only гейт TZ-OPS-310 (в этом репо нет `tasks/` — он бы жёстко блокировал деплой); `preflight.ps1` — проверяет `backend/admin` вместо `frontend/src` + обязательность MONGO_* ключей; `config.env.example` переписан; архив исключает `config.env`/`CREDENTIALS.md` (проверено тестом)
- [ ] **G. Деплой на VM отдельным контуром (P1.8)** — `/opt/data-core`, `:3001`, не трогая kppdf; затем cron (D)
- [ ] **H. Чистка CRM-модулей (P1.5)** — оставить ядро, удалить CRM-домен; typecheck+build+тесты зелёные
- [ ] **I. Финал** — обновить ROADMAP/README/CHECKLIST по факту, единый коммит(ы)

## ⛔ Вне автономного выполнения (нужен доступ/участие)

- [ ] J1. Подключение Google Таблицы (P0.2) — нужен реальный Google-аккаунут/таблица
- [ ] J2. Копия бэкапов вне NAS (P0.3) — USB/второй физический диск
- [ ] J3. Смена дефолтного пароля админа — делается вручную в админке

---

_Статус обновляется по ходу. Старт: A1._
