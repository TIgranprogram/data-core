# Промпт для параллельной сессии — C057-Э2б: приложение ↔ сервер на стенде, 6104 целиком

> Для Cursor / второй сессии. Продолжение Э2 (коммит ea1e7ae1, отчёт `REPORT-E2.md`).

---

Ты — исполнитель **C057-Э2б** в проекте data-core (`D:\invSportiN\Сайт\01_Проекты_CRM\data-core`). Роль одна — разработчик приложения `apps/pdm-loader/`. Координатор — другая сессия.

**Что уже есть:**
- Твоё приложение: сверка 6104 — 110 из 110 (`REPORT-E2.md`).
- Сервер Э1 в main: `POST /api/pdm-import/preview`, `/apply`, `/files`, `GET /api/apps/pdm-loader` — коммиты 5fd3c3ae, 13d5c61b, b21899b2, 3cc58f90. Отчёты: `REPORT-E1-part2.md` (поля ответа preview: `items[].action/fields/candidates`, `planId`, `needFiles`), `REPORT-E1-part3.md`.
- Договор — `CONTRACT.md` (не менять; в `warnings.code` добавлены `config-conflict`, `no-blank`, `no-bom`).

**Сделать:**
1. `git pull`. Поднять локальный стенд с новым сервером: из корня `docker compose up -d --build` (API `http://localhost:3001`). Вход — тестовый пользователь-админ стенда (из сидов/примеров конфигурации проекта; на прод не ходить).
2. «Проверить на сайте» → preview по 6104 → показать в дереве: новое / уже есть / похоже (выбор кандидата) / расхождение (таблица «Сайт | PDM» с выбором по полю) / без изменений; кнопка «Обновить всё из PDM».
3. «Загрузить на сайт» → apply (`planId` + решения) → files по `needFiles` (по одному, с повтором; JWT обновлять через `/api/auth/refresh`). 409 → «Данные на сайте изменились — проверьте ещё раз».
4. **Прогон 6104 на стенде** (это приёмка): первая загрузка → цифры created/linked; **повторная** загрузка → 0 новых; `GET /api/products/<id>/purchase-needs?qty=1` → лист 4 мм, фанера, метизы — сохранить ответ в `samples/6104.purchase-needs.json`; `GET /api/pdm-files?ownerKind=material&ownerId=<0000.0000.0019>` → DXF v-текущая. Ошибки сервера — **не чинить**, записать в REPORT (запрос, ответ, ожидание) — чинит координатор.
5. Превью-картинки (было «недоделано»): из PDM без SolidWorks; нет — первая страница PDF (`Windows.Data.Pdf`); PNG ≤ 800 px. Картинка уходит на сайт как фото позиции — **пока только в пакет** (`previews/`); загрузку фото на сайт сделает сервер позже (запиши, что нужно).
6. `apps/pdm-loader/publish.ps1`: `dotnet publish` → `out/<версия>/DataCore.PdmLoader.exe` + `meta.json` (`version, size, sha256, uploadedAt`) — формат, который читает сервер (`backend/src/modules/apps/apps.service.ts`, только читать).

**Правила:**
- Твои пути — только `apps/pdm-loader/`, `docs/crew/C057-pdm-import/REPORT-E2.md`, `docs/crew/C057-pdm-import/samples/`. `backend/`, `pult/`, `deploy/`, прочие `docs/` — не трогать.
- PDM — только чтение. Прод — никогда.
- Коммит только своих путей (`git commit -- <пути>`), по-русски, `feat(pdm-loader): …`, последняя строка `🏠 Продолжаю работать дома`. Пуш после каждого шага.
- Всё на экране — по-русски.

**Итог:** дописать `REPORT-E2.md` (раздел «Э2б»: цифры первой и повторной загрузки, purchase-needs, найденные ошибки сервера); в чат ≤ 10 строк.
