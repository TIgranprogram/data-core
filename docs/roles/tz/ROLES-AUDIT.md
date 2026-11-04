# ТЗ ROLES-AUDIT — матрица доступов ролей (без браузерного обхода)

**Класс:** M · **Max agents:** 2 (access + analyst) · **Проверки:** нет кода · **Код не писать**

**Зачем:** список «роль видит/может лишнее или мало» по бизнесу, чтобы потом точечно чинить. Не логиниться под каждой ролью в UI.

## Shared pack
- Прод: только чтение через `datacore-access` / `api.sh`.
- Отчёты → `docs/crew/C020-roles-access-audit/`.
- Не трогать: C019 VIEW-AS, чужие незакоммиченные вне C020, запись на прод.

## Шаги
1. **access:** `GET /api/roles` (prod) → файл `ROLES-PROD.md` (имя, label, baseRole, money, appSections, warehouseIds кратко, active). Без паролей и лишних пользователей.
2. **analyst:** по `ROLES-PROD.md` + `docs/PRODUCT.md` (коротко) + иерархия `backend/src/common/roles-hierarchy.ts` + список разделов `app-sections.ts` → `EXPECT.md`: для каждой роли «должно видеть / должно менять / не должно». Затем `FINDINGS.md`: расхождения с фактом из ROLES-PROD + явные дыры (пустые appSections у не-admin = «всё по иерархии» — пометить). Приоритет P0/P1/P2. Без кода.

## Отчёт в чат
≤ 12 строк + путь к FINDINGS.md.
