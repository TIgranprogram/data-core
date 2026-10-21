/**
 * Все ошибки API — по-русски (замечание пользователя 2026-10-19: «почему ошибки на английском?»).
 * Сообщения пишутся по-русски прямо в коде; этот словарь — страховка для унаследованных от kppdf
 * английских текстов и стандартных сообщений class-validator. Последний рубеж — понятный текст по коду
 * ответа; английский оригинал при этом уходит в поле `detail` (для разработчиков), а не пользователю.
 */
const EXACT: Record<string, string> = {
  'Only the system owner can create administrator accounts': 'Создавать администраторов может только владелец системы.',
  'Only the system owner can create administrator device invites': 'Приглашения для устройств администратора может создавать только владелец системы.',
  'Managing administrator accounts requires the system owner': 'Управлять учётными записями администраторов может только владелец системы.',
  'Managing administrator devices requires the system owner': 'Управлять устройствами администраторов может только владелец системы.',
  'This action is available only to the system owner': 'Это действие доступно только владельцу системы.',
  'Owner devices are bound to the owner and cannot change role': 'Устройства владельца привязаны к нему — роль менять нельзя.',
  'Owner not found or inactive': 'Владелец системы не найден или отключён.',
  'Last admin invariant violated': 'Нельзя удалить или понизить последнего администратора.',
  'Wrong old password': 'Старый пароль указан неверно.',
  'You can only change your own password': 'Менять можно только свой пароль.',
  'You can only edit your own profile': 'Изменять можно только свой профиль.',
  'You can only view your own profile': 'Смотреть можно только свой профиль.',
  'User not found': 'Пользователь не найден.',
  'User not found or inactive': 'Пользователь не найден или отключён.',
  'Refresh token revoked': 'Сессия завершена — войдите снова.',
  'Public registration is disabled. Use a device invite link.': 'Самостоятельная регистрация отключена — попросите у администратора приглашение.',
  'Authentication required for permission check': 'Нужно войти в систему.',
  'No user context': 'Нужно войти в систему.',
  'Invalid id': 'Некорректный идентификатор.',
  'Invalid entityId': 'Некорректный идентификатор записи.',
  'Invalid organizationId': 'Некорректная организация.',
  'Invalid organization scope': 'Нет доступа к этой организации.',
  'Invalid counterpartyId': 'Некорректный контрагент.',
  'Invalid collection name': 'Некорректное имя таблицы.',
  'Invalid composition line id': 'Некорректная строка состава.',
  'Invalid scope.access': 'Некорректные права ключа (read, write или full).',
  'Invalid ttl': 'Некорректный срок действия ключа.',
  'Invalid pairing key': 'Ключ не подходит.',
  'Not a pairing key': 'Это не ключ доступа.',
  'Pairing key expired': 'Срок действия ключа истёк.',
  'Pairing key revoked': 'Ключ отозван.',
  'Key not found': 'Ключ не найден.',
  'Invite not found': 'Приглашение не найдено.',
  'Device not found': 'Устройство не найдено.',
  'Device credential expired': 'Доступ устройства истёк — привяжите его заново.',
  'Device credential revoked': 'Доступ устройства отозван.',
  'Device role inactive': 'Роль устройства отключена.',
  'Device user inactive': 'Пользователь устройства отключён.',
  'No active device credential': 'У устройства нет действующего доступа.',
  'No device credential': 'Устройство не привязано.',
  'Idempotency-Key reused with a different payload': 'Повтор запроса с другими данными — обновите страницу и повторите.',
  'Validation failed': 'Проверьте заполнение полей.',
  'Internal server error': 'Ошибка на сервере. Повторите позже; если не проходит — сообщите администратору.',
  'MongoDB is not connected': 'База данных недоступна. Повторите через минуту.',
  'Status is already the requested value': 'Статус уже такой.',
  'Category cannot be its own parent': 'Категория не может быть вложена сама в себя.',
  'Cannot move category under its own descendant (would create a cycle)': 'Нельзя перенести категорию внутрь её же подкатегории.',
  'Category has active children or catalog references and cannot be archived': 'В категории есть подкатегории или позиции — сначала перенесите их.',
  'Material is referenced by catalog history and cannot be archived': 'Материал используется в изделиях или документах — удалить нельзя.',
  'Product is referenced by catalog history and cannot be archived': 'Изделие используется в заказах или документах — удалить нельзя.',
  'ProductModule is referenced by catalog history and cannot be archived': 'Модуль используется в изделиях — удалить нельзя.',
  'WorkType is referenced by catalog history and cannot be archived': 'Вид работ используется — удалить нельзя.',
  'Site does not belong to the selected counterparty': 'Площадка не относится к выбранному контрагенту.',
  'Duplicate composition line': 'Такая строка уже есть в составе.',
  'Product lines are not allowed on module composition': 'В состав модуля нельзя добавлять изделия.',
  'Product lines may only be added to products, not modules': 'Изделия можно добавлять только в состав изделия.',
  'Raw materials may only be added to modules': 'Материалы добавляются только в состав модуля.',
  'Legacy materials[] writes are disabled; use the composition API': 'Состав меняется только через раздел «Состав».',
  'Legacy productModuleIds writes are disabled; use the composition API': 'Состав меняется только через раздел «Состав».',
  'At least one of url or photoId is required': 'Укажите фото: файл или ссылку.',
  'Key must be 2-8 uppercase letters (ISO 4217 code)': 'Код валюты — 2–8 латинских заглавных букв (например RUB).',
  'LIMIT_FILE_SIZE': 'Файл слишком большой.',
  'LIMIT_FILE_COUNT': 'Слишком много файлов.',
  'LIMIT_PART_COUNT': 'Слишком много частей в запросе.',
  'LIMIT_UNEXPECTED_FILE': 'Файл передан не в то поле.',
  'Unauthorized': 'Нужно войти снова.',
  'Forbidden': 'Недостаточно прав для этого действия.',
  'Forbidden resource': 'Недостаточно прав для этого действия.',
  'Not Found': 'Не найдено.',
  'Bad Request': 'Некорректный запрос.',
  'Conflict': 'Конфликт данных: запись изменилась или уже существует.',
  'Too Many Requests': 'Слишком много запросов подряд. Подождите минуту.',
  'ThrottlerException: Too Many Requests': 'Слишком много запросов подряд. Подождите минуту.',
  'Payload Too Large': 'Слишком большой файл или запрос.',
};

