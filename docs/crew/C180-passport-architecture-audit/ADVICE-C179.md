# C179 — быстрый архитектурный совет
Вердикт: минимальный фикс нужен на сайте; iLogic/три входных вида не менять. Источники: C179/TZ,CURRENT-622,INSTALLATION-TYPES; passport-variants.ts:35–51, import.service.ts:28–33.
Причины расхождения: NL-проверка «бетон» стоит раньше анкеров; unknown импортируется какfoundation; ANCHORS.requiredImages ошибочноfoundation+holes; allowed скрывает толькоfoundation, а монтажные traits одновременноanchors+concrete(«опоры бетонируют»).
## Один policy resolver
`installationProfile(record.code,source)` → code/known, primaryCadKind, allowed/required slots+labels, applicabledepth, installtraits; безDB/NL. Передавать результат в imageRules/readiness/compose/PDF/import; клиент рисует полученные imageSlots, не угадывает поназванию.
| Explicitcode | Канонический смысл и минимальное правило |
|--|--|
| ANCHORS | primary/requiredmounting; foundation,holes,embedded_layout запрещены. Монтаж анкерами на готовоеоснование; anchors≠«опоры бетонируют», полеГне требовать. |
| CONCRETE_POSTS | primaryfoundation, foundationобязательна; holesтолькоразметкаям при соответствующем явном требовании, неуниверсальныйвторойвид. concrete и глубиназаделки применимы. |
| EMBEDDED | Самостоятельныйкод: основание+закладныедетали; сохранитьявныеfoundation/embedded_layout иегоусловия. Необъявлятьanchor или бетонированиемопор; Гневыдумывать. |
| ON_SURFACE | Установканапокрытие; нейтральныйmounting/схемаустановки, безавтовыводаанкеров/ям/фундамента. Legacyrequiredfoundation записи требуетотдельногорешения, небезусловногопереноса. |
| FREESTANDING / LAID | Дваизвестныхкода, безкрепления/ям. ТретийCADвидможетбытьнеобязательнойсхемойразмещения, неfoundation; требованияoverview/safetyфильтроватьпокатегориикакпрежде. |
| FENCE_POSTS | Установкастоекограждения: отдельныйprofile, текущаяявнаяразметкаholes допустима; схемаоснованияfoundationприменима приподтверждённомбетонировании. НеcollapseвANCHORS/CONCRETE_POSTS. |
Unknown/пустой/неизвестныйcode: явныйвыборспособа; readinessmissinginstallation. Приимпорте не назначатьfoundation; безопасно409 с действием выбора ДОобщейоперации, файлы/связи не терять. СтатическийDEFAULT_INSTALL[TRN] не является подтверждениемспособа. ИмеющеесяownEMBEDDED не стирать поэвристике.
СловарныеrequiredImages пересекатьсallowedprofile; ANCHORS.mounting добавитьобязательно даже при старомошибочномrequiredlist. Безусловныеholes/safety длявсехкатегорий недопустимы. Исправлениестарых7records—отдельныйreviewedplan, не массовое изменение изфакта622.
Legacyтретийinputkindfoundation трактовать как«03_Схема установки», затем назначать поexplicitprofile. Не переименовывать произвольныйстарыйfoundation/holesфайлванкерный: требуетсяпроверенныйсобственный03файл. ВновыхprintSnapshot заморозитьprofile/планслотов; старыеисторическиеснимкинепересобиратьживымсправочником.
622: reviewed4-частныйплан productowninstallation→ANCHORS; адресныйстарыйinstallationtextChoice заменить/снять; проверенный03photo→mounting, убратьтолькоактуальныеlegacyholes/foundationlinksбезудаленияфайлов; issued622 штатнойредакцией спрежнимномером/полнойисторией. Свойmanualтекстнепереписыватьмолча; product/instanceисточникисогласовать.
Приёмкадоrelease: таблица7codes+unknown; anchorlegacyfoundation+holesнеprint/ready; 3inputlegacyimport; сменаметода; сохраняютсяowntextиoldrevision; одинаковыйprofileвtemplate/book/ready/PDF. Минимальныйприоритет—исправленный622, не большойрефакторинг.
