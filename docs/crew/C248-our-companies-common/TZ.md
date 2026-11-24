# ТЗ C248 — ourCompanies в common

**Программа:** [C246/CHECKLIST](../C246-architecture-modularity/CHECKLIST.md) · этап 2  
**Зачем:** `ourCompanies` живёт внутри `incomes`, а finance/expenses/payroll/supply/salesorders тянут доходы ради чужой сущности.  
**Класс:** M · **Max agents:** 1 (backend) · **Проверки:** tsc + юнит incomes/finance/затронутых

## Что сделать
1. Вынести получение/список наших компаний в `common/` (или тонкий модуль без доменной логики доходов).
2. Все импортеры перевести на новое место.
3. `incomes` больше не является единственной дверью к ourCompanies.
4. Поведение ответов API то же.

## Файлы
- Читать: `incomes.service.ts` (~ourCompanies), Grep `ourCompanies`.
- Менять: common + импортеры; не раздувать публичный контракт.

## Критерии
- [ ] Grep `ourCompanies` из incomes как единственного источника — нет
- [ ] tsc + юнит затронутых зелёные
- [ ] приложение без C249 всё ещё работает

## Нельзя
- Менять правила денег/оплат «заодно».
- Писать в прод.
