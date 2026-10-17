# KPPDF 8.0 — учётные данные (ШАБЛОН)

> Скопируй в **`CREDENTIALS.md`** (тот же каталог) и заполни реальными значениями.  
> `CREDENTIALS.md` в `.gitignore` — **не коммитится**.

```powershell
copy deploy\synology\CREDENTIALS.example.md deploy\synology\CREDENTIALS.md
```

---

## SSH (Ubuntu VM на Synology)

| Поле | Значение |
|------|----------|
| VM name | `ubuntu24kppdf_8` |
| LAN IP | **`192.168.1.52`** |
| Docker bridge | `172.17.0.1` (не для SSH) |
| WAN IP | `193.222.62.240` (SSH auth fail с dev-машины) |
| Пользователь | `tiit` |
| Пароль | `<DEPLOY_PASSWORD>` — см. gitignored `CREDENTIALS.md` / `config.env` |
| SSH-ключи (Windows) | `%USERPROFILE%\.ssh\kppdf80-vm` |

---

## deploy/synology/config.env

| Переменная | Описание |
|------------|----------|
| `DEPLOY_HOST` | **`192.168.1.52`** (LAN) — основной; WAN `193.222.62.240` не работает |
| `DEPLOY_USER` | `tiit` |
| `DEPLOY_PASSWORD` | SSH-пароль (или `DEPLOY_SSH_KEY`) |
| `DEPLOY_SSH_KEY` | путь к приватному ключу `kppdf80-vm` |
| `REMOTE_DIR` | `/opt/kppdf-8.0` |
| `KPPDF_DATA_DIR` | `/var/lib/kppdf80` |
| `JWT_SECRET` | 64 hex |
| `JWT_REFRESH_SECRET` | отдельная 64 hex строка |
| `ADMIN_PASSWORD` | ≥12 символов, не demo-default |
| `CORS_ORIGIN` | `https://kppdf-crm.ru` |

---

## Приложение KPPDF (web UI)

| Поле | Значение |
|------|----------|
| URL prod | https://kppdf-crm.ru |
| URL LAN | http://192.168.1.52:3000 |
| Admin login | `admin` |
| Admin password | из `config.env` `ADMIN_PASSWORD` (не demo-default) |

> После первого входа смените пароль admin в production.

---

## Docker на сервере

```bash
sudo docker ps
# kppdf-mongo, kppdf-backend
```

---

## Cloudflare / домен

| | |
|---|---|
| Домен | kppdf-crm.ru |
| Tunnel | ~~cloudflared~~ — legacy kppdf-3.0 (см. `deploy/synology/tunnel_*.py` там). Канон v8: SSH reverse tunnel, systemd `kppdf-tunnel` на VM → VPS. См. `DEPLOY.md`. |

---

## Legacy (откуда скопированы секреты)

| Проект | Файл |
|--------|------|
| kppdf-3.0 | `WebstormProjects/kppdf-3.0/deploy/synology/config.env` |
| kppdf-4.0 | `WebstormProjects/kppdf-4.0/deploy/config.env` |

> **SSH на сервер КП3 для перелива данных** — отдельный ключ, не этот контур:  
> `deploy/kp3-data-copy/` + канон `docs/ops/kp3-data-copy-access.md` (ключ `kppdf8-kp3-data-copy`).

---

## Заметки после успешного деплоя

_Заполнить после первого успешного deploy:_

- Дата успешного деплоя: ___
- Рабочий SSH-хост (LAN/WAN): ___
- One-command: `.\deploy\synology\deploy.ps1` (см. `README.md`)
- Примечания: ___
