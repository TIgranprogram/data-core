# C162 — readonly smoke объединённого образа

19.11.2026. HEAD`61558531e43a10659ef38a477fd73849ad85c5d3`,dirty=true,builtAt`2026-11-19T17:13:28.789Z`;owned3198,health200. СведённыйкодC158+C162+mainвпервыеосмотренпослеmerge. Тома/фикстурысохранены,ниreseeding/metadataподготовки/оплатповторноне было.

**RawрезультатсценарияFAIL**,непереписан: `C161-COMBINED-SMOKE-1795108644079`. Общийобход34экрана+4адресныхстыка,38PNG(result+summary+geometryрядом). Все34экранаи4формы:0is-failed,0горизонтальноговыходастраницы,0JavaScriptисключений,0APIошибок/HTTP5xx. Частичныестарыеrecordsоткрывалисьтолькокликомстроки/шапки,никакихSave/оплат/удалений.

ПричинастрогогоFAIL—143HTTP404:38раз`/app/version.json`,105запросовк68уникальным`/uploads/...`копии. ИныхHTTPошибокнет. Localbackend/pwa/version.jsonсуществует:False;файлверсиигенерируетсядлявыпуска,этотdevelopmentобразнеполучилего. Исходныелокальныевложенияизссылоккопииполностьюнеподготовлены. Этоограничениястендовыхартефактов;общийrawFAILневыдаётсязаPASSдоступом. Координаторпринимаетрешениеучётаэтихограничений,старыеэкранынечинятсяэтимsmoke.

Адресноподтверждено:
- Moneyclassificationленивыймаршрутоткрываетреальнуюформуreason/article.
- Счёт255000с2оплатамиоткрыт,paidAmount255000/history2сохранены.
- Financialdictредактороткрываетсяпослеобъединения,версия/parentформачитаются.
- Заказ/incomeформаоткрытачерез«Изменить»:orderId/productId/articleIdполяесть,paidDateнесуществуетпри2реальныхчастях;ничегоне сохранялось.
- Финансовыйконтроль7строк/5платежей,100000income/262455expense/net−162455,2stableincomeIDпрежние. Legacy21427reconciliation/paidAmountnull/balanceDuenullпрежние.

OpenAPI525pathsэкспортированизowncombinedbackendвdocs/openapi.json;SHA256`ba1cc43d3ff8d286b5885cc66e117ac04bd7d772b97acb52ae7876f4ad457f87`. Новаяmainлогикаapi.sh(owned/bootstrap/rolecache)сохранена;локальнопоменянытолькоstandbase3198иstandcacheдобавлен-c161-3198. Патчвtools/logs/c161-combined-stand-api-local.patch;restoreожидаетrootпередвыпуском. СобственныйEdgeprofileудалён,сессиявstdin,prod/testDb/чужиеокнане менялись.

Read-onlyпредвыпусковойпродснимок—отдельноPROD-PREFLIGHT-READONLY.md. Самвыпускещёневыполнен,новыйинвойсC157не импортировался.


## Решение координатора по границам прогона

Функциональный scope объединения принят: 34 экрана и4 изменённых стыка без ошибок API/JavaScript/раскладки, неизменные денежные контроли. Исходный rawFAIL143static404 сохранён. Версия developmentкопии задаётся development.json (HEAD61558531), releaseversion.json в readonlybind отсутствует; prodversion.json прочитан200, текущийv1.946/033850dc. Это явный SKIP артефакта версии в development, не ошибка финансового кода. Недостающие68файловuploads — ограничение комплекта копии, не доказательство целостности всех производственных вложений; производственные файлы этим прогоном не заменялись.

Координатор дополнительно открыл actualPNG `orders-financial-picker-1280` и `money-classification-lazy-1280`: сохранены новый выбор изделия и финансовая часть позиции; классификация открывается справа, денежные поля только читаются. Семантические конфликты orders/ensure-indexes разрешены объединением обеих сторон; financeэкраны main не менял. Это адресное закрытие интеграционного стыка после уже принятого второго UIпрохода, не третий общий дизайн-аудит и не сплошной PASS всем альтернативным состояниям. Для выпуска остаются fullQA и штатные ворота.


Решение координатора после разбора: **functional34+4PASS**, environment artifacts **SKIP**. RawFAIL143HTTP404 сохранён отдельно. Штатный ownedhelper генерирует development.json, не version.json; /app/pwa readonlybind, поэтому source/compose не изменялись ради подмены артефакта. Доказательство development61558531 скопировано из публичного metadataфайла в evidence/combined-development-61558531.json. Prodvalidversion033850dc/v1.946 прочитан ранее в API-only preflight.

Локальные только2standapi.shhunk восстановлены к61558531;diff0. Новыйmainowned/bootstrap/rolecacheсохранён;patchвtools/logs/c161-combined-stand-api-local.patch.
