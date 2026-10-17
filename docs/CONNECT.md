# Подключение к Personal Data Core

Как подключиться к базе с **любой** платформы: Google Sheets, Python, PHP, Node, агент (Gemini/Claude) и т.д.

Всё подключение = **один URL + один ключ**. Больше ничего знать не нужно.

---

## 0. Где что лежит

| | |
|--|--|
| Базовый URL API | `http://<твой-сервер>:3000/api` |
| Документация (Swagger UI) | `http://<твой-сервер>:3000/docs` (нужен `SWAGGER_ENABLED=true` в prod) |
| Health-check | `GET /api/health/ready` |

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

Access-токен живёт 15 минут. Refresh — через cookie `refreshToken` (`POST /api/auth/refresh`).

**curl:**
```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"..."}' | jq -r .access)

curl -s http://localhost:3000/api/<модуль> -H "Authorization: Bearer $TOKEN"
```

---

## 2. Способ B — машинный ключ `kppd_` (для скриптов, Sheets, агентов)

Долгоживущий ключ вида `kppd_...` — им лучше пользоваться везде, где нет человека:
Google-таблица, cron-скрипт, агент, телефон.

**Выдать ключ** (нужен админ с permission `desktop:admin`):

```
POST /api/desktop/pairing-keys
Authorization: Bearer <admin-access-token>
Content-Type: application/json

{
  "ttl": "30d",                       // 1d | 7d | 30d | 90d | never
  "label": "google-sheets-inventory",  // для себя: где используется
  "apiBaseUrl": "http://192.168.1.52:3000"
}
```

Ответ содержит `apiKey` — **покажется один раз**, сохрани. Хеш хранится на сервере.

**Использовать** — тот же заголовок:
```
Authorization: Bearer kppd_xxxxx...
```

**Отозвать:** `POST /api/desktop/pairing-keys/:id/revoke`
**Список ключей:** `GET /api/desktop/pairing-keys`

---

## 3. Примеры подключения

### Google Apps Script (таблица читает и пишет в базу)

```javascript
const BASE = 'http://192.168.1.52:3000/api';
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

function saveRow(name, qty) {
  UrlFetchApp.fetch(BASE + '/materials', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + KEY },
    payload: JSON.stringify({ name, qty }),
    muteHttpExceptions: true,
  });
}
```

### Python

```python
import requests

BASE = "http://192.168.1.52:3000/api"
H = {"Authorization": "Bearer kppd_xxxxx..."}

r = requests.get(f"{BASE}/materials", headers=H, timeout=10)
r.raise_for_status()
print(r.json())
```

### PHP

```php
$ch = curl_init('http://192.168.1.52:3000/api/materials');
curl_setopt_array($ch, [
  CURLOPT_HTTPHEADER => ['Authorization: Bearer kppd_xxxxx...'],
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_TIMEOUT => 10,
]);
$data = json_decode(curl_exec($ch), true);
```

### Агент (Gemini / Claude)

Отдаёшь агенту: базовый URL + ключ + ссылку на Swagger (`/docs`) или на этот файл.
Агент сам разбирается в эндпоинтах и работает с данными.

---

## 4. Кто и что может (права)

| Роль | Права |
|--|--|
| `admin` | всё, включая выдачу ключей и управление пользователями |
| `manager` | чтение + запись в рабочих модулях |
| `user` | в основном чтение |

Права раздаются в модулях (`Roles`, `Permissions`). Новая внешняя интеграция — заводи под **отдельный ключ с TTL**, чтобы в любой момент можно было отозвать одну интеграцию, не трогая остальные.

---

## 5. Правила (чтобы база не портилась)

1. **Не подключайся к MongoDB напрямую** — только через API. Прямая запись ломает счётчики, аудит и уникальность.
2. **Один ключ = одна интеграция.** Легко отозвать — легко искать утечку.
3. TTL для разовых/экспериментальных ключей — `7d` или `30d`, не `never`.
4. Тяжёлые операции — через API-эндпоинты, не «просто пройтись по коллекции».

---

## 6. MCP (для агентов) — в подготовке

Планируется MCP-сервер поверх этого же API, чтобы агенты работали с данными как с инструментом
(список/создание/обновление записей), а не парсили JSON руками.
Прототип существует в kppdf-8.0 (`desktop/mcp`) — будет адаптирован сюда.
