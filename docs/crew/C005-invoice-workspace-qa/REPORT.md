# C005 — Smoke (только автоматика, без коммита)

**Дата:** 2026-11-03  
**Worktree:** `D:\data-core\.manus\worktrees\soorwu5tl3w6zui0j26jlr`  
**Вердикт:** **PARTIAL** (smoke-only; полная приёмка C005 не закрыта)

## Сделано

| Проверка | Результат |
|--|--|
| `node backend/scripts/pwa-import-check.mjs` | **OK** — 205 файлов, ошибок 0 |
| `node --test backend/pwa/sections/invoice-price.test.mjs` | **OK** — все кейсы зелёные |
| `node --test backend/pwa/sections/invoice-workspace.test.mjs` (статические) | **OK** — границы authoritative/fallback, partial/cancelled, paid/receipt, money=false, legacy editLine, DTO metadata, max 200 заявок |
| Каталог `.work/` | **Есть** (`debug`, `drafts`, `previews`, `qa-backup`, `qa-login`); в `.gitignore` — `/.work/`; **не коммитить** |

**Node:** v24.21.0 (локальная машина smoke-раннера).

## Не прошло / не делалось

| Пункт | Статус |
|--|--|
| Fixture `backend/pwa/fixtures/invoice-workspace.html` + клики QA (CHECKLIST) | **Не делалось** |
| Ширины 390 / 1024 / 1920 в браузере | **Не делалось** |
| `datacore-designer` (вид перед merge) | **Не делалось** |
| `tools/dc.cmd check` (tsc, jest backend) | **Не делалось** (smoke-only по поручению) |
| `invoice-workspace.test.mjs` — 10 тестов с VM-загрузкой модулей | **FAIL** — `TypeError: vm.SourceTextModule is not a constructor` (и `request-step.test.mjs` — `SyntaxError: node:vm` без экспорта `SourceTextModule` на Node 24). Похоже на несовместимость раннера с Node 24, не на синтаксис worktree (import-check чистый). Повтор на LTS Node 20/22 — в полном C005. |

## Git worktree (справка)

Много изменённых/новых файлов pwa + fixture; коммит **запрещён** до вердикта дизайнера (TZ C005).

## Следующие шаги (не в этом smoke)

1. Браузер: fixture + чек-лист кликов.  
2. Дизайнер по изменённым экранам.  
3. Перепрогон VM-тестов на Node 20/22 или правка harness под Node 24.  
4. После PASS — merge в main отдельным процессом (не C005 smoke).
