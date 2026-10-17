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
| VM name | `<VM_NAME>` |
| LAN IP | **`<LAN_IP>`** |
| Docker bridge | `172.17.0.1` (не для SSH) |
| WAN IP | `<WAN_IP>` (SSH auth fail с dev-машины) |
| Пользователь | `<SSH_USER>` |
| Пароль | `<DEPLOY_PASSWORD>` — см. gitignored `CREDENTIALS.md` / `config.env` |
| SSH-ключи (Windows) | `%USERPROFILE%\.ssh\<SSH_KEY_NAME>` |

---

## deploy/synology/config.env

| Переменная | Описание |
|------------|----------|
| `DEPLOY_HOST` | **`<LAN_IP>`** (LAN) — основной; WAN `<WAN_IP>` не работает |
| `DEPLOY_USER` | `<SSH_USER>` |
| `DEPLOY_PASSWORD` | SSH-пароль (или `DEPLOY_SSH_KEY`) |
| `DEPLOY_SSH_KEY` | путь к приватному ключу `<SSH_KEY_NAME>` |
| `REMOTE_DIR` | `/opt/kppdf-8.0` |
| `KPPDF_DATA_DIR` | `/var/lib/kppdf80` |
| `JWT_SECRET` | 64 hex |
| `JWT_REFRESH_SECRET` | отдельная 64 hex строка |
| `ADMIN_PASSWORD` | ≥12 символов, не demo-default |
| `CORS_ORIGIN` | `https://<DOMAIN>` |

---

## Приложение KPPDF (web UI)

| Поле | Значение |
|------|----------|
| URL prod | https://<DOMAIN> |
| URL LAN | http://<LAN_IP>:3000 |
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
| Домен | <DOMAIN> |
| Tunnel | ~~cloudflared~~ — legacy kppdf-3.0 (см. `deploy/synology/tunnel_*.py` там). Канон v8: SSH reverse tunnel, systemd `kppdf-tunnel` на VM → VPS. См. `DEPLOY.md`. |

---

## Legacy (откуда скопированы секреты)

| Проект | Файл |
|--------|------|
| kppdf-3.0 | `<OLD_PROJECT>/deploy/synology/config.env` |
| kppdf-4.0 | `<OLD_PROJECT>/deploy/config.env` |

> **SSH на сервер КП3 для перелива данных** — отдельный ключ, не этот контур:  
> `deploy/kp3-data-copy/` + канон `docs/ops/kp3-data-copy-access.md` (ключ `kppdf8-kp3-data-copy`).

---

## Заметки после успешного деплоя

_Заполнить после первого успешного deploy:_

- Дата успешного деплоя: ___
- Рабочий SSH-хост (LAN/WAN): ___
- One-command: `.\deploy\synology\deploy.ps1` (см. `README.md`)
- Примечания: ___
