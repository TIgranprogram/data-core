// Каталог пульта администратора сайта.
// Пульт — механические запуски на этом ПК (проверки, выкладка, копии), без кнопок для ИИ
// и без скриптов правки данных. Новая команда = запись здесь → экран и pult/docs/КОМАНДЫ.md.
//
// Запись команды:
//   id      уникальный код, не меняется
//   title   название кнопки — по-русски
//   hint    когда нажимать и что получится
//   risk    read | local | prod-write | danger (см. RISKS)
//   time    примерное время
//   run     { node|bash|git|cmd|npx|docker: [...], cwd? } | { open } | { folder } | { deploy } | { vm }
//   needs   ['bash','docker','vm'] — без этого кнопка серая
//   every   ритм в днях + why — попадёт на экран «Что делать сейчас»
//   params  [{ name, label, type:'select', options, default }]
//   confirm / word — для записи на сайт и опасных действий

export const RISKS = {
  read: { label: 'Только чтение', hint: 'Ничего не меняет' },
  local: { label: 'Сайт не затрагивает', hint: 'Меняет этот ПК, стенд или копию. Рабочий сайт как был' },
  'prod-write': { label: 'Меняет сайт', hint: 'Меняет рабочий сайт. Пульт спросит подтверждение' },
  danger: { label: 'Опасно', hint: 'Для запуска надо ввести слово' },
};

export const GROUPS = [
  { id: 'start', title: '', color: 'start' },
  { id: 'site', title: 'Рабочий сайт', color: 'site' },
  { id: 'checks', title: 'Проверки и ИИ', color: 'dev' },
  { id: 'copies', title: 'Копии и Sportin', color: 'copies' },
  { id: 'pc', title: 'Этот компьютер', color: 'pc' },
];

// Раздел now — экран «Что делать сейчас» (advisor.mjs).
// Раздел auto — автозапуск (SCHEDULE) плюс задачи Windows.
export const SECTIONS = [
  { id: 'now', group: 'start', title: 'Что делать сейчас', icon: '🧭', hint: 'Пульт смотрит на проект и подсказывает, что запустить' },
  { id: 'day', group: 'start', title: 'Каждый день', icon: '☀', hint: 'Состояние рабочего сайта и его ошибки. Ничего не меняет' },
  { id: 'deploy', group: 'site', title: 'Выкладка', icon: '🚀', hint: 'По порядку: ворота → выкладка → проверка после' },
  { id: 'datafix', group: 'site', title: 'Разовые правки данных', icon: '🧩', hint: 'Кнопки от Claude под конкретную задачу. Каждую — один раз после выкладки; повтор безопасен' },
  { id: 'site', group: 'site', title: 'Сервер', icon: '🗄', hint: 'Место на диске сервера. Раз в месяц' },
  { id: 'check', group: 'checks', title: 'Проверки на этом ПК', icon: '✅', hint: 'Код и экраны сайта на стенде этого ПК. Итог читает Claude и чинит точечно' },
  { id: 'aitester', group: 'checks', title: 'ИИ-тестировщик', icon: '🤖', hint: 'Локальный ИИ ходит по стенду как менеджер и пишет отчёт. По порядку: 0 → 1 → 2' },
  { id: 'localai', group: 'checks', title: 'Excel заказа (ИИ)', icon: '📄', hint: 'Документы заказа → локальный ИИ → Excel → импорт на сайт' },
  { id: 'backups', group: 'copies', title: 'Копии базы', icon: '💾', hint: 'Скачать копию на этот ПК и учебное восстановление' },
  { id: 'sportin', group: 'copies', title: 'Sportin', icon: '🖥', hint: 'Второй сервер: обновить, бэкап, проверка копии' },
  { id: 'stand', group: 'pc', title: 'Стенды', icon: '🧰', hint: 'Сайт на этом ПК для длинных проверок. Занимает память — остановите, когда не нужен' },
  { id: 'auto', group: 'pc', title: 'Автозапуск', icon: '⏰', hint: 'Что пульт запускает сам, пока открыт' },
  { id: 'setup', group: 'pc', title: 'Настройка ПК', icon: '⚙', hint: 'Разовая подготовка этого компьютера' },
  { id: 'links', group: 'pc', title: 'Ссылки и папки', icon: '🔗', hint: 'Сайт, админка и рабочие папки' },
];

