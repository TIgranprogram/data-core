# Индекс доказательств

Пути — от корня репо `D:\data-core`. Команды — только чтение.

| Метка | Что подтверждает | Где |
|--|--|--|
| E-1 | Цель «универсальное ядро», принципы, «37 модулей» | `VISION.md` §2–3 (стр. 14–43), §5 (стр. 63) |
| E-2 | README: «работает офлайн», «Restore проверен» | `README.md` (адреса; «Безопасность и бэкапы») |
| E-3 | Решения владельца: одно приложение, CRM заморожена, онлайн, «главное — паспорта и КП», расхождения PRODUCT с кодом | `docs/PRODUCT.md` «Решения», «Расхождения с кодом» |
| E-4 | 72 модуля; ~68 тыс. строк TS без тестов | `ls backend/src/modules`; `find backend/src -name '*.ts' ! -name '*.spec.ts' \| xargs cat \| wc -l` |
| E-5 | PWA: 293 файла, ~37 тыс. строк | `find backend/pwa -name '*.js'` |
| E-6 | Единая база с kppdf, прямой писатель, общие коллекции | `docs/ARCHITECTURE.md` «Единая база»; `AGENTS.md` «Известные ловушки» |
| E-7 | Выкладки, проверки, расхождения тегов (v1.617, v1.665, v1.717, v1.770) | `docs/HISTORY.md`; `docs/BACKLOG.md` «▶ Сейчас» п. 0 |
| E-8 | 1888 коммитов с 2026-10-17; темп по дням | `git log --format=%ad --date=short \| uniq -c` |
| E-9 | Прод: health ok, сборка 770, копия 5 ч | `node tools/dc.mjs status` → `tools/logs/20261113-212535-status.log` |
| E-10 | tsc 0; юнит 334/3441 PASS; 121 node-тест; 74 e2e-файла | прогон 13.11 в этом аудите; `find … -name '*.test.mjs'`; `ls backend/test/e2e` |
| E-11 | `docs` 101 МБ, `docs/crew` 95 МБ, `.git` 175 МБ, ~43 тыс. строк md | `du -sh`; `find docs -name '*.md' \| xargs cat \| wc -l` |
| E-12 | Прежний полный аудит и его находки | `docs/crew/C068-project-audit/SUMMARY.md` |
| E-13 | Авторы: владелец + «Nova»; соавторы Claude разных версий; упоминания Codex, Manus, Cursor | `git log --format=%an`; `Co-Authored-By`; `MANUS.md`; `.cursor/rules`; TEST-LOG 13.11 «(Codex)» |
| E-14 | Самые большие файлы (admin.js 1833; dicts.defs 930; product-passport.service 888; supply 826/818) | `find … -exec wc -l` |
| E-15 | Ворота и эксплуатация | `deploy/synology/preflight.sh`, `release.sh`, `doctor.sh`; `CLAUDE.md` «Метки коммита» |
| E-16 | Инструменты ИИ-процесса | `tools/`, `pult/`, `mcp/`, `.claude/agents` (9), `.claude/skills` (5), `docs/roles/` |
| E-17 | ~885 вызовов `.collection(` в обход моделей | `grep -rn "\.collection(" backend/src --include=*.ts \| grep -v spec \| wc -l` |
| E-18 | Оптимистичная блокировка только у product, material, category, organization, счёта | `grep -rln optimistic-lock backend/src`; `supply/dto-invoice.ts:51` |
| E-19 | Нет теста «у каждого маршрута есть права» | поиск `DiscoveryService\|PATH_METADATA\|getControllers` по `*.spec.ts` — пусто |
| E-20 | Решение «остановить CRM» (31.10) не выполнено | `docs/BACKLOG.md` «Ждёт владельца»; `docs/QUESTIONS.md` стр. 19 |
| E-21 | Два сервера: запасной v1.685, refresh failed, обратное переключение не доведено | `docs/CONTROL.md` «Серверы»; `deploy/ha`, `SRV-ERP` (~1,75 тыс. строк) |
| E-22 | Ошибки сайта за 7 дней: 67 видов / 91 случай, медленные экраны | `node tools/dc.mjs errors 168` → `tools/logs/20261113-212537-errors.log` |
| E-23 | 676 записей «требуют заполнения» | `node tools/dc.mjs data` → `tools/logs/20261113-212544-data.log` |
| E-24 | Последние e2e по журналу: 74 набора, 553 теста, 12 пропущено | `docs/TEST-LOG.md` стр. 177–179 |
| E-25 | Риски: пароль admin, копия вне дома, восстановление, печать не проверена | `docs/CONTROL.md` «Риски», «Локальная работа» |
| E-26 | Готовность заказа: состояние `unknown` | `backend/src/modules/salesorders/order-readiness.ts:11–27` |
| E-27 | Цены КП → заказ | `backend/src/modules/offers/offers.order-prices.spec.ts:9–31` |
| E-28 | `/uploads` — статическая отдача | `backend/src/main.ts:131–133` |
| E-29 | Коммиты с 06.11: всего 560, «паспорт» 129, «КП/offer» 20 | `git log --since=2026-11-06 --format=%s \| grep -ci …` |
| E-30 | Ошибка «module '../common.js' does not provide an export» 13.11 15:36; экспорты сейчас на месте | лог E-22; `grep export backend/pwa/sections/passports/common.js` |
| E-31 | Касания файлов за 14 дней: pwa 1830, crew 1602, src 1317, archive 292, roles 224, TASKS 119, TEST-LOG 92 … | `git log --since=2026-10-30 --name-only` |
| E-32 | `tests_ai_tiit` — «тема закрыта 2026-11-03», 81 файл в git | `tests_ai_tiit/ГЛАВНЫЙ_ОРКЕСТРАТОР.md` стр. 3 |
| E-33 | Открытые задачи: 151 `[ ]`, 33 `[~]`; 71 строка доски crew | `grep -c` по `docs/TASKS.md`, `docs/crew/BOARD.md` |
| E-34 | Использование на проде (роли, действия, записи) | ответ агента `datacore-access`, чтение API 13.11 — см. `02_PURPOSE_AND_VALUE.md` |
| E-35 | Падение числа юнит-тестов 3895 → 3428 (12–13.11) объяснено: удалены тесты угадывания по названию (C100) | `git log --diff-filter=D` → `fb9a7eaf` |
