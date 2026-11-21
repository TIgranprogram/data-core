# C177 — frontend

Статус: код и локальная UI-фикстура PASS; реальный стенд/независимая приёмка у координатора.
- ✅ salesorders и orderpass: первый производственный номер в прежней thumbрамке; фотографии товаров/экземпляров паспортов/договоров сохранены.
- ✅ optional productionNo нормализован whitelist; legacycache/links/rights/clear не удалены/не изменены; ID и число из имени заказчика не используются.
- ✅ salesorder отдельно «Договоры с заказчиками»; финансовые orders не приравнены к производственным заказам.
- Файлы: core/recent-cards.js(+tests), ui/kit/recent-cards.js(+tests), kit.css — единственный типографический вариант внутри существующего thumb.
- Проверки: targeted17/17, imports370/0, design-lintnew0; browserfixture обе темы4группы PASS,20/12/36/39,12исходныхфото сохранены, pageerrors0.
- Снимки и fixture-results: evidence/; оба PNG открыты. scripttools/logs/c177-ui-harness.mjs. Это локальная заполненная история, не серверная приёмка.
- Runtime SOURCE FREEZE после smoke. Не коммитил/не выкладывал; карта обновлена.

Подготовлен только readonly stand automation tools/logs/c177-stand-readonly.mjs: nodecheckPASS, не запускал. Реальная app3102, seed временной browserhistory, только GET; заказов/паспортов не создаёт. Три фото других карточек — явно локальные GET testSVGfixtures; цель — числа/группы/сохранение различий типов. Runtimefreeze не снимался.
