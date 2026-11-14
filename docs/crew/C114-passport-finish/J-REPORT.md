# C114-J — backend: мелочи паспорта и основа очереди (2026-11-14)

1. ✅ «Поставщик» → «Фирма»: `passport-rules.ts` (label и карта label→ключ, стр. 145/246), `product-passport.service.ts:656` (фильтр шаблона), spec `passport-check-product`, `passport-rules`; подмена в `pwa/passports/wire-form.js:140` убрана.
2. ✅ customerTitle → name паспорта: сервер уже принимал `name` в POST /passports и оставляет его (service.create, ownName). Экран: `funnel/api.js issueFromProduct` (+`customerTitle` → `name`), `funnel/issue.js` (`lineTitle()` из позиции заказа, передаётся при выпуске из заказа).
3. ✅ Шаги 1–2 H-REPORT: `product-passport/product-fill-weights.ts` (веса, «что открывает»), `product-fill-queue.ts` (buildFillQueue + loadFillContext), `GET /showcase/:id/fill-queue` → `{done,total,items[],scope:'passport'}` (контроллер рядом с passport-gaps, роли те же). Порядок: тип паспорта, обязательные, вес×срочность, порядок воронки. Дубли полей паспорта и изделия (габариты, вес, монтаж) не считаются дважды; пункты с умолчанием в счёт не идут. Срочность: в заказе ×2, есть выпущенный ×1,5 (флаг `urgent`). Шаг 3 (техописание) не делался.
Проверки: tsc 0; jest product-passport 61 набор / 663 теста зелёные (+6 новых в `product-fill-queue.spec.ts`); eslint новых файлов чисто; node --check трёх pwa-файлов ок. e2e не гонял.
Docs: `docs/MAP.md` (абзац C100/C028), `docs/openapi.json` правлен вручную (регенерация нужна Mongo).
Риски: openapi — ручная копия записи passport-gaps; при выкладке перегенерировать. Frontend: блок читает `fill-queue`, клик по `key` — gapKey воронки.
