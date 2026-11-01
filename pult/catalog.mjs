// Каталог пульта — единственный источник кнопок. Новая команда = новая запись здесь, остальное строится само:
// экран, проверка на сервере, pult/docs/КОМАНДЫ.md (node pult/gen-docs.mjs). Как добавить — pult/README.md.
//
// Запись команды:
//   id      уникальный код, не меняется
//   title   название кнопки — по-русски, без служебных слов
//   hint    когда нажимать и что получится
//   risk    read | local | prod-write | danger (см. RISKS)
//   time    примерное время, строка
//   run     что запускать: { node|bash|git|cmd|npx|docker: [...аргументы], cwd? } или { open: адрес } или { folder: путь }
//           ssh на сервер: { vm: 'команда на сервере' } — способ входа пульт выбирает сам (dispatch.mjs)
//           скрипт сам ходит на сервер по VM и KEY: добавьте vmEnv: true, иначе с работы он пойдёт домашним адресом
//           аргумент-заполнитель '{имя}' подставляется из params
//   needs   ['bash','docker','vm','key-home'] — без этого кнопка серая с причиной
//   every   ритм в днях (1, 7, 30) и why — причина: команда сама попадёт на экран «Что делать сейчас»
//   sub     подзаголовок внутри раздела, если карточек много
//   params  [{ name, label, type:'select', options:[{value,label}] | from:'prodScripts', default }]
//   confirm текст окна подтверждения; word — слово, которое надо ввести (для danger обязательно)

export const RISKS = {
  read: { label: 'Только чтение', hint: 'Ничего не меняет' },
  local: { label: 'Сайт не затрагивает', hint: 'Меняет этот ПК, стенд или GitHub. Рабочий сайт остаётся как был' },
  'prod-write': { label: 'Меняет сайт', hint: 'Меняет рабочий сайт. Перед запуском пульт спросит подтверждение' },
  danger: { label: 'Опасно', hint: 'Меняет рабочий сайт или данные. Для запуска надо ввести слово' },
};

// color — цвет группы: полоса в меню и на карточках (pult/ui/style.css, --g-<color>). По цвету видно, что с чем связано.
export const GROUPS = [
  { id: 'start', title: '', color: 'start' },
  { id: 'site', title: 'Рабочий сайт', color: 'site' },
  { id: 'copies', title: 'Копии и второй сервер', color: 'copies' },
  { id: 'dev', title: 'Разработка', color: 'dev' },
  { id: 'pc', title: 'Этот компьютер', color: 'pc' },
];

// Раздел now — экран «Что делать сейчас» (advisor.mjs), своих карточек у него нет.
// Раздел auto — экран автозапуска (SCHEDULE ниже) плюс карточки задач Windows.
export const SECTIONS = [
  { id: 'now', group: 'start', title: 'Что делать сейчас', icon: '🧭', hint: 'Пульт сам смотрит на проект и подсказывает очерёдность' },
  { id: 'day', group: 'site', title: 'Каждый день', icon: '☀', hint: 'Обзор проекта и ошибки сайта' },
  { id: 'deploy', group: 'site', title: 'Выкладка', icon: '🚀', hint: 'По порядку: ворота → выкладка → проверка после' },
  { id: 'prod', group: 'site', title: 'Сервер сайта', icon: '🌐', hint: 'Осмотр сервера и действия при аварии' },
  { id: 'scripts', group: 'site', title: 'Правка данных', icon: '🧾', hint: 'Разовые скрипты на рабочем сервере: сначала план, потом запись' },
  { id: 'backups', group: 'copies', title: 'Копии базы', icon: '💾', hint: 'Копии на сервере, на этом ПК и на NAS' },
  { id: 'sportin', group: 'copies', title: 'Sportin', icon: '🖥', hint: 'Второй сервер: копия сайта, бэкап, проверка восстановления' },
  { id: 'code', group: 'dev', title: 'Проверка кода', icon: '🧪', hint: 'Типы, тесты, сборка. Сайт не затрагивают' },
  { id: 'stand', group: 'dev', title: 'Стенды', icon: '🧰', hint: 'Сайт на этом ПК: на тестовой базе и на копии рабочей' },
  { id: 'git', group: 'dev', title: 'Git', icon: '🌿', hint: 'Обмен кодом между домом, работой и GitHub' },
  { id: 'auto', group: 'pc', title: 'Автозапуск', icon: '⏰', hint: 'Что и когда пульт запускает сам, пока он открыт' },
  { id: 'setup', group: 'pc', title: 'Настройка ПК', icon: '⚙', hint: 'Разовая подготовка компьютера, по порядку сверху вниз' },
  { id: 'links', group: 'pc', title: 'Ссылки и папки', icon: '🔗', hint: 'Сайт, админка, документы и рабочие папки' },
];

