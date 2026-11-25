# C268 — postrelease скролл колонок (прод)

Запись на прод не выполнялась. Viewport 1440×900, headless Chrome.

## До hotfix (v=`676ed3cb`, n=1056)

Дата: 2026-11-25 · **Итог: FAIL**

### Проектирование (#design)
- Колонка «На распределении»: scroll=6612, client=6612, карточек=29, низ +5980px, scrollTop=нет → **FAIL**
- overflow страницы 0px → **PASS**

## v2.58 (v=`0ebbacd0`, n=1057)

Дата: 2026-11-25 · **машинно PASS, глазами нет:** `clientHeight=8` — тело колонки схлопнуто (`flex:1 1 0` при высоте `.col` только через max-height). Скролл «есть», смотреть нельзя.

## v2.59 (ожидается)

Явная `height: calc(100dvh - 220px)` у `.col` + `max-height` у `.col-body`. Критерий: clientHeight колонки ≥ 400px при 900px окна, scrollTop двигается, overflow страницы 0.

Скрипт: `node tools/logs/c268-postrelease-scroll.mjs`