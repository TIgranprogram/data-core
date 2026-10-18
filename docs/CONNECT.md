# Подключение к Personal Data Core

Как подключиться к базе **с любой платформы или инструмента**: приложение (на любом языке), таблица, скрипт, бот, AI-агент — что угодно, что умеет HTTP-запросы.

Всё подключение = **один URL + один ключ**. Больше ничего знать не нужно. Примеры ниже — именно примеры, а не привязка: подставь свой стек.

---

## 0. Где что лежит

> **Публичный адрес (из интернета, HTTPS):** `https://kppdf-crm.ru/db/api` — базовый URL API, админка `https://kppdf-crm.ru/db/admin/`. Из домашней сети можно и напрямую: `http://<IP-VM>:3001/api`. Ниже в примерах `<твой-сервер>` = один из этих адресов.

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
  "apiBaseUrl": "http://<LAN_IP>:3001", // обязателен
  "scope": { "access": "write", "apps": ["inventory"] }  // необязательно, см. ниже
}
```

**Права ключа (`scope`, необязательно):**

| `access` | Что можно |
|--|--|
| `read` | только чтение (`GET`/`HEAD`/`OPTIONS`); любая запись → 403 |
| `write` | чтение и запись данных |
| `full` | всё, что может выдавший пользователь (= ключ без `scope`, старое поведение) |

`read` и `write` **не дают** администрирования: `/api/admin/*` (включая устройства), `/api/desktop/pairing-keys*` и `/api/desktop/pairing` (ключ не может выдавать ключи), `/api/roles*`, изменение `/api/users*` → 403. Права ключа никогда не шире прав выдавшего.
`apps` — список приложений (`^[a-z][a-z0-9]{0,39}$`, без `_`, до 50) для хранилища `/api/apps/:app/...`; не задан или пуст = все приложения.
> ⚠ `apps` ограничивает только хранилище `/api/apps/...`. Канонические справочники (`/api/materials`, `/api/products` …) такой ключ видит в пределах своего `access` (см. TASKS P3).

**Рекомендация:** одна интеграция = один ключ с минимальными правами. Таблица, которая только показывает данные, — `read`; скрипт, который пишет в своё приложение, — `write` + `apps`; `full` — только для админ-инструментов.
В админке: раздел «API-ключи» → «Права» и «Приложения»; в списке ключей — колонка «Права».

Ответ содержит `apiKey` — **покажется один раз**, сохрани. Хеш хранится на сервере.

**Использовать** — тот же заголовок (или `X-Access-Token: kppd_xxxxx...`):
```
Authorization: Bearer kppd_xxxxx...
```

Ключ действует **с правами выдавшего его пользователя** (его роль и организация), урезанными `scope`; деактивация пользователя отключает и его ключи.

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

## 3a. Данные своего приложения (`/api/apps`)

Для своих данных приложения **не нужно ничего добавлять на сервер**: придумай имя приложения и коллекции — и сразу пиши/читай JSON-документы. Коллекция создаётся при первой записи (в БД — `app_<app>_<collection>`, в админке «Таблицы» — раздел «Данные приложений»).

| Запрос | Что делает |
|--|--|
| `GET /api/apps` | список приложений и их коллекций: `{items:[{app, collections:[{name, count, deleted}]}], total}` |
| `GET /api/apps/:app/:collection` | список `{items, total, page, limit}`; параметры `page` (с 1), `limit` (по умолч. 50, максимум 200 — больше урезается), `sort`, `filter` |
| `GET /api/apps/:app/:collection/:id` | один документ |
| `POST /api/apps/:app/:collection` | создать: объект → один документ (201); **массив до 500** → пачка, ответ `{items, total}` |
| `PATCH /api/apps/:app/:collection/:id` | слияние верхнего уровня: переданные поля заменяются, остальные сохраняются |
| `PUT /api/apps/:app/:collection/:id` | полная замена документа |
| `DELETE /api/apps/:app/:collection/:id` | мягкое удаление (`deletedAt`, документ пропадает из чтения); `?hard=true` — физически, только с правом `app-data:admin` (admin) |

**Правила:**
- Имя приложения — `^[a-z][a-z0-9]{0,39}$` (**без** `_`, иначе имя коллекции в БД неоднозначно), коллекции — `^[a-z][a-z0-9_]{0,39}$`. Иначе 400.
- В ответе у документа всегда `id` (строка) и `_id`. Служебные поля `createdAt`, `updatedAt`, `createdBy`, `updatedBy`, `deletedAt` ставит сервер — если прислать их (или `id`/`_id`) в теле, они молча игнорируются.
- Ключи документа с `$` или `.` → 400. Документ больше 256 КБ → 413. Тело запроса — до 16 МБ.
- Невалидный `id` → 400, нет документа (или он удалён) → 404.
- `sort`: `field` (по возрастанию) или `-field` (по убыванию), несколько — через запятую: `sort=-createdAt,title`. Вложенные поля — через точку.
- `filter` — JSON (не забудь URL-кодировать): `{"status":"open"}` или `{"qty":{"$gte":1,"$lt":10}}`. Разрешены только операторы `$eq $ne $gt $gte $lt $lte $in $nin $exists` внутри поля; всё остальное (`$where`, `$expr`, `$regex`, `$or`, …) → 400. `id` в фильтре = `_id`; `createdAt`/`updatedAt` сравниваются с ISO-датой (`"2026-01-01"`).
- Права: чтение — `app-data:read` (есть у всех системных ролей), запись — `app-data:write` (admin, manager), физическое удаление — `app-data:admin` (admin). Если ключу `kppd_` задан список приложений, чужое приложение → 403.

**curl:**
```bash
BASE=http://<LAN_IP>:3001/api; KEY=kppd_xxxxx...
# создать
curl -s -X POST $BASE/apps/budget/expenses -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" -d '{"title":"Кофе","amount":250,"tags":["еда"]}'
# найти траты от 100, новые сверху
curl -s -G $BASE/apps/budget/expenses -H "Authorization: Bearer $KEY" \
  --data-urlencode 'filter={"amount":{"$gte":100}}' --data-urlencode 'sort=-createdAt'
# изменить одно поле / удалить
curl -s -X PATCH $BASE/apps/budget/expenses/<id> -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" -d '{"amount":300}'
curl -s -X DELETE $BASE/apps/budget/expenses/<id> -H "Authorization: Bearer $KEY"
```

**Python:**
```python
import json, requests

BASE = "http://<LAN_IP>:3001/api/apps/budget/expenses"
H = {"Authorization": "Bearer kppd_xxxxx..."}

doc = requests.post(BASE, json={"title": "Кофе", "amount": 250}, headers=H, timeout=10).json()
requests.post(BASE, json=[{"title": "Хлеб", "amount": 60}, {"title": "Сыр", "amount": 400}], headers=H, timeout=10)

page = requests.get(BASE, headers=H, timeout=10, params={
    "filter": json.dumps({"amount": {"$gte": 100}}), "sort": "-amount", "limit": 200,
}).json()
for item in page["items"]:
    print(item["id"], item["title"], item["amount"])

requests.patch(f"{BASE}/{doc['id']}", json={"amount": 300}, headers=H, timeout=10)
requests.delete(f"{BASE}/{doc['id']}", headers=H, timeout=10)
```

**JavaScript (браузер / Node 18+):**
```javascript
const BASE = 'http://<LAN_IP>:3001/api/apps/budget/expenses';
const H = { Authorization: 'Bearer kppd_xxxxx...', 'Content-Type': 'application/json' };

const doc = await (await fetch(BASE, { method: 'POST', headers: H, body: JSON.stringify({ title: 'Кофе', amount: 250 }) })).json();
const q = new URLSearchParams({ filter: JSON.stringify({ amount: { $gte: 100 } }), sort: '-createdAt' });
const { items, total } = await (await fetch(`${BASE}?${q}`, { headers: H })).json();
await fetch(`${BASE}/${doc.id}`, { method: 'PATCH', headers: H, body: JSON.stringify({ amount: 300 }) });
await fetch(`${BASE}/${doc.id}`, { method: 'DELETE', headers: H });
```

Все изменения пишутся в журнал аудита (`entityType: AppData`, в `details` — `app` и `collection`).

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
