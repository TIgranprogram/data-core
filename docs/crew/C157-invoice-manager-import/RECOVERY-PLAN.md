# C157 — восстановление №8 и оставшиеся9 документов

19.11.2026. Подготовлено и проверено координатором, **ещё не выполнено**. Действующий общий release-window закрыт до выпуска C163+C165 и независимой проверки новой версии. Никакого автоматического продолжения старого helper.

## Проверенное состояние

№8 ДОН-СТРОЙ,24.09.2026,22300₽,безНДС. Уже созданы supplier `6aff4f391eb87438515b4737`, request `6aff4f3b1eb87438515b4745`, invoice `6aff4f3d1eb87438515b4754`, photo `6aff4f421eb87438515b476f`. Черновик version1, fileIds пока пусты, платежей и канонических строк0. PDF один; UTF8имя, размер и SHA `622951368cf20caf638c1f3eb2e6d39489206d165dfd898678f0eda31a250f8f` сверены. Первичный400 вызван лишним header.version; серверные поля не менять ради ошибки клиента.

Исходный `data/next10-journal/<SHA>.json` остаётся STOP_RECONCILE и не изменяется. Старый helper `tools/logs/c157-next10-import.mjs` не запускать повторно.

## Отдельные проверенные планы

- [x] Узкий live read-proof: `data/next10-stop8-readproof.json`.
- [x] Recovery№8: `data/no8-recovery-plan.json`, planHash `571f87f413c46250d74341e320d8c690ad4764986a9e1a4391bcdfa53311c77b`; helper `tools/logs/c157-no8-recovery.mjs`, SHA `11217e42ed768193e1373af3ef08deff2204fea46ca072482a08a7bedf418f9d`. Root прочитал целиком: ровно header/line/issue/payment по существующимID, без create/upload, свежие read-proof/CAS, отдельный журнал/lock; исходный STOPjournal защищён хешем.
- [x] Остальные9: `data/remaining9-exact-apply-proposal.json`, planHash `2ea2ade7db45ef5e6924298bdb8ba17314682ea4405115c6649d427e96c07dce`; helper `tools/logs/c157-remaining9-import.mjs`, SHA `20f4b1f6fb13714a23c131570f67f49c9f71d9f326b218e5b1182e217df62f4a`. Root проверил весь diff к прежнему reviewed helper и новый targeted-reader: отдельные approval/journal, №8/первые3/4816/24334 заблокированы, header/issue безversion, line/payment сfreshversion.
- [x] Фактические DTO проверены локально:41payload header/issue/line/payment PASS; отрицательная header.version отклоняется. `tools/logs/c157-dto-check.cjs`, `data/recovery-remaining9-dto-proof.json`, APIcalls0. priceHint — итог строки; не делить на количество.
- [ ] После нового выпуска проверить runtime/UI/version/health/normal и freshточные исходныеID/версии/фото/платежи. Любое изменение → STOP и новый review.
- [ ] Координатор создаёт новые конкретные approvalфайлы с актуальной версией, hashhelper/payload и TTL; шаблоны FALSE разрешением не являются.
- [ ] Access выполняет recovery№8, затем отдельный remaining9. После каждого шага журнал PENDING→DONE и адресная сверка сумм/НДС/платежей/ownledger. Не выполнять приёмку и не менять постоянный НДС поставщика.
- [ ] На400/409/503/unknown остановиться. Не повторять upload/payment/create; сохранить безопасную причину и read-proof. Старые журналы/FAILEDattempt не переписывать.
- [ ] Подтвердить итог10документов/11строк/277230,89₽ один раз, без legacyдублей; обновить CHECKLIST/PROCESSING-STATE ссылками на новые успешные журналы. После окна — NO_ACTIVE_WRITE.

Статья и ID заказа неизвестны и оставлены для уточнения, исходный контекст сохранён. Услуги не превращаются в складские материалы. Это внесение доказанных исторических оплат в учёт сайта, не банковский перевод.