// Автозапуск по умолчанию (schedule.mjs). Только чтение и этот ПК: запись на сайт сама не запускается.
// Время подобрано под день: утром — обзор, вечером — ошибки за день, раз в неделю — осмотр и данные.
export const SCHEDULE = [
  { id: 'day-start', kind: 'daily', time: '09:00', enabled: true },
  { id: 'day-errors', kind: 'daily', time: '18:00', enabled: true, params: { hours: '24' } },
  { id: 'prod-doctor', kind: 'weekly', day: 1, time: '09:30', enabled: true },
  { id: 'day-data', kind: 'weekly', day: 1, time: '10:00', enabled: true },
  { id: 'code-check', kind: 'weekly', day: 5, time: '17:00', enabled: true },
  { id: 'sportin-drill', kind: 'monthly', day: 1, time: '12:00', enabled: true },
];

// soft: код выхода 1 значит «есть находки», а не сбой (так договорено в dc и doctor.sh).
const dc = (...args) => ({ node: ['tools/dc.mjs', ...args], soft: true });

export const COMMANDS = [
  // ---------- Каждый день ----------
  { id: 'day-start', section: 'day', title: 'Начало работы', risk: 'read', time: '20 с', needs: ['bash'], run: dc('start'), every: 1, why: 'Первая кнопка за день: новые ошибки сайта и состояние кода',
    hint: 'Первая кнопка за день. Покажет ветку, отставание от GitHub, незакоммиченное и ошибки сайта за сутки.' },
  { id: 'day-status', section: 'day', title: 'Состояние проекта', risk: 'read', time: '20 с', needs: ['bash'], run: dc('status'),
    hint: 'Сайт жив или нет, возраст копии базы, версия на сервере, последний полный прогон тестов.' },
  { id: 'day-errors', section: 'day', title: 'Ошибки с сайта', risk: 'read', time: '15 с', needs: ['bash'], run: dc('errors', '{hours}'),
    params: [{ name: 'hours', label: 'За какой срок', type: 'select', default: '24', options: [
      { value: '2', label: '2 часа' }, { value: '24', label: 'Сутки' }, { value: '72', label: '3 дня' }, { value: '168', label: 'Неделя' }] }],
    hint: 'Какие ошибки видели люди на сайте и на каких экранах. Новые ошибки чините первыми.' },
  { id: 'day-data', section: 'day', title: 'Что заполнить в данных', risk: 'read', time: '15 с', needs: ['bash'], run: dc('data'), every: 7, why: 'Раз в неделю: сколько записей ждут заполнения',
    hint: 'Сводка «Требуют заполнения»: сколько записей без важных полей и в каких разделах.' },
  { id: 'day-logs', section: 'day', title: 'Прошлые журналы', risk: 'read', time: '1 с', run: dc('logs'),
    hint: 'Список полных журналов команд dc. Полезно, когда короткого итога мало.' },

  // ---------- Выкладка ----------
  { id: 'deploy-gate', section: 'deploy', title: 'Проверить ворота', risk: 'read', time: '1–5 мин', needs: ['bash'], run: { bash: ['deploy/synology/preflight.sh'] },
    hint: 'Можно ли выкладывать: всё закоммичено, отправлено в GitHub, тесты зелёные. Сайт не меняет.' },
  { id: 'deploy-link', section: 'deploy', title: 'Проверить связь с сервером', risk: 'read', time: '30 с', needs: ['bash', 'vm'], run: { bash: ['remote-access/check.sh'] },
    hint: 'Проверяет цепочку VPS → домашний сервер → сайт. Нажмите, если выкладка не может зайти на сервер.' },
  { id: 'deploy-release', section: 'deploy', title: 'Выложить на сайт', risk: 'prod-write', time: '5–10 мин', needs: ['bash', 'vm'], run: { deploy: [] },
    confirm: 'Новая версия уйдёт на рабочий сайт. Порядок: ворота, копия базы, замена файлов, сборка, перезапуск, проверка.',
    hint: 'Обычная выкладка. Сначала пройдут ворота. CRM kppdf не затрагивается. Копия базы делается сама.' },
  { id: 'deploy-data', section: 'deploy', title: 'Выложить и загрузить заказы', risk: 'prod-write', time: '10–20 мин', needs: ['bash', 'vm'], run: { deploy: ['--data'] },
    confirm: 'Новая версия уйдёт на сайт. Затем загрузятся Excel-заказы с фото. Повторная загрузка ничего не задваивает.',
    hint: 'Выкладка плюс загрузка заказов из папки «для анализа/заказы». Нужна только при новых файлах заказов.' },
  { id: 'deploy-urgent', section: 'deploy', title: 'Срочная выкладка', risk: 'danger', time: '5–10 мин', needs: ['bash', 'vm'], run: { deploy: ['--force-urgent'] },
    confirm: 'Только когда сайт уже сломан. Пропускает приёмку дизайнера и полный прогон. Остальные ворота работают.', word: 'СРОЧНО',
    hint: 'Для аварии. Коммит, GitHub и тесты всё равно проверяются.' },
  { id: 'deploy-archive', section: 'deploy', title: 'Архив документов на сервер', risk: 'prod-write', time: '1–3 мин', run: { node: ['backend/scripts/devlog-import.js', 'prod', '--apply'] },
    confirm: 'Законченные документы и задачи уйдут в архив «Ведение проекта» на сервере. Рабочие данные сайта не меняются.',
    hint: 'То же делает каждая выкладка (шаг 7). Отдельно — когда документы перенесены в docs/archive и выкладки не будет. В конце — список файлов, которые можно удалить из проекта.' },
  { id: 'deploy-post', section: 'deploy', title: 'Проверка после выкладки', risk: 'read', time: '15 с', needs: ['bash'], run: { bash: ['deploy/synology/post-check.sh'] },
    hint: 'Нажмите через 1–2 часа после выкладки. Покажет новые ошибки с сайта на этой версии.' },

  // ---------- Рабочий сайт ----------
  { id: 'prod-doctor', section: 'prod', sub: 'Осмотр', title: 'Осмотр сайта', risk: 'read', time: '1 мин', needs: ['bash'], run: { bash: ['deploy/synology/doctor.sh'], soft: true }, every: 7, why: 'Раз в неделю: полный осмотр сайта',
    hint: 'Полный осмотр: диск, копии, целостность, скорость. Итог ✓ норма, ⚠ посмотреть, ✗ чинить сейчас. Раз в неделю и после выкладки.' },
  { id: 'prod-containers', section: 'prod', sub: 'Осмотр', title: 'Что запущено на сервере', risk: 'read', time: '10 с', needs: ['bash', 'vm'], run: { vm: "docker ps --format '{{.Names}}  {{.Status}}'" },
    hint: 'Список контейнеров на сервере и как давно они работают.' },
  { id: 'prod-disk', section: 'prod', sub: 'Осмотр', title: 'Место на диске сервера', risk: 'read', time: '10 с', needs: ['bash', 'vm'], run: { vm: 'df -h /var/lib/datacore && docker system df' },
    hint: 'Сколько места свободно. Выкладке нужно не меньше 2 ГБ.' },
  { id: 'prod-log', section: 'prod', sub: 'Осмотр', title: 'Журнал сервера', risk: 'read', time: '10 с', needs: ['bash', 'vm'], run: { vm: 'docker logs --tail {lines} datacore-backend 2>&1' },
    params: [{ name: 'lines', label: 'Сколько строк', type: 'select', default: '200', options: [
      { value: '100', label: '100' }, { value: '200', label: '200' }, { value: '1000', label: '1000' }] }],
    hint: 'Последние строки журнала backend. Нужен при разборе ошибки на сервере.' },
  { id: 'prod-backup', section: 'backups', title: 'Сделать копию базы', risk: 'prod-write', time: '2–5 мин', needs: ['bash', 'vm'], run: { vm: 'cd /opt/data-core && bash deploy/synology/backup.sh' },
    confirm: 'На сервере появится внеплановая копия базы и файлов. Рабочие данные не меняются. Нужно свободное место.',
    hint: 'Внеплановая копия. Обычно она не нужна: копии идут по расписанию и перед каждой выкладкой.' },
  { id: 'prod-drill', section: 'backups', title: 'Учебное восстановление', risk: 'prod-write', time: '5–15 мин', needs: ['bash', 'vm'], run: { vm: 'cd /opt/data-core && bash deploy/synology/restore-drill.sh' }, every: 30, why: 'Раз в месяц: проверка, что копия восстанавливается',
    confirm: 'Последняя копия развернётся во временную базу, числа сверятся, база удалится. Рабочая база не меняется.',
    hint: 'Раз в месяц. Доказывает, что копия восстанавливается. Итог виден в «Осмотре сайта».' },
  // CRM kppdf (решение пользователя 2026-10-31: отключить, нужна была только диаграмма Ганта — переносится в «В работе»)
  { id: 'crm-stop', section: 'prod', sub: 'CRM kppdf', title: 'CRM kppdf: остановить', risk: 'danger', time: '20 с', needs: ['bash', 'vm'],
    run: { vm: "for c in $(docker ps --format '{{.Names}}' | grep '^kppdf'); do docker update --restart=no $c >/dev/null && docker stop $c; done; docker ps -a --format '{{.Names}}  {{.Status}}' | grep '^kppdf' || echo 'контейнеров kppdf нет'" },
    confirm: 'Остановятся контейнеры CRM kppdf (порт 3000). Общая база и data-core работают дальше, данные не удаляются. Вернуть — кнопкой «CRM kppdf: запустить обратно».', word: 'CRM',
    hint: 'CRM больше не нужна. Перестанет писать в общую базу мимо data-core. Адрес kppdf-crm.ru (без /db/) перестанет открываться.' },
  { id: 'crm-start', section: 'prod', sub: 'CRM kppdf', title: 'CRM kppdf: запустить обратно', risk: 'prod-write', time: '30 с', needs: ['bash', 'vm'],
    run: { vm: "for c in $(docker ps -a --format '{{.Names}}' | grep '^kppdf'); do docker update --restart=unless-stopped $c >/dev/null && docker start $c; done; docker ps --format '{{.Names}}  {{.Status}}' | grep '^kppdf'" },
    confirm: 'Контейнеры CRM kppdf запустятся снова и будут подниматься после перезагрузки сервера.',
    hint: 'Если CRM всё-таки понадобилась.' },
  { id: 'prod-peer-url', section: 'sportin', title: 'Экран «Серверы»: адрес второго сервера', risk: 'prod-write', time: '10 с', needs: ['bash', 'vm'],
    run: { vm: "cd /opt/data-core && (grep -q '^HA_PEER_URL=' .env && sed -i 's#^HA_PEER_URL=.*#HA_PEER_URL=http://31.222.224.247:8080#' .env || echo 'HA_PEER_URL=http://31.222.224.247:8080' >> .env) && grep '^HA_PEER_URL=' .env" },
    confirm: 'В настройки сайта добавится адрес второго сервера. Сработает после следующей выкладки. Данные не меняются.',
    hint: 'Разово. Админка → Серверы будет показывать, отвечает ли второй сервер и насколько свежая на нём копия.' },
  { id: 'prod-rollback', section: 'prod', sub: 'Авария', title: 'Откат на прошлую версию', risk: 'danger', time: '2 мин', needs: ['bash', 'vm'], run: { vm: 'cd /opt/data-core && bash deploy/synology/rollback.sh' },
    confirm: 'Вернётся прошлая версия backend. Данные не откатываются. Экран приложения остаётся новым.', word: 'ОТКАТ',
    hint: 'Для аварии после выкладки. Подробно: docs/CONTROL.md, раздел «Если случилось».' },

  // ---------- Разовые скрипты ----------
  { id: 'script-plan', section: 'scripts', title: 'Скрипт: показать план', risk: 'read', time: '1–5 мин', needs: ['bash', 'vm'], run: { bash: ['remote-access/run-script.sh', '{script}'] },
    params: [{ name: 'script', label: 'Скрипт', type: 'select', from: 'prodScripts' }],
    hint: 'Запускает скрипт на сервере без записи и показывает, что он изменит. В списке только скрипты с режимом плана (--apply). Всегда нажимайте до записи.' },
  { id: 'script-apply', section: 'scripts', title: 'Скрипт: записать', risk: 'prod-write', time: '1–10 мин', needs: ['bash', 'vm'], run: { bash: ['remote-access/run-script.sh', '{script}', '--apply'] },
    params: [{ name: 'script', label: 'Скрипт', type: 'select', from: 'prodScripts' }],
    // без слова (решение пользователя 2026-10-31): перед записью всегда копия базы; слово — только для отката и срочной выкладки
    confirm: 'Скрипт изменит рабочие данные. Сначала сделается копия базы. Нет копии — запись не начнётся.',
    hint: 'Только после просмотра плана. Скрипт идёт в контейнер и на сервере не остаётся.' },
  // Наполнение паспортов (docs/audit/PASSPORT-FLOW-AUDIT.md §E). Порядок: категории групп → способ установки → поля из паспортов → значения по категории.
  ...[
    ['category-groups', '1. Категория паспорта у изделий', 'Показывает, у скольких изделий категория паспорта (тренажёры, воркаут, благоустройство и т. д.) определится по названию изделия и группы, и список не определённых.',
      'Изделиям без категории паспорта она запишется в карточку по названию изделия и группы. Заполненное не меняется.'],
    ['install-method', '2. Способ установки из текста', 'Показывает, у скольких изделий способ установки определится из текста паспорта, и какие тексты не распознаны.',
      'Изделиям без способа установки он запишется по тексту последнего паспорта. Паспорта не меняются.'],
    ['fields-to-product', '3. Габариты и поля из паспортов', 'Показывает, какие поля (габариты, вес, площадка, число пользователей и др.) перейдут из выпущенных паспортов в карточку изделия, и где паспорта расходятся.',
      'Пустые поля карточки изделия заполнятся из последнего выпущенного паспорта. Заполненное не меняется, паспорта не меняются.'],
    ['images-to-product', '5. Рисунки паспортов в изделие', 'Показывает, сколько рисунков (чертёж, схема, зона безопасности и др.) из паспортов появится в блоке «Фото и файлы» изделия, где паспорта расходятся и что пропущено.',
      'Рисунки паспортов появятся в изделии (для паспорта, по видам). Файлы не копируются, паспорта не меняются.'],
    ['category-defaults', '4. Срок службы по категории', 'Показывает, у скольких изделий срок службы (10 лет) заполнится по категории паспорта.',
      'Пустой срок службы у изделий с категорией паспорта станет 10 лет. Заполненное не меняется.'],
    ['templates-polish', '6. Тексты шаблонов по ГОСТ', 'Показывает, какие тексты шаблонов категорий исправятся (лишние обещания, ссылки на ГОСТ) — разница по каждому шаблону.',
      'Шаблоны категорий получат новую версию с исправленными текстами. Выпущенные паспорта не меняются.'],
  ].flatMap(([name, title, planHint, confirm]) => [
    { id: `passport-${name}-plan`, section: 'scripts', sub: 'Наполнение паспортов', title: `${title}: план`, risk: 'read', time: '1 мин', needs: ['bash', 'vm'], run: { bash: ['remote-access/run-script.sh', `passport-${name}`] },
      hint: `${planHint} Ничего не записывает.` },
    { id: `passport-${name}-apply`, section: 'scripts', sub: 'Наполнение паспортов', title: `${title}: применить`, risk: 'prod-write', time: '1–5 мин', needs: ['bash', 'vm'], run: { bash: ['remote-access/run-script.sh', `passport-${name}`, '--apply'] },
      confirm: `${confirm} Перед записью сделается копия базы; нет копии — запись не начнётся.`,
      hint: 'Только после просмотра плана. Повторный запуск ничего не меняет.' },
  ]),

  // ---------- Проверка кода ----------
  { id: 'code-check', section: 'code', title: 'Быстрая проверка', risk: 'read', time: '2–4 мин', run: dc('check'),
    hint: 'Типы, все юнит-тесты и импорты приложения. Те же шаги, что в воротах выкладки.' },
  { id: 'code-types', section: 'code', title: 'Только типы', risk: 'read', time: '40 с', run: { npx: ['tsc', '--noEmit'], cwd: 'backend' },
    hint: 'Самая быстрая проверка сервера. Норма: ни одной строки ошибок.' },
  { id: 'code-unit', section: 'code', title: 'Только юнит-тесты', risk: 'read', time: '2 мин', run: { npx: ['jest', '--silent'], cwd: 'backend' },
    hint: 'Все юнит-тесты сервера. Норма: все зелёные.' },
  { id: 'code-e2e', section: 'code', title: 'Сквозные тесты (e2e)', risk: 'local', time: '5–15 мин', needs: ['docker'], run: { npx: ['jest', '--config', './test/jest-e2e.json', '--runInBand', '--forceExit'], cwd: 'backend' },
    hint: 'Главные цепочки целиком. Нужен запущенный локальный Mongo. Работает только с тестовой базой.' },
  { id: 'code-app', section: 'code', title: 'Импорты приложения', risk: 'read', time: '5 с', run: { node: ['backend/scripts/pwa-import-check.mjs'] },
    hint: 'Находит сломанный синтаксис и импорт в приложении и админке.' },
  { id: 'code-map', section: 'code', title: 'Карта кода', risk: 'read', time: '5 с', run: { node: ['backend/scripts/check-map.mjs'] },
    hint: 'Проверяет, что docs/MAP.md не отстал от кода.' },
  { id: 'code-build', section: 'code', title: 'Сборка сервера', risk: 'local', time: '1 мин', run: { npx: ['nest', 'build'], cwd: 'backend' },
    hint: 'Пересобирает backend/dist на этом ПК. Норма: без ошибок.' },
  { id: 'code-tools', section: 'code', title: 'Тесты инструментов', risk: 'read', time: '20 с', run: { node: ['--test', 'tools/dc.test.mjs', 'tools/night.test.mjs', 'pult/test/*.test.mjs'] },
    hint: 'Тесты dc, ночного прогона и этого пульта. Покажет новые скрипты, которых нет на кнопках.' },

  // ---------- Стенды ----------
  // Запуск и остановка стендов — одна карточка SWITCHES, отдельных кнопок нет (hidden).
  { id: 'stand-up', section: 'stand', hidden: true, title: 'Локальный сайт: запустить', risk: 'local', time: '2–5 мин', needs: ['docker'], run: { docker: ['compose', 'up', '-d', '--build'] },
    hint: 'Поднимает Mongo и backend на этом ПК.' },
  { id: 'stand-down', section: 'stand', hidden: true, title: 'Локальный сайт: остановить', risk: 'local', time: '20 с', needs: ['docker'], run: { docker: ['compose', 'stop'] },
    hint: 'Останавливает локальные контейнеры. Данные остаются.' },
  { id: 'night-up', section: 'stand', hidden: true, title: 'Стенд на копии базы: запустить', risk: 'local', time: '3–10 мин', needs: ['docker'], run: dc('stand', 'up'),
    hint: 'Поднимает стенд из свежей копии базы.' },
  { id: 'night-down', section: 'stand', hidden: true, title: 'Стенд на копии базы: остановить', risk: 'local', time: '20 с', needs: ['docker'], run: dc('stand', 'down'),
    hint: 'Останавливает стенд на копии.' },
  { id: 'night-run', section: 'stand', title: 'Ночной прогон проверок', risk: 'local', time: '10 мин – 3 ч', needs: ['docker'], run: dc('night', '{mode}'),
    params: [{ name: 'mode', label: 'Какой', type: 'select', default: '--quick', options: [{ value: '--quick', label: 'Быстрый, 10–20 мин' }, { value: '', label: 'Полный, до 3 ч' }] }],
    hint: 'Все проверки в отдельной копии кода. Рабочую папку не трогает. Полный идёт и по расписанию в 23:30.' },
  { id: 'smb-install-home', section: 'backups', title: 'Копии на NAS: установить на домашнем сервере', risk: 'prod-write', time: '1–2 мин', needs: ['bash', 'vm'],
    run: { vm: 'cd /opt/data-core && bash deploy/smb/install-smb.sh' },
    confirm: 'На домашнем сервере появится отправка копий в сетевую папку (SMB). Текущие бэкапы и места для копий не меняются. Сайт может перезапуститься на несколько секунд.',
    hint: 'По желанию: чтобы домашний сервер тоже мог отправлять копии на NAS. Место добавляется в админке: Сервер → Копии вне дома → Сетевая папка (SMB).' },
  { id: 'sportin-smb', section: 'sportin', title: 'Копии на NAS: установить на Sportin', risk: 'local', time: '1–3 мин', needs: ['bash'], run: { bash: ['SRV-ERP/push-smb.sh'] },
    confirm: 'На втором сервере появится ночной бэкап и отправка копий на NAS. Прод не меняется.',
    hint: 'Разово, после «Обновить копию на Sportin» с кодом. Повторный запуск ничего не дублирует.' },
  { id: 'sportin-backup', section: 'sportin', title: 'Бэкап на Sportin сейчас', risk: 'local', time: '1–5 мин', needs: ['bash'], run: { bash: ['SRV-ERP/backup-now.sh'] },
    hint: 'Делает копию базы и фото на втором сервере, не дожидаясь ночи (03:30). После неё «Отправить сейчас» на NAS сработает.' },
  { id: 'sportin-drill', section: 'sportin', title: 'Учебное восстановление на Sportin', risk: 'local', time: '1–3 мин', needs: ['bash'], run: { bash: ['SRV-ERP/restore-drill-erp.sh'] }, every: 30,
    why: 'Раз в месяц: проверка, что копия Sportin (она же уходит на NAS) восстанавливается',
    hint: 'Разворачивает последнюю копию во временную базу, сверяет таблицы, удаляет её. Рабочая база не меняется. Проверено 2026-10-31: 136 таблиц, копия восстанавливается.' },
  { id: 'sportin-copy', section: 'sportin', title: 'Обновить копию на Sportin', risk: 'local', time: '10–40 мин', needs: ['bash'], run: { bash: ['SRV-ERP/refresh-copy.sh', '{mode}'] },
    params: [{ name: 'mode', label: 'Что обновить', type: 'select', default: '', options: [{ value: '', label: 'База и фото' }, { value: '--code', label: 'База, фото и код' }] }],
    confirm: 'Копия на Sportin будет заменена свежим бэкапом. Всё, что изменено в копии, пропадёт. Прод не меняется.',
    hint: 'Копия на сервере Sportin из свежего бэкапа. Прод не затрагивает.' },

  // ---------- Git ----------
  { id: 'git-status', section: 'git', title: 'Что изменено', risk: 'read', time: '2 с', run: { git: ['status', '--short', '--branch'] },
    hint: 'Список незакоммиченных файлов. Если ворота говорят «сначала коммит», причина здесь.' },
  { id: 'git-log', section: 'git', title: 'Последние коммиты', risk: 'read', time: '2 с', run: { git: ['log', '--oneline', '-15'] },
    hint: 'Что сделано недавно.' },
  { id: 'git-pull', section: 'git', title: 'Забрать из GitHub', risk: 'local', time: '10 с', run: { git: ['pull', '--ff-only'] },
    hint: 'Обновляет эту папку. Если сессия Claude работает здесь же, дождитесь её конца.' },
  { id: 'git-push', section: 'git', title: 'Отправить в GitHub', risk: 'local', time: '10 с', run: { git: ['push'] },
    hint: 'Отправляет готовые коммиты. Выкладка требует, чтобы они были в GitHub.' },

  // ---------- Настройка ПК ----------
  { id: 'setup-check', section: 'setup', title: 'Проверить этот ПК', risk: 'read', time: '10 с', run: { cmd: ['tools\\setup.cmd'] },
    hint: 'Node, Git, Docker, Edge и папка копий. Строка [!!] — что надо исправить.' },
  { id: 'setup-task', section: 'auto', sub: 'Задачи Windows: работают и при закрытом пульте', title: 'Ночной прогон в 23:30', risk: 'local', time: '10 с', run: { cmd: ['tools\\setup.cmd', 'task'] },
    hint: 'Создаёт задачу Windows «DataCore night» на 23:30. Запускается, только если проверка ПК зелёная.' },
  { id: 'setup-ai', section: 'setup', title: 'Разрешения для ИИ', risk: 'local', time: '1 с', run: { node: ['tools/allow-ai.mjs'] },
    hint: 'Один раз на ПК. Дописывает узкий список разрешений. Запись на прод в него не входит.' },
  { id: 'setup-work', section: 'setup', title: 'Подготовить рабочий ПК', risk: 'local', time: '20 с', needs: ['bash'], run: { bash: ['remote-access/setup-work-pc.sh'] },
    hint: 'Один раз. Кладёт ключ в ~/.ssh и настраивает вход на сервер. Нужна папка remote-access/secret с флешки.' },
  { id: 'setup-backup', section: 'backups', title: 'Скачать копию базы на этот ПК', risk: 'local', time: '5–15 мин', needs: ['vm'], run: { powershell: ['deploy/backup-pull/pull-backup.ps1'], vmEnv: true },
    hint: 'Кладёт свежий бэкап в D:\\datacore-backups. Нужен ночному стенду и проверке на реальных данных. В архиве рабочие данные: папку никому не передавайте.' },
  { id: 'setup-pull-task', section: 'auto', sub: 'Задачи Windows: работают и при закрытом пульте', title: 'Копия базы на ПК в 10:00', risk: 'local', time: '5 с', run: { powershell: ['deploy/backup-pull/register-task.ps1'] },
    hint: 'Один раз. Задача Windows «DataCore backup pull»: в 10:00 скачивает свежую копию базы. ПК был выключен — скачает при включении.' },
  { id: 'setup-refresh-task', section: 'auto', sub: 'Задачи Windows: работают и при закрытом пульте', title: 'Обновление Sportin в 11:00', risk: 'local', time: '5 с', run: { powershell: ['SRV-ERP/register-refresh-task.ps1'] },
    hint: 'Один раз. Задача Windows «DataCore copy refresh»: в 11:00 переносит свежую копию базы на Sportin. Без неё Sportin отстаёт от главного.' },
  { id: 'setup-shortcut', section: 'setup', title: 'Ярлык пульта на рабочий стол', risk: 'local', time: '2 с', run: { powershell: ['pult/shortcut.ps1', '-Name', 'Пульт DataCore'] },
    hint: 'Создаёт ярлык «Пульт DataCore». Ярлык сам просит права администратора.' },
  { id: 'setup-bundle', section: 'setup', sub: 'Переезд на другой сервер', title: 'Переносной пакет сервера', risk: 'local', time: 'до 1 ч', needs: ['bash', 'vm'], run: { bash: ['deploy/synology/bundle-pc.sh', '{step}'], vmEnv: true },
    confirm: 'Шаг «Собрать» создаёт на сервере большой архив и скачивает его на этот ПК. В архиве все пароли и ключи. Рабочие данные не меняются.',
    params: [{ name: 'step', label: 'Шаг', type: 'select', default: 'build', options: [
      { value: 'build', label: 'Собрать и скачать' }, { value: 'verify', label: 'Проверить последний' }, { value: 'steps', label: 'Показать шаги разворота' }] }],
    hint: 'Всё приложение одним архивом для переезда. В архиве секреты. Папка: C:\\datacore-bundles.' },

  // ---------- Ссылки и папки ----------
  { id: 'link-srv-synology', section: 'links', title: 'Сервер Synology', risk: 'read', time: 'сразу', run: { open: 'https://kppdf-crm.ru/db/app/' },
    hint: 'Главный сервер (дом). Адрес: kppdf-crm.ru/db/app/' },
  { id: 'link-srv-windows', section: 'links', title: 'Сервер Windows', risk: 'read', time: 'сразу', run: { open: 'http://31.222.224.247:8080/app/' },
    hint: 'Второй сервер (Sportin). Адрес: 31.222.224.247:8080/app/ — домен netcraze с портом 8080 не открывается.' },
  { id: 'link-site', section: 'links', title: 'Рабочее место', risk: 'read', time: 'сразу', run: { open: 'https://kppdf-crm.ru/db/app/' },
    hint: 'Приложение на рабочем сайте.' },
  { id: 'link-admin', section: 'links', title: 'Админка', risk: 'read', time: 'сразу', run: { open: 'https://kppdf-crm.ru/db/admin/' },
    hint: 'Админка на рабочем сайте.' },
  { id: 'link-local', section: 'links', title: 'Локальный сайт', risk: 'read', time: 'сразу', run: { open: 'http://localhost:3001/app/' },
    hint: 'Работает, если запущен «Локальный сайт» в разделе «Стенды».' },
  { id: 'link-project', section: 'links', title: 'Папка проекта', risk: 'read', time: 'сразу', run: { folder: '.' },
    hint: 'Открывает проект в проводнике.' },
  { id: 'link-logs', section: 'links', title: 'Журналы пульта', risk: 'read', time: 'сразу', run: { folder: 'pult/logs' },
    hint: 'Полный вывод каждого запуска кнопки.' },
  { id: 'link-commands', section: 'links', title: 'Справка по кнопкам', risk: 'read', time: 'сразу', run: { folder: 'pult/docs' },
    hint: 'Папка с файлом КОМАНДЫ.md. Он собирается из каталога автоматически.' },
];

