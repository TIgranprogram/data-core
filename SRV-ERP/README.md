# Стенд ERP — сервер у друга (sportin)

Тестовый стенд data-core ERP, поднятый на сервере Тиграна (Sportin).  
Используется для демонстрации и тестирования без VPN.

---

## Подключение

| Параметр | Значение |
|---|---|
| Локальный IP | 192.168.88.6 |
| Внешний IP | 31.222.224.247 |
| Домен (KeenDNS) | sportin.netcraze.pro |
| SSH-порт | 22 |
| Пользователь SSH | erpadmin |
| SSH-ключ | `~/.ssh/erp_server` (ed25519, без пароля) |

**Пароль** — в файле `connect.txt` (не коммитится, `.gitignore`).

```bash
ssh erpadmin@sportin.netcraze.pro
```

---

## Приложение

| Что | Адрес |
|---|---|
| PWA (Рабочее место) | http://31.222.224.247:8080/app/ |
| Healthcheck | http://31.222.224.247:8080/api/health/ready |

> **Важно:** домен `sportin.netcraze.pro:8080` **не работает** — KeenDNS пропускает только порты 80 и 443.  
> Всегда использовать прямой IP `31.222.224.247`.

---

## Роутер Keenetic

- Порт 80 — занят веб-интерфейсом Keenetic (не пробрасывается)
- Порт 8080 → 192.168.88.6:3001 (проброс настроен на роутере)
- Приложение слушает на порту 3001 внутри сети

---

## Развёртывание на новом сервере

### 1. Подготовка

```bash
# На сервере: установить Docker + Docker Compose
sudo apt-get install -y docker.io docker-compose-plugin

# Создать директорию
sudo mkdir -p /opt/data-core
sudo chown $USER:$USER /opt/data-core
```

### 2. Загрузить bundle

```bash
# С рабочей машины
scp datacore-bundle-vX.XXX-DATE.tar.gz erpadmin@sportin.netcraze.pro:/opt/data-core/

# На сервере
cd /opt/data-core
tar -xzf datacore-bundle-vX.XXX-DATE.tar.gz
```

### 3. Настроить .env

```bash
cp .env.example .env
nano .env
```

Ключевые переменные:
```
NODE_ENV=production
CORS_ORIGIN=http://31.222.224.247:8080
MONGO_URI=mongodb://...
JWT_SECRET=...
```

### 4. Запустить

```bash
cd /opt/data-core
sudo docker compose -f docker-compose.prod.yml up -d
```

### 5. Проверить

```bash
sudo docker compose -f docker-compose.prod.yml ps
curl http://127.0.0.1:3001/api/health/ready
```

---

## Диагностика

### Сервер не отвечает — где проблема?

```
Браузер → Роутер → Сервер → Docker → NestJS
```

| Симптом | Причина | Что делать |
|---|---|---|
| `ERR_CONNECTION_REFUSED` на 8080 | Роутер не пробрасывает порт | Проверить проброс на Keenetic: 8080 → 192.168.88.6:3001 |
| Домен sportin.netcraze.pro:8080 не открывается | KeenDNS блокирует нестандартные порты | Использовать прямой IP 31.222.224.247:8080 |
| Открывается 403 "Web server" | Попали на веб-морду Keenetic, не на сервер | Использовать прямой IP, не домен |
| `ERR_SSL_PROTOCOL_ERROR` на JS-файлах | В CSP есть `upgrade-insecure-requests` | Пересобрать или пропатчить main.js (см. ниже) |
| Приложение открывается, но не входит | CORS не соответствует адресу | В .env: `CORS_ORIGIN=http://31.222.224.247:8080` |
| Healthcheck 200, но страница пустая | Контейнер frontend упал | `docker ps`, `docker logs datacore-frontend` |

### Полезные команды на сервере

```bash
# Состояние контейнеров
sudo docker compose -f /opt/data-core/docker-compose.prod.yml ps

# Логи backend
sudo docker logs datacore-backend --tail 50

# Логи mongo
sudo docker logs datacore-mongo --tail 20

# Healthcheck
curl http://127.0.0.1:3001/api/health/ready

# CSP-заголовок (не должен содержать upgrade-insecure-requests)
curl -sI http://127.0.0.1:3001/app/ | grep content-security

# Открытые порты
sudo ss -tlnp | grep -E '3001|8080'
```

### Перезапуск backend

```bash
cd /opt/data-core
sudo docker compose -f docker-compose.prod.yml restart backend
```

---

## SSH-ключ

Ключ `~/.ssh/erp_server` (ed25519) настроен для passwordless входа.  
Публичный ключ добавлен в `~erpadmin/.ssh/authorized_keys` на сервере.

```bash
# Добавить ключ в ssh-agent
ssh-add ~/.ssh/erp_server

# Или указать явно
ssh -i ~/.ssh/erp_server erpadmin@sportin.netcraze.pro
```

---

## Важные заметки

1. **CSP в main.ts** — `useDefaults: false` обязателен, иначе helmet добавляет `upgrade-insecure-requests` автоматически, и все JS-модули ломаются на HTTP-стенде.
2. **HSTS отключён** (`hsts: false`) — на HTTP без домена HSTS бессмысленен и мешает.
3. **Пересборка** — после `docker build` патч на compiled JS теряется. Исходник `backend/src/main.ts` уже исправлен, перестройка не сломает.
4. **Данные** — в MongoDB прод-данные, перенесённые бандлом. Не чистить без предупреждения.
