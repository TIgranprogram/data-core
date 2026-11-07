# C020 — чек-лист починки ролей

ТЗ: `docs/roles/tz/ROLES-FIX.md` · Цель: `TARGET-ROLES.md`

## До старта
- [x] Снимок прода `ROLES-PROD.md`
- [x] FINDINGS + допущения координатора
- [x] ТЗ ROLES-FIX
- [x] Чужие пути (pult, VIEW-AS) не в зоне волны B

## Волна A — прод (данные) ✅
- [x] PATCH admin label
- [x] PATCH user label + appSections
- [x] PATCH director appSections (+work, offers, docs)
- [x] PATCH accountant appSections (узкий)
- [x] PATCH manager без payroll
- [x] PATCH проектировщик money:false + узкие sections
- [x] PATCH трубарез money:false
- [x] PATCH лазер money:false
- [x] PATCH label кладовщик плит
- [x] APPLY-LOG.md + повторный ROLES-PROD.md
- [x] WAREHOUSES.md (имена складов) — отчёт
- [x] r-99ca58 уже совпадал — не слали

## Волна B — код (локально в файлах, выкладки нет) ✅
- [x] sectionOpen: stock-mobile ↛ requests (`app-sections.ts`)
- [x] supply: list+receive с `@AppSection(..., 'stock-mobile')` (+ stock); create без stock
- [x] sees(): нет авто stock→stock-mobile (`api.js`)
- [x] тесты app-sections + guard; api.js module-check
- [x] REPORT-CODE.md
- [!] риск: трубарез/лазер больше не создают заявку «из нехватки» до выкладки+пока есть только stock

## Волна C
- [ ] qa smoke
- [ ] коммит (по просьбе)
- [ ] выкладка (по просьбе) — **нужна**, иначе код B не на сайте
- [ ] глазами: проектировщик, кладовщик телефон, трубарез, директор, наблюдатель  
  (меню/деньги с волны A — после перелогина или обновления /auth/me)

## Не в этой волне
- VIEW-AS (C019)
- Переименование кода роли «Кладовщик плит…» в `r-…`
- Смена warehouseIds