export const SCHEDULE = [
  { id: 'day-start', kind: 'daily', time: '09:00', enabled: true },
  { id: 'day-errors', kind: 'daily', time: '18:00', enabled: true, params: { hours: '24' } },
  { id: 'prod-doctor', kind: 'weekly', day: 1, time: '09:30', enabled: true },
  { id: 'day-data', kind: 'weekly', day: 1, time: '10:00', enabled: true },
  { id: 'code-check', kind: 'daily', time: '09:10', enabled: true },
  { id: 'sportin-drill', kind: 'monthly', day: 1, time: '12:00', enabled: true },
];

const dc = (...args) => ({ node: ['tools/dc.mjs', ...args], soft: true });

export const COMMANDS = [
  // ---------- Каждый день ----------
  { id: 'day-start', section: 'day', title: 'Начало работы', risk: 'read', time: '20 с', needs: ['bash'], run: dc('start'), every: 1, why: 'Первая кнопка за день: ошибки сайта и состояние кода',
    hint: 'Первая кнопка за день. Ветка, отставание от GitHub, незакоммиченное и ошибки сайта за сутки.' },
  { id: 'day-status', section: 'day', title: 'Рабочий сайт: быстрая проверка', risk: 'read', time: '20 с', needs: ['bash'], run: dc('status'),
    hint: 'Живой запрос к рабочему сайту: здоровье, возраст копии, версия. Ничего не меняет.' },
  { id: 'day-errors', section: 'day', title: 'Ошибки с сайта', risk: 'read', time: '15 с', needs: ['bash'], run: dc('errors', '{hours}'),
    params: [{ name: 'hours', label: 'За какой срок', type: 'select', default: '24', options: [
      { value: '2', label: '2 часа' }, { value: '24', label: 'Сутки' }, { value: '72', label: '3 дня' }, { value: '168', label: 'Неделя' }] }],
    hint: 'Какие ошибки видели люди на сайте и на каких экранах. Новые — чинить первыми.' },
  { id: 'day-data', section: 'day', title: 'Что заполнить в данных', risk: 'read', time: '15 с', needs: ['bash'], run: dc('data'), every: 7, why: 'Раз в неделю: сколько записей ждут заполнения',
    hint: 'Сводка «Требуют заполнения»: сколько записей без важных полей. Только чтение.' },

  // ---------- Выкладка ----------
  { id: 'deploy-gate', section: 'deploy', title: 'Проверить ворота', risk: 'read', time: '1–5 мин', needs: ['bash'], run: { bash: ['deploy/synology/preflight.sh'] },
    hint: 'Можно ли выкладывать: всё закоммичено, в GitHub, тесты зелёные. Сайт не меняет.' },
  { id: 'deploy-link', section: 'deploy', title: 'Проверить связь с сервером', risk: 'read', time: '30 с', needs: ['bash', 'vm'], run: { bash: ['remote-access/check.sh'] },
    hint: 'Цепочка до домашнего сервера. Нажмите, если выкладка не может зайти.' },
  { id: 'deploy-release', section: 'deploy', title: 'Выложить на сайт', risk: 'prod-write', time: '5–10 мин', needs: ['bash', 'vm'], run: { deploy: [] },
    confirm: 'Новая версия уйдёт на рабочий сайт. Порядок: ворота, копия базы, замена файлов, сборка, перезапуск, проверка.',
    hint: 'Обычная выкладка после готовности кода. Сначала ворота. Копия базы делается сама.' },
  { id: 'deploy-post', section: 'deploy', title: 'Проверка после выкладки', risk: 'read', time: '15 с', needs: ['bash'], run: { bash: ['deploy/synology/post-check.sh'] },
    hint: 'Через 1–2 часа после выкладки. Новые ошибки сайта на этой версии.' },
  { id: 'c054-passport-plan', section: 'datafix', title: 'Паспорта: записать признаки воронки', risk: 'prod-write', time: '1–3 мин', needs: ['bash', 'vm'],
    run: { bash: ['deploy/synology/c054-passport-plan.sh'] },
    confirm: 'В справочники паспортов запишутся признаки и условия пунктов. Выданные паспорта и № 597 не меняются. Запускать только после выкладки воронки паспортов.',
    hint: 'Один раз после выкладки C054. Повтор безопасен: те же значения, дублей не будет.' },
  { id: 'c054-parts-coatings', section: 'datafix', title: 'Паспорта: части и покрытия по категориям', risk: 'prod-write', time: '1–3 мин', needs: ['bash', 'vm'],
    run: { bash: ['deploy/synology/c054-parts-coatings.sh'] },
    confirm: 'У 39 частей и 39 материалов/покрытий проставятся категории (TRN/WRK/BLG/DIO/DSP). Пустые больше не считаются «для всех». Новые части не создаются. Выданные паспорта не меняются.',
    hint: 'Планы — docs/crew/C054-passport-funnel/REPORT-parts.md и REPORT-coatings.md. Повтор безопасен: совпадающие пропускаются.' },
  { id: 'c063-joints-materials', section: 'datafix', title: 'Паспорта: конструкция и материалы', risk: 'prod-write', time: '3–8 мин', needs: ['bash', 'vm'],
    run: { bash: ['deploy/synology/c063-joints-materials.sh'] },
    confirm: '476 изделий получат конструкцию «Болтовые + Сварные», 207 — «Из чего сделано» — из своего выпущенного паспорта (труба, профиль, лист, покрытие…). Пишется только в пустую таблицу; выданные паспорта не меняются.',
    hint: 'Список — docs/crew/C063-joints-materials/REVIEW.md. Повтор безопасен: заполненное пропускается.' },
  { id: 'c062-passport-purpose', section: 'datafix', title: 'Паспорта: назначение, элементы, установка', risk: 'prod-write', time: '3–8 мин', needs: ['bash', 'vm'],
    run: { bash: ['deploy/synology/c062-passport-purpose.sh'] },
    confirm: 'У изделий с пустыми полями запишутся «Назначение» (вариант текста), «Элементы» и «Способ установки» — по названию и группе. Заполненное не меняется, выданные паспорта не меняются.',
    hint: 'Список — docs/crew/C062-passport-purpose/REVIEW.md. Повтор безопасен: заполненное пропускается.' },
  { id: 'c066-passport-users', section: 'datafix', title: 'Паспорта: пользователи, возраст, рост, вес', risk: 'prod-write', time: '3–8 мин', needs: ['bash', 'vm'],
    run: { bash: ['deploy/synology/c066-passport-users.sh'] },
    confirm: 'В пустые умолчания паспорта запишутся maxUsers / возраст / рост / вес — из выпущенного паспорта, по группе (≥80 %) или «тренажёр → 1 пользователь». Заполненное не меняется, выданные паспорта не меняются.',
    hint: 'Список — docs/crew/C066-passport-users/REVIEW.md. Повтор безопасен: заполненное пропускается.' },
  { id: 'c061-trainers-load', section: 'datafix', title: 'Тренажёры: грузоблочные и суставные', risk: 'prod-write', time: '1–3 мин', needs: ['bash', 'vm'],
    run: { bash: ['deploy/synology/c061-trainers-load.sh'] },
    confirm: 'У 92 тренажёров запишется признак «Нагрузка»: 18 — «Изменяемая (грузы)», 74 — «Собственный вес». 4 тренажёра перейдут в группу «Тренажеры». Артикулы и выданные паспорта не меняются.',
    hint: 'Список — docs/crew/C061-trainers-load/REVIEW.md. Повтор безопасен: те же значения.' },
  { id: 'c061-wrong-category', section: 'datafix', title: 'Паспорта: 8 изделий — не «Уличный тренажёр»', risk: 'prod-write', time: '1 мин', needs: ['bash', 'vm'],
    run: { bash: ['deploy/synology/c061-wrong-category.sh'] },
    confirm: 'У 8 изделий (воркаут, ограждение, помост, стойки, павильон) снимется своя категория паспорта «Уличный тренажёр». Будет действовать категория группы: «Воркаут и спортивное оборудование» или «Благоустройство». Выданные паспорта не меняются.',
    hint: 'Список — docs/crew/C061-trainers-load/wrong-category.json. Повтор безопасен.' },

  { id: 'prod-doctor', section: 'day', title: 'Рабочий сайт: полный осмотр (раз в неделю)', risk: 'read', time: '1 мин', needs: ['bash'], run: { bash: ['deploy/synology/doctor.sh'], soft: true }, every: 7, why: 'Раз в неделю: полный осмотр сайта',
    hint: 'Диск, копии, целостность, скорость. Итог ✓ / ⚠ / ✗. Раз в неделю и после выкладки.' },

  // ---------- Проверки ----------
  { id: 'code-check', section: 'check', title: 'Быстрая проверка', risk: 'read', time: '2–4 мин', run: dc('check'), every: 1, why: 'Каждый день: типы, тесты и пульт. Замечание остаётся, пока проверка не станет зелёной',
    hint: 'Типы, юнит-тесты, импорты, дизайн и пульт. Те же шаги, что в воротах. Утром пульт запускает сам, если открыт.' },
  { id: 'check-full', section: 'check', title: 'Полная проверка', risk: 'local', time: '20–60 мин', needs: ['docker'], run: dc('full'),
    hint: 'Долгий прогон на отдельном стенде: типы, юнит, сквозные тесты и обходы. Рабочий сайт не трогает. Итог — локальный отчёт.' },
  { id: 'site-audit', section: 'check', title: 'Большая проверка сайта', risk: 'local', time: '10–30 мин', needs: ['docker'], run: dc('audit'),
    hint: 'Обходит экраны на трёх ширинах, снимки, мусор в тексте, ошибки API. Поднимает стенд сама. Отчёт читает ИИ и чинит точечно.' },
  { id: 'order-progress', section: 'check', title: 'Порядок интерфейса', risk: 'read', time: '5 с', run: dc('order'),
    hint: 'Одна строка: сколько экранов собрано из эталонов и сколько нарушений дизайна осталось. Число пишется в журнал.' },
  { id: 'site-audit-last', section: 'check', title: 'Итог большой проверки', risk: 'read', time: '2 с', run: dc('audit', 'last'),
    hint: 'Короткая сводка и путь к отчёту большой проверки.' },

  // ---------- Копии ----------
  { id: 'setup-backup', section: 'backups', title: 'Скачать копию базы на этот ПК', risk: 'local', time: '5–15 мин', needs: ['vm'], run: { powershell: ['deploy/backup-pull/pull-backup.ps1'], vmEnv: true },
    hint: 'Кладёт свежий бэкап в D:\\datacore-backups. Нужен стенду на копии. В архиве рабочие данные — никому не передавайте.' },
  { id: 'prod-drill', section: 'backups', title: 'Учебное восстановление (дом)', risk: 'prod-write', time: '5–15 мин', needs: ['bash', 'vm'], run: { vm: 'cd /opt/data-core && bash deploy/synology/restore-drill.sh' }, every: 30, why: 'Раз в месяц: проверка, что копия дома восстанавливается',
    confirm: 'Последняя копия развернётся во временную базу, числа сверятся, база удалится. Рабочая база не меняется.',
    hint: 'Раз в месяц. Доказывает, что домашняя копия восстанавливается.' },

  // ---------- Sportin ----------
  { id: 'sportin-version', section: 'sportin', title: 'Обновить версию (код + база + фото)', risk: 'local', time: '15–40 мин', needs: ['bash'], run: { bash: ['SRV-ERP/refresh-copy.sh', '--code'] },
    confirm: 'Sportin получит код с этого ПК и свежую копию базы Дома. Изменения на Sportin пропадут. Дом не меняется.',
    hint: 'Главная кнопка обновления второго сервера. Нужен включённый домашний ПК и свежая копия базы.' },
  { id: 'sportin-copy', section: 'sportin', title: 'Обновить только базу и фото', risk: 'local', time: '10–40 мин', needs: ['bash'], run: { bash: ['SRV-ERP/refresh-copy.sh'] },
    confirm: 'База на Sportin заменится копией Дома. Изменения на Sportin пропадут. Дом не меняется.',
    hint: 'Без кода. Так же каждый день в 11:00 делает задача Windows (раздел «Автозапуск»).' },
  { id: 'sportin-backup', section: 'sportin', title: 'Сделать бэкап сейчас', risk: 'local', time: '1–5 мин', needs: ['bash'], run: { bash: ['SRV-ERP/backup-now.sh'] },
    hint: 'Копия базы и фото на втором сервере, не дожидаясь ночи.' },
  { id: 'sportin-drill', section: 'sportin', title: 'Учебное восстановление', risk: 'local', time: '1–3 мин', needs: ['bash'], run: { bash: ['SRV-ERP/restore-drill-erp.sh'] }, every: 30,
    why: 'Раз в месяц: проверка, что копия Sportin восстанавливается',
    hint: 'Разворачивает последнюю копию во временную базу и удаляет её. Рабочая база не меняется.' },
  { id: 'sportin-smb', section: 'sportin', title: 'Включить ночной бэкап и копии на NAS', risk: 'local', time: '1–3 мин', needs: ['bash'], run: { bash: ['SRV-ERP/push-smb.sh'] },
    confirm: 'На втором сервере появится ночной бэкап и отправка копий на NAS. Рабочий сайт Дома не меняется.',
    hint: 'Разово после обновления версии. Повтор ничего не дублирует.' },

  // ---------- Стенды (скрытые — карточки SWITCHES) ----------
  { id: 'stand-up', section: 'stand', hidden: true, title: 'Локальный сайт: запустить', risk: 'local', time: '2–5 мин', needs: ['docker'], run: { docker: ['compose', 'up', '-d', '--build'] },
    hint: 'Поднимает Mongo и backend на этом ПК.' },
  { id: 'stand-down', section: 'stand', hidden: true, title: 'Локальный сайт: остановить', risk: 'local', time: '20 с', needs: ['docker'], run: { docker: ['compose', 'stop'] },
    hint: 'Останавливает локальные контейнеры. Данные остаются.' },
  { id: 'night-up', section: 'stand', hidden: true, title: 'Стенд на копии базы: запустить', risk: 'local', time: '3–10 мин', needs: ['docker'], run: dc('stand', 'up'),
    hint: 'Стенд на localhost:3102 из копии базы.' },
  { id: 'night-down', section: 'stand', hidden: true, title: 'Стенд на копии базы: остановить', risk: 'local', time: '20 с', needs: ['docker'], run: dc('stand', 'down'),
    hint: 'Останавливает стенд на копии. База сохраняется.' },

  { id: 'docker-clean-plan', section: 'stand', title: 'Docker: что лишнее на этом ПК', risk: 'read', time: '10 с', needs: ['docker'], run: { node: ['tools/docker-clean.mjs'] }, every: 14, why: 'Раз в две недели: старые стенды и кэш сборки съедают десятки ГБ',
    hint: 'Показывает, сколько места займут старые стенды и кэш. Ничего не удаляет.' },
  { id: 'docker-clean', section: 'stand', title: 'Docker: очистить этот ПК', risk: 'local', time: '1–3 мин', needs: ['docker'], run: { node: ['tools/docker-clean.mjs', '--clean'] },
    confirm: 'Удалятся старые стенды, кэш сборки, образы и тома без имени. Локальный сайт, его данные и текущий стенд :3102 останутся.',
    hint: 'Освобождает место. Следующая сборка стенда будет на пару минут дольше.' },
  { id: 'docker-clean-vm-plan', section: 'site', title: 'Docker на сервере: что лишнее', risk: 'read', time: '15 с', needs: ['bash', 'vm'], run: { node: ['tools/docker-clean.mjs', '--server'] }, every: 30, why: 'Раз в месяц: кэш сборки на сервере растёт с каждой выкладкой',
    hint: 'Показывает место на диске сервера и сколько займёт кэш сборки. Ничего не удаляет.' },
  { id: 'docker-clean-vm', section: 'site', title: 'Docker на сервере: очистить кэш', risk: 'prod-write', time: '1 мин', needs: ['bash', 'vm'], run: { node: ['tools/docker-clean.mjs', '--server', '--clean'] },
    confirm: 'На сервере удалится кэш сборки и образы без имени. Сайт, базы, CRM и образ для отката не меняются. Следующая выкладка соберётся на несколько минут дольше.',
    hint: 'Только если на сервере мало места (диск занят больше 70 %).' },

  // ---------- Автозапуск / задачи Windows ----------
  { id: 'setup-task', section: 'auto', sub: 'Задачи Windows (работают и при закрытом пульте)', title: 'Ночной прогон в 23:30', risk: 'local', time: '10 с', run: { cmd: ['tools\\setup.cmd', 'task'] },
    hint: 'Создаёт задачу Windows на 23:30. Только если проверка ПК зелёная.' },
  { id: 'setup-pull-task', section: 'auto', sub: 'Задачи Windows (работают и при закрытом пульте)', title: 'Копия базы на ПК в 10:00', risk: 'local', time: '5 с', run: { powershell: ['deploy/backup-pull/register-task.ps1'] },
    hint: 'Один раз. В 10:00 скачивает свежую копию базы на этот ПК.' },
  { id: 'setup-refresh-task', section: 'auto', sub: 'Задачи Windows (работают и при закрытом пульте)', title: 'Sportin: автообновление в 11:00', risk: 'local', time: '5 с', run: { powershell: ['SRV-ERP/register-refresh-task.ps1'] },
    hint: 'Один раз. В 11:00 переносит базу Дома на Sportin (без кода).' },

  // ---------- Настройка ПК ----------
  { id: 'setup-check', section: 'setup', title: 'Проверить этот ПК', risk: 'read', time: '10 с', run: { cmd: ['tools\\setup.cmd'] },
    hint: 'Node, Git, Docker, Edge и папка копий. Строка [!!] — что исправить.' },
  { id: 'setup-control-key', section: 'setup', title: 'Сохранить ключ ночного прогона', risk: 'local', time: '1 с', run: { node: ['tools/set-control-key.mjs'] },
    hint: 'Ключ из буфера — в файл на этом ПК. Нужен, чтобы итог ночной проверки был в «Состоянии» на сайте.' },
  { id: 'setup-work', section: 'setup', title: 'Подготовить рабочий ПК', risk: 'local', time: '20 с', needs: ['bash'], run: { bash: ['remote-access/setup-work-pc.sh'] },
    hint: 'Один раз. Ключ в ~/.ssh и вход на сервер. Нужна папка remote-access/secret с флешки.' },
  { id: 'git-pull', section: 'setup', title: 'Забрать обновления из GitHub', risk: 'local', time: '10 с', run: { git: ['pull', '--ff-only'] },
    hint: 'Обновляет папку проекта с GitHub. Если ИИ сейчас правит код здесь — дождитесь конца.' },
  { id: 'git-push', section: 'setup', title: 'Отправить в GitHub', risk: 'local', time: '10 с', run: { git: ['push'] },
    hint: 'Отправляет готовые коммиты. Без этого выкладка на сайт не начнётся.' },
  { id: 'setup-shortcut', section: 'setup', title: 'Ярлык пульта на рабочий стол', risk: 'local', time: '2 с', run: { powershell: ['pult/shortcut.ps1', '-Name', 'Пульт DataCore'] },
    hint: 'Ярлык «Пульт DataCore». Сам просит права администратора.' },

  // ---------- Ссылки ----------
  { id: 'link-srv-synology', section: 'links', title: 'Рабочий сайт', risk: 'read', time: 'сразу', run: { open: 'https://kppdf-crm.ru/db/app/' },
    hint: 'kppdf-crm.ru/db/app/' },
  { id: 'link-srv-windows', section: 'links', title: 'Sportin — второй сервер', risk: 'read', time: 'сразу', run: { open: 'http://31.222.224.247:8080/app/' },
    hint: '31.222.224.247:8080/app/' },
  { id: 'link-admin', section: 'links', title: 'Админка', risk: 'read', time: 'сразу', run: { open: 'https://kppdf-crm.ru/db/admin/' },
    hint: 'Админка рабочего сайта.' },
  { id: 'link-local', section: 'links', title: 'Локальный сайт', risk: 'read', time: 'сразу', run: { open: 'http://localhost:3001/app/' },
    hint: 'Если запущен стенд «Локальный сайт».' },
  { id: 'link-project', section: 'links', title: 'Папка проекта', risk: 'read', time: 'сразу', run: { folder: '.' },
    hint: 'Открывает проект в проводнике.' },
  { id: 'link-logs', section: 'links', title: 'Журналы пульта', risk: 'read', time: 'сразу', run: { folder: 'pult/logs' },
    hint: 'Полный вывод каждого запуска.' },

  // ---------- Локальный ИИ (C019) ----------
  { id: 'lai-inbox', section: 'localai', title: 'Входящие документы', risk: 'read', time: 'сразу', run: { folder: 'tools/local-ai-order/inbox' },
    hint: 'Сюда кладите ТЗ, ВОР, КП, контракт. Затем «Собрать Excel заказа».' },
  { id: 'lai-build', section: 'localai', title: 'Собрать Excel заказа', risk: 'local', time: '1–10 мин', run: { node: ['tools/local-ai-order/run.mjs'] },
    hint: 'Локальный ИИ читает inbox и пишет файл в out/. Потом импортируйте на сайте сами.' },
  { id: 'lai-out', section: 'localai', title: 'Готовый Excel', risk: 'read', time: 'сразу', run: { folder: 'tools/local-ai-order/out' },
    hint: 'Готовый Excel для «Заказы → Импорт Excel» на сайте.' },
  { id: 'lai-check', section: 'localai', title: 'Проверить связь с ИИ', risk: 'local', time: '5 с', run: { node: ['tools/local-ai-order/run.mjs', '--check'] },
    hint: 'Запрос /v1/models. LM Studio должен быть Running, CORS включён.' },
  { id: 'lai-setup', section: 'aitester', title: '0. Установить ИИ на этом ПК', risk: 'local', time: '1 мин – 30 мин', run: { node: ['tools/ai-tester/setup.mjs'] },
    hint: 'Один раз на каждом компьютере (дом, работа). Сам настроит LM Studio, подберёт модель под видеокарту, скачает и загрузит.' },
  // ИИ-тестировщик: локальная модель ходит по стенду этого ПК, записи с меткой ТЕСТ-ИИ, в конце убирает их сама
  { id: 'ait-check', section: 'aitester', title: '1. Проверить готовность тестировщика', risk: 'local', time: '10 с – 2 мин', run: { node: ['tools/ai-tester/run.mjs', '--check'] },
    hint: 'Проверяет по шагам: LM Studio, модель, браузер, Docker и стенд. Что не готово — пишет, что нажать.' },
  { id: 'ait-run', section: 'aitester', title: '2. Запустить тестировщика', risk: 'local', time: 'сколько выберете', run: { node: ['tools/ai-tester/run.mjs', '--minutes', '{minutes}'] },
    params: [{ name: 'minutes', label: 'Сколько работать', type: 'select', default: '480', options: [
      { value: '15', label: '15 минут (проба)' }, { value: '60', label: '1 час' }, { value: '240', label: '4 часа' }, { value: '480', label: 'Рабочий день (8 часов)' }] }],
    hint: 'Ходит по стенду как менеджер, создаёт записи «ТЕСТ-ИИ». В конце сам их убирает и пишет отчёт. Рабочий сайт не трогает.' },
  { id: 'ait-stop', section: 'aitester', title: 'Остановить тестировщика', risk: 'local', time: 'до 2 мин', run: { node: ['tools/ai-tester/run.mjs', '--stop'] },
    hint: 'Тестировщик закончит шаг, уберёт тестовые записи и допишет отчёт.' },
  { id: 'ait-report', section: 'aitester', title: 'Отчёт тестировщика', risk: 'read', time: 'сразу', run: { node: ['tools/ai-tester/run.mjs', '--last'] },
    hint: 'Итог последнего дня: ошибки сайта и замечания ИИ. Потом скажите Claude «посмотри отчёт тестировщика».' },
  { id: 'ait-cleanup', section: 'aitester', title: 'Убрать тестовые записи', risk: 'local', time: '30 с', run: { node: ['tools/ai-tester/run.mjs', '--cleanup'] },
    hint: 'Обычно не нужно — тестировщик убирает сам. Нужно, если компьютер выключился во время работы.' },
];

