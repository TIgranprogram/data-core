# data-core — учётные данные (ШАБЛОН)

> Скопируй в `CREDENTIALS.md` (тот же каталог, gitignored) и заполни. Сюда — только плейсхолдеры.
> Технические секреты деплоя живут в `config.env` (шаблон `config.env.example`); здесь — то, что нужно человеку.

```powershell
copy deploy\synology\CREDENTIALS.example.md deploy\synology\CREDENTIALS.md
```

## VM (Ubuntu на Synology)

| Поле | Значение |
|--|--|
| LAN IP | `<LAN_IP>` (без VPN) |
| SSH | `<SSH_USER>@<LAN_IP>`, ключ `%USERPROFILE%\.ssh\<SSH_KEY_NAME>` |
| Каталоги | `/opt/data-core`, данные `/var/lib/datacore` |

## data-core

| Поле | Значение |
|--|--|
| API | `http://<LAN_IP>:3001/api` |
| Админка | `http://<LAN_IP>:3001/admin` |
| Логин | `admin` / `<ADMIN_PASSWORD>` (= `ADMIN_PASSWORD` из `config.env`, пока не сменён в админке) |
| Mongo (только с VM) | `127.0.0.1:27018`, `root` / `<MONGO_ROOT_PASSWORD>`, app-user `datacore` / `<MONGO_APP_PASSWORD>` |

## Выданные API-ключи `kppd_…`

| Label | Для чего | TTL | Где хранится секрет |
|--|--|--|--|
| `<label>` | `<интеграция>` | `30d` | `<где>` |
