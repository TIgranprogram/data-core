# C180 — карта архитектуры паспортов и границы аудита
Статус: **первый адресный аудит стыков; не аудит всех72модулей и не окончательный ПС-1.0 signoff**. Основание C180/TZ; просмотрены C179снимки/7способов, variants/import, presentation/service/readinessстыки, snapshothelper/controller/UIcan/head C178. Код иprodне менялись.
## Карта текущего контура
`products + passportDefaults + dicts/kind/facets` → сборка context/variant/installation → product template/образец → instance позиции илиstandalone → проверкаготовности → allocate+issue → textSnapshot+printSnapshot → PDF/история.
Изменения идут разными входами: ordinary PATCH/name; локальные snapshot-field/item; product фото/defaults; атомарныйInventorimport(C172) с согласованной редакцией; печатныйPDFфайл. Само открытие/образец не должны быть mutationкомандой.
Живыеисточники применимы шаблону/черновику; issued хранит печатныеисточники и предыдущиеполныепроекции в revisions. ПрикладнойготовыйPDF — отдельныйвид, его содержимое веб-редакторне меняет. Аннулированное readonly; полныйархивзакрытогооплаченного заказа — отдельный незавершённыйконтур.
## Где сейчас расползается правило
- Installation: passport-variants.installKindOf выводит2режима поNL; importInstallationKind добавляет DEFAULT_INSTALL и unknown→foundation; dictrequiredImages противоречатphysicalcode. В622rawownEMBEDDED и anchorphysicalфакт — разное, это не«неправильноотображённыйдефолт».
- Allowed/required/PDF/слоты: imageKindAllowed иimageRules, category/installrequiredlists ифронтендподписи — разныепотребители безединого сериализованногоплана; ANCHORSскрываетfoundation, нооставляетholes.
- Mutation/history: обычный PATCH/CAD/local snapshot имеютразные подготовительныепути. C178закрываетконкретныйhistorybypass локальныхправок однимCAS, не доказываетунификациювсехкоманд.
- Capabilities: draft/issued/generated/file/annulled условия повторяются в UI; C178приводиткнижкукразрешённомуedit, ноединыйсерверныйcapabilitiesview покаотдельнонепроверен.
## Целевая форма без большой переписи
Одначистая `installationProfile(exactcode,origin)`; однаподготовка mutationплана с before/after/changed/revision/printcontext; одинатомарныйcommit; одинcapabilitiesview иодинсценарий трассы template→instance→revision→PDF→history.
Текущаявыпускнаяграница: закончить C178 и C179/622, доказатьсогласованностьсемантикииhistory наизолированнойкопии, затемобщийfull. Рефакторинг ниже не откладывает готовыйпаспорт.
