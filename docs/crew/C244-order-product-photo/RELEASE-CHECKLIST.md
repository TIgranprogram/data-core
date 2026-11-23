# C244 — приёмка и публикация

- [x] ProdGET подтвердил исходную причину:3413существует,product/incomephotoIds пусты,showcasepassportoverview доступен,orderline.photo=null. Данные не менялись.
- [x] Общий readonlybatchresolver с прежнимshowcaseadapter;3runtime+3test frozen отf6b35fc5. Автор33/191unit+4HTTP,tsc/eslint0.
- [x] Независимыйarchitect16unit/exact6SHA/PASS. Scopeне включает C017productionlistcover иlinesLookup, frozenarchive сохранён.
- [x] Обновлённая ownedкопияda26...;6browser/6PNG:realQAAPIphoto в обеих темах,own/noneUI-onlyfixture отдельно;0pageerrors/0writes. НезависимыйdesignerPASS.
- [x] Полный unit:406suites/4175testsPASS,tsc0/ESLint59TS0;112suites/918e2ePASS,0skip/missing/extra/duplicates;sourceSHA до/после совпали.
- [x] Финальный полныйe2ePASS/TESTLOGlowercasee2e✅, stagedownership,commit/push.
- [x] Стандартный выпуск и health/version/CRM/smoke; только после всех проверок.
- [x] ProdGET точнойincome6b0430c8de6d4da5c8610bd5/parent22-26: сохранить уже выбранное владельцем16:10 главное фото3413 (product.photoIds/mainPhotoId=6b043b54de6d4da5c8612581); три строки6/6/4,фото3502/4102 и3issued629–631 сравнить с USER3-PRERELEASE-BASELINE.md. Не очищать ручной выбор ради теста; автоматический fallback доказан наownedкопии, не приписывать ему ручное появление фото на проде. НикакихпрямыхAPIзаписейрадифото.

Источники: ARCH-REVIEW.md, BACKEND-REPORT.md, UI-REVIEW.md, stand/BROWSER-REPORT.md. ЭтоQAданные наownedкопии, не визуальныйprodпрогон. ОригиналыКП имеют приоритет; общаямобильная/паспортнаяПС-1.0 приёмка сюда не входит.
Уточнение владельцу: разбор Пульта заново не нужен для договора18/11/45 — в исходномPDF нет товарных рисунков, строки не сопоставлены. Фото появляются после ручного выбора изделий;8оригиналов/9связейизКП раньше были загружены в18/11/44. Автоматически сопоставлять45 или придумыватьегофото не поручалось.

## Итог

v2.51/tagrelease-v2.51-3488bca5 опубликован,health/smoke7/7/CRM200. Postrelease14полныхJSONравнывторомуmanualbaseline,3фото доступны,паспорта629–631сохранены. Ручноефото3413былоДОрелиза,автоfallbackдоказаннаownedкопии. [Факты](POSTRELEASE-REPORT.md).
