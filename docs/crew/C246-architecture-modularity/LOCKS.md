# Замки архитектуры — «сделали раз, не ломаем по незнанию»

> Зачем: надёжность + гибкость фич. Закрытый этап не переоткрывают агенты «на всякий».  
> Рельсы дня: [RAILS.md](RAILS.md). Очередь сейчас: [CHECKLIST.md](CHECKLIST.md). Дальше: [BEYOND-CHECKLIST.md](BEYOND-CHECKLIST.md).

## Три слоя защиты

| Слой | Что делает | Кто чинит при красном |
|--|--|--|
| **1. Решение** | [DECISION.md](DECISION.md) — выбран архитектура; менять только явным решением владельца + архитектор | координатор |
| **2. Чек-лист + отчёт** | `[x]` + `REPORT.md` = этап закрыт. Переоткрытие — только дефект или новое «да» владельца | координатор |
| **3. Автоматика** | `audit-cycles` (пары и циклы ≥3, L-256), (после C255) ESLint-границы, зоны `review-scope` | исполнитель этапа / архитектор границ |

## Реестр замков (пополнять при закрытии этапа)

| ID | Замок | Доказательство | Переоткрыть если |
|--|--|--|--|
| L-247 | нет цикла work↔order-line-plan; `ModuleWork` в common | C247 REPORT · audit-cycles 0 | снова пара в audit-cycles |
| L-248 | `ourCompanies` только из `common/our-companies` | C248 REPORT | внешний импорт из incomes.service |
| L-249a | `fontDir` только из `common/print/font-dir` | REPORT-fontDir | импорт из passport-pdf снаружи модуля |
| L-249b | finance не импортирует частные файлы supply | C249 REPORT | новый `from '../supply/…'` кроме Module/Service |
| L-250 | есть INVENTORY + raw-query; массового перевода нет | C250 REPORT | перевод без сверки выдачи |
| L-257 | черновик CONTRACT шести shared; kppdf на выход (не развиваем); diff схем kppdf **не блокер** | [C257 CONTRACT](../C257-shared-compat-contract/CONTRACT.md) · DECISION 24.11 | ломать живые поля shared без нужды; «чинить kppdf ради паритета» |
| L-251 | запись `incomes` в рантайме только через `income-writes` / фасад `IncomesService`; разовые scripts — белый список REPORT | [C251 REPORT](../C251-incomes-owner-writes/REPORT.md) | новая сырая запись incomes вне income-writes / incomes.service |
| L-252 | запись `salesorders` только через `salesorder-writes` / фасад `SalesOrdersService` (+ `patchLegal` хозяина); scripts — белый список | [C252 REPORT](../C252-salesorders-owner-writes/REPORT.md) | сырая запись salesorders вне salesorder-writes / salesorders.service |
| L-253 | запись `products` только через `product-writes` / фасад `ProductService`; витрина — через `product-owner-port`; scripts — белый список | [C253 REPORT](../C253-products-owner-writes/REPORT.md) | сырая запись products вне product-writes / product.service |
| L-254-0 | слой `common/shared-collections` + контракт полей шести shared; массового перевода consumers нет | [C254 REPORT](../C254-shared-collections-layer/REPORT.md) | ломать контракт полей без сверки с C257; массовый перевод без подпоставки |
| L-254-a | `partners` читает шесть shared через `sharedFind`/`sharedCount` (имя материала — includeDeleted) | [C254 REPORT §a](../C254-shared-collections-layer/REPORT.md) | сырой find/count shared в partners мимо слоя |
| L-254-b | `finance`/`fill-audit` читают shared через слой (снимок оплаты — includeDeleted; distinct/агрегат сырые) | [C254 REPORT §b](../C254-shared-collections-layer/REPORT.md) | сырой find/count shared в finance/fill-audit мимо слоя |
| L-254-c | find/count шести shared вне stock/supply через слой; агрегат/distinct сырые | [C254 REPORT §c](../C254-shared-collections-layer/REPORT.md) | новый сырой find/count shared вне stock/supply/слоя |
| L-254-w | запись шести shared вне stock/supply только через stock-writes/supply-writes (+ порты) | [C254 REPORT §w](../C254-shared-collections-layer/REPORT.md) | сырая запись shared вне stock/supply/writes |
| L-254 | слой shared + хозяева записи в data-core; CRM пишет напрямую; доки ARCHITECTURE/UNIFY | [C254 REPORT](../C254-shared-collections-layer/REPORT.md) · doc | ломать модель совместимости без «да» владельца |
| L-256 | `audit-cycles` ловит пары и циклы ≥3; код ≠ 0 на новую находку; 10 длинных — снимок, не разрешение плодить | C256 REPORT | новый цикл или пара вне снимка |
| L-258 | DTO/OpenAPI только по касанию одного эндпоинта; пакетного перевода Query-DTO нет | [C258 PLAYBOOK](../C258-dto-by-touch-playbook/PLAYBOOK.md) | массовый `@Query` → класс без инвентаря полей |
| L-255 | частичные границы: три домена + платформа + common→три; полное «только index» выкл | [C255 REPORT](../C255-domain-boundaries-eslint/REPORT.md) | ослаблять включённое правило; включать полное без погашения долга |
| L-259 | план CRM→API принят; код перевода (C260+) только после L-259 и по одному срезу | [C259 PLAN-SLICES](../C259-crm-api-client-plan/PLAN-SLICES.md) | начинать C260+ без принятого плана; один флаг на все срезы |
| L-DEC | модульный монолит, не микросервисы | DECISION | «да» владельца на смену курса |

## Правила для любого агента

1. Перед архитектурной правкой прочитай этот файл и CHECKLIST.
2. **Не** «улучшай» закрытый `[x]` этап без строки дефекта в ТЗ.
3. Новый код не обходит хозяина коллекции и не кладёт доменные правила в `common/`.
4. Коммит этапа содержит зону `Проверка зоны: … PASS` и ссылку на REPORT.
5. Сомнение (граница доменов, shared CRM, CRM→API) — стоп, эскалация архитектору/координатору, не «починить молча».

## Баланс с фичами

- Фича в одном домене — можно без архитектурного консилиума; рельсы из RAILS в smoke.
- Фича режет два домена — тонкий метод хозяина или common-тип; не сырая запись чужой коллекции.
- Смена курса (микросервисы, перенос папок АБЗ-8, CRM→API) — только программа из BEYOND + «да» владельца.
