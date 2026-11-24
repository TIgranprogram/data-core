# C266 — полировка эталона списков + проход по страницам

**Зачем:** владелец: «страница вылезает из‑под шапки» (не скроллбар); нужен аудит и эталонный вид на всех списках, не только склад.

**Класс:** L · **Max agents:** 2 (designer → audit; frontend → fix) · **Reviewers:** designer после fix · **Max review loops:** 2 · **Проверки:** smoke  
**Язык менеджера:** да · **Приёмка:** локальный стенд `http://localhost:3102/app/` (уже поднят). Прод не трогать.

## Глубже
- **Результат:** ни на одном `.list-screen` контент не просвечивает/не вылезает из‑под topbar; плотный CRM-вид по DESIGN §3.0; фильтры и таблица как на принятом складе.
- **Сырьё:** `NOTES.md` п.1–12; снимок `LOOK-stock.png`; живой `#stock` на :3102; замечание владельца «ЭТО НЕ СКРОЛЛ — страница вылезает из‑под шапки».
- **Метод:** designer фиксирует отклонения от §3.0 по экранам; frontend чинит общий CSS/kit + локальные отступления секций.
- **Судья:** снимки в папке C266; `node --input-type=module --check` на изменённых js; computed: topbar не sticky/непрозрачный на списке; scrollHeight страницы ≈ clientHeight.

## Shared pack
- Эталон нормы: `docs/DESIGN.md` §3.0 + §8 C266.
- Общий layout: `backend/pwa/ui/panels.css` блок `:has(> .page > .list-screen)` (≥721px).
- Причина полоски: sticky + полупрозрачный `--topbar-bg` (rgba … .9) — на списке topbar `position:relative`, `background:var(--bg)`, без backdrop-filter; page-head/toolbar/chips — static.
- Логин стенда — только через `deploy/synology/api.sh` / агент access; секреты не читать и не писать в отчёт.

## A. Designer (сначала / параллельно с чтением кода FE)
1. Прочитай роль `.claude/agents/datacore-designer.md`, DESIGN §3.0, NOTES.md.
2. На стенде :3102 глазами (браузер/снимки): `#stock`, `#requests`, `#salesorders`, `#partners`, `#money`, `#products` (что открывается как list-screen).
3. Оцени по чек-листу §3.0: высота окна / полоска из‑под шапки / воздух / дубли числа·крошек / сброс слева / плитки чисел / труба свёрнута / лишние hints / скролл фильтров.
4. Пиши только `docs/crew/C266-filter-compact/AUDIT.md`: таблица находок P0/P1/P2, экран, что не так, что должно быть, файл/селектор если видно. Снимки `AUDIT-*.png` в ту же папку.
5. Код не правь. В чат ≤12 строк + путь к AUDIT.md.

## B. Frontend (после AUDIT или по NOTES, если AUDIT ещё пишется — чини P0 из NOTES)
1. Роль `.claude/agents/datacore-frontend.md` + skill `datacore-design` при раскладке.
2. Довести `#stock` до эталона: **нет полоски из‑под шапки**; fill-height; сброс слева; ff-num; без hints/дублей.
3. Пройти остальные list-screen из NOTES «Проход по страницам»: убрать локальные отступления (hints, счётчик в h1, свой overflow/max-height ломающий fill-height). Предпочтительно правки в kit/`panels.css`/`list.js`, не копипаст по секциям.
4. Не трогать чужие untracked (C157/C158/C169/tmp). Менять только pwa UI/kit/секции списков + docs C266/DESIGN §3.0 при необходимости.
5. Отчёт `REPORT-POLISH.md`: что сделано, чек-лист страниц, проверки, риски.
6. Коммит/пуш/выкладка — не делать (координатор).

## Файлы
- Читать: DESIGN §3.0 (~91–100), NOTES.md, panels.css (блок C266 ~194–255 и ИЗ-2 ~455+), list.js (chipsTop/hints/reset), filter.js, crumbs.js, stock.js title/hints.
- Менять (FE): `backend/pwa/ui/panels.css`, `tokens.css`, `base.css`, `screens.css`, `list.css`, `kit/list.js`, `kit/filter.js`, `kit/filter-panel.js`, `kit/crumbs.js`, секции list при отступлениях; `docs/DESIGN.md` §3.0; NOTES чекбокс прохода.
- Нельзя: backend/src, прод, секреты, `git add -A`.

## Критерии
- [ ] На `#stock` нет контента из‑под topbar (P0).
- [ ] §3.0 выполняется на перечисленных списках или в AUDIT/REPORT явно «не list-screen / долг».
- [ ] Синтаксис модулей ok; design-lint по возможности.
- [ ] AUDIT.md + REPORT-POLISH.md лежат в C266.
