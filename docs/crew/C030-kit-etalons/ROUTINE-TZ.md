# C030 — рутина: перевод 5 экранов на эталоны kit (шаг 3)

Работать в папке `D:\data-core`. Читать только: этот файл, `docs/crew/C030-kit-etalons/SPEC.md` §4 (механический перевод) и §1 (таблица), `frontend-report.md` (какие эталоны и вызовы уже сделаны), шапки эталонов в `backend/pwa/ui/kit/index.js`, и сам переводимый экран.
**Запрещено:** коммитить, ходить на сайт и в базу, читать секреты, править `backend/pwa/ui/kit/*` и `backend/src`. Запретная зона: `money*`, `kp*`, `offers*`, статьи расходов, `docs/QUESTIONS.md`.

**Экраны — по одному, в этом порядке:** `backend/pwa/sections/home.js`, `stock.js`, `supplier-catalog.js`, `dicts.js`, `salesorders.js`.

**Для каждого экрана.**
1. Заменить классы по SPEC §4: «класс X → вызов эталона Y». Только то, что в §4 и для чего эталон есть в `frontend-report.md`. Нет эталона или вызов не подходит — оставить как есть и записать в отчёт.
2. Не менять поведение, тексты, порядок блоков, обработчики. Данные и запросы — как были.
3. После экрана:
   - `node --input-type=module --check < файл` — без ошибок;
   - `node backend/scripts/design-lint.mjs` — «Итого новых: 0», итог меньше прежнего;
   - `node backend/scripts/design-lint.mjs --update-baseline` — база вниз.
4. Классы из `screens.css`, которые экран больше не использует, — не удалять (их уберёт координатор после приёмки).

**В конце** — обход стенда, если поднят: `QA_BASE=http://localhost:3102 QA_DIR=D:/data-core/tools/.night/stands/4be747d1a7b92c8e28792424 node backend/scripts/qa-smoke.mjs` → «со сбоями 0». Не поднят — написать в отчёте.

**Отчёт** — `docs/crew/C030-kit-etalons/REPORT.md` (≤ 20 строк): по экрану L3 до → после, что оставлено и почему, итог линтера, обход стенда, статус PASS / PARTIAL / FAIL.

**Модель:** средняя (Sonnet 5.5 или похожая).
