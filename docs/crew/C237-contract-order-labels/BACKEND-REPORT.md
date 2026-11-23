# C237 — backend

PASS: ✅ договор без productionNo печатается как «Договор №…», «Позиции договора», файл «Договор_…pdf»; настоящий заказ сохраняет прежнюю печать.
✅ Внутренний documentKind необязателен, default=order. Публичные маршруты/ответы/схемы и записи не менялись; новых запросов к БД: 0.
Файлы: `order-pdf.ts`, `production-orders.service.ts`, `order-pdf.spec.ts`, новый `production-orders.pdf.spec.ts` в salesorders.
Проверки: `npx tsc --noEmit` exit0; ESLint четырёх файлов exit0; salesorders — 10 наборов/55 тестов PASS, 6,565с.
Рендер дополнительно: 5/5 PASS, 4,241с; 3 режима (contract/order/default), header/footer/metadata; service — отсутствующий/пустой/пробельный productionNo и заказ с двумя договорами, неизменность входных строк.
PDF-артефакты: `evidence/unassigned-contract.pdf` (18/11/45, 3 обезличенные строки), `evidence/production-order.pdf` (17-26, 2 договора/14 строк).
Воспроизведение: переменные `CONTRACT_PDF_OUT`/`ORDER_PDF_OUT` с абсолютными путями, затем `npx jest src/modules/salesorders/order-pdf.spec.ts --runInBand --silent` из backend.
➖ PDF визуально пока не принят, нужен render/просмотр QA; прод и UI не проверял, коммит/выкладку не делал.
Якоря: `order-pdf.ts:21`, `production-orders.service.ts:360`, `order-pdf.spec.ts:32`, `production-orders.pdf.spec.ts:25`; карта обновлена, коммит:88fe3eff.