// Стенды: одна карточка со статусом и одной кнопкой. state — поле из readStatus, start и stop — команды каталога.
export const SWITCHES = [
  { id: 'sw-local', section: 'stand', title: 'Локальный сайт', state: 'localSite', start: 'stand-up', stop: 'stand-down', link: 'http://localhost:3001/app/',
    hint: 'Сайт на этом ПК для проверки кода. Адрес: localhost:3001. Данные при остановке остаются.' },
  { id: 'sw-night', section: 'stand', title: 'Стенд на копии базы', state: 'nightStand', start: 'night-up', stop: 'night-down', link: 'http://localhost:3102/app/',
    hint: 'Копия рабочего сайта для проверки на реальных данных. Адрес: localhost:3102. Нужна скачанная копия базы.' },
];

// Подсказки к результату: текст вывода → что делать. Показываются под журналом запуска.
export const ADVICE = [
  { match: 'есть незакоммиченные изменения', say: 'В папке есть незакоммиченные файлы. Откройте «Git → Что изменено». Попросите Claude закоммитить или дождитесь конца второй сессии.' },
  { match: 'не запушен в origin', say: 'Коммит не отправлен в GitHub. Нажмите «Git → Отправить в GitHub» и повторите выкладку.' },
  { match: 'D:\\datacore-backups is missing', say: 'Нет папки копий. Она нужна только ночному стенду и копии на Sportin. Выкладке и сайту она не нужна.' },
  { match: 'Permission denied (publickey', say: 'Сервер не принял ключ. Запустите «Настройка ПК → Подготовить рабочий ПК».' },
  { match: 'Connection timed out', say: 'Нет связи с сервером. Запустите «Выкладка → Проверить связь с сервером».' },
  { match: 'Could not resolve host', say: 'Нет интернета или недоступен адрес сервера.' },
  { match: 'not a git repository', say: 'Пульт запущен не из папки проекта. Запускайте pult\\Пульт.cmd из репозитория.' },
  { match: 'dubious ownership', say: 'Git не доверяет папке под другим пользователем. Запустите пульт без прав администратора или добавьте папку в safe.directory.' },
  { match: 'Cannot connect to the Docker daemon', say: 'Docker не запущен. Запустите Docker Desktop и повторите.' },
];