const PATTERNS: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/^User access revoked: (.+)$/i, () => 'Доступ пользователя отключён — обратитесь к администратору.'],
  [/^Invalid (?:category|child category|parent) id: (.+)$/i, () => 'Некорректная категория.'],
  [/^Invalid colorId (.+)$/i, () => 'Некорректный цвет.'],
  [/^Unsupported mimetype: (.+)$/i, (m) => `Такой тип файла не поддерживается (${m[1]}). Загрузите JPG, PNG или WEBP.`],
  [/^Unsupported composition lineType: (.+)$/i, () => 'Неизвестный тип строки состава.'],
  [/^Composition cannot contain more than (\d+) lines$/i, (m) => `В составе не больше ${m[1]} строк.`],
  [/^\S+ \S+ changed while composition was being updated$/i, () => 'Запись изменилась, пока сохранялся состав — обновите страницу и повторите.'],
  [/^Collection not found: ?(.*)$/i, (m) => `Таблица не найдена${m[1] ? ` (${m[1]})` : ''}.`],
  [/^Contact \S+ not found for organization \S+$/i, () => 'Контакт не найден у этой организации.'],
  [/^ProductPassport for product \S+ not found$/i, () => 'Паспорт изделия не найден.'],
  [/^Composition line \S+ not found$/i, () => 'Строка состава не найдена.'],
  [/^Dictionary label \S+ not found$/i, () => 'Подпись справочника не найдена.'],
  [/^System (?:OrgRole|CounterpartyRole) .*$/i, () => 'Системную роль менять или удалять нельзя.'],
  [/^No file uploaded/i, () => 'Файл не загружен — выберите файл.'],
  [/E11000 duplicate key/i, () => 'Такая запись уже есть (повтор уникального значения).'],
  [/^Google: (.+)$/i, (m) => `Ошибка Google: ${m[1]}`],
];

