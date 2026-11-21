# Адресный разбор четырёх падений полного e2e
Статус: после полного 771PASS/6FAIL/12SKIP координатор разрешил fixture-only исправление четырёх файлов. Применено 18 вставок/7 удалений; runtime не менялся. Источник тестов заморожен, targeted4 и повторный full у QA; автор этого отчёта Jest/БД не запускал.
Источник: tools/logs/c176-qa-2026-11-21T14-06-22-512Z/e2e-full.log (1232,1445,1807; composition-meaning ниже по журналу).

| Suite / место | Доказанная причина | Минимальный план после разрешения координатора |
|--|--|--|
| new-endpoints-1101:40,120–122; ПНЗ plan/issue/pdf | passportInstall создан только с name «Анкерами», без code. Профиль unknown; ключ installationTypeId блокирует обе ранее ready позиции. PDF400 — следствие issued0. При корректном ANCHORS потребуется img_mounting: ready-изделия имеют только overview. | В fixture явно code:ANCHORS; для okPid и freshPid добавить mounting через existing addImg. Счётчики ready2/blocked2/issued2 и прежние assertions НЕ менять. Не подменять способ freestanding ради зелёного теста. |
| chain-materials-to-passport:54,98,103 | Самодельный code QA_MC_ANCHOR отсутствует среди 7 канонических кодов; name «Крепление анкерами» больше не классифицирует метод. Действующий ключ installationTypeId; после исправления code понадобится img_mounting, сейчас images содержит только overview. | Fixture code:ANCHORS, existing реальный test PNG привязать отдельным видом mounting вместе с overview. Не менять issue200, материалы, сохранность старого PDF и последующие guards. |
| composition-meaning:43,61,181 | Снова name «Анкерами» без code, поэтому installationTypeId unknown. product helper привязывает только overview; канонический anchor потребует img_mounting. | Fixture code:ANCHORS; product helper добавляет отдельную mounting-связь валидного test PNG. Сохранить issue200, модули/дерево/последующий frozen PDF и assertions. |
| passports C096:249–255 | Этот тест намеренно создаёт TRN БЕЗ installationTypeId. Лог реально содержит «Способ установки» и «Рост пользователя от», но не foundation: это правильный C179 unknown без fallback. Устарел только expected безусловного фундамента. | Сохранить проверки выбора метода/роста, добавить явные отрицательные проверки foundation в missing/requiredImages/slots для unknown; отдельно проверить foundation для выбранного CONCRETE_POSTS. Все C096 проверки пересборки/явного обновления/прав сохранить. Это актуализация противоречивого старого ожидания, runtime ослаблять нельзя. |

## Проверка точных ключей без вмешательства в полный прогон
Прямой вызов существующих installationProfile + missingKeyed через node/ts-node/register (без Jest/БД, без записи файлов) на полном BLG-документе с одним overview:
- code пустой → kind unknown → единственный missing {key:installationTypeId,label:«Способ установки»}.
- code QA_MC_ANCHOR → тот же installationTypeId.
- code ANCHORS → единственный missing {key:img_mounting,label:«Рисунок: Схема монтажа»}.
Связь с реальными fixtures подтверждается точными строками выше; полный HTTP body у трёх issue400 в исходном логе не распечатан, поэтому эти keys вычислены общим production helper, а не заявлены как перехваченный HTTP body.
Runtime исправлений для этих четырёх падений не предлагается. После завершения full: разрешённые fixture-правки → targeted этих 4 suites → согласованный финальный full по решению координатора.

## Применённый fixture-only patch
Три fixture теперь имеют canonical ANCHORS и валидный test PNG отдельным mounting-видом. В new-endpoints монтаж добавлен только двум ожидаемым ready позициям; прежние ready/blocked/issued assertions неизменны. C096 сохраняет method/growth и усиливает unknown-no-foundation (missing/required/slots), отдельно проверяет positive CONCRETE_POSTS. Runtime/guards/прочие assertions не изменены.
