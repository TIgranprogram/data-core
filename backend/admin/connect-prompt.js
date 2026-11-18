/* Единый промпт/файл для ИИ: вкладки «API-ключи» и «Подключение».
 * Не дублировать текст в admin.js — менять только здесь. */
(function () {
  const ACCESS_LABEL = { read: 'Только чтение', write: 'Чтение и запись', full: 'Полный доступ' };
  const PUBLIC = {
    api: 'https://kppdf-crm.ru/db/api',
    app: 'https://kppdf-crm.ru/db/app/',
    admin: 'https://kppdf-crm.ru/db/admin/',
    lan: 'http://<IP-домашнего-сервера>:3001/api',
  };

  function apiUrls(apiPath) {
    const here = location.origin + (apiPath || '/api');
    return { publicApi: PUBLIC.api, publicApp: PUBLIC.app, publicAdmin: PUBLIC.admin, here, lan: PUBLIC.lan };
  }

  /** Markdown для ИИ: адреса, ключ, менеджер, куда писать, как не испортить, лог ошибок. */
  function buildManagerFile({ apiKey, label, access, apps, apiPath } = {}) {
    const u = apiUrls(apiPath);
    const rights = ACCESS_LABEL[access] || ACCESS_LABEL.write;
    const keyBlock = apiKey
      ? apiKey
      : 'kppd_…  ← ВСТАВЬТЕ ключ, сохранённый при выдаче (метка «' + (label || '…') + '»). На сервере только хеш — повторно не показывают.';
    const appLine = Array.isArray(apps) && apps.length ? apps.join(', ') : 'все приложения /apps (если не ограничили при выдаче)';
    return [
      '# Data Core — подключение ИИ / скрипта как менеджер',
      '',
      'Ты работаешь с личной базой пользователя **только через REST API**. Прямого MongoDB нет.',
      'Роль по смыслу — **менеджер**: заполнять и править рабочие данные, **не ломая** общие справочники и чужие записи.',
      '',
      '## 1. Адреса (что куда)',
      '',
      '| Что | URL |',
      '|--|--|',
      `| API из интернета (основной) | \`${u.publicApi}\` |`,
      `| Этот же сайт сейчас (origin) | \`${u.here}\` |`,
      `| Из домашней сети (LAN) | \`${u.lan}\` |`,
      `| Рабочее место (экраны) | \`${u.publicApp}\` |`,
      `| Админка | \`${u.publicAdmin}\` |`,
      '',
      'Базовый URL API = адрес без хвоста пути. Health без ключа: `GET <API>/health/ready` → 200.',
      '',
      '## 2. Ключ и права (отдельной роли «ИИ» нет — так задумано)',
      '',
      `- Метка: **${label || '—'}**`,
      `- Права ключа: **${rights}**`,
      `- Приложения /apps: **${appLine}**`,
      '',
      'Роль человека в системе не дублируем: для ИИ выдают ключ `kppd_` с **«Чтение и запись» (write)**.',
      'Write ≈ менеджер: CRUD рабочих данных, **без** `/admin`, ролей, пользователей и выдачи ключей.',
      'Не просите `full` — он шире, чем нужно агенту. Отдельный пользователь «ИИ» не обязателен.',
      '',
      '```',
      keyBlock,
      '```',
      '',
      'Заголовок: `Authorization: Bearer <ключ>` (или `X-Access-Token`). `Content-Type: application/json` при теле.',
      '',
      '## 3. Сначала контракт (тем же ключом)',
      '',
      `1. GET ${u.publicApi}/meta/guide`,
      `2. GET ${u.publicApi}/meta/schema`,
      `3. GET ${u.publicApi}/meta/openapi.json`,
      '',
      'Списки: `{ items, total, page, limit }`, у объекта строковый `id`. Лишнее поле → 400. ~10 запросов/с.',
      '',
      '## 4. Куда класть данные (не перепутай)',
      '',
      'Экраны: ' + u.publicApp + ' — те же данные, что API. Клади только в «свою» таблицу:',
      '',
      '| Задача человека | API | Не путать с |',
      '|--|--|--|',
      '| Контрагент (фирма, поставщик, заказчик) | `/partners`, `/organizations` | не в заявки и не в заказы |',
      '| Заявка на закупку | `/supply/requests` (+ bulk) | не в расходы `/expenses` без нужды |',
      '| Заказ клиенту | `/salesorders` | позиции заказа — `/incomes` |',
      '| Строка заказа / оплата | `/incomes` | не создавать «левое» изделие вместо привязки |',
      '| Изделие каталога | `/showcase`, `/products` | не дублировать по похожему имени — сначала поиск |',
      '| Склад / материал | `/stock/...`, `/materials` | общие с CRM — только точечно |',
      '| Значение выпадающего списка | `/dicts/<ключ>` | не писать код TRN в название |',
      '| Свои заметки/таблицы агента | `/apps/<app>/<collection>` | не общие справочники |',
      '',
      'Перед **правкой** существующей записи: найди её `GET` (поиск/`id`), меняй только нужные поля `PATCH`. Не `DELETE` массово. Не выдумывай поля — только schema/OpenAPI.',
      'Общие с CRM коллекции (материалы, организации, склад…) — не чисти и не переименовывай «на глаз».',
      'Не делай: ключи, пользователи, роли, `/admin/*`.',
      '',
      '## 5. Ошибки — лог на сайте для разработчиков',
      '',
      'Если запрос вернул 4xx/5xx, данные неясны или ты чуть не испортил запись — **сохрани лог** (ключ `kppd_` для этого разрешён):',
      '',
      `POST ${u.publicApi}/client-errors`,
      '',
      'Тело (только эти поля):',
      '```json',
      '{',
      '  "kind": "integration",',
      '  "message": "кратко: что не вышло (без паролей и без полного ключа)",',
      '  "name": "AiAgent",',
      '  "section": "#ai-agent",',
      '  "action": "что пытался сделать (например: создать заявку)",',
      '  "status": 400,',
      '  "url": "/api/supply/requests",',
      '  "stack": "ответ сервера или стек, без секретов"',
      '}',
      '```',
      '',
      '- `kind` обязательно `"integration"` — иначе ключ получит 403.',
      '- Не клади в лог ключ `kppd_…`, пароли, персональные полные тексты без нужды; сервер маскирует секреты, но не злоупотребляй.',
      '- Ответ 204 = принято. Потом разработчик видит это в `dc errors` и в `GET /api/client-errors/top` (пометка «ИИ», section `#ai-agent`).',
      '- После ошибки: остановись или исправь по schema; не повторяй тот же вредный PATCH в цикле.',
      '',
      '## 6. Мини-пример',
      '',
      '```bash',
      `API="${u.publicApi}"`,
      'KEY="kppd_…"',
      'curl -s "$API/health/ready"',
      'curl -s "$API/partners?limit=20" -H "Authorization: Bearer $KEY"',
      'curl -s -X POST "$API/client-errors" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \\',
      '  -d \'{"kind":"integration","message":"тест лога ИИ","name":"AiAgent","section":"#ai-agent","action":"smoke"}\'',
      '```',
      '',
      '## 7. Безопасность',
      '',
      '- Один ключ — одна интеграция; не в открытый репозиторий.',
      '- При сомнении — сначала GET/schema, потом маленькая запись, при сбое — лог `integration`.',
      '',
      'Файл из админки Data Core · ' + new Date().toISOString(),
    ].join('\n');
  }

  function downloadManagerFile(meta) {
    const safe = String(meta.label || 'key').replace(/[^\wа-яёА-ЯЁ-]+/gi, '_').slice(0, 40) || 'key';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([buildManagerFile(meta)], { type: 'text/markdown;charset=utf-8' }));
    a.download = `datacore-manager-${safe}.md`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  window.DcConnectPrompt = { ACCESS_LABEL, apiUrls, buildManagerFile, downloadManagerFile, PUBLIC };
})();
