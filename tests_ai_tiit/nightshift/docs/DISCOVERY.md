# DISCOVERY — разведка проверяемого проекта

## Проверяемый проект
- Путь: D:\data-core (подтверждено владельцем). Исключить из проверки: tests_ai_tiit/, pult/.
- Стек: NestJS 10 / Mongoose 8 / MongoDB 4.4 (rs0), PWA (vanilla JS), админка (vanilla JS).
- Дополнительно: пульт управления в pult/ (Node.js .mjs) — вне проверки.

## Изоляция стенда
- Стенд использует отдельную Mongo в контейнере (БД datacore-night / datacore-test-night).
- Подключение к боевой datacore и к VM :3000 запрещено.
- Сеть стенда без доступа к боевым системам и интернету.

## Существующие контейнеры (только чтение, не трогать)
- datacore-mongo: mongo:4.4, 127.0.0.1:27018->27017, сеть data-core_default — боевой Mongo data-core.
- dcnight-mongo: mongo:4.4, 127.0.0.1:27118->27017, сеть dcnight_default — Mongo ночного стенда.
- dcnight-backend: dcnight-backend:latest, 127.0.0.1:3102->3000, сеть dcnight_default — backend ночного стенда.
Эти контейнеры не останавливать, не удалять, не менять тома.

## Что требует изоляции
- Боевая БД MongoDB (datacore) — не трогать.
- Прод-контур kppdf на VM :3000 — не трогать.
- Секреты: .env, deploy/synology/config.env, CREDENTIALS.md — не копировать/не печатать.

## Как получить код/БД/файлы
- Код: D:\data-core (git), исключая tests_ai_tiit/, pult/.
- БД: MongoDB rs0 на localhost:27017; тестовая БД datacore-test (дропается e2e-харнессом).
- Бэкапы: на VM — /var/lib/datacore/backups (deploy/synology/backup.sh); на домашнем ПК — D:\datacore-backups (tools/night.mjs). Путь уточняется владельцем.

## Инструменты (предварительно)
- Статанализ: tsc, eslint (backend), node --check для pwa.
- Тесты: jest (backend), node --test (pult, tools).
- e2e: jest-e2e (нужен Mongo).

## Вопросы к владельцу
1. Путь к свежим бэкапам БД (уточняется).
2. Время окончания ночи 01:00–07:00, остановка долгих тестов 06:00, деградация 10%, температура ≤85°C, свободное место ≥30 ГБ (записано в limits.yaml).