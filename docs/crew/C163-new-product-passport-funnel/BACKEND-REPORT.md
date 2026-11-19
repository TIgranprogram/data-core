# C163 — сервер воронки
Статус: реализация ✅, файлы заморожены для общего QA; общая приёмка/выпуск у координатора ➖.
Сделано: CAS `changes/expected.facetValueIds` в products, единый Mongo 4.4 updateOne вместе с defaults; null снимает поле, [] сохраняет пустой выбор; GET product.facetValueIds собственный массив/null ✅.
Валидация: ObjectId, живые значения и родитель productFacets, category новых ответов, single/multi; сохранённый хвост чужой категории остаётся, категория/вид защищены от параллельной смены ✅.
Short: технические sections исключаются до compose/when; монтаж/safety/service и дефекты сохраняют needJoints, maxUsers не изменялся ✅.
Производные элементы: productPatch читает живые elementIds критериев только с живым productFacets-родителем текущей категории (MAF=BLG), своё elements приоритетно; defaults, сохранённые чужие facet IDs и выданные снимки не переписываются ✅. P1 ARCH-REVIEW исправлен.
Файлы: showcase/passport-template-patch.ts/spec; product-passport/{product-passport.service,passport-from-product/spec,passport-presentation/spec,passport-v2-text}.ts; test/e2e/passport-presentation.e2e-spec.ts.
Проверки до P1: showcase+product-passport 93 suites / 875 tests PASS, audit-cycles 0. После P1: passport-from-product 1 suite / 19 tests PASS; tsc/eslint exit 0, diff --check 0. Три регрессии: смена категории/MAF и сохранённый хвост; dead/unknown/missing/broken parent; собственные элементы. Общий QA у координатора.
Числа: смешанная запись facet/default — 1 updateOne; unit проверяет один вызов и отсутствие facetValueIds в defaults; сравнение массивов сохраняет порядок, expected не очищает старые дубли.
Нужно от координатора: общий full/e2e, регенерация OpenAPI после сборки; UI снимает только purpose из manualText при явном возврате к словарю.
Риски: прямых запросов к API/проду, записи данных, коммита и выкладки не было; общая UI-приёмка не выполнялась.
Якоря внесены в docs/roles/maps/backend.md; коммит: — (у координатора); карта обновлена.
