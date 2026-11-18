# C143 — fill-queue → книжка (аудит 18.11)

| Ключ | Было | Станет |
|--|--|--|
| materials / parts | ✅ материалы, **без** is-wide | ✅ + is-wide + карточки строк |
| dimensions / weightKg | ✅ форма справа | ✅ без изменений логики |
| composition | ✅ воронка | ✅ |
| installation | ✅ только текст монтажа | ✅ текст + способ + **глубина Г** |
| foundationDepth | ❌ никуда | ✅ слот «Глубина Г» |
| purpose | ❌ только flash | ✅ слот «Назначение» |
| seatsCount, age*, height*, weightMax, maxUsers, fallHeight, site*, serviceLifeYears, warrantyMonths | ❌ flash / ничего | ✅ слот числа → passport-defaults |
| installationTypeId | ❌ | ✅ в слоте «Монтаж» |
| img_* | flash на лист | без изменений |
| category / kind / facets / elements / тексты | слева выбор / flash | без изменений (не правая колонка) |
