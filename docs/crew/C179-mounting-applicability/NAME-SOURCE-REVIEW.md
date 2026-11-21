# Источник названия паспорта — адресный read-only разбор
Статус: подтверждён дефект автологики относительно нового явного правила владельца. Source/test НЕ менялись, Jest/БД не запускались; release a96e708d не затронут.
Правило: автоматически имя из products.name; строка договора/заказа служит только отображению позиции. Уже выданные снимки не обновлять при чтении; действительно ручное имя не стирать без явного решения.

## Где возникает подмена
1. productPatch правильный: passport-from-product.ts:33 кладёт name=products.name. fromProductDiff(service:204–219) действует только для draft; diffPatch:100–118 уважает manualText/instanceManualText name.
2. Новый presentation экземпляр заказа: bindPresentation(passport-bind.ts:68) кладёт inc.title в scope.name. createPresentation(service:426–434) видит отличие от product.name, удаляет diff.name и ошибочно объявляет это автоматическое имя ручным (instanceManualText/manualText name). Это воспроизводимая по коду первичная причина.
3. Legacy ПНЗ: passport-order.ts:240–241 передаёт l.title→orderHost.createDraft(service:493–499)→dto.name; service.create:349–355 сохраняет отличающееся имя и ставит manualText name. Также ветка подготовки заказа service:474 передаёт inc.title. fromIncome(passport-queue.ts:150) сам имя НЕ подставляет.
4. Draft presentation чтение service.getPresentation:1213–1234 и выпуск preparePresentation:1254–1271 используют spread current→bound→fromProductDiff. Из-за manualname diff.name отсутствует; bound.name из inc.title побеждает. Даже настоящее ownmanualname может быть затёрто в проекции/при выпуске этим binding. bindPresentation должен связывать заказ/изделие/фирму, а не поставлять название позиции как имя паспорта.
5. Standalone presentation: bound не содержит name, поэтому продукт побеждает; createPresentation не переносит dto.name в set. Legacy standalone явное dto.name сохраняется как manual. Отличия этих режимов нельзя случайно поменять в срочном патче.
6. Issued: fromProductDiff запрещён followsProduct, getPresentation не вызывает bind/evaluate для issued. PDF читает сохранённое p.name, не products/incomes. Поэтому ранее выпущенное неправильное имя само после релиза не исправится. Штатный PATCH name создаёт редакцию с прежним номером, старый name/text/print сохраняются по существующему update.
7. C170 passportLine/lineBaseline — защита существования/привязки/источника/epoch; title не источник имени и не входит в fingerprint. Не менять binding/source guards ради названия, вложенные паспорта/их содержимое не переименовывать.

## Минимальный план после релиза и отдельного разрешения
- Убрать inc.title→name из presentation binding и автоматических order createDraft/batch вызовов. Автоматическое создание получает productPatch.name и не выставляет ownmanualname из line.title.
- Не убирать поддержку явно ручного dto.name/instanceManualText в остальных потоках автоматически; отдельно согласовать standalone presentation поведение, оставить как есть в узком патче.
- Existing draft с ошибочно автоматическим manualname неотличим от ручного по одним флагам. НЕ делать массовую миграцию/снятие flags по совпадению строк без reviewed списка. Для конкретного заказа20-26 — адресная подтверждённая операция.
- Перед печатью20-26: координатор/access читает actual linked product.name, строит diff список passportId/number/oldname/productId/productname/revision, затем PATCH только отличающихся имён через штатный API. Issued новая редакция/прежний номер; фото/тип/монтаж не трогать. Это исправляет конкретные экземпляры сразу, не требует ждать корневого изменения.

## Узкие регрессии
- Product.name=A, income.title=B: presentation create и order batch дают A без manualname; draft GET/issue/PDF также A; line.title=B остаётся в списке заказа.
- Product rename A→C до issue обновляет auto draft, rename после issue не меняет issued/PDF/history.
- Настоящее ownname=M с флагом сохраняется через GET/issue/refresh и правки line.title, автоматическое имя не помечается ручным.
- Legacy order flow использует A; standalone legacy/manual и standalone presentation текущие правила не ломаются.
- Адресный PATCH issued name A создаёт ровно1редакцию, прежний номер/старый PDF/name в истории; no-op без новой редакции. C170 attachment/selection/epoch/race guards прежние.
