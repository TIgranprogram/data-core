# Редкие ловушки (вынесены из AGENTS.md 2026-10-25)

Частые — в `AGENTS.md` «Известные ловушки». Общие с CRM таблицы `kind:'crm'` — AGENTS «Жёсткие правила» №4.

- Мусорный ObjectId → `CastError` → глобальный фильтр отдаёт **400** (не 500).
- Mongoose `ValidationError` → тоже **400** с полем и `missing`; у ответа 500 есть `errorId` — тот же код в журнале: `docker logs datacore-backend | grep 'сбой КОД'` (журнал теряется при пересоздании контейнера выкладкой).
- Rate-limit: глобально 10/с и 100/мин, `/auth/login` — 5/мин и 20/час. Серия запросов без пауз → 429, это не баг.
- `GET /api/admin/users` через `kppd_`-ключ → `total:0`: owner-админ скрыт от не-owner актора (TZ-AUTH-306). Не баг.
- `AuditService.log` приводит `entityId` к ObjectId — не-hex строку туда не клади (пиши в `details`).
- **Никогда не запускай `bash -x` / `set -x` на скриптах, которые читают `.env`** — трассировка печатает секреты (инцидент 2026-10-18, T22).
- Windows/Git Bash: `docker exec` с путями `/tmp/...` ломается → `MSYS_NO_PATHCONV=1`.