export const SWITCHES = [
  { id: 'sw-local', section: 'stand', title: 'Локальный сайт', state: 'localSite', start: 'stand-up', stop: 'stand-down', link: 'http://localhost:3001/app/',
    hint: 'Сайт на этом ПК. Адрес: localhost:3001. Данные при остановке остаются.' },
  { id: 'sw-night', section: 'stand', title: 'Стенд на копии базы', state: 'nightStand', start: 'night-up', stop: 'night-down', link: 'http://localhost:3102/app/',
    hint: 'Стенд на localhost:3102 из копии. Остановка сохраняет данные.' },
];

export const ADVICE = [
  { match: 'есть незакоммиченные изменения', say: 'В папке есть файлы без коммита. Попросите ИИ закоммитить или дождитесь конца другой сессии.' },
  { match: 'не запушен в origin', say: 'Коммит не отправлен в GitHub. Попросите ИИ отправить и повторите выкладку.' },
  { match: 'D:\\datacore-backups is missing', say: 'Нет папки копий. Она нужна стенду на копии и Sportin. Выкладке не нужна.' },
  { match: 'Permission denied (publickey', say: 'Сервер не принял ключ. Запустите «Настройка ПК → Подготовить рабочий ПК».' },
  { match: 'Connection timed out', say: 'Нет связи с сервером. Запустите «Выкладка → Проверить связь с сервером».' },
  { match: 'Could not resolve host', say: 'Нет интернета или недоступен адрес сервера.' },
  { match: 'not a git repository', say: 'Пульт запущен не из папки проекта. Запускайте из репозитория.' },
  { match: 'dubious ownership', say: 'Git не доверяет папке. Запустите пульт без прав администратора.' },
  { match: 'Cannot connect to the Docker daemon', say: 'Docker не запущен. Запустите Docker Desktop и повторите.' },
];

