# C268 — postrelease скролл колонок (прод)

Запись на прод не выполнялась. Viewport 1440×900, headless Chrome.

## До hotfix (v=`676ed3cb`, n=1056)

Дата: 2026-11-25 · **Итог: FAIL**

### Проектирование (#design)
- Колонка «На распределении»: scroll=6612, client=6612, карточек=29, низ +5980px, scrollTop=нет → **FAIL**
- overflow страницы 0px → **PASS**

## v2.58 (v=`0ebbacd0`, n=1057)

Дата: 2026-11-25 · **машинно PASS, глазами нет:** `clientHeight=8` — тело колонки схлопнуто (`flex:1 1 0` при высоте `.col` только через max-height). Скролл «есть», смотреть нельзя.

## v2.59 (v=`5430be32`, n=1058, b=`a9897e4a`)

Дата: 2026-11-25 · **Итог: PASS** (колонки: PASS, страница: PASS)

### Проектирование (#design)
- Колонка «На распределении»: scroll=6612, client=588, карточек=29, низ колонки −44px (в окне), scrollTop двигается=да → **PASS**
- document: scrollHeight=900, client≈900, overflow=0px → **PASS**

### Заявки (#requests) · В работе (#work)
- колонка без карточек → **SKIP** · overflow страницы 0px → **PASS**

Скрипт: `node tools/logs/c268-postrelease-scroll.mjs` (критерий clientHeight ≥ 400).