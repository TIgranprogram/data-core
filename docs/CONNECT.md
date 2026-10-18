# Подключение к Personal Data Core

Как подключиться к базе **с любой платформы или инструмента**: приложение (на любом языке), таблица, скрипт, бот, AI-агент — что угодно, что умеет HTTP-запросы.

Всё подключение = **один URL + один ключ**. Больше ничего знать не нужно. Примеры ниже — именно примеры, а не привязка: подставь свой стек.

---

## 0. Где что лежит

| | |
|--|--|
| Базовый URL API | `http://<твой-сервер>:3001/api` |
| Документация (Swagger UI) | `http://<твой-сервер>:3001/docs` (нужен `SWAGGER_ENABLED=true` в prod) |
| Health-check | `GET /api/health/ready` |
| Контракт эндпоинтов | `docs/openapi.json` (пути в нём без префикса `/api`) |

Порт `3001` — и на VM, и локально (`HOST_PORT` в `.env`; дефолт compose — `3000`).

---

## 1. Способ A — логин/пароль (для тебя и интерактивной работы)

```
POST /api/auth/login
Content-Type: application/json

{ "username": "admin", "password": "..." }
```

Ответ:
```json
{ "access": "<JWT>", "refresh": "<JWT>", "user": { ... } }
```

Дальше в каждый запрос кладёшь заголовок:

```
Authorization: Bearer <access>
```

Вместо `Authorization` можно слать тот же токен в заголовке `X-Access-Token: <access>` — сервер проверяет его первым (удобно, когда `Authorization` занят HTTP Basic прокси).

Access-токен живёт 15 минут (`JWT_EXPIRES_IN`), refresh — 30 дней. Обновить access:

```
POST /api/auth/refresh
Authorization: Bearer <refresh>        # или X-Access-Token: <refresh>
Content-Type: application/json

{}
```

Ответ: `{ "access": "<JWT>" }`. Refresh-токен берётся **из заголовка**, не из тела и не из cookie (сервер ставит cookie `refreshToken`, но не читает её). После `POST /api/auth/logout` старые refresh-токены отклоняются (401).

**curl:**
```bash
TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"..."}' | jq -r .access)

curl -s http://localhost:3001/api/<модуль> -H "Authorization: Bearer $TOKEN"
```

---

## 2. Способ B — машинный ключ `kppd_` (для внешних клиентов без человека)

Долгоживущий ключ вида `kppd_...` — им лучше пользоваться везде, где нет человека:
внешняя таблица, cron-скрипт, бот, мобильное приложение.

**Выдать ключ** (нужен админ с permission `desktop:admin`):

```
POST /api/desktop/pairing-keys
Authorization: Bearer <admin-access-token>
Content-Type: application/json

{
  "ttl": "30d",                       // 1d | 7d | 30d | 90d | never
  "label": "my-app-inventory",        // для себя: где используется
  "apiBaseUrl": "http://<LAN_IP>:3001"  // обязателен
}
```

Ответ содержит `apiKey` — **покажется один раз**, сохрани. Хеш хранится на сервере.

**Использовать** — тот же заголовок (или `X-Access-Token: kppd_xxxxx...`):
```
Authorization: Bearer kppd_xxxxx...
```

Ключ действует **с правами выдавшего его пользователя** (его роль и организация); деактивация пользователя отключает и его ключи.

**Отозвать:** `POST /api/desktop/pairing-keys/:id/revoke`
**Список ключей:** `GET /api/desktop/pairing-keys`

---

## 3. Примеры подключения

> Примеры — иллюстрация, **не привязка к платформам**: подойдёт любой клиент, который умеет HTTP-запросы. Возьми нужный тебе стек или сгенерируй клиента по `openapi.json` (задача в ROADMAP).

### Google Apps Script (таблица читает и пишет в базу)