// Скрипты без кнопки: ИИ / внутренние / убраны из пульта администратора.
export const NOT_ON_BUTTONS = {
  'backend/scripts/passport-items-audit.js': 'аудит пунктов паспортов для ИИ (C054): отчёт → решения пользователя в чате → --apply делает координатор',
  'tools/c039-types.mjs': 'разовый отчёт покрытия иконок типов для ИИ (C039), не для администратора',
  'deploy/synology/api.sh': 'вход для агента datacore-access; запрос собирается вручную',
  'deploy/synology/kp-data-fill.sh': 'разовая запись данных КП на прод (KP-2, 2026-11-09): реквизиты, НДС, бланки фирм; запускает пользователь один раз',
  'deploy/synology/kp-blank-names.sh': 'разовое исправление названий бланков КП на проде (KP-2, 2026-11-09); запускает пользователь один раз',
  'deploy/synology/sync-dir.sh': 'часть выкладки и отката на сервере; вручную не запускается',
  'deploy/synology/backup.sh': 'cron 03:00 и выкладка; отдельной кнопки нет',
  'deploy/synology/bundle-pc.sh': 'пакет сервера — в админке, вкладка «Сервер»',
  'deploy/synology/bundle.cmd': 'меню в консоли; пакет в админке',
  'deploy/synology/bundle-install.sh': 'для новой VM по MIGRATE.md',
  'deploy/synology/bundle-watch.sh': 'внутренний шаг сборки пакета',
  'deploy/synology/bundle.sh': 'на сервере; вызывает bundle-pc.sh',
  'deploy/synology/datacore-tunnel.sh': 'служба туннеля на сервере',
  'deploy/synology/doctor-report.js': 'внутренняя часть doctor.sh',
  'deploy/synology/release.sh': 'кнопка выкладки выбирает его сама',
  'deploy/synology/verify-restore.js': 'внутренняя часть восстановления',
  'deploy/synology/restore-drill.sh': 'кнопка «Учебное восстановление (дом)» зовёт по ssh',
  'deploy/synology/rollback.sh': 'откат — только через ИИ при аварии, не в пульте администратора',
  'remote-access/deploy.sh': 'кнопка выкладки выбирает его сама',
  'remote-access/run-script.sh': 'скрипты правки данных — только ИИ, не в пульте администратора',
  'SRV-ERP/setup-switch.sh': 'настройка стенда Sportin, на нём',
  'SRV-ERP/backup-erp.sh': 'бэкап второго сервера по cron',
  'deploy/smb/offsite-smb.sh': 'копии на NAS по cron на сервере',
  'deploy/smb/install-smb.sh': 'ставится кнопкой Sportin «ночной бэкап» / отдельно на доме через ИИ',
  'SRV-ERP/setup-tunnel.sh': 'настройка стенда Sportin, на нём',
  'tools/dc.cmd': 'обёртка над tools/dc.mjs',
  'tools/dc.mjs logs': 'список журналов; ИИ читает tools/logs',
  'tools/dc.mjs find': 'поиск по докам для ИИ',
  'tools/dc.mjs doc': 'чтение архива доков для ИИ',
  'tools/dc.mjs night': 'часть полной проверки (dc full); отдельной кнопки нет',
  'apps/pdm-loader/publish.ps1': 'приложение PDM собирает и выкладывает release.sh сам (шаг 6б), отдельная кнопка не нужна',
  'tools/kit/make-kit.sh': 'просит пароль; без пароля выдал бы все доступы',
  'tools/site-audit.mjs': 'кнопка «Большая проверка сайта» через dc audit',
  'tools/night.mjs': 'библиотека dc',
  'tools/night-owner.mjs': 'часть night runner',
  'tools/night-stand.mjs': 'часть night runner',
  'tools/setup-task.ps1': 'из tools/setup.cmd task',
  'tools/release-qa.mjs': 'пакет показателей для ИИ, не для администратора',
  'tools/run-all.mjs': 'локальный прогон для ИИ',
  'tools/screen-walk.mjs': 'часть полной проверки / ИИ',
  'tools/scenarios.mjs': 'часть полной проверки / ИИ',
  'tools/stock-filter-check.mjs': 'часть полной проверки / ИИ',
  'tools/allow-ai.mjs': 'разрешения для ИИ — настраивает ИИ, не администратор сайта',
};
