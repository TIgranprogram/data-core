/* Один шаблон для вкладок «API-ключи» и «Подключение». */
(function () {
  const ACCESS_LABEL = {
    app: 'Только своё приложение',
    read: 'Только чтение',
    write: 'Запись в общую базу',
    full: 'Права выдавшего ключ',
  };
  const APP_NAME = /^[a-z][a-z0-9]{0,39}$/;
  const isAppName = (name) => typeof name === 'string' && APP_NAME.test(name) && name !== 'control';
  const quoted = (value) => '\x60' + value + '\x60';

  function buildManagerFile({ access = 'app', apps = [], apiPath = '/api' } = {}) {
    const base = location.origin + apiPath;
    const privateApp = access === 'app';
    const names = Array.isArray(apps) ? apps.filter(isAppName) : [];
    const app = privateApp && names.length === 1 ? names[0] : '<имя-приложения>';
    const store = base + '/apps/' + app + '/<коллекция>';
    const permission = ACCESS_LABEL[access];

    return [
      '# DataCore — подключение приложения',
      '',
      'API ' + quoted(base),
      'Доступ «' + (permission || 'не указан') + '».',
      '',
      '## Ключ на стороне сервера',
      '',
      'Владелец отдельно помещает ключ в хранилище секретов приложения, переменная DATACORE_API_KEY.',
      'Добавляй на стороне сервера заголовок Authorization: Bearer со значением этой переменной.',
      'Запрашивай имена переменных, а не их значения. Секреты должны оставаться вне промптов, кода, браузера, URL и журналов.',
      '',
      ...(privateApp ? [
        '## Данные своего приложения',
        '',
        'Работай с коллекциями по адресу ' + quoted(store) + '.',
        'Если имя ещё не согласовано, дождись его до настройки подключения.',
        'GET /apps показывает доступное приложение и его коллекции.',
        'GET по коллекции возвращает items, total, page, limit. У объекта есть строковый id.',
        'POST создаёт запись. Для конкретного id доступны GET, PATCH, PUT и мягкое DELETE.',
        'Физическое удаление, общая база и административные маршруты закрыты.',
      ] : [
        '## Контракт и общие данные',
        '',
        'Уточни нужные маршруты по GET /meta/guide, GET /meta/schema и GET /meta/openapi.json.',
        ...(names.length ? ['Разрешённые имена в /apps: ' + names.map(quoted).join(', ') + '.'] : []),
        access === 'read'
          ? 'Используй операции чтения.'
          : 'Любую запись в общую базу предварительно согласуй с владельцем по маршруту и полям.',
        'Ищи существующую запись по id перед правкой. Для отдельных полей используй PATCH.',
      ]),
      '',
      'Перед запуском проверь один ожидаемый ответ на тестовой базе. При 401 или 403 остановись и сверь права.',
      'Указывай в диагностике только адрес без параметров, код HTTP и название операции.',
    ].join('\n');
  }

  function downloadManagerFile(meta) {
    const safe = String(meta.label || 'key').replace(/[^\wа-яёА-ЯЁ-]+/gi, '_').slice(0, 40) || 'key';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([buildManagerFile(meta)], { type: 'text/markdown;charset=utf-8' }));
    a.download = 'datacore-connection-' + safe + '.md';
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  window.DcConnectPrompt = { ACCESS_LABEL, isAppName, buildManagerFile, downloadManagerFile };
})();