```javascript
const BASE = 'http://<LAN_IP>:3001/api';
const KEY  = 'kppd_xxxxx...';

function loadData() {
  const res = UrlFetchApp.fetch(BASE + '/materials', {
    headers: { Authorization: 'Bearer ' + KEY },
    muteHttpExceptions: true,
  });
  const rows = JSON.parse(res.getContentText());
  const sh = SpreadsheetApp.getActive().getSheetByName('Data');
  sh.clear();
  rows.items.forEach((r, i) => sh.getRange(i + 1, 1).setValue(r.name));
}

// name, article, unit — обязательны; поля вне DTO (например qty) → 400
function saveRow(name, article, unit) {
  const res = UrlFetchApp.fetch(BASE + '/materials', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + KEY },
    payload: JSON.stringify({ name, article, unit }),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() >= 300) throw new Error(res.getContentText());
}
```

**Создать материал (curl):**
```bash
curl -s -X POST http://<LAN_IP>:3001/api/materials \
  -H "Authorization: Bearer kppd_xxxxx..." -H "Content-Type: application/json" \
  -d '{"name":"Лист стальной 2 мм","article":"LS-2","unit":"шт"}'
```
Обязательные поля: `name` (1–256), `article` (1–64), `unit` (1–32). Необязательные — см. `CreateMaterialDto` в `docs/openapi.json` (`sku`, `materialKind`, `categoryId`, `description`, …). Сервер работает с `forbidNonWhitelisted`: **любое лишнее поле → 400**. Запись — роли `admin`/`manager`, чтение списка — `admin`/`director`/`manager`.

### Python

```python
import requests

BASE = "http://<LAN_IP>:3001/api"
H = {"Authorization": "Bearer kppd_xxxxx..."}

r = requests.get(f"{BASE}/materials", headers=H, timeout=10)
r.raise_for_status()
print(r.json())
```

### PHP

```php
$ch = curl_init('http://<LAN_IP>:3001/api/materials');
curl_setopt_array($ch, [
  CURLOPT_HTTPHEADER => ['Authorization: Bearer kppd_xxxxx...'],
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_TIMEOUT => 10,
]);
$data = json_decode(curl_exec($ch), true);
```

### AI-агент или бот (любой)

Отдаёшь инструменту: базовый URL + ключ + ссылку на Swagger (`/docs`) или на этот файл —
и он сам разбирается в эндпоинтах и работает с данными.

---

## 4. Кто и что может (права)

| Роль | Права |
|--|--|
| `admin` | всё (`*`), включая выдачу ключей и управление пользователями |
| `director` | полный операционный доступ (в основном чтение), без управления пользователями и ролями |
| `manager` | чтение + запись в рабочих модулях, без управления пользователями |
| `user` | минимум: отдельные эндпоинты чтения (например, `GET /materials` ему недоступен — 403) |

Системные роли создаются сидом (`common/seed/admin.seed.ts`). Доступ задаётся на каждом эндпоинте (`@Roles`, `@Permissions`) — точный список ролей смотри в контроллере модуля (`docs/MAP.md`). Новая внешняя интеграция — заводи под **отдельный ключ с TTL**, чтобы в любой момент можно было отозвать одну интеграцию, не трогая остальные.

---

## 5. Правила (чтобы база не портилась)

1. **Не подключайся к MongoDB напрямую** — только через API. Прямая запись ломает счётчики, аудит и уникальность.
2. **Один ключ = одна интеграция.** Легко отозвать — легко искать утечку.
3. TTL для разовых/экспериментальных ключей — `7d` или `30d`, не `never`.
4. Тяжёлые операции — через API-эндпоинты, не «просто пройтись по коллекции».

---

## 6. Необязательные адаптеры (по надобности)

Проект остаётся **универсальным REST API** — никакой привязки к экосистемам.
Если позже понадобится удобный доступ из конкретной среды, адаптер добавляется поверх этого же API как тонкая обёртка, например:

- **MCP-сервер** — для AI-агентов, чтобы работали с данными как с инструментом (список/создание/обновление записей), а не парсили JSON руками. Прототип существует в kppdf-8.0 (`desktop/mcp`) — адаптируется сюда при реальной надобности.