// Скрипты проекта, которых нарочно нет на кнопках. Новый скрипт вне каталога и вне этого списка роняет проверку;
// то же для новой подкоманды tools/dc.mjs (pult/audit.mjs): так пульт и справка не отстают от проекта.
export const NOT_ON_BUTTONS = {
  'deploy/synology/api.sh': 'вход для агента datacore-access; запрос собирается вручную',
  'deploy/synology/backup.sh': 'идёт на сервере; кнопка prod-backup вызывает его по ssh',
  'deploy/synology/bundle.cmd': 'меню в консоли; кнопка зовёт bundle-pc.sh напрямую',
  'deploy/synology/bundle-install.sh': 'для новой VM при переезде, вручную по MIGRATE.md',
  'deploy/synology/bundle-watch.sh': 'внутренний шаг сборки пакета на VM',
  'deploy/synology/bundle.sh': 'идёт на сервере; вызывает bundle-pc.sh',
  'deploy/synology/datacore-tunnel.sh': 'служба туннеля на сервере, не на ПК',
  'deploy/synology/deploy.ps1': 'старый путь выкладки с config.env; основной — release.sh',
  'deploy/synology/deploy.py': 'старый путь выкладки; содержит --wipe, на кнопку не выносится',
  'deploy/synology/deploy.sh': 'обёртка над deploy.py',
  'deploy/synology/preflight.ps1': 'проверка для deploy.ps1',
  'deploy/synology/doctor-report.js': 'внутренняя часть doctor.sh',
  'deploy/synology/release.sh': 'кнопка выкладки выбирает его сама по этому ПК',
  'deploy/synology/verify-restore.js': 'внутренняя часть восстановления на сервере',
  'deploy/synology/restore-drill.sh': 'идёт на сервере; кнопка prod-drill вызывает его по ssh',
  'deploy/synology/rollback.sh': 'идёт на сервере; кнопка prod-rollback вызывает его по ssh',
  'remote-access/deploy.sh': 'кнопка выкладки выбирает его сама по этому ПК',
  'remote-access/pch.sh': 'разовый пакет ПЧ-1/2, выполнен 2026-10-30; повторять незачем',
  'SRV-ERP/setup-switch.sh': 'настройка стенда Sportin, запускается на нём',
  'SRV-ERP/backup-erp.sh': 'бэкап второго сервера, идёт по cron на нём (ставит deploy/smb/install-smb.sh --with-backup)',
  'deploy/smb/offsite-smb.sh': 'копии на сетевую папку (SMB), идёт по cron на сервере',
  'deploy/smb/install-smb.sh': 'установка копий по SMB на сервере — кнопки smb-install-home и sportin-smb',
  'SRV-ERP/setup-tunnel.sh': 'настройка стенда Sportin, запускается на нём',
  'tools/dc.cmd': 'обёртка над tools/dc.mjs',
  'tools/dc.mjs find': 'поиск для ИИ по докам и архиву на сервере; слово вводится в команде',
  'tools/dc.mjs doc': 'чтение дока из архива на сервере для ИИ; путь вводится в команде',
  'tools/kit/make-kit.sh': 'просит пароль в терминале; без пароля выдал бы архив со всеми доступами',
  'tools/night.mjs': 'библиотека dc: кнопки зовут tools/dc.mjs',
  'tools/setup-task.ps1': 'вызывается из tools/setup.cmd task',
};

