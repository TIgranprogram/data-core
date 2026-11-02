# PROGRESS — Ночная смена

## Этап 0. Разведка
- [x] 0.1 Прочитаны документы
- [x] 0.2 Найдена папка проверяемого сайта (D:\data-core, исключая tests_ai_tiit/, pult/)
- [x] 0.3 Изучена папка (только чтение)
- [x] 0.4 Записан DISCOVERY.md
- [x] 0.5 Черновик scenarios.yaml

## Этап 1. Каркас, CLI, отчёт, handoff
- [x] 1.1 pyproject.toml + uv sync (uv отсутствует → pip; см. DECISIONS)
- [x] 1.2 orchestrator/db.py
- [x] 1.3 orchestrator/plugins.py
- [x] 1.4 suites/demo
- [x] 1.5 orchestrator/runner.py
- [x] 1.6 orchestrator/report.py
- [x] 1.7 orchestrator/handoff.py
- [x] 1.8 orchestrator/cli.py

## Этап 2. Стенд, изоляция, регрессия, карта сценариев
- [x] 2.1 config/project.yaml
- [x] 2.2 stand/docker-compose.yml (поднят, internal=true, mongo:4.4, app, mailpit)
- [x] 2.3 stand/isolation (реальная проверка: host IP порты + google.com BLOCKED; падает при internal:false)
- [x] 2.4 orchestrator/scenarios.py (sync с разбором маршрутов NestJS)
- [x] 2.5 suites/regression (xdist + тесты сайта против стенда)
- [x] 2.6 suites/static (скелет)
- [x] 2.7 сравнение конфигураций (config_diff в отчёте)
- [x] 2.8 nightshift-app (health ok), Mailpit, заглушки, .env.stand

## Этап 3. Расписание, продолжение, ресурсы
- [ ] 3.1 resume.py
- [ ] 3.2 resources.py
- [ ] 3.3 scheduler.py
- [ ] 3.4 profiles.yaml
- [ ] 3.5 ротация логов, маскирование

## Этап 4. Нагрузка, soak, chaos, бэкапы
- [ ] 4.1 suites/backup
- [ ] 4.2 suites/load
- [ ] 4.3 suites/soak
- [ ] 4.4 suites/chaos
- [ ] 4.5 замеры производительности

## Этап 5. Фаззинг, мутации, визуальные, monkey, flaky, bisect
- [ ] 5.1 suites/fuzz
- [ ] 5.2 suites/mutation
- [ ] 5.3 suites/visual
- [ ] 5.4 suites/monkey
- [ ] 5.5 suites/flaky
- [ ] 5.6 bisect.py
- [ ] 5.7 группировка ошибок

## Этап 6. Локальный ИИ
- [ ] 6.1 llm_client.py
- [ ] 6.2 schemas.py
- [ ] 6.3 roles + prompts
- [ ] 6.4 context.py
- [ ] 6.5 loop.py (6A)
- [ ] 6.6 исправитель (6B)
- [ ] 6.7 защиты
- [ ] 6.8 fix_history
- [ ] 6.9 kb.py
- [ ] 6.10 тесты на заглушке

## Этап 7. GUI
- [ ] 7.1 выбор фреймворка
- [ ] 7.2 экраны
- [ ] 7.3 GUI вызывает только ядро

## Этап 8. Проверка компьютера, установка, упаковка
- [ ] 8.1 doctor.py
- [ ] 8.2 Установить всё
- [ ] 8.3 скачивание модели
- [ ] 8.4 сборка exe

## Лог шагов
(заполняется по мере работы)