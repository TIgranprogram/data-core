# C268 — postrelease скролл колонок (прод)

Дата: 2026-11-25 · version.json v=`676ed3cb` n=1056 b=a9897e4a

**Итог: FAIL** (колонки: FAIL, страница: PASS)

## Проектирование (#design)
- Колонка «На распределении»: scroll=6612, client=6612, карточек=29, низ колонки ниже окна на 5980px, scrollTop двигается=нет → **FAIL**
- document: scrollHeight=900, client≈900, overflow=0px → **PASS**

## Заявки (#requests)
- На доске нет карточек ни в одной колонке (админ, 1440×900) → **SKIP**
- overflow страницы 0px → **PASS**

## В работе (#work)
- Карточек на доске нет → **SKIP**
- overflow страницы 0px → **PASS**

Запись на прод не выполнялась.
