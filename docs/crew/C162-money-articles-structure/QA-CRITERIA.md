# C162 — проверенные критерии и границы QA

Фактический источник: evidence/QA-RESULTS.json, raw full и адресные повторения. Набор C158+C162, финальный backend freeze19.11.2026. Таблица не заменяет UI-REVIEW.

| Критерий ТЗ | Результат и доказательство |
|--|--|
| Постоянные ID, rename/reparent/третий уровень и payroll seed | PASS financial-articles.e2e; новый источник/имя не создаёт второй payroll; бывший leaf→group сохраняет ID/categoryIds/history projection |
| Циклы/CAS/reference guards | PASS финансовое дерево A→B/B→A, archive во время source reference; несовместимое дерево/alias/raw CRUD/merge не обходит writer |
| Архив использованной статьи | PASS история/usage/reset сохраняются, новая ссылка на archived/invalid не принимается; QA2 показал прежние деньги после archive effective статьи |
| Income article/type и идентичность частей | PASS core18; две одинаковые части имеют разные serverID; future hint/archived original не меняют прошлое; stale/foreign IDs/array безIDs запрещены |
| Оригинал/override/reset/null/audit | PASS core18 и QA2; суммы/даты/company/source IDs неизменны, повтор не дублирует audit, reset на archived original разрешён с диагностикой |
| Legacy identity preparation | PASS metadata-only GET/apply/CAS/mapping/synthetic; QA replay после последующего correction+source notes сохраняет прежнее соответствие; неизвестные поля/изменённое намерение отвергаются |
| Canonical operations, страницы и суммы | PASS core7-фактный пример и QA3-source пример; total/totals до page, уникальные operationId, BOTH/потомки/none/unknown/direct-group/cross-year; остальные source/filter regressions в core наборе |
| Одинаковые реальные факты в отчётах | PASS QA2: operations/by-articles/calendar/summary после corrections и tree changes сходятся; это не распространяет payroll canonical права на старые более широкие агрегаты |
| Source roles/scope/дата/history | PASS core18/pure: закрытый payroll source исключён/403, scope исходных данных не расширяется аналитикой, Moscow day; list без полной истории, detail по действию |
| Source-CAS и paid history | PASS cancel/remove vs first payment и повторный ARCH bounded cascade rollback; paid legacy source edits не обходят original. Backend source во время full не менялся |
| Начислено/ожидается/void/unresolved | PASS инварианты C158 и canonical facts: это не дополнительные кассовые операции; неопределённые FX долги не выдумываются RUB0 |
| Форма удаления оплаты дохода | Raw full обнаружил старый UI payments:[]; API409 правилен. Фикстуры обновлены на typed identity DELETE/явный synthetic source action; frontend исправил single/known synthetic flow; QA финальные350 guards/355 imports PASS,69node по отчёту frontend; визуальное действие отдельно |
| План183 старых статей, применения0/rollback | Документальный план проверен аналитиком/архитектором; data apply/rollback не выполнялись и не объявлены PASS этим QA. Нужны актуальный usage/revision/конкретный разрешённый план |
| Внешний вид и сценарии34 | Не принимаются по этим API тестам. Обе темы/ширины/видимые формы проверяет designer/access; полные UI evidence принадлежат координатору |

Штатный T26 opt-in:1 suite/12tests SKIP, отдельный disposable URI не выдавался; это не падение C162. Остальные тесты после целевых исправлений пройдены. Исходный полный FAIL сохранён, объединённое покрытие явно не выдано за один успешный full command.
