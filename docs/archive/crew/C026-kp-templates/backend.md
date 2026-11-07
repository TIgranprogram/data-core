# C026 KP-2 — отчёт backend (этап 1)

Статус: готово, не закоммичено. Проверки: `npx tsc --noEmit` 0; `npx jest offers incomes setting` 9 suites / 110 tests; полный `npx jest` 262 suites / 2519 tests зелёные; eslint offers + offers-only без замечаний.

## Пункты ТЗ
1. Схемы и DTO — `offer.schema.ts` (объект, НДС, доставка, copyOf; у бланка textTop/textBottom/defaultTerms), `dto.ts` (+UpdateBackgroundDto, OfferCopyDto, OfferCompanyDto). ✅
2. Зоны — `offer-layout.ts` `zoneOf(page, zones?)`, `paginateRows/placeBlock` с зонами; `offer-backgrounds.service.ts` `resolve()` → `{jpeg,textTop,textBottom}`. Старый offer-layout.spec прошёл без правки (дописаны новые тесты). ✅
3. PDF — `offer-pdf.ts`: № слева/Дата справа, Заказчик, Объект жирным, фото 80/48 pt, Итого ₽ + НДС/«Без НДС», серые строки доставка/срок/цены, затем условия и примечание. ✅
4. Маршруты `POST /offers/preview`, `POST /offers/:id/copy`, `GET /offers/defaults`, `GET /offers/companies`, `PATCH /offers/backgrounds/:id`. ✅ Дополнительно (не в контракте): `PATCH /offers/companies/:id` {offersOnly} (admin/manager) — чтобы галочка «Только для КП» не требовала read-modify-write через `PUT /settings/:key`.
5. Юнит: НДС 122 622,95; копия +3 % 700 400, +5 % 714 000; зоны; preview не пишет (offers.templates.spec.ts). ✅
6. «Только для КП» — `common/offers-only.ts` (настройка `settings.offers.onlyCompanyIds`), `ourCompanies(conn, {withOffersOnly})` скрывает по умолчанию. ✅ Проверка «старых денег у Приват-деал нет» — ➖ не сделана (чтение прода мне недоступно; нужен datacore-access: incomes/payroll/расходы по companyId «Приват-деал»).
7. openapi — ➖ вручную (Docker/Mongo нет), 288 строк добавлено скриптом по форме Swagger; перегенерировать при ближайшем Docker. MAP.md строка `offers` обновлена. ✅

## Допущения
- vatMode пусто → `organizations.vatRate > 0` ? with : without. В схеме организации vatRate по умолчанию 20 — старые КП без полей начнут печатать «НДС 20 %» (по ТЗ «по ставке фирмы»), если у фирмы не 22/0.
- `/offers/defaults.terms` — `defaultTerms` бланка стр. 1 «по умолчанию» этой фирмы, иначе общего, иначе ''.
- Копия: дата сегодня; срок действия сохраняет длительность; vatMode/vatRate не копируются (берутся по новой фирме); delivery, объект, terms, notes, строки копируются; статус draft.
- Номер в предпросмотре печатается как «КП-черновик» (без «№»).
- Валидация зоны: между верхом и низом ≥ 20 % страницы (400 по-русски).
- Знак ₽: на сервере с DejaVu — ок; на запасном шрифте gost-a.ttf глифа может не быть (локально проверить глазами нельзя) — qa: смотреть PDF на стенде.
- Жирный шрифт: DejaVuSans-Bold, если есть, иначе обычный.
- `resolve()` теперь возвращает объект — правлен offer-backgrounds.service.spec.ts; в моках payroll/salesorders specs добавлен `settings.findOne` (ourCompanies читает настройку).

## Вне зоны/не сделано
- Другие списки «наших фирм» не фильтруются (`supply.service.ts:236,754` — компании в снабжении, `fill-audit.service.ts:60`); ТЗ требовало доходы, расходы, календарь, ФОТ, заказы — это через `ourCompanies`. Если «Приват-деал» попадёт в выпадашку снабжения — сказать.
- e2e не дописан (qa).
