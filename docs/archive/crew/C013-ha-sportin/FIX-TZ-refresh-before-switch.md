# FIX — шаг «Обновить» перед «Сделать главным»

**Зачем:** Перед переключением пользователь обновляет запасной (код + база), потом спокойно жмёт «Сделать главным».

**Класс:** L · **Max agents:** 2 · **Проверки:** smoke (tsc + юнит switch + node --check admin)

## Порядок на экране «Серверы» (enabled)

1. **Шаг 1. Обновить** — кнопка на колонке запасного: «Обновить». Окно: пауза записи 1–2 мин, без смены домена. Старт → `POST /control/switch/refresh` `{confirm:true}`. Прогресс шагов обновления.
2. **Шаг 2. Сделать главным** — как сейчас (отсчёт 10 с → «Переключить»). Пока идёт любая работа — disabled.

## Контракт

- `POST /control/switch/refresh` — admin, тело `{confirm:true}`; заявка мосту `kind=refresh`; 201 `{ok,job}`; 409/503 как у start.
- `GET /control/switch` + поля: `canRefresh` (main + normal + !busy + bridge), `job.direction` = `refresh` при обновлении.
- Мост `do_refresh`: preflight → photos → readonly → dump → restore (сосед standby+normal) → photos → code (rsync backend/deploy/compose, build+up на соседе) → verify → last-refresh → finish; домен не трогать; главный снова normal.

## Файлы

- `backend/src/modules/control/switch/*` (rules, service, controller, dto, specs)
- `deploy/ha/switch/switch-watch.sh`
- `backend/admin/control-switch.js` (+ css при нужде)

## Нельзя

- Автодомен / replica set. Не `git add -A`. Секреты не читать.
