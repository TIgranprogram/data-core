# C066 — промпт: «Пользователей одновременно», возраст, рост, вес пользователя (2026-11-10)

```
Я — исполнитель (не координатор), правила — CLAUDE.md. Задача C066: массово заполнить в паспортных умолчаниях изделий (products.passportDefaults) пункты, которых не хватает для выпуска: maxUsers «Пользователей одновременно» (311 изделий), ageFrom/ageTo, heightMin/heightMax, weightMax. Только в пустые поля.
Образец целиком — C062: backend/scripts/c062-*.js, deploy/synology/c062-*.sh, docs/crew/C062-passport-purpose/REVIEW.md, кнопка в pult/catalog.mjs + node pult/gen-docs.mjs.
Данные прода — только чтение через агента datacore-access (deploy/synology/api.sh prod GET). Перепроверка 480 паспортов уже лежит: C:/Users/User/AppData/Local/Temp/claude/326477cc5ded4a48/74f7d0b0-77cc-4906-9f62-749f24bf252b/scratchpad/pp-check/<sku>.json; выпущенные паспорта: .../scratchpad/pp-mat.json.
Правила: сначала из выпущенного паспорта изделия; нет — по группе/категории (как у большинства изделий группы, ≥80 % одного значения); тренажёры — 1 пользователь; неуверенное — «вручную», не писать.
Скрипт записи: GET свежих умолчаний → дописать пустое → PUT /api/showcase/<id>/passport-defaults (PUT заменяет целиком — joints, textChoices, elements и др. не затирать). На прод НЕ писать — запись кнопкой пользователя.
Проверки: bash -n, node --check, tools/dc.cmd check. Коммит только своих путей, метки по CLAUDE.md, не выкладывать. Отчёт ≤ 12 строк в docs/crew/C066-passport-users/REPORT.md: сколько изделий получит каждый пункт, сколько вручную.
```