/** Подписи полей в сообщениях проверки. */
const FIELD_RU: Record<string, string> = {
  username: 'Логин', password: 'Пароль', newPassword: 'Новый пароль', oldPassword: 'Старый пароль', displayName: 'Имя',
  email: 'Email', role: 'Роль', isActive: 'Активен', name: 'Название', title: 'Наименование', qty: 'Количество',
  unit: 'Ед. изм.', article: 'Артикул', inn: 'ИНН', phone: 'Телефон', ttl: 'Срок действия', label: 'Название',
  priceHint: 'Сумма', invoiceNo: '№ счёта', invoiceDate: 'Дата счёта', requestDate: 'Дата заявки', notes: 'Примечание',
  minQuantity: 'Мин. остаток', weightKg: 'Вес', type: 'Тип', note: 'Примечание', url: 'Ссылка', key: 'Ключ', value: 'Значение',
  orderNo: '№ заказа', customer: 'Заказчик', unitPrice: 'Цена', amountManual: 'Доход вручную', shipDate: 'Дата отгрузки', paidDate: 'Дата оплаты',
};
export const fieldRu = (f: string) => FIELD_RU[f] ?? f;

const CV: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/^property (\S+) should not exist$/i, (m) => `${m[1]}: лишнее поле — сервер его не принимает.`],
  [/^(\S+) should not be empty$/i, (m) => `${m[1]}: заполните поле.`],
  [/^(\S+) should not be null or undefined$/i, (m) => `${m[1]}: заполните поле.`],
  [/^(\S+) must be an email$/i, (m) => `${m[1]}: некорректный адрес почты.`],
  [/^(\S+) must be a valid ISO 8601 date string$/i, (m) => `${m[1]}: некорректная дата.`],
  [/^(\S+) must be a Date instance$/i, (m) => `${m[1]}: некорректная дата.`],
  [/^(\S+) must be a boolean value$/i, (m) => `${m[1]}: должно быть «да» или «нет».`],
  [/^(\S+) must be an array$/i, (m) => `${m[1]}: должен быть список.`],
  [/^each value in (\S+) .+$/i, (m) => `${m[1]}: некорректное значение в списке.`],
  [/^(\S+) must match .+ regular expression$/i, (m) => `${m[1]}: некорректный формат.`],
];

const BY_STATUS: Record<number, string> = {
  400: 'Некорректные данные запроса. Проверьте заполнение полей.',
  401: 'Нужно войти снова.',
  403: 'Недостаточно прав для этого действия.',
  404: 'Не найдено — возможно, запись уже удалили.',
  409: 'Конфликт данных: запись изменилась или уже существует. Обновите страницу.',
  413: 'Слишком большой файл или запрос.',
  422: 'Проверьте заполнение полей.',
  429: 'Слишком много запросов подряд. Подождите минуту.',
};

export const hasCyrillic = (s: string) => /[а-яё]/i.test(s);

/** Английский текст → русский (точное совпадение, шаблоны, проверки полей). null — перевода нет. */
export function translateMessage(msg: string): string | null {
  const s = msg.trim();
  if (!s || hasCyrillic(s)) return null;
  if (EXACT[s]) return EXACT[s];
  for (const [re, fn] of [...PATTERNS, ...CV]) {
    const m = s.match(re);
    if (m) return fn(m);
  }
  return null;
}

/** Последний рубеж: текст без кириллицы заменяется понятным по коду ответа. */
export function russianFallback(status: number): string {
  return BY_STATUS[status] ?? (status >= 500 ? EXACT['Internal server error'] : 'Не удалось выполнить действие.');
}

/** «username: текст» → «Логин: текст» (путь вложенного поля — по последнему имени). */
export function localizeFieldPrefix(msg: string): string {
  return msg.replace(/^([A-Za-z_][\w.]*): /, (all, path: string) => {
    const leaf = path.split('.').pop()!;
    return FIELD_RU[leaf] ? `${FIELD_RU[leaf]}: ` : all;
  });
}
